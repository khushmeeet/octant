import type { RepoRef } from '$lib/source/types';
import { store as defaultStore } from '$lib/store';
import type { Store } from '$lib/store/types';
import { repoVisitId } from './ids';

/**
 * What we remember about looking at a repository — ARCHITECTURE.md §6.
 *
 * One record per repository, read once per page session and shared by every
 * screen of it. Two properties fall out of that, and both are the feature
 * rather than an optimisation:
 *
 * **The base does not move while you are here.** `lastSeenSha` is the value as
 * it was when you arrived, and recording the visit does not change it. So the
 * delta stays on screen while you read it, and walking Tree → File → Log →
 * Refs shows the same answer on all four instead of emptying it on the first
 * navigation. A per-screen read would have blanked the panel the moment you
 * used what it told you.
 *
 * **The visit is recorded once.** ARCHITECTURE.md §6 asks for last-seen to be
 * "debounced on view", and the debounce here is doing two jobs: it keeps a
 * screen you passed through in half a second from spending the record, and it
 * keeps four screens of one repository from writing four times.
 *
 * This is the opposite call from `review.svelte.ts`, deliberately, and the
 * reason is in that file: recording a pull request's head on view would empty
 * the "since my last review" diff before it had been read. Browsing is not
 * reviewing — looking at a tree really is seeing it.
 */

/** Long enough that a pass-through does not spend the record. */
export const RECORD_AFTER = 2_000;

export interface RepoMemory {
	/** The record has been read. Before this, nothing is known — not "nothing". */
	readonly ready: boolean;
	/** HEAD as of your last visit, frozen for the life of this session. */
	readonly lastSeenSha: string | null;
	readonly lastSeenAt: number | null;
	/** Every head recorded for this repository, oldest first. */
	readonly shas: readonly string[];
	/** You have been here before. `false` on a first visit, which is not "nothing changed". */
	readonly known: boolean;
	/**
	 * Note that this repository is on screen at `sha`. Debounced, and idempotent
	 * for a head already recorded this session.
	 */
	see(sha: string | null): void;
}

interface Entry extends RepoMemory {
	dispose(): void;
}

/**
 * Module scope, keyed by repository — this *is* the sharing. A registry rather
 * than a component-owned resource, because the thing being shared is a decision
 * about time ("when did you arrive"), and that has to outlive any one screen.
 *
 * A plain `Map` and not a `SvelteMap`, deliberately: the reactivity lives
 * inside each entry, and this is only ever read by key. Making the registry
 * itself reactive would make every screen in the app depend on which
 * repositories have been opened.
 */
// eslint-disable-next-line svelte/prefer-svelte-reactivity -- see above
const memories = new Map<string, Entry>();

export function repoMemory(repo: RepoRef, store: Store = defaultStore): RepoMemory {
	const id = repoVisitId(repo);

	let entry = memories.get(id);
	if (!entry) {
		entry = create(id, store);
		memories.set(id, entry);
	}
	return entry;
}

/** Tests and sign-out. A new session must not inherit the last one's arrival. */
export function forgetRepoMemories(): void {
	for (const entry of memories.values()) entry.dispose();
	memories.clear();
}

function create(id: string, store: Store): Entry {
	let ready = $state(false);
	let lastSeenSha = $state<string | null>(null);
	let lastSeenAt = $state<number | null>(null);
	let shas = $state<string[]>([]);
	let known = $state(false);

	/** The head we have already written, so the tick's pushes do not re-write. */
	let recorded: string | null = null;
	let timer: ReturnType<typeof setTimeout> | null = null;

	// Read first, and only once. Everything on screen is measured against this.
	void store
		.lastVisit(id)
		.catch(() => undefined)
		.then((visit) => {
			// A missing record is a first visit, not a failure. Either way the
			// screen is entitled to an answer.
			if (visit) {
				lastSeenSha = visit.lastSeenSha;
				lastSeenAt = visit.lastSeenAt;
				shas = visit.shas ?? (visit.lastSeenSha ? [visit.lastSeenSha] : []);
				known = true;
			}
			ready = true;
		});

	return {
		get ready() {
			return ready;
		},
		get lastSeenSha() {
			return lastSeenSha;
		},
		get lastSeenAt() {
			return lastSeenAt;
		},
		get shas() {
			return shas;
		},
		get known() {
			return known;
		},

		see(sha) {
			if (!sha || sha === recorded) return;

			// A head that moved under us — the background tick, or a push while the
			// screen was open — restarts the debounce against the new one.
			if (timer) clearTimeout(timer);
			timer = setTimeout(() => {
				timer = null;
				recorded = sha;
				// Written behind the render, which is already correct: what is on
				// screen was computed from the record as it was on arrival.
				void store.visit(id, sha).catch(() => {});
			}, RECORD_AFTER);
		},

		dispose() {
			if (timer) clearTimeout(timer);
			timer = null;
		}
	};
}

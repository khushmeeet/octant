import { SvelteMap } from 'svelte/reactivity';
import type { RepoRef } from '$lib/source/types';
import { store as defaultStore } from '$lib/store';
import type { Store, Visit } from '$lib/store/types';
import { fileVisitPrefix, pullVisitId } from './ids';

/**
 * What we remember about reviewing a pull request — ARCHITECTURE.md §6, in the
 * one place Phase 7 cannot do without it.
 *
 * The `visits` store has existed since Phase 2 and has had no caller. Phase 8
 * is where it becomes a feature — a "since your last visit" block on every
 * screen, dots on tree rows, ownership from `CODEOWNERS`. This file is
 * deliberately not that. It is the narrow slice the Review screen's *main view*
 * depends on, because PLAN.md Phase 7 makes "since my last review" the default
 * view rather than an option, and a default view cannot wait for a later phase.
 *
 * Two records, and they are the same shape the store already had. Their ids
 * moved to `ids.ts` in Phase 8, where every screen that reads them can agree on
 * what they are called:
 *
 *   `pull:{owner}/{name}:{n}`            when you last reviewed, and at what head
 *   `pull:{owner}/{name}:{n}:f:{path}`   when you marked one file viewed, and at what head
 *
 * `lastSeenSha` earns its name here: it is the base of the "since my last
 * review" comparison, so the whole default view of the hardest screen is one
 * string in IndexedDB.
 *
 * **Reviewing is recorded explicitly, not on view.** ARCHITECTURE.md §6 says
 * last-seen is "debounced on view", and that is right for a tree or a file —
 * looking at it *is* seeing it. It is wrong here, and dangerously so: recording
 * the head SHA the moment the screen opens would empty the "since my last
 * review" diff before you had read a line of it, and the next visit would show
 * you nothing while the work you skipped sat behind it. So the record is
 * written by the verb, and by marking the last file viewed — both of which are
 * a person saying they are done rather than a screen assuming it.
 */

export interface ReviewMemory {
	/** The records have been read. Before this, nothing is known — not "nothing". */
	readonly ready: boolean;
	/** The head SHA the last time this pull request was marked reviewed. */
	readonly lastSeenSha: string | null;
	readonly lastSeenAt: number | null;
	/**
	 * Every head this pull request has been marked reviewed at, oldest first —
	 * Phase 8's recorded head-SHA history. More than one entry means the branch
	 * has moved under a review that was already done once.
	 */
	readonly shas: readonly string[];
	/** Path → the head SHA it was marked viewed at. */
	readonly viewedAt: ReadonlyMap<string, string | null>;

	/** Mark one file viewed at `sha`, or un-mark it if it already is. */
	toggleFile(path: string, sha: string): void;
	markFiles(paths: readonly string[], sha: string): void;
	/** Record that this pull request was reviewed at `sha`. */
	markReviewed(sha: string): void;
}

export interface ReviewMemoryOptions {
	store?: Store;
}

/**
 * Create it during component initialisation — it owns an `$effect`, and follows
 * whatever `address` reads, exactly as `resource()` does.
 */
export function reviewMemory(
	address: () => { repo: RepoRef; number: number } | null,
	options: ReviewMemoryOptions = {}
): ReviewMemory {
	const store = options.store ?? defaultStore;

	let ready = $state(false);
	let visit = $state<Visit | null>(null);

	/**
	 * Reactive per entry, because that is exactly how it is read: a diff asks
	 * "is this one path viewed" once per file header, and marking one file
	 * should not invalidate the answer for the other thirty-nine.
	 */
	const files = new SvelteMap<string, string | null>();

	/** The pull request currently loaded. Not reactive, by design. */
	let loaded: string | null = null;
	/** Monotonic, so a slow read cannot land on top of a newer one. */
	let generation = 0;

	$effect(() => {
		const at = address();
		const id = at ? pullVisitId(at.repo, at.number) : null;

		if (id === loaded) return;
		loaded = id;
		generation += 1;

		ready = false;
		visit = null;
		files.clear();

		if (!at || !id) return;
		void load(at.repo, at.number, generation);
	});

	async function load(repo: RepoRef, number: number, mine: number): Promise<void> {
		const id = pullVisitId(repo, number);
		const prefix = fileVisitPrefix(repo, number);

		// Two reads rather than one, and they go together: a missing visits record
		// is not a data failure, it is a reader who has not reviewed anything yet.
		const [seen, marks] = await Promise.all([
			store.lastVisit(id).catch(() => undefined),
			store.visitsUnder(prefix).catch(() => null)
		]);
		if (mine !== generation) return;

		files.clear();
		for (const [key, record] of marks ?? []) {
			files.set(key.slice(prefix.length), record.lastSeenSha);
		}

		visit = seen ?? null;
		ready = true;
	}

	/** Written through to disk behind the render, which is already correct. */
	function put(id: string, sha: string | null): void {
		void store.visit(id, sha).catch(() => {});
	}

	function drop(id: string): void {
		void store.forget(id).catch(() => {});
	}

	return {
		get ready() {
			return ready;
		},
		get lastSeenSha() {
			return visit?.lastSeenSha ?? null;
		},
		get lastSeenAt() {
			return visit?.lastSeenAt ?? null;
		},
		get shas() {
			return visit?.shas ?? (visit?.lastSeenSha ? [visit.lastSeenSha] : []);
		},
		get viewedAt() {
			return files;
		},

		toggleFile(path, sha) {
			const at = address();
			if (!at) return;

			const id = `${fileVisitPrefix(at.repo, at.number)}${path}`;
			if (files.has(path)) {
				files.delete(path);
				drop(id);
			} else {
				files.set(path, sha);
				put(id, sha);
			}
		},

		markFiles(paths, sha) {
			const at = address();
			if (!at) return;

			const prefix = fileVisitPrefix(at.repo, at.number);
			for (const path of paths) {
				if (files.get(path) === sha) continue;
				files.set(path, sha);
				put(`${prefix}${path}`, sha);
			}
		},

		markReviewed(sha) {
			const at = address();
			if (!at) return;

			// The history the store keeps is appended to on write; mirroring it here
			// keeps the panel honest before the write has landed.
			const seen = visit?.shas ?? (visit?.lastSeenSha ? [visit.lastSeenSha] : []);
			visit = {
				lastSeenAt: Date.now(),
				lastSeenSha: sha,
				shas: seen[seen.length - 1] === sha ? seen : [...seen, sha]
			};
			put(pullVisitId(at.repo, at.number), sha);
		}
	};
}

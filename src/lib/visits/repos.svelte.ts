import { SvelteMap } from 'svelte/reactivity';
import { store as defaultStore } from '$lib/store';
import type { Store } from '$lib/store/types';
import { REPO_VISIT_PREFIX, repoSlugFrom } from './ids';

/**
 * What the home screen remembers — ARCHITECTURE.md §6, applied above the
 * repository rather than inside one.
 *
 * Like the Review list's delta, this one costs **no request at all**. Every
 * repository screen already writes a record when you look at it, and the
 * repository list already carries every row's `pushedAt`, so "has anything
 * landed here since I last opened it" is a comparison between two values we
 * hold — read as one prefix scan, once per screen, rather than a read per row.
 *
 * It is a *time* comparison and not a SHA one, which is the difference between
 * this and every other since-block in the app. The repository list does not
 * carry heads — asking for one per row would be a field per row on a list whose
 * whole point is that a row costs nothing — and the record's `lastSeenAt` is
 * enough to answer the only question the screen asks: is it worth opening.
 * Inside the repository, `sinceLastVisit` still does the exact version.
 */

export type RepoState =
	/** No record. You have never opened it here. */
	| 'unseen'
	/** Opened before, and pushed to since. */
	| 'moved'
	/** Opened, and nothing has landed since. */
	| 'seen';

export interface ReposSeen {
	/** The records have been read. Before this, nothing is known — not "nothing". */
	readonly ready: boolean;
	/** Repositories with a record, however old, including ones not on screen. */
	readonly count: number;
	stateOf(nameWithOwner: string, pushedAt: string): RepoState;
	/** When you last had it open, for a row's tooltip. */
	seenAt(nameWithOwner: string): number | null;
}

export interface ReposSeenOptions {
	store?: Store;
}

/** Create during component initialisation — it owns an `$effect`. */
export function reposSeen(options: ReposSeenOptions = {}): ReposSeen {
	const store = options.store ?? defaultStore;

	let ready = $state(false);
	/** `owner/name` → when it was last on screen. Reactive per entry. */
	const marks = new SvelteMap<string, number>();

	$effect(() => {
		void load();
	});

	async function load(): Promise<void> {
		const records = await store.visitsUnder(REPO_VISIT_PREFIX).catch(() => null);

		marks.clear();
		for (const [id, record] of records ?? []) marks.set(repoSlugFrom(id), record.lastSeenAt);

		ready = true;
	}

	return {
		get ready() {
			return ready;
		},
		get count() {
			return marks.size;
		},
		stateOf(nameWithOwner, pushedAt) {
			const seen = marks.get(nameWithOwner);
			if (seen === undefined) return 'unseen';

			// A repository with no push date at all — one that has never had a
			// commit — has nothing to have landed since. `Date.parse` rather than a
			// `Date`, which is a mutable object we would only ever read one number
			// from, once per row.
			const pushed = pushedAt ? Date.parse(pushedAt) : Number.NaN;
			return Number.isFinite(pushed) && pushed > seen ? 'moved' : 'seen';
		},
		seenAt(nameWithOwner) {
			return marks.get(nameWithOwner) ?? null;
		}
	};
}

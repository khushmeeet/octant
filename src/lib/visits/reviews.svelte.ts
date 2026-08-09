import { SvelteMap } from 'svelte/reactivity';
import type { RepoRef } from '$lib/source/types';
import { store as defaultStore } from '$lib/store';
import type { Store } from '$lib/store/types';
import { pullNumberFrom, pullVisitPrefix } from './ids';

/**
 * What the triage list remembers — PLAN.md Phase 8's delta for the Review
 * screen.
 *
 * Every other screen's "since your last visit" costs a comparison. This one
 * costs **nothing at all**: Phase 7 already writes a record per pull request
 * when you mark it reviewed, and the list already carries every row's head SHA,
 * so "has this moved since I looked at it" is a string comparison against a
 * prefix scan that runs once per screen.
 *
 * That is `visitsUnder` earning its second caller, which is why Phase 7 put it
 * on the `Store` rather than reading a key at a time: a round trip per row is
 * the shape ARCHITECTURE.md §7 rules out, and a list is all rows.
 */

export type ReviewState =
	/** No record. You have never marked this one reviewed. */
	| 'unseen'
	/** Reviewed, and pushed to since. */
	| 'moved'
	/** Reviewed at the head it is still on. */
	| 'seen';

export interface ReviewsSeen {
	/** The records have been read. Before this, nothing is known — not "nothing". */
	readonly ready: boolean;
	/** Pull requests with a record, however old. */
	readonly count: number;
	stateOf(number: number, headOid: string): ReviewState;
	/** The head you last reviewed it at, for a row's tooltip. */
	reviewedAt(number: number): string | null;
}

export interface ReviewsSeenOptions {
	store?: Store;
}

/** Create during component initialisation — it owns an `$effect`. */
export function reviewsSeen(
	input: () => RepoRef | null,
	options: ReviewsSeenOptions = {}
): ReviewsSeen {
	const store = options.store ?? defaultStore;

	let ready = $state(false);
	/** Number → the head it was reviewed at. Reactive per entry, as in `review.svelte.ts`. */
	const marks = new SvelteMap<number, string | null>();

	let loaded: string | null = null;
	let generation = 0;

	$effect(() => {
		const repo = input();
		const prefix = repo ? pullVisitPrefix(repo) : null;

		if (prefix === loaded) return;
		loaded = prefix;
		generation += 1;

		ready = false;
		marks.clear();

		if (!prefix) return;
		void load(prefix, generation);
	});

	async function load(prefix: string, mine: number): Promise<void> {
		const records = await store.visitsUnder(prefix).catch(() => null);
		if (mine !== generation) return;

		marks.clear();
		for (const [id, record] of records ?? []) {
			// The scan also returns each pull request's *file* records. A bare
			// number is the pull request itself; `7:f:src/app.ts` is not.
			const number = pullNumberFrom(id, prefix);
			if (number !== null) marks.set(number, record.lastSeenSha);
		}

		ready = true;
	}

	return {
		get ready() {
			return ready;
		},
		get count() {
			return marks.size;
		},
		stateOf(number, headOid) {
			if (!marks.has(number)) return 'unseen';
			return marks.get(number) === headOid ? 'seen' : 'moved';
		},
		reviewedAt(number) {
			return marks.get(number) ?? null;
		}
	};
}

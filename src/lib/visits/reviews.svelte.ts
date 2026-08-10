import { SvelteMap } from 'svelte/reactivity';
import type { RepoRef } from '$lib/source/types';
import { store as defaultStore } from '$lib/store';
import type { Store } from '$lib/store/types';
import { isPullVisitId, pullVisitId, pullVisitPrefix, PULL_VISIT_PREFIX } from './ids';

/**
 * What a pull request list remembers — PLAN.md Phase 8's delta for the Review
 * screen, and the home screen's for the same rows across every repository.
 *
 * Every other screen's "since your last visit" costs a comparison. This one
 * costs **nothing at all**: Phase 7 already writes a record per pull request
 * when you mark it reviewed, and a list already carries every row's head SHA,
 * so "has this moved since I looked at it" is a string comparison against a
 * prefix scan that runs once per screen.
 *
 * That is `visitsUnder` earning its second caller, which is why Phase 7 put it
 * on the `Store` rather than reading a key at a time: a round trip per row is
 * the shape ARCHITECTURE.md §7 rules out, and a list is all rows.
 *
 * The two callers differ only in how much of the tree they scan — one
 * repository's pull requests, or all of them — so they share the scan and
 * differ in the key they look a row up by. Ids are hierarchical for exactly
 * this: a narrower prefix is a smaller answer to the same question.
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

/** The same, for a list that spans repositories: the row names its own. */
export interface InboxSeen {
	readonly ready: boolean;
	readonly count: number;
	stateOf(repo: RepoRef, number: number, headOid: string): ReviewState;
	reviewedAt(repo: RepoRef, number: number): string | null;
}

export interface ReviewsSeenOptions {
	store?: Store;
}

/** Create during component initialisation — it owns an `$effect`. */
export function reviewsSeen(
	input: () => RepoRef | null,
	options: ReviewsSeenOptions = {}
): ReviewsSeen {
	const scan = records(() => {
		const repo = input();
		return repo ? pullVisitPrefix(repo) : null;
	}, options);

	return {
		get ready() {
			return scan.ready;
		},
		get count() {
			return scan.marks.size;
		},
		stateOf(number, headOid) {
			const repo = input();
			return repo ? stateOf(scan.marks, pullVisitId(repo, number), headOid) : 'unseen';
		},
		reviewedAt(number) {
			const repo = input();
			return repo ? (scan.marks.get(pullVisitId(repo, number)) ?? null) : null;
		}
	};
}

/**
 * Every pull request record there is. One scan, however many repositories the
 * list on screen spans — the home screen's list spans all of them, and reading
 * a record per row would be the round trip per row §7 rules out.
 */
export function inboxSeen(options: ReviewsSeenOptions = {}): InboxSeen {
	const scan = records(() => PULL_VISIT_PREFIX, options);

	return {
		get ready() {
			return scan.ready;
		},
		get count() {
			return scan.marks.size;
		},
		stateOf(repo, number, headOid) {
			return stateOf(scan.marks, pullVisitId(repo, number), headOid);
		},
		reviewedAt(repo, number) {
			return scan.marks.get(pullVisitId(repo, number)) ?? null;
		}
	};
}

function stateOf(
	marks: SvelteMap<string, string | null>,
	id: string,
	headOid: string
): ReviewState {
	if (!marks.has(id)) return 'unseen';
	return marks.get(id) === headOid ? 'seen' : 'moved';
}

interface Records {
	readonly ready: boolean;
	/** Visit id → the head it was reviewed at. Reactive per entry. */
	readonly marks: SvelteMap<string, string | null>;
}

function records(prefix: () => string | null, options: ReviewsSeenOptions): Records {
	const store = options.store ?? defaultStore;

	let ready = $state(false);
	const marks = new SvelteMap<string, string | null>();

	let loaded: string | null = null;
	let generation = 0;

	$effect(() => {
		const at = prefix();

		if (at === loaded) return;
		loaded = at;
		generation += 1;

		ready = false;
		marks.clear();

		if (!at) return;
		void load(at, generation);
	});

	async function load(at: string, mine: number): Promise<void> {
		const found = await store.visitsUnder(at).catch(() => null);
		if (mine !== generation) return;

		marks.clear();
		for (const [id, record] of found ?? []) {
			// The scan also returns each pull request's *file* records. Only the
			// pull request's own record is a row.
			if (isPullVisitId(id)) marks.set(id, record.lastSeenSha);
		}

		ready = true;
	}

	return {
		get ready() {
			return ready;
		},
		get marks() {
			return marks;
		}
	};
}

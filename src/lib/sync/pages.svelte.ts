import type { SourceError } from '$lib/source/errors';
import type { CacheQuery, PageOf } from '$lib/source/query';
import { store as defaultStore } from '$lib/store';
import type { Store } from '$lib/store/types';
import { settle } from './settle';

/**
 * `pages()` — PLAN.md Phase 5, and the answer to the question Phase 2 left
 * open: `resource()` has no pagination, and the log is the first screen that
 * needs it.
 *
 * It is `resource()`'s read path applied once per page, with one idea added:
 * **a cursor is part of an address.** The caller hands over a function from a
 * cursor to a query, so every page is a cache entry in its own right, keyed by
 * where it starts. Three things follow, and they are why this is not a list
 * held in memory behind a single key:
 *
 * - Walking back down a log you have already read is a local read, page by
 *   page, because each page is still filed under the cursor that fetched it.
 * - A page of a log addressed by commit SHA is immutable, like everything else
 *   addressed by a SHA — the key scheme decides that, not this file.
 * - The first page can be revalidated on its own. It is the only one that
 *   moves; the ones behind it are history.
 *
 * When the first page comes back with a different `endCursor` than it had, the
 * pages behind it are dropped: they were addressed from a cursor that no longer
 * ends anything. Keeping them would be splicing two different walks together
 * and calling the result a log.
 *
 * Create it during component initialisation — it owns an `$effect`.
 */

export interface Paged<T> {
	/** Every page loaded so far, in order. */
	readonly items: readonly T[];
	/** Nothing to show yet and the first page is out. Never true over data. */
	readonly loading: boolean;
	/** A further page is out. The rows already on screen stay on screen. */
	readonly loadingMore: boolean;
	/** What is shown is not known to be current, or a revalidation failed. */
	readonly stale: boolean;
	readonly error: SourceError | null;
	/** Whether the source says there is anything past what is loaded. */
	readonly hasMore: boolean;
	/** Across the whole walk, `null` before the first page lands. */
	readonly total: number | null;
	readonly pages: number;
	/** Load the next page. A no-op while one is out, or at the end. */
	more(): void;
	/** Go to the network for the first page regardless of what is cached. */
	refresh(): void;
}

export interface PagesOptions {
	store?: Store;
}

export function pages<T>(
	input: (after: string | null) => CacheQuery<PageOf<T>> | null,
	options: PagesOptions = {}
): Paged<T> {
	const store = options.store ?? defaultStore;

	/** Replaced wholesale, never mutated — so a page needs no proxy. */
	let loaded = $state.raw<PageOf<T>[]>([]);
	let error = $state<SourceError | null>(null);
	let loading = $state(false);
	let loadingMore = $state(false);
	let stale = $state(false);

	let ticket = $state({ force: false });

	/** The first page's address. What identifies the walk. */
	let address: string | null = null;
	/** Monotonic. Guards every state write against an out-of-order answer. */
	let generation = 0;
	let head: AbortController | null = null;
	let tail: AbortController | null = null;

	const items = $derived(loaded.flatMap((page) => page.items));

	$effect(() => {
		const first = input(null);
		const { force } = ticket;

		if (!first) {
			abort();
			generation += 1;
			address = null;
			reset();
			return;
		}

		// A descriptor is a fresh object on every read, so an unrelated state
		// change re-runs this effect at the identical address. Reissuing the same
		// request is waste we pay for out of the rate limit.
		if (!force && first.key.id === address) return;

		if (first.key.id !== address) {
			address = first.key.id;
			reset();
			loading = true;
		}

		abort();
		head = new AbortController();
		void load(first, (generation += 1), 0, force, head.signal);
	});

	// No dependencies, so this runs its cleanup once, on destroy.
	$effect(() => () => {
		generation += 1;
		abort();
	});

	async function load(
		query: CacheQuery<PageOf<T>>,
		mine: number,
		index: number,
		force: boolean,
		signal: AbortSignal
	): Promise<void> {
		let etag: string | null = null;

		if (!force) {
			// A cache failure is not a data failure: fall through to the network.
			const hit = await store.get<PageOf<T>>(query.key, query.maxAge).catch(() => undefined);
			if (mine !== generation) return;

			if (hit) {
				etag = hit.etag;
				place(index, hit.value);
				error = null;
				loading = false;
				loadingMore = false;
				stale = hit.stale;

				// Immutable, or inside its window. This is the branch that makes
				// paging back down a log you have read cost nothing.
				if (!hit.stale) return;
			}
		}

		let result;
		try {
			result = await settle(query, store, etag, signal);
		} catch {
			// This caller walked away. Sharing is reference counted, so the request
			// lives on for anyone still waiting, and the state is left as it was.
			if (mine === generation) settled();
			return;
		}

		if (mine !== generation) return;
		settled();

		if (!result.ok) {
			// The caller walked away. Leave the state exactly as it was.
			if (result.error.kind === 'cancelled') return;

			error = result.error;
			// Pages we already have are still worth reading. They are simply old.
			stale = loaded.length > 0;
			return;
		}

		if (result.modified) place(index, result.data);
		error = null;
		stale = false;
	}

	/**
	 * File a page at its position. A page whose cursor moved invalidates every
	 * page behind it — those were addressed from the cursor this one used to end
	 * at, and history has shifted under them.
	 */
	function place(index: number, page: PageOf<T>): void {
		const previous = loaded[index];
		const next = loaded.slice(0, index);
		next[index] = page;

		if (previous && previous.endCursor === page.endCursor) {
			next.push(...loaded.slice(index + 1));
		}
		loaded = next;
	}

	function settled(): void {
		loading = false;
		loadingMore = false;
	}

	function abort(): void {
		head?.abort();
		tail?.abort();
		head = null;
		tail = null;
	}

	function reset(): void {
		loaded = [];
		error = null;
		loading = false;
		loadingMore = false;
		stale = false;
	}

	return {
		get items() {
			return items;
		},
		get loading() {
			return loading;
		},
		get loadingMore() {
			return loadingMore;
		},
		get stale() {
			return stale;
		},
		get error() {
			return error;
		},
		get hasMore() {
			return loaded[loaded.length - 1]?.hasNextPage ?? false;
		},
		get total() {
			return loaded[0]?.totalCount ?? null;
		},
		get pages() {
			return loaded.length;
		},

		more() {
			if (loading || loadingMore) return;

			const last = loaded[loaded.length - 1];
			if (!last?.hasNextPage || !last.endCursor) return;

			const query = input(last.endCursor);
			if (!query) return;

			loadingMore = true;
			tail?.abort();
			tail = new AbortController();
			// The generation is not bumped: a further page belongs to the walk that
			// is already on screen, and the effect is what ends that walk.
			void load(query, generation, loaded.length, false, tail.signal);
		},

		refresh() {
			ticket = { force: true };
		}
	};
}

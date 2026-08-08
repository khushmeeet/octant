import type { GraphQLFieldError, SourceError } from '$lib/source/errors';
import type { CacheQuery, Fetched } from '$lib/source/query';
import { store as defaultStore } from '$lib/store';
import type { Store } from '$lib/store/types';
import { settle } from './settle';

/**
 * `resource()` — PLAN.md Phase 2, and the reason navigation never waits on the
 * network (ARCHITECTURE.md §2).
 *
 * The read path from ARCHITECTURE.md §5, as one primitive:
 *
 *   1. Read cache. If present, render immediately.
 *   2. If immutable, stop. Done.
 *   3. If mutable and past its window, revalidate behind the render.
 *   4. On an answer, patch the state; the UI updates reactively.
 *
 * Create it during component initialisation — it owns an `$effect`. `input` is
 * re-read whenever anything it touches changes, so a resource follows its
 * subject: give it a function of the route and it reloads when the route moves.
 *
 * `input` must not read the resource's own fields, or the effect will feed
 * itself.
 */

export interface Resource<T> {
	/** What to render. Survives a failed revalidation — see `error`. */
	readonly data: T | null;
	/** There is nothing to show yet and a request is out. Never true over data. */
	readonly loading: boolean;
	/**
	 * What is on screen is not known to be current: a revalidation is in flight,
	 * or the last one failed. Immutable data is never stale.
	 */
	readonly stale: boolean;
	/**
	 * Set alongside `data` when a revalidation failed over a cached render —
	 * the same "you have something, and it is not the whole story" shape as the
	 * executor's `partial`. `cancelled` never appears here; it is not a failure.
	 */
	readonly error: SourceError | null;
	/** Fields GitHub returned empty with an error beside them. */
	readonly partial: GraphQLFieldError[];
	/** Where the current render came from. The Phase 2 proof, and useful chrome. */
	readonly origin: 'cache' | 'network' | null;
	/** Go to the network regardless of what is cached. */
	refresh(): void;
}

export interface ResourceOptions {
	/** Swappable for a test double. Defaults to the app's one store. */
	store?: Store;
}

export function resource<T>(
	input: () => CacheQuery<T> | null,
	options: ResourceOptions = {}
): Resource<T> {
	const store = options.store ?? defaultStore;

	let data = $state<T | null>(null);
	let error = $state<SourceError | null>(null);
	let partial = $state<GraphQLFieldError[]>([]);
	let loading = $state(false);
	let stale = $state(false);
	let origin = $state<'cache' | 'network' | null>(null);

	/** Reassigned by `refresh()`; reading it is what makes the effect re-run. */
	let ticket = $state({ force: false });

	/** The address currently rendered or being loaded. Not reactive by design. */
	let address: string | null = null;
	/** Monotonic. Guards every state write against an out-of-order answer. */
	let generation = 0;
	let controller: AbortController | null = null;

	$effect(() => {
		const query = input();
		const { force } = ticket;

		if (!query) {
			controller?.abort();
			controller = null;
			generation += 1;
			address = null;
			reset();
			return;
		}

		// A descriptor is a fresh object on every read, so an unrelated state
		// change re-runs this effect with the identical address. Cancelling a
		// request in order to reissue the same one is pure waste, and on the
		// rate limit it is waste we pay for.
		if (!force && query.key.id === address) return;

		if (query.key.id !== address) {
			// A different subject. Showing the last one's data under the new one's
			// heading is worse than showing nothing for a frame.
			address = query.key.id;
			reset();
			loading = true;
		}

		controller?.abort();
		controller = new AbortController();
		void load(query, (generation += 1), force, controller.signal);
	});

	// No dependencies, so this runs its cleanup once, on destroy.
	$effect(() => () => {
		generation += 1;
		controller?.abort();
	});

	async function load(
		query: CacheQuery<T>,
		mine: number,
		force: boolean,
		signal: AbortSignal
	): Promise<void> {
		let etag: string | null = null;

		if (!force) {
			// A cache failure is not a data failure: fall through to the network.
			const hit = await store.get<T>(query.key, query.maxAge).catch(() => undefined);
			if (mine !== generation) return;

			if (hit) {
				etag = hit.etag;
				data = hit.value;
				error = null;
				partial = [];
				origin = 'cache';
				loading = false;
				stale = hit.stale;

				// Immutable, or inside its window. This is the branch that makes a
				// second visit cost nothing.
				if (!hit.stale) return;
			}
		}

		// Fetching and filing are one shared operation — see `settle()`. Two
		// components asking for the same address at the same moment, which is
		// every Tree screen's sidebar and listing, pay for it once.
		let result: Fetched<T>;
		try {
			result = await settle(query, store, etag, signal);
		} catch {
			// This caller walked away. Sharing is reference counted, so the request
			// lives on if anyone else is still waiting for it, and the state is
			// left exactly as it was.
			if (mine === generation) loading = false;
			return;
		}

		if (mine !== generation) return;
		loading = false;

		if (!result.ok) {
			// The caller walked away. Leave the state exactly as it was.
			if (result.error.kind === 'cancelled') return;

			error = result.error;
			// Data we already have is still worth reading. It is simply old now.
			stale = data !== null;
			return;
		}

		if (result.modified) {
			data = result.data;
			partial = result.partial;
			origin = 'network';
		}
		error = null;
		stale = false;
	}

	function reset(): void {
		data = null;
		error = null;
		partial = [];
		loading = false;
		stale = false;
		origin = null;
	}

	return {
		get data() {
			return data;
		},
		get loading() {
			return loading;
		},
		get stale() {
			return stale;
		},
		get error() {
			return error;
		},
		get partial() {
			return partial;
		},
		get origin() {
			return origin;
		},
		refresh() {
			ticket = { force: true };
		}
	};
}

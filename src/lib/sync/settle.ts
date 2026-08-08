import { share } from '$lib/source/inflight';
import type { CacheQuery, Fetched } from '$lib/source/query';
import type { Store } from '$lib/store/types';

/**
 * Fetch, then file — as one shared operation.
 *
 * The store write happens *inside* the shared work rather than after it, and
 * that placement is the whole point. Between a response arriving and it landing
 * in IndexedDB there is a window where a second reader's cache lookup misses
 * and it issues the request again. The executor's own in-flight sharing does
 * not cover that window, because by then the first request has already
 * settled.
 *
 * The window is not hypothetical: the sidebar's file tree and the main listing
 * ask for the same directory at the same moment on every Tree screen, and a
 * prefetch races the click that follows it. Sharing the write closes it, and
 * the rate limit is a real budget.
 *
 * Cancellation stays reference counted, so a screen navigated away from ends
 * its own wait without cancelling a request someone else is still waiting on.
 */
export function settle<T>(
	query: CacheQuery<T>,
	store: Store,
	etag: string | null = null,
	signal?: AbortSignal
): Promise<Fetched<T>> {
	return share(`settle:${query.key.id}`, signal, async (shared) => {
		const result = await query.run({ signal: shared, etag });

		// Worth keeping even if nobody is waiting for it any more: whoever asked
		// has already paid for it, and the next visit should not pay again. A
		// cache failure is not a data failure, so it is swallowed here.
		if (result.ok && result.modified) {
			await store.put(query.key, result.data, { etag: result.etag }).catch(() => {});
		} else if (result.ok) {
			await store.touch(query.key, result.etag).catch(() => {});
		}

		return result;
	});
}

import type { CacheQuery } from '$lib/source/query';
import { store as defaultStore } from '$lib/store';
import type { Store } from '$lib/store/types';
import { rate } from './rate.svelte';
import { settle } from './settle';

/**
 * Prefetch — ARCHITECTURE.md §5, and the item Phase 2 carried forward.
 *
 * "Prefetch on hover for rows and on mount for the adjacent screen." The same
 * read path as `resource()` minus the rendering: if the answer is already held
 * and fresh, stop; otherwise fetch it and file it, so the navigation that
 * follows is a local read.
 *
 * Three rules keep speculation from becoming a cost:
 *
 * 1. **Never on a tight budget.** A prefetch is a guess, so it is the first
 *    thing to stop when headroom is short (ARCHITECTURE.md §7). Navigation the
 *    user actually asked for keeps its quota.
 * 2. **Never twice.** A key already in the air is skipped without so much as a
 *    cache read — a hovered row fires this on every pointer entry.
 * 3. **Never observably.** Nothing is returned and nothing throws. A failed
 *    prefetch leaves the screen exactly as it was, and the real read that
 *    follows will report the failure properly.
 */

/** Keys currently being warmed. Not a cache — just a guard against a stampede. */
const inFlight = new Set<string>();

export interface PrefetchOptions {
	store?: Store;
	/** Warm even when headroom is low. Nothing in Phase 3 asks for this. */
	force?: boolean;
}

export function prefetch<T>(query: CacheQuery<T> | null, options: PrefetchOptions = {}): void {
	if (!query) return;
	if (!options.force && rate.low) return;
	if (inFlight.has(query.key.id)) return;

	inFlight.add(query.key.id);
	void warm(query, options.store ?? defaultStore).finally(() => inFlight.delete(query.key.id));
}

async function warm<T>(query: CacheQuery<T>, store: Store): Promise<void> {
	try {
		const hit = await store.get<T>(query.key, query.maxAge);
		// An immutable hit is never stale, so this is where most hovers stop.
		if (hit && !hit.stale) return;

		// The same shared fetch-and-file the real read uses, so a hover and the
		// click that follows it are one request even if the click lands while
		// the answer is still being written.
		await settle(query, store, hit?.etag ?? null);
	} catch {
		// A guess that did not pay off. The real read will say why.
	}
}

import type { CacheKey, CacheStore } from './keys';

/**
 * The `Store` seam — ARCHITECTURE.md §9.
 *
 * Where data is kept. `IdbStore` is the only implementation; a SQLite-backed
 * one would satisfy the same interface without a screen noticing. Everything
 * above this line is pure UI and knows nothing about IndexedDB.
 */

export interface CacheEntry<T> {
	value: T;
	/** Epoch ms of the network read that produced this. */
	fetchedAt: number;
	/** For `If-None-Match` on the next revalidation. REST-backed entries only. */
	etag: string | null;
	/**
	 * Whether this is worth asking about again. Always `false` for a
	 * SHA-addressed entry — the store structurally cannot call immutable data
	 * stale, which is the routing in ARCHITECTURE.md §5 made real rather than
	 * merely intended.
	 */
	stale: boolean;
}

/** What we remember about looking at something. Local only, never fetched. */
export interface Visit {
	lastSeenAt: number;
	/** What was current at the time, so the delta has a base. */
	lastSeenSha: string | null;
}

export interface PutOptions {
	etag?: string | null;
}

export interface Store {
	/**
	 * Read. `maxAge` is the freshness window for a mutable key and is ignored
	 * for an immutable one.
	 */
	get<T>(key: CacheKey, maxAge?: number): Promise<CacheEntry<T> | undefined>;

	put<T>(key: CacheKey, value: T, options?: PutOptions): Promise<void>;

	/** A 304. The value stands; only its clock restarts. */
	touch(key: CacheKey, etag?: string | null): Promise<void>;

	evict(key: CacheKey): Promise<void>;

	/** LRU over the immutable store. Returns how many entries went. */
	sweep(): Promise<number>;

	count(store: CacheStore): Promise<number>;

	/* ------------------------------------------------------- visits (§6) -- */

	/** Record that an object was looked at, and what was current when it was. */
	visit(objectId: string, sha?: string | null): Promise<void>;

	lastVisit(objectId: string): Promise<Visit | undefined>;
}

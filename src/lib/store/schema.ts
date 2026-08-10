/**
 * IndexedDB schema — ARCHITECTURE.md §5.
 *
 * Four object stores, all with out-of-line string keys so the key scheme
 * (`kind:repo:sha[:path]`) stays a concern of the layer above — see `keys.ts`.
 *
 * | store       | key                 | policy                                  |
 * | ----------- | ------------------- | --------------------------------------- |
 * | `immutable` | `kind:repo:sha[:p]` | write once, never invalidate, LRU evict |
 * | `mutable`   | `kind:repo:id`      | revalidate on a tick, carries `etag`    |
 * | `visits`    | `objectId`          | local only, never fetched               |
 * | `meta`      | fixed keys          | token metadata, rate limit, schema ver  |
 */

export const DB_NAME = 'octant';
export const DB_VERSION = 2;

export const STORE = {
	immutable: 'immutable',
	mutable: 'mutable',
	visits: 'visits',
	meta: 'meta'
} as const;

export type StoreName = (typeof STORE)[keyof typeof STORE];

/** Indexes, by the store they belong to. */
export const INDEX = {
	/** Immutable entries ordered by `lastUsedAt`, oldest first. LRU eviction. */
	lastUsed: 'by-last-used'
} as const;

/** Fixed keys in the `meta` store. */
export const META = {
	/** The PAT and the viewer identity it validated as. */
	auth: 'auth',
	/** Last known rate-limit state, so the meter is populated before the first query. */
	rateLimit: 'rateLimit',
	/** Repositories opened before, most recent first. The home screen's `Recent`. */
	recent: 'recent'
} as const;

/**
 * Migrations run in order for every version gap. Adding a store or an index is
 * additive; anything destructive must be written as an explicit step.
 *
 * `transaction` is the open `versionchange` transaction — an index can only be
 * created through it, so it is threaded in rather than reached for.
 */
export function migrate(
	db: IDBDatabase,
	fromVersion: number,
	transaction: IDBTransaction | null
): void {
	if (fromVersion < 1) {
		for (const name of Object.values(STORE)) {
			if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
		}
	}

	if (fromVersion < 2) {
		// Eviction walks the immutable store oldest-first. Without an index that
		// means loading every cached blob into memory just to sort it, which is
		// exactly the cost the cache exists to avoid.
		const immutable = transaction?.objectStore(STORE.immutable);
		if (immutable && !immutable.indexNames.contains(INDEX.lastUsed)) {
			immutable.createIndex(INDEX.lastUsed, 'lastUsedAt');
		}
	}
}

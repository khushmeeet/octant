import { idbCount, idbDelete, idbDeleteMany, idbGet, idbOldestKeys, idbPut } from './idb';
import type { CacheKey, CacheStore } from './keys';
import {
	EVICT_FRACTION,
	EVICT_ROUNDS,
	EVICT_TO,
	FRESHNESS,
	MAX_IMMUTABLE_ENTRIES,
	PUTS_PER_CHECK,
	QUOTA_PRESSURE,
	TOUCH_INTERVAL
} from './policy';
import { INDEX, STORE } from './schema';
import type { CacheEntry, PutOptions, Store, Visit } from './types';

/**
 * `IdbStore` — the `Store` seam over IndexedDB.
 *
 * Three things happen here and nowhere else:
 *
 * 1. **Routing.** A key says which store it belongs to; an immutable entry is
 *    never reported stale, so a SHA-addressed read can never trigger a network
 *    call no matter what window the caller passed.
 * 2. **Freshness.** A mutable entry carries `fetchedAt` and an ETag. Past its
 *    window it is still returned — staleness starts a revalidation, it does not
 *    withhold data.
 * 3. **Eviction.** LRU over the immutable store, under either of two pressures:
 *    the browser's quota, or our own entry ceiling.
 */

/** The envelope as it sits on disk. `lastUsedAt` is the LRU index's key path. */
interface StoredEntry<T> {
	value: T;
	fetchedAt: number;
	etag: string | null;
	lastUsedAt: number;
}

export class IdbStore implements Store {
	/** Writes since the last pressure check. Growth is caused by writes. */
	#writes = 0;
	/** One sweep at a time; concurrent callers share it. */
	#sweeping: Promise<number> | null = null;

	async get<T>(key: CacheKey, maxAge?: number): Promise<CacheEntry<T> | undefined> {
		const record = await idbGet<StoredEntry<T>>(key.store, key.id);
		if (!record) return undefined;

		if (key.store === 'immutable') {
			this.#markUsed(key, record);
			return { value: record.value, fetchedAt: record.fetchedAt, etag: record.etag, stale: false };
		}

		const window = maxAge ?? FRESHNESS.default;
		return {
			value: record.value,
			fetchedAt: record.fetchedAt,
			etag: record.etag,
			stale: Date.now() - record.fetchedAt > window
		};
	}

	async put<T>(key: CacheKey, value: T, options: PutOptions = {}): Promise<void> {
		const now = Date.now();
		const record: StoredEntry<T> = {
			value,
			fetchedAt: now,
			etag: options.etag ?? null,
			lastUsedAt: now
		};

		try {
			await idbPut(key.store, key.id, record);
		} catch (cause) {
			if (!isQuotaError(cause)) throw cause;
			// The disk answered before our own accounting noticed. Make room and
			// take the write once more; a second failure is real and propagates.
			await this.sweep();
			await idbPut(key.store, key.id, record);
		}

		await this.#afterWrite();
	}

	async touch(key: CacheKey, etag?: string | null): Promise<void> {
		const record = await idbGet<StoredEntry<unknown>>(key.store, key.id);
		if (!record) return;

		const now = Date.now();
		await idbPut(key.store, key.id, {
			...record,
			fetchedAt: now,
			lastUsedAt: now,
			etag: etag ?? record.etag
		});
	}

	evict(key: CacheKey): Promise<void> {
		return idbDelete(key.store, key.id);
	}

	count(store: CacheStore): Promise<number> {
		return idbCount(store);
	}

	sweep(): Promise<number> {
		this.#sweeping ??= this.#runSweep().finally(() => {
			this.#sweeping = null;
		});
		return this.#sweeping;
	}

	/* ------------------------------------------------------------ visits -- */

	async visit(objectId: string, sha: string | null = null): Promise<void> {
		const record: Visit = { lastSeenAt: Date.now(), lastSeenSha: sha };
		await idbPut(STORE.visits, objectId, record);
	}

	lastVisit(objectId: string): Promise<Visit | undefined> {
		return idbGet<Visit>(STORE.visits, objectId);
	}

	/* ----------------------------------------------------------- private -- */

	/**
	 * LRU without a write on every read. Recency is only ever compared between
	 * entries, so resolving it to the hour is plenty — and it keeps a cache hit
	 * a read, which is the point of having one.
	 */
	#markUsed<T>(key: CacheKey, record: StoredEntry<T>): void {
		if (Date.now() - record.lastUsedAt < TOUCH_INTERVAL) return;

		void idbPut(key.store, key.id, { ...record, lastUsedAt: Date.now() }).catch(() => {
			// Losing a touch costs an entry some of its standing in the queue.
			// Not worth failing a read that already succeeded.
		});
	}

	async #afterWrite(): Promise<void> {
		// Fires on the first write of the session, then every PUTS_PER_CHECK.
		const due = this.#writes % PUTS_PER_CHECK === 0;
		this.#writes += 1;
		if (!due) return;

		try {
			await this.sweep();
		} catch {
			// A cache that cannot tidy itself is still a working cache.
		}
	}

	async #runSweep(): Promise<number> {
		let removed = 0;

		// Our own ceiling first: it is exact, and it is the one that fires on a
		// machine whose quota is generous enough never to complain.
		const total = await idbCount(STORE.immutable);
		if (total > MAX_IMMUTABLE_ENTRIES) {
			removed += await evictOldest(total - Math.floor(MAX_IMMUTABLE_ENTRIES * EVICT_TO));
		}

		// Then the disk. There is no per-entry size on record — measuring one
		// would mean serialising every blob twice — so the loop drops a slice,
		// asks the browser again, and repeats a bounded number of times.
		for (let round = 0; round < EVICT_ROUNDS; round += 1) {
			if (!(await underPressure())) break;

			const remaining = await idbCount(STORE.immutable);
			if (remaining === 0) break;

			removed += await evictOldest(Math.max(1, Math.ceil(remaining * EVICT_FRACTION)));
		}

		return removed;
	}
}

async function evictOldest(howMany: number): Promise<number> {
	const victims = await idbOldestKeys(STORE.immutable, INDEX.lastUsed, howMany);
	await idbDeleteMany(STORE.immutable, victims);
	return victims.length;
}

async function underPressure(): Promise<boolean> {
	if (typeof navigator === 'undefined' || typeof navigator.storage?.estimate !== 'function') {
		return false;
	}

	const estimate = await navigator.storage.estimate().catch((): StorageEstimate => ({}));

	const usage = estimate.usage ?? 0;
	const quota = estimate.quota ?? 0;
	return quota > 0 && usage / quota > QUOTA_PRESSURE;
}

/** Every engine spells it differently; the name is the one portable part. */
function isQuotaError(cause: unknown): boolean {
	return cause instanceof DOMException && cause.name === 'QuotaExceededError';
}

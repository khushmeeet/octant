import { DB_NAME, DB_VERSION, migrate, type StoreName } from './schema';

/**
 * Thin promise wrapper over IndexedDB.
 *
 * Deliberately not the `Store` seam from ARCHITECTURE.md §9 — that is
 * `IdbStore`, which owns the immutable/mutable routing, freshness and LRU
 * eviction, and is built on top of these primitives. Nothing here knows what a
 * cache key means.
 */

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDb(): Promise<IDBDatabase> {
	if (dbPromise) return dbPromise;

	dbPromise = new Promise((resolve, reject) => {
		if (typeof indexedDB === 'undefined') {
			reject(new Error('IndexedDB is unavailable in this browser context'));
			return;
		}

		const request = indexedDB.open(DB_NAME, DB_VERSION);

		request.onupgradeneeded = (event) => {
			migrate(request.result, event.oldVersion, request.transaction);
		};
		request.onsuccess = () => {
			// Another tab opened a newer version; drop our handle rather than
			// blocking its upgrade forever.
			request.result.onversionchange = () => {
				request.result.close();
				dbPromise = null;
			};
			resolve(request.result);
		};
		request.onerror = () => reject(request.error ?? new Error('Failed to open IndexedDB'));
		request.onblocked = () => reject(new Error('IndexedDB upgrade blocked by another open tab'));
	});

	// A failed open must not be cached, or every later call inherits the failure.
	dbPromise.catch(() => {
		dbPromise = null;
	});

	return dbPromise;
}

function run<T>(
	store: StoreName,
	mode: IDBTransactionMode,
	body: (os: IDBObjectStore) => IDBRequest
): Promise<T> {
	return openDb().then(
		(db) =>
			new Promise<T>((resolve, reject) => {
				const tx = db.transaction(store, mode);
				const request = body(tx.objectStore(store));
				request.onsuccess = () => resolve(request.result as T);
				request.onerror = () => reject(request.error ?? new Error(`IndexedDB ${mode} failed`));
				tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
			})
	);
}

export function idbGet<T>(store: StoreName, key: string): Promise<T | undefined> {
	return run<T | undefined>(store, 'readonly', (os) => os.get(key));
}

export function idbPut<T>(store: StoreName, key: string, value: T): Promise<void> {
	return run<IDBValidKey>(store, 'readwrite', (os) => os.put(value, key)).then(() => undefined);
}

export function idbDelete(store: StoreName, key: string): Promise<void> {
	return run<undefined>(store, 'readwrite', (os) => os.delete(key)).then(() => undefined);
}

export function idbKeys(store: StoreName): Promise<string[]> {
	return run<IDBValidKey[]>(store, 'readonly', (os) => os.getAllKeys()).then(
		(keys) => keys as string[]
	);
}

export function idbCount(store: StoreName): Promise<number> {
	return run<number>(store, 'readonly', (os) => os.count());
}

/**
 * The first `limit` primary keys in index order.
 *
 * A key cursor rather than a value cursor: eviction needs to know *which*
 * entries to drop, never what is in them, and deserialising a few hundred
 * cached blobs to decide would cost more than the space it reclaims. Records
 * missing the index's key path are absent from the index, and so are never
 * chosen — every entry we write carries one.
 */
export function idbOldestKeys(store: StoreName, index: string, limit: number): Promise<string[]> {
	if (limit <= 0) return Promise.resolve([]);

	return openDb().then(
		(db) =>
			new Promise<string[]>((resolve, reject) => {
				const tx = db.transaction(store, 'readonly');
				const request = tx.objectStore(store).index(index).openKeyCursor();
				const keys: string[] = [];

				request.onsuccess = () => {
					const cursor = request.result;
					if (!cursor || keys.length >= limit) {
						resolve(keys);
						return;
					}
					keys.push(cursor.primaryKey as string);
					cursor.continue();
				};
				request.onerror = () => reject(request.error ?? new Error('IndexedDB cursor failed'));
				tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
			})
	);
}

/** One transaction for the whole batch, so a sweep is atomic and cheap. */
export function idbDeleteMany(store: StoreName, keys: string[]): Promise<void> {
	if (keys.length === 0) return Promise.resolve();

	return openDb().then(
		(db) =>
			new Promise<void>((resolve, reject) => {
				const tx = db.transaction(store, 'readwrite');
				const os = tx.objectStore(store);
				for (const key of keys) os.delete(key);

				tx.oncomplete = () => resolve();
				tx.onerror = () => reject(tx.error ?? new Error('IndexedDB delete failed'));
				tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
			})
	);
}

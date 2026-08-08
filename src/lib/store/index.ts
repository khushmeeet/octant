/**
 * The cache — ARCHITECTURE.md §5 and §9.
 *
 * Screens address data through `keys.ts` and read it through `resource()`.
 * They never see IndexedDB, a transaction, or a freshness window.
 */

export { IdbStore } from './idb-store';
export { immutableKey, isOid, mutableKey, revKey, type CacheKey, type CacheStore } from './keys';
export { FRESHNESS } from './policy';
export type { CacheEntry, PutOptions, Store, Visit } from './types';

import { IdbStore } from './idb-store';
import type { Store } from './types';

/**
 * The one the app uses. A single instance because the write-side accounting —
 * writes since the last pressure check, the in-flight sweep — is only correct
 * if there is one of it.
 */
export const store: Store = new IdbStore();

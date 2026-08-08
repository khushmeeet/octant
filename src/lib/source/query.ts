import type { CacheKey } from '$lib/store/keys';
import type { GraphQLFieldError, SourceError } from './errors';
import type { QueryResult } from './graphql';
import type { RestResult } from './rest';

/**
 * The join between the two seams — PLAN.md Phase 2.
 *
 * A `Source` method does not fetch. It returns a *description* of a fetch:
 * where the answer is kept, how long it stands, and how to go and get it. That
 * keeps the two responsibilities from bleeding into each other — `Source` knows
 * where data comes from, `Store` knows where it is kept, and `resource()` is
 * the only thing that knows the order to do them in.
 *
 * The alternative — a source that fetches and caches for itself — cannot render
 * from cache and revalidate behind without handing back two values, and a
 * cache key computed somewhere other than the query it belongs to is a key that
 * eventually stops matching it.
 */

export interface FetchOptions {
	signal?: AbortSignal;
	/** The stored ETag, for `If-None-Match`. REST-backed queries only. */
	etag?: string | null;
}

/**
 * Deliberately the same vocabulary as `RestResult`: a read either brought a new
 * value or confirmed the one we hold. GraphQL has no 304, so its queries are
 * always `modified`.
 */
export type Fetched<T> =
	| { ok: true; modified: true; data: T; etag: string | null; partial: GraphQLFieldError[] }
	| { ok: true; modified: false; etag: string | null }
	| { ok: false; error: SourceError };

export interface CacheQuery<T> {
	/** Decides the store, the freshness policy, and everything downstream. */
	readonly key: CacheKey;
	/** Freshness window in ms. Ignored for an immutable key, which never expires. */
	readonly maxAge?: number;
	run(options: FetchOptions): Promise<Fetched<T>>;
}

/** GraphQL: always a full answer, never an ETag. */
export function fromQuery<T>(result: QueryResult<T>): Fetched<T> {
	if (!result.ok) return result;
	return { ok: true, modified: true, data: result.data, etag: null, partial: result.partial };
}

/**
 * REST: a 304 carries no body, which is the whole point — it does not count
 * against the quota. `map` runs only when there is something to map.
 */
export function fromRest<T, U>(result: RestResult<T>, map: (data: T) => U): Fetched<U> {
	if (!result.ok) return result;
	if (!result.modified) return { ok: true, modified: false, etag: result.etag };
	return { ok: true, modified: true, data: map(result.data), etag: result.etag, partial: [] };
}

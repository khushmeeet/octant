import type { RepoRef } from '$lib/source/types';

/**
 * The cache key scheme — ARCHITECTURE.md §5.
 *
 * The central insight is that anything addressed by a SHA is immutable: a tree
 * at a commit, a blob at a SHA, blame at a revision. Those are written once and
 * never revalidated. Everything else is a thin mutable layer with a freshness
 * window.
 *
 * That split is the whole performance story, so it is decided *here*, by the
 * shape of the address, and carried in the key itself. A caller cannot file a
 * branch-addressed tree in the immutable store by mistake — `immutableKey`
 * refuses anything that is not an object ID, and `revKey` routes on what it
 * was actually given. The same move as `document()` composing `rateLimit` in:
 * unbreakable beats documented.
 *
 *   immutable   kind:owner/name:sha[:path]
 *   mutable     kind:owner/name[:id]
 */

export type CacheStore = 'immutable' | 'mutable';

export interface CacheKey {
	readonly store: CacheStore;
	readonly id: string;
}

/** Git object IDs: SHA-1 today, SHA-256 when GitHub finishes moving. */
const OID = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;

export function isOid(rev: string): boolean {
	return OID.test(rev);
}

/**
 * Write once, never invalidate. Throws on a non-SHA address rather than
 * quietly caching a moving target forever — that is a bug in the caller, of
 * the same family as the `invalid` error kind, and it should fire on the first
 * run rather than rot in a user's browser.
 */
export function immutableKey(kind: string, repo: RepoRef, sha: string, path = ''): CacheKey {
	if (!isOid(sha)) {
		throw new Error(`${kind}:${slug(repo)} needs an object ID to be immutable, got "${sha}"`);
	}
	return { store: 'immutable', id: join(kind, slug(repo), sha, path) };
}

/** Revalidated on a tick, carries an ETag. */
export function mutableKey(kind: string, repo: RepoRef, id = ''): CacheKey {
	return { store: 'mutable', id: join(kind, slug(repo), id) };
}

/**
 * The one screens reach for. A revision is a SHA or it is a name, and which
 * store the result belongs in follows from that with nothing left to decide.
 */
export function revKey(kind: string, repo: RepoRef, rev: string, path = ''): CacheKey {
	return isOid(rev) ? immutableKey(kind, repo, rev, path) : mutableKey(kind, repo, join(rev, path));
}

function slug(repo: RepoRef): string {
	return `${repo.owner}/${repo.name}`;
}

/**
 * Empty trailing segments are dropped so a root path and no path are one key.
 * A path may itself contain a colon on some filesystems; it is always the last
 * segment, so the key stays unambiguous.
 */
function join(...parts: string[]): string {
	const kept = [...parts];
	while (kept.length > 0 && kept[kept.length - 1] === '') kept.pop();
	return kept.join(':');
}

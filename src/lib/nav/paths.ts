import { resolve } from '$app/paths';
import type { RepoRef } from '$lib/source/types';

/**
 * The URL scheme — PLAN.md Phase 3, which replaces Phase 0's local `active`
 * state with routing.
 *
 *   /                                  choose a repository
 *   /{owner}/{name}                    tree at the default branch, root
 *   /{owner}/{name}/tree/{rev}         tree at a revision, root
 *   /{owner}/{name}/tree/{rev}/{path}  tree at a revision, in a directory
 *
 * **The revision is exactly one path segment, percent-encoded.** Git allows a
 * slash in a ref name and so does GitHub, which is why github.com's own
 * `/tree/release/1.0/src` is ambiguous — it has to consult the ref list to know
 * where the name ends and the path begins. We would have to spend a round trip
 * on the same question. Encoding the ref answers it in the URL: `release%2F1.0`
 * is one segment, always, and the split never needs resolving.
 *
 * The cost is that a URL pasted from github.com whose branch name contains a
 * slash reads the wrong way. That is a rarer event than navigating, and it
 * fails visibly rather than silently.
 *
 * Every internal URL in the app is built here, and built with SvelteKit's
 * `resolve()` against a route ID rather than by string concatenation. So a
 * route directory that is renamed or removed fails the type check instead of
 * producing a link that 404s at runtime — and if this ever gets served under a
 * base path, that lands in one file. `resolve()` substitutes parameters
 * verbatim, so encoding stays our job and happens on the way in.
 */

export interface TreeAddress {
	repo: RepoRef;
	/** `null` means "whatever this repository's default branch is". */
	rev: string | null;
	/** Repo-relative directory, `''` at the root. */
	path: string;
}

export function repoHref(repo: RepoRef): string {
	return resolve('/[owner]/[name]', {
		owner: segment(repo.owner),
		name: segment(repo.name)
	});
}

/**
 * A revision of `null` addresses the default branch by omission rather than by
 * name — so a link to a repository's front page stays correct after its default
 * branch is renamed, and does not need the repository summary to be built.
 */
export function treeHref(repo: RepoRef, rev: string | null, path = ''): string {
	if (rev === null && !path) return repoHref(repo);

	return resolve('/[owner]/[name]/tree/[rev]/[...path]', {
		owner: segment(repo.owner),
		name: segment(repo.name),
		// A URL cannot carry an empty segment before a path, so an unnamed
		// revision is spelled the way git already spells it.
		rev: rev === null ? 'HEAD' : segment(rev),
		path: encodePath(path)
	});
}

/** The directory containing `path`, or `null` at the repository root. */
export function parentPath(path: string): string | null {
	if (!path) return null;
	const cut = path.lastIndexOf('/');
	return cut === -1 ? '' : path.slice(0, cut);
}

/**
 * Read an address out of SvelteKit's params. Both tree routes land here, so
 * the two shapes are reconciled in one place. SvelteKit has already decoded
 * each segment, which is what makes the encoded revision come back whole.
 */
export function parseTree(params: Record<string, string | undefined>): TreeAddress {
	const rev = params.rev ?? null;
	return {
		repo: { owner: params.owner ?? '', name: params.name ?? '' },
		rev: rev === null || rev === 'HEAD' ? null : rev,
		path: cleanPath(params.path ?? '')
	};
}

export function cleanPath(path: string): string {
	return path.replace(/^\/+|\/+$/g, '');
}

/* ------------------------------------------------------------- link out -- */

/**
 * github.com is a companion, not a competitor — ARCHITECTURE.md §1 — so what is
 * out of scope, or not built yet, links out rather than pretending.
 */

export function blobUrl(repo: RepoRef, rev: string, path: string): string {
	return `https://github.com/${segment(repo.owner)}/${segment(repo.name)}/blob/${segment(rev)}/${encodePath(path)}`;
}

/** A download, so it is instant by definition and belongs in the verb row. */
export function archiveUrl(repo: RepoRef, rev: string): string {
	return `https://github.com/${segment(repo.owner)}/${segment(repo.name)}/archive/${segment(rev)}.zip`;
}

/* ------------------------------------------------------------- private -- */

function segment(value: string): string {
	return encodeURIComponent(value);
}

/** Each segment encoded, the separators left alone. */
function encodePath(path: string): string {
	return cleanPath(path).split('/').map(segment).join('/');
}

import { resolve } from '$app/paths';
import type { RepoRef } from '$lib/source/types';
import { lineHash, type LineRange } from './lines';

/**
 * The URL scheme — PLAN.md Phase 3, which replaces Phase 0's local `active`
 * state with routing.
 *
 *   /                                   choose a repository
 *   /{owner}/{name}                     tree at the default branch, root
 *   /{owner}/{name}/tree/{rev}          tree at a revision, root
 *   /{owner}/{name}/tree/{rev}/{path}   tree at a revision, in a directory
 *   /{owner}/{name}/blob/{rev}/{path}   a file
 *   /{owner}/{name}/blame/{rev}/{path}  a file, with the blame gutter
 *
 * **The blame gutter is part of the address, not a toggle beside it.** View and
 * Blame are two ways of reading the same object, and both are things you send
 * to someone — so each has a URL, the back button steps between them, and a
 * `#L204` survives the trip. It is also how git names them.
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

export interface FileAddress {
	repo: RepoRef;
	/** `null` means "whatever this repository's default branch is". */
	rev: string | null;
	/** Repo-relative path to the file. */
	path: string;
	/** Which of the two file routes this is. */
	blame: boolean;
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

/**
 * A file, with the blame gutter or without it, optionally addressed at a line
 * or a range. The revision is one encoded segment here for the same reason it
 * is on a tree — the split between ref and path is decided by the URL rather
 * than by a round trip.
 */
export function fileHref(
	repo: RepoRef,
	rev: string | null,
	path: string,
	options: { blame?: boolean; lines?: LineRange | null } = {}
): string {
	const params = {
		owner: segment(repo.owner),
		name: segment(repo.name),
		rev: rev === null ? 'HEAD' : segment(rev),
		path: encodePath(path)
	};

	const base = options.blame
		? resolve('/[owner]/[name]/blame/[rev]/[...path]', params)
		: resolve('/[owner]/[name]/blob/[rev]/[...path]', params);

	return base + lineHash(options.lines ?? null);
}

/** Read a file address out of SvelteKit's params. Both file routes land here. */
export function parseFile(params: Record<string, string | undefined>, blame: boolean): FileAddress {
	const rev = params.rev ?? null;
	return {
		repo: { owner: params.owner ?? '', name: params.name ?? '' },
		rev: rev === null || rev === 'HEAD' ? null : rev,
		path: cleanPath(params.path ?? ''),
		blame
	};
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

/** Where the file screen sends you when it cannot render what it holds. */
export function githubBlobUrl(repo: RepoRef, rev: string, path: string): string {
	return `${slug(repo)}/blob/${segment(rev)}/${encodePath(path)}`;
}

/**
 * The bytes themselves. ARCHITECTURE.md §4 names this as the fallback for a
 * blob the API will not send inline, and §11 as the first step before "too
 * large" — so it is both the Raw verb and the way out of a binary file.
 */
export function rawUrl(repo: RepoRef, rev: string, path: string): string {
	return `https://raw.githubusercontent.com/${segment(repo.owner)}/${segment(repo.name)}/${segment(rev)}/${encodePath(path)}`;
}

/** A path's history. The Log screen is Phase 5; until then this is the verb. */
export function githubHistoryUrl(repo: RepoRef, rev: string, path: string): string {
	return `${slug(repo)}/commits/${segment(rev)}/${encodePath(path)}`;
}

/** One commit. The blame gutter links here until Phase 5 shows a diff. */
export function githubCommitUrl(repo: RepoRef, oid: string): string {
	return `${slug(repo)}/commit/${segment(oid)}`;
}

/** A download, so it is instant by definition and belongs in the verb row. */
export function archiveUrl(repo: RepoRef, rev: string): string {
	return `${slug(repo)}/archive/${segment(rev)}.zip`;
}

/* ------------------------------------------------------------- private -- */

function slug(repo: RepoRef): string {
	return `https://github.com/${segment(repo.owner)}/${segment(repo.name)}`;
}

function segment(value: string): string {
	return encodeURIComponent(value);
}

/** Each segment encoded, the separators left alone. */
function encodePath(path: string): string {
	return cleanPath(path).split('/').map(segment).join('/');
}

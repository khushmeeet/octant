import { fromRest, type Fetched, type FetchOptions } from './query';
import { gitTree, type GitTree } from './rest';
import type { RepoRef } from './types';

/**
 * The path index — PLAN.md Phase 9's `files` result group.
 *
 * Every path in a repository at a revision, as two flat lists. It is what makes
 * the palette able to open a file you have never browsed to, which is the
 * phase's own definition of done: *you stop using the sidebar tree to open
 * files.*
 *
 * **One request, not a walk.** ARCHITECTURE.md §7's hard rule is that no
 * operation may fan out across a repository, and the reason the palette could
 * not have this earlier is that GraphQL has no recursive tree — asking it for
 * every path is a query per directory. REST's recursive tree read is a single
 * bounded request instead, which is a different shape entirely: its cost is one
 * request whatever the repository's size, and GitHub caps it itself.
 *
 * **It is paid for by the first keystroke, and usually only once.** Nothing
 * fetches this on navigation; the palette asks for it when you type into it,
 * and at a commit SHA the answer is filed permanently — so a repository whose
 * HEAD has not moved is indexed once and read from disk forever after. That is
 * why the palette resolves a revision to its commit before asking: a branch name
 * would put the largest single payload in the app on a freshness window.
 *
 * Truncation is carried rather than hidden (§11): a repository past GitHub's cap
 * gets a partial index, and the footer says so instead of quietly missing files.
 */

export interface PathIndex {
	/** Blob paths, repo-relative, in git's own order. */
	files: string[];
	/** Directory paths, so the palette can send you to a tree as well as a file. */
	dirs: string[];
	/** GitHub sent part of the tree. The index is incomplete and says so. */
	truncated: boolean;
}

export async function getPaths(
	ref: RepoRef,
	rev: string,
	options: FetchOptions = {}
): Promise<Fetched<PathIndex>> {
	const result = await gitTree(ref, rev, { signal: options.signal, etag: options.etag });
	return fromRest(result, index);
}

function index(node: GitTree): PathIndex {
	const files: string[] = [];
	const dirs: string[] = [];

	for (const entry of node.tree ?? []) {
		// Submodules are `commit` entries: a path in this repository that is not a
		// file of it. Opening one would address a tree we cannot read.
		if (entry.type === 'blob') files.push(entry.path);
		else if (entry.type === 'tree') dirs.push(entry.path);
	}

	return { files, dirs, truncated: node.truncated ?? false };
}

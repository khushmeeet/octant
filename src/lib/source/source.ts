import { FRESHNESS, immutableKey, mutableKey, revKey } from '$lib/store';
import { getBlob, type BlobContent } from './blob';
import { getRepo, type RepoSummary } from './repo';
import { fromQuery, type CacheQuery } from './query';
import { getTree, type TreeListing } from './tree';
import type { RepoRef } from './types';

/**
 * The `Source` seam — ARCHITECTURE.md §9.
 *
 * Where data comes from. `GitHubSource` is the only implementation; a
 * `LocalSource` backed by a git sidecar would satisfy the same interface.
 * Everything above this line is pure UI and knows nothing about GitHub.
 *
 * The architecture names nine methods. Three are implemented, and the interface
 * declares three — a method that exists and throws is a worse lie than one that
 * is honestly absent, and the compiler is more use when the interface tells the
 * truth. `getLog`, `getBlame`, `getRefs`, `getPulls`, `getDiff` and `compare`
 * arrive with the screens that need them, in Phases 4 through 7.
 */

export interface Source {
	/** Identity, HEAD, clone URLs and the four sidebar counts. One round trip. */
	getRepo(ref: RepoRef): CacheQuery<RepoSummary>;

	/**
	 * A directory listing at a revision. Pass a commit SHA and the answer is
	 * cached permanently; pass a branch name and it is revalidated. The key
	 * scheme decides which, from the revision it was handed.
	 */
	getTree(ref: RepoRef, rev: string, path?: string): CacheQuery<TreeListing>;

	/**
	 * A file's contents, by the blob's own object ID — which a tree listing
	 * always carries, so a screen never has to name a path to read one. Always
	 * permanent: a blob at a SHA is the definition of immutable.
	 */
	getBlob(ref: RepoRef, oid: string): CacheQuery<BlobContent>;
}

export const GitHubSource: Source = {
	getRepo(ref) {
		return {
			// HEAD moves, so the summary is mutable however permanent its identity
			// fields are. Splitting it would cost a second round trip to save a
			// few hundred bytes.
			key: mutableKey('repo', ref),
			maxAge: FRESHNESS.repo,
			run: (options) => getRepo(ref, options).then(fromQuery)
		};
	},

	getTree(ref, rev, path = '') {
		return {
			key: revKey('tree', ref, rev, path),
			maxAge: FRESHNESS.tree,
			run: (options) => getTree(ref, rev, path, options).then(fromQuery)
		};
	},

	getBlob(ref, oid) {
		return {
			// No `maxAge`: an immutable entry is never reported stale whatever
			// window it is handed, so naming one here would only be decoration.
			key: immutableKey('blob', ref, oid),
			run: (options) => getBlob(ref, oid, options).then(fromQuery)
		};
	}
};

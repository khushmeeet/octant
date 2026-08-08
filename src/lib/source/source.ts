import { FRESHNESS, immutableKey, isOid, mutableKey, revKey } from '$lib/store';
import { getBlame, type FileBlame } from './blame';
import { getBlob, getFile, type BlobContent, type FileContent } from './blob';
import { getCommit, type CommitDetail } from './commit';
import { getCompare, type CompareResult } from './compare';
import { getLog, type LogPage } from './log';
import { getRefs, type RefKind, type RefsPage } from './refs';
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
 * The architecture names nine methods. Nine are implemented, and the interface
 * declares nine — a method that exists and throws is a worse lie than one that
 * is honestly absent, and the compiler is more use when the interface tells the
 * truth. Phase 6 adds `getRefs` and `getCompare`; `getPulls` and the pull
 * request's own diff arrive with the Review screen in Phase 7.
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

	/**
	 * A file's contents at a revision and a path, which is what a URL carries.
	 * One round trip from a deep link, where resolving the path to an object ID
	 * first would be two.
	 */
	getFile(ref: RepoRef, rev: string, path: string): CacheQuery<FileContent>;

	/** Who wrote each line, as runs. The most expensive read in the app. */
	getBlame(ref: RepoRef, rev: string, path: string): CacheQuery<FileBlame>;

	/**
	 * One page of history, optionally scoped to a path. The cursor is part of
	 * the address: a page is filed under where it starts, so walking back down a
	 * log already read is a local read. `pages()` is what walks these.
	 */
	getLog(ref: RepoRef, rev: string, path?: string, after?: string | null): CacheQuery<LogPage>;

	/**
	 * One commit and everything it touched, patches included. The only read in
	 * the app that goes over REST, because GraphQL has no patch field.
	 */
	getCommit(ref: RepoRef, rev: string): CacheQuery<CommitDetail>;

	/**
	 * One page of branches, or one page of tags — the same read, since they are
	 * the same object. `base` names the ref ahead/behind is measured against;
	 * `null` asks for no comparison at all, which is what a tag list wants.
	 */
	getRefs(
		ref: RepoRef,
		kind: RefKind,
		base?: string | null,
		after?: string | null
	): CacheQuery<RefsPage>;

	/**
	 * `base...head`: the commits between two points and the diff they add up
	 * to. What shipped in a release, and what a branch has that the default
	 * branch does not.
	 */
	getCompare(ref: RepoRef, base: string, head: string): CacheQuery<CompareResult>;
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
	},

	getFile(ref, rev, path) {
		return {
			// `file:` rather than `blob:`, because this is the same content under a
			// different address and the two must not collide in the store — one is
			// keyed by what the bytes are, the other by where they were found.
			key: revKey('file', ref, rev, path),
			maxAge: FRESHNESS.file,
			run: (options) => getFile(ref, rev, path, options).then(fromQuery)
		};
	},

	getBlame(ref, rev, path) {
		return {
			key: revKey('blame', ref, rev, path),
			maxAge: FRESHNESS.blame,
			run: (options) => getBlame(ref, rev, path, options).then(fromQuery)
		};
	},

	getLog(ref, rev, path = '', after = null) {
		// The cursor goes in the key before the path, because a path may itself
		// contain a colon and must therefore stay the last segment. `head` names
		// the first page rather than leaving an empty segment, so a key stays
		// readable in devtools — which is where the cache is inspected.
		const page = after ? `after=${after}` : 'head';

		return {
			key: revKey('log', ref, rev, path ? `${page}:${path}` : page),
			maxAge: FRESHNESS.log,
			run: (options) => getLog(ref, rev, path, after, options).then(fromQuery)
		};
	},

	getCommit(ref, rev) {
		return {
			// A commit named by SHA is the definition of immutable; one named by a
			// branch moves with it. `revKey` decides, as everywhere else.
			key: revKey('commit', ref, rev),
			maxAge: FRESHNESS.commit,
			run: (options) => getCommit(ref, rev, options)
		};
	},

	getRefs(ref, kind, base = null, after = null) {
		// Refs are the mutable layer by definition — a ref that stopped moving
		// would be a SHA. The base is part of the address because the ahead and
		// behind columns are answers about it, and the cursor is part of it for
		// the same reason it is on a log page: a page is filed under where it
		// starts (`pages()`).
		const page = after ? `after=${after}` : 'head';

		return {
			key: mutableKey('refs', ref, `${kind}:${base ?? 'none'}:${page}`),
			maxAge: FRESHNESS.refs,
			run: (options) => getRefs(ref, kind, base, after, options).then(fromQuery)
		};
	},

	getCompare(ref, base, head) {
		// **Both** endpoints have to be SHAs for this to be permanent, which is
		// why `revKey` is not enough here: it decides from one revision, and a
		// comparison has two. A range with a branch on either side is a question
		// about now and revalidates like one.
		const permanent = isOid(base) && isOid(head);

		return {
			key: permanent
				? immutableKey('compare', ref, base, head)
				: mutableKey('compare', ref, `${base}...${head}`),
			maxAge: FRESHNESS.compare,
			run: (options) => getCompare(ref, base, head, options)
		};
	}
};

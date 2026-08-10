import { accountKey, FRESHNESS, immutableKey, isOid, mutableKey, revKey } from '$lib/store';
import { getBlame, type FileBlame } from './blame';
import { getBlob, getFile, type BlobContent, type FileContent } from './blob';
import { getCommit, type CommitDetail } from './commit';
import { getCompare, type CompareResult } from './compare';
import { getLog, type LogPage } from './log';
import { getOwners, type OwnersFile } from './owners';
import { getPaths, type PathIndex } from './paths';
import { getPull, type PullDetail } from './pull';
import { getPullFiles, type PullFilesPage } from './pull-files';
import { getPulls, type PullFilter, type PullsPage } from './pulls';
import { getRefs, type RefKind, type RefsPage } from './refs';
import { getRepo, type RepoSummary } from './repo';
import { fromQuery, type CacheQuery } from './query';
import { mergePull, type MergeRequest, type MergeResponse, type WriteResult } from './rest';
import { getTree, type TreeListing } from './tree';
import type { RepoRef } from './types';
import { getViewerPulls, getViewerRepos, type InboxPulls, type ViewerReposPage } from './viewer';

/**
 * The `Source` seam — ARCHITECTURE.md §9.
 *
 * Where data comes from. `GitHubSource` is the only implementation; a
 * `LocalSource` backed by a git sidecar would satisfy the same interface.
 * Everything above this line is pure UI and knows nothing about GitHub.
 *
 * The architecture names nine methods; every one is implemented, and the
 * interface declares exactly what exists — a method that exists and throws is a
 * worse lie than one that is honestly absent, and the compiler is more use when
 * the interface tells the truth.
 *
 * Phase 7 takes it to twelve. `getPulls` is the ninth §9 names; `getPull` and
 * `getPullFiles` are beyond it, and deliberately: §9's list was written before
 * the Review screen was designed, and a pull request turns out to be three
 * reads rather than one — a list, an object with its conversation, and a diff
 * that is REST because GraphQL has no patch field. Folding the last two into
 * `getPulls` would have made one method mean three things.
 *
 * The home screen adds the last two, and they are the only methods here that do
 * not take a `RepoRef` — every read above this point is about one repository,
 * and these two are about the account that can see them all.
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

	/**
	 * One page of pull requests, narrowed to a state. The triage list: nothing
	 * on it is per-row, so a page costs one query however many rows it has.
	 */
	getPulls(ref: RepoRef, filter?: PullFilter, after?: string | null): CacheQuery<PullsPage>;

	/**
	 * One pull request and its whole conversation — reviews, threads with their
	 * line positions, and the check rollup. Everything but the diff.
	 */
	getPull(ref: RepoRef, number: number): CacheQuery<PullDetail>;

	/**
	 * One page of that pull request's diff, over REST. `at` is the pair of
	 * commits the diff is a function of, and it is what makes the answer
	 * permanent — see `pull-files.ts`.
	 */
	getPullFiles(
		ref: RepoRef,
		number: number,
		at: PullDiffAt,
		after?: string | null
	): CacheQuery<PullFilesPage>;

	/**
	 * `CODEOWNERS`, from whichever of its three homes has it — one query, three
	 * aliased expressions, no fan-out. What decides which paths are yours.
	 */
	getOwners(ref: RepoRef, rev: string): CacheQuery<OwnersFile>;

	/**
	 * Every path in the repository at a revision — the palette's file index.
	 * One request rather than a query per directory, which is what lets a
	 * repository be searched by path without breaking §7's fan-out rule.
	 */
	getPaths(ref: RepoRef, rev: string): CacheQuery<PathIndex>;

	/**
	 * One page of the repositories this token can see, most recently pushed
	 * first. The home screen's list, and the answer to a question the arrival
	 * screen used to ask *you*.
	 *
	 * `login` names the account rather than narrowing the query — GitHub reads
	 * the viewer from the token — because it is the cache's address: one browser,
	 * two tokens, two lists that must not be mistaken for each other.
	 */
	getViewerRepos(login: string, after?: string | null): CacheQuery<ViewerReposPage>;

	/**
	 * The open pull requests that involve you: the ones you opened, and the ones
	 * waiting on your review, merged into one list. Two searches, one round trip,
	 * and no per-row read — see `viewer.ts` for why it is search and not a
	 * connection.
	 */
	getViewerPulls(login: string): CacheQuery<InboxPulls>;

	/**
	 * Land a pull request. **The one method here that is not a read**, and the
	 * one place ARCHITECTURE.md §1's read-only rule is broken on purpose — see
	 * the note there for why merging is the exception and nothing else is.
	 *
	 * It returns a promise rather than a `CacheQuery` because none of the read
	 * path applies to it: there is nothing to cache, nothing to revalidate, and
	 * nothing to replay. What it does have in common with the reads is the seam
	 * — a screen still never touches `fetch`, a status code or the token.
	 *
	 * The caller re-reads the pull request afterwards. Patching the cached copy
	 * to say `MERGED` from here would be us asserting the outcome; asking is
	 * cheap, and it is the only version of events GitHub agrees with.
	 */
	mergePull(
		ref: RepoRef,
		number: number,
		request: MergeRequest
	): Promise<WriteResult<MergeResponse>>;
}

/**
 * The two commits a pull request's diff is measured between. Both are needed:
 * the head is the obvious one, and the base matters because GitHub recomputes
 * the merge base when the target branch moves, so a diff at one head against
 * two different bases is two different answers.
 */
export interface PullDiffAt {
	headOid: string;
	baseOid: string;
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
	},

	getPulls(ref, filter = 'open', after = null) {
		// A pull request list is the mutable layer by definition — the whole point
		// of it is what is in flight. The cursor is part of the address for the
		// same reason it is on a log page: a page is filed under where it starts.
		const page = after ? `after=${after}` : 'head';

		return {
			key: mutableKey('pulls', ref, `${filter}:${page}`),
			maxAge: FRESHNESS.pulls,
			run: (options) => getPulls(ref, filter, after, options).then(fromQuery)
		};
	},

	getPull(ref, number) {
		return {
			// Mutable however settled the pull request looks: a merged one still
			// gains replies, and the check rollup moves while CI runs. The window is
			// the shortest in the app for exactly that reason.
			key: mutableKey('pull', ref, String(number)),
			maxAge: FRESHNESS.pull,
			run: (options) => getPull(ref, number, options).then(fromQuery)
		};
	},

	getPullFiles(ref, number, at, after = null) {
		// The cursor is the page it came from — `pull-files.ts` explains why the
		// synthetic cursor lives here rather than inside `pages()`.
		const page = after ? Number(after) + 1 : 1;

		return {
			/**
			 * **Permanent, keyed by both commits.** A pull request's diff is a
			 * function of its head and the base it is measured against, so pinning
			 * both makes the answer immutable — which matters more here than
			 * anywhere else in the app, because this is the largest payload we
			 * fetch and the screen that fetches it is the one people sit on
			 * longest. `revKey` cannot decide this: it routes on one revision and a
			 * diff has two, the same reason `getCompare` writes its check out.
			 */
			key:
				isOid(at.headOid) && isOid(at.baseOid)
					? immutableKey('pullfiles', ref, at.headOid, `${number}:${at.baseOid}:p${page}`)
					: mutableKey('pullfiles', ref, `${number}:p${page}`),
			maxAge: FRESHNESS.pull,
			run: (options) => getPullFiles(ref, number, page, options)
		};
	},

	getOwners(ref, rev) {
		return {
			// `revKey` as everywhere else: at a branch it revalidates on the longest
			// window in the app, at a commit SHA it is permanent.
			//
			// ARCHITECTURE.md §6 says "cached against the tree SHA that produced
			// it". Keying on the revision is the same idea and a cheaper one: the
			// *root* tree SHA moves with every commit that changes anything, so
			// keying on it would re-fetch a file that had not changed on every
			// push, which is the opposite of what §6 is asking for.
			key: revKey('owners', ref, rev),
			maxAge: FRESHNESS.owners,
			run: (options) => getOwners(ref, rev, options).then(fromQuery)
		};
	},

	getPaths(ref, rev) {
		return {
			// `revKey` as everywhere else, and it matters more here than anywhere:
			// this is the largest single payload in the app, so the palette resolves
			// a revision to its commit before asking, and the answer lands in the
			// permanent store rather than on a window.
			key: revKey('paths', ref, rev),
			maxAge: FRESHNESS.paths,
			run: (options) => getPaths(ref, rev, options)
		};
	},

	getViewerRepos(login, after = null) {
		// The cursor is part of the address, as it is on every other walk: a page
		// is filed under where it starts, so paging back down a list you have
		// already read is a local read.
		const page = after ? `after=${after}` : 'head';

		return {
			key: accountKey('repos', login, page),
			maxAge: FRESHNESS.repos,
			run: (options) => getViewerRepos(after, options).then(fromQuery)
		};
	},

	getViewerPulls(login) {
		return {
			key: accountKey('inbox', login),
			maxAge: FRESHNESS.inbox,
			run: (options) => getViewerPulls(options).then(fromQuery)
		};
	},

	mergePull(ref, number, request) {
		return mergePull(ref, number, request);
	}
};

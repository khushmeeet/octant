/**
 * The client — PLAN.md Phase 1.
 *
 * One place where every network call goes. Screens import from here and never
 * touch `fetch`, a status code, or the token.
 */

export { document, type TypedDocument, type Variables } from './document';
export { query, type QueryOptions, type QueryResult } from './graphql';
export {
	restGet,
	compare,
	commitDetail,
	gitTree,
	pullFiles,
	comparisonTruncated,
	COMPARE_FILE_CAP,
	COMMIT_FILE_CAP,
	PULL_FILES_CAP,
	PULL_FILES_PAGE,
	type RestOptions,
	type RestResult,
	type Comparison,
	type CommitResponse,
	type CompareCommit,
	type DiffFile,
	type GitTree,
	type GitTreeEntry
} from './rest';
export {
	ERROR_LABEL,
	type GraphQLFieldError,
	type SourceError,
	type SourceErrorKind
} from './errors';
export { setTokenProvider, type TokenProvider } from './token';
export { parseRepoRef, type RepoRef } from './types';
export { getRepo, REPO, type HeadCommit, type RepoSummary } from './repo';
export { getTree, TREE, type EntryType, type TreeEntry, type TreeListing } from './tree';
export { getBlob, getFile, BLOB, FILE, type BlobContent, type FileContent } from './blob';
export { getBlame, BLAME, type BlameCommit, type BlameRange, type FileBlame } from './blame';
export { getLog, logAuthor, LOG, LOG_PAGE_SIZE, type LogCommit, type LogPage } from './log';
export { getCommit, type ChangedFile, type ChangeStatus, type CommitDetail } from './commit';
export {
	getRefs,
	refAuthor,
	REFS,
	REFS_PAGE_SIZE,
	type Annotation,
	type RefEntry,
	type RefKind,
	type RefsPage
} from './refs';
export { getCompare, type CompareCommitInfo, type CompareResult } from './compare';
export {
	getPulls,
	pullAuthor,
	PULLS,
	PULLS_PAGE_SIZE,
	type PullEntry,
	type PullFilter,
	type PullsPage,
	type PullState,
	type ReviewDecision
} from './pulls';
export {
	approvals,
	changesRequested,
	getPull,
	unresolved,
	PULL,
	COMMENT_PAGE_SIZE,
	THREAD_PAGE_SIZE,
	type MergeableState,
	type PullDetail,
	type Review,
	type ReviewComment,
	type ReviewState,
	type ReviewThread,
	type ThreadSide
} from './pull';
export { getPullFiles, pullFilesTruncated, type PullFilesPage } from './pull-files';
export { getOwners, OWNERS, OWNERS_PATHS, type OwnersFile } from './owners';
export { getPaths, type PathIndex } from './paths';
export {
	getViewerPulls,
	getViewerRepos,
	INBOX,
	INBOX_PAGE_SIZE,
	REPOS,
	REPOS_PAGE_SIZE,
	type InboxPull,
	type InboxPulls,
	type ViewerRepo,
	type ViewerReposPage
} from './viewer';
export { NO_CHECKS, type CheckRun, type CheckState, type CheckSummary } from './checks';
export { commitOid, type RevisionNode } from './revision';
export {
	fromQuery,
	fromRest,
	type CacheQuery,
	type FetchOptions,
	type Fetched,
	type PageOf
} from './query';
export { GitHubSource, type PullDiffAt, type Source } from './source';

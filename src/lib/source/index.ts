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
	pullFiles,
	comparisonTruncated,
	COMPARE_FILE_CAP,
	type RestOptions,
	type RestResult,
	type Comparison,
	type CompareCommit,
	type DiffFile
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
export { fromQuery, fromRest, type CacheQuery, type FetchOptions, type Fetched } from './query';
export { GitHubSource, type Source } from './source';

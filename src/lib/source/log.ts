import { document } from './document';
import { fail } from './errors';
import { query, type QueryOptions, type QueryResult } from './graphql';
import type { PageOf } from './query';
import type { RepoRef } from './types';

/**
 * The log query — PLAN.md Phase 5, and ARCHITECTURE.md §4's
 * `ref.target.history(path:, first:, after:)`.
 *
 * Three things arrive together because a screen's main content and its sidebar
 * blocks are one round trip (ARCHITECTURE.md §4): the commits, the total for
 * the scope, and the cursor for the next page. `totalCount` is what lets the
 * screen say "50 of 1,284" rather than implying the log ends where the first
 * page does.
 *
 * `additions`/`deletions` are what the delta bar is made of, and `parents` is
 * what the graph column is made of. Both are per-commit fields GitHub computes
 * anyway; asking for them here is the difference between one query and one
 * query per row.
 */

interface CommitNode {
	oid: string;
	abbreviatedOid: string;
	messageHeadline: string;
	messageBody: string;
	committedDate: string;
	additions: number;
	deletions: number;
	changedFilesIfAvailable: number | null;
	author: { name: string | null; user: { login: string } | null } | null;
	parents: { nodes: ({ oid: string } | null)[] | null };
}

interface HistoryNode {
	__typename: string;
	history?: {
		totalCount: number;
		pageInfo: { hasNextPage: boolean; endCursor: string | null };
		nodes: (CommitNode | null)[] | null;
	} | null;
}

interface LogVars extends RepoRef {
	/** A revision alone. History is walked from a commit, not from a path. */
	rev: string;
	/** `null` is the whole repository — an empty string is not the same thing. */
	path: string | null;
	first: number;
	after: string | null;
}

export const LOG = document<{ repository: { object: HistoryNode | null } | null }, LogVars>({
	name: 'Log',
	variables:
		'$owner: String!, $name: String!, $rev: String!, $path: String, $first: Int!, $after: String',
	body: `
	repository(owner: $owner, name: $name) {
		object(expression: $rev) {
			__typename
			... on Commit {
				history(path: $path, first: $first, after: $after) {
					totalCount
					pageInfo { hasNextPage endCursor }
					nodes {
						oid
						abbreviatedOid
						messageHeadline
						messageBody
						committedDate
						additions
						deletions
						changedFilesIfAvailable
						author { name user { login } }
						parents(first: 3) { nodes { oid } }
					}
				}
			}
		}
	}`
});

export interface LogCommit {
	oid: string;
	abbreviatedOid: string;
	/** The first line. What the table's message column shows. */
	headline: string;
	/** Everything after it, which the detail pane shows and the table does not. */
	body: string;
	committedDate: string;
	authorName: string | null;
	authorLogin: string | null;
	additions: number;
	deletions: number;
	/** `null` when the commit is too large for GitHub to count cheaply. */
	changedFiles: number | null;
	/** First parent first, which is what makes the graph's spine the spine. */
	parents: string[];
}

/** One page of history. `PageOf` is the shape `pages()` walks. */
export interface LogPage extends PageOf<LogCommit> {
	items: LogCommit[];
	/** The scope this page was walked under, `''` for the whole repository. */
	path: string;
}

/**
 * Fifty rows is about three screens of a 32px table, so the first page always
 * outruns the first scroll, and it is small enough that a log nobody pages
 * through has not overpaid for the ones they did not read.
 */
export const LOG_PAGE_SIZE = 50;

export async function getLog(
	ref: RepoRef,
	rev: string,
	path = '',
	after: string | null = null,
	options: QueryOptions = {}
): Promise<QueryResult<LogPage>> {
	const clean = path.replace(/^\/+|\/+$/g, '');
	const result = await query(
		LOG,
		{ ...ref, rev, path: clean || null, first: LOG_PAGE_SIZE, after },
		options
	);
	if (!result.ok) return result;

	const node = result.data.repository?.object ?? null;

	if (!node || node.__typename !== 'Commit') {
		return {
			ok: false,
			error: fail('not-found', `No commit at ${rev} — or it is not visible to this token.`)
		};
	}

	const history = node.history;

	return {
		ok: true,
		data: {
			items: (history?.nodes ?? [])
				.filter((entry): entry is CommitNode => entry !== null)
				.map(commit),
			totalCount: history?.totalCount ?? 0,
			endCursor: history?.pageInfo.endCursor ?? null,
			hasNextPage: history?.pageInfo.hasNextPage ?? false,
			path: clean
		},
		partial: result.partial
	};
}

function commit(node: CommitNode): LogCommit {
	return {
		oid: node.oid,
		abbreviatedOid: node.abbreviatedOid || node.oid.slice(0, 7),
		headline: node.messageHeadline ?? '',
		body: node.messageBody ?? '',
		committedDate: node.committedDate ?? '',
		authorName: node.author?.name ?? null,
		authorLogin: node.author?.user?.login ?? null,
		additions: node.additions ?? 0,
		deletions: node.deletions ?? 0,
		changedFiles: node.changedFilesIfAvailable ?? null,
		parents: (node.parents.nodes ?? [])
			.filter((parent): parent is { oid: string } => parent !== null)
			.map((parent) => parent.oid)
	};
}

/** How the log names an author: the login if there is one, else the name. */
export function logAuthor(commit: LogCommit): string {
	return commit.authorLogin ?? commit.authorName ?? 'unknown';
}

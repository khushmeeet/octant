import { document } from './document';
import { fail } from './errors';
import { query, type QueryOptions, type QueryResult } from './graphql';
import type { RepoRef } from './types';

/**
 * Blame — PLAN.md Phase 4, "who wrote this line and why".
 *
 * GraphQL answers with *ranges* rather than lines: one entry per run of
 * consecutive lines that share a commit. That is the shape the gutter wants
 * anyway — DESIGN.md §5 asks for repeated SHAs to collapse so authorship reads
 * as blocks — and it is far smaller than a line-per-line answer on a file of
 * any size.
 *
 * Blame is the most expensive read in the app: GitHub walks the file's history
 * to produce it. Two things follow. It is a separate query from the file's
 * contents, so the code is on screen while it is still out; and at a commit SHA
 * it is permanent, which is the difference between paying once and paying every
 * time you open a file you have read before.
 */

interface BlameCommitNode {
	oid: string;
	abbreviatedOid: string;
	messageHeadline: string;
	committedDate: string;
	author?: { name: string | null; user: { login: string } | null } | null;
}

interface BlameRangeNode {
	startingLine: number;
	endingLine: number;
	commit: BlameCommitNode;
}

interface CommitNode {
	__typename: string;
	blame?: { ranges: BlameRangeNode[] } | null;
}

interface BlameVars extends RepoRef {
	/** A revision alone — blame is taken at a commit, not at a path. */
	rev: string;
	path: string;
}

export const BLAME = document<{ repository: { object: CommitNode | null } | null }, BlameVars>({
	name: 'Blame',
	variables: '$owner: String!, $name: String!, $rev: String!, $path: String!',
	body: `
	repository(owner: $owner, name: $name) {
		object(expression: $rev) {
			__typename
			... on Commit {
				blame(path: $path) {
					ranges {
						startingLine
						endingLine
						commit {
							oid
							abbreviatedOid
							messageHeadline
							committedDate
							author { name user { login } }
						}
					}
				}
			}
		}
	}`
});

export interface BlameCommit {
	oid: string;
	abbreviatedOid: string;
	headline: string;
	committedDate: string;
	authorName: string | null;
	authorLogin: string | null;
}

/** Lines `from`…`to`, 1-based and inclusive, as git counts them. */
export interface BlameRange {
	from: number;
	to: number;
	commit: BlameCommit;
}

export interface FileBlame {
	path: string;
	ranges: BlameRange[];
}

export async function getBlame(
	ref: RepoRef,
	rev: string,
	path: string,
	options: QueryOptions = {}
): Promise<QueryResult<FileBlame>> {
	const clean = path.replace(/^\/+|\/+$/g, '');
	const result = await query(BLAME, { ...ref, rev, path: clean }, options);
	if (!result.ok) return result;

	const node = result.data.repository?.object ?? null;

	if (!node || node.__typename !== 'Commit') {
		return {
			ok: false,
			error: fail('not-found', `No commit at ${rev} — or it is not visible to this token.`)
		};
	}

	const ranges = (node.blame?.ranges ?? [])
		.map(range)
		// GitHub returns them in order, but the gutter indexes by line and a
		// single out-of-order range would misplace a whole run.
		.sort((a, b) => a.from - b.from);

	return { ok: true, data: { path: clean, ranges }, partial: result.partial };
}

function range(node: BlameRangeNode): BlameRange {
	return {
		from: node.startingLine,
		to: node.endingLine,
		commit: {
			oid: node.commit.oid,
			abbreviatedOid: node.commit.abbreviatedOid || node.commit.oid.slice(0, 7),
			headline: node.commit.messageHeadline ?? '',
			committedDate: node.commit.committedDate ?? '',
			authorName: node.commit.author?.name ?? null,
			authorLogin: node.commit.author?.user?.login ?? null
		}
	};
}

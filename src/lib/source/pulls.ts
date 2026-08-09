import { rollupState, type CheckState } from './checks';
import { document } from './document';
import { fail } from './errors';
import { query, type QueryOptions, type QueryResult } from './graphql';
import type { PageOf } from './query';
import type { RepoRef } from './types';

/**
 * The pull request list — PLAN.md Phase 7, and ARCHITECTURE.md §4's
 * `pullRequest` read at its cheapest.
 *
 * This is the triage screen, so it is shaped to the question "which of these
 * needs me": who wrote it, how big it is, whether CI is green, and whether
 * somebody has already approved it. Everything a row shows arrives with the
 * row — there is no per-row read anywhere on this screen, which is the rule
 * ARCHITECTURE.md §7 sets and the reason the refs list guards its `compare`
 * field behind an `@include`.
 *
 * The one nested connection is `commits(last: 1)`, for the check rollup. It is
 * bounded by the page rather than by the repository — fifty PRs cost fifty
 * extra nodes, not a walk — and the rollup is a stored field rather than a
 * computed one, so it is nothing like the merge base `Ref.compare` asks for.
 * A triage list without a CI column is a list you have to open every row of.
 */

/** GitHub's own three. A draft is an `OPEN` pull request with a flag set. */
export type PullState = 'OPEN' | 'CLOSED' | 'MERGED';

/** What the screen offers, which is the three plus "do not narrow at all". */
export type PullFilter = 'open' | 'merged' | 'closed' | 'all';

/** `null` asks for every state — the variable is nullable for exactly this. */
const STATES: Record<PullFilter, PullState[] | null> = {
	open: ['OPEN'],
	merged: ['MERGED'],
	closed: ['CLOSED'],
	all: null
};

/**
 * `APPROVED`, `CHANGES_REQUESTED`, `REVIEW_REQUIRED` — or null on a pull
 * request nobody has been asked to look at.
 */
export type ReviewDecision = 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null;

interface PullNode {
	number: number;
	title: string;
	state: PullState;
	isDraft: boolean;
	createdAt: string;
	updatedAt: string;
	baseRefName: string;
	headRefName: string;
	headRefOid: string;
	additions: number;
	deletions: number;
	changedFiles: number;
	author: { login: string } | null;
	reviewDecision: ReviewDecision;
	comments: { totalCount: number };
	commits: { nodes: ({ commit: { statusCheckRollup: { state: string } | null } } | null)[] | null };
}

interface PullsNode {
	totalCount: number;
	pageInfo: { hasNextPage: boolean; endCursor: string | null };
	nodes: (PullNode | null)[] | null;
}

interface PullsVars extends RepoRef {
	states: PullState[] | null;
	first: number;
	after: string | null;
}

export const PULLS = document<{ repository: { pullRequests: PullsNode | null } | null }, PullsVars>(
	{
		name: 'Pulls',
		variables:
			'$owner: String!, $name: String!, $states: [PullRequestState!], $first: Int!, $after: String',
		body: `
	repository(owner: $owner, name: $name) {
		pullRequests(
			states: $states
			first: $first
			after: $after
			orderBy: { field: UPDATED_AT, direction: DESC }
		) {
			totalCount
			pageInfo { hasNextPage endCursor }
			nodes {
				number
				title
				state
				isDraft
				createdAt
				updatedAt
				baseRefName
				headRefName
				headRefOid
				additions
				deletions
				changedFiles
				author { login }
				reviewDecision
				comments { totalCount }
				commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
			}
		}
	}`
	}
);

export interface PullEntry {
	number: number;
	title: string;
	state: PullState;
	isDraft: boolean;
	createdAt: string;
	updatedAt: string;
	/** Where it wants to land, and what it is landing from. */
	baseRefName: string;
	headRefName: string;
	headRefOid: string;
	additions: number;
	deletions: number;
	changedFiles: number;
	authorLogin: string | null;
	reviewDecision: ReviewDecision;
	comments: number;
	/** The rollup only — the runs behind it are the detail screen's read. */
	checks: CheckState;
}

export interface PullsPage extends PageOf<PullEntry> {
	items: PullEntry[];
	filter: PullFilter;
}

/**
 * Fifty rows is three screens of a 32px table, the same page the log walks —
 * and a repository with more than fifty open pull requests has a problem no
 * client can page its way out of.
 */
export const PULLS_PAGE_SIZE = 50;

export async function getPulls(
	ref: RepoRef,
	filter: PullFilter = 'open',
	after: string | null = null,
	options: QueryOptions = {}
): Promise<QueryResult<PullsPage>> {
	const result = await query(
		PULLS,
		{ ...ref, states: STATES[filter], first: PULLS_PAGE_SIZE, after },
		options
	);
	if (!result.ok) return result;

	const node = result.data.repository?.pullRequests ?? null;
	if (!node) {
		return {
			ok: false,
			error: fail('not-found', `No ${ref.owner}/${ref.name} — or it is not visible to this token.`)
		};
	}

	return {
		ok: true,
		data: {
			items: (node.nodes ?? []).filter((entry): entry is PullNode => entry !== null).map(pullEntry),
			totalCount: node.totalCount ?? 0,
			endCursor: node.pageInfo.endCursor ?? null,
			hasNextPage: node.pageInfo.hasNextPage ?? false,
			filter
		},
		partial: result.partial
	};
}

function pullEntry(node: PullNode): PullEntry {
	return {
		number: node.number,
		title: node.title ?? '',
		state: node.state,
		isDraft: node.isDraft ?? false,
		createdAt: node.createdAt ?? '',
		updatedAt: node.updatedAt ?? '',
		baseRefName: node.baseRefName ?? '',
		headRefName: node.headRefName ?? '',
		headRefOid: node.headRefOid ?? '',
		additions: node.additions ?? 0,
		deletions: node.deletions ?? 0,
		changedFiles: node.changedFiles ?? 0,
		authorLogin: node.author?.login ?? null,
		reviewDecision: node.reviewDecision ?? null,
		comments: node.comments?.totalCount ?? 0,
		checks: rollupState(node.commits?.nodes?.[0]?.commit.statusCheckRollup?.state)
	};
}

/** How the list names an author. Ghosted accounts come back as a null actor. */
export function pullAuthor(entry: { authorLogin: string | null }): string {
	return entry.authorLogin ?? 'unknown';
}

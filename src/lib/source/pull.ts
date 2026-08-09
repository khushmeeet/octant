import { summarise, type CheckSummary } from './checks';
import { document } from './document';
import { fail } from './errors';
import { query, type QueryOptions, type QueryResult } from './graphql';
import type { PullState, ReviewDecision } from './pulls';
import type { RepoRef } from './types';

/**
 * One pull request — PLAN.md Phase 7, and the hardest document in the app.
 *
 * ARCHITECTURE.md §4 asks for `pullRequest` with "reviews, `reviewThreads` with
 * line positions, comments, check runs", and §4's rule is one query per screen:
 * the diff-first detail view's main content and all three sidebar blocks come
 * back in a single round trip. So the identity, the state, the base and head
 * SHAs, every review, every thread with its comments, and the check rollup with
 * the runs behind it are one document. The diff itself is the only separate
 * read, because GraphQL has no patch field — that is `pull-files.ts`.
 *
 * **The head and base SHAs are the load-bearing fields.** Everything else on
 * the screen is chrome around them: the whole-diff read is addressed by the
 * pair, "since my last review" is a comparison between the recorded head and
 * this one, and mark-viewed is a per-file record of a SHA. A pull request is
 * two moving SHAs with a conversation attached.
 *
 * **A thread carries the commit its comments were written against.** That is
 * PLAN.md Phase 7's "watch for" — comment anchoring across force pushes — and
 * it is one field, `originalCommit { oid }`, rather than a mechanism. When
 * GitHub can still place a thread on the current diff it sends `line`; when the
 * line has moved out from under it, `line` is null and only `originalLine`
 * survives. Carrying the SHA that number belonged to is what lets the screen
 * say *which* version of the file the comment was about instead of dropping the
 * comment or pinning it to a line that now means something else.
 */

/** GitHub's five, of which `PENDING` never appears in `latestReviews`. */
export type ReviewState = 'PENDING' | 'COMMENTED' | 'APPROVED' | 'CHANGES_REQUESTED' | 'DISMISSED';

/** `MERGEABLE`, `CONFLICTING`, or `UNKNOWN` while GitHub works it out. */
export type MergeableState = 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN';

/** Which side of the diff a thread hangs off. `LEFT` is the old file. */
export type ThreadSide = 'LEFT' | 'RIGHT';

interface ActorNode {
	login: string;
	avatarUrl?: string | null;
}

interface CommentNode {
	id: string;
	author: ActorNode | null;
	body: string;
	createdAt: string;
	outdated: boolean;
	originalCommit: { oid: string } | null;
	url: string;
}

interface ThreadNode {
	id: string;
	isResolved: boolean;
	isOutdated: boolean;
	path: string;
	line: number | null;
	startLine: number | null;
	originalLine: number | null;
	diffSide: ThreadSide;
	resolvedBy: ActorNode | null;
	comments: { totalCount: number; nodes: (CommentNode | null)[] | null };
}

interface ReviewNode {
	id: string;
	state: ReviewState;
	author: ActorNode | null;
	submittedAt: string | null;
	body: string;
	url: string;
}

interface RollupHolder {
	nodes: ({ commit: { oid: string; statusCheckRollup: unknown } } | null)[] | null;
}

interface PullNode {
	number: number;
	title: string;
	body: string;
	state: PullState;
	isDraft: boolean;
	isCrossRepository: boolean;
	createdAt: string;
	updatedAt: string;
	mergedAt: string | null;
	closedAt: string | null;
	baseRefName: string;
	headRefName: string;
	baseRefOid: string;
	headRefOid: string;
	additions: number;
	deletions: number;
	changedFiles: number;
	mergeable: MergeableState;
	url: string;
	author: ActorNode | null;
	reviewDecision: ReviewDecision;
	totalCommits: { totalCount: number };
	commits: RollupHolder;
	latestReviews: { nodes: (ReviewNode | null)[] | null } | null;
	reviewThreads: {
		totalCount: number;
		pageInfo: { hasNextPage: boolean };
		nodes: (ThreadNode | null)[] | null;
	};
}

interface PullVars extends RepoRef {
	number: number;
	threads: number;
	comments: number;
	contexts: number;
}

export const PULL = document<{ repository: { pullRequest: PullNode | null } | null }, PullVars>({
	name: 'Pull',
	variables:
		'$owner: String!, $name: String!, $number: Int!, $threads: Int!, $comments: Int!, $contexts: Int!',
	body: `
	repository(owner: $owner, name: $name) {
		pullRequest(number: $number) {
			number
			title
			body
			state
			isDraft
			isCrossRepository
			createdAt
			updatedAt
			mergedAt
			closedAt
			baseRefName
			headRefName
			baseRefOid
			headRefOid
			additions
			deletions
			changedFiles
			mergeable
			url
			author { login avatarUrl }
			reviewDecision
			totalCommits: commits { totalCount }
			commits(last: 1) {
				nodes {
					commit {
						oid
						statusCheckRollup {
							state
							contexts(first: $contexts) {
								totalCount
								nodes {
									__typename
									... on CheckRun { name conclusion status detailsUrl }
									... on StatusContext { context state targetUrl }
								}
							}
						}
					}
				}
			}
			latestReviews(last: 20) {
				nodes { id state author { login avatarUrl } submittedAt body url }
			}
			reviewThreads(first: $threads) {
				totalCount
				pageInfo { hasNextPage }
				nodes {
					id
					isResolved
					isOutdated
					path
					line
					startLine
					originalLine
					diffSide
					resolvedBy { login }
					comments(first: $comments) {
						totalCount
						nodes {
							id
							author { login avatarUrl }
							body
							createdAt
							outdated
							originalCommit { oid }
							url
						}
					}
				}
			}
		}
	}`
});

export interface ReviewComment {
	id: string;
	authorLogin: string | null;
	avatarUrl: string | null;
	/** Markdown. Rendered through our own parser, never as HTML — Phase 3's rule. */
	body: string;
	createdAt: string;
	outdated: boolean;
	/**
	 * The commit this comment was written against. What makes a thread placeable
	 * when its line has moved — PLAN.md Phase 7's "watch for".
	 */
	commitOid: string | null;
	url: string;
}

export interface ReviewThread {
	id: string;
	path: string;
	/** Where it sits on the *current* diff, or `null` once it has moved. */
	line: number | null;
	/** Where it sat when it was written. Always known. */
	originalLine: number | null;
	startLine: number | null;
	side: ThreadSide;
	isResolved: boolean;
	/** GitHub could not place it on the current diff. */
	isOutdated: boolean;
	resolvedBy: string | null;
	comments: ReviewComment[];
	/** How many there are, which is not always how many we asked for. */
	totalComments: number;
}

export interface Review {
	id: string;
	state: ReviewState;
	authorLogin: string | null;
	avatarUrl: string | null;
	submittedAt: string | null;
	body: string;
	url: string;
}

export interface PullDetail {
	number: number;
	title: string;
	body: string;
	state: PullState;
	isDraft: boolean;
	isCrossRepository: boolean;
	createdAt: string;
	updatedAt: string;
	mergedAt: string | null;
	closedAt: string | null;
	baseRefName: string;
	headRefName: string;
	/** The two SHAs the whole screen is addressed by. */
	baseRefOid: string;
	headRefOid: string;
	additions: number;
	deletions: number;
	changedFiles: number;
	totalCommits: number;
	mergeable: MergeableState;
	url: string;
	authorLogin: string | null;
	avatarUrl: string | null;
	reviewDecision: ReviewDecision;
	checks: CheckSummary;
	reviews: Review[];
	threads: ReviewThread[];
	/** More threads exist than we asked for. Said out loud rather than hidden. */
	moreThreads: boolean;
	totalThreads: number;
}

/**
 * Fifty threads is more conversation than any pull request worth reviewing in
 * one sitting has, and twenty replies is more than any thread that is still
 * about code. Both are disclosed when they bind rather than silently clipped.
 */
export const THREAD_PAGE_SIZE = 50;
export const COMMENT_PAGE_SIZE = 20;
/** Enough for a busy CI matrix; the runs are a list, not a fan-out. */
export const CONTEXT_PAGE_SIZE = 30;

export async function getPull(
	ref: RepoRef,
	number: number,
	options: QueryOptions = {}
): Promise<QueryResult<PullDetail>> {
	const result = await query(
		PULL,
		{
			...ref,
			number,
			threads: THREAD_PAGE_SIZE,
			comments: COMMENT_PAGE_SIZE,
			contexts: CONTEXT_PAGE_SIZE
		},
		options
	);
	if (!result.ok) return result;

	const node = result.data.repository?.pullRequest ?? null;
	if (!node) {
		return {
			ok: false,
			error: fail(
				'not-found',
				`No pull request #${number} in ${ref.owner}/${ref.name} — or it is not visible to this token.`
			)
		};
	}

	return { ok: true, data: detail(node), partial: result.partial };
}

function detail(node: PullNode): PullDetail {
	const threads = (node.reviewThreads?.nodes ?? [])
		.filter((entry): entry is ThreadNode => entry !== null)
		.map(thread)
		.sort(byPlace);

	return {
		number: node.number,
		title: node.title ?? '',
		body: node.body ?? '',
		state: node.state,
		isDraft: node.isDraft ?? false,
		isCrossRepository: node.isCrossRepository ?? false,
		createdAt: node.createdAt ?? '',
		updatedAt: node.updatedAt ?? '',
		mergedAt: node.mergedAt ?? null,
		closedAt: node.closedAt ?? null,
		baseRefName: node.baseRefName ?? '',
		headRefName: node.headRefName ?? '',
		baseRefOid: node.baseRefOid ?? '',
		headRefOid: node.headRefOid ?? '',
		additions: node.additions ?? 0,
		deletions: node.deletions ?? 0,
		changedFiles: node.changedFiles ?? 0,
		totalCommits: node.totalCommits?.totalCount ?? 0,
		mergeable: node.mergeable ?? 'UNKNOWN',
		url: node.url ?? '',
		authorLogin: node.author?.login ?? null,
		avatarUrl: node.author?.avatarUrl ?? null,
		reviewDecision: node.reviewDecision ?? null,
		checks: summarise(node.commits?.nodes?.[0]?.commit.statusCheckRollup as never),
		reviews: (node.latestReviews?.nodes ?? [])
			.filter((entry): entry is ReviewNode => entry !== null)
			// A review nobody submitted is a draft in somebody else's browser.
			.filter((entry) => entry.state !== 'PENDING')
			.map(review),
		threads,
		moreThreads: node.reviewThreads?.pageInfo.hasNextPage ?? false,
		totalThreads: node.reviewThreads?.totalCount ?? threads.length
	};
}

function thread(node: ThreadNode): ReviewThread {
	return {
		id: node.id,
		path: node.path ?? '',
		line: node.line ?? null,
		originalLine: node.originalLine ?? null,
		startLine: node.startLine ?? null,
		side: node.diffSide ?? 'RIGHT',
		isResolved: node.isResolved ?? false,
		isOutdated: node.isOutdated ?? false,
		resolvedBy: node.resolvedBy?.login ?? null,
		comments: (node.comments?.nodes ?? [])
			.filter((entry): entry is CommentNode => entry !== null)
			.map(comment),
		totalComments: node.comments?.totalCount ?? 0
	};
}

function comment(node: CommentNode): ReviewComment {
	return {
		id: node.id,
		authorLogin: node.author?.login ?? null,
		avatarUrl: node.author?.avatarUrl ?? null,
		body: node.body ?? '',
		createdAt: node.createdAt ?? '',
		outdated: node.outdated ?? false,
		commitOid: node.originalCommit?.oid ?? null,
		url: node.url ?? ''
	};
}

function review(node: ReviewNode): Review {
	return {
		id: node.id,
		state: node.state,
		authorLogin: node.author?.login ?? null,
		avatarUrl: node.author?.avatarUrl ?? null,
		submittedAt: node.submittedAt ?? null,
		body: node.body ?? '',
		url: node.url ?? ''
	};
}

/**
 * Threads in reading order: by file, then down the file. GitHub returns them in
 * the order they were created, which is the order the conversation happened in
 * and not the order the code is in — and this list is read beside a diff.
 *
 * Sorting at the source keeps it out of the render path and means the cached
 * value is already in display order, the same call `getTree` makes about
 * directories and `getRefs` about recency.
 */
function byPlace(a: ReviewThread, b: ReviewThread): number {
	if (a.path !== b.path) return a.path.localeCompare(b.path);
	return (a.line ?? a.originalLine ?? 0) - (b.line ?? b.originalLine ?? 0);
}

/** Threads still asking for something. The count the sidebar leads with. */
export function unresolved(threads: readonly ReviewThread[]): number {
	let n = 0;
	for (const thread of threads) if (!thread.isResolved) n += 1;
	return n;
}

/** Who approved, among the latest review from each reviewer. */
export function approvals(reviews: readonly Review[]): number {
	let n = 0;
	for (const review of reviews) if (review.state === 'APPROVED') n += 1;
	return n;
}

export function changesRequested(reviews: readonly Review[]): number {
	let n = 0;
	for (const review of reviews) if (review.state === 'CHANGES_REQUESTED') n += 1;
	return n;
}

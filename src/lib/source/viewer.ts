import { rollupState } from './checks';
import { document } from './document';
import { fail } from './errors';
import { query, type QueryOptions, type QueryResult } from './graphql';
import type { PullEntry } from './pulls';
import type { PageOf } from './query';
import type { RepoRef } from './types';

/**
 * The account's two lists — the home screen's reads.
 *
 * Every other query in this client is about one repository, named in the URL.
 * These two are about *you*: what you can open, and what is in flight that has
 * your name on it. That is a surface `ARCHITECTURE.md` §1 used to rule out
 * along with the rest of GitHub's account product, and the amendment is in §1
 * now — the arrival screen used to be a text field you had to already know the
 * answer to, which is the one question a client of your own repositories should
 * never have to ask.
 *
 * **Neither read fans out.** §7's hard rule is that no operation may walk a
 * whole repository, and nothing here does: the repository list is one paged
 * connection whose per-row open-PR count is a stored total rather than a walk,
 * and the pull requests are two bounded searches. A row costs nodes, never a
 * request — the same bargain the triage list makes, and the reason `Pulls` may
 * ask for `commits(last: 1)`.
 *
 * The one thing to know about `Inbox` is that **search is an index**, so a pull
 * request opened seconds ago may not be in it yet. That is acceptable for a
 * screen whose job is "what is waiting", and it buys the half of the answer a
 * plain connection cannot give: `viewer.pullRequests` returns what you *wrote*,
 * and the pull requests that need you most are the ones somebody else did.
 */

/* ---------------------------------------------------------- repositories -- */

interface RepoNode {
	nameWithOwner: string;
	description: string | null;
	isPrivate: boolean;
	isArchived: boolean;
	isFork: boolean;
	pushedAt: string | null;
	pullRequests: { totalCount: number };
}

interface ReposNode {
	totalCount: number;
	pageInfo: { hasNextPage: boolean; endCursor: string | null };
	nodes: (RepoNode | null)[] | null;
}

interface ReposVars {
	first: number;
	after: string | null;
}

export const REPOS = document<{ viewer: { repositories: ReposNode | null } | null }, ReposVars>({
	name: 'Repos',
	variables: '$first: Int!, $after: String',
	body: `
	viewer {
		repositories(
			first: $first
			after: $after
			affiliations: [OWNER, COLLABORATOR, ORGANIZATION_MEMBER]
			orderBy: { field: PUSHED_AT, direction: DESC }
		) {
			totalCount
			pageInfo { hasNextPage endCursor }
			nodes {
				nameWithOwner
				description
				isPrivate
				isArchived
				isFork
				pushedAt
				pullRequests(states: OPEN) { totalCount }
			}
		}
	}`
});

export interface ViewerRepo extends RepoRef {
	nameWithOwner: string;
	description: string | null;
	isPrivate: boolean;
	isArchived: boolean;
	isFork: boolean;
	/**
	 * When anything last landed on any branch, which is what the list is ordered
	 * by. `pushedAt` and not `updatedAt`: the second one moves when somebody
	 * stars the repository or edits its description, and this list is about code.
	 */
	pushedAt: string;
	/** A stored total on the connection, not a walk of it. */
	openPullRequests: number;
}

export type ViewerReposPage = PageOf<ViewerRepo>;

/**
 * Fifty rows is the same page the log and the triage list walk, and it covers
 * every account that has not made a hobby of collecting repositories. Past that
 * there is a Load more button, because a rate limit is a real budget.
 */
export const REPOS_PAGE_SIZE = 50;

export async function getViewerRepos(
	after: string | null = null,
	options: QueryOptions = {}
): Promise<QueryResult<ViewerReposPage>> {
	const result = await query(REPOS, { first: REPOS_PAGE_SIZE, after }, options);
	if (!result.ok) return result;

	const node = result.data.viewer?.repositories ?? null;
	if (!node) {
		return { ok: false, error: fail('forbidden', 'This token cannot read your repositories.') };
	}

	return {
		ok: true,
		data: {
			items: (node.nodes ?? []).filter((entry): entry is RepoNode => entry !== null).map(repoEntry),
			totalCount: node.totalCount ?? 0,
			endCursor: node.pageInfo.endCursor ?? null,
			hasNextPage: node.pageInfo.hasNextPage ?? false
		},
		partial: result.partial
	};
}

function repoEntry(node: RepoNode): ViewerRepo {
	const [owner = '', name = ''] = node.nameWithOwner.split('/');

	return {
		owner,
		name,
		nameWithOwner: node.nameWithOwner,
		description: node.description,
		isPrivate: node.isPrivate ?? false,
		isArchived: node.isArchived ?? false,
		isFork: node.isFork ?? false,
		pushedAt: node.pushedAt ?? '',
		openPullRequests: node.pullRequests?.totalCount ?? 0
	};
}

/* ----------------------------------------------------------------- inbox -- */

interface InboxNode {
	number?: number;
	title?: string;
	isDraft?: boolean;
	createdAt?: string;
	updatedAt?: string;
	baseRefName?: string;
	headRefName?: string;
	headRefOid?: string;
	additions?: number;
	deletions?: number;
	changedFiles?: number;
	author?: { login: string } | null;
	reviewDecision?: PullEntry['reviewDecision'];
	comments?: { totalCount: number };
	repository?: { nameWithOwner: string; isPrivate: boolean } | null;
	commits?: {
		nodes: ({ commit: { statusCheckRollup: { state: string } | null } } | null)[] | null;
	};
}

interface SearchNode {
	issueCount: number;
	nodes: (InboxNode | null)[] | null;
}

interface InboxVars {
	mine: string;
	requested: string;
	first: number;
}

const INBOX_PULL = `
fragment inboxPull on PullRequest {
	number
	title
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
	repository { nameWithOwner isPrivate }
	commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
}`;

export const INBOX = document<{ mine: SearchNode | null; requested: SearchNode | null }, InboxVars>(
	{
		name: 'Inbox',
		variables: '$mine: String!, $requested: String!, $first: Int!',
		body: `
	mine: search(query: $mine, type: ISSUE, first: $first) {
		issueCount
		nodes { ...inboxPull }
	}
	requested: search(query: $requested, type: ISSUE, first: $first) {
		issueCount
		nodes { ...inboxPull }
	}`,
		fragments: [INBOX_PULL]
	}
);

/**
 * `@me` is GitHub's own way of saying "the authenticated user" in a search
 * qualifier, so the two queries are constants rather than something we have to
 * interpolate a login into — and a login that changes case or gets renamed
 * cannot desynchronise them.
 */
const MINE = 'is:pr is:open archived:false author:@me sort:updated-desc';
const REQUESTED = 'is:pr is:open archived:false review-requested:@me sort:updated-desc';

/** One pull request on the home screen, which spans every repository. */
export interface InboxPull extends PullEntry {
	repo: RepoRef;
	nameWithOwner: string;
	isPrivate: boolean;
	/** You opened it. */
	authored: boolean;
	/** Your review has been asked for. The one thing on this screen that is about you. */
	requested: boolean;
}

export interface InboxPulls {
	items: InboxPull[];
	/** What GitHub says the two sets hold, which is not what a page of them shows. */
	authoredTotal: number;
	requestedTotal: number;
	/** Either set was longer than a page. Said out loud rather than paged. */
	truncated: boolean;
}

/**
 * Twenty-five of each. This is a landing screen and not a triage list — the
 * triage list is per repository, it is one click away on every row, and it
 * pages. A home screen that needed a second page would be a home screen you
 * work in.
 */
export const INBOX_PAGE_SIZE = 25;

export async function getViewerPulls(options: QueryOptions = {}): Promise<QueryResult<InboxPulls>> {
	const result = await query(
		INBOX,
		{ mine: MINE, requested: REQUESTED, first: INBOX_PAGE_SIZE },
		options
	);
	if (!result.ok) return result;

	const mine = result.data.mine;
	const requested = result.data.requested;
	if (!mine && !requested) {
		return { ok: false, error: fail('forbidden', 'This token cannot search your pull requests.') };
	}

	// Keyed by repository and number rather than by the node's id, because the
	// same pull request arrives in both sets whenever you have asked somebody to
	// review your own work — one row, carrying both facts.
	const merged = new Map<string, InboxPull>();

	for (const [nodes, field] of [
		[mine?.nodes ?? [], 'authored'],
		[requested?.nodes ?? [], 'requested']
	] as const) {
		for (const node of nodes) {
			// `type: ISSUE` searches both kinds and `is:pr` narrows it, so anything
			// that is not a pull request comes back as an empty node.
			if (!node?.number || !node.repository) continue;

			const entry = merged.get(key(node)) ?? inboxPull(node);
			entry[field] = true;
			merged.set(key(node), entry);
		}
	}

	return {
		ok: true,
		data: {
			items: [...merged.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
			authoredTotal: mine?.issueCount ?? 0,
			requestedTotal: requested?.issueCount ?? 0,
			truncated:
				(mine?.issueCount ?? 0) > INBOX_PAGE_SIZE || (requested?.issueCount ?? 0) > INBOX_PAGE_SIZE
		},
		partial: result.partial
	};
}

function key(node: InboxNode): string {
	return `${node.repository?.nameWithOwner}#${node.number}`;
}

function inboxPull(node: InboxNode): InboxPull {
	const nameWithOwner = node.repository?.nameWithOwner ?? '';
	const [owner = '', name = ''] = nameWithOwner.split('/');

	return {
		repo: { owner, name },
		nameWithOwner,
		isPrivate: node.repository?.isPrivate ?? false,
		authored: false,
		requested: false,

		number: node.number ?? 0,
		title: node.title ?? '',
		// Everything here matched `is:open`, so the state is not a field we have to
		// ask for — a draft is an open pull request with a flag set.
		state: 'OPEN',
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

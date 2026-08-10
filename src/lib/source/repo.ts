import { document } from './document';
import { fail } from './errors';
import { query, type QueryOptions, type QueryResult } from './graphql';
import type { MergeMethod } from './rest';
import type { RepoRef } from './types';

/**
 * The repository query — PLAN.md Phase 1's proof that the executor works end
 * to end, and the header half of the Tree screen in Phase 3.
 *
 * Shaped to a screen rather than to the domain model: identity, HEAD, clone
 * URLs and the four sidebar counts arrive in one round trip. Phase 2 moves
 * this behind the `Source` seam; the document does not change when it does.
 */

interface HeadNode {
	oid?: string;
	abbreviatedOid?: string;
	messageHeadline?: string;
	committedDate?: string;
	author?: { name: string | null; user: { login: string } | null } | null;
	history?: { totalCount: number };
}

interface RepoNode {
	nameWithOwner: string;
	description: string | null;
	isPrivate: boolean;
	isArchived: boolean;
	url: string;
	sshUrl: string;
	diskUsage: number | null;
	defaultBranchRef: { name: string; target: HeadNode | null } | null;
	branches: { totalCount: number };
	tags: { totalCount: number };
	pullRequests: { totalCount: number };
	mergeCommitAllowed: boolean | null;
	squashMergeAllowed: boolean | null;
	rebaseMergeAllowed: boolean | null;
}

export const REPO = document<{ repository: RepoNode | null }, RepoRef>({
	name: 'Repo',
	variables: '$owner: String!, $name: String!',
	body: `
	repository(owner: $owner, name: $name) {
		nameWithOwner
		description
		isPrivate
		isArchived
		url
		sshUrl
		diskUsage
		defaultBranchRef {
			name
			target {
				... on Commit {
					oid
					abbreviatedOid
					messageHeadline
					committedDate
					author { name user { login } }
					history { totalCount }
				}
			}
		}
		branches: refs(refPrefix: "refs/heads/") { totalCount }
		tags: refs(refPrefix: "refs/tags/") { totalCount }
		pullRequests(states: OPEN) { totalCount }
		mergeCommitAllowed
		squashMergeAllowed
		rebaseMergeAllowed
	}`
});

export interface HeadCommit {
	oid: string;
	abbreviatedOid: string;
	messageHeadline: string;
	committedDate: string;
	authorName: string | null;
	authorLogin: string | null;
}

export interface RepoSummary {
	owner: string;
	name: string;
	nameWithOwner: string;
	description: string | null;
	isPrivate: boolean;
	isArchived: boolean;
	url: string;
	/** DESIGN.md §5's clone strip: read-only, then read/write. */
	cloneUrl: string;
	sshUrl: string;
	diskUsageKb: number | null;
	defaultBranch: string | null;
	head: HeadCommit | null;
	counts: { commits: number; branches: number; tags: number; openPullRequests: number };
	/**
	 * Which ways this repository will let a pull request land, in the order the
	 * Review screen offers them. A repository setting rather than a permission:
	 * an empty list means every method is switched off, which GitHub allows and
	 * which is worth saying out loud rather than discovering from a 405.
	 */
	mergeMethods: MergeMethod[];
}

export async function getRepo(
	ref: RepoRef,
	options: QueryOptions = {}
): Promise<QueryResult<RepoSummary>> {
	const result = await query(REPO, ref, options);
	if (!result.ok) return result;

	// A repository the token cannot see comes back as a null field beside a
	// NOT_FOUND error, not as a failed request. GitHub does not distinguish
	// missing from hidden, and neither can we.
	const node = result.data.repository;
	if (!node) {
		return {
			ok: false,
			error: fail(
				'not-found',
				`No repository ${ref.owner}/${ref.name} — or it is not visible to this token.`
			)
		};
	}

	return { ok: true, data: summarise(node), partial: result.partial };
}

function summarise(node: RepoNode): RepoSummary {
	const [owner = '', name = ''] = node.nameWithOwner.split('/');
	const head = node.defaultBranchRef?.target ?? null;

	return {
		owner,
		name,
		nameWithOwner: node.nameWithOwner,
		description: node.description,
		isPrivate: node.isPrivate,
		isArchived: node.isArchived,
		url: node.url,
		// GraphQL exposes no HTTPS clone field; it is the web URL with a suffix.
		cloneUrl: `${node.url}.git`,
		sshUrl: node.sshUrl,
		diskUsageKb: node.diskUsage,
		defaultBranch: node.defaultBranchRef?.name ?? null,
		head: head?.oid
			? {
					oid: head.oid,
					abbreviatedOid: head.abbreviatedOid ?? head.oid.slice(0, 7),
					messageHeadline: head.messageHeadline ?? '',
					committedDate: head.committedDate ?? '',
					authorName: head.author?.name ?? null,
					authorLogin: head.author?.user?.login ?? null
				}
			: null,
		counts: {
			commits: head?.history?.totalCount ?? 0,
			branches: node.branches.totalCount,
			tags: node.tags.totalCount,
			openPullRequests: node.pullRequests.totalCount
		},
		mergeMethods: methods(node)
	};
}

/**
 * A field GitHub returned empty — an old cache entry, or a partial response —
 * is read as allowed, so a missing answer offers the default rather than
 * hiding the button. GitHub is the one that decides; sending a method it
 * forbids costs a 405 with its own sentence in it.
 */
function methods(node: RepoNode): MergeMethod[] {
	const out: MergeMethod[] = [];
	if (node.mergeCommitAllowed !== false) out.push('merge');
	if (node.squashMergeAllowed !== false) out.push('squash');
	if (node.rebaseMergeAllowed !== false) out.push('rebase');
	return out;
}

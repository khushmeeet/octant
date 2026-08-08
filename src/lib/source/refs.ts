import { document } from './document';
import { fail } from './errors';
import { query, type QueryOptions, type QueryResult } from './graphql';
import type { PageOf } from './query';
import type { RepoRef } from './types';

/**
 * The refs query — PLAN.md Phase 6, and ARCHITECTURE.md §4's
 * `refs(refPrefix: "refs/heads/")` and `"refs/tags/"`, with `Tag.message` for
 * the changelog.
 *
 * **Branches and tags are the same object** (ARCHITECTURE.md §2), so they share
 * one document and differ only in the prefix they are asked for. What they do
 * not share is the question worth asking about them, and the document says so:
 * a branch gets `compare`, because "how far has this drifted from the default
 * branch" is what you want to know about one; a tag does not, because a tag
 * does not drift — the question there is what shipped in it, which is a
 * comparison with the *previous tag* and lives on `compare.ts`.
 *
 * `@include(if: $withCompare)` is what keeps that from costing tags anything.
 * GitHub computes a merge base per node it appears on, and asking for a hundred
 * of them on a list nobody will read the number from is exactly the kind of
 * fan-out ARCHITECTURE.md §7 rules out.
 */

export type RefKind = 'branch' | 'tag';

/** Git's own names for the two, which is what the API is addressed by. */
const PREFIX: Record<RefKind, string> = {
	branch: 'refs/heads/',
	tag: 'refs/tags/'
};

interface TipNode {
	oid: string;
	abbreviatedOid: string;
	messageHeadline: string;
	committedDate: string;
	author: { name: string | null; user: { login: string } | null } | null;
}

interface TargetNode extends Partial<TipNode> {
	__typename: string;
	/** Annotated tags only. */
	message?: string | null;
	tagger?: { name: string | null; date: string | null; user: { login: string } | null } | null;
	/** The commit an annotated tag points at. */
	target?: (Partial<TipNode> & { __typename: string }) | null;
}

interface RefNode {
	name: string;
	compare?: { aheadBy: number; behindBy: number } | null;
	target: TargetNode | null;
}

interface RefsNode {
	totalCount: number;
	pageInfo: { hasNextPage: boolean; endCursor: string | null };
	nodes: (RefNode | null)[] | null;
}

interface RefsVars extends RepoRef {
	prefix: string;
	first: number;
	after: string | null;
	/**
	 * The ref ahead/behind is measured against. Always sent because the variable
	 * is non-null, and ignored entirely when `withCompare` is false.
	 */
	base: string;
	withCompare: boolean;
}

const TIP = `
fragment tip on Commit {
	oid
	abbreviatedOid
	messageHeadline
	committedDate
	author { name user { login } }
}`;

export const REFS = document<{ repository: { refs: RefsNode | null } | null }, RefsVars>({
	name: 'Refs',
	variables:
		'$owner: String!, $name: String!, $prefix: String!, $first: Int!, $after: String, $base: String!, $withCompare: Boolean!',
	body: `
	repository(owner: $owner, name: $name) {
		refs(
			refPrefix: $prefix
			first: $first
			after: $after
			orderBy: { field: TAG_COMMIT_DATE, direction: DESC }
		) {
			totalCount
			pageInfo { hasNextPage endCursor }
			nodes {
				name
				compare(headRef: $base) @include(if: $withCompare) { aheadBy behindBy }
				target {
					__typename
					...tip
					... on Tag {
						message
						tagger { name date user { login } }
						target { __typename ...tip }
					}
				}
			}
		}
	}`,
	fragments: [TIP]
});

/** What an annotated tag carries that a lightweight one does not. */
export interface Annotation {
	message: string;
	taggerName: string | null;
	taggerLogin: string | null;
	/** When the tag was made, which is not when the commit was made. */
	date: string;
}

export interface RefEntry {
	kind: RefKind;
	/** Short name — `main`, `v1.2.0`. The prefix is never carried. */
	name: string;
	/** The commit it resolves to, peeled through an annotated tag. */
	oid: string;
	abbreviatedOid: string;
	/** The tip commit's first line. */
	headline: string;
	committedDate: string;
	authorName: string | null;
	authorLogin: string | null;
	/** `null` on a lightweight tag and on every branch. */
	annotation: Annotation | null;
	/** Commits this ref has that the base does not. `null` when not asked for. */
	ahead: number | null;
	/** Commits the base has that this ref does not. */
	behind: number | null;
}

export interface RefsPage extends PageOf<RefEntry> {
	items: RefEntry[];
	kind: RefKind;
}

/**
 * A hundred is GitHub's maximum page and it covers every branch list worth
 * scanning in one request. Tag lists run to thousands on old repositories,
 * which is what `pages()` is for.
 */
export const REFS_PAGE_SIZE = 100;

export async function getRefs(
	ref: RepoRef,
	kind: RefKind,
	base: string | null = null,
	after: string | null = null,
	options: QueryOptions = {}
): Promise<QueryResult<RefsPage>> {
	const result = await query(
		REFS,
		{
			...ref,
			prefix: PREFIX[kind],
			first: REFS_PAGE_SIZE,
			after,
			// Non-null in the schema, so it is always sent; `withCompare` is what
			// decides whether GitHub ever looks at it.
			base: base ?? 'HEAD',
			withCompare: base !== null
		},
		options
	);
	if (!result.ok) return result;

	const node = result.data.repository?.refs ?? null;
	if (!node) {
		return {
			ok: false,
			error: fail('not-found', `No ${ref.owner}/${ref.name} — or it is not visible to this token.`)
		};
	}

	return {
		ok: true,
		data: {
			items: (node.nodes ?? [])
				.filter((entry): entry is RefNode => entry !== null)
				.map((entry) => refEntry(entry, kind))
				.filter((entry): entry is RefEntry => entry !== null)
				.sort(byRecency),
			totalCount: node.totalCount ?? 0,
			endCursor: node.pageInfo.endCursor ?? null,
			hasNextPage: node.pageInfo.hasNextPage ?? false,
			kind
		},
		partial: result.partial
	};
}

/**
 * A ref whose target we cannot read is dropped rather than rendered as a row
 * with nothing in it. That happens for the two object kinds a ref can point at
 * and a person cannot browse — a tag of a tag, and a ref into a tree — and both
 * are rare enough that a missing row is a better answer than an empty one.
 */
function refEntry(node: RefNode, kind: RefKind): RefEntry | null {
	const target = node.target;
	if (!target) return null;

	const tip = target.__typename === 'Tag' ? target.target : target;
	if (!tip || tip.__typename !== 'Commit' || !tip.oid) return null;

	return {
		kind,
		name: node.name,
		oid: tip.oid,
		abbreviatedOid: tip.abbreviatedOid || tip.oid.slice(0, 7),
		headline: tip.messageHeadline ?? '',
		committedDate: tip.committedDate ?? '',
		authorName: tip.author?.name ?? null,
		authorLogin: tip.author?.user?.login ?? null,
		annotation:
			target.__typename === 'Tag'
				? {
						message: target.message ?? '',
						taggerName: target.tagger?.name ?? null,
						taggerLogin: target.tagger?.user?.login ?? null,
						date: target.tagger?.date ?? tip.committedDate ?? ''
					}
				: null,
		// **The inversion is deliberate and it is GitHub's, not ours.**
		// `Ref.compare(headRef:)` treats the ref it is called on as the *base*,
		// so `aheadBy` is how far the default branch has run ahead of this ref —
		// which is precisely how far this ref is behind. Reading the two fields
		// straight through would report every stale branch as a busy one.
		ahead: node.compare ? node.compare.behindBy : null,
		behind: node.compare ? node.compare.aheadBy : null
	};
}

/**
 * Newest first, which is the order both lists want: a branch list is a list of
 * what is in flight, and a tag list read newest-first is a changelog.
 *
 * The query asks for the same order, so this is normally confirming it rather
 * than imposing it — but `TAG_COMMIT_DATE` is documented against tags, and a
 * branch list that came back alphabetically would bury the branch you pushed an
 * hour ago. Sorting at the source keeps it out of the render path and means the
 * cached page is already in display order, the same call `getTree` makes about
 * directories. It orders within a page; across pages it still trusts GitHub,
 * which for tags is the field's documented behaviour.
 */
function byRecency(a: RefEntry, b: RefEntry): number {
	return b.committedDate.localeCompare(a.committedDate) || a.name.localeCompare(b.name);
}

/** How a ref names its author: the login if there is one, else the name. */
export function refAuthor(entry: RefEntry): string {
	return entry.authorLogin ?? entry.authorName ?? 'unknown';
}

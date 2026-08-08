/**
 * Resolving a revision to the commit it names — PLAN.md Phase 6's ref map,
 * arrived at from the other direction.
 *
 * Phases 3, 4 and 5 all hid the Permalink verb on any revision but the default
 * branch, because a permalink needs a commit SHA and the only one a screen held
 * came from the repository summary's HEAD. The obvious fix was a ref → SHA map
 * the screens could consult; the cheaper one is this, because **every screen
 * already asks GitHub to resolve its revision**. A tree query resolves
 * `main:src`, a file query resolves `main:src/app.ts` — so asking for the
 * commit `main` names in the same round trip costs one aliased field and no
 * extra request at all. A map would have been a second query, per screen, for
 * an answer the first query was already computing.
 *
 * The peel through `Tag` is the part worth being careful about. `object(
 * expression: "v1.2.0")` on an annotated tag answers with the *tag object*, not
 * the commit — its `oid` is a real SHA that is not a commit SHA, and a
 * permalink built from it would be a link to something that is not a revision.
 * So the commit is read from `Tag.target`, and anything else answers `null`,
 * which every caller already treats as "no permalink here".
 */

export interface RevisionNode {
	__typename: string;
	oid?: string;
	target?: { __typename?: string; oid?: string } | null;
}

/**
 * The aliased selection, for a document that already declares `$rev: String!`.
 * Written once so the two documents that carry it cannot drift apart.
 */
export const COMMIT_FIELD = `
		commit: object(expression: $rev) {
			__typename
			... on Commit { oid }
			... on Tag { target { __typename ... on Commit { oid } } }
		}`;

/** The commit a resolved revision names, peeling an annotated tag on the way. */
export function commitOid(node: RevisionNode | null | undefined): string | null {
	if (!node) return null;
	if (node.__typename === 'Commit') return node.oid ?? null;
	if (node.__typename === 'Tag' && node.target?.__typename === 'Commit') {
		return node.target.oid ?? null;
	}
	return null;
}

import { document } from './document';
import { query, type QueryOptions, type QueryResult } from './graphql';
import type { RepoRef } from './types';

/**
 * `CODEOWNERS` — PLAN.md Phase 8, and the source of "this concerns you".
 *
 * GitHub looks for the file in three places and takes the first it finds:
 * `.github/`, the repository root, then `docs/`. Finding it could have been
 * three round trips, or a listing of two directories we have no other reason to
 * read — so it is **one query with three aliased expressions**, which is the
 * same move `revision.ts` makes: GraphQL will resolve as many expressions as
 * you name in one document, and naming three costs one request.
 *
 * That matters more here than anywhere else, because ownership is consulted by
 * every screen. A read that fanned out would be a fan-out on all of them.
 *
 * The file is returned as text. Parsing it is `visits/owners.ts`'s business —
 * ARCHITECTURE.md §9 puts ownership in `visits/`, and a source that understood
 * `CODEOWNERS` semantics would be a source that knows what the UI means by
 * "yours".
 */

interface OwnersBlob {
	__typename?: string;
	text?: string | null;
	isTruncated?: boolean;
}

interface OwnersVars extends RepoRef {
	github: string;
	root: string;
	docs: string;
}

interface OwnersData {
	repository: {
		github: OwnersBlob | null;
		root: OwnersBlob | null;
		docs: OwnersBlob | null;
	} | null;
}

const BLOB = `{
			__typename
			... on Blob { text isTruncated }
		}`;

export const OWNERS = document<OwnersData, OwnersVars>({
	name: 'Owners',
	variables: '$owner: String!, $name: String!, $github: String!, $root: String!, $docs: String!',
	body: `
	repository(owner: $owner, name: $name) {
		github: object(expression: $github) ${BLOB}
		root: object(expression: $root) ${BLOB}
		docs: object(expression: $docs) ${BLOB}
	}`
});

/** GitHub's own order of precedence. The first one found is the one in force. */
export const OWNERS_PATHS = ['.github/CODEOWNERS', 'CODEOWNERS', 'docs/CODEOWNERS'] as const;

export interface OwnersFile {
	/** Where it was found, or `null` when the repository has none. */
	path: string | null;
	text: string | null;
	/** GitHub sent a prefix. Rules past the cut are simply not known. */
	isTruncated: boolean;
}

export async function getOwners(
	ref: RepoRef,
	rev: string,
	options: QueryOptions = {}
): Promise<QueryResult<OwnersFile>> {
	const [github, root, docs] = OWNERS_PATHS;
	const result = await query(
		OWNERS,
		{
			...ref,
			github: `${rev}:${github}`,
			root: `${rev}:${root}`,
			docs: `${rev}:${docs}`
		},
		options
	);
	if (!result.ok) return result;

	const node = result.data.repository;
	const found: Array<[string, OwnersBlob | null]> = [
		[github, node?.github ?? null],
		[root, node?.root ?? null],
		[docs, node?.docs ?? null]
	];

	for (const [path, blob] of found) {
		// A repository without the file answers `null` for all three, which is
		// data rather than an error: most repositories have no CODEOWNERS, and a
		// screen that treated the common case as a failure would be shouting.
		if (!blob || blob.__typename !== 'Blob' || typeof blob.text !== 'string') continue;
		return {
			ok: true,
			data: { path, text: blob.text, isTruncated: blob.isTruncated ?? false },
			partial: result.partial
		};
	}

	return {
		ok: true,
		data: { path: null, text: null, isTruncated: false },
		partial: result.partial
	};
}

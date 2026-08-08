import { document } from './document';
import { fail } from './errors';
import { query, type QueryOptions, type QueryResult } from './graphql';
import type { RepoRef } from './types';

/**
 * The tree query — PLAN.md Phase 2, and the listing half of the Tree screen in
 * Phase 3.
 *
 * Mode and size, and no per-file last-commit column: that column costs a blame
 * walk per entry and is rarely acted on (ARCHITECTURE.md §2). This is one round
 * trip for a directory, and at a commit SHA the answer is permanent.
 */

interface EntryNode {
	name: string;
	path: string;
	type: string;
	/** Git's mode as an integer — 33188, not "100644". */
	mode: number;
	oid: string;
	object: { byteSize?: number; isBinary?: boolean | null } | null;
}

interface ObjectNode {
	__typename: string;
	oid?: string;
	entries?: EntryNode[] | null;
}

interface TreeVars extends RepoRef {
	/** `rev:path` — `main:src/lib`. An empty path is the root: `main:`. */
	expression: string;
}

export const TREE = document<{ repository: { object: ObjectNode | null } | null }, TreeVars>({
	name: 'Tree',
	variables: '$owner: String!, $name: String!, $expression: String!',
	body: `
	repository(owner: $owner, name: $name) {
		object(expression: $expression) {
			__typename
			... on Tree {
				oid
				entries {
					name
					path
					type
					mode
					oid
					object {
						... on Blob { byteSize isBinary }
					}
				}
			}
		}
	}`
});

export type EntryType = 'blob' | 'tree' | 'commit';

export interface TreeEntry {
	name: string;
	/** Repo-relative, as git records it. */
	path: string;
	/** `commit` is a submodule. */
	type: EntryType;
	/** Octal, as git writes it: `100644`, `100755`, `120000`, `040000`, `160000`. */
	mode: string;
	oid: string;
	/** Blobs only. */
	byteSize: number | null;
	isBinary: boolean | null;
}

export interface TreeListing {
	/** The tree's own SHA. What makes a listing addressable and permanent. */
	oid: string;
	/** Repo-relative directory, `''` at the root. */
	path: string;
	entries: TreeEntry[];
}

export async function getTree(
	ref: RepoRef,
	rev: string,
	path = '',
	options: QueryOptions = {}
): Promise<QueryResult<TreeListing>> {
	const clean = path.replace(/^\/+|\/+$/g, '');
	const result = await query(TREE, { ...ref, expression: `${rev}:${clean}` }, options);
	if (!result.ok) return result;

	const node = result.data.repository?.object ?? null;
	const where = `${clean || '/'} at ${rev}`;

	if (!node) {
		return {
			ok: false,
			error: fail('not-found', `No ${where} — or it is not visible to this token.`)
		};
	}

	// The expression resolved, but to a file. Worth saying plainly: Phase 3 sends
	// this to the file screen rather than showing an error at all.
	if (node.__typename !== 'Tree') {
		return {
			ok: false,
			error: fail('not-found', `${where} is a ${node.__typename.toLowerCase()}, not a directory.`)
		};
	}

	return {
		ok: true,
		data: {
			oid: node.oid ?? '',
			path: clean,
			entries: (node.entries ?? []).map(entry).sort(byKind)
		},
		partial: result.partial
	};
}

function entry(node: EntryNode): TreeEntry {
	return {
		name: node.name,
		path: node.path,
		type: (node.type === 'tree' || node.type === 'commit' ? node.type : 'blob') as EntryType,
		// Git writes a tree as 040000; the API sends 16384. Pad so the column
		// reads as the six digits every other git tool shows.
		mode: node.mode.toString(8).padStart(6, '0'),
		oid: node.oid,
		byteSize: node.object?.byteSize ?? null,
		isBinary: node.object?.isBinary ?? null
	};
}

/**
 * Git stores tree entries in byte order, interleaving directories and files.
 * Every tool that shows a tree to a person groups directories first, because
 * the two are navigated differently. Sorting here rather than in the screen
 * keeps it out of the render path and means the cached listing is already in
 * display order.
 */
function byKind(a: TreeEntry, b: TreeEntry): number {
	const rank = (e: TreeEntry) => (e.type === 'blob' ? 1 : 0);
	return rank(a) - rank(b) || a.name.localeCompare(b.name);
}

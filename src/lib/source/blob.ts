import { document } from './document';
import { fail, type SourceError } from './errors';
import { query, type QueryOptions, type QueryResult } from './graphql';
import type { RepoRef } from './types';

/**
 * Blob contents, under both of the addresses a file has — PLAN.md Phase 3's
 * README and Phase 4's file screen.
 *
 * **By object ID** (`getBlob`) the answer is permanent: a README that did not
 * change between two commits is one entry, fetched once, and never fetched
 * again on any branch, at any revision, forever. That is the cache insight at
 * its sharpest, and it is available to any caller that already holds a tree
 * listing, because a listing carries every entry's `oid`.
 *
 * **By `rev:path`** (`getFile`) it is one round trip from a URL alone, which is
 * what a deep link into a file is. Resolving the path to an object ID first
 * would be permanent but it would also be a waterfall on the screen the tool
 * exists for, and ARCHITECTURE.md §4 does not allow one. On a commit SHA the
 * key is immutable anyway, so a permalink pays the same price as an oid.
 */

interface BlobNode {
	__typename: string;
	oid?: string;
	byteSize?: number;
	isBinary?: boolean | null;
	isTruncated?: boolean;
	text?: string | null;
}

const BLOB_FIELDS = `
			__typename
			... on Blob {
				oid
				byteSize
				isBinary
				isTruncated
				text
			}`;

interface BlobVars extends RepoRef {
	oid: string;
}

export const BLOB = document<{ repository: { object: BlobNode | null } | null }, BlobVars>({
	name: 'Blob',
	variables: '$owner: String!, $name: String!, $oid: GitObjectID!',
	body: `
	repository(owner: $owner, name: $name) {
		object(oid: $oid) {${BLOB_FIELDS}
		}
	}`
});

interface FileVars extends RepoRef {
	/** `rev:path` — `main:src/lib/app.ts`. */
	expression: string;
}

export const FILE = document<{ repository: { object: BlobNode | null } | null }, FileVars>({
	name: 'File',
	variables: '$owner: String!, $name: String!, $expression: String!',
	body: `
	repository(owner: $owner, name: $name) {
		object(expression: $expression) {${BLOB_FIELDS}
		}
	}`
});

export interface BlobContent {
	oid: string;
	byteSize: number;
	/**
	 * `null` for a binary blob, and for one GitHub declined to send. Both are
	 * fallbacks rather than errors — ARCHITECTURE.md §11 — so they arrive as
	 * data a screen can render honestly, not as a failed read.
	 */
	text: string | null;
	isBinary: boolean;
	/** GitHub sent a prefix, not the file. */
	isTruncated: boolean;
}

/** A blob that knows where it lives, which is what a file screen addresses. */
export interface FileContent extends BlobContent {
	path: string;
}

export async function getBlob(
	ref: RepoRef,
	oid: string,
	options: QueryOptions = {}
): Promise<QueryResult<BlobContent>> {
	const result = await query(BLOB, { ...ref, oid }, options);
	if (!result.ok) return result;

	const content = read(result.data.repository?.object ?? null, oid.slice(0, 7));
	if (!content.ok) return content;

	return { ok: true, data: content.data, partial: result.partial };
}

export async function getFile(
	ref: RepoRef,
	rev: string,
	path: string,
	options: QueryOptions = {}
): Promise<QueryResult<FileContent>> {
	const clean = path.replace(/^\/+|\/+$/g, '');
	const result = await query(FILE, { ...ref, expression: `${rev}:${clean}` }, options);
	if (!result.ok) return result;

	const content = read(result.data.repository?.object ?? null, `${clean} at ${rev}`);
	if (!content.ok) return content;

	return { ok: true, data: { ...content.data, path: clean }, partial: result.partial };
}

/**
 * Both addresses resolve to the same node, so they read it the same way — and
 * both report the same thing when they land on a tree instead. `objectType` is
 * what lets the file screen send the reader to the tree screen rather than
 * show them an error about an address that was perfectly good.
 */
function read(
	node: BlobNode | null,
	where: string
): { ok: true; data: BlobContent } | { ok: false; error: SourceError } {
	if (!node) {
		return {
			ok: false,
			error: fail('not-found', `No ${where} — or it is not visible to this token.`)
		};
	}

	if (node.__typename !== 'Blob') {
		return {
			ok: false,
			error: fail('not-found', `${where} is a ${node.__typename.toLowerCase()}, not a file.`, {
				objectType: node.__typename
			})
		};
	}

	return {
		ok: true,
		data: {
			oid: node.oid ?? '',
			byteSize: node.byteSize ?? 0,
			// A binary blob answers `text: null`. So does one past the API's cap,
			// which is why `isTruncated` is carried separately rather than inferred.
			text: node.text ?? null,
			isBinary: node.isBinary ?? false,
			isTruncated: node.isTruncated ?? false
		}
	};
}

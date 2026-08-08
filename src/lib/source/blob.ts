import { document } from './document';
import { fail } from './errors';
import { query, type QueryOptions, type QueryResult } from './graphql';
import type { RepoRef } from './types';

/**
 * The blob query — PLAN.md Phase 3's README, and the content half of the File
 * screen in Phase 4.
 *
 * Addressed by the blob's *own* object ID rather than by `rev:path`, which the
 * tree listing already hands us. That is the cache insight at its sharpest: a
 * README that did not change between two commits is one entry, fetched once,
 * and never fetched again on any branch, at any revision, forever.
 */

interface BlobNode {
	__typename: string;
	oid?: string;
	byteSize?: number;
	isBinary?: boolean | null;
	isTruncated?: boolean;
	text?: string | null;
}

interface BlobVars extends RepoRef {
	oid: string;
}

export const BLOB = document<{ repository: { object: BlobNode | null } | null }, BlobVars>({
	name: 'Blob',
	variables: '$owner: String!, $name: String!, $oid: GitObjectID!',
	body: `
	repository(owner: $owner, name: $name) {
		object(oid: $oid) {
			__typename
			... on Blob {
				oid
				byteSize
				isBinary
				isTruncated
				text
			}
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

export async function getBlob(
	ref: RepoRef,
	oid: string,
	options: QueryOptions = {}
): Promise<QueryResult<BlobContent>> {
	const result = await query(BLOB, { ...ref, oid }, options);
	if (!result.ok) return result;

	const node = result.data.repository?.object ?? null;
	if (!node) {
		return {
			ok: false,
			error: fail('not-found', `No object ${oid.slice(0, 7)} — or it is not visible to this token.`)
		};
	}

	if (node.__typename !== 'Blob') {
		return {
			ok: false,
			error: fail(
				'not-found',
				`${oid.slice(0, 7)} is a ${node.__typename.toLowerCase()}, not a file.`
			)
		};
	}

	return {
		ok: true,
		data: {
			oid: node.oid ?? oid,
			byteSize: node.byteSize ?? 0,
			// A binary blob answers `text: null`. So does one past the API's cap,
			// which is why `isTruncated` is carried separately rather than inferred.
			text: node.text ?? null,
			isBinary: node.isBinary ?? false,
			isTruncated: node.isTruncated ?? false
		},
		partial: result.partial
	};
}

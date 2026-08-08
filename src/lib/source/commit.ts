import { fromRest, type Fetched, type FetchOptions } from './query';
import { commitDetail, COMMIT_FILE_CAP, type CommitResponse, type DiffFile } from './rest';
import type { RepoRef } from './types';

/**
 * One commit, with its patches — PLAN.md Phase 5.
 *
 * The first read in the app that goes over REST rather than GraphQL, because
 * GraphQL has no patch field: ARCHITECTURE.md §4 puts diffs on the compare and
 * files endpoints, and a single commit is the smallest of those. It is also
 * the first use of `fromRest` and the mutable ETag path, both of which Phase 1
 * built and nothing had needed until now.
 *
 * The same read serves two callers, which is the point of it being one query.
 * The log's detail pane wants the file list for the commit under the cursor,
 * and the commit screen wants the file list *and* every patch in it — so
 * selecting a row in the log pays for the screen that `enter` opens, and by the
 * time you press it the answer is already on disk.
 */

export type ChangeStatus = DiffFile['status'];

export interface ChangedFile {
	path: string;
	/** Where it was before a rename, else `null`. */
	previousPath: string | null;
	status: ChangeStatus;
	additions: number;
	deletions: number;
	/**
	 * The unified patch, or `null` when GitHub declined to inline one — a binary
	 * blob, or a file whose diff is too large. The screen says which; it never
	 * renders an empty diff as if nothing changed.
	 */
	patch: string | null;
}

export interface CommitDetail {
	oid: string;
	abbreviatedOid: string;
	/** The first line of the message. */
	headline: string;
	/** Everything after it, blank lines and all. */
	body: string;
	authorName: string | null;
	authorEmail: string | null;
	authorLogin: string | null;
	committedDate: string;
	parents: string[];
	additions: number;
	deletions: number;
	files: ChangedFile[];
	/**
	 * GitHub sent part of the file list. ARCHITECTURE.md §11 asks for truncation
	 * to be detected and disclosed rather than discovered, so it is carried here
	 * rather than inferred by whoever renders it.
	 */
	truncated: boolean;
}

export async function getCommit(
	ref: RepoRef,
	rev: string,
	options: FetchOptions = {}
): Promise<Fetched<CommitDetail>> {
	const result = await commitDetail(ref, rev, { signal: options.signal, etag: options.etag });
	return fromRest(result, detail);
}

function detail(node: CommitResponse): CommitDetail {
	const message = node.commit.message ?? '';
	const split = message.indexOf('\n');
	const files = (node.files ?? []).map(changed);

	return {
		oid: node.sha,
		abbreviatedOid: node.sha.slice(0, 7),
		headline: split === -1 ? message : message.slice(0, split),
		body: split === -1 ? '' : message.slice(split + 1).replace(/^\n+/, ''),
		authorName: node.commit.author?.name ?? null,
		authorEmail: node.commit.author?.email ?? null,
		authorLogin: node.author?.login ?? null,
		committedDate: node.commit.author?.date ?? node.commit.committer?.date ?? '',
		parents: (node.parents ?? []).map((parent) => parent.sha),
		// `stats` is absent on a commit too large for GitHub to total, so the
		// files are summed instead rather than reporting a change of zero.
		additions: node.stats?.additions ?? sum(files, 'additions'),
		deletions: node.stats?.deletions ?? sum(files, 'deletions'),
		files,
		truncated: files.length >= COMMIT_FILE_CAP
	};
}

/**
 * Exported because the compare endpoint sends the identical per-file shape —
 * Phase 6 is the second caller, and a second mapping would be a second place
 * for a rename to stop being reported.
 */
export function changed(file: DiffFile): ChangedFile {
	return {
		path: file.filename,
		previousPath: file.previous_filename ?? null,
		status: file.status,
		additions: file.additions ?? 0,
		deletions: file.deletions ?? 0,
		patch: file.patch ?? null
	};
}

function sum(files: ChangedFile[], key: 'additions' | 'deletions'): number {
	let total = 0;
	for (const file of files) total += file[key];
	return total;
}

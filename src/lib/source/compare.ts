import { changed, type ChangedFile } from './commit';
import { fromRest, type Fetched, type FetchOptions } from './query';
import { compare, comparisonTruncated, type Comparison, type CompareCommit } from './rest';
import type { RepoRef } from './types';

/**
 * `base...head` — PLAN.md Phase 6's Compare and "Log since previous".
 *
 * The endpoint has been sitting in `rest.ts` unused since Phase 1, which built
 * it early on purpose: ARCHITECTURE.md §11 lists patch truncation as a known
 * limit and the risk register asks for it to be discovered before Phase 7
 * depends on it. This is the phase that gives it a caller, and it is the same
 * read ARCHITECTURE.md §3 names as the thing that powers "since your last
 * review" without us storing a single blob — so Phase 7 inherits it working.
 *
 * One read answers two questions that look different and are not: **what
 * shipped in this release** is the commits between two tags, and **what is on
 * this branch** is the commits between the default branch and its tip. Both are
 * `base...head`; only the two endpoints differ.
 *
 * Addressed by commit SHA it is permanent, which is what makes a tag's
 * changelog something we compute once ever. The Refs screen always has both
 * SHAs — it just finished resolving every ref to one — so it always addresses
 * it that way, and the key scheme does the rest.
 */

export interface CompareCommitInfo {
	oid: string;
	abbreviatedOid: string;
	/** The first line. What a shortlog prints. */
	headline: string;
	authorName: string | null;
	authorLogin: string | null;
	committedDate: string;
}

export interface CompareResult {
	/** As asked for — a SHA or a name, whichever the caller addressed. */
	base: string;
	head: string;
	/** GitHub's own word for the relationship between the two. */
	status: Comparison['status'];
	/** Commits `head` has that `base` does not. */
	aheadBy: number;
	behindBy: number;
	/** Across the whole range, which is not always what `commits` holds. */
	totalCommits: number;
	/** Where the two last agreed. */
	mergeBaseOid: string;
	/** Oldest first, as GitHub sends them and as a shortlog reads. */
	commits: CompareCommitInfo[];
	files: ChangedFile[];
	additions: number;
	deletions: number;
	/**
	 * GitHub capped the commit list, the file list, or both — ARCHITECTURE.md
	 * §11 asks for this to be disclosed rather than discovered, so it is carried
	 * here rather than inferred by whoever renders it.
	 */
	truncated: boolean;
}

export async function getCompare(
	ref: RepoRef,
	base: string,
	head: string,
	options: FetchOptions = {}
): Promise<Fetched<CompareResult>> {
	const result = await compare(ref, base, head, {
		signal: options.signal,
		etag: options.etag
	});
	return fromRest(result, (data) => summarise(data, base, head));
}

function summarise(node: Comparison, base: string, head: string): CompareResult {
	const files = (node.files ?? []).map(changed);

	return {
		base,
		head,
		status: node.status,
		aheadBy: node.ahead_by ?? 0,
		behindBy: node.behind_by ?? 0,
		totalCommits: node.total_commits ?? node.commits.length,
		mergeBaseOid: node.merge_base_commit?.sha ?? '',
		commits: (node.commits ?? []).map(commitInfo),
		files,
		additions: sum(files, 'additions'),
		deletions: sum(files, 'deletions'),
		truncated: comparisonTruncated(node)
	};
}

function commitInfo(node: CompareCommit): CompareCommitInfo {
	const message = node.commit.message ?? '';
	const split = message.indexOf('\n');

	return {
		oid: node.sha,
		abbreviatedOid: node.sha.slice(0, 7),
		headline: split === -1 ? message : message.slice(0, split),
		authorName: node.commit.author?.name ?? null,
		authorLogin: node.author?.login ?? null,
		committedDate: node.commit.author?.date ?? ''
	};
}

function sum(files: ChangedFile[], key: 'additions' | 'deletions'): number {
	let total = 0;
	for (const file of files) total += file[key];
	return total;
}

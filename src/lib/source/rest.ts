import { rate } from '$lib/sync/rate.svelte';
import { fail, fromThrown, httpError, type SourceError } from './errors';
import {
	DEFAULT_TIMEOUT_MS,
	GITHUB_REST,
	GITHUB_API_VERSION,
	hasNext,
	rateFromHeaders,
	readMessage,
	withTimeout
} from './http';
import { share, stableKey } from './inflight';
import { currentToken, tokenTag } from './token';
import type { RepoRef } from './types';

/**
 * REST reads — PLAN.md Phase 1.
 *
 * GraphQL cannot diff, so compare and the pull-request files endpoint stay on
 * REST. Every call carries `If-None-Match` when the caller has an ETag: a 304
 * does not count against the quota, which is what makes background refresh
 * nearly free (ARCHITECTURE.md §7).
 *
 * The helper is deliberately stateless about caching — it takes an ETag and
 * returns one. Where they are kept is the `Store`'s business, in Phase 2.
 */

export interface RestOptions {
	/** Sent as `If-None-Match`. */
	etag?: string | null;
	signal?: AbortSignal;
	token?: string;
	fresh?: boolean;
	timeoutMs?: number;
	accept?: string;
}

export type RestResult<T> =
	| {
			ok: true;
			modified: true;
			status: number;
			data: T;
			etag: string | null;
			/** `Link: rel="next"` — there is another page. */
			hasNextPage: boolean;
	  }
	| { ok: true; modified: false; status: 304; data: null; etag: string | null; hasNextPage: false }
	| { ok: false; error: SourceError };

export async function restGet<T>(path: string, options: RestOptions = {}): Promise<RestResult<T>> {
	const token = options.token ?? currentToken();
	if (!token) {
		return { ok: false, error: fail('unauthorized', 'No token. Connect one to read GitHub.') };
	}

	const etag = options.etag ?? null;
	const accept = options.accept ?? 'application/vnd.github+json';
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const run = (signal: AbortSignal | undefined) =>
		execute<T>(path, token, etag, accept, signal, timeoutMs);

	try {
		if (options.fresh) return await run(options.signal);
		// The ETag belongs in the key: a caller without one must not be handed
		// another caller's 304.
		return await share(
			stableKey(`GET ${path}#${tokenTag(token)}`, { etag, accept }),
			options.signal,
			run
		);
	} catch (cause) {
		return { ok: false, error: fromThrown(cause) };
	}
}

async function execute<T>(
	path: string,
	token: string,
	etag: string | null,
	accept: string,
	signal: AbortSignal | undefined,
	timeoutMs: number
): Promise<RestResult<T>> {
	const headers: Record<string, string> = {
		Authorization: `Bearer ${token}`,
		Accept: accept,
		'X-GitHub-Api-Version': GITHUB_API_VERSION
	};
	if (etag) headers['If-None-Match'] = etag;

	let response: Response;
	try {
		response = await fetch(`${GITHUB_REST}${path}`, {
			headers,
			signal: withTimeout(signal, timeoutMs)
		});
	} catch (cause) {
		return { ok: false, error: fromThrown(cause) };
	}

	const reading = rateFromHeaders(response.headers);
	if (reading) rate.record('rest', reading);

	if (response.status === 304) {
		return {
			ok: true,
			modified: false,
			status: 304,
			data: null,
			etag: response.headers.get('etag') ?? etag,
			hasNextPage: false
		};
	}

	if (!response.ok) {
		return { ok: false, error: httpError(response, await readMessage(response)) };
	}

	let data: T;
	try {
		data = (await response.json()) as T;
	} catch {
		return {
			ok: false,
			error: fail('server', 'GitHub returned a response we could not read.', {
				status: response.status
			})
		};
	}

	return {
		ok: true,
		modified: true,
		status: response.status,
		data,
		etag: response.headers.get('etag'),
		hasNextPage: hasNext(response.headers.get('link'))
	};
}

/* ---------------------------------------------------------------- diffs -- */

/** As GitHub sends it. Mapping into our own shape is the diff screen's job. */
export interface DiffFile {
	filename: string;
	previous_filename?: string;
	status: 'added' | 'removed' | 'modified' | 'renamed' | 'copied' | 'changed' | 'unchanged';
	additions: number;
	deletions: number;
	changes: number;
	sha: string;
	/** Absent when the blob is binary, or the patch was too large to inline. */
	patch?: string;
}

export interface CompareCommit {
	sha: string;
	commit: {
		message: string;
		author: { name: string; email: string; date: string } | null;
	};
	author: { login: string } | null;
}

export interface Comparison {
	status: 'diverged' | 'ahead' | 'behind' | 'identical';
	ahead_by: number;
	behind_by: number;
	total_commits: number;
	base_commit: CompareCommit;
	merge_base_commit: CompareCommit;
	commits: CompareCommit[];
	files?: DiffFile[];
}

/** One commit, with the per-file patches GraphQL has no field for. */
export interface CommitResponse {
	sha: string;
	commit: {
		message: string;
		author: { name: string; email: string; date: string } | null;
		committer: { name: string; email: string; date: string } | null;
	};
	author: { login: string } | null;
	parents: { sha: string }[];
	stats?: { additions: number; deletions: number; total: number };
	files?: DiffFile[];
}

/** GitHub caps the compare response here — ARCHITECTURE.md §11. */
export const COMPARE_FILE_CAP = 300;

/** And a single commit's file list here, for the same reason. */
export const COMMIT_FILE_CAP = 300;

/**
 * A pull request's file list is paged rather than capped at 300 — but GitHub
 * stops at 3,000 files however many pages you ask for, so a diff that reaches
 * the ceiling is truncated and has to say so (ARCHITECTURE.md §11).
 */
export const PULL_FILES_CAP = 3_000;

/** GitHub's maximum page. Fewer pages is fewer round trips on a large review. */
export const PULL_FILES_PAGE = 100;

/**
 * One commit and everything it touched — PLAN.md Phase 5's diff.
 *
 * GraphQL has no patch field at all, so this is REST's, and it is the only way
 * to see what a commit actually did without cloning. The ref may be a SHA or a
 * name; a SHA is what the log links to, and what makes the answer permanent.
 */
export function commitDetail(
	repo: RepoRef,
	rev: string,
	options: RestOptions = {}
): Promise<RestResult<CommitResponse>> {
	return restGet<CommitResponse>(
		`/repos/${encodeRef(repo.owner)}/${encodeRef(repo.name)}/commits/${encodeRef(rev)}`,
		options
	);
}

/**
 * `base...head` for any two SHAs or refs. This is what powers "since your
 * last review" without us storing a single blob (ARCHITECTURE.md §3).
 */
export function compare(
	repo: RepoRef,
	base: string,
	head: string,
	options: RestOptions = {}
): Promise<RestResult<Comparison>> {
	const range = `${encodeRef(base)}...${encodeRef(head)}`;
	return restGet<Comparison>(
		`/repos/${encodeRef(repo.owner)}/${encodeRef(repo.name)}/compare/${range}`,
		options
	);
}

/* ---------------------------------------------------------------- trees -- */

/** One entry of a recursive tree read, as GitHub sends it. */
export interface GitTreeEntry {
	path: string;
	mode: string;
	/** `commit` is a submodule — a pointer into another repository. */
	type: 'blob' | 'tree' | 'commit';
	sha: string;
	size?: number;
}

export interface GitTree {
	sha: string;
	tree: GitTreeEntry[] | null;
	/** GitHub stopped short: past 100,000 entries, or 7 MB of them. */
	truncated: boolean;
}

/**
 * **Every path in the repository, in one request** — the palette's file index.
 *
 * REST rather than GraphQL because GraphQL has no recursive tree: asking it the
 * same question is a query per directory, which is precisely the fan-out
 * ARCHITECTURE.md §7 rules out. This is the opposite shape — one bounded request
 * whose size is the repository's, and which GitHub itself caps and flags with
 * `truncated` rather than silently shortening.
 *
 * The `rev` may be a commit SHA, a branch or a tag; git resolves any of them to
 * a root tree. A SHA is what makes the answer permanent, so the palette resolves
 * one before asking wherever it can.
 */
export function gitTree(
	repo: RepoRef,
	rev: string,
	options: RestOptions = {}
): Promise<RestResult<GitTree>> {
	const path = `/repos/${encodeRef(repo.owner)}/${encodeRef(repo.name)}/git/trees/${encodeRef(rev)}?recursive=1`;
	return restGet<GitTree>(path, options);
}

/** Per-file patches for a pull request. Paginated; 100 is the maximum page. */
export function pullFiles(
	repo: RepoRef,
	number: number,
	options: RestOptions & { page?: number; perPage?: number } = {}
): Promise<RestResult<DiffFile[]>> {
	const { page = 1, perPage = 100, ...rest } = options;
	const path = `/repos/${encodeRef(repo.owner)}/${encodeRef(repo.name)}/pulls/${number}/files?per_page=${perPage}&page=${page}`;
	return restGet<DiffFile[]>(path, rest);
}

/* ---------------------------------------------------------------- write -- */

/**
 * The one write in the client, and it is deliberately its own path rather than
 * a flag on `restGet`.
 *
 * A read may be shared with an identical read in flight, replayed from a 304,
 * or filed in the cache; every one of those is wrong for a write. So this
 * skips `share()` — two clicks must not become one silently — carries no ETag,
 * and hands nothing to the store. What it shares with the read path is the
 * transport: the same headers, the same deadline, the same rate meter and the
 * same error taxonomy, so a merge fails in the shape every screen already
 * knows how to render.
 */
export type WriteResult<T> = { ok: true; data: T } | { ok: false; error: SourceError };

export interface WriteOptions {
	signal?: AbortSignal;
	token?: string;
	timeoutMs?: number;
}

/** What GitHub answers a merge with. `merged` is false only alongside a reason. */
export interface MergeResponse {
	sha: string;
	merged: boolean;
	message: string;
}

/**
 * How the commit is built. A repository may forbid any of the three, which is
 * why the summary reads which are allowed rather than the screen assuming.
 */
export type MergeMethod = 'merge' | 'squash' | 'rebase';

export interface MergeRequest {
	method: MergeMethod;
	/**
	 * The head the merge is *for*. GitHub refuses with a 409 when the branch has
	 * moved past it, which is the whole reason it is sent: what gets merged is
	 * what was read, or nothing.
	 */
	headOid: string;
}

/** `PUT /pulls/{n}/merge` — ARCHITECTURE.md §1's one exception to read-only. */
export async function mergePull(
	repo: RepoRef,
	number: number,
	request: MergeRequest,
	options: WriteOptions = {}
): Promise<WriteResult<MergeResponse>> {
	const token = options.token ?? currentToken();
	if (!token) {
		return { ok: false, error: fail('unauthorized', 'No token. Connect one to merge.') };
	}

	const path = `/repos/${encodeRef(repo.owner)}/${encodeRef(repo.name)}/pulls/${number}/merge`;
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

	let response: Response;
	try {
		response = await fetch(`${GITHUB_REST}${path}`, {
			method: 'PUT',
			headers: {
				Authorization: `Bearer ${token}`,
				Accept: 'application/vnd.github+json',
				'Content-Type': 'application/json',
				'X-GitHub-Api-Version': GITHUB_API_VERSION
			},
			body: JSON.stringify({ merge_method: request.method, sha: request.headOid }),
			signal: withTimeout(options.signal, timeoutMs)
		});
	} catch (cause) {
		return { ok: false, error: fromThrown(cause) };
	}

	const reading = rateFromHeaders(response.headers);
	if (reading) rate.record('rest', reading);

	if (!response.ok) {
		return { ok: false, error: httpError(response, await readMessage(response)) };
	}

	let data: MergeResponse;
	try {
		data = (await response.json()) as MergeResponse;
	} catch {
		// The merge may well have happened. Saying so honestly is the only
		// answer available, and the screen re-reads the pull request either way.
		return {
			ok: false,
			error: fail('server', 'GitHub answered the merge with something we could not read.', {
				status: response.status
			})
		};
	}

	if (!data.merged) {
		return { ok: false, error: fail('invalid', data.message || 'GitHub did not merge it.') };
	}

	return { ok: true, data };
}

/**
 * Truncation is silent in the payload — a capped file list and a commit list
 * shorter than the count it reports. Detect it so the screen can say so and
 * link out, rather than quietly showing half a diff.
 */
export function comparisonTruncated(comparison: Comparison): boolean {
	return (
		(comparison.files?.length ?? 0) >= COMPARE_FILE_CAP ||
		comparison.commits.length < comparison.total_commits
	);
}

/** Refs may contain slashes (`feature/x`), which must survive as path separators. */
function encodeRef(ref: string): string {
	return encodeURIComponent(ref).replace(/%2F/g, '/');
}

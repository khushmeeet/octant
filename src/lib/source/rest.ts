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

/** GitHub caps the compare response here — ARCHITECTURE.md §11. */
export const COMPARE_FILE_CAP = 300;

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

import type { RateReading } from '$lib/sync/rate.svelte';

/** Transport bits shared by the GraphQL and REST paths. */

export const GITHUB_GRAPHQL = 'https://api.github.com/graphql';
export const GITHUB_REST = 'https://api.github.com';

/** Pinned, so a REST response shape changes when we say it does. */
export const GITHUB_API_VERSION = '2022-11-28';

/** A request that has not answered by now is not going to help the render. */
export const DEFAULT_TIMEOUT_MS = 20_000;

/**
 * Compose the caller's cancellation with our own deadline. A timeout aborts
 * with a `TimeoutError`, which the taxonomy separates from a cancellation so
 * one is reported and the other is not.
 */
export function withTimeout(
	signal: AbortSignal | undefined,
	timeoutMs: number
): AbortSignal | undefined {
	if (!(timeoutMs > 0)) return signal;

	const deadline = AbortSignal.timeout(timeoutMs);
	return signal ? AbortSignal.any([signal, deadline]) : deadline;
}

/** GitHub's error bodies are `{ "message": "…" }`. Reads a clone, so the caller keeps the stream. */
export async function readMessage(response: Response): Promise<string | undefined> {
	try {
		const body = (await response.clone().json()) as { message?: unknown };
		return typeof body?.message === 'string' ? body.message : undefined;
	} catch {
		return undefined;
	}
}

/**
 * REST reports its budget in headers rather than in the payload. Note this is
 * a different budget from GraphQL's — requests an hour, not points an hour.
 */
export function rateFromHeaders(headers: Headers): RateReading | null {
	const limit = num(headers, 'x-ratelimit-limit');
	const remaining = num(headers, 'x-ratelimit-remaining');
	const reset = num(headers, 'x-ratelimit-reset');
	if (limit === null || remaining === null || reset === null || limit <= 0) return null;

	const used = num(headers, 'x-ratelimit-used');
	return {
		limit,
		remaining,
		used: used ?? limit - remaining,
		resetAt: new Date(reset * 1000).toISOString()
	};
}

/** `Link: <…>; rel="next"` is the only pagination signal REST gives us. */
export function hasNext(link: string | null): boolean {
	return link !== null && link.includes('rel="next"');
}

function num(headers: Headers, name: string): number | null {
	const raw = headers.get(name);
	if (raw === null) return null;
	const value = Number(raw);
	return Number.isFinite(value) ? value : null;
}

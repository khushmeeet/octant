/**
 * Error taxonomy — PLAN.md Phase 1.
 *
 * Every failure the client can produce, GraphQL or REST, arrives in one
 * shape. Screens branch on a condition they can do something about, never on
 * a status code: `not-found` is a message, `rate-limited` is a wait,
 * `cancelled` is silence, and `invalid` is our bug rather than the user's.
 */

export type SourceErrorKind =
	/** 401 — the token is wrong, revoked or expired. */
	| 'unauthorized'
	/** Valid token, insufficient scope or repository access. */
	| 'forbidden'
	/** Primary or secondary limit. `retryAt` says when it is worth trying again. */
	| 'rate-limited'
	/** No such object — or none this token can see. GitHub does not distinguish. */
	| 'not-found'
	/** The request was malformed. Ours to fix, not the user's to retry. */
	| 'invalid'
	/** Offline, DNS, CORS, timeout. */
	| 'network'
	/** 5xx, or a well-formed response we could not read. */
	| 'server'
	/** The caller walked away. Never shown — it is not a failure. */
	| 'cancelled';

export interface SourceError {
	kind: SourceErrorKind;
	/** Shown to the user as written. */
	message: string;
	/** The HTTP status, where there was one. */
	status?: number;
	/** Epoch ms before which a retry is pointless. Rate limits only. */
	retryAt?: number;
	/**
	 * The address resolved, but to another kind of git object — `Tree` where a
	 * file was asked for, `Blob` where a directory was. That is a condition a
	 * screen can act on rather than report: it sends the reader to the screen
	 * that shows what is actually there.
	 */
	objectType?: string;
	cause?: unknown;
}

/** One entry in a GraphQL `errors` array. Present with or without data. */
export interface GraphQLFieldError {
	message: string;
	type?: string;
	path?: (string | number)[];
}

/** Short label for the chrome. The message carries the detail. */
export const ERROR_LABEL: Record<SourceErrorKind, string> = {
	unauthorized: 'Not authorised',
	forbidden: 'Forbidden',
	'rate-limited': 'Rate limited',
	'not-found': 'Not found',
	invalid: 'Bad request',
	network: 'Unreachable',
	server: 'GitHub error',
	cancelled: 'Cancelled'
};

export function fail(
	kind: SourceErrorKind,
	message: string,
	extra: Omit<Partial<SourceError>, 'kind' | 'message'> = {}
): SourceError {
	return { kind, message, ...extra };
}

/**
 * Map a non-2xx response. The body message is passed in rather than read
 * here, because reading it consumes the stream the caller may still want.
 */
export function httpError(response: Response, message?: string): SourceError {
	const status = response.status;

	if (status === 401) {
		return fail('unauthorized', 'GitHub rejected this token.', { status });
	}

	if (status === 403 || status === 429) {
		const exhausted = response.headers.get('x-ratelimit-remaining') === '0';
		const backoff = Number(response.headers.get('retry-after'));

		if (exhausted) {
			return fail('rate-limited', 'Rate limit exhausted. It refills on the hour.', {
				status,
				retryAt: resetAt(response.headers)
			});
		}
		if (Number.isFinite(backoff) && backoff > 0) {
			return fail('rate-limited', 'GitHub asked us to slow down.', {
				status,
				retryAt: Date.now() + backoff * 1000
			});
		}
		return fail('forbidden', message ?? 'This token is not permitted to read that.', { status });
	}

	if (status === 404) {
		return fail('not-found', message ?? 'No such object — or this token cannot see it.', {
			status
		});
	}

	if (status === 400 || status === 422) {
		return fail('invalid', message ?? `GitHub rejected the request (${status}).`, { status });
	}

	if (status >= 500) {
		return fail('server', `GitHub returned ${status}.`, { status });
	}

	return fail('server', message ?? `Unexpected response (${status}).`, { status });
}

/** Whatever `fetch` threw: offline, blocked, timed out, or cancelled by us. */
export function fromThrown(cause: unknown): SourceError {
	const name = cause instanceof Error ? cause.name : '';

	if (name === 'AbortError') return fail('cancelled', 'Request cancelled.', { cause });
	if (name === 'TimeoutError') return fail('network', 'GitHub did not respond in time.', { cause });

	return fail('network', 'Could not reach api.github.com. Check your connection.', { cause });
}

/**
 * GraphQL answers 200 with an error envelope, so the status tells us nothing
 * and the error `type` tells us everything.
 */
const TYPE_KINDS: Record<string, SourceErrorKind> = {
	NOT_FOUND: 'not-found',
	FORBIDDEN: 'forbidden',
	INSUFFICIENT_SCOPES: 'forbidden',
	UNAUTHORIZED: 'unauthorized',
	RATE_LIMITED: 'rate-limited',
	SERVICE_UNAVAILABLE: 'server',
	INTERNAL: 'server',
	MAX_NODE_LIMIT_EXCEEDED: 'invalid',
	MAX_COST_EXCEEDED: 'invalid'
};

export function fromGraphQLErrors(
	errors: GraphQLFieldError[],
	fallback = 'GitHub returned no data.'
): SourceError {
	const first = errors[0];
	if (!first) return fail('server', fallback);

	// An error carrying no `type` is a parse or validation failure: the
	// document we sent is wrong, which is a bug and not a condition to recover
	// from at the call site.
	const kind = first.type ? (TYPE_KINDS[first.type] ?? 'server') : 'invalid';
	return fail(kind, first.message || fallback);
}

function resetAt(headers: Headers): number | undefined {
	const reset = Number(headers.get('x-ratelimit-reset'));
	return Number.isFinite(reset) && reset > 0 ? reset * 1000 : undefined;
}

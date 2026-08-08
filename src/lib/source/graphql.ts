import { rate, type RateReading } from '$lib/sync/rate.svelte';
import type { TypedDocument, Variables } from './document';
import {
	fail,
	fromGraphQLErrors,
	fromThrown,
	httpError,
	type GraphQLFieldError,
	type SourceError
} from './errors';
import { DEFAULT_TIMEOUT_MS, GITHUB_GRAPHQL, withTimeout } from './http';
import { share, stableKey } from './inflight';
import { currentToken, tokenTag } from './token';

/**
 * The GraphQL executor — PLAN.md Phase 1.
 *
 * One place where every GraphQL call goes: it attaches the token, enforces a
 * deadline, shares in-flight duplicates, maps every failure into the error
 * taxonomy, and pays the meter on the way past. Callers hand it a typed
 * document and get typed data back — they never see a status code, and never
 * see `rateLimit`, which is stripped here.
 */

export interface QueryOptions {
	signal?: AbortSignal;
	/** Explicit bearer token. Only the pre-auth validation path passes one. */
	token?: string;
	/** Bypass in-flight sharing. Reads are idempotent, so this is rarely right. */
	fresh?: boolean;
	timeoutMs?: number;
}

export type QueryResult<TData> =
	| {
			ok: true;
			data: TData;
			/**
			 * GraphQL can answer with data *and* errors: a field the token could
			 * not read resolves to null while the rest arrives intact. Non-empty
			 * means what you got is partial.
			 */
			partial: GraphQLFieldError[];
	  }
	| { ok: false; error: SourceError };

interface Envelope<TData> {
	data?: (TData & { rateLimit?: RateReading | null }) | null;
	errors?: GraphQLFieldError[];
	/** Present on transport-level failures, where there is no GraphQL envelope. */
	message?: string;
}

export async function query<TData, TVars extends Variables>(
	doc: TypedDocument<TData, TVars>,
	variables: TVars,
	options: QueryOptions = {}
): Promise<QueryResult<TData>> {
	const token = options.token ?? currentToken();
	if (!token) {
		return { ok: false, error: fail('unauthorized', 'No token. Connect one to read GitHub.') };
	}

	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const run = (signal: AbortSignal | undefined) =>
		execute(doc, variables, token, signal, timeoutMs);

	try {
		if (options.fresh) return await run(options.signal);
		return await share(stableKey(`${doc.name}#${tokenTag(token)}`, variables), options.signal, run);
	} catch (cause) {
		// `execute` resolves rather than rejects; this is a cancelled wait.
		return { ok: false, error: fromThrown(cause) };
	}
}

async function execute<TData, TVars extends Variables>(
	doc: TypedDocument<TData, TVars>,
	variables: TVars,
	token: string,
	signal: AbortSignal | undefined,
	timeoutMs: number
): Promise<QueryResult<TData>> {
	let response: Response;

	try {
		response = await fetch(GITHUB_GRAPHQL, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${token}`,
				'Content-Type': 'application/json',
				Accept: 'application/json'
			},
			body: JSON.stringify({ query: doc.text, variables, operationName: doc.name }),
			signal: withTimeout(signal, timeoutMs)
		});
	} catch (cause) {
		return { ok: false, error: fromThrown(cause) };
	}

	let body: Envelope<TData>;
	try {
		body = (await response.json()) as Envelope<TData>;
	} catch {
		return {
			ok: false,
			error: response.ok
				? fail('server', 'GitHub returned a response we could not read.', {
						status: response.status
					})
				: httpError(response)
		};
	}

	if (!response.ok) return { ok: false, error: httpError(response, body?.message) };

	const payload = body.data ?? null;
	const errors = body.errors ?? [];

	// A 200 with no data at all is a failure whatever the envelope says.
	if (!payload) return { ok: false, error: fromGraphQLErrors(errors, body.message) };

	const { rateLimit, ...data } = payload;
	if (rateLimit) rate.record('graphql', rateLimit);

	// `data` is `payload` minus the field we composed in, which is `TData` by
	// construction — TypeScript cannot see that through the generic.
	return { ok: true, data: data as unknown as TData, partial: errors };
}

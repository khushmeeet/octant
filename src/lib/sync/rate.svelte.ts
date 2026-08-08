import { idbDelete, idbGet, idbPut } from '$lib/store/idb';
import { META, STORE } from '$lib/store/schema';

/**
 * Rate-limit accounting — ARCHITECTURE.md §7.
 *
 * Every GraphQL query asks for the `rateLimit` field and every REST response
 * carries `x-ratelimit-*` headers, so headroom is known without spending a
 * request to find out. The client writes here on the way past; the meter in
 * the header reads.
 *
 * The two budgets are held separately because they are separate: 5,000
 * *points* an hour on GraphQL, 5,000 *requests* an hour on REST. Adding them
 * would produce a number that means nothing. The meter shows GraphQL, which
 * is what navigation spends.
 */

export interface RateLimit {
	limit: number;
	remaining: number;
	used: number;
	/** ISO-8601. GitHub's window resets on the hour. */
	resetAt: string;
	/** When we observed this, so a stale reading can be shown as stale. */
	observedAt: number;
}

/** A reading as an API reports it, before we stamp it. */
export type RateReading = Omit<RateLimit, 'observedAt'>;

export type Budget = 'graphql' | 'rest';

interface Persisted {
	graphql: RateLimit | null;
	rest: RateLimit | null;
}

let graphql = $state<RateLimit | null>(null);
let rest = $state<RateLimit | null>(null);

export const rate = {
	/** Points. What the header meter shows. */
	get graphql(): RateLimit | null {
		return graphql;
	},

	/** Requests. Spent only by compare and the pull-request files endpoint. */
	get rest(): RateLimit | null {
		return rest;
	},

	/** Fraction of the hourly GraphQL budget still available, or `null` if unknown. */
	get fraction(): number | null {
		if (!graphql || graphql.limit <= 0) return null;
		return graphql.remaining / graphql.limit;
	},

	/** Below a tenth of the budget the meter earns emphasis. */
	get low(): boolean {
		const f = rate.fraction;
		return f !== null && f <= 0.1;
	},

	/** Record a reading from a response. Persisted so the meter survives reload. */
	record(budget: Budget, next: RateReading): void {
		const reading: RateLimit = { ...next, observedAt: Date.now() };
		if (budget === 'graphql') graphql = reading;
		else rest = reading;
		persist();
	},

	/** Populate the meter from the last known reading, before any query runs. */
	async hydrate(): Promise<void> {
		if (graphql || rest) return;

		const saved = await idbGet<Persisted | RateLimit>(STORE.meta, META.rateLimit).catch(
			() => undefined
		);
		if (!saved) return;

		// A reading written before the budgets were split is a GraphQL reading.
		if ('limit' in saved) {
			if (!graphql) graphql = saved;
			return;
		}
		if (!graphql) graphql = saved.graphql;
		if (!rest) rest = saved.rest;
	},

	clear(): void {
		graphql = null;
		rest = null;
		void idbDelete(STORE.meta, META.rateLimit).catch(() => {});
	}
};

function persist(): void {
	const snapshot: Persisted = {
		graphql: $state.snapshot(graphql),
		rest: $state.snapshot(rest)
	};
	void idbPut(STORE.meta, META.rateLimit, snapshot).catch(() => {
		// The meter is live in memory regardless; persistence is only so it
		// survives a reload.
	});
}

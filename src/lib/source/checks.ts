/**
 * Check runs and commit statuses, as one answer — PLAN.md Phase 7's right
 * panel, which asks for "checks, approvals, base, conflicts".
 *
 * GitHub has two mechanisms here and shows them in one place. The older commit
 * status API attaches a `StatusContext` to a SHA; the newer Checks API attaches
 * a `CheckRun`. `statusCheckRollup.contexts` is a union of the two, and they
 * spell the same three outcomes differently — a check run carries a `status`
 * and a `conclusion`, a status context carries a single `state`. Reconciling
 * them once, here, is what lets a screen ask "is CI green" without learning
 * which era a repository's CI was configured in.
 *
 * Both documents that read checks share this: the list wants the rollup's own
 * state for one pill, and the detail wants the runs behind it. A second mapping
 * would be a second place for a red build to read as amber.
 */

/** What a screen acts on. Everything GitHub can say collapses into these. */
export type CheckState = 'success' | 'failure' | 'pending' | 'none';

export interface CheckRun {
	name: string;
	state: CheckState;
	/** GitHub's own word — `TIMED_OUT`, `IN_PROGRESS`. Shown on hover, unmapped. */
	detail: string;
	url: string | null;
}

export interface CheckSummary {
	/** The rollup: failure if anything failed, else pending, else success. */
	state: CheckState;
	total: number;
	passing: number;
	failing: number;
	pending: number;
	/** Empty on the list, where only the rollup is asked for. */
	runs: CheckRun[];
}

export const NO_CHECKS: CheckSummary = {
	state: 'none',
	total: 0,
	passing: 0,
	failing: 0,
	pending: 0,
	runs: []
};

/**
 * A check run that finished. `NEUTRAL` and `SKIPPED` are successes because they
 * are not things a reviewer has to act on, and a screen that counted them as
 * failures would cry wolf on every repository with a conditional job.
 */
const CONCLUSION: Record<string, CheckState> = {
	SUCCESS: 'success',
	NEUTRAL: 'success',
	SKIPPED: 'success',
	FAILURE: 'failure',
	TIMED_OUT: 'failure',
	CANCELLED: 'failure',
	ACTION_REQUIRED: 'failure',
	STARTUP_FAILURE: 'failure',
	STALE: 'pending'
};

/** The older API's single field, which conflates status and conclusion. */
const STATUS_STATE: Record<string, CheckState> = {
	SUCCESS: 'success',
	FAILURE: 'failure',
	ERROR: 'failure',
	PENDING: 'pending',
	EXPECTED: 'pending'
};

export interface RollupContext {
	__typename?: string;
	/** CheckRun. */
	name?: string | null;
	conclusion?: string | null;
	status?: string | null;
	detailsUrl?: string | null;
	/** StatusContext. */
	context?: string | null;
	state?: string | null;
	targetUrl?: string | null;
}

export interface RollupNode {
	state?: string | null;
	contexts?: { totalCount?: number; nodes?: (RollupContext | null)[] | null } | null;
}

export function rollupState(state: string | null | undefined): CheckState {
	return state ? (STATUS_STATE[state] ?? 'pending') : 'none';
}

/**
 * The whole rollup. Counts come from the contexts when we asked for them and
 * from the rollup's own state when we did not, so the summary is never a lie
 * about how much it looked at — a list that shows one pill has not paid for
 * thirty context nodes per row.
 */
export function summarise(node: RollupNode | null | undefined): CheckSummary {
	if (!node) return NO_CHECKS;

	const runs = (node.contexts?.nodes ?? [])
		.filter((context): context is RollupContext => context !== null)
		.map(run);

	if (runs.length === 0) {
		const state = rollupState(node.state);
		return { ...NO_CHECKS, state, total: node.contexts?.totalCount ?? 0 };
	}

	let passing = 0;
	let failing = 0;
	let pending = 0;
	for (const item of runs) {
		if (item.state === 'success') passing += 1;
		else if (item.state === 'failure') failing += 1;
		else pending += 1;
	}

	return {
		// A red build outranks a running one: it is the thing you would act on,
		// and waiting for the rest to finish will not make it green.
		state: failing > 0 ? 'failure' : pending > 0 ? 'pending' : 'success',
		total: node.contexts?.totalCount ?? runs.length,
		passing,
		failing,
		pending,
		runs
	};
}

function run(context: RollupContext): CheckRun {
	if (context.__typename === 'StatusContext') {
		return {
			name: context.context ?? 'status',
			state: STATUS_STATE[context.state ?? ''] ?? 'pending',
			detail: context.state ?? '',
			url: context.targetUrl ?? null
		};
	}

	// A check run that has not completed has no conclusion yet, whatever its
	// status says. `QUEUED` and `IN_PROGRESS` are both simply "not yet".
	const done = context.status === 'COMPLETED';
	return {
		name: context.name ?? 'check',
		state: done ? (CONCLUSION[context.conclusion ?? ''] ?? 'pending') : 'pending',
		detail: done ? (context.conclusion ?? '') : (context.status ?? ''),
		url: context.detailsUrl ?? null
	};
}

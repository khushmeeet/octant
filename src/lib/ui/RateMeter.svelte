<script lang="ts">
	import { rate } from '$lib/sync/rate.svelte';
	import { count, until } from './format';

	/**
	 * Remaining GraphQL headroom — ARCHITECTURE.md §7.
	 *
	 * It is a real constraint, so it is visible rather than mysterious. Under
	 * a tenth of the budget the reading takes full contrast rather than a
	 * colour: amber and red already mean force-push and removed-line, and
	 * each meaning is used once.
	 */
	const current = $derived(rate.graphql);
	const rest = $derived(rate.rest);

	// REST is a separate budget spent only by diffs, so it stays out of the
	// reading and turns up on hover, where it answers a question you asked.
	const title = $derived(
		current
			? [
					`${count(current.remaining)} of ${count(current.limit)} GraphQL points left · resets in ${until(current.resetAt)}`,
					rest && `${count(rest.remaining)} of ${count(rest.limit)} REST requests left`
				]
					.filter(Boolean)
					.join('\n')
			: 'Rate limit unknown until the first query'
	);
</script>

<span class="meter" class:low={rate.low} {title}>
	{#if current}
		<span class="n">{count(current.remaining)}</span>
		<span class="of">/{count(current.limit)}</span>
	{:else}
		<span class="of">—</span>
	{/if}
</span>

<style>
	.meter {
		display: inline-flex;
		align-items: baseline;
		gap: 2px;
		font-family: var(--font-mono);
		font-size: 11.5px;
		font-variant-numeric: tabular-nums;
		padding: 2.5px 8px;
		border-radius: var(--radius-pill);
		border: 1px solid var(--bd);
		white-space: nowrap;
		transition:
			color 120ms,
			border-color 120ms;
	}

	.n {
		color: var(--tx2);
	}

	.of {
		color: var(--tx3);
	}

	.low {
		border-color: var(--bd2);
	}

	.low .n {
		color: var(--tx);
	}
</style>

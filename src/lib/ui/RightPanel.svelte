<script lang="ts">
	/**
	 * The right panel has one shape and never changes it — ARCHITECTURE.md §2.
	 *
	 * Same three blocks, same order, on every screen:
	 *   1. Since your last visit
	 *   2. About (identity of the current object)
	 *   3. Open against it
	 *
	 * Positional consistency is most of retrieval speed, so the headings are
	 * fixed here rather than passed in. Screens supply only the rows.
	 */
	import type { PanelEntry } from './types';

	interface Props {
		/** Appended to the first heading, e.g. `2d`. */
		since?: string;
		visit?: PanelEntry[];
		about?: PanelEntry[];
		open?: PanelEntry[];
	}

	let { since, visit = [], about = [], open = [] }: Props = $props();

	const blocks = $derived([
		{ heading: since ? `Since your last visit · ${since}` : 'Since your last visit', rows: visit },
		{ heading: 'About', rows: about },
		{ heading: 'Open against it', rows: open }
	]);
</script>

<aside class="side2" aria-label="Context">
	{#each blocks as block, i (block.heading)}
		{#if i > 0}
			<hr />
		{/if}
		<h3>{block.heading}</h3>
		{#if block.rows.length === 0}
			<p class="empty">—</p>
		{:else}
			{#each block.rows as row (row.key)}
				<div class="kv">
					<span class:mono={row.mono}>{row.key}</span>
					<span class:accent={row.accent} class:mono={row.mono}>{row.value}</span>
				</div>
			{/each}
		{/if}
	{/each}
</aside>

<style>
	.side2 {
		width: var(--panel-w);
		flex: none;
		border-left: 1px solid var(--bd);
		padding: var(--pad-panel);
		background: var(--panel);
		overflow-y: auto;
	}

	h3 {
		font-size: 11px;
		font-weight: 500;
		color: var(--tx3);
		margin: 0 0 8px;
	}

	.kv {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 3px 0;
		font-size: 12px;
	}

	.kv span:first-child {
		color: var(--tx2);
	}

	.kv span:last-child {
		color: var(--tx);
		text-align: right;
		margin-left: auto;
	}

	.empty {
		margin: 0;
		padding: 3px 0;
		font-size: 12px;
		color: var(--tx3);
	}

	.accent {
		color: var(--acc-tx) !important;
	}

	.mono {
		font-family: var(--font-mono);
		font-size: 11.5px;
	}

	hr {
		border: none;
		border-top: 1px solid var(--bd);
		margin: 14px 0;
	}

	@media (max-width: 1060px) {
		.side2 {
			display: none;
		}
	}
</style>

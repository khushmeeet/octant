<script lang="ts">
	import type { Snippet } from 'svelte';

	/**
	 * Header pill — DESIGN.md §5. 11.5px, 5px radius, hairline border.
	 * Tones map to the one meaning each colour is allowed to carry.
	 */
	interface Props {
		/**
		 * `warn` is amber, and DESIGN.md §3 spends amber on exactly two things: a
		 * force push you have not seen, and an unresolved thread. Phase 7 is the
		 * first screen with either, which is why the tone arrives with it rather
		 * than in Phase 0 — a colour with no meaning in use is a colour that
		 * drifts into decoration.
		 */
		tone?: 'default' | 'accent' | 'ok' | 'no' | 'warn' | 'plain';
		mono?: boolean;
		title?: string;
		onclick?: () => void;
		children: Snippet;
	}

	let { tone = 'default', mono = false, title, onclick, children }: Props = $props();
</script>

{#if onclick}
	<button class="pill {tone} interactive" class:mono {title} type="button" {onclick}>
		{@render children()}
	</button>
{:else}
	<span class="pill {tone}" class:mono {title}>
		{@render children()}
	</span>
{/if}

<style>
	.pill {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		font-size: 11.5px;
		padding: 2.5px 8px;
		border-radius: var(--radius-pill);
		border: 1px solid var(--bd);
		color: var(--tx2);
		white-space: nowrap;
		transition:
			color 120ms,
			border-color 120ms,
			background-color 120ms;
	}

	.interactive:hover {
		border-color: var(--bd2);
		color: var(--tx);
	}

	.accent {
		background: var(--acc-bg);
		border-color: transparent;
		color: var(--acc-tx);
	}

	.ok {
		background: var(--ok-bg);
		border-color: transparent;
		color: var(--ok);
	}

	.no {
		background: var(--no-bg);
		border-color: transparent;
		color: var(--no);
	}

	.warn {
		border-color: var(--wn);
		color: var(--wn);
	}

	.plain {
		border-color: transparent;
		color: var(--tx3);
	}

	.mono {
		font-family: var(--font-mono);
		font-size: 11.5px;
		font-variant-numeric: tabular-nums;
	}
</style>

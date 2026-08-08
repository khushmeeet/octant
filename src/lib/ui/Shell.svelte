<script lang="ts">
	import type { Snippet } from 'svelte';
	import Header from './Header.svelte';
	import RightPanel from './RightPanel.svelte';
	import Sidebar from './Sidebar.svelte';
	import VerbRow from './VerbRow.svelte';

	/**
	 * App shell — DESIGN.md §5.
	 *
	 * sidebar | (header → verb row → content), content splitting into main
	 * and the right panel. Every screen fills the same four regions, so the
	 * geography is learned once.
	 */
	interface Props {
		header?: Snippet;
		verbs?: Snippet;
		panel?: Snippet;
		children: Snippet;
	}

	let { header, verbs, panel, children }: Props = $props();
</script>

{#snippet defaultHeader()}
	<Header />
{/snippet}

{#snippet defaultVerbs()}
	<VerbRow />
{/snippet}

{#snippet defaultPanel()}
	<RightPanel />
{/snippet}

<div class="app">
	<Sidebar />
	<div class="body">
		{@render (header ?? defaultHeader)()}
		{@render (verbs ?? defaultVerbs)()}
		<div class="content">
			<main class="mid">
				{@render children()}
			</main>
			{@render (panel ?? defaultPanel)()}
		</div>
	</div>
</div>

<style>
	.app {
		height: 100dvh;
		margin: 0 auto;
		border: 1px solid var(--bd);
		border-radius: var(--frame-radius);
		overflow: hidden;
		background: var(--panel);
		display: flex;
	}

	.body {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}

	.content {
		flex: 1;
		display: flex;
		min-height: 0;
	}

	.mid {
		flex: 1;
		min-width: 0;
		min-height: 0;
		overflow: auto;
	}

	/* The frame's inset makes its 10px radius mean something. */
	@media (min-width: 781px) {
		.app {
			height: calc(100dvh - 16px);
			margin: 8px;
		}
	}
</style>

<script lang="ts">
	import type { Snippet } from 'svelte';
	import Header from './Header.svelte';
	import RightPanel from './RightPanel.svelte';
	import Sidebar from './Sidebar.svelte';
	import { panel as panelState } from './panel.svelte';

	/**
	 * App shell — DESIGN.md §5.
	 *
	 * sidebar | (header → content), content splitting into main and the right
	 * panel. Every screen fills the same three regions, so the geography is
	 * learned once.
	 *
	 * The shell fills the viewport edge to edge. It used to float 8px inside a
	 * rounded frame, which cost a strip of the window on all four sides and
	 * bought a border nobody reads — a repository browser is a dense list, and
	 * the rows are worth more than the inset.
	 */
	interface Props {
		sidebar?: Snippet;
		header?: Snippet;
		panel?: Snippet;
		children: Snippet;
	}

	let { sidebar, header, panel, children }: Props = $props();
</script>

{#snippet defaultSidebar()}
	<Sidebar />
{/snippet}

{#snippet defaultHeader()}
	<Header />
{/snippet}

{#snippet defaultPanel()}
	<RightPanel />
{/snippet}

<div class="app">
	{@render (sidebar ?? defaultSidebar)()}
	<div class="body">
		{@render (header ?? defaultHeader)()}
		<div class="content">
			<main class="mid">
				{@render children()}
			</main>
			{#if panelState.open}
				{@render (panel ?? defaultPanel)()}
			{/if}
		</div>
	</div>
</div>

<style>
	.app {
		height: 100dvh;
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
</style>

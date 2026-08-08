<script lang="ts">
	import type { Snippet } from 'svelte';
	import Icon from './Icon.svelte';
	import Pill from './Pill.svelte';
	import RateMeter from './RateMeter.svelte';
	import { theme } from './theme.svelte';
	import type { Crumb } from './types';

	/**
	 * Breadcrumb left, pills right — DESIGN.md §5.
	 *
	 * A screen supplies its own pills (ref, HEAD SHA, state); the meter, the
	 * palette and the theme toggle are the chrome's and always sit outermost, so
	 * their position never depends on which screen you are on.
	 */
	interface Props {
		crumbs?: Crumb[];
		pills?: Snippet;
	}

	let { crumbs = [{ label: 'octant' }], pills }: Props = $props();
</script>

<header class="hd">
	<div class="bc">
		{#each crumbs as crumb, i (i)}
			{#if i > 0}
				<Icon name="chev" muted />
			{/if}
			{#if i === crumbs.length - 1}
				<b class:mono={crumb.mono}>{crumb.label}</b>
			{:else if crumb.href}
				<a class:mono={crumb.mono} href={crumb.href}>{crumb.label}</a>
			{:else}
				<span class:mono={crumb.mono}>{crumb.label}</span>
			{/if}
		{/each}
	</div>

	<div class="r">
		{#if pills}{@render pills()}{/if}
		<RateMeter />
		<Pill title="Command palette — arrives in Phase 9">
			<Icon name="search" />⌘K
		</Pill>
		<Pill
			onclick={() => theme.toggle()}
			title="Switch to the {theme.current === 'dark' ? 'light' : 'dark'} theme"
		>
			{theme.current === 'dark' ? 'Light' : 'Dark'}
		</Pill>
	</div>
</header>

<style>
	.hd {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 0 var(--pad-main);
		height: var(--header-h);
		border-bottom: 1px solid var(--bd);
		flex: none;
	}

	.bc {
		display: flex;
		align-items: center;
		gap: 6px;
		color: var(--tx2);
		min-width: 0;
		overflow: hidden;
	}

	.bc b {
		color: var(--tx);
		font-weight: 500;
		white-space: nowrap;
	}

	.bc a,
	.bc span {
		white-space: nowrap;
		transition: color 120ms;
	}

	.bc a:hover {
		color: var(--tx);
	}

	.r {
		margin-left: auto;
		display: flex;
		align-items: center;
		gap: 6px;
		flex: none;
	}
</style>

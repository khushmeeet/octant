<script lang="ts">
	import Icon from './Icon.svelte';
	import Pill from './Pill.svelte';
	import RateMeter from './RateMeter.svelte';
	import { theme } from './theme.svelte';

	interface Props {
		/** Breadcrumb segments, last one emphasised. */
		crumbs?: string[];
	}

	let { crumbs = ['octant'] }: Props = $props();
</script>

<header class="hd">
	<div class="bc">
		{#each crumbs as crumb, i (i)}
			{#if i > 0}
				<Icon name="chev" muted />
			{/if}
			{#if i === crumbs.length - 1}
				<b>{crumb}</b>
			{:else}
				<span>{crumb}</span>
			{/if}
		{/each}
	</div>

	<div class="r">
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
	}

	.bc b {
		color: var(--tx);
		font-weight: 500;
	}

	.r {
		margin-left: auto;
		display: flex;
		align-items: center;
		gap: 6px;
	}
</style>

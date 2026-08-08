<script lang="ts">
	import { refsHref, treeHref } from '$lib/nav/paths';
	import type { RefKind, RepoRef } from '$lib/source';
	import Icon from '$lib/ui/Icon.svelte';
	import { count } from '$lib/ui/format';

	/**
	 * The sidebar's contextual section on the Refs screen — DESIGN.md §5 calls
	 * it `Scope`, which is the same thing it means on the Log screen: what
	 * subset of the object am I looking at.
	 *
	 * It is short on purpose. Branches and tags are the same object
	 * (ARCHITECTURE.md §2) and the screen shows both by default, so the only
	 * scope worth naming is which half — and once that is said there is nothing
	 * else to put here that the table does not already say better. A sidebar
	 * that mirrored the list beside it would be a second copy of the screen.
	 *
	 * The default branch sits below the filter because it is the answer to a
	 * question the ahead/behind column raises and cannot answer for itself:
	 * ahead of *what*.
	 */
	interface Props {
		repo: RepoRef;
		kind: RefKind | null;
		branches: number | null;
		tags: number | null;
		defaultBranch: string | null;
	}

	let { repo, kind, branches, tags, defaultBranch }: Props = $props();

	const items = $derived([
		{ id: null, label: 'All refs', icon: 'commit' as const, n: total(branches, tags) },
		{ id: 'branch' as const, label: 'Branches', icon: 'branch' as const, n: branches },
		{ id: 'tag' as const, label: 'Tags', icon: 'tag' as const, n: tags }
	]);

	function total(a: number | null, b: number | null): number | null {
		return a === null && b === null ? null : (a ?? 0) + (b ?? 0);
	}
</script>

<div class="kinds">
	{#each items as item (item.label)}
		<a
			class="item"
			class:on={kind === item.id}
			aria-current={kind === item.id ? 'true' : undefined}
			href={refsHref(repo, { kind: item.id })}
		>
			<Icon name={item.icon} />
			<span class="lbl">{item.label}</span>
			{#if item.n !== null}<span class="n">{count(item.n)}</span>{/if}
		</a>
	{/each}

	<div class="head">Compared against</div>
	{#if defaultBranch}
		<a class="item" href={treeHref(repo, defaultBranch)} title="Browse {defaultBranch}">
			<Icon name="branch" />
			<span class="lbl mono">{defaultBranch}</span>
		</a>
	{:else}
		<p class="hint">…</p>
	{/if}
</div>

<style>
	.kinds {
		display: flex;
		flex-direction: column;
		gap: 1px;
	}

	.item {
		display: flex;
		align-items: center;
		gap: 6px;
		height: 24px;
		padding: 0 6px;
		border-radius: var(--radius-item);
		color: var(--tx2);
		min-width: 0;
		flex: none;
		transition:
			color 120ms,
			background-color 120ms;
	}

	.item:hover {
		background: var(--hover);
		color: var(--tx);
	}

	/* Selection is announced as well as tinted — DESIGN.md §9. */
	.item.on {
		background: var(--sel);
		color: var(--tx);
		font-weight: 500;
	}

	.lbl {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 12px;
	}

	.n {
		margin-left: auto;
		font-size: 11px;
		color: var(--tx3);
		font-variant-numeric: tabular-nums;
		flex: none;
	}

	.head {
		font-size: 11px;
		font-weight: 500;
		color: var(--tx3);
		padding: 14px 6px 4px;
	}

	.hint {
		margin: 0;
		padding: 2px 6px;
		font-size: 12px;
		color: var(--tx3);
	}
</style>

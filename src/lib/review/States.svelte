<script lang="ts">
	import { pullsHref } from '$lib/nav/paths';
	import type { PullFilter, RepoRef } from '$lib/source';
	import Icon from '$lib/ui/Icon.svelte';
	import { count } from '$lib/ui/format';

	/**
	 * The sidebar's contextual section on the pull request list — `Scope`, the
	 * same heading the Log and Refs screens use for the same question: which
	 * subset of the object am I looking at.
	 *
	 * Only the open count is known without asking. GitHub's repository summary
	 * counts open pull requests and nothing else, and asking for three more
	 * totals would be three more connections on every screen that reads the
	 * summary — which is all of them. So the other rows carry a count only once
	 * their own walk has answered, which is the same bargain the refs list makes
	 * between `walk.total` and the summary's number.
	 */
	interface Props {
		repo: RepoRef;
		filter: PullFilter;
		/** The walk's own total for the filter currently shown, if it has landed. */
		shownTotal: number | null;
		/** Open pull requests, from the repository summary. Always known. */
		openTotal: number | null;
	}

	let { repo, filter, shownTotal, openTotal }: Props = $props();

	const items = $derived([
		{ id: 'open' as const, label: 'Open', icon: 'pr' as const, n: openTotal },
		{ id: 'merged' as const, label: 'Merged', icon: 'commit' as const, n: null },
		{ id: 'closed' as const, label: 'Closed', icon: 'branch' as const, n: null },
		{ id: 'all' as const, label: 'All', icon: 'code' as const, n: null }
	]);

	/** A row that is the one on screen shows what the walk actually found. */
	function shown(id: PullFilter, fallback: number | null): number | null {
		return id === filter ? (shownTotal ?? fallback) : fallback;
	}
</script>

<div class="states">
	{#each items as item (item.id)}
		<a
			class="item"
			class:on={filter === item.id}
			aria-current={filter === item.id ? 'true' : undefined}
			href={pullsHref(repo, { filter: item.id })}
		>
			<Icon name={item.icon} />
			<span class="lbl">{item.label}</span>
			{#if shown(item.id, item.n) !== null}
				<span class="n">{count(shown(item.id, item.n) ?? 0)}</span>
			{/if}
		</a>
	{/each}
</div>

<style>
	.states {
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
</style>

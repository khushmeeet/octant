<script lang="ts">
	import { blobUrl, treeHref } from '$lib/nav/paths';
	import { GitHubSource, type RepoRef, type TreeEntry } from '$lib/source';
	import { prefetch } from '$lib/sync/prefetch';
	import { resource } from '$lib/sync/resource.svelte';
	import Icon from './Icon.svelte';
	import Self from './FileTreeNode.svelte';

	/**
	 * One row of the sidebar's contextual file tree — PLAN.md Phase 3.
	 *
	 * A node fetches its own children, and only once it is open. Two things fall
	 * out of that: the tree costs nothing until it is used, and every listing it
	 * pulls is the same cache entry the main screen would pull for that
	 * directory — so expanding a folder here makes opening it there free, and
	 * the other way round.
	 */
	interface Props {
		repo: RepoRef;
		/** The revision listings are queried at. */
		rev: string;
		/** The revision links carry. `null` addresses the default branch. */
		hrefRev: string | null;
		entry: TreeEntry;
		depth: number;
		/** The directory the main screen is showing. */
		current: string;
	}

	let { repo, rev, hrefRev, entry, depth, current }: Props = $props();

	const isDir = $derived(entry.type !== 'blob');
	const onPath = $derived(current === entry.path || current.startsWith(`${entry.path}/`));

	/** A manual toggle, which outranks the path until the path next moves. */
	let override = $state<boolean | null>(null);
	const open = $derived(isDir && (override ?? onPath));

	// Navigating changes what "on the path" means, and that retires the manual
	// toggle: the tree follows the screen unless the reader has said otherwise
	// since the screen last moved.
	$effect(() => {
		void onPath;
		override = null;
	});

	const children = $derived(isDir ? GitHubSource.getTree(repo, rev, entry.path) : null);
	const listing = resource(() => (open ? children : null));
</script>

<div class="node" style:padding-left="{6 + depth * 11}px">
	{#if isDir}
		<button
			class="tw"
			class:open
			aria-expanded={open}
			aria-label={open ? `Collapse ${entry.name}` : `Expand ${entry.name}`}
			onclick={() => (override = !open)}
			onpointerenter={() => prefetch(children)}
		>
			<Icon name="chev" />
		</button>
		<a
			class="name dir"
			class:on={current === entry.path}
			href={treeHref(repo, hrefRev, entry.path)}
			title={entry.path}
			onpointerenter={() => prefetch(children)}
		>
			{entry.name}
		</a>
	{:else}
		<span class="tw" aria-hidden="true"></span>
		<!-- The file screen is Phase 4. Until it exists this links out rather
		     than pretending — ARCHITECTURE.md §1. -->
		<a
			class="name"
			href={blobUrl(repo, rev, entry.path)}
			title="{entry.path} — opens on github.com until Phase 4"
			target="_blank"
			rel="noopener noreferrer external"
		>
			{entry.name}
		</a>
	{/if}
</div>

{#if open}
	{#if listing.data}
		{#each listing.data.entries as child (child.path)}
			<Self {repo} {rev} {hrefRev} entry={child} depth={depth + 1} {current} />
		{/each}
	{:else if listing.error}
		<p class="hint" style:padding-left="{17 + depth * 11}px">{listing.error.message}</p>
	{:else if listing.loading}
		<p class="hint" style:padding-left="{17 + depth * 11}px">…</p>
	{/if}
{/if}

<style>
	.node {
		display: flex;
		align-items: center;
		gap: 2px;
		height: 24px;
		border-radius: var(--radius-item);
		min-width: 0;
	}

	.node:hover {
		background: var(--hover);
	}

	.tw {
		width: 14px;
		height: 14px;
		flex: none;
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--tx3);
	}

	.tw.open {
		transform: rotate(90deg);
		color: var(--tx2);
	}

	.name {
		font-size: 12px;
		color: var(--tx2);
		padding: 0 4px;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		transition: color 120ms;
	}

	.name:hover {
		color: var(--tx);
	}

	.name.on {
		color: var(--tx);
		font-weight: 500;
	}

	.hint {
		margin: 0;
		font-size: 11px;
		color: var(--tx3);
		height: 20px;
		display: flex;
		align-items: center;
	}
</style>

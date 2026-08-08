<script lang="ts">
	import { GitHubSource, type RepoRef } from '$lib/source';
	import { resource } from '$lib/sync/resource.svelte';
	import FileTreeNode from './FileTreeNode.svelte';

	/**
	 * The sidebar's contextual section on the Tree screen — DESIGN.md §5.
	 *
	 * Always rooted at the repository, whatever directory the main screen is
	 * showing, because a tree that reparented itself on every navigation would
	 * make the sidebar move under the reader. Ancestors of the current path open
	 * themselves; everything else is where it was left.
	 *
	 * The root listing is the same cache key the main screen reads at the root,
	 * so on a root-level screen this is either a local read or a share of the
	 * request already in the air. It is never a second round trip.
	 */
	interface Props {
		repo: RepoRef;
		rev: string;
		hrefRev: string | null;
		current: string;
	}

	let { repo, rev, hrefRev, current }: Props = $props();

	const root = resource(() => GitHubSource.getTree(repo, rev, ''));
</script>

{#if root.data}
	{#each root.data.entries as entry (entry.path)}
		<FileTreeNode {repo} {rev} {hrefRev} {entry} depth={0} {current} />
	{/each}
{:else if root.error}
	<p class="hint">{root.error.message}</p>
{:else if root.loading}
	<p class="hint">Loading the tree…</p>
{/if}

<style>
	.hint {
		margin: 0;
		padding: 2px 6px;
		font-size: 12px;
		color: var(--tx3);
	}
</style>

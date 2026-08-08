<script lang="ts">
	import { logHref } from '$lib/nav/paths';
	import { type RepoRef, type TreeEntry } from '$lib/source';
	import Icon from '$lib/ui/Icon.svelte';
	import { count } from '$lib/ui/format';
	import type { AuthorTally } from './authors';

	/**
	 * The sidebar's contextual section on the Log screen — DESIGN.md §5 names it
	 * `Scope`, and PLAN.md Phase 5 asks for the path and author filters to be
	 * driven from here.
	 *
	 * Both narrow the same list and they are not the same kind of thing, which is
	 * why they look different. **Path is a scope**: it changes the address, the
	 * query GitHub answers, and the total the screen reports. **Author is a
	 * filter**: it narrows what is already loaded, instantly, and the count
	 * beside each name says exactly how far that reaches.
	 *
	 * The listing is the directory the scope sits in, so moving the log sideways
	 * — this file, or the one next to it — is one click. It is the same cache
	 * entry the Tree and File screens read for that directory, so arriving here
	 * from either of them costs nothing.
	 */
	interface Props {
		repo: RepoRef;
		/** The revision links carry. `null` addresses the default branch. */
		hrefRev: string | null;
		/** The path the log is scoped to, `''` for the whole repository. */
		path: string;
		/** The scope's own directory listing, for moving sideways. */
		entries: readonly TreeEntry[] | null;
		authors: readonly AuthorTally[];
		author: string | null;
		loading?: boolean;
	}

	let { repo, hrefRev, path, entries, authors, author, loading = false }: Props = $props();

	/** The directory the scope sits in. A directory scope is its own. */
	const here = $derived.by(() => {
		if (!path) return '';
		const inside = entries?.find((entry) => entry.path === path);
		if (inside) return path.slice(0, Math.max(0, path.lastIndexOf('/')));
		return path;
	});

	const crumbs = $derived.by(() => {
		const segments = here ? here.split('/') : [];
		return segments.map((segment, i) => ({
			label: segment,
			path: segments.slice(0, i + 1).join('/')
		}));
	});

	/** Keep the author when re-scoping: it is a view, not part of the address. */
	function scope(to: string): string {
		return logHref(repo, hrefRev, to, { author });
	}
</script>

<div class="scope">
	<a class="item root" class:on={!path} href={scope('')}>
		<Icon name="commit" />
		<span class="lbl">Whole repository</span>
	</a>

	{#each crumbs as crumb (crumb.path)}
		<a class="item" class:on={path === crumb.path} href={scope(crumb.path)}>
			<Icon name="folder" />
			<span class="lbl mono">{crumb.label}</span>
		</a>
	{/each}

	{#if entries}
		<div class="list">
			{#each entries as entry (entry.path)}
				{#if entry.type !== 'commit'}
					<a
						class="item entry"
						class:on={path === entry.path}
						aria-current={path === entry.path ? 'true' : undefined}
						href={scope(entry.path)}
						title="Scope the log to {entry.path}"
					>
						<Icon name={entry.type === 'tree' ? 'folder' : 'file'} />
						<span class="lbl mono">{entry.name}</span>
					</a>
				{/if}
			{/each}
		</div>
	{:else if loading}
		<p class="hint">Loading the directory…</p>
	{/if}

	<div class="head">Authors</div>
	{#if authors.length === 0}
		<p class="hint">{loading ? '…' : 'No commits loaded.'}</p>
	{:else}
		{#each authors as who (who.name)}
			{@const on = author === who.name}
			<a
				class="item who"
				class:on
				aria-current={on ? 'true' : undefined}
				href={logHref(repo, hrefRev, path, { author: on ? null : who.name })}
				title={on ? 'Show every author again' : `Show only commits by ${who.name}`}
			>
				<span class="lbl">{who.name}</span>
				<span class="n">{count(who.count)}</span>
			</a>
		{/each}
	{/if}
</div>

<style>
	.scope {
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

	.entry {
		padding-left: 14px;
	}

	.list {
		display: flex;
		flex-direction: column;
		gap: 1px;
		/* Long directories stay a sidebar rather than becoming the sidebar. */
		max-height: 260px;
		overflow-y: auto;
		margin: 2px -4px;
		padding: 0 4px;
	}

	.head {
		font-size: 11px;
		font-weight: 500;
		color: var(--tx3);
		padding: 14px 6px 4px;
	}

	.n {
		margin-left: auto;
		font-size: 11px;
		color: var(--tx3);
		font-variant-numeric: tabular-nums;
		flex: none;
	}

	.hint {
		margin: 0;
		padding: 2px 6px;
		font-size: 12px;
		color: var(--tx3);
	}
</style>

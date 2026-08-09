<script lang="ts">
	import { logHref } from '$lib/nav/paths';
	import { type RepoRef } from '$lib/source';
	import { count } from '$lib/ui/format';
	import type { AuthorTally } from './authors';

	/**
	 * The sidebar's contextual section on the Log screen — the author filter, and
	 * only the author filter.
	 *
	 * It used to lead with a scope picker: the directory the log is scoped to,
	 * its ancestors, and a listing of everything beside it, so the log could be
	 * moved sideways from here. That was a second file tree, on a screen whose
	 * subject is history rather than files, and it pushed the one control that
	 * belongs here below the fold. Re-scoping is still a click — the breadcrumb
	 * walks the path, and the Tree and File screens' `Log` verbs arrive already
	 * scoped — so what it cost was a sidebar full of things the screen was not
	 * about.
	 *
	 * What is left is a filter, not a scope, and the difference is the reason it
	 * is shaped this way. **Author narrows what is already loaded**, instantly,
	 * and the count beside each name says exactly how far that reaches — as
	 * against a path, which changes the address, the query GitHub answers, and
	 * the total the screen reports.
	 */
	interface Props {
		repo: RepoRef;
		/** The revision links carry. `null` addresses the default branch. */
		hrefRev: string | null;
		/** The path the log is scoped to, `''` for the whole repository. */
		path: string;
		authors: readonly AuthorTally[];
		author: string | null;
		loading?: boolean;
	}

	let { repo, hrefRev, path, authors, author, loading = false }: Props = $props();
</script>

<div class="authors">
	{#if authors.length === 0}
		<p class="hint">{loading ? '…' : 'No commits loaded.'}</p>
	{:else}
		{#each authors as who (who.name)}
			{@const on = author === who.name}
			<a
				class="item"
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
	.authors {
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

	.hint {
		margin: 0;
		padding: 2px 6px;
		font-size: 12px;
		color: var(--tx3);
	}
</style>

<script lang="ts">
	import { commitHref, compareHref } from '$lib/nav/paths';
	import { refAuthor, type CompareResult, type RefEntry, type RepoRef } from '$lib/source';
	import type { SourceError } from '$lib/source/errors';
	import Pill from '$lib/ui/Pill.svelte';
	import { ago, count } from '$lib/ui/format';
	import { formatShortlog, shortlog } from './shortlog';

	/**
	 * The selected ref, below the table — DESIGN.md §5's Tag block: "mono
	 * version, age and SHA pills, then the shortlog in a `<pre>` at 11.5px".
	 *
	 * It fills in two beats for the same reason the log's commit pane does.
	 * Everything the refs query already carries — the name, the tip commit, the
	 * tag's own message, ahead and behind — is on screen the instant the
	 * selection moves. The shortlog is a second read and it waits for the cursor
	 * to stop, because walking a tag list with `j` must not be one comparison
	 * per row.
	 *
	 * The comparison it waits for is the phase's whole argument. A tag is
	 * compared with the tag before it, which is what shipped in that release; a
	 * branch is compared with the default branch, which is what is in flight on
	 * it. Same read, different endpoints — see `compare.ts`.
	 */
	interface Props {
		repo: RepoRef;
		entry: RefEntry;
		/** What the comparison is against, and what to call it. */
		base: { label: string; oid: string } | null;
		comparison: CompareResult | null;
		loading?: boolean;
		error?: SourceError | null;
		/** Why there is no comparison to make, when there is not. */
		reason?: string | null;
		isDefault?: boolean;
	}

	let {
		repo,
		entry,
		base,
		comparison,
		loading = false,
		error = null,
		reason = null,
		isDefault = false
	}: Props = $props();

	const groups = $derived(comparison ? shortlog(comparison.commits) : []);
	const block = $derived(formatShortlog(groups));

	/** The tag's own message, which is the part a lightweight tag does not have. */
	const annotation = $derived(entry.annotation?.message.trim() ?? '');
</script>

<section class="detail" aria-label="Selected ref">
	<div class="top">
		<span class="name mono">{entry.name}</span>
		<Pill mono title={entry.committedDate}>{ago(entry.committedDate)}</Pill>
		<a class="shapill" href={commitHref(repo, entry.oid)} title={entry.headline}>
			<Pill mono tone="accent">{entry.abbreviatedOid}</Pill>
		</a>
		{#if isDefault}
			<Pill title="This repository's default branch">default</Pill>
		{:else if entry.ahead !== null && entry.behind !== null}
			<!-- Greyscale, not green and red: DESIGN.md §3 spends those on diff
			     state and nowhere else. The numbers carry their own meaning and
			     the title says it in words. -->
			<Pill
				mono
				title="{entry.ahead} commits {base?.label ??
					'the default branch'} does not have, {entry.behind} it has that this does not"
			>
				↑{count(entry.ahead)} ↓{count(entry.behind)}
			</Pill>
		{/if}
		<span class="head">{entry.headline}</span>
		<span class="by">{refAuthor(entry)}</span>
		{#if base}
			<a class="open" href={compareHref(repo, base.oid, entry.oid)}>
				{base.label}…{entry.name}
			</a>
		{/if}
	</div>

	<div class="halves">
		{#if annotation}
			<pre class="body">{annotation}</pre>
		{/if}

		<div class="log" class:wide={!annotation}>
			{#if comparison}
				{#if comparison.commits.length === 0}
					<p class="hint">
						Nothing between {base?.label} and {entry.name} — they are the same commit.
					</p>
				{:else}
					<p class="tally">
						{count(comparison.totalCommits)}
						{comparison.totalCommits === 1 ? 'commit' : 'commits'}
						since {base?.label}
						{#if comparison.truncated}
							· GitHub sent the first {count(comparison.commits.length)}
						{/if}
					</p>
					<!-- A shortlog is read as a block, not as rows: it is the one place
					     in the app where alignment carries the meaning. -->
					<pre class="shortlog mono">{block}</pre>
				{/if}
			{:else if error}
				<p class="hint">{error.message}</p>
			{:else if reason}
				<p class="hint">{reason}</p>
			{:else if loading}
				<p class="hint">Reading what changed since {base?.label ?? 'the previous ref'}…</p>
			{/if}
		</div>
	</div>
</section>

<style>
	.detail {
		border-top: 1px solid var(--bd);
		background: var(--side);
		display: flex;
		flex-direction: column;
		min-height: 0;
		flex: none;
		/* A pane, not a second screen: the table keeps most of the height. */
		height: 210px;
		max-height: 44%;
	}

	.top {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px var(--pad-main);
		flex: none;
		min-width: 0;
	}

	.name {
		font-size: 13px;
		color: var(--tx);
		font-weight: 500;
		flex: none;
		max-width: 30%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.shapill {
		flex: none;
		display: inline-flex;
	}

	.head {
		font-size: 12px;
		color: var(--tx2);
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.by {
		font-size: 12px;
		color: var(--tx3);
		flex: none;
	}

	.open {
		margin-left: auto;
		font-size: 12px;
		color: var(--tx2);
		flex: none;
		padding: 3px 8px;
		border-radius: var(--radius-item);
		font-family: var(--font-mono);
		max-width: 34%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		transition:
			color 120ms,
			background-color 120ms;
	}

	.open:hover {
		background: var(--hover);
		color: var(--tx);
	}

	.halves {
		display: flex;
		flex: 1;
		min-height: 0;
		border-top: 1px solid var(--bd);
	}

	.body {
		margin: 0;
		padding: 8px var(--pad-main);
		font-family: inherit;
		font-size: 11.5px;
		line-height: 1.5;
		color: var(--tx2);
		white-space: pre-wrap;
		flex: 0 1 46ch;
		min-width: 0;
		overflow-y: auto;
		border-right: 1px solid var(--bd);
	}

	.log {
		flex: 1;
		min-width: 0;
		overflow: auto;
		padding: 4px 0 8px;
	}

	.log.wide {
		flex: 1 1 100%;
	}

	.tally {
		margin: 0;
		padding: 4px var(--pad-main);
		font-size: 11px;
		color: var(--tx3);
		font-variant-numeric: tabular-nums;
	}

	.shortlog {
		margin: 0;
		padding: 0 var(--pad-main) 4px;
		font-size: 11.5px;
		line-height: 1.6;
		color: var(--tx2);
		white-space: pre;
	}

	.hint {
		margin: 0;
		padding: 4px var(--pad-main);
		font-size: 12px;
		color: var(--tx3);
	}
</style>

<script lang="ts">
	import { lineHash, within, type LineRange } from '$lib/nav/lines';
	import VirtualRows from '$lib/ui/VirtualRows.svelte';
	import CodeLine from './CodeLine.svelte';
	import { blameAuthor, type BlameLine } from './blame';
	import { widestLine, type Highlighter } from './highlight';
	import { ago } from '$lib/ui/format';

	/**
	 * The code viewer — PLAN.md Phase 4. Line numbers, an optional blame gutter,
	 * and source, virtualised.
	 *
	 * **Two gutters that stay put.** DESIGN.md §7 is explicit that code must not
	 * reflow — wrapping is a reading regression — so a long line scrolls the
	 * column sideways. Both gutters are `position: sticky` against that scroll,
	 * so the line you are reading keeps its number and its author however far
	 * right you go.
	 *
	 * **Blame runs collapse.** A line whose commit matches the line above renders
	 * an empty cell, so authorship reads as blocks (DESIGN.md §5). Only the first
	 * line of a run is a link, which also keeps the tab order to one stop per
	 * author rather than one per line.
	 *
	 * **The selection tints the source, not the gutters.** A translucent fill
	 * painted on a row and again on a sticky child inside it composites twice and
	 * bands. So the gutters stay opaque and the line number carries the selection
	 * as an inset rule — which is a second, non-colour carrier for it anyway
	 * (DESIGN.md §9).
	 */
	interface Props {
		code: Highlighter;
		/** One entry per line, or `null` for no gutter. Index 0 is line 1. */
		blame?: (BlameLine | null)[] | null;
		/** The addressed line or range — what `#L204-L219` resolves to. */
		selection?: LineRange | null;
		/** The keyboard's line, 1-based. Unset until `j` or `k` moves it. */
		cursor?: number | null;
		/** A line number was clicked. `extend` is a shift-click. */
		onpick?: (line: number, extend: boolean) => void;
		/** Where a blame entry's commit lives. Phase 5 makes this internal. */
		commitHref?: (oid: string) => string;
		/** Line to keep in view, 1-based. */
		reveal?: number | null;
	}

	let {
		code,
		blame = null,
		selection = null,
		cursor = null,
		onpick,
		commitHref,
		reveal = null
	}: Props = $props();

	/** DESIGN.md §2 gives code 12px at 1.6; the row is that, rounded to a
	    whole pixel so a virtualised window never drifts against its own maths. */
	const ROW = 20;

	const lines = $derived(code.lines);
	const widest = $derived(widestLine(lines));

	function pick(event: MouseEvent, line: number): void {
		// The href stays for copy-link-address and middle click; the click itself
		// is ours, so a range can be shift-extended and the URL replaced rather
		// than pushed — clicking twenty lines should not be twenty steps back.
		event.preventDefault();
		onpick?.(line, event.shiftKey);
	}
</script>

<div class="code mono" style:--code-w="{widest}ch" style:--code-row="{ROW}px">
	<VirtualRows items={lines} rowHeight={ROW} reveal={reveal === null ? null : reveal - 1}>
		{#snippet row(text: string, index: number)}
			{@const n = index + 1}
			{@const mark = blame?.[index] ?? null}
			<div class="row" id="L{n}">
				<a
					class="ln"
					class:pick={within(selection, n)}
					href={lineHash({ from: n, to: n })}
					aria-label="Line {n}"
					onclick={(event) => pick(event, n)}
				>
					{n}
				</a>

				{#if blame}
					{#if mark && mark.first}
						<a
							class="bl"
							href={commitHref?.(mark.commit.oid) ?? '#'}
							target="_blank"
							rel="noopener noreferrer external"
							title="{mark.commit.headline} — {blameAuthor(mark.commit)}, {ago(
								mark.commit.committedDate
							)} ago"
						>
							<span class="sha">{mark.commit.abbreviatedOid}</span>
							<span class="who">{blameAuthor(mark.commit)}</span>
							<span class="when">{ago(mark.commit.committedDate)}</span>
						</a>
					{:else}
						<span class="bl run" aria-hidden="true"></span>
					{/if}
				{/if}

				<code class="src" class:pick={within(selection, n)} class:at={cursor === n}>
					<CodeLine {text} tokens={code.tokens(index)} />
				</code>
			</div>
		{/snippet}

		{#snippet empty()}
			<p class="none">This file is empty.</p>
		{/snippet}
	</VirtualRows>
</div>

<style>
	.code {
		/* Wide enough for the longest line in the file, and never narrower than
		   the column — so a short file still fills it and a long one scrolls. */
		width: max-content;
		min-width: 100%;
		font-size: 12px;
		line-height: var(--code-row);
		tab-size: 4;
	}

	.row {
		display: flex;
		align-items: stretch;
		height: var(--code-row);
	}

	.ln,
	.bl {
		/* Opaque, and pinned against the horizontal scroll. */
		position: sticky;
		background: var(--panel);
		flex: none;
		color: var(--tx3);
		font-size: 11px;
		user-select: none;
	}

	.ln {
		left: 0;
		z-index: 2;
		width: var(--gutter-ln);
		padding-right: 10px;
		text-align: right;
		font-variant-numeric: tabular-nums;
		transition: color 120ms;
	}

	.ln:hover {
		color: var(--tx);
	}

	/* The selection's second carrier: a rule in the gutter, not colour alone. */
	.ln.pick {
		color: var(--acc-tx);
		box-shadow: inset 2px 0 0 var(--acc);
	}

	.bl {
		left: var(--gutter-ln);
		z-index: 1;
		width: var(--gutter-blame);
		display: flex;
		align-items: center;
		gap: 6px;
		padding-right: 10px;
		border-right: 1px solid var(--bd);
		overflow: hidden;
		white-space: nowrap;
	}

	.sha {
		color: var(--tx2);
		flex: none;
	}

	.who {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.when {
		flex: none;
	}

	a.bl:hover .sha,
	a.bl:hover .who {
		color: var(--tx);
	}

	.src {
		flex: 1 0 auto;
		min-width: var(--code-w);
		padding: 0 var(--pad-main) 0 12px;
		color: var(--tx);
		white-space: pre;
		transition: background-color 120ms;
	}

	.row:hover .src {
		background: var(--hover);
	}

	/* Keyboard and mouse selection look identical — DESIGN.md §6. */
	.src.at {
		background: var(--sel);
	}

	/* The addressed line is the thing you were sent to: indigo, per
	   DESIGN.md §3's "this concerns you". */
	.src.pick,
	.row:hover .src.pick {
		background: var(--acc-bg);
	}

	.none {
		margin: 0;
		padding: 12px var(--pad-main);
		font-size: 12px;
		color: var(--tx3);
	}

	@media (max-width: 780px) {
		.bl {
			display: none;
		}
	}
</style>

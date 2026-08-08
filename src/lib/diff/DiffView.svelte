<script lang="ts">
	import { fileAnchor } from '$lib/nav/paths';
	import type { ChangedFile } from '$lib/source';
	import VirtualRows from '$lib/ui/VirtualRows.svelte';
	import DeltaBar from '$lib/ui/DeltaBar.svelte';
	import { count } from '$lib/ui/format';
	import { parsePatch, type DiffLine } from './parse';

	/**
	 * A unified diff, virtualised — DESIGN.md §5: a sign column, row-level tint
	 * from `--ok-bg` / `--no-bg`, and hunk headers on `--side`.
	 *
	 * Every file in the commit is flattened into **one** list of fixed-height
	 * rows — file headers, hunk headers and lines alike — rather than a
	 * virtualised list per file. That is what keeps a 40-file commit to one
	 * scroller and one window, and it is why a file header is a 20px row like
	 * everything else: a virtualised list drifts against its own arithmetic the
	 * moment two rows disagree about their height.
	 *
	 * Two number gutters and the sign column are `position: sticky` against the
	 * horizontal scroll, for the same reason the code viewer's are — DESIGN.md §7
	 * says code must not reflow, so a long line scrolls sideways and the line you
	 * are reading has to keep its numbers.
	 *
	 * Syntax highlighting is deliberately absent here. Our scanner carries state
	 * from one line to the next, and a hunk is a handful of lines cut out of a
	 * file with the rest missing — so the state at the top of a hunk is unknown,
	 * and a highlighter run over it would confidently colour the wrong things.
	 * A missing colour is a subset; a wrong one is a lie.
	 */
	interface Props {
		files: readonly ChangedFile[];
		/** Path to bring into view — what an `#f-…` anchor resolves to. */
		reveal?: string | null;
		/** Where a file's own bytes live, for what we cannot render inline. */
		fileHref?: (file: ChangedFile) => string;
		/** Where a file's whole patch lives on github.com. */
		outHref?: (file: ChangedFile) => string;
	}

	let { files, reveal = null, fileHref, outHref }: Props = $props();

	/** DESIGN.md §2 gives code 12px at 1.6, rounded to a whole pixel. */
	const ROW = 20;

	type Row =
		| { kind: 'file'; file: ChangedFile }
		| { kind: 'hunk'; header: string; heading: string }
		| { kind: 'line'; line: DiffLine }
		| { kind: 'stop'; file: ChangedFile; text: string };

	const rows = $derived.by<Row[]>(() => {
		const out: Row[] = [];

		for (const file of files) {
			out.push({ kind: 'file', file });

			if (file.patch === null) {
				out.push({
					kind: 'stop',
					file,
					text:
						file.additions === 0 && file.deletions === 0
							? 'Binary file — there is no patch to show.'
							: 'GitHub did not inline a patch for this file. It is too large.'
				});
				continue;
			}

			for (const hunk of parsePatch(file.patch)) {
				out.push({ kind: 'hunk', header: hunk.header, heading: hunk.heading });
				for (const line of hunk.lines) out.push({ kind: 'line', line });
			}
		}

		return out;
	});

	/**
	 * A file header may not be rendered when its anchor is followed, so getting
	 * there is arithmetic on a row index rather than a call to `scrollIntoView`
	 * on an element that does not exist yet — the same trick as a deep link to
	 * a line in a 20,000-line file.
	 */
	const revealAt = $derived.by(() => {
		if (!reveal) return null;
		const at = rows.findIndex((row) => row.kind === 'file' && row.file.path === reveal);
		return at === -1 ? null : at;
	});

	/** The widest line in the diff, so the column stops jumping as it scrolls. */
	const widest = $derived.by(() => {
		let widest = 40;
		for (const row of rows) {
			if (row.kind !== 'line') continue;
			const width = row.line.text.length;
			if (width > widest) widest = width;
		}
		return widest;
	});

	const MARK: Record<ChangedFile['status'], string> = {
		added: 'added',
		removed: 'deleted',
		modified: 'modified',
		renamed: 'renamed',
		copied: 'copied',
		changed: 'modified',
		unchanged: 'unchanged'
	};

	const SIGN: Record<DiffLine['kind'], string> = { add: '+', del: '−', ctx: ' ', note: ' ' };
</script>

<div class="diff mono" style:--diff-w="{widest}ch" style:--diff-row="{ROW}px">
	<VirtualRows items={rows} rowHeight={ROW} reveal={revealAt}>
		{#snippet row(item: Row)}
			{#if item.kind === 'file'}
				<div class="frow" id={fileAnchor(item.file.path)}>
					<span class="fpath">{item.file.path}</span>
					{#if item.file.previousPath}
						<span class="was">← {item.file.previousPath}</span>
					{/if}
					<span class="fstat">{MARK[item.file.status]}</span>
					<DeltaBar additions={item.file.additions} deletions={item.file.deletions} />
					<span class="fnum">
						<b class="add">+{count(item.file.additions)}</b>
						<b class="del">−{count(item.file.deletions)}</b>
					</span>
					{#if fileHref}
						<a class="fout" href={fileHref(item.file)}>View file</a>
					{/if}
				</div>
			{:else if item.kind === 'hunk'}
				<div class="hrow">
					<span class="hhead">{item.header}</span>
					{#if item.heading}<span class="hwhat">{item.heading}</span>{/if}
				</div>
			{:else if item.kind === 'stop'}
				<div class="srow">
					<span>{item.text}</span>
					{#if outHref}
						<a href={outHref(item.file)} target="_blank" rel="noopener noreferrer external">
							Open it on github.com
						</a>
					{/if}
				</div>
			{:else}
				{@const line = item.line}
				<div class="lrow {line.kind}">
					<span class="ln old">{line.old ?? ''}</span>
					<span class="ln new">{line.new ?? ''}</span>
					<!-- Colour is never the sole carrier of meaning — DESIGN.md §9. -->
					<span class="sign" aria-hidden={line.kind === 'ctx' ? 'true' : undefined}>
						{SIGN[line.kind]}
					</span>
					<code class="src">{line.text}</code>
				</div>
			{/if}
		{/snippet}

		{#snippet empty()}
			<p class="none">This commit changed no files.</p>
		{/snippet}
	</VirtualRows>
</div>

<style>
	.diff {
		width: max-content;
		min-width: 100%;
		font-size: 12px;
		line-height: var(--diff-row);
		tab-size: 4;
	}

	.frow,
	.hrow,
	.srow,
	.lrow {
		display: flex;
		align-items: center;
		height: var(--diff-row);
	}

	/* A file's own header. Sticky against the horizontal scroll like the
	   gutters, so it does not slide away when a long line is read. */
	.frow,
	.hrow,
	.srow {
		position: sticky;
		left: 0;
		width: max-content;
		min-width: 100%;
		max-width: 100vw;
		gap: 10px;
		padding: 0 var(--pad-main);
		background: var(--side);
		border-top: 1px solid var(--bd);
		border-bottom: 1px solid var(--bd);
	}

	.fpath {
		color: var(--tx);
		font-weight: 500;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.was,
	.fstat {
		font-size: 11px;
		color: var(--tx3);
		flex: none;
		white-space: nowrap;
	}

	.fnum {
		display: flex;
		gap: 6px;
		font-size: 11px;
		flex: none;
	}

	.fout {
		margin-left: auto;
		font-size: 11px;
		color: var(--tx3);
		flex: none;
		transition: color 120ms;
	}

	.fout:hover {
		color: var(--tx);
	}

	.hrow {
		border-top: none;
		gap: 12px;
	}

	.hhead {
		color: var(--acc-tx);
		font-size: 11px;
		flex: none;
	}

	.hwhat {
		color: var(--tx3);
		font-size: 11px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.srow {
		color: var(--tx3);
		font-size: 11px;
		border-top: none;
	}

	.srow a {
		color: var(--acc-tx);
	}

	/* Both gutters and the sign stay opaque and pinned, so a line keeps its
	   numbers however far right the source scrolls. */
	.ln,
	.sign {
		position: sticky;
		flex: none;
		background: var(--panel);
		color: var(--tx3);
		font-size: 11px;
		user-select: none;
		text-align: right;
		font-variant-numeric: tabular-nums;
	}

	.ln {
		width: var(--gutter-diff);
		padding-right: 8px;
	}

	.old {
		left: 0;
		z-index: 3;
	}

	.new {
		left: var(--gutter-diff);
		z-index: 2;
	}

	.sign {
		left: calc(var(--gutter-diff) * 2);
		z-index: 1;
		width: 14px;
		text-align: center;
		border-right: 1px solid var(--bd);
	}

	.src {
		flex: 1 0 auto;
		min-width: var(--diff-w);
		padding: 0 var(--pad-main) 0 10px;
		color: var(--tx);
		white-space: pre;
	}

	.add .src {
		background: var(--ok-bg);
	}

	.add .sign {
		color: var(--ok);
	}

	.del .src {
		background: var(--no-bg);
	}

	.del .sign {
		color: var(--no);
	}

	.note .src {
		color: var(--tx3);
	}

	.none {
		margin: 0;
		padding: 12px var(--pad-main);
		font-size: 12px;
		color: var(--tx3);
	}
</style>

<script lang="ts">
	import type { Snippet } from 'svelte';
	import { fileAnchor } from '$lib/nav/paths';
	import type { ChangedFile } from '$lib/source';
	import VirtualRows from '$lib/ui/VirtualRows.svelte';
	import DeltaBar from '$lib/ui/DeltaBar.svelte';
	import { count } from '$lib/ui/format';
	import DiffText from './DiffText.svelte';
	import { noteKey, type DiffNote } from './notes';
	import { parsePatch, type DiffLine } from './parse';

	/**
	 * A unified diff, virtualised — DESIGN.md §5: a sign column, row-level tint
	 * from `--ok-bg` / `--no-bg`, and hunk headers on `--side`.
	 *
	 * **The tint runs the whole row, and the words that changed are brighter
	 * still.** A sign is one character in a 14px column, and reading a diff by
	 * it means reading every line to find the handful that moved. So the green
	 * and the red run from the line numbers to the end of the source, and where
	 * a removed line has a counterpart on the other side, the runs of text that
	 * actually differ take a second layer of the same colour — which is what
	 * turns "this line changed" into "this word changed" without a second read.
	 * `words.ts` decides which; this only paints them.
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
		/**
		 * Markers on lines, keyed by `noteKey()`. Phase 7's review threads; the
		 * diff itself stays a renderer of patches and knows nothing about them.
		 */
		notes?: ReadonlyMap<string, DiffNote>;
		/** The marker currently open, so it can be shown as selected. */
		activeNote?: string | null;
		/** A note key to bring into view. The thread list's `enter`. */
		revealNote?: string | null;
		onnote?: (id: string) => void;
		/**
		 * Files shown as a header row only — Phase 7's mark-viewed. Collapsing is
		 * what keeps the flat list flat: a hidden file is fewer rows, not a row of
		 * a different height.
		 */
		collapsed?: ReadonlySet<string>;
		/** Extra controls in a file's header row, right of the counts. */
		fileExtra?: Snippet<[ChangedFile]>;
	}

	let {
		files,
		reveal = null,
		fileHref,
		outHref,
		notes,
		activeNote = null,
		revealNote = null,
		onnote,
		collapsed,
		fileExtra
	}: Props = $props();

	/** DESIGN.md §2 gives code 12px at 1.6, rounded to a whole pixel. */
	const ROW = 20;

	type Row =
		| { kind: 'file'; file: ChangedFile }
		| { kind: 'hunk'; header: string; heading: string }
		| { kind: 'line'; line: DiffLine; path: string }
		| { kind: 'stop'; file: ChangedFile; text: string };

	const rows = $derived.by<Row[]>(() => {
		const out: Row[] = [];

		for (const file of files) {
			out.push({ kind: 'file', file });

			// A viewed file keeps its header and loses its body. The header still
			// carries the counts and the control that brings it back.
			if (collapsed?.has(file.path)) continue;

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
				for (const line of hunk.lines) out.push({ kind: 'line', line, path: file.path });
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
		if (revealNote) {
			const at = rows.findIndex((row) => row.kind === 'line' && keyOf(row) === revealNote);
			if (at !== -1) return at;
		}
		if (!reveal) return null;
		const at = rows.findIndex((row) => row.kind === 'file' && row.file.path === reveal);
		return at === -1 ? null : at;
	});

	/**
	 * A line's marker key. A row can carry a number on both sides, and a thread
	 * is anchored to exactly one of them — the new side is checked first because
	 * that is where all but deletion comments live.
	 */
	function keyOf(row: Extract<Row, { kind: 'line' }>): string | null {
		if (!notes) return null;
		if (row.line.new !== null) {
			const key = noteKey(row.path, 'new', row.line.new);
			if (notes.has(key)) return key;
		}
		if (row.line.old !== null) {
			const key = noteKey(row.path, 'old', row.line.old);
			if (notes.has(key)) return key;
		}
		return null;
	}

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
				<div
					class="frow"
					class:shut={collapsed?.has(item.file.path)}
					id={fileAnchor(item.file.path)}
				>
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
					<span class="fright">
						{#if fileHref}
							<a class="fout" href={fileHref(item.file)}>View file</a>
						{/if}
						{#if fileExtra}{@render fileExtra(item.file)}{/if}
					</span>
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
				{@const key = keyOf(item)}
				{@const note = key ? notes?.get(key) : null}
				<div class="lrow {line.kind}" class:noted={note} class:onnote={key === activeNote}>
					<span class="ln old">{line.old ?? ''}</span>
					<span class="ln new">{line.new ?? ''}</span>
					<!-- Colour is never the sole carrier of meaning — DESIGN.md §9. -->
					<span class="sign" aria-hidden={line.kind === 'ctx' ? 'true' : undefined}>
						{SIGN[line.kind]}
					</span>
					<code class="src"><DiffText text={line.text} words={line.words} /></code>
					{#if note && key}
						<button
							class="note {note.tone}"
							class:on={key === activeNote}
							title={note.title}
							onclick={() => onnote?.(note.id)}
						>
							{note.label}
						</button>
					{/if}
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

	.fright {
		margin-left: auto;
		display: flex;
		align-items: center;
		gap: 10px;
		flex: none;
	}

	.fout {
		font-size: 11px;
		color: var(--tx3);
		flex: none;
		transition: color 120ms;
	}

	.fout:hover {
		color: var(--tx);
	}

	/* A collapsed file is still a file: same row, same height, quieter path. */
	.frow.shut .fpath {
		color: var(--tx2);
		font-weight: 400;
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

	/*
	 * A changed row is tinted end to end. The source takes the translucent fill
	 * over `--panel`; the gutters and the sign, which are opaque because they
	 * are sticky over the source, take the same colour already flattened. The
	 * two must be kept in step — see `--ok-row` in `app.css`.
	 */
	.add .src {
		background: var(--ok-line);
	}

	.add .ln,
	.add .sign {
		background: var(--ok-row);
	}

	.add .sign {
		color: var(--ok);
	}

	.del .src {
		background: var(--no-line);
	}

	.del .ln,
	.del .sign {
		background: var(--no-row);
	}

	.del .sign {
		color: var(--no);
	}

	/* Which of the two the word-level emphasis is drawn in. `DiffText` reads it
	   and never learns which side of the diff it is rendering. */
	.add {
		--diff-word: var(--ok-word);
	}

	.del {
		--diff-word: var(--no-word);
	}

	.note .src {
		color: var(--tx3);
	}

	/*
	 * A line somebody commented on. The marker sits after the source rather than
	 * in a gutter of its own, so the sign column keeps its width and a diff with
	 * no threads in it measures exactly as it did before Phase 7.
	 */
	.note {
		position: sticky;
		right: 0;
		flex: none;
		margin-left: 10px;
		height: 14px;
		padding: 0 6px;
		border-radius: var(--radius-pill);
		font-size: 10px;
		line-height: 14px;
		font-family: var(--font-mono);
		border: 1px solid transparent;
		transition:
			color 120ms,
			background-color 120ms,
			border-color 120ms;
	}

	.note.accent {
		background: var(--acc-bg);
		color: var(--acc-tx);
	}

	/* Amber is unresolved — DESIGN.md §3 spends it on exactly that and on a
	   force push you have not seen. */
	.note.warn {
		background: var(--wn);
		color: var(--bg);
	}

	.note.muted {
		background: var(--raise);
		color: var(--tx3);
	}

	.note:hover,
	.note.on {
		border-color: var(--bd2);
	}

	/* The anchored line reads as selected while its thread is open. Not colour
	   alone: the marker takes a border at the same moment. */
	.lrow.onnote .src {
		background: var(--sel);
	}

	.none {
		margin: 0;
		padding: 12px var(--pad-main);
		font-size: 12px;
		color: var(--tx3);
	}
</style>

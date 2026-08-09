<script lang="ts">
	import type { ReviewThread } from '$lib/source';
	import { count } from '$lib/ui/format';

	/**
	 * The sidebar's contextual section on the Review screen — DESIGN.md §5 names
	 * it `Threads`, and it is the only one of the four headings that had no
	 * screen until now.
	 *
	 * It is the triage half of the conversation: every thread in the pull
	 * request, in the order the code is in, with the unresolved ones marked. The
	 * diff beside it is where a thread is *read*; this is where you find out
	 * there are four of them and one is still open. A sidebar that repeated the
	 * thread cards would be a second copy of the screen — the same argument
	 * `Kinds.svelte` makes about the refs list.
	 *
	 * Threads whose line has moved are still listed, and still say so. They are
	 * the ones most likely to be forgotten and most likely to matter.
	 */
	interface Props {
		threads: readonly ReviewThread[];
		selected: string | null;
		onselect: (id: string) => void;
		/** Threads exist beyond the page we asked for. Said, not hidden. */
		more?: boolean;
		loading?: boolean;
	}

	let { threads, selected, onselect, more = false, loading = false }: Props = $props();

	const open = $derived(threads.filter((thread) => !thread.isResolved).length);

	/** The file name alone; the path is in the title, where it has room. */
	function leaf(path: string): string {
		return path.split('/').pop() ?? path;
	}

	function at(thread: ReviewThread): string {
		const line = thread.line ?? thread.originalLine;
		return line === null ? '—' : `${thread.side === 'LEFT' ? '−' : '+'}${line}`;
	}
</script>

{#if threads.length === 0}
	<p class="hint">{loading ? 'Reading the conversation…' : 'Nobody has commented on the code.'}</p>
{:else}
	<div class="tally">
		{#if open > 0}
			<b>{count(open)}</b> unresolved of {count(threads.length)}
		{:else}
			All {count(threads.length)} resolved
		{/if}
	</div>

	<!-- A named group, because these are the screen's one cursor and a reader
	     tabbing into the sidebar should be told what they have arrived in. -->
	<div class="rows" role="group" aria-label="Review threads">
		{#each threads as thread (thread.id)}
			<button
				class="row"
				class:on={selected === thread.id}
				class:done={thread.isResolved}
				aria-current={selected === thread.id ? 'true' : undefined}
				title="{thread.path} — {thread.comments[0]?.authorLogin ?? 'unknown'}"
				onclick={() => onselect(thread.id)}
			>
				<!-- Colour is never the sole carrier — the dot has a title and the
				     resolved rows are dimmed and struck through their line number. -->
				<span
					class="dot"
					class:open={!thread.isResolved}
					title={thread.isResolved ? 'Resolved' : 'Unresolved'}
				></span>
				<span class="name mono">{leaf(thread.path)}</span>
				<span class="at mono" class:moved={thread.line === null}>{at(thread)}</span>
			</button>
		{/each}
	</div>

	{#if more}
		<p class="hint">Only the first {count(threads.length)} threads were read.</p>
	{/if}
{/if}

<style>
	.tally {
		font-size: 11px;
		color: var(--tx3);
		padding: 2px 6px 6px;
		font-variant-numeric: tabular-nums;
	}

	.tally b {
		color: var(--wn);
		font-weight: 500;
	}

	.rows {
		display: flex;
		flex-direction: column;
		gap: 1px;
	}

	.row {
		display: flex;
		align-items: center;
		gap: 6px;
		height: 24px;
		width: 100%;
		padding: 0 6px;
		border-radius: var(--radius-item);
		color: var(--tx2);
		text-align: left;
		min-width: 0;
		transition:
			color 120ms,
			background-color 120ms;
	}

	.row:hover {
		background: var(--hover);
		color: var(--tx);
	}

	.row.on {
		background: var(--sel);
		color: var(--tx);
	}

	.dot {
		width: 6px;
		height: 6px;
		border-radius: var(--radius-pill);
		background: var(--bd2);
		flex: none;
	}

	.dot.open {
		background: var(--wn);
	}

	.name {
		flex: 1;
		min-width: 0;
		font-size: 12px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.row.done .name {
		color: var(--tx3);
	}

	.at {
		flex: none;
		font-size: 10px;
		color: var(--tx3);
	}

	.at.moved {
		text-decoration: line-through;
	}

	.hint {
		margin: 0;
		padding: 2px 6px;
		font-size: 12px;
		color: var(--tx3);
	}
</style>

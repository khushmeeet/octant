<script lang="ts">
	import type { Span } from './words';

	/**
	 * One line of a diff, as alternating unchanged and changed runs.
	 *
	 * The row already carries its colour; this only says *where* on the row it
	 * belongs, from the spans `words.ts` resolved at parse time. The fill comes
	 * from `--diff-word`, which the row sets to the green or red the row is
	 * already tinted with — so the emphasis is always the same hue as the sign,
	 * and a component that knows nothing about which side it is on stays that
	 * way.
	 *
	 * Whitespace is load-bearing, exactly as in `code/CodeLine.svelte`:
	 * indentation arrives inside the dynamic text of a run, which Svelte never
	 * collapses, and `white-space: pre` on the host row renders it. There is
	 * deliberately no static whitespace in this template.
	 */
	interface Props {
		text: string;
		words?: readonly Span[];
	}

	let { text, words = [] }: Props = $props();

	const runs = $derived(split(text, words));

	function split(text: string, words: readonly Span[]): { text: string; on: boolean }[] {
		if (words.length === 0) return [{ text, on: false }];

		const out: { text: string; on: boolean }[] = [];
		let at = 0;

		for (const span of words) {
			if (span.start > at) out.push({ text: text.slice(at, span.start), on: false });
			out.push({ text: text.slice(span.start, span.end), on: true });
			at = span.end;
		}

		if (at < text.length) out.push({ text: text.slice(at), on: false });

		return out;
	}
</script>

{#each runs as run, i (i)}{#if run.on}<span class="w">{run.text}</span>{:else}{run.text}{/if}{/each}

<style>
	/*
	 * A second layer of the row's own tint, not a second colour: DESIGN.md §3
	 * spends green and red on added and removed, and "this part of the line" is
	 * not a third meaning. It is never the sole carrier of anything either —
	 * the sign column has already said which side the row is on.
	 */
	.w {
		background: var(--diff-word);
		border-radius: 2px;
	}
</style>

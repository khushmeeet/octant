<script lang="ts">
	import CodeLine from './CodeLine.svelte';
	import { highlighter, splitLines } from './highlight';
	import { grammarNamed } from './lang';

	/**
	 * A short, whole snippet — a fenced block in a README.
	 *
	 * Not virtualised, because a fenced block is a paragraph rather than a file,
	 * and not scrolled by itself either: the caller owns the box. This exists so
	 * that the highlighter chosen for the file screen serves the one other place
	 * in the app that renders source, rather than there being two answers to the
	 * same question.
	 */
	interface Props {
		text: string;
		/** A fence's info string: `ts`, `sh`, `svelte`. */
		lang?: string | null;
	}

	let { text, lang = null }: Props = $props();

	const lines = $derived(splitLines(text));
	const code = $derived(highlighter(lines, grammarNamed(lang)));
</script>

{#each lines as line, i (i)}<span class="cl"><CodeLine text={line} tokens={code.tokens(i)} /></span
	>{/each}

<style>
	.cl {
		display: block;
		white-space: pre;
		tab-size: 4;
		/* An empty line is still a line; without this it collapses to nothing. */
		min-height: 1.6em;
	}
</style>

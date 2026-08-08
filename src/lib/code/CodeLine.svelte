<script lang="ts">
	import { pieces } from './highlight';
	import type { Token } from './tokenize';

	/**
	 * One line of source, as alternating highlighted and plain runs.
	 *
	 * The four kinds are the four DESIGN.md §3 spends on syntax, and nothing
	 * here decides which is which — the scanner already did. This is only the
	 * mapping from a token kind to a CSS variable.
	 *
	 * Whitespace is load-bearing: indentation arrives inside the dynamic text of
	 * a piece, which Svelte never collapses, and `white-space: pre` on the host
	 * row renders it. There is deliberately no static whitespace in this
	 * template — a newline between the `{#each}` and the `<span>` would be a
	 * space in the middle of the source.
	 */
	interface Props {
		text: string;
		tokens?: readonly Token[];
	}

	let { text, tokens = [] }: Props = $props();

	const runs = $derived(pieces(text, tokens));
</script>

{#each runs as run, i (i)}{#if run.kind}<span class={run.kind}>{run.text}</span
		>{:else}{run.text}{/if}{/each}

<style>
	.kw {
		color: var(--kw);
	}

	.str {
		color: var(--str);
	}

	/* The only italic in the app, and the one place it belongs: a comment is
	   not the program. */
	.cm {
		color: var(--cm);
		font-style: italic;
	}

	.fn {
		color: var(--fn);
	}
</style>

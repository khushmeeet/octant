<script lang="ts">
	import type { Inline } from './parse';
	import Self from './MdInline.svelte';

	/**
	 * Inline nodes. Nothing here is `{@html}` — every node is a tag Svelte
	 * wrote, so a README cannot introduce markup we did not choose.
	 */
	interface Props {
		nodes: Inline[];
		/** Turns a README-relative href into one that resolves. */
		resolve?: (href: string) => string;
	}

	let { nodes, resolve }: Props = $props();

	function href(raw: string): string {
		return resolve ? resolve(raw) : raw;
	}
</script>

{#each nodes as node, i (i)}
	{#if node.kind === 'text'}{node.text}{:else if node.kind === 'code'}<code class="mono"
			>{node.text}</code
		>{:else if node.kind === 'strong'}<strong><Self nodes={node.children} {resolve} /></strong
		>{:else if node.kind === 'em'}<em><Self nodes={node.children} {resolve} /></em
		>{:else if node.kind === 'strike'}<del><Self nodes={node.children} {resolve} /></del
		>{:else if node.kind === 'link'}<a
			href={href(node.href)}
			target="_blank"
			rel="noopener noreferrer external"><Self nodes={node.children} {resolve} /></a
		>{:else if node.kind === 'image' && node.alt}<span class="img">{node.alt}</span>{/if}
{/each}

<style>
	code {
		font-size: 11.5px;
		background: var(--raise);
		border: 1px solid var(--bd);
		border-radius: 4px;
		padding: 0.5px 4px;
	}

	a {
		color: var(--acc-tx);
		transition: color 120ms;
	}

	a:hover {
		text-decoration: underline;
	}

	strong {
		font-weight: 600;
		color: var(--tx);
	}

	del {
		color: var(--tx3);
	}

	/* No illustrations — DESIGN.md §8. An image keeps its alt text and nothing
	   else, which also means a README never makes a network request. */
	.img {
		color: var(--tx3);
		font-style: italic;
	}
</style>

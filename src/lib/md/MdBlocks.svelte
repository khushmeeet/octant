<script lang="ts">
	import MdInline from './MdInline.svelte';
	import type { Block } from './parse';
	import Self from './MdBlocks.svelte';

	interface Props {
		blocks: Block[];
		resolve?: (href: string) => string;
	}

	let { blocks, resolve }: Props = $props();
</script>

{#each blocks as block, i (i)}
	{#if block.kind === 'heading'}
		<svelte:element this={`h${Math.min(block.level + 2, 6)}`} class="h h{block.level}">
			<MdInline nodes={block.children} {resolve} />
		</svelte:element>
	{:else if block.kind === 'paragraph'}
		<p><MdInline nodes={block.children} {resolve} /></p>
	{:else if block.kind === 'code'}
		<!-- Syntax highlighting is Phase 4, and it arrives for the file screen
		     first. Until then code reads as code because it is monospaced. -->
		<pre class="mono"><code>{block.text}</code></pre>
	{:else if block.kind === 'quote'}
		<blockquote><Self blocks={block.blocks} {resolve} /></blockquote>
	{:else if block.kind === 'list'}
		{#if block.ordered}
			<ol start={block.start}>
				{#each block.items as item, j (j)}
					<li><Self blocks={item} {resolve} /></li>
				{/each}
			</ol>
		{:else}
			<ul>
				{#each block.items as item, j (j)}
					<li><Self blocks={item} {resolve} /></li>
				{/each}
			</ul>
		{/if}
	{:else if block.kind === 'table'}
		<div class="scroll">
			<table>
				<thead>
					<tr>
						{#each block.head as cell, c (c)}
							<th style:text-align={block.align[c] ?? 'left'}>
								<MdInline nodes={cell} {resolve} />
							</th>
						{/each}
					</tr>
				</thead>
				<tbody>
					{#each block.rows as row, r (r)}
						<tr>
							{#each row as cell, c (c)}
								<td style:text-align={block.align[c] ?? 'left'}>
									<MdInline nodes={cell} {resolve} />
								</td>
							{/each}
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{:else if block.kind === 'rule'}
		<hr />
	{/if}
{/each}

<style>
	.h {
		color: var(--tx);
		font-weight: 600;
		margin: 22px 0 8px;
		line-height: 1.4;
	}

	.h:first-child {
		margin-top: 0;
	}

	/* Prose headings sit under the chrome, so h1 tops out at the 15px the
	   spec gives a repo name — a README cannot shout louder than the app. */
	.h1 {
		font-size: 15px;
		padding-bottom: 8px;
		border-bottom: 1px solid var(--bd);
	}

	.h2 {
		font-size: 14px;
	}

	.h3,
	.h4,
	.h5,
	.h6 {
		font-size: 13px;
	}

	p {
		margin: 0 0 10px;
		color: var(--tx2);
	}

	pre {
		margin: 0 0 12px;
		padding: 10px 12px;
		background: var(--side);
		border: 1px solid var(--bd);
		border-radius: var(--radius-card);
		overflow-x: auto;
		font-size: 12px;
		line-height: 1.6;
		color: var(--tx);
	}

	/* Code inside a block is already monospaced by the `pre`; it must not pick
	   up the inline span's border and fill. */
	pre code {
		font: inherit;
		background: none;
		border: none;
		padding: 0;
	}

	blockquote {
		margin: 0 0 10px;
		padding-left: 12px;
		border-left: 2px solid var(--bd2);
		color: var(--tx3);
	}

	/* Tailwind's preflight is imported for its reset and strips list markers.
	   Prose is the one place they carry meaning, so they come back here. */
	ul,
	ol {
		margin: 0 0 10px;
		padding-left: 20px;
		color: var(--tx2);
	}

	ul {
		list-style: disc;
	}

	ol {
		list-style: decimal;
	}

	li::marker {
		color: var(--tx3);
	}

	li {
		margin: 2px 0;
	}

	/* A list item's paragraphs are the item, so they carry no extra rhythm.
	   `:global` because an item's blocks are rendered through a nested instance
	   of this component — the `li` is still scoped, so nothing leaks out. */
	li :global(p) {
		margin: 0 0 4px;
	}

	li :global(p:last-child) {
		margin-bottom: 0;
	}

	li :global(ul),
	li :global(ol) {
		margin: 2px 0;
	}

	.scroll {
		overflow-x: auto;
		margin: 0 0 12px;
	}

	table {
		border-collapse: collapse;
		font-size: 12px;
	}

	th,
	td {
		border: 1px solid var(--bd);
		padding: 5px 10px;
		color: var(--tx2);
	}

	th {
		font-weight: 500;
		color: var(--tx);
		background: var(--side);
		white-space: nowrap;
	}

	hr {
		border: none;
		border-top: 1px solid var(--bd);
		margin: 16px 0;
	}
</style>

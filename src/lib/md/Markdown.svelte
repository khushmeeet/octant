<script lang="ts">
	import type { RepoRef } from '$lib/source/types';
	import MdBlocks from './MdBlocks.svelte';
	import { parseMarkdown } from './parse';

	/**
	 * Renders a Markdown document as a tree of Svelte-authored elements.
	 *
	 * `base` is what a README's relative links are relative *to*. Resolving
	 * them against github.com rather than against our own routes is deliberate
	 * for Phase 3: the file screen does not exist yet, and a link that opens
	 * the file on github.com is honest where a link into a screen we have not
	 * built would not be. Phase 4 changes this function and nothing else.
	 */
	interface Props {
		source: string;
		base?: { repo: RepoRef; rev: string; dir: string };
	}

	let { source, base }: Props = $props();

	const blocks = $derived(parseMarkdown(source));

	const resolve = $derived(
		base
			? (href: string) => {
					if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(href) || href.startsWith('#')) return href;
					const target = relativeTo(base.dir, href);
					return `https://github.com/${base.repo.owner}/${base.repo.name}/blob/${encodeURIComponent(base.rev)}/${target}`;
				}
			: undefined
	);

	/** `./`, `../` and repo-absolute `/` against the directory the README is in. */
	function relativeTo(dir: string, href: string): string {
		const [path, hash] = href.split('#');
		const segments = href.startsWith('/') ? [] : dir.split('/').filter(Boolean);

		for (const part of path.split('/')) {
			if (!part || part === '.') continue;
			if (part === '..') segments.pop();
			else segments.push(part);
		}

		const resolved = segments.map(encodeURIComponent).join('/');
		return hash ? `${resolved}#${hash}` : resolved;
	}
</script>

<div class="md">
	<MdBlocks {blocks} {resolve} />
</div>

<style>
	.md {
		font-size: 13px;
		line-height: 1.6;
		max-width: 76ch;
	}
</style>

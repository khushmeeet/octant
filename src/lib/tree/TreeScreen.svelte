<script lang="ts">
	import { goto } from '$app/navigation';
	import Markdown from '$lib/md/Markdown.svelte';
	import {
		archiveUrl,
		fileHref,
		githubBlobUrl,
		parentPath,
		treeHref,
		type TreeAddress
	} from '$lib/nav/paths';
	import { ERROR_LABEL, GitHubSource, type TreeEntry } from '$lib/source';
	import { prefetch } from '$lib/sync/prefetch';
	import { resource } from '$lib/sync/resource.svelte';
	import CloneStrip from '$lib/ui/CloneStrip.svelte';
	import FileTree from '$lib/ui/FileTree.svelte';
	import Header from '$lib/ui/Header.svelte';
	import Icon from '$lib/ui/Icon.svelte';
	import Pill from '$lib/ui/Pill.svelte';
	import RightPanel from '$lib/ui/RightPanel.svelte';
	import Shell from '$lib/ui/Shell.svelte';
	import Sidebar from '$lib/ui/Sidebar.svelte';
	import VerbRow from '$lib/ui/VerbRow.svelte';
	import VirtualRows from '$lib/ui/VirtualRows.svelte';
	import { copy } from '$lib/ui/clipboard';
	import { ago, bytes, count, kilobytes } from '$lib/ui/format';
	import type { Crumb, PanelEntry, Verb } from '$lib/ui/types';

	/**
	 * The Tree screen — PLAN.md Phase 3. The first real screen, end to end.
	 *
	 * Two resources, in parallel, never chained. An unnamed revision is queried
	 * as the literal `HEAD` rather than resolved to the default branch first,
	 * which is the difference between one round trip and two on the screen
	 * people open most: waiting for the repository summary just to learn the
	 * name of a branch we were about to ask GitHub about anyway would be a
	 * waterfall for no information (ARCHITECTURE.md §4).
	 *
	 * The README is a third read, deliberately behind the listing. It is
	 * addressed by the blob's own object ID, which the listing already carries,
	 * so it is permanent and shared across every revision where the file did not
	 * change — and it is below the fold, so arriving a beat later costs nothing.
	 */
	interface Props {
		address: TreeAddress;
	}

	let { address }: Props = $props();

	const repo = $derived(address.repo);
	const path = $derived(address.path);

	/**
	 * What queries are made at. `HEAD` is a revision GitHub resolves for us, so
	 * an unnamed default branch costs nothing to address.
	 */
	const rev = $derived(address.rev ?? 'HEAD');

	const summary = resource(() => GitHubSource.getRepo(repo));
	const tree = resource(() => GitHubSource.getTree(repo, rev, path));

	/* ------------------------------------------------------------- readme -- */

	const README = /^readme(\.(md|markdown|mdx|rst|txt|adoc))?$/i;
	const MARKDOWN = /\.(md|markdown|mdx)$/i;

	const readmeEntry = $derived(
		tree.data?.entries.find((entry) => entry.type === 'blob' && README.test(entry.name)) ?? null
	);

	const readme = resource(() => (readmeEntry ? GitHubSource.getBlob(repo, readmeEntry.oid) : null));

	/* --------------------------------------------------------------- rows -- */

	/**
	 * `..` is a row rather than chrome so the keyboard reaches it: `j`/`k` walk
	 * everything the mouse can click, with no exceptions to remember.
	 */
	type Row = { kind: 'up'; href: string } | { kind: 'entry'; entry: TreeEntry };

	let filter = $state('');
	/** Unset until the keyboard or the pointer moves it. A screen you have just
	    opened should not claim one of its rows is special. */
	let cursor = $state<number | null>(null);
	let filterField = $state<HTMLInputElement | null>(null);
	let listTop = $state<HTMLElement | null>(null);
	let readmeTop = $state<HTMLElement | null>(null);

	const parent = $derived(parentPath(path));

	const rows = $derived.by<Row[]>(() => {
		const entries = tree.data?.entries ?? [];
		const needle = filter.trim().toLowerCase();

		const matched = needle
			? entries.filter((entry) => entry.name.toLowerCase().includes(needle))
			: entries;

		const list: Row[] = matched.map((entry) => ({ kind: 'entry', entry }));

		// Filtering is a search of this directory, so the way out of it is not a
		// result. It comes back the moment the field is empty.
		if (parent !== null && !needle) {
			list.unshift({ kind: 'up', href: treeHref(repo, address.rev, parent) });
		}
		return list;
	});

	/**
	 * Derived rather than clamped in place, so a shrinking filter cannot loop.
	 * `-1` is "nothing selected", which every consumer already treats as no-op.
	 */
	const active = $derived(cursor === null ? -1 : Math.min(cursor, Math.max(0, rows.length - 1)));

	// A new directory is a new list. Carrying a filter or a cursor position
	// across it would be carrying an answer to a question nobody asked twice.
	$effect(() => {
		void path;
		void rev;
		void repo.owner;
		void repo.name;
		filter = '';
		cursor = null;
	});

	// Prefetch on mount for the adjacent screen — ARCHITECTURE.md §5. The
	// directory you came from is the one you are most likely to go back to.
	$effect(() => {
		if (parent !== null) prefetch(GitHubSource.getTree(repo, rev, parent));
	});

	function hrefFor(row: Row): string {
		if (row.kind === 'up') return row.href;
		const { entry } = row;
		return entry.type === 'tree'
			? treeHref(repo, address.rev, entry.path)
			: fileHref(repo, address.rev, entry.path);
	}

	function warm(row: Row): void {
		if (row.kind === 'up') prefetch(GitHubSource.getTree(repo, rev, parent ?? ''));
		else if (row.entry.type === 'tree') prefetch(GitHubSource.getTree(repo, rev, row.entry.path));
		else if (row.entry.type === 'blob') prefetch(GitHubSource.getFile(repo, rev, row.entry.path));
	}

	/* ----------------------------------------------------------- keyboard -- */

	function open(row: Row | undefined): void {
		if (!row) return;
		if (row.kind === 'entry' && row.entry.type === 'commit') return;
		void goto(hrefFor(row));
	}

	function onKeydown(event: KeyboardEvent): void {
		const target = event.target as HTMLElement | null;
		const typing =
			target instanceof HTMLInputElement ||
			target instanceof HTMLTextAreaElement ||
			target?.isContentEditable === true;

		if (event.key === 'Escape') {
			filter = '';
			if (typing) target?.blur();
			return;
		}

		if (typing || event.metaKey || event.ctrlKey || event.altKey) return;

		switch (event.key) {
			case 'j':
			case 'ArrowDown':
				event.preventDefault();
				// From nothing, either direction starts at the top. Predictable
				// beats clever when the list may be four thousand rows long.
				cursor = active < 0 ? 0 : Math.min(active + 1, rows.length - 1);
				break;
			case 'k':
			case 'ArrowUp':
				event.preventDefault();
				cursor = active <= 0 ? 0 : active - 1;
				break;
			case 'Enter':
				if (active < 0) break;
				event.preventDefault();
				open(rows[active]);
				break;
			case '/':
				event.preventDefault();
				filterField?.focus();
				filterField?.select();
				break;
		}
	}

	/* -------------------------------------------------------------- verbs -- */

	/**
	 * A permalink needs a commit SHA, and Phase 3 only knows one for the default
	 * branch. Rather than offer a verb that cannot act — DESIGN.md §5 requires
	 * every verb to resolve — it is absent on any other revision until Phase 6's
	 * ref map makes the SHA available for all of them.
	 */
	const head = $derived(summary.data?.head ?? null);
	const onDefaultBranch = $derived(
		address.rev === null || address.rev === summary.data?.defaultBranch
	);
	const permalink = $derived(head && onDefaultBranch ? treeHref(repo, head.oid, path) : null);
	const alreadyPermanent = $derived(address.rev !== null && address.rev === head?.oid);

	let copied = $state(false);

	async function copyPath() {
		copied = await copy(path || `${repo.owner}/${repo.name}`);
		setTimeout(() => (copied = false), 1200);
	}

	const verbs = $derived.by<Verb[]>(() => {
		const list: Verb[] = [
			{ id: 'files', label: 'Files', onselect: () => listTop?.scrollIntoView({ block: 'start' }) }
		];

		if (readmeEntry) {
			list.push({
				id: 'readme',
				label: 'Readme',
				onselect: () => readmeTop?.scrollIntoView({ block: 'start' })
			});
		}

		list.push({
			id: 'archive',
			label: 'Archive',
			href: archiveUrl(repo, rev === 'HEAD' ? (summary.data?.defaultBranch ?? 'HEAD') : rev),
			external: true,
			title: 'Download this revision as a zip from github.com'
		});

		if (permalink && !alreadyPermanent) {
			list.push({
				id: 'permalink',
				label: 'Permalink',
				href: permalink,
				title: 'Address this tree by commit SHA — cached permanently once you do'
			});
		}

		return list;
	});

	/* -------------------------------------------------------------- chrome -- */

	const crumbs = $derived.by<Crumb[]>(() => {
		const list: Crumb[] = [
			{ label: repo.owner },
			{ label: repo.name, href: treeHref(repo, address.rev, '') }
		];

		const segments = path ? path.split('/') : [];
		segments.forEach((segment, i) => {
			list.push({
				label: segment,
				mono: true,
				href: treeHref(repo, address.rev, segments.slice(0, i + 1).join('/'))
			});
		});
		return list;
	});

	const visit = $derived<PanelEntry[]>([
		// Real deltas are Phase 8. The block keeps its position and its shape so
		// the geography is learned now rather than rearranged later.
		{ key: 'Commits since', value: '—' },
		{ key: 'In paths you own', value: '—' },
		{ key: 'Last visit', value: '—' }
	]);

	const about = $derived.by<PanelEntry[]>(() => {
		const data = summary.data;
		if (!data) return [];

		const entries: PanelEntry[] = [
			{ key: 'Repository', value: data.nameWithOwner, mono: true },
			{ key: 'Default', value: data.defaultBranch ?? '—', mono: true }
		];

		if (data.head) {
			entries.push({ key: 'HEAD', value: data.head.abbreviatedOid, mono: true });
			entries.push({ key: 'Committed', value: ago(data.head.committedDate) });
		}

		entries.push({ key: 'Visibility', value: data.isPrivate ? 'Private' : 'Public' });
		entries.push({ key: 'Size', value: kilobytes(data.diskUsageKb) });
		if (data.isArchived) entries.push({ key: 'State', value: 'Archived', accent: true });
		return entries;
	});

	const openAgainst = $derived.by<PanelEntry[]>(() => {
		const data = summary.data;
		if (!data) return [];
		return [
			{ key: 'Pull requests', value: count(data.counts.openPullRequests) },
			{ key: 'Branches', value: count(data.counts.branches) },
			{ key: 'Tags', value: count(data.counts.tags) }
		];
	});

	/**
	 * A tree address that resolved to a file is the file screen's address, not
	 * an error. `objectType` is how the source says which it was, and following
	 * it beats telling someone their perfectly good URL was wrong.
	 */
	const elsewhere = $derived(tree.error?.objectType === 'Blob');

	$effect(() => {
		if (elsewhere) void goto(fileHref(repo, address.rev, path));
	});

	// A screen on its way somewhere else says nothing on the way. Reporting an
	// address as missing for the frame before it resolves is worse than a blank.
	const failure = $derived(elsewhere ? null : (summary.error ?? tree.error));
</script>

<svelte:window onkeydown={onKeydown} />

{#snippet sidebar()}
	<Sidebar
		repo={summary.data}
		active="tree"
		treeCount={tree.data?.entries.length ?? null}
		section="Files"
	>
		<FileTree {repo} {rev} hrefRev={address.rev} current={path} />
	</Sidebar>
{/snippet}

{#snippet pills()}
	<Pill mono tone="accent" title={address.rev ? 'Revision from the URL' : 'The default branch'}>
		{address.rev ?? summary.data?.defaultBranch ?? 'HEAD'}
	</Pill>
	{#if head}
		<Pill mono title={head.messageHeadline}>{head.abbreviatedOid}</Pill>
	{/if}
{/snippet}

{#snippet header()}
	<Header {crumbs} {pills} />
{/snippet}

{#snippet verbRow()}
	<VerbRow
		object={path || `${repo.owner}/${repo.name}`}
		{verbs}
		active="files"
		utility={{ id: 'copy', label: copied ? 'Copied' : 'Copy path', onselect: copyPath }}
	/>
{/snippet}

{#snippet panel()}
	<RightPanel {visit} {about} open={openAgainst} />
{/snippet}

<Shell {sidebar} {header} verbs={verbRow} {panel}>
	{#if summary.data && !path}
		<CloneStrip https={summary.data.cloneUrl} ssh={summary.data.sshUrl} />
	{/if}

	{#if failure && !tree.data}
		<p class="fail" role="alert">
			<b>{ERROR_LABEL[failure.kind]}</b>{failure.message}
		</p>
	{:else}
		{#if failure}
			<!-- Cached listing on screen, failed revalidation behind it. Both true. -->
			<p class="warn" role="status">
				<b>{ERROR_LABEL[failure.kind]}</b>Showing what was cached. {failure.message}
			</p>
		{/if}

		<div class="bar" bind:this={listTop}>
			<input
				bind:this={filterField}
				bind:value={filter}
				class="filter"
				type="search"
				placeholder="Filter this directory  /"
				aria-label="Filter this directory"
				autocomplete="off"
				spellcheck="false"
			/>
			<span class="tally">
				{#if filter.trim()}
					{count(rows.filter((row) => row.kind === 'entry').length)} of
					{count(tree.data?.entries.length ?? 0)}
				{:else if tree.data}
					{count(tree.data.entries.length)}
					{tree.data.entries.length === 1 ? 'entry' : 'entries'}
				{/if}
			</span>
		</div>

		<div class="cols" aria-hidden="true">
			<span class="c-name">Name</span>
			<span class="c-mode">Mode</span>
			<span class="c-size">Size</span>
		</div>

		<!-- A directory listing is a set of links to other places, so it is
		     navigation and gets a label rather than a list role it would then
		     have to fake option semantics for. -->
		<nav class="list" aria-label="Directory listing">
			<VirtualRows items={rows} rowHeight={32} reveal={active} revealMargin={28}>
				{#snippet row(item: Row, index: number)}
					{#if item.kind === 'up'}
						<a
							class="row up"
							class:sel={index === active}
							aria-current={index === active ? 'true' : undefined}
							href={item.href}
							onpointerenter={() => warm(item)}
							onclick={() => (cursor = index)}
						>
							<Icon name="folder" />
							<span class="name mono">..</span>
						</a>
					{:else if item.entry.type === 'commit'}
						<div class="row sub" class:sel={index === active} title="Submodule">
							<Icon name="commit" />
							<span class="name mono">{item.entry.name}</span>
							<span class="mode mono">{item.entry.mode}</span>
							<span class="size mono">submodule</span>
						</div>
					{:else}
						{@const dir = item.entry.type === 'tree'}
						<!-- Selection is not carried by colour alone — DESIGN.md §9. -->
						<a
							class="row"
							class:sel={index === active}
							class:dir
							aria-current={index === active ? 'true' : undefined}
							href={hrefFor(item)}
							title={item.entry.path}
							onpointerenter={() => warm(item)}
							onclick={() => (cursor = index)}
						>
							<Icon name={dir ? 'folder' : 'file'} />
							<span class="name mono">{item.entry.name}</span>
							<span class="mode mono">{item.entry.mode}</span>
							<span class="size mono">{bytes(item.entry.byteSize)}</span>
						</a>
					{/if}
				{/snippet}

				{#snippet empty()}
					<p class="none">
						{#if tree.loading}
							&nbsp;
						{:else if filter.trim()}
							Nothing here matches <b>{filter.trim()}</b>.
						{:else}
							This directory is empty.
						{/if}
					</p>
				{/snippet}
			</VirtualRows>
		</nav>

		{#if readmeEntry}
			<section class="readme" bind:this={readmeTop}>
				<h2 class="mono">{readmeEntry.name}</h2>
				{#if readme.data?.text !== null && readme.data?.text !== undefined}
					{#if MARKDOWN.test(readmeEntry.name)}
						<Markdown source={readme.data.text} base={{ repo, rev, dir: path }} />
					{:else}
						<pre class="plain mono">{readme.data.text}</pre>
					{/if}
					{#if readme.data.isTruncated}
						<p class="note">
							GitHub sent a prefix of this file, not all of it.
							<a
								href={githubBlobUrl(repo, rev, readmeEntry.path)}
								target="_blank"
								rel="noopener noreferrer">Read it on github.com</a
							>.
						</p>
					{/if}
				{:else if readme.error}
					<p class="note">{readme.error.message}</p>
				{:else if readme.data}
					<p class="note">This file is binary, or too large for the API to send.</p>
				{/if}
			</section>
		{/if}
	{/if}
</Shell>

<style>
	.bar {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 8px var(--pad-main);
	}

	.filter {
		flex: 1;
		min-width: 0;
		max-width: 320px;
		background: var(--bg);
		border: 1px solid var(--bd);
		border-radius: var(--radius-pill);
		padding: 4px 10px;
		font-size: 12px;
		color: var(--tx);
		transition: border-color 120ms;
	}

	.filter::placeholder {
		color: var(--tx3);
	}

	.filter:hover {
		border-color: var(--bd2);
	}

	.tally {
		font-size: 11px;
		color: var(--tx3);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}

	.cols {
		display: flex;
		align-items: center;
		gap: 8px;
		height: var(--colhd-h);
		padding: 0 var(--pad-main);
		border-top: 1px solid var(--bd);
		border-bottom: 1px solid var(--bd);
		font-size: 11px;
		font-weight: 500;
		color: var(--tx3);
		background: var(--panel);
		position: sticky;
		top: 0;
		z-index: 1;
	}

	.c-name {
		flex: 1;
		min-width: 0;
		padding-left: 22px;
	}

	.c-mode {
		width: 72px;
		text-align: right;
	}

	.c-size {
		width: 76px;
		text-align: right;
	}

	.list {
		border-bottom: 1px solid var(--bd);
	}

	.row {
		display: flex;
		align-items: center;
		gap: 8px;
		height: var(--row-h);
		padding: 0 var(--pad-main);
		color: var(--tx3);
		transition: background-color 120ms;
	}

	.row:hover {
		background: var(--hover);
	}

	/* Keyboard and mouse selection look identical — DESIGN.md §6. */
	.row.sel {
		background: var(--sel);
	}

	.row.dir,
	.row.up {
		color: var(--acc-tx);
	}

	.name {
		flex: 1;
		min-width: 0;
		font-size: 12px;
		color: var(--tx);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.row.dir .name,
	.row.up .name {
		color: var(--tx);
		font-weight: 500;
	}

	.mode,
	.size {
		font-size: 11px;
		color: var(--tx3);
		text-align: right;
		flex: none;
	}

	.mode {
		width: 72px;
	}

	.size {
		width: 76px;
	}

	.sub {
		cursor: default;
	}

	.none {
		margin: 0;
		padding: 12px var(--pad-main);
		font-size: 12px;
		color: var(--tx3);
	}

	.none b {
		color: var(--tx2);
		font-weight: 500;
	}

	.readme {
		padding: 18px var(--pad-main) 40px;
	}

	.readme h2 {
		font-size: 11.5px;
		font-weight: 400;
		color: var(--tx3);
		margin: 0 0 14px;
	}

	.plain {
		margin: 0;
		font-size: 12px;
		line-height: 1.6;
		color: var(--tx2);
		white-space: pre-wrap;
		max-width: 76ch;
	}

	.note {
		margin: 10px 0 0;
		font-size: 12px;
		color: var(--tx3);
	}

	.note a {
		color: var(--acc-tx);
	}

	.fail,
	.warn {
		margin: 0;
		padding: 12px var(--pad-main);
		color: var(--tx2);
	}

	.warn {
		border-bottom: 1px solid var(--bd);
	}

	.fail b,
	.warn b {
		font-weight: 500;
		margin-right: 8px;
	}

	.fail b {
		color: var(--no);
	}

	.warn b {
		color: var(--wn);
	}
</style>

<script lang="ts">
	import { goto } from '$app/navigation';
	import { archiveUrl, fileHref, parentPath, treeHref, type TreeAddress } from '$lib/nav/paths';
	import { ERROR_LABEL, GitHubSource, type TreeEntry } from '$lib/source';
	import { prefetch } from '$lib/sync/prefetch';
	import { resource } from '$lib/sync/resource.svelte';
	import Dot from '$lib/ui/Dot.svelte';
	import Header from '$lib/ui/Header.svelte';
	import Icon from '$lib/ui/Icon.svelte';
	import Pill from '$lib/ui/Pill.svelte';
	import RightPanel from '$lib/ui/RightPanel.svelte';
	import Shell from '$lib/ui/Shell.svelte';
	import Sidebar from '$lib/ui/Sidebar.svelte';
	import VirtualRows from '$lib/ui/VirtualRows.svelte';
	import { ago, bytes, count, kilobytes, mode } from '$lib/ui/format';
	import type { Crumb, PanelEntry, Verb } from '$lib/ui/types';
	import { sinceLastVisit } from '$lib/visits/since.svelte';

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
	 * **This screen is about a directory, and only about one.** It used to be the
	 * repository's front page as well, and carried three things that were about
	 * the repository rather than about the directory on screen: the clone strip,
	 * the README under the listing, and a second copy of the tree in the sidebar.
	 * The first two moved to the Summary screen, which is what the repository's
	 * own address renders now. The third was deleted outright — Phase 9's palette
	 * opens any file in the repository by name, from an index of every path,
	 * which is what a sidebar tree was a slower approximation of.
	 *
	 * What is left is one listing, at one revision, at one path. The root is
	 * `/tree/HEAD` rather than `/`, so the address says which of the two screens
	 * you are on.
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

	/* -------------------------------------------------------------- since -- */

	/**
	 * Phase 8. One comparison against the head we wrote down last time answers
	 * the panel's first block *and* every dot in the listing — a row's dot is a
	 * lookup against the paths that comparison already named, never a read of
	 * its own. On a repository nobody has pushed to, it costs nothing at all.
	 */
	const since = sinceLastVisit(() => ({
		repo,
		rev,
		head: summary.data?.head?.oid ?? null
	}));

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

	const head = $derived(summary.data?.head ?? null);

	/**
	 * `Files` and `Readme` used to lead this list, scrolling the page to one of
	 * the screen's two sections. They went with the verb row, and then the
	 * README they pointed at went to the Summary screen — a jump link to
	 * something visible was chrome pretending to be navigation, and the section
	 * it jumped to was never about this directory in the first place.
	 *
	 * `Permalink` and `Copy path` went the same way, and for the same reason.
	 * The tree is the screen you land on, and neither verb is about the tree:
	 * one re-addresses a listing you are already reading and the other hands
	 * back a path the breadcrumb is spelling out two inches to the left. Both
	 * still exist where they answer a question — on a file, whose SHA is the
	 * thing you quote, and on a commit. Here they were a row of chrome charged
	 * to every visit.
	 */
	const verbs = $derived.by<Verb[]>(() => [
		{
			id: 'archive',
			label: 'Archive',
			href: archiveUrl(repo, rev === 'HEAD' ? (summary.data?.defaultBranch ?? 'HEAD') : rev),
			external: true,
			title: 'Download this revision as a zip from github.com'
		}
	]);

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
	<!-- No contextual section. The tree used to render a second copy of itself
	     here, and Phase 9's palette is what finally made it redundant: ⌘K opens
	     any file in the repository by name, from an index of every path, which is
	     what a sidebar tree was an approximation of. -->
	<Sidebar
		repo={summary.data}
		active="tree"
		rev={address.rev}
		treeCount={tree.data?.entries.length ?? null}
		section={null}
	/>
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
	<Header {crumbs} {pills} {verbs} />
{/snippet}

{#snippet panel()}
	<RightPanel since={since.label} visit={since.rows} {about} open={openAgainst} />
{/snippet}

<Shell {sidebar} {header} {panel}>
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

		<div class="bar">
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
							<span class="named"><span class="name mono">{item.entry.name}</span></span>
							<span class="mode mono" title={item.entry.mode}>{mode(item.entry.mode)}</span>
							<span class="size mono">submodule</span>
						</div>
					{:else}
						{@const dir = item.entry.type === 'tree'}
						{@const mark = since.mark(item.entry.path)}
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
							<!-- The dot sits against the name rather than in a column of its
							     own: across a 900px row a column would put it an inch of empty
							     space away from the thing it is about. -->
							<span class="named">
								<span class="name mono">{item.entry.name}</span>
								{#if mark}
									<Dot title={mark.title} />
								{/if}
							</span>
							<span class="mode mono" title={item.entry.mode}>{mode(item.entry.mode)}</span>
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

	/* Ten characters of symbolic mode, which is wider than six octal digits
	   were and reads without being decoded first. */
	.c-mode {
		width: 88px;
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

	/* Name and its dot, taking what is left of the row so the fixed columns
	   stay right-aligned. */
	.named {
		display: flex;
		align-items: center;
		gap: 8px;
		flex: 1;
		min-width: 0;
	}

	.name {
		min-width: 0;
		font-size: 12px;
		color: var(--tx);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.row.up .name {
		flex: 1;
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
		width: 88px;
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

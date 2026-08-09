<script lang="ts">
	import { goto } from '$app/navigation';
	import {
		archiveUrl,
		compareHref,
		logHref,
		refsHref,
		treeHref,
		type RefsAddress,
		type RefSelection
	} from '$lib/nav/paths';
	import { ERROR_LABEL, GitHubSource, refAuthor, type RefEntry, type RefKind } from '$lib/source';
	import { pages } from '$lib/sync/pages.svelte';
	import { prefetch } from '$lib/sync/prefetch';
	import { resource } from '$lib/sync/resource.svelte';
	import Header from '$lib/ui/Header.svelte';
	import Icon from '$lib/ui/Icon.svelte';
	import Pill from '$lib/ui/Pill.svelte';
	import RightPanel from '$lib/ui/RightPanel.svelte';
	import Shell from '$lib/ui/Shell.svelte';
	import Sidebar from '$lib/ui/Sidebar.svelte';
	import VirtualRows from '$lib/ui/VirtualRows.svelte';
	import { copy } from '$lib/ui/clipboard';
	import { ago, count } from '$lib/ui/format';
	import type { Crumb, PanelEntry, Verb } from '$lib/ui/types';
	import { sinceLastVisit } from '$lib/visits/since.svelte';
	import Kinds from './Kinds.svelte';
	import RefDetail from './RefDetail.svelte';

	/**
	 * The Refs screen — PLAN.md Phase 6. "What has shipped, and what's in
	 * flight?"
	 *
	 * Branches and tags on one screen because they are one object
	 * (ARCHITECTURE.md §2), in one list rather than two panels, so the keyboard
	 * walks the whole thing and the group headings are rows like everything
	 * else. Two walks feed it — one query per kind, in parallel — and the
	 * selected ref's shortlog is a third read that only happens for the ref you
	 * stopped on.
	 *
	 * The branch walk waits for the repository summary, and it is the only place
	 * in the app that waits for anything. Ahead and behind are measured against
	 * the default branch, and `Ref.compare` wants that branch *by name* — which
	 * is a fact only the summary has. In practice there is no wait: you arrive
	 * here from another screen of the same repository, so the summary is a cache
	 * hit on the first frame. On a cold direct link it is one query deep, on a
	 * screen that is nobody's entry point, and it buys the column that makes a
	 * list of forty branches worth reading.
	 */
	interface Props {
		address: RefsAddress;
	}

	let { address }: Props = $props();

	const repo = $derived(address.repo);
	const kind = $derived(address.kind);

	const summary = resource(() => GitHubSource.getRepo(repo));

	const since = sinceLastVisit(() => ({
		repo,
		rev: 'HEAD',
		head: summary.data?.head?.oid ?? null
	}));
	const defaultBranch = $derived(summary.data?.defaultBranch ?? null);
	const defaultHead = $derived(summary.data?.head ?? null);

	const branches = pages<RefEntry>((after) =>
		defaultBranch && kind !== 'tag'
			? GitHubSource.getRefs(repo, 'branch', defaultBranch, after)
			: null
	);

	// No base: a tag does not drift, so there is nothing to be ahead of. What a
	// tag is compared with is the tag before it, and that is the pane's read.
	const tags = pages<RefEntry>((after) =>
		kind !== 'branch' ? GitHubSource.getRefs(repo, 'tag', null, after) : null
	);

	/* --------------------------------------------------------------- rows -- */

	type Row =
		| { id: string; row: 'group'; label: string; loaded: number; total: number | null }
		| { id: string; row: 'ref'; entry: RefEntry }
		| { id: string; row: 'more'; which: RefKind; rest: number };

	let filter = $state('');
	let filterField = $state<HTMLInputElement | null>(null);

	function matches(entry: RefEntry, needle: string): boolean {
		if (!needle) return true;
		return (
			entry.name.toLowerCase().includes(needle) ||
			entry.oid.startsWith(needle) ||
			entry.headline.toLowerCase().includes(needle)
		);
	}

	const shownBranches = $derived(
		branches.items.filter((entry) => matches(entry, filter.trim().toLowerCase()))
	);
	const shownTags = $derived(
		tags.items.filter((entry) => matches(entry, filter.trim().toLowerCase()))
	);

	const rows = $derived.by<Row[]>(() => {
		const list: Row[] = [];

		const group = (
			which: RefKind,
			label: string,
			shown: readonly RefEntry[],
			walk: typeof branches
		) => {
			list.push({
				id: `g-${which}`,
				row: 'group',
				label,
				loaded: shown.length,
				total: walk.total
			});
			for (const entry of shown) list.push({ id: `${which}-${entry.name}`, row: 'ref', entry });
			if (walk.hasMore) {
				list.push({
					id: `m-${which}`,
					row: 'more',
					which,
					rest: Math.max(0, (walk.total ?? 0) - walk.items.length)
				});
			}
		};

		if (kind !== 'tag') group('branch', 'Branches', shownBranches, branches);
		if (kind !== 'branch') group('tag', 'Tags', shownTags, tags);
		return list;
	});

	/** Every ref on screen, in the order the list shows them. */
	const shownRefs = $derived(
		rows.filter((row): row is Extract<Row, { row: 'ref' }> => row.row === 'ref')
	);

	/* ---------------------------------------------------------- selection -- */

	/**
	 * The selection lives in the URL, so the cursor is derived rather than held.
	 * One source of truth means `j` cannot disagree with the address bar, and a
	 * release you are reading is a link you can send.
	 */
	const selected = $derived.by(() => {
		const want = address.ref;
		if (!want) return null;
		const pool = want.kind === 'tag' ? tags.items : branches.items;
		return pool.find((entry) => entry.name === want.name) ?? null;
	});

	const active = $derived(
		selected ? rows.findIndex((row) => row.row === 'ref' && row.entry === selected) : -1
	);

	function hrefFor(entry: RefEntry | null): string {
		const ref: RefSelection | null = entry ? { kind: entry.kind, name: entry.name } : null;
		return refsHref(repo, { kind, ref });
	}

	/** Replaced, not pushed: walking a tag list is one step back out, not fifty. */
	function select(entry: RefEntry | null): void {
		void goto(hrefFor(entry), { replaceState: true, noScroll: true, keepFocus: true });
	}

	function step(delta: number): void {
		if (shownRefs.length === 0) return;
		const at = selected ? shownRefs.findIndex((row) => row.entry === selected) : -1;
		// From nothing, either direction starts at the top — the rule every list
		// in this app follows.
		const next = at < 0 ? 0 : Math.min(shownRefs.length - 1, Math.max(0, at + delta));
		select(shownRefs[next].entry);
	}

	// A filter that hides the selected ref should not leave a pane describing
	// something off screen.
	$effect(() => {
		if (!selected || shownRefs.length === 0) return;
		if (!shownRefs.some((row) => row.entry === selected)) select(null);
	});

	/* ------------------------------------------------------------- detail -- */

	/** Tags are newest first, so the one after this in the list is the one before it. */
	const previousTag = $derived.by(() => {
		if (!selected || selected.kind !== 'tag') return null;
		const at = tags.items.indexOf(selected);
		return at === -1 ? null : (tags.items[at + 1] ?? null);
	});

	/** What the selected ref is compared with, and what to call it on screen. */
	const base = $derived.by(() => {
		if (!selected) return null;
		if (selected.kind === 'tag') {
			return previousTag ? { label: previousTag.name, oid: previousTag.oid } : null;
		}
		if (!defaultHead || !defaultBranch) return null;
		return { label: defaultBranch, oid: defaultHead.oid };
	});

	/** Said out loud rather than left as an empty pane. */
	const reason = $derived.by(() => {
		if (!selected || base) return null;
		if (selected.kind === 'tag') {
			return tags.hasMore
				? 'Load more tags to see what changed since the one before this.'
				: 'Nothing is tagged before this, so there is no range to read.';
		}
		return 'The default branch is not known yet.';
	});

	const identical = $derived(Boolean(base && selected && base.oid === selected.oid));

	/**
	 * Holding `j` down through a tag list must not be one comparison per row, so
	 * the shortlog waits for the selection to stop. Everything else in the pane
	 * came with the refs query and is there immediately.
	 */
	const SETTLE_MS = 120;
	let resting = $state<string | null>(null);

	$effect(() => {
		const at = selected && base && !identical ? `${base.oid}:${selected.oid}` : null;
		if (at === null) {
			resting = null;
			return;
		}
		const timer = setTimeout(() => (resting = at), SETTLE_MS);
		return () => clearTimeout(timer);
	});

	const comparison = resource(() => {
		if (!resting) return null;
		const [from, to] = resting.split(':');
		return GitHubSource.getCompare(repo, from, to);
	});

	/* ----------------------------------------------------------- keyboard -- */

	function open(row: Row | undefined): void {
		if (!row) return;
		if (row.row === 'ref') void goto(treeHref(repo, row.entry.name));
		else if (row.row === 'more') more(row.which);
	}

	function more(which: RefKind): void {
		if (which === 'branch') branches.more();
		else tags.more();
	}

	function pick(event: MouseEvent, entry: RefEntry): void {
		// A modified click belongs to the browser. Only a plain one is ours, and
		// ours is to select — the same bargain the log's rows make.
		if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
		event.preventDefault();
		select(entry);
	}

	function onKeydown(event: KeyboardEvent): void {
		const target = event.target as HTMLElement | null;
		const typing =
			target instanceof HTMLInputElement ||
			target instanceof HTMLTextAreaElement ||
			target?.isContentEditable === true;

		if (event.key === 'Escape') {
			if (filter) filter = '';
			else select(null);
			if (typing) target?.blur();
			return;
		}

		if (typing || event.metaKey || event.ctrlKey || event.altKey) return;

		switch (event.key) {
			case 'j':
			case 'ArrowDown':
				event.preventDefault();
				step(1);
				break;
			case 'k':
			case 'ArrowUp':
				event.preventDefault();
				step(-1);
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

	let copied = $state('');

	async function put(label: string, text: string) {
		if (await copy(text)) {
			copied = label;
			setTimeout(() => (copied = ''), 1200);
		}
	}

	const isDefault = $derived(Boolean(selected && selected.name === defaultBranch));

	const verbs = $derived.by<Verb[]>(() => {
		const entry = selected;

		if (!entry) {
			return [
				{
					id: 'browse',
					label: 'Browse',
					href: treeHref(repo, null),
					title: 'Browse the default branch'
				},
				{
					id: 'archive',
					label: 'Archive',
					href: archiveUrl(repo, defaultBranch ?? 'HEAD'),
					external: true,
					title: 'Download the default branch as a zip from github.com'
				}
			];
		}

		const list: Verb[] = [
			{
				id: 'browse',
				label: 'Browse',
				href: treeHref(repo, entry.name),
				title: `Browse the repository at ${entry.name}`,
				onhover: () => prefetch(GitHubSource.getTree(repo, entry.name, ''))
			}
		];

		// A tag's history is the range since the tag before it — which is the
		// changelog. A branch's is just its history, and the log screen has it.
		if (entry.kind === 'tag') {
			if (base) {
				list.push({
					id: 'since',
					label: 'Log since previous',
					href: compareHref(repo, base.oid, entry.oid),
					title: `Every commit between ${base.label} and ${entry.name}`,
					onhover: () => prefetch(GitHubSource.getCompare(repo, base.oid, entry.oid))
				});
			}
		} else {
			list.push({
				id: 'log',
				label: 'Log',
				href: logHref(repo, entry.name),
				title: `History at ${entry.name}`,
				onhover: () => prefetch(GitHubSource.getLog(repo, entry.name, '', null))
			});
		}

		list.push({
			id: 'archive',
			label: 'Archive',
			href: archiveUrl(repo, entry.name),
			external: true,
			title: `Download ${entry.name} as a zip from github.com`
		});

		// Comparing the default branch with itself is nothing, so the verb that
		// would do it is absent — the rule since Phase 3.
		if (defaultHead && defaultHead.oid !== entry.oid) {
			list.push({
				id: 'compare',
				label: 'Compare',
				href: compareHref(repo, defaultHead.oid, entry.oid),
				title: `What ${entry.name} has that ${defaultBranch ?? 'the default branch'} does not`,
				onhover: () => prefetch(GitHubSource.getCompare(repo, defaultHead.oid, entry.oid))
			});
		}

		/**
		 * Phase 6 is where this stops being conditional. Every ref on this screen
		 * arrived with the commit it resolves to, so a permanent address is
		 * always available — which is the thing Phases 3, 4 and 5 were waiting
		 * for and hid the verb without.
		 */
		list.push({
			id: 'permalink',
			label: 'Permalink',
			href: treeHref(repo, entry.oid),
			title: 'Browse this ref at the commit it points at — cached permanently',
			onhover: () => prefetch(GitHubSource.getTree(repo, entry.oid, ''))
		});

		return list;
	});

	const utility = $derived<Verb>(
		selected
			? {
					id: 'copy',
					label: copied === 'sha' ? 'Copied' : 'Copy SHA',
					onselect: () => put('sha', selected.oid)
				}
			: {
					id: 'copy',
					label: copied === 'name' ? 'Copied' : 'Copy name',
					onselect: () => put('name', `${repo.owner}/${repo.name}`)
				}
	);

	/* ------------------------------------------------------------- chrome -- */

	const crumbs = $derived.by<Crumb[]>(() => {
		const list: Crumb[] = [
			{ label: repo.owner },
			{ label: repo.name, href: treeHref(repo, null) },
			{ label: 'refs', href: refsHref(repo) }
		];
		if (selected) list.push({ label: selected.name, mono: true });
		return list;
	});

	const about = $derived.by<PanelEntry[]>(() => {
		if (selected) {
			const entries: PanelEntry[] = [
				{ key: 'Ref', value: selected.name, mono: true },
				{ key: 'Kind', value: selected.kind === 'tag' ? 'Tag' : 'Branch' },
				{ key: 'Target', value: selected.abbreviatedOid, mono: true },
				{ key: 'Committed', value: ago(selected.committedDate) },
				{ key: 'Author', value: refAuthor(selected) }
			];
			if (selected.ahead !== null) entries.push({ key: 'Ahead', value: count(selected.ahead) });
			if (selected.behind !== null) entries.push({ key: 'Behind', value: count(selected.behind) });
			if (selected.annotation) {
				entries.push({ key: 'Annotated', value: 'Yes', accent: true });
			}
			return entries;
		}

		const data = summary.data;
		if (!data) return [];
		return [
			{ key: 'Repository', value: data.nameWithOwner, mono: true },
			{ key: 'Default', value: data.defaultBranch ?? '—', mono: true },
			{ key: 'Branches', value: count(data.counts.branches) },
			{ key: 'Tags', value: count(data.counts.tags) }
		];
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
	 * How many refs there are, as against how many are loaded. The walk's own
	 * total is the better answer once it lands; before that — and for the kind a
	 * filter is not loading at all — the repository summary already knows.
	 */
	const branchCount = $derived(branches.total ?? summary.data?.counts.branches ?? null);
	const tagCount = $derived(tags.total ?? summary.data?.counts.tags ?? null);
	const refsCount = $derived(
		branchCount === null && tagCount === null ? null : (branchCount ?? 0) + (tagCount ?? 0)
	);

	const failure = $derived(branches.error ?? tags.error ?? summary.error);
	const nothingLoaded = $derived(branches.items.length === 0 && tags.items.length === 0);
	const loading = $derived(branches.loading || tags.loading || summary.loading);
</script>

<svelte:window onkeydown={onKeydown} />

{#snippet sidebar()}
	<Sidebar repo={summary.data} active="refs" {refsCount} section="Scope">
		<Kinds {repo} {kind} branches={branchCount} tags={tagCount} {defaultBranch} />
	</Sidebar>
{/snippet}

{#snippet pills()}
	{#if defaultBranch}
		<Pill mono tone="accent" title="The default branch — what ahead and behind mean">
			{defaultBranch}
		</Pill>
	{/if}
	{#if defaultHead}
		<Pill mono title={defaultHead.messageHeadline}>{defaultHead.abbreviatedOid}</Pill>
	{/if}
{/snippet}

{#snippet header()}
	<Header {crumbs} {pills} {verbs} {utility} />
{/snippet}

{#snippet panel()}
	<RightPanel since={since.label} visit={since.rows} {about} open={openAgainst} />
{/snippet}

<Shell {sidebar} {header} {panel}>
	<!-- The same split as the log: the list scrolls, the detail stays put, and
	     the keyboard walks one with the other filling in place. -->
	<div class="split">
		<div class="screen">
			{#if failure && nothingLoaded}
				<p class="fail" role="alert">
					<b>{ERROR_LABEL[failure.kind]}</b>{failure.message}
				</p>
			{:else}
				{#if failure}
					<!-- Refs on screen, failed revalidation behind them. Both true. -->
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
						placeholder="Filter loaded refs  /"
						aria-label="Filter loaded refs"
						autocomplete="off"
						spellcheck="false"
					/>
					<span class="tally">
						{#if !loading || !nothingLoaded}
							{count(shownBranches.length + shownTags.length)} shown ·
							{count((branches.total ?? 0) + (tags.total ?? 0))} refs
						{/if}
					</span>
				</div>

				<div class="cols" aria-hidden="true">
					<span class="c-name">Ref</span>
					<span class="c-drift">State</span>
					<span class="c-sha">Target</span>
					<span class="c-msg">Tip</span>
					<span class="c-age">Age</span>
				</div>

				<!-- Refs are a set of places you can go, so the list is navigation. -->
				<nav class="list" aria-label="Refs">
					<VirtualRows items={rows} rowHeight={32} reveal={active} revealMargin={28}>
						{#snippet row(item: Row, index: number)}
							{#if item.row === 'group'}
								<div class="row group">
									<Icon name={item.id === 'g-tag' ? 'tag' : 'branch'} />
									<span class="glabel">{item.label}</span>
									<span class="gcount mono">
										{#if item.total !== null && item.total !== item.loaded}
											{count(item.loaded)} of {count(item.total)}
										{:else}
											{count(item.loaded)}
										{/if}
									</span>
								</div>
							{:else if item.row === 'more'}
								<button
									class="row more"
									onclick={() => more(item.which)}
									disabled={item.which === 'branch' ? branches.loadingMore : tags.loadingMore}
								>
									<span class="mname">
										{(item.which === 'branch' ? branches.loadingMore : tags.loadingMore)
											? 'Loading…'
											: `Load more ${item.which === 'branch' ? 'branches' : 'tags'}`}
									</span>
									<span class="mrest mono">{count(item.rest)} more</span>
								</button>
							{:else}
								{@const entry = item.entry}
								{@const on = index === active}
								<!-- Selection is not carried by colour alone — DESIGN.md §9. -->
								<a
									class="row"
									class:sel={on}
									class:def={entry.name === defaultBranch}
									aria-current={on ? 'true' : undefined}
									href={treeHref(repo, entry.name)}
									title="{entry.name} — {entry.headline}"
									onclick={(event) => pick(event, entry)}
									ondblclick={() => open(item)}
									onpointerenter={() => prefetch(GitHubSource.getTree(repo, entry.name, ''))}
								>
									<span class="name mono">{entry.name}</span>
									<span class="drift mono">
										{#if entry.name === defaultBranch}
											<span class="badge">default</span>
										{:else if entry.ahead !== null && entry.behind !== null}
											{#if entry.ahead === 0 && entry.behind === 0}
												<span class="even">even</span>
											{:else}
												<span class="up" title="{entry.ahead} commits ahead"
													>↑{count(entry.ahead)}</span
												>
												<span class="down" title="{entry.behind} commits behind"
													>↓{count(entry.behind)}</span
												>
											{/if}
										{:else if entry.annotation}
											<span class="even">annotated</span>
										{/if}
									</span>
									<span class="sha mono">{entry.abbreviatedOid}</span>
									<span class="msg">{entry.headline}</span>
									<span class="age mono" title={entry.committedDate}>
										{ago(entry.committedDate)}
									</span>
								</a>
							{/if}
						{/snippet}

						{#snippet empty()}
							<p class="none">
								{#if loading}
									&nbsp;
								{:else if filter.trim()}
									No ref matches <b>{filter.trim()}</b>.
								{:else}
									This repository has no refs we can read.
								{/if}
							</p>
						{/snippet}
					</VirtualRows>
				</nav>
			{/if}
		</div>

		{#if selected}
			<RefDetail
				{repo}
				entry={selected}
				base={identical ? null : base}
				comparison={comparison.data}
				loading={comparison.loading || (resting === null && Boolean(base) && !identical)}
				error={comparison.error}
				reason={identical ? `Even with ${base?.label}.` : reason}
				{isDefault}
			/>
		{/if}
	</div>
</Shell>

<style>
	.split {
		height: 100%;
		display: flex;
		flex-direction: column;
		min-height: 0;
	}

	.screen {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		overflow-y: auto;
	}

	.bar {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 8px var(--pad-main);
		flex: none;
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
		flex: none;
	}

	.row {
		display: flex;
		align-items: center;
		gap: 8px;
		height: var(--row-h);
		padding: 0 var(--pad-main);
		color: var(--tx3);
		width: 100%;
		text-align: left;
		transition: background-color 120ms;
	}

	a.row:hover,
	button.row:hover:not(:disabled) {
		background: var(--hover);
	}

	/* Keyboard and mouse selection look identical — DESIGN.md §6. */
	.row.sel {
		background: var(--sel);
	}

	/* A heading is a row so the list stays one window of one row height —
	   the same call the diff makes about its file headers. */
	.group {
		background: var(--side);
		border-bottom: 1px solid var(--bd);
		color: var(--tx2);
	}

	.glabel {
		font-size: 11px;
		font-weight: 500;
		color: var(--tx2);
	}

	.gcount {
		margin-left: auto;
		font-size: 11px;
		color: var(--tx3);
	}

	.more {
		color: var(--tx2);
	}

	.more:disabled {
		cursor: default;
		color: var(--tx3);
	}

	.mname {
		font-size: 12px;
		padding-left: 22px;
	}

	.mrest {
		margin-left: auto;
		font-size: 11px;
		color: var(--tx3);
	}

	.c-name,
	.name {
		width: 30%;
		max-width: 260px;
		flex: none;
		font-size: 12px;
		color: var(--tx);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.row.sel .name,
	.row.def .name {
		font-weight: 500;
	}

	.row.def .name {
		color: var(--acc-tx);
	}

	.c-drift,
	.drift {
		width: 104px;
		flex: none;
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 11px;
	}

	/* Ahead and behind stay greyscale: DESIGN.md §3 spends green and red on
	   diff state and nothing else, and each meaning is used once. */
	.up {
		color: var(--tx2);
	}

	.down,
	.even {
		color: var(--tx3);
	}

	.badge {
		font-size: 10px;
		color: var(--acc-tx);
	}

	.c-sha,
	.sha {
		width: 64px;
		flex: none;
	}

	.sha {
		font-size: 11px;
		color: var(--acc-tx);
	}

	.c-msg,
	.msg {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.msg {
		font-size: 12px;
		color: var(--tx2);
	}

	.c-age,
	.age {
		width: 44px;
		flex: none;
		font-size: 11px;
		color: var(--tx3);
		text-align: right;
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
		font-family: var(--font-mono);
	}

	.fail,
	.warn {
		margin: 0;
		padding: 12px var(--pad-main);
		color: var(--tx2);
		flex: none;
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

	/* Below the sidebar breakpoint the tip message gives its width to the name. */
	@media (max-width: 780px) {
		.c-msg,
		.msg {
			display: none;
		}
	}
</style>

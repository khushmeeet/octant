<script lang="ts">
	import { goto } from '$app/navigation';
	import {
		commitHref,
		fileHref,
		homeHref,
		logHref,
		parentPath,
		treeHref,
		type LogAddress
	} from '$lib/nav/paths';
	import { ERROR_LABEL, GitHubSource, logAuthor, type LogCommit } from '$lib/source';
	import { pages } from '$lib/sync/pages.svelte';
	import { prefetch } from '$lib/sync/prefetch';
	import { resource } from '$lib/sync/resource.svelte';
	import DeltaBar from '$lib/ui/DeltaBar.svelte';
	import Header from '$lib/ui/Header.svelte';
	import Pill from '$lib/ui/Pill.svelte';
	import RightPanel from '$lib/ui/RightPanel.svelte';
	import Shell from '$lib/ui/Shell.svelte';
	import Sidebar from '$lib/ui/Sidebar.svelte';
	import VirtualRows from '$lib/ui/VirtualRows.svelte';
	import { copy } from '$lib/ui/clipboard';
	import { ago, count } from '$lib/ui/format';
	import type { Crumb, PanelEntry, Verb } from '$lib/ui/types';
	import { sinceLastVisit } from '$lib/visits/since.svelte';
	import Authors from './Authors.svelte';
	import CommitDetail from './CommitDetail.svelte';
	import CommitGraph from './CommitGraph.svelte';
	import { tallyAuthors } from './authors';
	import { commitGraph } from './graph';

	/**
	 * The Log screen — PLAN.md Phase 5. "When did this file get slow?"
	 *
	 * The screen is a split rather than one scrolling column, which is a
	 * departure from the Tree and File screens and a deliberate one. Scanning a
	 * log and reading a commit are two halves of one question, and putting the
	 * detail below the table means `j` and `k` walk the history with each
	 * commit's message and files appearing in place — rather than a round trip
	 * to another screen and back for every candidate. `VirtualRows` already
	 * virtualises against its nearest scrolling ancestor, so the table having its
	 * own scroller costs nothing: it was built for this in Phase 3.
	 *
	 * Four reads, none of them chained. The history and the repository summary go
	 * out together, as on every screen. The scope's own directory listing is
	 * whatever the Tree or File screen you came from already cached, and it
	 * answers two things the log cannot answer for itself: whether the scope is
	 * a file, and which commit this revision resolves to. The selected commit's
	 * files are the fourth, and they are debounced — see `CommitDetail`.
	 */
	interface Props {
		address: LogAddress;
	}

	let { address }: Props = $props();

	const repo = $derived(address.repo);
	const path = $derived(address.path);
	const rev = $derived(address.rev ?? 'HEAD');

	const summary = resource(() => GitHubSource.getRepo(repo));

	const since = sinceLastVisit(() => ({ repo, rev, head: summary.data?.head?.oid ?? null }));
	const log = pages<LogCommit>((after) => GitHubSource.getLog(repo, rev, path, after));

	/**
	 * The directory the scope sits in — the root when there is no scope. The
	 * same cache entry the tree screen reads for that directory, so it is a local
	 * read whenever you arrived from one, and it answers the two questions the
	 * verb row cannot answer for itself: whether the scope is a file, and what
	 * commit the revision on screen resolves to.
	 */
	const listingPath = $derived(path ? (parentPath(path) ?? '') : '');
	const siblings = resource(() => GitHubSource.getTree(repo, rev, listingPath));

	const scopeEntry = $derived(siblings.data?.entries.find((entry) => entry.path === path) ?? null);
	const scopeIsFile = $derived(scopeEntry?.type === 'blob');

	/* --------------------------------------------------------------- rows -- */

	let filter = $state('');
	/** Unset until the keyboard or a click moves it — a screen claims nothing. */
	let cursor = $state<number | null>(null);
	let filterField = $state<HTMLInputElement | null>(null);

	const authors = $derived(tallyAuthors(log.items));

	const rows = $derived.by(() => {
		const who = address.author?.toLowerCase() ?? null;
		const needle = filter.trim().toLowerCase();

		return log.items.filter((commit) => {
			if (who && logAuthor(commit).toLowerCase() !== who) return false;
			if (!needle) return true;
			return (
				commit.headline.toLowerCase().includes(needle) ||
				commit.oid.startsWith(needle) ||
				logAuthor(commit).toLowerCase().includes(needle)
			);
		});
	});

	/**
	 * Lanes are drawn over the rows on screen rather than over everything
	 * loaded, so a filtered log draws what it actually shows. Filtering breaks
	 * the parent chain, and `commitGraph` answers that with a spine — which is
	 * the honest picture of a list that is no longer a graph.
	 */
	const graph = $derived(commitGraph(rows));

	const active = $derived(cursor === null ? -1 : Math.min(cursor, rows.length - 1));
	const selected = $derived(active >= 0 ? (rows[active] ?? null) : null);

	// A new scope is a new question. Nothing about the last one survives it.
	$effect(() => {
		void path;
		void rev;
		void address.author;
		void repo.owner;
		void repo.name;
		filter = '';
		cursor = null;
	});

	/* ------------------------------------------------------------- detail -- */

	/**
	 * Holding `j` down through fifty rows must not be fifty requests, so the
	 * file list waits for the cursor to stop. Everything else in the pane comes
	 * from the row itself and is there immediately.
	 */
	const SETTLE_MS = 120;
	let resting = $state<string | null>(null);

	$effect(() => {
		const oid = selected?.oid ?? null;
		if (oid === null) {
			resting = null;
			return;
		}
		const timer = setTimeout(() => (resting = oid), SETTLE_MS);
		return () => clearTimeout(timer);
	});

	const detail = resource(() => (resting ? GitHubSource.getCommit(repo, resting) : null));

	/* ----------------------------------------------------------- keyboard -- */

	function open(commit: LogCommit | null): void {
		if (!commit) return;
		void goto(commitHref(repo, commit.oid));
	}

	function pick(event: MouseEvent, index: number): void {
		// A modified click belongs to the browser — open in a new tab, copy the
		// link address. Only a plain click is ours, and ours is to select: the
		// same bargain the code viewer's line numbers make.
		if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
		event.preventDefault();
		cursor = index;
	}

	function onKeydown(event: KeyboardEvent): void {
		const target = event.target as HTMLElement | null;
		const typing =
			target instanceof HTMLInputElement ||
			target instanceof HTMLTextAreaElement ||
			target?.isContentEditable === true;

		if (event.key === 'Escape') {
			if (filter) filter = '';
			else cursor = null;
			if (typing) target?.blur();
			return;
		}

		if (typing || event.metaKey || event.ctrlKey || event.altKey) return;

		switch (event.key) {
			case 'j':
			case 'ArrowDown':
				event.preventDefault();
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
				open(selected);
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
	 * The commit this log walks from — Phase 6, and what Permalink addresses on
	 * any revision rather than only the default branch.
	 *
	 * It comes from the directory listing rather than from the log pages,
	 * because `siblings` resolves the same revision this screen is showing and
	 * is already fetched on every visit (`source/revision.ts`). Threading it out
	 * through `pages()` instead would mean teaching a generic pagination
	 * primitive about a field only one of its callers has.
	 */
	const commitOid = $derived(siblings.data?.commitOid ?? null);
	const alreadyPermanent = $derived(address.rev !== null && address.rev === commitOid);

	/** Where a commit's tree starts: the scope, or the directory holding it. */
	const scopeDir = $derived(scopeIsFile ? listingPath : path);

	let copied = $state('');

	async function put(label: string, text: string) {
		if (await copy(text)) {
			copied = label;
			setTimeout(() => (copied = ''), 1200);
		}
	}

	const verbs = $derived.by<Verb[]>(() => {
		const list: Verb[] = [];
		const commit = selected;

		if (commit) {
			list.push(
				{
					id: 'diff',
					label: 'Diff',
					href: commitHref(repo, commit.oid),
					title: 'What this commit changed',
					// A verb resolves in under 50ms or it does not belong in the row
					// (DESIGN.md §5). Selecting the row has usually paid for this
					// already; hovering covers the case where it has not.
					onhover: () => prefetch(GitHubSource.getCommit(repo, commit.oid))
				},
				{
					id: 'tree',
					label: 'Tree here',
					href: treeHref(repo, commit.oid, scopeDir),
					title: 'Browse the repository as it stood at this commit',
					onhover: () => prefetch(GitHubSource.getTree(repo, commit.oid, scopeDir))
				}
			);

			// A verb that cannot act is absent — the rule the Tree screen set.
			// A directory has no blame, so the verb only exists over a file.
			if (scopeIsFile) {
				list.push({
					id: 'blame',
					label: 'Blame from here',
					href: fileHref(repo, commit.oid, path, { blame: true }),
					title: 'Who wrote each line, as of this commit',
					onhover: () => prefetch(GitHubSource.getBlame(repo, commit.oid, path))
				});
			}

			// We are a read client — ARCHITECTURE.md §1 allows no writes — and
			// github.com has no revert for a bare commit either. What resolves
			// instantly and is honest is the command you were going to run anyway.
			list.push(
				{
					id: 'revert',
					label: copied === 'revert' ? 'Copied' : 'Revert',
					title: `Copy: git revert ${commit.abbreviatedOid}`,
					onselect: () => put('revert', `git revert ${commit.oid}`)
				},
				{
					id: 'cherry',
					label: copied === 'cherry' ? 'Copied' : 'Cherry-pick',
					title: `Copy: git cherry-pick ${commit.abbreviatedOid}`,
					onselect: () => put('cherry', `git cherry-pick ${commit.oid}`)
				}
			);
		} else {
			list.push({
				id: 'tree',
				label: 'Tree',
				href: treeHref(repo, address.rev, scopeDir),
				title: 'Browse this revision'
			});
		}

		if (commitOid && !alreadyPermanent) {
			list.push({
				id: 'permalink',
				label: 'Permalink',
				href: logHref(repo, commitOid, path, { author: address.author }),
				title: 'Address this history by commit SHA — cached permanently once you do'
			});
		}

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
					label: copied === 'path' ? 'Copied' : 'Copy path',
					onselect: () => put('path', path || `${repo.owner}/${repo.name}`)
				}
	);

	/* ------------------------------------------------------------- chrome -- */

	const crumbs = $derived.by<Crumb[]>(() => {
		const list: Crumb[] = [
			{ label: repo.owner, href: homeHref() },
			{ label: repo.name, href: logHref(repo, address.rev, '') }
		];

		const segments = path ? path.split('/') : [];
		segments.forEach((segment, i) => {
			list.push({
				label: segment,
				mono: true,
				// Every crumb stays on this screen: walking up a log's path is
				// re-scoping the log, not leaving it.
				href: logHref(repo, address.rev, segments.slice(0, i + 1).join('/'), {
					author: address.author
				})
			});
		});
		return list;
	});

	/**
	 * The repository's block, plus one row the log is uniquely placed to add:
	 * whether anything landed *in the scope on screen*. The comparison already
	 * lists the paths, so a path-scoped answer is a lookup rather than a second
	 * read — which is the whole reason the delta is computed once per repository
	 * and projected, rather than once per thing you might ask about.
	 */
	const visit = $derived.by<PanelEntry[]>(() => {
		if (!path || !since.any) return since.rows;

		const mark = since.mark(path);
		return [
			{
				key: 'In this scope',
				value: mark ? `${count(mark.files)} file${mark.files === 1 ? '' : 's'}` : 'Nothing',
				accent: Boolean(mark)
			},
			...since.rows
		];
	});

	const about = $derived.by<PanelEntry[]>(() => {
		const entries: PanelEntry[] = [
			{ key: 'Scope', value: path || 'Whole repository', mono: Boolean(path) },
			{ key: 'Revision', value: address.rev ?? summary.data?.defaultBranch ?? 'HEAD', mono: true }
		];

		if (log.total !== null) entries.push({ key: 'Commits', value: count(log.total) });
		if (log.items.length > 0) {
			entries.push({ key: 'Loaded', value: count(log.items.length) });
			entries.push({ key: 'Newest', value: ago(log.items[0].committedDate) });
			entries.push({ key: 'Oldest', value: ago(log.items[log.items.length - 1].committedDate) });
		}
		if (address.author) {
			entries.push({ key: 'Author', value: address.author, accent: true });
		}
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

	const failure = $derived(log.error ?? summary.error);
</script>

<svelte:window onkeydown={onKeydown} />

{#snippet sidebar()}
	<Sidebar
		repo={summary.data}
		active="log"
		rev={address.rev}
		logCount={log.total}
		treeCount={siblings.data?.entries.length ?? null}
		section="Authors"
	>
		<Authors
			{repo}
			hrefRev={address.rev}
			{path}
			{authors}
			author={address.author}
			loading={log.loading}
		/>
	</Sidebar>
{/snippet}

{#snippet pills()}
	<Pill mono tone="accent" title={address.rev ? 'Revision from the URL' : 'The default branch'}>
		{address.rev ?? summary.data?.defaultBranch ?? 'HEAD'}
	</Pill>
	{#if address.author}
		<Pill tone="accent" title="Narrowed to commits by {address.author}">{address.author}</Pill>
	{/if}
	{#if head}
		<Pill mono title={head.messageHeadline}>{head.abbreviatedOid}</Pill>
	{/if}
{/snippet}

{#snippet header()}
	<!-- No verb is marked current: none of these is the view you are looking at.
	     They act on the selected commit when there is one, and on the scope
	     otherwise — every object carries its own verbs, ARCHITECTURE.md §2. -->
	<Header {crumbs} {pills} {verbs} {utility} />
{/snippet}

{#snippet panel()}
	<RightPanel since={since.label} {visit} {about} open={openAgainst} />
{/snippet}

<Shell {sidebar} {header} {panel}>
	<!--
	  The screen is a split: the table scrolls, the detail pane sits under it and
	  stays put. Scanning a log and reading a commit are two halves of one
	  question, so `j` and `k` walk the history with the message and the files
	  appearing in place rather than a round trip to another screen for every
	  candidate.
	-->
	<div class="split">
		<div class="screen">
			{#if failure && log.items.length === 0}
				<p class="fail" role="alert">
					<b>{ERROR_LABEL[failure.kind]}</b>{failure.message}
				</p>
			{:else}
				{#if failure}
					<!-- Commits on screen, failed revalidation behind them. Both true. -->
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
						placeholder="Filter loaded commits  /"
						aria-label="Filter loaded commits"
						autocomplete="off"
						spellcheck="false"
					/>
					<span class="tally">
						{#if log.total !== null}
							{#if rows.length !== log.items.length}
								{count(rows.length)} of {count(log.items.length)} loaded ·
							{:else}
								{count(log.items.length)} of
							{/if}
							{count(log.total)}
							{log.total === 1 ? 'commit' : 'commits'}
						{/if}
					</span>
				</div>

				<div class="cols" aria-hidden="true">
					<span class="c-graph"></span>
					<span class="c-msg">Message</span>
					<span class="c-sha">Commit</span>
					<span class="c-delta">Change</span>
					<span class="c-who">Author</span>
					<span class="c-age">Age</span>
				</div>

				<!-- A log is a set of commits you can go and read, so it is navigation
				     and gets a label rather than a list role whose option semantics it
				     would then have to fake. -->
				<nav class="list" aria-label="Commit log">
					<VirtualRows items={rows} rowHeight={32} reveal={active} revealMargin={28}>
						{#snippet row(commit: LogCommit, index: number)}
							<a
								class="row"
								class:sel={index === active}
								aria-current={index === active ? 'true' : undefined}
								href={commitHref(repo, commit.oid)}
								title={commit.headline}
								onclick={(event) => pick(event, index)}
								ondblclick={() => open(commit)}
							>
								<CommitGraph row={graph[index] ?? null} />
								<span class="msg">{commit.headline}</span>
								<span class="sha mono">{commit.abbreviatedOid}</span>
								<span class="delta">
									<DeltaBar additions={commit.additions} deletions={commit.deletions} />
									<span class="num mono">
										<b class="add">+{count(commit.additions)}</b>
										<b class="del">−{count(commit.deletions)}</b>
									</span>
								</span>
								<span class="who">{logAuthor(commit)}</span>
								<span class="age mono" title={commit.committedDate}>
									{ago(commit.committedDate)}
								</span>
							</a>
						{/snippet}

						{#snippet empty()}
							<p class="none">
								{#if log.loading}
									&nbsp;
								{:else if filter.trim() || address.author}
									Nothing loaded matches.
									{#if log.hasMore}There is more history behind this.{/if}
								{:else if path}
									Nothing has touched <b>{path}</b> at this revision.
								{:else}
									This revision has no history.
								{/if}
							</p>
						{/snippet}
					</VirtualRows>
				</nav>

				{#if log.hasMore}
					<div class="more">
						<button onclick={() => log.more()} disabled={log.loadingMore}>
							{log.loadingMore ? 'Loading…' : 'Load more'}
						</button>
						<span class="rest">
							{count(Math.max(0, (log.total ?? 0) - log.items.length))} older
						</span>
					</div>
				{/if}
			{/if}
		</div>

		{#if selected}
			<CommitDetail
				{repo}
				commit={selected}
				detail={detail.data}
				loading={detail.loading}
				error={detail.error}
			/>
		{/if}
	</div>
</Shell>

<style>
	/*
	 * `Shell` gives the main column a definite height, so `100%` here is that
	 * height and the two halves divide it rather than the page growing. The
	 * table is the scroller — `VirtualRows` finds it as its nearest scrolling
	 * ancestor, which is the case it was written for — and the detail pane below
	 * it does not move when the table does.
	 */
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
		transition: background-color 120ms;
	}

	.row:hover {
		background: var(--hover);
	}

	/* Keyboard and mouse selection look identical — DESIGN.md §6. */
	.row.sel {
		background: var(--sel);
	}

	/* `CommitGraph` owns its own width, so this is only the heading above it. */
	.c-graph {
		width: var(--col-graph);
		flex: none;
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
		font-size: 13px;
		color: var(--tx);
	}

	.row.sel .msg {
		font-weight: 500;
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

	.c-delta,
	.delta {
		width: 132px;
		flex: none;
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.num {
		font-size: 11px;
		display: flex;
		gap: 6px;
		margin-left: auto;
	}

	.add {
		color: var(--ok);
		font-weight: 400;
	}

	.del {
		color: var(--no);
		font-weight: 400;
	}

	.c-who,
	.who {
		width: 104px;
		flex: none;
		font-size: 12px;
		color: var(--tx2);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.c-age,
	.age {
		width: 44px;
		flex: none;
		font-size: 11px;
		color: var(--tx3);
		text-align: right;
	}

	.more {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 10px var(--pad-main) 24px;
	}

	.more button {
		font-size: 12px;
		color: var(--tx2);
		border: 1px solid var(--bd);
		border-radius: var(--radius-pill);
		padding: 4px 10px;
		transition:
			color 120ms,
			border-color 120ms;
	}

	.more button:hover:not(:disabled) {
		border-color: var(--bd2);
		color: var(--tx);
	}

	.more button:disabled {
		cursor: default;
		color: var(--tx3);
	}

	.rest {
		font-size: 11px;
		color: var(--tx3);
		font-variant-numeric: tabular-nums;
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

	/* Below the sidebar breakpoint the scope panel is gone, so the columns that
	   repeat what the detail pane says give their width to the message. */
	@media (max-width: 780px) {
		.c-who,
		.who,
		.c-delta,
		.delta {
			display: none;
		}
	}
</style>

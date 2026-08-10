<script lang="ts">
	import { goto } from '$app/navigation';
	import {
		githubPullUrl,
		homeHref,
		pullHref,
		pullsHref,
		repoHref,
		treeHref,
		type PullsAddress
	} from '$lib/nav/paths';
	import {
		ERROR_LABEL,
		GitHubSource,
		pullAuthor,
		type CheckState,
		type PullEntry
	} from '$lib/source';
	import { pages } from '$lib/sync/pages.svelte';
	import { prefetch } from '$lib/sync/prefetch';
	import { resource } from '$lib/sync/resource.svelte';
	import DeltaBar from '$lib/ui/DeltaBar.svelte';
	import Dot from '$lib/ui/Dot.svelte';
	import Header from '$lib/ui/Header.svelte';
	import Pill from '$lib/ui/Pill.svelte';
	import RightPanel from '$lib/ui/RightPanel.svelte';
	import Shell from '$lib/ui/Shell.svelte';
	import Sidebar from '$lib/ui/Sidebar.svelte';
	import VirtualRows from '$lib/ui/VirtualRows.svelte';
	import { copy } from '$lib/ui/clipboard';
	import { ago, count } from '$lib/ui/format';
	import type { Crumb, PanelEntry, Verb } from '$lib/ui/types';
	import { reviewsSeen } from '$lib/visits/reviews.svelte';
	import States from './States.svelte';

	/**
	 * The pull request list — PLAN.md Phase 7's "PR list, then the diff-first
	 * detail view".
	 *
	 * This is a triage screen and it is shaped like one: one row per pull
	 * request, everything a row shows arriving with the row, and nothing on it
	 * that costs a second read. The question it answers is "which of these needs
	 * me", which is why the columns are the ones they are — CI state and review
	 * decision earn their width because they are what makes a row skippable.
	 *
	 * `enter` warms the detail screen on the way out, and hovering a row does
	 * the same, so the diff-first view opens on data that is already on disk.
	 * That is the same bargain the log's rows make with the commit screen.
	 */
	interface Props {
		address: PullsAddress;
	}

	let { address }: Props = $props();

	const repo = $derived(address.repo);
	const filter = $derived(address.filter);

	const summary = resource(() => GitHubSource.getRepo(repo));
	const walk = pages<PullEntry>((after) => GitHubSource.getPulls(repo, filter, after));

	/**
	 * Phase 8's delta for this screen, and the only one in the app that costs no
	 * request: the records Phase 7 writes when you mark a review done, read as
	 * one prefix scan, against head SHAs the list is already carrying.
	 */
	const seen = reviewsSeen(() => repo);

	/** A row you have reviewed and that has been pushed to since. */
	function movedSince(entry: PullEntry): boolean {
		return seen.stateOf(entry.number, entry.headRefOid) === 'moved';
	}

	/* --------------------------------------------------------------- rows -- */

	let query = $state('');
	let field = $state<HTMLInputElement | null>(null);

	function matches(entry: PullEntry, needle: string): boolean {
		if (!needle) return true;
		return (
			entry.title.toLowerCase().includes(needle) ||
			String(entry.number) === needle ||
			`#${entry.number}`.startsWith(needle) ||
			(entry.authorLogin ?? '').toLowerCase().includes(needle) ||
			entry.headRefName.toLowerCase().includes(needle)
		);
	}

	const shown = $derived(walk.items.filter((entry) => matches(entry, query.trim().toLowerCase())));

	/** The cursor is local: a row of a triage list is a place you pass through. */
	let cursor = $state(-1);

	$effect(() => {
		// A filter that hides the cursor should not leave it pointing at nothing.
		if (cursor >= shown.length) cursor = shown.length - 1;
	});

	function step(delta: number): void {
		if (shown.length === 0) return;
		cursor = cursor < 0 ? 0 : Math.min(shown.length - 1, Math.max(0, cursor + delta));
	}

	function open(entry: PullEntry | undefined): void {
		if (!entry) return;
		void goto(pullHref(repo, entry.number));
	}

	function warm(entry: PullEntry): void {
		prefetch(GitHubSource.getPull(repo, entry.number));
	}

	function pick(event: MouseEvent, index: number): void {
		// A modified click belongs to the browser — the same bargain the log's
		// rows make. A plain one moves the cursor and follows the link.
		if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
		cursor = index;
	}

	function onKeydown(event: KeyboardEvent): void {
		const target = event.target as HTMLElement | null;
		const typing =
			target instanceof HTMLInputElement ||
			target instanceof HTMLTextAreaElement ||
			target?.isContentEditable === true;

		if (event.key === 'Escape') {
			if (query) query = '';
			else cursor = -1;
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
				if (cursor < 0) break;
				event.preventDefault();
				open(shown[cursor]);
				break;
			case '/':
				event.preventDefault();
				field?.focus();
				field?.select();
				break;
		}
	}

	/* ------------------------------------------------------------ display -- */

	const CHECK_LABEL: Record<CheckState, string> = {
		success: 'passing',
		failure: 'failing',
		pending: 'running',
		none: ''
	};

	const DECISION: Record<string, string> = {
		APPROVED: 'approved',
		CHANGES_REQUESTED: 'changes',
		REVIEW_REQUIRED: 'review'
	};

	function stateOf(entry: PullEntry): string {
		if (entry.state === 'MERGED') return 'merged';
		if (entry.state === 'CLOSED') return 'closed';
		return entry.isDraft ? 'draft' : 'open';
	}

	/* -------------------------------------------------------------- verbs -- */

	let copied = $state('');

	async function put(label: string, text: string) {
		if (await copy(text)) {
			copied = label;
			setTimeout(() => (copied = ''), 1200);
		}
	}

	const selected = $derived<PullEntry | null>(cursor >= 0 ? (shown[cursor] ?? null) : null);

	const verbs = $derived.by<Verb[]>(() => {
		const entry = selected;

		if (!entry) {
			return [
				{
					id: 'open',
					label: 'Open',
					href: pullsHref(repo, { filter: 'open' }),
					title: 'Pull requests still in flight'
				},
				{
					id: 'browse',
					label: 'Browse',
					href: treeHref(repo, null),
					title: 'Browse the default branch'
				}
			];
		}

		return [
			{
				id: 'review',
				label: 'Review',
				href: pullHref(repo, entry.number),
				title: `Read the diff of #${entry.number}`,
				onhover: () => warm(entry)
			},
			{
				id: 'files',
				label: 'Files',
				href: pullHref(repo, entry.number, { view: 'all' }),
				title: 'Every file this pull request touches',
				onhover: () => warm(entry)
			},
			{
				id: 'branch',
				label: 'Browse head',
				href: treeHref(repo, entry.headRefName),
				title: `Browse the repository at ${entry.headRefName}`,
				onhover: () => prefetch(GitHubSource.getTree(repo, entry.headRefName, ''))
			},
			{
				id: 'compare',
				label: 'Compare',
				href: pullHref(repo, entry.number, { view: 'all' }),
				title: `What ${entry.headRefName} has that ${entry.baseRefName} does not`,
				onhover: () => warm(entry)
			},
			{
				id: 'conversation',
				label: 'Conversation',
				href: githubPullUrl(repo, entry.number),
				external: true,
				title: 'The comment thread on github.com — writing one is out of scope'
			}
		];
	});

	const utility = $derived<Verb>(
		selected
			? {
					id: 'copy',
					label: copied === 'checkout' ? 'Copied' : 'Copy checkout',
					title: `Copy: git fetch origin pull/${selected.number}/head`,
					onselect: () =>
						put(
							'checkout',
							`git fetch origin pull/${selected.number}/head:pr-${selected.number} && git switch pr-${selected.number}`
						)
				}
			: {
					id: 'copy',
					label: copied === 'name' ? 'Copied' : 'Copy name',
					onselect: () => put('name', `${repo.owner}/${repo.name}`)
				}
	);

	/* ------------------------------------------------------------- chrome -- */

	const crumbs = $derived.by<Crumb[]>(() => [
		{ label: repo.owner, href: homeHref() },
		{ label: repo.name, href: repoHref(repo) },
		{ label: 'pulls', href: pullsHref(repo) }
	]);

	const moved = $derived(walk.items.filter(movedSince));
	const unseen = $derived(
		walk.items.filter((entry) => seen.stateOf(entry.number, entry.headRefOid) === 'unseen')
	);

	const visit = $derived.by<PanelEntry[]>(() => {
		if (!seen.ready) return [{ key: 'Reviewed before', value: '—' }];

		return [
			{ key: 'Reviewed before', value: `${count(seen.count)}` },
			{ key: 'Moved since', value: count(moved.length), accent: moved.length > 0 },
			{ key: 'Never opened', value: count(unseen.length) }
		];
	});

	const about = $derived.by<PanelEntry[]>(() => {
		if (selected) {
			return [
				{ key: 'Pull request', value: `#${selected.number}`, mono: true },
				{ key: 'State', value: stateOf(selected) },
				{ key: 'Author', value: pullAuthor(selected) },
				{ key: 'Base', value: selected.baseRefName, mono: true },
				{ key: 'Head', value: selected.headRefName, mono: true },
				{ key: 'Files', value: count(selected.changedFiles) },
				{ key: 'Added', value: `+${count(selected.additions)}` },
				{ key: 'Removed', value: `−${count(selected.deletions)}` }
			];
		}

		const data = summary.data;
		if (!data) return [];
		return [
			{ key: 'Repository', value: data.nameWithOwner, mono: true },
			{ key: 'Default', value: data.defaultBranch ?? '—', mono: true },
			{ key: 'Showing', value: filter }
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

	const openTotal = $derived(summary.data?.counts.openPullRequests ?? null);
	const reviewCount = $derived(walk.total ?? openTotal);
	const failure = $derived(walk.error ?? summary.error);
</script>

<svelte:window onkeydown={onKeydown} />

{#snippet sidebar()}
	<Sidebar repo={summary.data} active="review" {reviewCount} section="Scope">
		<States {repo} {filter} shownTotal={walk.total} {openTotal} />
	</Sidebar>
{/snippet}

{#snippet pills()}
	{#if walk.total !== null}
		<Pill tone={filter === 'open' ? 'accent' : 'default'}>
			{count(walk.total)}
			{filter}
		</Pill>
	{/if}
{/snippet}

{#snippet header()}
	<Header {crumbs} {pills} {verbs} {utility} />
{/snippet}

{#snippet panel()}
	<RightPanel {visit} {about} open={openAgainst} />
{/snippet}

<Shell {sidebar} {header} {panel}>
	{#if failure && walk.items.length === 0}
		<p class="fail" role="alert">
			<b>{ERROR_LABEL[failure.kind]}</b>{failure.message}
		</p>
	{:else}
		{#if failure}
			<!-- The list on screen, failed revalidation behind it. Both true. -->
			<p class="warn" role="status">
				<b>{ERROR_LABEL[failure.kind]}</b>Showing what was cached. {failure.message}
			</p>
		{/if}

		<div class="bar">
			<input
				bind:this={field}
				bind:value={query}
				class="filter"
				type="search"
				placeholder="Filter loaded pull requests  /"
				aria-label="Filter loaded pull requests"
				autocomplete="off"
				spellcheck="false"
			/>
			<span class="tally">
				{#if walk.total !== null}
					{#if shown.length !== walk.items.length}
						{count(shown.length)} of {count(walk.items.length)} loaded ·
					{/if}
					{count(walk.total)}
					{filter === 'all' ? 'pull requests' : filter}
				{/if}
			</span>
		</div>

		<div class="cols" aria-hidden="true">
			<span class="c-num">#</span>
			<span class="c-flag"></span>
			<span class="c-title">Title</span>
			<span class="c-who">Author</span>
			<span class="c-ref">Into</span>
			<span class="c-delta">Change</span>
			<span class="c-state">State</span>
			<span class="c-age">Age</span>
		</div>

		<nav class="list" aria-label="Pull requests">
			<VirtualRows items={shown} rowHeight={32} reveal={cursor} revealMargin={28}>
				{#snippet row(entry: PullEntry, index: number)}
					{@const on = index === cursor}
					<!-- Selection is not carried by colour alone — DESIGN.md §9. -->
					<a
						class="row"
						class:sel={on}
						aria-current={on ? 'true' : undefined}
						href={pullHref(repo, entry.number)}
						title="#{entry.number} {entry.title}"
						onclick={(event) => pick(event, index)}
						onpointerenter={() => warm(entry)}
					>
						<span class="num mono">{entry.number}</span>
						{#if movedSince(entry)}
							<Dot
								title="Pushed to since you reviewed it — was {seen
									.reviewedAt(entry.number)
									?.slice(0, 7)}"
							/>
						{:else}
							<Dot title="" placeholder />
						{/if}
						<span class="title">
							{entry.title}
							{#if entry.comments > 0}
								<span class="talk mono" title="{entry.comments} comments">
									{count(entry.comments)}
								</span>
							{/if}
						</span>
						<span class="who">{pullAuthor(entry)}</span>
						<span class="ref mono" title="{entry.headRefName} → {entry.baseRefName}">
							{entry.baseRefName}
						</span>
						<span class="delta">
							<DeltaBar additions={entry.additions} deletions={entry.deletions} />
						</span>
						<span class="state">
							<span class="badge {stateOf(entry)}">{stateOf(entry)}</span>
							{#if entry.checks !== 'none'}
								<!-- Green and red are diff state everywhere else, so a check is
								     a word first and a tint second — DESIGN.md §3 and §9. -->
								<span class="ck {entry.checks}" title="Checks {CHECK_LABEL[entry.checks]}">
									{CHECK_LABEL[entry.checks]}
								</span>
							{/if}
							{#if entry.reviewDecision && DECISION[entry.reviewDecision]}
								<span class="dec {entry.reviewDecision}">{DECISION[entry.reviewDecision]}</span>
							{/if}
						</span>
						<span class="age mono" title={entry.updatedAt}>{ago(entry.updatedAt)}</span>
					</a>
				{/snippet}

				{#snippet empty()}
					<p class="none">
						{#if walk.loading}
							&nbsp;
						{:else if query.trim()}
							No pull request matches <b>{query.trim()}</b>.
						{:else if filter === 'open'}
							Nothing is in flight.
						{:else}
							No {filter} pull requests.
						{/if}
					</p>
				{/snippet}
			</VirtualRows>
		</nav>

		{#if walk.hasMore}
			<!-- A button, not infinite scroll: a rate limit is a real budget, and a
			     virtualised list that is also the page's scroller should not
			     surprise you at the bottom. -->
			<button class="more" onclick={() => walk.more()} disabled={walk.loadingMore}>
				{walk.loadingMore
					? 'Loading…'
					: `Load more · ${count(Math.max(0, (walk.total ?? 0) - walk.items.length))} left`}
			</button>
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

	.c-num,
	.num {
		width: 46px;
		flex: none;
		font-size: 11px;
		color: var(--acc-tx);
		text-align: right;
	}

	/* Holds the dot column open in the header, so the columns below line up
	   whether or not a row has news. */
	.c-flag {
		width: 5px;
		flex: none;
	}

	.c-title,
	.title {
		flex: 1;
		min-width: 0;
		font-size: 12px;
		color: var(--tx);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.row.sel .title {
		font-weight: 500;
	}

	.talk {
		font-size: 10px;
		color: var(--tx3);
		margin-left: 6px;
	}

	.c-who,
	.who {
		width: 96px;
		flex: none;
		font-size: 12px;
		color: var(--tx2);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.c-ref,
	.ref {
		width: 96px;
		flex: none;
		font-size: 11px;
		color: var(--tx3);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.c-delta,
	.delta {
		width: 46px;
		flex: none;
		display: flex;
		align-items: center;
	}

	.c-state,
	.state {
		width: 168px;
		flex: none;
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 11px;
		overflow: hidden;
	}

	.badge {
		flex: none;
		color: var(--tx2);
	}

	.badge.open {
		color: var(--acc-tx);
	}

	.badge.draft,
	.badge.closed {
		color: var(--tx3);
	}

	.ck {
		flex: none;
	}

	.ck.success {
		color: var(--tx3);
	}

	/* The one place a failing check spends colour: it is the thing you would
	   act on, and the word says it too. */
	.ck.failure {
		color: var(--no);
	}

	.ck.pending {
		color: var(--tx3);
	}

	.dec {
		flex: none;
		color: var(--tx3);
	}

	.dec.APPROVED {
		color: var(--ok);
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
		display: block;
		width: 100%;
		height: var(--row-h);
		font-size: 12px;
		color: var(--tx2);
		border-top: 1px solid var(--bd);
		transition:
			color 120ms,
			background-color 120ms;
	}

	.more:hover:not(:disabled) {
		background: var(--hover);
		color: var(--tx);
	}

	.more:disabled {
		color: var(--tx3);
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
		font-family: var(--font-mono);
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

	/* Below the sidebar breakpoint the branch column gives its width back. */
	@media (max-width: 780px) {
		.c-ref,
		.ref,
		.c-who,
		.who {
			display: none;
		}
	}
</style>

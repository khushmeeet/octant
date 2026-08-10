<script lang="ts">
	import { goto } from '$app/navigation';
	import { session } from '$lib/auth/token.svelte';
	import {
		githubPullUrl,
		homeHref,
		logHref,
		pullHref,
		pullsHref,
		refsHref,
		repoHref,
		treeHref,
		type HomeAddress
	} from '$lib/nav/paths';
	import {
		ERROR_LABEL,
		GitHubSource,
		parseRepoRef,
		pullAuthor,
		type CheckState,
		type InboxPull,
		type RepoRef,
		type ViewerRepo
	} from '$lib/source';
	import { pages } from '$lib/sync/pages.svelte';
	import { prefetch } from '$lib/sync/prefetch';
	import { resource } from '$lib/sync/resource.svelte';
	import DeltaBar from '$lib/ui/DeltaBar.svelte';
	import Dot from '$lib/ui/Dot.svelte';
	import Header from '$lib/ui/Header.svelte';
	import Icon from '$lib/ui/Icon.svelte';
	import Pill from '$lib/ui/Pill.svelte';
	import RightPanel from '$lib/ui/RightPanel.svelte';
	import Shell from '$lib/ui/Shell.svelte';
	import Sidebar from '$lib/ui/Sidebar.svelte';
	import VirtualRows from '$lib/ui/VirtualRows.svelte';
	import { copy } from '$lib/ui/clipboard';
	import { ago, agoAt, count } from '$lib/ui/format';
	import type { Crumb, NavHead, NavItem, PanelEntry, Verb } from '$lib/ui/types';
	import { reposSeen } from '$lib/visits/repos.svelte';
	import Recents from './Recents.svelte';

	/**
	 * The home screen — where the app opens.
	 *
	 * What was here before was a text field: `owner/name`, and a list of what you
	 * had opened before. It was defensible in the way a login form is defensible —
	 * it worked, and it asked you for something you already knew — but the first
	 * question a client of your own repositories should answer is *which ones are
	 * there*, and the second is *which of them needs you*. A text box answers
	 * neither, and a person who has just arrived is exactly the person who does
	 * not yet know what changed while they were away.
	 *
	 * So: two lists, one screen, one round trip each and no per-row read on
	 * either. Pull requests first, because they are the half with a deadline; the
	 * repositories under them, ordered by what was pushed to rather than
	 * alphabetically, so the top of the list is where the work is.
	 *
	 * **Nothing about this screen is a repository**, which is the one thing that
	 * makes it different from every other screen in the app: the sidebar's four
	 * primitives are questions about a repository and have nothing to point at
	 * here, so it brings its own three destinations, and the right panel's fixed
	 * three blocks are about the account instead.
	 *
	 * Typing `owner/name` into the filter still opens anything the token can read.
	 * That is the whole of the old screen, kept as a row rather than as a screen:
	 * a repository you can see but are not a member of is not on any list GitHub
	 * will hand us, and the ability to go there anyway was worth more than the
	 * screen that used to house it.
	 */
	interface Props {
		address: HomeAddress;
	}

	let { address }: Props = $props();

	const view = $derived(address.view);
	const viewer = $derived(session.viewer);
	const login = $derived(viewer?.login ?? null);

	const walk = pages<ViewerRepo>((after) =>
		login ? GitHubSource.getViewerRepos(login, after) : null
	);
	const inbox = resource(() => (login ? GitHubSource.getViewerPulls(login) : null));

	/**
	 * The delta, and it costs nothing: every repository screen writes a record
	 * when you look at it, the list carries every row's `pushedAt`, and one prefix
	 * scan turns the pair into "this moved while you were away".
	 */
	const seen = reposSeen();

	function movedSince(repo: ViewerRepo): boolean {
		return seen.stateOf(repo.nameWithOwner, repo.pushedAt) === 'moved';
	}

	/* --------------------------------------------------------------- rows -- */

	/**
	 * One list for the keyboard, two on screen. `j` and `k` walk everything the
	 * pointer can click and stop at neither section's edge, which is the same
	 * rule the tree's `..` row follows.
	 */
	type Row =
		| { kind: 'pull'; pull: InboxPull }
		| { kind: 'repo'; repo: ViewerRepo }
		/** Not on any list of ours: a repository named in the filter. */
		| { kind: 'direct'; ref: RepoRef };

	let query = $state('');
	let field = $state<HTMLInputElement | null>(null);

	const needle = $derived(query.trim().toLowerCase());

	const showPulls = $derived(view === 'all' || view === 'pulls');
	const showRepos = $derived(view === 'all' || view === 'repos');

	function matchesPull(entry: InboxPull, text: string): boolean {
		if (!text) return true;
		return (
			entry.title.toLowerCase().includes(text) ||
			entry.nameWithOwner.toLowerCase().includes(text) ||
			String(entry.number) === text ||
			`#${entry.number}`.startsWith(text) ||
			(entry.authorLogin ?? '').toLowerCase().includes(text)
		);
	}

	function matchesRepo(entry: ViewerRepo, text: string): boolean {
		if (!text) return true;
		return (
			entry.nameWithOwner.toLowerCase().includes(text) ||
			(entry.description ?? '').toLowerCase().includes(text)
		);
	}

	/**
	 * A filter that reads as an address is an address. Paste a github.com URL and
	 * it works too — it is the thing most likely to be on the clipboard when you
	 * arrive here.
	 */
	const direct = $derived.by<RepoRef | null>(() => {
		if (!showRepos || !needle) return null;

		const typed = query.trim().replace(/^https?:\/\/github\.com\//i, '');
		const parsed = parseRepoRef(typed.split(/[?#]/)[0].split('/').slice(0, 2).join('/'));
		if (!parsed) return null;

		// Already on the list below, where it carries more than a name does.
		const slug = `${parsed.owner}/${parsed.name}`.toLowerCase();
		if (walk.items.some((entry) => entry.nameWithOwner.toLowerCase() === slug)) return null;

		return parsed;
	});

	const pullRows = $derived.by<Row[]>(() =>
		showPulls
			? (inbox.data?.items ?? [])
					.filter((entry) => matchesPull(entry, needle))
					.map((pull) => ({ kind: 'pull', pull }) as const)
			: []
	);

	const repoRows = $derived.by<Row[]>(() => {
		if (!showRepos) return [];

		const rows: Row[] = walk.items
			.filter((entry) => matchesRepo(entry, needle))
			.map((repo) => ({ kind: 'repo', repo }) as const);

		if (direct) rows.unshift({ kind: 'direct', ref: direct });
		return rows;
	});

	/** What the cursor walks. The two sections in the order they are rendered. */
	const rows = $derived([...pullRows, ...repoRows]);

	/** Unset until the keyboard or the pointer moves it — as everywhere else. */
	let cursor = $state(-1);

	$effect(() => {
		// A filter that hides the cursor should not leave it pointing at nothing.
		if (cursor >= rows.length) cursor = rows.length - 1;
	});

	const selected = $derived<Row | null>(cursor >= 0 ? (rows[cursor] ?? null) : null);

	function step(delta: number): void {
		if (rows.length === 0) return;
		cursor = cursor < 0 ? 0 : Math.min(rows.length - 1, Math.max(0, cursor + delta));
	}

	function hrefOf(row: Row): string {
		if (row.kind === 'pull') return pullHref(row.pull.repo, row.pull.number);
		if (row.kind === 'repo') return repoHref(row.repo);
		return repoHref(row.ref);
	}

	function warm(row: Row): void {
		if (row.kind === 'pull') prefetch(GitHubSource.getPull(row.pull.repo, row.pull.number));
		else if (row.kind === 'repo') prefetch(GitHubSource.getRepo(row.repo));
	}

	function open(row: Row | undefined): void {
		if (row) void goto(hrefOf(row));
	}

	function pick(event: MouseEvent, index: number): void {
		// A modified click belongs to the browser. A plain one moves the cursor
		// and follows the link.
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

		if (event.key === 'Enter' && typing && cursor < 0 && rows.length > 0) {
			// Typed an address and pressed enter without ever leaving the field:
			// the first row is what was meant.
			event.preventDefault();
			open(rows[0]);
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
				open(rows[cursor]);
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

	/* -------------------------------------------------------------- verbs -- */

	let copied = $state('');

	async function put(label: string, text: string) {
		if (await copy(text)) {
			copied = label;
			setTimeout(() => (copied = ''), 1200);
		}
	}

	const verbs = $derived.by<Verb[]>(() => {
		const row = selected;

		if (row?.kind === 'pull') {
			const pull = row.pull;
			return [
				{
					id: 'review',
					label: 'Review',
					href: pullHref(pull.repo, pull.number),
					title: `Read the diff of ${pull.nameWithOwner}#${pull.number}`,
					onhover: () => warm(row)
				},
				{
					id: 'files',
					label: 'Files',
					href: pullHref(pull.repo, pull.number, { view: 'all' }),
					title: 'Every file this pull request touches',
					onhover: () => warm(row)
				},
				{
					id: 'repo',
					label: 'Repository',
					href: repoHref(pull.repo),
					title: `Browse ${pull.nameWithOwner}`,
					onhover: () => prefetch(GitHubSource.getRepo(pull.repo))
				},
				{
					id: 'conversation',
					label: 'Conversation',
					href: githubPullUrl(pull.repo, pull.number),
					external: true,
					title: 'The comment thread on github.com — writing one is out of scope'
				}
			];
		}

		const ref = row?.kind === 'repo' ? row.repo : row?.kind === 'direct' ? row.ref : null;

		if (ref) {
			return [
				{
					id: 'browse',
					label: 'Browse',
					href: treeHref(ref, null),
					title: 'Browse the default branch',
					onhover: () => prefetch(GitHubSource.getRepo(ref))
				},
				{ id: 'log', label: 'Log', href: logHref(ref, null, ''), title: 'What has landed here' },
				{ id: 'refs', label: 'Refs', href: refsHref(ref), title: 'Branches and tags' },
				{
					id: 'review',
					label: 'Review',
					href: pullsHref(ref),
					title: 'Pull requests still in flight'
				}
			];
		}

		return [
			{
				id: 'pulls',
				label: 'Pull requests',
				href: homeHref({ view: 'pulls' }),
				title: 'Only what is in flight'
			},
			{
				id: 'repos',
				label: 'Repositories',
				href: homeHref({ view: 'repos' }),
				title: 'Only the repositories'
			}
		];
	});

	const utility = $derived.by<Verb | undefined>(() => {
		const row = selected;
		if (!row) return undefined;

		if (row.kind === 'pull') {
			return {
				id: 'copy',
				label: copied === 'checkout' ? 'Copied' : 'Copy checkout',
				title: `Copy: git fetch origin pull/${row.pull.number}/head`,
				onselect: () =>
					put(
						'checkout',
						`git fetch origin pull/${row.pull.number}/head:pr-${row.pull.number} && git switch pr-${row.pull.number}`
					)
			};
		}

		const slug = row.kind === 'repo' ? row.repo.nameWithOwner : `${row.ref.owner}/${row.ref.name}`;

		return {
			id: 'copy',
			label: copied === 'name' ? 'Copied' : 'Copy name',
			title: `Copy ${slug}`,
			onselect: () => put('name', slug)
		};
	});

	/* ------------------------------------------------------------- chrome -- */

	const crumbs = $derived.by<Crumb[]>(() => [
		{ label: 'octant', href: homeHref() },
		{ label: login ?? 'account' }
	]);

	const head = $derived<NavHead>({
		label: login ?? 'octant',
		initial: (login ?? '?').charAt(0).toUpperCase(),
		href: homeHref(),
		title: viewer?.name ?? login ?? 'Your account'
	});

	const items = $derived<NavItem[]>([
		{ id: 'all', label: 'All', icon: 'code', count: null, href: homeHref() },
		{
			id: 'repos',
			label: 'Repositories',
			icon: 'folder',
			count: walk.total,
			href: homeHref({ view: 'repos' })
		},
		{
			id: 'pulls',
			label: 'Pull requests',
			icon: 'pr',
			count: inbox.data ? inbox.data.items.length : null,
			href: homeHref({ view: 'pulls' })
		}
	]);

	const requested = $derived((inbox.data?.items ?? []).filter((entry) => entry.requested));
	const moved = $derived(walk.items.filter(movedSince));
	const unseen = $derived(
		walk.items.filter((entry) => seen.stateOf(entry.nameWithOwner, entry.pushedAt) === 'unseen')
	);

	const visit = $derived.by<PanelEntry[]>(() => {
		if (!seen.ready) return [{ key: 'Opened before', value: '—' }];

		return [
			{ key: 'Opened before', value: count(seen.count) },
			{ key: 'Pushed since', value: count(moved.length), accent: moved.length > 0 },
			{ key: 'Never opened', value: count(unseen.length) }
		];
	});

	const about = $derived.by<PanelEntry[]>(() => {
		const row = selected;

		if (row?.kind === 'pull') {
			return [
				{ key: 'Repository', value: row.pull.nameWithOwner, mono: true },
				{ key: 'Pull request', value: `#${row.pull.number}`, mono: true },
				{ key: 'Author', value: pullAuthor(row.pull) },
				{ key: 'Into', value: row.pull.baseRefName, mono: true },
				{ key: 'Files', value: count(row.pull.changedFiles) },
				{ key: 'Added', value: `+${count(row.pull.additions)}` },
				{ key: 'Removed', value: `−${count(row.pull.deletions)}` },
				...(row.pull.requested
					? [{ key: 'Asked of you', value: 'yes', accent: true } satisfies PanelEntry]
					: [])
			];
		}

		if (row?.kind === 'repo') {
			return [
				{ key: 'Repository', value: row.repo.nameWithOwner, mono: true },
				{ key: 'Visibility', value: row.repo.isPrivate ? 'private' : 'public' },
				{ key: 'Pushed', value: row.repo.pushedAt ? ago(row.repo.pushedAt) : '—' },
				{ key: 'Open pull requests', value: count(row.repo.openPullRequests) },
				...(row.repo.isFork ? [{ key: 'Fork', value: 'yes' } satisfies PanelEntry] : []),
				...(row.repo.isArchived ? [{ key: 'Archived', value: 'yes' } satisfies PanelEntry] : [])
			];
		}

		if (row?.kind === 'direct') {
			return [
				{ key: 'Repository', value: `${row.ref.owner}/${row.ref.name}`, mono: true },
				{ key: 'On your list', value: 'no' }
			];
		}

		return [
			{ key: 'Account', value: login ?? '—', mono: true },
			{ key: 'Repositories', value: walk.total === null ? '—' : count(walk.total) },
			{ key: 'Showing', value: view === 'all' ? 'everything' : view }
		];
	});

	const openAgainst = $derived.by<PanelEntry[]>(() => {
		const data = inbox.data;
		if (!data) return [];

		return [
			{ key: 'Yours', value: count(data.authoredTotal) },
			{
				key: 'Awaiting your review',
				value: count(data.requestedTotal),
				accent: data.requestedTotal > 0
			},
			{
				key: 'Across repositories',
				value: count(walk.items.filter((entry) => entry.openPullRequests > 0).length)
			}
		];
	});

	/** The list on screen; a revalidation that failed behind it is a warning. */
	const failure = $derived(walk.error ?? inbox.error);
	const nothing = $derived(walk.items.length === 0 && (inbox.data?.items.length ?? 0) === 0);
</script>

<svelte:window onkeydown={onKeydown} />

{#snippet sidebar()}
	<Sidebar {head} {items} active={view} section="Recent">
		<Recents />
	</Sidebar>
{/snippet}

{#snippet pills()}
	{#if requested.length > 0}
		<Pill tone="accent">{count(requested.length)} for you</Pill>
	{/if}
	{#if walk.total !== null}
		<Pill>{count(walk.total)} repositories</Pill>
	{/if}
{/snippet}

{#snippet header()}
	<Header {crumbs} {pills} {verbs} {utility} />
{/snippet}

{#snippet panel()}
	<RightPanel {visit} {about} open={openAgainst} />
{/snippet}

{#snippet pullRow(row: Row, index: number)}
	{#if row.kind === 'pull'}
		{@const entry = row.pull}
		{@const on = index === cursor}
		<!-- Selection is not carried by colour alone — DESIGN.md §9. -->
		<a
			class="row"
			class:sel={on}
			aria-current={on ? 'true' : undefined}
			href={pullHref(entry.repo, entry.number)}
			title="{entry.nameWithOwner}#{entry.number} {entry.title}"
			onclick={(event) => pick(event, index)}
			onpointerenter={() => warm(row)}
		>
			<span class="where mono">{entry.nameWithOwner}</span>
			<span class="num mono">{entry.number}</span>
			{#if entry.requested}
				<Dot title="Your review was asked for" />
			{:else}
				<Dot title="" placeholder />
			{/if}
			<span class="title">
				{entry.title}
				{#if entry.comments > 0}
					<span class="talk mono" title="{entry.comments} comments">{count(entry.comments)}</span>
				{/if}
			</span>
			<span class="who">{pullAuthor(entry)}</span>
			<span class="delta">
				<DeltaBar additions={entry.additions} deletions={entry.deletions} />
			</span>
			<span class="state">
				<span class="badge {entry.isDraft ? 'draft' : 'open'}">
					{entry.isDraft ? 'draft' : 'open'}
				</span>
				{#if entry.checks !== 'none'}
					<!-- Green and red are diff state everywhere else, so a check is a
					     word first and a tint second — DESIGN.md §3 and §9. -->
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
	{/if}
{/snippet}

{#snippet repoRow(row: Row, index: number)}
	{@const on = index + pullRows.length === cursor}
	{#if row.kind === 'direct'}
		<a
			class="row direct"
			class:sel={on}
			aria-current={on ? 'true' : undefined}
			href={repoHref(row.ref)}
			title="Open {row.ref.owner}/{row.ref.name}"
			onclick={(event) => pick(event, index + pullRows.length)}
		>
			<Icon name="link" />
			<span class="title">
				Open <span class="mono">{row.ref.owner}/{row.ref.name}</span>
			</span>
			<span class="age">not on your list</span>
		</a>
	{:else if row.kind === 'repo'}
		{@const entry = row.repo}
		<a
			class="row"
			class:sel={on}
			aria-current={on ? 'true' : undefined}
			href={repoHref(entry)}
			title={entry.description ?? entry.nameWithOwner}
			onclick={(event) => pick(event, index + pullRows.length)}
			onpointerenter={() => warm(row)}
		>
			{#if movedSince(entry)}
				<Dot
					title="Pushed to since you last opened it — you were here {agoAt(
						seen.seenAt(entry.nameWithOwner) ?? Date.now()
					)} ago"
				/>
			{:else}
				<Dot title="" placeholder />
			{/if}
			<span class="name mono">{entry.nameWithOwner}</span>
			<span class="desc">{entry.description ?? ''}</span>
			<span class="state">
				{#if entry.isPrivate}<span class="badge">private</span>{/if}
				{#if entry.isArchived}<span class="badge">archived</span>{/if}
				{#if entry.isFork}<span class="badge">fork</span>{/if}
			</span>
			<span class="prs">
				{#if entry.openPullRequests > 0}
					{count(entry.openPullRequests)} open
				{/if}
			</span>
			<span class="age mono" title={entry.pushedAt}
				>{entry.pushedAt ? ago(entry.pushedAt) : ''}</span
			>
		</a>
	{/if}
{/snippet}

<Shell {sidebar} {header} {panel}>
	{#if failure && nothing}
		<p class="fail" role="alert">
			<b>{ERROR_LABEL[failure.kind]}</b>{failure.message}
		</p>
	{:else}
		{#if failure}
			<!-- What is on screen, and a revalidation that failed behind it. Both true. -->
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
				placeholder="Filter, or type owner/name  /"
				aria-label="Filter repositories and pull requests"
				autocomplete="off"
				autocorrect="off"
				spellcheck="false"
			/>
			<span class="tally">
				{#if walk.total !== null}
					<!-- A list that ends without saying whether it ended is the
					     dishonest kind of paging — `query.ts` on `totalCount`. -->
					{count(walk.items.length)} of {count(walk.total)} repositories
				{/if}
				{#if inbox.data}
					· {count(inbox.data.items.length)} in flight
				{/if}
			</span>
		</div>

		{#if showPulls}
			<h2 class="sec">In flight</h2>
			<div class="cols" aria-hidden="true">
				<span class="c-where">Repository</span>
				<span class="c-num">#</span>
				<span class="c-flag"></span>
				<span class="c-title">Title</span>
				<span class="c-who">Author</span>
				<span class="c-delta">Change</span>
				<span class="c-state">State</span>
				<span class="c-age">Age</span>
			</div>

			<nav class="list" aria-label="Open pull requests">
				<VirtualRows
					items={pullRows}
					rowHeight={32}
					reveal={cursor < pullRows.length ? cursor : null}
					revealMargin={28}
					row={pullRow}
				>
					{#snippet empty()}
						<p class="none">
							{#if inbox.loading}
								&nbsp;
							{:else if needle}
								No pull request matches <b>{query.trim()}</b>.
							{:else}
								Nothing is waiting on you.
							{/if}
						</p>
					{/snippet}
				</VirtualRows>
			</nav>
		{/if}

		{#if showRepos}
			<h2 class="sec">Repositories</h2>
			<div class="cols" aria-hidden="true">
				<span class="c-flag"></span>
				<span class="c-name">Repository</span>
				<span class="c-desc">Description</span>
				<span class="c-state"></span>
				<span class="c-prs">Pulls</span>
				<span class="c-age">Pushed</span>
			</div>

			<nav class="list" aria-label="Repositories">
				<VirtualRows
					items={repoRows}
					rowHeight={32}
					reveal={cursor >= pullRows.length ? cursor - pullRows.length : null}
					revealMargin={28}
					row={repoRow}
				>
					{#snippet empty()}
						<p class="none">
							{#if walk.loading}
								&nbsp;
							{:else if needle}
								No repository matches <b>{query.trim()}</b>.
							{:else}
								This token can see no repositories.
							{/if}
						</p>
					{/snippet}
				</VirtualRows>
			</nav>

			{#if walk.hasMore}
				<!-- A button, not infinite scroll: a rate limit is a real budget. -->
				<button class="more" onclick={() => walk.more()} disabled={walk.loadingMore}>
					{walk.loadingMore
						? 'Loading…'
						: `Load more · ${count(Math.max(0, (walk.total ?? 0) - walk.items.length))} left`}
				</button>
			{/if}
		{/if}

		{#if inbox.data?.truncated && showPulls}
			<p class="note">
				Showing the most recently updated of each. The rest are on each repository's own Review
				screen.
			</p>
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

	.sec {
		font-size: 11px;
		font-weight: 500;
		color: var(--tx3);
		margin: 10px 0 4px;
		padding: 0 var(--pad-main);
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

	.c-where,
	.where {
		width: 168px;
		flex: none;
		font-size: 11.5px;
		color: var(--tx2);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.c-num,
	.num {
		width: 46px;
		flex: none;
		font-size: 11px;
		color: var(--acc-tx);
		text-align: right;
	}

	/* Holds the dot column open so the columns line up whether or not a row has
	   news, and nothing moves when one appears. */
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

	.row.sel .title,
	.row.sel .name {
		font-weight: 500;
	}

	.talk {
		font-size: 10px;
		color: var(--tx3);
		margin-left: 6px;
	}

	.c-name,
	.name {
		width: 260px;
		flex: none;
		font-size: 12px;
		color: var(--tx);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.c-desc,
	.desc {
		flex: 1;
		min-width: 0;
		font-size: 12px;
		color: var(--tx2);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
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

	.badge.draft {
		color: var(--tx3);
	}

	.ck {
		flex: none;
	}

	.ck.success,
	.ck.pending {
		color: var(--tx3);
	}

	/* The one place a failing check spends colour: it is the thing you would act
	   on, and the word says it too. */
	.ck.failure {
		color: var(--no);
	}

	.dec {
		flex: none;
		color: var(--tx3);
	}

	.dec.APPROVED {
		color: var(--ok);
	}

	.c-prs,
	.prs {
		width: 68px;
		flex: none;
		font-size: 11px;
		color: var(--tx3);
		text-align: right;
		font-variant-numeric: tabular-nums;
	}

	.c-age,
	.age {
		width: 52px;
		flex: none;
		font-size: 11px;
		color: var(--tx3);
		text-align: right;
	}

	.direct .age {
		width: auto;
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

	.none,
	.note {
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

	/* Below the sidebar breakpoint the columns that are context give their width
	   back to the two that are the answer. */
	@media (max-width: 1060px) {
		.c-desc,
		.desc,
		.c-who,
		.who {
			display: none;
		}
	}

	@media (max-width: 780px) {
		.c-where,
		.where {
			width: 110px;
		}

		.c-name,
		.name {
			width: 180px;
		}
	}
</style>

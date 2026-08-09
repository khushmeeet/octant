<script lang="ts">
	import { page } from '$app/state';
	import DiffView from '$lib/diff/DiffView.svelte';
	import {
		commitHref,
		compareHref,
		fileHref,
		githubPullUrl,
		parseFileAnchor,
		pullHref,
		pullsHref,
		treeHref,
		type PullAddress,
		type PullView
	} from '$lib/nav/paths';
	import {
		approvals,
		changesRequested,
		ERROR_LABEL,
		GitHubSource,
		pullFilesTruncated,
		unresolved,
		type ChangedFile,
		type PullDetail,
		type ReviewThread
	} from '$lib/source';
	import { pages } from '$lib/sync/pages.svelte';
	import { prefetch } from '$lib/sync/prefetch';
	import { resource } from '$lib/sync/resource.svelte';
	import DeltaBar from '$lib/ui/DeltaBar.svelte';
	import Header from '$lib/ui/Header.svelte';
	import Pill from '$lib/ui/Pill.svelte';
	import RightPanel from '$lib/ui/RightPanel.svelte';
	import Shell from '$lib/ui/Shell.svelte';
	import Sidebar from '$lib/ui/Sidebar.svelte';
	import VerbRow from '$lib/ui/VerbRow.svelte';
	import { copy } from '$lib/ui/clipboard';
	import { ago, count } from '$lib/ui/format';
	import type { Crumb, PanelEntry, Verb } from '$lib/ui/types';
	import { reviewMemory } from '$lib/visits/review.svelte';
	import { anchorOf, pathsOf, threadNotes, viewedPaths } from './anchor';
	import Thread from './Thread.svelte';
	import Threads from './Threads.svelte';

	/**
	 * One pull request, diff first — PLAN.md Phase 7, and the screen the plan
	 * says to budget for.
	 *
	 * **"Since my last review" is the default view, not an option.** That is the
	 * phase's whole argument, and it is the reason this screen is the first one
	 * to touch the `visits` store: the default view is a comparison between the
	 * head SHA recorded when you last said you were done and the head SHA now.
	 * When there is no record — a first pass — there is nothing to be since, so
	 * the verb is absent and the whole diff is what you get. A verb that cannot
	 * act is absent, which has been the rule since Phase 3.
	 *
	 * **The force-push check is free, and that is the interesting part.**
	 * PLAN.md warns that comment anchoring across force pushes is where this
	 * screen gets genuinely hard, and ARCHITECTURE.md §6 describes detecting one
	 * by asking whether the current head descends from the recorded head. That
	 * question is already answered by the read we were making anyway: a
	 * `base...head` comparison comes back `ahead` when the head descends from
	 * the base and `diverged` when it does not. So the same request that
	 * produces the "since my last review" diff also says whether the branch was
	 * rewritten under it, and no second query exists to go stale.
	 *
	 * What that costs is honesty about the diff's extent. GitHub's compare is a
	 * three-dot range, measured from where the two commits last agreed — so
	 * after a rebase it reports more than "what changed", because the merge base
	 * has moved back to before the work you already read. The screen says so in
	 * as many words rather than quietly showing you the whole pull request under
	 * a heading that promises otherwise. A missing colour is a subset; a wrong
	 * one is a lie.
	 *
	 * **Threads read below the diff rather than inside it.** DESIGN.md §5 draws
	 * a thread card indented from the gutter, which reads as inline. The diff is
	 * one flat list of fixed-height rows — that is what holds §10's 60fps at
	 * 3,000 lines — and a variable-height card in the middle of it drifts the
	 * arithmetic the whole list depends on. So the anchored line takes a marker,
	 * and the card opens in the pane below, exactly as the log's commit detail
	 * and the refs screen's tag block do. The card itself is §5's card; only its
	 * placement moved, and the budget is what moved it.
	 */
	interface Props {
		address: PullAddress;
	}

	let { address }: Props = $props();

	const repo = $derived(address.repo);
	const number = $derived(address.number);

	const summary = resource(() => GitHubSource.getRepo(repo));
	const pull = resource(() => (number > 0 ? GitHubSource.getPull(repo, number) : null));

	const data = $derived<PullDetail | null>(pull.data);
	const headOid = $derived(data?.headRefOid ?? '');
	const baseOid = $derived(data?.baseRefOid ?? '');

	/* -------------------------------------------------------------- visits -- */

	const memory = reviewMemory(() => (number > 0 ? { repo, number } : null));

	/** The head SHA you were last looking at, when it is not the head now. */
	const reviewedAt = $derived.by(() => {
		const seen = memory.lastSeenSha;
		if (!seen || !headOid || seen === headOid) return null;
		return seen;
	});

	/**
	 * The view, resolved. The URL wins when it says something, because a link to
	 * the whole diff has to survive being followed; otherwise the record
	 * decides, which is what makes "since my last review" a default rather than
	 * a button. Until the record has been read there is no answer, and guessing
	 * `all` would flash the wrong diff on every second visit.
	 */
	const view = $derived<PullView | null>(
		address.view ?? (memory.ready ? (reviewedAt ? 'since' : 'all') : null)
	);

	/* ------------------------------------------------------------- diffs -- */

	/**
	 * Read whenever there is a review to measure from, and not only when the
	 * since-view is showing. It answers two questions, and the second one is
	 * needed on both views: *what has landed since* is the diff, and *what has
	 * moved since* is what decides which of your viewed marks are still good. A
	 * whole-diff view that did not know would have to un-view every file on
	 * every push. It is a comparison between two commit SHAs, so it is cached
	 * permanently and asked for once ever.
	 */
	const since = resource(() =>
		reviewedAt && headOid ? GitHubSource.getCompare(repo, reviewedAt, headOid) : null
	);

	const whole = pages<ChangedFile>((after) =>
		view === 'all' && headOid && baseOid
			? GitHubSource.getPullFiles(repo, number, { headOid, baseOid }, after)
			: null
	);

	const files = $derived<readonly ChangedFile[]>(
		view === 'since' ? (since.data?.files ?? []) : whole.items
	);

	/** GitHub rewrote the branch: the recorded head is not an ancestor of this one. */
	const forcePushed = $derived(since.data?.status === 'diverged');

	/**
	 * The recorded head is gone — GitHub keeps a force-pushed SHA reachable
	 * through the pull request's timeline, but not forever. Not an error worth a
	 * red banner: it means the "since" view cannot be built, and the whole diff
	 * can.
	 */
	const sinceLost = $derived(since.error?.kind === 'not-found');

	const truncated = $derived.by(() => {
		if (view === 'since') return since.data?.truncated ?? false;
		// A walk that has not answered yet has not sent fewer files than it
		// promised — it has sent none. Without the guard the honest-truncation
		// notice flashes on every cold open, which teaches people to ignore it.
		if (!data || whole.pages === 0) return false;
		return pullFilesTruncated(data.changedFiles, whole.items.length, whole.hasMore);
	});

	/** Which file's patch the hash addresses, if any. */
	const anchored = $derived(parseFileAnchor(page.url.hash));

	/* ----------------------------------------------------------- viewed -- */

	/** What the branch has touched since the recorded review, when we know. */
	const changedSince = $derived(since.data ? pathsOf(since.data.files) : null);

	const viewed = $derived(viewedPaths(memory.viewedAt, headOid, changedSince));

	const viewedHere = $derived(files.filter((file) => viewed.has(file.path)).length);
	const allViewed = $derived(files.length > 0 && viewedHere === files.length);

	function toggleViewed(file: ChangedFile): void {
		if (!headOid) return;
		memory.toggleFile(file.path, headOid);
	}

	/* ---------------------------------------------------------- threads -- */

	const threads = $derived<readonly ReviewThread[]>(data?.threads ?? []);

	let openThread = $state<string | null>(null);

	const selected = $derived<ReviewThread | null>(
		openThread ? (threads.find((thread) => thread.id === openThread) ?? null) : null
	);

	const notes = $derived(threadNotes(threads));

	/** Set only while a thread is being jumped to, so the diff does not re-scroll. */
	let revealNote = $state<string | null>(null);

	function selectThread(id: string): void {
		openThread = id;
		revealNote = null;
	}

	function revealThread(): void {
		const key = selected ? anchorOf(selected) : null;
		// Reassigned even when unchanged, so pressing `enter` twice scrolls back.
		revealNote = null;
		if (key) queueMicrotask(() => (revealNote = key));
	}

	function stepThread(delta: number): void {
		if (threads.length === 0) return;
		const at = selected ? threads.indexOf(selected) : -1;
		const next = at < 0 ? 0 : Math.min(threads.length - 1, Math.max(0, at + delta));
		selectThread(threads[next].id);
	}

	const activeNote = $derived(selected ? anchorOf(selected) : null);

	/* ---------------------------------------------------------- keyboard -- */

	function onKeydown(event: KeyboardEvent): void {
		const target = event.target as HTMLElement | null;
		const typing =
			target instanceof HTMLInputElement ||
			target instanceof HTMLTextAreaElement ||
			target?.isContentEditable === true;

		if (event.key === 'Escape') {
			openThread = null;
			if (typing) target?.blur();
			return;
		}

		if (typing || event.metaKey || event.ctrlKey || event.altKey) return;

		switch (event.key) {
			case 'j':
			case 'ArrowDown':
				event.preventDefault();
				stepThread(1);
				break;
			case 'k':
			case 'ArrowUp':
				event.preventDefault();
				stepThread(-1);
				break;
			case 'Enter':
				if (!selected) break;
				event.preventDefault();
				revealThread();
				break;
		}
	}

	/* ------------------------------------------------------------- verbs -- */

	let copied = $state('');

	async function put(label: string, text: string) {
		if (await copy(text)) {
			copied = label;
			setTimeout(() => (copied = ''), 1200);
		}
	}

	let marked = $state(false);

	/** This exact head is already the base of the next "since". */
	const recorded = $derived(Boolean(headOid) && memory.lastSeenSha === headOid);

	function markReviewed(): void {
		if (!headOid) return;
		memory.markReviewed(headOid);
		// Every file in the diff you just finished is viewed by definition.
		memory.markFiles(
			files.map((file) => file.path),
			headOid
		);
		marked = true;
		setTimeout(() => (marked = false), 1200);
	}

	const verbs = $derived.by<Verb[]>(() => {
		const list: Verb[] = [];

		// Absent on a first pass, because there is nothing to be since — the rule
		// every screen has followed since Phase 3, applied to the phase's own
		// headline verb.
		if (reviewedAt) {
			list.push({
				id: 'since',
				label: 'Since my last review',
				href: pullHref(repo, number, { view: 'since' }),
				title: `What has landed since ${reviewedAt.slice(0, 7)}`,
				onhover: () =>
					headOid ? prefetch(GitHubSource.getCompare(repo, reviewedAt, headOid)) : undefined
			});
		}

		list.push({
			id: 'all',
			label: 'Whole diff',
			href: pullHref(repo, number, { view: 'all' }),
			title: `Every file #${number} touches`,
			onhover: () =>
				headOid && baseOid
					? prefetch(GitHubSource.getPullFiles(repo, number, { headOid, baseOid }, null))
					: undefined
		});

		if (baseOid && headOid) {
			list.push({
				id: 'commits',
				label: 'Commits',
				href: compareHref(repo, baseOid, headOid),
				title: `The ${count(data?.totalCommits ?? 0)} commits on this branch`,
				onhover: () => prefetch(GitHubSource.getCompare(repo, baseOid, headOid))
			});
			list.push({
				id: 'tree',
				label: 'Browse head',
				href: treeHref(repo, headOid),
				title: 'Browse the repository as it stands on this branch',
				onhover: () => prefetch(GitHubSource.getTree(repo, headOid, ''))
			});
		}

		if (headOid) {
			list.push({
				id: 'mark',
				label: marked ? 'Recorded' : recorded ? 'Reviewed' : 'Mark reviewed',
				title: recorded
					? `Already recorded at ${headOid.slice(0, 7)}`
					: `Record ${headOid.slice(0, 7)} as reviewed — the base of the next "since"`,
				onselect: markReviewed
			});
		}

		list.push({
			id: 'conversation',
			label: 'Conversation',
			href: githubPullUrl(repo, number),
			external: true,
			title: 'Replying is a write, and writes are out of scope — ARCHITECTURE.md §1'
		});

		return list;
	});

	/* ------------------------------------------------------------ chrome -- */

	const stateWord = $derived.by(() => {
		if (!data) return '';
		if (data.state === 'MERGED') return 'Merged';
		if (data.state === 'CLOSED') return 'Closed';
		return data.isDraft ? 'Draft' : 'Open';
	});

	const checkWord = $derived.by(() => {
		const checks = data?.checks;
		if (!checks || checks.state === 'none') return null;
		if (checks.failing > 0) {
			return `${count(checks.failing)} check${checks.failing === 1 ? '' : 's'} failing`;
		}
		if (checks.pending > 0) {
			return `${count(checks.pending)} check${checks.pending === 1 ? '' : 's'} running`;
		}
		if (checks.state === 'failure') return 'checks failing';
		if (checks.state === 'pending') return 'checks running';
		return 'checks passing';
	});

	const crumbs = $derived.by<Crumb[]>(() => [
		{ label: repo.owner },
		{ label: repo.name, href: treeHref(repo, null) },
		{ label: 'pulls', href: pullsHref(repo) },
		{ label: `#${number}`, mono: true }
	]);

	/**
	 * The one screen in Phase 7 whose first block is real. Everywhere else it is
	 * three placeholder rows until Phase 8 — but here the record is what the
	 * main view is built out of, and a placeholder above a diff computed from
	 * the same data would be a strange thing to look at.
	 */
	const visit = $derived.by<PanelEntry[]>(() => {
		if (!memory.ready) return [{ key: 'Reviewed', value: '—' }];
		if (!memory.lastSeenSha) {
			return [
				{ key: 'Reviewed', value: 'Never', accent: true },
				{ key: 'Files viewed', value: `${count(viewedHere)} of ${count(files.length)}` },
				{ key: 'Last visit', value: '—' }
			];
		}

		const entries: PanelEntry[] = [
			{ key: 'Reviewed at', value: memory.lastSeenSha.slice(0, 7), mono: true },
			{
				key: 'Last visit',
				value: memory.lastSeenAt ? ago(new Date(memory.lastSeenAt).toISOString()) : '—'
			}
		];

		if (!reviewedAt) {
			entries.push({ key: 'Since then', value: 'Nothing' });
		} else {
			entries.push({
				key: 'Commits since',
				value: since.data ? count(since.data.totalCommits) : '—',
				accent: Boolean(since.data && since.data.totalCommits > 0)
			});
			entries.push({
				key: 'Files since',
				value: since.data ? count(since.data.files.length) : '—'
			});
			// Amber's other meaning — DESIGN.md §3 spends it on exactly this.
			if (forcePushed) entries.push({ key: 'Force pushed', value: 'Yes', accent: true });
		}

		entries.push({ key: 'Files viewed', value: `${count(viewedHere)} of ${count(files.length)}` });
		return entries;
	});

	const MERGEABLE: Record<string, string> = {
		MERGEABLE: 'Clean',
		CONFLICTING: 'Conflicts',
		UNKNOWN: 'Checking'
	};

	const about = $derived.by<PanelEntry[]>(() => {
		if (!data) return [];
		return [
			{ key: 'Pull request', value: `#${data.number}`, mono: true },
			{ key: 'State', value: stateWord },
			{ key: 'Author', value: data.authorLogin ?? 'unknown' },
			{ key: 'Base', value: data.baseRefName, mono: true },
			{ key: 'Head', value: data.headRefName, mono: true },
			{ key: 'At', value: data.headRefOid.slice(0, 7), mono: true },
			{ key: 'Commits', value: count(data.totalCommits) },
			{ key: 'Files', value: count(data.changedFiles) },
			{ key: 'Added', value: `+${count(data.additions)}` },
			{ key: 'Removed', value: `−${count(data.deletions)}` },
			{
				key: 'Merge',
				value: MERGEABLE[data.mergeable] ?? data.mergeable,
				accent: data.mergeable === 'CONFLICTING'
			}
		];
	});

	/**
	 * PLAN.md Phase 7 asks the right panel for "checks, approvals, base,
	 * conflicts". Base and conflicts are identity, so they sit in About; what is
	 * *open against* a pull request is the work it is still waiting on.
	 */
	const openAgainst = $derived.by<PanelEntry[]>(() => {
		if (!data) return [];

		const open = unresolved(data.threads);
		const entries: PanelEntry[] = [
			{ key: 'Unresolved', value: count(open), accent: open > 0 },
			{ key: 'Threads', value: count(data.totalThreads) },
			{ key: 'Approvals', value: count(approvals(data.reviews)) }
		];

		const changes = changesRequested(data.reviews);
		if (changes > 0) entries.push({ key: 'Changes asked', value: count(changes), accent: true });

		if (data.checks.state !== 'none') {
			entries.push({ key: 'Checks passing', value: count(data.checks.passing) });
			if (data.checks.failing > 0) {
				entries.push({ key: 'Checks failing', value: count(data.checks.failing), accent: true });
			}
			if (data.checks.pending > 0) {
				entries.push({ key: 'Checks running', value: count(data.checks.pending) });
			}
		}

		return entries;
	});

	const failure = $derived(pull.error ?? whole.error ?? summary.error);
	const loading = $derived(pull.loading || (view === null && !pull.data));
	const diffLoading = $derived(view === 'since' ? since.loading : whole.loading);
</script>

<svelte:window onkeydown={onKeydown} />

{#snippet sidebar()}
	<!-- DESIGN.md §5's fourth contextual heading, which had no screen until now. -->
	<Sidebar repo={summary.data} active="review" section="Threads">
		<Threads
			{threads}
			selected={openThread}
			onselect={selectThread}
			more={data?.moreThreads ?? false}
			loading={pull.loading}
		/>
	</Sidebar>
{/snippet}

{#snippet pills()}
	{#if data}
		<Pill tone={data.state === 'MERGED' ? 'accent' : data.isDraft ? 'plain' : 'default'}>
			{stateWord}
		</Pill>
		{#if checkWord}
			<Pill
				tone={data.checks.state === 'failure'
					? 'no'
					: data.checks.state === 'success'
						? 'ok'
						: 'default'}
				title="{count(data.checks.passing)} passing, {count(data.checks.failing)} failing, {count(
					data.checks.pending
				)} running"
			>
				{checkWord}
			</Pill>
		{/if}
		<Pill mono title="{data.headRefName} → {data.baseRefName}">{data.headRefOid.slice(0, 7)}</Pill>
	{/if}
{/snippet}

{#snippet header()}
	<Header {crumbs} {pills} />
{/snippet}

{#snippet verbRow()}
	<VerbRow
		object="#{number}"
		{verbs}
		active={view === 'since' ? 'since' : 'all'}
		utility={{
			id: 'copy',
			label: copied === 'checkout' ? 'Copied' : 'Copy checkout',
			title: `Copy: git fetch origin pull/${number}/head`,
			onselect: () =>
				put(
					'checkout',
					`git fetch origin pull/${number}/head:pr-${number} && git switch pr-${number}`
				)
		}}
	/>
{/snippet}

{#snippet panel()}
	<RightPanel {visit} {about} open={openAgainst} />
{/snippet}

{#snippet viewedToggle(file: ChangedFile)}
	<button
		class="seen"
		class:on={viewed.has(file.path)}
		aria-pressed={viewed.has(file.path)}
		title={viewed.has(file.path)
			? 'Marked viewed — click to open it again'
			: 'Mark viewed and collapse it'}
		onclick={() => toggleViewed(file)}
	>
		{viewed.has(file.path) ? 'Viewed' : 'Mark viewed'}
	</button>
{/snippet}

<Shell {sidebar} {header} verbs={verbRow} {panel}>
	<div class="split">
		<div class="screen">
			{#if failure && !data}
				<p class="fail" role="alert">
					<b>{ERROR_LABEL[failure.kind]}</b>{failure.message}
				</p>
			{:else}
				{#if failure}
					<!-- The pull request on screen, failed revalidation behind it. -->
					<p class="warn" role="status">
						<b>{ERROR_LABEL[failure.kind]}</b>Showing what was cached. {failure.message}
					</p>
				{/if}

				{#if data}
					<section class="head">
						<h1>{data.title} <span class="n mono">#{data.number}</span></h1>
						<p class="meta">
							<b>{data.authorLogin ?? 'unknown'}</b>
							wants to merge <b>{count(data.totalCommits)}</b>
							{data.totalCommits === 1 ? 'commit' : 'commits'} into
							<a class="mono link" href={treeHref(repo, data.baseRefName)}>{data.baseRefName}</a>
							from
							<a class="mono link" href={treeHref(repo, data.headRefName)}>{data.headRefName}</a>
							· opened {ago(data.createdAt)} ago
						</p>
						<p class="stat">
							<DeltaBar additions={data.additions} deletions={data.deletions} />
							<span class="mono">
								{count(data.changedFiles)}
								{data.changedFiles === 1 ? 'file' : 'files'}
								<b class="add">+{count(data.additions)}</b>
								<b class="del">−{count(data.deletions)}</b>
							</span>
							<!-- Only where the two numbers are about the same diff. On the
							     since-view the heading counts the pull request and the diff
							     below counts the range, so the tally goes on the banner
							     that names the range instead. -->
							{#if view === 'all' && files.length > 0}
								<span class="viewed">{count(viewedHere)} of {count(files.length)} viewed</span>
							{/if}
						</p>
					</section>

					{#if view === 'since' && reviewedAt}
						<p class="since" role="status">
							<b>Since your last review</b>
							<span>
								{#if since.data}
									{count(since.data.totalCommits)}
									{since.data.totalCommits === 1 ? 'commit' : 'commits'} and
									{count(since.data.files.length)}
									{since.data.files.length === 1 ? 'file' : 'files'} since
									<a class="mono link" href={commitHref(repo, reviewedAt)}
										>{reviewedAt.slice(0, 7)}</a
									>{#if files.length > 0}, {count(viewedHere)} of {count(files.length)} viewed{/if}.
								{:else if since.loading}
									Reading what changed since {reviewedAt.slice(0, 7)}…
								{:else if sinceLost}
									GitHub no longer has {reviewedAt.slice(0, 7)}, so there is nothing to measure
									from.
								{/if}
							</span>
						</p>
					{/if}

					{#if forcePushed}
						<!-- Amber, which DESIGN.md §3 spends on exactly this. Said in
						     words as well, and on the since-view said twice over: the
						     diff below it is genuinely wider than the heading promises,
						     and pretending otherwise is the one thing worse than the
						     extra rows. -->
						<p class="warn" role="status">
							<b>Force pushed</b>{data.headRefName} was rewritten since you last looked, so
							{reviewedAt?.slice(0, 7)} is no longer an ancestor of {headOid.slice(0, 7)}.
							{#if view === 'since'}
								What is below is measured from where the two last agreed, which means it includes
								work you have already read.
								<a href={pullHref(repo, number, { view: 'all' })}>Read the whole diff instead</a>.
							{/if}
						</p>
					{/if}

					{#if sinceLost && view === 'since'}
						<p class="warn" role="status">
							<b>Gone</b>The commit you last reviewed is not reachable any more.
							<a href={pullHref(repo, number, { view: 'all' })}>Read the whole diff</a>.
						</p>
					{/if}

					{#if truncated}
						<!-- ARCHITECTURE.md §11: detect truncation, say so, link out. -->
						<p class="warn" role="status">
							<b>Truncated</b>GitHub sent {count(files.length)} of {count(data.changedFiles)} files for
							this pull request, not all of them.
							<a
								href={githubPullUrl(repo, number, '/files')}
								target="_blank"
								rel="noopener noreferrer external"
							>
								See the whole diff on github.com
							</a>.
						</p>
					{/if}

					{#if data.mergeable === 'CONFLICTING'}
						<p class="warn" role="status">
							<b>Conflicts</b>This does not merge cleanly into {data.baseRefName}.
						</p>
					{/if}

					{#if files.length === 0}
						<p class="none">
							{#if diffLoading || view === null}
								&nbsp;
							{:else if view === 'since'}
								Nothing has changed since you last reviewed this.
							{:else}
								This pull request changes no files.
							{/if}
						</p>
					{:else}
						<DiffView
							{files}
							reveal={anchored}
							{notes}
							{activeNote}
							{revealNote}
							collapsed={viewed}
							onnote={selectThread}
							fileExtra={viewedToggle}
							fileHref={(file) => fileHref(repo, headOid || data.headRefName, file.path)}
							outHref={() => githubPullUrl(repo, number, '/files')}
						/>
					{/if}

					{#if view === 'all' && whole.hasMore}
						<button class="more" onclick={() => whole.more()} disabled={whole.loadingMore}>
							{whole.loadingMore
								? 'Loading…'
								: `Load more files · ${count(Math.max(0, data.changedFiles - whole.items.length))} left`}
						</button>
					{/if}

					{#if allViewed && files.length > 0}
						<p class="done">
							Every file here is viewed.
							{#if recorded}
								<!-- Already done, so this states a fact rather than offering the
								     same act twice under two labels. -->
								<span>Recorded at <span class="mono">{headOid.slice(0, 7)}</span>.</span>
							{:else}
								<button class="record" onclick={markReviewed}>Record this as reviewed</button>
							{/if}
						</p>
					{/if}
				{:else if loading}
					<p class="none">&nbsp;</p>
				{/if}
			{/if}
		</div>

		{#if selected}
			<div class="pane">
				<div class="panebar">
					<span class="palabel">Thread</span>
					<span class="pahint mono">j / k · enter</span>
					<button class="close" onclick={() => (openThread = null)} title="Close — esc">
						Close
					</button>
				</div>
				<div class="card">
					<Thread
						thread={selected}
						compact
						lineHref={selected.line !== null
							? fileHref(repo, headOid || (data?.headRefName ?? ''), selected.path, {
									lines: { from: selected.startLine ?? selected.line, to: selected.line }
								})
							: null}
						outHref={selected.comments[0]?.url || githubPullUrl(repo, number)}
					/>
				</div>
			</div>
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
		overflow: auto;
	}

	/*
	 * The diff column scrolls sideways, because DESIGN.md §7 says code never
	 * reflows. Everything that is not a diff row has to hold its own left edge,
	 * or the title slides away when a long line is read.
	 */
	.head,
	.since,
	.fail,
	.warn,
	.none,
	.done,
	.more {
		position: sticky;
		left: 0;
		width: max-content;
		max-width: 100%;
	}

	.head {
		padding: 16px var(--pad-main);
	}

	h1 {
		margin: 0;
		font-size: 15px;
		font-weight: 600;
		color: var(--tx);
	}

	.n {
		color: var(--tx3);
		font-weight: 400;
	}

	.meta {
		margin: 10px 0 0;
		font-size: 12px;
		color: var(--tx3);
	}

	.meta b {
		color: var(--tx2);
		font-weight: 500;
	}

	.link {
		color: var(--acc-tx);
		transition: color 120ms;
	}

	.link:hover {
		color: var(--tx);
	}

	.stat {
		display: flex;
		align-items: center;
		gap: 10px;
		margin: 12px 0 0;
		font-size: 11.5px;
		color: var(--tx3);
	}

	.stat b {
		font-weight: 400;
		margin-left: 4px;
	}

	.viewed {
		color: var(--tx3);
	}

	.add {
		color: var(--ok);
	}

	.del {
		color: var(--no);
	}

	/* The default view says what it is, every time. It is not an option you
	   picked, so it cannot be left to a toggle's state to explain. */
	.since {
		display: flex;
		align-items: center;
		gap: 10px;
		margin: 0;
		padding: 8px var(--pad-main);
		background: var(--acc-bg);
		border-top: 1px solid var(--bd);
		border-bottom: 1px solid var(--bd);
		font-size: 12px;
		color: var(--tx2);
	}

	.since b {
		color: var(--acc-tx);
		font-weight: 500;
		flex: none;
	}

	.seen {
		font-size: 11px;
		color: var(--tx3);
		padding: 0 6px;
		height: 14px;
		line-height: 14px;
		border-radius: var(--radius-pill);
		border: 1px solid transparent;
		transition:
			color 120ms,
			border-color 120ms,
			background-color 120ms;
	}

	.seen:hover {
		color: var(--tx);
		border-color: var(--bd2);
	}

	.seen.on {
		background: var(--acc-bg);
		color: var(--acc-tx);
	}

	.done {
		margin: 0;
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 10px var(--pad-main);
		border-top: 1px solid var(--bd);
		font-size: 12px;
		color: var(--tx3);
	}

	.record {
		font-size: 12px;
		color: var(--acc-tx);
		padding: 3px 8px;
		border-radius: var(--radius-item);
		transition: background-color 120ms;
	}

	.record:hover {
		background: var(--hover);
	}

	.more {
		display: block;
		width: 100%;
		min-width: 100%;
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

	/* The same split as the log and the refs screen: the diff scrolls, the
	   detail stays put, and the keyboard walks one with the other filling. */
	.pane {
		border-top: 1px solid var(--bd);
		background: var(--side);
		display: flex;
		flex-direction: column;
		min-height: 0;
		flex: none;
		height: 232px;
		max-height: 46%;
	}

	.panebar {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 6px var(--pad-main);
		flex: none;
		border-bottom: 1px solid var(--bd);
	}

	.palabel {
		font-size: 11px;
		font-weight: 500;
		color: var(--tx3);
	}

	.pahint {
		font-size: 10px;
		color: var(--tx3);
	}

	.close {
		margin-left: auto;
		font-size: 11px;
		color: var(--tx3);
		transition: color 120ms;
	}

	.close:hover {
		color: var(--tx);
	}

	.card {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: 10px var(--pad-main);
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

	.warn a {
		color: var(--acc-tx);
	}

	.none {
		margin: 0;
		padding: 12px var(--pad-main);
		font-size: 12px;
		color: var(--tx3);
	}
</style>

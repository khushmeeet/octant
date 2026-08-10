<script lang="ts">
	import { page } from '$app/state';
	import DiffView from '$lib/diff/DiffView.svelte';
	import {
		commitHref,
		compareHref,
		fileAnchor,
		fileHref,
		githubCompareUrl,
		homeHref,
		parseFileAnchor,
		refsHref,
		repoHref,
		treeHref,
		type CompareAddress
	} from '$lib/nav/paths';
	import { ERROR_LABEL, GitHubSource, type ChangedFile, type CompareCommitInfo } from '$lib/source';
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

	/**
	 * `base...head` — PLAN.md Phase 6's Compare and "Log since previous", which
	 * are the same screen reached with different endpoints.
	 *
	 * It exists because both of those verbs would otherwise have been links to
	 * github.com, and they would have been links to the *same* github.com page —
	 * two verbs, one destination, neither of them ours. What they are actually
	 * asking is a question we can answer with one REST read we already had:
	 * "what is between these two points", which is a commit list and a diff.
	 *
	 * The parts are all built. `DiffView` and the patch parser came with Phase 5
	 * and this is their second caller; `compare()` has been in `rest.ts` since
	 * Phase 1, put there early because ARCHITECTURE.md §11 lists patch
	 * truncation as a known limit and the risk register asks for it to be found
	 * before Phase 7 leans on it. This is also the read that ARCHITECTURE.md §6
	 * names for "since your last review", so the screen Phase 7 has to build now
	 * starts from something that works.
	 */
	interface Props {
		address: CompareAddress;
	}

	let { address }: Props = $props();

	const repo = $derived(address.repo);
	const base = $derived(address.base);
	const head = $derived(address.head);

	const summary = resource(() => GitHubSource.getRepo(repo));

	const since = sinceLastVisit(() => ({
		repo,
		rev: 'HEAD',
		head: summary.data?.head?.oid ?? null
	}));
	const comparison = resource(() =>
		base && head ? GitHubSource.getCompare(repo, base, head) : null
	);

	const data = $derived(comparison.data);
	const files = $derived<readonly ChangedFile[]>(data?.files ?? []);
	const commits = $derived<readonly CompareCommitInfo[]>(data?.commits ?? []);

	/** Which file's patch the hash addresses, if any. */
	const anchored = $derived(parseFileAnchor(page.url.hash));

	let commitsTop = $state<HTMLElement | null>(null);
	let filesTop = $state<HTMLElement | null>(null);

	/** Short enough for a header, and mono because both sides are identifiers. */
	const shortBase = $derived(short(base));
	const shortHead = $derived(short(head));
	const range = $derived(`${shortBase}…${shortHead}`);

	function short(rev: string): string {
		return /^[0-9a-f]{40}$/.test(rev) ? rev.slice(0, 7) : rev;
	}

	const STATUS: Record<string, string> = {
		identical: 'Identical',
		ahead: 'Ahead',
		behind: 'Behind',
		diverged: 'Diverged'
	};

	/* -------------------------------------------------------------- verbs -- */

	let copied = $state('');

	async function put(label: string, text: string) {
		if (await copy(text)) {
			copied = label;
			setTimeout(() => (copied = ''), 1200);
		}
	}

	const verbs = $derived.by<Verb[]>(() => [
		{
			id: 'commits',
			label: 'Commits',
			onselect: () => commitsTop?.scrollIntoView({ block: 'start' })
		},
		{
			id: 'files',
			label: 'Files',
			onselect: () => filesTop?.scrollIntoView({ block: 'start' })
		},
		{
			id: 'swap',
			label: 'Swap',
			href: compareHref(repo, head, base),
			title: `Compare ${shortHead}…${shortBase} instead`,
			onhover: () => prefetch(GitHubSource.getCompare(repo, head, base))
		},
		{
			id: 'tree',
			label: 'Tree at head',
			href: treeHref(repo, head, ''),
			title: `Browse the repository at ${shortHead}`,
			onhover: () => prefetch(GitHubSource.getTree(repo, head, ''))
		},
		{
			id: 'refs',
			label: 'Refs',
			href: refsHref(repo),
			title: 'Back to branches and tags'
		}
	]);

	/* ------------------------------------------------------------- chrome -- */

	const crumbs = $derived.by<Crumb[]>(() => [
		{ label: repo.owner, href: homeHref() },
		{ label: repo.name, href: repoHref(repo) },
		{ label: 'refs', href: refsHref(repo) },
		{ label: range, mono: true }
	]);

	const about = $derived.by<PanelEntry[]>(() => {
		if (!data) return [];
		return [
			{ key: 'Base', value: shortBase, mono: true },
			{ key: 'Head', value: shortHead, mono: true },
			{ key: 'State', value: STATUS[data.status] ?? data.status },
			{ key: 'Ahead', value: count(data.aheadBy) },
			{ key: 'Behind', value: count(data.behindBy) },
			{ key: 'Commits', value: count(data.totalCommits) },
			{ key: 'Files', value: count(data.files.length) },
			{ key: 'Merge base', value: data.mergeBaseOid.slice(0, 7), mono: true }
		];
	});

	const openAgainst = $derived.by<PanelEntry[]>(() => {
		const repoData = summary.data;
		if (!repoData) return [];
		return [
			{ key: 'Pull requests', value: count(repoData.counts.openPullRequests) },
			{ key: 'Branches', value: count(repoData.counts.branches) },
			{ key: 'Tags', value: count(repoData.counts.tags) }
		];
	});

	const failure = $derived(comparison.error ?? summary.error);
</script>

{#snippet sidebar()}
	<!-- Refs is the nav item this screen belongs to: a comparison is a question
	     about two refs, and it is where you came from. -->
	<Sidebar repo={summary.data} active="refs" section="Files">
		{#if files.length === 0}
			<p class="hint">{comparison.loading ? 'Reading the range…' : 'Nothing changed.'}</p>
		{:else}
			{#each files as file (file.path)}
				<a
					class="sfile"
					class:on={anchored === file.path}
					aria-current={anchored === file.path ? 'true' : undefined}
					href="#{fileAnchor(file.path)}"
					title={file.path}
				>
					<span class="sname mono">{file.path.split('/').pop()}</span>
					<span class="snum mono">
						<b class="add">+{count(file.additions)}</b>
						<b class="del">−{count(file.deletions)}</b>
					</span>
				</a>
			{/each}
		{/if}
	</Sidebar>
{/snippet}

{#snippet pills()}
	{#if data}
		<Pill tone={data.status === 'identical' ? 'plain' : 'accent'}>
			{STATUS[data.status] ?? data.status}
		</Pill>
		<Pill mono title="{data.additions} added, {data.deletions} removed">
			+{count(data.additions)} −{count(data.deletions)}
		</Pill>
	{/if}
{/snippet}

{#snippet header()}
	<Header
		{crumbs}
		{pills}
		{verbs}
		utility={{
			id: 'copy',
			label: copied === 'range' ? 'Copied' : 'Copy range',
			onselect: () => put('range', `${base}...${head}`)
		}}
	/>
{/snippet}

{#snippet panel()}
	<RightPanel since={since.label} visit={since.rows} {about} open={openAgainst} />
{/snippet}

<Shell {sidebar} {header} {panel}>
	{#if failure && !data}
		<p class="fail" role="alert">
			<b>{ERROR_LABEL[failure.kind]}</b>{failure.message}
		</p>
	{:else}
		{#if failure}
			<!-- The range on screen, failed revalidation behind it. Both true. -->
			<p class="warn" role="status">
				<b>{ERROR_LABEL[failure.kind]}</b>Showing what was cached. {failure.message}
			</p>
		{/if}

		{#if data}
			<section class="summary">
				<h1 class="mono">{range}</h1>
				<p class="meta">
					<b>{count(data.totalCommits)}</b>
					{data.totalCommits === 1 ? 'commit' : 'commits'} and
					<b>{count(data.files.length)}</b>
					{data.files.length === 1 ? 'file' : 'files'} between
					<span class="mono">{shortBase}</span> and <span class="mono">{shortHead}</span>
					{#if data.mergeBaseOid}
						· they last agreed at
						<a class="mono link" href={commitHref(repo, data.mergeBaseOid)}>
							{data.mergeBaseOid.slice(0, 7)}
						</a>
					{/if}
				</p>
				<p class="stat">
					<DeltaBar additions={data.additions} deletions={data.deletions} />
					<span class="mono">
						<b class="add">+{count(data.additions)}</b>
						<b class="del">−{count(data.deletions)}</b>
					</span>
				</p>
			</section>

			{#if data.truncated}
				<!-- ARCHITECTURE.md §11: detect truncation, say so, link out. -->
				<p class="warn" role="status">
					<b>Truncated</b>GitHub sent {count(data.commits.length)} of
					{count(data.totalCommits)} commits and {count(data.files.length)} files for this range, not
					all of them.
					<a
						href={githubCompareUrl(repo, base, head)}
						target="_blank"
						rel="noopener noreferrer external"
					>
						See the whole range on github.com
					</a>.
				</p>
			{/if}

			{#if commits.length > 0}
				<section class="commits" bind:this={commitsTop}>
					<h2>Commits</h2>
					<!-- Oldest first, as GitHub sends them and as a release reads. -->
					<nav class="list" aria-label="Commits in this range">
						<VirtualRows items={commits} rowHeight={32}>
							{#snippet row(commit: CompareCommitInfo)}
								<a
									class="crow"
									href={commitHref(repo, commit.oid)}
									title={commit.headline}
									onpointerenter={() => prefetch(GitHubSource.getCommit(repo, commit.oid))}
								>
									<span class="csha mono">{commit.abbreviatedOid}</span>
									<span class="cmsg">{commit.headline}</span>
									<span class="cwho">{commit.authorLogin ?? commit.authorName ?? 'unknown'}</span>
									<span class="cage mono" title={commit.committedDate}>
										{ago(commit.committedDate)}
									</span>
								</a>
							{/snippet}
						</VirtualRows>
					</nav>
				</section>
			{/if}

			<div bind:this={filesTop}>
				{#if files.length === 0}
					<p class="none">These two revisions have the same contents.</p>
				{:else}
					<DiffView
						{files}
						reveal={anchored}
						fileHref={(file) => fileHref(repo, head, file.path)}
						outHref={(file) => `${githubCompareUrl(repo, base, head)}#diff-${file.path}`}
					/>
				{/if}
			</div>
		{:else if comparison.loading}
			<p class="none">&nbsp;</p>
		{/if}
	{/if}
</Shell>

<style>
	/*
	 * The diff column scrolls sideways, because DESIGN.md §7 says code never
	 * reflows. Everything that is not a diff row has to hold its own left edge,
	 * or the summary slides away when a long line is read.
	 */
	.summary,
	.commits,
	.fail,
	.warn,
	.none {
		position: sticky;
		left: 0;
		width: max-content;
		max-width: 100%;
	}

	.summary {
		padding: 16px var(--pad-main);
	}

	h1 {
		margin: 0;
		font-size: 15px;
		font-weight: 600;
		color: var(--tx);
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
		margin-right: 6px;
	}

	/* No rules around it: the block is `position: sticky` against the diff's
	   sideways scroll, so it is only as wide as its own content and a border
	   would stop halfway across the screen. The heading and the diff's own file
	   header do the separating. */
	.commits {
		padding: 0 0 12px;
	}

	h2 {
		margin: 0;
		padding: 10px var(--pad-main) 6px;
		font-size: 11px;
		font-weight: 500;
		color: var(--tx3);
	}

	.crow {
		display: flex;
		align-items: center;
		gap: 10px;
		height: var(--row-h);
		padding: 0 var(--pad-main);
		transition: background-color 120ms;
	}

	.crow:hover {
		background: var(--hover);
	}

	.csha {
		width: 64px;
		flex: none;
		font-size: 11px;
		color: var(--acc-tx);
	}

	.cmsg {
		flex: 1;
		min-width: 0;
		font-size: 12px;
		color: var(--tx);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.cwho {
		width: 104px;
		flex: none;
		font-size: 12px;
		color: var(--tx2);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.cage {
		width: 44px;
		flex: none;
		font-size: 11px;
		color: var(--tx3);
		text-align: right;
	}

	.add {
		color: var(--ok);
	}

	.del {
		color: var(--no);
	}

	.sfile {
		display: flex;
		align-items: center;
		gap: 6px;
		height: 24px;
		padding: 0 6px;
		border-radius: var(--radius-item);
		color: var(--tx2);
		min-width: 0;
		transition:
			color 120ms,
			background-color 120ms;
	}

	.sfile:hover {
		background: var(--hover);
		color: var(--tx);
	}

	.sfile.on {
		background: var(--sel);
		color: var(--tx);
	}

	.sname {
		flex: 1;
		min-width: 0;
		font-size: 12px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.snum {
		flex: none;
		font-size: 10px;
		display: flex;
		gap: 4px;
	}

	.snum b {
		font-weight: 400;
	}

	.hint {
		margin: 0;
		padding: 2px 6px;
		font-size: 12px;
		color: var(--tx3);
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

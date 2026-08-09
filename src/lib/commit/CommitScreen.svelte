<script lang="ts">
	import { page } from '$app/state';
	import DiffView from '$lib/diff/DiffView.svelte';
	import {
		commitHref,
		fileAnchor,
		fileHref,
		githubCommitUrl,
		logHref,
		parseFileAnchor,
		treeHref,
		type CommitAddress
	} from '$lib/nav/paths';
	import { ERROR_LABEL, GitHubSource, type ChangedFile } from '$lib/source';
	import { prefetch } from '$lib/sync/prefetch';
	import { resource } from '$lib/sync/resource.svelte';
	import DeltaBar from '$lib/ui/DeltaBar.svelte';
	import Header from '$lib/ui/Header.svelte';
	import Pill from '$lib/ui/Pill.svelte';
	import RightPanel from '$lib/ui/RightPanel.svelte';
	import Shell from '$lib/ui/Shell.svelte';
	import Sidebar from '$lib/ui/Sidebar.svelte';
	import { copy } from '$lib/ui/clipboard';
	import { ago, count } from '$lib/ui/format';
	import type { Crumb, PanelEntry, Verb } from '$lib/ui/types';
	import { sinceLastVisit } from '$lib/visits/since.svelte';

	/**
	 * One commit, and what it changed — PLAN.md Phase 5's "`enter` opens the
	 * diff".
	 *
	 * Two reads, and the interesting one is usually already done: the log's
	 * detail pane asks for this exact commit under this exact key while the
	 * cursor rests on its row, so arriving here from the log is a local read.
	 * That is the same bargain the file screen makes by warming blame on hover,
	 * and it is what lets `enter` be instant on a screen whose content is a
	 * network round trip.
	 *
	 * A commit named by SHA is immutable, so this screen is cached permanently
	 * and never revalidated — which is exactly right for the thing you send
	 * someone as "look at what this did".
	 */
	interface Props {
		address: CommitAddress;
	}

	let { address }: Props = $props();

	const repo = $derived(address.repo);
	const rev = $derived(address.rev);

	const summary = resource(() => GitHubSource.getRepo(repo));

	const since = sinceLastVisit(() => ({
		repo,
		rev: 'HEAD',
		head: summary.data?.head?.oid ?? null
	}));
	const commit = resource(() => GitHubSource.getCommit(repo, rev));

	const data = $derived(commit.data);
	const files = $derived<readonly ChangedFile[]>(data?.files ?? []);

	/** Which file's patch the hash addresses, if any. */
	const anchored = $derived(parseFileAnchor(page.url.hash));

	/* -------------------------------------------------------------- verbs -- */

	/** The revision links carry once we know the commit is real. */
	const oid = $derived(data?.oid ?? rev);

	let copied = $state('');

	async function put(label: string, text: string) {
		if (await copy(text)) {
			copied = label;
			setTimeout(() => (copied = ''), 1200);
		}
	}

	const verbs = $derived.by<Verb[]>(() => [
		{
			id: 'diff',
			label: 'Diff',
			href: commitHref(repo, rev),
			title: 'What this commit changed'
		},
		{
			id: 'tree',
			label: 'Tree here',
			href: treeHref(repo, oid, ''),
			title: 'Browse the repository as it stood at this commit',
			onhover: () => prefetch(GitHubSource.getTree(repo, oid, ''))
		},
		{
			id: 'log',
			label: 'Log from here',
			href: logHref(repo, oid, ''),
			title: 'History up to and including this commit',
			onhover: () => prefetch(GitHubSource.getLog(repo, oid, '', null))
		},
		// We are a read client — ARCHITECTURE.md §1 allows no writes — and
		// github.com has no revert for a bare commit either. What resolves
		// instantly and is honest is the command you were going to run anyway.
		{
			id: 'revert',
			label: copied === 'revert' ? 'Copied' : 'Revert',
			title: `Copy: git revert ${oid.slice(0, 7)}`,
			onselect: () => put('revert', `git revert ${oid}`)
		},
		{
			id: 'cherry',
			label: copied === 'cherry' ? 'Copied' : 'Cherry-pick',
			title: `Copy: git cherry-pick ${oid.slice(0, 7)}`,
			onselect: () => put('cherry', `git cherry-pick ${oid}`)
		}
	]);

	/* ------------------------------------------------------------- chrome -- */

	const crumbs = $derived.by<Crumb[]>(() => [
		{ label: repo.owner },
		{ label: repo.name, href: treeHref(repo, null, '') },
		{ label: 'commits', href: logHref(repo, null, '') },
		{ label: data?.abbreviatedOid ?? rev.slice(0, 7), mono: true }
	]);

	const about = $derived.by<PanelEntry[]>(() => {
		if (!data) return [];

		const entries: PanelEntry[] = [
			{ key: 'Commit', value: data.abbreviatedOid, mono: true },
			{ key: 'Author', value: data.authorLogin ?? data.authorName ?? 'unknown' }
		];

		if (data.committedDate) entries.push({ key: 'Committed', value: ago(data.committedDate) });
		entries.push({ key: 'Files', value: count(data.files.length) });
		entries.push({ key: 'Added', value: `+${count(data.additions)}` });
		entries.push({ key: 'Removed', value: `−${count(data.deletions)}` });
		if (data.parents.length > 1) {
			entries.push({ key: 'Parents', value: count(data.parents.length), accent: true });
		}
		return entries;
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

	const failure = $derived(commit.error ?? summary.error);
</script>

{#snippet sidebar()}
	<!-- The Log count stays the repository's: a commit is not a scope, and a nav
	     item that counted this screen's files would be answering another
	     question under the Log heading. -->
	<Sidebar repo={summary.data} active="log" section="Files">
		{#if files.length === 0}
			<p class="hint">{commit.loading ? 'Reading the commit…' : 'Nothing was touched.'}</p>
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
		<Pill mono tone="accent" title="This commit">{data.abbreviatedOid}</Pill>
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
		active="diff"
		utility={{
			id: 'copy',
			label: copied === 'sha' ? 'Copied' : 'Copy SHA',
			onselect: () => put('sha', oid)
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
			<!-- The commit on screen, failed revalidation behind it. Both true. -->
			<p class="warn" role="status">
				<b>{ERROR_LABEL[failure.kind]}</b>Showing what was cached. {failure.message}
			</p>
		{/if}

		{#if data}
			<section class="message">
				<h1>{data.headline}</h1>
				{#if data.body.trim()}
					<pre class="body">{data.body.trim()}</pre>
				{/if}
				<p class="meta">
					<b>{data.authorLogin ?? data.authorName ?? 'unknown'}</b>
					committed {ago(data.committedDate)} ago ·
					<span class="mono">{data.abbreviatedOid}</span>
					{#if data.parents.length > 0}
						· {data.parents.length === 1 ? 'parent' : 'parents'}
						{#each data.parents as parent (parent)}
							<a class="parent mono" href={commitHref(repo, parent)}>{parent.slice(0, 7)}</a>
						{/each}
					{/if}
				</p>
				<p class="stat">
					<DeltaBar additions={data.additions} deletions={data.deletions} />
					<span class="mono">
						{count(data.files.length)}
						{data.files.length === 1 ? 'file' : 'files'}
						<b class="add">+{count(data.additions)}</b>
						<b class="del">−{count(data.deletions)}</b>
					</span>
				</p>
			</section>

			{#if data.truncated}
				<!-- ARCHITECTURE.md §11: detect truncation, say so, link out. -->
				<p class="warn" role="status">
					<b>Truncated</b>GitHub sent the first {count(data.files.length)} files of this commit, not all
					of them.
					<a href={githubCommitUrl(repo, oid)} target="_blank" rel="noopener noreferrer external">
						See the whole commit on github.com
					</a>.
				</p>
			{/if}

			<DiffView
				{files}
				reveal={anchored}
				fileHref={(file) => fileHref(repo, oid, file.path)}
				outHref={(file) => `${githubCommitUrl(repo, oid)}#diff-${file.path}`}
			/>
		{:else if commit.loading}
			<p class="none">&nbsp;</p>
		{/if}
	{/if}
</Shell>

<style>
	/*
	 * The diff column scrolls sideways, because DESIGN.md §7 says code never
	 * reflows. Everything that is not a diff row has to hold its own left edge,
	 * or the commit message slides away when a long line is read.
	 */
	.message,
	.fail,
	.warn,
	.none {
		position: sticky;
		left: 0;
		width: max-content;
		max-width: 100%;
	}

	.message {
		padding: 16px var(--pad-main);
	}

	h1 {
		margin: 0;
		font-size: 15px;
		font-weight: 600;
		color: var(--tx);
	}

	.body {
		margin: 10px 0 0;
		font-family: inherit;
		font-size: 12px;
		line-height: 1.5;
		color: var(--tx2);
		white-space: pre-wrap;
		max-width: 90ch;
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

	.parent {
		color: var(--acc-tx);
		transition: color 120ms;
	}

	.parent:hover {
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
	}
</style>

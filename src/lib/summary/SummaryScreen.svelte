<script lang="ts">
	import Markdown from '$lib/md/Markdown.svelte';
	import { archiveUrl, commitHref, githubBlobUrl, homeHref, treeHref } from '$lib/nav/paths';
	import { ERROR_LABEL, GitHubSource, type RepoRef } from '$lib/source';
	import { prefetch } from '$lib/sync/prefetch';
	import { resource } from '$lib/sync/resource.svelte';
	import CloneStrip from '$lib/ui/CloneStrip.svelte';
	import Header from '$lib/ui/Header.svelte';
	import Pill from '$lib/ui/Pill.svelte';
	import RightPanel from '$lib/ui/RightPanel.svelte';
	import Shell from '$lib/ui/Shell.svelte';
	import Sidebar from '$lib/ui/Sidebar.svelte';
	import { ago, count, kilobytes } from '$lib/ui/format';
	import type { Crumb, PanelEntry, Verb } from '$lib/ui/types';
	import { sinceLastVisit } from '$lib/visits/since.svelte';

	/**
	 * The Summary screen — what a repository *is*, and what just landed.
	 *
	 * This is where a repository now opens. It used to open on the tree, with the
	 * README below the listing, and that was two answers stacked in the wrong
	 * order: a directory listing is what you want when you know where you are
	 * going, and prose is what you want when you do not. Anyone arriving at a
	 * repository for the first time — from the home screen, from a link, from the
	 * palette — is in the second case, and was being shown four thousand rows
	 * before the paragraph that explains them.
	 *
	 * So the repository's own address is about the repository: its description,
	 * the commit at its head, how to clone it, and its README at the width of the
	 * screen. The tree is one click away in the sidebar, and it is now a screen
	 * about a directory and nothing else.
	 *
	 * **Three reads, and only the first is new work.** The summary is the same
	 * query every repository screen makes; the root listing is the same key the
	 * Tree screen reads and is shared with it; the README is addressed by the
	 * blob's own object ID, which the listing carries, so it is permanent and is
	 * shared across every revision where the file did not change.
	 */
	interface Props {
		repo: RepoRef;
	}

	let { repo }: Props = $props();

	/** `HEAD` is a revision GitHub resolves, so the default branch costs no trip. */
	const rev = 'HEAD';

	const summary = resource(() => GitHubSource.getRepo(repo));
	const tree = resource(() => GitHubSource.getTree(repo, rev, ''));

	/* ------------------------------------------------------------- readme -- */

	const README = /^readme(\.(md|markdown|mdx|rst|txt|adoc))?$/i;
	const MARKDOWN = /\.(md|markdown|mdx)$/i;

	const readmeEntry = $derived(
		tree.data?.entries.find((entry) => entry.type === 'blob' && README.test(entry.name)) ?? null
	);

	const readme = resource(() => (readmeEntry ? GitHubSource.getBlob(repo, readmeEntry.oid) : null));

	/* -------------------------------------------------------------- since -- */

	const since = sinceLastVisit(() => ({
		repo,
		rev,
		head: summary.data?.head?.oid ?? null
	}));

	// The screen most people go to next, and the one this screen has already
	// paid for: the root listing is the same cache entry the tree renders from.
	$effect(() => {
		prefetch(GitHubSource.getTree(repo, rev, ''));
	});

	/* -------------------------------------------------------------- chrome -- */

	const head = $derived(summary.data?.head ?? null);

	const crumbs = $derived.by<Crumb[]>(() => [
		{ label: repo.owner, href: homeHref() },
		{ label: repo.name }
	]);

	/**
	 * One verb. Browsing, history, refs and reviews are the sidebar's four
	 * primitives and repeating them here would be chrome pretending to be
	 * navigation — the same thing the home screen's verb row was cut for.
	 */
	const verbs = $derived.by<Verb[]>(() => [
		{
			id: 'archive',
			label: 'Archive',
			href: archiveUrl(repo, summary.data?.defaultBranch ?? 'HEAD'),
			external: true,
			title: 'Download the default branch as a zip from github.com'
		}
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

		entries.push({ key: 'Commits', value: count(data.counts.commits) });
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

	const failure = $derived(summary.error ?? tree.error);
</script>

{#snippet sidebar()}
	<!-- `summary` matches no nav item on purpose: the badge above them *is* this
	     screen, and it lights up instead. Git's four primitives stay four. -->
	<Sidebar
		repo={summary.data}
		active="summary"
		treeCount={tree.data?.entries.length ?? null}
		section={null}
	/>
{/snippet}

{#snippet pills()}
	<Pill mono tone="accent" title="The default branch">
		{summary.data?.defaultBranch ?? 'HEAD'}
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
	{#if failure && !summary.data}
		<p class="fail" role="alert">
			<b>{ERROR_LABEL[failure.kind]}</b>{failure.message}
		</p>
	{:else}
		{#if failure}
			<p class="warn" role="status">
				<b>{ERROR_LABEL[failure.kind]}</b>Showing what was cached. {failure.message}
			</p>
		{/if}

		{#if summary.data}
			<section class="what" aria-label="This repository">
				{#if summary.data.description}
					<p class="desc">{summary.data.description}</p>
				{/if}

				{#if head}
					<!-- What just landed. It was a pill and a panel row and nothing you
					     could read; here it is a sentence, and the SHA opens the commit. -->
					<p class="head">
						<a
							class="mono sha"
							href={commitHref(repo, head.oid)}
							title="Open this commit"
							onpointerenter={() => prefetch(GitHubSource.getCommit(repo, head.oid))}
						>
							{head.abbreviatedOid}
						</a>
						<span class="msg">{head.messageHeadline}</span>
						<span class="who">
							{head.authorLogin ?? head.authorName ?? 'someone'} · {ago(head.committedDate)}
						</span>
					</p>
				{/if}

				<CloneStrip https={summary.data.cloneUrl} ssh={summary.data.sshUrl} />
			</section>
		{/if}

		{#if readmeEntry}
			<section class="readme" aria-label={readmeEntry.name}>
				<h2 class="mono">{readmeEntry.name}</h2>
				{#if readme.data?.text !== null && readme.data?.text !== undefined}
					{#if MARKDOWN.test(readmeEntry.name)}
						<!-- Full width, which is this screen's whole point: the README is
						     the content here rather than a footnote under a listing. -->
						<Markdown source={readme.data.text} base={{ repo, rev, dir: '' }} wide />
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
		{:else if tree.data}
			<p class="note none">
				No README here. <a href={treeHref(repo, null, '')}>Browse the tree</a> instead.
			</p>
		{/if}
	{/if}
</Shell>

<style>
	.what {
		padding: 14px var(--pad-main) 0;
		border-bottom: 1px solid var(--bd);
	}

	.desc {
		margin: 0 0 10px;
		font-size: 13px;
		color: var(--tx2);
		max-width: 76ch;
	}

	.head {
		display: flex;
		align-items: baseline;
		gap: 8px;
		margin: 0 0 10px;
		min-width: 0;
	}

	.sha {
		flex: none;
		font-size: 11.5px;
		color: var(--acc-tx);
	}

	.msg {
		font-size: 12px;
		color: var(--tx);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.who {
		flex: none;
		font-size: 11px;
		color: var(--tx3);
		margin-left: auto;
		white-space: nowrap;
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
	}

	.note {
		margin: 10px 0 0;
		font-size: 12px;
		color: var(--tx3);
	}

	.note.none {
		padding: 18px var(--pad-main);
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

<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import CodeViewer from '$lib/code/CodeViewer.svelte';
	import { blameByLine } from '$lib/code/blame';
	import { highlighter, splitLines } from '$lib/code/highlight';
	import { languageOf } from '$lib/code/lang';
	import { lineHash, parseLines, range, type LineRange } from '$lib/nav/lines';
	import {
		commitHref,
		fileHref,
		githubBlobUrl,
		logHref,
		parentPath,
		rawUrl,
		treeHref,
		type FileAddress
	} from '$lib/nav/paths';
	import { ERROR_LABEL, GitHubSource } from '$lib/source';
	import { prefetch } from '$lib/sync/prefetch';
	import { resource } from '$lib/sync/resource.svelte';
	import FileTree from '$lib/ui/FileTree.svelte';
	import Header from '$lib/ui/Header.svelte';
	import Pill from '$lib/ui/Pill.svelte';
	import RightPanel from '$lib/ui/RightPanel.svelte';
	import Shell from '$lib/ui/Shell.svelte';
	import Sidebar from '$lib/ui/Sidebar.svelte';
	import VerbRow from '$lib/ui/VerbRow.svelte';
	import { copy } from '$lib/ui/clipboard';
	import { ago, bytes, count, kilobytes } from '$lib/ui/format';
	import type { Crumb, PanelEntry, Verb } from '$lib/ui/types';

	/**
	 * The File screen — PLAN.md Phase 4, "the screen the tool exists for".
	 *
	 * Three resources in parallel, never chained, for the same reason the Tree
	 * screen has three: the contents come from `rev:path` in one round trip, and
	 * the repository summary that fills the chrome is a query we would be making
	 * anyway. Blame is the third and it is deliberately independent — it is the
	 * most expensive read in the app, so the code is on screen and readable while
	 * it is still out, and it is only asked for on the address that shows it.
	 */
	interface Props {
		address: FileAddress;
	}

	let { address }: Props = $props();

	const repo = $derived(address.repo);
	const path = $derived(address.path);
	const rev = $derived(address.rev ?? 'HEAD');
	const name = $derived(path.split('/').pop() ?? path);
	const dir = $derived(parentPath(path) ?? '');

	const summary = resource(() => GitHubSource.getRepo(repo));
	const file = resource(() => GitHubSource.getFile(repo, rev, path));
	const blame = resource(() => (address.blame ? GitHubSource.getBlame(repo, rev, path) : null));

	/**
	 * The directory this file sits in. Not a fourth round trip: the sidebar's
	 * tree opens the ancestors of the current path and asks for exactly this
	 * listing, so the two share one request (`settle()`) — and reading it here
	 * rather than prefetching it blindly means the way back out is warm *and*
	 * the sidebar's Tree count is real.
	 */
	const siblings = resource(() => GitHubSource.getTree(repo, rev, dir));

	/* --------------------------------------------------------------- code -- */

	const language = $derived(languageOf(path));
	const text = $derived(file.data?.text ?? null);

	const lines = $derived(text === null ? [] : splitLines(text));
	const code = $derived(highlighter(lines, language.grammar));

	/** Arrived, and there is nothing to render: it is binary, or it is too big. */
	const unreadable = $derived(file.data !== null && file.data.text === null);

	const marks = $derived(blame.data ? blameByLine(blame.data.ranges, lines.length) : null);

	/* ---------------------------------------------------------- selection -- */

	/**
	 * The address of a line lives in the hash, so it survives a reload, a paste
	 * into a message, and the trip between View and Blame. Reading it from the
	 * URL rather than holding it in state means there is one answer to "which
	 * lines are these", and the back button moves it.
	 */
	const selection = $derived(parseLines(page.url.hash));

	/** Unset until the keyboard moves it — a screen claims nothing on arrival. */
	let cursor = $state<number | null>(null);
	/** Bumped to ask the viewer to scroll; a hash that lands late still lands. */
	let reveal = $state<number | null>(null);

	// A new file is a new document. The cursor does not survive it, and the
	// deep link in the URL is what the viewer should be looking at.
	$effect(() => {
		void path;
		void repo.owner;
		void repo.name;
		cursor = null;
	});

	// Scroll to the addressed line once there is a document to scroll. Watching
	// the line count as well as the hash is what makes a cold deep link work:
	// the hash is known long before the file that has to be scrolled.
	$effect(() => {
		const target = selection?.from ?? null;
		void lines.length;
		reveal = target;
	});

	/**
	 * Move the addressed range. `replaceState` rather than a push, because
	 * addressing twenty lines in turn should be one step back out of the file
	 * rather than twenty — and `goto` rather than shallow routing, because the
	 * selection is derived from `page.url` and only a real navigation moves it.
	 */
	function addressLines(lines: LineRange | null): void {
		void goto(page.url.pathname + lineHash(lines), {
			replaceState: true,
			noScroll: true,
			keepFocus: true
		});
	}

	function select(line: number, extend: boolean): void {
		cursor = line;
		addressLines(extend && selection ? range(selection.from, line) : { from: line, to: line });
	}

	function moveTo(line: number): void {
		if (lines.length === 0) return;
		cursor = Math.max(1, Math.min(line, lines.length));
		reveal = cursor;
	}

	function onKeydown(event: KeyboardEvent): void {
		const target = event.target as HTMLElement | null;
		const typing =
			target instanceof HTMLInputElement ||
			target instanceof HTMLTextAreaElement ||
			target?.isContentEditable === true;

		if (typing || event.metaKey || event.ctrlKey || event.altKey) return;

		switch (event.key) {
			case 'j':
			case 'ArrowDown':
				event.preventDefault();
				moveTo(cursor === null ? 1 : cursor + 1);
				break;
			case 'k':
			case 'ArrowUp':
				event.preventDefault();
				moveTo(cursor === null ? 1 : cursor - 1);
				break;
			case 'Enter':
				// `enter` opens — and on a file the thing to open is a line's
				// address, which is what you send to someone.
				if (cursor === null) break;
				event.preventDefault();
				select(cursor, event.shiftKey);
				break;
			case 'Escape':
				if (!selection) break;
				event.preventDefault();
				addressLines(null);
				break;
		}
	}

	/* -------------------------------------------------------------- verbs -- */

	/**
	 * Phase 6 makes Permalink work on any revision. The file query resolves the
	 * commit its expression names in the same round trip (`source/revision.ts`),
	 * so the SHA is here for a branch or a tag as well as for the default
	 * branch — which is what Phases 3 to 5 hid the verb for want of.
	 */
	const head = $derived(summary.data?.head ?? null);
	const commitOid = $derived(file.data?.commitOid ?? null);
	const alreadyPermanent = $derived(address.rev !== null && address.rev === commitOid);

	/** What github.com calls this revision when we have not been given a name. */
	const outRev = $derived(rev === 'HEAD' ? (summary.data?.defaultBranch ?? 'HEAD') : rev);

	let copied = $state(false);

	async function copyPath() {
		copied = await copy(path);
		setTimeout(() => (copied = false), 1200);
	}

	const verbs = $derived.by<Verb[]>(() => {
		const list: Verb[] = [
			{
				id: 'view',
				label: 'View',
				href: fileHref(repo, address.rev, path, { lines: selection })
			}
		];

		// A verb that cannot act is absent — the rule the Tree screen set. There
		// are no lines to attribute in a file we could not render, so there is
		// nothing for a blame gutter to sit beside.
		if (!unreadable) {
			list.push({
				id: 'blame',
				label: 'Blame',
				href: fileHref(repo, address.rev, path, { blame: true, lines: selection }),
				title: 'Who wrote each line, and when',
				// A verb resolves in under 50ms or it does not belong in the row
				// (DESIGN.md §5). Blame is a query, so hovering pays for it before
				// the click asks — and at a SHA it is paid for exactly once, ever.
				onhover: () => prefetch(GitHubSource.getBlame(repo, rev, path))
			});
		}

		list.push(
			{
				id: 'log',
				label: 'Log',
				href: logHref(repo, address.rev, path),
				title: 'Every commit that touched this file',
				// The log is a query like blame is, so the verb pays for it on hover
				// rather than making the row's 50ms promise on credit.
				onhover: () => prefetch(GitHubSource.getLog(repo, rev, path, null))
			},
			{
				id: 'raw',
				label: 'Raw',
				href: rawUrl(repo, outRev, path),
				external: true,
				title: 'The bytes, unrendered'
			}
		);

		if (commitOid && !alreadyPermanent) {
			list.push({
				id: 'permalink',
				label: 'Permalink',
				href: fileHref(repo, commitOid, path, { blame: address.blame, lines: selection }),
				title: 'Address this file by commit SHA — cached permanently once you do'
			});
		}

		return list;
	});

	/* ------------------------------------------------------------- chrome -- */

	const crumbs = $derived.by<Crumb[]>(() => {
		const list: Crumb[] = [
			{ label: repo.owner },
			{ label: repo.name, href: treeHref(repo, address.rev, '') }
		];

		const segments = path ? path.split('/') : [];
		segments.forEach((segment, i) => {
			const last = i === segments.length - 1;
			list.push({
				label: segment,
				mono: true,
				// Every segment but the last is a directory; the last is this file,
				// and the header renders it as the place you already are.
				href: last ? undefined : treeHref(repo, address.rev, segments.slice(0, i + 1).join('/'))
			});
		});
		return list;
	});

	const visit = $derived<PanelEntry[]>([
		// Real deltas are Phase 8. The block keeps its position and its shape so
		// the geography is learned now rather than rearranged later.
		{ key: 'Lines changed', value: '—' },
		{ key: 'By', value: '—' },
		{ key: 'Last visit', value: '—' }
	]);

	const about = $derived.by<PanelEntry[]>(() => {
		const data = file.data;
		const entries: PanelEntry[] = [{ key: 'File', value: name, mono: true }];

		if (language.label) entries.push({ key: 'Language', value: language.label });
		if (data) {
			entries.push({ key: 'Size', value: bytes(data.byteSize) });
			if (data.text !== null) entries.push({ key: 'Lines', value: count(lines.length) });
			if (data.oid) entries.push({ key: 'Blob', value: data.oid.slice(0, 7), mono: true });
		}

		if (selection) {
			entries.push({
				key: 'Addressed',
				value:
					selection.from === selection.to
						? `L${selection.from}`
						: `L${selection.from}–${selection.to}`,
				accent: true,
				mono: true
			});
		}

		if (summary.data?.head) {
			entries.push({ key: 'HEAD', value: summary.data.head.abbreviatedOid, mono: true });
			entries.push({ key: 'Committed', value: ago(summary.data.head.committedDate) });
		}
		if (summary.data)
			entries.push({ key: 'Repository', value: kilobytes(summary.data.diskUsageKb) });

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

	/* ------------------------------------------------------------- states -- */

	/**
	 * An address that resolved to a directory is not an error — it is the other
	 * screen's address. `objectType` is how the source says so, and following it
	 * is better than telling someone their perfectly good URL was wrong.
	 */
	const elsewhere = $derived(file.error?.objectType === 'Tree');

	$effect(() => {
		if (elsewhere) void goto(treeHref(repo, address.rev, path));
	});

	// A screen on its way somewhere else says nothing on the way. Reporting an
	// address as missing for the frame before it resolves is worse than a blank.
	const failure = $derived(elsewhere ? null : (file.error ?? summary.error));
</script>

<svelte:window onkeydown={onKeydown} />

{#snippet sidebar()}
	<Sidebar
		repo={summary.data}
		active="tree"
		rev={address.rev}
		treeCount={siblings.data?.entries.length ?? null}
		section="Files"
	>
		<FileTree {repo} {rev} hrefRev={address.rev} current={dir} file={path} />
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
		object={path}
		{verbs}
		active={address.blame ? 'blame' : 'view'}
		utility={{ id: 'copy', label: copied ? 'Copied' : 'Copy path', onselect: copyPath }}
	/>
{/snippet}

{#snippet panel()}
	<RightPanel {visit} {about} open={openAgainst} />
{/snippet}

<Shell {sidebar} {header} verbs={verbRow} {panel}>
	{#if failure && !file.data}
		<p class="fail" role="alert">
			<b>{ERROR_LABEL[failure.kind]}</b>{failure.message}
		</p>
	{:else}
		{#if failure}
			<!-- Cached contents on screen, failed revalidation behind them. -->
			<p class="warn" role="status">
				<b>{ERROR_LABEL[failure.kind]}</b>Showing what was cached. {failure.message}
			</p>
		{/if}

		{#if address.blame && blame.error}
			<p class="warn" role="status">
				<b>{ERROR_LABEL[blame.error.kind]}</b>Blame is unavailable for this file. {blame.error
					.message}
			</p>
		{/if}

		{#if unreadable}
			<!-- ARCHITECTURE.md §11: fall back to the raw URL, then say so plainly.
			     Both of these are data rather than failures, so they are stated
			     rather than reported. -->
			<div class="stop">
				<p class="lead">
					{#if file.data?.isBinary}
						This is a binary file.
					{:else}
						This file is too large for the API to send inline.
					{/if}
					<span class="dim">{bytes(file.data?.byteSize ?? 0)}</span>
				</p>
				<p class="links">
					<a href={rawUrl(repo, outRev, path)} target="_blank" rel="noopener noreferrer external"
						>Open the raw bytes</a
					>
					·
					<a
						href={githubBlobUrl(repo, outRev, path)}
						target="_blank"
						rel="noopener noreferrer external">View on github.com</a
					>
				</p>
			</div>
		{:else if file.data}
			{#if file.data.isTruncated}
				<p class="warn" role="status">
					<b>Truncated</b>GitHub sent a prefix of this file, not all of it.
					<a href={rawUrl(repo, outRev, path)} target="_blank" rel="noopener noreferrer external"
						>Read the whole file</a
					>.
				</p>
			{/if}

			{#if address.blame && !blame.data && blame.loading}
				<p class="warn" role="status"><b>Blame</b>Working out who wrote each line…</p>
			{/if}

			<CodeViewer
				{code}
				blame={address.blame ? marks : null}
				{selection}
				{cursor}
				{reveal}
				onpick={select}
				commitHref={(oid) => commitHref(repo, oid)}
			/>
		{:else if file.loading}
			<p class="none">&nbsp;</p>
		{/if}
	{/if}
</Shell>

<style>
	/*
	 * The column scrolls sideways, because DESIGN.md §7 says code never
	 * reflows. Anything that is not code therefore has to hold its own left
	 * edge, or a note about a truncated file would slide off the screen the
	 * moment you read a long line.
	 */
	.fail,
	.warn,
	.stop,
	.none {
		position: sticky;
		left: 0;
		width: max-content;
		max-width: 100%;
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

	.stop {
		padding: 24px var(--pad-main);
	}

	.lead {
		margin: 0 0 6px;
		color: var(--tx);
	}

	.dim {
		color: var(--tx3);
		margin-left: 6px;
	}

	.links {
		margin: 0;
		font-size: 12px;
		color: var(--tx3);
	}

	.links a {
		color: var(--acc-tx);
		transition: color 120ms;
	}

	.links a:hover {
		color: var(--tx);
	}

	.none {
		margin: 0;
		padding: 12px var(--pad-main);
	}
</style>

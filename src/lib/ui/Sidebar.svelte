<script lang="ts">
	import type { Snippet } from 'svelte';
	import { session } from '$lib/auth/token.svelte';
	import { logHref, refsHref, repoHref } from '$lib/nav/paths';
	import type { RepoSummary } from '$lib/source';
	import Icon from './Icon.svelte';
	import { count } from './format';
	import type { IconName } from './icons';

	/**
	 * Navigation is git's primitives, not GitHub's product surface —
	 * ARCHITECTURE.md §2. Four items, and branches and tags share one screen
	 * because they are the same object.
	 *
	 * Phase 3 replaced Phase 0's local `active` state with the route, Phase 5
	 * makes Log a real destination and Phase 6 does the same for Refs. Review is
	 * still rendered but not reachable: its count is real and comes from the
	 * repository summary we already hold, and the item says plainly that the
	 * screen is not built rather than linking somewhere that isn't there. An
	 * honest dead end beats a stub route.
	 */
	export type NavId = 'tree' | 'log' | 'refs' | 'review';

	interface Props {
		repo?: RepoSummary | null;
		active?: NavId;
		/**
		 * The revision the nav links carry. `null` addresses the default branch,
		 * which is what keeps a link correct across a rename.
		 */
		rev?: string | null;
		/** Entries in the directory on screen. The Tree item's count. */
		treeCount?: number | null;
		/**
		 * Commits in the log's current scope, which is not the same number as the
		 * repository's total once a path narrows it.
		 */
		logCount?: number | null;
		/** Refs on screen, when a screen knows better than the summary does. */
		refsCount?: number | null;
		/** Contextual section heading — `Files`, `Symbols`, `Scope`, `Threads`. */
		section?: string;
		/** The contextual section's body. */
		children?: Snippet;
	}

	let {
		repo = null,
		active,
		rev = null,
		treeCount = null,
		logCount = null,
		refsCount = null,
		section = 'Files',
		children
	}: Props = $props();

	const viewer = $derived(session.viewer);
	const initial = $derived((viewer?.login ?? '?').charAt(0).toUpperCase());

	interface NavItem {
		id: NavId;
		label: string;
		icon: IconName;
		count: number | null;
		href: string | null;
		/** The phase that builds it, for the item's title. */
		phase: number;
	}

	const nav = $derived<NavItem[]>([
		{
			id: 'tree',
			label: 'Tree',
			icon: 'code',
			count: treeCount,
			href: repo ? repoHref(repo) : null,
			phase: 3
		},
		{
			id: 'log',
			label: 'Log',
			icon: 'commit',
			// The scope's count when a screen knows one, and the repository's
			// otherwise — the Tree item has worked this way since Phase 3.
			count: logCount ?? repo?.counts.commits ?? null,
			// Repository-level, deliberately: a nav item goes to the whole of a
			// thing. Scoping the log to a path is the verb row's job, and the
			// sidebar's Scope section's.
			href: repo ? logHref(repo, rev, '') : null,
			phase: 5
		},
		{
			id: 'refs',
			label: 'Refs',
			icon: 'branch',
			// Branches and tags, counted together, because they are one object
			// and one screen — ARCHITECTURE.md §2.
			count: refsCount ?? (repo ? repo.counts.branches + repo.counts.tags : null),
			href: repo ? refsHref(repo) : null,
			phase: 6
		},
		{
			id: 'review',
			label: 'Review',
			icon: 'pr',
			count: repo?.counts.openPullRequests ?? null,
			href: null,
			phase: 7
		}
	]);
</script>

<nav class="sb" aria-label="Primary">
	{#if repo}
		<a class="org" href={repoHref(repo)}>
			<span class="av" aria-hidden="true">{repo.owner.charAt(0).toUpperCase()}</span>
			<span class="orgname" title={repo.nameWithOwner}>{repo.nameWithOwner}</span>
		</a>
	{:else}
		<div class="org">
			<span class="av" aria-hidden="true">—</span>
			<span class="orgname muted">No repository</span>
		</div>
	{/if}

	{#each nav as item (item.id)}
		{#if item.href}
			<a class="nav" class:on={active === item.id} href={item.href}>
				<Icon name={item.icon} />
				<span class="lbl">{item.label}</span>
				{#if item.count !== null}<span class="n">{count(item.count)}</span>{/if}
			</a>
		{:else}
			<span
				class="nav off"
				aria-disabled="true"
				title="The {item.label} screen is Phase {item.phase}"
			>
				<Icon name={item.icon} />
				<span class="lbl">{item.label}</span>
				{#if item.count !== null}<span class="n">{count(item.count)}</span>{/if}
			</span>
		{/if}
	{/each}

	<div class="sec">{section}</div>
	{#if children}
		<div class="ctx">{@render children()}</div>
	{:else}
		<p class="empty">Open a repository to browse its tree.</p>
	{/if}

	{#if viewer}
		<div class="acct">
			<span class="av acc" aria-hidden="true">{initial}</span>
			<span class="login" title={viewer.name ?? viewer.login}>{viewer.login}</span>
			<button class="out" onclick={() => session.signOut()}>Sign out</button>
		</div>
	{/if}
</nav>

<style>
	.sb {
		width: var(--sidebar-w);
		flex: none;
		background: var(--side);
		border-right: 1px solid var(--bd);
		padding: var(--pad-side-y) var(--pad-side-x);
		display: flex;
		flex-direction: column;
		gap: 1px;
		min-height: 0;
	}

	.org {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 5px 6px 10px;
		font-weight: 500;
		min-width: 0;
		flex: none;
	}

	.orgname {
		color: var(--tx);
		font-weight: 500;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.orgname.muted {
		color: var(--tx3);
		font-weight: 400;
	}

	.av {
		width: 18px;
		height: 18px;
		border-radius: var(--radius-pill);
		background: var(--bd);
		color: var(--tx3);
		font-size: 10px;
		font-weight: 600;
		display: flex;
		align-items: center;
		justify-content: center;
		flex: none;
	}

	a.org .av {
		background: var(--acc);
		color: #fff;
	}

	.av.acc {
		background: var(--acc);
		color: #fff;
	}

	.nav {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 5px 6px;
		border-radius: var(--radius-item);
		color: var(--tx2);
		font-weight: 450;
		width: 100%;
		text-align: left;
		flex: none;
		transition:
			color 120ms,
			background-color 120ms;
	}

	.lbl {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.n {
		margin-left: auto;
		font-size: 11px;
		color: var(--tx3);
		font-variant-numeric: tabular-nums;
	}

	a.nav:hover {
		background: var(--hover);
		color: var(--tx);
	}

	.nav.on {
		background: var(--sel);
		color: var(--tx);
		font-weight: 500;
	}

	/* Not built yet, and it says so. Colour is not the only carrier: the item
	   is not a link, carries aria-disabled, and names its phase on hover. */
	.nav.off {
		color: var(--tx3);
		cursor: default;
	}

	.sec {
		font-size: 11px;
		font-weight: 500;
		color: var(--tx3);
		padding: 14px 6px 4px;
		flex: none;
	}

	.ctx {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		margin: 0 -4px;
		padding: 0 4px;
	}

	.empty {
		margin: 0;
		padding: 0 6px;
		font-size: 12px;
		color: var(--tx3);
		flex: 1;
	}

	.acct {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 6px 2px;
		margin-top: 8px;
		border-top: 1px solid var(--bd);
		min-width: 0;
		flex: none;
	}

	.login {
		font-size: 12px;
		color: var(--tx2);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.out {
		margin-left: auto;
		font-size: 11px;
		color: var(--tx3);
		flex: none;
		transition: color 120ms;
	}

	.out:hover {
		color: var(--tx);
	}

	@media (max-width: 780px) {
		.sb {
			display: none;
		}
	}
</style>

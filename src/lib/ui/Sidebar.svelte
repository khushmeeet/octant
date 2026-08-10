<script lang="ts">
	import type { Snippet } from 'svelte';
	import { session } from '$lib/auth/token.svelte';
	import { logHref, pullsHref, refsHref, repoHref, treeHref } from '$lib/nav/paths';
	import type { RepoSummary } from '$lib/source';
	import Icon from './Icon.svelte';
	import { count } from './format';
	import type { NavHead, NavItem } from './types';

	/**
	 * Navigation is git's primitives, not GitHub's product surface —
	 * ARCHITECTURE.md §2. Four items, and branches and tags share one screen
	 * because they are the same object.
	 *
	 * Phase 3 replaced Phase 0's local `active` state with the route; Phase 5
	 * made Log a destination, Phase 6 did the same for Refs, and Phase 7 closes
	 * the set — every one of the four now goes somewhere, which is the first
	 * time the sidebar has told the whole truth.
	 *
	 * `head` and `items` exist for the one screen that is *above* a repository.
	 * Git's four primitives are questions about a repository, so on the home
	 * screen they have nothing to point at — and four dead items were what this
	 * component used to render there. A screen that is not about a repository
	 * supplies its own two, and everything else about the geography is unchanged:
	 * badge, items with counts, contextual section, account.
	 *
	 * **The badge is the fifth destination and is not an item.** The Summary
	 * screen is the repository itself rather than one of git's primitives, so it
	 * belongs to the thing that names the repository — the badge — which was
	 * already a link to that address and now lights up when you are on it. Four
	 * items stays four.
	 */
	export type NavId = 'tree' | 'log' | 'refs' | 'review';

	interface Props {
		repo?: RepoSummary | null;
		/**
		 * The nav item you are looking at. One of `NavId`, a screen's own, or
		 * `summary` — which matches no item and lights the badge instead.
		 */
		active?: string;
		/** Overrides the repository badge. For a screen that has no repository. */
		head?: NavHead | null;
		/** Overrides git's four. For the same screen, and nothing else. */
		items?: NavItem[] | null;
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
		/** Pull requests in the state on screen, which is not always the open ones. */
		reviewCount?: number | null;
		/**
		 * Contextual section heading — `Files`, `Symbols`, `Scope`, `Threads`.
		 * `null` on a screen that has no contextual section: a heading over
		 * nothing reads as a section that failed to load.
		 */
		section?: string | null;
		/** The contextual section's body. */
		children?: Snippet;
	}

	let {
		repo = null,
		active,
		head = null,
		items = null,
		rev = null,
		treeCount = null,
		logCount = null,
		refsCount = null,
		reviewCount = null,
		section = 'Files',
		children
	}: Props = $props();

	const viewer = $derived(session.viewer);
	const initial = $derived((viewer?.login ?? '?').charAt(0).toUpperCase());

	/** The badge: the repository, unless a screen says it is about something else. */
	const badge = $derived<NavHead | null>(
		head ??
			(repo
				? {
						label: repo.nameWithOwner,
						initial: repo.owner.charAt(0).toUpperCase(),
						href: repoHref(repo),
						title: repo.nameWithOwner
					}
				: null)
	);

	const primitives = $derived<NavItem[]>([
		{
			id: 'tree',
			label: 'Tree',
			icon: 'code',
			count: treeCount,
			// `/tree/HEAD`, not the repository's front page: that address belongs to
			// the Summary now, and the badge above is what points at it.
			href: repo ? treeHref(repo, rev, '') : null
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
			href: repo ? logHref(repo, rev, '') : null
		},
		{
			id: 'refs',
			label: 'Refs',
			icon: 'branch',
			// Branches and tags, counted together, because they are one object
			// and one screen — ARCHITECTURE.md §2.
			count: refsCount ?? (repo ? repo.counts.branches + repo.counts.tags : null),
			href: repo ? refsHref(repo) : null
		},
		{
			id: 'review',
			label: 'Review',
			icon: 'pr',
			// Open pull requests unless a screen is showing another state, which
			// is the same rule the Tree, Log and Refs items have followed since
			// they became destinations.
			count: reviewCount ?? repo?.counts.openPullRequests ?? null,
			href: repo ? pullsHref(repo) : null
		}
	]);

	const nav = $derived(items ?? primitives);
</script>

<nav class="sb" aria-label="Primary">
	{#if badge?.href}
		<!-- The badge is a destination as well as a label: it is the repository's
		     own screen. It lights up there the way a nav item does on its own,
		     because a link you are already on should say so. -->
		<a
			class="org"
			class:on={active === 'summary'}
			href={badge.href}
			aria-current={active === 'summary' ? 'page' : undefined}
		>
			<span class="av" aria-hidden="true">{badge.initial}</span>
			<span class="orgname" title={badge.title ?? badge.label}>{badge.label}</span>
		</a>
	{:else if badge}
		<div class="org">
			<span class="av" aria-hidden="true">{badge.initial}</span>
			<span class="orgname" title={badge.title ?? badge.label}>{badge.label}</span>
		</div>
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
			<!-- A destination with nothing to point at: no repository is open, so
			     git's four primitives have nothing to be primitives of. -->
			<span class="nav off" aria-disabled="true" title="Open a repository to reach {item.label}">
				<Icon name={item.icon} />
				<span class="lbl">{item.label}</span>
				{#if item.count !== null}<span class="n">{count(item.count)}</span>{/if}
			</span>
		{/if}
	{/each}

	{#if section === null}
		<!-- No contextual section at all. The space still belongs to the nav, so
		     the account stays on the floor where every screen keeps it. -->
		<div class="fill"></div>
	{:else}
		<div class="sec">{section}</div>
		{#if children}
			<div class="ctx">{@render children()}</div>
		{:else}
			<p class="empty">Open a repository to browse its tree.</p>
		{/if}
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

	/* The same selected fill a nav item takes, minus the bottom padding that
	   separates the badge from them — so the highlight is the badge's own box. */
	a.org.on {
		background: var(--sel);
		border-radius: var(--radius-item);
		padding-bottom: 5px;
		margin-bottom: 5px;
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

	.fill {
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

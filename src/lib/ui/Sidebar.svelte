<script lang="ts">
	import { session } from '$lib/auth/token.svelte';
	import Icon from './Icon.svelte';
	import type { IconName } from './icons';

	/**
	 * Navigation is git's primitives, not GitHub's product surface —
	 * four items, and branches and tags share one screen.
	 *
	 * Phase 0 has no routes to point at, so selection is local. Phase 3
	 * replaces this with the current pathname.
	 */
	const NAV: Array<{ id: string; label: string; icon: IconName }> = [
		{ id: 'tree', label: 'Tree', icon: 'code' },
		{ id: 'log', label: 'Log', icon: 'commit' },
		{ id: 'refs', label: 'Refs', icon: 'branch' },
		{ id: 'review', label: 'Review', icon: 'pr' }
	];

	let active = $state('tree');

	const viewer = $derived(session.viewer);
	const initial = $derived((viewer?.login ?? '?').charAt(0).toUpperCase());
</script>

<nav class="sb" aria-label="Primary">
	<div class="org">
		<span class="av" aria-hidden="true">—</span>
		<span class="orgname">No repository</span>
	</div>

	{#each NAV as item (item.id)}
		<button class="nav" class:on={active === item.id} onclick={() => (active = item.id)}>
			<Icon name={item.icon} />
			{item.label}
		</button>
	{/each}

	<div class="sec">Files</div>
	<p class="empty">Open a repository to browse its tree.</p>

	<div class="spacer"></div>

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
	}

	.orgname {
		color: var(--tx3);
		font-weight: 400;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
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
		transition:
			color 120ms,
			background-color 120ms;
	}

	.nav:hover {
		background: var(--hover);
		color: var(--tx);
	}

	.nav.on {
		background: var(--sel);
		color: var(--tx);
		font-weight: 500;
	}

	.sec {
		font-size: 11px;
		font-weight: 500;
		color: var(--tx3);
		padding: 14px 6px 4px;
	}

	.empty {
		margin: 0;
		padding: 0 6px;
		font-size: 12px;
		color: var(--tx3);
	}

	.spacer {
		flex: 1;
		min-height: 12px;
	}

	.acct {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 6px 2px;
		border-top: 1px solid var(--bd);
		min-width: 0;
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

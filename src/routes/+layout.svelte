<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import TokenGate from '$lib/auth/TokenGate.svelte';
	import { session } from '$lib/auth/token.svelte';
	import { startTick } from '$lib/sync/tick';
	import { panel } from '$lib/ui/panel.svelte';
	import { theme } from '$lib/ui/theme.svelte';

	let { children } = $props();

	// Client-only (`ssr = false`), so `document` and `localStorage` are
	// available at init.
	theme.init();
	panel.init();
	void session.restore();

	/**
	 * One timer for the app — PLAN.md Phase 8. It lives here rather than in a
	 * screen because what it polls is a pinned *set*, not the thing on screen,
	 * and because a timer per screen would be a timer per navigation.
	 */
	$effect(() => {
		if (session.status !== 'signed-in') return;
		return startTick();
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>Octant</title>
</svelte:head>

{#if session.status === 'loading'}
	<!-- An IndexedDB read, not a network call. Deliberately blank rather
	     than a spinner that would outlive the wait it explains. -->
	<div class="boot"></div>
{:else if session.status === 'signed-out'}
	<TokenGate />
{:else}
	{@render children()}
{/if}

<style>
	.boot {
		min-height: 100dvh;
		background: var(--bg);
	}
</style>

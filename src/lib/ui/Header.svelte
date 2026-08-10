<script lang="ts">
	import type { Snippet } from 'svelte';
	import { palette } from '$lib/palette/palette.svelte';
	import Icon from './Icon.svelte';
	import Pill from './Pill.svelte';
	import { panel } from './panel.svelte';
	import { theme } from './theme.svelte';
	import type { Crumb, Verb } from './types';

	/**
	 * Breadcrumb left, the object's pills and verbs right — DESIGN.md §5.
	 *
	 * Verbs used to sit in a row of their own under this one. They did not earn
	 * the 32px: the row repeated the object's name, which the breadcrumb already
	 * says, and pushed every screen's content a line further down. So the verbs
	 * moved up here, next to the pills that identify the thing they act on, and
	 * the app got a row back.
	 *
	 * A screen supplies its own pills (ref, HEAD SHA, state) and its own verbs;
	 * the palette, the theme toggle and the panel toggle are the chrome's and
	 * always sit outermost, so their position never depends on which screen you
	 * are on. Between the two, the object's group scrolls rather than pushing the
	 * chrome off the end.
	 */
	interface Props {
		crumbs?: Crumb[];
		pills?: Snippet;
		/** Every object carries its own verbs — ARCHITECTURE.md §2. */
		verbs?: Verb[];
		/** Which verb names the view you are already looking at, if any. */
		active?: string;
		/** Trailing utility verb, usually a copy action. */
		utility?: Verb;
	}

	let { crumbs = [{ label: 'octant' }], pills, verbs = [], active, utility }: Props = $props();
</script>

{#snippet action(verb: Verb)}
	{#if verb.href}
		<a
			class="verb"
			class:on={active === verb.id}
			href={verb.href}
			title={verb.title}
			target={verb.external ? '_blank' : undefined}
			rel={verb.external ? 'noopener noreferrer external' : undefined}
			onclick={verb.onselect}
			onpointerenter={verb.onhover}
			onfocus={verb.onhover}
		>
			{verb.label}
		</a>
	{:else}
		<button
			class="verb"
			class:on={active === verb.id}
			title={verb.title}
			onclick={verb.onselect}
			onpointerenter={verb.onhover}
			onfocus={verb.onhover}
		>
			{verb.label}
		</button>
	{/if}
{/snippet}

<header class="hd">
	<div class="bc">
		{#each crumbs as crumb, i (i)}
			{#if i > 0}
				<Icon name="chev" muted />
			{/if}
			{#if i === crumbs.length - 1}
				<b class:mono={crumb.mono}>{crumb.label}</b>
			{:else if crumb.href}
				<a class:mono={crumb.mono} href={crumb.href}>{crumb.label}</a>
			{:else}
				<span class:mono={crumb.mono}>{crumb.label}</span>
			{/if}
		{/each}
	</div>

	<div class="obj">
		{#if pills}{@render pills()}{/if}
		{#each verbs as verb (verb.id)}
			{@render action(verb)}
		{/each}
		{#if utility}
			{@render action(utility)}
		{/if}
	</div>

	<div class="r">
		<Pill onclick={() => palette.show()} title="Search and go — ⌘K">
			<Icon name="search" />⌘K
		</Pill>
		<Pill
			onclick={() => theme.toggle()}
			title="Switch to the {theme.current === 'dark' ? 'light' : 'dark'} theme"
		>
			{theme.current === 'dark' ? 'Light' : 'Dark'}
		</Pill>
		<!-- The panel is context, not content. Wanting the width back for a diff
		     is a reasonable thing to want. -->
		<button
			class="tog"
			class:on={panel.open}
			aria-pressed={panel.open}
			title={panel.open ? 'Hide the context panel' : 'Show the context panel'}
			onclick={() => panel.toggle()}
		>
			<Icon name="panel" label={panel.open ? 'Hide the context panel' : 'Show the context panel'} />
		</button>
	</div>
</header>

<style>
	.hd {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 0 var(--pad-main);
		height: var(--header-h);
		border-bottom: 1px solid var(--bd);
		flex: none;
	}

	.bc {
		display: flex;
		align-items: center;
		gap: 6px;
		color: var(--tx2);
		min-width: 0;
		overflow: hidden;
	}

	.bc b {
		color: var(--tx);
		font-weight: 500;
		white-space: nowrap;
	}

	.bc a,
	.bc span {
		white-space: nowrap;
		transition: color 120ms;
	}

	.bc a:hover {
		color: var(--tx);
	}

	/* The object's own group: what it is, then what you can do to it. It takes
	   the slack and scrolls when a screen carries more verbs than fit, so the
	   chrome to its right never moves. */
	.obj {
		margin-left: auto;
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
		overflow-x: auto;
		overflow-y: hidden;
		scrollbar-width: none;
		padding: 4px 0;
	}

	.obj::-webkit-scrollbar {
		display: none;
	}

	.r {
		display: flex;
		align-items: center;
		gap: 6px;
		flex: none;
	}

	.verb {
		font-size: 12px;
		color: var(--tx2);
		padding: 2.5px 8px;
		border-radius: var(--radius-item);
		white-space: nowrap;
		flex: none;
		transition:
			color 120ms,
			background-color 120ms;
	}

	.verb:hover {
		background: var(--hover);
		color: var(--tx);
	}

	.verb.on {
		color: var(--tx);
		background: var(--sel);
	}

	.tog {
		display: inline-flex;
		align-items: center;
		padding: 4px;
		border-radius: var(--radius-item);
		color: var(--tx3);
		flex: none;
		transition:
			color 120ms,
			background-color 120ms;
	}

	.tog:hover {
		color: var(--tx);
		background: var(--hover);
	}

	.tog.on {
		color: var(--tx2);
	}

	/* Below the panel's own breakpoint there is nothing to toggle. */
	@media (max-width: 1060px) {
		.tog {
			display: none;
		}
	}
</style>

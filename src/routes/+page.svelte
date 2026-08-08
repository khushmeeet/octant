<script lang="ts">
	import { goto } from '$app/navigation';
	import { repoHref } from '$lib/nav/paths';
	import { recent } from '$lib/nav/recent.svelte';
	import { parseRepoRef } from '$lib/source';
	import { store } from '$lib/store';
	import Header from '$lib/ui/Header.svelte';
	import Icon from '$lib/ui/Icon.svelte';
	import RightPanel from '$lib/ui/RightPanel.svelte';
	import Shell from '$lib/ui/Shell.svelte';
	import VerbRow from '$lib/ui/VerbRow.svelte';
	import { ago, count } from '$lib/ui/format';
	import type { PanelEntry } from '$lib/ui/types';

	/**
	 * The entry screen — where you say which repository you are reading.
	 *
	 * This replaces the Phase 2 probe. There is no repository list from GitHub
	 * here on purpose: `ARCHITECTURE.md` §1 keeps social and account surfaces out
	 * of scope, and a list of everything you can see is a fan-out across the API
	 * that §7 forbids outright. What you have opened before is local, free, and
	 * a better answer anyway.
	 */
	let input = $state('');
	let invalid = $state<string | null>(null);
	let cached = $state({ immutable: 0, mutable: 0 });

	void recent.hydrate();

	$effect(() => {
		void Promise.all([store.count('immutable'), store.count('mutable')]).then(
			([immutable, mutable]) => (cached = { immutable, mutable })
		);
	});

	function submit(event: SubmitEvent) {
		event.preventDefault();

		// Paste a github.com URL and it works too — it is the thing most likely
		// to be on the clipboard when you arrive here.
		const typed = input.trim().replace(/^https?:\/\/github\.com\//i, '');
		const parsed = parseRepoRef(typed.split(/[?#]/)[0].split('/').slice(0, 2).join('/'));

		if (!parsed) {
			invalid = 'Name a repository as owner/name.';
			return;
		}

		invalid = null;
		void goto(repoHref(parsed));
	}

	const about = $derived<PanelEntry[]>([
		{ key: 'Cached, permanent', value: count(cached.immutable), mono: true },
		{ key: 'Cached, revalidated', value: count(cached.mutable), mono: true },
		{ key: 'Recent', value: count(recent.all.length), mono: true }
	]);
</script>

{#snippet header()}
	<Header crumbs={[{ label: 'octant' }]} />
{/snippet}

{#snippet verbs()}
	<VerbRow object="octant" />
{/snippet}

{#snippet panel()}
	<RightPanel {about} />
{/snippet}

<Shell {header} {verbs} {panel}>
	<div class="entry">
		<h1>Open a repository</h1>
		<p class="lede">
			Anything your token can read. Paste <span class="mono">owner/name</span> or a github.com URL.
		</p>

		<form onsubmit={submit}>
			<!-- svelte-ignore a11y_autofocus -->
			<input
				bind:value={input}
				class="mono"
				aria-label="Repository"
				placeholder="owner/name"
				autocomplete="off"
				autocorrect="off"
				spellcheck="false"
				autofocus
			/>
			<button type="submit">Open</button>
		</form>

		{#if invalid}
			<p class="err" role="alert">{invalid}</p>
		{/if}

		{#if recent.all.length > 0}
			<h2>Recent</h2>
			<ul class="recents">
				{#each recent.all as entry (`${entry.owner}/${entry.name}`)}
					<li>
						<a href={repoHref(entry)}>
							<Icon name="code" />
							<span class="who mono">{entry.owner}/{entry.name}</span>
							<span class="when">{ago(new Date(entry.at).toISOString())}</span>
						</a>
						<button
							class="drop"
							onclick={() => recent.forget(entry)}
							aria-label="Forget {entry.owner}/{entry.name}"
							title="Forget this repository">×</button
						>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</Shell>

<style>
	.entry {
		padding: 32px var(--pad-main);
		max-width: 62ch;
	}

	h1 {
		font-size: 15px;
		font-weight: 600;
		margin: 0 0 4px;
	}

	.lede {
		margin: 0 0 20px;
		color: var(--tx2);
	}

	form {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	input {
		flex: 1;
		min-width: 0;
		background: var(--bg);
		border: 1px solid var(--bd);
		border-radius: var(--radius-pill);
		padding: 6px 12px;
		color: var(--tx);
		transition: border-color 120ms;
	}

	input::placeholder {
		color: var(--tx3);
	}

	input:hover {
		border-color: var(--bd2);
	}

	form button {
		background: var(--raise);
		border: 1px solid var(--bd);
		border-radius: var(--radius-pill);
		padding: 6px 14px;
		color: var(--tx);
		font-weight: 500;
		transition: border-color 120ms;
	}

	form button:hover {
		border-color: var(--bd2);
	}

	.err {
		margin: 10px 0 0;
		color: var(--no);
		font-size: 12px;
	}

	h2 {
		font-size: 11px;
		font-weight: 500;
		color: var(--tx3);
		margin: 32px 0 6px;
	}

	.recents {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.recents li {
		display: flex;
		align-items: center;
		border-radius: var(--radius-item);
		transition: background-color 120ms;
	}

	.recents li:hover {
		background: var(--hover);
	}

	.recents a {
		display: flex;
		align-items: center;
		gap: 8px;
		height: var(--row-h);
		padding: 0 8px;
		flex: 1;
		min-width: 0;
		color: var(--tx3);
	}

	.who {
		font-size: 12px;
		color: var(--tx);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.when {
		margin-left: auto;
		font-size: 11px;
		color: var(--tx3);
	}

	.drop {
		padding: 0 10px;
		height: var(--row-h);
		color: var(--tx3);
		font-size: 14px;
		line-height: 1;
		opacity: 0;
		transition: color 120ms;
	}

	.recents li:hover .drop {
		opacity: 1;
	}

	.drop:hover {
		color: var(--tx);
	}

	.drop:focus-visible {
		opacity: 1;
	}
</style>

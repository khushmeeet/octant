<script lang="ts">
	import { repoHref } from '$lib/nav/paths';
	import { recent } from '$lib/nav/recent.svelte';
	import { GitHubSource } from '$lib/source';
	import { prefetch } from '$lib/sync/prefetch';
	import Icon from '$lib/ui/Icon.svelte';
	import { agoAt } from '$lib/ui/format';

	/**
	 * The home screen's contextual section — `Recent`, the one thing the arrival
	 * screen had that its replacement would have lost.
	 *
	 * It is not a smaller copy of the list beside it. The main list is *what
	 * exists*, ordered by what was pushed to; this is *where you have been*,
	 * ordered by you, and on an account with three hundred repositories the four
	 * you are actually working in are the whole answer. It is also local: this
	 * costs no request at all, which is why it renders before the network has
	 * said anything and why it is still there when GitHub is unreachable.
	 *
	 * The same reason the background tick pins this list rather than the one from
	 * the API — `sync/tick.ts`.
	 */
	void recent.hydrate();
</script>

<div class="recents">
	{#each recent.all as entry (`${entry.owner}/${entry.name}`)}
		<div class="line">
			<a
				class="item"
				href={repoHref(entry)}
				title="{entry.owner}/{entry.name} — last opened {agoAt(entry.at)} ago"
				onpointerenter={() => prefetch(GitHubSource.getRepo(entry))}
			>
				<Icon name="code" />
				<span class="lbl mono">{entry.name}</span>
				<span class="n">{agoAt(entry.at)}</span>
			</a>
			<button
				class="drop"
				onclick={() => recent.forget(entry)}
				aria-label="Forget {entry.owner}/{entry.name}"
				title="Forget this repository">×</button
			>
		</div>
	{:else}
		<p class="empty">Nothing opened yet.</p>
	{/each}
</div>

<style>
	.recents {
		display: flex;
		flex-direction: column;
		gap: 1px;
	}

	.line {
		display: flex;
		align-items: center;
		border-radius: var(--radius-item);
		transition: background-color 120ms;
	}

	.line:hover {
		background: var(--hover);
	}

	.item {
		display: flex;
		align-items: center;
		gap: 6px;
		height: 24px;
		padding: 0 6px;
		flex: 1;
		min-width: 0;
		color: var(--tx2);
		transition: color 120ms;
	}

	.item:hover {
		color: var(--tx);
	}

	.lbl {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 11.5px;
	}

	.n {
		margin-left: auto;
		font-size: 11px;
		color: var(--tx3);
		font-variant-numeric: tabular-nums;
		flex: none;
	}

	/* Present for the pointer and for the keyboard, invisible while reading. */
	.drop {
		padding: 0 6px;
		height: 24px;
		color: var(--tx3);
		font-size: 13px;
		line-height: 1;
		flex: none;
		opacity: 0;
		transition: color 120ms;
	}

	.line:hover .drop,
	.drop:focus-visible {
		opacity: 1;
	}

	.drop:hover {
		color: var(--tx);
	}

	.empty {
		margin: 0;
		padding: 0 6px;
		font-size: 12px;
		color: var(--tx3);
	}
</style>

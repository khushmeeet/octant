<script lang="ts">
	/**
	 * Every object carries its own verbs — ARCHITECTURE.md §2.
	 *
	 * Left: the current object's name in tertiary text with a right divider.
	 * Then the verbs as text buttons, and the copy/utility verb right-aligned.
	 * Every verb must resolve in under 50ms or it does not belong here.
	 *
	 * Phase 0 has no object, so the row renders empty at its correct height.
	 */
	import type { Verb } from './types';

	interface Props {
		object?: string;
		verbs?: Verb[];
		active?: string;
		/** Right-aligned utility verb, usually a copy action. */
		utility?: Verb;
	}

	let { object, verbs = [], active, utility }: Props = $props();
</script>

<div class="verbs">
	<span class="obj">{object ?? 'No object'}</span>

	{#each verbs as verb (verb.id)}
		<button class="verb" class:on={active === verb.id} onclick={verb.onselect}>
			{verb.label}
		</button>
	{/each}

	{#if utility}
		<button class="verb sp" onclick={utility.onselect}>{utility.label}</button>
	{/if}
</div>

<style>
	.verbs {
		display: flex;
		align-items: center;
		gap: 2px;
		height: var(--verbs-h);
		padding: 0 12px;
		border-bottom: 1px solid var(--bd);
		background: var(--side);
		flex: none;
		overflow-x: auto;
		overflow-y: hidden;
		scrollbar-width: none;
	}

	.verbs::-webkit-scrollbar {
		display: none;
	}

	.obj {
		font-size: 12px;
		color: var(--tx3);
		padding-right: 10px;
		margin-right: 4px;
		border-right: 1px solid var(--bd);
		height: 16px;
		display: flex;
		align-items: center;
		white-space: nowrap;
		flex: none;
	}

	.verb {
		font-size: 12px;
		color: var(--tx2);
		padding: 3px 8px;
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

	.sp {
		margin-left: auto;
	}
</style>

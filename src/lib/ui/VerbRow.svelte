<script lang="ts">
	/**
	 * Every object carries its own verbs — ARCHITECTURE.md §2.
	 *
	 * Left: the current object's name in tertiary text with a right divider.
	 * Then the verbs as text buttons, and the copy/utility verb right-aligned.
	 * Every verb must resolve in under 50ms or it does not belong here, which is
	 * why a verb is either a local action or a link — never a request the row
	 * waits on.
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

{#snippet action(verb: Verb, extra: string)}
	{#if verb.href}
		<a
			class="verb {extra}"
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
			class="verb {extra}"
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

<div class="verbs">
	<span class="obj mono">{object ?? 'No object'}</span>

	{#each verbs as verb (verb.id)}
		{@render action(verb, '')}
	{/each}

	{#if utility}
		{@render action(utility, 'sp')}
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
		font-size: 11.5px;
		color: var(--tx3);
		padding-right: 10px;
		margin-right: 4px;
		border-right: 1px solid var(--bd);
		height: 16px;
		display: flex;
		align-items: center;
		white-space: nowrap;
		flex: none;
		max-width: 40%;
		overflow: hidden;
		text-overflow: ellipsis;
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

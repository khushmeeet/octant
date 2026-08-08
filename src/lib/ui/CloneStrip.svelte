<script lang="ts">
	import { copy } from './clipboard';

	/**
	 * Clone strip — DESIGN.md §5, Tree screen only.
	 *
	 * Two URLs, labelled by what they let you do rather than by their protocol.
	 * "HTTPS" and "SSH" name the transport; `read-only` and `read/write` name
	 * the thing you were actually deciding between.
	 */
	interface Props {
		https: string;
		ssh: string;
	}

	let { https, ssh }: Props = $props();

	let copied = $state<string | null>(null);
	let timer: ReturnType<typeof setTimeout> | null = null;

	async function take(url: string) {
		const ok = await copy(url);
		copied = ok ? url : null;
		if (timer) clearTimeout(timer);
		timer = setTimeout(() => (copied = null), 1200);
	}

	$effect(() => () => {
		if (timer) clearTimeout(timer);
	});
</script>

<div class="strip">
	{#each [{ label: 'read-only', url: https }, { label: 'read/write', url: ssh }] as clone (clone.label)}
		<button
			class="clone"
			onclick={() => take(clone.url)}
			title="Copy {clone.url}"
			aria-label="Copy the {clone.label} clone URL"
		>
			<span class="lbl">{clone.label}</span>
			<span class="url mono">{clone.url}</span>
			<span class="done" aria-live="polite">{copied === clone.url ? 'copied' : ''}</span>
		</button>
	{/each}
</div>

<style>
	.strip {
		display: flex;
		gap: 18px;
		flex-wrap: wrap;
		padding: 8px var(--pad-main);
		border-bottom: 1px solid var(--bd);
	}

	.clone {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
		border-radius: var(--radius-item);
		padding: 2px 4px;
		margin: -2px -4px;
		transition: background-color 120ms;
	}

	.clone:hover {
		background: var(--hover);
	}

	.lbl {
		font-size: 11px;
		color: var(--tx3);
		flex: none;
	}

	.url {
		font-size: 11.5px;
		color: var(--tx2);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.clone:hover .url {
		color: var(--tx);
	}

	.done {
		font-size: 11px;
		color: var(--acc-tx);
		flex: none;
		min-width: 0;
	}

	@media (max-width: 1060px) {
		.strip {
			gap: 10px;
		}
	}
</style>

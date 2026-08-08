<script lang="ts">
	import { ICONS, type IconName, type IconShape } from './icons';

	interface Props {
		name: IconName;
		/** Meaningful icons get a label; decorative ones stay aria-hidden. */
		label?: string;
		muted?: boolean;
	}

	let { name, label, muted = false }: Props = $props();

	const shape = $derived(ICONS[name] as IconShape);
</script>

<svg
	class="i"
	class:muted
	viewBox="0 0 24 24"
	role={label ? 'img' : undefined}
	aria-label={label}
	aria-hidden={label ? undefined : true}
>
	{#each shape.c ?? [] as [cx, cy, r] (`${cx},${cy},${r}`)}
		<circle {cx} {cy} {r} />
	{/each}
	{#each shape.d ?? [] as d (d)}
		<path {d} />
	{/each}
</svg>

<style>
	.i {
		width: var(--icon);
		height: var(--icon);
		flex: none;
		stroke: currentColor;
		fill: none;
		stroke-width: 1.6;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.muted {
		color: var(--tx3);
	}
</style>

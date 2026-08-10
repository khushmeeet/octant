<script lang="ts">
	import Bar from './Bar.svelte';
	import { isPaletteChord, palette } from './palette.svelte';

	/**
	 * The palette's mount point and its shortcut — PLAN.md Phase 9.
	 *
	 * It sits in the layout rather than in a screen, because ⌘K belongs to the
	 * app: the same two keys open the same overlay on every screen, including the
	 * ones that have their own window-level key handling.
	 *
	 * Everything that costs anything lives in `Bar.svelte`, which is mounted only
	 * while the palette is open. So the app carries one key listener for this
	 * feature when it is closed, and not a single read.
	 */
	function onKeydown(event: KeyboardEvent): void {
		if (!isPaletteChord(event)) return;

		// The browser has its own ⌘K in some windows. This one wins.
		event.preventDefault();
		palette.toggle();
	}
</script>

<svelte:window onkeydown={onKeydown} />

{#if palette.open}
	<Bar />
{/if}

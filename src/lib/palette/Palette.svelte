<script lang="ts">
	import Bar from './Bar.svelte';
	import { isPaletteChord, palette, rememberPointer } from '$lib/ui/palette.svelte';

	/**
	 * The palette's mount point and its shortcut — PLAN.md Phase 9.
	 *
	 * It sits in the layout rather than in a screen, because ⌘K belongs to the
	 * app: the same two keys open the same overlay on every screen, including the
	 * ones that have their own window-level key handling.
	 *
	 * Everything that costs anything lives in `Bar.svelte`, which is mounted only
	 * while the palette is open. So the app carries two listeners for this
	 * feature when it is closed, and not a single read. The second one writes
	 * down where the pointer is, which is what lets the overlay tell a mouse that
	 * moved from a mouse that was merely already there — see `ui/palette.svelte.ts`,
	 * which also explains why the state lives over there rather than in here.
	 */
	function onKeydown(event: KeyboardEvent): void {
		if (!isPaletteChord(event)) return;

		// The browser has its own ⌘K in some windows. This one wins.
		event.preventDefault();
		palette.toggle();
	}
</script>

<svelte:window onkeydown={onKeydown} onpointermove={rememberPointer} />

{#if palette.open}
	<Bar />
{/if}

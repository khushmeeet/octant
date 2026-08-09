<script lang="ts">
	/**
	 * The change dot — ARCHITECTURE.md §6, DESIGN.md §3.
	 *
	 * Indigo, and one meaning: **something landed inside this since your last
	 * visit.** Not two glyphs and not two tones — DESIGN.md §3 spends indigo on
	 * "this concerns you" once, and owning the path is a reason the dot is there
	 * rather than a second kind of dot. What owning it changes is the *sentence*,
	 * which is where a difference belongs when the difference is a fact about
	 * you rather than about the change.
	 *
	 * DESIGN.md §9 forbids colour as the sole carrier, so the dot is never only
	 * a colour: it has a label a screen reader reads and a title a pointer
	 * finds, and the panel beside it carries the same number in words.
	 */
	interface Props {
		/** What landed, in words. Both the tooltip and the accessible name. */
		title: string;
		/** Reserve the width even when there is nothing to show, so rows do not shift. */
		placeholder?: boolean;
	}

	let { title, placeholder = false }: Props = $props();
</script>

{#if placeholder}
	<span class="dot none" aria-hidden="true"></span>
{:else}
	<span class="dot" role="img" aria-label={title} {title}></span>
{/if}

<style>
	.dot {
		width: 5px;
		height: 5px;
		border-radius: 50%;
		background: var(--acc);
		flex: none;
	}

	/* Holds the column open so a row with news and a row without are the same
	   shape. Nothing moves when a dot appears — DESIGN.md §6. */
	.dot.none {
		background: none;
	}
</style>

<script lang="ts" generics="T">
	import type { Snippet } from 'svelte';

	/**
	 * Virtualised fixed-height rows — PLAN.md's risk register, which says to
	 * build this into the row primitive in Phase 3 rather than retrofit it.
	 *
	 * It virtualises against the **nearest scrolling ancestor**, not against a
	 * scroller of its own. That is what lets the README sit below the listing in
	 * ordinary document flow while four thousand rows above it stay cheap: a
	 * list with its own scrollbar would have forced the README into a second
	 * scrolling region, and two scrollbars on one screen is a worse answer than
	 * any amount of implementation.
	 *
	 * The slice is positioned with padding rather than transforms, so nothing
	 * moves — DESIGN.md §6 — and the rows keep their place in the document for
	 * find-in-page and for the focus ring.
	 */
	interface Props {
		items: T[];
		/** Must match the rendered row, or the window drifts. DESIGN.md §4: 32px. */
		rowHeight?: number;
		/** Rows rendered beyond each edge, so a fast scroll does not show gaps. */
		overscan?: number;
		/** Row to keep in view. Changing it scrolls; this is how `j`/`k` work. */
		reveal?: number | null;
		/** Space to leave above a revealed row, for a sticky column header. */
		revealMargin?: number;
		row: Snippet<[T, number]>;
		empty?: Snippet;
	}

	let {
		items,
		rowHeight = 32,
		overscan = 8,
		reveal = null,
		revealMargin = 0,
		row,
		empty
	}: Props = $props();

	let anchor = $state<HTMLDivElement | null>(null);

	/** Read on every scroll, so it stays the one cheap measurement. */
	let scrollTop = $state(0);
	let viewportHeight = $state(0);
	/** The anchor's top within the viewport's scroll content. Measured on layout. */
	let offset = $state(0);

	let viewport: HTMLElement | null = null;

	const total = $derived(items.length);

	const start = $derived(
		Math.max(0, Math.min(total, Math.floor((scrollTop - offset) / rowHeight) - overscan))
	);

	const end = $derived(
		Math.min(total, start + Math.ceil(viewportHeight / rowHeight) + overscan * 2 + 1)
	);

	const slice = $derived(items.slice(start, end));

	$effect(() => {
		if (!anchor) return;

		viewport = scrollParent(anchor);

		const onScroll = () => {
			scrollTop = viewport?.scrollTop ?? 0;
		};

		// Anything that moves the list within the page changes `offset`, and
		// anything that resizes the viewport changes how many rows fit. Both are
		// layout events, so they are measured there and never on scroll.
		const observer = new ResizeObserver(measure);
		observer.observe(viewport);
		observer.observe(anchor);

		viewport.addEventListener('scroll', onScroll, { passive: true });
		measure();

		return () => {
			observer.disconnect();
			viewport?.removeEventListener('scroll', onScroll);
			viewport = null;
		};
	});

	// A row the keyboard moved to may not be rendered, so scrolling to it is
	// arithmetic rather than a call to `scrollIntoView` on an element.
	$effect(() => {
		const index = reveal;
		if (index === null || index < 0 || !viewport) return;

		const top = offset + index * rowHeight;
		const view = viewport.scrollTop;

		if (top - revealMargin < view) viewport.scrollTop = Math.max(0, top - revealMargin);
		else if (top + rowHeight > view + viewport.clientHeight) {
			viewport.scrollTop = top + rowHeight - viewport.clientHeight;
		}
	});

	function measure(): void {
		if (!anchor || !viewport) return;

		const from = viewport.getBoundingClientRect().top;
		offset = anchor.getBoundingClientRect().top - from + viewport.scrollTop;
		viewportHeight = viewport.clientHeight;
		scrollTop = viewport.scrollTop;
	}

	function scrollParent(from: HTMLElement): HTMLElement {
		let node = from.parentElement;
		while (node) {
			const overflow = getComputedStyle(node).overflowY;
			if (overflow === 'auto' || overflow === 'scroll') return node;
			node = node.parentElement;
		}
		return (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
	}
</script>

{#if total === 0 && empty}
	{@render empty()}
{:else}
	<div
		bind:this={anchor}
		style:padding-top="{start * rowHeight}px"
		style:padding-bottom="{(total - end) * rowHeight}px"
	>
		{#each slice as item, i (start + i)}
			{@render row(item, start + i)}
		{/each}
	</div>
{/if}

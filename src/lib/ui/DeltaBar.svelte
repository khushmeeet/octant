<script lang="ts">
	/**
	 * The delta bar — DESIGN.md §5. Five 5px cells, 2px gaps, 1px radius; green
	 * for added, red for removed, `--bd2` for unused.
	 *
	 * "The only graphic in the app; it earns its place because scanning a hundred
	 * rows for 'is this a big change' is a real task." So it answers two
	 * questions at once and neither of them is "how many lines exactly": how big,
	 * from how many cells are lit, and which direction, from their colour.
	 *
	 * How many cells light is a *scale*, not a proportion — a one-line fix and a
	 * thousand-line rewrite have to look different from across the table, and a
	 * proportion of a total you cannot see says nothing. The thresholds are
	 * written out rather than computed from a logarithm because these are the
	 * boundaries the eye is being asked to learn, and they should be greppable.
	 *
	 * Colour is never the only carrier (DESIGN.md §9): every place this appears
	 * puts the raw counts beside it, so the bar is `aria-hidden` and the numbers
	 * are what is read out.
	 */
	interface Props {
		additions: number;
		deletions: number;
	}

	let { additions, deletions }: Props = $props();

	const CELLS = 5;
	/** Changed lines at which each further cell lights. */
	const STEPS = [1, 10, 50, 200, 1000];

	const total = $derived(Math.max(0, additions) + Math.max(0, deletions));

	const used = $derived(STEPS.filter((step) => total >= step).length);

	const green = $derived.by(() => {
		if (used === 0 || additions <= 0) return 0;
		const share = Math.round((additions / total) * used);
		// A change that added anything shows at least one green cell, and one that
		// removed anything keeps a red one — rounding must not erase a direction.
		if (share === 0) return 1;
		if (share === used && deletions > 0) return used - 1;
		return share;
	});

	const cells = $derived(
		Array.from({ length: CELLS }, (_, i) => {
			if (i >= used) return 'off';
			return i < green ? 'add' : 'del';
		})
	);
</script>

<span class="bar" aria-hidden="true">
	{#each cells as cell, i (i)}
		<i class={cell}></i>
	{/each}
</span>

<style>
	.bar {
		display: inline-flex;
		align-items: center;
		gap: 2px;
		flex: none;
	}

	i {
		width: 5px;
		height: 10px;
		border-radius: 1px;
		background: var(--bd2);
	}

	.add {
		background: var(--ok);
	}

	.del {
		background: var(--no);
	}
</style>

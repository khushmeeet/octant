<script lang="ts">
	import { GRAPH_W, LANE_GAP, LANE_X0, type GraphRow } from './graph';

	/**
	 * One row of the graph column, drawn.
	 *
	 * The whole reason this is SVG rather than the mono box-drawing it replaced
	 * is that a lane has to cross a row boundary. A glyph cannot: `│` is ink
	 * inside a 12px line box sitting in a 32px row, so a lane running through
	 * ten commits came out as ten dashes with gaps, and `╮` curved away toward a
	 * lane it never reached because the cell ended first. Here every edge is
	 * drawn against the row's real height and every lane leaves the bottom of one
	 * row exactly where it enters the top of the next, so the column is one
	 * continuous drawing that happens to be cut into rows.
	 *
	 * Curves rather than corners, and the same curve in both directions: a lane
	 * joining the dot is a cubic whose control points sit at the quarter heights,
	 * which leaves the top vertically and arrives at the dot vertically. That is
	 * what makes a merge read as a merge at 32px — a diagonal at this size is a
	 * jagged line, and an elbow is a corner you have to look at twice.
	 *
	 * Colour is by column, which is what every graph that colours lanes does. It
	 * is stable while the lane is, it makes the spine one colour all the way
	 * down, and it deliberately avoids the delta bar's green and red: those two
	 * already mean added and removed on the same row.
	 */
	interface Props {
		row: GraphRow | null;
		/** The row height the lanes have to span, so they meet across rows. */
		height?: number;
	}

	let { row, height = 32 }: Props = $props();

	const mid = $derived(height / 2);
	const x = (at: number) => LANE_X0 + at * LANE_GAP;

	/** Down the column from the row above, then a symmetric S into the dot. */
	function join(from: number, to: number): string {
		return `M${x(from)},0 C${x(from)},${mid / 2} ${x(to)},${mid / 2} ${x(to)},${mid}`;
	}

	/** The same curve, mirrored: out of the dot and away down the column. */
	function fork(from: number, to: number): string {
		const bend = mid + (height - mid) / 2;
		return `M${x(from)},${mid} C${x(from)},${bend} ${x(to)},${bend} ${x(to)},${height}`;
	}
</script>

{#if row}
	<svg
		class="graph"
		width={GRAPH_W}
		{height}
		viewBox="0 0 {GRAPH_W} {height}"
		data-lane={row.lane}
		aria-hidden="true"
	>
		<!-- Lanes that have nothing to do with this commit, drawn first so the
		     commit's own edges sit over them where they cross. -->
		{#each row.through as lane (lane.at)}
			<path class="through" d="M{x(lane.at)},0 V{height}" style:stroke="var(--lane-{lane.tone})" />
		{/each}

		{#each row.joins as lane (lane.at)}
			<path class="join" d={join(lane.at, row.lane)} style:stroke="var(--lane-{lane.tone})" />
		{/each}

		{#each row.forks as lane (lane.at)}
			<path class="fork" d={fork(row.lane, lane.at)} style:stroke="var(--lane-{lane.tone})" />
		{/each}

		{#if row.up}
			<path class="up" d="M{x(row.lane)},0 V{mid}" style:stroke="var(--lane-{row.tone})" />
		{/if}
		{#if row.down}
			<path class="down" d="M{x(row.lane)},{mid} V{height}" style:stroke="var(--lane-{row.tone})" />
		{/if}

		<circle class="dot" cx={x(row.lane)} cy={mid} r="3.5" style:fill="var(--lane-{row.tone})" />

		<!-- A branch is open past the right-hand edge. Three dots is the smallest
		     honest way to say the column is not the whole graph. -->
		{#if row.beyond}
			{#each [-4, 0, 4] as dy (dy)}
				<circle class="more" cx={GRAPH_W - 3} cy={mid + dy} r="1" />
			{/each}
		{/if}
	</svg>
{:else}
	<span class="graph" aria-hidden="true"></span>
{/if}

<style>
	.graph {
		width: var(--col-graph);
		flex: none;
		overflow: visible;
	}

	path {
		fill: none;
		stroke-width: 1.5;
		stroke-linecap: round;
	}

	.more {
		fill: var(--tx3);
	}
</style>

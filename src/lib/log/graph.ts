/**
 * The graph column — DESIGN.md §5.
 *
 * History arrives as a flat list of commits, each carrying its parents, and
 * this turns that back into the shape it came from: lanes. A lane holds the oid
 * of the commit it is next expecting, a commit claims the lane that was waiting
 * for it, and its parents are what the lane waits for next. Extra parents open
 * lanes; lanes waiting on the same commit close into it.
 *
 * **A parent outside the loaded window closes its lane.** This is the whole
 * trick, and it is what makes the column survive both of the cases that would
 * otherwise wreck it. A path-scoped log is not a graph at all — filtering drops
 * the commits in between, so no commit is its neighbour's parent — and without
 * this rule every row would open a lane that nothing ever closes, marching off
 * the right-hand edge within a screenful. With it, a filtered log draws a clean
 * spine, which is what a filtered log honestly is. The same rule handles the
 * bottom of a page: the parents are simply not loaded yet, so the lanes end,
 * and loading more redraws them because the whole column is one cheap pass.
 *
 * **What comes out is geometry, not characters.** This column was box-drawing
 * glyphs in mono for five phases, and glyphs cannot draw a graph. `│` is a
 * stroke inside a 12px line box dropped into a 32px row, so a lane running
 * through ten commits is ten dashes with gaps between them, and `╮` is a curve
 * that stops at the edge of its own cell rather than reaching the lane it is
 * supposed to be joining. No amount of choosing better characters fixes a
 * column whose ink cannot cross a row boundary. So the pass emits lanes and
 * edges, `CommitGraph.svelte` draws them as SVG at the row's real height, and
 * the lines meet because they are the same line.
 *
 * It is still deliberately a *one-row-per-commit* drawing rather than a railway
 * with half-rows between commits: a merge takes a branch in and lets the next
 * one out on the same row, which is what `joins` and `forks` both being
 * non-empty means.
 */

/** One lane's worth of an edge: where it sits, and what colour it carries. */
export interface GraphEdge {
	/** Column index, already clamped to what fits. */
	at: number;
	/** Which of the lane colours this edge is drawn in. */
	tone: number;
}

export interface GraphRow {
	/** Column the commit's dot sits in. */
	lane: number;
	/** The dot's colour. */
	tone: number;
	/** Columns in use on this row — what the renderer sizes itself against. */
	width: number;
	/** Lanes running straight past this commit, top to bottom. */
	through: GraphEdge[];
	/** Lanes arriving from the row above and ending at the dot. */
	joins: GraphEdge[];
	/** Lanes leaving the dot and carrying on below. */
	forks: GraphEdge[];
	/** The commit's own lane, above the dot and below it. */
	up: boolean;
	down: boolean;
	/** A lane is open past the right-hand edge, and the row has to say so. */
	beyond: boolean;
}

export interface GraphCommit {
	oid: string;
	parents: readonly string[];
}

/** What fits in the column. Past this the row says so and stops. */
export const MAX_LANES = 5;

/** Geometry the column and its renderer have to agree on, in CSS pixels. */
export const LANE_GAP = 11;
export const LANE_X0 = 7;
export const GRAPH_W = LANE_X0 * 2 + (MAX_LANES - 1) * LANE_GAP;

/** How many colours the lanes cycle through — `--lane-0` upwards in `app.css`. */
export const TONES = 5;

export function commitGraph(
	commits: readonly GraphCommit[],
	maxLanes: number = MAX_LANES
): GraphRow[] {
	// Only a parent we are actually going to draw can keep a lane open — and
	// *draw below this row*, which is not the same thing. A log is ordered by
	// date, not by topology, so a parent can land above its own child when the
	// clocks disagree. A lane opened for one would wait for a commit that has
	// already gone past, and trail an unbroken vertical off the bottom of the
	// list. Position, not membership, is what makes a parent drawable.
	const at = new Map<string, number>();
	commits.forEach((commit, i) => {
		if (!at.has(commit.oid)) at.set(commit.oid, i);
	});

	/** `lanes[i]` is the oid lane `i` is waiting for, or `null` if it is free. */
	const lanes: (string | null)[] = [];
	const rows: GraphRow[] = [];

	commits.forEach((commit, i) => {
		let lane = lanes.indexOf(commit.oid);
		// A lane was already waiting for this commit, so there is a line above it.
		// Otherwise it is a tip — the dot starts here and nothing runs into it.
		const up = lane !== -1;
		if (lane === -1) {
			lane = freeLane(lanes);
			lanes[lane] = commit.oid;
		}

		// Every other lane waiting for this same commit merges into it here.
		const merging: number[] = [];
		for (let j = 0; j < lanes.length; j += 1) {
			if (j !== lane && lanes[j] === commit.oid) {
				merging.push(j);
				lanes[j] = null;
			}
		}

		const parents = commit.parents.filter((parent) => (at.get(parent) ?? -1) > i);
		lanes[lane] = parents[0] ?? null;

		const opened: number[] = [];
		for (const parent of parents.slice(1)) {
			// A parent another lane is already waiting for is that lane's business.
			if (lanes.includes(parent)) continue;
			const j = freeLane(lanes);
			lanes[j] = parent;
			opened.push(j);
		}

		rows.push(shape(lane, up, lanes, merging, opened, maxLanes));

		// Trailing free lanes are not lanes. Dropping them keeps the column as
		// narrow as the history actually is.
		while (lanes.length > 0 && lanes[lanes.length - 1] === null) lanes.pop();
	});

	return rows;
}

function shape(
	lane: number,
	up: boolean,
	lanes: readonly (string | null)[],
	merging: readonly number[],
	opened: readonly number[],
	maxLanes: number
): GraphRow {
	// Wide enough for every open lane and for this commit's own, and never wider
	// than the column. A lane that closed on this row still has to be drawn.
	const open = Math.max(lanes.length, lane + 1, ...merging.map((j) => j + 1));
	const width = Math.min(open, maxLanes);
	const at = Math.min(lane, width - 1);

	const through: GraphEdge[] = [];
	const joins: GraphEdge[] = [];
	const forks: GraphEdge[] = [];

	for (let j = 0; j < width; j += 1) {
		if (j === at) continue;
		// A merge closes a lane and a merge commit's extra parent opens one, and
		// both happen on the row of the same merge commit — so a column that took
		// a branch in can hand the freed slot straight back to the next one out.
		// It is two edges in one column, not one edge that has to choose which
		// half of itself to be.
		if (merging.includes(j)) joins.push(edge(j));
		if (opened.includes(j)) forks.push(edge(j));
		if (!merging.includes(j) && !opened.includes(j) && lanes[j] != null) through.push(edge(j));
	}

	return {
		lane: at,
		tone: at % TONES,
		width,
		through,
		joins,
		forks,
		up,
		down: lanes[lane] != null,
		// Something is still open past the edge of the column. Saying so is better
		// than drawing a graph that quietly leaves branches out.
		beyond: lanes.slice(maxLanes).some((held) => held != null)
	};
}

/** Lanes carry their colour by position, so a spine keeps its own from top to bottom. */
function edge(at: number): GraphEdge {
	return { at, tone: at % TONES };
}

function freeLane(lanes: readonly (string | null)[]): number {
	const free = lanes.indexOf(null);
	return free === -1 ? lanes.length : free;
}

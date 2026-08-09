/**
 * The graph column — DESIGN.md §5, "box-drawing characters in mono at a fixed
 * 46px width".
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
 * It is deliberately a *one-row-per-commit* drawing rather than a railway with
 * half-rows between commits. 46px is about six characters, and a graph that
 * needed more width than that would be a graph nobody could read at a glance.
 */

export interface GraphRow {
	/** One character per lane, left to right. Rendered as a single mono string. */
	cells: string[];
	/** Which lane this commit sits in, clamped to what fits. */
	lane: number;
}

export interface GraphCommit {
	oid: string;
	parents: readonly string[];
}

/** What fits in the column at 12px mono. Past this the row says so and stops. */
export const MAX_LANES = 5;

const DOT = '●';
const LINE = '│';
const DASH = '─';
const CLOSE_RIGHT = '╯';
const CLOSE_LEFT = '╰';
const OPEN_RIGHT = '╮';
const OPEN_LEFT = '╭';
/** A lane that closes into this commit and reopens in the same column. */
const JOIN_RIGHT = '┤';
const JOIN_LEFT = '├';
const MORE = '⋯';

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

		rows.push(draw(lane, lanes, merging, opened, maxLanes));

		// Trailing free lanes are not lanes. Dropping them keeps the column as
		// narrow as the history actually is.
		while (lanes.length > 0 && lanes[lanes.length - 1] === null) lanes.pop();
	});

	return rows;
}

function draw(
	lane: number,
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
	const cells: string[] = new Array(width).fill(' ');

	for (let j = 0; j < width; j += 1) {
		if (j === at) continue;
		// A merge closes a lane and a merge commit's extra parent opens one, and
		// both happen on the row of the same merge commit — so a column that took
		// a branch in can hand the freed slot straight back to the next one out.
		// Drawn as a close alone it lies about what continues below it; as an
		// open alone it leaves the branch above it dangling. It is both, and
		// `├`/`┤` is the one character that says so: in from above, out below,
		// and a stroke towards the commit that joined them.
		const closes = merging.includes(j);
		const opens = opened.includes(j);
		if (closes && opens) cells[j] = j > at ? JOIN_RIGHT : JOIN_LEFT;
		else if (closes) cells[j] = j > at ? CLOSE_RIGHT : CLOSE_LEFT;
		else if (opens) cells[j] = j > at ? OPEN_RIGHT : OPEN_LEFT;
		else if (lanes[j] != null) cells[j] = LINE;
	}

	// Reach from the commit out to whatever it connected to, over the gaps only:
	// a lane passing through keeps its own vertical rather than being crossed.
	for (const j of [...merging, ...opened]) {
		if (j >= width) continue;
		const from = j > at ? at + 1 : j + 1;
		const to = j > at ? j : at;
		for (let k = from; k < to; k += 1) if (cells[k] === ' ') cells[k] = DASH;
	}

	cells[at] = DOT;

	// Something is still open past the edge of the column. Saying so is better
	// than drawing a graph that quietly leaves branches out.
	const beyond = lanes.slice(maxLanes).some((held) => held != null);
	if (beyond && width - 1 !== at) cells[width - 1] = MORE;

	return { cells, lane: at };
}

function freeLane(lanes: readonly (string | null)[]): number {
	const free = lanes.indexOf(null);
	return free === -1 ? lanes.length : free;
}

/**
 * Line addresses — PLAN.md Phase 4's deep links to `#L204` and `#L204-L219`.
 *
 * The grammar is github.com's, deliberately: a link to a line is the thing
 * people paste to each other, and one pasted from either place should open in
 * the other. It is the one piece of GitHub's URL surface worth copying exactly.
 *
 * A range is held normalised — `from` ≤ `to` — so a selection dragged upwards
 * and one dragged downwards are the same address, and a single line is a range
 * whose ends meet rather than a second shape to handle.
 */

export interface LineRange {
	/** 1-based, as git and every editor count. */
	from: number;
	/** Inclusive. Equal to `from` for a single line. */
	to: number;
}

const HASH = /^#L(\d+)(?:-L?(\d+))?$/;

/** `null` for anything that is not a line address, including an empty hash. */
export function parseLines(hash: string): LineRange | null {
	const match = HASH.exec(hash);
	if (!match) return null;

	const from = Number(match[1]);
	const to = match[2] === undefined ? from : Number(match[2]);
	if (!Number.isFinite(from) || from < 1) return null;

	return range(from, Number.isFinite(to) && to >= 1 ? to : from);
}

/** The empty string for no selection, so it can be concatenated unconditionally. */
export function lineHash(lines: LineRange | null): string {
	if (!lines) return '';
	return lines.from === lines.to ? `#L${lines.from}` : `#L${lines.from}-L${lines.to}`;
}

export function range(a: number, b: number): LineRange {
	return a <= b ? { from: a, to: b } : { from: b, to: a };
}

export function within(lines: LineRange | null, line: number): boolean {
	return lines !== null && line >= lines.from && line <= lines.to;
}

import type { BlameCommit, BlameRange } from '$lib/source';

/**
 * Blame, per line, with its runs marked — the overlay half of PLAN.md Phase 4's
 * warning that blame and syntax are computed on different axes.
 *
 * The API answers in ranges and the viewer renders lines, so the axes are
 * reconciled once, here, into an array the viewer can index. `first` is what
 * DESIGN.md §5 asks for: a repeated commit renders transparent, so authorship
 * reads as blocks rather than as the same SHA written forty times.
 *
 * A run is not the same thing as a range. Two adjacent ranges can carry the
 * same commit — git splits a hunk when something between them was changed and
 * changed back — and printing the SHA twice in a row would say there were two
 * authors where there was one.
 */

export interface BlameLine {
	commit: BlameCommit;
	/** The first line of a run of lines sharing this commit. */
	first: boolean;
}

export function blameByLine(ranges: readonly BlameRange[], lines: number): (BlameLine | null)[] {
	const out: (BlameLine | null)[] = new Array(lines).fill(null);
	let previous: string | null = null;

	for (const range of ranges) {
		for (let line = range.from; line <= range.to; line += 1) {
			// Blame is taken at a revision and the file is read at the same one, so
			// they agree — but a range that runs past the end would write outside
			// the array, and a truncated file makes that ordinary rather than odd.
			if (line < 1 || line > lines) continue;

			out[line - 1] = { commit: range.commit, first: range.commit.oid !== previous };
			previous = range.commit.oid;
		}
	}

	return out;
}

/** How the gutter names an author: the login if there is one, else the name. */
export function blameAuthor(commit: BlameCommit): string {
	return commit.authorLogin ?? commit.authorName ?? 'unknown';
}

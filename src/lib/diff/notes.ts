/**
 * Markers hung off diff lines — PLAN.md Phase 7's "review threads anchored to
 * lines".
 *
 * `DiffView` renders a flat list of fixed-height rows and knows nothing about
 * pull requests, so a caller that wants to mark a line says so by key rather
 * than by handing over a thread. The key is the file's path, the side of the
 * diff, and the line number on that side — which is exactly how GitHub
 * addresses a review thread, and exactly what a parsed hunk already carries.
 *
 * The two live in separate files because they are separate axes, the same call
 * Phase 4 made about blame and syntax: resolve the diff into rows, then look
 * each row's marker up. Interleaving them would put a review's vocabulary
 * inside the thing that renders a commit.
 */

/** Which numbered side of the diff a marker hangs off. */
export type NoteSide = 'old' | 'new';

export interface DiffNote {
	/** Opaque to the diff. Handed straight back when the marker is clicked. */
	id: string;
	/** What the marker reads — a count, usually. Never colour alone. */
	label: string;
	/** Indigo for "this concerns you", amber for unresolved — DESIGN.md §3. */
	tone: 'accent' | 'warn' | 'muted';
	title?: string;
}

/**
 * A newline separates the path from the position, because a path may contain
 * anything else and a key that could be produced two ways is a key that
 * eventually marks the wrong line.
 */
export function noteKey(path: string, side: NoteSide, line: number): string {
	return `${path}\n${side}${line}`;
}

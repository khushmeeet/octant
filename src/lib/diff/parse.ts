/**
 * Unified patches, parsed — PLAN.md Phase 5's diff, and the piece Phase 7 will
 * reuse for pull requests.
 *
 * GitHub sends a patch per file as one string in exactly the format `git diff`
 * writes, so this is a parser for that and nothing more. It is deliberately
 * total: anything it does not recognise becomes a line of context rather than
 * an exception, because a diff that fails to render is worse than a diff with
 * one odd row in it — and the payload comes from a repository, not from us.
 *
 * Line numbers are resolved here rather than at render time. A hunk header
 * says where each side starts and the signs say which side each line advances,
 * so counting once on the way in gives the viewer two numbers per row and no
 * arithmetic in the scroll path.
 */

export type DiffLineKind =
	/** Present only in the new file. */
	| 'add'
	/** Present only in the old one. */
	| 'del'
	/** In both, unchanged. */
	| 'ctx'
	/** `\ No newline at end of file`, and anything else git annotates with. */
	| 'note';

export interface DiffLine {
	kind: DiffLineKind;
	text: string;
	/** 1-based line in the old file, `null` on an addition. */
	old: number | null;
	/** 1-based line in the new file, `null` on a deletion. */
	new: number | null;
}

export interface DiffHunk {
	/** `@@ -1,7 +1,9 @@`, rebuilt rather than sliced, so it is always well formed. */
	header: string;
	/** What git puts after the second `@@` — usually the enclosing function. */
	heading: string;
	lines: DiffLine[];
}

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/;

export function parsePatch(patch: string): DiffHunk[] {
	const hunks: DiffHunk[] = [];
	let current: DiffHunk | null = null;
	let oldLine = 0;
	let newLine = 0;

	const lines = patch.split('\n');
	// A trailing newline terminates the last line; it is not a further one.
	if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();

	for (const raw of lines) {
		const match = HUNK.exec(raw);

		if (match) {
			oldLine = Number(match[1]);
			newLine = Number(match[3]);
			current = {
				header: `@@ -${span(match[1], match[2])} +${span(match[3], match[4])} @@`,
				heading: match[5] ?? '',
				lines: []
			};
			hunks.push(current);
			continue;
		}

		// Anything before the first hunk header is preamble we did not ask for.
		if (!current) continue;

		const sign = raw.charAt(0);
		const text = raw.slice(1);

		if (sign === '+') current.lines.push({ kind: 'add', text, old: null, new: newLine++ });
		else if (sign === '-') current.lines.push({ kind: 'del', text, old: oldLine++, new: null });
		else if (sign === '\\')
			current.lines.push({ kind: 'note', text: text.trim(), old: null, new: null });
		else current.lines.push({ kind: 'ctx', text, old: oldLine++, new: newLine++ });
	}

	return hunks;
}

/** How many lines a patch will render, without building them. */
export function patchLength(hunks: readonly DiffHunk[]): number {
	let total = 0;
	for (const hunk of hunks) total += hunk.lines.length + 1;
	return total;
}

function span(start: string, length: string | undefined): string {
	return length === undefined ? start : `${start},${length}`;
}

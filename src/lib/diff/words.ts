import type { DiffLine } from './parse';

/**
 * Intra-line refinement — which *words* on a changed line actually changed.
 *
 * A unified patch is line-granular: git says "this line went, that one came",
 * and the sign column and the row tint say so faithfully. What neither says is
 * *where* on the line the change is, and on a 120-character line whose only
 * edit is one renamed identifier, that is the entire question a reader has. So
 * every replaced line is compared against the line that replaced it, and the
 * runs of text that differ are handed to the renderer as character ranges.
 *
 * **It is a refinement and never a claim.** Nothing here can add or lose a
 * line; the worst a wrong answer can do is emphasise the wrong words on a row
 * that is already, correctly, marked added or removed. That is what licenses
 * the heuristics below — and what makes every one of them fail *closed*, by
 * returning no spans rather than a guess.
 *
 * **Pairing is by position inside a replacement run.** A run of removals
 * immediately followed by a run of additions is an edit, and its k-th removal
 * is almost always the origin of its k-th addition. Where the two runs are
 * different lengths the surplus lines are simply not paired: an unpaired line
 * is a plain addition or removal, which is the truth.
 *
 * **The alignment is weighted by characters, not by tokens.** Matching one
 * long identifier is worth more than matching three stray spaces, and a
 * token-counting LCS happily does the opposite — leaving the punctuation
 * aligned and the words either side of it all marked as changed.
 */

/** A half-open range of characters in a `DiffLine`'s `text`. */
export interface Span {
	start: number;
	end: number;
}

/**
 * Past this many characters a line is generated, minified or a lockfile, and
 * the word that changed inside it was never going to be the useful answer.
 */
const MAX_CHARS = 800;

/** The alignment table is quadratic. This bounds it at a fixed cost per pair. */
const MAX_CELLS = 40_000;

/** A replacement run longer than this is a rewritten file, not an edit. */
const MAX_RUN = 400;

/**
 * Two lines sharing less than half their text are not versions of each other,
 * whatever the alignment manages to match up. Highlighting them would mark
 * most of both rows, which says less than the row tint already does.
 */
const MIN_SIMILARITY = 0.5;

/**
 * Identifiers, whitespace runs, and every other character on its own.
 * Whitespace is a token rather than a separator because indentation changes
 * are changes, and a reader who cannot see one spends a minute not seeing it.
 */
const TOKEN = /[\p{L}\p{N}_$]+|\s+|[^\p{L}\p{N}_$\s]/gu;

/**
 * Fill in `words` on every line of a hunk that has a counterpart. Mutates in
 * place: it is called from the parser, on lines the parser has just built and
 * nobody else has seen yet.
 */
export function refineWords(lines: DiffLine[]): void {
	let at = 0;

	while (at < lines.length) {
		if (lines[at].kind !== 'del') {
			at += 1;
			continue;
		}

		let adds = at;
		while (adds < lines.length && lines[adds].kind === 'del') adds += 1;

		let end = adds;
		while (end < lines.length && lines[end].kind === 'add') end += 1;

		const pairs = Math.min(adds - at, end - adds);
		if (pairs > 0 && pairs <= MAX_RUN) {
			for (let k = 0; k < pairs; k += 1) mark(lines[at + k], lines[adds + k]);
		}

		// `end` is `adds` when nothing followed the removals, and `adds` is past
		// them either way, so this always advances.
		at = end;
	}
}

/** Compare one removed line against the line that replaced it. */
function mark(before: DiffLine, after: DiffLine): void {
	const a = before.text;
	const b = after.text;

	// A line that came back unchanged is a move, not an edit. There is nothing
	// on it to point at, and pointing at all of it would be worse than nothing.
	if (a === b) return;
	if (a.length > MAX_CHARS || b.length > MAX_CHARS) return;

	const ta = tokens(a);
	const tb = tokens(b);
	if (ta.length * tb.length > MAX_CELLS) return;

	const aligned = align(ta, tb);
	if (2 * aligned.shared < MIN_SIMILARITY * (a.length + b.length)) return;

	const spansA = spans(ta, aligned.a);
	const spansB = spans(tb, aligned.b);
	if (spansA.length === 0 && spansB.length === 0) return;

	before.words = spansA;
	after.words = spansB;
}

function tokens(text: string): string[] {
	return text.match(TOKEN) ?? [];
}

/**
 * A longest-common-subsequence alignment, weighted by token length. Returns a
 * per-token "this survived" flag for each side, and the number of characters
 * the two lines were found to share.
 */
function align(a: string[], b: string[]): { a: boolean[]; b: boolean[]; shared: number } {
	const width = b.length + 1;
	const best = new Uint32Array((a.length + 1) * width);

	for (let i = a.length - 1; i >= 0; i -= 1) {
		for (let j = b.length - 1; j >= 0; j -= 1) {
			best[i * width + j] =
				a[i] === b[j]
					? best[(i + 1) * width + j + 1] + a[i].length
					: Math.max(best[(i + 1) * width + j], best[i * width + j + 1]);
		}
	}

	const keptA = new Array<boolean>(a.length).fill(false);
	const keptB = new Array<boolean>(b.length).fill(false);
	let shared = 0;

	let i = 0;
	let j = 0;
	while (i < a.length && j < b.length) {
		if (a[i] === b[j]) {
			keptA[i] = true;
			keptB[j] = true;
			shared += a[i].length;
			i += 1;
			j += 1;
		} else if (best[(i + 1) * width + j] >= best[i * width + j + 1]) {
			i += 1;
		} else {
			j += 1;
		}
	}

	return { a: keptA, b: keptB, shared };
}

/** The unmatched tokens, as character ranges, with neighbours merged. */
function spans(toks: string[], kept: boolean[]): Span[] {
	const out: Span[] = [];
	let at = 0;
	let open: Span | null = null;

	for (let i = 0; i < toks.length; i += 1) {
		const end = at + toks[i].length;

		if (kept[i]) {
			open = null;
		} else if (open) {
			open.end = end;
		} else {
			open = { start: at, end };
			out.push(open);
		}

		at = end;
	}

	return out;
}

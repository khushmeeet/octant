import type { DiffLine } from './parse';

/**
 * Intra-line refinement — which characters on a changed line actually changed.
 *
 * A unified patch is line-granular: git says "this line went, that one came",
 * and the sign column and the row tint say so faithfully. What neither says is
 * *where* on the line the change is, and on a 120-character line whose only
 * edit is one renamed identifier, that is the entire question a reader has. So
 * a replaced block is compared against the block that replaced it, and the runs
 * of text that differ are handed to the renderer as character ranges.
 *
 * **It is a refinement and never a claim.** Nothing here can add or lose a
 * line; the worst a wrong answer can do is emphasise the wrong characters on a
 * row that is already, correctly, marked added or removed. That is what
 * licenses the heuristics below — and what makes every one of them fail
 * *closed*, by producing no spans rather than a guess.
 *
 * **A replacement is compared as a block, not line against line.** This began
 * as pairing the k-th removal with the k-th addition, and that is wrong the
 * moment a paragraph is rewrapped or a statement is split across two lines: one
 * removed line becomes three added ones, the pairing matches it against the
 * first of them, and the other two — which are most of the new text — go
 * unmarked while some coincidence at the end of the first gets lit up instead.
 * So the whole run of removals and the whole run of additions are each joined
 * and compared as one text, and the answer is scattered back across the lines
 * it came from. A sentence that moved from the end of one line to the start of
 * the next is then simply unchanged text, which is what it is.
 *
 * **The comparison is character-level, and the highlight is snapped to word
 * boundaries.** Characters are what finds the change — a single transposition
 * inside a long identifier is invisible to anything coarser. Words are what
 * makes it readable: a highlight that starts three characters into a name is
 * confetti, so a span that lands inside a word is grown until it holds the
 * whole word. Precision from the first, legibility from the second.
 *
 * The two cleanups either side of that are what keep the result from looking
 * scattered, and both matter more than they sound:
 *
 * - **Common prefix and suffix come off first.** It is what makes the
 *   comparison affordable — the quadratic part only ever sees the middle that
 *   actually differs — and it is also what gets an appended clause right: strip
 *   the shared head and tail of "…nowhere else." against "…nowhere else — and
 *   the merge button…", and nothing at all was removed, so the removed row
 *   carries no highlight and the added text carries all of it.
 * - **Scraps of coincidence between two real changes are absorbed.** Two lines
 *   that share the odd `(` or `,` in the middle of otherwise different text
 *   would otherwise be lit in fragments around them. A matched run too short to
 *   be a word is not evidence of anything.
 *
 * Finally, a line covered end to end carries no spans at all: the row tint has
 * already said the whole line is new, and repeating it in a second colour says
 * nothing and costs contrast.
 */

/** A half-open range of characters in a `DiffLine`'s `text`. */
export interface Span {
	start: number;
	end: number;
}

/**
 * Past this many characters a side is generated, minified or a lockfile, and
 * the character that changed inside it was never going to be the useful answer.
 */
const MAX_SIDE_CHARS = 4000;

/**
 * The alignment grid is quadratic in what is left after the common prefix and
 * suffix come off. Past this, both middles are marked whole — coarse, but
 * bounded and still true.
 */
const MAX_CELLS = 65_536;

/**
 * A matched run shorter than this, sitting between two changes, is a
 * coincidence rather than surviving text. It gets absorbed into the change
 * around it, and it does not count towards the two sides being related.
 */
const MIN_RUN = 3;

/** What a highlight is not allowed to cut in half. */
const WORD = /[\p{L}\p{N}_$]/u;

/**
 * Fill in `words` on the lines of a hunk that have a counterpart. Mutates in
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

		// Removals with nothing after them are a deletion, not a replacement.
		if (end > adds) refine(lines.slice(at, adds), lines.slice(adds, end));

		// `adds` is always past the removals, so this always advances.
		at = end;
	}
}

/** Compare one block of removed lines against the block that replaced it. */
function refine(before: DiffLine[], after: DiffLine[]): void {
	const a = before.map((line) => line.text).join('\n');
	const b = after.map((line) => line.text).join('\n');

	// Text that came back unchanged is a move, not an edit. There is nothing to
	// point at, and pointing at all of it would be worse than nothing.
	if (a === b) return;
	if (a.length > MAX_SIDE_CHARS || b.length > MAX_SIDE_CHARS) return;

	const changed = compare(a, b);
	if (!changed) return;

	scatter(before, changed.a);
	scatter(after, changed.b);
}

/**
 * The changed ranges on each side, in the coordinates of the joined text, or
 * `null` when the two sides are not versions of each other at all.
 */
function compare(a: string, b: string): { a: Span[]; b: Span[] } | null {
	const head = prefix(a, b);
	const tail = suffix(a, b, head);

	const midA = a.slice(head, a.length - tail);
	const midB = b.slice(head, b.length - tail);

	let spansA: Span[];
	let spansB: Span[];
	let shared = head + tail;

	if (midA.length === 0 || midB.length === 0) {
		// Pure insertion or pure deletion: one side gained or lost a run and the
		// other has nothing to show for it, which is the honest answer.
		spansA = midA.length === 0 ? [] : [{ start: head, end: head + midA.length }];
		spansB = midB.length === 0 ? [] : [{ start: head, end: head + midB.length }];
	} else if (midA.length * midB.length > MAX_CELLS) {
		spansA = [{ start: head, end: head + midA.length }];
		spansB = [{ start: head, end: head + midB.length }];
	} else {
		const aligned = align(midA, midB);
		shared += aligned.shared;
		spansA = unmatched(aligned.a, head);
		spansB = unmatched(aligned.b, head);
	}

	// Half of the shorter side has to survive in runs long enough to mean
	// something, or these are two unrelated lines that happen to be adjacent —
	// and marking the difference between those is marking nearly all of both.
	if (2 * shared < Math.min(a.length, b.length)) return null;

	return { a: settle(spansA, a), b: settle(spansB, b) };
}

/** How many characters the two sides open with in common. */
function prefix(a: string, b: string): number {
	const limit = Math.min(a.length, b.length);
	let at = 0;
	while (at < limit && a[at] === b[at]) at += 1;
	return at;
}

/** And how many they end with, past what the prefix already took. */
function suffix(a: string, b: string, head: number): number {
	const limit = Math.min(a.length, b.length) - head;
	let at = 0;
	while (at < limit && a[a.length - 1 - at] === b[b.length - 1 - at]) at += 1;
	return at;
}

/**
 * A character-level longest common subsequence. Returns a per-character "this
 * survived" flag for each side, and how many characters matched in runs long
 * enough to be evidence rather than coincidence.
 */
function align(x: string, y: string): { a: boolean[]; b: boolean[]; shared: number } {
	const width = y.length + 1;
	const best = new Uint32Array((x.length + 1) * width);

	for (let i = x.length - 1; i >= 0; i -= 1) {
		for (let j = y.length - 1; j >= 0; j -= 1) {
			best[i * width + j] =
				x[i] === y[j]
					? best[(i + 1) * width + j + 1] + 1
					: Math.max(best[(i + 1) * width + j], best[i * width + j + 1]);
		}
	}

	const keptX = new Array<boolean>(x.length).fill(false);
	const keptY = new Array<boolean>(y.length).fill(false);
	let shared = 0;
	let run = 0;

	let i = 0;
	let j = 0;
	while (i < x.length && j < y.length) {
		if (x[i] === y[j]) {
			keptX[i] = true;
			keptY[j] = true;
			run += 1;
			i += 1;
			j += 1;
			continue;
		}

		if (run >= MIN_RUN) shared += run;
		run = 0;

		if (best[(i + 1) * width + j] >= best[i * width + j + 1]) i += 1;
		else j += 1;
	}

	if (run >= MIN_RUN) shared += run;

	return { a: keptX, b: keptY, shared };
}

/** The characters that did not survive, as ranges, offset past the prefix. */
function unmatched(kept: boolean[], offset: number): Span[] {
	const out: Span[] = [];
	let open: Span | null = null;

	for (let i = 0; i < kept.length; i += 1) {
		if (kept[i]) {
			open = null;
		} else if (open) {
			open.end = offset + i + 1;
		} else {
			open = { start: offset + i, end: offset + i + 1 };
			out.push(open);
		}
	}

	return out;
}

/**
 * Absorb the scraps between two changes, then grow every span until it holds
 * whole words — and whole characters: a range must never split a surrogate
 * pair, or `slice` hands the renderer half of an astral character.
 */
function settle(spans: Span[], text: string): Span[] {
	const merged: Span[] = [];
	for (const span of spans) {
		const last = merged[merged.length - 1];
		if (last && span.start - last.end <= MIN_RUN) last.end = span.end;
		else merged.push({ ...span });
	}

	const out: Span[] = [];
	for (const span of merged) {
		let { start, end } = span;

		while (start > 0 && WORD.test(text[start - 1]) && WORD.test(text[start])) start -= 1;
		while (end < text.length && WORD.test(text[end - 1]) && WORD.test(text[end])) end += 1;

		if (low(text.charCodeAt(start))) start -= 1;
		if (low(text.charCodeAt(end))) end += 1;

		const last = out[out.length - 1];
		if (last && start <= last.end) last.end = Math.max(last.end, end);
		else out.push({ start, end });
	}

	return out;
}

/** The trailing half of a surrogate pair, which is never a boundary. */
function low(code: number): boolean {
	return code >= 0xdc00 && code <= 0xdfff;
}

/**
 * A line's own edges are absorbed on the same terms two spans are: a scrap of
 * punctuation too short to be a word is not evidence that anything survived
 * there. It is what stops a highlight ending one character before the end of
 * the line because a full stop happened to match the one on the line it
 * replaced — and, since a line then covered end to end is dropped entirely, it
 * is also what keeps a wholly new line to the row tint alone.
 *
 * Only non-word characters are eaten, so an identifier is never half-swallowed
 * by the tidy-up meant to make it legible.
 */
function edges(spans: Span[], text: string): void {
	const first = spans[0];
	if (first.start > 0 && first.start <= MIN_RUN && !WORD.test(text.slice(0, first.start))) {
		first.start = 0;
	}

	const last = spans[spans.length - 1];
	const trailing = text.length - last.end;
	if (trailing > 0 && trailing <= MIN_RUN && !WORD.test(text.slice(last.end))) {
		last.end = text.length;
	}
}

/**
 * Cut the joined text's ranges back up along the lines they came from. The
 * newline that joined two lines belongs to neither, so it falls in the gap.
 */
function scatter(lines: DiffLine[], spans: Span[]): void {
	if (spans.length === 0) return;

	let at = 0;

	for (const line of lines) {
		const from = at;
		const to = at + line.text.length;
		at = to + 1;

		if (line.text.length === 0) continue;

		const local: Span[] = [];
		for (const span of spans) {
			const start = Math.max(span.start, from);
			const end = Math.min(span.end, to);
			if (end > start) local.push({ start: start - from, end: end - from });
		}

		if (local.length === 0) continue;

		edges(local, line.text);

		// A line marked end to end is a line the row tint has already accounted
		// for. Saying it twice in two strengths of the same colour says nothing.
		if (local.length === 1 && local[0].start === 0 && local[0].end === line.text.length) continue;

		line.words = local;
	}
}

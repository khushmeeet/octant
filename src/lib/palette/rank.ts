/**
 * Ranking — PLAN.md Phase 9, "from local cache first, network second".
 *
 * Everything the palette ranks is already in memory, so this runs on every
 * keystroke against every candidate: a repository's whole path index, the
 * account's repositories, the pull requests in flight. It is a subsequence
 * matcher rather than a word matcher, because the thing you half-remember about
 * a path is rarely a whole word of it — `srcmpl` should find
 * `src/lib/compiler.js`.
 *
 * Three ideas do most of the work:
 *
 * 1. **Match, then tighten.** A greedy left-to-right scan proves the characters
 *    are there in order; a second pass slides each one as far right as it can
 *    go. That turns `app` on `src/lib/App.svelte` from three scattered letters
 *    into a run inside the file's own name, which is what a person means.
 * 2. **Runs and boundaries score, position does not.** Consecutive characters
 *    and characters after `/`, `-`, `_`, `.` or a camel hump are what make a
 *    match feel deliberate.
 * 3. **Shorter wins ties.** A candidate that is mostly match beats one that
 *    merely contains it.
 *
 * No highlighting is invented here: `hits` is where the characters actually
 * landed, and the row renders exactly those.
 */

export interface Match {
	score: number;
	/** Indices in the candidate, ascending. What the row emphasises. */
	hits: number[];
}

export interface Ranked<T> {
	item: T;
	match: Match;
}

const BOUNDARY = /[/\-_. ]/;

/**
 * `needle` must already be lower case and whitespace-free — `parseQuery` does
 * both, once, rather than every candidate paying for it.
 */
export function match(text: string, needle: string): Match | null {
	if (!needle) return { score: 0, hits: [] };

	const lowered = text.toLowerCase();
	const hits: number[] = [];

	let at = 0;
	for (let i = 0; i < needle.length; i++) {
		const found = lowered.indexOf(needle[i], at);
		if (found === -1) return null;
		hits.push(found);
		at = found + 1;
	}

	tighten(lowered, needle, hits);
	return { score: score(text, lowered, hits), hits };
}

/**
 * Slide every hit as far right as it will go without passing the one after it.
 * The greedy scan finds *a* match; this finds the one nearest the end, which on
 * a path is the part that names the file.
 */
function tighten(lowered: string, needle: string, hits: number[]): void {
	for (let i = hits.length - 1; i >= 0; i--) {
		const limit = (i === hits.length - 1 ? lowered.length : hits[i + 1]) - 1;

		for (let cursor = limit; cursor > hits[i]; cursor--) {
			if (lowered[cursor] === needle[i]) {
				hits[i] = cursor;
				break;
			}
		}
	}
}

function score(text: string, lowered: string, hits: number[]): number {
	// Where the last path segment starts. A match inside it is a match on the
	// thing's name rather than on the shelf it sits on.
	const base = lowered.lastIndexOf('/') + 1;

	let total = 0;
	for (let i = 0; i < hits.length; i++) {
		const at = hits[i];
		total += 10;

		if (i > 0 && hits[i - 1] === at - 1) total += 12;

		if (at === 0 || BOUNDARY.test(lowered[at - 1])) total += 10;
		// A camel hump: an upper-case letter after a lower-case one. The same
		// word start, spelled the way source files spell it.
		else if (text[at] !== lowered[at] && text[at - 1] === lowered[at - 1]) total += 6;

		if (at >= base) total += 6;
	}

	// How far in the match starts, and how much of the candidate is not match.
	// Both are penalties rather than bonuses so a long path never out-scores a
	// short one on length alone.
	return total - Math.min(hits[0], 24) * 0.5 - lowered.length * 0.15;
}

/**
 * The best `limit` of `items`, highest score first. An empty needle keeps the
 * order it was given — the lists that reach here are already ordered by
 * something better than a score (most recently pushed, most recently updated).
 */
export function best<T>(
	items: readonly T[],
	needle: string,
	text: (item: T) => string,
	limit: number
): Ranked<T>[] {
	return bestOf(items, limit, (item) => match(text(item), needle));
}

export interface Segment {
	text: string;
	/** Part of what you typed. The row emphasises it; nothing else. */
	hit: boolean;
}

/**
 * A label cut into matched and unmatched runs, for rendering. Emphasis is the
 * only decoration the palette spends — no colour, because DESIGN.md §3 gives
 * every colour exactly one meaning and "this is why the row is here" is not one
 * of them.
 */
export function segments(text: string, hits: readonly number[] = []): Segment[] {
	if (hits.length === 0) return [{ text, hit: false }];

	const parts: Segment[] = [];
	let at = 0;

	for (let i = 0; i < hits.length;) {
		// Consecutive hits render as one run rather than one span per character.
		let end = i;
		while (end + 1 < hits.length && hits[end + 1] === hits[end] + 1) end += 1;

		if (hits[i] > at) parts.push({ text: text.slice(at, hits[i]), hit: false });
		parts.push({ text: text.slice(hits[i], hits[end] + 1), hit: true });

		at = hits[end] + 1;
		i = end + 1;
	}

	if (at < text.length) parts.push({ text: text.slice(at), hit: false });
	return parts;
}

/**
 * The same, for a candidate that is matched against more than one of its own
 * fields — a pull request is found by its title or by its number, and which one
 * hit decides what the row highlights.
 *
 * A scorer that returns a match for everything is how an empty needle keeps the
 * order it was given.
 */
export function bestOf<T>(
	items: readonly T[],
	limit: number,
	scorer: (item: T) => Match | null
): Ranked<T>[] {
	const found: Ranked<T>[] = [];
	for (const item of items) {
		const hit = scorer(item);
		if (hit) found.push({ item, match: hit });
	}

	// A stable sort, which `Array.prototype.sort` has been since ES2019: equal
	// scores keep the order the list arrived in, and those lists are already
	// ordered by something better than a score — most recently pushed, most
	// recently updated. It is also what makes an empty needle a no-op.
	found.sort((a, b) => b.match.score - a.match.score);

	// A partial sort would be faster on a large index and is not worth the code:
	// this runs on lists of thousands, not millions, and only on what matched.
	return found.slice(0, limit);
}

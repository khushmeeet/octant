import { scan, type Grammar, type Token, type TokenKind } from './tokenize';

/**
 * The highlighting seam — PLAN.md Phase 4.
 *
 * `PLAN.md` warns that blame ranges and syntax tokens are computed on different
 * axes and must not be interleaved in one pass. This is the syntax axis, whole:
 * a file goes in, and a line's tokens come out on request. The viewer overlays
 * blame on the same line index afterwards, and neither knows about the other.
 *
 * Two things are lazy, and both matter at 20,000 lines:
 *
 * - **Line states** are computed only as far as the highest line asked for.
 *   Scanning for the state alone allocates nothing, so walking ahead to a line
 *   a deep link jumped to costs a pass over characters and no garbage.
 * - **Tokens** are computed per line and memoised, so scrolling back over a
 *   line already read is a lookup.
 *
 * A `null` grammar is a first-class answer, not a failure: it renders the file
 * as plain text, which is what a `.txt` should look like anyway.
 */

export interface Highlighter {
	readonly lines: readonly string[];
	/** Tokens for one 0-based line. Empty when the file has no grammar. */
	tokens(index: number): readonly Token[];
}

export interface Piece {
	text: string;
	/** `null` is unhighlighted source. */
	kind: TokenKind | null;
}

const NONE: readonly Token[] = [];

export function highlighter(lines: readonly string[], grammar: Grammar | null): Highlighter {
	if (!grammar) return { lines, tokens: () => NONE };
	const g = grammar;

	/** `states[i]` is the state line `i` begins in. The first begins clean. */
	const states: number[] = [0];
	const memo: (Token[] | undefined)[] = [];

	function stateAt(index: number): number {
		while (states.length <= index && states.length <= lines.length) {
			const at = states.length - 1;
			states.push(scan(g, lines[at] ?? '', states[at], null));
		}
		return states[index] ?? 0;
	}

	return {
		lines,
		tokens(index) {
			const held = memo[index];
			if (held) return held;

			const out: Token[] = [];
			scan(g, lines[index] ?? '', stateAt(index), out);
			memo[index] = out;
			return out;
		}
	};
}

/**
 * A line as alternating highlighted and plain runs. Built at render time for
 * the lines actually on screen, so the memoised token arrays stay small.
 */
export function pieces(line: string, tokens: readonly Token[]): Piece[] {
	if (tokens.length === 0) return line ? [{ text: line, kind: null }] : [];

	const out: Piece[] = [];
	let at = 0;

	for (const token of tokens) {
		if (token.from > at) out.push({ text: line.slice(at, token.from), kind: null });
		out.push({ text: line.slice(token.from, token.to), kind: token.kind });
		at = token.to;
	}

	if (at < line.length) out.push({ text: line.slice(at), kind: null });
	return out;
}

/**
 * Split a blob into the lines a code viewer numbers.
 *
 * A text file ends with a newline; that terminator is not a further line, and
 * counting it as one puts a phantom empty row under every file. `\r\n` is
 * normalised here rather than in the viewer so a checkout with Windows endings
 * does not render a stray glyph at the end of every line.
 */
export function splitLines(text: string): string[] {
	const lines = text.split('\n');
	if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
	return lines.map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line));
}

/**
 * The longest line, in character cells.
 *
 * A virtualised list only holds a viewport's worth of rows, so the width of a
 * horizontally scrolling code column would be the widest line *currently
 * rendered* — and it would jump as you scrolled past a long one. Measuring the
 * whole file once fixes the width for the whole file. It is a single pass with
 * no allocation, and a monospace column makes a character count a width.
 */
export function widestLine(lines: readonly string[], tab = 4): number {
	let widest = 0;

	for (const line of lines) {
		let width = line.length;

		if (line.includes('\t')) {
			width = 0;
			for (const ch of line) width += ch === '\t' ? tab - (width % tab) : 1;
		}

		if (width > widest) widest = width;
	}

	return widest;
}

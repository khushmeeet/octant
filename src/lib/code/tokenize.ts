/**
 * The tokenizer — PLAN.md Phase 4's syntax highlighting.
 *
 * **Four token kinds, and only four.** DESIGN.md §3 spends exactly four colours
 * on syntax — keyword, string/literal, comment, call site — and says they sit
 * *under* the chrome and never above it. A TextMate grammar resolves dozens of
 * scopes we would then collapse into those four anyway, so the scanner emits
 * the four directly and there is nothing to map.
 *
 * **It is incremental by line, because the viewer is virtualised.** Tokenizing
 * a whole blob up front is a single blocking pass proportional to the file, on
 * a screen whose budget is 400ms cold and 16ms warm. Instead a line is scanned
 * from the state the previous line ended in, so opening a 20,000-line file
 * costs a viewport's worth of work. `scan` returns that end state, and passing
 * `out: null` runs it for the state alone with no allocation — which is how
 * `highlight.ts` walks ahead to a line you jumped to.
 *
 * **It is a subset, deliberately**, in the same spirit as `md/parse.ts`: it
 * never throws, and anything it does not understand comes out as plain text.
 * A grammar it gets wrong is a colour that is missing, never a line that is.
 */

export type TokenKind =
	/** `--kw` — keywords. */
	| 'kw'
	/** `--str` — strings and numeric literals. */
	| 'str'
	/** `--cm` — comments. */
	| 'cm'
	/** `--fn` — call sites. */
	| 'fn';

/** Column offsets into one line: `from` inclusive, `to` exclusive. */
export interface Token {
	from: number;
	to: number;
	kind: TokenKind;
}

export interface Quote {
	open: string;
	close: string;
	/** A backslash escapes the closer. */
	escape?: boolean;
	/** Survives a line break — a template literal, a Python docstring. */
	multiline?: boolean;
}

/** A region of a markup document handed to another grammar. */
export interface Embed {
	/** The opening tag up to its name, lowercase: `<script`. */
	open: string;
	/** The closing tag, whole: `</script>`. */
	close: string;
	grammar: Grammar;
}

export interface Grammar {
	id: string;
	keywords?: ReadonlySet<string>;
	/** Matched against the lowercased word — SQL and friends. */
	ignoreCase?: boolean;
	/** Line comment openers. */
	line?: readonly string[];
	/** Block comment delimiters. */
	block?: readonly (readonly [string, string])[];
	quotes?: readonly Quote[];
	/** `name(` reads as a call site. */
	calls?: boolean;
	/** Digits open a numeric literal. Default on. */
	numbers?: boolean;
	/** `@media`, `@mixin` — an at-word is a keyword. CSS and its dialects. */
	at?: boolean;
	/** `<tag` and `</tag` read as keywords. Markup languages. */
	tags?: boolean;
	/** Markup only. */
	embeds?: readonly Embed[];
}

/**
 * Line state is one small integer so a file's worth of them is an array of
 * numbers rather than a graph of objects: `embed * 64 + inner`, where `embed`
 * selects the grammar in force and `inner` names the multi-line construct the
 * line opened inside — 0 for none, then the block comments, then the
 * multi-line strings.
 */
const EMBED = 64;

const NO_STRINGS: readonly string[] = [];
const NO_BLOCKS: readonly (readonly [string, string])[] = [];
const NO_QUOTES: readonly Quote[] = [];

/**
 * Scan one line. Returns the state the next line starts in; pushes tokens into
 * `out` when there is one, and allocates nothing when there is not.
 */
export function scan(host: Grammar, line: string, state: number, out: Token[] | null): number {
	const n = line.length;
	let embed = Math.floor(state / EMBED);
	let inner = state % EMBED;
	/** A `<script` whose `>` we have not reached yet. */
	let pending = 0;
	let i = 0;

	function emit(from: number, to: number, kind: TokenKind): void {
		if (out && to > from) out.push({ from, to, kind });
	}

	scanning: while (i < n) {
		const g = embed === 0 ? host : (host.embeds?.[embed - 1]?.grammar ?? host);
		const blocks = g.block ?? NO_BLOCKS;
		const quotes = g.quotes ?? NO_QUOTES;

		// A construct that survived the last line break. It owns the start of
		// this line, whatever else is in it.
		if (inner !== 0) {
			const which = inner - 1;
			if (which < blocks.length) {
				const close = blocks[which][1];
				const end = line.indexOf(close, i);
				if (end === -1) {
					emit(i, n, 'cm');
					break;
				}
				emit(i, end + close.length, 'cm');
				i = end + close.length;
			} else {
				const spec = quotes[which - blocks.length];
				const end = spec ? closeOf(line, i, spec) : -1;
				if (end === -1) {
					emit(i, n, 'str');
					break;
				}
				emit(i, end, 'str');
				i = end;
			}
			inner = 0;
			continue;
		}

		// The end of an embedded region, checked before the sub-grammar gets a
		// say — but after its strings, which is why `"</script>"` in JavaScript
		// stays a string.
		if (embed !== 0) {
			const close = host.embeds?.[embed - 1]?.close ?? '';
			if (close && line.startsWith(close, i)) {
				emit(i, i + close.length, 'kw');
				i += close.length;
				embed = 0;
				continue;
			}
		}

		for (const open of g.line ?? NO_STRINGS) {
			if (line.startsWith(open, i)) {
				emit(i, n, 'cm');
				break scanning;
			}
		}

		for (let b = 0; b < blocks.length; b += 1) {
			const [open, close] = blocks[b];
			if (!line.startsWith(open, i)) continue;
			const end = line.indexOf(close, i + open.length);
			if (end === -1) {
				emit(i, n, 'cm');
				inner = 1 + b;
				break scanning;
			}
			emit(i, end + close.length, 'cm');
			i = end + close.length;
			continue scanning;
		}

		for (let q = 0; q < quotes.length; q += 1) {
			const spec = quotes[q];
			if (!line.startsWith(spec.open, i)) continue;
			const end = closeOf(line, i + spec.open.length, spec);
			if (end === -1) {
				emit(i, n, 'str');
				// An unterminated single-line string ends with the line. Only a
				// construct that really spans lines is allowed to colour the next
				// one, or one stray quote would tint the rest of the file.
				if (spec.multiline) inner = 1 + blocks.length + q;
				break scanning;
			}
			emit(i, end, 'str');
			i = end;
			continue scanning;
		}

		const ch = line[i];

		if (g.tags && ch === '<') {
			let j = i + 1;
			if (line[j] === '/') j += 1;
			if (isTagStart(line[j])) {
				let k = j;
				while (k < n && isTagPart(line[k])) k += 1;
				emit(i, k, 'kw');
				const name = line.slice(i, k).toLowerCase();
				const found = host.embeds?.findIndex((e) => e.open === name) ?? -1;
				// The attributes are still markup; the region starts after the `>`.
				if (found >= 0) pending = found + 1;
				i = k;
				continue;
			}
		}

		if (g.tags && ch === '>' && pending !== 0) {
			embed = pending;
			pending = 0;
			i += 1;
			continue;
		}

		if (g.at && ch === '@' && isIdentStart(line[i + 1])) {
			let j = i + 1;
			while (j < n && isIdentPart(line[j])) j += 1;
			emit(i, j, 'kw');
			i = j;
			continue;
		}

		if (isIdentStart(ch)) {
			let j = i;
			while (j < n && isIdentPart(line[j])) j += 1;
			const word = line.slice(i, j);
			if (g.keywords?.has(g.ignoreCase ? word.toLowerCase() : word)) emit(i, j, 'kw');
			else if (g.calls && line[skipSpace(line, j)] === '(') emit(i, j, 'fn');
			i = j;
			continue;
		}

		// Reached only outside an identifier, so `utf8` stays one word.
		if (g.numbers !== false && isDigit(ch)) {
			let j = i;
			while (j < n && isNumberPart(line[j])) j += 1;
			emit(i, j, 'str');
			i = j;
			continue;
		}

		i += 1;
	}

	// A tag that opened a region but whose `>` is on another line. Rare enough
	// to handle by assumption rather than by carrying a third state field.
	if (pending !== 0) embed = pending;

	return embed * EMBED + inner;
}

/** Index just past the closing delimiter, or `-1` if the line ends first. */
function closeOf(line: string, from: number, spec: Quote): number {
	let i = from;
	while (i < line.length) {
		if (spec.escape && line[i] === '\\') {
			i += 2;
			continue;
		}
		if (line.startsWith(spec.close, i)) return i + spec.close.length;
		i += 1;
	}
	return -1;
}

function skipSpace(line: string, from: number): number {
	let i = from;
	while (line[i] === ' ' || line[i] === '\t') i += 1;
	return i;
}

function isDigit(ch: string | undefined): boolean {
	return ch !== undefined && ch >= '0' && ch <= '9';
}

/** Suffixes, exponents, separators and radix prefixes, without parsing them. */
function isNumberPart(ch: string): boolean {
	return isDigit(ch) || isAlpha(ch) || ch === '.' || ch === '_';
}

function isAlpha(ch: string): boolean {
	return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z');
}

/** Non-ASCII counts as a letter, so an identifier in any script stays whole. */
function isIdentStart(ch: string | undefined): boolean {
	if (ch === undefined) return false;
	return isAlpha(ch) || ch === '_' || ch === '$' || ch.charCodeAt(0) > 127;
}

function isIdentPart(ch: string): boolean {
	return isIdentStart(ch) || isDigit(ch);
}

function isTagStart(ch: string | undefined): boolean {
	return ch !== undefined && (isAlpha(ch) || ch === '!' || ch === '?');
}

function isTagPart(ch: string): boolean {
	return isIdentPart(ch) || ch === '-' || ch === ':' || ch === '!' || ch === '?';
}

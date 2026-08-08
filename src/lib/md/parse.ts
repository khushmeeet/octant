/**
 * A small Markdown parser — PLAN.md Phase 3, "README rendering below the
 * listing".
 *
 * Two decisions shape it, and both are the architecture's rather than taste.
 *
 * **It produces an AST, not HTML.** GitHub will render Markdown for us over
 * REST, and the result would be one `{@html}` away from the screen. But
 * ARCHITECTURE.md §11 already lists the token in browser storage against "XSS
 * is a real risk", and injecting third-party markup into the one document that
 * holds it makes that risk strictly worse for a feature that is not worth it.
 * A tree of typed nodes rendered by Svelte cannot inject anything.
 *
 * **It is a subset, deliberately.** Headings, paragraphs, fenced code, quotes,
 * lists, tables, rules, and the inline set — enough for the READMEs people
 * actually write. Raw HTML is stripped rather than rendered: it is where the
 * decoration lives, and DESIGN.md §8 does not want the decoration.
 *
 * The parser never throws. Anything it does not understand comes out as text,
 * because a README that renders plainly is better than a screen that does not
 * render at all.
 */

export type Align = 'left' | 'center' | 'right' | null;

export type Inline =
	| { kind: 'text'; text: string }
	| { kind: 'code'; text: string }
	| { kind: 'strong'; children: Inline[] }
	| { kind: 'em'; children: Inline[] }
	| { kind: 'strike'; children: Inline[] }
	| { kind: 'link'; href: string; children: Inline[] }
	/** Rendered as its alt text. DESIGN.md §8: no illustrations, no badges. */
	| { kind: 'image'; alt: string };

export type Block =
	| { kind: 'heading'; level: number; children: Inline[] }
	| { kind: 'paragraph'; children: Inline[] }
	| { kind: 'code'; lang: string | null; text: string }
	| { kind: 'quote'; blocks: Block[] }
	| { kind: 'list'; ordered: boolean; start: number; items: Block[][] }
	| { kind: 'table'; head: Inline[][]; align: Align[]; rows: Inline[][][] }
	| { kind: 'rule' };

/** Link reference definitions, collected before the block pass. */
type Refs = Map<string, string>;

export function parseMarkdown(source: string): Block[] {
	// A byte-order mark, written as an escape: literally it is invisible, and an
	// invisible character in a regex is a trap for whoever reads this next.
	const text = source
		.replace(/^\uFEFF/, '')
		.replace(/\r\n?/g, '\n')
		.replace(/\t/g, '    ');
	const refs: Refs = new Map();
	const lines = collectRefs(text.split('\n'), refs);
	return parseBlocks(lines, refs);
}

/* --------------------------------------------------------------- blocks -- */

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*(\S+)?/;
const ATX = /^ {0,3}(#{1,6})(?:\s+(.*?))?\s*$/;
const RULE = /^ {0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/;
const QUOTE = /^ {0,3}> ?/;
const SETEXT = /^ {0,3}(=+|-+)\s*$/;
const HTML_OPEN = /^ {0,3}<\/?[a-zA-Z][^>]*>?/;
const DEFINITION = /^ {0,3}\[([^\]]+)\]:\s*(\S+)/;

function collectRefs(lines: string[], refs: Refs): string[] {
	const kept: string[] = [];
	let fenced = false;

	for (const line of lines) {
		if (FENCE.test(line)) fenced = !fenced;

		const definition = fenced ? null : DEFINITION.exec(line);
		if (definition) {
			refs.set(definition[1].toLowerCase(), definition[2].replace(/^<|>$/g, ''));
			continue;
		}
		kept.push(line);
	}
	return kept;
}

function parseBlocks(lines: string[], refs: Refs): Block[] {
	const out: Block[] = [];
	let i = 0;

	while (i < lines.length) {
		const line = lines[i];

		if (!line.trim()) {
			i += 1;
			continue;
		}

		const fence = FENCE.exec(line);
		if (fence) {
			const marker = fence[1];
			const body: string[] = [];
			i += 1;
			while (i < lines.length && !lines[i].trimStart().startsWith(marker)) {
				body.push(lines[i]);
				i += 1;
			}
			// An unterminated fence runs to the end of the file, as GitHub's does.
			i += 1;
			out.push({ kind: 'code', lang: fence[2] ?? null, text: body.join('\n') });
			continue;
		}

		const atx = ATX.exec(line);
		if (atx) {
			const text = (atx[2] ?? '').replace(/\s+#+\s*$/, '');
			out.push({ kind: 'heading', level: atx[1].length, children: parseInline(text, refs) });
			i += 1;
			continue;
		}

		if (RULE.test(line)) {
			out.push({ kind: 'rule' });
			i += 1;
			continue;
		}

		if (QUOTE.test(line)) {
			const body: string[] = [];
			while (i < lines.length && (QUOTE.test(lines[i]) || (lines[i].trim() && body.length > 0))) {
				body.push(lines[i].replace(QUOTE, ''));
				i += 1;
			}
			out.push({ kind: 'quote', blocks: parseBlocks(body, refs) });
			continue;
		}

		if (listMarker(line)) {
			const [list, next] = parseList(lines, i, refs);
			out.push(list);
			i = next;
			continue;
		}

		const table = parseTable(lines, i, refs);
		if (table) {
			out.push(table[0]);
			i = table[1];
			continue;
		}

		// Raw HTML: skipped to the next blank line. This is where the centred
		// logos and the badge rows live, and neither belongs in this design.
		if (HTML_OPEN.test(line)) {
			while (i < lines.length && lines[i].trim()) i += 1;
			continue;
		}

		const buffer: string[] = [];
		let heading: Block | null = null;

		while (i < lines.length) {
			const current = lines[i];
			if (!current.trim()) break;

			// Checked before the block starters, because `---` under a line of
			// text is an underline and on its own it is a rule.
			const setext = buffer.length > 0 ? SETEXT.exec(current) : null;
			if (setext) {
				heading = {
					kind: 'heading',
					level: setext[1].startsWith('=') ? 1 : 2,
					children: parseInline(buffer.join(' '), refs)
				};
				i += 1;
				break;
			}

			if (buffer.length > 0 && (startsBlock(current) || parseTable(lines, i, refs))) break;

			buffer.push(current.trim());
			i += 1;
		}

		if (heading) out.push(heading);
		else if (buffer.length > 0)
			out.push({ kind: 'paragraph', children: parseInline(buffer.join('\n'), refs) });
	}

	return out;
}

function startsBlock(line: string): boolean {
	return (
		FENCE.test(line) ||
		ATX.test(line) ||
		RULE.test(line) ||
		QUOTE.test(line) ||
		HTML_OPEN.test(line) ||
		listMarker(line) !== null
	);
}

/* ----------------------------------------------------------------- list -- */

interface Marker {
	indent: number;
	/** Columns from the start of the line to the item's content. */
	width: number;
	ordered: boolean;
	start: number;
}

const MARKER = /^( *)([-*+]|(\d{1,9})[.)])( +|$)/;

function listMarker(line: string): Marker | null {
	const match = MARKER.exec(line);
	// Four spaces of indent is a code block, not a nested item.
	if (!match || match[1].length > 3 + 4) return null;

	const ordered = match[3] !== undefined;
	return {
		indent: match[1].length,
		width: match[0].length,
		ordered,
		start: ordered ? Number(match[3]) : 1
	};
}

function parseList(lines: string[], from: number, refs: Refs): [Block, number] {
	const first = listMarker(lines[from])!;
	const items: Block[][] = [];
	let buffer: string[] = [];
	let content = first.width;
	let i = from;

	const flush = () => {
		if (buffer.length > 0) items.push(parseBlocks(buffer, refs));
		buffer = [];
	};

	while (i < lines.length) {
		const line = lines[i];
		const marker = listMarker(line);

		// A sibling item: same nesting level, same kind. A different kind starts
		// a new list, which is what the blank-line-free `- a` / `1. b` case wants.
		if (marker && marker.indent <= first.indent && marker.ordered === first.ordered) {
			flush();
			buffer.push(line.slice(marker.width));
			content = marker.width;
			i += 1;
			continue;
		}

		if (!line.trim()) {
			const next = lines[i + 1] ?? '';
			const continues =
				(next.trim() && indentOf(next) >= content) ||
				(listMarker(next)?.indent ?? Infinity) <= first.indent;
			if (!continues) break;
			buffer.push('');
			i += 1;
			continue;
		}

		if (indentOf(line) >= content) {
			buffer.push(line.slice(content));
			i += 1;
			continue;
		}

		// Lazy continuation: an unindented line under an item's paragraph.
		if (buffer.length > 0 && buffer[buffer.length - 1].trim() && !startsBlock(line)) {
			buffer.push(line.trim());
			i += 1;
			continue;
		}

		break;
	}

	flush();
	return [{ kind: 'list', ordered: first.ordered, start: first.start, items }, i];
}

function indentOf(line: string): number {
	return line.length - line.trimStart().length;
}

/* ---------------------------------------------------------------- table -- */

const DELIMITER = /^ {0,3}\|?(?: *:?-+:? *\|)+ *:?-+:? *\|? *$/;

function parseTable(lines: string[], from: number, refs: Refs): [Block, number] | null {
	const header = lines[from];
	const delimiter = lines[from + 1];
	if (!header?.includes('|') || !delimiter || !DELIMITER.test(delimiter)) return null;

	const head = splitRow(header);
	const align = splitRow(delimiter).map(alignOf);
	if (head.length !== align.length) return null;

	const rows: string[][] = [];
	let i = from + 2;
	while (i < lines.length && lines[i].trim() && lines[i].includes('|')) {
		const cells = splitRow(lines[i]);
		while (cells.length < head.length) cells.push('');
		rows.push(cells.slice(0, head.length));
		i += 1;
	}

	return [
		{
			kind: 'table',
			head: head.map((cell) => parseInline(cell, refs)),
			align,
			rows: rows.map((row) => row.map((cell) => parseInline(cell, refs)))
		},
		i
	];
}

function alignOf(cell: string): Align {
	const left = cell.startsWith(':');
	const right = cell.endsWith(':');
	if (left && right) return 'center';
	if (right) return 'right';
	if (left) return 'left';
	return null;
}

/** Splits on unescaped pipes, dropping the optional outer ones. */
function splitRow(line: string): string[] {
	const cells: string[] = [];
	let cell = '';

	for (let i = 0; i < line.length; i += 1) {
		if (line[i] === '\\' && line[i + 1] === '|') {
			cell += '|';
			i += 1;
		} else if (line[i] === '|') {
			cells.push(cell);
			cell = '';
		} else {
			cell += line[i];
		}
	}
	cells.push(cell);

	if (cells[0].trim() === '') cells.shift();
	if (cells.length > 0 && cells[cells.length - 1].trim() === '') cells.pop();
	return cells.map((value) => value.trim());
}

/* --------------------------------------------------------------- inline -- */

const ESCAPABLE = /[\\`*_{}[\]()#+\-.!~<>|]/;
const AUTOLINK = /^<((?:https?|mailto):[^>\s]+)>/;
const TAG = /^<\/?[a-zA-Z][^>]*>/;
const BARE_URL = /^(?:https?:\/\/|www\.)[^\s<>()[\]]+[^\s<>()[\].,;:!?'"]/;

export function parseInline(source: string, refs: Refs = new Map()): Inline[] {
	const out: Inline[] = [];
	let text = '';
	let i = 0;

	const flush = () => {
		if (text) out.push({ kind: 'text', text });
		text = '';
	};

	while (i < source.length) {
		const char = source[i];

		if (char === '\\' && ESCAPABLE.test(source[i + 1] ?? '')) {
			text += source[i + 1];
			i += 2;
			continue;
		}

		if (char === '`') {
			const run = /^`+/.exec(source.slice(i))![0];
			const close = source.indexOf(run, i + run.length);
			if (close !== -1) {
				flush();
				out.push({
					kind: 'code',
					text: source.slice(i + run.length, close).replace(/^ (.*) $/, '$1')
				});
				i = close + run.length;
				continue;
			}
		}

		if (char === '!' && source[i + 1] === '[') {
			const link = matchLink(source, i + 1, refs);
			if (link) {
				flush();
				out.push({ kind: 'image', alt: link.label });
				i = link.end;
				continue;
			}
		}

		if (char === '[') {
			const link = matchLink(source, i, refs);
			if (link) {
				flush();
				out.push({ kind: 'link', href: link.href, children: parseInline(link.label, refs) });
				i = link.end;
				continue;
			}
		}

		if (char === '<') {
			const auto = AUTOLINK.exec(source.slice(i));
			if (auto) {
				flush();
				out.push({ kind: 'link', href: auto[1], children: [{ kind: 'text', text: auto[1] }] });
				i += auto[0].length;
				continue;
			}
			const tag = TAG.exec(source.slice(i));
			if (tag) {
				// Stripped, not shown. Same reason as the block-level case.
				i += tag[0].length;
				continue;
			}
		}

		if (char === '~' && source[i + 1] === '~') {
			const close = source.indexOf('~~', i + 2);
			if (close !== -1) {
				flush();
				out.push({ kind: 'strike', children: parseInline(source.slice(i + 2, close), refs) });
				i = close + 2;
				continue;
			}
		}

		if (char === '*' || char === '_') {
			const emphasis = matchEmphasis(source, i);
			if (emphasis) {
				flush();
				const children = parseInline(emphasis.body, refs);
				out.push(emphasis.strong ? { kind: 'strong', children } : { kind: 'em', children });
				i = emphasis.end;
				continue;
			}
		}

		if (char === 'h' || char === 'w') {
			const bare = BARE_URL.exec(source.slice(i));
			if (bare) {
				flush();
				const href = bare[0].startsWith('www.') ? `https://${bare[0]}` : bare[0];
				out.push({ kind: 'link', href, children: [{ kind: 'text', text: bare[0] }] });
				i += bare[0].length;
				continue;
			}
		}

		text += char;
		i += 1;
	}

	flush();
	return out;
}

interface Matched {
	label: string;
	href: string;
	end: number;
}

/**
 * `[label](href)`, `[label][ref]` and the shortcut `[ref]`. Brackets and
 * parentheses are balanced rather than matched to the first close, so a link
 * whose label contains an image, or whose target contains a parenthesis,
 * survives.
 */
function matchLink(source: string, start: number, refs: Refs): Matched | null {
	if (source[start] !== '[') return null;

	let depth = 0;
	let i = start;
	for (; i < source.length; i += 1) {
		if (source[i] === '\\') i += 1;
		else if (source[i] === '[') depth += 1;
		else if (source[i] === ']') {
			depth -= 1;
			if (depth === 0) break;
		}
	}
	if (depth !== 0) return null;

	const label = source.slice(start + 1, i);

	if (source[i + 1] === '(') {
		let parens = 1;
		let j = i + 2;
		for (; j < source.length; j += 1) {
			if (source[j] === '\\') j += 1;
			else if (source[j] === '(') parens += 1;
			else if (source[j] === ')') {
				parens -= 1;
				if (parens === 0) break;
			}
		}
		if (parens !== 0) return null;

		const inner = source.slice(i + 2, j).trim();
		const href = inner
			.replace(/\s+(["'(]).*\1?$/, '')
			.trim()
			.replace(/^<|>$/g, '');
		return { label, href: safeHref(href), end: j + 1 };
	}

	const reference = /^\[([^\]]*)\]/.exec(source.slice(i + 1));
	if (reference) {
		const key = (reference[1] || label).toLowerCase();
		const href = refs.get(key);
		return href ? { label, href: safeHref(href), end: i + 1 + reference[0].length } : null;
	}

	const shortcut = refs.get(label.toLowerCase());
	return shortcut ? { label, href: safeHref(shortcut), end: i + 1 } : null;
}

interface Emphasis {
	body: string;
	strong: boolean;
	end: number;
}

function matchEmphasis(source: string, start: number): Emphasis | null {
	const char = source[start];
	const strong = source[start + 1] === char;
	const marker = strong ? char + char : char;
	const from = start + marker.length;

	// `snake_case` is an identifier, not emphasis. Underscores only open a run
	// at a word boundary, which is the rule that keeps mono-adjacent prose intact.
	if (char === '_' && /[\w]/.test(source[start - 1] ?? '')) return null;
	if (/\s/.test(source[from] ?? '')) return null;

	let i = from;
	while (i < source.length) {
		const at = source.indexOf(marker, i);
		if (at === -1) return null;
		// A run closes on a non-space, and `**` never closes on the first `*`
		// of a longer run.
		if (/\s/.test(source[at - 1] ?? ' ')) {
			i = at + marker.length;
			continue;
		}
		if (char === '_' && /[\w]/.test(source[at + marker.length] ?? '')) {
			i = at + marker.length;
			continue;
		}
		return { body: source.slice(from, at), strong, end: at + marker.length };
	}
	return null;
}

/**
 * Schemes we will put in an `href`. Everything else becomes a fragment, which
 * renders as a link that goes nowhere rather than one that runs something.
 */
function safeHref(href: string): string {
	const trimmed = href.trim();
	if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) {
		return /^(?:https?|mailto):/i.test(trimmed) ? trimmed : '#';
	}
	return trimmed || '#';
}

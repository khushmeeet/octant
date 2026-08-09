/**
 * `CODEOWNERS`, parsed — ARCHITECTURE.md §6's ownership, and the only thing in
 * the app that decides what "yours" means.
 *
 * The file is gitignore-shaped: a pattern, then the accounts that own whatever
 * it matches. Two rules from GitHub carry all the weight, and both are easy to
 * get subtly wrong:
 *
 * 1. **The last matching rule wins**, not the most specific one. A file matched
 *    by both `*.ts` and `/src/compiler.ts` belongs to whichever was written
 *    lower in the file.
 * 2. **A pattern with no slash matches at any depth**, and one with a slash
 *    anywhere but the end is anchored to the repository root. `build/` is every
 *    `build` directory; `/build/` is the one at the top.
 *
 * It is a subset, and it says so — the same bargain the highlighter and the
 * Markdown parser make. A pattern it reads too broadly costs an indigo dot on a
 * path you do not own; one it reads too narrowly costs a dot you would have
 * wanted. Neither is a wrong answer about the code, which is why a subset is
 * tolerable here and would not be in a diff.
 */

export interface OwnerRule {
	/** As written, so a tooltip can show the reader what matched. */
	pattern: string;
	/** `@login`, `@org/team` or an email address, as written. */
	owners: string[];
}

export interface Codeowners {
	/** Where the file was found, or `null` when there is none. */
	path: string | null;
	rules: OwnerRule[];
}

export const NO_OWNERS: Codeowners = { path: null, rules: [] };

/** A line is a pattern and then its owners, with `#` starting a comment. */
export function parseCodeowners(text: string | null, path: string | null): Codeowners {
	if (!text || !path) return NO_OWNERS;

	const rules: OwnerRule[] = [];

	for (const raw of text.split('\n')) {
		const hash = raw.indexOf('#');
		const line = (hash === -1 ? raw : raw.slice(0, hash)).trim();
		if (!line) continue;

		const [pattern, ...owners] = line.split(/\s+/);
		if (!pattern) continue;

		// A pattern with no owners is how CODEOWNERS *removes* ownership from
		// something an earlier rule claimed. It is kept, empty, because last match
		// wins — dropping it would hand the path back to the rule above it.
		rules.push({ pattern, owners: owners.filter((owner) => owner.length > 0) });
	}

	return { path, rules };
}

/** Who owns a path, or an empty list. Last match wins, so this walks backwards. */
export function ownersOf(rules: readonly OwnerRule[], path: string): string[] {
	for (let i = rules.length - 1; i >= 0; i -= 1) {
		const rule = rules[i];
		if (matches(rule.pattern, path)) return rule.owners;
	}
	return [];
}

/**
 * Whether this account owns the path. Compared case-insensitively, because
 * GitHub logins are, and written with the `@` optional so a caller can pass a
 * login straight from `viewer`.
 *
 * Teams are matched only when the caller knows its own — team membership is an
 * organisation query, which is a whole surface ARCHITECTURE.md §1 puts out of
 * scope. A repository whose CODEOWNERS names only teams therefore owns nothing
 * here, which is honest: we would be guessing otherwise.
 */
export function ownedBy(rules: readonly OwnerRule[], path: string, login: string | null): boolean {
	if (!login) return false;
	const me = `@${login.replace(/^@/, '')}`.toLowerCase();
	return ownersOf(rules, path).some((owner) => owner.toLowerCase() === me);
}

/**
 * Compiled patterns, memoised across every path they are tested against — a
 * tree of four thousand rows against forty rules is a hundred and sixty
 * thousand tests, and compiling a regular expression for each of them would be
 * the slowest thing on the screen. The same move `highlight.ts` makes.
 */
const compiled = new Map<string, RegExp>();

function matches(pattern: string, path: string): boolean {
	let expression = compiled.get(pattern);
	if (!expression) {
		expression = toRegExp(pattern);
		compiled.set(pattern, expression);
	}
	return expression.test(path);
}

/**
 * gitignore semantics, as far as CODEOWNERS uses them.
 *
 * A bare pattern also matches everything *under* what it names, because a
 * pattern that names a directory owns its contents — that is the whole point of
 * writing `src/lib` rather than listing its files.
 */
function toRegExp(pattern: string): RegExp {
	// A slash anywhere but the end anchors the pattern to the repository root.
	// `*` is the sole exception: it is every path, at every depth.
	const anchored = pattern.startsWith('/') || pattern.slice(0, -1).includes('/');

	let body = pattern.replace(/^\/+/, '');
	const directory = body.endsWith('/');
	body = body.replace(/\/+$/, '');

	let source = '';
	for (let i = 0; i < body.length; i += 1) {
		const char = body[i];

		if (char === '*') {
			const double = body[i + 1] === '*';
			if (double) {
				// `**/` spans any number of directories including none; a trailing
				// `**` is simply everything from here down.
				if (body[i + 2] === '/') {
					source += '(?:.*/)?';
					i += 2;
				} else {
					source += '.*';
					i += 1;
				}
			} else {
				source += '[^/]*';
			}
			continue;
		}

		if (char === '?') {
			source += '[^/]';
			continue;
		}

		source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
	}

	const head = anchored ? '^' : '^(?:.*/)?';
	// A directory pattern owns its contents and not a file of the same name; a
	// bare one owns both itself and anything beneath it.
	const tail = directory ? '/.*$' : '(?:/.*)?$';

	return new RegExp(head + source + tail);
}

import { parseRepoRef, type RepoRef } from '$lib/source/types';

/**
 * What you typed — PLAN.md Phase 9's prefix grammar.
 *
 * One character decides what the rest of the line means:
 *
 *   (none)  everything: files, pull requests, repositories, screens
 *   /       paths in the repository you are in
 *   #       pull requests, and `#412` is the pull request itself
 *   ~       a commit — a SHA is an address, not a search
 *   @       symbols. Reserved and unimplemented — see below.
 *
 * **`/` is paths and not content, and that is a deviation worth naming.** The
 * plan wrote it as "content", which would mean GitHub's code search: a separate
 * index, on a separate rate limit, covering the default branch only and lagging
 * behind pushes (ARCHITECTURE.md §11). What `/` can narrow honestly is the file
 * index we already hold, so that is what it does. Content search stays out until
 * it can be answered without those three caveats.
 *
 * **`@` is in the grammar and does nothing**, which is what the plan asks for:
 * "leave the group in the grammar, unimplemented". There is no symbol index and
 * §11 says why — building one is the fan-out §7 rules out. A prefix that is
 * reserved and says so is better than one that quietly means something else
 * later.
 *
 * A leading space escapes the grammar, so a file that genuinely starts with `#`
 * is still findable.
 */

export type Mode = 'all' | 'path' | 'pull' | 'commit' | 'symbol';

export interface Query {
	mode: Mode;
	/** The line with its prefix removed, as typed. */
	term: string;
	/**
	 * What matching actually uses: lower case, and with whitespace dropped so
	 * `src app` finds `src/App.svelte` without teaching the ranker about words.
	 */
	needle: string;
}

const PREFIXES: Record<string, Mode> = { '/': 'path', '#': 'pull', '~': 'commit', '@': 'symbol' };

/** The footer's hint row, in the order the modes are listed above. */
export const GRAMMAR: { prefix: string; label: string }[] = [
	{ prefix: '/', label: 'path' },
	{ prefix: '#', label: 'pull' },
	{ prefix: '~', label: 'commit' },
	{ prefix: '@', label: 'symbol' }
];

export function parseQuery(raw: string): Query {
	const mode = PREFIXES[raw.charAt(0)] ?? 'all';
	const term = (mode === 'all' ? raw : raw.slice(1)).trim();

	return { mode, term, needle: term.toLowerCase().replace(/\s+/g, '') };
}

/**
 * An address, rather than a result. Typing one of these means "take me there",
 * and the palette puts them above every list — the same call the home screen's
 * filter makes about `owner/name`, for the same reason: a thing you can name
 * exactly is not a search result.
 */
export type Target =
	| { kind: 'repo'; repo: RepoRef }
	| { kind: 'pull'; repo: RepoRef; number: number }
	| { kind: 'commit'; repo: RepoRef; rev: string };

/** Seven is what git abbreviates to, and the shortest a person would paste. */
const OID = /^[0-9a-f]{7,64}$/;

/**
 * What the line addresses, if anything. `here` is the repository on screen,
 * which is what makes `#412` and a bare SHA mean something — without one they
 * are searches with no repository to search.
 *
 * A github.com URL works too: it is the thing most likely to be on the clipboard
 * when you reach for the palette.
 */
export function targets(query: Query, here: RepoRef | null): Target[] {
	const found: Target[] = [];
	const { mode, term } = query;
	if (!term) return found;

	const typed = term.replace(/^https?:\/\/github\.com\//i, '').replace(/^\/+|\/+$/g, '');

	// `owner/name`, `owner/name#412`, and github.com's own `owner/name/pull/412`.
	const [address, fragment] = typed.split('#');
	const parts = address.split('/');
	const repo = parseRepoRef(parts.slice(0, 2).join('/'));

	if (repo && mode !== 'commit') {
		const number = pullNumber(parts.length > 2 ? parts.slice(2) : [], fragment);

		if (number !== null) found.push({ kind: 'pull', repo, number });
		// The repository itself, whether or not a pull request was named: a URL
		// pasted from a review is often the way you meant to reach the repository.
		if (mode !== 'pull' && parts.length <= 2) found.push({ kind: 'repo', repo });
	}

	if (here && (mode === 'pull' || mode === 'all')) {
		// `#412` in the grammar, or `412` once `#` has already said what this is.
		const bare = mode === 'pull' ? term : fragment === undefined ? '' : fragment;
		if (/^\d+$/.test(bare)) found.push({ kind: 'pull', repo: here, number: Number(bare) });
	}

	if (here && (mode === 'commit' || mode === 'all') && OID.test(term.toLowerCase())) {
		found.push({ kind: 'commit', repo: here, rev: term.toLowerCase() });
	}

	return found;
}

/** `pull/412` as segments, or `412` after a `#`. */
function pullNumber(segments: string[], fragment: string | undefined): number | null {
	if (segments[0] === 'pull' && /^\d+$/.test(segments[1] ?? '')) return Number(segments[1]);
	if (fragment !== undefined && /^\d+$/.test(fragment)) return Number(fragment);
	return null;
}

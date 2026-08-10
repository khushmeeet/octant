import type { RefKind } from '$lib/source/refs';
import type { PullFilter } from '$lib/source/pulls';
import { resolve } from '$app/paths';
import type { RepoRef } from '$lib/source/types';
import { lineHash, type LineRange } from './lines';

/**
 * The URL scheme — PLAN.md Phase 3, which replaces Phase 0's local `active`
 * state with routing.
 *
 *   /                                   your repositories, and what needs you
 *   /{owner}/{name}                     tree at the default branch, root
 *   /{owner}/{name}/tree/{rev}          tree at a revision, root
 *   /{owner}/{name}/tree/{rev}/{path}   tree at a revision, in a directory
 *   /{owner}/{name}/blob/{rev}/{path}   a file
 *   /{owner}/{name}/blame/{rev}/{path}  a file, with the blame gutter
 *   /{owner}/{name}/log/{rev}/{path}    history, optionally scoped to a path
 *   /{owner}/{name}/commit/{oid}        one commit, and its diff
 *   /{owner}/{name}/refs                branches and tags, on one screen
 *   /{owner}/{name}/compare/{base}/{head}   what is between two revisions
 *   /{owner}/{name}/pulls               pull requests, narrowed by state
 *   /{owner}/{name}/pull/{number}       one pull request, diff first
 *
 * **The blame gutter is part of the address, not a toggle beside it.** View and
 * Blame are two ways of reading the same object, and both are things you send
 * to someone — so each has a URL, the back button steps between them, and a
 * `#L204` survives the trip. It is also how git names them.
 *
 * **The revision is exactly one path segment, percent-encoded.** Git allows a
 * slash in a ref name and so does GitHub, which is why github.com's own
 * `/tree/release/1.0/src` is ambiguous — it has to consult the ref list to know
 * where the name ends and the path begins. We would have to spend a round trip
 * on the same question. Encoding the ref answers it in the URL: `release%2F1.0`
 * is one segment, always, and the split never needs resolving.
 *
 * The cost is that a URL pasted from github.com whose branch name contains a
 * slash reads the wrong way. That is a rarer event than navigating, and it
 * fails visibly rather than silently.
 *
 * Every internal URL in the app is built here, and built with SvelteKit's
 * `resolve()` against a route ID rather than by string concatenation. So a
 * route directory that is renamed or removed fails the type check instead of
 * producing a link that 404s at runtime — and if this ever gets served under a
 * base path, that lands in one file. `resolve()` substitutes parameters
 * verbatim, so encoding stays our job and happens on the way in.
 */

export interface TreeAddress {
	repo: RepoRef;
	/** `null` means "whatever this repository's default branch is". */
	rev: string | null;
	/** Repo-relative directory, `''` at the root. */
	path: string;
}

export interface FileAddress {
	repo: RepoRef;
	/** `null` means "whatever this repository's default branch is". */
	rev: string | null;
	/** Repo-relative path to the file. */
	path: string;
	/** Which of the two file routes this is. */
	blame: boolean;
}

export interface LogAddress {
	repo: RepoRef;
	/** `null` means "whatever this repository's default branch is". */
	rev: string | null;
	/** The path history is scoped to, `''` for the whole repository. */
	path: string;
	/**
	 * The author the log is narrowed to, by login or name. A query parameter
	 * rather than a segment: it narrows what is shown of an address rather than
	 * naming a different one, and it should drop off when you walk up the path.
	 */
	author: string | null;
}

export interface CommitAddress {
	repo: RepoRef;
	/** A SHA, usually. The route accepts any revision GitHub can resolve. */
	rev: string;
}

export interface RefsAddress {
	repo: RepoRef;
	/**
	 * Which of the two kinds is shown, `null` for both. A query parameter and
	 * not a segment, because ARCHITECTURE.md §2 is explicit that branches and
	 * tags are the same object — narrowing to one is a view of that screen, not
	 * a different address, exactly as the log's author filter is.
	 */
	kind: RefKind | null;
	/**
	 * The ref whose detail is open. In the URL rather than in local state,
	 * unlike the log's cursor, because "what shipped in v1.2.0" is a thing you
	 * send someone — and it is replaced rather than pushed as you walk, the same
	 * call the file screen makes about addressing lines in turn.
	 */
	ref: RefSelection | null;
}

/**
 * Qualified with git's own prefix, so a branch and a tag of the same name are
 * two addresses rather than a coin toss.
 */
export interface RefSelection {
	kind: RefKind;
	name: string;
}

export interface CompareAddress {
	repo: RepoRef;
	/** Where the range starts. Either endpoint may be a SHA or a name. */
	base: string;
	head: string;
}

/* ----------------------------------------------------------------- home -- */

/**
 * The account screen — the two lists that are about you rather than about a
 * repository. Which of them is on screen is a query parameter and not a
 * segment, the same line the rest of this file draws: they are views of one
 * address, not two addresses.
 *
 * **Pull requests are the default**, so the app opens on the half with a
 * deadline. There was a third view that showed both lists stacked; it was the
 * default and it was wrong — a landing screen either answers a question or
 * asks you to scroll past one to find the other.
 */
export type HomeView = 'pulls' | 'repos';

export interface HomeAddress {
	view: HomeView;
}

const VIEWS: Record<string, HomeView> = { pulls: 'pulls', repos: 'repos' };

export function homeHref(options: { view?: HomeView } = {}): string {
	const base = resolve('/');
	// `pulls` is the default and is left out, so the plain URL is the one the
	// sidebar's badge points at and the one you would type.
	return options.view === 'repos' ? `${base}?view=repos` : base;
}

export function parseHome(search?: URLSearchParams): HomeAddress {
	return { view: VIEWS[search?.get('view') ?? ''] ?? 'pulls' };
}

export function repoHref(repo: RepoRef): string {
	return resolve('/[owner]/[name]', {
		owner: segment(repo.owner),
		name: segment(repo.name)
	});
}

/**
 * A revision of `null` addresses the default branch by omission rather than by
 * name — so a link to a repository's front page stays correct after its default
 * branch is renamed, and does not need the repository summary to be built.
 */
export function treeHref(repo: RepoRef, rev: string | null, path = ''): string {
	if (rev === null && !path) return repoHref(repo);

	return resolve('/[owner]/[name]/tree/[rev]/[...path]', {
		owner: segment(repo.owner),
		name: segment(repo.name),
		// A URL cannot carry an empty segment before a path, so an unnamed
		// revision is spelled the way git already spells it.
		rev: rev === null ? 'HEAD' : segment(rev),
		path: encodePath(path)
	});
}

/**
 * A file, with the blame gutter or without it, optionally addressed at a line
 * or a range. The revision is one encoded segment here for the same reason it
 * is on a tree — the split between ref and path is decided by the URL rather
 * than by a round trip.
 */
export function fileHref(
	repo: RepoRef,
	rev: string | null,
	path: string,
	options: { blame?: boolean; lines?: LineRange | null } = {}
): string {
	const params = {
		owner: segment(repo.owner),
		name: segment(repo.name),
		rev: rev === null ? 'HEAD' : segment(rev),
		path: encodePath(path)
	};

	const base = options.blame
		? resolve('/[owner]/[name]/blame/[rev]/[...path]', params)
		: resolve('/[owner]/[name]/blob/[rev]/[...path]', params);

	return base + lineHash(options.lines ?? null);
}

/**
 * History at a revision, optionally scoped to a path and narrowed to an author.
 *
 * The path is a segment and the author is a parameter, deliberately: scoping
 * the log to a directory is a different object, and narrowing it to a person is
 * a view of the same one.
 */
export function logHref(
	repo: RepoRef,
	rev: string | null,
	path = '',
	options: { author?: string | null } = {}
): string {
	const base = resolve('/[owner]/[name]/log/[rev]/[...path]', {
		owner: segment(repo.owner),
		name: segment(repo.name),
		rev: rev === null ? 'HEAD' : segment(rev),
		path: encodePath(path)
	});

	return options.author ? `${base}?author=${segment(options.author)}` : base;
}

/**
 * One commit. What `enter` opens from the log, and where the blame gutter goes.
 * `file` addresses one file's patch within it, which is how a touched file in
 * the log's detail pane links to the change it is describing.
 */
export function commitHref(
	repo: RepoRef,
	rev: string,
	options: { file?: string | null } = {}
): string {
	const base = resolve('/[owner]/[name]/commit/[rev]', {
		owner: segment(repo.owner),
		name: segment(repo.name),
		rev: segment(rev)
	});

	return options.file ? `${base}#${fileAnchor(options.file)}` : base;
}

/**
 * Branches and tags — PLAN.md Phase 6. The URL names sets rather than a type
 * (`?kind=tags`, not `?kind=tag`) because that is what it selects and what the
 * sidebar calls them.
 */
const KIND_SLUG: Record<RefKind, string> = { branch: 'branches', tag: 'tags' };
const KINDS: Record<string, RefKind> = { branches: 'branch', tags: 'tag' };

/** How a selected ref is spelled in the URL: git's prefix, then the name. */
const REF_SLUG: Record<RefKind, string> = { branch: 'heads', tag: 'tags' };
const REF_KINDS: Record<string, RefKind> = { heads: 'branch', tags: 'tag' };

export function refsHref(
	repo: RepoRef,
	options: { kind?: RefKind | null; ref?: RefSelection | null } = {}
): string {
	const base = resolve('/[owner]/[name]/refs', {
		owner: segment(repo.owner),
		name: segment(repo.name)
	});

	const search = new URLSearchParams();
	if (options.kind) search.set('kind', KIND_SLUG[options.kind]);
	if (options.ref) search.set('ref', `${REF_SLUG[options.ref.kind]}/${options.ref.name}`);

	const query = search.toString();
	return query ? `${base}?${query}` : base;
}

export function parseRefs(
	params: Record<string, string | undefined>,
	search?: URLSearchParams
): RefsAddress {
	return {
		repo: { owner: params.owner ?? '', name: params.name ?? '' },
		kind: KINDS[search?.get('kind') ?? ''] ?? null,
		ref: parseRefSelection(search?.get('ref'))
	};
}

function parseRefSelection(value: string | null | undefined): RefSelection | null {
	if (!value) return null;
	// The prefix is everything before the first slash; the name keeps the rest,
	// because `heads/release/1.0` is a branch called `release/1.0`.
	const cut = value.indexOf('/');
	if (cut === -1) return null;

	const kind = REF_KINDS[value.slice(0, cut)];
	const name = value.slice(cut + 1);
	return kind && name ? { kind, name } : null;
}

/**
 * `base...head`, as two encoded segments rather than github.com's single
 * `base...head` one. Same rule as the revision: a ref name may contain a slash
 * and a triple dot is a legal filename, so putting the split in the URL's own
 * structure is the only version that never needs resolving.
 *
 * The Refs screen always addresses this with the two commit SHAs it has just
 * finished resolving, which makes the answer permanent — a tag's changelog is
 * computed once, ever. The route accepts names too, for a URL typed by hand.
 */
export function compareHref(repo: RepoRef, base: string, head: string): string {
	return resolve('/[owner]/[name]/compare/[base]/[head]', {
		owner: segment(repo.owner),
		name: segment(repo.name),
		base: segment(base),
		head: segment(head)
	});
}

export function parseCompare(params: Record<string, string | undefined>): CompareAddress {
	return {
		repo: { owner: params.owner ?? '', name: params.name ?? '' },
		base: params.base ?? '',
		head: params.head ?? ''
	};
}

/* --------------------------------------------------------------- review -- */

/**
 * Pull requests — PLAN.md Phase 7. The list is `pulls` and one of them is
 * `pull/{number}`, naming the object rather than the screen, the same way
 * `commit/{rev}` does. The sidebar item is called Review because that is the
 * question it answers; the URL is called `pull` because that is what is at it.
 */
export interface PullsAddress {
	repo: RepoRef;
	/** Which states are shown. A view of one address, so a query parameter. */
	filter: PullFilter;
}

/**
 * Which diff the Review screen is showing. `since` is the default wherever
 * there is a recorded review to measure from — PLAN.md Phase 7 is explicit that
 * it is the default *view*, not an option — and `all` is the whole pull
 * request, which is what a first pass wants and what a second pass falls back
 * to when nothing has been recorded yet.
 */
export type PullView = 'since' | 'all';

export interface PullAddress {
	repo: RepoRef;
	number: number;
	/** `null` means "whichever is right", which the screen decides from the record. */
	view: PullView | null;
}

const FILTERS: Record<string, PullFilter> = {
	open: 'open',
	merged: 'merged',
	closed: 'closed',
	all: 'all'
};

export function pullsHref(repo: RepoRef, options: { filter?: PullFilter } = {}): string {
	const base = resolve('/[owner]/[name]/pulls', {
		owner: segment(repo.owner),
		name: segment(repo.name)
	});

	// `open` is the default and is left out, so the plain URL is the one you
	// arrive at from the sidebar and the one you would type.
	return options.filter && options.filter !== 'open' ? `${base}?state=${options.filter}` : base;
}

export function parsePulls(
	params: Record<string, string | undefined>,
	search?: URLSearchParams
): PullsAddress {
	return {
		repo: { owner: params.owner ?? '', name: params.name ?? '' },
		filter: FILTERS[search?.get('state') ?? ''] ?? 'open'
	};
}

export function pullHref(
	repo: RepoRef,
	number: number,
	options: { view?: PullView | null; file?: string | null } = {}
): string {
	const base = resolve('/[owner]/[name]/pull/[number]', {
		owner: segment(repo.owner),
		name: segment(repo.name),
		number: String(number)
	});

	const query = options.view ? `?view=${options.view}` : '';
	return options.file ? `${base}${query}#${fileAnchor(options.file)}` : `${base}${query}`;
}

export function parsePull(
	params: Record<string, string | undefined>,
	search?: URLSearchParams
): PullAddress {
	const view = search?.get('view');
	return {
		repo: { owner: params.owner ?? '', name: params.name ?? '' },
		// A number the route could not parse is 0, which no pull request is, so
		// the screen reports it as not found rather than asking GitHub about it.
		number: Number.parseInt(params.number ?? '', 10) || 0,
		view: view === 'since' || view === 'all' ? view : null
	};
}

/** The id a file's patch carries on the commit screen, and the hash that finds it. */
export function fileAnchor(path: string): string {
	return `f-${segment(path)}`;
}

/** The path an anchor names, or `null` if the hash is not one. */
export function parseFileAnchor(hash: string): string | null {
	if (!hash.startsWith('#f-')) return null;
	try {
		return decodeURIComponent(hash.slice(3));
	} catch {
		// A hand-edited hash. Not an address, so not an error either.
		return null;
	}
}

/** Read a log address out of SvelteKit's params and the query string. */
export function parseLog(
	params: Record<string, string | undefined>,
	search?: URLSearchParams
): LogAddress {
	const rev = params.rev ?? null;
	return {
		repo: { owner: params.owner ?? '', name: params.name ?? '' },
		rev: rev === null || rev === 'HEAD' ? null : rev,
		path: cleanPath(params.path ?? ''),
		author: search?.get('author') || null
	};
}

export function parseCommit(params: Record<string, string | undefined>): CommitAddress {
	return {
		repo: { owner: params.owner ?? '', name: params.name ?? '' },
		rev: params.rev ?? ''
	};
}

/** Read a file address out of SvelteKit's params. Both file routes land here. */
export function parseFile(params: Record<string, string | undefined>, blame: boolean): FileAddress {
	const rev = params.rev ?? null;
	return {
		repo: { owner: params.owner ?? '', name: params.name ?? '' },
		rev: rev === null || rev === 'HEAD' ? null : rev,
		path: cleanPath(params.path ?? ''),
		blame
	};
}

/** The directory containing `path`, or `null` at the repository root. */
export function parentPath(path: string): string | null {
	if (!path) return null;
	const cut = path.lastIndexOf('/');
	return cut === -1 ? '' : path.slice(0, cut);
}

/**
 * Read an address out of SvelteKit's params. Both tree routes land here, so
 * the two shapes are reconciled in one place. SvelteKit has already decoded
 * each segment, which is what makes the encoded revision come back whole.
 */
export function parseTree(params: Record<string, string | undefined>): TreeAddress {
	const rev = params.rev ?? null;
	return {
		repo: { owner: params.owner ?? '', name: params.name ?? '' },
		rev: rev === null || rev === 'HEAD' ? null : rev,
		path: cleanPath(params.path ?? '')
	};
}

export function cleanPath(path: string): string {
	return path.replace(/^\/+|\/+$/g, '');
}

/* ------------------------------------------------------------- link out -- */

/**
 * github.com is a companion, not a competitor — ARCHITECTURE.md §1 — so what is
 * out of scope, or not built yet, links out rather than pretending.
 */

/** Where the file screen sends you when it cannot render what it holds. */
export function githubBlobUrl(repo: RepoRef, rev: string, path: string): string {
	return `${slug(repo)}/blob/${segment(rev)}/${encodePath(path)}`;
}

/**
 * The bytes themselves. ARCHITECTURE.md §4 names this as the fallback for a
 * blob the API will not send inline, and §11 as the first step before "too
 * large" — so it is both the Raw verb and the way out of a binary file.
 */
export function rawUrl(repo: RepoRef, rev: string, path: string): string {
	return `https://raw.githubusercontent.com/${segment(repo.owner)}/${segment(repo.name)}/${segment(rev)}/${encodePath(path)}`;
}

/**
 * One commit on github.com. The commit screen renders the patch itself now, so
 * this is only the way out when GitHub declined to send one — a binary blob, or
 * a diff past the cap it will inline (ARCHITECTURE.md §11).
 */
export function githubCommitUrl(repo: RepoRef, oid: string): string {
	return `${slug(repo)}/commit/${segment(oid)}`;
}

/** A download, so it is instant by definition and belongs in the verb row. */
export function archiveUrl(repo: RepoRef, rev: string): string {
	return `${slug(repo)}/archive/${segment(rev)}.zip`;
}

/**
 * The same range on github.com. The compare screen renders it itself now, so
 * this is the way out when GitHub declined to inline the patches — a range past
 * the cap it will send (ARCHITECTURE.md §11).
 */
export function githubCompareUrl(repo: RepoRef, base: string, head: string): string {
	return `${slug(repo)}/compare/${segment(base)}...${segment(head)}`;
}

/**
 * A pull request's conversation. We render its diff, its threads and its checks
 * — but writing a comment is a write, and ARCHITECTURE.md §1 puts every write
 * out of scope for v1 (§12 asks whether review comments should be the
 * exception; until that is answered, replying is a link out rather than a form
 * that does not work).
 */
export function githubPullUrl(repo: RepoRef, number: number, tab = ''): string {
	return `${slug(repo)}/pull/${number}${tab}`;
}

/* ------------------------------------------------------------- private -- */

function slug(repo: RepoRef): string {
	return `https://github.com/${segment(repo.owner)}/${segment(repo.name)}`;
}

function segment(value: string): string {
	return encodeURIComponent(value);
}

/** Each segment encoded, the separators left alone. */
function encodePath(path: string): string {
	return cleanPath(path).split('/').map(segment).join('/');
}

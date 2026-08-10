import { session } from '$lib/auth/token.svelte';
import {
	commitHref,
	fileHref,
	homeHref,
	logHref,
	pullHref,
	pullsHref,
	refsHref,
	repoHref,
	treeHref
} from '$lib/nav/paths';
import { recent } from '$lib/nav/recent.svelte';
import { GitHubSource, type InboxPull, type RepoRef, type ViewerRepo } from '$lib/source';
import { prefetch } from '$lib/sync/prefetch';
import { resource } from '$lib/sync/resource.svelte';
import { agoAt } from '$lib/ui/format';
import { panel } from '$lib/ui/panel.svelte';
import { theme } from '$lib/ui/theme.svelte';
import { reposSeen } from '$lib/visits/repos.svelte';
import { inboxSeen } from '$lib/visits/reviews.svelte';
import { targets, type Query, type Target } from './grammar';
import { settleGroups } from './groups';
import { best, bestOf, match, type Match } from './rank';
import type { Group, Result } from './types';

/**
 * What the palette shows — PLAN.md Phase 9's result groups.
 *
 * Every list here is one the app already holds: the account's repositories and
 * its pull requests are the home screen's two reads, the visit records are
 * Phase 8's, the recent list is what the background tick pins. The only read
 * this phase adds is the path index, and it is asked for on the first keystroke
 * rather than on open — so ⌘K followed by `esc` costs nothing at all, and the
 * one request it can make is filed permanently.
 *
 * **The order of the groups is fixed.** They filter and re-rank inside
 * themselves and never move: addresses, then what moved while you were away,
 * then files, pull requests, repositories, screens. A palette whose groups
 * reorder as you type has to be read; one whose geography holds still can be
 * aimed at, which is the same argument the right panel's three blocks make.
 *
 * Create during component initialisation — the resources and visit scans own
 * `$effect`s. The palette's overlay is only mounted while it is open, so all of
 * this exists for as long as the palette is on screen and not a moment longer.
 */

export interface PaletteContext {
	/** The repository on screen, `null` above one. */
	repo: RepoRef | null;
	/** The revision the URL names, `null` when it names the default branch. */
	rev: string | null;
	query: Query;
}

export interface PaletteResults {
	readonly groups: Group[];
	/** Every row in group order. What the cursor walks and `enter` opens. */
	readonly flat: Result[];
	/** A list this depends on has not arrived. Never true over rows. */
	readonly loading: boolean;
	/** Files in the index, or `null` when there is no repository to index. */
	readonly indexed: number | null;
	readonly indexing: boolean;
	/** GitHub sent part of the tree — the index is incomplete, and says so. */
	readonly truncated: boolean;
}

/** Rows per group. Enough to answer, few enough that the list stays scannable. */
const CAP = 6;
/** Files earn a longer list: it is the group the phase exists for. */
const FILE_CAP = 8;

export function paletteResults(input: () => PaletteContext): PaletteResults {
	const login = $derived(session.viewer?.login ?? null);
	const repo = $derived(input().repo);
	const rev = $derived(input().rev);
	const query = $derived(input().query);
	const needle = $derived(query.needle);
	const mode = $derived(query.mode);

	/**
	 * The three reads. All are cached and none is new: the summary is what every
	 * repository screen has already paid for, and the two account lists are the
	 * home screen's — on the freshness windows in `policy.ts`, opening the
	 * palette twice in a minute costs nothing the second time.
	 */
	const summary = resource(() => (repo ? GitHubSource.getRepo(repo) : null));
	const repos = resource(() => (login ? GitHubSource.getViewerRepos(login) : null));
	const inbox = resource(() => (login ? GitHubSource.getViewerPulls(login) : null));

	const seen = reposSeen();
	const reviewed = inboxSeen();

	$effect(() => {
		void recent.hydrate();
	});

	/**
	 * Where the index is read. A commit SHA if we know one, because that is what
	 * makes it permanent; the URL's revision when it names one, because that is
	 * the tree you are looking at.
	 */
	const indexRev = $derived(rev ?? summary.data?.head?.oid ?? summary.data?.defaultBranch ?? null);

	/** The index is paid for by the first keystroke, and never by opening. */
	const wantsFiles = $derived(mode === 'path' || (mode === 'all' && needle.length > 0));

	const paths = resource(() =>
		repo && indexRev && wantsFiles ? GitHubSource.getPaths(repo, indexRev) : null
	);

	/* ------------------------------------------------------------ groups -- */

	const address = $derived.by<Result[]>(() => targets(query, repo).map(addressRow));

	const since = $derived.by<Result[]>(() => {
		if (mode !== 'all') return [];

		const movedPulls = (inbox.data?.items ?? []).filter(
			(pull) => reviewed.stateOf(pull.repo, pull.number, pull.headRefOid) === 'moved'
		);
		const movedRepos = (repos.data?.items ?? []).filter(
			(entry) => seen.stateOf(entry.nameWithOwner, entry.pushedAt) === 'moved'
		);

		return [
			...bestOf(movedPulls, CAP, (pull) => pullMatch(pull, needle)).map(({ item, match }) =>
				pullRow(item, match, 'pushed since you reviewed it')
			),
			...best(movedRepos, needle, (entry) => entry.nameWithOwner, CAP).map(({ item, match }) =>
				repoRow(item, match, 'pushed since you were here')
			)
		]
			.map((row) => ({ ...row, accent: true }))
			.slice(0, CAP);
	});

	const files = $derived.by<Result[]>(() => {
		if (!wantsFiles || !repo) return [];

		const index = paths.data;
		if (!index || !needle) return [];

		// Files and directories are ranked separately and merged by score, so a
		// directory only outranks a file by being the better match rather than by
		// which list it happened to be in.
		return [
			...best(index.files, needle, identity, FILE_CAP).map((hit) => ({ ...hit, dir: false })),
			...best(index.dirs, needle, identity, FILE_CAP).map((hit) => ({ ...hit, dir: true }))
		]
			.sort((a, b) => b.match.score - a.match.score)
			.slice(0, FILE_CAP)
			.map(({ item, match, dir }) => fileRow(repo, rev, item, match, dir));
	});

	const pulls = $derived.by<Result[]>(() => {
		if (mode !== 'all' && mode !== 'pull') return [];

		return bestOf(inbox.data?.items ?? [], CAP, (pull) => pullMatch(pull, needle)).map(
			({ item, match }) => pullRow(item, match, item.requested ? 'your review was asked for' : null)
		);
	});

	const recents = $derived.by<Result[]>(() => {
		if (mode !== 'all') return [];

		return best(recent.all, needle, (entry) => `${entry.owner}/${entry.name}`, CAP).map(
			({ item, match }) => ({
				id: `repo:${item.owner}/${item.name}`,
				icon: 'folder' as const,
				label: `${item.owner}/${item.name}`,
				hits: match.hits,
				mono: true,
				note: `${agoAt(item.at)} ago`,
				href: repoHref(item),
				warm: () => prefetch(GitHubSource.getRepo(item)),
				title: `Browse ${item.owner}/${item.name}`
			})
		);
	});

	const repositories = $derived.by<Result[]>(() => {
		// With nothing typed the recent list is the better answer, and a dump of
		// fifty repositories under it is a list nobody reads.
		if (mode !== 'all' || !needle) return [];

		return best(repos.data?.items ?? [], needle, (entry) => entry.nameWithOwner, CAP).map(
			({ item, match }) => repoRow(item, match, null)
		);
	});

	const screens = $derived.by<Result[]>(() => {
		if (mode !== 'all') return [];

		const rows: Result[] = [
			{
				id: 'screen:home',
				icon: 'pr',
				label: 'Home',
				meta: 'your pull requests and repositories',
				href: homeHref()
			}
		];

		if (repo) {
			const where = `${repo.owner}/${repo.name}`;
			rows.push(
				{
					id: 'screen:tree',
					icon: 'folder',
					label: 'Tree',
					meta: where,
					title: 'Browse the files',
					href: treeHref(repo, rev),
					warm: () => prefetch(GitHubSource.getRepo(repo))
				},
				{
					id: 'screen:log',
					icon: 'commit',
					label: 'Log',
					meta: where,
					title: 'What has landed here',
					href: logHref(repo, rev, '')
				},
				{
					id: 'screen:refs',
					icon: 'branch',
					label: 'Refs',
					meta: where,
					title: 'Branches and tags',
					href: refsHref(repo)
				},
				{
					id: 'screen:review',
					icon: 'pr',
					label: 'Review',
					meta: where,
					title: 'Pull requests still in flight',
					href: pullsHref(repo)
				}
			);
		}

		return best(rows, needle, (row) => row.label, rows.length).map(({ item, match }) => ({
			...item,
			hits: match.hits
		}));
	});

	const commands = $derived.by<Result[]>(() => {
		if (mode !== 'all') return [];

		const rows: Result[] = [
			{
				id: 'command:theme',
				icon: 'code',
				label: 'Switch theme',
				meta: `to ${theme.current === 'dark' ? 'light' : 'dark'}`,
				run: () => theme.toggle()
			},
			{
				id: 'command:panel',
				icon: 'panel',
				label: 'Toggle the context panel',
				meta: panel.open ? 'hide it' : 'show it',
				run: () => panel.toggle()
			}
		];

		return best(rows, needle, (row) => row.label, rows.length).map(({ item, match }) => ({
			...item,
			hits: match.hits
		}));
	});

	/* ------------------------------------------------------------ assemble -- */

	const groups = $derived.by<Group[]>(() =>
		settleGroups([
			{ id: 'address', label: 'Go to', results: address },
			{ id: 'since', label: 'Since your last visit', results: since },
			{ id: 'files', label: 'Files', results: files, note: filesNote() },
			{ id: 'pulls', label: 'Pull requests', results: pulls },
			{ id: 'recent', label: 'Recent', results: recents },
			{ id: 'repos', label: 'Repositories', results: repositories },
			{ id: 'screens', label: 'Screens', results: screens },
			{
				id: 'symbols',
				label: 'Symbols',
				results: [],
				// PLAN.md Phase 9 leaves this in the grammar and unimplemented, and
				// ARCHITECTURE.md §11 says why: an index of a repository's symbols is
				// the fan-out §7 rules out, and GitHub has no symbol API to borrow.
				note: mode === 'symbol' ? 'No symbol index. It needs a local git sidecar — §11.' : undefined
			},
			{ id: 'commands', label: 'Commands', results: commands }
		])
	);

	function filesNote(): string | undefined {
		if (mode !== 'path') return undefined;
		if (!repo) return 'Open a repository to search its files.';
		if (paths.error) return paths.error.message;
		if (!needle) return paths.data ? undefined : 'Reading the index…';
		return undefined;
	}

	return {
		get groups() {
			return groups;
		},
		get flat() {
			return groups.flatMap((group) => group.results);
		},
		get loading() {
			// Every list here is cached, so this is an IndexedDB read and not a
			// network one — but it is not instantaneous, and "no match" shown for a
			// frame before the answer arrives is a wrong answer rather than a slow
			// one. The palette says nothing until it has something to say.
			return inbox.loading || repos.loading || paths.loading;
		},
		get indexed() {
			return paths.data ? paths.data.files.length : null;
		},
		get indexing() {
			return paths.loading;
		},
		get truncated() {
			return paths.data?.truncated ?? false;
		}
	};
}

/* ---------------------------------------------------------------- rows -- */

function identity(value: string): string {
	return value;
}

function addressRow(target: Target): Result {
	const where = `${target.repo.owner}/${target.repo.name}`;

	if (target.kind === 'pull') {
		return {
			id: `pull:${where}#${target.number}`,
			icon: 'pr',
			label: `${where}#${target.number}`,
			mono: true,
			note: 'pull request',
			href: pullHref(target.repo, target.number),
			warm: () => prefetch(GitHubSource.getPull(target.repo, target.number)),
			title: `Review ${where}#${target.number}`
		};
	}

	if (target.kind === 'commit') {
		return {
			id: `commit:${where}:${target.rev}`,
			icon: 'commit',
			label: target.rev.slice(0, 12),
			mono: true,
			note: 'commit',
			href: commitHref(target.repo, target.rev),
			warm: () => prefetch(GitHubSource.getCommit(target.repo, target.rev)),
			title: `Open commit ${target.rev} in ${where}`
		};
	}

	return {
		id: `repo:${where}`,
		icon: 'link',
		label: where,
		mono: true,
		note: 'repository',
		href: repoHref(target.repo),
		warm: () => prefetch(GitHubSource.getRepo(target.repo)),
		// The home screen's address row says the same thing, and it is the reason
		// both exist: a repository you can read but are not a member of is on no
		// list GitHub will hand us.
		title: `Open ${where} — anything this token can read`
	};
}

function repoRow(entry: ViewerRepo, hit: Match, note: string | null): Result {
	return {
		id: `repo:${entry.nameWithOwner}`,
		icon: 'folder',
		label: entry.nameWithOwner,
		hits: hit.hits,
		mono: true,
		meta: entry.description ?? '',
		note: note ?? undefined,
		href: repoHref(entry),
		warm: () => prefetch(GitHubSource.getRepo(entry)),
		title: entry.description ?? `Browse ${entry.nameWithOwner}`
	};
}

function pullRow(pull: InboxPull, hit: Match, note: string | null): Result {
	return {
		id: `pull:${pull.nameWithOwner}#${pull.number}`,
		icon: 'pr',
		label: pull.title,
		hits: hit.hits,
		meta: `${pull.nameWithOwner}#${pull.number}`,
		note: note ?? undefined,
		href: pullHref(pull.repo, pull.number),
		warm: () => prefetch(GitHubSource.getPull(pull.repo, pull.number)),
		title: `${pull.nameWithOwner}#${pull.number} ${pull.title}`
	};
}

/**
 * A path opens at the revision the URL names — not at the one the index was
 * read at. They are usually the same commit; where they differ, the URL's is
 * the one you are reading, and a link that quietly re-pinned you to a SHA would
 * be a different address than the tree beside it.
 */
function fileRow(
	repo: RepoRef,
	rev: string | null,
	path: string,
	hit: Match,
	dir: boolean
): Result {
	return {
		id: `${dir ? 'dir' : 'file'}:${path}`,
		icon: dir ? 'folder' : 'file',
		label: path,
		hits: hit.hits,
		mono: true,
		note: dir ? 'directory' : undefined,
		href: dir ? treeHref(repo, rev, path) : fileHref(repo, rev, path),
		// `HEAD` is what the screen this opens will ask with, so the warmed key is
		// the key it reads — an unnamed default branch costs no round trip to name.
		warm: () => {
			const at = rev ?? 'HEAD';
			if (dir) prefetch(GitHubSource.getTree(repo, at, path));
			else prefetch(GitHubSource.getFile(repo, at, path));
		},
		title: path
	};
}

/**
 * A pull request is found by its title far more often than by its number, so
 * the title is what carries the highlight — and the identifier is a second,
 * quieter attempt, because `#412` and `owner/name` are also how you look for
 * one. Two tries rather than one composite string: a match spanning both would
 * highlight characters the row does not show.
 */
function pullMatch(pull: InboxPull, needle: string): Match | null {
	const onTitle = match(pull.title, needle);
	if (onTitle) return onTitle;

	const onId = match(`${pull.nameWithOwner}#${pull.number}`, needle);
	return onId ? { score: onId.score - 20, hits: [] } : null;
}

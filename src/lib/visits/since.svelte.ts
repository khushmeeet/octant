import { session } from '$lib/auth/token.svelte';
import { GitHubSource, type ChangedFile, type RepoRef } from '$lib/source';
import { resource } from '$lib/sync/resource.svelte';
import { agoAt, count } from '$lib/ui/format';
import type { PanelEntry } from '$lib/ui/types';
import { NO_OWNERS, ownedBy, parseCodeowners } from './owners';
import { byPath, spread } from './reach';
import { repoMemory, type RepoMemory } from './repo.svelte';

/**
 * "Since your last visit" — PLAN.md Phase 8, and the feature github.com has no
 * equivalent for.
 *
 * The whole thing is **one comparison**. We wrote down the head SHA you last
 * saw; GitHub will diff any two SHAs; so `compare(lastSeenSha, head)` answers
 * every question the first sidebar block asks and every dot on the screen, from
 * a single read that is addressed by two commit SHAs and therefore permanent.
 * ARCHITECTURE.md §3 names this as the reason the architecture is viable
 * without a server, and §6 as the layer that is entirely ours.
 *
 * Three things follow from it being one read:
 *
 * - **Rows are free.** A dot on a directory is a prefix test against the paths
 *   the comparison already listed, not a query. ARCHITECTURE.md §7's hard rule
 *   is that no operation may fan out across a repository, and a per-row read
 *   would have been exactly that, on the widest screen in the app.
 * - **It costs nothing when nothing happened.** No record, or a head that has
 *   not moved, and there is no request at all — cost is proportional to change,
 *   not to navigation.
 * - **The force-push answer comes with it.** GitHub reports a range as `ahead`
 *   when the head descends from the base and `diverged` when it does not, which
 *   is precisely ARCHITECTURE.md §6's descendant test. Phase 7 found this for
 *   pull requests; it is the same word for a rewritten default branch, and it
 *   needs no second query to go stale or disagree.
 *
 * Ownership rides alongside: `CODEOWNERS` is one query, cached long, and read
 * only once there is a delta to attribute — so a repository nobody has left is
 * a repository we never ask about.
 */

export interface SinceAddress {
	repo: RepoRef;
	/** The revision the screen is at. What `CODEOWNERS` is read from. */
	rev: string;
	/** The repository's current HEAD, once the summary has answered. */
	head: string | null;
}

/** What a dot on a row means, in the row's own terms. */
export interface RowMark {
	/** Files changed inside this path since your last visit. Always at least 1. */
	files: number;
	/** `CODEOWNERS` says one of them is yours. */
	owned: boolean;
	/** The tooltip, and the dot's accessible name. */
	title: string;
}

/**
 * Six members, and every one of them has a caller — the same call `Source` made
 * about declaring nine methods rather than the fourteen the architecture named.
 * The comparison holds far more than this (its commits, its authors, its
 * truncation flag, the parsed `CODEOWNERS`); none of it is exposed until a
 * screen asks, because an interface that answers questions nobody is asking is
 * an interface nobody can safely change.
 */
export interface Since {
	/** Something landed. `false` covers a first visit and an unmoved head alike. */
	readonly any: boolean;
	/** `2d` — what the panel heading is suffixed with. */
	readonly label: string | undefined;
	/**
	 * Every commit in the range, by SHA. What lets a screen that holds a
	 * path-scoped list of commits cut it down to the ones that landed since —
	 * the comparison lists its commits and its files but never says which
	 * touched which, so the intersection has to be taken by whoever has both.
	 */
	readonly commitOids: readonly string[];
	/** What landed in exactly this file, if anything. */
	fileChange(path: string): ChangedFile | undefined;
	/**
	 * The row marker for a path, or `null` when nothing landed inside it. One
	 * place, so every list in the app says the same sentence about a dot.
	 */
	mark(path: string): RowMark | null;
	/** The first right-panel block, so every screen says it the same way. */
	readonly rows: PanelEntry[];
}

export function sinceLastVisit(input: () => SinceAddress | null): Since {
	const at = $derived(input());

	/**
	 * Resolved in an effect rather than a derivation, because `repoMemory` is a
	 * registry that *creates* the record's state on first ask — and a derivation
	 * is the wrong place to do anything but compute. `.pre` so the resources
	 * below see it in the same flush.
	 */
	let memory = $state<RepoMemory | null>(null);
	let held: string | null = null;

	$effect.pre(() => {
		const id = at ? `${at.repo.owner}/${at.repo.name}` : null;
		if (id === held) return;
		held = id;
		memory = at ? repoMemory(at.repo) : null;
	});

	const lastSeenSha = $derived(memory?.lastSeenSha ?? null);

	/**
	 * The comparison, and the only network cost of the whole feature. Absent
	 * unless there is a record, a head, and daylight between them — which is why
	 * a first visit and a quiet repository both cost nothing.
	 */
	const range = $derived(
		at && lastSeenSha && at.head && lastSeenSha !== at.head
			? GitHubSource.getCompare(at.repo, lastSeenSha, at.head)
			: null
	);

	const compare = resource(() => range);

	/**
	 * Read beside the comparison rather than after it: both are known to be
	 * wanted the moment the record says the head has moved, so chaining them
	 * would be a waterfall for no information — the same call `TreeScreen` makes
	 * about its two queries.
	 */
	const owners = resource(() => (at && range ? GitHubSource.getOwners(at.repo, at.rev) : null));

	// Recording is what makes the *next* visit meaningful, and it is deliberately
	// not conditional on any of the above: a first visit records too, or a first
	// visit would never become a second one.
	$effect(() => {
		if (at?.head) memory?.see(at.head);
	});

	const files = $derived(compare.data?.files ?? []);

	const codeowners = $derived(
		owners.data ? parseCodeowners(owners.data.text, owners.data.path) : NO_OWNERS
	);

	const login = $derived(session.viewer?.login ?? null);

	const ownedFiles = $derived(
		codeowners.rules.length === 0
			? []
			: files.filter((file) => ownedBy(codeowners.rules, file.path, login))
	);

	/**
	 * Every changed path *and every directory above it*, so a dot on a row is a
	 * `Set` lookup rather than a scan of three hundred paths per row. Built once
	 * per comparison; a four-thousand-row tree then costs four thousand hashes.
	 */
	const reach = $derived(spread(files));
	const ownedReach = $derived(spread(ownedFiles));

	const changes = $derived(byPath(files));

	const commitOids = $derived((compare.data?.commits ?? []).map((commit) => commit.oid));

	const any = $derived((compare.data?.totalCommits ?? 0) > 0 || files.length > 0);

	/** Whether `CODEOWNERS` gives this path — or anything under it — to you. */
	function owned(path: string): boolean {
		return path === '' ? ownedFiles.length > 0 : ownedReach.has(path);
	}

	const rows = $derived.by<PanelEntry[]>(() => {
		if (!memory?.ready) return [{ key: 'Last visit', value: '—' }];

		if (!memory.known) {
			// A first visit is a real answer, and a better one than three dashes:
			// it says the feature is working and has nothing to report yet.
			return [{ key: 'Last visit', value: 'First' }];
		}

		const last: PanelEntry = {
			key: 'Last visit',
			value: memory.lastSeenAt ? agoAt(memory.lastSeenAt) : '—'
		};

		if (!range) return [{ key: 'Commits since', value: '0' }, last];

		if (compare.loading && !compare.data) {
			return [{ key: 'Commits since', value: '…' }, last];
		}

		const total = compare.data?.totalCommits ?? 0;
		const entries: PanelEntry[] = [
			{
				key: 'Commits since',
				value: compare.data ? `${count(total)}${compare.data.truncated ? '+' : ''}` : '—',
				accent: total > 0
			},
			{ key: 'Files since', value: compare.data ? count(files.length) : '—' }
		];

		// A repository with no CODEOWNERS gets a dash rather than a zero: nobody
		// owns anything here, which is not the same as you owning none of it.
		entries.push({
			key: 'In paths you own',
			value: codeowners.rules.length === 0 ? '—' : count(ownedFiles.length),
			accent: ownedFiles.length > 0
		});

		// The same meaning Phase 7 gave amber, applied to the branch rather than to
		// a pull request: DESIGN.md §3 spends it on "a force push you have not
		// seen", and a rewritten default branch is one.
		if (compare.data?.status === 'diverged') {
			entries.push({ key: 'Force pushed', value: 'Yes', warn: true });
		}

		entries.push(last);
		return entries;
	});

	return {
		get any() {
			return any;
		},
		get label() {
			const when = memory?.lastSeenAt;
			return when ? agoAt(when) : undefined;
		},
		get commitOids() {
			return commitOids;
		},
		fileChange(path) {
			return changes.get(path);
		},
		mark(path) {
			const changed = path === '' ? files.length : (reach.get(path) ?? 0);
			if (changed === 0) return null;

			const mine = owned(path);
			return {
				files: changed,
				owned: mine,
				title:
					`${changed} file${changed === 1 ? '' : 's'} changed since your last visit` +
					(mine ? ' · you own this path' : '')
			};
		},
		get rows() {
			return rows;
		}
	};
}

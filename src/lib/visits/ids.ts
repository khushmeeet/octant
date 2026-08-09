import type { RepoRef } from '$lib/source/types';

/**
 * The `visits` object-id scheme — ARCHITECTURE.md §6.
 *
 * One file, for the same reason `keys.ts` is one file: an id computed at a call
 * site is an id that eventually stops matching the one the other screen wrote.
 * These are *not* cache keys — nothing here is ever fetched — so they live
 * beside the feature that reads them rather than in `store/`.
 *
 * Ids are hierarchical because `visitsUnder(prefix)` is a prefix scan: a screen
 * that needs one record reads one, and a screen that needs a set of them reads
 * the set in a single transaction rather than a round trip per row.
 *
 *   repo:{owner}/{name}                  when you last had this repository open,
 *                                        and what its HEAD was at the time
 *   pull:{owner}/{name}:{n}              when you last reviewed, and at what head
 *   pull:{owner}/{name}:{n}:f:{path}     when you marked one file viewed
 *
 * **There is one record per repository, not one per directory.** ARCHITECTURE.md
 * §6 reads the repository's delta and then *projects* it onto rows — "a dot if
 * the directory contains such a commit" — so a directory needs no record of its
 * own, and the whole screen is answered by the one comparison the repository
 * record already justifies. A record per path would have meant a comparison per
 * directory navigated, each against a different base, sharing nothing.
 */

export function repoVisitId(repo: RepoRef): string {
	return `repo:${repo.owner}/${repo.name}`;
}

export function pullVisitId(repo: RepoRef, number: number): string {
	return `pull:${repo.owner}/${repo.name}:${number}`;
}

/** Every pull-request record of one repository. The Review list's prefix scan. */
export function pullVisitPrefix(repo: RepoRef): string {
	return `pull:${repo.owner}/${repo.name}:`;
}

/**
 * `:f:` rather than `:`, so the file records of #12 are not also the records of
 * #120 — a prefix read has no other way to know where the number ends. It is
 * also what lets `pullVisitPrefix` tell a pull request's own record from its
 * files': the first is a bare number, the second is not.
 */
export function fileVisitPrefix(repo: RepoRef, number: number): string {
	return `${pullVisitId(repo, number)}:f:`;
}

/**
 * The pull request a `pullVisitPrefix` row belongs to, or `null` if the row is
 * one of its files rather than the pull request itself.
 */
export function pullNumberFrom(id: string, prefix: string): number | null {
	const rest = id.slice(prefix.length);
	return /^\d+$/.test(rest) ? Number(rest) : null;
}

import { logAuthor, type LogCommit } from '$lib/source';

/**
 * Who has been committing, among the commits loaded — PLAN.md Phase 5's author
 * filter, which the sidebar drives.
 *
 * The count is the honest part. GitHub can filter history by author server-side,
 * but only by node ID, and turning a login into one costs a round trip before
 * the log can even be asked for — a waterfall on the screen, for a filter, in an
 * architecture whose first rule is that navigation never waits (§4). So the
 * filter narrows what is loaded, instantly, and every place it appears says how
 * much that is: the tally here, and "of N loaded" on the screen. A filter that
 * says what it covers is honest; one that implies it has seen the whole history
 * is not.
 */

export interface AuthorTally {
	name: string;
	count: number;
}

export function tallyAuthors(commits: readonly LogCommit[]): AuthorTally[] {
	const counts = new Map<string, number>();

	for (const commit of commits) {
		const name = logAuthor(commit);
		counts.set(name, (counts.get(name) ?? 0) + 1);
	}

	return [...counts]
		.map(([name, count]) => ({ name, count }))
		.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

import type { Group } from './types';

/**
 * Settle the group list — the last step of building results.
 *
 * **A row earns its place once.** The same repository is plausibly a recent
 * one, one of the account's, and one that has been pushed to since you were
 * last there; the same pull request is plausibly an address and an inbox row.
 * Showing it three times would make a short list look like a long one and would
 * put the same destination under three different headings, so the first group
 * to claim an id keeps it — and the groups are ordered most specific first,
 * which makes "first" mean "best".
 *
 * A group with nothing left, and nothing to say instead, does not render: a
 * heading over no rows reads as a section that failed to load.
 */
export function settleGroups(groups: Group[]): Group[] {
	const taken = new Set<string>();

	return groups
		.map((group) => ({
			...group,
			results: group.results.filter((row) => {
				if (taken.has(row.id)) return false;
				taken.add(row.id);
				return true;
			})
		}))
		.filter((group) => group.results.length > 0 || group.note);
}

import type { CompareCommitInfo } from '$lib/source';

/**
 * `git shortlog` — PLAN.md Phase 6's "tag entries carry their message and
 * shortlog", and DESIGN.md §5's Tag block, which puts it in a `<pre>`.
 *
 * This is the whole reason the refs page is the changelog rather than a list of
 * pointers. A tag on its own says a release happened; a tag with the commits
 * between it and the tag before it says what the release *was* — and grouped by
 * author, which is git's own format, it also says who did it, in the shape
 * every release note in the world is already written in.
 *
 * The `<pre>` is deliberate too, and it is DESIGN.md's call: this is the one
 * place in the app where alignment carries meaning, because a shortlog is read
 * as a block rather than as rows.
 */

export interface ShortlogGroup {
	author: string;
	/** Oldest first, which is how git prints them and how a release reads. */
	headlines: string[];
}

/**
 * Grouped by author, **busiest first** — where git's default is alphabetical
 * and `-n` is what you actually type. A changelog is read to find out what
 * happened, and the person who did the most of it is the fastest way in.
 */
export function shortlog(commits: readonly CompareCommitInfo[]): ShortlogGroup[] {
	const groups = new Map<string, string[]>();

	for (const commit of commits) {
		const author = commit.authorLogin ?? commit.authorName ?? 'unknown';
		const headlines = groups.get(author);
		if (headlines) headlines.push(commit.headline);
		else groups.set(author, [commit.headline]);
	}

	return [...groups]
		.map(([author, headlines]) => ({ author, headlines }))
		.sort((a, b) => b.headlines.length - a.headlines.length || a.author.localeCompare(b.author));
}

/** Six spaces, as git indents a subject. Alignment is the point of the block. */
const INDENT = '      ';

/** The block itself, in git's own layout, ready for a `<pre>`. */
export function formatShortlog(groups: readonly ShortlogGroup[]): string {
	return groups
		.map(
			(group) =>
				`${group.author} (${group.headlines.length}):\n` +
				group.headlines.map((headline) => `${INDENT}${headline}`).join('\n')
		)
		.join('\n\n');
}

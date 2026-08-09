import { noteKey, type DiffNote } from '$lib/diff/notes';
import type { ChangedFile, ReviewThread } from '$lib/source';

/**
 * Where a review thread sits on a diff, and which files have been read.
 *
 * Both are pure functions of data the screen already holds, and both are the
 * kind of thing that is wrong in a way you cannot see: a thread anchored to the
 * wrong line reads as a rendering quirk rather than as a bug, and a file
 * wrongly marked viewed is a file you skip. So they live here, testable on
 * their own, rather than inside the screen that renders them — the same
 * separation `blame.ts` makes from the code viewer and `graph.ts` from the log.
 */

/**
 * The diff row a thread hangs off, or `null` when GitHub can no longer place
 * it anywhere — a comment whose line has been deleted outright.
 *
 * `line` is where it sits on the *current* diff and `originalLine` is where it
 * was written; falling back to the second is what PLAN.md Phase 7's "watch for"
 * asks for. A comment placed at its original line is placed with the SHA it was
 * written against beside it, so the screen can say which file it was about
 * rather than implying it is about this one.
 */
export function anchorOf(thread: ReviewThread): string | null {
	const line = thread.line ?? thread.originalLine;
	if (line === null) return null;
	return noteKey(thread.path, thread.side === 'LEFT' ? 'old' : 'new', line);
}

/**
 * Markers by line. Two people commenting on one line is two threads at one
 * anchor, so a marker counts the comments across all of them and opens the
 * first — the sidebar is where the second is reached, which is most of what
 * the sidebar is for.
 *
 * Amber for anything unresolved, which is the meaning DESIGN.md §3 gives it;
 * everything settled goes quiet, because a resolved thread is history and the
 * diff is not a conversation log.
 */
export function threadNotes(threads: readonly ReviewThread[]): Map<string, DiffNote> {
	const found = new Map<string, ReviewThread[]>();

	for (const thread of threads) {
		const key = anchorOf(thread);
		if (!key) continue;
		const list = found.get(key);
		if (list) list.push(thread);
		else found.set(key, [thread]);
	}

	const notes = new Map<string, DiffNote>();

	for (const [key, list] of found) {
		const open = list.some((thread) => !thread.isResolved);
		const comments = list.reduce((total, thread) => total + thread.totalComments, 0);

		notes.set(key, {
			id: list[0].id,
			// Never colour alone — the count is the label, and the title spells the
			// state out in words (DESIGN.md §9).
			label: String(comments),
			tone: open ? 'warn' : 'muted',
			title:
				list.length === 1
					? `${comments} ${comments === 1 ? 'comment' : 'comments'} · ${open ? 'unresolved' : 'resolved'}`
					: `${list.length} threads, ${comments} comments${open ? ' · unresolved' : ''}`
		});
	}

	return notes;
}

/** The paths a set of changed files covers. */
export function pathsOf(files: readonly ChangedFile[]): Set<string> {
	const paths = new Set<string>();
	for (const file of files) paths.add(file.path);
	return paths;
}

/**
 * Which files count as read.
 *
 * A mark records the head SHA it was made at. If that is still the head, the
 * file is plainly viewed. If the branch has moved on, the mark survives for any
 * file the move did not touch — which is what keeps one push from un-viewing
 * forty files somebody has already read, and what keeps the one file it *did*
 * touch from staying quietly collapsed.
 *
 * `changedSince` is `null` when we cannot know — no recorded review to measure
 * from, or the comparison has not landed. Then a stale mark is not honoured,
 * because claiming a file is unchanged is a claim, and this one would be a
 * guess.
 */
export function viewedPaths(
	marks: ReadonlyMap<string, string | null>,
	headOid: string,
	changedSince: ReadonlySet<string> | null
): Set<string> {
	const viewed = new Set<string>();

	for (const [path, sha] of marks) {
		if (sha === headOid) viewed.add(path);
		else if (changedSince && !changedSince.has(path)) viewed.add(path);
	}

	return viewed;
}

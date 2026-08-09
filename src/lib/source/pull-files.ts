import { changed, type ChangedFile } from './commit';
import { fromRest, type Fetched, type FetchOptions } from './query';
import { pullFiles, PULL_FILES_PAGE } from './rest';
import type { PageOf } from './query';
import type { RepoRef } from './types';

/**
 * A pull request's whole diff — PLAN.md Phase 7: "unified diff, virtualised,
 * from the PR files endpoint".
 *
 * It is REST for the same reason the commit and the compare are: GraphQL has no
 * patch field. What is different is the paging. `pullFiles` takes a **page
 * number**, not a cursor, and PROGRESS.md's carried-forward note left the
 * choice open — teach `PageOf` about both kinds of paging, or have the source
 * hand back a synthetic cursor.
 *
 * **The source hands back a cursor.** A page number is a detail of one
 * endpoint; `pages()` is the settled primitive that four screens now depend on,
 * and growing it a second mode to accommodate one caller would put REST's
 * pagination scheme into a file that has no business knowing REST exists. So a
 * page's `endCursor` is the page it was, as a string, and the source turns that
 * back into `page + 1` on the way in. Everything `pages()` promises still
 * holds: a page is a cache entry keyed by where it starts, and a walk already
 * read costs nothing to walk again.
 *
 * **A page is immutable, and that is the whole performance story here.** The
 * diff of a pull request is a function of two commits — its head and the base
 * it is measured against — so keyed by that pair it can never go stale. This is
 * the heaviest read on the hardest screen, and without the permanent key it
 * would be re-fetched every thirty seconds of reading. `source.ts` builds the
 * key, because a range has two endpoints and `revKey` decides from one.
 */

export interface PullFilesPage extends PageOf<ChangedFile> {
	items: ChangedFile[];
	/** 1-based, as GitHub counts them. Carried so a key can name it. */
	page: number;
}

export async function getPullFiles(
	ref: RepoRef,
	number: number,
	page = 1,
	options: FetchOptions = {}
): Promise<Fetched<PullFilesPage>> {
	const result = await pullFiles(ref, number, {
		page,
		perPage: PULL_FILES_PAGE,
		signal: options.signal,
		etag: options.etag
	});

	// Read before the closure: `Link: rel="next"` lives on the response, not in
	// the body, and `fromRest` only ever hands the mapper a body.
	const more = result.ok && result.modified ? result.hasNextPage : false;

	return fromRest(result, (files) => ({
		items: files.map(changed),
		// The cursor *is* the page, which is what lets `pages()` treat a
		// page-numbered endpoint exactly like a cursor-walked one.
		endCursor: more ? String(page) : null,
		hasNextPage: more,
		/**
		 * REST does not send a total, so this cannot be one. The screen shows the
		 * pull request's own `changedFiles`, which came from the query that
		 * actually knows — a fabricated total here would be a number that agreed
		 * with nothing.
		 */
		totalCount: 0,
		page
	}));
}

/**
 * GitHub sent fewer files than the pull request says it has, and has no further
 * page to offer — which is what hitting `PULL_FILES_CAP` looks like from here,
 * and what any other shortfall looks like too. ARCHITECTURE.md §11 asks for
 * truncation to be disclosed rather than discovered, and this is the check that
 * does it: the count comes from the query that knows, not from a page.
 */
export function pullFilesTruncated(changedFiles: number, loaded: number, more: boolean): boolean {
	return !more && loaded < changedFiles;
}

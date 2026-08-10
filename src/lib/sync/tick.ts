import { recent } from '$lib/nav/recent.svelte';
import { GitHubSource } from '$lib/source';
import type { RepoRef } from '$lib/source/types';
import { rate } from './rate.svelte';
import { prefetch } from './prefetch';

/**
 * The background revalidation tick — PLAN.md Phase 8, ARCHITECTURE.md §11's
 * answer to having no webhooks: "poll while the app is open; ETags make it
 * cheap."
 *
 * What it revalidates is deliberately small — **the repository summary, for a
 * pinned set.** That one mutable entry carries HEAD, and HEAD moving is the
 * event everything else in this phase is a consequence of: the "since your
 * last visit" comparison re-keys itself on the new head, the dots reappear, and
 * the counts follow. Polling anything else would be paying for answers nobody
 * is looking at.
 *
 * ARCHITECTURE.md §12 asks how many repositories should sync in the background
 * and says a pinned set is probably right. It is: unbounded polling is a
 * standing charge against a budget §7 says to treat as real. The pinned set is
 * the three most recently opened, which is what "what I am working on" means
 * for a single-person tool — and it is a list we already keep.
 *
 * Three guards, all of them the same principle as `prefetch()`: speculation is
 * the first thing to give up.
 *
 * 1. **Hidden tabs do not poll.** A tab in the background is not being read,
 *    and the answer will be re-asked the moment it comes forward.
 * 2. **A tight budget does not poll.** `prefetch()` already refuses on low
 *    headroom, and the tick goes through it rather than around it.
 * 3. **A fresh entry does not poll.** The tick asks the cache first, so a
 *    revalidation only leaves the machine when the freshness window has
 *    actually elapsed — and where an entry has an ETag, `settle()` replays it,
 *    so a `304` costs nothing against the quota at all.
 */

/** Slower than any freshness window, so the window decides and the tick only asks. */
export const TICK_INTERVAL = 60_000;

/** How many repositories sync in the background. What "pinned" means for now. */
export const PINNED = 3;

/**
 * Start polling. Returns the stop function; called once, from the layout, so
 * there is one timer for the app rather than one per screen.
 */
export function startTick(): () => void {
	if (typeof window === 'undefined') return () => {};

	// The pinned set is the recent list, and the recent list is on disk until
	// something asks for it. Nothing else does any more — the home screen lists
	// what GitHub says exists rather than where you have been — so this is the
	// only read of it, and it is idempotent.
	void recent.hydrate();

	const timer = setInterval(sweep, TICK_INTERVAL);

	// Coming back to the tab is the moment freshness matters most and the moment
	// the clock is least likely to have just fired. Ask immediately.
	const onVisible = () => {
		if (document.visibilityState === 'visible') sweep();
	};
	document.addEventListener('visibilitychange', onVisible);

	return () => {
		clearInterval(timer);
		document.removeEventListener('visibilitychange', onVisible);
	};
}

/** One round. Exported so a test can drive it without waiting a minute. */
export function sweep(): void {
	if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
	if (rate.low) return;

	for (const ref of pinned()) {
		// Through `prefetch`, not around it: it reads the cache first, shares an
		// in-flight request with whatever the screen is doing, and stays silent
		// about failures. A poll that reported errors would be a poll that
		// interrupted reading to say the network blinked.
		prefetch(GitHubSource.getRepo(ref));
	}
}

function pinned(): RepoRef[] {
	return recent.all.slice(0, PINNED).map((entry) => ({ owner: entry.owner, name: entry.name }));
}

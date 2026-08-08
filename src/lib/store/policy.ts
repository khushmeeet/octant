/**
 * Cache policy — the numbers, in one place.
 *
 * ARCHITECTURE.md §5 fixes the shape of the cache but not its constants. They
 * live here rather than beside their uses so that tuning is one file to read,
 * and so a freshness window is never picked at a call site by whoever happened
 * to be writing a query that day.
 */

/**
 * How long a mutable entry stands before it is worth asking again. These are
 * per kind because volatility is per kind: a repository's HEAD moves on a push,
 * a pull request's checks move every few seconds while CI runs.
 *
 * A stale entry is still *rendered* — staleness starts a revalidation, it does
 * not withhold anything. So these can afford to be short.
 */
export const FRESHNESS = {
	/** Anything that did not name a window. */
	default: 30_000,
	/** Identity, HEAD and the sidebar counts. */
	repo: 60_000,
	/** A tree addressed by branch name rather than by SHA. */
	tree: 30_000,
	/** The ref → SHA map. */
	refs: 30_000,
	/** Pull request state. */
	pull: 30_000,
	/** Check runs, while CI is moving. */
	checks: 15_000
} as const;

/**
 * A hard ceiling on the immutable store, independent of disk pressure.
 * `navigator.storage.estimate()` is coarse and browser-dependent, and on a
 * large quota it may never report pressure at all while the store grows without
 * bound. A count is a second signal that always works.
 */
export const MAX_IMMUTABLE_ENTRIES = 4_000;

/** Evict down to this fraction of the ceiling, so a sweep is not a per-put tax. */
export const EVICT_TO = 0.8;

/** Fraction of the origin's quota above which we start evicting. */
export const QUOTA_PRESSURE = 0.85;

/** Fraction of the immutable store dropped per round when disk is the constraint. */
export const EVICT_FRACTION = 0.25;

/** Rounds of evict-then-re-estimate before giving up on relieving pressure. */
export const EVICT_ROUNDS = 3;

/**
 * Writes between pressure checks. Checking is a count and an estimate, both
 * cheap, but not free enough to run on every blob we cache. Growth is caused by
 * writes, so writes are the right clock — no timers.
 */
export const PUTS_PER_CHECK = 64;

/**
 * LRU needs a read to mark an entry used, and a write on every read would undo
 * the point of a cache. So a read only rewrites `lastUsedAt` when the stored
 * value is older than this. Recency stays accurate to within an hour, which is
 * far finer than eviction needs.
 */
export const TOUCH_INTERVAL = 3_600_000;

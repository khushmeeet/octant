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
	/** A file's contents at a branch. As volatile as the tree that holds it. */
	file: 30_000,
	/**
	 * Blame at a branch. Longer than the file it describes, deliberately: it is
	 * the most expensive read in the app, and it only moves when the file does —
	 * so the file's own revalidation is what notices, a beat earlier.
	 */
	blame: 120_000,
	/**
	 * A page of history at a branch. Only the first page is ever really at a
	 * branch — the pages behind it are addressed from a cursor — so this is the
	 * window on "has anything landed", which is the same question the repository
	 * summary asks.
	 */
	log: 30_000,
	/**
	 * A commit addressed by name rather than by SHA. Addressed by SHA — which is
	 * how the log links to one — it is immutable and this is never consulted.
	 */
	commit: 30_000,
	/** The ref → SHA map. */
	refs: 30_000,
	/**
	 * A comparison between two revisions that are not both SHAs — so one of its
	 * endpoints is a branch, and it is as volatile as that branch. Between two
	 * SHAs it is immutable and this is never consulted.
	 */
	compare: 30_000,
	/**
	 * One pull request: its state, its threads, and the check rollup, which all
	 * arrive in one document. The window is the shortest of the three because a
	 * screen is only as fresh as its fastest-moving field, and on this one that
	 * is CI. The diff underneath it is addressed by two commit SHAs and is
	 * immutable, so the short window costs a small query rather than a large one.
	 */
	pull: 15_000,
	/** The triage list. As volatile as the pushes that reorder it. */
	pulls: 30_000,
	/** Check runs, while CI is moving. */
	checks: 15_000,
	/**
	 * `CODEOWNERS`, at a branch. By far the longest window in the app, because
	 * the file changes when a team reorganises rather than when someone pushes —
	 * and because every screen consults it, so a short window would make a rarely
	 * moving file the most-fetched thing here. At a commit SHA it is immutable
	 * and this is never consulted.
	 */
	owners: 600_000
} as const;

/**
 * How many head SHAs a `visits` record keeps — ARCHITECTURE.md §6.
 *
 * Enough to read a rewritten branch's recent past, small enough that the record
 * stays one small object. What the history is *for* is finding a SHA that a ref
 * no longer names, and a SHA ten pushes old is one nobody is still reviewing
 * against.
 */
export const VISIT_HISTORY = 10;

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

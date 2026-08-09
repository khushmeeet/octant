/** Shapes the shell's regions accept. Screens fill them; the shell never changes. */

/** One segment of the header breadcrumb. The last is emphasised by the header. */
export interface Crumb {
	label: string;
	href?: string;
	/** Paths and SHAs are machine identifiers; repository names are not. */
	mono?: boolean;
}

/**
 * A verb in the object verb row. Must resolve in under 50ms or it does not
 * belong there — so a verb either runs locally (`onselect`) or is a link the
 * browser follows (`href`), and never something that waits on a request.
 */
export interface Verb {
	id: string;
	label: string;
	onselect?: () => void;
	href?: string;
	/**
	 * Warm whatever this verb will need. A verb whose screen has to fetch
	 * something cannot meet the 50ms rule on its own; hovering is the moment to
	 * pay for it, which is the same bargain the tree's rows make.
	 */
	onhover?: () => void;
	/** Leaves the app. Gets `target="_blank"` and a hint in its title. */
	external?: boolean;
	title?: string;
}

/**
 * What a list needs in order to dot its rows — Phase 8.
 *
 * A function rather than a set, so the caller keeps the index and the list
 * keeps none of it. `null` is the common answer and costs a lookup.
 */
export interface TreeMarks {
	mark(path: string): { owned: boolean; title: string } | null;
}

/** One key/value row in a right-panel block. */
export interface PanelEntry {
	key: string;
	value: string;
	/** Indigo — this concerns you. */
	accent?: boolean;
	/** Amber — a force push you have not seen. DESIGN.md §3, one meaning only. */
	warn?: boolean;
	mono?: boolean;
}

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

/** One key/value row in a right-panel block. */
export interface PanelEntry {
	key: string;
	value: string;
	/** Indigo — this concerns you. */
	accent?: boolean;
	mono?: boolean;
}

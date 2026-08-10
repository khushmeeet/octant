import type { IconName } from '$lib/ui/icons';

/** One row of the palette. Rows are links when they go somewhere. */
export interface Result {
	/** Stable across keystrokes: it is what dedupes a row out of a second group. */
	id: string;
	icon: IconName;
	/** The text the needle matched, and the text `hits` indexes into. */
	label: string;
	/** Where the characters landed — `rank.ts`. Rendered, never invented. */
	hits?: number[];
	/** Paths, SHAs and `owner/name` are machine identifiers. DESIGN.md §2. */
	mono?: boolean;
	/** Secondary text beside the label: a title, a description, a repository. */
	meta?: string;
	/** Tertiary text at the end of the row: what this row is, or what it costs. */
	note?: string;
	href?: string;
	/** For a row that acts rather than navigates. Never both. */
	run?: () => void;
	/** Warm what opening this would need — the same bargain a hovered row makes. */
	warm?: () => void;
	title?: string;
	/** Indigo: this concerns you. DESIGN.md §3, one meaning only. */
	accent?: boolean;
}

/**
 * A block of rows under a heading. The order of the groups is fixed and does
 * not re-rank — positional consistency is most of retrieval speed
 * (ARCHITECTURE.md §2), and a palette whose groups move as you type is one you
 * have to read rather than aim at.
 */
export interface Group {
	id: string;
	label: string;
	results: Result[];
	/** Said in place of rows, when a group has something to explain. */
	note?: string;
}

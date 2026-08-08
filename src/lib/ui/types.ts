/** Shapes the shell's regions accept. Screens fill them; the shell never changes. */

/** A verb in the object verb row. Must resolve in under 50ms or it does not belong there. */
export interface Verb {
	id: string;
	label: string;
	onselect?: () => void;
}

/** One key/value row in a right-panel block. */
export interface PanelEntry {
	key: string;
	value: string;
	/** Indigo — this concerns you. */
	accent?: boolean;
	mono?: boolean;
}

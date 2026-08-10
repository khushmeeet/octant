/**
 * Whether the palette is on screen — DESIGN.md §5, PLAN.md Phase 9.
 *
 * A module rather than a prop because ⌘K is the app's shortcut and not a
 * screen's: the same two keys open the same overlay wherever you are, and the
 * header's own chrome button is the second caller. It is the same shape as
 * `panel` and `theme`, minus the persistence — a palette that reopened where
 * you left it would be showing you the answer to a question you already asked.
 */

let open = $state(false);

export const palette = {
	get open(): boolean {
		return open;
	},

	show(): void {
		open = true;
	},

	close(): void {
		open = false;
	},

	toggle(): void {
		open = !open;
	}
};

/** ⌘K on a Mac, Ctrl+K everywhere else. Both, always, so neither is wrong. */
export function isPaletteChord(event: KeyboardEvent): boolean {
	return (event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'k';
}

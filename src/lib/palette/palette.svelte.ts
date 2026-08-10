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

/* --------------------------------------------------------------- pointer -- */

/**
 * Where the pointer was when the palette opened.
 *
 * The overlay appears wherever the mouse was last left, and the browser then
 * **synthesises** a pointer move for whatever row landed underneath it — so
 * "a pointer event arrived" is not the same as "the pointer moved", and taking
 * the first for the second hands the selection to a row nobody chose. Knowing
 * where the pointer already was is what tells the two apart.
 *
 * Deliberately not `$state`: it is written on every mouse move in the app and
 * read once per palette. Making it reactive would put a render cycle behind
 * every pixel of pointer travel to answer a question asked twice a minute.
 */
let pointer: { x: number; y: number } | null = null;

export function rememberPointer(event: PointerEvent): void {
	pointer = { x: event.clientX, y: event.clientY };
}

/** `null` until the pointer has moved at all — a keyboard-only session. */
export function lastPointer(): { x: number; y: number } | null {
	return pointer;
}

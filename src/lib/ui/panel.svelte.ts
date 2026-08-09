/**
 * Whether the right panel is on screen — DESIGN.md §5.
 *
 * The panel is context, not content: identity, what changed since your last
 * visit, what is open against the object. On a narrow window it is already
 * hidden by a media query; this is the same answer given deliberately, so a
 * wide window can be spent on the diff instead.
 *
 * localStorage rather than IndexedDB, for the same reason the theme uses it:
 * the read has to be synchronous or the panel flashes in before it collapses.
 */

const KEY = 'octant:panel';

let open = $state(true);

export const panel = {
	get open(): boolean {
		return open;
	},

	/** Adopt what was stored, if anything. Open is the default. */
	init(): void {
		try {
			open = localStorage.getItem(KEY) !== 'closed';
		} catch {
			// Private mode or storage disabled — the panel just won't persist.
		}
	},

	set(next: boolean): void {
		open = next;
		try {
			localStorage.setItem(KEY, next ? 'open' : 'closed');
		} catch {
			// As above.
		}
	},

	toggle(): void {
		panel.set(!open);
	}
};

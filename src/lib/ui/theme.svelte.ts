/**
 * Theme — dark is the default, light is a first-class alternate (DESIGN.md §1).
 *
 * The value is resolved by an inline script in `app.html` before first paint;
 * this module only mirrors and mutates it. localStorage rather than IndexedDB
 * because the read has to be synchronous to avoid a flash.
 */

export type Theme = 'dark' | 'light';

const KEY = 'octant:theme';

let current = $state<Theme>('dark');

export const theme = {
	get current(): Theme {
		return current;
	},

	/** Adopt whatever the pre-paint script settled on. */
	init(): void {
		const attr = document.documentElement.dataset.theme;
		current = attr === 'light' ? 'light' : 'dark';
	},

	set(next: Theme): void {
		current = next;
		document.documentElement.dataset.theme = next;
		try {
			localStorage.setItem(KEY, next);
		} catch {
			// Private mode or storage disabled — the theme just won't persist.
		}
	},

	toggle(): void {
		theme.set(current === 'dark' ? 'light' : 'dark');
	}
};

/**
 * Icon geometry, copied from the sprite in gitui-previews-v3.html.
 *
 * All on a 24×24 grid, rendered at 14px with a 1.6px stroke and no fill —
 * DESIGN.md §4. `c` is circles as `[cx, cy, r]`, `d` is path data.
 */

export interface IconShape {
	c?: Array<[number, number, number]>;
	d?: string[];
}

export const ICONS = {
	folder: {
		d: ['M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z']
	},
	file: {
		d: ['M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z', 'M14 3v5h5']
	},
	branch: {
		c: [
			[6, 6, 2.5],
			[6, 18, 2.5],
			[18, 8, 2.5]
		],
		d: ['M6 8.5v7M18 10.5c0 4-5 3-12 5']
	},
	commit: {
		c: [[12, 12, 3.5]],
		d: ['M3 12h5.5M15.5 12H21']
	},
	pr: {
		c: [
			[6, 18, 2.5],
			[6, 6, 2.5],
			[18, 18, 2.5]
		],
		d: ['M6 8.5v7M18 15.5V9a3 3 0 0 0-3-3h-3', 'M14 4l-2 2 2 2']
	},
	search: {
		c: [[11, 11, 6.5]],
		d: ['M16 16l4 4']
	},
	chev: {
		d: ['M9 6l6 6-6 6']
	},
	tag: {
		c: [[7.5, 7.5, 1.2]],
		d: ['M3 12V4h8l9 9-8 8z']
	},
	code: {
		d: ['M9 7l-5 5 5 5M15 7l5 5-5 5']
	},
	link: {
		d: [
			'M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1',
			'M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1'
		]
	},
	/** The shell's frame with its right column ruled off — the context panel. */
	panel: {
		d: ['M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z', 'M15 5.5v13']
	}
} as const satisfies Record<string, IconShape>;

export type IconName = keyof typeof ICONS;

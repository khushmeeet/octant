import type { ChangedFile } from '$lib/source';

/**
 * Turning a comparison into something a list can ask a question of, once per
 * row — the arithmetic behind every dot in the app.
 *
 * All of it is pure, and it lives outside the runes module for that reason:
 * these are indexes rebuilt whenever the comparison changes and never mutated
 * in place, so they are plain `Map`s and `Set`s on purpose. Putting them here
 * also makes them testable without a component to hang them on.
 */

/**
 * Every changed path and every directory above it, against how many changed
 * files it holds — so a row can say what its dot is for and not merely that it
 * has one, and so a four-thousand-row tree costs four thousand hash lookups
 * rather than four thousand scans of three hundred paths.
 *
 * A rename contributes both of its names, because a directory that lost a file
 * changed as surely as the one that gained it.
 */
export function spread(files: readonly ChangedFile[]): Map<string, number> {
	const reach = new Map<string, number>();

	for (const file of files) {
		// A rename is one file, so its two names must not count twice in the
		// directories they share. `seen` is what keeps those at one.
		const seen = new Set<string>();

		for (const path of [file.path, file.previousPath]) {
			if (!path) continue;
			let cut = path.length;
			while (cut > 0) {
				seen.add(path.slice(0, cut));
				cut = path.lastIndexOf('/', cut - 1);
			}
		}

		for (const path of seen) reach.set(path, (reach.get(path) ?? 0) + 1);
	}

	return reach;
}

/** Changed files by path, for a screen that is looking at exactly one of them. */
export function byPath(files: readonly ChangedFile[]): Map<string, ChangedFile> {
	return new Map(files.map((file) => [file.path, file]));
}

/** Distinct, in the order they first appeared. Empty strings and nulls dropped. */
export function distinct(values: readonly (string | null | undefined)[]): string[] {
	const seen = new Set<string>();
	const kept: string[] = [];

	for (const value of values) {
		if (!value || seen.has(value)) continue;
		seen.add(value);
		kept.push(value);
	}

	return kept;
}

/** Membership, for intersecting a list of commits with the range they may be in. */
export function setOf(values: readonly string[]): Set<string> {
	return new Set(values);
}

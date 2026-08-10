import type { RepoRef } from '$lib/source/types';
import { idbGet, idbPut } from '$lib/store/idb';
import { META, STORE } from '$lib/store/schema';

/**
 * Repositories opened before — what the background tick pins.
 *
 * This is not cached data and it is not a `Store` concern: it is one small
 * record of what this person does, in the same family as `visits`. It lives in
 * `meta` under a fixed key rather than getting a store of its own, because
 * twelve entries do not need an index.
 *
 * It had a screen of its own until the home screen replaced it, and it does not
 * need one back: `sync/tick.ts` reads the top three as the pinned set
 * (ARCHITECTURE.md §12), and what you can open is now a list from GitHub rather
 * than a list of where you have been. Phase 9 is the second reader and the one
 * this list was really for — the palette's `Recent` group, which is what an
 * empty query answers with: where you were is a better guess than anything a
 * ranker could make about a list of fifty repositories.
 */

export interface RecentRepo extends RepoRef {
	/** Epoch ms of the last visit. Ordering only. */
	at: number;
}

/** Enough to cover what one person is actually working on. */
const KEEP = 12;

let list = $state<RecentRepo[]>([]);
let loaded = false;

export const recent = {
	/** Most recent first. */
	get all(): RecentRepo[] {
		return list;
	},

	async hydrate(): Promise<void> {
		if (loaded) return;
		loaded = true;

		const saved = await idbGet<RecentRepo[]>(STORE.meta, META.recent).catch(() => undefined);
		if (Array.isArray(saved)) list = saved;
	},

	async remember(ref: RepoRef): Promise<void> {
		await recent.hydrate();
		list = [{ ...ref, at: Date.now() }, ...without(list, ref)].slice(0, KEEP);
		await persist();
	}

	// There was a `forget` here, for the × on a row of the old entry screen's
	// list. Nothing calls it now that the list has no UI, and an exported method
	// with no caller is a promise about behaviour nobody has checked in a while.
	// It is five lines when a screen wants it back.
};

function without(entries: RecentRepo[], ref: RepoRef): RecentRepo[] {
	return entries.filter((entry) => entry.owner !== ref.owner || entry.name !== ref.name);
}

async function persist(): Promise<void> {
	// The list surviving a reload is a convenience, not a guarantee. A storage
	// failure leaves it correct in memory and says nothing.
	await idbPut(STORE.meta, META.recent, $state.snapshot(list)).catch(() => {});
}

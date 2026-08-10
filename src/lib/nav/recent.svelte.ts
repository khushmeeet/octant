import type { RepoRef } from '$lib/source/types';
import { idbGet, idbPut } from '$lib/store/idb';
import { META, STORE } from '$lib/store/schema';

/**
 * Repositories opened before — the home screen's `Recent` section.
 *
 * This is not cached data and it is not a `Store` concern: it is one small
 * record of what this person does, in the same family as `visits`. It lives in
 * `meta` under a fixed key rather than getting a store of its own, because
 * twelve entries do not need an index.
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
	},

	async forget(ref: RepoRef): Promise<void> {
		await recent.hydrate();
		list = without(list, ref);
		await persist();
	}
};

function without(entries: RecentRepo[], ref: RepoRef): RecentRepo[] {
	return entries.filter((entry) => entry.owner !== ref.owner || entry.name !== ref.name);
}

async function persist(): Promise<void> {
	// The list surviving a reload is a convenience, not a guarantee. A storage
	// failure leaves it correct in memory and says nothing.
	await idbPut(STORE.meta, META.recent, $state.snapshot(list)).catch(() => {});
}

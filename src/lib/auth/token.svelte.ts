import { setTokenProvider, type TokenProvider } from '$lib/source/token';
import type { SourceError } from '$lib/source/errors';
import { idbDelete, idbGet, idbPut } from '$lib/store/idb';
import { META, STORE } from '$lib/store/schema';
import { rate } from '$lib/sync/rate.svelte';
import { forgetRepoMemories } from '$lib/visits/repo.svelte';
import { validateToken, type Viewer } from './validate';

/**
 * Authentication — ARCHITECTURE.md §8.
 *
 * Now: a fine-grained PAT, entered once, held in IndexedDB. Later: OAuth.
 * Everything above this module reads the token through `TokenProvider` and
 * never learns where it came from, so the migration touches only this file.
 */

export type { TokenProvider };

interface AuthRecord {
	token: string;
	viewer: Viewer;
	addedAt: number;
}

export type SessionStatus = 'loading' | 'signed-out' | 'signed-in';

let status = $state<SessionStatus>('loading');
let record = $state<AuthRecord | null>(null);

export const session = {
	get status(): SessionStatus {
		return status;
	},

	get viewer(): Viewer | null {
		return record?.viewer ?? null;
	},

	getToken(): string | null {
		return record?.token ?? null;
	},

	/**
	 * Read the stored token and trust it immediately, then revalidate behind —
	 * the same stale-while-revalidate shape the cache uses. A token revoked
	 * since last visit signs us out once the check comes back.
	 */
	async restore(): Promise<void> {
		let saved: AuthRecord | undefined;
		try {
			await rate.hydrate();
			saved = await idbGet<AuthRecord>(STORE.meta, META.auth);
		} catch {
			// Storage is blocked or unavailable. Fall through to the gate rather
			// than stranding the app on the boot screen.
			status = 'signed-out';
			return;
		}

		if (!saved?.token) {
			status = 'signed-out';
			return;
		}

		record = saved;
		status = 'signed-in';

		const result = await validateToken(saved.token);
		if (result.ok) {
			record = { ...saved, viewer: result.viewer };
			await persist(record);
		} else if (result.error.kind === 'unauthorized') {
			await session.signOut();
		}
		// Network and server failures leave the session intact: being offline
		// is not being signed out.
	},

	/** Validate before persisting. A token we never proved is not stored. */
	async signIn(token: string): Promise<{ ok: true } | { ok: false; error: SourceError }> {
		const trimmed = token.trim();
		const result = await validateToken(trimmed);
		if (!result.ok) return { ok: false, error: result.error };

		record = { token: trimmed, viewer: result.viewer, addedAt: Date.now() };
		status = 'signed-in';
		await persist(record);
		return { ok: true };
	},

	async signOut(): Promise<void> {
		record = null;
		status = 'signed-out';
		rate.clear();
		// "Since your last visit" is measured from when *this* session arrived, and
		// that is held in memory. Signing out ends the session, so it ends too —
		// otherwise the next person to sign in inherits somebody else's arrival.
		// The records on disk are untouched: they are what a next visit is since.
		forgetRepoMemories();
		await idbDelete(STORE.meta, META.auth).catch(() => {});
	}
} satisfies TokenProvider & Record<string, unknown>;

// The client asks for the token rather than being handed one, so `source/`
// never imports `auth/` and Phase 10 changes nothing above this line.
setTokenProvider(session);

/**
 * A storage failure must not sink a session that is otherwise valid — the
 * token just won't survive a reload. Phase 2 gives the store real error
 * reporting; until then this is a warning, not a failure mode.
 */
async function persist(next: AuthRecord): Promise<void> {
	try {
		await idbPut(STORE.meta, META.auth, $state.snapshot(next));
	} catch (cause) {
		console.warn('Could not persist the token to IndexedDB', cause);
	}
}

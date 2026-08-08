import { document } from '$lib/source/document';
import type { SourceError } from '$lib/source/errors';
import { query } from '$lib/source/graphql';

/**
 * Token validation — ARCHITECTURE.md §8, PLAN.md Phase 0.
 *
 * This runs before there is a session to authorise it, so it is the one
 * caller that hands the executor an explicit token. Everything else about it
 * is ordinary: the same document factory, the same error taxonomy, and the
 * meter is populated by the executor's interceptor rather than by hand.
 */

export interface Viewer {
	login: string;
	name: string | null;
	avatarUrl: string;
}

export type ValidationResult = { ok: true; viewer: Viewer } | { ok: false; error: SourceError };

const VIEWER = document<{ viewer: Viewer | null }>({
	name: 'Viewer',
	body: `
	viewer {
		login
		name
		avatarUrl(size: 64)
	}`
});

export async function validateToken(
	token: string,
	signal?: AbortSignal
): Promise<ValidationResult> {
	const result = await query(VIEWER, {}, { token, signal, fresh: true });
	if (!result.ok) return result;

	const viewer = result.data.viewer;
	if (!viewer) {
		return {
			ok: false,
			error: {
				kind: 'forbidden',
				message: 'Token accepted but not permitted to read your account.'
			}
		};
	}

	return { ok: true, viewer };
}

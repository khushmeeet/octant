/**
 * The token seam — ARCHITECTURE.md §8.
 *
 * The client reads its bearer token from a provider it never constructs, so
 * Phase 10 can swap a PAT for OAuth without `source/` learning that anything
 * changed. The interface lives here rather than in `auth/` so the dependency
 * runs one way: auth knows about the client, the client does not know about
 * auth.
 */

export interface TokenProvider {
	/** The bearer token for outbound requests, or `null` when signed out. */
	getToken(): string | null;
}

let provider: TokenProvider | null = null;

export function setTokenProvider(next: TokenProvider | null): void {
	provider = next;
}

export function currentToken(): string | null {
	return provider?.getToken() ?? null;
}

/**
 * A short, non-reversible tag for a token. In-flight requests are keyed by
 * document and variables, which are identical across accounts — `Viewer` has
 * no variables at all — so the key needs to know the token apart without
 * holding it. FNV-1a is enough: this distinguishes, it does not protect.
 */
export function tokenTag(token: string): string {
	let hash = 0x811c9dc5;
	for (let i = 0; i < token.length; i += 1) {
		hash ^= token.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return (hash >>> 0).toString(36);
}

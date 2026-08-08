/** Domain references shared across the client. */

export interface RepoRef {
	owner: string;
	name: string;
}

/** `owner/name` → a ref, or `null` if it is not one. */
export function parseRepoRef(input: string): RepoRef | null {
	const [owner, name, ...rest] = input
		.trim()
		.replace(/^\/+|\/+$/g, '')
		.split('/');
	if (!owner || !name || rest.length > 0) return null;
	return { owner, name };
}

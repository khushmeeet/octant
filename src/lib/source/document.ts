/**
 * Typed GraphQL documents — PLAN.md Phase 1.
 *
 * A document is composed here rather than written out, because ARCHITECTURE.md
 * §7 requires every query to ask for its own cost. Composing the `rateLimit`
 * selection in means a document structurally cannot omit it — the same move
 * as `RightPanel` owning its three headings. Unbreakable beats documented.
 */

/**
 * Deliberately `object` rather than `Record<string, unknown>`: an interface
 * does not satisfy an index signature, and variables want to be named
 * interfaces. The shape is checked against the document by GitHub either way.
 */
export type Variables = object;

export interface TypedDocument<TData, TVars extends Variables = Variables> {
	/** Operation name. Also the de-duplication key prefix. */
	readonly name: string;
	readonly text: string;
	/** Phantom. Never present at runtime; carries the shapes for inference. */
	readonly types?: { data: TData; variables: TVars };
}

export const RATE_LIMIT_FIELD = 'rateLimit { limit remaining used resetAt }';

export interface DocumentSpec {
	name: string;
	/** Variable declarations without the parentheses: `$owner: String!, $name: String!`. */
	variables?: string;
	/** The operation's selection set, without the outer braces. */
	body: string;
	/** Fragment definitions, appended after the operation. */
	fragments?: string[];
}

export function document<TData, TVars extends Variables = Record<string, never>>(
	spec: DocumentSpec
): TypedDocument<TData, TVars> {
	const params = spec.variables?.trim() ? `(${spec.variables.trim()})` : '';

	const text = [
		`query ${spec.name}${params} {`,
		spec.body.trim(),
		`\t${RATE_LIMIT_FIELD}`,
		'}',
		...(spec.fragments ?? []).map((fragment) => `\n${fragment.trim()}`)
	].join('\n');

	return { name: spec.name, text };
}

/**
 * Copying is a verb-row action, so it has to resolve in under 50ms and it has
 * to say whether it worked — the clipboard is permission-gated and can simply
 * refuse. Callers get a boolean rather than a rejection, because a failed copy
 * is a message, not an error condition.
 */
export async function copy(text: string): Promise<boolean> {
	try {
		await navigator.clipboard.writeText(text);
		return true;
	} catch {
		return legacyCopy(text);
	}
}

/** Insecure contexts and older permission models still have `execCommand`. */
function legacyCopy(text: string): boolean {
	try {
		const field = document.createElement('textarea');
		field.value = text;
		field.setAttribute('readonly', '');
		field.style.position = 'fixed';
		field.style.opacity = '0';
		document.body.append(field);
		field.select();
		const ok = document.execCommand('copy');
		field.remove();
		return ok;
	} catch {
		return false;
	}
}

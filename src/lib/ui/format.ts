const counts = new Intl.NumberFormat('en-US');

export function count(n: number): string {
	return counts.format(n);
}

/**
 * Compact forward-looking duration: `43m`, `2h`, `18s`.
 * Matches the terse relative times used throughout the chrome.
 */
export function until(iso: string, now = Date.now()): string {
	const ms = new Date(iso).getTime() - now;
	if (!Number.isFinite(ms)) return '—';
	if (ms <= 0) return 'now';

	const seconds = Math.round(ms / 1000);
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.round(seconds / 60);
	if (minutes < 60) return `${minutes}m`;
	return `${Math.round(minutes / 60)}h`;
}

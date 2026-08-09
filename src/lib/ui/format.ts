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

/**
 * Compact backward-looking duration: `4m`, `3h`, `2d`, `7mo`, `3y`.
 * Terse on purpose — it sits in a 32px row beside things that matter more.
 */
export function ago(iso: string, now = Date.now()): string {
	const ms = now - new Date(iso).getTime();
	if (!Number.isFinite(ms)) return '—';
	if (ms < 60_000) return 'now';

	const minutes = Math.floor(ms / 60_000);
	if (minutes < 60) return `${minutes}m`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h`;
	const days = Math.floor(hours / 24);
	if (days < 30) return `${days}d`;
	const months = Math.floor(days / 30);
	if (months < 12) return `${months}mo`;
	return `${Math.floor(days / 365)}y`;
}

/**
 * The same, for a time we hold as epoch milliseconds rather than as a string —
 * which is how the `visits` store records one. Round-tripping through an ISO
 * string to ask "how long ago" was the alternative, and it is a lie about where
 * the value came from.
 */
export function agoAt(epochMs: number, now = Date.now()): string {
	return ago(new Date(epochMs).toISOString(), now);
}

/**
 * Byte sizes as git tools write them. Binary units, because a blob's size is
 * a fact about storage, and one decimal place, because the column is 72px wide
 * and the second one has never told anybody anything.
 */
export function bytes(size: number | null): string {
	if (size === null) return '';
	if (size < 1024) return `${size} B`;

	const units = ['KB', 'MB', 'GB'];
	let value = size / 1024;
	let unit = 0;
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit += 1;
	}
	return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/** Repo-wide disk usage arrives from GitHub in kilobytes, not bytes. */
export function kilobytes(size: number | null): string {
	return size === null ? '—' : bytes(size * 1024);
}

/**
 * A tree entry's mode the way `ls -l` and `git ls-tree -l` readers already read
 * it: `100644` is `-rw-r--r--`, `040000` is `drwxr-xr-x`.
 *
 * Six octal digits are the storage format, not a reading. The only questions a
 * listing is actually asked of this column are "is that a directory, a symlink
 * or a submodule" and "is it executable", and the symbolic form answers both at
 * a glance where the number needs decoding first.
 *
 * Trees and symlinks carry no permission bits of their own — git stores them as
 * 040000 and 120000 — so they take the conventional rendering every other tool
 * shows for them rather than nine dashes.
 */
export function mode(octal: string): string {
	const bits = Number.parseInt(octal, 8);
	if (!Number.isFinite(bits)) return octal;

	switch (bits & 0o170000) {
		case 0o040000:
			return 'drwxr-xr-x';
		case 0o120000:
			return 'lrwxrwxrwx';
		// A gitlink is a commit pinned inside a tree, not a file here. `m` for
		// module, and no permissions, because it has none in this repository.
		case 0o160000:
			return 'm---------';
	}

	const rwx = (triplet: number) =>
		`${triplet & 4 ? 'r' : '-'}${triplet & 2 ? 'w' : '-'}${triplet & 1 ? 'x' : '-'}`;

	return `-${rwx((bits >> 6) & 7)}${rwx((bits >> 3) & 7)}${rwx(bits & 7)}`;
}

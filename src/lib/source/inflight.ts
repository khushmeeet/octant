/**
 * In-flight request sharing — PLAN.md Phase 1.
 *
 * Identical reads issued while one is already in the air share a single
 * promise. A hover prefetch and the click that follows it are the same
 * request, and the rate limit is a real budget, so paying twice is not an
 * option.
 *
 * Cancellation is reference counted. A caller walking away ends its own wait
 * immediately; the request itself is only aborted once the last caller has
 * gone, so one component unmounting cannot cancel another's data.
 */

interface Entry<T> {
	promise: Promise<T>;
	controller: AbortController;
	waiters: number;
	settled: boolean;
}

const inflight = new Map<string, Entry<unknown>>();

export function share<T>(
	key: string,
	signal: AbortSignal | undefined,
	run: (signal: AbortSignal) => Promise<T>
): Promise<T> {
	if (signal?.aborted) return Promise.reject(abortError());

	let entry = inflight.get(key) as Entry<T> | undefined;

	if (!entry) {
		const controller = new AbortController();
		const promise = run(controller.signal);
		const created: Entry<T> = { promise, controller, waiters: 0, settled: false };

		// Own the settlement, so a request every caller walked away from does
		// not surface as an unhandled rejection.
		const forget = () => {
			created.settled = true;
			if (inflight.get(key) === created) inflight.delete(key);
		};
		promise.then(forget, forget);

		inflight.set(key, created as Entry<unknown>);
		entry = created;
	}

	return join(key, entry, signal);
}

/** Stable across key order, so `{a, b}` and `{b, a}` are one request. */
export function stableKey(name: string, variables: unknown): string {
	return `${name}:${stable(variables)}`;
}

function join<T>(key: string, entry: Entry<T>, signal: AbortSignal | undefined): Promise<T> {
	entry.waiters += 1;

	let released = false;
	const release = () => {
		if (released) return;
		released = true;
		entry.waiters -= 1;

		if (entry.waiters === 0 && !entry.settled) {
			entry.controller.abort();
			if (inflight.get(key) === entry) inflight.delete(key);
		}
	};

	if (!signal) return entry.promise.finally(release);

	return new Promise<T>((resolve, reject) => {
		const onAbort = () => {
			release();
			reject(abortError());
		};
		signal.addEventListener('abort', onAbort, { once: true });

		entry.promise.then(
			(value) => {
				signal.removeEventListener('abort', onAbort);
				release();
				resolve(value);
			},
			(cause) => {
				signal.removeEventListener('abort', onAbort);
				release();
				reject(cause);
			}
		);
	});
}

function abortError(): DOMException {
	return new DOMException('Request cancelled.', 'AbortError');
}

function stable(value: unknown): string {
	if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
	if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;

	const entries = Object.entries(value as Record<string, unknown>)
		.filter(([, v]) => v !== undefined)
		.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

	return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(',')}}`;
}

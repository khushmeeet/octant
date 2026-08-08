import { expect, test, type Page, type Route } from '@playwright/test';

const GRAPHQL = 'https://api.github.com/graphql';

const resetAt = () => new Date(Date.now() + 3_600_000).toISOString();

const rateLimit = (remaining: number) => ({
	limit: 5000,
	remaining,
	used: 5000 - remaining,
	resetAt: resetAt()
});

const VIEWER = {
	login: 'octant-user',
	name: 'Octant User',
	avatarUrl: 'https://avatars.test/u.png'
};

const HEAD = '0f1a2b3c4d5e6f708192a3b4c5d6e7f809192a3b';

const REPOSITORY = {
	nameWithOwner: 'sveltejs/svelte',
	description: 'web development for the rest of us',
	isPrivate: false,
	isArchived: false,
	url: 'https://github.com/sveltejs/svelte',
	sshUrl: 'git@github.com:sveltejs/svelte.git',
	diskUsage: 204800,
	defaultBranchRef: {
		name: 'main',
		target: {
			oid: HEAD,
			abbreviatedOid: '0f1a2b3',
			messageHeadline: 'stop the compiler eating its own tail',
			committedDate: '2026-08-01T10:00:00Z',
			author: { name: 'Rich', user: { login: 'rich' } },
			history: { totalCount: 12345 }
		}
	},
	branches: { totalCount: 42 },
	tags: { totalCount: 900 },
	pullRequests: { totalCount: 7 }
};

/** Mode arrives as an integer: 16384 is 040000, 33188 is 100644. */
const ROOT_TREE = {
	__typename: 'Tree',
	oid: 'aaaabbbbccccddddeeeeffff00001111222233ff',
	entries: [
		{
			name: 'README.md',
			path: 'README.md',
			type: 'blob',
			mode: 33188,
			oid: '1111111111111111111111111111111111111111',
			object: { byteSize: 2048, isBinary: false }
		},
		{
			name: 'src',
			path: 'src',
			type: 'tree',
			mode: 16384,
			oid: '2222222222222222222222222222222222222222',
			object: null
		}
	]
};

const SRC_TREE = {
	__typename: 'Tree',
	oid: '2222222222222222222222222222222222222222',
	entries: [
		{
			name: 'compiler.js',
			path: 'src/compiler.js',
			type: 'blob',
			mode: 33188,
			oid: '3333333333333333333333333333333333333333',
			object: { byteSize: 91_000, isBinary: false }
		}
	]
};

interface Body {
	operationName?: string;
	variables?: Record<string, string>;
}

function bodyOf(route: Route): Body {
	return JSON.parse(route.request().postData() ?? '{}') as Body;
}

function json(route: Route, payload: unknown) {
	return route.fulfill({
		status: 200,
		contentType: 'application/json',
		body: JSON.stringify(payload)
	});
}

interface Stub {
	/** Requests seen per operation name, so a cache hit is a number that did not move. */
	readonly calls: Record<string, number>;
	/** Replace the handler for one operation mid-test. */
	on(
		operation: string,
		handler: (route: Route, variables: Record<string, string>) => unknown
	): void;
}

/**
 * Stubs the endpoint, signs in through the gate, and lands on the shell.
 * Routes survive a reload, which is what makes the durability tests possible.
 */
async function signIn(page: Page): Promise<Stub> {
	const calls: Record<string, number> = {};
	const handlers: Record<string, (route: Route, variables: Record<string, string>) => unknown> = {
		Viewer: (route) => json(route, { data: { viewer: VIEWER, rateLimit: rateLimit(4999) } }),
		Repo: (route) => json(route, { data: { repository: REPOSITORY, rateLimit: rateLimit(4998) } }),
		Tree: (route, variables) =>
			json(route, {
				data: {
					repository: {
						object: variables.expression?.endsWith(':src') ? SRC_TREE : ROOT_TREE
					},
					rateLimit: rateLimit(4997)
				}
			})
	};

	await page.route(GRAPHQL, async (route) => {
		const { operationName = '', variables = {} } = bodyOf(route);
		calls[operationName] = (calls[operationName] ?? 0) + 1;

		const handler = handlers[operationName];
		if (!handler) {
			await json(route, { data: null, errors: [{ message: `no stub for ${operationName}` }] });
			return;
		}
		await handler(route, variables);
	});

	await page.goto('/');
	await page.getByLabel('Personal access token').fill('github_pat_stub');
	await page.getByRole('button', { name: 'Validate and continue' }).click();
	await expect(page.getByRole('heading', { name: 'Cache and seams' })).toBeVisible();

	return {
		calls,
		on(operation, handler) {
			handlers[operation] = handler;
		}
	};
}

/** The tree only becomes addressable once HEAD is known, so it lands second. */
async function fetchRepo(page: Page) {
	await page.getByRole('button', { name: 'Fetch', exact: true }).click();
	await expect(page.getByRole('main').getByText('README.md')).toBeVisible();
}

test('a fresh browser lands on the token gate', async ({ page }) => {
	await page.goto('/');

	await expect(page.getByRole('heading', { name: 'Connect a token' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Validate and continue' })).toBeDisabled();
});

test('the gate reports a token GitHub rejects', async ({ page }) => {
	await page.route(GRAPHQL, (route) =>
		route.fulfill({ status: 401, body: '{"message":"Bad credentials"}' })
	);

	await page.goto('/');
	await page.getByLabel('Personal access token').fill('github_pat_not_a_real_token');
	await page.getByRole('button', { name: 'Validate and continue' }).click();

	await expect(page.getByRole('alert')).toHaveText('GitHub rejected this token.');
	await expect(page.getByRole('heading', { name: 'Connect a token' })).toBeVisible();
});

test('the source returns typed data and the meter is paid from the response', async ({ page }) => {
	const stub = await signIn(page);

	// The validation query populated the meter before any screen ran.
	await expect(page.getByTitle(/GraphQL points left/)).toContainText('4,999');

	await fetchRepo(page);

	const main = page.getByRole('main');
	await expect(main.getByText('sveltejs/svelte', { exact: true })).toBeVisible();
	await expect(main.getByText('stop the compiler eating its own tail')).toBeVisible();
	await expect(main.getByText('12,345')).toBeVisible();
	await expect(main.getByText('42 · 900')).toBeVisible();

	// Mode as git writes it, size formatted, directories first.
	await expect(main.getByText('100644').first()).toBeVisible();
	await expect(main.getByText('040000')).toBeVisible();
	await expect(main.getByText('2.0 KB')).toBeVisible();

	expect(stub.calls.Repo).toBe(1);
	expect(stub.calls.Tree).toBe(1);
	await expect(page.getByTitle(/GraphQL points left/)).toContainText('4,997');
});

test('a repository the token cannot see reports not found', async ({ page }) => {
	const stub = await signIn(page);
	stub.on('Repo', (route) =>
		json(route, {
			data: { repository: null, rateLimit: rateLimit(4998) },
			errors: [
				{ type: 'NOT_FOUND', message: "Could not resolve to a Repository with the name 'x/y'." }
			]
		})
	);

	await page.getByRole('button', { name: 'Fetch', exact: true }).click();

	await expect(page.getByRole('alert')).toContainText('Not found');
	await expect(page.getByRole('alert')).toContainText('sveltejs/svelte');
});

test('one address is not fetched twice while it is in the air', async ({ page }) => {
	const stub = await signIn(page);
	stub.on('Repo', async (route) => {
		// Wide enough that the second click lands while the first is still out.
		await new Promise((resolve) => setTimeout(resolve, 600));
		await json(route, { data: { repository: REPOSITORY, rateLimit: rateLimit(4998) } });
	});

	const fetch = page.getByRole('button', { name: 'Fetch', exact: true });
	await fetch.click();
	await fetch.click();

	await expect(page.getByRole('main').getByText('sveltejs/svelte', { exact: true })).toBeVisible();
	expect(stub.calls.Repo).toBe(1);
});

/* --------------------------------------------- Phase 2: the cache itself -- */

test('a second load paints from IndexedDB with no network call', async ({ page }) => {
	const stub = await signIn(page);
	await fetchRepo(page);

	expect(stub.calls.Repo).toBe(1);
	expect(stub.calls.Tree).toBe(1);

	// A new document, a new store instance, nothing in memory. Only IndexedDB
	// survives, so anything that paints now came off disk.
	await page.reload();
	await expect(page.getByRole('heading', { name: 'Cache and seams' })).toBeVisible();
	await fetchRepo(page);

	const main = page.getByRole('main');
	await expect(main.getByText('stop the compiler eating its own tail')).toBeVisible();
	await expect(main.getByText('from cache')).toHaveCount(2);

	expect(stub.calls.Repo).toBe(1);
	expect(stub.calls.Tree).toBe(1);
});

test('a listing addressed by SHA is never asked for twice', async ({ page }) => {
	const stub = await signIn(page);
	await fetchRepo(page);

	const main = page.getByRole('main');

	await main.getByRole('button', { name: 'src/' }).click();
	await expect(main.getByText('compiler.js')).toBeVisible();
	expect(stub.calls.Tree).toBe(2);

	// Back to the root, then down again. Both are immutable keys we already hold.
	await main.getByRole('button', { name: '/', exact: true }).click();
	await expect(main.getByText('README.md')).toBeVisible();

	await main.getByRole('button', { name: 'src/' }).click();
	await expect(main.getByText('compiler.js')).toBeVisible();

	expect(stub.calls.Tree).toBe(2);
	await expect(main.getByText('88.9 KB')).toBeVisible();
});

test('a failed revalidation keeps the cached render on screen', async ({ page }) => {
	const stub = await signIn(page);
	await fetchRepo(page);

	stub.on('Repo', (route) => route.abort('failed'));
	await page.getByRole('button', { name: 'Refresh' }).click();

	const main = page.getByRole('main');
	await expect(page.getByRole('status')).toContainText('Showing what was cached');
	await expect(main.getByText('stop the compiler eating its own tail')).toBeVisible();
	expect(stub.calls.Repo).toBe(2);
});

test('a database written by an earlier phase is migrated in place', async ({ page }) => {
	// Reach the origin, then put a schema v1 database where the app will find
	// one — four stores, no LRU index, which is what Phase 0 and Phase 1 left
	// in every browser that has already run this app.
	//
	// Wait for the gate before touching storage: it is the signal that
	// `session.restore()` has finished, and a delete that lands mid-boot is
	// undone by the app's next read reopening at the current version.
	await page.goto('/');
	await expect(page.getByRole('heading', { name: 'Connect a token' })).toBeVisible();

	await page.evaluate(async () => {
		await new Promise<void>((resolve, reject) => {
			const request = indexedDB.deleteDatabase('octant');
			// The app booted and is holding a connection, so this arrives blocked.
			// It unblocks when `openDb`'s `onversionchange` lets go; waiting for
			// success rather than for blocked is the difference between deleting
			// the database and only asking.
			request.onsuccess = () => resolve();
			request.onerror = () => reject(request.error);
		});

		await new Promise<void>((resolve, reject) => {
			const request = indexedDB.open('octant', 1);
			request.onupgradeneeded = () => {
				for (const name of ['immutable', 'mutable', 'visits', 'meta']) {
					request.result.createObjectStore(name);
				}
			};
			request.onsuccess = () => {
				request.result.onversionchange = () => request.result.close();
				request.result.close();
				resolve();
			};
			request.onerror = () => reject(request.error);
		});
	});

	await page.reload();
	const stub = await signIn(page);
	await fetchRepo(page);

	const upgraded = await page.evaluate(async () => {
		const db = await new Promise<IDBDatabase>((resolve, reject) => {
			const request = indexedDB.open('octant');
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
		const store = db.transaction('immutable', 'readonly').objectStore('immutable');
		const result = { version: db.version, indexes: [...store.indexNames] };
		db.close();
		return result;
	});

	expect(upgraded.version).toBe(2);
	expect(upgraded.indexes).toContain('by-last-used');
	expect(stub.calls.Tree).toBe(1);
});

test('a full immutable store is evicted oldest-first', async ({ page }) => {
	await signIn(page);

	// Seed past the ceiling with entries older than anything the app will write,
	// so the app's own cached objects are never the ones chosen.
	const seeded = await page.evaluate(async () => {
		const db = await new Promise<IDBDatabase>((resolve, reject) => {
			const request = indexedDB.open('octant');
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});

		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction('immutable', 'readwrite');
			const os = tx.objectStore('immutable');
			for (let i = 0; i < 4001; i += 1) {
				os.put(
					{ value: i, fetchedAt: 1, etag: null, lastUsedAt: i + 1 },
					`seed:${String(i).padStart(4, '0')}`
				);
			}
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error);
		});

		const count = await new Promise<number>((resolve, reject) => {
			const request = db.transaction('immutable', 'readonly').objectStore('immutable').count();
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
		db.close();
		return count;
	});

	expect(seeded).toBe(4001);

	// The first write of the session triggers the pressure check.
	await fetchRepo(page);

	const survivors = await page.evaluate(async () => {
		const db = await new Promise<IDBDatabase>((resolve, reject) => {
			const request = indexedDB.open('octant');
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});

		const read = <T>(body: (os: IDBObjectStore) => IDBRequest) =>
			new Promise<T>((resolve, reject) => {
				const request = body(db.transaction('immutable', 'readonly').objectStore('immutable'));
				request.onsuccess = () => resolve(request.result as T);
				request.onerror = () => reject(request.error);
			});

		const result = {
			count: await read<number>((os) => os.count()),
			oldest: await read<unknown>((os) => os.get('seed:0000')),
			newest: await read<unknown>((os) => os.get('seed:4000'))
		};
		db.close();
		return result;
	});

	// 4001 seeded, evicted down to 80% of the 4,000 ceiling, plus the one tree
	// the app cached on its way past.
	expect(survivors.count).toBe(3201);
	expect(survivors.oldest).toBeUndefined();
	expect(survivors.newest).toBeDefined();
});

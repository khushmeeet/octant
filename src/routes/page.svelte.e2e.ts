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
const README_OID = '1111111111111111111111111111111111111111';
const SRC_OID = '2222222222222222222222222222222222222222';

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
const blob = (name: string, path: string, oid: string, byteSize: number) => ({
	name,
	path,
	type: 'blob',
	mode: 33188,
	oid,
	object: { byteSize, isBinary: false }
});

const dir = (name: string, path: string, oid: string) => ({
	name,
	path,
	type: 'tree',
	mode: 16384,
	oid,
	object: null
});

const ROOT_TREE = {
	__typename: 'Tree',
	oid: 'aaaabbbbccccddddeeeeffff00001111222233ff',
	entries: [
		blob('README.md', 'README.md', README_OID, 2048),
		dir('src', 'src', SRC_OID),
		dir('big', 'big', '4444444444444444444444444444444444444444')
	]
};

const SRC_TREE = {
	__typename: 'Tree',
	oid: SRC_OID,
	entries: [
		blob('compiler.js', 'src/compiler.js', '3333333333333333333333333333333333333333', 91_000)
	]
};

/** Past any sane render budget, which is the point — PLAN.md's risk register. */
const BIG_TREE = {
	__typename: 'Tree',
	oid: '4444444444444444444444444444444444444444',
	entries: Array.from({ length: 4000 }, (_, i) => {
		const name = `file-${String(i).padStart(4, '0')}.txt`;
		return blob(name, `big/${name}`, String(i).padStart(40, 'e'), 10);
	})
};

const TREES: Record<string, unknown> = { '': ROOT_TREE, src: SRC_TREE, big: BIG_TREE };

/**
 * Exercises the parser's whole surface in one file: headings, emphasis, a
 * fenced block, a reference link, a table — and a block of raw HTML, which must
 * not survive.
 */
const README = `# svelte

Web development for the *rest of us*.

<p align="center">a centred logo</p>

\`\`\`sh
bun install
\`\`\`

- read the [docs][d]
- file a bug

[d]: https://svelte.dev/docs

| Key | Value |
| --- | ----- |
| one | two   |
`;

const BLOBS: Record<string, { text: string; byteSize: number }> = {
	[README_OID]: { text: README, byteSize: README.length }
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
	/** Tree requests per directory. The cache tests turn on these. */
	readonly trees: Record<string, number>;
	/** Replace the handler for one operation mid-test. */
	on(
		operation: string,
		handler: (route: Route, variables: Record<string, string>) => unknown
	): void;
}

/**
 * Stubs the endpoint, signs in through the gate, and lands on the entry screen.
 * Routes survive a reload, which is what makes the durability tests possible.
 */
async function signIn(page: Page): Promise<Stub> {
	const calls: Record<string, number> = {};
	const trees: Record<string, number> = {};

	const handlers: Record<string, (route: Route, variables: Record<string, string>) => unknown> = {
		Viewer: (route) => json(route, { data: { viewer: VIEWER, rateLimit: rateLimit(4999) } }),
		Repo: (route) => json(route, { data: { repository: REPOSITORY, rateLimit: rateLimit(4998) } }),
		Tree: (route, variables) => {
			// `rev:path` — the revision is ignored here on purpose, so a listing
			// asked for by SHA and by name is the same answer under two keys.
			const path = (variables.expression ?? '').split(':').slice(1).join(':');
			trees[path] = (trees[path] ?? 0) + 1;
			return json(route, {
				data: { repository: { object: TREES[path] ?? null }, rateLimit: rateLimit(4997) }
			});
		},
		Blob: (route, variables) => {
			const found = BLOBS[variables.oid ?? ''];
			return json(route, {
				data: {
					repository: {
						object: found
							? {
									__typename: 'Blob',
									oid: variables.oid,
									byteSize: found.byteSize,
									isBinary: false,
									isTruncated: false,
									text: found.text
								}
							: null
					},
					rateLimit: rateLimit(4996)
				}
			});
		}
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
	await expect(page.getByRole('heading', { name: 'Open a repository' })).toBeVisible();

	return {
		calls,
		trees,
		on(operation, handler) {
			handlers[operation] = handler;
		}
	};
}

/** The listing, as a set of links. Rows are links because they go somewhere. */
function listing(page: Page) {
	return page.getByRole('navigation', { name: 'Directory listing' });
}

async function openRepo(page: Page, at = '/sveltejs/svelte') {
	await page.goto(at);
	await expect(listing(page).getByRole('link', { name: 'README.md' })).toBeVisible();
}

/**
 * Age every revalidated entry so the next read of one is a revalidation rather
 * than a hit. Reaching into the store beats mocking the clock: the freshness
 * window is a comparison against `fetchedAt`, so moving `fetchedAt` tests
 * exactly the branch we mean without putting the whole page on a fake timer.
 */
async function expireMutable(page: Page) {
	await page.evaluate(async () => {
		const db = await new Promise<IDBDatabase>((resolve, reject) => {
			const request = indexedDB.open('octant');
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});

		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction('mutable', 'readwrite');
			const cursorRequest = tx.objectStore('mutable').openCursor();
			cursorRequest.onsuccess = () => {
				const cursor = cursorRequest.result;
				if (!cursor) return;
				cursor.update({ ...cursor.value, fetchedAt: 1 });
				cursor.continue();
			};
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error);
		});

		db.close();
	});
}

/**
 * The suite talks to nothing it does not control. The webfonts are chrome and
 * are not under test, and a render-blocking stylesheet on a CDN would put a
 * third party's latency inside every navigation this file measures.
 */
test.beforeEach(async ({ page }) => {
	await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
});

/* ------------------------------------------------------- Phase 0: the gate -- */

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

/* ---------------------------------------------------- Phase 1: the client -- */

test('the source returns typed data and the meter is paid from the response', async ({ page }) => {
	const stub = await signIn(page);

	// The validation query populated the meter before any screen ran.
	await expect(page.getByTitle(/GraphQL points left/)).toContainText('4,999');

	await openRepo(page);

	// Mode as git writes it, size formatted, directories first.
	const rows = listing(page).getByRole('link');
	await expect(rows.nth(0)).toContainText('big');
	await expect(rows.nth(1)).toContainText('src');
	await expect(rows.nth(2)).toContainText('README.md');
	await expect(listing(page).getByText('040000').first()).toBeVisible();
	await expect(listing(page).getByText('100644')).toBeVisible();
	await expect(listing(page).getByText('2.0 KB')).toBeVisible();

	expect(stub.calls.Repo).toBe(1);
	await expect(page.getByTitle(/GraphQL points left/)).toContainText('4,99');
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
	stub.on('Tree', (route) =>
		json(route, {
			data: { repository: null, rateLimit: rateLimit(4997) },
			errors: [{ type: 'NOT_FOUND', message: 'Could not resolve to a Repository.' }]
		})
	);

	await page.goto('/sveltejs/nope');
	await expect(page.getByRole('alert')).toContainText('Not found');
});

test('one address is not fetched twice while it is in the air', async ({ page }) => {
	const stub = await signIn(page);
	stub.on('Tree', async (route, variables) => {
		// Wide enough that the sidebar's read lands while the listing's is out.
		await new Promise((resolve) => setTimeout(resolve, 500));
		const path = (variables.expression ?? '').split(':').slice(1).join(':');
		await json(route, {
			data: { repository: { object: TREES[path] ?? null }, rateLimit: rateLimit(4997) }
		});
	});

	await openRepo(page);

	// The listing and the sidebar tree both want the root at the same revision.
	// That is one address, so it is one request.
	expect(stub.calls.Tree).toBe(1);
});

/* ----------------------------------------------------- Phase 2: the cache -- */

test('a second load paints from IndexedDB with no network call', async ({ page }) => {
	const stub = await signIn(page);
	await openRepo(page);

	// The README rendering is the signal that its blob reached IndexedDB —
	// `settle()` writes before it resolves, and the resolve is what sets `data`.
	// Reloading before that would discard a request the next load then repeats.
	await expect(page.getByRole('main').getByRole('heading', { name: 'svelte' })).toBeVisible();

	const repoCalls = stub.calls.Repo;
	const treeCalls = stub.calls.Tree;
	expect(treeCalls).toBe(1);

	// A new document, a new store instance, nothing in memory. Only IndexedDB
	// survives, so anything that paints now came off disk.
	await page.reload();
	await expect(listing(page).getByRole('link', { name: 'README.md' })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'svelte', exact: true })).toBeVisible();

	expect(stub.calls.Repo).toBe(repoCalls);
	expect(stub.calls.Tree).toBe(treeCalls);
	expect(stub.calls.Blob).toBe(1);
});

test('a listing addressed by SHA is never asked for twice', async ({ page }) => {
	const stub = await signIn(page);
	await openRepo(page, `/sveltejs/svelte/tree/${HEAD}`);

	await listing(page).getByRole('link', { name: 'src' }).click();
	await expect(listing(page).getByRole('link', { name: 'compiler.js' })).toBeVisible();
	expect(stub.trees.src).toBe(1);

	// Back to the root, then down again. Both are immutable keys we already hold.
	await page.goBack();
	await expect(listing(page).getByRole('link', { name: 'README.md' })).toBeVisible();
	await listing(page).getByRole('link', { name: 'src' }).click();
	await expect(listing(page).getByRole('link', { name: 'compiler.js' })).toBeVisible();

	expect(stub.trees.src).toBe(1);
	expect(stub.trees['']).toBe(1);
	await expect(listing(page).getByText('89 KB')).toBeVisible();
});

test('a failed revalidation keeps the cached render on screen', async ({ page }) => {
	const stub = await signIn(page);
	await openRepo(page);

	// Past the freshness window, so coming back revalidates rather than reading
	// straight through — and the revalidation is the thing that fails.
	await expireMutable(page);
	stub.on('Repo', (route) => route.abort('failed'));
	stub.on('Tree', (route) => route.abort('failed'));

	await page.reload();

	await expect(page.getByRole('status')).toContainText('Showing what was cached');
	await expect(listing(page).getByRole('link', { name: 'README.md' })).toBeVisible();
	await expect(page.getByRole('main').getByRole('heading', { name: 'svelte' })).toBeVisible();
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
	await openRepo(page);

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
	expect(stub.trees['']).toBe(1);
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

	// The first write of the session triggers the pressure check. The README is
	// blob-addressed, so it lands in the immutable store.
	await openRepo(page);
	await expect(page.getByRole('heading', { name: 'svelte', exact: true })).toBeVisible();

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
			oldest: await read<unknown>((os) => os.get('seed:0000')),
			newest: await read<unknown>((os) => os.get('seed:4000'))
		};
		db.close();
		return result;
	});

	expect(survivors.oldest).toBeUndefined();
	expect(survivors.newest).toBeDefined();
});

/* --------------------------------------------------- Phase 3: the screen -- */

test('the tree screen carries the repository, its clone URLs and its README', async ({ page }) => {
	await signIn(page);
	await openRepo(page);

	// Header: breadcrumb, ref pill, HEAD SHA.
	await expect(page.getByRole('banner').getByText('sveltejs')).toBeVisible();
	await expect(page.getByRole('banner').getByText('main', { exact: true })).toBeVisible();
	await expect(page.getByRole('banner').getByText('0f1a2b3')).toBeVisible();

	// Clone strip: two URLs, labelled by what they let you do.
	await expect(page.getByLabel('Copy the read-only clone URL')).toContainText(
		'https://github.com/sveltejs/svelte.git'
	);
	await expect(page.getByLabel('Copy the read/write clone URL')).toContainText(
		'git@github.com:sveltejs/svelte.git'
	);

	// The right panel keeps its three blocks, in order, whatever is in them.
	const panel = page.getByRole('complementary', { name: 'Context' });
	await expect(panel.getByRole('heading').nth(0)).toHaveText('Since your last visit');
	await expect(panel.getByRole('heading').nth(1)).toHaveText('About');
	await expect(panel.getByRole('heading').nth(2)).toHaveText('Open against it');
	await expect(panel).toContainText('200 MB');

	// Sidebar counts come from the summary we already hold.
	const sidebar = page.getByRole('navigation', { name: 'Primary' });
	await expect(sidebar.getByText('12,345')).toBeVisible();
	await expect(sidebar.getByText('942')).toBeVisible();
	await expect(sidebar.getByText('7', { exact: true })).toBeVisible();
});

test('the README renders as markdown, and its raw HTML does not survive', async ({ page }) => {
	await signIn(page);
	await openRepo(page);

	const main = page.getByRole('main');
	await expect(main.getByRole('heading', { name: 'svelte', exact: true })).toBeVisible();
	await expect(main.getByText('rest of us')).toBeVisible();
	await expect(main.getByText('bun install')).toBeVisible();
	await expect(main.getByRole('link', { name: 'docs' })).toHaveAttribute(
		'href',
		'https://svelte.dev/docs'
	);
	await expect(main.getByRole('cell', { name: 'two' })).toBeVisible();

	// The centred logo is decoration, and DESIGN.md §8 does not want it.
	await expect(main.getByText('a centred logo')).toHaveCount(0);
});

test('j and k move the selection and enter opens the row', async ({ page }) => {
	await signIn(page);
	await openRepo(page);

	// A screen you have just opened claims nothing. The first press starts at
	// the top, and selection is announced rather than only tinted.
	const rows = listing(page).getByRole('link');
	await expect(listing(page).locator('[aria-current]')).toHaveCount(0);

	await page.keyboard.press('j');
	await expect(rows.nth(0)).toHaveAttribute('aria-current', 'true');
	await page.keyboard.press('j');
	await expect(rows.nth(1)).toHaveAttribute('aria-current', 'true');
	await expect(rows.nth(1)).toContainText('src');

	await page.keyboard.press('Enter');
	await expect(page).toHaveURL('/sveltejs/svelte/tree/HEAD/src');
	await expect(listing(page).getByRole('link', { name: 'compiler.js' })).toBeVisible();

	// A subdirectory offers the way back out as a row, so the keyboard reaches
	// it. It lands on the repository's canonical front page, because the default
	// branch is addressed by omission rather than by name.
	await expect(listing(page).getByRole('link', { name: '..' })).toBeVisible();
	await expect(listing(page).locator('[aria-current]')).toHaveCount(0);
	await page.keyboard.press('j');
	await page.keyboard.press('Enter');
	await expect(page).toHaveURL('/sveltejs/svelte');
});

test('slash focuses the filter and filtering narrows the listing', async ({ page }) => {
	await signIn(page);
	await openRepo(page);

	await page.keyboard.press('/');
	await expect(page.getByLabel('Filter this directory')).toBeFocused();

	await page.keyboard.type('read');
	await expect(listing(page).getByRole('link')).toHaveCount(1);
	await expect(listing(page).getByRole('link')).toContainText('README.md');
	await expect(page.getByRole('main')).toContainText('1 of 3');

	await page.keyboard.press('Escape');
	await expect(listing(page).getByRole('link')).toHaveCount(3);
});

test('four thousand entries render as a window, not as a listing', async ({ page }) => {
	await signIn(page);
	await page.goto('/sveltejs/svelte/tree/HEAD/big');
	await expect(listing(page).getByRole('link', { name: 'file-0000.txt' })).toBeVisible();

	// The budget is 60fps at this size, which is only possible if the DOM holds
	// a viewport's worth of rows rather than the directory.
	const rendered = await listing(page).getByRole('link').count();
	expect(rendered).toBeGreaterThan(2);
	expect(rendered).toBeLessThan(120);
	await expect(listing(page).getByRole('link', { name: 'file-3999.txt' })).toHaveCount(0);

	// It virtualises against the page's scroller, not one of its own.
	await page.getByRole('main').evaluate((el) => el.scrollTo(0, el.scrollHeight));
	await expect(listing(page).getByRole('link', { name: 'file-3999.txt' })).toBeVisible();
	await expect(listing(page).getByRole('link', { name: 'file-0000.txt' })).toHaveCount(0);
});

test('hovering a directory warms it, so opening it costs nothing', async ({ page }) => {
	const stub = await signIn(page);
	await openRepo(page);

	expect(stub.trees.src).toBeUndefined();

	await listing(page).getByRole('link', { name: 'src' }).hover();
	await expect.poll(() => stub.trees.src).toBe(1);

	await listing(page).getByRole('link', { name: 'src' }).click();
	await expect(listing(page).getByRole('link', { name: 'compiler.js' })).toBeVisible();

	// The screen it opened was already on disk when it was asked for.
	expect(stub.trees.src).toBe(1);
});

test('the sidebar tree expands, and shares the listing it already paid for', async ({ page }) => {
	const stub = await signIn(page);
	await openRepo(page);

	const sidebar = page.getByRole('navigation', { name: 'Primary' });
	expect(stub.trees['']).toBe(1);

	await sidebar.getByRole('button', { name: 'Expand src' }).click();
	await expect(sidebar.getByRole('link', { name: 'compiler.js' })).toBeVisible();
	expect(stub.trees.src).toBe(1);

	// Opening the same directory in the main column is now a local read.
	await listing(page).getByRole('link', { name: 'src' }).click();
	await expect(listing(page).getByRole('link', { name: 'compiler.js' })).toBeVisible();
	expect(stub.trees.src).toBe(1);
});

test('permalink re-addresses the tree by SHA, and the SHA is permanent', async ({ page }) => {
	const stub = await signIn(page);
	await openRepo(page);

	await page.getByRole('link', { name: 'Permalink' }).click();
	await expect(page).toHaveURL(`/sveltejs/svelte/tree/${HEAD}`);

	// A different address, so it is fetched once...
	await expect.poll(() => stub.trees['']).toBe(2);

	// ...and then never again, however stale everything around it has gone. That
	// is the whole point of the verb: a named branch has a freshness window and
	// a SHA does not.
	await expireMutable(page);
	await page.goto('/sveltejs/svelte/tree/main');
	await expect(listing(page).getByRole('link', { name: 'README.md' })).toBeVisible();
	await page.goto(`/sveltejs/svelte/tree/${HEAD}`);
	await expect(listing(page).getByRole('link', { name: 'README.md' })).toBeVisible();

	expect(stub.trees['']).toBe(3);

	// On a permanent address there is nothing left to make permanent.
	await expect(page.getByRole('link', { name: 'Permalink' })).toHaveCount(0);
});

test('a branch name with a slash survives the round trip through the URL', async ({ page }) => {
	const stub = await signIn(page);
	await page.goto(`/sveltejs/svelte/tree/${encodeURIComponent('release/1.0')}/src`);
	await expect(listing(page).getByRole('link', { name: 'compiler.js' })).toBeVisible();

	// One segment in, one revision out — the ref never has to be guessed apart
	// from the path.
	const asked = await page.evaluate(() => document.title);
	expect(asked).toBeTruthy();
	expect(stub.trees.src).toBe(1);
	await expect(page.getByRole('banner').getByText('release/1.0')).toBeVisible();
});

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
		blob('App.svelte', 'src/App.svelte', 'aaaa111111111111111111111111111111111111', 300),
		blob('compiler.js', 'src/compiler.js', '3333333333333333333333333333333333333333', 91_000),
		blob('huge.txt', 'src/huge.txt', '5555555555555555555555555555555555555555', 260_000),
		blob('logo.png', 'src/logo.png', '6666666666666666666666666666666666666666', 40_000)
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
# get started
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

/**
 * One small file that exercises every branch of the scanner the file screen
 * depends on: a line comment, a string, keywords, a call site, a tab indent,
 * and a block comment that survives a line break.
 */
const COMPILER = [
	'// the compiler',
	"import { parse } from './parse.js';",
	'',
	'export function compile(source, options = {}) {',
	'\tconst ast = parse(source);',
	'\t/* a block',
	'\t   comment */',
	'\treturn { ast, options, name: "compiler" };',
	'}',
	''
].join('\n');

/**
 * Markup that hands two regions to another grammar and takes them back. This
 * is the intricate half of the scanner: the region has to open after the tag's
 * `>` rather than at its name, survive the line breaks in between, and close on
 * a tag the inner grammar knows nothing about.
 */
const APP_SVELTE = [
	'<script lang="ts">',
	'\tlet count = $state(0);',
	'</script>',
	'',
	'<!-- a comment -->',
	'<button onclick={() => count++}>{count}</button>',
	''
].join('\n');

/** Past any sane render budget, and truncated — both at once, on purpose. */
const HUGE = Array.from({ length: 4000 }, (_, i) => `line ${i + 1}`).join('\n');

interface FileStub {
	text: string | null;
	byteSize: number;
	oid: string;
	isBinary?: boolean;
	isTruncated?: boolean;
}

/** Keyed by path, because that is how a file screen addresses one. */
const FILES: Record<string, FileStub> = {
	'src/App.svelte': {
		text: APP_SVELTE,
		byteSize: APP_SVELTE.length,
		oid: 'aaaa111111111111111111111111111111111111'
	},
	'src/compiler.js': {
		text: COMPILER,
		byteSize: 91_000,
		oid: '3333333333333333333333333333333333333333'
	},
	'src/huge.txt': {
		text: HUGE,
		byteSize: 260_000,
		oid: '5555555555555555555555555555555555555555',
		isTruncated: true
	},
	'src/logo.png': {
		text: null,
		byteSize: 40_000,
		oid: '6666666666666666666666666666666666666666',
		isBinary: true
	}
};

const OLD = {
	oid: '7777777777777777777777777777777777777777',
	abbreviatedOid: '7777777',
	messageHeadline: 'first cut of the compiler',
	committedDate: '2021-04-02T09:00:00Z',
	author: { name: 'Rich Harris', user: { login: 'rich' } }
};

const NEW = {
	oid: '8888888888888888888888888888888888888888',
	abbreviatedOid: '8888888',
	messageHeadline: 'inline the parser call',
	committedDate: '2026-07-30T09:00:00Z',
	author: { name: 'Simon', user: { login: 'simon' } }
};

/**
 * Two authors over nine lines, in three ranges — the middle one is the newer
 * commit, so the gutter has to start a fresh run when the old one comes back.
 */
const BLAME_RANGES = [
	{ startingLine: 1, endingLine: 3, commit: OLD },
	{ startingLine: 4, endingLine: 5, commit: NEW },
	{ startingLine: 6, endingLine: 9, commit: OLD }
];

/* ------------------------------------------------------- Phase 5: the log -- */

/** Distinct in their first seven characters, which is all a log ever shows. */
const sha = (n: number) => n.toString(16).padStart(7, '0') + '0'.repeat(33);

interface HistoryStub {
	n: number;
	parents: number[];
	author: string;
	headline: string;
	body: string;
	/** Which paths a path-scoped history would return this commit for. */
	touches: string[];
	additions: number;
	deletions: number;
}

/**
 * Nine commits with a real shape — a merge, a side branch that rejoins, and two
 * authors — followed by a hundred linear ones so the log has a second page.
 *
 * The shape is the point. Lanes only mean anything if something opens one and
 * something else closes it: 109 is a merge of 108 and 105, and 105 is a side
 * branch whose parent 104 is also 106's, so lane 1 opens on the first row and
 * merges back six rows later.
 */
const STRUCTURED: Omit<HistoryStub, 'n'>[] = [
	{
		parents: [108, 105],
		author: 'rich',
		headline: 'merge the parser rewrite',
		body: '',
		touches: ['src/App.svelte'],
		additions: 40,
		deletions: 12
	},
	{
		parents: [107],
		author: 'simon',
		headline: 'inline the parser call',
		body: 'It was showing up in every profile we took.\n\nCloses #412.',
		touches: ['src/compiler.js'],
		additions: 12,
		deletions: 3
	},
	{
		parents: [106],
		author: 'rich',
		headline: 'document the new flag',
		body: '',
		touches: ['README.md'],
		additions: 4,
		deletions: 0
	},
	{
		parents: [104],
		author: 'simon',
		headline: 'make the compiler slow',
		body: '',
		touches: ['src/compiler.js'],
		additions: 900,
		deletions: 20
	},
	{
		parents: [104],
		author: 'rich',
		headline: 'start the parser rewrite',
		body: '',
		touches: ['src/App.svelte'],
		additions: 30,
		deletions: 8
	},
	{
		parents: [103],
		author: 'rich',
		headline: 'tidy the compiler',
		body: '',
		touches: ['src/compiler.js'],
		additions: 6,
		deletions: 6
	},
	{
		parents: [102],
		author: 'simon',
		headline: 'fix a typo in the readme',
		body: '',
		touches: ['README.md'],
		additions: 1,
		deletions: 1
	},
	{
		parents: [101],
		author: 'rich',
		headline: 'first cut of the compiler',
		body: '',
		touches: ['src/compiler.js'],
		additions: 200,
		deletions: 0
	},
	{
		parents: [100],
		author: 'rich',
		headline: 'add the readme',
		body: '',
		touches: ['README.md'],
		additions: 20,
		deletions: 0
	}
];

const HISTORY: HistoryStub[] = [
	...STRUCTURED.map((commit, i) => ({ ...commit, n: 109 - i })),
	...Array.from({ length: 100 }, (_, i) => {
		const n = 100 - i;
		return {
			n,
			parents: n > 1 ? [n - 1] : [],
			author: 'rich',
			headline: `groundwork ${n}`,
			body: '',
			touches: ['src/App.svelte'],
			additions: 3,
			deletions: 1
		};
	})
];

const BY_OID = new Map(HISTORY.map((commit) => [sha(commit.n), commit]));

/** Six lines, two of them added — enough to number both sides against. */
const COMPILER_PATCH = [
	'@@ -1,4 +1,5 @@',
	' // the compiler',
	"-import { parse } from './parse.js';",
	"+import { parse } from './parse.js';",
	"+import { tidy } from './tidy.js';",
	' ',
	' export function compile(source, options = {}) {'
].join('\n');

/** Past any sane render budget, which is the point. */
const BIG_PATCH = [
	'@@ -1,2000 +1,2000 @@',
	...Array.from({ length: 4000 }, (_, i) => (i % 2 === 1 ? '+' : ' ') + `line ${i + 1}`)
].join('\n');

interface DiffFileStub {
	filename: string;
	status: string;
	additions: number;
	deletions: number;
	patch?: string;
	previous_filename?: string;
}

const PATCHES: Record<number, DiffFileStub[]> = {
	// A binary blob beside a readable file: GitHub sends no patch for the first,
	// and a screen that rendered that as "nothing changed" would be lying.
	109: [
		{ filename: 'src/logo.png', status: 'modified', additions: 0, deletions: 0 },
		{
			filename: 'src/App.svelte',
			status: 'renamed',
			previous_filename: 'src/Old.svelte',
			additions: 40,
			deletions: 12,
			patch: COMPILER_PATCH
		}
	],
	108: [
		{
			filename: 'src/compiler.js',
			status: 'modified',
			additions: 12,
			deletions: 3,
			patch: COMPILER_PATCH
		}
	],
	106: [
		{
			filename: 'src/compiler.js',
			status: 'modified',
			additions: 900,
			deletions: 20,
			patch: BIG_PATCH
		}
	]
};

function logNode(commit: HistoryStub) {
	return {
		oid: sha(commit.n),
		abbreviatedOid: sha(commit.n).slice(0, 7),
		messageHeadline: commit.headline,
		messageBody: commit.body,
		committedDate: new Date(Date.UTC(2026, 0, 1) + commit.n * 3_600_000).toISOString(),
		additions: commit.additions,
		deletions: commit.deletions,
		changedFilesIfAvailable: PATCHES[commit.n]?.length ?? 1,
		author: {
			name: commit.author === 'rich' ? 'Rich Harris' : 'Simon',
			user: { login: commit.author }
		},
		parents: { nodes: commit.parents.map((parent) => ({ oid: sha(parent) })) }
	};
}

function restCommit(oid: string) {
	const found = BY_OID.get(oid);
	const files = found ? (PATCHES[found.n] ?? []) : [];

	return {
		sha: oid,
		commit: {
			message: found ? [found.headline, found.body].filter(Boolean).join('\n\n') : 'a commit',
			author: {
				name: found?.author ?? 'Rich Harris',
				email: 'rich@svelte.dev',
				date: found
					? new Date(Date.UTC(2026, 0, 1) + found.n * 3_600_000).toISOString()
					: '2026-07-01T09:00:00Z'
			},
			committer: null
		},
		author: { login: found?.author ?? 'rich' },
		parents: (found?.parents ?? []).map((parent) => ({ sha: sha(parent) })),
		stats: {
			additions: found?.additions ?? 0,
			deletions: found?.deletions ?? 0,
			total: (found?.additions ?? 0) + (found?.deletions ?? 0)
		},
		files
	};
}

interface Body {
	operationName?: string;
	variables?: Record<string, string | number | null>;
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
	/** File requests per path. */
	readonly files: Record<string, number>;
	/** Blame requests per path. Blame is the expensive one, so it is counted. */
	readonly blames: Record<string, number>;
	/** Log requests per scope path — `''` is the whole repository. */
	readonly logs: Record<string, number>;
	/** Commit requests per SHA. The REST read, and the one `enter` depends on. */
	readonly commits: Record<string, number>;
	/** Replace the handler for one operation mid-test. */
	on(
		operation: string,
		handler: (route: Route, variables: Record<string, string | number | null>) => unknown
	): void;
}

/**
 * Stubs the endpoint, signs in through the gate, and lands on the entry screen.
 * Routes survive a reload, which is what makes the durability tests possible.
 */
async function signIn(page: Page): Promise<Stub> {
	const calls: Record<string, number> = {};
	const trees: Record<string, number> = {};
	const files: Record<string, number> = {};
	const blames: Record<string, number> = {};
	const logs: Record<string, number> = {};
	const commits: Record<string, number> = {};

	const handlers: Record<
		string,
		(route: Route, variables: Record<string, string | number | null>) => unknown
	> = {
		Viewer: (route) => json(route, { data: { viewer: VIEWER, rateLimit: rateLimit(4999) } }),
		Repo: (route) => json(route, { data: { repository: REPOSITORY, rateLimit: rateLimit(4998) } }),
		Tree: (route, variables) => {
			// `rev:path` — the revision is ignored here on purpose, so a listing
			// asked for by SHA and by name is the same answer under two keys.
			const path = String(variables.expression ?? '')
				.split(':')
				.slice(1)
				.join(':');
			trees[path] = (trees[path] ?? 0) + 1;
			// A path that names a file resolves — to a blob. Which is what lets the
			// tree screen hand the address to the file screen.
			const object = TREES[path] ?? (FILES[path] ? { __typename: 'Blob' } : null);
			return json(route, {
				data: { repository: { object }, rateLimit: rateLimit(4997) }
			});
		},
		File: (route, variables) => {
			const path = String(variables.expression ?? '')
				.split(':')
				.slice(1)
				.join(':');
			files[path] = (files[path] ?? 0) + 1;
			const found = FILES[path];
			return json(route, {
				data: {
					repository: {
						object: found
							? {
									__typename: 'Blob',
									oid: found.oid,
									byteSize: found.byteSize,
									isBinary: found.isBinary ?? false,
									isTruncated: found.isTruncated ?? false,
									text: found.text
								}
							: (TREES[path] ?? null) && { __typename: 'Tree' }
					},
					rateLimit: rateLimit(4995)
				}
			});
		},
		Blame: (route, variables) => {
			const path = String(variables.path ?? '');
			blames[path] = (blames[path] ?? 0) + 1;
			return json(route, {
				data: {
					repository: {
						object: FILES[path] ? { __typename: 'Commit', blame: { ranges: BLAME_RANGES } } : null
					},
					rateLimit: rateLimit(4994)
				}
			});
		},
		Blob: (route, variables) => {
			const found = BLOBS[String(variables.oid ?? '')];
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
		},
		Log: (route, variables) => {
			const path = variables.path === null ? '' : String(variables.path ?? '');
			logs[path] = (logs[path] ?? 0) + 1;

			// A path-scoped history is not a slice of the unscoped one: git drops
			// the commits in between, which is exactly what makes the graph column
			// have to cope with a list that is no longer a chain.
			const all = path ? HISTORY.filter((commit) => commit.touches.includes(path)) : HISTORY;

			// The cursor is the index it ended at. GitHub's is opaque; ours only has
			// to be stable, because what is under test is that a page is *keyed* by
			// where it starts.
			const first = Number(variables.first ?? 50);
			const after = variables.after === null ? null : String(variables.after ?? '');
			const start = after ? Number(after) + 1 : 0;
			const slice = all.slice(start, start + first);

			return json(route, {
				data: {
					repository: {
						object: {
							__typename: 'Commit',
							history: {
								totalCount: all.length,
								pageInfo: {
									hasNextPage: start + slice.length < all.length,
									endCursor: slice.length > 0 ? String(start + slice.length - 1) : null
								},
								nodes: slice.map(logNode)
							}
						}
					},
					rateLimit: rateLimit(4993)
				}
			});
		}
	};

	// One commit and its patches is the only read in the app that is REST, so it
	// is the only one that does not come through the GraphQL endpoint.
	await page.route('https://api.github.com/repos/*/*/commits/*', async (route) => {
		const oid = route.request().url().split('/').pop() ?? '';
		commits[oid] = (commits[oid] ?? 0) + 1;
		await json(route, restCommit(oid));
	});

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
		files,
		blames,
		logs,
		commits,
		on(operation, handler) {
			handlers[operation] = handler;
		}
	};
}

/** The code viewer's rows. Each carries its line number as its id. */
function line(page: Page, n: number) {
	return page.locator(`#L${n}`);
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
		const path = String(variables.expression ?? '')
			.split(':')
			.slice(1)
			.join(':');
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

/* ------------------------------------------- Phase 4: the file and blame -- */

const COMPILER_JS = '/sveltejs/svelte/blob/HEAD/src/compiler.js';

async function openFile(page: Page, at = COMPILER_JS) {
	await page.goto(at);
	await expect(line(page, 1)).toBeVisible();
}

test('the file screen carries the file, its verbs and its panel', async ({ page }) => {
	await signIn(page);
	await openFile(page);

	// The verb row PLAN.md Phase 4 asks for, in order.
	for (const verb of ['View', 'Blame', 'Log', 'Raw', 'Permalink']) {
		await expect(page.getByRole('link', { name: verb, exact: true })).toBeVisible();
	}

	// Nine lines, numbered, with the file's own trailing newline not counted as
	// a tenth.
	await expect(page.getByRole('link', { name: 'Line 9' })).toBeVisible();
	await expect(page.getByRole('link', { name: 'Line 10' })).toHaveCount(0);

	const panel = page.getByRole('complementary', { name: 'Context' });
	await expect(panel.getByRole('heading').nth(0)).toHaveText('Since your last visit');
	await expect(panel).toContainText('JavaScript');
	await expect(panel).toContainText('89 KB');
	await expect(panel).toContainText('9');

	// The breadcrumb walks directories and ends on the file.
	await expect(page.getByRole('banner').getByRole('link', { name: 'src' })).toHaveAttribute(
		'href',
		'/sveltejs/svelte/tree/HEAD/src'
	);
});

test('the source is highlighted, and not one character of it is changed', async ({ page }) => {
	await signIn(page);
	await openFile(page);

	// Four kinds, and only four — DESIGN.md §3.
	await expect(line(page, 1).locator('.cm')).toHaveText('// the compiler');
	await expect(line(page, 2).locator('.kw').first()).toHaveText('import');
	await expect(line(page, 2).locator('.str')).toHaveText("'./parse.js'");
	await expect(line(page, 4).locator('.fn')).toHaveText('compile');
	await expect(line(page, 8).locator('.str')).toHaveText('"compiler"');

	// The scanner carries its state across the line break: line 7 is inside a
	// block comment that opened on line 6 and nothing on it opened one.
	await expect(line(page, 6).locator('.cm')).toHaveText('/* a block');
	await expect(line(page, 7).locator('.cm')).toHaveText('comment */');

	// Highlighting is a colour over the source, never a rewrite of it. The tab
	// is the test: it is the one character a template would quietly eat.
	expect(await line(page, 5).locator('code').textContent()).toBe('\tconst ast = parse(source);');
	expect(await line(page, 3).locator('code').textContent()).toBe('');
});

test('a hash addresses a line, and a range', async ({ page }) => {
	await signIn(page);
	await openFile(page, `${COMPILER_JS}#L5`);

	await expect(line(page, 5).locator('code')).toHaveClass(/pick/);
	await expect(line(page, 4).locator('code')).not.toHaveClass(/pick/);
	await expect(page.getByRole('complementary', { name: 'Context' })).toContainText('L5');

	await page.goto(`${COMPILER_JS}#L2-L4`);
	await expect(line(page, 2).locator('code')).toHaveClass(/pick/);
	await expect(line(page, 3).locator('code')).toHaveClass(/pick/);
	await expect(line(page, 4).locator('code')).toHaveClass(/pick/);
	await expect(line(page, 5).locator('code')).not.toHaveClass(/pick/);

	// The range survives the trip to the other view of the same file.
	await page.getByRole('link', { name: 'Blame', exact: true }).click();
	await expect(page).toHaveURL('/sveltejs/svelte/blame/HEAD/src/compiler.js#L2-L4');
	await expect(line(page, 3).locator('code')).toHaveClass(/pick/);
});

test('clicking a line number addresses it, and shift-click extends it', async ({ page }) => {
	await signIn(page);
	await openFile(page);

	await page.getByRole('link', { name: 'Line 3' }).click();
	await expect(page).toHaveURL(`${COMPILER_JS}#L3`);

	await page.getByRole('link', { name: 'Line 6' }).click({ modifiers: ['Shift'] });
	await expect(page).toHaveURL(`${COMPILER_JS}#L3-L6`);
	await expect(line(page, 5).locator('code')).toHaveClass(/pick/);

	// Two addresses in, and one step back leaves the file altogether: addressing
	// lines replaces history rather than piling it up.
	await page.goBack();
	await expect(page).toHaveURL('/');
});

test('j and k move the line cursor and enter addresses it', async ({ page }) => {
	await signIn(page);
	await openFile(page);

	// A screen you have just opened claims no line.
	await expect(page.locator('code.pick, code.at')).toHaveCount(0);

	await page.keyboard.press('j');
	await expect(line(page, 1).locator('code')).toHaveClass(/at/);
	await page.keyboard.press('j');
	await page.keyboard.press('j');
	await expect(line(page, 3).locator('code')).toHaveClass(/at/);
	await page.keyboard.press('k');
	await expect(line(page, 2).locator('code')).toHaveClass(/at/);

	await page.keyboard.press('Enter');
	await expect(page).toHaveURL(`${COMPILER_JS}#L2`);

	await page.keyboard.press('Escape');
	await expect(page).toHaveURL(COMPILER_JS);
});

test('blame is its own address, and repeated commits collapse into runs', async ({ page }) => {
	const stub = await signIn(page);
	await openFile(page);

	// Reading a file does not pay for blame. It is the most expensive query in
	// the app and it only belongs to the address that shows it.
	expect(stub.blames['src/compiler.js']).toBeUndefined();

	await page.goto('/sveltejs/svelte/blame/HEAD/src/compiler.js');
	await expect(line(page, 1).locator('.sha')).toHaveText('7777777');
	await expect(line(page, 1)).toContainText('rich');

	// Lines 2 and 3 share line 1's commit, so they render nothing at all.
	await expect(line(page, 2).locator('.sha')).toHaveCount(0);
	await expect(line(page, 3).locator('.sha')).toHaveCount(0);

	// A different commit starts a run...
	await expect(line(page, 4).locator('.sha')).toHaveText('8888888');
	await expect(line(page, 4)).toContainText('simon');

	// ...and the first commit coming back starts another, rather than being
	// swallowed because the same SHA was seen further up.
	await expect(line(page, 6).locator('.sha')).toHaveText('7777777');
	expect(stub.blames['src/compiler.js']).toBe(1);
});

test('hovering the blame verb warms it, so opening the gutter costs nothing', async ({ page }) => {
	const stub = await signIn(page);
	await openFile(page);

	await page.getByRole('link', { name: 'Blame', exact: true }).hover();
	await expect.poll(() => stub.blames['src/compiler.js']).toBe(1);

	await page.getByRole('link', { name: 'Blame', exact: true }).click();
	await expect(line(page, 1).locator('.sha')).toHaveText('7777777');

	// The gutter it opened was already on disk when it was asked for.
	expect(stub.blames['src/compiler.js']).toBe(1);
});

test('markup hands its script region to another grammar, and takes it back', async ({ page }) => {
	await signIn(page);
	await openFile(page, '/sveltejs/svelte/blob/HEAD/src/App.svelte');

	// The tag is markup, and the region it opens starts after the `>` — so the
	// attribute is still an attribute.
	await expect(line(page, 1).locator('.kw').first()).toHaveText('<script');
	await expect(line(page, 1).locator('.str')).toHaveText('"ts"');

	// Inside, on a line of its own, JavaScript.
	await expect(line(page, 2).locator('.kw')).toHaveText('let');
	await expect(line(page, 2).locator('.fn')).toHaveText('$state');

	// And back out, on a tag the inner grammar knows nothing about.
	await expect(line(page, 3).locator('.kw')).toHaveText('</script>');
	await expect(line(page, 5).locator('.cm')).toHaveText('<!-- a comment -->');
	await expect(line(page, 6).locator('.kw').first()).toHaveText('<button');

	await expect(page.getByRole('complementary', { name: 'Context' })).toContainText('Svelte');
});

test('a binary file says so, and offers the bytes', async ({ page }) => {
	await signIn(page);
	await page.goto('/sveltejs/svelte/blob/HEAD/src/logo.png');

	await expect(page.getByRole('main')).toContainText('This is a binary file');
	await expect(page.getByRole('main')).toContainText('39 KB');
	await expect(page.getByRole('link', { name: 'Open the raw bytes' })).toHaveAttribute(
		'href',
		'https://raw.githubusercontent.com/sveltejs/svelte/main/src/logo.png'
	);
	await expect(line(page, 1)).toHaveCount(0);

	// A verb that cannot act is absent: there are no lines here to attribute.
	await expect(page.getByRole('link', { name: 'Blame', exact: true })).toHaveCount(0);
	await expect(page.getByRole('link', { name: 'Raw', exact: true })).toBeVisible();
});

test('a four thousand line file renders as a window, and says it was cut short', async ({
	page
}) => {
	await signIn(page);
	await openFile(page, '/sveltejs/svelte/blob/HEAD/src/huge.txt');

	await expect(page.getByRole('status')).toContainText('sent a prefix of this file');

	const rendered = await page.getByRole('link', { name: /^Line \d+$/ }).count();
	expect(rendered).toBeGreaterThan(2);
	expect(rendered).toBeLessThan(140);
	await expect(line(page, 4000)).toHaveCount(0);

	// It virtualises against the page's scroller, like every other list here.
	await page.getByRole('main').evaluate((el) => el.scrollTo(0, el.scrollHeight));
	await expect(line(page, 4000)).toBeVisible();
	await expect(line(page, 1)).toHaveCount(0);

	// A deep link into the middle of it is a jump, not a step, so the line
	// arrives with the context that gives it its meaning rather than pinned to
	// the bottom edge of the screen.
	await page.goto('/sveltejs/svelte/blob/HEAD/src/huge.txt#L3000');
	await expect(line(page, 3000).locator('code')).toHaveClass(/pick/);
	await expect(line(page, 2990)).toBeVisible();
	await expect(line(page, 3010)).toBeVisible();
});

test('a file opens inside the app now, and hovering one warms it', async ({ page }) => {
	const stub = await signIn(page);

	// Arrive without the pointer over the listing. Navigating by mouse leaves it
	// resting wherever the new screen puts a row under it — which warms that row,
	// correctly, but is not the hover under test here.
	await page.goto('/sveltejs/svelte/tree/HEAD/src');
	await expect(listing(page).getByRole('link', { name: 'compiler.js' })).toBeVisible();
	expect(stub.files['src/compiler.js']).toBeUndefined();

	await listing(page).getByRole('link', { name: 'compiler.js' }).hover();
	await expect.poll(() => stub.files['src/compiler.js']).toBe(1);

	await listing(page).getByRole('link', { name: 'compiler.js' }).click();
	await expect(page).toHaveURL(COMPILER_JS);
	await expect(line(page, 1).locator('.cm')).toHaveText('// the compiler');

	// The screen it opened was already on disk when it was asked for.
	expect(stub.files['src/compiler.js']).toBe(1);
});

test('a tree address that names a file lands on the file screen', async ({ page }) => {
	await signIn(page);
	await page.goto('/sveltejs/svelte/tree/HEAD/src/compiler.js');

	// The address resolved — just to the other kind of object. Following it
	// beats telling someone their perfectly good URL was wrong.
	await expect(page).toHaveURL(COMPILER_JS);
	await expect(line(page, 1)).toBeVisible();
});

test('a readme code fence is read by the same scanner as the file screen', async ({ page }) => {
	await signIn(page);
	await openRepo(page);

	const main = page.getByRole('main');
	await expect(main.getByText('bun install')).toBeVisible();
	await expect(main.locator('pre .cm')).toHaveText('# get started');
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

/* ------------------------------------------------ Phase 5: the log screen -- */

const LOG = '/sveltejs/svelte/log/HEAD';
const MERGE = sha(109);
const INLINE = sha(108);
const SLOW = sha(106);

/** The commit table, as a set of rows you can go and read. */
function commitLog(page: Page) {
	return page.getByRole('navigation', { name: 'Commit log' });
}

function detailPane(page: Page) {
	return page.getByRole('region', { name: 'Selected commit' });
}

async function openLog(page: Page, at = LOG) {
	await page.goto(at);
	await expect(commitLog(page).getByRole('link').first()).toBeVisible();
}

test('the log screen carries its commits, its counts and its panel', async ({ page }) => {
	await signIn(page);
	await openLog(page);

	const rows = commitLog(page).getByRole('link');
	await expect(rows.nth(0)).toContainText('merge the parser rewrite');
	await expect(rows.nth(0)).toContainText(MERGE.slice(0, 7));
	await expect(rows.nth(1)).toContainText('inline the parser call');
	await expect(rows.nth(1)).toContainText('simon');

	// The raw counts sit beside the delta bar, so the bar never carries a
	// meaning on colour alone — DESIGN.md §9.
	await expect(rows.nth(1)).toContainText('+12');
	await expect(rows.nth(1)).toContainText('−3');

	// A page is fifty, and the screen says what it is not showing.
	await expect(page.getByRole('main')).toContainText('50 of 109 commits');

	const panel = page.getByRole('complementary', { name: 'Context' });
	await expect(panel.getByRole('heading').nth(0)).toHaveText('Since your last visit');
	await expect(panel.getByRole('heading').nth(1)).toHaveText('About');
	await expect(panel.getByRole('heading').nth(2)).toHaveText('Open against it');
	await expect(panel).toContainText('Whole repository');
	await expect(panel).toContainText('109');

	// The Log nav item is a destination now, and its count is the scope's.
	const sidebar = page.getByRole('navigation', { name: 'Primary' });
	await expect(sidebar.getByRole('link', { name: /Log/ })).toBeVisible();
});

test('the graph opens a lane for a merge and closes it where it rejoins', async ({ page }) => {
	await signIn(page);
	await openLog(page);

	// 109 merges 108 and 105, so a second lane opens on the first row...
	const rows = commitLog(page).getByRole('link');
	await expect(rows.nth(0).locator('.graph')).toHaveText('●╮');

	// ...carries down beside the spine while 105 is reached...
	await expect(rows.nth(4).locator('.graph')).toHaveText('│●');

	// ...and closes into 104, which is the parent both sides share.
	await expect(rows.nth(5).locator('.graph')).toHaveText('●╯');

	// Below the join there is one lane and it stays one lane.
	await expect(rows.nth(6).locator('.graph')).toHaveText('●');
});

test('j and k move a selection that starts unset, and the pane fills in two beats', async ({
	page
}) => {
	const stub = await signIn(page);
	await openLog(page);

	// A screen you have just opened claims none of its rows.
	await expect(commitLog(page).locator('[aria-current]')).toHaveCount(0);
	await expect(detailPane(page)).toHaveCount(0);

	await page.keyboard.press('j');
	await page.keyboard.press('j');

	const rows = commitLog(page).getByRole('link');
	await expect(rows.nth(1)).toHaveAttribute('aria-current', 'true');

	// The whole message is there immediately: it came with the log query, and
	// pressing `j` must never blank the screen.
	await expect(detailPane(page)).toContainText('inline the parser call');
	await expect(detailPane(page)).toContainText('showing up in every profile');

	// The file list is the second beat, and it is a different read.
	await expect(detailPane(page).getByRole('link', { name: /src\/compiler\.js/ })).toBeVisible();
	expect(stub.commits[INLINE]).toBe(1);

	await page.keyboard.press('k');
	await expect(detailPane(page)).toContainText('merge the parser rewrite');
});

test('enter opens the diff, and resting on the row already paid for it', async ({ page }) => {
	const stub = await signIn(page);
	await openLog(page);

	await page.keyboard.press('j');
	await page.keyboard.press('j');
	await expect(detailPane(page).getByRole('link', { name: /src\/compiler\.js/ })).toBeVisible();
	expect(stub.commits[INLINE]).toBe(1);

	await page.keyboard.press('Enter');
	await expect(page).toHaveURL(`/sveltejs/svelte/commit/${INLINE}`);
	await expect(page.getByRole('heading', { name: 'inline the parser call' })).toBeVisible();

	// The screen it opened was already on disk when it was asked for.
	expect(stub.commits[INLINE]).toBe(1);
});

test('the diff carries both line numbers, a sign per row and its hunk header', async ({ page }) => {
	await signIn(page);
	await page.goto(`/sveltejs/svelte/commit/${INLINE}`);

	await expect(page.getByText('@@ -1,4 +1,5 @@')).toBeVisible();
	await expect(page.getByRole('main')).toContainText('src/compiler.js');

	const removed = page.locator('.lrow.del');
	const added = page.locator('.lrow.add');
	await expect(removed).toHaveCount(1);
	await expect(added).toHaveCount(2);
	await expect(removed).toContainText("import { parse } from './parse.js';");

	// A removal advances the old side only, an addition the new side only. The
	// second added line is therefore new line 3 with no old number beside it.
	await expect(added.nth(1).locator('.new')).toHaveText('3');
	await expect(added.nth(1).locator('.old')).toHaveText('');
	await expect(removed.locator('.old')).toHaveText('2');

	// Colour is never the sole carrier — DESIGN.md §9.
	await expect(added.first().locator('.sign')).toHaveText('+');
	await expect(removed.locator('.sign')).toHaveText('−');
});

test('a binary file in a commit says so rather than showing an empty diff', async ({ page }) => {
	await signIn(page);
	await page.goto(`/sveltejs/svelte/commit/${MERGE}`);

	await expect(page.getByRole('main')).toContainText('Binary file');
	await expect(page.getByRole('main')).toContainText('src/logo.png');

	// A rename says where it came from, next to the file it became.
	await expect(page.getByRole('main')).toContainText('src/Old.svelte');

	// Both parents of a merge are reachable, and the panel says there are two.
	await expect(page.getByRole('link', { name: sha(105).slice(0, 7) })).toBeVisible();
	await expect(page.getByRole('complementary', { name: 'Context' })).toContainText('Parents');
});

test('a four thousand line diff renders as a window, not as a diff', async ({ page }) => {
	await signIn(page);
	await page.goto(`/sveltejs/svelte/commit/${SLOW}`);

	await expect(page.getByText('@@ -1,2000 +1,2000 @@')).toBeVisible();

	const rendered = await page.locator('.lrow').count();
	expect(rendered).toBeGreaterThan(2);
	expect(rendered).toBeLessThan(140);

	// It virtualises against the page's scroller, like every other list here.
	await page.getByRole('main').evaluate((el) => el.scrollTo(0, el.scrollHeight));
	await expect(page.getByText('line 4000', { exact: true })).toBeVisible();
});

test('the log scopes to a path, and the total follows the scope', async ({ page }) => {
	const stub = await signIn(page);
	await openFile(page);

	// The file screen's Log verb is internal now, and it warms what it opens.
	await page.getByRole('link', { name: 'Log', exact: true }).hover();
	await expect.poll(() => stub.logs['src/compiler.js']).toBe(1);

	await page.getByRole('link', { name: 'Log', exact: true }).click();
	await expect(page).toHaveURL('/sveltejs/svelte/log/HEAD/src/compiler.js');

	// Four commits touched it, out of a hundred and nine.
	await expect(commitLog(page).getByRole('link')).toHaveCount(4);
	await expect(page.getByRole('main')).toContainText('4 of 4 commits');
	await expect(page.getByRole('complementary', { name: 'Context' })).toContainText(
		'src/compiler.js'
	);

	// Filtering by path drops the commits in between, so the history is a list
	// rather than a graph — and it draws itself as one instead of leaking lanes.
	for (const row of await commitLog(page).getByRole('link').all()) {
		await expect(row.locator('.graph')).toHaveText('●');
	}

	// The scope was opened once, and the verb's hover is what paid for it.
	expect(stub.logs['src/compiler.js']).toBe(1);
});

test('the sidebar re-scopes the log, and the author filter says what it covers', async ({
	page
}) => {
	await signIn(page);
	await openLog(page);

	const sidebar = page.getByRole('navigation', { name: 'Primary' });

	// Scope is a segment: it changes the address and the total.
	await sidebar.getByRole('link', { name: 'README.md' }).click();
	await expect(page).toHaveURL('/sveltejs/svelte/log/HEAD/README.md');
	await expect(commitLog(page).getByRole('link')).toHaveCount(3);

	await sidebar.getByRole('link', { name: 'Whole repository' }).click();
	await expect(page).toHaveURL(LOG);

	// Author is a parameter: it narrows the view of the same address, and it is
	// honest about reaching only as far as what is loaded.
	await sidebar.getByRole('link', { name: /simon/ }).click();
	await expect(page).toHaveURL(`${LOG}?author=simon`);
	await expect(commitLog(page).getByRole('link')).toHaveCount(3);
	await expect(page.getByRole('main')).toContainText('3 of 50 loaded · 109 commits');
	await expect(page.getByRole('banner').getByText('simon')).toBeVisible();
});

test('a further page is fetched once, and walking back down it is free', async ({ page }) => {
	const stub = await signIn(page);
	await openLog(page);

	expect(stub.logs['']).toBe(1);
	await expect(page.getByRole('main')).toContainText('50 of 109 commits');

	await page.getByRole('button', { name: 'Load more' }).click();
	await expect(page.getByRole('main')).toContainText('100 of 109 commits');
	expect(stub.logs['']).toBe(2);

	await page.getByRole('button', { name: 'Load more' }).click();
	await expect(page.getByRole('main')).toContainText('109 of 109 commits');
	expect(stub.logs['']).toBe(3);
	await expect(page.getByRole('button', { name: 'Load more' })).toHaveCount(0);

	// Leave and come back, then walk the whole way down again. The first page is
	// inside its window and each page behind it is filed under the cursor that
	// fetched it, so the second walk costs nothing at all.
	await page.goto('/sveltejs/svelte');
	await expect(listing(page).getByRole('link', { name: 'README.md' })).toBeVisible();
	await openLog(page);

	await page.getByRole('button', { name: 'Load more' }).click();
	await expect(page.getByRole('main')).toContainText('100 of 109 commits');
	await page.getByRole('button', { name: 'Load more' }).click();
	await expect(page.getByRole('main')).toContainText('109 of 109 commits');

	expect(stub.logs['']).toBe(3);
});

test('the blame gutter opens a commit inside the app now', async ({ page }) => {
	await signIn(page);
	await page.goto('/sveltejs/svelte/blame/HEAD/src/compiler.js');
	await expect(line(page, 1).locator('.sha')).toHaveText('7777777');

	// The blame entry, not the line number beside it.
	await line(page, 1).locator('a.bl').click();
	await expect(page).toHaveURL('/sveltejs/svelte/commit/7777777777777777777777777777777777777777');
	await expect(page.getByRole('main')).toContainText('7777777');
});

test('the write verbs copy the command rather than pretending to write', async ({ page }) => {
	await signIn(page);
	await openLog(page);

	// No commit is selected, so the commit's verbs are not there to be pressed.
	await expect(page.getByRole('button', { name: 'Revert' })).toHaveCount(0);

	await page.keyboard.press('j');
	await page.getByRole('button', { name: 'Cherry-pick' }).click();

	// The label only flips once the clipboard actually took it.
	await expect(page.getByRole('button', { name: 'Copied' })).toBeVisible();
});

test('a commit is permanent, so its diff is never fetched twice', async ({ page }) => {
	const stub = await signIn(page);
	await page.goto(`/sveltejs/svelte/commit/${INLINE}`);
	await expect(page.getByText('@@ -1,4 +1,5 @@')).toBeVisible();
	expect(stub.commits[INLINE]).toBe(1);

	// A new document, a new store, nothing in memory — and it is addressed by
	// SHA, so it is immutable however stale everything around it goes.
	await expireMutable(page);
	await page.reload();
	await expect(page.getByText('@@ -1,4 +1,5 @@')).toBeVisible();

	expect(stub.commits[INLINE]).toBe(1);
});

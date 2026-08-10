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
 * Ten commits with a real shape — two merges, two side branches that rejoin,
 * and two authors — followed by ninety-nine linear ones so the log has a second
 * page.
 *
 * The shape is the point. Lanes only mean anything if something opens one and
 * something else closes it: 109 is a merge of 108 and 105, and 105 is a side
 * branch whose parent 104 is also 106's, so lane 1 opens on the first row and
 * merges back five rows later.
 *
 * 104 is where the second lane earns its keep. It is itself a merge — of 103
 * and 100, a side branch off 98 — so the row that takes one branch *in* is the
 * row that lets the next one *out*, and the column it frees is the column the
 * new one claims. One row per commit means both happen in the same cell, which
 * is the case a graph drawn from lane state gets wrong by drawing only the half
 * it noticed last.
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
		parents: [103, 100],
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
		parents: [99],
		author: 'rich',
		headline: 'add the readme',
		body: '',
		touches: ['README.md'],
		additions: 20,
		deletions: 0
	},
	// The side branch 104 merges. It forked from 98, so it is not an ancestor of
	// 104's first parent and the merge is a real one.
	{
		parents: [98],
		author: 'rich',
		headline: 'split the tidier out',
		body: '',
		touches: ['src/App.svelte'],
		additions: 14,
		deletions: 9
	}
];

const HISTORY: HistoryStub[] = [
	...STRUCTURED.map((commit, i) => ({ ...commit, n: 109 - i })),
	...Array.from({ length: 99 }, (_, i) => {
		const n = 99 - i;
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

/* ----------------------------------------------------- Phase 6: the refs -- */

/** When a commit landed. One place, because three stubs now need to agree. */
function commitDate(n: number): string {
	return new Date(Date.UTC(2026, 0, 1) + n * 3_600_000).toISOString();
}

/**
 * `main` is the repository stub's HEAD, which is not one of the history's own
 * SHAs — so the compare stub aliases it to the newest commit. Everything else
 * points at a real one.
 */
const AS_COMMIT = new Map<string, HistoryStub>([...BY_OID, [HEAD, HISTORY[0]]]);

interface BranchStub {
	name: string;
	commit: number | null;
	/** As read on screen: commits this branch has that `main` does not. */
	ahead: number;
	behind: number;
}

const BRANCHES: BranchStub[] = [
	{ name: 'main', commit: null, ahead: 0, behind: 0 },
	{ name: 'parser-rewrite', commit: 105, ahead: 6, behind: 2 },
	{ name: 'release/1.0', commit: 101, ahead: 0, behind: 12 }
];

interface TagStub {
	name: string;
	commit: number;
	/** Annotated tags carry a message; lightweight ones point straight at a commit. */
	message?: string;
}

/**
 * Three real releases and enough filler behind them to need a second page —
 * which is what makes "the tag before this one" a question the screen can get
 * wrong at a page boundary.
 */
const TAGS: TagStub[] = [
	{
		name: 'v1.2.0',
		commit: 109,
		message: 'The parser rewrite ships.\n\nCompiles are about a third faster.'
	},
	{ name: 'v1.1.0', commit: 106, message: 'Slow compiler, fast parser.' },
	{ name: 'v1.0.0', commit: 101 },
	...Array.from({ length: 117 }, (_, i) => ({
		name: `v0.${117 - i}.0`,
		commit: Math.max(1, 100 - i)
	}))
];

/** What a ref's target looks like once GitHub has resolved it. */
function tipNode(n: number) {
	const found = HISTORY.find((commit) => commit.n === n);
	return {
		__typename: 'Commit',
		oid: sha(n),
		abbreviatedOid: sha(n).slice(0, 7),
		messageHeadline: found?.headline ?? 'a commit',
		committedDate: commitDate(n),
		author: {
			name: found?.author === 'simon' ? 'Simon' : 'Rich Harris',
			user: { login: found?.author ?? 'rich' }
		}
	};
}

function branchNode(branch: BranchStub, withCompare: boolean) {
	return {
		name: branch.name,
		// **GitHub's own inversion**, reproduced deliberately: `Ref.compare` is
		// called with the ref as the *base*, so `aheadBy` is how far the default
		// branch has run ahead — which is this branch's behind. A screen that read
		// the fields straight through would pass every other test and report every
		// stale branch as a busy one.
		...(withCompare ? { compare: { aheadBy: branch.behind, behindBy: branch.ahead } } : {}),
		target:
			branch.commit === null
				? {
						__typename: 'Commit',
						oid: HEAD,
						abbreviatedOid: HEAD.slice(0, 7),
						messageHeadline: REPOSITORY.defaultBranchRef.target.messageHeadline,
						committedDate: REPOSITORY.defaultBranchRef.target.committedDate,
						author: { name: 'Rich', user: { login: 'rich' } }
					}
				: tipNode(branch.commit)
	};
}

function tagNode(tag: TagStub) {
	if (tag.message === undefined) return { name: tag.name, target: tipNode(tag.commit) };

	return {
		name: tag.name,
		target: {
			__typename: 'Tag',
			message: tag.message,
			tagger: { name: 'Rich Harris', date: commitDate(tag.commit), user: { login: 'rich' } },
			target: tipNode(tag.commit)
		}
	};
}

/**
 * `base...head` as GitHub sends it. The range is every commit strictly after
 * the older endpoint and up to the newer, oldest first — which is the order a
 * shortlog is printed in.
 */
function restCompare(range: string) {
	const [base = '', head = ''] = range.split('...');

	// A force push, as GitHub reports one: the old head is still reachable, but
	// it is no longer an ancestor of the new one, so the two have *diverged*
	// rather than the new one being ahead. That single word is the whole of
	// Phase 7's force-push detection.
	if (base === STALE_HEAD) {
		const between = HISTORY.filter((commit) => commit.n === 108 || commit.n === 109);
		return {
			status: 'diverged',
			ahead_by: 2,
			behind_by: 1,
			total_commits: between.length,
			base_commit: { sha: base, commit: { message: '', author: null }, author: null },
			merge_base_commit: { sha: sha(107), commit: { message: '', author: null }, author: null },
			commits: between.map(compareCommit),
			files: PULL_FILES[6] ?? []
		};
	}

	const from = AS_COMMIT.get(base);
	const to = AS_COMMIT.get(head);

	const lo = Math.min(from?.n ?? 0, to?.n ?? 0);
	const hi = Math.max(from?.n ?? 0, to?.n ?? 0);
	const between = HISTORY.filter((commit) => commit.n > lo && commit.n <= hi).sort(
		(a, b) => a.n - b.n
	);

	const files = new Map<string, DiffFileStub>();
	for (const commit of between) {
		for (const file of PATCHES[commit.n] ?? []) files.set(file.filename, file);
	}

	const forward = (to?.n ?? 0) >= (from?.n ?? 0);

	return {
		status: between.length === 0 ? 'identical' : forward ? 'ahead' : 'behind',
		ahead_by: forward ? between.length : 0,
		behind_by: forward ? 0 : between.length,
		total_commits: between.length,
		base_commit: { sha: base, commit: { message: '', author: null }, author: null },
		merge_base_commit: { sha: base, commit: { message: '', author: null }, author: null },
		commits: between.map(compareCommit),
		files: [...files.values()]
	};
}

function compareCommit(commit: HistoryStub) {
	return {
		sha: sha(commit.n),
		commit: {
			message: [commit.headline, commit.body].filter(Boolean).join('\n\n'),
			author: {
				name: commit.author === 'simon' ? 'Simon' : 'Rich Harris',
				email: 'dev@svelte.dev',
				date: commitDate(commit.n)
			}
		},
		author: { login: commit.author }
	};
}

/**
 * What a bare revision resolves to — the field Phase 6 adds to the tree and
 * file queries so Permalink works on a branch that is not the default one.
 */
const REV_OIDS: Record<string, string> = {
	'release/1.0': sha(101),
	'parser-rewrite': sha(105),
	'v1.2.0': sha(109)
};

function revOid(rev: string): string {
	if (/^[0-9a-f]{40}$/.test(rev)) return rev;
	return REV_OIDS[rev] ?? HEAD;
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

/* ------------------------------------------- Phase 8: since your last visit -- */

/**
 * `CODEOWNERS`, exercising the four things the parser has to get right: a
 * catch-all, an anchored path, a glob, and **last match wins** — `src/compiler.js`
 * is claimed by `*` on the first line and taken back on the second, and the
 * second is the one in force. `docs/` matches nothing, which is what keeps the
 * screen from reporting rules rather than files.
 */
const CODEOWNERS = [
	'# who to bother about what',
	'*                @rich',
	'src/compiler.js  @octant-user',
	'src/*.svelte     @octant-user @rich',
	'docs/            @simon'
].join('\n');

/* ---------------------------------------------------- Phase 7: the review -- */

/**
 * The head #6 had before it was rebased. It is deliberately *not* one of the
 * history's commits: a force-pushed SHA is reachable through the pull request's
 * timeline and nowhere else, which is exactly the situation the "since my last
 * review" diff has to survive.
 */
const STALE_HEAD = 'cafe0000cafe0000cafe0000cafe0000cafe0000';

interface PullStub {
	number: number;
	title: string;
	state: 'OPEN' | 'CLOSED' | 'MERGED';
	isDraft: boolean;
	head: string;
	headOid: string;
	base: string;
	author: string;
	additions: number;
	deletions: number;
	changedFiles: number;
	comments: number;
	decision: string | null;
	/** The rollup GitHub reports for the head commit. */
	checks: 'SUCCESS' | 'FAILURE' | 'PENDING' | null;
	mergeable?: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN';
}

const PULLS: PullStub[] = [
	{
		number: 7,
		title: 'Rewrite the parser',
		state: 'OPEN',
		isDraft: false,
		head: 'parser-rewrite',
		headOid: sha(105),
		base: 'main',
		author: 'simon',
		additions: 40,
		deletions: 12,
		changedFiles: 2,
		comments: 4,
		decision: 'REVIEW_REQUIRED',
		checks: 'FAILURE',
		mergeable: 'MERGEABLE'
	},
	{
		number: 6,
		title: 'Inline the parser call',
		state: 'OPEN',
		isDraft: false,
		head: 'inline-parse',
		headOid: STALE_HEAD,
		base: 'main',
		author: 'rich',
		additions: 12,
		deletions: 3,
		changedFiles: 1,
		comments: 0,
		decision: 'APPROVED',
		checks: 'SUCCESS',
		mergeable: 'CONFLICTING'
	},
	{
		number: 5,
		title: 'Document the new flag',
		state: 'MERGED',
		isDraft: false,
		head: 'docs',
		headOid: sha(107),
		base: 'main',
		author: 'rich',
		additions: 4,
		deletions: 0,
		changedFiles: 1,
		comments: 1,
		decision: null,
		checks: 'SUCCESS'
	},
	{
		number: 4,
		title: 'Type the whole compiler',
		state: 'OPEN',
		isDraft: true,
		head: 'types',
		headOid: sha(103),
		base: 'main',
		author: 'simon',
		additions: 300,
		deletions: 150,
		// Past one page of GitHub's file endpoint, which is what makes the walk
		// a walk rather than a single read.
		changedFiles: 150,
		comments: 0,
		decision: null,
		checks: null
	}
];

const BY_NUMBER = new Map(PULLS.map((pull) => [pull.number, pull]));

/** One page of a large diff, so the second page is a different set of rows. */
const WIDE_FILES: DiffFileStub[] = Array.from({ length: 150 }, (_, i) => ({
	filename: `src/typed-${String(i).padStart(3, '0')}.ts`,
	status: 'modified',
	additions: 2,
	deletions: 1,
	patch: ['@@ -1,1 +1,2 @@', ' const a = 1;', '+const b = 2;'].join('\n')
}));

const PULL_FILES: Record<number, DiffFileStub[]> = {
	7: [
		{
			filename: 'src/compiler.js',
			status: 'modified',
			additions: 12,
			deletions: 3,
			patch: COMPILER_PATCH
		},
		{
			filename: 'src/App.svelte',
			status: 'renamed',
			previous_filename: 'src/Old.svelte',
			additions: 28,
			deletions: 9,
			patch: COMPILER_PATCH
		}
	],
	6: [
		{
			filename: 'src/compiler.js',
			status: 'modified',
			additions: 12,
			deletions: 3,
			patch: COMPILER_PATCH
		}
	],
	5: [
		{ filename: 'README.md', status: 'modified', additions: 4, deletions: 0, patch: COMPILER_PATCH }
	],
	4: WIDE_FILES
};

interface ThreadStub {
	id: string;
	path: string;
	/** Where it sits on the diff now. `null` once the line has moved. */
	line: number | null;
	originalLine: number;
	side: 'LEFT' | 'RIGHT';
	isResolved: boolean;
	comments: { author: string; body: string; commit: string }[];
}

/**
 * Three threads over two files, and the middle one has lost its line. That is
 * the case PLAN.md Phase 7 warns about: GitHub sends `line: null` and only
 * `originalLine` survives, so the only thing that can place the comment is the
 * commit it was written against.
 */
const THREADS: ThreadStub[] = [
	{
		id: 'T_app',
		path: 'src/App.svelte',
		line: 3,
		originalLine: 3,
		side: 'RIGHT',
		isResolved: false,
		comments: [
			{ author: 'rich', body: 'This import is doing **two** things.', commit: sha(105) },
			{ author: 'simon', body: 'Split in the next push.', commit: sha(105) }
		]
	},
	{
		id: 'T_moved',
		path: 'src/compiler.js',
		line: null,
		originalLine: 9,
		side: 'RIGHT',
		isResolved: false,
		comments: [{ author: 'rich', body: 'Was this ever measured?', commit: sha(101) }]
	},
	{
		id: 'T_done',
		path: 'src/compiler.js',
		line: 3,
		originalLine: 3,
		side: 'RIGHT',
		isResolved: true,
		comments: [{ author: 'simon', body: 'Fixed.', commit: sha(105) }]
	}
];

const CHECK_RUNS: Record<string, unknown[]> = {
	FAILURE: [
		{
			__typename: 'CheckRun',
			name: 'unit',
			conclusion: 'SUCCESS',
			status: 'COMPLETED',
			detailsUrl: null
		},
		{
			__typename: 'CheckRun',
			name: 'lint',
			conclusion: 'FAILURE',
			status: 'COMPLETED',
			detailsUrl: null
		}
	],
	SUCCESS: [
		{
			__typename: 'CheckRun',
			name: 'unit',
			conclusion: 'SUCCESS',
			status: 'COMPLETED',
			detailsUrl: null
		},
		{ __typename: 'StatusContext', context: 'ci/legacy', state: 'SUCCESS', targetUrl: null }
	],
	PENDING: [
		{
			__typename: 'CheckRun',
			name: 'unit',
			conclusion: null,
			status: 'IN_PROGRESS',
			detailsUrl: null
		}
	]
};

function rollup(state: string | null) {
	if (!state) return null;
	const nodes = CHECK_RUNS[state] ?? [];
	return { state, contexts: { totalCount: nodes.length, nodes } };
}

function pullListNode(pull: PullStub) {
	return {
		number: pull.number,
		title: pull.title,
		state: pull.state,
		isDraft: pull.isDraft,
		createdAt: commitDate(90),
		updatedAt: commitDate(100 + pull.number),
		baseRefName: pull.base,
		headRefName: pull.head,
		headRefOid: pull.headOid,
		additions: pull.additions,
		deletions: pull.deletions,
		changedFiles: pull.changedFiles,
		author: { login: pull.author },
		reviewDecision: pull.decision,
		comments: { totalCount: pull.comments },
		commits: { nodes: [{ commit: { statusCheckRollup: rollup(pull.checks) } }] }
	};
}

function threadNode(thread: ThreadStub) {
	return {
		id: thread.id,
		isResolved: thread.isResolved,
		isOutdated: thread.line === null,
		path: thread.path,
		line: thread.line,
		startLine: null,
		originalLine: thread.originalLine,
		diffSide: thread.side,
		resolvedBy: thread.isResolved ? { login: 'rich' } : null,
		comments: {
			totalCount: thread.comments.length,
			nodes: thread.comments.map((comment, i) => ({
				id: `${thread.id}-${i}`,
				author: { login: comment.author, avatarUrl: `https://avatars.test/${comment.author}.png` },
				body: comment.body,
				createdAt: commitDate(100),
				outdated: thread.line === null,
				originalCommit: { oid: comment.commit },
				url: `https://github.com/sveltejs/svelte/pull/7#discussion_${thread.id}`
			}))
		}
	};
}

function pullDetailNode(pull: PullStub, headOid: string) {
	return {
		...pullListNode(pull),
		headRefOid: headOid,
		body: 'The parser rewrite, at last.',
		isCrossRepository: false,
		mergedAt: pull.state === 'MERGED' ? commitDate(108) : null,
		closedAt: null,
		baseRefOid: HEAD,
		mergeable: pull.mergeable ?? 'UNKNOWN',
		url: `https://github.com/sveltejs/svelte/pull/${pull.number}`,
		author: { login: pull.author, avatarUrl: `https://avatars.test/${pull.author}.png` },
		totalCommits: { totalCount: 3 },
		commits: { nodes: [{ commit: { oid: headOid, statusCheckRollup: rollup(pull.checks) } }] },
		latestReviews: {
			nodes:
				pull.decision === 'APPROVED'
					? [
							{
								id: 'R1',
								state: 'APPROVED',
								author: { login: 'rich', avatarUrl: null },
								submittedAt: commitDate(107),
								body: '',
								url: ''
							}
						]
					: []
		},
		reviewThreads:
			pull.number === 7
				? {
						totalCount: THREADS.length,
						pageInfo: { hasNextPage: false },
						nodes: THREADS.map(threadNode)
					}
				: { totalCount: 0, pageInfo: { hasNextPage: false }, nodes: [] }
	};
}

/* --------------------------------------------------- The home screen: you -- */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/**
 * What the account can see. Three repositories with something to say, and
 * enough filler behind them to need a second page — which is what makes the
 * home screen's walk a walk rather than a button nobody has pressed.
 *
 * The push dates are relative to now, because the whole point of the first
 * block is a comparison against a `visits` record, and a record is written at
 * the time the test runs.
 */
interface ViewerRepoStub {
	nameWithOwner: string;
	description: string | null;
	isPrivate?: boolean;
	isArchived?: boolean;
	isFork?: boolean;
	pushedAgo: number;
	openPulls: number;
}

const VIEWER_REPOS: ViewerRepoStub[] = [
	{
		nameWithOwner: 'sveltejs/svelte',
		description: 'web development for the rest of us',
		pushedAgo: HOUR,
		openPulls: 7
	},
	{
		nameWithOwner: 'octant-user/dotfiles',
		description: 'the shell, as configured',
		isPrivate: true,
		pushedAgo: 30 * DAY,
		openPulls: 0
	},
	{
		nameWithOwner: 'octant-user/notes',
		description: 'things I wrote down',
		isArchived: true,
		pushedAgo: 400 * DAY,
		openPulls: 0
	},
	...Array.from({ length: 49 }, (_, i) => ({
		nameWithOwner: `octant-user/repo-${String(i).padStart(2, '0')}`,
		description: null,
		pushedAgo: (i + 2) * DAY,
		openPulls: 0
	}))
];

function viewerRepoNode(stub: ViewerRepoStub) {
	return {
		nameWithOwner: stub.nameWithOwner,
		description: stub.description,
		isPrivate: stub.isPrivate ?? false,
		isArchived: stub.isArchived ?? false,
		isFork: stub.isFork ?? false,
		pushedAt: new Date(Date.now() - stub.pushedAgo).toISOString(),
		pullRequests: { totalCount: stub.openPulls }
	};
}

/**
 * Which pull requests each of the two searches comes back with. **#6 is in
 * both** — you opened it and then asked somebody to look at it — which is the
 * case the merge exists for: one row carrying two facts, not two rows.
 */
const INBOX_MINE = [6, 4];
const INBOX_REQUESTED = [7, 6];

function inboxNode(number: number, mine: boolean) {
	const pull = BY_NUMBER.get(number);
	if (!pull) return null;

	return {
		...pullListNode(pull),
		// The `author:@me` search returns what you wrote, so it is yours whatever
		// the fixture says.
		author: { login: mine ? VIEWER.login : pull.author },
		repository: { nameWithOwner: REPOSITORY.nameWithOwner, isPrivate: REPOSITORY.isPrivate }
	};
}

function searchNode(numbers: number[], mine: boolean) {
	return {
		issueCount: numbers.length,
		nodes: numbers.map((number) => inboxNode(number, mine)).filter(Boolean)
	};
}

interface Body {
	operationName?: string;
	variables?: Record<string, string | number | boolean | null>;
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
	/** Ref requests per kind. Two walks, so two counters. */
	readonly refs: Record<string, number>;
	/** Compare requests per `base...head`. A tag's changelog turns on this. */
	readonly compares: Record<string, number>;
	/** Pull request list requests per state filter. */
	readonly pulls: Record<string, number>;
	/** One pull request's own query, per number. */
	readonly pull: Record<string, number>;
	/** The REST file endpoint, per `number:page`. The heaviest read in the app. */
	readonly pullFiles: Record<string, number>;
	/** `CODEOWNERS` reads, per revision. Every screen consults it, so it is counted. */
	readonly owners: Record<string, number>;
	/** The account's repository list, per cursor. The home screen's walk. */
	readonly repos: Record<string, number>;
	/** Move a pull request's head, as a push does. */
	push(number: number, oid: string): void;
	/**
	 * Replace the handler for one operation mid-test, and hand back the one it
	 * replaced — so a test that only wants to change half of an operation's
	 * answer can delegate the other half rather than restating it.
	 */
	on(operation: string, handler: Handler): Handler | undefined;
}

type Handler = (
	route: Route,
	variables: Record<string, string | number | boolean | null>
) => unknown;

/**
 * Stubs the endpoint, signs in through the gate, and lands on the home screen.
 * Routes survive a reload, which is what makes the durability tests possible.
 */
async function signIn(page: Page): Promise<Stub> {
	const calls: Record<string, number> = {};
	const trees: Record<string, number> = {};
	const files: Record<string, number> = {};
	const blames: Record<string, number> = {};
	const logs: Record<string, number> = {};
	const commits: Record<string, number> = {};
	const refs: Record<string, number> = {};
	const compares: Record<string, number> = {};
	const pulls: Record<string, number> = {};
	const pull: Record<string, number> = {};
	const pullFiles: Record<string, number> = {};
	const owners: Record<string, number> = {};
	const repos: Record<string, number> = {};

	/**
	 * The head a pull request currently reports. Mutable so a test can push to a
	 * branch mid-session, which is the only way to have a *last* review that is
	 * not also the current one.
	 */
	const heads = new Map(PULLS.map((entry) => [entry.number, entry.headOid]));

	const handlers: Record<string, Handler> = {
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
				data: {
					repository: {
						object,
						// Phase 6: the revision resolves to a commit in the same round
						// trip, which is what Permalink addresses.
						commit: { __typename: 'Commit', oid: revOid(String(variables.rev ?? 'HEAD')) }
					},
					rateLimit: rateLimit(4997)
				}
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
							: (TREES[path] ?? null) && { __typename: 'Tree' },
						commit: { __typename: 'Commit', oid: revOid(String(variables.rev ?? 'HEAD')) }
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
		},
		Refs: (route, variables) => {
			const tag = String(variables.prefix ?? '') === 'refs/tags/';
			const kind = tag ? 'tag' : 'branch';
			refs[kind] = (refs[kind] ?? 0) + 1;

			const first = Number(variables.first ?? 100);
			const after = variables.after == null ? null : String(variables.after);
			const start = after ? Number(after) + 1 : 0;

			// Deliberately handed back in an order the screen must not trust: the
			// branch list arrives alphabetically, which is what `refs(orderBy:)`
			// degrades to outside `refs/tags/`.
			const all = tag
				? TAGS.map(tagNode)
				: [...BRANCHES]
						.sort((a, b) => a.name.localeCompare(b.name))
						.map((branch) => branchNode(branch, variables.withCompare === true));

			const slice = all.slice(start, start + first);

			return json(route, {
				data: {
					repository: {
						refs: {
							totalCount: all.length,
							pageInfo: {
								hasNextPage: start + slice.length < all.length,
								endCursor: slice.length > 0 ? String(start + slice.length - 1) : null
							},
							nodes: slice
						}
					},
					rateLimit: rateLimit(4992)
				}
			});
		},
		Pulls: (route, variables) => {
			const states = variables.states as unknown as string[] | null;
			const key = states ? states.join('+') : 'all';
			pulls[key] = (pulls[key] ?? 0) + 1;

			const all = PULLS.filter((entry) => !states || states.includes(entry.state)).map((entry) =>
				pullListNode({ ...entry, headOid: heads.get(entry.number) ?? entry.headOid })
			);

			const first = Number(variables.first ?? 50);
			const after = variables.after == null ? null : String(variables.after);
			const start = after ? Number(after) + 1 : 0;
			const slice = all.slice(start, start + first);

			return json(route, {
				data: {
					repository: {
						pullRequests: {
							totalCount: all.length,
							pageInfo: {
								hasNextPage: start + slice.length < all.length,
								endCursor: slice.length > 0 ? String(start + slice.length - 1) : null
							},
							nodes: slice
						}
					},
					rateLimit: rateLimit(4991)
				}
			});
		},
		Owners: (route, variables) => {
			// The three aliased expressions are one query, which is the whole point
			// of the document — the stub answers all three and only one has a blob.
			const rev = String(variables.root ?? '').split(':')[0];
			owners[rev] = (owners[rev] ?? 0) + 1;

			return json(route, {
				data: {
					repository: {
						github: null,
						root: { __typename: 'Blob', text: CODEOWNERS, isTruncated: false },
						docs: null
					},
					rateLimit: rateLimit(4989)
				}
			});
		},
		Repos: (route, variables) => {
			const first = Number(variables.first ?? 50);
			const after = variables.after == null ? null : String(variables.after);
			const start = after ? Number(after) + 1 : 0;
			repos[after ?? 'head'] = (repos[after ?? 'head'] ?? 0) + 1;

			const slice = VIEWER_REPOS.slice(start, start + first);

			return json(route, {
				data: {
					viewer: {
						repositories: {
							totalCount: VIEWER_REPOS.length,
							pageInfo: {
								hasNextPage: start + slice.length < VIEWER_REPOS.length,
								endCursor: slice.length > 0 ? String(start + slice.length - 1) : null
							},
							nodes: slice.map(viewerRepoNode)
						}
					},
					rateLimit: rateLimit(4988)
				}
			});
		},
		Inbox: (route) =>
			json(route, {
				data: {
					mine: searchNode(INBOX_MINE, true),
					requested: searchNode(INBOX_REQUESTED, false),
					rateLimit: rateLimit(4987)
				}
			}),
		Pull: (route, variables) => {
			const number = Number(variables.number ?? 0);
			pull[String(number)] = (pull[String(number)] ?? 0) + 1;

			const found = BY_NUMBER.get(number);
			return json(route, {
				data: {
					repository: {
						pullRequest: found ? pullDetailNode(found, heads.get(number) ?? found.headOid) : null
					},
					rateLimit: rateLimit(4990)
				}
			});
		}
	};

	// A commit's patches and a range's are the two reads that are REST, because
	// GraphQL has no patch field. They are the only ones not on the endpoint.
	await page.route('https://api.github.com/repos/*/*/commits/*', async (route) => {
		const oid = route.request().url().split('/').pop() ?? '';
		commits[oid] = (commits[oid] ?? 0) + 1;
		await json(route, restCommit(oid));
	});

	await page.route('https://api.github.com/repos/*/*/compare/*', async (route) => {
		const range = decodeURIComponent(route.request().url().split('/compare/').pop() ?? '');
		compares[range] = (compares[range] ?? 0) + 1;
		await json(route, restCompare(range));
	});

	// A pull request's own diff. A regular expression rather than a glob, because
	// this is the one endpoint we call with a query string.
	await page.route(/\/repos\/[^/]+\/[^/]+\/pulls\/\d+\/files/, async (route) => {
		const url = new URL(route.request().url());
		const number = Number(url.pathname.split('/').at(-2));
		const perPage = Number(url.searchParams.get('per_page') ?? 100);
		const pageNumber = Number(url.searchParams.get('page') ?? 1);

		pullFiles[`${number}:${pageNumber}`] = (pullFiles[`${number}:${pageNumber}`] ?? 0) + 1;

		const all = PULL_FILES[number] ?? [];
		const start = (pageNumber - 1) * perPage;
		const slice = all.slice(start, start + perPage);

		const more = start + slice.length < all.length;

		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			// `Link: rel="next"` is how REST says there is another page, and it is
			// the only thing `pages()` has to go on for this endpoint. It is not a
			// CORS-safelisted response header, so GitHub exposes it explicitly —
			// and so must the stub, or the browser hides it from us exactly as it
			// would in production.
			headers: {
				'access-control-expose-headers': 'Link, ETag',
				...(more
					? { link: `<${url.origin}${url.pathname}?page=${pageNumber + 1}>; rel="next"` }
					: {})
			},
			body: JSON.stringify(slice)
		});
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
	await expect(page.getByRole('heading', { name: 'Repositories' })).toBeVisible();

	return {
		calls,
		trees,
		files,
		blames,
		logs,
		commits,
		refs,
		compares,
		pulls,
		pull,
		pullFiles,
		owners,
		repos,
		push(number, oid) {
			heads.set(number, oid);
		},
		on(operation, handler) {
			const was = handlers[operation];
			handlers[operation] = handler;
			return was;
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

/** The home screen's two lists. Rows are links because they go somewhere. */
function repoList(page: Page) {
	return page.getByRole('navigation', { name: 'Repositories' });
}

function inboxList(page: Page) {
	return page.getByRole('navigation', { name: 'Open pull requests' });
}

/** Land on the home screen with both lists filled in. */
async function openHome(page: Page, at = '/') {
	await page.goto(at);
	await expect(repoList(page).getByRole('link', { name: /sveltejs\/svelte/ })).toBeVisible();
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
 * Write a `visits` record by hand — a previous visit, without having to have
 * made one. "Since your last visit" is measured from a SHA on disk, so seeding
 * that SHA is the whole setup for every test of it, and it is the only way to
 * have a *last* visit that is not also this one.
 */
async function seedVisit(page: Page, id: string, sha: string | null) {
	await page.evaluate(
		async ({ id, sha }) => {
			const db = await new Promise<IDBDatabase>((resolve, reject) => {
				const request = indexedDB.open('octant');
				request.onsuccess = () => resolve(request.result);
				request.onerror = () => reject(request.error);
			});

			await new Promise<void>((resolve, reject) => {
				const tx = db.transaction('visits', 'readwrite');
				tx.objectStore('visits').put(
					{ lastSeenAt: Date.now() - 172_800_000, lastSeenSha: sha, shas: sha ? [sha] : [] },
					id
				);
				tx.oncomplete = () => resolve();
				tx.onerror = () => reject(tx.error);
			});

			db.close();
		},
		{ id, sha }
	);
}

/** Read one back, which is how "the visit was recorded" is asserted. */
async function readVisit(page: Page, id: string) {
	return page.evaluate(async (id) => {
		const db = await new Promise<IDBDatabase>((resolve, reject) => {
			const request = indexedDB.open('octant');
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});

		const record = await new Promise<{ lastSeenSha: string | null; shas?: string[] } | undefined>(
			(resolve, reject) => {
				const request = db.transaction('visits', 'readonly').objectStore('visits').get(id);
				request.onsuccess = () => resolve(request.result);
				request.onerror = () => reject(request.error);
			}
		);

		db.close();
		return record ?? null;
	}, id);
}

const REPO_VISIT = 'repo:sveltejs/svelte';

/** The right panel, which is where every screen says what moved. */
function context(page: Page) {
	return page.getByRole('complementary', { name: 'Context' });
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

test('the source returns typed data the listing renders as git reads it', async ({ page }) => {
	const stub = await signIn(page);
	await openRepo(page);

	// Mode symbolically rather than as six octal digits, size formatted,
	// directories first.
	const rows = listing(page).getByRole('link');
	await expect(rows.nth(0)).toContainText('big');
	await expect(rows.nth(1)).toContainText('src');
	await expect(rows.nth(2)).toContainText('README.md');
	await expect(listing(page).getByText('drwxr-xr-x').first()).toBeVisible();
	await expect(listing(page).getByText('-rw-r--r--')).toBeVisible();
	await expect(listing(page).getByText('2.0 KB')).toBeVisible();

	// The octal is still the truth underneath, and the title says so.
	await expect(listing(page).getByTitle('100644')).toBeVisible();

	expect(stub.calls.Repo).toBe(1);
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

test('the verbs live in the header now, beside the pills they act on', async ({ page }) => {
	await signIn(page);
	await openRepo(page);

	// There is one row of chrome above the content, not two.
	const banner = page.getByRole('banner');
	await expect(banner.getByRole('link', { name: 'Archive' })).toHaveAttribute(
		'href',
		'https://github.com/sveltejs/svelte/archive/main.zip'
	);

	// And the row that used to carry them, with the object's name repeated from
	// the breadcrumb, is gone.
	await expect(banner.getByRole('link', { name: 'Files', exact: true })).toHaveCount(0);
	await expect(banner.getByRole('button', { name: 'Files', exact: true })).toHaveCount(0);

	// The tree carries one verb, and it is the one that does something the
	// screen cannot. `Copy path` handed back what the breadcrumb is already
	// spelling out, and `Permalink` re-addressed a listing you are reading; both
	// are gone from here and both still exist where they answer a question — on
	// a file, and on a commit.
	await expect(banner.getByRole('button', { name: 'Copy path' })).toHaveCount(0);
	await expect(banner.getByRole('link', { name: 'Permalink' })).toHaveCount(0);
});

test('the context panel collapses, and stays collapsed across a reload', async ({ page }) => {
	await signIn(page);
	await openRepo(page);

	await expect(context(page)).toBeVisible();

	await page.getByRole('button', { name: 'Hide the context panel' }).click();
	await expect(context(page)).toHaveCount(0);

	// It is a preference, not a per-screen mode: it survives a navigation and a
	// reload, which is the whole reason it is written down.
	await page.getByRole('link', { name: 'src', exact: true }).first().click();
	await expect(context(page)).toHaveCount(0);

	await page.reload();
	await expect(page.getByRole('button', { name: 'Show the context panel' })).toBeVisible();
	await expect(context(page)).toHaveCount(0);

	await page.getByRole('button', { name: 'Show the context panel' }).click();
	await expect(context(page)).toBeVisible();
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

test('a tree addressed by SHA is permanent, however stale the branch has gone', async ({
	page
}) => {
	const stub = await signIn(page);
	await openRepo(page);

	// The tree stopped carrying a Permalink verb of its own — a listing you are
	// already reading does not need a second address in the chrome — but the
	// address it made is still an address, and it is still the permanent one.
	await page.goto(`/sveltejs/svelte/tree/${HEAD}`);
	await expect(listing(page).getByRole('link', { name: 'README.md' })).toBeVisible();

	// A different address, so it is fetched once...
	await expect.poll(() => stub.trees['']).toBe(2);

	// ...and then never again, however stale everything around it has gone. That
	// is the whole point: a named branch has a freshness window and a SHA does
	// not.
	await expireMutable(page);
	await page.goto('/sveltejs/svelte/tree/main');
	await expect(listing(page).getByRole('link', { name: 'README.md' })).toBeVisible();
	await page.goto(`/sveltejs/svelte/tree/${HEAD}`);
	await expect(listing(page).getByRole('link', { name: 'README.md' })).toBeVisible();

	expect(stub.trees['']).toBe(3);
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

/**
 * What one row of the graph column is drawing: the lane its dot sits in, and
 * how many of each kind of edge leave, arrive or run past it.
 */
async function lanes(page: Page, index: number) {
	const svg = commitLog(page).getByRole('link').nth(index).locator('svg.graph');
	await expect(svg).toBeVisible();
	const count = async (kind: string) => await svg.locator(`path.${kind}`).count();
	return {
		lane: await svg.getAttribute('data-lane'),
		up: (await count('up')) === 1,
		down: (await count('down')) === 1,
		joins: await count('join'),
		forks: await count('fork'),
		through: await count('through')
	};
}

test('the graph opens a lane for a merge and closes it where it rejoins', async ({ page }) => {
	await signIn(page);
	await openLog(page);

	// 109 merges 108 and 105, so a second lane forks off the first row. Nothing
	// runs into the dot: it is the tip of what is loaded.
	expect(await lanes(page, 0)).toEqual({
		lane: '0',
		up: false,
		down: true,
		joins: 0,
		forks: 1,
		through: 0
	});

	// The forked lane carries down beside the spine...
	expect(await lanes(page, 1)).toMatchObject({ lane: '0', through: 1, joins: 0, forks: 0 });

	// ...until 105 is reached, which is in it rather than on the spine.
	expect(await lanes(page, 4)).toMatchObject({ lane: '1', up: true, down: true, through: 1 });

	// 104 is where it rejoins, and 104 is a merge in its own right — so the
	// column 105 gives back is the column 100 takes. One row carries both edges:
	// a branch arriving from above and a different branch leaving below. Drawn
	// as a join alone the four rows of lane under it would run from nothing.
	expect(await lanes(page, 5)).toEqual({
		lane: '0',
		up: true,
		down: true,
		joins: 1,
		forks: 1,
		through: 0
	});

	// The reopened lane is a lane like any other: it runs past...
	expect(await lanes(page, 6)).toMatchObject({ lane: '0', through: 1 });
	expect(await lanes(page, 8)).toMatchObject({ lane: '0', through: 1 });

	// ...reaches 100...
	expect(await lanes(page, 9)).toMatchObject({ lane: '1', up: true, down: true, through: 1 });

	// ...and joins the spine at 98, which both sides share. 99 is only the row
	// before it, still on the spine with the other lane running past.
	expect(await lanes(page, 10)).toMatchObject({ lane: '0', through: 1, joins: 0 });
	expect(await lanes(page, 11)).toMatchObject({ lane: '0', joins: 1, forks: 0, through: 0 });

	// Below the join there is one lane and it stays one lane.
	expect(await lanes(page, 12)).toEqual({
		lane: '0',
		up: true,
		down: true,
		joins: 0,
		forks: 0,
		through: 0
	});
});

test('the lanes meet across rows — the column is one drawing, not a glyph per cell', async ({
	page
}) => {
	await signIn(page);
	await openLog(page);

	// This is the whole reason the column stopped being box-drawing characters.
	// A glyph is ink inside a 12px line box dropped into a 32px row, so a lane
	// running through ten commits came out as ten dashes with gaps. Every edge
	// is drawn against the row's real height now, so where one row's lane leaves
	// the bottom is exactly where the next one's enters the top.
	const rows = commitLog(page).getByRole('link');
	const first = await rows.nth(1).locator('svg.graph').boundingBox();
	const second = await rows.nth(2).locator('svg.graph').boundingBox();
	expect(first).not.toBeNull();
	expect(second).not.toBeNull();
	expect(first!.height).toBe(32);
	expect(first!.y + first!.height).toBeCloseTo(second!.y, 1);

	// A lane that runs past a commit spans the row top to bottom, and the two
	// halves of a lane the commit sits in meet at the dot.
	await expect(rows.nth(1).locator('path.through')).toHaveAttribute('d', 'M18,0 V32');
	await expect(rows.nth(1).locator('path.up')).toHaveAttribute('d', 'M7,0 V16');
	await expect(rows.nth(1).locator('path.down')).toHaveAttribute('d', 'M7,16 V32');
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
	// One column, one dot a row, and never a fork or a join.
	for (const row of await commitLog(page).getByRole('link').all()) {
		await expect(row.locator('svg.graph')).toHaveAttribute('data-lane', '0');
		await expect(row.locator('svg.graph circle.dot')).toHaveCount(1);
		await expect(row.locator('svg.graph path.fork')).toHaveCount(0);
		await expect(row.locator('svg.graph path.join')).toHaveCount(0);
		await expect(row.locator('svg.graph path.through')).toHaveCount(0);
	}

	// Where two of the four *are* parent and child — 106's parent is 104, and
	// the filter kept both — the spine is joined up between them and nowhere
	// else. The character column could not draw this at all: a lane the commit
	// itself sits in had no glyph but the dot, so a real edge went missing.
	expect(await lanes(page, 1)).toMatchObject({ up: false, down: true });
	expect(await lanes(page, 2)).toMatchObject({ up: true, down: false });
	expect(await lanes(page, 3)).toMatchObject({ up: false, down: false });

	// The scope was opened once, and the verb's hover is what paid for it.
	expect(stub.logs['src/compiler.js']).toBe(1);
});

test('the log sidebar is the author filter, and it says what it covers', async ({ page }) => {
	await signIn(page);
	await openLog(page);

	const sidebar = page.getByRole('navigation', { name: 'Primary' });

	// The section used to lead with a second file tree — the scope's directory,
	// listed so the log could be moved sideways from here. It was a tree on a
	// screen about history, and it pushed the one control that belongs here
	// below the fold.
	await expect(sidebar.getByRole('link', { name: 'Whole repository' })).toHaveCount(0);
	await expect(sidebar.getByRole('link', { name: 'README.md' })).toHaveCount(0);

	// Author is a parameter: it narrows the view of the same address, and it is
	// honest about reaching only as far as what is loaded.
	await sidebar.getByRole('link', { name: /simon/ }).click();
	await expect(page).toHaveURL(`${LOG}?author=simon`);
	await expect(commitLog(page).getByRole('link')).toHaveCount(3);
	await expect(page.getByRole('main')).toContainText('3 of 50 loaded · 109 commits');
	await expect(page.getByRole('banner').getByText('simon')).toBeVisible();

	// Re-scoping did not go anywhere: the breadcrumb walks the path, and it
	// keeps the author it was narrowed to on the way.
	await page.goto('/sveltejs/svelte/log/HEAD/src/compiler.js');
	await expect(commitLog(page).getByRole('link')).toHaveCount(4);
	await page.getByRole('banner').getByRole('link', { name: 'src', exact: true }).click();
	await expect(page).toHaveURL('/sveltejs/svelte/log/HEAD/src');
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

/* ----------------------------------------------- Phase 6: refs and compare -- */

const REFS = '/sveltejs/svelte/refs';

/** The refs table, as a set of places you can go. */
function refList(page: Page) {
	return page.getByRole('navigation', { name: 'Refs' });
}

function refPane(page: Page) {
	return page.getByRole('region', { name: 'Selected ref' });
}

async function openRefs(page: Page, at = REFS) {
	await page.goto(at);
	await expect(refList(page).getByRole('link').first()).toBeVisible();
}

test('branches and tags are one screen, and the sidebar reaches it', async ({ page }) => {
	const stub = await signIn(page);
	await openRepo(page);

	// Refs is a destination now, not an honest dead end. Its count is both
	// kinds together, because they are one object.
	const nav = page.getByRole('navigation', { name: 'Primary' });
	await expect(nav.getByRole('link', { name: /Refs/ })).toBeVisible();
	await nav.getByRole('link', { name: /Refs/ }).click();
	await expect(page).toHaveURL(REFS);

	// One list, two headings, and every branch and the first page of tags in it.
	await expect(refList(page)).toContainText('Branches');
	await expect(refList(page)).toContainText('Tags');
	await expect(refList(page).getByRole('link', { name: /^main/ })).toBeVisible();
	await expect(refList(page).getByRole('link', { name: /^v1\.2\.0/ })).toBeVisible();

	// One query per kind, in parallel — not one per ref.
	expect(stub.refs.branch).toBe(1);
	expect(stub.refs.tag).toBe(1);

	const panel = page.getByRole('complementary', { name: 'Context' });
	await expect(panel.getByRole('heading').nth(0)).toHaveText('Since your last visit');
	await expect(panel.getByRole('heading').nth(1)).toHaveText('About');
	await expect(panel.getByRole('heading').nth(2)).toHaveText('Open against it');
});

test('a repository that has never been tagged has no tags section', async ({ page }) => {
	const stub = await signIn(page);

	// The counts and the walk have to agree, because either one on its own is
	// enough to keep a heading on screen.
	stub.on('Repo', (route) =>
		json(route, {
			data: {
				repository: { ...REPOSITORY, tags: { totalCount: 0 } },
				rateLimit: rateLimit(4998)
			}
		})
	);
	const walk = stub.on('Refs', (route, variables) => {
		if (String(variables.prefix ?? '') !== 'refs/tags/') return walk?.(route, variables);
		return json(route, {
			data: {
				repository: {
					refs: {
						totalCount: 0,
						pageInfo: { hasNextPage: false, endCursor: null },
						nodes: []
					}
				},
				rateLimit: rateLimit(4992)
			}
		});
	});

	await openRefs(page, REFS);

	// A heading over nothing reads as a section that failed to load. Branches
	// are all there is, so branches are all the screen says.
	await expect(refList(page)).toContainText('Branches');
	await expect(refList(page)).not.toContainText('Tags');

	// And the sidebar does not offer a scope with nothing in it either.
	const sidebar = page.getByRole('navigation', { name: 'Primary' });
	await expect(sidebar.getByRole('link', { name: /^Branches/ })).toBeVisible();
	await expect(sidebar.getByRole('link', { name: /^Tags/ })).toHaveCount(0);
});

test('ahead and behind are read the right way round, and are not the API order', async ({
	page
}) => {
	await signIn(page);
	await openRefs(page, `${REFS}?kind=branches`);

	// GitHub calls the ref the *base*, so its `aheadBy` is this branch's behind.
	// The stub sends it GitHub's way round; the screen has to turn it back.
	const branch = refList(page).getByRole('link', { name: /^parser-rewrite/ });
	await expect(branch.locator('.up')).toHaveText('↑6');
	await expect(branch.locator('.down')).toHaveText('↓2');

	const stale = refList(page).getByRole('link', { name: /^release\/1\.0/ });
	await expect(stale.locator('.up')).toHaveText('↑0');
	await expect(stale.locator('.down')).toHaveText('↓12');

	// The default branch has nothing to be ahead of, and says so instead.
	await expect(refList(page).getByRole('link', { name: /^main/ })).toContainText('default');

	// Most recent first, whatever order the API answered in — the stub replies
	// alphabetically on purpose, which would put `main` last.
	const names = refList(page).getByRole('link').locator('.name');
	await expect(names.nth(0)).toHaveText('main');
	await expect(names.nth(2)).toHaveText('release/1.0');
});

test('a tag carries its message and its shortlog — the refs page is the changelog', async ({
	page
}) => {
	const stub = await signIn(page);
	await openRefs(page, `${REFS}?kind=tags`);

	await refList(page)
		.getByRole('link', { name: /^v1\.2\.0/ })
		.click();
	await expect(page).toHaveURL(`${REFS}?kind=tags&ref=${encodeURIComponent('tags/v1.2.0')}`);

	// The annotation is in the refs query, so it is there immediately.
	const pane = refPane(page);
	await expect(pane).toContainText('The parser rewrite ships.');
	await expect(pane).toContainText('Compiles are about a third faster.');

	// The shortlog is the second beat: three commits since v1.1.0, grouped by
	// author, busiest first — which is `git shortlog -n`.
	await expect(pane).toContainText('3 commits since v1.1.0');
	const shortlog = pane.locator('.shortlog');
	await expect(shortlog).toContainText('rich (2):');
	await expect(shortlog).toContainText('simon (1):');
	await expect(shortlog).toContainText('inline the parser call');

	// Exactly one range was compared, and it was addressed by the two SHAs the
	// list already held rather than by the tag names.
	expect(stub.compares[`${sha(106)}...${sha(109)}`]).toBe(1);
	expect(Object.keys(stub.compares)).toHaveLength(1);
});

test('walking the tag list with j and k is one comparison per rest, not per row', async ({
	page
}) => {
	const stub = await signIn(page);
	await openRefs(page, `${REFS}?kind=tags`);

	// Three rows in one go, without stopping on any of them. From nothing,
	// either direction starts at the top — the rule every list here follows.
	await page.keyboard.press('j');
	await page.keyboard.press('j');
	await page.keyboard.press('j');

	// The pane keeps up regardless, because the first beat costs nothing: the
	// name, the tip and the tag's own message all came with the refs query.
	await expect(page).toHaveURL(`${REFS}?kind=tags&ref=${encodeURIComponent('tags/v1.0.0')}`);
	await expect(refPane(page)).toContainText('v1.0.0');

	// The second beat is the one that waits, and only the row we stopped on
	// ever asked for it — the two we walked through were never compared.
	await expect(refPane(page).locator('.shortlog')).toContainText('add the readme');
	expect(stub.compares[`${sha(100)}...${sha(101)}`]).toBe(1);
	expect(Object.keys(stub.compares)).toHaveLength(1);

	// The selection is replaced, not pushed, so three rows left no history
	// behind them: one step back leaves the screen rather than the last row.
	await page.goBack();
	await expect(page).toHaveURL('/');
});

test('a tag at the edge of a page says it cannot see the one before it', async ({ page }) => {
	await signIn(page);
	await openRefs(page, `${REFS}?kind=tags`);

	// The hundredth tag is the last one loaded, and the tag before it is on a
	// page nobody has asked for. Saying so beats an empty pane.
	await page.keyboard.press('/');
	await page.keyboard.type('v0.21.0');
	await refList(page).getByRole('link').first().click();
	await expect(refPane(page)).toContainText('Load more tags');

	await page.getByRole('button', { name: 'Load more tags' }).click();
	await expect(refPane(page).locator('.tally')).toContainText('since v0.20.0');
});

test('the refs verbs act, and Log since previous opens the range', async ({ page }) => {
	const stub = await signIn(page);
	await openRefs(page, `${REFS}?kind=tags`);
	await refList(page)
		.getByRole('link', { name: /^v1\.2\.0/ })
		.click();

	// The verb row PLAN.md Phase 6 asks for, over a tag.
	for (const verb of ['Browse', 'Log since previous', 'Archive', 'Compare', 'Permalink']) {
		await expect(page.getByRole('link', { name: verb, exact: true })).toBeVisible();
	}

	// Permalink addresses the commit the tag points at, permanently.
	await expect(page.getByRole('link', { name: 'Permalink', exact: true })).toHaveAttribute(
		'href',
		`/sveltejs/svelte/tree/${sha(109)}`
	);

	await page.getByRole('link', { name: 'Log since previous' }).click();
	await expect(page).toHaveURL(`/sveltejs/svelte/compare/${sha(106)}/${sha(109)}`);

	// Resting on the row had already paid for it: the range is fetched once.
	expect(stub.compares[`${sha(106)}...${sha(109)}`]).toBe(1);
});

test('the compare screen carries the range, its commits and its diff', async ({ page }) => {
	await signIn(page);
	await page.goto(`/sveltejs/svelte/compare/${sha(106)}/${sha(109)}`);

	const main = page.getByRole('main');
	await expect(main).toContainText('3 commits');

	// Oldest first, as a release reads.
	const commits = page.getByRole('navigation', { name: 'Commits in this range' });
	await expect(commits.getByRole('link')).toHaveCount(3);
	await expect(commits.getByRole('link').first()).toContainText('document the new flag');
	await expect(commits.getByRole('link').last()).toContainText('merge the parser rewrite');

	// And the diff itself, through the same view the commit screen uses — the
	// patch parser's second caller, which is what Phase 5 said would earn it one.
	await expect(page.getByText('@@ -1,4 +1,5 @@').first()).toBeVisible();
	await expect(main).toContainText('src/compiler.js');

	const panel = page.getByRole('complementary', { name: 'Context' });
	await expect(panel).toContainText('Merge base');

	// Swap is a link, so it resolves without a request being made for it.
	await page.getByRole('link', { name: 'Swap' }).click();
	await expect(page).toHaveURL(`/sveltejs/svelte/compare/${sha(109)}/${sha(106)}`);
});

test('a range between two SHAs is permanent, so it is never fetched twice', async ({ page }) => {
	const stub = await signIn(page);
	const range = `${sha(106)}...${sha(109)}`;

	await page.goto(`/sveltejs/svelte/compare/${sha(106)}/${sha(109)}`);
	await expect(page.getByText('@@ -1,4 +1,5 @@').first()).toBeVisible();
	expect(stub.compares[range]).toBe(1);

	// A new document, a new store, nothing in memory — and both endpoints are
	// SHAs, so it is immutable however stale everything around it goes.
	await expireMutable(page);
	await page.reload();
	await expect(page.getByText('@@ -1,4 +1,5 @@').first()).toBeVisible();

	expect(stub.compares[range]).toBe(1);
});

test('permalink now works on a branch that is not the default one', async ({ page }) => {
	await signIn(page);

	// Phases 3 to 5 hid the verb here: the only commit SHA a screen held came
	// from the repository summary's HEAD, which is the default branch's. The
	// file screen resolves the expression it was already sending, in the same
	// round trip, so the SHA it addresses is `release/1.0`'s and not `main`'s.
	await page.goto(`/sveltejs/svelte/blob/${encodeURIComponent('release/1.0')}/src/compiler.js`);
	await expect(line(page, 1)).toBeVisible();
	await expect(page.getByRole('link', { name: 'Permalink' })).toHaveAttribute(
		'href',
		`/sveltejs/svelte/blob/${sha(101)}/src/compiler.js`
	);

	// The log resolves it the same way, from the listing it reads for the scope.
	await page.goto(`/sveltejs/svelte/log/${encodeURIComponent('release/1.0')}/src/compiler.js`);
	await expect(commitLog(page).getByRole('link').first()).toBeVisible();
	await expect(page.getByRole('link', { name: 'Permalink' })).toHaveAttribute(
		'href',
		`/sveltejs/svelte/log/${sha(101)}/src/compiler.js`
	);
});

test('the kind filter narrows the screen, and the ref filter narrows the list', async ({
	page
}) => {
	await signIn(page);
	await openRefs(page);

	const sidebar = page.getByRole('navigation', { name: 'Primary' });
	await sidebar.getByRole('link', { name: /^Branches/ }).click();
	await expect(page).toHaveURL(`${REFS}?kind=branches`);
	await expect(refList(page)).not.toContainText('v1.2.0');
	await expect(refList(page).getByRole('link')).toHaveCount(3);

	// `/` focuses the filter, and it narrows what is loaded — as everywhere else.
	await page.keyboard.press('/');
	await page.keyboard.type('release');
	await expect(refList(page).getByRole('link')).toHaveCount(1);
	await expect(refList(page).getByRole('link').first()).toContainText('release/1.0');
});

/* --------------------------------------------- Phase 7: review and threads -- */

const PULLS_URL = '/sveltejs/svelte/pulls';

function pullList(page: Page) {
	return page.getByRole('navigation', { name: 'Pull requests' });
}

function threadList(page: Page) {
	return page.getByRole('group', { name: 'Review threads' });
}

async function openPulls(page: Page, at = PULLS_URL) {
	await page.goto(at);
	await expect(pullList(page).getByRole('link', { name: /Rewrite the parser/ })).toBeVisible();
}

async function openPull(page: Page, number = 7) {
	await page.goto(`/sveltejs/svelte/pull/${number}`);
	await expect(page.getByRole('heading', { level: 1 })).toContainText(`#${number}`);
}

test('the review list carries every pull request, paid for with one query', async ({ page }) => {
	const stub = await signIn(page);
	await openPulls(page);

	// Three open, and the draft is one of them — a draft is an open pull request
	// with a flag, not a fourth state.
	const rows = pullList(page).getByRole('link');
	await expect(rows).toHaveCount(3);
	await expect(rows.nth(0)).toContainText('Rewrite the parser');
	await expect(rows.nth(0)).toContainText('simon');
	await expect(rows.nth(0)).toContainText('failing');
	await expect(rows.nth(1)).toContainText('approved');
	await expect(rows.nth(2)).toContainText('draft');

	// One query for the page, not one per row: everything a row shows — the
	// check rollup included — arrived with the row.
	expect(stub.calls.Pulls).toBe(1);
	expect(stub.calls.Pull ?? 0).toBe(0);

	// The right panel keeps its three blocks in the fixed order, on this screen
	// as on every other.
	const panel = page.getByRole('complementary', { name: 'Context' });
	await expect(panel.getByRole('heading')).toHaveText([
		'Since your last visit',
		'About',
		'Open against it'
	]);
});

test('Review is a destination at last, and the state filter re-scopes it', async ({ page }) => {
	await signIn(page);
	await openRepo(page);

	// Phase 3 through 6 rendered this item as an honest dead end. It is a link now.
	await page
		.getByRole('navigation', { name: 'Primary' })
		.getByRole('link', { name: /Review/ })
		.click();
	await expect(page).toHaveURL(PULLS_URL);

	await page
		.getByRole('navigation', { name: 'Primary' })
		.getByRole('link', { name: /^Merged/ })
		.click();
	await expect(page).toHaveURL(`${PULLS_URL}?state=merged`);

	const rows = pullList(page).getByRole('link');
	await expect(rows).toHaveCount(1);
	await expect(rows.first()).toContainText('Document the new flag');
});

test('j and k move a selection that starts unset, and enter opens the review', async ({ page }) => {
	await signIn(page);
	await openPulls(page);

	// A screen you have just opened does not claim one of its rows is special.
	await expect(pullList(page).locator('[aria-current="true"]')).toHaveCount(0);

	await page.keyboard.press('j');
	await expect(pullList(page).locator('[aria-current="true"]')).toContainText('Rewrite the parser');
	await page.keyboard.press('j');
	await expect(pullList(page).locator('[aria-current="true"]')).toContainText(
		'Inline the parser call'
	);
	await page.keyboard.press('k');
	await expect(pullList(page).locator('[aria-current="true"]')).toContainText('Rewrite the parser');

	await page.keyboard.press('Enter');
	await expect(page).toHaveURL('/sveltejs/svelte/pull/7');
	await expect(page.getByRole('heading', { level: 1 })).toContainText('Rewrite the parser');
});

test('a first pass is the whole diff, and there is no "since" verb to offer', async ({ page }) => {
	const stub = await signIn(page);
	await openPull(page);

	// Nothing has been reviewed, so there is nothing to be since — and a verb
	// that cannot act is absent, which has been the rule since Phase 3.
	await expect(page.getByRole('link', { name: 'Since my last review' })).toHaveCount(0);
	await expect(page.getByRole('link', { name: 'Whole diff', exact: true })).toBeVisible();

	// The diff came from the pull request's own file endpoint, in one page.
	await expect(page.getByText('src/compiler.js').first()).toBeVisible();
	await expect(page.getByText('src/App.svelte').first()).toBeVisible();
	await expect(page.getByText('← src/Old.svelte')).toBeVisible();
	expect(stub.pullFiles['7:1']).toBe(1);
	expect(stub.compares[`${sha(105)}...${sha(105)}`] ?? 0).toBe(0);

	// Checks and conflicts are read off the same query the screen is built from.
	await expect(page.getByText('1 check failing')).toBeVisible();
	const panel = page.getByRole('complementary', { name: 'Context' });
	await expect(panel).toContainText('Checks failing');
	await expect(panel).toContainText('Unresolved');
});

test('a second pass is the diff since the last review, and it is the default view', async ({
	page
}) => {
	const stub = await signIn(page);
	await openPull(page);

	// Say you are done. That is what records the head — nothing about opening
	// the screen does, or the next visit would show you nothing.
	await page.getByRole('button', { name: 'Mark reviewed' }).click();
	await expect(page.getByRole('button', { name: 'Recorded' })).toBeVisible();

	// Somebody pushes. The pull request query is mutable and still inside its
	// window, so age it — otherwise the screen is correctly showing the head it
	// was told about a moment ago.
	stub.push(7, sha(109));
	await expireMutable(page);
	await openPull(page);

	// No `?view=` in the URL, and the screen chose the since-diff anyway.
	await expect(page).toHaveURL('/sveltejs/svelte/pull/7');
	await expect(
		page.getByRole('status').filter({ hasText: 'Since your last review' })
	).toContainText(sha(105).slice(0, 7));
	await expect.poll(() => stub.compares[`${sha(105)}...${sha(109)}`] ?? 0).toBe(1);

	const panel = page.getByRole('complementary', { name: 'Context' });
	await expect(panel).toContainText('Reviewed at');
	await expect(panel).toContainText(sha(105).slice(0, 7));
	await expect(panel).toContainText('Commits since');

	// And the whole diff is still one verb away, which is what makes the default
	// a default rather than a trap. It is a second read because the head moved —
	// the diff is keyed by the two commits it is a function of, so a new head is
	// a different object and not a stale copy of the old one.
	await page.getByRole('link', { name: 'Whole diff', exact: true }).click();
	await expect(page).toHaveURL('/sveltejs/svelte/pull/7?view=all');
	await expect.poll(() => stub.pullFiles['7:1'] ?? 0).toBe(2);
});

test('a force push is detected from the comparison we were making anyway', async ({ page }) => {
	const stub = await signIn(page);
	await openPull(page, 6);

	await page.getByRole('button', { name: 'Mark reviewed' }).click();
	await expect(page.getByRole('button', { name: 'Recorded' })).toBeVisible();

	// The branch is rewritten: the recorded head is still reachable, but it is
	// no longer an ancestor of the new one.
	stub.push(6, sha(109));
	await expireMutable(page);
	await openPull(page, 6);

	const warned = page.getByRole('status').filter({ hasText: 'Force pushed' });
	await expect(warned).toBeVisible();
	await expect(warned).toContainText(STALE_HEAD.slice(0, 7));
	// It says the diff below is wider than the heading promises, rather than
	// quietly showing the whole pull request under it.
	await expect(warned).toContainText('includes work you have already read');

	await expect(page.getByRole('complementary', { name: 'Context' })).toContainText('Force pushed');

	// One request answered both questions. There is no second query to detect it.
	expect(stub.compares[`${STALE_HEAD}...${sha(109)}`]).toBe(1);
});

test('threads are anchored to their lines, and the moved one still says where it was', async ({
	page
}) => {
	await signIn(page);
	await openPull(page);

	// Three threads, in the order the code is in rather than the order the
	// conversation happened in: by file, then down the file. So the thread
	// written first is listed last, because line 9 comes after line 3.
	const rows = threadList(page).getByRole('button');
	await expect(rows).toHaveCount(3);
	await expect(page.getByText('2 unresolved of 3')).toBeVisible();
	await expect(rows.nth(0)).toContainText('App.svelte');
	await expect(rows.nth(1)).toContainText('compiler.js');
	await expect(rows.nth(2)).toContainText('compiler.js');

	// The line a thread hangs off carries a marker with the comment count.
	await expect(page.getByRole('button', { name: '2', exact: true }).first()).toBeVisible();

	// A resolved thread reads as settled.
	await rows.nth(1).click();
	await expect(page.getByRole('article')).toContainText('Resolved');
	await expect(page.getByRole('article')).toContainText('Fixed.');

	// The thread that lost its line is still listed, its number struck through
	// rather than dropped. PLAN.md Phase 7's "watch for": the commit it was
	// written against is what places it, and the screen says which one.
	await rows.nth(2).click();
	const card = page.getByRole('article');
	await expect(card).toContainText('Was this ever measured?');
	await expect(card).toContainText('Unresolved');
	await expect(card).toContainText(`Moved · ${sha(101).slice(0, 7)}`);
});

test('j and k walk the threads and esc closes the pane', async ({ page }) => {
	await signIn(page);
	await openPull(page);

	await page.keyboard.press('j');
	await expect(page.getByRole('article')).toContainText('This import is doing');
	// Comment bodies are Markdown, parsed by us and never injected as HTML.
	await expect(page.getByRole('article').locator('strong')).toHaveText('two');
	// A thread with replies shows them, separated as DESIGN.md §5 asks.
	await expect(page.getByRole('article')).toContainText('Split in the next push.');

	await page.keyboard.press('j');
	await expect(page.getByRole('article')).toContainText('Fixed.');
	await page.keyboard.press('k');
	await expect(page.getByRole('article')).toContainText('This import is doing');

	await page.keyboard.press('Escape');
	await expect(page.getByRole('article')).toHaveCount(0);
});

test('marking a file viewed collapses it, and marking the last one records the review', async ({
	page
}) => {
	await signIn(page);
	await openPull(page);

	// Two files, both open. The patch's own lines are on screen.
	await expect(page.getByText("import { tidy } from './tidy.js';")).toHaveCount(2);

	const marks = page.getByRole('button', { name: 'Mark viewed', exact: true });
	const seen = page.getByRole('button', { name: 'Viewed', exact: true });

	await expect(marks).toHaveCount(2);
	await marks.first().click();

	// Collapsed: the header stays, the body goes. That is what keeps the
	// virtualised list one row height throughout.
	await expect(seen).toHaveCount(1);
	await expect(page.getByText("import { tidy } from './tidy.js';")).toHaveCount(1);

	await marks.click();
	await expect(page.getByText("import { tidy } from './tidy.js';")).toHaveCount(0);

	// Every file read is a review finished, and the screen offers to record it.
	await expect(page.getByText('Every file here is viewed.')).toBeVisible();
	await page.getByRole('button', { name: 'Record this as reviewed' }).click();
	await expect(page.getByRole('complementary', { name: 'Context' })).toContainText('Reviewed at');

	// The marks survive a reload, because they are in IndexedDB and not in memory.
	await page.reload();
	await expect(seen).toHaveCount(2);
});

test('a marked file stays viewed across a push that did not touch it', async ({ page }) => {
	const stub = await signIn(page);
	await openPull(page);

	const marks = page.getByRole('button', { name: 'Mark viewed', exact: true });
	const seen = page.getByRole('button', { name: 'Viewed', exact: true });

	// Read both files, and say so.
	await marks.first().click();
	await marks.click();
	await page.getByRole('button', { name: 'Record this as reviewed' }).click();
	await expect(page.getByRole('complementary', { name: 'Context' })).toContainText('Reviewed at');

	// A push lands, and it touched `src/compiler.js` only. The mark on that file
	// is spent; the one on `src/App.svelte` survives, which is what keeps a push
	// from restarting a review somebody has already done.
	stub.push(7, sha(108));
	await expireMutable(page);
	await openPull(page);

	await expect(
		page.getByRole('status').filter({ hasText: 'Since your last review' })
	).toBeVisible();
	await expect(marks).toHaveCount(1);
	await expect(seen).toHaveCount(0);

	// And the surviving mark is still on record — the whole diff shows it.
	await page.getByRole('link', { name: 'Whole diff', exact: true }).click();
	await expect(seen).toHaveCount(1);
	await expect(marks).toHaveCount(1);
});

test('a large diff is paged, and the page it walked is never fetched twice', async ({ page }) => {
	const stub = await signIn(page);
	await openPull(page, 4);

	// The first page is a hundred files, and the screen says what it is not
	// showing rather than ending silently.
	await expect(page.getByText('src/typed-000.ts').first()).toBeVisible();
	await expect(page.getByRole('button', { name: /Load more files/ })).toContainText('50 left');
	expect(stub.pullFiles['4:1']).toBe(1);
	expect(stub.pullFiles['4:2'] ?? 0).toBe(0);

	await page.getByRole('button', { name: /Load more files/ }).click();
	await expect.poll(() => stub.pullFiles['4:2'] ?? 0).toBe(1);
	// The walk is finished, so there is nothing left to offer.
	await expect(page.getByRole('button', { name: /Load more/ })).toHaveCount(0);

	// A pull request's diff is a function of two commits, so it is filed
	// permanently. Leaving and walking the whole thing again costs nothing.
	await page.goto(PULLS_URL);
	await expireMutable(page);
	await openPull(page, 4);
	await expect(page.getByText('src/typed-000.ts').first()).toBeVisible();
	await page.getByRole('button', { name: /Load more files/ }).click();
	await expect(page.getByRole('button', { name: /Load more/ })).toHaveCount(0);

	expect(stub.pullFiles['4:1']).toBe(1);
	expect(stub.pullFiles['4:2']).toBe(1);
});

test('hovering a row warms the review it opens', async ({ page }) => {
	const stub = await signIn(page);
	await openPulls(page);

	await pullList(page)
		.getByRole('link', { name: /Rewrite the parser/ })
		.hover();
	await expect.poll(() => stub.pull['7'] ?? 0).toBe(1);

	await pullList(page)
		.getByRole('link', { name: /Rewrite the parser/ })
		.click();
	await expect(page.getByRole('heading', { level: 1 })).toContainText('Rewrite the parser');

	// The screen it opened asked for nothing it did not already hold.
	expect(stub.pull['7']).toBe(1);
});

/* ------------------------------------------ Phase 8: since your last visit -- */

test('a first visit says so, and costs nothing to say', async ({ page }) => {
	const stub = await signIn(page);
	await openRepo(page);

	// There is no record, so there is nothing to compare against — and the
	// screen says which of the two it is, because "first visit" and "nothing
	// changed" are different answers.
	await expect(context(page)).toContainText('Last visit');
	await expect(context(page)).toContainText('First');

	// No comparison, and no CODEOWNERS. The feature is free until it has
	// something to say.
	expect(Object.keys(stub.compares)).toHaveLength(0);
	expect(Object.keys(stub.owners)).toHaveLength(0);

	// …and the visit is recorded, so the next one is a second one. The write is
	// debounced, which is what keeps a screen you passed through from spending
	// the record.
	await expect
		.poll(async () => (await readVisit(page, REPO_VISIT))?.lastSeenSha, {
			timeout: 8000
		})
		.toBe(HEAD);
});

test('a second visit says what landed, from exactly one comparison', async ({ page }) => {
	const stub = await signIn(page);

	// Arrive once so there is a database to seed, then rewrite the record to a
	// commit nine pushes back and come in again.
	await openRepo(page);
	await seedVisit(page, REPO_VISIT, sha(100));
	await openRepo(page);

	const panel = context(page);
	await expect(panel).toContainText('Commits since');
	await expect(panel).toContainText('9');
	await expect(panel).toContainText('Files since');

	// One request, and it is the only one the whole block costs.
	await expect.poll(() => stub.compares[`${sha(100)}...${HEAD}`] ?? 0).toBe(1);
	expect(Object.keys(stub.compares)).toHaveLength(1);

	// The heading carries how long ago, so the numbers have a scale.
	await expect(panel).toContainText('Since your last visit · 2d');
});

test('the dots on a listing are projected from that one comparison', async ({ page }) => {
	const stub = await signIn(page);
	await openRepo(page);
	await seedVisit(page, REPO_VISIT, sha(100));
	await openRepo(page);

	// `src` holds all three changed files; the README was not one of them, and a
	// row with no news carries no dot.
	const src = listing(page).getByRole('link', { name: 'src' });
	await expect(src.getByRole('img')).toHaveAttribute(
		'aria-label',
		/3 files changed since your last visit/
	);
	await expect(listing(page).getByRole('link', { name: 'README.md' }).getByRole('img')).toHaveCount(
		0
	);

	// The sidebar's tree is dotted from the same answer, not a second one.
	const tree = page.getByRole('navigation', { name: 'Primary' });
	await expect(
		tree.getByRole('img', { name: /changed since your last visit/ }).first()
	).toBeVisible();

	expect(Object.keys(stub.compares)).toHaveLength(1);
});

test('CODEOWNERS decides which of them are yours, and is read once', async ({ page }) => {
	const stub = await signIn(page);
	await openRepo(page);
	await seedVisit(page, REPO_VISIT, sha(100));
	await openRepo(page);

	// Three files moved. `src/compiler.js` and `src/App.svelte` are this
	// account's by the second and third rules; `src/logo.png` falls to the
	// catch-all, which is somebody else's. Last match wins, so the first line
	// claiming everything does not make everything yours.
	await expect(context(page)).toContainText('In paths you own');
	await expect(context(page).getByText('2', { exact: true }).first()).toBeVisible();

	// One query for the file, however many rules and rows consult it.
	await expect.poll(() => stub.owners['HEAD'] ?? 0).toBe(1);

	// And the dot on the directory says so, which is where a fact about you
	// belongs rather than in a second colour.
	await expect(listing(page).getByRole('link', { name: 'src' }).getByRole('img')).toHaveAttribute(
		'aria-label',
		/you own this path/
	);
});

test('a rewritten default branch is amber, from the same one request', async ({ page }) => {
	const stub = await signIn(page);
	await openRepo(page);

	// The recorded head is still reachable but is no longer an ancestor of the
	// current one — which GitHub reports as `diverged` rather than `ahead`, and
	// that single word is the whole of the descendant test.
	await seedVisit(page, REPO_VISIT, STALE_HEAD);
	await openRepo(page);

	await expect(context(page)).toContainText('Force pushed');
	expect(stub.compares[`${STALE_HEAD}...${HEAD}`]).toBe(1);
});

test('the delta survives walking around inside the repository', async ({ page }) => {
	const stub = await signIn(page);
	await openRepo(page);
	await seedVisit(page, REPO_VISIT, sha(100));
	await openRepo(page);

	await expect(context(page)).toContainText('Commits since');

	// Into a file and back out. Recording the visit must not empty the block
	// under the reader, and one record is shared by every screen — so the
	// comparison is not remade either.
	await listing(page).getByRole('link', { name: 'src' }).click();
	await listing(page).getByRole('link', { name: 'compiler.js' }).click();
	await expect(line(page, 1)).toBeVisible();
	await expect(context(page)).toContainText('Commits since');

	await page.goBack();
	await page.goBack();
	await expect(context(page)).toContainText('Commits since');

	expect(stub.compares[`${sha(100)}...${HEAD}`]).toBe(1);
	expect(Object.keys(stub.owners)).toHaveLength(1);
});

test('the file screen says what changed in this file, and who by', async ({ page }) => {
	const stub = await signIn(page);
	await openRepo(page);
	await seedVisit(page, REPO_VISIT, sha(100));

	await openFile(page);

	const panel = context(page);
	await expect(panel).toContainText('Lines changed');
	// 12 added and 3 removed, from the comparison's own entry for this path —
	// not from a second read of the file.
	await expect(panel).toContainText('+12');
	await expect(panel).toContainText('−3');

	// And by whom, which the comparison cannot answer: it lists the range's
	// commits and the range's files but never says which touched which. The
	// path-scoped log is the intersection, and it is the query the Log verb was
	// going to warm anyway.
	await expect(panel).toContainText('By');
	await expect(panel).toContainText('simon');
	await expect.poll(() => stub.logs['src/compiler.js'] ?? 0).toBe(1);
});

test('the review list marks what has moved since you reviewed it', async ({ page }) => {
	const stub = await signIn(page);

	await openPull(page);
	await page.getByRole('button', { name: 'Mark reviewed' }).click();
	await expect(page.getByRole('button', { name: 'Recorded' })).toBeVisible();

	stub.push(7, sha(109));
	await expireMutable(page);
	await openPulls(page);

	// No request at all: the records are already on disk and the list is already
	// carrying every row's head, so "has this moved" is a string comparison over
	// one prefix scan.
	const row = pullList(page).getByRole('link', { name: /Rewrite the parser/ });
	await expect(row.getByRole('img')).toHaveAttribute('aria-label', /Pushed to since you reviewed/);

	const panel = context(page);
	await expect(panel).toContainText('Reviewed before');
	await expect(panel).toContainText('Moved since');
	await expect(panel).toContainText('Never opened');

	// A pull request you have never opened carries no dot.
	await expect(
		pullList(page)
			.getByRole('link', { name: /Type the whole compiler/ })
			.getByRole('img')
	).toHaveCount(0);
});

test('the comparison is addressed by two SHAs, so it is never fetched twice', async ({ page }) => {
	const stub = await signIn(page);
	await openRepo(page);
	await seedVisit(page, REPO_VISIT, sha(100));
	await openRepo(page);

	await expect(context(page)).toContainText('Commits since');
	expect(stub.compares[`${sha(100)}...${HEAD}`]).toBe(1);

	// Leave, age everything that revalidates, and come back. Both endpoints are
	// commit SHAs, so the answer is permanent whatever happens around it.
	await openRefs(page);
	await expireMutable(page);

	await openRepo(page);
	await expect(context(page)).toContainText('Commits since');
	expect(stub.compares[`${sha(100)}...${HEAD}`]).toBe(1);
});

test('the background tick revalidates the pinned repository without a navigation', async ({
	page
}) => {
	const stub = await signIn(page);
	await openRepo(page);

	const before = stub.calls.Repo ?? 0;

	// Nothing is stale, so a tick is a cache read and no request.
	await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
	await page.waitForTimeout(200);
	expect(stub.calls.Repo).toBe(before);

	// Past its window it is a conditional revalidation, and it happens while the
	// screen sits still — which is what ARCHITECTURE.md §11 means by polling
	// instead of webhooks.
	await expireMutable(page);
	await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
	await expect.poll(() => stub.calls.Repo ?? 0).toBe(before + 1);
});

/* ---------------------------------------------------- The home screen: you -- */

test('the app opens on your repositories and what is in flight', async ({ page }) => {
	const stub = await signIn(page);

	// Two lists, and the account rather than a repository above them.
	await expect(page.getByRole('heading', { name: 'In flight' })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Repositories' })).toBeVisible();
	await expect(page.getByRole('navigation', { name: 'Primary' })).toContainText('octant-user');

	// Nothing is selected, so the header carries pills and no verbs — there is no
	// object to carry them, and the two views are the sidebar's three items.
	await expect(page.getByRole('banner')).toContainText('52 repositories');
	await expect(
		page.getByRole('banner').getByRole('link', { name: /^(Repositories|Pull requests)$/ })
	).toHaveCount(0);

	// The sidebar's three items are the whole of it: no contextual section, and
	// no heading standing over one.
	const primary = page.getByRole('navigation', { name: 'Primary' });
	// The badge and the three views, and nothing under them.
	await expect(primary.getByRole('link')).toHaveCount(4);
	await expect(primary).not.toContainText('Recent');

	// Ordered by what was pushed to, so the top of the list is where the work is.
	const rows = repoList(page).getByRole('link');
	await expect(rows.nth(0)).toContainText('sveltejs/svelte');
	await expect(rows.nth(0)).toContainText('web development for the rest of us');
	await expect(rows.nth(0)).toContainText('7 open');
	await expect(rows.nth(1)).toContainText('octant-user/dotfiles');
	await expect(rows.nth(1)).toContainText('private');

	// A pull request row names the repository it is in, because this list spans
	// all of them.
	await expect(inboxList(page).getByRole('link', { name: /Rewrite the parser/ })).toContainText(
		'sveltejs/svelte'
	);

	// One page of repositories and one search pair. No per-row read on either:
	// fifty-two rows and three pull requests cost two queries between them.
	expect(stub.calls.Repos).toBe(1);
	expect(stub.calls.Inbox).toBe(1);

	// Resting on a row warms the screen it opens, the bargain every list in the
	// app makes. Not an exact count: the pointer is somewhere when the gate
	// unmounts, and whatever it lands on is warmed for the same good reason.
	await inboxList(page)
		.getByRole('link', { name: /Rewrite the parser/ })
		.hover();
	await expect.poll(() => stub.pull['7'] ?? 0).toBeGreaterThanOrEqual(1);
});

test('a pull request in both searches is one row carrying both facts', async ({ page }) => {
	await signIn(page);

	// #6 is yours *and* has been sent back to you. One row, and it says so.
	const merged = inboxList(page).getByRole('link', { name: /Inline the parser call/ });
	await expect(merged).toHaveCount(1);
	await expect(merged).toContainText('octant-user');
	await expect(merged.getByRole('img', { name: 'Your review was asked for' })).toBeVisible();

	// Three pull requests over two searches of two, newest first.
	await expect(inboxList(page).getByRole('link')).toHaveCount(3);
	await expect(inboxList(page).getByRole('link').nth(0)).toContainText('Rewrite the parser');

	// The header counts the ones that are actually waiting on you.
	await expect(page.getByRole('banner')).toContainText('2 for you');
});

test('j and k walk both lists and enter opens the row', async ({ page }) => {
	await signIn(page);
	await expect(inboxList(page).getByRole('link')).toHaveCount(3);
	await expect(repoList(page).getByRole('link').first()).toContainText('sveltejs/svelte');

	// Nothing is selected on arrival — a screen you have just opened should not
	// claim one of its rows is special.
	await expect(page.locator('[aria-current="true"]')).toHaveCount(0);

	// Three pull requests, then the repositories underneath them: the cursor does
	// not stop at the section boundary.
	for (let i = 0; i < 4; i += 1) await page.keyboard.press('j');
	await expect(page.locator('[aria-current="true"]')).toContainText('sveltejs/svelte');
	await expect(context(page)).toContainText('Visibility');

	await page.keyboard.press('k');
	await expect(page.locator('[aria-current="true"]')).toContainText('Type the whole compiler');

	await page.keyboard.press('Enter');
	await expect(page).toHaveURL('/sveltejs/svelte/pull/4');
});

test('the filter is also the way to a repository that is not on the list', async ({ page }) => {
	await signIn(page);

	// Slash focuses the field, as everywhere else in the app.
	await page.keyboard.press('/');
	await page.keyboard.type('rich/kit');

	// Nothing on the list matches, and what was typed is an address.
	await expect(repoList(page).getByRole('link')).toHaveCount(1);
	await expect(repoList(page).getByRole('link')).toContainText('Open rich/kit');

	await repoList(page).getByRole('link').click();
	await expect(page).toHaveURL('/rich/kit');

	// A name already on the list is not offered twice.
	await openHome(page);
	await page.keyboard.press('/');
	await page.keyboard.type('sveltejs/svelte');
	await expect(repoList(page).getByRole('link')).toHaveCount(1);
	await expect(repoList(page).getByRole('link')).not.toContainText('Open sveltejs/svelte');
});

test('the list says which repositories moved while you were away', async ({ page }) => {
	await signIn(page);

	// A visit two days old. `sveltejs/svelte` was pushed to an hour ago, so it
	// has moved; `octant-user/dotfiles` was last pushed a month ago, so it has not.
	await seedVisit(page, REPO_VISIT, HEAD);
	await seedVisit(page, 'repo:octant-user/dotfiles', null);
	await page.reload();
	await openHome(page);

	const moved = repoList(page).getByRole('link', { name: /sveltejs\/svelte/ });
	await expect(
		moved.getByRole('img', { name: /Pushed to since you last opened it/ })
	).toBeVisible();

	const still = repoList(page).getByRole('link', { name: /octant-user\/dotfiles/ });
	await expect(still.getByRole('img')).toHaveCount(0);

	// The same answer in words, which is the rule for the dot — DESIGN.md §9.
	await expect(context(page)).toContainText('Pushed since');
	await expect(context(page)).toContainText('Opened before');
});

test('the two views narrow the screen, and the second page is a walk', async ({ page }) => {
	const stub = await signIn(page);

	await page
		.getByRole('navigation', { name: 'Primary' })
		.getByRole('link', { name: 'Pull requests' })
		.click();
	await expect(page).toHaveURL('/?view=pulls');
	await expect(page.getByRole('heading', { name: 'Repositories' })).toHaveCount(0);
	await expect(inboxList(page).getByRole('link')).toHaveCount(3);

	await page
		.getByRole('navigation', { name: 'Primary' })
		.getByRole('link', { name: 'Repositories' })
		.click();
	await expect(page).toHaveURL('/?view=repos');
	await expect(page.getByRole('heading', { name: 'In flight' })).toHaveCount(0);

	// Fifty of fifty-two, and the button says how many are left.
	await expect(page.getByRole('main')).toContainText('50 of 52 repositories');
	await page.getByRole('button', { name: /Load more/ }).click();
	await expect(page.getByRole('main')).toContainText('52 of 52 repositories');
	await expect(page.getByRole('button', { name: /Load more/ })).toHaveCount(0);

	// The second page is a page in its own right, filed under the cursor that
	// fetched it — so it is one more request, not a re-read of the first.
	expect(stub.repos.head).toBe(1);
	expect(Object.keys(stub.repos)).toHaveLength(2);
});

test('coming back to the home screen is a local read', async ({ page }) => {
	const stub = await signIn(page);

	await repoList(page)
		.getByRole('link', { name: /sveltejs\/svelte/ })
		.click();
	await expect(listing(page).getByRole('link', { name: 'README.md' })).toBeVisible();

	// The account's two lists are cached under the account, not under a
	// repository — so walking back to them costs nothing.
	await page.goBack();
	await expect(repoList(page).getByRole('link', { name: /sveltejs\/svelte/ })).toBeVisible();
	expect(stub.calls.Repos).toBe(1);
	expect(stub.calls.Inbox).toBe(1);
});

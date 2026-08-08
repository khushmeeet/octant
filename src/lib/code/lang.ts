import type { Grammar } from './tokenize';

/**
 * Languages — PLAN.md Phase 4, "for the languages you actually read".
 *
 * A grammar here is data, not code: comment and string delimiters, a keyword
 * list, and two flags. That is enough for the four colours DESIGN.md §3 spends
 * on syntax, and it is all a reader needs — comments recede, strings and
 * literals separate from structure, keywords give a line its shape, and call
 * sites say where the work happens.
 *
 * Where a language is not exactly served it is mapped to its nearest neighbour
 * rather than left plain: Kotlin read through the Java grammar gets its
 * comments, strings and most of its keywords right, which is most of the value.
 * A missing grammar is a file rendered as plain text — never a file that fails
 * to render.
 */

const set = (words: string) => new Set(words.split(/\s+/).filter(Boolean));

/* ------------------------------------------------------------ keywords -- */

const JS_WORDS = `
	as async await break case catch class const continue debugger declare default
	delete do else enum export extends false finally for from function get if
	implements import in infer instanceof interface is keyof let new null of
	override package private protected public readonly return satisfies set
	static super switch this throw true try type typeof undefined var void while
	with yield abstract namespace module accessor using
	any unknown never string number boolean object bigint symbol
`;

const CSS_WORDS = `important inherit initial unset revert var and not or from to`;

const PY_WORDS = `
	and as assert async await break class continue def del elif else except
	finally for from global if import in is lambda nonlocal not or pass raise
	return try while with yield match case True False None self cls
`;

const GO_WORDS = `
	break case chan const continue default defer else fallthrough for func go
	goto if import interface map package range return select struct switch type
	var nil true false iota make new len cap append copy delete panic recover
	string bool byte rune error int int8 int16 int32 int64 uint uint8 uint16
	uint32 uint64 uintptr float32 float64 complex64 complex128 any
`;

const RUST_WORDS = `
	as async await break const continue crate dyn else enum extern false fn for
	if impl in let loop match mod move mut pub ref return self Self static struct
	super trait true type unsafe use where while box union macro_rules
	String Vec Option Result Some None Ok Err bool char str u8 u16 u32 u64 u128
	usize i8 i16 i32 i64 i128 isize f32 f64
`;

const C_WORDS = `
	alignas alignof asm auto bool break case catch char class const constexpr
	continue decltype default delete do double else enum explicit export extern
	false float for friend goto if inline int long mutable namespace new noexcept
	nullptr operator private protected public register return short signed sizeof
	static struct switch template this throw true try typedef typename union
	unsigned using virtual void volatile while NULL size_t uint8_t uint32_t
	uint64_t int32_t int64_t
`;

const JAVA_WORDS = `
	abstract actual as assert boolean break by byte case catch char class companion
	const constructor continue crossinline data default do double else enum
	expect extends external final finally float for fun goto if implements import
	in infix init inline instanceof int interface internal is lateinit long native
	new noinline null object open operator out override package private protected
	public record reified return sealed short static super suspend switch
	synchronized tailrec this throw throws transient true false try typealias val
	var vararg void volatile when where while yield String Int Boolean Unit Any
	let guard func struct protocol extension defer associatedtype some
`;

const RUBY_WORDS = `
	alias and begin break case class def defined? do else elsif end ensure false
	for if in module next nil not or redo rescue retry return self super then true
	undef unless until when while yield require require_relative attr_accessor
	attr_reader attr_writer include extend lambda proc raise
`;

const SHELL_WORDS = `
	if then else elif fi case esac for while until do done function in return
	local export readonly declare typeset set unset shift source alias eval exec
	trap exit break continue echo printf cd test time select
`;

const SQL_WORDS = `
	select from where insert into values update set delete create table alter drop
	index view join inner left right full outer on group by order having limit
	offset union all distinct as and or not null is in exists between like case
	when then else end begin commit rollback transaction primary key foreign
	references constraint default unique check cascade returning with recursive
	count sum avg min max coalesce cast
`;

const GRAPHQL_WORDS = `
	query mutation subscription fragment on type input interface enum union scalar
	schema implements extend directive repeatable true false null
`;

const DOCKER_WORDS = `
	FROM RUN CMD LABEL MAINTAINER EXPOSE ENV ADD COPY ENTRYPOINT VOLUME USER
	WORKDIR ARG ONBUILD STOPSIGNAL HEALTHCHECK SHELL AS
`;

const MAKE_WORDS = `include ifeq ifneq ifdef ifndef else endif define endef export unexport override`;

/* ------------------------------------------------------------ grammars -- */

const SLASH_COMMENTS = { line: ['//'], block: [['/*', '*/']] } as const;

const JS: Grammar = {
	id: 'js',
	keywords: set(JS_WORDS),
	...SLASH_COMMENTS,
	quotes: [
		{ open: '"', close: '"', escape: true },
		{ open: "'", close: "'", escape: true },
		{ open: '`', close: '`', escape: true, multiline: true }
	],
	calls: true
};

const CSS: Grammar = {
	id: 'css',
	keywords: set(CSS_WORDS),
	// `//` is not a comment in CSS proper, but it is in SCSS and Less, and one
	// grammar serves all three.
	line: ['//'],
	block: [['/*', '*/']],
	quotes: [
		{ open: '"', close: '"', escape: true },
		{ open: "'", close: "'", escape: true }
	],
	at: true
};

const JSON_G: Grammar = {
	id: 'json',
	keywords: set('true false null'),
	// JSONC and package manager lockfiles carry comments; plain JSON never has
	// one to find.
	line: ['//'],
	block: [['/*', '*/']],
	quotes: [{ open: '"', close: '"', escape: true }]
};

const HASH_QUOTES = [
	{ open: '"', close: '"', escape: true },
	{ open: "'", close: "'", escape: true }
] as const;

const MARKUP_EMBEDS = [
	{ open: '<script', close: '</script>', grammar: JS },
	{ open: '<style', close: '</style>', grammar: CSS }
] as const;

const HTML: Grammar = {
	id: 'html',
	block: [['<!--', '-->']],
	quotes: HASH_QUOTES,
	tags: true,
	numbers: false,
	embeds: MARKUP_EMBEDS
};

const XML: Grammar = {
	id: 'xml',
	block: [['<!--', '-->']],
	quotes: HASH_QUOTES,
	tags: true,
	numbers: false
};

/**
 * Svelte is markup with script and style regions, so it is HTML plus the
 * keyword set that makes `{#each}` and `$derived` read as structure.
 */
const SVELTE: Grammar = {
	id: 'svelte',
	keywords: set('if else each await then catch key snippet render html const debug'),
	block: [['<!--', '-->']],
	quotes: HASH_QUOTES,
	tags: true,
	numbers: false,
	embeds: MARKUP_EMBEDS
};

const PYTHON: Grammar = {
	id: 'python',
	keywords: set(PY_WORDS),
	line: ['#'],
	// Triple quotes first: a docstring must not be read as an empty string
	// followed by a comment.
	quotes: [
		{ open: '"""', close: '"""', multiline: true },
		{ open: "'''", close: "'''", multiline: true },
		{ open: '"', close: '"', escape: true },
		{ open: "'", close: "'", escape: true }
	],
	calls: true
};

const GO: Grammar = {
	id: 'go',
	keywords: set(GO_WORDS),
	...SLASH_COMMENTS,
	quotes: [
		{ open: '"', close: '"', escape: true },
		{ open: '`', close: '`', multiline: true },
		{ open: "'", close: "'", escape: true }
	],
	calls: true
};

const RUST: Grammar = {
	id: 'rust',
	keywords: set(RUST_WORDS),
	...SLASH_COMMENTS,
	// No `'` — a lifetime is not a string, and treating one as an unterminated
	// literal would tint the rest of every generic signature in the file.
	quotes: [{ open: '"', close: '"', escape: true }],
	calls: true
};

const C: Grammar = {
	id: 'c',
	keywords: set(C_WORDS),
	...SLASH_COMMENTS,
	quotes: [
		{ open: '"', close: '"', escape: true },
		{ open: "'", close: "'", escape: true }
	],
	calls: true
};

const JAVA: Grammar = {
	id: 'java',
	keywords: set(JAVA_WORDS),
	...SLASH_COMMENTS,
	quotes: [
		{ open: '"""', close: '"""', multiline: true },
		{ open: '"', close: '"', escape: true },
		{ open: "'", close: "'", escape: true }
	],
	calls: true
};

const RUBY: Grammar = {
	id: 'ruby',
	keywords: set(RUBY_WORDS),
	line: ['#'],
	quotes: [
		{ open: '"', close: '"', escape: true },
		{ open: "'", close: "'", escape: true }
	],
	calls: true
};

const SHELL: Grammar = {
	id: 'shell',
	keywords: set(SHELL_WORDS),
	line: ['#'],
	quotes: [
		{ open: '"', close: '"', escape: true },
		{ open: "'", close: "'" }
	]
};

const YAML: Grammar = {
	id: 'yaml',
	keywords: set('true false null yes no on off'),
	line: ['#'],
	quotes: HASH_QUOTES
};

const TOML: Grammar = {
	id: 'toml',
	keywords: set('true false'),
	line: ['#'],
	quotes: [
		{ open: '"""', close: '"""', multiline: true },
		{ open: '"', close: '"', escape: true },
		{ open: "'", close: "'" }
	]
};

const INI: Grammar = {
	id: 'ini',
	keywords: set('true false on off yes no'),
	line: ['#', ';'],
	quotes: HASH_QUOTES
};

const SQL: Grammar = {
	id: 'sql',
	keywords: set(SQL_WORDS),
	ignoreCase: true,
	line: ['--'],
	block: [['/*', '*/']],
	quotes: [
		{ open: "'", close: "'", escape: true },
		{ open: '"', close: '"', escape: true }
	],
	calls: true
};

const GRAPHQL: Grammar = {
	id: 'graphql',
	keywords: set(GRAPHQL_WORDS),
	line: ['#'],
	quotes: [
		{ open: '"""', close: '"""', multiline: true },
		{ open: '"', close: '"', escape: true }
	]
};

const DOCKERFILE: Grammar = {
	id: 'dockerfile',
	keywords: set(DOCKER_WORDS),
	line: ['#'],
	quotes: HASH_QUOTES
};

const MAKE: Grammar = {
	id: 'make',
	keywords: set(MAKE_WORDS),
	line: ['#'],
	quotes: HASH_QUOTES
};

/* --------------------------------------------------------- resolution -- */

/**
 * Extension → the label the right panel shows, and the grammar that reads it.
 * The label is per extension and the grammar is shared: TypeScript is named
 * TypeScript even though JavaScript's grammar is what colours it.
 */
const BY_EXT: Record<string, [label: string, grammar: Grammar | null]> = {
	js: ['JavaScript', JS],
	mjs: ['JavaScript', JS],
	cjs: ['JavaScript', JS],
	jsx: ['JavaScript', JS],
	ts: ['TypeScript', JS],
	mts: ['TypeScript', JS],
	cts: ['TypeScript', JS],
	tsx: ['TypeScript', JS],
	svelte: ['Svelte', SVELTE],
	vue: ['Vue', SVELTE],
	html: ['HTML', HTML],
	htm: ['HTML', HTML],
	xml: ['XML', XML],
	svg: ['SVG', XML],
	xsl: ['XSL', XML],
	plist: ['Property list', XML],
	css: ['CSS', CSS],
	scss: ['Sass', CSS],
	sass: ['Sass', CSS],
	less: ['Less', CSS],
	json: ['JSON', JSON_G],
	jsonc: ['JSON', JSON_G],
	json5: ['JSON5', JSON_G],
	lock: ['Lockfile', JSON_G],
	py: ['Python', PYTHON],
	pyi: ['Python', PYTHON],
	go: ['Go', GO],
	rs: ['Rust', RUST],
	c: ['C', C],
	h: ['C', C],
	cc: ['C++', C],
	cpp: ['C++', C],
	cxx: ['C++', C],
	hpp: ['C++', C],
	hh: ['C++', C],
	m: ['Objective-C', C],
	cs: ['C#', C],
	zig: ['Zig', C],
	java: ['Java', JAVA],
	kt: ['Kotlin', JAVA],
	kts: ['Kotlin', JAVA],
	scala: ['Scala', JAVA],
	swift: ['Swift', JAVA],
	dart: ['Dart', JAVA],
	groovy: ['Groovy', JAVA],
	rb: ['Ruby', RUBY],
	rake: ['Ruby', RUBY],
	gemspec: ['Ruby', RUBY],
	sh: ['Shell', SHELL],
	bash: ['Shell', SHELL],
	zsh: ['Shell', SHELL],
	fish: ['Fish', SHELL],
	ps1: ['PowerShell', SHELL],
	yaml: ['YAML', YAML],
	yml: ['YAML', YAML],
	toml: ['TOML', TOML],
	ini: ['INI', INI],
	cfg: ['Config', INI],
	conf: ['Config', INI],
	env: ['Env', INI],
	properties: ['Properties', INI],
	sql: ['SQL', SQL],
	graphql: ['GraphQL', GRAPHQL],
	gql: ['GraphQL', GRAPHQL],
	php: ['PHP', C],
	pl: ['Perl', RUBY],
	lua: ['Lua', RUBY],
	r: ['R', RUBY],
	ex: ['Elixir', RUBY],
	exs: ['Elixir', RUBY],
	// Prose reads as prose. Colouring it would be the texture DESIGN.md §2
	// rejects, and the README already renders as Markdown where it matters.
	md: ['Markdown', null],
	markdown: ['Markdown', null],
	mdx: ['MDX', null],
	rst: ['reStructuredText', null],
	adoc: ['AsciiDoc', null],
	txt: ['Text', null],
	csv: ['CSV', null],
	tsv: ['TSV', null],
	log: ['Log', null],
	diff: ['Diff', null],
	patch: ['Diff', null]
};

/** Files git tracks by name rather than by extension. */
const BY_NAME: Record<string, [label: string, grammar: Grammar | null]> = {
	dockerfile: ['Dockerfile', DOCKERFILE],
	containerfile: ['Dockerfile', DOCKERFILE],
	makefile: ['Makefile', MAKE],
	gnumakefile: ['Makefile', MAKE],
	'.gitignore': ['Ignore list', INI],
	'.gitattributes': ['Git attributes', INI],
	'.dockerignore': ['Ignore list', INI],
	'.prettierignore': ['Ignore list', INI],
	'.npmrc': ['Config', INI],
	'.editorconfig': ['Config', INI],
	'.env': ['Env', INI],
	'.bashrc': ['Shell', SHELL],
	'.zshrc': ['Shell', SHELL],
	license: ['Licence', null],
	'go.sum': ['Checksums', null]
};

/** Fenced code blocks name a language rather than a file. */
const BY_INFO: Record<string, Grammar | null> = {
	javascript: JS,
	typescript: JS,
	node: JS,
	console: SHELL,
	sh: SHELL,
	shell: SHELL,
	bash: SHELL,
	zsh: SHELL,
	python: PYTHON,
	golang: GO,
	rust: RUST,
	'c++': C,
	csharp: C,
	yml: YAML,
	graphql: GRAPHQL,
	svelte: SVELTE
};

export interface Language {
	/** For the right panel. `null` when the file is not one we recognise. */
	label: string | null;
	/** `null` renders as plain text, which is always a correct answer. */
	grammar: Grammar | null;
}

const UNKNOWN: Language = { label: null, grammar: null };

/** What language a repository path is written in. */
export function languageOf(path: string): Language {
	const name = (path.split('/').pop() ?? '').toLowerCase();

	const byName = BY_NAME[name];
	if (byName) return { label: byName[0], grammar: byName[1] };

	// `component.spec.ts` is TypeScript, and `archive.tar.gz` is neither `gz`
	// nor `tar` — the last extension is the one that decides.
	const cut = name.lastIndexOf('.');
	if (cut <= 0) return UNKNOWN;

	const found = BY_EXT[name.slice(cut + 1)];
	return found ? { label: found[0], grammar: found[1] } : UNKNOWN;
}

/**
 * The grammar behind a fenced block's info string. Unknown fences render as
 * plain monospace, which is what a fence with no info string does anyway.
 */
export function grammarNamed(info: string | null): Grammar | null {
	if (!info) return null;

	// ```ts title="x.ts" — the language is the first word.
	const word = info.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
	if (!word) return null;

	if (word in BY_INFO) return BY_INFO[word];
	const byExt = BY_EXT[word];
	if (byExt) return byExt[1];
	return BY_NAME[word]?.[1] ?? null;
}

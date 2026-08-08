# Implementation plan

Ten phases. Each one ends in something usable, so the information
architecture can be judged against real repositories rather than mockups.

Sequencing rule: **the cache comes before the second screen.** Building two
screens against raw fetches and retrofitting caching afterwards means
rewriting both. Phase 2 exists to avoid that.

---

## Phase 0 — Skeleton and auth gate

**Goal:** the app runs, holds a token, and proves it can reach GitHub.

- SvelteKit with `adapter-static`, SPA mode (`ssr = false`, fallback to
  `index.html`)
- Design tokens as CSS variables, dark and light — copy the values from
  `DESIGN.md` §3, verify against `gitui-previews-v3.html`
- App shell: sidebar, header, verb row, right panel — as empty regions with
  correct dimensions
- PAT entry screen; store in IndexedDB `meta`; validate against the `viewer`
  query
- Rate-limit meter in the header, populated from the validation query

**Done when:** paste a token, see your login name and remaining quota.

**Watch for:** don't build a router-level auth guard yet — a single gate at
the shell is enough and will be replaced in Phase 9.

---

## Phase 1 — GraphQL client

**Goal:** one place where every network call goes.

- Typed query executor: document, variables, response
- Every query includes the `rateLimit` field; a response interceptor updates
  the meter
- Error taxonomy: unauthorised, rate limited, not found, network, partial
  (GraphQL can return data _and_ errors — handle both)
- REST helper for compare and PR files, carrying `If-None-Match`
- Request de-duplication: identical in-flight queries share one promise

**Done when:** a hand-called `getRepo` returns typed data and the meter
decrements correctly.

---

## Phase 2 — Cache and the Source/Store seams

**Goal:** the architecture's core. Everything after this is screens.

- `Store` interface; `IdbStore` over the four object stores with a schema
  version and a migration path
- Immutable vs mutable routing by key shape — SHA-addressed keys never
  revalidate
- `resource()` primitive on Svelte 5 runes: returns `{ data, loading, stale,
error }`, renders from cache first, revalidates behind
- `Source` interface; `GitHubSource` implementing `getRepo` and `getTree`
  only, for now
- Quota-pressure eviction, LRU over the immutable store

**Done when:** a second load of the same query paints from IndexedDB with no
network call, verified in devtools.

**Watch for:** this is the phase most likely to be rushed. The immutable/
mutable split is the whole performance story — get the key scheme right
before any screen depends on it.

---

## Phase 3 — Tree screen

**Goal:** first real screen, end to end.

- Repo header: breadcrumb, ref pill, HEAD SHA, clone URLs labelled read-only
  and read/write
- Verb row: Files / Readme / Blame / Archive / Permalink
- Listing with mode and size columns, virtualised
- README rendering below the listing
- Right panel with all three blocks — "since your last visit" can show
  placeholder zeros until Phase 8
- Sidebar file tree with expand/collapse
- Keyboard: `j`/`k`, `enter`, `/` to filter

**Done when:** you can browse a real repository of your own and it feels
faster than github.com on a second visit.

**This is the first real checkpoint.** Live with it for a few days before
Phase 4. Note what you reach for that isn't there and what you never look at.

---

## Phase 4 — File and blame

**Goal:** the screen the tool exists for.

- Code viewer, virtualised, with line numbers and stable line anchors
- Permanent blame gutter; collapse repeated commits into visual runs
- Syntax highlighting — start with Shiki or Prism for the languages you
  actually read, restrained palette per the architecture
- Verb row: View / Blame / Log / Raw / Permalink
- Deep links to `#L204` and ranges `#L204-L219`
- Large-file and binary fallbacks

**Done when:** open a file you didn't write and understand its history
without leaving the screen.

**Watch for:** blame ranges and syntax tokens are computed on different
axes. Resolve highlighting per line, then overlay blame — don't try to
interleave them in one pass.

---

## Phase 5 — Log

- Virtualised commit table with the graph column
- The five-cell delta bar plus raw counts
- Path and author filters, driven from the sidebar
- Selected-commit detail panel: full message, touched files
- Verb row: Diff / Tree here / Blame from here / Revert / Cherry-pick /
  Permalink (write verbs can link out initially)
- `enter` opens the diff

**Done when:** you can answer "when did this file get slow" without opening
github.com.

---

## Phase 6 — Refs

- Branches and tags on one screen
- Tag entries carry their message and shortlog — the refs page is the
  changelog
- Verb row: Browse / Log since previous / Archive / Compare / Permalink
- Ahead/behind against the default branch

**Done when:** you can read what shipped in a release without a separate
changelog file.

---

## Phase 7 — Review

**Goal:** the hardest screen. Budget accordingly.

- PR list, then the diff-first detail view
- Unified diff, virtualised, from the PR files endpoint
- Review threads anchored to lines, with resolved/unresolved state
- Right panel: checks, approvals, base, conflicts
- Verb row with **"Since my last review" as the default view**, not an option
- Truncation detection with an honest message and a link out
- Mark-viewed state, stored locally

**Done when:** you can do a real second-pass review of a PR that was force
pushed, and see only what actually changed.

**Watch for:** comment anchoring across force pushes is where this screen
gets genuinely hard. Store the head SHA with every thread so a comment can
be placed even when its original line has moved.

---

## Phase 8 — Since your last visit

**Goal:** turn the placeholder blocks into the feature that makes this
better than github.com rather than just quieter.

- `visits` store: record last-seen time and SHA per object, debounced on view
- Delta computation for each screen's first sidebar block
- `CODEOWNERS` parsing, cached against the tree SHA
- Dots on tree rows and sidebar items for changes in owned paths
- Force-push detection from the recorded head-SHA history
- Background revalidation tick for a pinned set of repos, ETag-conditional

**Done when:** you open the app after two days away and it tells you what
moved without you asking.

---

## Phase 9 — Command palette

- `⌘K` overlay with prefix grammar: `@` symbol, `#` review, `~` commit,
  `/` content
- Result groups: files, recent, changed-since-your-last-visit
- Ranking from local cache first, network second
- Symbols deferred — leave the group in the grammar, unimplemented

**Done when:** you stop using the sidebar tree to open files.

---

## Phase 10 — OAuth

- Confirm whether GitHub App SPA clients with PKCE are available; if so, no
  server is needed at all
- Otherwise, one edge function for the code-for-token exchange
- Refresh-token handling and re-auth prompts
- Migration path for existing PAT users — keep PAT as a fallback

**Done when:** a fresh browser can sign in without pasting a token.

---

## Suggested checkpoints

Stop and reassess the information architecture at three points rather than
at the end:

| After   | Question                                                                   |
| ------- | -------------------------------------------------------------------------- |
| Phase 3 | Is the right-panel shape right, or does one screen want a different order? |
| Phase 5 | Is the delta bar earning its space? Is the graph column worth its width?   |
| Phase 7 | Does "since my last review" work as the default, or is it disorienting?    |

---

## Risk register

| Risk                              | Likelihood | Response                                                   |
| --------------------------------- | ---------- | ---------------------------------------------------------- |
| Rate limit hit during development | High       | Cache from Phase 2, not later. Keep the meter visible.     |
| Diff truncation on large PRs      | Medium     | Detect and disclose early; don't discover it in Phase 7.   |
| Syntax highlighting bundle size   | Medium     | Load grammars lazily, only for languages actually opened.  |
| Virtual scroll retrofit           | Medium     | Build it into the row primitive in Phase 3.                |
| Blame performance on hot files    | Medium     | Cache blame by file+SHA permanently; it never changes.     |
| Scope creep into Issues/Actions   | High       | The out-of-scope list in the architecture is the contract. |

---

## Definition of done for v1

You use this instead of github.com for reading code and reviewing pull
requests for two weeks, and the times you fall back are for surfaces that
were deliberately out of scope.

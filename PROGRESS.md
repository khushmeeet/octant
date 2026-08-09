# Progress

A running record of what has actually been built, phase by phase, and the
decisions taken along the way that aren't derivable from the code.

`ARCHITECTURE.md` says why the system is shaped this way. `PLAN.md` says what
order to build it in. `DESIGN.md` says how it looks. This file says where we
got to.

| Phase | Status | Landed |
|---|---|---|
| 0 — Skeleton and auth gate | **Done** | 2026-08-06 |
| 1 — GraphQL client | **Done** | 2026-08-07 |
| 2 — Cache and the Source/Store seams | **Done** | 2026-08-07 |
| 3 — Tree screen | **Done** | 2026-08-08 |
| 4 — File and blame | **Done** | 2026-08-08 |
| 5 — Log | **Done** | 2026-08-08 |
| 6 — Refs | **Done** | 2026-08-08 |
| 7 — Review | **Done** | 2026-08-09 |
| 8 — Since your last visit | **Done** | 2026-08-09 |
| 9 — Command palette | Not started | — |
| 10 — OAuth | Not started | — |

---

## Phase 0 — Skeleton and auth gate

**Done when:** paste a token, see your login name and remaining quota. ✅

### What was built

**SPA setup.** `adapter-auto` → `adapter-static` with `fallback: 'index.html'`.
`src/routes/+layout.ts` sets `ssr = false`, `prerender = false`. The build
emits one `index.html` plus assets; there is no server, as per the
architecture. Note this project keeps its SvelteKit config inline in
`vite.config.ts` — there is no `svelte.config.js`.

**Design tokens** — `src/app.css`. Every value from `DESIGN.md` §3, checked
line-by-line against `gitui-previews-v3.html`; the two agreed, so nothing
needed reconciling. Dark on `:root`, light under `:root[data-theme="light"]`.
`DESIGN.md` §4's layout metrics are tokens too (`--row-h`, `--sidebar-w`,
`--gutter-blame`, …) so no screen hardcodes a dimension. An inline script in
`app.html` resolves the theme before first paint, falling back to
`prefers-color-scheme`.

**App shell** — `src/lib/ui/`.

| File | Role |
|---|---|
| `Shell.svelte` | sidebar \| (header → verb row → content split), snippet slots per region |
| `Sidebar.svelte` | org row, four nav items, contextual section, account footer |
| `Header.svelte` | breadcrumb, rate meter, ⌘K pill, theme toggle |
| `VerbRow.svelte` | 32px object verb bar, empty in Phase 0 |
| `RightPanel.svelte` | the three fixed blocks |
| `Pill.svelte`, `Icon.svelte`, `icons.ts` | chrome primitives; icon geometry lifted from the preview sprite |
| `types.ts` | `Verb`, `PanelEntry` |
| `format.ts` | `count()`, `until()` |
| `theme.svelte.ts` | theme state, mirrors what the pre-paint script settled on |

`RightPanel` hardcodes its three headings in fixed order and accepts only
rows — a screen structurally cannot reorder them. That is the "one shape and
never changes it" rule made unbreakable rather than merely documented.

**Auth** — `src/lib/auth/`. `TokenGate.svelte` is the entry screen;
`validate.ts` holds the `viewer` query; `token.svelte.ts` holds the session
and implements the `TokenProvider` seam from `ARCHITECTURE.md` §8, so Phase 10
touches one file. Behaviour worth knowing:

- A token is validated **before** it is persisted. Nothing unproven is stored.
- `restore()` trusts the stored token immediately and revalidates behind it —
  the same stale-while-revalidate shape the cache will use. A 401 signs you
  out; a network failure does not, because being offline is not being signed
  out.
- Storage failures (Safari private mode) degrade to a warning and a working
  in-memory session rather than stranding the app on the boot screen.
- One gate at the shell, no router-level guard — as `PLAN.md` Phase 0 warns.

**IndexedDB** — `src/lib/store/`. `schema.ts` declares all four stores from
`ARCHITECTURE.md` §5 at version 1 behind a versioned `migrate()`. `idb.ts` is
a thin promise wrapper — deliberately **not** the `Store` seam, which arrives
in Phase 2 with immutable/mutable routing and LRU eviction and will be built
on top of these primitives.

**Rate meter** — `src/lib/sync/rate.svelte.ts`, populated by the validation
query and persisted so the meter is populated before the first query of the
next session.

### Decisions

**Tailwind stays installed but unused for chrome.** Every component style is
bespoke and spec'd in exact px; utilities would have meant two sources of
truth for the token values. Tailwind is imported in `app.css` for its
preflight reset. Revisit if it never earns its place by Phase 3.

**The rate meter goes greyscale, not amber, when low.** `DESIGN.md` §3 spends
amber on "a force push you have not seen" and red on removed lines, one
meaning each. Below 10% headroom the meter takes full `--tx` contrast and a
`--bd2` border instead of spending a colour. If that reads as too quiet in
real use, amber is the obvious escalation.

**All four object stores exist at schema v1**, not just `meta`. Declaring the
shape is architecture and `ARCHITECTURE.md` §5 already fixes it; the migration
path exists either way. Phase 0 writes only to `meta`.

**Theme persists in `localStorage`, not IndexedDB.** The read has to be
synchronous to avoid a flash. Theme is chrome, not app data. This is the only
thing outside IndexedDB.

**The app frame is inset 8px** so its 10px radius means something, matching
how the preview presents it as a framed card. Full-bleed below 780px.

### Deliberately deferred

- **Sidebar nav is local state, not routes.** Phase 0 has nowhere to navigate;
  clicking Tree/Log/Refs/Review moves the selection and nothing else. Phase 3
  replaces it with the pathname.
- **No GraphQL executor.** `validate.ts` is a standalone `fetch`. It runs
  before there is a token to authorise it with, so it would have to
  special-case the executor anyway. Phase 1 owns de-duplication, the error
  taxonomy and the response interceptor; the meter is already wired to receive
  from it.
- **`⌘K` pill is inert.** Phase 9.
- **Right-panel blocks render `—`.** Real deltas are Phase 8.

### Scaffolding changes

- Removed `src/routes/demo/**` (template demo routes) and
  `src/routes/layout.css`, replaced by `src/app.css`.
- `prettier.config.js` — `tailwindStylesheet` repointed at `src/app.css`.
- `.prettierignore` — added `ARCHITECTURE.md`, `DESIGN.md`, `PLAN.md`, which
  `bun run format` had been reflowing (table padding only, no values changed).

### Verification

`bun run check` (0 errors), `bun run lint`, `bun run build` and
`bunx playwright test` all pass. Two e2e tests in
`src/routes/page.svelte.e2e.ts` cover the gate rendering and a rejected token.
Shell, gate, both themes and the <1060px breakpoint checked by screenshot.

---

## Phase 1 — GraphQL client

**Done when:** a hand-called `getRepo` returns typed data and the meter
decrements correctly. ✅

### What was built

`src/lib/source/` — one place where every network call goes. Nothing above it
touches `fetch`, a status code, or the token.

| File | Role |
|---|---|
| `document.ts` | `TypedDocument`, and the factory that composes a query |
| `graphql.ts` | the executor: token, deadline, de-duplication, taxonomy, meter |
| `rest.ts` | `restGet` with `If-None-Match`, plus `compare` and `pullFiles` |
| `errors.ts` | the error taxonomy and every mapping into it |
| `inflight.ts` | in-flight sharing with reference-counted cancellation |
| `token.ts` | the `TokenProvider` seam and a hash for keying requests per token |
| `http.ts` | endpoints, timeout composition, header parsing shared by both transports |
| `repo.ts` | the `Repo` document and `getRepo` |
| `types.ts` | `RepoRef`, `parseRepoRef` |

**Documents are composed, not written.** `document({ name, variables, body })`
wraps the selection set and appends `rateLimit { … }` itself, so a query
structurally cannot omit its own cost — the same move as `RightPanel` owning
its three headings. The executor strips the field back out before returning,
so callers never see it and never think about it.

**The error taxonomy is eight kinds**, each one something a screen can act on:
`unauthorized`, `forbidden`, `rate-limited`, `not-found`, `invalid`, `network`,
`server`, `cancelled`. Two of those are worth calling out. `invalid` means our
document is wrong rather than the user's request — a GraphQL error with no
`type` is a parse or validation failure, which is a bug and not a condition to
recover from. `cancelled` exists so a walked-away request is never rendered as
a failure.

**Partial responses are successes.** GraphQL answers with data _and_ errors
when one field is unreadable, so `QueryResult` carries `partial: GraphQLFieldError[]`
alongside the data rather than forcing the caller to choose between them.

**De-duplication is reference counted.** Identical queries in flight share one
promise; a caller abandoning its wait cancels only its own, and the request is
aborted only when the last caller leaves. One component unmounting cannot
cancel another's data.

### Decisions

**The token is a hash in the de-duplication key, not a name.** Keys are
document plus variables, and `Viewer` has no variables at all — two accounts
would collide on one entry. An FNV-1a tag of the token separates them without
holding the secret in a `Map` key. It distinguishes; it does not protect.

**`TokenProvider` moved from `auth/` into `source/token.ts`.** The client asks
for a token rather than being handed one, so the dependency runs one way: auth
knows about the client, the client knows nothing about auth. `auth/token.svelte.ts`
registers the session at module init and re-exports the type, so
`ARCHITECTURE.md` §8's promise that Phase 10 touches one file still holds.

**`validateToken` now goes through the executor**, which resolves the
carried-forward item from Phase 0. It passes an explicit token and `fresh: true` —
validating a token is a deliberate act and must never be served by another
request already in the air. The meter is populated by the interceptor now, so
`signIn` no longer records it by hand.

**The two rate budgets are held separately.** GraphQL spends points, REST
spends requests, and they refill independently — adding them yields a number
that means nothing. `rate.graphql` and `rate.rest`. The header meter stays on
GraphQL, which is what navigation costs; REST appears in the meter's tooltip,
where it answers a question you asked rather than one you didn't.

**The REST helper is stateless about caching.** It takes an ETag and returns
one; where ETags are kept is the `Store`'s business in Phase 2. Building the
storage here would have meant writing the mutable-store policy twice.

**`compare` and `pullFiles` ship now, unused.** The risk register calls for
discovering diff truncation early rather than in Phase 7, so
`comparisonTruncated()` exists alongside them and the caps are named constants.

**`Variables` is typed `object`, not `Record<string, unknown>`.** An interface
does not satisfy an index signature, so the stricter type would have forced
every future variables shape to be a type alias — a trap that fires on the
tenth document, not the first.

### Deliberately deferred

- **No caching.** Every query hits the network. `resource()` and the
  `Store`/`Source` seams are Phase 2, and the executor was built to sit under
  them: `QueryResult` is already the shape a cache wants to wrap.
- **No retry or backoff.** `rate-limited` carries `retryAt`, but deciding when
  to try again belongs to Phase 8's revalidation tick, not to a call site.
- **Pagination is a `hasNextPage` flag**, not a cursor walk. The screen that
  needs to page will say what it wants.
- **The probe screen.** `+page.svelte` is a harness, not a screen: name a
  repository, watch typed data come back and the meter get paid. Phase 3
  replaces it with Tree.

### Verification

`bun run check` (0 errors), `bun run lint`, `bun run build` and
`bunx playwright test` all pass. Three new e2e tests stub `api.github.com` and
cover the whole path: typed data rendered from `getRepo` with the meter moving
4,999 → 4,998, two clicks inside one flight producing exactly one request, and
a null `repository` beside a `NOT_FOUND` error surfacing as **Not found**.

**Not yet run against live GitHub.** The documents are checked against the
schema by hand and against stubs by test; the first real token will be the
first real proof.

---

## Phase 2 — Cache and the Source/Store seams

**Done when:** a second load of the same query paints from IndexedDB with no
network call, verified in devtools. ✅ — and pinned by a test, below.

### What was built

The key scheme first, as `PLAN.md` asks, then everything else on top of it.

| File | Role |
|---|---|
| `store/keys.ts` | `CacheKey`, `isOid`, and the three constructors that route |
| `store/types.ts` | the `Store` interface, `CacheEntry`, `Visit` |
| `store/policy.ts` | freshness windows, eviction thresholds — every constant |
| `store/idb-store.ts` | `IdbStore`: routing, freshness, LRU eviction |
| `store/schema.ts` | v2 — adds the `by-last-used` index on `immutable` |
| `store/idb.ts` | gains a key cursor, a batch delete and a count |
| `source/query.ts` | `CacheQuery`, `Fetched`, and adapters from Phase 1's results |
| `source/tree.ts` | the `Tree` document and `getTree` |
| `source/source.ts` | the `Source` interface and `GitHubSource` |
| `sync/resource.svelte.ts` | `resource()` — cache first, revalidate behind |

**The key decides the store, and it is decided once.** `immutableKey` throws
on anything that is not an object ID; `revKey` takes a revision and routes on
what it actually is. So a tree asked for by commit SHA is permanent and a tree
asked for by branch name is not, without a screen ever choosing. `IdbStore.get`
then refuses to mark an immutable entry stale whatever window it was passed —
the immutable/mutable split is two lines of code in two files, and neither is a
convention anyone can forget. Same move as `document()` composing `rateLimit`
in, and `RightPanel` owning its three headings.

**A `Source` method does not fetch — it describes a fetch.** `getRepo(ref)`
returns where the answer is kept, how long it stands, and how to go and get it.
That is what lets `resource()` be the only thing that knows the *order*: read
cache, render, stop if immutable, revalidate if not. A source that cached for
itself would have to hand back two values to render-then-revalidate, and a key
computed apart from the query it belongs to is a key that eventually stops
matching it.

**`resource()` is the whole read path from `ARCHITECTURE.md` §5 as one
primitive.** It also resolves the three items Phase 1 carried forward: ETags are
stored and replayed, out-of-order responses are guarded by a generation counter
in the right place, and a screen navigated away from still writes what it paid
for to the cache — the store write happens before the staleness guard, so the
next visit does not pay again.

### Decisions

**Eviction has two pressure signals, not one.** `navigator.storage.estimate()`
is coarse, and on a machine with a generous quota it may never complain while
the store grows without bound. So there is also a hard ceiling of 4,000
immutable entries, and it is the one that fires in practice. Quota pressure
evicts in rounds of 25% with a re-estimate between them, because there is no
per-entry size on record — measuring one would mean serialising every blob
twice, which is the cost the cache exists to avoid.

**LRU touches are coalesced to the hour.** Marking an entry used on every read
would make a cache hit a write, which defeats the point. Recency is only ever
compared *between* entries, so resolving it to the hour is far finer than
eviction needs. This is why the schema went to v2: ordering by `lastUsedAt`
needs an index, or a sweep has to load every cached blob into memory to sort it.

**The pressure check runs on writes, not on a timer.** Growth is caused by
writes, so writes are the right clock: the first put of a session, then every
64th. No timers to own, and the check is a count plus an estimate.

**`Source` declares two methods, not nine.** `ARCHITECTURE.md` §9 names nine.
A method that exists and throws is a worse lie than one that is honestly
absent, and the compiler is more use when the interface tells the truth. The
other seven arrive with the screens that need them. This is the opposite call
from Phase 0's "declare all four object stores now", and deliberately: an object
store is an inert declaration, a method is a promise to a caller.

**The repository summary is mutable, whole.** It carries HEAD, so it moves.
Splitting the permanent half out would cost a second round trip to save a few
hundred bytes, against an architecture whose rule is one query per screen.

**Tree entries are sorted at the source, directories first.** Git stores them
in byte order, interleaved. Every tool that shows a tree to a person groups
directories, because the two are navigated differently. Doing it here keeps it
out of the render path and means the cached listing is already in display order.

**A failed revalidation keeps the data on screen and sets `error` beside it.**
Both are true, and it is the same shape as the executor's `partial`: you have
something, and it is not the whole story. Only a `cancelled` result writes
nothing at all — walking away is not a failure.

**`resource()` ignores a re-run at an address it already holds.** A query
descriptor is a fresh object on every read, so any unrelated state change
re-runs the effect with an identical key. Cancelling a request to reissue the
same one is waste we pay for out of the rate limit.

### Deliberately deferred

- **No in-memory layer in front of IndexedDB.** A cached read costs an IDB
  round trip — a millisecond or two, inside the 16ms budget. A memory LRU would
  make it synchronous and cut IDB traffic on repeat navigation; worth revisiting
  in Phase 5 when the log starts moving real volume, not before there is
  something to measure.
- **No background revalidation tick.** `resource()` revalidates what is looked
  at. Polling a pinned set of repos is Phase 8, and `ARCHITECTURE.md` §12 has
  not settled how many.
- **No prefetch on hover.** Wants rows to hover over. Phase 3.
- **`visit`/`lastVisit` are implemented but unused.** The interface names them
  and they are four lines; Phase 8 computes deltas from them.
- **`compare` and `pullFiles` are still outside the seam.** They are REST, they
  need `fromRest`, and the screen that shapes them is Phase 7.

### Verification

`bun run check` (0 errors), `bun run lint`, `bun run build` all pass.
`bunx playwright test --repeat-each=3` — 30 passed, no flakes. Six tests are
new, and four of them are the phase:

- a second load paints from IndexedDB with **no network call** — fetch, reload
  the page, fetch again, and both operation counters are still at 1;
- a listing addressed by SHA is never asked for twice — descend, return,
  descend again, two requests total;
- a failed revalidation keeps the cached render on screen;
- a full immutable store is evicted oldest-first — 4,001 seeded entries are
  swept to 3,200 on the first write, oldest gone, newest kept;
- a v1 database from Phase 0/1 is migrated in place and gains the index.

Both themes checked by screenshot at 1440px.

**Still not run against live GitHub.** `Tree` is schema-checked by hand like
Phase 1's documents. `mode` arriving as an integer and `object` being null on
non-blob entries are the two things to confirm first with a real token.

---

## Phase 3 — Tree screen

**Done when:** you can browse a real repository of your own and it feels faster
than github.com on a second visit. ✅ — on a stubbed repository, and pinned by
tests. The live-token qualifier under **Verification** still stands.

### What was built

The first real screen, and the routing underneath it.

| File | Role |
|---|---|
| `nav/paths.ts` | the URL scheme, and every internal link in the app |
| `nav/recent.svelte.ts` | repositories opened before — the entry screen's list |
| `routes/+page.svelte` | the entry screen, replacing the Phase 2 probe |
| `routes/[owner]/[name]/+page.svelte` | a repository's front page |
| `routes/[owner]/[name]/tree/[rev]/[...path]/+page.svelte` | a tree at a revision |
| `tree/TreeScreen.svelte` | the screen: two resources, rows, keyboard, verbs, panel |
| `ui/VirtualRows.svelte` | fixed-height rows, virtualised against the page's scroller |
| `ui/FileTree.svelte`, `ui/FileTreeNode.svelte` | the sidebar's contextual tree |
| `ui/CloneStrip.svelte` | two clone URLs, labelled by what they let you do |
| `ui/clipboard.ts` | copy, with the `execCommand` fallback |
| `md/parse.ts` | a small Markdown parser: source in, typed AST out |
| `md/Markdown.svelte`, `md/MdBlocks.svelte`, `md/MdInline.svelte` | the renderer |
| `source/blob.ts` | the `Blob` document and `getBlob`, addressed by object ID |
| `sync/prefetch.ts` | prefetch on hover and on mount |
| `sync/settle.ts` | fetch and file, as one shared operation |

Reworked: `Shell` gained a `sidebar` region so a screen can fill all five;
`Sidebar` takes the repository and the route instead of local state, and its
four nav counts come from the summary Phase 1 was already fetching; `Header`
takes linked breadcrumbs and a screen's own pills; `VerbRow` verbs can be links,
because a verb that resolves in under 50ms is either local work or something the
browser does. `format.ts` gained `ago`, `bytes`, `kilobytes`.

**Two resources, in parallel, never chained.** An unnamed revision is queried as
the literal `HEAD` rather than resolved to the default branch first. Waiting for
the repository summary to learn the name of a branch we were about to ask GitHub
about anyway is a waterfall that buys no information, and it would sit on the
screen people open most.

**The README is addressed by the blob's own object ID**, which the listing
already carries. So it is permanent, and it is one cache entry shared across
every revision where the file did not change — the Phase 2 key scheme paying
out. It is also the third read on the screen, deliberately behind the listing:
it is below the fold, so arriving a beat later costs nothing.

### Decisions

**The revision is exactly one percent-encoded path segment.** Git allows a slash
in a ref name, which is why github.com's own `/tree/release/1.0/src` is
ambiguous — it consults its ref list to know where the name ends and the path
begins, and we would have to spend a round trip on the same question. Encoding
answers it in the URL: `release%2F1.0` is one segment, always. The cost is that
a github.com URL pasted for a slashed branch reads the wrong way; that is rarer
than navigating, and it fails visibly.

**`settle()` — fetch and file as one shared operation.** Found by a test that
failed one run in eight. Phase 1's in-flight sharing collapses identical
requests, but it stops at the response: between an answer arriving and it
landing in IndexedDB there is a window where a second reader's cache lookup
misses and issues the same request again. The sidebar tree and the main listing
ask for the same directory at the same instant on every Tree screen, and a hover
prefetch races the click that follows it, so the window is not hypothetical.
Moving the store write *inside* the shared work closes it. `resource()` and
`prefetch()` now share one path.

**Markdown is parsed into an AST, never into HTML.** GitHub renders Markdown for
us over REST and the result would be one `{@html}` from the screen.
`ARCHITECTURE.md` §11 already lists the token in browser storage against "XSS is
a real risk", and injecting third-party markup into the document that holds it
makes that risk strictly worse for a feature not worth it. A tree of typed nodes
rendered by Svelte cannot inject anything. Raw HTML in a README is stripped and
images render as their alt text — that is where the badges and centred logos
live, and `DESIGN.md` §8 does not want them. It is a subset by design, and it
never throws: anything it does not understand comes out as text.

**Virtualisation is against the page's scroller, not one of its own.** A list
with its own scrollbar would have forced the README into a second scrolling
region, and two scrollbars on one screen is a worse answer than any amount of
implementation. The slice is positioned with padding rather than transforms, so
nothing moves and the rows keep their place for find-in-page and the focus ring.

**A verb that cannot act is absent.** `PLAN.md` lists Blame in this screen's verb
row; git has no directory blame and the file screen is Phase 4, so it is not
there. Permalink appears only where a commit SHA is known, which in Phase 3 is
the default branch — Phase 6's ref map extends it to the rest. `DESIGN.md` §5
makes "every verb resolves" the rule, and a verb that greys out is a worse
answer than a row that is honest about its length.

**Files link out to github.com.** The file screen is Phase 4. `ARCHITECTURE.md`
§1 says what is out of scope links out, and the same is honest for what is not
built yet. Phase 4 changes `blobUrl`'s call sites and nothing else.

**Log, Refs and Review are rendered, unreachable, and carry real counts.** No
stub routes: an item that says which phase builds it beats a link to a page that
apologises. The counts were already in the repository summary.

**The keyboard cursor starts unset.** A screen you have just opened should not
claim one of its rows is special; the first `j` or `k` starts at the top.
Selection carries `aria-current` as well as a tint, so it is not colour alone —
`DESIGN.md` §9.

**Prefetch stops when headroom is low.** A prefetch is a guess, so it is the
first thing to give up when the rate limit is tight. Navigation the reader
actually asked for keeps its quota.

**`nav/` is a new module**, beyond the layout in `ARCHITECTURE.md` §9. The URL
scheme is read by routes, written by the chrome and followed by the keyboard;
it is the app's addressing scheme rather than a detail of the UI. Every link in
it is built with SvelteKit's `resolve()` against a typed route ID, so a renamed
route directory fails the type check instead of 404ing at runtime. The lint rule
that wants to see that call at the link itself cannot see through a function, so
it is turned off in `eslint.config.js` with that note — centralising the
construction is the stronger version of what it asks for.

**The entry screen lists what you have opened, not what GitHub can show you.**
A repository list is a fan-out across the API that §7 forbids outright, and the
account surfaces are out of scope anyway. What is local is free and a better
answer. It accepts a pasted github.com URL, which is what is usually on the
clipboard when you arrive there.

### Deliberately deferred

- **"Since your last visit" is three placeholder rows.** Phase 8, as `PLAN.md`
  allows. The `visits` store is still unwritten: recording last-seen without
  computing a delta would be data nobody reads, and Phase 8 wants to design both
  together.
- **No syntax highlighting**, including in README code blocks. Phase 4 chooses
  the highlighter and the file screen gets it first; a second implementation
  here would be one to throw away.
- **No `..` at the repository root, no breadcrumb-relative filtering.** The
  filter is this directory only, and the `..` row hides while it is active,
  because the way out of a search is not one of its results.
- **The right panel's shape is unreviewed.** `PLAN.md`'s first checkpoint asks
  whether one screen wants a different order. It has been used for hours, not
  days — the answer belongs after living with it.

### Verification

`bun run check` (0 errors), `bun run lint` and `bun run build` all pass.
`bunx playwright test --repeat-each=6` — 114 passed, no flakes. The suite is 19
tests and now runs in about 25 seconds; it also stubs the webfont CDN, which was
putting a third party's latency inside every navigation it measures.

Nine tests are new, and the phase is in these:

- the screen carries its repository, clone URLs, README, the three right-panel
  blocks in fixed order, and sidebar counts;
- the README renders as Markdown and its raw HTML block does not survive;
- `j`/`k` move a selection that starts unset, and `enter` opens the row —
  including `..`, which is a row precisely so the keyboard reaches it;
- `/` focuses the filter and filtering narrows the listing and its tally;
- four thousand entries render as a window of under 120 rows, and scrolling the
  page's own scroller reveals the last of them;
- hovering a directory warms it, and opening it afterwards costs nothing;
- expanding the sidebar tree and opening the same directory in the main column
  is one request, not two;
- Permalink re-addresses the tree by SHA, and that address is never re-fetched
  however stale everything around it goes;
- a branch name with a slash survives the round trip through the URL.

Both themes checked by screenshot at 1440px, and the <1060px breakpoint where
the right panel hides.

**Still not run against live GitHub.** Three things to confirm with the first
real token, in this order: `Repository.object(oid:)` returning a `Blob`, which is
new in this phase; `HEAD` accepted as an `expression` prefix, which the whole
no-waterfall argument rests on; and `mode` arriving as an integer with `object`
null on non-blob entries, carried over from Phase 2.

---

## Phase 4 — File and blame

**Done when:** open a file you didn't write and understand its history without
leaving the screen. ✅ — on a stubbed repository, and pinned by tests. The
live-token qualifier under **Verification** still stands.

### What was built

The screen the tool exists for, and the two things underneath it that had no
home before: a syntax highlighter and a code viewer.

| File | Role |
|---|---|
| `code/tokenize.ts` | the scanner: one line in, four kinds of token out |
| `code/lang.ts` | the grammars, and what a path or a fence is written in |
| `code/highlight.ts` | the seam: lazy line states, memoised tokens, `splitLines` |
| `code/CodeLine.svelte` | one line's tokens, as spans |
| `code/CodeViewer.svelte` | line numbers, blame gutter, source — virtualised |
| `code/blame.ts` | blame ranges reconciled onto lines, with runs marked |
| `code/Code.svelte` | a whole short snippet, for a README's fenced blocks |
| `file/FileScreen.svelte` | the screen: three resources, verbs, keyboard, panel |
| `nav/lines.ts` | `#L204` and `#L204-L219`, parsed and formatted |
| `source/blame.ts` | the `Blame` document and `getBlame` |
| `routes/[owner]/[name]/blob/[rev]/[...path]/+page.svelte` | a file |
| `routes/[owner]/[name]/blame/[rev]/[...path]/+page.svelte` | a file, with the gutter |

Reworked: `source/blob.ts` gained the `File` document and `getFile`, and the two
addresses a blob has now share one reader; `Source` grew from three methods to
five; `nav/paths.ts` gained `fileHref`/`parseFile` and four link-outs, and
`blobUrl` became `githubBlobUrl` now that "the blob URL" means ours; `Verb`
gained `onhover`; `VirtualRows` accepts a `readonly` list and centres a distant
row; `FileTree` carries the open file; `MdBlocks` renders fences through the new
highlighter. `SourceError` gained `objectType`, and both screens act on it.

**One round trip from a URL.** `getFile` addresses `rev:path` rather than
resolving the path to an object ID first. The object ID is permanent and the
path is not, so the SHA-addressed read is the better cache citizen — but getting
there costs a tree query before the blob query, and ARCHITECTURE.md §4 does not
allow a waterfall on the screen people open most. On a commit SHA the key is
immutable anyway, so a permalink pays the object ID's price. `getBlob(oid)` stays
for the README, which already holds the ID.

**Blame is a third read and its own address.** It is the most expensive query in
the app — GitHub walks the file's history for it — so the code is on screen and
readable while it is still out, and `/blob/…` never asks for it at all.

### Decisions

**The highlighter is ours, not Shiki's or Prism's.** `PLAN.md` names both; this
is a deliberate departure, for three reasons that compound.

The first is the palette. DESIGN.md §3 spends exactly four colours on syntax —
keyword, string/literal, comment, call site — and says they sit *under* the
chrome. A TextMate grammar resolves dozens of scopes that we would then collapse
into those four, so the mapping table would be larger than the scanner.

The second is decisive: **the viewer is virtualised, and Shiki is not
incremental.** `codeToTokens` tokenises a whole blob in one blocking pass
proportional to the file, against a 400ms cold budget and a 16ms warm one. A
line-based scanner with a carried state does a viewport's worth of work to open a
20,000-line file, and walks the rest only if you scroll there.

The third is the one Phase 3 already made about Markdown. Shiki's natural output
is an HTML string and `{@html}`, and ARCHITECTURE.md §11 lists the token in
browser storage against "XSS is a real risk". Rendering repository contents as
markup in the document that holds the token makes that risk strictly worse.
(Shiki *can* return tokens instead — but at that point it is being used as a
tokeniser, which is the part we are cheapest at.)

It is a subset, and it says so: a grammar it gets wrong is a colour that is
missing, never a line that is. If it proves too weak in use, `highlighter()` is a
five-line seam and Shiki's `codeToTokens` satisfies it.

**Line state is one integer, so a file's worth of it is an array of numbers.**
`embed * 64 + inner` — which grammar is in force, and which multi-line construct
the line opened inside. That is what makes walking ahead to line 3,000 a pass
over characters with no allocation, and it is why `scan()` takes an `out` array
that may be `null`: the same code path computes state alone or state and tokens.

**An unterminated string ends with its line unless the construct really spans
lines.** A template literal or a docstring sets the carried state; a stray
apostrophe in a comment-free line does not, or one quote would tint the rest of
the file. This is also why the Rust grammar has no single-quote string: `&'a str`
is a lifetime, not a literal.

**The blame gutter is an address, not a toggle.** View and Blame are two things
you send to someone, so each has a URL, the back button steps between them, and
the `#L204` survives the trip. It is also how git names them. The cost is a
second route directory; the alternative was a switch whose state nobody else
could see.

**Blame is warmed by hovering its verb.** DESIGN.md §5 requires every verb to
resolve in under 50ms, and a query cannot. The tree's rows already make this
bargain with hover, so the verb row makes it too — `Verb.onhover`. At a commit
SHA the gutter is then paid for exactly once, ever.

**A run is not a range.** GraphQL answers blame in ranges, and two adjacent
ranges can carry the same commit — git splits a hunk when something between them
changed and changed back. Collapsing on the range would print one author as two;
`blameByLine` collapses on the commit, which is what DESIGN.md §5 means by
"authorship reads as blocks".

**The selection tints the source and rules the gutter, rather than tinting the
row.** A translucent fill painted on a row and again on a `position: sticky`
child inside it composites twice and bands visibly. So the gutters stay opaque
and the addressed line's number carries an inset accent rule — which makes the
selection something other than colour alone, as DESIGN.md §9 asks anyway.

**A revealed row is walked to when it is near and centred when it is not.**
`VirtualRows` scrolled minimally, which is right for `j` and `k` — one press
should move the list by one row, not throw it. It is wrong for a link to line
3,000: the minimal scroll pins that line to the bottom edge with nothing under
it, and the lines around a line are most of what you followed the link for. So a
row more than a viewport away is centred instead. The tree gets the same rule and
never notices, because its cursor only ever moves by one.

**The whole file is measured to fix the column's width.** A virtualised list
holds only what is on screen, so a horizontally scrolling code column would be as
wide as the widest line *currently rendered* and would jump as you scrolled past
a long one. `widestLine()` is one allocation-free pass and it settles the width
for the file. Tabs are counted to their stop, because this repository is written
with them.

**`goto(…, { replaceState: true })`, not SvelteKit's `replaceState`.** The
selection is derived from `page.url.hash` so that there is one answer to "which
lines are these" and the back button moves it. Shallow routing's `replaceState`
does not move `page.url`, so the derivation never fired — found by the test for
shift-extending a range. Replacing rather than pushing is deliberate: addressing
twenty lines in turn is one step back out of the file, not twenty.

**An address that resolved to the other kind of object is not an error.**
`SourceError.objectType` carries the typename, and each screen follows it: a tree
URL naming a file lands on the file screen, and the reverse. Phase 3 left a
comment promising this; it costs one field and two effects. Telling someone their
perfectly good URL was wrong is the worse answer.

**A verb that cannot act is still absent.** Blame does not appear on a binary or
oversized file, because there are no rendered lines for a gutter to sit beside.
Permalink follows Phase 3's rule unchanged.

**The file screen reads its own directory rather than prefetching it.** The
sidebar's tree opens the ancestors of the current path and asks for exactly that
listing, so the two share one request through `settle()`. Reading it as a
resource costs nothing more than the prefetch did and makes the sidebar's Tree
count real instead of blank.

**README fences go through the same scanner.** Phase 3 deferred this on the
grounds that a second implementation would be one to throw away; there is now one
implementation, and `Code.svelte` is the non-virtualised way in.

### Deliberately deferred

- **No in-app fallback fetch for a large blob.** ARCHITECTURE.md §11 says "fall
  back to raw URL, then to 'too large'". The raw URL is offered as a link — as
  the Raw verb and from the stop block — but not fetched: `raw.githubusercontent.com`
  does not serve CORS for private repositories, so it would work for exactly the
  files that need it least. The right door is REST `/repos/…/git/blobs/:sha`,
  which is CORS-enabled and authenticated; it wants `fromRest` and the mutable
  ETag path, which Phase 7 is already building for the diff.
- **`getFile` does not also file its content under the blob's object ID.** The
  response carries the `oid`, so the same bytes could be shared with `getBlob`'s
  permanent entry and with every other revision where the file did not change.
  It needs `settle()` to accept a second key, which is a change to the write path
  and not to a screen. Worth doing when the blob cache has real files in it.
- **`/` does nothing on the file screen.** DESIGN.md §6 gives it "filter", and on
  a file that means find-in-file. Phase 9's palette already claims `/` for
  content search; deciding twice would be deciding wrong once.
- **The blame gutter links out to github.com for a commit**, like Log. Phase 5
  makes both internal.
- **`age` is not selected from the blame query.** It would make a heat gutter
  possible, and DESIGN.md §8 does not want the decoration. It costs nothing to
  add if reading blame in anger says otherwise.
- **"Since your last visit" is three placeholder rows**, as on the Tree screen.
  Phase 8.

### Verification

`bun run check` (0 errors), `bun run lint` and `bun run build` all pass.
`bunx playwright test --repeat-each=4` — 128 passed, no flakes. The suite is 32
tests and runs in about 26 seconds.

Thirteen tests are new, and the phase is in these:

- the screen carries its file, the five verbs `PLAN.md` names, nine numbered
  lines from a file whose own trailing newline is not a tenth, and a breadcrumb
  that walks directories and ends on the file;
- four kinds of token are coloured, a block comment's state survives a line
  break, and **not one character of the source is changed** — asserted on a
  tab-indented line, which is the character a template would quietly eat;
- `#L5` and `#L2-L4` address a line and a range, and the range survives the trip
  to the blame view of the same file;
- clicking a line number addresses it and shift-clicking extends it, and two
  addresses later one step back leaves the file altogether;
- `j`/`k` move a cursor that starts unset, `enter` addresses the line and `esc`
  clears it;
- blame is not fetched by the view that does not show it, and three ranges over
  two authors collapse into three runs — including the second run of the commit
  that was already seen further up;
- hovering the Blame verb warms it, and opening the gutter afterwards costs
  nothing;
- markup hands its `<script>` region to another grammar after the tag's `>`,
  keeps it across a line break, and takes it back on `</script>`;
- a binary file says so, offers the bytes, and drops the verb it cannot honour;
- four thousand lines render as a window of under 140 rows, the file says it was
  truncated, and a link to line 3,000 arrives centred with its neighbours rather
  than pinned to the bottom edge;
- a file opens inside the app from the tree now, and hovering one warms it;
- a tree address that names a file lands on the file screen;
- a README fence is read by the same scanner as the file screen.

Both themes checked by screenshot at 1440px, along with the blame gutter, the
binary stop block, and a 400-character line scrolled sideways to confirm both
gutters stay pinned.

**Still not run against live GitHub.** Two documents are new and neither has met
a real token: `File`, whose `object(expression:)` on a `Blob` mirrors `Tree`'s
and should be safe, and `Blame`, which is the one to watch — `Commit.blame(path:)`
is the most expensive field we have asked for, and how it behaves on a large
file, and how its `startingLine`/`endingLine` line up against `Blob.text`, are
both things only a real repository will settle.

---

## Phase 5 — Log

**Done when:** you can answer "when did this file get slow" without opening
github.com. ✅ — on a stubbed repository, and pinned by tests. The live-token
qualifier under **Verification** still stands.

### What was built

Two screens, because the answer to "when" is only half the question. The log
says which commit, and the commit screen says what it did.

| File | Role |
|---|---|
| `source/log.ts` | the `Log` document and `getLog` — one page of history |
| `source/commit.ts` | `getCommit`: one commit and its patches, over REST |
| `sync/pages.svelte.ts` | `pages()` — a walk, one cached page at a time |
| `log/graph.ts` | lanes, from parents, as box-drawing characters |
| `log/authors.ts` | who has been committing, among what is loaded |
| `log/LogScreen.svelte` | the screen: table, scope, filters, detail pane |
| `log/Scope.svelte` | the sidebar's `Scope` section — path and author |
| `log/CommitDetail.svelte` | the selected commit: whole message, touched files |
| `ui/DeltaBar.svelte` | five cells, and the only graphic in the app |
| `diff/parse.ts` | unified patches in, hunks and numbered lines out |
| `diff/DiffView.svelte` | the diff, virtualised, one list across every file |
| `commit/CommitScreen.svelte` | one commit, its message and its whole diff |
| `routes/[owner]/[name]/log/[rev]/[...path]/+page.svelte` | history, scoped |
| `routes/[owner]/[name]/commit/[rev]/+page.svelte` | one commit |

Reworked: `Source` grew from five methods to seven; `rest.ts` gained the commit
endpoint, and `fromRest` has a caller at last; `query.ts` gained `PageOf`;
`nav/paths.ts` gained `logHref`, `commitHref`, `fileAnchor` and their parsers,
and lost `githubHistoryUrl` — the Log verb is internal now, and so is the blame
gutter's commit link, which closes the two items Phase 4 carried forward.
`Sidebar` takes a `rev` and a `logCount`, and Log is a destination rather than
an honest dead end.

**One query per page, and a page is an address.** `getLog` takes a cursor and
`pages()` files what comes back under a key that names it. That is the whole
pagination design: the first page is mutable and revalidates, the pages behind
it are addressed from a cursor and are as permanent as the walk they came from,
and a log at a commit SHA is immutable end to end.

### Decisions

**`resource()` was not made to paginate; `pages()` was written beside it.** The
shared part is two lines — read the cache, then `settle()` — and the rest is
genuinely different: appending rather than replacing, a position per page, and
a rule for what a moved cursor invalidates. Forcing both through one primitive
would have complicated the one that every screen depends on in order to spare
forty lines in the one that two screens do.

**A page whose cursor moved drops the pages behind it.** They were addressed
from the cursor it used to end at, and if history has shifted under them,
keeping them is splicing two different walks together and calling the result a
log. Dropping them means the next `more()` re-reads — from cache, if the walk
did not really change.

**A parent outside the loaded window closes its lane.** This one rule is what
makes the graph column survive the two cases that would otherwise wreck it. A
path-scoped log is not a graph — filtering drops the commits in between, so no
commit is its neighbour's parent — and without the rule every row would open a
lane nothing ever closes, marching off the right-hand edge within a screenful.
With it, a filtered log draws a spine, which is what a filtered log honestly
is. The same rule handles the foot of a page, where the parents are merely not
loaded yet; loading more redraws the column, because it is one cheap pass.

**The delta bar's fill is a scale, not a proportion.** A one-line fix and a
thousand-line rewrite have to look different from across the table, and a
proportion of a total you cannot see says nothing at all. Cells light at 1, 10,
50, 200 and 1,000 changed lines, written out rather than derived from a
logarithm because those boundaries are what the eye is being asked to learn.
The green/red split within the lit cells is proportional, with the rounding
pinned so a change that added anything keeps a green cell and one that removed
anything keeps a red one.

**The author filter is local, and says so everywhere it appears.** GitHub can
filter history by author server-side, but only by node ID, and turning a login
into one costs a round trip *before* the log can be asked for — a waterfall on
the screen, for a filter. So it narrows what is loaded, instantly, and every
surface states the reach: the sidebar counts per author, and the tally reads
"3 of 50 loaded · 109 commits". The path filter, which is the one the phase's
"done when" turns on, is server-side and changes the total. Scope is a segment
because it addresses a different object; author is a query parameter because it
is a view of the same one.

**The screen is a split, and the detail pane is the reason.** Scanning a log and
reading a commit are two halves of one question. With the pane pinned below the
table, `j` and `k` walk the history with each message and file list appearing in
place, instead of a round trip to another screen for every candidate.
`VirtualRows` virtualises against its nearest scrolling ancestor, so giving the
table its own scroller cost nothing — Phase 3 built it for exactly this.

**The pane fills in two beats, and the second one is debounced.** The whole
message, the author, the counts and the bar are already in the log query, so
they are there the instant the cursor lands — pressing `j` must never blank the
screen. The file list is a second read, and it waits 120ms for the cursor to
stop, because holding `j` down through fifty rows must not be fifty requests.
It is the same query the commit screen makes, under the same key, so resting on
a row pays for the screen `enter` opens.

**Clicking a row selects; the row is still a link.** The same bargain the code
viewer's line numbers make: the click is ours and calls `preventDefault`, so
plain clicks select and the detail pane fills, while a modified click is left to
the browser and opens the commit in a new tab. `enter` opens, and so does a
double-click and the Diff verb.

**Revert and Cherry-pick copy the command.** `PLAN.md` allows write verbs to
link out, but github.com has no revert for a bare commit to link to, and
`ARCHITECTURE.md` §1 says we perform no writes. What resolves instantly and is
honest is `git revert <sha>` on the clipboard — the thing you were going to run
anyway. Same rule as everywhere else: a verb that cannot act is absent, and one
that can act says exactly what it did.

**The diff is one flat list of fixed-height rows across every file.** File
headers, hunk headers and lines alike, so a forty-file commit is one scroller
and one window. A virtualised list drifts against its own arithmetic the moment
two rows disagree about their height, so the file header is a 20px row that
earns its presence from tint and weight rather than from size.

**No syntax highlighting inside the diff.** Our scanner carries state from one
line to the next, and a hunk is a handful of lines cut out of a file with the
rest missing — so the state at the top of a hunk is unknown and a highlighter
run over it would confidently colour the wrong things. A missing colour is a
subset, which Phase 4 already accepted; a wrong one is a lie.

**A commit's file list is the sidebar's `Files` section.** The commit screen had
no obvious contextual section, and jumping to a file's patch in a forty-file
diff is the thing you actually want there. It scrolls by row arithmetic rather
than by anchor, because the row an `#f-…` names may not be rendered yet — the
same trick as a deep link to line 3,000.

### Deliberately deferred

- **No server-side author filter.** It needs a login → node ID lookup, which is
  a round trip before the log query rather than beside it. If the local filter
  proves too shallow in use, the honest fix is `user(login:)` cached under its
  own key, and a waterfall paid only while a filter is active.
- **The log does not auto-load when you scroll to the end.** "Load more" is a
  button, because infinite scroll on a virtualised list that is also the page's
  scroller is a surprise, and because a rate limit is a real budget.
- **`enter` on the log does not open a diff *scoped to the path*.** A
  path-scoped log opens the whole commit. GitHub's compare endpoint cannot
  filter by path either; the file list makes it a click away.
- **No word-level diff within a line.** DESIGN.md gives the diff a sign column
  and a row tint and nothing else, and intraline highlighting is a second
  colour meaning on top of the one green already carries.
- **Split (side-by-side) diff view.** Unified only, as DESIGN.md §5 specifies.
- **"Since your last visit" is three placeholder rows** on both new screens, as
  on the Tree and File screens. Phase 8.

### Verification

`bun run check` (0 errors), `bun run lint` and `bun run build` all pass.
`bunx playwright test --repeat-each=4` — 180 passed, no flakes. The suite is 45
tests and runs in about 35 seconds.

Thirteen tests are new, and the phase is in these:

- the screen carries its commits, their SHAs, authors, ages and raw counts, the
  three right-panel blocks in fixed order, and a tally that says what it is not
  showing — `50 of 109 commits`;
- the graph opens a lane for a merge, carries it down beside the spine, and
  closes it into the parent both sides share — `●╮`, `│●`, `●╯`;
- `j`/`k` move a selection that starts unset, and the pane fills in two beats:
  the whole message immediately, the file list after a second read;
- `enter` opens the diff, and resting on the row had already paid for it — the
  commit is fetched once, and the screen it opens fetches nothing;
- the diff numbers both sides independently, signs every row, and renders its
  hunk header — a deletion advances the old side only, an addition the new;
- a binary file in a commit says so rather than rendering as an empty diff, and
  a rename says where it came from;
- a four thousand line diff renders as a window of under 140 rows, and the last
  line is reachable by scrolling the page's own scroller;
- the file screen's Log verb is internal, warms what it opens, and lands on a
  path-scoped log whose total is the scope's — four commits, not a hundred and
  nine — drawn as a spine rather than as leaked lanes;
- the sidebar re-scopes the log by path and narrows it by author, and the author
  filter states its reach: `3 of 50 loaded · 109 commits`;
- a further page is fetched once, and walking the whole log down a second time
  after leaving the screen costs nothing at all;
- the blame gutter opens a commit inside the app now;
- Revert and Cherry-pick copy the command, and are absent until a commit is
  selected;
- a commit addressed by SHA is never fetched twice, however stale everything
  around it goes.

Both themes checked by screenshot at 1440px, along with the detail pane, the
commit screen, and the <1060px breakpoint where the right panel hides.

**Still not run against live GitHub.** Two things are new and neither has met a
real token. `Commit.history`'s cursor is the one to watch: this phase assumes a
cursor keeps addressing the same position in the walk it came from, which is
what makes a page cacheable under it — the stub's cursor is an index, and a real
one is opaque. And `additions`/`deletions` on every node of a 50-commit page is
the most expensive thing we have asked GraphQL for since blame; if it proves
costly against the rate limit, the delta bar is the field to make optional.

---

## Phase 6 — Refs

**Done when:** you can read what shipped in a release without a separate
changelog file. ✅ — on a stubbed repository, and pinned by tests. The
live-token qualifier under **Verification** still stands.

### What was built

Two screens again, for the same reason Phase 5 needed two: a list of tags says
that releases happened, and the thing you came to find out is what was *in*
one.

| File | Role |
|---|---|
| `source/refs.ts` | the `Refs` document and `getRefs` — one page of branches, or of tags |
| `source/compare.ts` | `getCompare`: `base...head`, over REST |
| `source/revision.ts` | the commit a revision names, and the field two documents carry to ask |
| `refs/shortlog.ts` | commits in, `git shortlog` out |
| `refs/RefsScreen.svelte` | the screen: two walks, one list, the selected ref's range |
| `refs/RefDetail.svelte` | DESIGN.md §5's Tag block — pills, message, shortlog |
| `refs/Kinds.svelte` | the sidebar's `Scope`: which half, and what drift is measured against |
| `compare/CompareScreen.svelte` | a range: its commits and its whole diff |
| `routes/[owner]/[name]/refs/+page.svelte` | branches and tags |
| `routes/[owner]/[name]/compare/[base]/[head]/+page.svelte` | what is between two revisions |

Reworked: `Source` grew from seven methods to nine, which is every method
`ARCHITECTURE.md` §9 names except the two the Review screen will add;
`tree.ts` and `blob.ts` carry one more aliased field each; `commit.ts` exports
its per-file mapper, because the compare endpoint sends the identical shape;
`nav/paths.ts` gained `refsHref`, `compareHref`, their parsers and
`githubCompareUrl`; `Sidebar` makes Refs a destination and takes a `refsCount`;
`policy.ts` gained `FRESHNESS.compare`. The Tree, File and Log screens lost the
condition that hid their Permalink verb.

**One query per kind, in parallel, and one comparison for the ref you stop on.**
The refs list is two `pages()` walks over one document; the shortlog is a third
read, debounced, keyed by the two SHAs the list already resolved. Nothing in
the screen is per-row.

### Decisions

**The ref map turned out to be the wrong shape, and the right answer was
cheaper.** Four phases have been carrying "Phase 6 extends Permalink once the
ref map makes a commit SHA available for any revision". A map is a second query
per screen — and every screen was *already* asking GitHub to resolve its
revision: a tree query resolves `main:src`, a file query resolves
`main:src/app.ts`. So `source/revision.ts` adds one aliased field that resolves
`main` in the same round trip, and Permalink works on any branch or tag for the
price of nothing. The map would have bought the same answer twice.

It peels through `Tag`, which is the part worth being careful about:
`object(expression: "v1.2.0")` on an annotated tag answers with the tag object,
whose `oid` is a real SHA that is not a commit SHA. A permalink built from it
would address something that is not a revision.

**Branches get `compare`; tags do not.** They are one object and one document,
but they are not one question. What you want to know about a branch is how far
it has drifted from the default branch; what you want to know about a tag is
what shipped in it, which is a comparison with the tag *before* it, not with
`main`. `@include(if: $withCompare)` is what keeps the second question from
paying for the first: GitHub computes a merge base per node the field appears
on, and a hundred of them on a tag list nobody reads the number from is the
fan-out `ARCHITECTURE.md` §7 rules out.

**Ahead and behind are inverted on the way in, and that is GitHub's doing.**
`Ref.compare(headRef:)` treats the ref it is called on as the *base*, so its
`aheadBy` is how far the default branch has run ahead of this branch — which is
this branch's *behind*. Reading the two fields straight through would pass every
shape check and report every stale branch as a busy one. The stub speaks
GitHub's way round on purpose, so the test would fail if the mapping were ever
"simplified".

**The branch walk waits for the repository summary. It is the only wait in the
app.** `Ref.compare` needs the default branch *by name*, and only the summary
has it. The alternatives were worse: fetching the list twice — once without the
column, once with — or dropping the column that makes forty branches scannable.
In practice there is no wait at all, because you arrive here from another screen
of the same repository and the summary is a cache hit on the first frame. On a
cold direct link it is one query deep, on a screen that is nobody's entry point.

**Refs are sorted at the source, newest first.** The query asks for
`TAG_COMMIT_DATE` descending, but that field is documented against `refs/tags/`
— a branch list that came back alphabetically would bury the branch you pushed
an hour ago, and the stub returns branches alphabetically so the screen cannot
quietly rely on the server. Same call `getTree` makes about directories: display
order belongs in the cached value, not in the render path.

**Selection lives in the URL here, and nowhere else does.** The log's cursor is
local state, because a row of a log is a place you are passing through. A tag is
not: "what shipped in v1.2.0" is a thing you send someone. So `?ref=tags/v1.2.0`
is the address, and it is *replaced* rather than pushed as you walk — the same
call the file screen makes about addressing lines in turn, and for the same
reason: reading twenty tags is one step back out of the screen, not twenty. It
is qualified with git's own prefix so a branch and a tag of the same name are
two addresses rather than a coin toss.

**Which kind is shown is a query parameter, because branches and tags are one
object.** `ARCHITECTURE.md` §2 is explicit about that, and the log already drew
this line: a scope is a segment, a view is a parameter.

**The compare screen exists because two of the verbs would otherwise have been
the same link out.** `PLAN.md` asks for Browse / Log since previous / Archive /
Compare / Permalink, and github.com answers both "log since previous" and
"compare" with one page — two verbs, one destination, neither of them ours. What
they are actually asking is one REST read we already had. `DiffView` and the
patch parser came with Phase 5 and this is their second caller;
`comparisonTruncated` has been in `rest.ts` since Phase 1 precisely so
truncation would be found before something depended on it. It is also the read
`ARCHITECTURE.md` §6 names for "since your last review", so Phase 7 starts from
a compare that works.

**The shortlog is grouped by author, busiest first**, where git's default is
alphabetical and `-n` is what you actually type. It is rendered in a `<pre>`
because DESIGN.md §5 says so and because a shortlog is the one place in this app
where alignment carries meaning — it is read as a block, not as rows.

**Everything the Refs screen addresses, it addresses by SHA.** The list has just
finished resolving every ref to a commit, so the pane's comparison, the "Log
since previous" verb and the Compare verb all use those SHAs: one cache entry
shared between the pane and the screen it opens, and a tag's changelog computed
once ever rather than every thirty seconds. `getCompare` needs **both** endpoints
to be object IDs before it will file the answer as permanent — `revKey` decides
from one revision and a range has two, so that check is written out in
`source.ts` rather than inferred.

**Ahead and behind stay greyscale.** `DESIGN.md` §3 spends green and red on diff
state and each meaning is used once. The numbers carry their own meaning, the
arrows are not colour, and the title says it in words.

**A group heading is a row.** The list is one `VirtualRows` window over
branches, tags, their headings and their "load more" buttons alike — the same
call the diff makes about file headers, and for the same reason: a virtualised
list drifts the moment two rows disagree about their height. It also means the
keyboard walks everything the mouse can reach, with `j`/`k` stepping over the
headings.

### Deliberately deferred

- **No `Ref.compare` for tags, so no ahead/behind column on them.** If reading
  the screen in anger wants it, the field is one `@include` flag away — but it
  would double what the tag list costs to answer a question the shortlog
  already answers better.
- **The filter is local, over what is loaded.** `refs(query:)` would narrow
  server-side, but it would also make every keystroke a request and reset the
  walk. Same call Phase 5 made about the author filter, and the tally says how
  far the filter reaches.
- **"Previous tag" is the previous tag by commit date**, not by version
  ordering. `v1.10.0` and `v1.9.0` sort by when they were cut rather than by
  what they are called, which is right far more often than a version parser
  would be and never pretends to understand a scheme it has not seen.
- **The compare screen has no base/head pickers.** Every route into it names
  both ends. A picker is a Phase 9 palette question, not a form.
- **No word-level diff, no split view**, as on the commit screen. Unchanged.
- **"Since your last visit" is three placeholder rows** on both new screens.
  Phase 8.

### Verification

`bun run check` (0 errors), `bun run lint` and `bun run build` all pass.
`bunx playwright test --repeat-each=3` — 165 passed, no flakes. The suite is 55
tests and runs in about 38 seconds.

Ten tests are new, and the phase is in these:

- branches and tags arrive as one screen with one heading each, reached from a
  sidebar item that is a link at last, and paid for with one query per kind —
  not one per ref;
- ahead and behind are read the right way round: the stub answers the way
  GitHub does, with the ref as the base, and a branch six ahead and two behind
  has to come out of fields that say two and six;
- the list is ordered newest-first even though the stub answers alphabetically;
- a tag carries its annotation immediately and its shortlog a beat later —
  three commits since `v1.1.0`, grouped `rich (2)` then `simon (1)`, from
  exactly one comparison addressed by the two SHAs the list already held;
- walking three tags with `j` costs one comparison, not three, and one step back
  leaves the whole walk rather than replaying it;
- a tag at the foot of a page says it cannot see the tag before it, and says so
  again with a number once the next page is loaded;
- the five verbs `PLAN.md` names are there over a tag, Permalink addresses the
  commit it points at, and "Log since previous" opens a range that resting on
  the row had already paid for;
- the compare screen carries its commits oldest-first and its whole diff, and
  Swap is a link;
- a range between two SHAs is never fetched twice, however stale everything
  around it goes;
- Permalink now resolves on `release/1.0` — on the tree screen and the file
  screen both — which is the thing Phases 3, 4 and 5 hid the verb for want of.

Both themes checked by screenshot at 1440px, along with the tag block and the
compare screen, and the <1060px breakpoint where the right panel hides.

**Still not run against live GitHub.** Three things are new and none has met a
real token. `Ref.compare`'s direction is the one to watch — it is the field this
screen's most load-bearing column is made of, and the inversion above is read
from GitHub's own wording rather than from a response. `refs(orderBy:)` with
`TAG_COMMIT_DATE` is documented against tags only, so what it does to a branch
list is worth looking at once (the source sorts each page regardless, so the
failure mode is an odd order across page boundaries, not a wrong one within a
page). And the REST compare endpoint has never been called for real: its caps —
250 commits, 300 files — are what `truncated` is made of, and a real release
range is the first thing that will test them.

---

## Phase 7 — Review

**Done when:** you can do a real second-pass review of a PR that was force
pushed, and see only what actually changed. ✅ — on a stubbed repository, and
pinned by tests. The live-token qualifier under **Verification** still stands.

### What was built

Two screens again, and for once that is not the phase choosing: a pull request
is a thing you triage and a thing you read, and the two want opposite shapes.
Underneath them is the first use the `visits` store has ever had.

| File | Role |
|---|---|
| `source/pulls.ts` | the `Pulls` document and `getPulls` — one page of the triage list |
| `source/pull.ts` | the `Pull` document and `getPull` — one PR, its reviews, threads and checks |
| `source/pull-files.ts` | `getPullFiles`: the PR files endpoint, paged, over REST |
| `source/checks.ts` | check runs and commit statuses reconciled into one answer |
| `visits/review.svelte.ts` | what we remember about reviewing a pull request |
| `diff/notes.ts` | the key a marker on a diff line is addressed by |
| `review/anchor.ts` | where a thread sits, and which files count as read |
| `review/ReviewScreen.svelte` | the list: rows, filters, keyboard, verbs, panel |
| `review/PullScreen.svelte` | the screen: two diffs, threads, mark-viewed, the record |
| `review/Thread.svelte` | DESIGN.md §5's thread card |
| `review/Threads.svelte` | the sidebar's `Threads` section |
| `review/States.svelte` | the sidebar's `Scope` on the list — which states are shown |
| `review/Avatar.svelte` | the only avatar in the app, and it degrades to an initial |
| `routes/[owner]/[name]/pulls/+page.svelte` | pull requests, narrowed by state |
| `routes/[owner]/[name]/pull/[number]/+page.svelte` | one pull request |

Reworked: `Source` grew from nine methods to twelve; `Store` gained
`visitsUnder` and `forget`, and `idb.ts` a prefix scan to implement them;
`DiffView` learned markers, collapsed files and an extra control per file
header, none of which a commit or a compare passes; `nav/paths.ts` gained
`pullsHref`, `pullHref`, their parsers and `githubPullUrl`; `Sidebar` makes
Review a destination, which is the last of the four; `Pill` gained a `warn`
tone; `policy.ts` gained `FRESHNESS.pulls` and shortened `FRESHNESS.pull`.

**The four nav items all go somewhere now.** Phase 0 drew them as local state
and every phase since has turned one of them into a route. This is the first
time the sidebar tells the whole truth.

### Decisions

**"Since my last review" is the default view, and the record is written by
hand.** PLAN.md is explicit that it is the default rather than an option, which
makes the `visits` store a Phase 7 dependency rather than a Phase 8 feature —
a default view cannot wait for a later phase. What Phase 7 does *not* do is
adopt ARCHITECTURE.md §6's "debounced on view" rule, and the reason is specific
to this screen: recording the head SHA when the screen opens would empty the
since-diff before you had read a line of it, and the next visit would show you
nothing while the work you skipped sat behind it. So the record is written by
the verb, and by marking the last file viewed — both of which are a person
saying they are done rather than a screen assuming it. Everywhere else, Phase 8
can debounce on view as written.

**The force-push check is free.** ARCHITECTURE.md §6 describes detecting one by
asking whether the current head descends from the recorded head, and PLAN.md
warns that this is where the screen gets genuinely hard. The question turns out
to be already answered by the read we were making anyway: a `base...head`
comparison comes back `ahead` when the head descends from the base and
`diverged` when it does not. One request produces the since-diff *and* the
force-push verdict, and there is no second query to go stale or disagree.

The cost is honesty about the diff's extent, and it is paid out loud. GitHub's
compare is three-dot, measured from where the two commits last agreed — so
after a rebase the range is wider than "what changed", because the merge base
has moved back behind work you have already read. The screen says exactly that
in amber rather than showing you the whole pull request under a heading that
promises otherwise. GitHub's REST compare may accept two-dot ranges, which
would be the precise answer; that is one of the things a live token can settle,
and until it has, a stated overshoot beats an unverified request on the default
view of the hardest screen.

**A thread carries the commit it was written against, and that is the whole
anchoring mechanism.** PLAN.md's "watch for" asks for the head SHA to be stored
with every thread so a comment can be placed when its line has moved.
`originalCommit { oid }` is that SHA and it costs one field. GitHub sends
`line: null` once it can no longer place a thread on the current diff; the
screen falls back to `originalLine`, marks the thread **Moved**, and names the
commit that line number belonged to. Dropping the comment or pinning it to a
line that now means something else are both worse than saying which version of
the file it was about.

**Threads read below the diff, not inside it.** DESIGN.md §5 draws the card
indented 60px from the gutter, which reads as inline. The diff is one flat list
of fixed-height rows — that is what holds §10's 60fps at 3,000 lines — and a
variable-height card in the middle of it drifts the arithmetic the whole list
depends on. So the anchored line takes a marker carrying its comment count, and
the card opens in the pane below, which is the geography the log's commit
detail and the refs screen's tag block already established. The card itself is
§5's card unchanged; only its placement moved, and the budget is what moved it.

**A pull request's diff is immutable, keyed by two commits.** It is the largest
payload we fetch and the screen that fetches it is the one people sit on
longest, so a 30-second window would have been the worst cache in the app. The
diff is a function of the head *and* the base — GitHub recomputes the merge
base when the target branch moves — so pinning both makes it permanent.
`revKey` cannot decide this because it routes on one revision, the same reason
`getCompare` writes its check out by hand.

**REST pages by number, and the source hands back a synthetic cursor.**
PROGRESS.md left this open: teach `PageOf` about both kinds of paging, or fake
a cursor. A page number is a detail of one endpoint and `pages()` is the
primitive four screens now depend on, so the fake cursor lives in `source.ts`
and `pages()` never learns that REST exists. A page's `endCursor` is the page
it was; the source turns it back into `page + 1` on the way in.

**The since-comparison is read on both views, not just the one it draws.** It
answers two questions and the second is needed either way: *what landed since*
is the diff, and *what moved since* is what decides which of your viewed marks
are still good. A whole-diff view that did not know would have to un-view every
file on every push, which would make mark-viewed useless on exactly the pull
requests it is for. It is a comparison between two SHAs, so it is asked for
once ever.

**Mark-viewed is two `visits` records and no new concepts.** A file marked
viewed stores the head it was marked at; a pull request marked reviewed stores
the same thing. A mark survives a push that did not touch its file, and is spent
by one that did. `Store` grew one read — `visitsUnder(prefix)` — because asking
one key at a time would be a round trip per file in the diff, and Phase 8's tree
dots will want exactly the same read.

**The list has no per-row read, including its CI column.** `commits(last: 1)`
for the check rollup is one nested connection bounded by the page rather than by
the repository, and the rollup is a stored field rather than a computed one — so
it is nothing like the merge base `Ref.compare` asks for, which is why the refs
list had to guard that one behind an `@include`. A triage list without a CI
column is a list you have to open every row of.

**Comment bodies go through our own Markdown parser.** Phase 3 settled this for
READMEs and the argument is strictly stronger here: a README is written by
whoever owns the repository, and a review comment is written by anyone who can
comment on the pull request. ARCHITECTURE.md §11 lists the token in browser
storage against "XSS is a real risk".

**Amber gets its second meaning, and its first user.** DESIGN.md §3 spends
amber on a force push you have not seen and on an unresolved thread. Both arrive
in this phase, which is why `Pill` only gains a `warn` tone now — a colour with
no meaning in use is a colour that drifts into decoration. Green and red stay
diff state: a failing check is a word first and a tint second.

**Replying links out.** ARCHITECTURE.md §1 puts writes out of scope and §12
still asks whether review comments should be the exception. Until that is
answered, a link that works beats a box that does not.

### Deliberately deferred

- **Two-dot compare for the since-diff.** The three-dot range overshoots after
  a force push and the screen says so. GitHub's REST compare is documented to
  accept `base..head`, which would be exact — but no read in this project has
  met a real token yet, and an unverified request on the default view of the
  hardest screen is the wrong place to find out. Try it the first afternoon
  there is a token; it is a one-line change in `rest.ts`.
- **No thread address in the URL.** The refs screen puts its selection in the
  URL because "what shipped in v1.2.0" is a thing you send someone. A thread
  cursor is closer to the log's: a place you pass through while reading. What
  *is* addressable is the file (`#f-…`) and the line the thread hangs on, both
  of which already have URLs. A dedicated thread address wants stable ids in
  the URL and Phase 9's palette is the better door.
- **Only the first 50 threads and 20 replies per thread.** Both are disclosed
  when they bind rather than silently clipped. Paging them wants a second
  `pages()` walk keyed off a document that is otherwise one round trip.
- **No per-hunk "pushes since you reviewed" count.** DESIGN.md §5 puts one on
  the hunk header. It needs per-line attribution across pushes, which is a blame
  walk per hunk — the fan-out ARCHITECTURE.md §7 rules out. The screen answers
  the same question once, at the top, from the comparison it already has.
- **`mergeable` is asked for and may answer `UNKNOWN`.** GitHub computes it
  lazily and the first ask can return before the job runs. The panel says
  "Checking" rather than guessing. Re-asking on a timer is Phase 8's tick.
- **Checks ride the pull request's freshness window**, which is now the shortest
  in the app at 15s. A separate `Checks` document at its own rate would be a
  second query per screen against ARCHITECTURE.md §4's one-query rule, for a
  field that only moves while CI is running.
- **The right panel's first block is real here and nowhere else.** This screen's
  main view is computed from the visit record, so a placeholder above it would
  have been a strange thing to look at. Every other screen keeps its three
  dashes until Phase 8.

### Verification

`bun run check` (0 errors), `bun run lint` and `bun run build` all pass.
`bunx playwright test --repeat-each=3` — 201 passed, no flakes. The suite is 67
tests and runs in about 35 seconds.

Twelve tests are new, and the phase is in these:

- the triage list carries every pull request with its author, CI state and
  review decision, in **one** query rather than one per row, with the three
  right-panel blocks in fixed order;
- Review is a link at last — the sidebar reaches it, and the state filter
  re-scopes the screen to merged;
- `j`/`k` move a selection that starts unset, and `enter` opens the review;
- a **first pass** is the whole diff and the "since" verb is absent, because
  there is nothing to be since — and the whole diff came from the PR files
  endpoint, not from a comparison;
- a **second pass** is the since-diff, chosen with no `?view=` in the URL: mark
  reviewed, push, come back, and the screen has already decided;
- a **force push** is detected from the comparison we were making anyway — one
  request, `diverged` rather than `ahead`, and the notice says the diff below is
  wider than the heading promises;
- three threads arrive in the order the code is in rather than the order the
  conversation happened in, the anchored lines carry markers, and the one whose
  line has moved says which commit it was written against;
- `j`/`k` walk the threads with the card filling in place, replies and all, and
  `esc` closes it — and a `**bold**` body is parsed by us, never injected;
- marking a file viewed collapses it to its header row, marking the last one
  offers to record the review, and the marks survive a reload because they are
  in IndexedDB;
- a mark survives a push that did not touch its file and is spent by one that
  did — which is the thing that keeps a push from restarting a review;
- a 150-file diff is walked in two pages, and walking the whole thing again
  after leaving the screen costs nothing however stale everything around it
  goes;
- hovering a row warms the review it opens, so `enter` fetches nothing.

Both themes checked by screenshot at 1440px, along with the thread pane, the
since-view banner and the <1060px breakpoint where the right panel hides.

**Still not run against live GitHub.** Three documents are new and none has met
a real token. `Pull` is the one to watch — it is the largest query in the app
and three of its fields are guesses about behaviour rather than about shape:
whether `mergeable` answers on the first ask or has to be re-read, whether
`latestReviews` really is one review per reviewer, and what
`reviewThreads.line` actually does on a thread GitHub has repositioned rather
than dropped. `Pulls` is shape-checked only, and its `commits(last: 1)` rollup
is the one field worth costing against the rate limit. And the PR files
endpoint has never been paged for real: the synthetic cursor rests on
`Link: rel="next"` being present and readable, which needs
`Access-Control-Expose-Headers` from GitHub — the stub now sends it, precisely
because the browser hides the header without it and the failure mode is a diff
that silently stops at 100 files.

---

## Phase 8 — Since your last visit

**Done when:** you open the app after two days away and it tells you what moved
without you asking. ✅ — on a stubbed repository, and pinned by tests. The
live-token qualifier under **Verification** still stands.

### What was built

No new screens. Every screen already had the block; this is the phase that
fills it, and the dots and the ownership and the tick that keeps it moving.

| File | Role |
|---|---|
| `visits/ids.ts` | the `visits` object-id scheme, in one place |
| `visits/repo.svelte.ts` | `repoMemory()` — when you arrived, shared by every screen |
| `visits/since.svelte.ts` | `sinceLastVisit()` — the delta, and the panel rows every screen shows |
| `visits/owners.ts` | `CODEOWNERS` parsed, and what "yours" means |
| `visits/reach.ts` | the indexes a dot is a lookup against |
| `visits/reviews.svelte.ts` | the triage list's delta, from records and no request |
| `source/owners.ts` | the `Owners` document — three aliased expressions, one query |
| `sync/tick.ts` | the background revalidation tick, for a pinned set |
| `ui/Dot.svelte` | the change dot |

Reworked: `Store.visit` keeps a bounded head-SHA history and is a
read-modify-write for it; `Visit` gained `shas`; `Source` grew from twelve
methods to thirteen; `policy.ts` gained `FRESHNESS.owners` and `VISIT_HISTORY`;
`PanelEntry` gained a `warn` tone and `RightPanel` renders it; `format.ts` gained
`agoAt`; `FileTree` and `FileTreeNode` take marks; `visits/review.svelte.ts` lost
its id helpers to `ids.ts` and exposes the history; `signOut` clears the
in-memory arrivals; the layout owns one timer.

**The whole feature is one comparison.** We wrote down the head SHA you last
saw, GitHub will diff any two SHAs, so `compare(lastSeenSha, head)` answers the
panel, the dots, the ownership count and the force-push verdict together — from
a read addressed by two commit SHAs, which makes it permanent. ARCHITECTURE.md
§3 names this as the reason the architecture works without a server; this is the
phase that spends it.

### Decisions

**One record per repository, and the delta is projected onto rows.** The
alternative — a record per directory — is more precise and much worse: each
directory would have a different base SHA, so browsing a tree would be one
comparison per directory, sharing nothing. ARCHITECTURE.md §6 already describes
the cheap shape, and it is easy to read past: *"Repo: commits landed since… Tree
row: a dot if the directory contains such a commit."* The row's answer is a
projection of the repository's, not a question of its own. So a dot is a `Map`
lookup against the paths the one comparison already listed, and a four-thousand
row tree costs four thousand hashes and no requests — which is what keeps this
inside ARCHITECTURE.md §7's rule that nothing may fan out across a repository.

**The base does not move while you are here.** `repoMemory` is a registry at
module scope, read once per page session and shared by every screen, and
recording the visit deliberately does not update what is on screen. Without
that, the block would empty the instant you acted on it: open the tree, see "9
commits since", click into one of them, come back, and it says nothing. Walking
Tree → File → Log → Refs now shows the same answer on all four, and one record
is written rather than four.

**Recording is debounced on view, and this is the opposite of Phase 7.** That
asymmetry is the point and it is written down in both files. Looking at a tree
*is* seeing it, so two seconds on screen spends the record. Looking at a pull
request is not reviewing it, so the Review screen still records by hand — and if
it did not, the "since my last review" diff would empty before you had read a
line of it.

**`CODEOWNERS` is one query with three aliased expressions.** GitHub looks in
`.github/`, the root and `docs/`, first match wins. That could have been three
round trips, or a listing of two directories we have no other reason to read.
GraphQL resolves as many expressions as a document names, so it is one request —
the same move `revision.ts` made in Phase 6, and it matters more here because
ownership is consulted by every screen.

**It is keyed by revision, not by tree SHA, and §6 is wrong about this.**
ARCHITECTURE.md §6 says `CODEOWNERS` should be "cached against the tree SHA that
produced it". The *root* tree SHA changes on every commit that changes anything,
so keying on it would re-fetch a file that had not moved on every single push —
the opposite of what §6 is asking for. `revKey` on the revision gives one mutable
entry per repository on the longest freshness window in the app (ten minutes),
and a permanent one at a commit SHA. Same answer, cheaper.

**Ownership is read only once there is a delta to attribute.** There is nothing
to colour on a repository nobody has pushed to, so there is nothing to ask. It
is read *beside* the comparison rather than after it — both are known to be
wanted the moment the record says the head has moved, so chaining them would be
a waterfall for no information.

**A team you might be in does not make a path yours.** `CODEOWNERS` names
`@user`, `@org/team` and email addresses; resolving team membership is an
organisation query, and organisations are out of scope by ARCHITECTURE.md §1. So
only a login match counts, and a repository whose `CODEOWNERS` names only teams
owns nothing here. That is a smaller answer than GitHub's and an honest one — the
alternative is guessing about who you are.

**The parser is a subset, and the failure mode is why that is tolerable.** It
reads gitignore semantics as far as `CODEOWNERS` uses them: last match wins
rather than most specific, a slash anywhere but the end anchors to the root, a
bare name matches at any depth, a bare pattern owns what is under it. A pattern
it reads too broadly costs an indigo dot on a path you do not own; too narrowly,
a dot you would have wanted. Neither is a wrong answer *about the code*, which is
the same bargain the highlighter and the Markdown parser make and would not be
acceptable in a diff.

**One dot, one meaning, and owning it changes the sentence rather than the
glyph.** DESIGN.md §3 spends indigo on "this concerns you" once, so a second
tone or a second shape for an owned path would be spending it twice. The dot
means *something landed inside this since your last visit*; whether it is yours
is in its label and in the panel's count, where a fact about you belongs.
DESIGN.md §9 is satisfied without inventing anything: the dot has an accessible
name and a tooltip, and the panel says the same number in words.

**The dot sits against the name, not in a column.** A column was tried first and
is wrong at this width: it puts the dot most of a 900px row away from the thing
it is about. The name and its dot share the flexible cell, so the fixed Mode and
Size columns stay where they were.

**Force-push detection is the comparison again, and the history is what the
phase adds.** Phase 7 found that GitHub answers `ahead` when the head descends
from the base and `diverged` when it does not — ARCHITECTURE.md §6's descendant
test, for free. Phase 8 applies the same word to the default branch, which
nothing was doing, and adds what §6 actually asks for: `Visit.shas`, a bounded
ring of every head we have recorded. That is what keeps a SHA addressable after
the ref that named it has moved off it. `visit()` is a read-modify-write now,
which is one extra read on a record written at most once per screen.

**The Review list's delta costs nothing at all.** Every other screen spends a
comparison; this one spends a prefix scan of records Phase 7 was already writing,
against head SHAs the list was already carrying. `visitsUnder` earns its second
caller, which is why Phase 7 put it on the `Store` rather than reading a key at a
time.

**The File screen makes one extra read, and it is a hover paid early.**
PLAN.md asks the File screen for "lines changed since, and by whom". The
comparison answers the first half exactly and cannot answer the second: it lists
the range's commits and the range's files but never says which touched which.
The intersection of a path-scoped log with the range's commit SHAs does — and
that log is the query the Log verb warms on hover, under the same key. So it is
not a new request, it is an existing one made a moment sooner, and it is asked
for only when this file is one of the ones that moved.

**The tick polls one thing, for three repositories.** ARCHITECTURE.md §12 asks
how many repositories should sync in the background and answers "a pinned set is
probably right"; the pinned set is the three most recently opened, which is a
list we already keep. What it revalidates is the repository summary and nothing
else, because HEAD moving is the event every other part of this phase is a
consequence of — the comparison re-keys on the new head and the dots reappear
while the screen sits still. It goes *through* `prefetch()` rather than around
it, so it inherits all three of that function's rules: never on a tight budget,
never twice, never observably. It also skips a hidden tab, and it asks
immediately when one comes forward.

**Every screen shows the repository's block; two add a row of their own.** The
Log screen adds "In this scope" when a path narrows it, which is a lookup rather
than a second read. The File screen adds its own two rows in front. Commit and
Compare show the repository's block unchanged — the object they are about is
immutable, so "since your last visit" can only sensibly mean the repository, and
positional consistency is worth more than a bespoke answer. The Pull screen
keeps Phase 7's block, which is the one place "your last visit" means "your last
review", plus one row from the new history.

### Deliberately deferred

- **No `..` or ancestor dots.** A dot answers for a path *and everything under
  it*, so the `..` row would light on almost every visit and say nothing. The
  panel is where the repository-wide answer lives.
- **No dots on the four nav items.** PLAN.md says "tree rows and sidebar items";
  the sidebar items that are tree rows are the file tree's, and those have them.
  A dot on `Tree` while you are looking at the tree is noise, and the counts are
  already there.
- **The Refs screen shows the repository's block, not "refs moved / new tags".**
  Those need a record of the ref list rather than of a SHA — a different shape of
  memory, for a question the tag list's own ordering mostly answers. If reading
  the screen in anger wants it, the record is `refs:{owner}/{name}` and the delta
  is a set difference.
- **No delta on the entry screen's recent list.** A number per repository is a
  comparison per repository, which is the fan-out §7 forbids. The tick keeps
  those summaries warm; showing "12 new" beside each would not be free.
- **`CODEOWNERS` truncation is carried but not shown.** `isTruncated` is on the
  answer; a file past GitHub's blob cap would be a `CODEOWNERS` of some
  thousands of rules, and disclosing it wants a place to say it that is not the
  first thing you read.
- **The tick does not revalidate the screen you are on.** `resource()` already
  does that on navigation and on staleness. Polling the current screen as well
  would be two clocks for one answer.
- **No cross-repository "what moved" view.** That is a fan-out and a Phase 9
  palette question.

### Verification

`bun run check` (0 errors), `bun run lint` and `bun run build` all pass.
`bunx playwright test --repeat-each=3` — 231 passed. The suite is 77 tests and
runs in about 2.5 minutes.

Ten tests are new, and the phase is in these:

- a **first visit** says `First` rather than a dash, and costs nothing to say —
  no comparison and no `CODEOWNERS` — while still recording, so that a first
  visit becomes a second one;
- a **second visit** reports nine commits and three files from **one**
  comparison, with `Since your last visit · 2d` in the heading;
- the **dots are projected from that one comparison**: `src` carries "3 files
  changed since your last visit", the README carries none, the sidebar tree is
  dotted from the same answer, and there is still exactly one comparison;
- **`CODEOWNERS` decides which of them are yours** — two of the three, because
  the last matching rule wins and the catch-all on the first line is overruled;
  read once, however many rows consult it; and the dot on the directory says so;
- a **rewritten default branch** is amber, from the same one request — the
  recorded head is reachable but is not an ancestor, so the range is `diverged`;
- **the delta survives walking around**: Tree → File → back shows the same block
  throughout, with one comparison and one `CODEOWNERS` read for the whole walk,
  which is the thing recording-on-view would otherwise have broken;
- the **File screen** says `+12 −3` for this file and names both authors, from
  the path-scoped log the Log verb was going to warm anyway;
- the **Review list** marks what has moved since you reviewed it, with no request
  at all, and leaves a pull request you have never opened unmarked;
- the comparison is **addressed by two SHAs**, so leaving the screen and ageing
  everything mutable does not fetch it again;
- the **background tick** does nothing while the entry is fresh and revalidates
  it once past its window — with no navigation, which is the point.

Both themes checked by screenshot at 1440px — the dotted listing, the file
screen's two extra rows, the amber force-push row and the marked triage list —
along with the <1060px breakpoint where the right panel hides and the dots stay.

**One note on the suite.** An early full run had two Phase 5 tests time out at
five seconds waiting for a first paint, on one of three iterations, under two
workers on a loaded machine; two subsequent full `--repeat-each=3` runs were
clean, and both tests pass twelve times out of twelve in isolation. They are
timeouts rather than assertion failures and no Phase 8 code is on their path, so
this is recorded rather than chased — but if the log and file screens start
timing out again, this is where it was first seen.

**Still not run against live GitHub.** One document is new and it has not met a
real token: `Owners`, whose three aliased `object(expression:)` fields mirror
`Tree`'s and should be safe in shape. Two behaviours are worth watching on the
first afternoon there is one. The comparison this phase rests on is the REST
compare endpoint, which ARCHITECTURE.md §11 caps at 250 commits and 300 files —
the panel prints a `+` when GitHub says it truncated, but a fortnight away from a
busy repository is the first thing that will really test it, and it is the case
where "since your last visit" is worth the most and knows the least. And the
history in `Visit.shas` is written but nothing yet reads it apart from the Pull
screen's count: the moment it earns its place is the first real force push, when
a SHA that no ref names any more has to still be addressable.

---

## Chrome pass — one row of it, and a panel you can put away

**Done when:** the app is edge to edge, there is one row of chrome above the
content rather than two, and the reader can spend the panel's 230px on the
thing they came for. ✅

### What changed

| File | Change |
|---|---|
| `ui/Shell.svelte` | the verb region is gone; the frame is gone; the panel is conditional |
| `ui/Header.svelte` | absorbs the verbs, loses the rate meter, gains the panel toggle |
| `ui/panel.svelte.ts` | new — whether the right panel is on screen, persisted |
| `ui/format.ts` | `mode()` — six octal digits read as `drwxr-xr-x` |
| `ui/VerbRow.svelte`, `ui/RateMeter.svelte` | deleted |

Every screen passes `verbs`, `active` and `utility` to `Header` where it passed
them to `VerbRow`, and drops the `verbs` snippet from `Shell`.

**The verb row was 32px of repetition.** It named the object on the left — a
name the breadcrumb three pixels above it was already saying — and then pushed
every screen's first row a line further down. The verbs themselves were never
the problem, so they moved up beside the pills that identify the object they act
on, which is where the reader was already looking. `ARCHITECTURE.md` §2 is
unchanged in substance: every object still carries its own verbs, and they still
have to resolve in 50ms.

**Two verbs did not survive the move.** The Tree screen's `Files` and `Readme`
scrolled the page to a section of itself. In a row of its own that was cheap; in
the header it is chrome pretending to be navigation, next to verbs that go
somewhere. Both sections are on the screen already.

**The header's middle group scrolls; the chrome does not.** The Log screen with
a commit selected carries three pills, six verbs and a utility, which is the
worst case and fits at 1100px. Past that the object's group scrolls inside
itself rather than pushing ⌘K, the theme toggle and the panel toggle off the
end — their position is the thing that must not depend on the screen.

**The rate meter is gone from the header, not from the app.** `4,819/5,000` is a
real constraint and it is still accounted for — `sync/rate.svelte.ts` is what
`prefetch()` and the background tick consult before spending anything — but it
answered a question nobody was asking on the way to a file. The number is in the
response, and the code that cares reads it there.

**The panel is a preference, not a screen mode.** It persists in `localStorage`
next to the theme and for the same reason: read it after paint and it flashes in
before it collapses. Below 1060px the media query still hides it and the toggle
hides with it — there is nothing to toggle.

**The frame was costing 16px of both axes for a border.** It was a card in the
preview, which is how previews present things; in the app it is a browser
window, and the rows are worth more than the inset.

**Mode is symbolic now.** `100644` is a storage format. The questions a listing
is actually asked — is that a directory, is it executable, is it a symlink —
are answered at a glance by `-rw-r--r--` and need decoding from the octal. The
octal is still the truth underneath and is on the cell's title.

---

## Carried forward

Things to resolve when their phase arrives, beyond `ARCHITECTURE.md` §12.

- **Run every read against a real token.** `Repo`, `Tree`, `Blob`, `File`,
  `Blame`, `Log`, `Refs`, `Pulls`, `Pull` and now `Owners` are schema-checked by
  hand and against stubs only, and no REST endpoint — the commit, the compare,
  the pull request's files — has been called for real. This has been blocking
  since Phase 2 and is now ten documents deep across eight screens. Four most need a
  real repository: `Blame`, because it is the most expensive field we ask for
  and whether its line numbers line up with `Blob.text` exactly is not something
  a stub can answer; `Log`, because the whole pagination design rests on a
  cursor still addressing the same position in the walk it came from; `Refs`,
  because `Ref.compare`'s direction is read from GitHub's wording rather than
  from a response, and a whole column depends on getting it the right way round;
  and now `Pull`, whose `mergeable`, `latestReviews` and repositioned-thread
  `line` are guesses about *behaviour* rather than about shape — the first three
  of that kind in the project. **This is by a distance the largest single risk
  here**, and one afternoon with a token would retire most of it. It would also
  settle two-dot compare, which is the one thing standing between the Review
  screen's default view and an exact answer.
- **`PLAN.md`'s checkpoints are both open now.** The first asks whether the
  right panel's shape is right; three screens share it and none has argued for a
  different order, but that is an observation from building them rather than
  from living with them. The second, which falls here, asks whether the delta
  bar earns its space and whether the graph column is worth its width. The bar
  looks like it does — it is what makes a table of a hundred rows scannable. The
  graph is the doubtful one: on a linear history it is a column of identical
  dots, and it only says anything at a merge. Watch how often it does. Phase 6
  is a third data point for the first checkpoint and did not want a different
  order either, though it did want a block whose rows are not key/value pairs —
  the tag's shortlog went in the detail pane rather than the panel, which is the
  first time a screen has had something the panel's shape could not hold.
  **Phase 7's checkpoint is now open too**, and it is the sharpest of the three:
  does "since my last review" work as the default, or is it disorienting? The
  argument for it is that a second pass on a 40-file pull request is a different
  task from a first pass, and the argument against is that the diff you are
  shown depends on a record you cannot see. Two things were built to soften
  that and both want watching in use — the banner names the range every time,
  and the verb is simply absent on a first pass rather than greyed. Phase 7 is
  also a fourth data point for the first checkpoint, and the first screen whose
  "since your last visit" block has real rows in it: the order still holds.
- **The highlighter is a subset, and use is what will show where.** It reads the
  languages listed in `code/lang.ts`, some of them through a neighbour's grammar
  — Kotlin and Swift through Java's, PHP through C's. Note which files read badly
  rather than adding grammars speculatively; `highlighter()` is a five-line seam
  if a real one is ever needed.
- **A large or binary blob is offered as a link, not fetched.** The honest
  fallback is REST `/repos/…/git/blobs/:sha`, which is CORS-enabled and
  authenticated where `raw.githubusercontent.com` is neither for private
  repositories. It wanted `fromRest` and the mutable ETag path; Phase 5 built
  both for the commit endpoint, so this is now a small piece of work with no
  remaining dependency.
- **`getFile` caches by `rev:path`, not by object ID.** One round trip from a URL
  was worth more than the permanent key — but the response carries the `oid`, so
  filing it under both would give a file that did not change between two branches
  one cache entry instead of two. It needs `settle()` to accept a second key,
  which is a change to the write path and not to a screen.
- **The in-memory layer is still not needed, and Phase 7 was the test.** The
  Review screen reads four entries at once — the repository, the pull request,
  the since-comparison and a page of the diff — plus a `visits` prefix scan, and
  it is still not felt. The reason has not changed since Phase 2: a page is one
  entry rather than a hundred. What did appear is a second kind of read against
  IndexedDB, the prefix cursor, and that one *is* per-file. It is a single
  transaction and it runs once per pull request, so it is fine; if Phase 8 puts
  a prefix scan behind every tree row, measure before believing that.
- **Pagination is settled twice over: `pages()`, and the cursor may be
  synthetic.** Phase 5 answered the question Phase 2 left open; Phase 7 answered
  the one Phase 5 left. A page-numbered REST endpoint is walked by having the
  *source* spell the page as a cursor, so `pages()` never learns that REST
  exists. Any future endpoint that pages by number should do the same rather
  than teaching `PageOf` a second mode.
- **`visits` is finished, and the two recording rules are opposites on purpose.**
  Phase 8 closed this. There are two ways a record is written and both are right
  for what they record: browsing debounces on view (`visits/repo.svelte.ts`),
  because looking at a tree is seeing it; reviewing waits to be told
  (`visits/review.svelte.ts`), because looking at a pull request is not reviewing
  it. Anything added here should say which of the two it is before it is written.
  `visitsUnder(prefix)` now has the second caller Phase 7 predicted, and it is
  the Review list rather than the tree — the tree's dots turned out to need no
  per-row read at all.
- **`getCompare` still does not paginate**, and now that matters in one more
  place: the since-diff is a comparison, so a review of a range past REST's 250
  commits or 300 files is capped rather than paged. `truncated` says so. It is
  the right answer for a release range and an acceptable one for a review that
  large, but it is the honest limit of the default view.
- **Eviction has never run under real pressure.** The ceiling is exercised by
  test; the quota path is not, because a headless browser's quota is enormous.
  This matters more with every phase: file contents were the first thing we
  cached measured in hundreds of kilobytes, a commit's patches were the second,
  and a pull request's whole diff — filed permanently, a hundred files a page —
  is now the third and the largest. Phase 8 adds a fourth kind that grows with
  *time away* rather than with browsing: a since-comparison is filed permanently
  under its two SHAs, so a fortnight of daily visits to a busy repository leaves
  a fortnight of ranges behind it. They are small next to a diff and the LRU
  ceiling covers them, but they are the first entries the cache accumulates
  without anyone navigating.
- **Nine pure modules have no tests of their own, and the list has got worse.**
  The Markdown parser, the scanner, the graph, the patch parser, the shortlog,
  `review/anchor.ts`, `source/checks.ts` and now `visits/owners.ts` and
  `visits/reach.ts` are covered only through the screens that render them.
  `visits/owners.ts` joins `anchor.ts` at the top of the list and for the same
  reason: **a wrong answer is invisible.** A `CODEOWNERS` pattern read too
  broadly is an indigo dot on somebody else's file, which looks exactly like a
  correct one, and the e2e test covers four rules out of a syntax with a dozen
  shapes. `reach.ts` is arithmetic with one edge worth pinning — a rename must
  count once in the directories its two names share, not twice.

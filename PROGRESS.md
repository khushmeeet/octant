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
| 6 — Refs | Not started | — |
| 7 — Review | Not started | — |
| 8 — Since your last visit | Not started | — |
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

## Carried forward

Things to resolve when their phase arrives, beyond `ARCHITECTURE.md` §12.

- **Run every read against a real token.** `Repo`, `Tree`, `Blob`, `File`,
  `Blame` and `Log` are schema-checked by hand and against stubs only, and the
  REST commit endpoint has never been called for real either. This has been
  blocking since Phase 2 and is now six documents deep. Two of them most need a
  real repository: `Blame`, because it is the most expensive field we ask for
  and whether its line numbers line up with `Blob.text` exactly is not something
  a stub can answer; and `Log`, because the whole pagination design rests on a
  cursor still addressing the same position in the walk it came from.
- **`PLAN.md`'s checkpoints are both open now.** The first asks whether the
  right panel's shape is right; three screens share it and none has argued for a
  different order, but that is an observation from building them rather than
  from living with them. The second, which falls here, asks whether the delta
  bar earns its space and whether the graph column is worth its width. The bar
  looks like it does — it is what makes a table of a hundred rows scannable. The
  graph is the doubtful one: on a linear history it is a column of identical
  dots, and it only says anything at a merge. Watch how often it does.
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
- **Phase 6** extends Permalink to non-default branches, once the ref map makes
  a commit SHA available for any revision. The Tree, File and Log screens all
  hide the verb until then.
- **The in-memory layer is still not needed.** Phase 2 deferred it and Phase 4
  asked again here, on the grounds that the log would move real volume. It does
  — a hundred commits a page — and an IDB round trip per navigation is still not
  felt, because a page is one entry rather than a hundred. Ask again in Phase 7,
  where a PR's file list and its threads are read together.
- **Pagination is settled: `pages()`.** Phase 5 answered the question Phase 2
  left open, and Phase 7 should walk the PR file list with the same primitive
  rather than growing a second one. The one thing it does not do is REST
  pagination by page *number* — `pullFiles` takes `page`, not a cursor, so
  either the source hands back a synthetic cursor or `PageOf` learns about both.
  Decide when the file list is built, not before.
- **Eviction has never run under real pressure.** The ceiling is exercised by
  test; the quota path is not, because a headless browser's quota is enormous.
  This matters more with every phase: file contents were the first thing we
  cached measured in hundreds of kilobytes, and a commit's patches are the
  second.
- **Four pure modules have no tests of their own.** The Markdown parser, the
  scanner, the graph and the patch parser are all covered through the screens
  that render them. That is the right level while each has one caller — but the
  graph is the first of them whose output is a *diagram*, where a wrong answer
  reads as a rendering quirk rather than as a failure, and the patch parser is
  the first that Phase 7 will give a second caller. Both earn direct tests when
  that happens.

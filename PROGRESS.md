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
| 4 — File and blame | Not started | — |
| 5 — Log | Not started | — |
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

## Carried forward

Things to resolve when their phase arrives, beyond `ARCHITECTURE.md` §12.

- **Run every document against a real token.** `Repo`, `Tree` and `Blob` are
  schema-checked by hand and against stubs only. This has been blocking since
  Phase 2 and is now three documents deep.
- **Phase 3 is the first checkpoint.** Live with it for a few days before
  Phase 4, and answer `PLAN.md`'s question: is the right-panel shape right, or
  does one screen want a different order?
- **Phase 4** replaces every `blobUrl` link-out with the file screen, and takes
  over `getBlob` — which already returns `isBinary` and `isTruncated` for the
  fallbacks `ARCHITECTURE.md` §11 requires.
- **Phase 6** extends Permalink to non-default branches, once the ref map makes
  a commit SHA available for any revision.
- **The in-memory layer is still not needed.** Phase 2 deferred it until a
  screen could say whether an IDB round trip per navigation is felt. On the Tree
  screen it is not, at these sizes. Ask again in Phase 5, when the log moves
  real volume.
- **`resource()` has no pagination.** Trees do not need it — GitHub returns
  `Tree.entries` whole, which is why 4,000 rows is a rendering problem and not a
  fetching one. The log and the PR file list do. Decide in Phase 5, before
  Phase 7 needs it too.
- **Eviction has never run under real pressure.** The ceiling is exercised by
  test; the quota path is not, because a headless browser's quota is enormous.
  Watch it once the blob cache has real files in it.
- **The Markdown parser has no test of its own.** It is covered through the
  README on the Tree screen, which is the only thing that renders one. If Phase 7
  gives PR descriptions the same renderer, it earns direct tests.

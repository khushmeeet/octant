# Architecture

A fast, keyboard-driven read client for GitHub repositories. Client-only:
the browser talks directly to GitHub's API, and there is no server of our own.

---

## 1. What we're building

A focused client for **reading and reviewing code**, scoped to git's own
primitives. It is a companion to github.com, not a replacement — anything
outside the scope below links out.

**In scope**

| Surface | Answers                                    |
| ------- | ------------------------------------------ |
| Home    | Which repositories are there, and what needs me? |
| Tree    | What is this repo, and what just landed?   |
| Log     | What changed, how big, by whom?            |
| File    | Who wrote this line and why?               |
| Refs    | What has shipped, and what's in flight?    |
| Review  | What changed since I last looked at this?  |
| Command | Take me straight to the thing.             |

**Explicitly out of scope** — Actions, Projects, Discussions, Wiki, Issues,
org and repo settings, billing, security tab, marketplace, social features
(stars, follows, feeds). No write operations beyond review comments in a
later phase.

**Home is the one account surface, and it is deliberate.** This document
originally ruled the account out along with the rest of GitHub's product and
opened the app on a text field you typed `owner/name` into. That was wrong in
the way a login form is wrong: the first question a client of your own
repositories should answer is which ones there are, and the second is which of
them needs you today. So the arrival screen lists the repositories the token
can see and the open pull requests you wrote or have been asked to review.

Nothing else about the account follows it in. There are no stars, no
followers, no feed, no notifications inbox, no organisation pages — one list of
repositories and one list of pull requests, both of which are ways into the
six repository surfaces above. §7's fan-out rule is untouched: each list is one
bounded query, and a row costs nodes rather than a request.

**Non-goals**

- Multi-user. This is a single-person tool.
- Multi-device state sync.
- Hosting or serving git. We are a client, not a forge.
- Offline-first. Offline-_tolerant_ (cache serves reads) is enough.

---

## 2. Design principles

These came out of the preview iterations and are settled. The principles are
here; the specification — tokens, metrics, component inventory — lives in
`DESIGN.md`, and the rendered reference is `gitui-previews-v3.html`.

**Navigation is git's primitives, not GitHub's product surface.**
Four items: Tree, Log, Refs, Review. Branches and tags are the same object,
so they share one screen.

**Every object carries its own verbs.** The header exposes the current
object's actions inline, beside the pills that identify it — on a file:
View / Blame / Log / Raw / Permalink. Nothing lives behind a menu. This is
the single largest retrieval win and it is only honest if every verb is
instant.

**The right panel has one shape and never changes it.**
Same three blocks, same order, on every screen:

1. Since your last visit
2. About (identity of the current object)
3. Open against it

Positional consistency is most of retrieval speed. The user learns the
geography once and stops reading headings.

**Delete expensive information nobody reads.** The tree lists mode and size,
not a per-file last-commit column. That column costs a blame walk per entry
and is rarely acted on; the repo's own HEAD commit, shown once at the top,
answers the question it was approximating.

**Monospace is a signal, not a texture.** Mono appears only on machine
identifiers — SHAs, paths, symbols, file modes, code. Seeing mono means
"this is copyable and exact."

**Colour is stratified and each meaning is used once.**

| Colour                      | Meaning                                              |
| --------------------------- | ---------------------------------------------------- |
| Green / red                 | Added / removed. Diff state only.                    |
| Indigo                      | This concerns you — your owned paths, unread changes |
| Amber                       | A force push you have not seen                       |
| Muted violet / green / blue | Syntax: keyword / string / call site                 |

**Latency is a feature.** Navigation never waits on the network. The only
place latency is allowed to be visible is the sync indicator in the header.

---

## 3. System shape

```
┌──────────────┐        ┌───────────────────┐
│  Svelte SPA  │───────▶│   api.github.com  │
│              │        │  GraphQL + REST   │
│  IndexedDB   │        └───────────────────┘
│  (cache +    │
│   visits)    │        Later, one edge function
└──────────────┘        for the OAuth code swap only
```

There is no backend. GitHub is the backend. The browser holds a durable
cache and the small amount of state GitHub does not track for us.

**Why this is viable:** every feature in scope is reachable from the browser.
`api.github.com` sends permissive CORS headers, GraphQL exposes blame and
path-scoped history, and the compare endpoint diffs any two SHAs — which is
what powers "since your last review" without us storing a single blob.

---

## 4. Where each screen's data comes from

| Screen            | Source                                                                                                            |
| ----------------- | ----------------------------------------------------------------------------------------------------------------- |
| Home, repos       | GraphQL `viewer.repositories(orderBy: PUSHED_AT)`, each with `pullRequests(states: OPEN).totalCount`              |
| Home, in flight   | GraphQL `search(type: ISSUE)` twice — `author:@me` and `review-requested:@me`, merged by repository and number    |
| Tree              | GraphQL `repository.object(expression: "REF:path")` → `Tree.entries` with `name`, `type`, `mode`, `Blob.byteSize` |
| File contents     | GraphQL `Blob.text`; fall back to `raw.githubusercontent.com` for large or binary blobs                           |
| Blame             | GraphQL `Commit.blame(path:)` → ranges with their commits                                                         |
| Log               | GraphQL `ref.target.history(path:, first:, after:)`                                                               |
| Refs              | GraphQL `refs(refPrefix: "refs/heads/")` and `"refs/tags/"`, with `Tag.message` for the changelog                 |
| Review            | GraphQL `pullRequest` — reviews, `reviewThreads` with line positions, comments, check runs                        |
| Diff              | REST compare `base...head`, and the PR files endpoint's per-file `patch`                                          |
| Since last review | REST compare `storedHeadSha...currentHeadSha`                                                                     |
| Symbols (palette) | Deferred — see §9                                                                                                 |

One query per screen. Queries are shaped to the screen, not to the domain
model: a screen's main content and all three sidebar blocks come back in a
single round trip. No waterfalls.

Home is the exception that proves the shape: it is two screens' worth of
question — what exists, and what is waiting — so it is two queries, issued in
parallel and never chained. The repository list pages; the pull requests do
not, because a landing screen that needs a second page of them is a triage
screen, and triage is per repository.

The two searches are the one place we depend on GitHub's issue index rather
than on a connection, and the trade is deliberate: `viewer.pullRequests`
returns only what you wrote, and the pull requests that need you most are the
ones somebody else did. The cost is indexing lag of a few seconds on a pull
request opened moments ago.

---

## 5. The cache

The central insight: **anything addressed by a SHA is immutable.** A tree at
a commit, a blob at a SHA, a commit's metadata, blame at a revision — none
of these ever change. They are cached permanently and never revalidated.

Only a thin mutable layer needs refreshing.

**IndexedDB stores**

| Store       | Key                    | Contents                                          | Policy                                                     |
| ----------- | ---------------------- | ------------------------------------------------- | ---------------------------------------------------------- |
| `immutable` | `kind:repo:sha[:path]` | trees, blobs, commits, blame ranges, diffs        | Write once. Never invalidate. LRU evict on quota pressure. |
| `mutable`   | `kind:repo:id`         | ref→SHA map, PR state, check runs, review threads | Revalidate on a tick; store `etag` and `fetchedAt`.        |
| `mutable`   | `kind:@login[:id]`     | the account's repository list and its pull requests | Same policy. Keyed by login, not by repo: one browser may hold two tokens, and they see different things. |
| `visits`    | `objectId`             | `lastSeenAt`, `lastSeenSha`                       | Local only. Never fetched.                                 |
| `meta`      | fixed keys             | token metadata, rate-limit state, schema version  | —                                                          |

**Read path — stale-while-revalidate, always.**

1. Read cache. If present, render immediately.
2. If immutable, stop. Done.
3. If mutable and older than the freshness window, fetch with `If-None-Match`.
4. On 200, patch the store; the UI updates reactively. On 304, mark fresh.

The consequence: navigating back to a screen you have visited is a local
read. Navigating forward to a screen whose parent you have visited is usually
partially warm, because trees and commits were already pulled.

**Prefetch** on hover for rows and on mount for the adjacent screen — the
file a cursor rests on, the diff of a selected commit.

---

## 6. The "since your last visit" layer

This is the feature GitHub has no equivalent for and it is entirely ours.

We store, per object, when the user last looked at it and what SHA was
current at the time. Every sidebar's first block is a comparison between
that record and what the API returns now:

- Home row: a dot if the repository has been pushed to since you last opened
  it — a time comparison rather than a SHA one, because the list carries
  `pushedAt` and asking for a head per row would be a field per row
- Repo: commits landed since, and how many touched paths you own
- Tree row: a dot if the directory contains such a commit
- File: lines changed since, and by whom
- Review: pushes since, new replies, whether a force push happened
- Palette: a "changed since your last visit" result group

Ownership comes from `CODEOWNERS`, parsed once per repo and cached against
the tree SHA that produced it.

Force-push detection: we keep every head SHA we have seen for a pull request.
If the current head is not a descendant of the last one we recorded, it was
force pushed, and the "since my last review" diff is still valid because
GitHub keeps the old SHA reachable through the PR timeline.

---

## 7. Rate limits

5,000 points/hour on GraphQL, 5,000 requests/hour on REST, per token.

- Every GraphQL query requests the `rateLimit` field, so we always know our
  remaining headroom without spending a request to find out.
- Remaining headroom is shown in the header. It is a real constraint, so it
  should be visible rather than mysterious.
- Conditional requests are used on all REST polling: a `304` does not count
  against the quota, which makes background refresh nearly free.
- The immutable cache means steady-state browsing costs almost nothing —
  cost is proportional to _change_, not to navigation.
- Hard rule: no operation may fan out across a whole repository. That
  constraint is what defers the symbol index.

---

## 8. Authentication

**Now — personal access token.** A fine-grained PAT with read access to the
repos in scope, entered once, stored in IndexedDB. Validated on entry
against the `viewer` query. This is correct for single-user local use and
costs nothing to build.

**Later — OAuth.** With one constraint that shapes the migration:
`github.com/login/oauth/access_token` does not support CORS or preflight
requests, so a pure SPA cannot complete the web flow. Two routes:

1. A single edge function (~30 lines) that performs the code-for-token
   exchange and nothing else. Everything after auth stays browser-direct.
2. GitHub's SPA client support for GitHub Apps, which uses PKCE with no
   client secret and enables CORS on the token endpoint for redirect URIs
   registered as SPA clients. Requires expiring tokens and refresh. Check
   its availability before writing route 1.

Either way, auth is isolated behind a `TokenProvider` so the rest of the app
never learns where the token came from.

---

## 9. Seams

Two interfaces separate the UI from everything else. Both exist from day one
even though there is only one implementation of each.

**`Source`** — where data comes from. `getRepo`, `getTree`, `getBlob`,
`getLog`, `getBlame`, `getRefs`, `getPulls`, `getDiff`, `compare` — and, for
the home screen, `getViewerRepos` and `getViewerPulls`, the only two that name
an account rather than a repository. Implemented by `GitHubSource`. A future
`LocalSource` backed by a git sidecar would satisfy the same interface.

**`Store`** — where data is kept. `get`, `put`, `evict`, plus the visit
methods. Implemented by `IdbStore`. A future SQLite-backed store swaps in
without touching a screen.

Everything above these two interfaces is pure UI and knows nothing about
GitHub.

### Module layout

```
src/lib/
  auth/         token provider, validation, entry gate
  home/         the arrival screen: your repositories, and what needs you
  source/       Source interface, GitHubSource, GraphQL documents
  store/        Store interface, IdbStore, schema + migrations
  sync/         revalidation ticks, rate-limit accounting, prefetch
  visits/       last-seen records, ownership, delta computation
  ui/           shell, sidebar, header + verbs, right panel, rows, code viewer
src/routes/     one route per screen
```

---

## 10. Performance budget

These are the numbers the design is making promises about.

| Interaction                      | Budget                                    |
| -------------------------------- | ----------------------------------------- |
| Cached screen render             | < 16ms to first paint                     |
| Verb action                      | < 50ms, or it must not be a verb          |
| Cold screen (network)            | < 400ms p50                               |
| Log virtualised at 4,000 commits | 60fps scroll                              |
| Diff virtualised at 3,000 lines  | 60fps scroll                              |

Virtualised lists for Log, Tree and diffs are required from the start.
Retrofitting virtual scroll into a fixed-height row layout is painful, and
both surfaces will exceed naive rendering on real repositories.

---

## 11. Known limits

Accepted, with the mitigation or the deferral noted.

| Limit                           | Consequence                                | Response                                                                                      |
| ------------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------- |
| No local symbol index           | Palette ranks files and paths, not symbols | Defer. Optionally use GitHub code search (default branch only, separate limit, indexing lag). |
| No `git log -L`                 | "History of this symbol" cannot ship       | Cut from v1. Needs a local git sidecar.                                                       |
| No webhooks                     | No push freshness                          | Poll while the app is open; ETags make it cheap.                                              |
| Patch truncation on large diffs | Very large PRs degrade                     | Detect truncation, show it honestly, link out.                                                |
| Blob size caps                  | Large files can't render inline            | Fall back to raw URL, then to "too large".                                                    |
| Token in browser storage        | XSS is a real risk                         | Fine-grained PAT, minimum scopes, short expiry; OAuth later.                                  |
| No cross-repo code search       | Palette is per-repo                        | Accepted for v1.                                                                              |

---

## 12. Open questions

- Does GitHub's SPA client support for GitHub Apps ship what §8 describes?
  Determines whether OAuth needs an edge function at all.
- Does the file tree persist across navigation, or is it contextual per
  screen? Currently contextual — worth testing both.
- How many repos should sync in the background? Unbounded polling will hit
  the rate limit; a pinned set is probably right.
- Should review comments be writable in v1, or is this strictly read-only
  until the reading experience is proven?

# Design specification

The visual and interaction spec. `ARCHITECTURE.md` covers _why_ the
information is organised this way; this covers _how it looks and measures_.

**Canonical reference:** `gitui-previews-v3.html`. Where this document and
the preview disagree, the preview wins — it is the rendered truth. This file
exists so the values are greppable and reviewable.

---

## 1. Direction

Linear's design language: dense but calm, low-contrast borders, sans chrome,
generous keyboard affordance, no decoration. Dark is the default; light is a
first-class alternate, not an afterthought.

Explicitly rejected along the way: a terminal/datasheet aesthetic with
box-drawing characters, uppercase micro-labels and hairline rules
everywhere. It was legible but eccentric, and it made monospace a texture
rather than a signal.

---

## 2. Typography

| Role                              | Face           | Size   | Weight |
| --------------------------------- | -------------- | ------ | ------ |
| Body / chrome                     | Inter          | 13px   | 400    |
| Emphasis in chrome                | Inter          | 13px   | 500    |
| Headings (repo name, PR title)    | Inter          | 15px   | 600    |
| Secondary / meta                  | Inter          | 12px   | 400    |
| Section labels                    | Inter          | 11px   | 500    |
| Pills                             | Inter          | 11.5px | 400    |
| Code, SHAs, paths, symbols, modes | JetBrains Mono | 12px   | 400    |
| Blame gutter                      | JetBrains Mono | 11px   | 400    |

Line height 1.5 for chrome, 1.6 for code. Ligatures disabled everywhere
(`font-variant-ligatures: none`) — in a diff, `!=` rendering as `≠` is a
correctness problem, not a flourish.

Berkeley Mono (TX-02) is a drop-in upgrade for the mono face if licensed;
the stack should list it first.

**Rule:** monospace only on machine identifiers. Seeing mono means "exact
and copyable."

---

## 3. Colour tokens

### Dark (default)

| Token      | Value                    | Use                           |
| ---------- | ------------------------ | ----------------------------- |
| `--bg`     | `#08090A`                | page                          |
| `--panel`  | `#0F1011`                | main surface                  |
| `--side`   | `#0B0C0D`                | sidebar, verb row, file bars  |
| `--raise`  | `#17181A`                | palette, threads, buttons     |
| `--hover`  | `rgba(255,255,255,.045)` | row hover                     |
| `--sel`    | `rgba(255,255,255,.07)`  | row / nav selection           |
| `--tx`     | `#F7F8F8`                | primary text                  |
| `--tx2`    | `#8A8F98`                | secondary                     |
| `--tx3`    | `#62666D`                | tertiary, line numbers, blame |
| `--bd`     | `rgba(255,255,255,.07)`  | default hairline              |
| `--bd2`    | `rgba(255,255,255,.12)`  | hover / emphasis border       |
| `--acc`    | `#5E6AD2`                | accent base                   |
| `--acc-tx` | `#8D95F2`                | accent text                   |
| `--acc-bg` | `rgba(94,106,210,.15)`   | accent fill                   |
| `--ok`     | `#4CB782`                | added / success               |
| `--ok-bg`  | `rgba(76,183,130,.12)`   | added pill fill               |
| `--ok-line`| `rgba(76,183,130,.18)`   | added diff row                |
| `--ok-row` | `#1A2E25`                | the same, flattened           |
| `--ok-word`| `rgba(76,183,130,.38)`   | the words that changed        |
| `--ok-hover`| `#5CC48F`               | the merge button, hovered     |
| `--no`     | `#E5484D`                | removed / failure             |
| `--no-bg`  | `rgba(229,72,77,.12)`    | removed pill fill             |
| `--no-line`| `rgba(229,72,77,.18)`    | removed diff row              |
| `--no-row` | `#361A1C`                | the same, flattened           |
| `--no-word`| `rgba(229,72,77,.38)`    | the words that changed        |
| `--wn`     | `#F2C94C`                | force push, unresolved        |
| `--mg`     | `#A371F7`                | merged                        |
| `--mg-bg`  | `rgba(163,113,247,.16)`  | merged fill                   |

`--ok-row` and `--no-row` are `--ok-line` and `--no-line` composited against
`--panel`, and must be recomputed whenever either moves. A diff's gutters and
sign column are sticky over scrolling source, so they cannot be translucent —
and they cannot be a different colour from the row they belong to either, or
the tint stops at the sign and the row stops reading as one thing.

### Light

| Token                             | Value                                          |
| --------------------------------- | ---------------------------------------------- |
| `--bg` / `--panel` / `--raise`    | `#FFFFFF`                                      |
| `--side`                          | `#FAFAFA`                                      |
| `--hover`                         | `rgba(0,0,0,.035)`                             |
| `--sel`                           | `rgba(0,0,0,.055)`                             |
| `--tx` / `--tx2` / `--tx3`        | `#17181A` / `#6B6F76` / `#9195A0`              |
| `--bd` / `--bd2`                  | `rgba(0,0,0,.09)` / `rgba(0,0,0,.14)`          |
| `--acc` / `--acc-tx` / `--acc-bg` | `#5E6AD2` / `#4F58B8` / `rgba(94,106,210,.10)` |
| `--ok` / `--ok-bg`                | `#2E7D5B` / `rgba(46,125,91,.10)`              |
| `--ok-line` / `--ok-row`          | `rgba(46,125,91,.16)` / `#DDEAE4`              |
| `--ok-word` / `--ok-hover`        | `rgba(46,125,91,.32)` / `#26694B`              |
| `--no` / `--no-bg`                | `#C93B40` / `rgba(201,59,64,.10)`              |
| `--no-line` / `--no-row`          | `rgba(201,59,64,.16)` / `#F6E0E0`              |
| `--no-word`                       | `rgba(201,59,64,.32)`                          |
| `--wn`                            | `#B07D14`                                      |
| `--mg` / `--mg-bg`                | `#8250DF` / `rgba(130,80,223,.12)`             |

### Syntax

Restrained by design — these sit _under_ the chrome, never above it.

| Token   | Dark      | Light     | Use               |
| ------- | --------- | --------- | ----------------- |
| `--kw`  | `#A78BFA` | `#7C4DDB` | keywords          |
| `--str` | `#7FB88A` | `#2E7D5B` | strings, literals |
| `--cm`  | `#5C6067` | `#9195A0` | comments (italic) |
| `--fn`  | `#77A9F2` | `#2F6FD0` | call sites        |

### Semantics — each meaning used once

- **Green / red** — added / removed. Diff state only, nowhere else — and the
  merge button, which is the same meaning acted on: it is the added and removed
  above it, applied to the base branch.
- **Indigo** — this concerns you: owned paths, unread changes, active view.
- **Amber** — a force push you have not seen; unresolved thread.
- **Purple** — merged, and nothing else. A landed pull request used to be
  indigo, which reads "this concerns you"; it is the one that no longer does.
- Everything else is greyscale.

---

## 4. Layout metrics

| Element                   | Value              |
| ------------------------- | ------------------ |
| Left sidebar width        | 196px              |
| Right panel width         | 230px              |
| Header height             | 44px               |
| Column header height      | 28px               |
| Data row height           | 32px               |
| Horizontal padding (main) | 14px               |
| Sidebar padding           | 10px / 8px         |
| Right panel padding       | 14px               |
| Line-number gutter        | 46px               |
| Blame gutter              | 126px              |
| Graph column              | 58px               |
| Pill radius / padding     | 5px / 2.5px 8px    |
| Nav + tree item radius    | 5px                |
| Thread card radius        | 8px                |
| Icon size                 | 14px, 1.6px stroke |

Borders are `1px solid var(--bd)` — roughly 7% opacity. The eye groups by
rhythm and spacing, not by lines. Resist raising the contrast.

---

## 5. Component inventory

**Shell** — sidebar, body (header → content), content splits into main and
right panel. It fills the viewport: no frame, no inset, no rounded corner. A
repository browser is a dense list and the rows are worth more than the border.

**Sidebar** — org badge (18px, 5px radius, accent fill) then four nav items:
Tree, Log, Refs, Review, each with a count on the right. Below, a contextual
section whose heading changes per screen (`Scope`, `Threads`, and a commit's
`Files`) — and which is absent, heading and all, on a screen that has none,
which is now most of them.

The badge is a destination as well as a label: it is the repository's own
screen, the Summary, and it takes the same `--sel` fill a nav item takes when
you are on it. Tree and File used to carry an expanding copy of the repository's
tree under a `Files` heading; it is gone. ⌘K opens any path in the repository by
name, which is what a tree in 196px was a slower way to do, and the space is
worth more as quiet.

The home screen is the one place the four are replaced rather than filled in:
git's primitives are questions about a repository, and above one they have
nothing to point at. It shows the account in the badge and two items — Pull
requests, Repositories — which are views of the same address, and no
contextual section at all. The geography is otherwise unchanged, which is the
point: badge, items, counts and account sit exactly where they sit on every
other screen.

**Home** — one table, with the standard 28px column header and no heading
above it: the sidebar says which of the two you are looking at. Pull requests
by default, across every repository, so the row leads with the repository
name; repositories on the other view, ordered by what was pushed to. One
filter field above, which is also where you type `owner/name` — that offers a
single row above the table, in either view, because it is an address rather
than a result. With no row selected the header carries pills and no verbs:
there is no object to carry them.

**Header** — breadcrumb left; the object's group and then the chrome, right.
Every segment of the breadcrumb is a link to the thing it names, including the
first: the owner goes to the home screen, which is the only screen that is about
the account — there are no owner or organisation pages to send it to.
The object's group is its pills (ref, HEAD SHA, state — `Open`, `1 check
failing`) followed by its verbs as text buttons and the copy/utility verb
last; it scrolls rather than pushing anything off the end. The chrome is ⌘K,
the theme toggle and the panel toggle, always outermost so their position
never depends on the screen.

**Verbs** — every object carries its own, in the header beside the pills that
identify it. Every verb must resolve in under 50ms or it does not belong
there. They had a 32px row of their own until it was cut: it repeated the
object's name from the breadcrumb and pushed every screen's content a line
down for verbs that fit next to the pills.

**Summary** — the repository's own screen, and where it opens. Description at
13px, then one line for the head commit — SHA in accent mono, headline, author
and age right-aligned — both above a hairline. Below it the README, **at the
full width of the main column**: here the prose is the screen rather than a note
under a listing, and the 76-character measure that reads best beside something
else reads as unfinished with nothing beside it.

The clone URL is in the header's copy slot, `Copy URL`, with the URL itself in
the title. It was a strip under the head commit offering two of them labelled
`read-only` and `read/write`, and the labels were the problem: HTTPS or SSH is
a decision made once in a git config, and re-asking it cost a row of the screen
on every visit. Every other screen keeps the one string it exists to hand you in
the same slot — `Copy SHA`, `Copy checkout` — so this is where you already look.

**Row** — 32px, flex, hover and selected states. Composition varies by
screen but the height and padding never do.

**Right panel block** — 11px tertiary heading, then key/value pairs at 12px
with the key left and value right. Three blocks separated by hairlines, in
fixed order: since your last visit → about → open against it.

**Code viewer** — line numbers, optional blame gutter, source. Blame runs
collapse: repeated SHAs render transparent so authorship reads as blocks.

**Diff** — sign column (14px), row-level tint from `--ok-line` / `--no-line`,
hunk headers on `--side` carrying the "pushes since you reviewed" count.

The tint runs the **whole** row — line numbers, sign and source — because a
sign is one character in a 14px column and reading a diff by it means reading
every line to find the handful that moved. Inside a replaced block, the runs of
text that actually differ take a second layer of the same colour, at
`--ok-word` / `--no-word`. That is the difference between "this line changed"
and "this word changed", and it is the whole reason to open a diff at all.

**Matching is character-level; the highlight is word-level.** Characters find
the change — a transposition inside an identifier is invisible to anything
coarser — and a span that lands inside a word is then grown to hold the whole
word, because a highlight starting three characters into a name is confetti.
The comparison is between whole *blocks*: every removed line joined against
every added line, so a rewrapped paragraph or a statement split across two
lines reads as text that moved rather than as three unrelated rows.

A refinement is never a claim, and all four ways of having no answer produce
the same one — the row tint and nothing more: a run of removals with no
additions after it, text that came back unchanged, two blocks too unalike to be
versions of each other, and a line covered end to end, which the row tint has
already accounted for.

**Merge bar** — Review screen, directly under the heading, the same 8px/14px
band as the "since your last review" banner and filling the column rather than
shrinking to its text. It says what will happen in words, offers only the
methods the repository allows, and ends in the app's **one filled button**, in
`--ok`. It arms rather than acts: the green button turns into `Confirm merge`
beside a `Cancel`, because a merge cannot be undone and one click on a screen
you navigate with `j` and `k` is not consent. Blocked — draft, conflicting,
archived — it keeps the band and drops the button, and says which of the three
it is. Merged, the band goes purple and says what landed where.

**Thread** — 8px radius card, indented 60px from the gutter, avatar +
author + relative time, status pill right-aligned, replies separated by a
hairline.

**Tag block** — Refs screen. Mono version, age and SHA pills, then the
shortlog in a `<pre>` at 11.5px.

**Delta bar** — five 5px cells, 2px gaps, 1px radius. Green for added,
red for removed, `--bd2` for unused. The only graphic in the app; it earns
its place because scanning a hundred rows for "is this a big change" is a
real task.

**Graph column** — drawn, not typed. One inline SVG per row at a fixed 58px
width: five lanes at an 11px pitch, 1.5px strokes with round caps, a 3.5px
dot, and cubic curves whose control points sit at the quarter heights so a
branch leaves and rejoins vertically rather than as a diagonal. Lanes are
coloured by column (`--lane-0` upwards), deliberately avoiding the delta
bar's green and red. This was box-drawing characters in mono for five
phases and they could not do it: a glyph is ink inside a 12px line box in a
32px row, so a lane crossing ten commits was ten dashes with gaps and a
curve stopped at the edge of its own cell. Each row's SVG is the row's full
height, so lanes meet where the rows do.

**Palette** — centred overlay, `min(540px, 90%)`, 10px radius, shadow
`0 16px 48px rgba(0,0,0,.45)`, scrim at 50% black. Query row, grouped
results, footer showing the prefix grammar and index size.

Rows are the standard 32px and carry an icon, the matched text, a secondary
field and a trailing note. **The characters you typed are emphasised by weight,
never by colour** — every colour here already means exactly one thing (§3), and
"this is why the row matched" is not one of them. Group headings are the same
11px tertiary label the right panel's blocks use, and the groups never reorder:
they filter in place, so the geography of an answer is learned once. There is no
separate hover state — moving the pointer moves the cursor — so exactly one row
is ever highlighted, and it is always the one `enter` will open. The query row
names the repository the grammar is scoped to, tertiary and right-aligned.

---

## 6. Interaction

- Hover: `--hover` fill, no movement, no shadow.
- Selection: `--sel` fill. Keyboard and mouse selection look identical.
- Focus: `2px solid var(--acc)` with `2px` offset. Never removed.
- Transitions: 120ms on colour only. Nothing animates position or size.
- All animation wrapped in `prefers-reduced-motion`.

Keyboard is primary. `j`/`k` move, `enter` opens, `/` filters, `⌘K` opens
the palette, `esc` dismisses. Shortcut hints live in the palette footer, not
in a persistent status bar — discoverable when you're already asking a
question, invisible while reading.

---

## 7. Responsive

| Breakpoint | Behaviour                              |
| ---------- | -------------------------------------- |
| < 1060px   | Right panel hides                      |
| < 780px    | Left sidebar hides; blame gutter hides |

The main column and code viewer never reflow — code wrapping is a reading
regression, so it scrolls horizontally instead.

---

## 8. Deliberately absent

No gradients. No shadows except the palette overlay. No avatars outside
review threads. No stars, forks, watchers or any social metric. No emoji.
No illustrations or empty-state art. No per-file last-commit column. No
rounded corners above 10px.

---

## 9. Accessibility

- Contrast: `--tx` on `--panel` clears AAA in both themes; `--tx3` is used
  only for non-essential meta, never for anything load-bearing.
- Colour is never the sole carrier of meaning: diff rows have `+`/`−` signs,
  status pills have text, the change dot has a tooltip and a sidebar
  equivalent. The emphasis on the changed run inside a row is the one thing
  carried by colour alone, and it is allowed to be — it refines a distinction
  the sign column has already made in text, and nothing is lost by not seeing
  it.
- Focus is always visible; every verb-row action is reachable by tab.
- Icons that carry meaning get labels; decorative ones are `aria-hidden`.

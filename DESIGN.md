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
| `--ok-bg`  | `rgba(76,183,130,.12)`   | added row fill                |
| `--no`     | `#E5484D`                | removed / failure             |
| `--no-bg`  | `rgba(229,72,77,.12)`    | removed row fill              |
| `--wn`     | `#F2C94C`                | force push, unresolved        |

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
| `--no` / `--no-bg`                | `#C93B40` / `rgba(201,59,64,.10)`              |
| `--wn`                            | `#B07D14`                                      |

### Syntax

Restrained by design — these sit _under_ the chrome, never above it.

| Token   | Dark      | Light     | Use               |
| ------- | --------- | --------- | ----------------- |
| `--kw`  | `#A78BFA` | `#7C4DDB` | keywords          |
| `--str` | `#7FB88A` | `#2E7D5B` | strings, literals |
| `--cm`  | `#5C6067` | `#9195A0` | comments (italic) |
| `--fn`  | `#77A9F2` | `#2F6FD0` | call sites        |

### Semantics — each meaning used once

- **Green / red** — added / removed. Diff state only, nowhere else.
- **Indigo** — this concerns you: owned paths, unread changes, active view.
- **Amber** — a force push you have not seen; unresolved thread.
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
section whose heading changes per screen (`Files`, `Symbols`, `Scope`,
`Threads`).

**Header** — breadcrumb left; the object's group and then the chrome, right.
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

**Clone strip** — Tree screen only. Two labelled URLs, `read-only` and
`read/write`, in mono at 11.5px.

**Row** — 32px, flex, hover and selected states. Composition varies by
screen but the height and padding never do.

**Right panel block** — 11px tertiary heading, then key/value pairs at 12px
with the key left and value right. Three blocks separated by hairlines, in
fixed order: since your last visit → about → open against it.

**Code viewer** — line numbers, optional blame gutter, source. Blame runs
collapse: repeated SHAs render transparent so authorship reads as blocks.

**Diff** — sign column (14px), row-level tint from `--ok-bg` / `--no-bg`,
hunk headers on `--side` carrying the "pushes since you reviewed" count.

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
  equivalent.
- Focus is always visible; every verb-row action is reachable by tab.
- Icons that carry meaning get labels; decorative ones are `aria-hidden`.

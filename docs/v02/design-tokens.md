# Fabro design tokens

Every colour, font, size, radius, shadow and motion value lives in `src/renderer/styles/tokens.css`.
Component rules only read these custom properties, so a **theme** (light/dark) or a **skin** (Halloween today; a
terminal skin, a high-contrast skin… next) is one block that redefines some of them:

```css
[data-skin="terminal"] {
  --font-ui: var(--font-mono); --font-read: var(--font-mono); --font-display: var(--font-mono);
  --bg: #0b0f0c; --panel: #070a08; --elev: #0f1511; --text: #c8f5d0; --accent: #39d353; --accent-ink: #04110a;
  --r-sm: 2px; --r-md: 2px; --r: 3px; --r-lg: 4px; --r-xl: 4px; --r-pill: 3px;
  --shadow: none; --shadow-lg: 0 0 0 1px var(--border-strong);
  --texture: repeating-linear-gradient(0deg, rgba(255,255,255,.02) 0 1px, transparent 1px 3px);
}
```
`src/renderer/styles/skin-halloween.css` is the worked example (tokens + its own decorations).
Load order: `styles/tokens.css` → `styles.css` → feature sheets (`styles/<feature>.css`) → `styles/skin-*.css` → `styles/motion.css`.
The quick bar (`quick.html`) loads `tokens.css` too.

Rules for component CSS: no hex/rgb literals (exceptions are commented in place: the dev-mode warning stripe,
the black presentation screen, per-artifact pastel tints set by JS, the colour-picker wheel); sizes from the scales
below; motion only through the duration/curve tokens.

## Surfaces
| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | #f7f5f0 | #11151c | the page |
| `--panel` | #efece5 | #0d1016 | sidebar, side areas |
| `--elev` | #fffefb | #1a1f28 | raised surfaces: composer, cards, menus, dialogs |
| `--elev-2` | #faf8f3 | #151a22 | quiet fill inside surfaces (rows, fields) |
| `--paper` | #fff | #fff | real white sheets: documents, web previews, thumbnails, switch knobs |
| `--bubble` | #ece8df | #222934 | the user's messages |
| `--code-bg`, `--code-head` | | | code blocks and their header |
| `--scrim` | | | behind dialogs, the phone drawer |
| `--texture` | none | none | optional background-image layer on `html`/`body` (skins) |

## Ink, lines, fills
`--text`, `--text-2`, `--muted` (AA on `--bg`, `--panel`, `--elev`), `--faint` (decoration only, never text to read) ·
`--border`, `--border-strong` · `--hover`, `--active` (selected), `--pressed` (`:active`).

## Accent (coral) and status
| Token | Use |
|---|---|
| `--accent` | fills with `--accent-ink` text (AA), icons, active toggles |
| `--accent-hover` | hover on filled accent |
| `--accent-text` | coral words on the page (links, "Ouvrir") — AA |
| `--accent-soft` | tinted backgrounds (on-state chips, icon tiles) |
| `--accent-line` | accent outlines |
| `--accent-ink` | text/icons on `--accent` |
| `--logo` | the propeller — always the brand coral (#cf6a3c light, #ff6a4d dark) |
| `--focus` | keyboard focus ring and focused fields |
| `--ok` `--warn` `--err` + `-soft` | status text / tinted backgrounds; `--on-status` = text on a filled status |
| `--hl`, `--hl-ink` | highlighter mark |
| `--data-1..3` | charts and meters |
| `--syn-*` (comment, keyword, string, number, title, type, attr, meta) | code highlighting |
| `--term-bg/-fg/-dim/-line` | terminal blocks (always dark) |

## Type
Families: `--font-ui` (system sans), `--font-read` (message text — a skin can set a serif or mono here),
`--font-display` (serif headings: Iowan / Palatino / Georgia), `--font-mono`. Short aliases `--sans`, `--serif`, `--mono`.

Scale: `--fs-2xs` 11 · `--fs-xs` 12 · `--fs-sm` 13 · `--fs-ui` 14 · `--fs-body` 15 · `--fs-read` 16 (messages) ·
`--fs-h4` 17 · `--fs-h3` 20 · `--fs-h2` 26 · `--fs-h1` 32 · `--fs-display` clamp(30–40) (greeting).
Leading: `--lh-tight` 1.25 · `--lh-ui` 1.45 · `--lh-read` 1.65. Weights `--fw-medium` 500, `--fw-strong` 600.
Reading column: `--measure` 46rem (~72 characters); the composer uses the same width (`--measure-composer`).

## Space, shape, size
Space (4 px grid): `--sp-0` 2 · `--sp-1` 4 · `--sp-1h` 6 · `--sp-2` 8 · `--sp-3` 12 · `--sp-4` 16 · `--sp-5` 20 ·
`--sp-6` 24 · `--sp-7` 32 · `--sp-8` 40 · `--sp-9` 56 · `--gap` 10 (between the floating panels).

Radii: `--r-xs` 6 · `--r-sm` 8 · `--r-md` 10 (controls) · `--r` 12 (cards, code) · `--r-lg` 18 (panels, menus) ·
`--r-xl` 24 (composer, dialogs) · `--r-pill`.

Control heights: `--ctl-xs` 26 · `--ctl-sm` 30 · `--ctl` 34 · `--ctl-lg` 42. `--hit` 32 (44 on touch screens).
`--sb-w` sidebar width.

## Depth
`--shadow-sm` (hairline lift for buttons), `--shadow` (things that float: composer, side panel),
`--shadow-lg` (menus, dialogs, toasts), `--thumb-shadow` (paper on a tinted thumbnail), `--knob-shadow` (switch/slider knobs), `--tile-shadow` (provider logo tiles). Light mode (modest
computers) flattens them.

## Motion
`--dur-press` 110 ms · `--dur-1` 160 · `--dur-2` 240 · `--dur-3` 360 · `--dur-4` 520 ·
`--ease-out`, `--ease-in`, `--ease-inout`, `--ease-spring` (panels, menus), `--ease-bounce` (toggles, press release) ·
`--lift` 6 px (how far things travel when they appear). Aliases kept for older rules: `--ease`, `--spring`.
See `docs/v02/motion.md`.

## Reusable controls (for the settings rebuild and new pages)
Classes in `styles.css` › "Controls": `.btn` (`.primary .ghost .danger .sm .lg`), `.input` (`.sm .sm2 .area .bare .mono`),
`select.input` (native menu, drawn chevron), `.switch` (`<button class="switch on"><i></i></button>`), `.seg`
(segmented, `.seg.sm`), `input[type=range]` / `.range-wrap` + `.rv`, checkboxes/radios (accent-coloured),
`.field` (label + control + `small` hint), `.card` (`.quiet`), `.list` + `.list-row` (`.link-row`), `.tabs`
(underline tabs: `<div class="tabs"><button class="on">…`), `.chip` (`.accent .ok`), `.tag`, `.fit-*`.
Settings shell: `.st-panel`, `.st-nav`/`.st-tab`, `.st-top`, `.st-content`, `.st-sec` (section heading — one
style everywhere, sentence case), `.st-row` = `.st-label` (`span` + `small`) + `.st-control`, `.st-block`, `.st-intro`.
Every control has hover, pressed (`:active`), disabled and `:focus-visible` states.

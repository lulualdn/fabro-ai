# Motion in Fabro v0.2

## The language
- **Answer at once, settle softly.** Things start moving on the frame after the click and land with a spring
  (pre-computed `linear()` curves: `--ease-spring` for panels and menus, `--ease-bounce` for small toggles).
  Fallback `cubic-bezier` curves where `linear()` isn't supported (older Safari on phones).
- **Short.** `--dur-press` 110 ms (press, hover colour) · `--dur-1` 160 ms (fades) · `--dur-2` 240 ms (menus) ·
  `--dur-3` 360 ms (sidebar, side panel, dialogs) · `--dur-4` 520 ms (the greeting, once).
- **From where you acted.** Menus scale up from the pointer (or the focused control for keyboard users) and fade
  out instead of vanishing. Dialogs rise a few pixels. Messages you send come up from the composer's corner.
- **Interruptible and reversible.** CSS transitions reverse from their current value; `motion.js` restarts a glide
  from wherever the piece is (it reads the running animation's progress). Toggling the sidebar as fast as you can
  follows your clicks; nothing queues, nothing snaps.
- **Only transform and opacity move.** Colour fades only on small controls, ≤ 110 ms. No box-shadow, blur, width or
  height animation; no `backdrop-filter` anywhere in the base theme (the Halloween skin keeps one on the composer).
- **Nothing loops while idle.** Loops exist only while something is happening (spinner while loading, caret and
  "thinking" breathing while a model answers, the voice ring while listening). The update chip pulse, the
  onboarding idle spin, the download-bar shimmer and the "thinking" gradient shimmer are gone.
- **Hidden window = still.** `html.is-hidden` pauses every CSS animation, running WAAPI animations are finished.
- **Reduced motion** (system setting or Fabro's "Reduce motion"): durations go to 1 ms, loops stop, only the loading
  propeller keeps turning slowly (it still has to say "busy"). The View Transitions are skipped.

## Where it lives
- `src/renderer/styles/tokens.css` — durations, curves, `--lift`.
- `src/renderer/styles/motion.css` — keyframes, entrances, caret, view transitions, hidden/reduced rules.
- Component transitions sit next to their component in `styles.css` (sidebar, side panel, settings, toasts, switches).
- `src/renderer/motion.js` — what CSS can't do alone, wired by observers (no other file calls it):
  - **Layout glide (FLIP).** The sidebar and the side panel leave the flow when closed and slide with a transform.
    The main column snaps once to its new width; a `ResizeObserver` on `.main` (armed by a `MutationObserver` on
    `#app`'s layout classes) translates the column's pieces back to where they were and releases them. Where a piece
    "was" is derived from the previous column box and its anchoring (left / right / centred) — no measurement before
    the change, so callers don't have to know about it. Reads are batched before any animation starts.
    Long scrolling content is never moved as one block (a moving element is painted whole): only the messages on
    screen glide, the others take their new place unseen.
  - **Menus**: enter from the pointer; a copy of a closing menu fades out in `#motion-ghosts` (no ids, no actions,
    `inert`, so tests and assistive tech never see it).
  - **Toasts**: when one leaves, the others close the gap.
  - `window.Motion = { reduced, token, ms, glide(el, dx, dy), enter(el) }` for other modules.
- Performance fix that made the numbers below possible: `.thread > .msg:not(:last-child) { content-visibility: auto }` —
  messages out of view skip layout and paint. Any width change (sidebar, side panel, window) used to re-flow the
  whole conversation (≈45 ms for 40 messages on a fast CPU, ≈5× that throttled); now ≈8 ms.

## Measurements
`scripts/motion-test.js` drives the real Electron app (Playwright) with the CPU throttled through CDP
(`Emulation.setCPUThrottlingRate`) and records every animation frame (rAF deltas) and every long task
(`PerformanceObserver('longtask')`) while it runs the scenarios. The conversation has 40 messages with headings,
lists, tables and code; the streaming answer is ~3 000 characters in 4-character chunks every 12 ms.

```
flock /tmp/fabro-e2e.lock xvfb-run -a -s "-screen 0 1440x900x24" node scripts/motion-test.js --rates 4,6 [--app <other checkout>] [--json out.json] [--shots dir]
```

Before = commit 86bd79d (v0.1.56 + groundwork), after = branch `v02-ui`. Same machine (2 cores, Xvfb, software
compositing), same script. 60 Hz ⇒ an ideal frame is 16.7 ms; "frames >32 ms" are visibly dropped frames.

| CPU | Scenario | Before: mean / p95 / max frame (ms) | Before: frames >32 ms · long tasks (max) | After: mean / p95 / max frame (ms) | After: frames >32 ms · long tasks (max) |
|---|---|---|---|---|---|
| 4× | sidebar, fast toggles (interrupted) | 36.3 / 100 / 117 | 31 of 62 · 11 (114) | 18.5 / 33 / 50 | 8 of 112 · 0 (0) |
| 4× | sidebar, open/close | 27.6 / 67 / 117 | 30 of 101 · 14 (115) | 17.6 / 17 / 67 | 6 of 166 · 1 (84) |
| 4× | settings open/close | 31.2 / 67 / 133 | 42 of 126 · 1 (52) | 18.2 / 33 / 50 | 17 of 212 · 0 (0) |
| 4× | model picker | 17.9 / 17 / 83 | 9 of 195 · 2 (85) | 17.7 / 33 / 50 | 10 of 196 · 1 (51) |
| 4× | side panel (artifact) | 32.9 / 117 / 183 | 30 of 127 · 21 (159) | 18.7 / 17 / 150 | 7 of 226 · 7 (138) |
| 4× | scroll long conversation | 18.1 / 33 / 50 | 8 of 107 · 0 (0) | 17.3 / 17 / 67 | 2 of 108 · 1 (64) |
| 4× | streaming answer | 33.4 / 67 / 400 | 175 of 333 · 45 (359) | 36.0 / 83 / 417 | 164 of 326 · 62 (415) |
| 6× | sidebar, fast toggles (interrupted) | 46.7 / 100 / 133 | 22 of 41 · 16 (106) | 23.0 / 100 / 150 | 10 of 100 · 8 (140) |
| 6× | sidebar, open/close | 38.5 / 117 / 167 | 20 of 78 · 20 (165) | 18.8 / 17 / 100 | 8 of 161 · 3 (106) |
| 6× | settings open/close | 38.4 / 83 / 133 | 43 of 108 · 8 (110) | 23.7 / 67 / 133 | 33 of 167 · 8 (116) |
| 6× | model picker | 18.2 / 17 / 83 | 9 of 198 · 3 (94) | 18.0 / 33 / 67 | 11 of 195 · 1 (63) |
| 6× | side panel (artifact) | 41.3 / 167 / 300 | 20 of 103 · 19 (256) | 20.3 / 33 / 183 | 12 of 214 · 9 (118) |
| 6× | scroll long conversation | 20.5 / 33 / 67 | 18 of 100 · 3 (70) | 19.5 / 33 / 67 | 11 of 101 · 2 (76) |
| 6× | streaming answer | 43.3 / 100 / 200 | 176 of 252 · 65 (195) | 51.9 / 133 / 200 | 139 of 223 · 86 (185) |

### Reading it
- **Sidebar, settings, side panel**: the old sidebar and side panel animated `width`, which re-laid out the
  conversation on every frame — that is the wall of 30–40 dropped frames before. Now the layout changes once and
  the movement is composited: at 4× the sidebar drops ~1 frame per toggle (the frame of the click itself), with no
  long task even when toggled 8 times in a row mid-flight.
- **Target "no frame over ~32 ms at 4×" is met for most frames, not all.** What's left at 4×:
  the click frame (re-rendering the sidebar/top bar and one layout, 50–85 ms), and opening an artifact (rendering
  its markdown/HTML in the panel: up to ~140 ms, the same work as before). These are one-off frames at the start
  of the movement; the movement itself runs on the compositor.
- **Streaming is unchanged** (≈half the frames over 32 ms at 4×, both before and after). The cost is the
  re-render of the answer's markdown on every animation frame (`scheduleStreamRender` in app.js), which belongs to
  the streaming/render-scheduling work happening in parallel — not touched here. CSS on my side helps only a
  little (no gradient shimmer, caret is an opacity breathe on a pseudo-element).
- Numbers on a 2-core VM under Xvfb are noisy (±30 % between runs); compare runs from the same machine.

# Context (v0.2) — `src/main/context/`

- `tokens.js`: estimates, calibrated per model on the real prompt size.
- `digest.js`: the hidden `<digest>…</digest>` line (stream filter, never shown, never spoken), mechanical
  descriptions when the model forgets it, exact identifiers (paths, URLs, code, numbers, versions), outlines.
- `index.js`: the manager.
  - The renderer sends the whole conversation with message ids and digests; originals stay in the database.
    A per-conversation snapshot (`<account>/context/<conv>.json`) says which first messages are replaced by a summary.
    `prepare()` applies it as a prefix of the next request: the prompt only changes when a compression happens.
    An edit or branch in the covered part drops the snapshot.
  - When: never mid tool round. After an answer past ~65 % → background job (`bg` priority in the governor).
    Before a request past ~85 % → forced, with a "summarising" status. One step, back to ~50 %.
  - How: one model call, first line `DECISION: COMPRESS` or `GROW`. GROW (local models, only if the window can
    grow ≥ 1.3×): `engine.resizeContext` up to 2×, capped at the all-GPU limit. Unusable answer → mechanical
    summary from the digests. Identifiers are always copied mechanically. Pinned messages stay verbatim.
  - Memory pressure (governor `pressure` event) → grown windows reset (`onPressure`, wired in chat.js).
  - Inside one agent run (`inRun`): past ~85 %, old tool results become outlines, then the oldest steps are
    folded into a note on the request (roles keep alternating).
- Tools `context_list` / `context_read` / `context_pin` (`agent/context-tools.js`), offered when a conversation is
  summarised or longer than 24 messages.
- UI: `context-ui.js` gauge next to the model pill (real usage, real window, summary mark), toasts.
- Setting `context.grow: false` disables growing (no UI for it yet).

Tests: `node scripts/context-test.js`, `xvfb-run -a node scripts/context-e2e.js` (tiny window via `FABRO_CTX_TEST`).
Never tried with a real model: whether Gemma writes the digest line, and GROW on a real GPU.

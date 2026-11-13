# Models: find a model in plain words, and model tiers (v0.2)

## Finder — `src/main/modelfinder.js`

`find({ need, constraints?, specs?, offline?, useModel? })` → `{ ok, criteria, machine, picks[], notes[], considered }`.

1. Free text → criteria with heuristics (FR/EN words for code, images, homework, long documents, speed, "my small
   laptop", "the best my PC can run", sizes, languages). The loaded model is asked once only when the heuristics are
   unsure; everything works with no model loaded.
2. Candidates: the built-in catalog, then a Hugging Face search ranked on metadata (tags, downloads, likes, date,
   license). No hard-coded "best models" list. Offline (or `FABRO_E2E`): catalog only, and a note says so.
3. Each quantization is checked against this machine through the governor (`fitPlan`): GPU / split / MoE experts in
   RAM / CPU, comfortable context, estimated speed.
4. One recommendation, plus a lighter and a stronger alternative when they exist, each with what it is good and less
   good at and honest warnings (slow, CPU only, partial offload, big download, licence, gated, size estimated).
   Asked for code: a code model that runs at a usable speed is the recommendation.

Chat tool `find_model` (agent category "models") returns the same result; the chat shows it as cards with an
Install button each. Nothing downloads without that click.

Renderer: `window.ModelFinder = { renderSection(el), renderTiers(el), cardsHtml(res), open(), close(), mount(),
tierBadge(ref|tier), tierOf(ref), refreshTiers(), find(q) }`. Settings → Models mounts `[data-mf="section"]` and
`[data-mf="tiers"]`; the model picker and the first-run card have "Help me choose…".

## Tiers — `src/main/modeltiers.js`

Every usable chat model (local, Ollama/LM Studio, providers; Fabro Cloud only when nothing else) gets `light`,
`medium` or `complex`, relative to the pool: effective size (MoE: geometric mean of total and active), measured speed
to break ties, log-scale thirds. One model → all three. User overrides per model and a preferred model per tier
(`settings.modelTiers`, per account). IPC `api.tiers.{ list, resolve, setOverride, setPreferred }`.

Sub-agents: `run_subagent` takes `model: light | medium | complex` (or a model name). `forSubAgent()` picks the model:
- no tier given: search / summarise / extract → light, otherwise medium;
- a local model that would not fit next to the busy main model → the main model, with a note to the caller;
- a local conversation never goes to a cloud model, and a conversation on one provider never goes to another provider,
  unless the user picked that model for the tier in settings;
- if the tier's model fails before doing anything, the sub-task reruns on the main model (`chat.js` `spawnSub`).

## Tests

`node scripts/models-test.js` (fixtures in `scripts/fixtures/models-hf.json`), the main e2e covers the chat card,
the picker badges, the dialog and the tiers screen.

# Voice mode v0.2 — pipeline and latency budget

## The pipeline (one turn)

```
mic (getUserMedia, AEC + AGC on, noise suppression off) ─ ScriptProcessor 1024 ─► Mic.feed
  → Resampler → 16 kHz → Endpointer (voice-core.js, 10 ms frames)
      start  : 4 of 7 frames over the threshold (6 while Fabro speaks); 500 ms pre-roll kept
      pause  : 200 ms of silence → speculative FINAL recognition starts now
      end    : 380 ms (sounds finished) / 650 ms (unknown) / 1100 ms (mid-thought: "et", "because", "euh"…)
  → while speaking: PARTIAL recognitions (≤ 50 % duty, only when one takes < 1.6 s) → live transcript,
    "sounds finished?" hint, early barge-in decision
  → end: final text = the speculative run (already started 200 ms after the last sound)
  → sendPrompt immediately (no settle wait unless an aborted answer is closing)
model tokens → Chunker (first piece at the first clause / 9 words; then sentences, short ones merged, ≤ 220 chars)
  → speakable(): markdown/code/links/emoji out ("je te mets le code à l'écran"), dates/units/money in words
  → TTS worker (serial queue, 2 pieces ahead, cancellable by answer generation)
  → Speaker: WAV → AudioBuffer, loudness-normalised, sentence pause baked in, scheduled on the AudioContext clock
    back to back (8 ms crossfade), ≤ 6 s scheduled ahead
barge-in: speech onset while speaking → master gain to 0 in 60 ms, sources stopped, position remembered (pause)
  → backchannel / echo / noise → resume 350 ms before where it stopped
  → ≥ 3 real words in a partial (or > 1.3 s of speech where there are no partials) → stop + abort generation,
    assistant message truncated to what was actually played (by audio-clock position, word level)
```

One AudioContext for mic, voice and sound effects, created synchronously in the tap that opens voice mode
(plus a 1-sample unlock buffer for iOS), closed when voice mode closes.

## Latency budget — measured with `scripts/voice-flow-e2e.js`

Harness: real Electron app, real chat path (`chat.js` → fake OpenAI-compatible server: first token after
250 ms, then a token every 25 ms), synthetic speech fed into the microphone pipeline at real-time pace, the
in-page engines stubbed with fixed costs: **STT = 180 ms + 90 ms per second of audio** (≈ 480 ms for this
3.3 s utterance), **TTS = 60 ms + 100 ms per second of audio produced**. Same stubs and same server for both runs.
`VFLOW_BASELINE=1` was run on the old code (commit 901170b voice files) before any change.

| Stage (ms after the real end of speech, unless noted) | before | after |
|---|---:|---:|
| end of speech → recognition starts | 623 | 229–235 |
| recognition (stub) | 531 | 480 |
| end of speech → transcript ready | 1154 | 709–715 |
| end of speech → request reaches the model | 1286 | 764–790 |
| model TTFT (fake server) | 251 | 250 |
| first token → first TTS request | 261 | 54–61 |
| first TTS piece (stub) | 367 | 146–150 |
| **end of speech → first audio** | **2325** | **1254–1278** |
| partial transcript visible before end of speech | never | 1.5–1.6 s before |
| pre-roll before the first syllable | 407 | 468 |
| gap between pieces (audio clock) | 0–151 (media-element chaining, one underrun) | −8 (8 ms crossfade, every piece) |
| barge-in: voice faded (from speech onset) | 170 (ducked to 22 %, not stopped) | 146–150 (to 0) |
| barge-in: generation aborted | no (kept generating) | ~1 s after onset (as soon as a partial shows real words) |
| barge-in: history truncated to what was played | yes (by finished pieces) | yes (by audio-clock position) |

Where the remaining ~1.25 s goes (after): ~230 ms waiting for the 200 ms pause + frame latency, ~480 ms STT,
~50 ms send, 250 ms model TTFT, ~55 ms first clause, ~150 ms first TTS piece, ~30 ms scheduling lead.

### Real engines on this machine (`scripts/voice-local-e2e.js`, 2-core VM, no GPU, WebAssembly)

| | measured |
|---|---|
| Piper fr_FR-siwis-medium, 2.5 s of speech | 2317 ms (first run of the session) |
| Piper, 3.0 s of speech | 1189 ms |
| Whisper base (q8, WASM), 2.5–3 s utterance | 6600–7900 ms |

Whisper pads every input to 30 s, so its cost is nearly constant per call: on a slow CPU without WebGPU it
dominates everything (partials switch themselves off there — `sttMs ≥ 1.6 s`). On such machines the Python
faster-whisper path (already preferred when there is no GPU and it is installed) or WebGPU is what makes it fast.
The first TTS piece is kept deliberately short ("Bonjour Lulu !") because Piper on CPU runs at ~0.4–0.9× real time.

## What blocked, waited or dropped before (and what changed)

- Endpointing waited a fixed 620 ms, then started Whisper from zero → speculative final at 200 ms of silence,
  adaptive end (380 / 650 / 1100 ms) from the partial transcript.
- Nothing was transcribed while the user spoke → partials with a duty cycle, stale partials dropped in the worker.
- `VEar.analyse` ran on 48 kHz on the UI thread (50–130 ms desktop, several hundred ms on a phone) → 16 kHz,
  pitch on 8 kHz, first 4 s only, run during the speculative recognition (≈ 5–20 ms desktop).
- `encodeWav` resampled by nearest sample (aliasing on whispers) → box-filter resampler.
- First piece needed a clause of ≥ 14 chars, later ones a full sentence; each piece synthesised only one ahead,
  played through `<audio>` + `onended` chaining (gaps, a MediaElementSource per piece, a second AudioContext)
  → chunker, 2 ahead, clock scheduling on one context.
- Workers ran concurrent requests on one ONNX session → serial queues; TTS of a cut answer dropped (`cancel`).
- Barge-in only ducked to 22 % and never stopped generation until Whisper finished → pause to 0, early cut.
- Mic `getUserMedia`/AudioContext were created after an `await` (iOS may refuse audio) → context made first, in
  the tap.
- Markdown/URL/emoji filter was regex-light (bold markers, emoji, "°C", dates read as symbols) → `speakable()`.
- The `.vx` overlay had `backdrop-filter: blur(18px)` on the whole screen → removed (voice.css).
- The propeller rAF ran forever (also hidden) and queried the DOM every frame → cached nodes, stops when hidden,
  no rotation with reduce-motion.

## Not measurable here

Real microphones (AEC quality, laptop speaker echo, headsets), iPhone Safari (audio session, memory, the frame's
bridged microphone), GPU TTS (Kokoro/WebGPU) and GPU Whisper, Bluetooth output latency, real model TTFT.
See the owner test script in the v0.2 report.

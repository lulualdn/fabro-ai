# Fabro — IA locale, ultra simple

App desktop (Electron) pour faire tourner des IA en local. Base v0.1 : **UI + mode Chat**. Les modes Projets / Agent / Code sont visibles mais verrouillés derrière « Installer les dépendances » (branché sur `modes:install`, à implémenter).

## Lancer

```bash
npm install
npm start
```

## Builder / publier

```bash
npm run dist       # installeur pour l'OS courant (NSIS / DMG+ZIP / AppImage) → dist/
npm run release    # build + publication GitHub Releases (GH_TOKEN requis)
```

Changer `build.publish` dans `package.json` (owner/repo GitHub) avant la première release.

## Architecture

```
src/
  main/
    main.js     fenêtre (barre de titre masquée), IPC, planification des mises à jour
    engine.js   moteur llama.cpp : télécharge le build adapté (CUDA/Vulkan/Metal/CPU),
                lance llama-server, fallback CPU / autre build si échec, auto-update
    models.js   catalogue + recommandations selon le matériel, recherche & téléchargement
                GGUF Hugging Face (reprise, fichiers splittés, mmproj vision), liste Ollama
    system.js   détection CPU / RAM / GPU / VRAM → budget mémoire
    chat.js     streaming SSE OpenAI-compatible (llama-server ou Ollama), reasoning, stats tokens
    store.js    réglages + conversations en JSON (userData)
    updater.js  mise à jour de l'app (electron-updater / GitHub Releases)
  preload.js    pont IPC sécurisé (contextIsolation + sandbox)
  renderer/     UI vanilla JS : sidebar flottante repliable, chat, panneau de réglages en
                overlay, panneau latéral de visualisation (code / image / vidéo / markdown)
```

## Mises à jour automatiques
- **App** : `electron-updater` vérifie GitHub Releases 10 s après le lancement, télécharge en fond, installe à la fermeture (ou bouton « Redémarrer pour mettre à jour »).
- **Moteur** : compare le tag de la dernière release `ggml-org/llama.cpp` toutes les 6 h et se met à jour quand aucun modèle n'est chargé.

## Langues
Anglais par défaut, détection auto de la langue système. Incluses : en, fr, es, de (es/de partielles → repli anglais). Ajouter une langue = un bloc dans `i18n.js` + une entrée dans `LANGS` (`app.js`).

## Raccourcis
`Entrée` envoyer · `Maj+Entrée` nouvelle ligne · `Ctrl/⌘+N` nouveau chat · `Ctrl/⌘+B` sidebar · `Ctrl/⌘+,` réglages · `Échap` fermer / stopper.

## Releases

Every push to `main` builds the installers (Actions artifacts). A commit whose message contains `[release]` (or a pushed `v*` tag) makes GitHub Actions build Windows (`Fabro-Setup-x.y.z.exe`), macOS and Linux installers and publishes them in a Release, which the in-app auto-updater reads.
Run the workflow manually (Actions › Build & release › Run workflow) to get the installers as artifacts without publishing.

## Website

`site/` holds the Fabro website (home, feature pages, "Can my PC run it?", privacy, changelog, legal), in English, French, Spanish and German with light/dark themes. `node site/build.js` writes static pages to `site/dist`. The model list comes from the installer, the changelog from GitHub Releases. `netlify.toml` lets Netlify build it with no dependencies.

## Computer Use

The agent can see the screen and use the mouse and keyboard in any app (`src/main/computer/`). It gets a screenshot with numbered boxes on every control the app describes through accessibility (UI Automation on Windows), the list of those elements with their state, the windows and the focus, plus the text read on screen (built-in Windows OCR, tesseract on Linux) for apps that describe nothing (games, canvases). Actions — click, double/right click, long press, drag, scroll, typing, shortcuts, held keys, relative mouse moves, or a chained gesture in one call — move like a person (curved, minimum-jerk paths) and each returns the screen afterwards.

Windows: a small helper compiled on first use with the C# compiler that ships with Windows (nothing to install). Linux (X11): XTEST through python-xlib, installed in Fabro's Python. macOS: not yet.

Safety: asked once per conversation (Settings › Agent › Computer Use), Fabro minimizes itself and shows a frame hidden from its own screenshots, moving the mouse or pressing Esc hands control back at once, passwords and card numbers are never typed, sensitive clicks are confirmed, Fabro's own windows are off limits. Tests: `xvfb-run -a -s "-screen 0 1440x900x24" node scripts/computer-test.js` (Linux), `npx electron scripts/computer-win-test.js` (Windows).

## Mods

Everything in Fabro can be modded: screens, commands, history, internals. Settings › Mods installs them (built-in: Claude, ChatGPT and Gemini for Fabro). Each web-chat mod keeps its own saved sign-in and can import it from your own browser (Firefox, Chrome, Edge, Brave…). How to write one: [MODDING.md](MODDING.md). Tests: `node scripts/browser-import-test.js`, `xvfb-run -a node scripts/mods-e2e.js`.

## Links

`fabro://new?q=…` opens a new chat with that message, `fabro://chat/<id>` opens a conversation (works from any browser).

## Fabro Cloud (free, no account)

For computers too modest to run a model well (detected: no real GPU and little memory or few cores), Fabro starts on **Fabro Cloud**: a pool of free, anonymous, key-free endpoints whose limits add up — LLM7 (fast, several requests at once, a daily token quota per address) and OVH AI Endpoints (gpt-oss 120B, Qwen3.5 397B, Llama 3.3 70B…, 2 requests a minute per model, rotated). A busy or exhausted model hands over to the next at once (`src/main/providers.js`, `chat.js`). Settings › Providers turns it on/off; **Light mode** (Settings › General, on by default on such computers) drops blur, shadows and decorative motion.

## Voice

Speech-to-text: faster-whisper, with the size the computer handles well (large-v3 **turbo** with ≥ 12 GB RAM and 8 threads, else small) downloaded in the background while a quick model already works; a vocabulary (recent names Whisper doesn't know, installed models, the user's own words — voice mode › 📖) passed as hotwords; a lower voice-activity threshold, no browser noise suppression and a second pass without VAD so whispers are heard. Text-to-speech: **Kokoro** (one fluid voice family across en/fr/es/it/pt/ja/zh/hi), Piper for German; every sentence is read in its own language (`src/main/langdetect.js`).

Voice mode feels alive (`src/renderer/voice-fx.js`): the AI's voice carries moods — `(joyeux)`, `(triste)`, `[chuchote]`, `[rire]`, `[soupir]` change speed, loudness and laughter — and `[son:…]` plays sound effects synthesised on the fly (ding, tada, sifflet, prout, applaudissements…). Talking over it only lowers its voice: an "mh", "ouais", a laugh or its own echo lets it carry on; anything else cuts it where it was, and the conversation keeps only what was said aloud. Each utterance is also analysed (spectrum, pitch, rhythm — a few ms, no model) for whistling, humming, singing, laughter, claps, a fart, a whisper or an excited / tired voice, passed to the model as cues. A small installed model (≥ 1 GB, e.g. Gemma 4 E2B) answers voice turns when the chat model is big, with greedy Whisper decoding and the first clause spoken as soon as it's written. Test: `scripts/voice-e2e.js`.

## Themes

Light, dark and **Halloween** (a skin over dark: pumpkin accent, moon glow, bats, cobweb — offered in the user menu from mid-October).

## Fabro Anywhere (phone)

The phone app is a PWA in `site/app/` (served at `/app/` on the website). It pairs with the desktop by reading the circular code shown in Settings › Fabro Anywhere (`src/anywhere/core.js` draws and reads it, with Reed-Solomon correction). Phone and computer share P-256 keys; every message is AES-GCM encrypted end to end. They meet through public MQTT-over-WebSocket relays (or your own: `node scripts/mqtt-relay.js`, behind wss://), then switch to a direct WebRTC data channel when possible. The computer side runs in a hidden window (`src/anywhere/peer.*`) and `src/main/anywhere.js` (runs, sync, voice, Web Push sent straight to the phone's push service).

Two interfaces: a thumb-first one on phones (home shortcuts, recent chats, long-press menus) and a desktop one in a computer's browser (sidebar, side panel for files and artifacts, hover actions, `/` · `Ctrl K` · `Ctrl ⇧ O`). Settings › Display › Layout forces either.

Without the computer, it keeps chat **and** agent with tools (`site/app/agent.js`): Fabro Cloud (free, no account) or the phone's own model (WebGPU, offline); web search and page reading, images, Python (Pyodide), JavaScript, weather, plan — synced to the computer when it's back (Settings › When the computer is away). Voice without the computer: Whisper large-v3 turbo in the cloud, or Whisper on the phone (`stt-worker.js`, offline); the phone's best natural voices, sentence by sentence in each language (`speech.js`). The computer's full interface runs in a sandboxed frame that can't ask for the microphone: the phone app captures it and streams it in (`full.js` ↔ `full.html`); a refused microphone opens step-by-step help for the exact browser. Tests: `scripts/anywhere-test.js`, `scripts/ringcode-test.js`, `scripts/anywhere-e2e.js`.

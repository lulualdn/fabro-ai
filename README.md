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

## Mods

Everything in Fabro can be modded: screens, commands, history, internals. Settings › Mods installs them (built-in: Claude, ChatGPT and Gemini for Fabro). Each web-chat mod keeps its own saved sign-in and can import it from your own browser (Firefox, Chrome, Edge, Brave…). How to write one: [MODDING.md](MODDING.md). Tests: `node scripts/browser-import-test.js`, `xvfb-run -a node scripts/mods-e2e.js`.

## Links

`fabro://new?q=…` opens a new chat with that message, `fabro://chat/<id>` opens a conversation (works from any browser).

## Fabro Anywhere (phone)

The phone app is a PWA in `site/app/` (served at `/app/` on the website). It pairs with the desktop by reading the circular code shown in Settings › Fabro Anywhere (`src/anywhere/core.js` draws and reads it, with Reed-Solomon correction). Phone and computer share P-256 keys; every message is AES-GCM encrypted end to end. They meet through public MQTT-over-WebSocket relays (or your own: `node scripts/mqtt-relay.js`, behind wss://), then switch to a direct WebRTC data channel when possible. The computer side runs in a hidden window (`src/anywhere/peer.*`) and `src/main/anywhere.js` (runs, sync, voice, Web Push sent straight to the phone's push service). Tests: `scripts/anywhere-test.js`, `scripts/ringcode-test.js`, `scripts/anywhere-e2e.js`.

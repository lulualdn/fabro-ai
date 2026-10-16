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

`git tag v0.1.0 && git push --tags` → GitHub Actions builds Windows (`Fabro-Setup-x.y.z.exe`), macOS and Linux installers and publishes them in a Release, which the in-app auto-updater reads.
Run the workflow manually (Actions › Build & release › Run workflow) to get the installers as artifacts without publishing.

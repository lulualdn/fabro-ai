# Fabro

Appli desktop d'IA locale (Electron, renderer en JS vanilla, llama.cpp). Propriétaire : Lulu (UFStudios).

- Chantier en cours : **v0.2**. Lire `docs/v02/HANDOFF.md` (état, branches, reste à faire) puis `docs/v02/CONTRACT.md`
  (règles : nouveau code dans de nouveaux fichiers, `paths.dataDir()` pour les données par compte, tokens CSS, etc.).
  Les chemins `/home/claude/...` et le verrou `flock /tmp/fabro-e2e.lock` cités dans le contrat viennent de l'ancien
  environnement de travail : les ignorer.
- Tests : `node scripts/{guides,accounts,perf,agent,voice,sysprompt}-test.js`, puis `node scripts/e2e.js <dossier>`
  (Electron + Playwright ; `xvfb-run -a` sous Linux), `scripts/artifacts-e2e.js`, `scripts/accounts-e2e.js`.
- Ne jamais bumper la version ni écrire `[release]` dans un commit sans demande explicite : ça déclenche la CI
  qui publie la mise à jour automatique à tous les utilisateurs.
- Français dans l'interface : « tu », phrases courtes, pas de ton marketing. Design sobre, pas de dégradés décoratifs.
- Lulu parle français, veut des réponses courtes et techniques, et teste lui-même sur Windows 11 + RTX 3060.

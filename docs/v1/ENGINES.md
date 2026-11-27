# Moteurs, atelier et computer use : état et notes (v1)

## Fait

- **Arène, premier tour** (`src/main/arena.js`, Réglages › Modèles › Comparer les moteurs) : llama.cpp seul, + n-gram,
  + MTP si le GGUF a des têtes MTP (`*.nextn_predict_layers`). Les noms d'options sont lus dans `llama-server --help`
  de la build installée (ils ont changé : `--spec-type mtp` → `draft-mtp`, `--draft-max` → `--spec-draft-n-max`).
  Mesures : premier mot, tok/s sur 3 invites (texte, code, JSON), température 0. Éliminé si la réponse diffère de
  llama.cpp seul ou si l'appel d'outil casse. Gagnant gardé par modèle + build (relancé après mise à jour du moteur),
  ajouté au lancement par `engine.argsFor` (jamais en mode sans échec). `settings.engine.speculative = false` coupe tout.
- **Atelier Linux** (`src/main/workshop.js`, Labs) : conteneur par projet via Podman puis Docker ; seul le dossier du
  projet est monté (`/work`) ; RAM = 1/4 de la machine (1 à 8 Go), CPU = moitié des cœurs ; ports 3000, 5173, 8000,
  8080 publiés sur 127.0.0.1 pour l'aperçu ; aucun jeton ni variable de Fabro à l'intérieur. Outil `workshop` dans
  Fabro Code.
- **Pastille d'arrêt** (`src/main/computer/stop-pill.js`).

## À vérifier sur le PC de Lulu

- Les options exactes de la build llama.cpp installée (l'arène les lit, mais rien n'a tourné sur un vrai modèle ici).
- MTP : seulement avec des GGUF qui ont les têtes MTP (ex. builds « MTP » d'unsloth). Pas de slots parallèles avec
  MTP (Fabro lance `-np 1`, donc OK).
- `wslc` (conteneurs WSL, WSL 2.9.3+) : seulement détecté. La syntaxe de la CLI est à confirmer avant de l'utiliser
  à la place de Podman/Docker.

## Pas fait (notes)

- **12 cas de `scripts/small-model-eval.js` par variante** : à lancer par Lulu contre un serveur démarré avec les
  options du gagnant (`--url`). L'arène intégrée ne fait que le contrôle rapide.
- **DFlash 2** : décodage spéculatif par blocs avec un petit modèle de brouillon dédié. Pas dans llama.cpp principal
  à ce jour ; à intégrer comme candidat quand une build stable et des brouillons GGUF existent.
- **Strata** (gros MoE réparti GPU + RAM + SSD) : 48 à 64 Go de RAM selon la version (32 pour Coder), ~100 Go de
  disque, GPU 12 Go recommandé. Pas d'audit de sécurité externe : ne pas l'activer par défaut. Lulu a une RTX 3060
  12 Go ; la RAM est à lire sur sa machine (`system.getSpecs().ramGB`) avant de proposer.
- **ik_llama.cpp** (CPU, MoE hybride), **MLX** (Mac Apple Silicon), **LiteRT-LM** (petits modèles, NPU) : candidats
  futurs ; chaque moteur doit exposer une API compatible OpenAI pour passer dans `arena.measure`.
- **Computer use en arrière-plan** : curseur dessiné (Cua Driver, MIT), écran virtuel (pilote à installer avec
  accord), session Windows séparée. Prototypes à faire ; un écran virtuel ne donne pas de seconde souris, et les jeux,
  apps à canevas et apps administrateur peuvent refuser les entrées en arrière-plan.

# Fabro v0.2 — état et reprise (13 nov. 2026)

Ce fichier sert à reprendre le chantier v0.2 dans une autre session (Claude Code). Lire aussi `docs/v02/CONTRACT.md`
(règles de travail + ce que chaque bloc expose).

## État au 13 nov. 2026 (2ᵉ session)

**Vague 2 terminée et fusionnée dans `v0.2`** : skills + MCP (`api-install.md`), modèles (`models.md`), thèmes
(`themes.md`), paramètres + Mon Fabro + Ressources (`settings-map.md`), contexte (`context.md`). Les branches
`v02-*` sont fusionnées, on peut les supprimer. La section « Reste à faire › Vague 2 » plus bas est donc close.

Tests ajoutés : `node scripts/{skills,mcpeasy,models,themes,myfabro,context}-test.js` et, sous `xvfb-run -a`,
`scripts/{install,keys,settings,context}-e2e.js`. `agents-e2e.js` est réparé (il appelait le vrai Fabro Cloud).
Tout est vert sous Linux. `accounts-test.js` a échoué une fois machine chargée puis repassé : à surveiller.

Toujours **jamais lancé sous Windows ni sur GPU** (pas de machine attachée à la session) : toute la liste
« Jamais vérifié » reste valable, plus : double-clic sur un `.skill`, import des configs MCP d'autres applis sur un
vrai poste, GROW de la fenêtre de contexte sur GPU, ligne `<digest>` écrite par un vrai Gemma, estimation de vitesse
du chercheur de modèles (pessimiste sur CPU portable), écran Ressources avec une vraie carte.

Éval petit modèle (Gemma 4 E4B Q4_K_M, llama.cpp CPU, 16k) : voir `docs/v02/small-model-eval.md`.

Reste : vague 3 (ordre à valider avec Lulu), dont le passage « vous » → « tu » de l'interface existante.

## Branches

| Branche | Contenu | État |
|---|---|---|
| `main` | v0.1.56, ce qui est publié | intact |
| `v0.2` | vague 1 fusionnée et intégrée | toutes les suites vertes sous Linux, **jamais lancé sous Windows ni sur GPU** |
| `v02-settings` | paramètres en 5 sections + Mon Fabro + écran Ressources | terminé, fusionné dans `v0.2` |
| `v02-themes` | thèmes façon Discord + thème CLI + navigation clavier | terminé, fusionné dans `v0.2` |
| `v02-models` | recherche de modèle en langage courant + niveaux léger/intermédiaire/complexe | terminé, fusionné dans `v0.2` |
| `v02-skills` | import de skills (.skill, zip, dossier, lien) + ajout MCP simplifié | terminé, fusionné dans `v0.2` |
| `v02-context` | compression, contexte intelligent, fenêtre variable | terminé, fusionné dans `v0.2` |

Les branches `v02-settings/themes/models/skills` partent d'un `v0.2` antérieur à la fusion du system prompt :
faire `git merge v0.2` dans chacune avant de continuer. Le dernier commit de chaque branche WIP est un instantané
pris à l'interruption : il peut contenir du code à moitié écrit.

## Ce qui est fait (vague 1, dans `v0.2`)

- **Comptes** (`docs/v02/accounts.md`) : 5 comptes isolés, migration de l'install existante en compte n°1,
  mot de passe (scrypt ; chiffre clés API et clés Anywhere, pas les conversations), fichiers modèles partagés,
  changement de compte par relance contrôlée.
- **Perfs** (`docs/v02/perf-audit.md`, `docs/v02/api-resources.md`) : gouverneur de ressources (threads, marges
  RAM/VRAM, une génération lourde à la fois avec file), réglages auto par machine + mini-bench au repos, filtrage
  des options selon le `--help` du moteur, détection de disque lent, API Ressources, rendu du streaming allégé.
- **UI** (`docs/v02/design-tokens.md`, `docs/v02/motion.md`) : tout en variables CSS, feuille de style refaite,
  couche d'animation interruptible.
- **Artefacts** : plus de Kit injecté dans les nouveaux artefacts, parseur tolérant, 69 guides de méthode dans
  `src/main/guides/builtin/`, vérification visuelle conservée, anciens artefacts inchangés.
- **Vocal** (`docs/v02/voice.md`) : transcription partielle, lecture sans trous, coupure de parole.
- **System prompt** (`src/main/sysprompt/`) : prompt adaptatif à budget, garde-fous anti-invention, carnet de l'IA
  (`note_to_self`), guides auto-écrits (`read_guide`/`write_guide`), system prompts personnels à variables.

## Tests

```
for t in guides accounts perf agent voice sysprompt; do node scripts/$t-test.js; done
xvfb-run -a -s "-screen 0 1440x900x24" node scripts/e2e.js /tmp/shots          # aussi THEME=dark
xvfb-run -a -s "-screen 0 1440x900x24" node scripts/artifacts-e2e.js /tmp/shots-art
xvfb-run -a -s "-screen 0 1440x900x24" node scripts/accounts-e2e.js /tmp/shots-acc
```
Sous Windows/macOS, lancer les scripts e2e sans `xvfb-run`. `scripts/agents-e2e.js` échouait déjà sur `main`
dans l'environnement Linux de test (délai du faux serveur) : à revérifier.

## Jamais vérifié — à faire sur une vraie machine avant toute release

1. Windows : migration vers les comptes (antivirus / OneDrive qui verrouillent des fichiers), priorités de
   processus, détection du type de disque (PowerShell), détection cœurs P/E.
2. GPU : chargement de Gemma 4 E4B entièrement sur la carte, mini-bench des réglages auto, lecture de la VRAM
   utilisée par les autres applis.
3. Mac 8 Go : le budget RAM est peut-être trop prudent (`limits.ramHeadroomGB`).
4. Vocal : vrais micros, écho sur haut-parleurs, iPhone via Anywhere, Kokoro sur GPU (protocole dans `voice.md`).
5. Petit modèle réel : `scripts/small-model-eval.js` (12 scénarios) n'a jamais donné de comparaison avant/après ;
   les guides d'artefacts n'ont jamais été essayés avec un vrai modèle.
6. À l'œil : éditeur de system prompts perso, sélecteur dans la barre de chat, carnet, guides ; zoom 125–150 % ;
   vrais téléphones.

## Reste à faire

### Finir la vague 2 (branches WIP ci-dessus)
- **Paramètres** : cinq sections — Mon compte / Mes modèles / Mon Fabro / Ressources / Avancé (sous-onglets) —
  dans `src/renderer/settings-ui.js`, sans perdre un seul réglage (`docs/v02/settings-map.md` à tenir). Monter :
  `Accounts.renderSection`, `Themes?.renderSection`, `ModelFinder?.renderSection/renderTiers`,
  `McpEasy?.renderSection`, `SkillsImport?.renderSection`, `SysPrompts?.renderSection`, `Notebook?.renderSection`,
  `Guides?.renderSection`, `DevLab?.renderSection`. Écran Ressources sur `api.resources.*` : barre disque en
  sections, graphes RAM/VRAM/CPU, conseils avec action en un clic.
- **Mon Fabro** (`src/main/myfabro.js`) : entrées de mémoire (titre + contenu + type + dates + source), profil
  vivant avec provenance (uniquement ce que l'utilisateur a dit ou fait ; titres des chats ChatGPT/Claude/Gemini
  synchronisés par les mods ; jamais d'inférence de traits sensibles ni d'âge), frise « ton histoire avec Fabro »
  calculée depuis la base, projets oubliés, skills à créer (ouvre une conversation pré-remplie).
- **Thèmes** : moteur + manifeste `.fabrotheme.json` (entrée non fiable : aucun script, aucune ressource distante),
  6 à 8 thèmes, thème CLI (monospace, zéro arrondi, préfixes `you ›` / `fabro ›`, ligne d'état, navigation clavier).
- **Modèles** : `find_model` (outil + carte ; l'installation exige toujours un clic), niveaux
  light/medium/complex, paramètre `model` des sous-agents.
- **Skills / MCP** : `skillimport.preview/install`, `mcpeasy.parse/test/add` (`docs/v02/api-install.md`).
- **Contexte** (`src/main/context/`) : compression aux bons moments (jamais en plein tour d'outils ; à ~65 % au
  repos, forcée avant ~85 %, en un seul gros pas pour ménager le cache de prompt ; identifiants extraits
  mécaniquement), contexte intelligent (balise `<digest>` en fin de message, retirée de l'affichage et du vocal,
  repli mécanique ; outils `context_list` / `context_read` / `context_pin`), fenêtre variable (décision
  grandir-ou-compresser prise pendant la compression, par paliers, via `engine.maxContext/resizeContext`,
  retour à la normale sous pression mémoire).

### Vague 3 (pas commencée)
- Outils agents en plus + l'IA peut proposer d'installer un MCP, un skill ou un system prompt, avec une seule
  confirmation oui / annuler.
- Scripts de réveil : l'IA lance un script qui la rappelle avec un résultat (ex. fin d'un déploiement GitHub),
  et elle est arrêtée entre-temps au lieu de faire des `wait`.
- Mode « tout autoriser » avec avertissement ; réglage de l'intensité de réflexion dans la barre de chat.
- Message envoyé pendant une génération : bulle semi-transparente avec « envoyer maintenant » (interrompt), sinon
  remis au modèle au prochain moment opportun (`inject()` existe déjà dans chat.js).
- Labo développeur : tester des system prompts, comparer des modèles rapidement, une IA qui en entraîne d'autres
  et rend un compte rendu (`sysprompt.explain` est prêt).
- Intégration rapide Claude Code / Codex ; import de `.skill` par double-clic.
- Traductions es/de, passage du français au « tu » partout (l'accueil dit encore « vous »).
- Trois lenteurs repérées : la fenêtre attend la détection matérielle avant de s'afficher (`main.js`),
  `setInterval(syncBrowser, 700)` permanent dans `agent-ui.js`, un message IPC par token.
- Anywhere : pas de transcription vocale en direct dans l'interface complète du téléphone
  (`site/app/local-pc.js` ignore le drapeau `partial`).
- Fabro Code : propositions faites au propriétaire, rien de décidé.

### Après la vérification finale
- Vidéo de présentation (nouveautés + anciennes fonctions, thème sobre, fin « Download the beta today »).
- Release : bump de version, `[release]` dans le message de commit, puis déploiement manuel du site
  (`fabro.ufstudios.eu/app` n'est pas déployé par les pushs).

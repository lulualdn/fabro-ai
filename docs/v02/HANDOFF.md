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

### Vague 3 (en cours)
Fait (branche `v0.2`, après la 0.1.58, pas encore publié) :
- Message en file : bulle semi-transparente + « Envoyer maintenant » (`chatbar-ui.js`).
- « Tout autoriser » par conversation, avec avertissement ; supprimer / payer / envoyer / publier et les commandes
  dangereuses demandent toujours (`ctx.allowAll` dans `agent/index.js`). L'intensité de réflexion existait déjà.
- Installations proposées par l'IA : `agent/installs.js` + carte oui / annuler (`install-card.js`), `scripts/installs-test.js`.
- Scripts de réveil : outil `wake_me_when` (`agent/wakeup.js`, `wakeups.js`, `wakeups-ui.js`). La boucle s'arrête
  (`endTurn` dans `chat.js`), la sortie du script relance le chat. Les scripts s'arrêtent à la fermeture de l'app.
  Pas testé avec un vrai modèle : seulement le gestionnaire et le rappel dans l'interface.
- Labo développeur (Réglages › Avancé › Développeur, mode développeur allumé) : même question à 2–4 réglages
  (modèle + prompt système), puis compte rendu écrit par le modèle courant, avec un prompt proposé
  (`devlab.js`, `devlab-ui.js`). Pas testé avec un vrai modèle.
- Moteur local : prompt système et liste d'outils figés par conversation (`sysprompt/freeze.js`), ce qui change pour
  une demande part en note `<system_update>` sur le dernier message utilisateur. Les appels en arrière-plan
  (`chat.quick`) n'envoient plus d'outils ni le prompt adaptatif (`params.bare`). Gain à mesurer sur une vraie machine.

Reste :
- Outils agents en plus + l'IA peut proposer d'installer un MCP, un skill ou un system prompt, avec une seule
  confirmation oui / annuler.
- Scripts de réveil : l'IA lance un script qui la rappelle avec un résultat (ex. fin d'un déploiement GitHub),
  et elle est arrêtée entre-temps au lieu de faire des `wait`.
- Mode « tout autoriser » avec avertissement ; réglage de l'intensité de réflexion dans la barre de chat.
- Message envoyé pendant une génération : bulle semi-transparente avec « envoyer maintenant » (interrompt), sinon
  remis au modèle au prochain moment opportun (`inject()` existe déjà dans chat.js).
- Intégration rapide Claude Code / Codex ; import de `.skill` par double-clic.
- Traductions es/de, passage du français au « tu » partout (l'accueil dit encore « vous »).
- Trois lenteurs repérées : la fenêtre attend la détection matérielle avant de s'afficher (`main.js`),
  `setInterval(syncBrowser, 700)` permanent dans `agent-ui.js`, un message IPC par token.
- Anywhere : pas de transcription vocale en direct dans l'interface complète du téléphone
  (`site/app/local-pc.js` ignore le drapeau `partial`).
- Fabro Code : propositions faites au propriétaire, rien de décidé.

### Demandes de Lulu du 14 novembre (après la 0.1.59)
Fait sur `v0.2`, pas publié : Gemma 4 E4B téléchargé seul sur installation neuve (`first-model.js`) ; réflexion,
étapes et artefacts affichés à leur place dans le message (`timeline.js`).
Reste, dans l'ordre :
- Documents : sous-agent spécialisé caché qui reçoit toutes les instructions, modifications ciblées (lignes à
  changer seulement), images et icônes (web compris), guides de mise en page. L'IA doit avoir un contrôle total
  sur le PDF (champs remplissables, etc.), pas seulement une lib, et pouvoir installer / lancer des outils pour
  traiter les documents. Slides et sites : même exigence de qualité.
- System prompt intelligent : ne donner que les infos utiles, pas tout l'historique (l'IA peut demander
  l'historique complet) ; en cas de doute sur ce dont on parle, chercher sur le web.
- Fabro Code : nouveaux projets plus simples, l'interface de l'app change en mode Code, version simplifiée
  sur mobile. Anywhere : bloc agent / progression moins envahissant.
- Vague 5 — Fabro Intelligent UI : une réponse n'est pas un seul message mais plusieurs affichages interactifs
  (barres de progression, cartes mentales, mise en page d'article de journal, petits jeux…), au thème Fabro.
  **Fait (première version)** : `src/renderer/intelligent-ui.js` + `styles/intelligent-ui.css` + `src/main/sysprompt/iui.js`.
  Le modèle écrit un bloc ```` ```fabro-ui ```` avec un objet JSON ; types : progress, stats, timeline, compare, mindmap, article,
  checklist, quiz, flashcards, memory, order, custom (HTML/CSS/JS dans un cadre isolé qui reçoit les tokens Fabro, sans réseau).
  Hook : `code()` de marked dans `app.js`. Réglage `settings.intelligentUi` (pas encore d'interrupteur dans les Paramètres).
  Vérifié dans l'app avec des blocs écrits à la main ; pas testé avec un vrai modèle (qualité du JSON des petits modèles inconnue).
  Reste : interrupteur, état gardé après redémarrage, Anywhere (le rendu passe par `md()`, à vérifier), autres types.
- Vague 6 — Fabro AI Overlay (mod, pas installé par défaut) : l'IA crée des widgets de bureau (Windows, Linux,
  macOS), coins arrondis, éléments plein écran placés par l'IA, interactifs ou transparents aux clics, pouvant
  regarder l'écran et parler à l'IA en arrière-plan. Petite hélice Fabro semi-transparente en haut à droite
  pour fermer l'overlay.

### Après la vérification finale
- Vidéo de présentation (nouveautés + anciennes fonctions, thème sobre, fin « Download the beta today »).
- Release : bump de version, `[release]` dans le message de commit, puis déploiement manuel du site
  (`fabro.ufstudios.eu/app` n'est pas déployé par les pushs).

### Fabro Code, nouveau shell (0.1.61)
- `src/renderer/code-shell.js` + `styles/code-shell.css` + `i18n/code-shell.js`, `src/main/code-new.js` (IPC `code:create`).
- Sans projet : « Qu'est-ce qu'on construit ? » : on décrit, le dossier est créé dans Documents › Fabro Code
  (`settings.code.projectsDir` pour changer), ouvert, et la description part en premier message.
- Projet ouvert : la barre latérale de l'app s'efface (hook `sbAuto` dans `app.js`) ; barre projet / branche / aperçu /
  terminal / nouvelle session ; panneau à onglets Fichiers / Modifs / Sessions ; tiroir sous 760 px.
- Remplace `cxWelcome`, `renderCodeView`, `cxSide` de `code-ui.js` et enveloppe `renderView`, `cxRenderTree`.
- Lulu a demandé une release à chaque grosse mise à jour (Intelligent UI = 0.1.60, shell Code = 0.1.61).
- Pas vérifié : le premier message avec un vrai modèle, le rendu dans Anywhere sur un vrai téléphone.

### Vague 6 — Fabro Overlay (mod intégré, désactivé par défaut)
- `src/mods/overlay/` : `main.js` (fenêtre transparente au-dessus de tout, outils `overlay_show` / `overlay_remove` /
  `overlay_list`, surveillance d'écran), `overlay.html` + `page.js` (dessin), `preload.js`.
- Widgets arrondis posés sur le bureau (enregistrés, de retour au démarrage, déplaçables) ; éléments plein écran (non
  enregistrés). La souris traverse la fenêtre sauf sur un élément interactif et sur l'hélice Fabro (haut droite, à
  moitié transparente) qui ferme l'overlay.
- Le contenu de l'IA tourne dans un cadre isolé (scripts seuls). `fabro.ask()` pose une question au modèle ;
  `watch_every` + `watch_prompt` : capture d'écran envoyée au modèle à ce rythme (20 s minimum), réponse dans `fabro.onAI`.
  Un point de couleur dans l'en-tête signale un widget qui regarde l'écran. `overlay_show` demande l'accord (risk write).
- Vérifié sous Linux/xvfb : outils, fenêtre, clic dans un widget, fermeture, sauvegarde. Pas vérifié : la souris qui
  traverse sur Windows/macOS réels, plusieurs écrans (écran principal seulement), la surveillance avec un vrai modèle
  vision, Wayland (capture et `forward` non garantis).
- Bloc agent : sur fenêtre taille téléphone (Anywhere) le panneau de session ne s'ouvre plus tout seul.

### Téléphone / Anywhere (0.1.63)
- `src/renderer/phone.js` + `styles/phone.css` (interface PC en taille téléphone) : glisser depuis le bord gauche ouvre le
  menu, glisser à gauche le ferme ; tirer vers le haut au dernier message remplit un anneau puis lance un nouveau chat ;
  bulle « Pas connecté au PC » (mode local) qui ouvre l'appairage ou relance la connexion ; Intelligent UI en une colonne.
- `site/app/theme.js` : clavier iPhone : la hauteur suit `visualViewport`, la page ne glisse plus (`html.kb-open`).
- Mise à jour du PC depuis le téléphone : `updater:install` n'est plus refusé (`remote-ui.js`) ; le téléphone affiche
  « Ton PC met Fabro à jour » (`full.js`, message `updating`) et attend 5 min au lieu de passer en local.
- Reconnexion : nouveaux essais toutes les 2 à 15 s (au lieu de 4 à 60 s).
- Pas fait : plantage des modèles locaux / voix sur téléphone (cause inconnue, il faut le message d'erreur ou le modèle
  de téléphone), paramètres simplifiés sur téléphone, déconnexions côté PC (non étudié), limites des chats créés hors ligne.
- Vérifié : gestes simulés dans une fenêtre 390 px, `anywhere-full-e2e` vert. Pas vérifié sur un vrai iPhone/Android.

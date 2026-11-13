# Prompt de reprise — Fabro v0.2

Tu reprends un chantier commencé dans une autre session. Tu n'as aucun contexte : tout ce qu'il faut est ici et
dans `docs/v02/`. Lis ce fichier en entier, puis `docs/v02/HANDOFF.md` et `docs/v02/CONTRACT.md`, avant de toucher
au code.

## 1. Le projet et moi

Fabro est mon appli desktop d'IA locale (Electron, renderer en JS vanilla sans framework, modèles GGUF via
llama.cpp `llama-server`, aussi Ollama et des fournisseurs externes). Dépôt `lulualdn/fabro-ai`, site
`fabro.ufstudios.eu`, version publiée : v0.1.56 sur `main`. Elle a : chat, mode agent (fichiers, terminal, Python,
navigateur intégré, Computer Use, documents, sous-agents, MCP, skills, tâches planifiées), artefacts (pages,
documents/PDF, slides, SVG), mode vocal local (Whisper + Piper/Kokoro), génération d'images, mémoire, projets,
« mods » qui intègrent Claude/ChatGPT/Gemini, une app « Agents », et Fabro Anywhere (la même interface diffusée
sur téléphone). Modèle par défaut : Gemma 4 E4B (petit, 8k–16k de contexte). Fabro Code est en maintenance.

Moi : Lulu, développeur solo (UFStudios), je teste sur Windows 11 + RTX 3060 12 Go. Je parle français, je veux des
réponses courtes et techniques. Je délègue la construction et je corrige au résultat. Je n'aime pas ce qui fait
« généré par IA » : dégradés décoratifs, effet verre, ton marketing. Design sobre. Identité à garder : thème clair
ivoire/argile, thème sombre bleu nuit, accent corail, mon logo hélice tel quel (ne jamais le redessiner), titres en
serif, gros arrondis, icônes pleines, sidebar façon Claude qui disparaît complètement une fois réduite.

## 2. Ce que j'ai demandé (ma demande d'origine, complète)

1. **Optimisation.** L'app fait beaucoup ramer les appareils, jusqu'au freeze, elle n'a pas de limites. Les modèles
   ne sont pas bien optimisés : quand on laisse les paramètres par défaut, ils doivent être réglés automatiquement
   pour aller le plus vite possible sur la machine.
2. **Recherches plus poussées** avec l'IA.
3. **Plus de capacités et d'outils pour les agents** : aujourd'hui ils ne peuvent pas faire grand-chose sans qu'on
   leur écrive un guide entier. Voir tout ce qui manque.
4. **System prompt intelligent** qui s'adapte à la situation du chat, pour informer directement les utilisateurs.
5. **Refonte complète de l'UI** pour qu'elle fasse plus « human made », même style visuel et mêmes arrondis.
6. **Animations fluides à la Apple** sur tout appareil.
7. **Comptes** : 5 maximum, qui n'ont rien en commun, pour particuliers et familles. Chaque compte a son
   historique, peut avoir un mot de passe, peut lier Anywhere, peut installer des modèles.
8. **Recherche de modèles simplifiée** avec des infos du quotidien : on demande directement à l'IA de trouver un
   modèle et elle le propose.
9. **Sous-agents** : classer les modèles en « modèle léger », « modèle intermédiaire », « modèle complexe », l'IA
   choisit entre les trois.
10. **Barre de chat** : régler l'intensité de réflexion ; mode « tout autoriser » avec avertissement.
11. **Mode développeur** : une section pour tester des system prompts, tester les modèles facilement et
    rapidement, et une IA qui apprend aux autres IA puis rend des comptes rendus.
12. **Contexte** : compression qui se fait aux bons moments. « Contexte intelligent » : chaque message est généré
    avec une petite description à la fin, et le modèle peut voir plus de détails en naviguant dans les
    descriptions. Fenêtre de contexte variable qui grandit selon les besoins ; c'est décidé au moment des
    compressions, le modèle détermine si la fenêtre doit grandir.
13. **Paramètres simplifiés**, en sections :
    - **Mon compte** : nom, icône, lier des clés API, instructions perso, etc.
    - **Mes modèles** : utiliser des modèles d'autres comptes ou en installer de nouveaux.
    - **Mon Fabro** : la mémoire Fabro (Fabro crée un titre et un contenu pour chaque chose notable, par exemple
      un nouveau projet) ; une description de l'utilisateur qu'il crée et met à jour d'après ce qu'il a vu, y
      compris les noms des chats sur ChatGPT, Claude, Gemini ; nom, âge, profession, habitudes ; une interface où
      Fabro rappelle tout ce qu'on a fait avec lui, du premier projet aux autres ; rappel des projets oubliés ;
      conseils de skills à créer (appuyer demande à Fabro, dans une conversation, de créer le skill d'après sa
      mémoire).
    - **Ressources** : utilisation disque en une barre remplie en plusieurs sections, graphes, conseils
      d'optimisation RAM et VRAM.
    - **Avancé** : connecteurs, MCP (ajout à simplifier) et tout le reste, en sous-onglets.
14. **Petits modèles** : regarder le comportement de Gemma 4 E4B et régler par le system prompt tout ce qui le
    rend non autonome (renforcement par prompt). L'IA doit pouvoir se créer elle-même des guides à partir de ce
    qu'elle observe. Elle a un espace où elle note « l'utilisateur veut que je sois autonome et que je ne pose
    pas de questions », rappelé par le system prompt intelligent.
15. **System prompts personnels** (option dans Avancé) : désactive le system prompt intelligent ; l'utilisateur
    personnalise tout le prompt avec des variables (mémoire, heure, position…). Ajoute dans la barre de chat une
    icône feuille de papier pour choisir avec quel system prompt on parle. Sauvegarde en fichier.
16. **L'IA configure elle-même** des MCP, ajoute des skills, crée des system prompts, avec juste une confirmation
    oui / annuler avant l'installation.
17. **Scripts de réveil** : l'IA exécute un script qui la rappelle avec un résultat (ex. fin d'un déploiement
    GitHub). Pendant ce temps elle est arrêtée, pour éviter les `wait`.
18. **Message envoyé pendant une génération** : bulle semi-transparente, avec dessous « envoyer maintenant » qui
    interrompt et envoie tout de suite ; sinon ça attend un moment opportun pour donner la précision à l'IA.
19. **Thèmes** façon Discord (pas comme Halloween) : couleurs, polices, textures, parfois animations. Un thème
    « CLI » qui ressemble à un terminal façon Claude Code : chats dans un panneau sans arrondis sur le côté,
    navigation au clavier.
20. **Artefacts** : je m'étais trompé, ils sont trop compliqués à exploiter pour l'IA. Il faut la guider sans
    faire à sa place. La library injectée dans chaque artefact enlève le côté créatif : la remplacer par des
    guides de réalisation, dont des dizaines de méthodes rien que pour les documents.
21. **Import de skills** plus facile, dont ceux de l'app Claude et les fichiers `.skill`.
22. **Mode vocal** refait pour être le plus fluide possible.
23. **Fabro Code** : me proposer une liste de choses à faire, sans les faire.
24. **Intégration rapide à Claude Code, Codex, etc.**
25. **Disques lents** (pas SSD, pas internes) : proposer de faire de la place pour un petit modèle plus rapide,
    refusable.
26. « Fais-toi plaisir sur le reste des fonctionnalités. »
27. **Après la vérification finale** : une vidéo dans le style de https://youtu.be/JYW7s02YCDg (mêmes animations,
    thème plus sobre) qui présente les nouveautés et toutes les anciennes fonctions, terminant par « Download the
    beta today ». Musique : à décider avec moi (un morceau connu sans licence serait coupé par YouTube ; soit je
    fournis un morceau, soit une piste sous licence libre).

## 3. Ce qui a été décidé en route

- Travail par vagues, sur la branche `v0.2`, `main` intact. Rien n'est publié.
- Nouveau code dans de nouveaux fichiers ; les fichiers chauds (`chat.js`, `main.js`, `prompts.js`, `preload.js`,
  `app.js`, `styles.css`, `i18n.js`, `index.html`, `store.js`) ne reçoivent que de petits points d'accroche.
- Données par compte via `paths.dataDir()` ; moteur et fichiers modèles partagés.
- Changer de compte relance l'app (seule façon sûre de ne rien garder en mémoire d'un compte à l'autre).
- Le mot de passe d'un compte chiffre les clés API et les clés Anywhere, pas les conversations ; pas de
  récupération, on supprime le compte. L'interface doit le dire tel quel.
- Mon Fabro : le profil ne contient que ce que l'utilisateur a dit ou fait ; jamais de traits sensibles déduits
  (santé, religion, politique, orientation, origine), jamais d'âge deviné ; chaque ligne montre sa source et se
  corrige ; rien ne quitte l'ordinateur.
- Une installation proposée par l'IA (modèle, MCP, skill, prompt) exige toujours un clic de l'utilisateur.
- Un thème importé, un skill importé, un guide lu sont des données non fiables : pas de script, pas de droits.
- Reconstruire le message système en cours de route casse le cache de prompt de llama.cpp : les infos de
  mi-parcours passent par les résultats d'outils.
- Preuve du problème d'autonomie : mes rapports AutoEval, où Gemma a écrit dix notes 5/5 identiques sans rien
  exécuter et inventé ma config Python. C'est ce comportement que les garde-fous ciblent.

## 4. Où on en est

**Fait et fusionné dans `v0.2`** (détails dans `HANDOFF.md` et les docs liées) : points 1, 4, 5, 6, 7, 14, 15, 20,
22, 25, plus les données de l'écran Ressources. Toutes les suites passent sous Linux. Jamais lancé sous Windows ni
sur GPU.

**Commencé, non testé, sur des branches WIP** : `v02-settings` (point 13), `v02-themes` (19), `v02-models` (8, 9),
`v02-skills` (21 + ajout MCP), `v02-context` (12, à peine commencé). Le dernier commit de chacune est un
instantané pris à une interruption : il peut être à moitié écrit.

**Pas commencé** : points 2, 3, 10, 11, 16, 17, 18, 24, la vidéo (27). Le point 23 (Fabro Code) : une liste de
dix propositions m'a été faite, je n'ai pas encore choisi.

## 5. Ce que tu fais, dans l'ordre

### Étape 1 — vérifier `v0.2` sur ma machine
`git checkout v0.2 && npm ci`, lance les tests de `HANDOFF.md`, puis `npm start`. Passe la liste « Jamais
vérifié » du `HANDOFF.md` point par point : migration vers les comptes, chargement de Gemma 4 E4B sur la 3060,
mini-bench des réglages auto, lecture de la VRAM des autres applis, détection du disque, vocal avec un vrai micro,
écrans des system prompts perso. Dis-moi ce qui casse, corrige, recommence. Lance aussi
`scripts/small-model-eval.js` avant/après (procédure dans le rapport du system prompt, résumée dans `HANDOFF.md`)
pour mesurer enfin l'effet du renforcement sur Gemma.

### Étape 2 — finir la vague 2, une branche à la fois
Ordre : `v02-skills`, `v02-models`, `v02-themes`, `v02-settings`, `v02-context`. Pour chacune : `git merge v0.2`
dedans, relis le commit WIP, termine, fais passer tous les tests, regarde les écrans, fusionne dans `v0.2`.

- **Skills + MCP** : import depuis `.skill` (zip avec un dossier contenant `SKILL.md`), zip, dossier, texte collé,
  lien GitHub, skills trouvés sur l'ordinateur (Claude Code `~/.claude/skills`, etc.) ; pour l'app Claude,
  expliquer en une phrase qu'on exporte un `.skill` depuis l'app. Aperçu avant installation, limites strictes à
  la décompression, rien n'est exécuté à l'import, note de compatibilité qui traduit les noms d'outils de Claude
  vers ceux de Fabro, export en `.skill`. MCP : coller n'importe quoi (JSON `mcpServers`, ligne `npx`/`uvx`/
  `docker`, `claude mcp add …`, URL), importer depuis les configs d'autres applis (Claude Desktop, Claude Code,
  Cursor, VS Code, Codex, LM Studio), petite liste de serveurs connus vérifiés, test de connexion avant
  d'enregistrer, la commande exacte montrée à la confirmation. API pour l'étape 3 : `skillimport.preview/install`,
  `mcpeasy.parse/test/add`.
- **Modèles** : `modelfinder.find({ need })` — texte libre → critères (heuristiques d'abord, doit marcher sans
  modèle chargé) → candidats du catalogue puis recherche Hugging Face classée sur les métadonnées (ne jamais
  coder en dur une liste de « meilleurs modèles ») → ce qui tient sur CETTE machine via le gouverneur → 1 choix
  + 2 alternatives avec le pourquoi et des avertissements honnêtes. Outil `find_model` en chat + carte avec
  bouton Installer. Niveaux `light/medium/complex` calculés automatiquement, modifiables ; paramètre `model` des
  sous-agents avec repli sur le modèle principal si un second ne tient pas en mémoire.
- **Thèmes** : manifeste (tokens clair/sombre, polices système, texture légère, animations), 6 à 8 thèmes avec un
  vrai parti pris, contraste AA vérifié par test, import/export `.fabrotheme.json` assaini. Thème CLI : monospace,
  zéro arrondi, filets 1 px, préfixes `you ›` / `fabro ›`, étapes d'outils en lignes de log, curseur bloc, ligne
  d'état (modèle · contexte · tok/s · compte), animations sèches. Clavier : `j/k`, `Entrée`, `/`, `Échap`,
  `g g`/`G`, `[`/`]`, `?`, `Ctrl+N`, commandes `/model /new /theme /settings /voice /clear`, sans jamais voler
  une touche pendant la saisie.
- **Paramètres** : les cinq sections du point 13, sans perdre un seul réglage existant (tenir
  `docs/v02/settings-map.md`). Monter les blocs des autres : `Accounts`, `Themes`, `ModelFinder`, `McpEasy`,
  `SkillsImport`, `SysPrompts`, `Notebook`, `Guides`, `DevLab`. Écran Ressources sur `api.resources.*`. Mon Fabro
  selon le point 13 et les règles de la section 3 ; extraction de mémoire dans le travail d'après-tour, à basse
  priorité via le gouverneur ; frise calculée depuis la base, pas par un modèle ;
  `myfabro.forPrompt({ budgetTokens, query })` pour le system prompt.
- **Contexte** : voir la section « Contexte » de `HANDOFF.md`. À retenir : ne jamais compresser en plein tour
  d'outils ; à ~65 % au repos et en arrière-plan, forcé avant ~85 % ; un seul gros pas ; identifiants (chemins,
  URL, nombres, noms) extraits mécaniquement et gardés mot pour mot ; originaux conservés en base ; balise
  `<digest>` en fin de message, jamais affichée ni lue à voix haute, repli mécanique si le modèle l'oublie ;
  outils `context_list` / `context_read` / `context_pin` ; grandir par paliers jusqu'à la limite tout-GPU
  (`engine.maxContext`, `engine.resizeContext`), question GROW ou COMPRESS posée dans l'appel de compression
  lui-même, retour à la normale sous pression mémoire ; jauge de contexte près de la barre de chat.

### Étape 3 — vague 3 (demande-moi l'ordre avant)
- **Outils agents** (point 3) : fais d'abord l'inventaire de ce qui manque par rapport à ce qu'un agent sait
  faire ailleurs, propose-moi la liste, puis ajoute. Recherche plus poussée (point 2) : recherche en plusieurs
  requêtes, lecture des pages, recoupement, sources citées.
- **Installations par l'IA** (16) : outils qui appellent `skillimport` / `mcpeasy` / `sysprompts` et affichent
  une carte oui / annuler.
- **Scripts de réveil** (17) : outil qui lance un script en arrière-plan avec une condition de fin ; la boucle
  de l'agent s'arrête vraiment ; le résultat relance la conversation. Délai maximum, annulation, trace visible.
- **Tout autoriser** (10) : par conversation, avec un avertissement clair ; ne lève jamais les confirmations
  avant supprimer / payer / envoyer / publier si une note du carnet ne peut pas le faire non plus — à me
  confirmer. **Intensité de réflexion** : réglage dans la barre de chat (le paramètre `reasoning` existe déjà).
- **Message en file** (18) : `inject()` existe dans `chat.js` ; il manque la bulle et « envoyer maintenant ».
- **Labo développeur** (11) : essai de system prompts côte à côte (`sysprompt.explain` est prêt), comparaison
  rapide de modèles sur les mêmes questions, et l'IA « professeur » qui entraîne une autre IA par le prompt puis
  rend un compte rendu.
- **Intégration Claude Code / Codex** (24), ouverture des `.skill` par double-clic.
- **Finitions** : français au « tu » partout (l'accueil dit encore « vous »), traductions es/de, les trois
  lenteurs et le point Anywhere listés dans `HANDOFF.md`.

### Étape 4 — vérification finale, puis vidéo, puis release
Relecture complète, tous les tests, essais réels sur ma machine. Ensuite seulement la vidéo (point 27), puis la
release quand je le dis.

## 6. Règles

- Une seule branche à la fois, **pas de sous-agents en parallèle** : c'est ce qui a vidé ma limite d'usage.
- Commit après chaque morceau fini.
- **Ne bump jamais la version et n'écris jamais `[release]` dans un commit sans que je le demande** : ça publie
  la mise à jour automatique à tous les utilisateurs.
- Ne dis jamais qu'une chose marche sans l'avoir lancée. Si tu n'as pas pu vérifier, dis-le.
- Interface en français au « tu », phrases courtes. Design sobre, tokens CSS uniquement, animations en
  `transform` / `opacity`.
- Réponds-moi court, en français.

# Prompt — vidéo de présentation de Fabro

À coller dans une nouvelle session, **après la vérification finale** (étape 4 de `PROMPT.md`).
Écrit sans avoir pu regarder la vidéo de référence (seuls le titre et la miniature ont été lus) : la première
étape du prompt est donc de la regarder.

---

Tu reprends le dépôt `lulualdn/fabro-ai` (Fabro, appli desktop d'IA locale, Electron). Lis `CLAUDE.md`,
`docs/v02/HANDOFF.md`, `docs/v02/motion.md` et `docs/v02/design-tokens.md`.

## Ce que je veux
Une vidéo de présentation de Fabro, 60 à 90 s, en 1920×1080 à 60 i/s (plus une version verticale 1080×1920),
qui montre **toutes** les fonctions de l'app, anciennes et nouvelles, et qui donne envie de la télécharger.
Dernier plan : le logo hélice, puis le texte **« Download the beta today »** et l'adresse du site.

## La référence : à suivre de très près
https://youtu.be/JYW7s02YCDg (« 4 nouveautés pour la version 8.4.0 », Papillon).
1. Regarde-la en entier, image par image s'il le faut (`yt-dlp` + `ffmpeg` pour sortir une image toutes les
   0,25 s). Si tu ne peux pas la télécharger, demande-moi un enregistrement : ne devine pas.
2. Écris d'abord `docs/v02/video-reference.md` : la liste des plans avec, pour chacun, durée, ce qui bouge, la
   courbe (rebond, ressort, glissé), les transitions entre plans, la place du texte, la façon dont la musique
   tombe sur les coupes. C'est ce document que tu suis ensuite.
3. Reprends : un chapitre par fonction, annoncé par une carte pleine couleur avec une grosse icône arrondie ;
   des morceaux d'interface détachés de l'app qui entrent avec un ressort, grossissent, se superposent ; des
   coupes calées sur le rythme ; presque pas de texte, quelques mots par plan.
4. Change : **thème plus sobre**. Les couleurs de Fabro uniquement (ivoire/argile en clair, bleu nuit en sombre,
   corail en accent), titres en serif, grands rayons, icônes pleines, pas de dégradés décoratifs. Le logo hélice
   n'est pas modifié.

## Deux sortes d'images
- **La vraie app, avec ses vraies animations.** Capture Electron avec Playwright, image par image (horloge
  pilotée, pas d'enregistrement d'écran) : ouverture de la barre latérale, menus qui partent du pointeur,
  message qui monte depuis la zone de saisie, panneau latéral, réglages, changement de thème, jauge de contexte.
  Les scripts existants servent de base : `scripts/trailer-capture.js`, `scripts/trailer-capture2.js`,
  `scripts/trailer/film.src.html`, `scripts/trailer/render.js`, `scripts/themes-shots.js`.
- **Des interfaces faites pour la vidéo.** Des éléments de l'app refaits en HTML/CSS avec les tokens de l'app
  (`src/renderer/styles/tokens.css`), agrandis et simplifiés : une bulle, la pastille de modèle, une carte
  d'installation, l'anneau de la voix, une tuile de thème. Ils doivent avoir l'air de sortir de l'app : mêmes
  rayons, mêmes ombres, mêmes polices, mêmes courbes (`--ease-spring`, `--ease-bounce`).
  Aucune fonction inventée : ce qui est montré existe dans l'app.

## Les chapitres (ordre à proposer, à me faire valider avant de monter)
1. Ouverture : l'hélice, « Ton IA. Sur ton ordinateur. »
2. Local et privé : un modèle se télécharge, répond hors ligne ; rien ne sort de l'ordinateur.
3. Choix du modèle : recherche de modèles, paliers léger / moyen / complexe, Fabro Cloud gratuit sans compte.
4. L'agent : il range des fichiers, lance des commandes, cherche sur le web, utilise l'ordinateur (Computer Use).
5. Artefacts : documents, diapositives, tableur (Fabro Docs / Slides / Calc), PDF mis en page, export Office.
6. Mode vocal : parler, réponse phrase par phrase.
7. Fabro Anywhere : le téléphone appairé avec le code circulaire, la même conversation dans la poche.
8. Nouveautés v0.2 : comptes ; nouveaux réglages en 5 sections ; Mon Fabro (ce qu'il sait de toi, avec la
   source) ; contexte intelligent (jauge, résumé sans perte) ; thèmes et thème CLI au clavier ; import de skills
   et MCP en un clic ; prompts système personnels ; guides ; animations refaites.
9. Mods, liens `fabro://`, mises à jour automatiques : un plan rapide chacun.
10. Fin : « Download the beta today ».
Vérifie chaque point dans le code et `HANDOFF.md` avant de le montrer : ce qui n'est pas fini ne passe pas à
l'image.

## Musique
Même énergie que la référence (note son tempo dans `video-reference.md`) et coupes calées dessus.
Propose-moi 3 morceaux avant de monter : au moins un connu et au moins un sous licence libre, avec pour chacun
le tempo et ce que YouTube en fait (un morceau connu sans licence : vidéo bloquée, coupée ou démonétisée selon
l'ayant droit). Je choisis. Ne récupère aucun morceau sans que je l'aie choisi.

## Texte à l'écran
Anglais, très court (3 à 5 mots par plan), ton simple, pas de superlatifs. Prévois les mêmes plans en
français dans un fichier de textes séparé pour une seconde version.

## Méthode
- Un film = une page HTML avec `window.setT(t)` et `window.DURATION`, rendue image par image puis assemblée
  avec `ffmpeg` (c'est déjà le principe de `scripts/trailer/`). Tout dans `scripts/trailer/`, rien dans l'app.
- Montre-moi d'abord un storyboard (une image par plan), puis une maquette de 15 s avec la musique, puis le
  film entier. Attends mon accord à chaque étape.
- Animations en transform/opacity, ressorts, 60 i/s réels : regarde les images sorties, ne dis pas que c'est
  fluide sans l'avoir vérifié.
- Pas de sous-agents en parallèle. Un commit par étape finie. Ne touche ni à la version ni à `[release]`.

## Livrables
`fabro-presentation-1080p.mp4`, `fabro-presentation-vertical.mp4`, une miniature 1280×720, les sources dans
`scripts/trailer/`, et `docs/v02/video.md` (comment relancer le rendu).

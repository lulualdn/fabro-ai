# Mods

Un mod ajoute ou change quelque chose dans Fabro : une demande au-dessus du chat, une commande, un nouveau look pour le chat, une fonction comme des flashcards. Fabro 1.0 donne aux mods des **points d’extension stables** : un mod écrit pour la version 1 de l’API continue de marcher quand l’interface change.

## Le dossier

```
mon-mod/
  mod.json      la fiche du mod
  ui.js         dans la fenêtre de Fabro (API v1)
  ui.css        facultatif
  main.js       facultatif : processus principal (Node + Electron)
```

```json
{
  "id": "mon-mod",
  "name": "Mon mod",
  "version": "1.0.0",
  "description": "Ce qu’il fait, en une ligne.",
  "ui": ["ui.js"],
  "uiStyles": ["ui.css"],
  "permissions": ["show a card above the chat", "send a message to the AI"]
}
```

`permissions` dit en clair ce que fait le mod. Fabro l’affiche avant de l’activer.

## L’API (`Fabro`, version 1)

Dans `ui.js`, deux objets sont disponibles : `Fabro` (l’API) et `mod` (ton mod : `mod.id`, `mod.call(fonction, …)` pour appeler son `main.js`).

| Point d’extension | À quoi ça sert |
| --- | --- |
| `Fabro.slots.add(emplacement, { id, render(el), order })` | Ajouter un élément dans un emplacement : `above-chat`, `sidebar`, `composer`, `message`, `settings`. |
| `Fabro.ui.card({ id, title, sub, actions })` | Une carte au-dessus du chat, avec des boutons. `Fabro.ui.removeCard(id)` la retire. |
| `Fabro.commands.add({ name, title, run(args) })` | Une commande tapée `/name` dans la saisie. Elle apparaît dans le menu `/`. |
| `Fabro.chatView.replace({ css, message(node, html) })` | Changer l’apparence du chat (thème, mise en page). `Fabro.chatView.reset()` revient au chat de Fabro. |
| `Fabro.chat.send(texte)`, `Fabro.chat.current()` | Envoyer un message, lire la conversation ouverte. |
| `Fabro.on(évènement, fn)` | `ready`, `conv`, `send`, `done`, `theme`. Renvoie une fonction pour se désabonner. |
| `Fabro.ui.toast(texte)` | Un petit message en bas. |

L’IA peut aussi afficher une carte au-dessus du chat avec l’outil `show_card`.

## Exemples

Trois mods complets sont dans le dépôt, dossier [`examples/mods`](https://github.com/lulualdn/fabro-ai/tree/main/examples/mods) :

- **daily-card** : une demande au-dessus du chat une fois par jour, et la commande `/idee`.
- **paper-chat** : le chat redessiné comme une page de carnet.
- **flashcards** : `/flashcards` transforme la conversation en cartes à réviser.

## Sécurité

Un mod a les droits de l’app. N’installe que des mods de confiance. Fabro affiche ce qu’un mod déclare avant de l’activer, tu peux le couper à tout moment (Réglages → Général), et si la fenêtre plante, Fabro redémarre **sans mods** jusqu’à ce que tu les réactives.

## Mods écrits pour l’ancienne interface

Les mods qui surchargent des fonctions de l’ancienne interface (`renderer.js` avec `window.fabro`, ou qui remplacent `renderMessage`, `openSettings`…) **ne tournent plus dans la nouvelle interface**. Ils marchent encore dans l’interface complète (Réglages → Avancé), le temps de migrer.

| Avant | Maintenant |
| --- | --- |
| `renderer.js` | `ui.js`, déclaré dans `"ui"` |
| `style.css` (`"styles"`) | `ui.css` (`"uiStyles"`) |
| remplacer une fonction d’affichage | `Fabro.chatView.replace` ou un emplacement `Fabro.slots` |
| `fabro.commands` / `/commande` | `Fabro.commands.add` |
| écouter le chat | `Fabro.on('send')`, `Fabro.on('done')` |
| `main.js` | inchangé |

Le guide de l’ancienne API reste dans [MODDING.md](https://github.com/lulualdn/fabro-ai/blob/main/MODDING.md).

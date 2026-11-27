# Mods

A mod adds or changes something in Fabro: a request above the chat, a command, a new look for the chat, a feature like flashcards. Fabro 1.0 gives mods **stable extension points**: a mod written for version 1 of the API keeps working when the interface changes.

## The folder

```
my-mod/
  mod.json      the mod's card
  ui.js         in Fabro's window (API v1)
  ui.css        optional
  main.js       optional: main process (Node + Electron)
```

```json
{
  "id": "my-mod",
  "name": "My mod",
  "version": "1.0.0",
  "description": "What it does, in one line.",
  "ui": ["ui.js"],
  "uiStyles": ["ui.css"],
  "permissions": ["show a card above the chat", "send a message to the AI"]
}
```

`permissions` says in plain words what the mod does. Fabro shows it before turning the mod on.

## The API (`Fabro`, version 1)

In `ui.js` you get `Fabro` (the API) and `mod` (your mod: `mod.id`, `mod.call(function, …)` to call its `main.js`).

| Extension point | What for |
| --- | --- |
| `Fabro.slots.add(slot, { id, render(el), order })` | Add an element to a slot: `above-chat`, `sidebar`, `composer`, `message`, `settings`. |
| `Fabro.ui.card({ id, title, sub, actions })` | A card above the chat, with buttons. `Fabro.ui.removeCard(id)` removes it. |
| `Fabro.commands.add({ name, title, run(args) })` | A command typed `/name` in the composer. It shows in the `/` menu. |
| `Fabro.chatView.replace({ css, message(node, html) })` | Change how the chat looks (theme, layout). `Fabro.chatView.reset()` goes back to Fabro's chat. |
| `Fabro.chat.send(text)`, `Fabro.chat.current()` | Send a message, read the open conversation. |
| `Fabro.on(event, fn)` | `ready`, `conv`, `send`, `done`, `theme`. Returns a function to unsubscribe. |
| `Fabro.ui.toast(text)` | A short message at the bottom. |

The AI can also show a card above the chat with the `show_card` tool.

## Examples

Three complete mods are in the repository, folder [`examples/mods`](https://github.com/lulualdn/fabro-ai/tree/main/examples/mods):

- **daily-card**: a request above the chat once a day, and the `/idee` command.
- **paper-chat**: the chat redrawn as a notebook page.
- **flashcards**: `/flashcards` turns the conversation into cards to review.

## Safety

A mod has the app's rights. Only install mods you trust. Fabro shows what a mod declares before turning it on, you can turn it off at any time (Settings → General), and if the window crashes, Fabro starts **without mods** until you turn them back on.

## Mods written for the previous interface

Mods that override functions of the previous interface (`renderer.js` with `window.fabro`, or replacing `renderMessage`, `openSettings`…) **no longer run in the new interface**. They still work in the full interface (Settings → Advanced) while you migrate.

| Before | Now |
| --- | --- |
| `renderer.js` | `ui.js`, listed in `"ui"` |
| `style.css` (`"styles"`) | `ui.css` (`"uiStyles"`) |
| replacing a display function | `Fabro.chatView.replace` or a `Fabro.slots` slot |
| `fabro.commands` / `/command` | `Fabro.commands.add` |
| listening to the chat | `Fabro.on('send')`, `Fabro.on('done')` |
| `main.js` | unchanged |

The previous API's guide stays in [MODDING.md](https://github.com/lulualdn/fabro-ai/blob/main/MODDING.md).

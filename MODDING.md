# Modding Fabro

A mod can change anything in Fabro: its screens, its commands, its history, and how it works inside.
Mods run with the same rights as the app itself, so only install mods you trust.

Install mods in **Settings › Mods**, either from a folder or from a `.zip`. You can also drop a folder
into the mods folder (**Mods folder** button), which is `<userData>/mods/<id>/`.
Built-in mods live in `src/mods/`.

## The folder

```
my-mod/
  mod.json
  main.js        optional: runs in the main process (Node + Electron)
  renderer.js    optional: runs in the app window
  quick.js       optional: runs in the quick bar
  style.css      optional: added to the app window
  icon.png       optional
```

```json
{
  "id": "my-mod",
  "name": "My mod",
  "version": "1.0.0",
  "author": "You",
  "description": "What it does, in one line.",
  "main": "main.js",
  "renderer": ["renderer.js"],
  "quick": ["quick.js"],
  "styles": ["style.css"],
  "icon": "icon.png",
  "commands": [{ "name": "hello", "description": "Say hello" }],
  "setup": false
}
```

* `id`: letters, digits, `.`, `_` or `-`.
* `renderer`, `quick` and `styles` take one file or a list of files, loaded in order.
* `commands` lists the `/commands` of the mod. The quick bar uses this list to send `/hello …` to the app.
* `setup: true`: when the mod is installed, Fabro sends it a `setup` event once the window has reloaded.
  The mod can use it to show a sign-in page, for example.

Turning a mod on or off reloads the app window.

## Main process (`main.js`)

```js
module.exports = {
  async activate(fabro) {
    fabro.handle('greet', async (name) => `Hello ${name}`);  // the window calls fabro.call('greet', 'Lulu')
    fabro.emit('ready', { at: Date.now() });                  // the window listens with fabro.on('ready', …)
  },
  async deactivate() {},
};
```

`fabro` in the main process gives you:

| | |
|---|---|
| `fabro.electron` | the whole Electron module |
| `fabro.core('engine')` | any internal Fabro module (`store`, `chat`, `engine`, `models`, `db`, `desktop`, `agent`…) |
| `fabro.mainWindow()`, `fabro.quickWindow()` | the windows |
| `fabro.handle(method, fn)` | a function the window can call |
| `fabro.emit(type, data)` | an event sent to the window and to the quick bar |
| `fabro.settings.get()` / `set(patch)` | the mod's own saved settings |
| `fabro.readJSON(file, def)` / `writeJSON(file, value)` | files in the mod's data folder (`fabro.dataDir`) |
| `fabro.web.*` | a website shown in the chat area, with its own saved sign-in (see below) |
| `fabro.onCleanup(fn)` | run when the mod is turned off |
| `fabro.log(...)` | logs, prefixed with the mod id |

### Websites in the chat area: `fabro.web`

Every mod has its own browser session (`persist:mod-<id>`). The sign-in is kept between launches.

* `ensure()`: create the view.
* `load(url)`: open a page in the view.
* `url()`: the address of the current page.
* `exec(js)`: run code in the page.
* `waitFor(js, timeout)`: wait until some page code returns true.
* `submit({ text, selector, mode })`: press Enter in the page's message box. With `mode: 'type'`, the text is typed first. With `'prefilled'`, the page already filled the box.
* `scrape({ url, ready, script })`: open a page in a hidden window and return what `script` returns.
* `cookies(filter)`, `clear()`: read the session's cookies, or sign out of everything.
* `contents()`: the page's raw Electron `webContents`.

## App window (`renderer.js`)

Your code runs inside a function that receives `fabro`. It can also use every global of the UI:
`S` (the state), `renderView`, `renderSidebar`, `openConv`, `sendPrompt`, `actions`, and the rest.

```js
// a command typed in the message box: "/hello world"
fabro.commands.register('/hello', { description: 'Say hello', run: (text) => fabro.toast('Hello ' + text) });

// replace any global function of the UI
fabro.override('renderTopbar', (orig) => function () { orig(); document.querySelector('#topbar').style.background = 'purple'; });

// a click handler for data-action="my-thing"
fabro.actions['my-thing'] = (el) => { /* … */ };

// chats from somewhere else, mixed into the history and sorted by time
fabro.history.register({
  list: () => [{ id: '1', title: 'From my mod', updatedAt: Date.now(), icon: 'data:image/svg+xml;…' }],
  open: (item) => { /* … */ },
});

// a website from main.js shown in the chat area
fabro.view.open({ title: 'My site', sidebar: 'hide' });   // 'keep' leaves the sidebar open
fabro.call('openSite');                                    // main.js: fabro.web.ensure(); fabro.web.load(url)
fabro.view.close();

// main-process functions and events
const r = await fabro.call('greet', 'Lulu');
fabro.on('ready', (data) => { /* … */ });

// hooks: 'loaded' (after every mod is loaded), 'web' (events from the embedded pages)
fabro.hook('loaded', () => {});
```

Helpers: `fabro.t(key)`, `fabro.toast(text, 'err')`, `fabro.icon(name, size)`, `fabro.esc(text)`, `fabro.md(markdown)`, `fabro.api` (the IPC bridge).

## Quick bar (`quick.js`)

Your code receives a smaller `fabro` (`fabro.api`, `fabro.call`).
`/commands` that a mod declares in `mod.json` work in the quick bar without any code: the main window opens and runs the command.

## Built-in examples

`src/mods/claude`, `src/mods/chatgpt` and `src/mods/gemini` each use the same small helper
(`src/mods/_shared/webchat-*.js`). Each mod is about 40 lines of settings: the site's addresses, how to tell
that you are signed in, how to start a chat from a prompt, and how to read your chat list.

## Links that open Fabro

These links work from a browser or from any app:

* `fabro://new?q=Your%20message` opens a new chat with the message already typed in.
  It is sent right away only if **Settings › Desktop › Send prompts from fabro:// links right away** is on.
* `fabro://new?q=/claude%20Your%20message` runs a mod command.
* `fabro://chat/<id>` opens one of your conversations.
* `fabro://settings/mods` opens a settings tab.

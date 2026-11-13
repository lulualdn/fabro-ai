# Local accounts (v0.2)

Up to 5 accounts on one computer, for a person or a family. No server, no e-mail. Accounts have nothing in common:
each has its own chats, memory, settings, keys and phones. Code: `src/main/accounts/`, `src/main/paths.js`,
UI `src/renderer/accounts-ui.js` + `accounts.html`, tests `scripts/accounts-test.js`, `scripts/accounts-e2e.js`.

## Layout on disk (`userData` = Electron's userData, e.g. `%APPDATA%\Fabro`)

```
userData/
  accounts.json          account list (id, name, icon, colour, password hash, wrapped data key, last opened…)
  machine.json           machine-wide settings (see below)
  accounts/<id>/         everything personal of one account  ← paths.dataDir()
  models/  engine/  deps/  voice/  crashes/  computer/  Partitions/   shared
```

## Shared vs per account

| Per account (`paths.dataDir()`) | Shared (`paths.sharedDir()`) |
|---|---|
| `settings.json` (+ `.bak`): everything except the machine keys | `machine.json`: `engine`, `modelProfiles`, `libraries`, `defaultLibrary`, `downloads`, `autoUpdate`, `firstModel` (store.js `SHARED_KEYS`, merged into `getSettings()`; `setSettings()` splits) |
| `fabro.db` (+ wal/shm): conversations, memory, artifacts, projects, RAG chunks | `engine/` (llama.cpp), `deps/` (Python, SearXNG, git, voice engine, stable-diffusion) |
| `conversations/` (old JSON), `projects/<id>/files`, `checkpoints/` (code mode) | `models/` model files, `models/index.json`, `models/downloads.json` (each download records its owner accounts) |
| `secrets.json` provider API keys | `models/images`, `voice/` (voice model files) |
| `anywhere.json` Anywhere identity, paired phones, keys | `computer/` helper binaries (Computer Use); screenshots are per account (`computer/shots`) |
| `tasks.json`, `usage.json` | `crashes/` (crash stacks, app-level) |
| `skills/`, `mods/` (user mods), `mod-data/` | `accounts.json`, `uninstall-paths.txt` |
| `webimg/`, `thumbs/`, `office/`, `kit-icons.json`, `kit-photos.json` | Chromium default session of the app window (HTTP cache, `localStorage` holds only `fabro.updSeen`) |
| `models.json`: the list of models this account uses | Window placement: none persisted today |
| MCP servers, agent folders + permissions, voice prefs, hotkey, local API, HF token: all in the account's settings | Updater (outside userData) |
| Electron partitions: `persist:a-<id>-mod-<mod>`, `persist:a-<id>-fabro-browser` (`paths.partition(name)`) | |
| Agent / image output folder: `~/Documents/Fabro - <Name>` (`paths.outputDir()`) | |

The account migrated from a pre-accounts install keeps the old partition names (`persist:mod-*`,
`persist:fabro-browser`) and the old output folder `~/Documents/Fabro`, so its saved web sign-ins and files stay.
Other accounts' output folders are siblings, never inside it.

Rule for new code: per-user data through `paths.dataDir()` / `inData()`, Electron partitions through
`paths.partition(name)`, never `app.getPath('userData')`.

## Migration of an existing install

`accounts/migrate.js`, run by `accounts.boot()` before anything else starts. The state is saved in `accounts.json`
at each step:

1. `copying`: the personal items (list `ITEMS`) are copied to `accounts/<id>/`, each one checked file by file
   (size + SHA-256). An interruption here redoes the copy from scratch; the old place is still the real one.
2. `switched`: the account list is written with account #1 → the account folder is now the real one.
   Machine keys of the old settings go to `machine.json`; every model in `models/index.json` goes in account #1's list.
3. Old copies are removed. A file Windows keeps locked is left and removed at the next start (an old copy is
   never removed if its account copy is missing).

If the copy or the check fails: `failed`, the half copy is removed, Fabro keeps running from the old place
(fallback, account features off, the UI shows a notice) and tries again at the next start. Nothing is deleted.

After the move, a `settings.json` re-appearing at the top (the Windows installer seeds one on reinstall) is absorbed:
its model disk / first model go to `machine.json`, the file is renamed `settings.json.absorbed`.

A single account without a password opens directly, like before: no picker, no extra click.

## Startup and switching

`accounts.boot()` decides: the account just switched to (if it has no password), the only account (if no password),
the last account when started hidden at login (if no password); otherwise the picker window (`accounts.html`).
Only after an account is open does main.js start the store, database, tasks, MCP, Anywhere, mods…

**Switching = controlled relaunch** (`app.relaunch()` + quit). Chosen over an in-process switch because a dozen
modules keep per-account state in memory (settings, SQLite handle, tasks timers, MCP connections, Anywhere
identity and peer window, mods and their web views, provider secrets cache, usage cache, agent browser). A relaunch
guarantees none of it leaks into the next account; the cost is a restart (the engine reloads its model).
Running generations stop with the process. If the target account has a password, the app restarts on the picker
with that account's password field. "Lock" restarts on the account list.

**Scheduled tasks** of an account run only while it is open. **Anywhere**: each account has its own identity and
paired phones; a phone only reaches its own account, and only while that account is open (otherwise it gets no
answer). From a phone, `accounts:*` calls are refused except `current`, `counts`, `models` (read only), and file
access is limited to the open account's folders.

## Password: what it is, and what it is not

- Stored: a salted scrypt hash (N=2^15, r=8, p=1), compared in constant time. 5 free tries, then waits of 30 s
  doubling up to 15 min; the counter is kept in `accounts.json`, so restarting Fabro does not reset it.
- It **locks the account inside Fabro** on a shared computer.
- Real protection, added when a password is set: a random 256-bit data key, stored only wrapped (AES-256-GCM)
  with a key derived from the password (scrypt). With it, these secrets are sealed (`vlt:`), on top of the OS
  protection (safeStorage): **provider API keys** (`secrets.json`) and **Anywhere's private keys and per-phone keys**
  (`anywhere.json`). Without the password they cannot be read, even by someone who copies the files.
  Changing the password re-wraps the data key only; removing it puts the secrets back under OS protection only.
- **Not covered**: conversations, memory, projects, settings (including the Hugging Face token, the local API key,
  MCP server configs and their tokens), files, and mods' saved web sign-ins (Chromium cookies, protected by the OS
  for the Windows user, not by the account password). Someone with full access to the Windows session can read them.
  The password is not disk encryption; the UI says so.
- Forgotten password: no recovery. From the picker, "Forgot the password?" deletes the account and its data after
  typing its name.

## Models

Model files are shared; each account lists the models it uses (`accounts/<id>/models.json`).
- A download is owned by the account(s) that started it; a model already on disk is added to my list at once.
- `Accounts.models()` → `{ mine: [{id,name,sizeBytes,sharedWith}], others: [{id,name,sizeBytes}] }` (others: name
  and size only, never whose).
- Link: added instantly, no download. Remove/unlink: the file is deleted only when no other account lists it;
  otherwise it just leaves my list and the UI says why no space was freed.
- Deleting an account deletes the models only it used (imported files: only their entry).

## Deleting an account

Own account (Settings → My account): type the name (+ password), Fabro restarts and deletes it before any account
opens. Forgotten password: from the picker. Removed: the account folder, its Electron partitions, models nobody
else uses. Kept: files in its `Documents` output folder. If it was the last account, a fresh one is made.

## APIs

Main: `require('./accounts')` → `boot`, `handoff(win)`, `pickerWindow()`, `isOpen()`, `current()`;
`paths.dataDir()`, `inData()`, `sharedDir()`, `accountId()`, `partition(name)`, `outputDir()`.
IPC `accounts:*` / preload `api.accounts.*`: `status, list, current, create, open, unlock, forget, quit` (picker),
`update, pickPicture, clearPicture, setPassword, switch, lock, delete, counts, models, linkModel, unlinkModel`;
event `accounts:event` (`modelKept`, `models`).
Renderer `window.Accounts`: `renderSection(container)` (self-contained "My account" block), `openCreate()`,
`openManager()`, `avatar(acc, size)`, `current()`, `list()`, `refresh()`, `switchTo(id)`, `lock()`,
`models()`, `linkModel(id)`, `unlinkModel(id)`.

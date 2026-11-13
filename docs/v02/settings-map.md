# Settings map (v0.1 tabs → v0.2 sections)

`src/renderer/settings-ui.js` owns the panel. Old deep links (`openSettings('engine')`…) still work: `ST_LEGACY`
sends them to the section that holds that content. `scripts/settings-e2e.js` renders every old page with the old
page functions and checks that each of its controls (88 today) exists in a new view.

| Old tab | Control | Now in |
|---|---|---|
| General | Name, language, theme, reduce motion, light mode | My account (What we call each other, Look) |
| General | Auto-update, version / check | Advanced › Updates |
| General | Developer mode, DevTools | Advanced › Developer |
| Generation | System prompt | My account › Your instructions |
| Generation | Temperature, Top P, max tokens | Advanced › Engine (Generation) |
| Generation | Personal prompts (`SysPrompts`) | Advanced › Prompts (with the AI notebook and guides) |
| Providers | Fabro Cloud, external providers, keys | My account › API keys and providers |
| Anywhere | Pairing, devices | My account › Fabro Anywhere |
| Models | Installed models, downloads, catalog, Hugging Face search | My models |
| Models | Default model | My models (top) |
| Storage | Libraries, import, download options, HF token | My models › Where models are stored |
| Engine | Engine status, energy mode, memory, per-model defaults | Advanced › Engine |
| Engine | Live monitor | Resources (live charts) |
| Engine | Local API | Advanced › Local API |
| Usage | Usage and costs | Resources › Usage and costs |
| Agent | Agent mode, folders, permissions, sub-agents | Advanced › Agent (+ Computer Use) |
| Agent | Python, search engine, browser, sandbox | Advanced › Skills & tools |
| Agent | MCP servers | Advanced › Connectors (easy add + advanced form) |
| Agent | Skills | Advanced › Skills & tools (import, export, list) |
| Shortcut | Hotkey, background, start at login, quit | Advanced › Shortcuts |
| Mods | Mods | Advanced › Mods |
| System | Specs, runtime isolation | Advanced › Developer |
| System | Crash reports | Advanced › Updates |
| About | About | Advanced › About |

New: My account › accounts block (picture, colour, password, delete), assistant's name, themes gallery; My models ›
other accounts' models, find a model, tiers; My Fabro (memory, profile with sources, story, unfinished work, skill
ideas); Resources (disk bar, RAM / VRAM / CPU charts, advice with one-click actions, limits presets); Advanced ›
Voice, Tasks.

Mounts (`[data-mount]`, kept across re-renders): accounts, themes, resources, myfabro, sysprompts, notebook, guides;
`mcpeasy` and `skillimport` are refilled by their modules after each render; `[data-mf]` by `ModelFinder.mount()`.
Other files test what is on screen with `stShows(leaf)` instead of `S.settingsTab === 'x'`.

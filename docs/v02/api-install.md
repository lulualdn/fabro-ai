# Skills and MCP: import and easy add (v0.2)

Two main-process modules, one renderer block each. Everything the user (or, in wave 3, the AI) installs goes
through a preview the user confirms. Nothing is executed at import.

## Skills — `src/main/skillimport.js`

Sources: a plain string (path, URL, or pasted SKILL.md text) or `{ type: 'file'|'folder'|'text'|'url'|'found', path|text|url|id }`.
Formats: `.skill` / `.zip` (one folder with `SKILL.md`, or several skills), folder, single `SKILL.md`, pasted text,
GitHub links (`/tree/…`, `/blob/…/SKILL.md`, raw links; `github.com/…` without `https://` is accepted).

| IPC (`api.skillimport.*`) | Returns |
|---|---|
| `preview(source)` | `{ ok, previewId, label, skills:[{ key, name, description, license, fileCount, bytes, files[], warnings[], notes[], tools:{ mapped[], unmapped[] }, collision }], skippedFiles[], errors[] }` or `{ ok:false, error, code }`. Staged in memory only (20 min, 8 max). |
| `install(previewId, { select, collision, enable })` | `{ ok, installed:[{ name, dir }] }`. Writes into the open account's skills folder. `collision[key]`: `keepBoth` (default) or `replace`. |
| `found()` | Skills of other tools on this computer (Claude Code `~/.claude/skills`, Claude Code plugins, `~/.agents`, Codex, `~/.fabro`). |
| `remove(name)` | Only skills installed in Fabro. |
| `discard(previewId)`, `pick('file'|'folder')`, `export(name)` (save dialog → `.skill`), `openFile(path)` | |

Limits (`LIMITS`, `ziplite.DEFAULTS`): archive size, file count, per-file and total unpacked size, zip-bomb ratio,
no absolute paths / `..` / links / encrypted entries / Zip64. Program files (`.exe`, `.dll`, …) are listed and not
installed; scripts are installed and flagged. Pasted text needs front matter, a `#` title, or a few lines
(`IMPORT_NOT_SKILL` otherwise).

Compatibility (`skillcompat.js`): Claude tool names in the skill (`Bash`, `Read`, `Write`, `Glob`, `WebFetch`, …) are
mapped to Fabro tools; the preview lists them, and when the agent loads the skill (`agent/skills.js`) a short note
and rewritten `/mnt/skills/…` paths are added to what it reads. The file on disk is not changed.

`.skill` files: `fileAssociations` in package.json, `second-instance` / `open-file` / argv → `skillimport:open` event →
preview dialog. Not tried on a real Windows/macOS install.

Renderer: `window.SkillsImport = { renderSection(el), openFile(path), openLink(), refreshFound() }`, mounted on
`[data-mount="skillimport"]`. Drop a `.skill` anywhere in the window, or anything on the drop zone.

## MCP — `src/main/mcpeasy.js`

| IPC (`api.mcpeasy.*`) | Returns |
|---|---|
| `parse(text)` | `{ ok, servers:[draft], errors[] }`. Accepts `mcpServers` JSON (Claude Desktop / Cursor / VS Code `servers`), a bare server object, Codex TOML, `npx` / `uvx` / `docker` / `node` lines, `claude mcp add …` (incl. `--transport`, `-e`, `--header`, `add-json`), `code --add-mcp`, a URL, a bare npm package. Drafts never carry secret values back to the renderer. |
| `catalog()` | Well-known servers (filesystem, fetch, memory, git, time, sequential-thinking, playwright, GitHub remote, Brave Search). |
| `prereq({ draftId })` | Node / uv / Docker / Python… found or how to install. |
| `test({ draftId, name, values })` | Real connection: `{ ok, tools[], count, auth?, cause, hint, stderr }` (stderr scrubbed of secrets). |
| `add({ draftId, name, values })` | `{ ok, server, servers }`. Secrets go to the secret store, not settings. |
| `found()` / `import(keys)` | Configs of Claude Desktop, Claude Code, Cursor, VS Code (+ Insiders), Codex, LM Studio, Windsurf, Gemini CLI (read-only); imports are added **off**. |
| `setTool(id, tool, on)` | Per-tool switch; an off tool is hidden from the agent. |

Renderer: `window.McpEasy = { renderSection(el), openAdd(tab) }`, mounted on `[data-mount="mcpeasy"]`.
The dialog shows the exact command or address, the prerequisites, a test; "Add" stays disabled until a test passes.

## Messages

Main-process messages are English. The renderer passes them through `installMsg()` (`i18n/install.js`), which
translates the known ones to French. A new message in either module needs a line there.

## Tests

`node scripts/skills-test.js`, `node scripts/mcpeasy-test.js`, and the screens:
`xvfb-run -a node scripts/install-e2e.js <shots>`.

## For wave 3 (AI-proposed installs)

An agent tool should call `preview` / `parse`, show a card with the same content (name, what runs, warnings), and only
call `install` / `test` + `add` after the user clicks. Never pass `enable` or `add` without that click.

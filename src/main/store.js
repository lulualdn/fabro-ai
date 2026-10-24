// Persistent settings + conversations (JSON files in userData).
const { app } = require('electron');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const DEFAULTS = {
  language: 'auto',            // 'auto' or a language code
  theme: 'system',             // system | light | dark
  sidebarCollapsed: false,
  selectedModel: null,         // { backend:'local', id } | { backend:'provider', provider, model }
  providers: { enabled: false, list: [] }, // external providers (OpenAI, Anthropic, Ollama, LM Studio…)
  hfToken: '',
  engine: { ctx: 8192, gpuLayers: -1, threads: 0, flashAttn: 'auto', kvType: 'f16', cpuMoe: 'auto', idleMinutes: 30, energy: 'auto', multiModel: true }, // gpuLayers -1 = auto
  modelProfiles: {},           // per-model overrides: ctx, gpuLayers, threads, kvType, preload, idleMinutes, gen…
  libraries: [], defaultLibrary: 'default',
  downloads: { maxConcurrent: 1, limitMBps: 0 },
  localApi: { enabled: false, port: 11500, key: '', lan: false },
  gen: { temperature: 0.7, topP: 0.95, maxTokens: 4096, systemPrompt: '', reasoning: 'auto' },
  autoUpdate: true,
  devMode: false,              // banner + devtools (opt-in since the public release)
  installedModes: ['chat'],
  closeToTray: true,           // the window's close button hides Fabro in the tray
  trayHintShown: false,
  hotkey: { enabled: true, accelerator: 'Control+Super+Space', copilotKey: true },
  quickTarget: 'current',      // quick bar: 'current' conversation or 'new'
  search: { engine: 'searxng', searxngUrl: '', duckyUrl: '', searxngDeclined: false, v2: true },   // web search tool (SearXNG by default)
  chatTools: { webSearch: true, fetch: true },     // tools allowed in chat mode
  memory: { enabled: true, auto: true },           // use / generate memories
  styles: [], activeStyle: 'default',              // response styles (built-in + learned)
  autoTitle: true,
  telemetry: { crashReports: false },             // nothing is sent; opt-in offers a GitHub report after a crash
  reduceMotion: false,
  agent: { enabled: true, folders: [], permissions: {}, disabledTools: [] },
  // Computer Use: the AI sees the screen and uses the mouse and keyboard (asked once per conversation)
  computer: { enabled: true, confirm: true, hideFabro: true, speed: 'natural', ocr: 'auto', width: 1280, overlay: true },
  mods: { enabled: { agents: true } },
  mcp: { servers: [] },
  skills: { disabled: [], extraDirs: [] },
};

const dir = () => app.getPath('userData');
const convDir = () => path.join(dir(), 'conversations');
const settingsFile = () => path.join(dir(), 'settings.json');
let settings = null;

function isObj(v) { return v && typeof v === 'object' && !Array.isArray(v); }
const ATOMIC = new Set(['selectedModel']); // replaced as a whole, never deep-merged
function merge(base, patch) {
  const out = { ...base };
  for (const k of Object.keys(patch || {})) {
    out[k] = !ATOMIC.has(k) && isObj(base[k]) && isObj(patch[k]) ? merge(base[k], patch[k]) : patch[k];
  }
  return out;
}

async function writeJSON(file, data) {
  const tmp = file + '.tmp';
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2));
  await fsp.rename(tmp, file);
}

function init() {
  fs.mkdirSync(convDir(), { recursive: true });
  // Settings survive updates: a copy is kept beside them and used if the file is missing or damaged.
  const bak = settingsFile() + '.bak';
  const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
  try { settings = merge(DEFAULTS, read(settingsFile())); try { fs.copyFileSync(settingsFile(), bak); } catch {} }
  catch { try { settings = merge(DEFAULTS, read(bak)); fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2)); } catch { settings = merge(DEFAULTS, {}); } }
  // Public release: developer mode is turned off once for everyone (it can be turned back on in Settings).
  if (!settings.devModeReleased) { settings.devMode = false; settings.devModeReleased = true; try { fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2)); } catch {} }
}

const getSettings = () => settings;
async function setSettings(patch) {
  settings = merge(settings, patch);
  await writeJSON(settingsFile(), settings);
  return settings;
}

const safeId = (id) => String(id).replace(/[^a-zA-Z0-9_-]/g, '');

async function listConversations() {
  const files = (await fsp.readdir(convDir())).filter((f) => f.endsWith('.json'));
  const out = [];
  for (const f of files) {
    try {
      const c = JSON.parse(await fsp.readFile(path.join(convDir(), f), 'utf8'));
      out.push({
        id: c.id, title: c.title, updatedAt: c.updatedAt, mode: c.mode || 'chat',
        pinned: !!c.pinned, agent: !!c.agent,
        hasArtifact: (c.messages || []).some((m) => m.role === 'assistant' && /```/.test(m.content || '')),
      });
    } catch { /* skip corrupt */ }
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}
async function getConversation(id) {
  return JSON.parse(await fsp.readFile(path.join(convDir(), safeId(id) + '.json'), 'utf8'));
}
async function saveConversation(c) {
  c.updatedAt = Date.now();
  await writeJSON(path.join(convDir(), safeId(c.id) + '.json'), c);
  return true;
}
async function patchConversation(id, patch) {
  const file = path.join(convDir(), safeId(id) + '.json');
  const c = JSON.parse(await fsp.readFile(file, 'utf8'));
  Object.assign(c, patch);
  await writeJSON(file, c);
  return true;
}
async function deleteConversation(id) {
  await fsp.rm(path.join(convDir(), safeId(id) + '.json'), { force: true });
  return true;
}

module.exports = { init, getSettings, setSettings, listConversations, getConversation, saveConversation, patchConversation, deleteConversation, writeJSON };

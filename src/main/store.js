// Persistent settings + conversations (JSON files in userData).
const { app } = require('electron');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const DEFAULTS = {
  language: 'auto',            // 'auto' or a language code
  theme: 'system',             // system | light | dark
  sidebarCollapsed: false,
  backend: 'local',            // local (built-in llama.cpp) | ollama
  selectedModel: null,         // { backend:'local', id } | { backend:'ollama', name }
  ollamaUrl: 'http://127.0.0.1:11434',
  hfToken: '',
  engine: { ctx: 8192, gpuLayers: -1, threads: 0 }, // -1 = auto (all on GPU)
  gen: { temperature: 0.7, topP: 0.95, maxTokens: 4096, systemPrompt: '' },
  autoUpdate: true,
  devMode: true,               // internal builds: banner + devtools
  installedModes: ['chat'],
};

const dir = () => app.getPath('userData');
const convDir = () => path.join(dir(), 'conversations');
const settingsFile = () => path.join(dir(), 'settings.json');
let settings = null;

function isObj(v) { return v && typeof v === 'object' && !Array.isArray(v); }
function merge(base, patch) {
  const out = { ...base };
  for (const k of Object.keys(patch || {})) {
    out[k] = isObj(base[k]) && isObj(patch[k]) ? merge(base[k], patch[k]) : patch[k];
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
  try { settings = merge(DEFAULTS, JSON.parse(fs.readFileSync(settingsFile(), 'utf8'))); }
  catch { settings = merge(DEFAULTS, {}); }
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

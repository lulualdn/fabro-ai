// External providers — everything that is NOT Fabro's built-in llama.cpp engine.
// Cloud APIs (OpenAI, Anthropic, xAI, Gemini, Mistral, …), local servers (Ollama,
// LM Studio) and any OpenAI-compatible endpoint. API keys live encrypted in
// secrets.json (OS keychain via safeStorage) and never reach the renderer.
const { app, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');
const store = require('./store');

// protocol: 'openai' (Chat Completions + /models) | 'anthropic' (Messages API)
const PRESETS = {
  ollama:     { name: 'Ollama',        protocol: 'openai', baseUrl: 'http://127.0.0.1:11434/v1', local: true, keyless: true, site: 'https://ollama.com' },
  lmstudio:   { name: 'LM Studio',     protocol: 'openai', baseUrl: 'http://127.0.0.1:1234/v1', local: true, keyless: true, site: 'https://lmstudio.ai' },
  openai:     { name: 'OpenAI',        protocol: 'openai', baseUrl: 'https://api.openai.com/v1', keyUrl: 'https://platform.openai.com/api-keys' },
  anthropic:  { name: 'Anthropic',     protocol: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', keyUrl: 'https://console.anthropic.com/settings/keys' },
  xai:        { name: 'xAI · Grok',    protocol: 'openai', baseUrl: 'https://api.x.ai/v1', keyUrl: 'https://console.x.ai' },
  google:     { name: 'Google Gemini', protocol: 'openai', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', keyUrl: 'https://aistudio.google.com/apikey' },
  mistral:    { name: 'Mistral',       protocol: 'openai', baseUrl: 'https://api.mistral.ai/v1', keyUrl: 'https://console.mistral.ai/api-keys' },
  deepseek:   { name: 'DeepSeek',      protocol: 'openai', baseUrl: 'https://api.deepseek.com/v1', keyUrl: 'https://platform.deepseek.com/api_keys' },
  groq:       { name: 'Groq',          protocol: 'openai', baseUrl: 'https://api.groq.com/openai/v1', keyUrl: 'https://console.groq.com/keys' },
  openrouter: { name: 'OpenRouter',    protocol: 'openai', baseUrl: 'https://openrouter.ai/api/v1', keyUrl: 'https://openrouter.ai/keys' },
  together:   { name: 'Together AI',   protocol: 'openai', baseUrl: 'https://api.together.xyz/v1', keyUrl: 'https://api.together.ai/settings/api-keys' },
  cerebras:   { name: 'Cerebras',      protocol: 'openai', baseUrl: 'https://api.cerebras.ai/v1', keyUrl: 'https://cloud.cerebras.ai' },
  perplexity: { name: 'Perplexity',    protocol: 'openai', baseUrl: 'https://api.perplexity.ai', keyUrl: 'https://www.perplexity.ai/settings/api', fixedModels: ['sonar', 'sonar-pro', 'sonar-reasoning', 'sonar-reasoning-pro'] },
  custom:     { name: 'OpenAI-compatible', protocol: 'openai', baseUrl: '', custom: true },
};

// ───────────────────────────── secrets ─────────────────────────────
const secretsFile = () => path.join(app.getPath('userData'), 'secrets.json');
let secrets = null;
function loadSecrets() {
  if (secrets) return secrets;
  try { secrets = JSON.parse(fs.readFileSync(secretsFile(), 'utf8')); } catch { secrets = {}; }
  return secrets;
}
function saveSecrets() {
  const f = secretsFile();
  fs.writeFileSync(f + '.tmp', JSON.stringify(secrets, null, 2), { mode: 0o600 });
  fs.renameSync(f + '.tmp', f);
}
function setKey(id, key) {
  loadSecrets();
  if (!key) delete secrets[id];
  else if (safeStorage.isEncryptionAvailable()) secrets[id] = 'enc:' + safeStorage.encryptString(key).toString('base64');
  else secrets[id] = 'plain:' + Buffer.from(key).toString('base64');
  saveSecrets();
}
function getKey(id) {
  const v = loadSecrets()[id];
  if (!v) return '';
  try {
    if (v.startsWith('enc:')) return safeStorage.decryptString(Buffer.from(v.slice(4), 'base64'));
    if (v.startsWith('plain:')) return Buffer.from(v.slice(6), 'base64').toString();
  } catch { /* keychain changed */ }
  return '';
}

// ───────────────────────────── config ─────────────────────────────
const cfg = () => store.getSettings().providers || { enabled: false, list: [] };
const list = () => cfg().list || [];
const get = (id) => list().find((p) => p.id === id) || null;
async function saveList(next, extra = {}) { await store.setSettings({ providers: { ...cfg(), ...extra, list: next } }); }

function view() {
  return {
    enabled: !!cfg().enabled,
    presets: Object.entries(PRESETS).map(([kind, p]) => ({ kind, ...p })),
    list: list().map((p) => ({ ...p, hasKey: !!getKey(p.id), keyHint: maskKey(getKey(p.id)) })),
  };
}
function maskKey(k) { return k ? `${k.slice(0, 4)}…${k.slice(-4)}` : ''; }

// ───────────────────────────── HTTP helpers ─────────────────────────────
function headersFor(p, key = getKey(p.id)) {
  const preset = PRESETS[p.kind] || PRESETS.custom;
  if (preset.protocol === 'anthropic') {
    return { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' };
  }
  const h = { 'Content-Type': 'application/json' };
  if (key) h.Authorization = `Bearer ${key}`;
  if (p.kind === 'openrouter') { h['HTTP-Referer'] = 'https://fabro.eu'; h['X-Title'] = 'Fabro'; }
  return h;
}
const trimBase = (u) => String(u || '').trim().replace(/\/+$/, '');

class ProviderError extends Error {
  constructor(code, message, detail) { super(message); this.code = code; this.detail = detail || ''; }
}
async function httpErr(res, p) {
  let body = ''; try { body = await res.text(); } catch {}
  let msg = `HTTP ${res.status}`;
  try { const j = JSON.parse(body); msg = (j.error && (j.error.message || j.error)) || j.message || msg; } catch {}
  const code = res.status === 401 || res.status === 403 ? 'PROVIDER_AUTH' : res.status === 429 ? 'PROVIDER_RATE' : res.status === 404 ? 'PROVIDER_MODEL' : 'PROVIDER_HTTP';
  return new ProviderError(code, `${p.name}: ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`, body.slice(0, 1500));
}
function netErr(e, p) {
  if (e.name === 'AbortError' || e.name === 'TimeoutError') return new ProviderError('PROVIDER_DOWN', `${p.name}: timeout`, String(e.message));
  return new ProviderError(PRESETS[p.kind]?.local ? 'PROVIDER_DOWN' : 'NETWORK', `${p.name}: ${e.cause?.code || e.message}`, String(e.cause || e.message));
}

// ───────────────────────────── model listing ─────────────────────────────
const NON_CHAT = /(embed|whisper|tts|dall-?e|moderation|transcribe|realtime|audio|image-|imagen|veo|rerank|guard|search-preview|computer-use|^babbage|^davinci|-instruct$)/i;
const VISION = /(gpt-4o|gpt-4\.1|gpt-5|o3|o4|claude|gemini|grok-[234]|vision|llava|pixtral|gemma-?3|gemma-?4|qwen.*vl|qwen3\.5|mistral-(small|medium)|llama-4|minicpm)/i;

async function fetchModels(p, key) {
  const preset = PRESETS[p.kind] || PRESETS.custom;
  const base = trimBase(p.baseUrl);
  if (preset.fixedModels) return preset.fixedModels.map((id) => ({ id, name: id }));
  const sig = AbortSignal.timeout(preset.local ? 2500 : 12000);
  try {
    if (p.kind === 'ollama') {
      const r = await fetch(base.replace(/\/v1$/, '') + '/api/tags', { signal: sig });
      if (!r.ok) throw await httpErr(r, p);
      const j = await r.json();
      return (j.models || []).filter((m) => !/embed/i.test(m.name)).map((m) => ({
        id: m.name, name: m.name, size: m.size,
        params: m.details && m.details.parameter_size, quant: m.details && m.details.quantization_level,
        vision: VISION.test(m.name) || (m.details?.families || []).includes('clip'),
      }));
    }
    if (p.kind === 'lmstudio') {
      // Native API knows the model type; fall back to /v1/models on older builds.
      try {
        const r = await fetch(base.replace(/\/v1$/, '') + '/api/v0/models', { signal: sig });
        if (r.ok) {
          const j = await r.json();
          return (j.data || []).filter((m) => m.type !== 'embeddings').map((m) => ({
            id: m.id, name: m.id, vision: m.type === 'vlm', quant: m.quantization, ctx: m.max_context_length, loaded: m.state === 'loaded',
          }));
        }
      } catch (e) { if (e instanceof ProviderError) throw e; }
    }
    const url = preset.protocol === 'anthropic' ? `${base}/models?limit=100` : `${base}/models`;
    const r = await fetch(url, { headers: headersFor(p, key), signal: sig });
    if (!r.ok) throw await httpErr(r, p);
    const j = await r.json();
    const data = j.data || j.models || [];
    return data
      .map((m) => ({ id: String(m.id || m.name || '').replace(/^models\//, ''), name: m.display_name || m.name || m.id, ctx: m.context_length || m.context_window }))
      .filter((m) => m.id && !NON_CHAT.test(m.id))
      .map((m) => ({ ...m, name: String(m.name).replace(/^models\//, ''), vision: VISION.test(m.id) }))
      .sort((a, b) => a.id.localeCompare(b.id));
  } catch (e) {
    if (e instanceof ProviderError) throw e;
    throw netErr(e, p);
  }
}

// One-click local servers: is Ollama / LM Studio running right now?
async function detect() {
  const probe = async (kind) => {
    const p = { id: kind, kind, ...PRESETS[kind] };
    try { const models = await fetchModels(p); return { running: true, models: models.length }; }
    catch { return { running: false, models: 0 }; }
  };
  const [ollama, lmstudio] = await Promise.all([probe('ollama'), probe('lmstudio')]);
  return { ollama, lmstudio };
}

// ───────────────────────────── CRUD ─────────────────────────────
function newId(kind) {
  if (!get(kind)) return kind;
  let i = 2; while (get(`${kind}-${i}`)) i++; return `${kind}-${i}`;
}

// add({kind, apiKey?, baseUrl?, name?}) → validates by listing models first.
async function add({ kind, apiKey = '', baseUrl = '', name = '' }) {
  const preset = PRESETS[kind];
  if (!preset) throw new ProviderError('PROVIDER_HTTP', `Unknown provider: ${kind}`);
  const base = trimBase(baseUrl || preset.baseUrl);
  if (!base) throw new ProviderError('PROVIDER_URL', 'Base URL required');
  if (!preset.keyless && !preset.custom && !apiKey) throw new ProviderError('PROVIDER_AUTH', 'API key required');
  const p = { id: newId(kind), kind, name: name || preset.name, baseUrl: base, enabled: true };
  const models = await fetchModels(p, apiKey.trim());
  p.models = models; p.updatedAt = Date.now();
  if (apiKey) setKey(p.id, apiKey.trim());
  await saveList([...list(), p], { enabled: true });
  return view();
}

async function update(id, patch) {
  const p = get(id); if (!p) return view();
  const next = { ...p };
  for (const k of ['name', 'baseUrl', 'enabled']) if (k in patch) next[k] = k === 'baseUrl' ? trimBase(patch[k]) : patch[k];
  if ('apiKey' in patch) setKey(id, String(patch.apiKey || '').trim());
  if ('baseUrl' in patch || 'apiKey' in patch) { next.models = await fetchModels(next); next.updatedAt = Date.now(); }
  await saveList(list().map((x) => (x.id === id ? next : x)));
  return view();
}

async function remove(id) {
  setKey(id, '');
  await saveList(list().filter((p) => p.id !== id));
  const sel = store.getSettings().selectedModel;
  if (sel && sel.backend === 'provider' && sel.provider === id) await store.setSettings({ selectedModel: null });
  return view();
}

async function refresh(id) {
  const targets = id ? [get(id)].filter(Boolean) : list().filter((p) => p.enabled);
  const errors = {};
  const next = await Promise.all(list().map(async (p) => {
    if (!targets.includes(p)) return p;
    try { return { ...p, models: await fetchModels(p), updatedAt: Date.now(), error: undefined }; }
    catch (e) { errors[p.id] = e.message; return { ...p, error: e.code || 'PROVIDER_HTTP' }; }
  }));
  await saveList(next);
  return { ...view(), errors };
}

async function setEnabled(on) { await store.setSettings({ providers: { ...cfg(), enabled: !!on } }); return view(); }

// Models exposed in pickers: only when the feature is on and the provider is enabled.
function chatModels() {
  if (!cfg().enabled) return [];
  return list().filter((p) => p.enabled).flatMap((p) => (p.models || []).map((m) => ({
    ref: { backend: 'provider', provider: p.id, model: m.id },
    label: m.name || m.id, provider: p.id, providerName: p.name, kind: p.kind, local: !!PRESETS[p.kind]?.local,
    vision: !!m.vision, params: m.params, quant: m.quant, size: m.size, ctx: m.ctx,
  })));
}

// Resolve a chat target for chat.js.
function target(ref) {
  const p = get(ref.provider);
  if (!p) throw new ProviderError('NO_MODEL', 'Provider removed');
  if (!cfg().enabled || !p.enabled) throw new ProviderError('PROVIDER_OFF', `${p.name} is disabled`);
  const preset = PRESETS[p.kind] || PRESETS.custom;
  const m = (p.models || []).find((x) => x.id === ref.model) || { id: ref.model };
  return { provider: p, preset, protocol: preset.protocol, base: trimBase(p.baseUrl), headers: headersFor(p), model: ref.model, info: m, netErr: (e) => netErr(e, p), httpErr: (r) => httpErr(r, p) };
}

// Settings migration from ≤0.1.4 (Ollama lived next to the built-in engine).
async function migrate() {
  const s = store.getSettings();
  const patch = {};
  let lst = list();
  const legacy = s.selectedModel && s.selectedModel.backend === 'ollama';
  if (legacy && !lst.some((p) => p.kind === 'ollama')) {
    const base = trimBase(s.ollamaUrl || 'http://127.0.0.1:11434').replace(/\/v1$/, '') + '/v1';
    lst = [...lst, { id: 'ollama', kind: 'ollama', name: 'Ollama', baseUrl: base, enabled: true, models: [] }];
    patch.providers = { ...cfg(), enabled: true, list: lst };
  }
  if (legacy) patch.selectedModel = { backend: 'provider', provider: lst.find((p) => p.kind === 'ollama').id, model: s.selectedModel.name };
  if (Object.keys(patch).length) await store.setSettings(patch);
  if (cfg().enabled && lst.length) refresh().catch(() => {});
}

module.exports = { setSecret: setKey, PRESETS, view, detect, add, update, remove, refresh, setEnabled, chatModels, target, migrate, ProviderError, getKey };

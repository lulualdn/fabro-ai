// MCP client: local servers (stdio) and remote servers (Streamable HTTP, with OAuth).
// Each server's tools are registered as agent tools named mcp__<server>__<tool>.
const { app, shell } = require('electron');
const { spawn } = require('child_process');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');
const store = require('../store');
const agent = require('./index');
const providers = require('../providers'); // secret store (encrypted)

const PROTOCOL = '2025-06-18';
const servers = new Map(); // id → { cfg, status, error, tools, client, log }
let emit = () => {};
const publish = () => emit('mcp:status', view());

const cfgs = () => (store.getSettings().mcp || {}).servers || [];
const clean = (s) => String(s).replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');

// ───────────────────────────── transports ─────────────────────────────
class StdioClient {
  constructor(cfg, onLog) {
    this.cfg = cfg; this.onLog = onLog; this.id = 0; this.pending = new Map(); this.buf = '';
  }
  start() {
    const win = process.platform === 'win32';
    const env = { ...process.env, ...(this.cfg.env || {}) };
    this.p = spawn(this.cfg.command, this.cfg.args || [], { env, cwd: this.cfg.cwd || os.homedir(), shell: win, windowsHide: true });
    this.p.stdout.on('data', (d) => {
      this.buf += d;
      let i;
      while ((i = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, i).trim(); this.buf = this.buf.slice(i + 1);
        if (!line) continue;
        let msg; try { msg = JSON.parse(line); } catch { this.onLog(line); continue; }
        if (msg.id != null && this.pending.has(msg.id)) { const { resolve, reject } = this.pending.get(msg.id); this.pending.delete(msg.id); msg.error ? reject(Object.assign(new Error(msg.error.message || 'MCP error'), { code: msg.error.code })) : resolve(msg.result); }
        else if (msg.method && msg.id != null) this.write({ jsonrpc: '2.0', id: msg.id, result: {} }); // pings / roots requests
      }
    });
    this.p.stderr.on('data', (d) => this.onLog(String(d)));
    this.exited = new Promise((r) => this.p.on('exit', (c) => { for (const { reject } of this.pending.values()) reject(new Error(`Server exited (${c})`)); this.pending.clear(); r(c); }));
    this.p.on('error', (e) => { this.onLog(String(e.message)); for (const { reject } of this.pending.values()) reject(e); this.pending.clear(); });
  }
  write(obj) { try { this.p.stdin.write(JSON.stringify(obj) + '\n'); } catch {} }
  request(method, params, timeout = 60000) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method} timed out`)); }, timeout);
      this.pending.set(id, { resolve: (v) => { clearTimeout(t); resolve(v); }, reject: (e) => { clearTimeout(t); reject(e); } });
      this.write({ jsonrpc: '2.0', id, method, params });
    });
  }
  notify(method, params) { this.write({ jsonrpc: '2.0', method, params }); }
  close() { try { this.p.kill(); } catch {} }
}

class HttpClient {
  constructor(cfg, onLog) { this.cfg = cfg; this.onLog = onLog; this.id = 0; this.session = null; }
  start() {}
  async headers() {
    const h = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': PROTOCOL, ...(this.cfg.headers || {}) };
    const tok = loadToken(this.cfg.id);
    if (tok && tok.access_token) h.Authorization = `Bearer ${tok.access_token}`;
    if (this.session) h['Mcp-Session-Id'] = this.session;
    return h;
  }
  async post(body, retried = false) {
    const res = await fetch(this.cfg.url, { method: 'POST', headers: await this.headers(), body: JSON.stringify(body), signal: AbortSignal.timeout(90000) });
    if (res.status === 401 && !retried) {
      const tok = loadToken(this.cfg.id);
      if (tok && tok.refresh_token && await refresh(this.cfg, tok)) return this.post(body, true);
      throw Object.assign(new Error('Authorization required'), { code: 'MCP_AUTH', www: res.headers.get('www-authenticate') || '' });
    }
    const sid = res.headers.get('mcp-session-id'); if (sid) this.session = sid;
    if (res.status === 202) return null;
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const type = res.headers.get('content-type') || '';
    if (type.includes('text/event-stream')) {
      const text = await res.text();
      const datas = text.split('\n').filter((l) => l.startsWith('data:')).map((l) => { try { return JSON.parse(l.slice(5).trim()); } catch { return null; } }).filter(Boolean);
      return datas.find((d) => d.id === body.id) || datas[datas.length - 1] || null;
    }
    return res.json();
  }
  async request(method, params) {
    const id = ++this.id;
    const r = await this.post({ jsonrpc: '2.0', id, method, params });
    if (!r) return null;
    if (r.error) throw Object.assign(new Error(r.error.message || 'MCP error'), { code: r.error.code });
    return r.result;
  }
  notify(method, params) { this.post({ jsonrpc: '2.0', method, params }).catch(() => {}); }
  close() { if (this.session) fetch(this.cfg.url, { method: 'DELETE', headers: { 'Mcp-Session-Id': this.session } }).catch(() => {}); }
}

// ───────────────────────────── OAuth (remote servers) ─────────────────────────────
const tokenKey = (id) => `mcp:${id}`;
function loadToken(id) { try { return JSON.parse(providers.getKey(tokenKey(id)) || 'null'); } catch { return null; } }
function saveToken(id, tok) { providers.setSecret(tokenKey(id), tok ? JSON.stringify(tok) : ''); }
async function discover(cfg, www) {
  const base = new URL(cfg.url);
  let asUrl = null;
  const rm = /resource_metadata="([^"]+)"/.exec(www || '');
  for (const u of [rm && rm[1], `${base.origin}/.well-known/oauth-protected-resource${base.pathname}`, `${base.origin}/.well-known/oauth-protected-resource`].filter(Boolean)) {
    try { const r = await fetch(u); if (r.ok) { const j = await r.json(); if (j.authorization_servers && j.authorization_servers[0]) { asUrl = j.authorization_servers[0]; break; } } } catch {}
  }
  asUrl = asUrl || base.origin;
  for (const u of [`${asUrl.replace(/\/$/, '')}/.well-known/oauth-authorization-server`, `${asUrl.replace(/\/$/, '')}/.well-known/openid-configuration`]) {
    try { const r = await fetch(u); if (r.ok) return r.json(); } catch {}
  }
  return { authorization_endpoint: `${base.origin}/authorize`, token_endpoint: `${base.origin}/token`, registration_endpoint: `${base.origin}/register` };
}
async function authorize(cfg, www) {
  const meta = await discover(cfg, www);
  const server = http.createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const redirect = `http://127.0.0.1:${server.address().port}/callback`;
  try {
    let clientId = cfg.clientId;
    if (!clientId && meta.registration_endpoint) {
      const reg = await (await fetch(meta.registration_endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_name: 'Fabro', redirect_uris: [redirect], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' }) })).json();
      clientId = reg.client_id;
    }
    if (!clientId) throw new Error('This server needs a client id (dynamic registration is not supported)');
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    const st = crypto.randomBytes(12).toString('hex');
    const u = new URL(meta.authorization_endpoint);
    Object.entries({ response_type: 'code', client_id: clientId, redirect_uri: redirect, code_challenge: challenge, code_challenge_method: 'S256', state: st, resource: cfg.url, ...(cfg.scope ? { scope: cfg.scope } : {}) }).forEach(([k, v]) => u.searchParams.set(k, v));
    const code = await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('Sign-in timed out')), 5 * 60000);
      server.on('request', (req, res) => {
        const q = new URL(req.url, redirect).searchParams;
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<!doctype html><meta charset="utf-8"><body style="font:16px system-ui;display:grid;place-items:center;height:100vh;background:#12161d;color:#f3f1ee"><div>✅ Fabro est connecté. Vous pouvez fermer cet onglet.</div></body>');
        clearTimeout(t);
        if (q.get('state') !== st) reject(new Error('OAuth state mismatch')); else if (q.get('error')) reject(new Error(q.get('error'))); else resolve(q.get('code'));
      });
      shell.openExternal(u.toString());
    });
    const tok = await (await fetch(meta.token_endpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirect, client_id: clientId, code_verifier: verifier, resource: cfg.url }) })).json();
    if (!tok.access_token) throw new Error(tok.error_description || tok.error || 'No access token');
    saveToken(cfg.id, { ...tok, client_id: clientId, token_endpoint: meta.token_endpoint, at: Date.now() });
    return true;
  } finally { server.close(); }
}
async function refresh(cfg, tok) {
  try {
    const r = await (await fetch(tok.token_endpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tok.refresh_token, client_id: tok.client_id, resource: cfg.url }) })).json();
    if (!r.access_token) return false;
    saveToken(cfg.id, { ...tok, ...r, at: Date.now() }); return true;
  } catch { return false; }
}

// ───────────────────────────── lifecycle ─────────────────────────────
async function connect(cfg) {
  disconnect(cfg.id);
  const s = { cfg, status: 'connecting', error: null, tools: [], log: [] };
  servers.set(cfg.id, s); publish();
  const log = (l) => { s.log.push(...String(l).split('\n').filter(Boolean)); s.log = s.log.slice(-80); };
  const client = cfg.type === 'http' ? new HttpClient(cfg, log) : new StdioClient(cfg, log);
  s.client = client;
  try {
    client.start();
    await client.request('initialize', { protocolVersion: PROTOCOL, capabilities: { roots: { listChanged: false } }, clientInfo: { name: 'Fabro', version: app.getVersion() } });
    client.notify('notifications/initialized', {});
    let tools = [], cursor;
    do { const r = await client.request('tools/list', cursor ? { cursor } : {}); tools = tools.concat((r && r.tools) || []); cursor = r && r.nextCursor; } while (cursor && tools.length < 500);
    s.tools = tools; s.status = 'ready';
    registerTools(cfg, tools, client);
  } catch (e) {
    s.status = e.code === 'MCP_AUTH' ? 'auth' : 'error'; s.error = e.message; s.www = e.www;
    try { client.close(); } catch {}
  }
  publish();
  return view();
}
function registerTools(cfg, tools, client) {
  const sid = clean(cfg.name || cfg.id).slice(0, 20) || 'srv';
  agent.unregisterWhere((t) => t.category === `mcp:${cfg.id}`);
  for (const t of tools) {
    const ann = t.annotations || {};
    agent.register({
      name: `mcp__${sid}__${clean(t.name)}`.slice(0, 64), category: `mcp:${cfg.id}`, untrusted: true,
      risk: ann.readOnlyHint ? 'read' : ann.destructiveHint ? 'danger' : 'write',
      description: `[${cfg.name}] ${(t.description || t.title || t.name).slice(0, 900)}`,
      parameters: t.inputSchema && t.inputSchema.type ? t.inputSchema : { type: 'object', properties: {} },
      keywords: [String(cfg.name || '').toLowerCase(), ...String(t.name).toLowerCase().split(/[_\-.]/).filter((w) => w.length > 3)],
      summarize: (a) => `${cfg.name} · ${t.name} ${JSON.stringify(a).slice(0, 200)}`,
      async run(a) {
        const r = await client.request('tools/call', { name: t.name, arguments: a || {} }, 180000);
        const parts = (r && r.content) || [];
        const text = parts.filter((p) => p.type === 'text').map((p) => p.text).join('\n') || (r && r.structuredContent ? JSON.stringify(r.structuredContent, null, 1) : '');
        const img = parts.find((p) => p.type === 'image');
        return { content: (r && r.isError ? 'Error: ' : '') + (text || '(no output)').slice(0, 20000), image: img ? `data:${img.mimeType};base64,${img.data}` : undefined, view: { kind: 'mcp', server: cfg.name, tool: t.name, error: !!(r && r.isError) } };
      },
    });
  }
}
function disconnect(id) {
  const s = servers.get(id);
  if (s && s.client) try { s.client.close(); } catch {}
  servers.delete(id);
  agent.unregisterWhere((t) => t.category === `mcp:${id}`);
}
function view() {
  return cfgs().map((c) => { const s = servers.get(c.id) || {}; return { ...c, env: c.env ? Object.keys(c.env) : [], status: c.enabled === false ? 'off' : s.status || 'idle', error: s.error || null, tools: (s.tools || []).map((t) => ({ name: t.name, description: (t.description || '').slice(0, 160) })), log: (s.log || []).slice(-20) }; });
}
async function startAll() { for (const c of cfgs()) if (c.enabled !== false) connect(c).catch(() => {}); }

async function save(list) { await store.setSettings({ mcp: { servers: list } }); }
async function add(cfg) {
  const id = clean(cfg.name || 'server').toLowerCase().slice(0, 24) + '-' + Date.now().toString(36).slice(-4);
  const entry = { id, name: cfg.name || id, type: cfg.url ? 'http' : 'stdio', command: cfg.command, args: cfg.args || [], env: cfg.env || {}, url: cfg.url, headers: cfg.headers, enabled: true };
  await save([...cfgs(), entry]);
  await connect(entry);
  return view();
}
async function remove(id) { disconnect(id); saveToken(id, null); await save(cfgs().filter((c) => c.id !== id)); publish(); return view(); }
async function toggle(id, on) {
  await save(cfgs().map((c) => (c.id === id ? { ...c, enabled: on } : c)));
  if (on) await connect(cfgs().find((c) => c.id === id)); else { disconnect(id); publish(); }
  return view();
}
async function signIn(id) { const c = cfgs().find((x) => x.id === id); const s = servers.get(id); await authorize(c, s && s.www); return connect(c); }

// Import from Claude Desktop's config file.
function claudeConfigPath() {
  if (process.platform === 'win32') return path.join(process.env.APPDATA || '', 'Claude', 'claude_desktop_config.json');
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  return path.join(os.homedir(), '.config', 'Claude', 'claude_desktop_config.json');
}
function readClaudeConfig() {
  const p = claudeConfigPath();
  if (!fs.existsSync(p)) return { path: p, servers: [] };
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  const have = new Set(cfgs().map((c) => c.name));
  return { path: p, servers: Object.entries(j.mcpServers || {}).map(([name, v]) => ({ name, command: v.command, args: v.args || [], env: v.env || {}, url: v.url, type: v.url ? 'http' : 'stdio', already: have.has(name) })) };
}
async function importClaude(names) {
  const { servers: list } = readClaudeConfig();
  for (const s of list.filter((x) => names.includes(x.name) && !x.already)) await add(s);
  return view();
}

function init(emitter) { emit = emitter; startAll(); }
function stopAll() { for (const id of servers.keys()) disconnect(id); }

module.exports = { init, view, add, remove, toggle, signIn, connect, readClaudeConfig, importClaude, stopAll };

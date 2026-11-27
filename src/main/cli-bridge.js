// The bridge between `fabro code` in a terminal (src/cli/fabro.js) and the running app: same engine, same
// conversations (they show in the app as Fabro Code sessions), same permissions (the terminal answers the
// questions the app would ask). A local HTTP server on 127.0.0.1 with a random port and token, written to
// <userData>/cli.json (readable only by this user). Nothing listens on the network.
//
// It also makes the `fabro` command available: a small script next to the app that runs Fabro's own executable
// as Node (ELECTRON_RUN_AS_NODE, like VS Code's `code`), added to the user's PATH on Windows; ~/.local/bin on
// macOS and Linux.
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { app } = require('electron');

let server = null; let token = '';
const runs = new Map(); // reqId → { res, conv, asst }
const infoFile = () => path.join(app.getPath('userData'), 'cli.json');

async function modelOf() {
  const store = require('./store'); const sel = store.getSettings().selectedModel; if (!sel) return null;
  const refKey = (r) => !r ? '' : r.backend === 'provider' ? `p:${r.provider}:${r.model}` : r.backend === 'local' ? `l:${r.id}` : `${r.backend}:${r.id || r.name}`;
  let inst = { local: [] }; try { inst = (await require('./models').installed()) || inst; } catch {}
  let prov = []; try { prov = (await require('./providers').chatModels()) || []; } catch {}
  const all = [...inst.local.filter((m) => !m.role).map((m) => ({ ref: { backend: 'local', id: m.id }, label: m.name })), ...prov.map((m) => ({ ref: m.ref, label: m.label }))];
  return all.find((m) => refKey(m.ref) === refKey(sel)) || null;
}
function messagesOf(conv) {
  const A = require('../anywhere/core.js');
  const out = [{ role: 'system', content: '' }];
  for (const n of A.pathOf(conv)) { if (n.pending || (n.role === 'assistant' && n.error && !n.content)) continue; out.push({ role: n.role === 'assistant' ? 'assistant' : 'user', content: n.content || '' }); }
  return out;
}
const uid = () => crypto.randomBytes(6).toString('hex');
const json = (res, code, o) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
const body = (req) => new Promise((ok) => { let s = ''; req.on('data', (c) => { s += c; if (s.length > 2e6) req.destroy(); }); req.on('end', () => { try { ok(JSON.parse(s || '{}')); } catch { ok({}); } }); });

async function handle(req, res) {
  if (req.headers['x-fabro-token'] !== token) return json(res, 403, { error: 'forbidden' });
  const url = new URL(req.url, 'http://x'); const store = require('./store'); const chat = require('./chat');
  if (req.method === 'GET' && url.pathname === '/info') {
    const m = await modelOf(); const s = store.getSettings();
    return json(res, 200, { version: app.getVersion(), model: m ? m.label : '', lang: (s.language && s.language !== 'auto' ? s.language : app.getLocale()).slice(0, 2), reduceMotion: !!((s.v1 || {}).reduceMotion) });
  }
  if (req.method === 'GET' && url.pathname === '/sessions') {
    const root = url.searchParams.get('root') || '';
    const db = require('./db');
    const out = db.listConversations().filter((c) => c.codeRoot && path.resolve(c.codeRoot) === path.resolve(root)).slice(0, 15).map((c) => ({ id: c.id, title: c.title, updatedAt: c.updatedAt }));
    return json(res, 200, out);
  }
  if (req.method === 'POST' && url.pathname === '/answer') { const b = await body(req); return json(res, 200, { ok: chat.answer(b.reqId, b.id, b.value) }); }
  if (req.method === 'POST' && url.pathname === '/abort') { const b = await body(req); chat.abort(b.reqId); return json(res, 200, { ok: true }); }
  if (req.method === 'POST' && url.pathname === '/run') {
    const b = await body(req); const root = path.resolve(String(b.root || os.homedir()));
    if (!fs.existsSync(root)) return json(res, 400, { error: 'folder not found' });
    const model = await modelOf(); if (!model) return json(res, 400, { error: 'No model chosen in Fabro yet: open Fabro and pick one.' });
    const A = require('../anywhere/core.js'); const now = Date.now();
    let conv = null; if (b.convId) { try { conv = require('./db').getConversation(String(b.convId)); } catch {} }
    if (!conv) { conv = { id: uid() + now.toString(36), title: String(b.text || '').replace(/\s+/g, ' ').slice(0, 64), mode: 'code', code: { root }, agent: true, nodes: [], leafId: null, createdAt: now, updatedAt: now, origin: 'cli' }; await require('./code').info(root).catch(() => {}); }
    const user = { id: uid(), role: 'user', content: String(b.text || ''), createdAt: now, parentId: conv.leafId || null };
    conv.nodes = [...A.nodesOf(conv), user]; conv.leafId = user.id;
    const asst = { id: uid(), role: 'assistant', content: '', steps: [], model: model.label, createdAt: now + 1, parentId: user.id, origin: 'cli' };
    const reqId = 'cli-' + uid();
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
    const sendEv = (ev) => { try { res.write(`data: ${JSON.stringify(ev)}\n\n`); } catch {} };
    sendEv({ type: 'start', reqId, convId: conv.id, model: model.label });
    runs.set(reqId, { res, conv, asst });
    const code = require('./code'); const ps = code.projectSettings ? code.projectSettings(root) : {};
    chat.send({ reqId, model: model.ref, messages: messagesOf(conv),
      params: { agentMode: true, agent: true, tools: ['web_search', 'fetch_url'], userContext: { lang: (b.lang || 'fr'), memories: [] } },
      meta: { convId: conv.id, code: { root, mode: (ps && ps.mode) || 'edits' }, modelLabel: model.label } }, async (ev) => {
      if (ev.type === 'token') asst.content += ev.text;
      else if (ev.type === 'retract') asst.content = '';
      else if (ev.type === 'tool_start') asst.steps.push({ id: ev.id, name: ev.name, args: ev.args, status: 'running', parent: ev.parent });
      else if (ev.type === 'tool_end') { const s = asst.steps.find((x) => x.id === ev.id); if (s) { s.status = ev.error ? 'error' : ev.refused ? 'refused' : 'done'; s.view = ev.view; } }
      else if (ev.type === 'error') asst.error = ev.message;
      sendEv(ev);
      if (ev.type === 'done' || ev.type === 'error') {
        conv.nodes = [...A.nodesOf(conv), asst]; conv.leafId = asst.id; conv.updatedAt = Date.now();
        try { require('./db').saveConversation(require('./anywhere').mergeOnSave ? require('./anywhere').mergeOnSave(conv) : conv); } catch (e) { console.error('cli save', e); }
        try { require('electron').BrowserWindow.getAllWindows().forEach((w) => w.webContents.send('anywhere:event', { type: 'conv', id: conv.id })); } catch {}
        runs.delete(reqId); try { res.end(); } catch {}
      }
    });
    req.on('close', () => { if (runs.has(reqId)) chat.abort(reqId); });
    return;
  }
  json(res, 404, { error: 'not found' });
}

function start() {
  if (server) return;
  token = crypto.randomBytes(24).toString('hex');
  server = http.createServer((req, res) => handle(req, res).catch((e) => { try { json(res, 500, { error: String(e.message || e) }); } catch {} }));
  server.listen(0, '127.0.0.1', () => {
    const info = { port: server.address().port, token, pid: process.pid };
    try { fs.writeFileSync(infoFile(), JSON.stringify(info), { mode: 0o600 }); } catch (e) { console.error('cli.json', e); }
  });
  app.on('will-quit', () => { try { fs.unlinkSync(infoFile()); } catch {} });
}

// ───────────────────────────── the `fabro` command ─────────────────────────────
function cliScript() { return app.isPackaged ? path.join(process.resourcesPath, 'app.asar', 'src', 'cli', 'fabro.js') : path.join(__dirname, '..', 'cli', 'fabro.js'); }
async function installCommand() {
  const exe = process.execPath; const script = cliScript(); const home = app.getPath('userData');
  if (process.env.APPIMAGE) { // the mount path changes at each start: copy the CLI out and run it through the .AppImage file itself
    const share = path.join(os.homedir(), '.local', 'share', 'fabro-cli'); fs.mkdirSync(path.join(share, 'cli'), { recursive: true }); fs.mkdirSync(path.join(share, 'shared'), { recursive: true });
    const src = path.dirname(script); fs.writeFileSync(path.join(share, 'cli', 'fabro.js'), fs.readFileSync(script)); fs.writeFileSync(path.join(share, 'shared', 'mascot.js'), fs.readFileSync(path.join(src, '..', 'shared', 'mascot.js')));
    const dir = path.join(os.homedir(), '.local', 'bin'); fs.mkdirSync(dir, { recursive: true }); const f = path.join(dir, 'fabro');
    fs.writeFileSync(f, `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 FABRO_HOME=${JSON.stringify(home)} exec ${JSON.stringify(process.env.APPIMAGE)} ${JSON.stringify(path.join(share, 'cli', 'fabro.js'))} "$@"\n`, { mode: 0o755 });
    const inPath = (process.env.PATH || '').split(':').includes(dir);
    return { ok: true, path: f, note: (inPath ? 'Type: fabro code' : `Add ${dir} to your PATH, then type: fabro code`) + ' (reinstall the command if you move the .AppImage file)' };
  }
  if (process.platform === 'win32') {
    const dir = path.join(path.dirname(exe), 'bin'); fs.mkdirSync(dir, { recursive: true });
    const devArgs = app.isPackaged ? '' : ` "${path.join(__dirname, '..', '..')}"`;
    fs.writeFileSync(path.join(dir, 'fabro.cmd'), `@echo off\r\nsetlocal\r\nset ELECTRON_RUN_AS_NODE=1\r\nset FABRO_HOME=${home}\r\n"${exe}" "${script}"${devArgs ? '' : ''} %*\r\n`);
    // add the folder to the user's PATH once (no admin rights needed)
    const ps = `$p=[Environment]::GetEnvironmentVariable('Path','User'); if (-not $p) { $p='' }; if (($p -split ';') -notcontains '${dir.replace(/'/g, "''")}') { [Environment]::SetEnvironmentVariable('Path', ($p.TrimEnd(';') + ';${dir.replace(/'/g, "''")}').TrimStart(';'), 'User') }`;
    await new Promise((ok) => require('child_process').execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true }, () => ok()));
    return { ok: true, path: path.join(dir, 'fabro.cmd'), note: 'Open a new terminal, then type: fabro code' };
  }
  const dir = path.join(os.homedir(), '.local', 'bin'); fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, 'fabro');
  fs.writeFileSync(f, `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 FABRO_HOME=${JSON.stringify(home)} exec ${JSON.stringify(exe)} ${JSON.stringify(script)} "$@"\n`, { mode: 0o755 });
  const inPath = (process.env.PATH || '').split(':').includes(dir);
  return { ok: true, path: f, note: inPath ? 'Type: fabro code' : `Add ${dir} to your PATH, then type: fabro code` };
}
// Windows: the command is set up at the first start of each version (the installer's job, done by the app it installed)
async function ensureCommand() {
  const store = require('./store'); const done = (store.getSettings().cli || {}).installed;
  if (process.platform !== 'win32' || !app.isPackaged || done === app.getVersion()) return;
  const r = await installCommand().catch((e) => ({ ok: false, error: e.message }));
  if (r.ok) await store.setSettings({ cli: { installed: app.getVersion() } });
}

function register(h) {
  h('cli:install', () => installCommand());
  h('cli:status', () => ({ running: !!server, script: cliScript() }));
}
module.exports = { start, register, installCommand, ensureCommand };

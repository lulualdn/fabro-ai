// Fabro Anywhere, computer side. A hidden window (src/anywhere/peer.html) holds the network part — relay,
// encryption, WebRTC — with the same code as the phone app. This module keeps the identity and the paired
// phones, answers their requests (conversations, sync, model runs, voice) and sends Web Push notifications.
const { app, BrowserWindow, ipcMain, safeStorage } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const store = require('./store');
const db = require('./db');
const chat = require('./chat');
const webpush = require('./webpush');
const A = require('../anywhere/core.js');

const SITE = 'https://fabro.ufstudios.eu';
const APP_URL = `${SITE}/app/`;
const file = () => path.join(app.getPath('userData'), 'anywhere.json');
const cfg = () => store.getSettings().anywhere || {};

let data = null;          // { identity: { jwk }, vapid, devices: [...], tombstones: [...] }
let peer = null;          // hidden BrowserWindow
let peerReady = null;
let toRenderer = () => {};
let askRenderer = async () => null;
let pairing = null;       // { secret, expires, data27 }
const live = new Map();   // deviceId → { state: 'relay'|'direct'|'off', visible, at }
let relayStatus = [];
const runs = new Map();   // runId → { reqId, deviceId, convId }

// ───────────────────────────── storage (secrets protected by the OS when possible) ─────────────────────────────
const protect = (s) => { try { if (safeStorage.isEncryptionAvailable()) return 'enc:' + safeStorage.encryptString(s).toString('base64'); } catch {} return s; };
const reveal = (s) => { if (typeof s === 'string' && s.startsWith('enc:')) { try { return safeStorage.decryptString(Buffer.from(s.slice(4), 'base64')); } catch { return null; } } return s; };
function load() {
  if (data) return data;
  try { data = JSON.parse(fs.readFileSync(file(), 'utf8')); } catch { data = {}; }
  if (!data.identity) {
    const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const jwk = privateKey.export({ format: 'jwk' });
    data.identity = { jwk: { ...jwk, d: protect(jwk.d) } };
  }
  if (!data.vapid) { const v = webpush.vapidKeys(); data.vapid = { publicKey: v.publicKey, privateJwk: { ...v.privateJwk, d: protect(v.privateJwk.d) } }; }
  data.devices = data.devices || []; data.tombstones = data.tombstones || [];
  data.revoked = (data.revoked || []).filter((r) => Date.now() - r.at < 30 * 86400000);
  save();
  return data;
}
function save() { try { fs.writeFileSync(file() + '.tmp', JSON.stringify(data, null, 1)); fs.renameSync(file() + '.tmp', file()); } catch (e) { console.error('anywhere save', e); } }
const identityJwk = () => { const j = load().identity.jwk; return { ...j, d: reveal(j.d) }; };
const vapid = () => { const v = load().vapid; return { publicKey: v.publicKey, privateJwk: { ...v.privateJwk, d: reveal(v.privateJwk.d) } }; };
const devKey = (d) => reveal(d.k);
const pubRaw = () => { const j = identityJwk(); return Buffer.concat([Buffer.from([4]), Buffer.from(j.x, 'base64url'), Buffer.from(j.y, 'base64url')]); };
const fingerprint = () => crypto.createHash('sha256').update(pubRaw()).digest().subarray(0, 15);
const pcName = () => cfg().name || os.hostname().replace(/\.local$/, '') || 'PC';
function relays() {
  if (process.env.FABRO_ANYWHERE_RELAYS) return process.env.FABRO_ANYWHERE_RELAYS.split(',').filter(Boolean); // tests
  const c = cfg(); const list = (c.relays && c.relays.length ? c.relays : A.DEFAULT_RELAYS).filter((u) => A.DEFAULT_RELAYS.includes(u)); if (c.customRelay) list.push(c.customRelay); return list.length ? list : A.DEFAULT_RELAYS.slice(); }
function iceServers() {
  const c = cfg(); const out = [...A.STUN];
  if (c.turn && c.turn.url) out.push({ urls: c.turn.url, username: c.turn.username || undefined, credential: c.turn.credential || undefined });
  return out;
}
const publicDevice = (d) => ({ id: d.id, name: d.name, platform: d.platform, pairedAt: d.pairedAt, lastSeen: d.lastSeen || null, push: !!d.push, ...(live.get(d.id) || { state: 'off' }) });

// ───────────────────────────── peer window ─────────────────────────────
function ensurePeer() {
  if (peer && !peer.isDestroyed()) return peerReady;
  peer = new BrowserWindow({
    show: false, width: 400, height: 300, title: 'Fabro Anywhere',
    webPreferences: { preload: path.join(__dirname, '..', 'anywhere', 'peer-preload.js'), contextIsolation: true, sandbox: true, backgroundThrottling: false },
  });
  peer.webContents.setWebRTCIPHandlingPolicy('default'); // allow direct local-network paths
  peerReady = new Promise((res) => peer.webContents.once('did-finish-load', res));
  peer.loadFile(path.join(__dirname, '..', 'anywhere', 'peer.html'));
  const w = peer;
  w.on('closed', () => { if (peer !== w) return; peer = null; peerReady = null; for (const k of live.keys()) live.set(k, { ...live.get(k), state: 'off' }); emitStatus(); });
  return peerReady;
}
const toPeer = (cmd) => { if (peer && !peer.isDestroyed()) peer.webContents.send('aw:cmd', cmd); };
const sendTo = (deviceId, msg) => toPeer({ cmd: 'send', deviceId, msg });
function emitStatus() { toRenderer('anywhere:event', { type: 'status', status: status() }); }
function status() {
  const c = cfg();
  return { enabled: !!c.enabled, relays: relayStatus, devices: load().devices.map(publicDevice), pairing: pairing ? { expires: pairing.expires } : null, appUrl: APP_URL, name: pcName(), notifyAgent: c.notifyAgent !== false, customRelay: c.customRelay || '', relayList: c.relays && c.relays.length ? c.relays : A.DEFAULT_RELAYS, turn: c.turn || null };
}
function bootInfo() {
  return { identity: identityJwk(), devices: load().devices.map((d) => ({ id: d.id, k: devKey(d) })).filter((d) => d.k), revoked: load().revoked.map((r) => ({ id: r.id, k: reveal(r.k) })).filter((r) => r.k), relays: relays(), ice: iceServers(), info: { pcName: pcName(), vapid: load().vapid.publicKey } };
}
async function start() {
  if (!cfg().enabled) return;
  if (!load().devices.length && !pairing) return; // nothing to listen for yet
  await ensurePeer();
}
function stop() {
  if (!peer || peer.isDestroyed()) { peer = null; return; }
  const p = peer; peer = null; peerReady = null;
  try { p.webContents.send('aw:cmd', { cmd: 'bye-all' }); } catch {}
  setTimeout(() => { if (!p.isDestroyed()) p.destroy(); }, 400); // let phones hear goodbye
  for (const k of live.keys()) live.set(k, { ...live.get(k), state: 'off' });
  emitStatus();
}

// ───────────────────────────── pairing ─────────────────────────────
async function pairStart() {
  if (!cfg().enabled) await store.setSettings({ anywhere: { enabled: true } });
  const secret = crypto.randomBytes(10);
  const data27 = Buffer.from(A.packPayload({ flags: A.flagsFor(relays()), fp: new Uint8Array(fingerprint()), secret: new Uint8Array(secret) }));
  pairing = { secret: secret.toString('base64url'), expires: Date.now() + 5 * 60000, data27: data27.toString('base64url') };
  await ensurePeer();
  toPeer({ cmd: 'pair-start', secret: pairing.secret, relays: relays() });
  clearTimeout(pairStart.t); pairStart.t = setTimeout(pairStop, 5 * 60000);
  emitStatus();
  return { data27: pairing.data27, text: await A.textCode(new Uint8Array(data27)), expires: pairing.expires, appUrl: APP_URL, customRelay: cfg().customRelay || '' };
}
function pairStop() { clearTimeout(pairStart.t); if (!pairing) return true; pairing = null; toPeer({ cmd: 'pair-stop' }); emitStatus(); if (!load().devices.length) stop(); return true; }
function onPaired(dev) {
  const d = { ...dev, k: protect(dev.k), lastSeen: Date.now() };
  load().devices = [...data.devices.filter((x) => x.id !== d.id), d]; save();
  pairing = null; clearTimeout(pairStart.t);
  toPeer({ cmd: 'add', device: { id: d.id, k: dev.k } });
  toRenderer('anywhere:event', { type: 'paired', device: publicDevice(d) });
  emitStatus();
}
async function revoke(id) {
  toPeer({ cmd: 'remove', deviceId: id, notify: true });
  const d = load().devices.find((x) => x.id === id);
  if (d) data.revoked = [{ id, k: d.k, at: Date.now() }, ...data.revoked.filter((r) => r.id !== id)].slice(0, 50);
  data.devices = data.devices.filter((x) => x.id !== id); save();
  live.delete(id); emitStatus();
  if (!data.devices.length && !data.revoked.length) setTimeout(() => { if (!data.devices.length && !pairing) stop(); }, 2000);
  return true;
}
function rename(id, name) { const d = load().devices.find((x) => x.id === id); if (d) { d.name = String(name || '').trim().slice(0, 60) || d.name; save(); emitStatus(); } return true; }
async function configure(patch) {
  await store.setSettings({ anywhere: patch });
  if ('enabled' in patch && !patch.enabled) stop();
  else if (peer) { toPeer({ cmd: 'config', relays: relays(), ice: iceServers() }); }
  else await start();
  emitStatus();
  return status();
}

// ───────────────────────────── conversations ─────────────────────────────
const trimView = (v) => { if (!v || typeof v !== 'object') return v; const o = { ...v }; for (const k of Object.keys(o)) if (typeof o[k] === 'string' && o[k].length > 4000) o[k] = o[k].slice(0, 4000) + '…'; return o; };
function forPhone(c) {
  if (!c) return c;
  const nodes = A.nodesOf(c).map(({ steps, ...n }) => ({ ...n, steps: (steps || []).map((s) => ({ id: s.id, name: s.name, status: s.status, parent: s.parent, args: s.args && JSON.stringify(s.args).length < 1500 ? s.args : undefined, view: trimView(s.view) })) }));
  const { messages, ...rest } = c;
  return { ...rest, nodes };
}
const phoneVisible = (meta) => !meta.codeRoot;
function getConv(id) { try { return db.getConversation(id); } catch { return null; } }
function saveMerged(incoming) {
  const cur = getConv(incoming.id);
  const merged = cur ? A.mergeConv(cur, incoming) : A.mergeConv(null, incoming);
  if (cur && cur.pinned) merged.pinned = true;
  db.saveConversation(merged);
  toRenderer('anywhere:event', { type: 'conv', id: merged.id });
  return merged;
}
// conv:save from the desktop: keep what a phone added meanwhile (the desktop copy may be older).
function mergeOnSave(c) {
  if (!c || c.ephemeral) return c;
  const cur = getConv(c.id); if (!cur) return c;
  const mine = new Set((c.nodes || []).map((n) => n.id));
  if (!A.nodesOf(cur).some((n) => !mine.has(n.id))) return c;
  return A.mergeConv(cur, { ...c, updatedAt: Date.now() });
}
function tombstone(id) { load().tombstones = [{ id, at: Date.now() }, ...data.tombstones.filter((t) => t.id !== id)].slice(0, 500); save(); }

function sync(p = {}) {
  for (const id of p.deleted || []) { try { db.deleteConversation(id); tombstone(id); toRenderer('anywhere:event', { type: 'conv', id, deleted: true }); } catch {} }
  const gone = new Set(load().tombstones.map((t) => t.id));
  for (const c of p.push || []) if (c && c.id && !gone.has(c.id) && (c.nodes || []).length) saveMerged(c);
  const metas = db.listConversations().filter(phoneVisible).map((m) => ({ id: m.id, title: m.title, updatedAt: m.updatedAt, agent: m.agent, pinned: m.pinned, project: m.project }));
  const have = p.have || {};
  const want = new Set(p.full || []);
  const changed = metas.filter((m) => !(m.id in have) || have[m.id] < m.updatedAt).slice(0, 25).map((m) => m.id);
  const convs = [...new Set([...changed, ...want])].map(getConv).filter(Boolean).map(forPhone);
  return { metas, convs, deleted: [...gone] };
}

// ───────────────────────────── models ─────────────────────────────
async function modelList() {
  const models = require('./models'); const providers = require('./providers');
  const inst = await models.installed().catch(() => ({ local: [] }));
  let prov = []; try { prov = await providers.chatModels(); } catch {}
  const l = (inst.local || []).filter((m) => !m.role).map((m) => ({ ref: { backend: 'local', id: m.id }, label: m.name, vision: !!m.vision, local: true }));
  const p = (prov || []).map((m) => ({ ref: m.ref, label: m.label, vision: !!m.vision, provider: m.providerName, local: !!m.local }));
  return [...l, ...p];
}
const refKey = (r) => !r ? '' : r.backend === 'provider' ? `p:${r.provider}:${r.model}` : r.backend === 'local' ? `l:${r.id}` : `${r.backend}:${r.id || r.name}`;

// ───────────────────────────── runs (a phone asks a question) ─────────────────────────────
function buildMessages(pathNodes, system) {
  const out = [{ role: 'system', content: system }];
  for (const m of pathNodes) {
    if (m.pending || (m.role === 'assistant' && m.error && !m.content)) continue;
    if (m.role === 'assistant') { out.push({ role: 'assistant', content: m.content || '' }); continue; }
    const texts = (m.attachments || []).filter((a) => a.kind === 'text').map((a) => `File: ${a.name}\n\`\`\`${a.ext || ''}\n${a.text}\n\`\`\``);
    const content = [...texts, m.content].filter(Boolean).join('\n\n');
    const imgs = (m.attachments || []).filter((a) => a.kind === 'image' && a.data);
    if (imgs.length) out.push({ role: 'user', content: [{ type: 'text', text: content || ' ' }, ...imgs.map((a) => ({ type: 'image_url', image_url: { url: a.data } }))] });
    else out.push({ role: 'user', content });
  }
  return out;
}
async function context() {
  const r = await askRenderer('context');
  if (r && r.system) return r;
  const s = store.getSettings();
  return { system: `You are Fabro, a helpful assistant running on the user's own computer. Today is ${new Date().toDateString()}. Answer in the user's language.`, agentPrompt: '', tools: ['web_search', 'fetch_url'], gen: s.gen || {}, model: s.selectedModel, lang: 'en', agentEnabled: (s.agent || {}).enabled !== false };
}
async function run(deviceId, p) {
  const c0 = p.conv ? saveMerged(p.conv) : getConv(p.convId);
  if (!c0) throw new Error('Conversation not found');
  const nodes = A.nodesOf(c0);
  const user = nodes.find((n) => n.id === p.nodeId && n.role === 'user');
  if (!user) throw new Error('Message not found');
  if (nodes.some((n) => n.parentId === user.id && n.role === 'assistant' && !n.error)) return { already: true }; // answered meanwhile
  const ctx = await context();
  const list = await modelList();
  const ref = p.model || ctx.model;
  const m = list.find((x) => refKey(x.ref) === refKey(ref)) || list[0];
  if (!m) throw new Error('No model on the computer yet');
  const reqId = 'aw-' + A.uid(), runId = reqId;
  const asst = { id: A.uid(), role: 'assistant', content: '', reasoning: '', steps: [], model: m.label, pending: true, createdAt: Date.now(), parentId: user.id, origin: 'phone' };
  const c = { ...c0, nodes: [...nodes, asst], leafId: asst.id };
  delete c.messages;
  if (p.agent !== undefined) c.agent = !!p.agent;
  db.saveConversation(c); toRenderer('anywhere:event', { type: 'conv', id: c.id });
  const pathNodes = A.pathOf({ nodes: c.nodes, leafId: user.id });
  runs.set(runId, { reqId, deviceId, convId: c.id });
  let buf = [], flushT = null;
  const flush = () => { flushT = null; if (buf.length) { sendTo(deviceId, { t: 'ev', k: 'run', runId, convId: c.id, nodeId: asst.id, evs: buf }); buf = []; } };
  const push = (ev) => { buf.push(ev); if (!flushT) flushT = setTimeout(flush, 90); };
  const usedTools = [...new Set(nodes.flatMap((x) => (x.steps || []).map((s) => s.name)))];
  const params = { ...(ctx.gen || {}), tools: ctx.tools || [], agentMode: !!c.agent, agentPrompt: ctx.agentPrompt || '', vision: !!m.vision, usedTools, agent: ctx.agentEnabled !== false };
  if (params.reasoning === 'auto') delete params.reasoning;
  const finished = new Promise((resolve) => {
    chat.send({ reqId, model: m.ref, messages: buildMessages(pathNodes, ctx.system), params, meta: { convId: c.id, turnId: asst.id, project: c.project || null, modelLabel: m.label } }, (ev) => {
      switch (ev.type) {
        case 'reasoning': asst.reasoning += ev.text; push({ type: 'reasoning', text: ev.text }); break;
        case 'token': asst.content += ev.text; push({ type: 'token', text: ev.text }); break;
        case 'tool_start': asst.steps.push({ id: ev.id, name: ev.name, args: ev.args || {}, status: 'running', parent: ev.parent }); push({ type: 'tool_start', id: ev.id, name: ev.name, parent: ev.parent, args: ev.args && JSON.stringify(ev.args).length < 1500 ? ev.args : undefined }); break;
        case 'tool_end': { const st = asst.steps.find((x) => x.id === ev.id); if (st) { st.status = ev.error ? 'error' : ev.refused ? 'refused' : 'done'; st.view = ev.view; st.error = ev.error; } push({ type: 'tool_end', id: ev.id, error: ev.error, refused: ev.refused, view: trimView(ev.view) }); break; }
        case 'tool_round': if (asst.content && !/\n\n$/.test(asst.content)) asst.content += '\n\n'; push({ type: 'tool_round' }); break;
        case 'agent_switch': c.agent = true; push({ type: 'agent_switch' }); break;
        case 'permission': flush(); sendTo(deviceId, { t: 'ev', k: 'ask', runId, convId: c.id, ask: { type: 'permission', id: ev.id, summary: ev.summary || ev.tool || '', tool: ev.tool, detail: ev.detail || '' } }); break;
        case 'deps_needed': chat.answer(reqId, ev.id, false); break;
        case 'retract': asst.content = ''; push({ type: 'retract' }); break;
        case 'done': asst.stats = ev.stats; resolve(); break;
        case 'error': asst.error = ev.message; asst.errorCode = ev.code; resolve(); break;
      }
    }).catch((e) => { asst.error = String(e && e.message || e); resolve(); });
  });
  finished.then(async () => {
    flush(); clearTimeout(flushT); runs.delete(runId);
    asst.pending = false; asst.updatedAt = Date.now();
    const latest = getConv(c.id);
    let final = A.mergeConv(latest, { ...c, updatedAt: Date.now() });
    // AI title on the first answer
    const users = A.pathOf(final).filter((x) => x.role === 'user');
    if (!asst.error && users.length === 1 && !final.aiTitle && store.getSettings().autoTitle !== false) {
      try { const t = await require('./brain').title({ model: m.ref, user: users[0].content || '', answer: asst.content, lang: ctx.lang || 'en' }); if (t && t.length > 1) { final.title = t; final.aiTitle = true; } } catch {}
    }
    if (!final.title) final.title = (user.content || '').replace(/\s+/g, ' ').slice(0, 64);
    db.saveConversation(final);
    toRenderer('anywhere:event', { type: 'conv', id: final.id });
    sendTo(deviceId, { t: 'ev', k: 'run.done', runId, convId: final.id, conv: forPhone(getConv(final.id)) });
    const st = live.get(deviceId) || {};
    if (st.state === 'off' || !st.state || !st.visible) notify(deviceId, { title: final.title || pcName(), body: asst.error ? `⚠ ${asst.error}`.slice(0, 160) : (asst.content || '').replace(/[#*_`>]/g, '').replace(/\s+/g, ' ').slice(0, 160), convId: final.id, tag: final.id, kind: (asst.steps || []).length ? 'agent' : 'answer' });
  });
  return { runId, nodeId: asst.id, model: m.label };
}

// ───────────────────────────── notifications ─────────────────────────────
async function notify(deviceId, msg) {
  const d = load().devices.find((x) => x.id === deviceId);
  if (!d || !d.push) return false;
  try {
    const r = await webpush.send(d.push, msg, vapid());
    if (r.gone) { d.push = null; save(); emitStatus(); }
    return r.ok;
  } catch { return false; }
}
// A task the desktop's agent finished while the window was in the background.
function desktopAgentDone({ title, body, convId }) {
  if (cfg().notifyAgent === false || !load().devices.length) return;
  if (!body) { const l = (store.getSettings().language && store.getSettings().language !== 'auto' ? store.getSettings().language : app.getLocale()).slice(0, 2); body = { fr: 'Tâche de l’agent terminée ✓', es: 'Tarea del agente terminada ✓', de: 'Agenten-Aufgabe erledigt ✓' }[l] || 'Agent task done ✓'; }
  for (const d of load().devices) {
    const st = live.get(d.id) || {};
    if (st.state && st.state !== 'off' && st.visible) sendTo(d.id, { t: 'ev', k: 'toast', title, body, convId });
    else notify(d.id, { title, body, convId, tag: convId, kind: 'agent' });
  }
}

// ───────────────────────────── requests from phones ─────────────────────────────
async function handle(deviceId, method, p = {}) {
  const dev = load().devices.find((d) => d.id === deviceId);
  if (!dev) throw new Error('unknown device');
  switch (method) {
    case 'hello': {
      live.set(deviceId, { ...(live.get(deviceId) || {}), visible: p.visible !== false, at: Date.now() });
      if (p.name && p.name !== dev.name && !dev.renamed) { /* keep the PC-side name */ }
      const voice = require('./voice').status();
      const ctx = await askRenderer('context').catch(() => null);
      return { pcName: pcName(), models: await modelList(), model: (ctx && ctx.model) || store.getSettings().selectedModel, voice: { ready: !!(voice.runtime && voice.whisperReady), voice: voice.voice }, vapid: load().vapid.publicKey, ice: iceServers(), deviceName: dev.name, version: app.getVersion() };
    }
    case 'state': live.set(deviceId, { ...(live.get(deviceId) || {}), visible: !!p.visible, at: Date.now() }); return true;
    case 'sync': return sync(p);
    case 'conv.get': { const c = getConv(p.id); if (!c) throw new Error('Conversation not found'); return forPhone(c); }
    case 'conv.delete': { db.deleteConversation(p.id); tombstone(p.id); toRenderer('anywhere:event', { type: 'conv', id: p.id, deleted: true }); return true; }
    case 'conv.rename': { db.patchConversation(p.id, { title: String(p.title || '').slice(0, 120) }); toRenderer('anywhere:event', { type: 'conv', id: p.id }); return true; }
    case 'models': return modelList();
    case 'run': return run(deviceId, p);
    case 'run.abort': { const r = runs.get(p.runId); if (r) chat.abort(r.reqId); return true; }
    case 'run.answer': { const r = runs.get(p.runId); return r ? chat.answer(r.reqId, p.callId, p.value) : false; }
    case 'voice.stt': { const voice = require('./voice'); return voice.stt(Buffer.from(p.wav, 'base64'), { lang: p.lang }); }
    case 'voice.tts': { const voice = require('./voice'); const wav = await voice.tts(String(p.text || '').slice(0, 1500), {}); return { wav: Buffer.from(wav).toString('base64') }; }
    case 'push.sub': { dev.push = p.sub && p.sub.endpoint && p.sub.keys ? { endpoint: String(p.sub.endpoint), keys: { p256dh: String(p.sub.keys.p256dh), auth: String(p.sub.keys.auth) } } : null; save(); emitStatus(); return true; }
    case 'unpair': setTimeout(() => revoke(deviceId), 300); return true;
    case 'push.test': return notify(deviceId, { title: pcName(), body: p.body || 'Fabro Anywhere ✓', tag: 'test' });
    default: throw new Error('unknown method ' + method);
  }
}

// ───────────────────────────── init ─────────────────────────────
function init({ emit, ask }) {
  toRenderer = emit; askRenderer = ask;
  const fromPeer = (ch, fn) => ipcMain.handle(ch, (e, ...a) => { if (!peer || e.sender !== peer.webContents) throw new Error('forbidden'); return fn(...a); });
  fromPeer('aw:boot', () => bootInfo());
  fromPeer('aw:paired', (dev) => onPaired(dev));
  fromPeer('aw:relays', (st) => { relayStatus = st; emitStatus(); return true; });
  fromPeer('aw:state', ({ deviceId, state }) => {
    const d = load().devices.find((x) => x.id === deviceId); if (!d) return false;
    live.set(deviceId, { ...(live.get(deviceId) || {}), state, at: Date.now() });
    if (state !== 'off') { d.lastSeen = Date.now(); save(); }
    emitStatus(); return true;
  });
  fromPeer('aw:msg', async ({ deviceId, msg }) => {
    const d = load().devices.find((x) => x.id === deviceId); if (!d || !msg) return false;
    d.lastSeen = Date.now();
    if (msg.t === 'req') {
      try { sendTo(deviceId, { t: 'res', id: msg.id, ok: true, r: await handle(deviceId, msg.m, msg.p) }); }
      catch (e) { sendTo(deviceId, { t: 'res', id: msg.id, ok: false, e: String(e && e.message || e) }); }
    }
    return true;
  });
  app.whenReady().then(() => setTimeout(() => start().catch(() => {}), 2500));
}

module.exports = {
  init, status, pairStart, pairStop, revoke, rename, configure, mergeOnSave, tombstone, desktopAgentDone, stop,
  _test: { handle, sync, run, onPaired, load, forPhone },
};

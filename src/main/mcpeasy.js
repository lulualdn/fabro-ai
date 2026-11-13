// "Add an MCP server from whatever you have": parse pasted text, find configs of other apps, a short list of well-known
// servers, prerequisite checks, a real connection test, then save. Built on agent/mcp.js (which owns the connections).
//   parse(text)            → { ok, servers:[{ name, type, command, args, env, url, headers, needs[], notes[], source }], errors[] }
//   prereq(config)         → { ok, items:[{ tool, label, found, path, help }] }
//   test(config)           → { ok, auth?, tools[], count, error, stderr, cause, hint, prereq, ms }
//   add(config, opts)      → { ok, server }   (config = a parse() server + optional values for its needs[]; enabled:false for imports)
//   catalog()              → well-known servers (package names verified against the official registries)
//   findConfigs()          → configs of other apps found on this computer (read-only) → importFrom(selection)
// Nothing here starts a program except test() and add() with enabled !== false, and both are explicit calls.
// See docs/v02/api-install.md.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const mcp = () => require('./agent/mcp');
const existingNames = () => { try { return mcp().view().map((s) => s.name); } catch { return []; } };

// ───────────────────────────── helpers ─────────────────────────────
const SECRET_RE = /(key|token|secret|passw(or)?d|pwd|credential|bearer|cookie|auth|signature)/i;
const isSecretName = (n) => SECRET_RE.test(String(n)) || /(^|[_-])pat($|[_-])/i.test(String(n));
const PLACEHOLDER_RE = /^(<[^>]*>|\$\{[^}]*\}|\$[A-Z_][A-Z0-9_]*|%[A-Z_]+%|\{\{[^}]*\}\}|\.{3}|…|x{3,}|your[-_ ]?.*|.*(your[-_ ]?(api[-_ ]?)?(key|token|secret|password|pat).*)|.*[-_]here|replace[-_ ].*|change[-_ ]?me|todo|path\/to\/.*|\/path\/to\/.*|[a-z]:\\path\\to\\.*)$/i;
const isPlaceholder = (v) => v === undefined || v === null || String(v).trim() === '' || PLACEHOLDER_RE.test(String(v).trim());

// shell-like split. Backslashes stay literal (Windows paths) except before a quote or a space.
function tokenize(line) {
  const out = []; let cur = ''; let q = ''; let has = false;
  const s = String(line);
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '\\' && q === '"' && s[i + 1] === '"') { cur += '"'; i++; continue; }
      if (c === q) { q = ''; continue; }
      cur += c; continue;
    }
    if (c === '"' || c === "'") { q = c; has = true; continue; }
    if (c === '\\' && (s[i + 1] === ' ' || s[i + 1] === '"' || s[i + 1] === "'")) { cur += s[i + 1]; i++; has = true; continue; }
    if (/\s/.test(c)) { if (cur || has) out.push(cur); cur = ''; has = false; continue; }
    cur += c; has = true;
  }
  if (cur || has) out.push(cur);
  return out;
}

// JSON with comments / trailing commas / code fences (what people paste from READMEs and VS Code settings)
function looseJson(text) {
  let s = String(text).replace(/^﻿/, '').trim();
  const fence = s.match(/^```[a-zA-Z]*\n([\s\S]*?)\n?```\s*$/); if (fence) s = fence[1].trim();
  let out = ''; let inStr = false; let esc = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) { out += c; if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') { inStr = true; out += c; continue; }
    if (c === '/' && s[i + 1] === '/') { while (i < s.length && s[i] !== '\n') i++; out += '\n'; continue; }
    if (c === '/' && s[i + 1] === '*') { i += 2; while (i < s.length && !(s[i] === '*' && s[i + 1] === '/')) i++; i++; continue; }
    out += c;
  }
  out = out.replace(/,(\s*[}\]])/g, '$1');
  try { return JSON.parse(out); } catch (e) { /* maybe a fragment: "name": { ... } */ }
  if (/^"[^"]+"\s*:\s*\{/.test(out.trim())) return JSON.parse('{' + out.trim().replace(/,\s*$/, '') + '}');
  return JSON.parse(out);
}

// Small TOML reader: tables, dotted keys in table headers, strings, numbers, booleans, arrays, inline tables.
function parseToml(text) {
  const root = {}; let cur = root;
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
  const splitKey = (k) => { const parts = []; const re = /\s*(?:"((?:[^"\\]|\\.)*)"|'([^']*)'|([A-Za-z0-9_-]+))\s*(?:\.|$)/y; let m; re.lastIndex = 0; let i = 0; while (i < k.length && (m = re.exec(k))) { parts.push(m[1] !== undefined ? JSON.parse(`"${m[1]}"`) : m[2] !== undefined ? m[2] : m[3]); i = re.lastIndex; if (m[0].length === 0) break; } return parts; };
  const val = (s) => {
    s = s.trim();
    if (s.startsWith('"""')) return s.slice(3, -3);
    if (s.startsWith('"')) { try { return JSON.parse(s); } catch { return s.slice(1, -1); } }
    if (s.startsWith("'")) return s.slice(1, -1);
    if (s === 'true') return true; if (s === 'false') return false;
    if (/^[+-]?\d+(\.\d+)?$/.test(s)) return Number(s);
    if (s.startsWith('[')) { const inner = s.slice(1, s.lastIndexOf(']')); return splitTop(inner).map(val).filter((x) => x !== undefined); }
    if (s.startsWith('{')) { const o = {}; for (const kv of splitTop(s.slice(1, s.lastIndexOf('}')))) { const i = kv.indexOf('='); if (i > 0) o[splitKey(kv.slice(0, i).trim()).join('.')] = val(kv.slice(i + 1)); } return o; }
    return s;
  };
  function splitTop(s) { const out = []; let depth = 0; let q = ''; let cur = ''; for (let i = 0; i < s.length; i++) { const c = s[i]; if (q) { cur += c; if (c === '\\' && q === '"') { cur += s[++i]; } else if (c === q) q = ''; continue; } if (c === '"' || c === "'") { q = c; cur += c; continue; } if (c === '[' || c === '{') depth++; if (c === ']' || c === '}') depth--; if (c === ',' && depth === 0) { if (cur.trim()) out.push(cur.trim()); cur = ''; continue; } cur += c; } if (cur.trim()) out.push(cur.trim()); return out; }
  const stripComment = (l) => { let q = ''; for (let i = 0; i < l.length; i++) { const c = l[i]; if (q) { if (c === '\\' && q === '"') i++; else if (c === q) q = ''; } else if (c === '"' || c === "'") q = c; else if (c === '#') return l.slice(0, i); } return l; };
  for (let i = 0; i < lines.length; i++) {
    let l = stripComment(lines[i]).trim(); if (!l) continue;
    const h = l.match(/^\[\[?([^\]]+)\]\]?$/);
    if (h) { cur = root; for (const k of splitKey(h[1])) cur = cur[k] = cur[k] || {}; continue; }
    const eq = l.indexOf('='); if (eq < 0) continue;
    const key = l.slice(0, eq).trim(); let v = l.slice(eq + 1).trim();
    // multi-line arrays / inline tables
    const bal = (x) => (x.match(/[\[{]/g) || []).length - (x.match(/[\]}]/g) || []).length;
    while (bal(v) > 0 && i + 1 < lines.length) v += ' ' + stripComment(lines[++i]).trim();
    let t = cur; const ks = splitKey(key); for (const k of ks.slice(0, -1)) t = t[k] = t[k] || {};
    t[ks[ks.length - 1]] = val(v);
  }
  return root;
}

// ───────────────────────────── naming ─────────────────────────────
const VALUE_FLAGS = new Set(['-e', '--env', '-v', '--volume', '-p', '--publish', '--name', '-w', '--workdir', '--network', '--net', '--mount', '-u', '--user', '--entrypoint', '--env-file', '--platform', '-l', '--label', '--add-host', '-m', '--memory', '--cpus', '--pull', '--restart', '--hostname', '-h']);
function dockerImage(args) {
  const i0 = args.findIndex((a) => a === 'run' || a === 'create');
  for (let i = i0 + 1; i < args.length; i++) { const a = args[i]; if (a.startsWith('-')) { if (VALUE_FLAGS.has(a)) i++; continue; } return { image: a, index: i }; }
  return null;
}
function shortName(raw) {
  let n = String(raw || '').replace(/^npm:/, '').replace(/@(latest|next|[\d.]+[\w.-]*)$/, '').replace(/:[\w.-]+$/, '');
  const scope = (n.match(/^@([^/]+)\//) || [])[1] || '';
  n = n.replace(/^@[^/]+\//, '').split('/').pop().replace(/\.(js|mjs|py)$/, '');
  const strip = (x) => x.replace(/^(mcp-server-|server-|mcp-)/, '').replace(/(-mcp-server|-server-mcp|-mcp|-server|_mcp_server|_mcp)$/, '');
  let s = strip(n); if (!s || s === 'mcp' || s === 'server') s = scope || n;
  s = s.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return s.slice(0, 24) || 'server';
}
function nameFrom(cfg) {
  if (cfg.url) { try { const h = new URL(cfg.url).hostname.replace(/^(www|api|mcp|server)\./, '').split('.'); return shortName(h.length > 2 ? h[h.length - 2] : h[0]); } catch { return 'remote'; } }
  const cmd = path.basename(String(cfg.command || '')).replace(/\.(cmd|exe|bat)$/i, ''); const args = cfg.args || [];
  if (cmd === 'docker' || cmd === 'podman') { const d = dockerImage(args); if (d) return shortName(d.image); }
  if (['npx', 'bunx', 'pnpx', 'uvx', 'pipx'].includes(cmd) || (['pnpm', 'yarn'].includes(cmd) && args[0] === 'dlx')) { const a = args.find((x) => !x.startsWith('-') && x !== 'dlx' && x !== 'run'); if (a) return shortName(a); }
  if (cmd === 'uv' && args[0] === 'run') { const a = args.slice(1).find((x) => !x.startsWith('-')); if (a) return shortName(a); }
  if (/^python3?$|^py$/.test(cmd)) { const i = args.indexOf('-m'); if (i >= 0 && args[i + 1]) return shortName(args[i + 1]); }
  if (['node', 'deno', 'bun'].includes(cmd)) { const a = args.find((x) => !x.startsWith('-') && x !== 'run'); if (a) { const base = path.basename(a).replace(/\.(js|mjs|ts)$/, ''); return shortName(/^(index|main|server|cli)$/.test(base) ? path.basename(path.dirname(a.replace(/\\/g, '/'))) : base); } }
  return shortName(cmd);
}

// ───────────────────────────── building a server from loose pieces ─────────────────────────────
function newServer(src) { return { name: '', type: 'stdio', command: '', args: [], env: {}, url: '', headers: {}, needs: [], notes: [], source: src }; }

// Look at env / headers / args and list what the user still has to give (secrets first).
function finalize(s, labels = {}) {
  s.needs = s.needs || [];
  const have = new Set(s.needs.map((n) => `${n.where}:${n.name || n.index}`));
  const push = (n) => { const k = `${n.where}:${n.name || n.index}`; if (!have.has(k)) { have.add(k); s.needs.push(n); } };
  for (const [k, v] of Object.entries(s.env || {})) {
    const m = String(v).match(/^\$\{input:([^}]+)\}$/);
    const lbl = m && labels[m[1]];
    if (isPlaceholder(v)) { s.env[k] = ''; push({ where: 'env', name: k, label: lbl || k, secret: isSecretName(k), required: true, kind: isSecretName(k) ? 'password' : 'text' }); }
    else if (isSecretName(k)) push({ where: 'env', name: k, label: k, secret: true, required: true, set: true, kind: 'password' });
  }
  for (const [k, v] of Object.entries(s.headers || {})) {
    const pre = /^(Bearer|Basic|Token)\s+/i.exec(String(v));
    const rest = pre ? String(v).slice(pre[0].length) : String(v);
    const m = rest.match(/^\$\{input:([^}]+)\}$/);
    if (isPlaceholder(rest)) { s.headers[k] = ''; push({ where: 'header', name: k, prefix: pre ? pre[0] : '', label: (m && labels[m[1]]) || k, secret: true, required: true, kind: 'password' }); }
    else if (isSecretName(k) || pre) push({ where: 'header', name: k, label: k, secret: true, required: true, set: true, kind: 'password' });
  }
  (s.args || []).forEach((a, i) => { if (/^<[^>]+>$/.test(a) || /^([a-zA-Z]:)?[\\/]?path[\\/]to[\\/]/i.test(a) || /^your[-_]/i.test(a)) push({ where: 'arg', index: i, label: String(a).replace(/^<|>$/g, ''), secret: false, required: true, kind: /path|dir|folder|repo/i.test(a) ? 'folder' : 'text' }); });
  if (!s.name) s.name = nameFrom(s);
  s.type = s.url ? 'http' : 'stdio';
  if (s.type === 'http' && /\/sse\/?$/.test(s.url) && !s.notes.some((n) => /SSE/.test(n))) s.notes.push('This looks like a legacy SSE address. Fabro speaks Streamable HTTP; the test will tell if it works.');
  return s;
}

// docker run / npx … : lift -e KEY=VALUE out of the arguments so values never sit in the command line
function liftDockerEnv(s) {
  const cmd = path.basename(String(s.command)).replace(/\.(exe|cmd)$/i, '');
  if (cmd !== 'docker' && cmd !== 'podman') return;
  const out = []; const a = s.args;
  for (let i = 0; i < a.length; i++) {
    const t = a[i]; let m;
    if ((t === '-e' || t === '--env') && a[i + 1] !== undefined) { const kv = String(a[i + 1]); const eq = kv.indexOf('='); const k = eq < 0 ? kv : kv.slice(0, eq); if (eq >= 0) s.env[k] = kv.slice(eq + 1); else if (!(k in s.env)) s.env[k] = ''; out.push('-e', k); i++; continue; }
    if ((m = /^(?:--env=|-e)(.+)$/.exec(t))) { const kv = m[1]; const eq = kv.indexOf('='); const k = eq < 0 ? kv : kv.slice(0, eq); if (eq >= 0) s.env[k] = kv.slice(eq + 1); else if (!(k in s.env)) s.env[k] = ''; out.push('-e', k); continue; }
    out.push(t);
  }
  s.args = out;
}
function fixLauncher(s) {
  const cmd = path.basename(String(s.command)).replace(/\.(exe|cmd)$/i, '');
  if (cmd === 'npx' && !s.args.some((a) => a === '-y' || a === '--yes')) { s.args = ['-y', ...s.args]; s.notes.push('Added -y so npx does not wait for a question nobody can answer.'); }
  if (cmd === 'docker' && s.args[0] === 'run' && !s.args.includes('-i') && !s.args.some((a) => /^-[a-z]*i[a-z]*$/.test(a) || a === '--interactive')) { s.args.splice(1, 0, '-i'); s.notes.push('Added -i: MCP servers talk through standard input.'); }
}

function fromObject(o, name, labels) {
  const s = newServer('json'); s.name = name || '';
  const urlKey = o.url || o.serverUrl || o.httpUrl || o.endpoint || o.baseUrl;
  if (urlKey) s.url = String(urlKey);
  if (o.command) {
    if (Array.isArray(o.command)) { s.command = String(o.command[0]); s.args = [...o.command.slice(1), ...(o.args || [])].map(String); } // opencode style
    else if (!o.args && /\s/.test(String(o.command).trim()) && !/^[a-zA-Z]:\\|^\//.test(String(o.command))) { const t = tokenize(o.command); s.command = t[0]; s.args = t.slice(1); }
    else { s.command = String(o.command); s.args = (o.args || []).map(String); }
  }
  if (s.url && s.command) s.command = '';
  s.env = {}; for (const [k, v] of Object.entries(o.env || o.environment || {})) s.env[k] = String(v);
  for (const k of o.env_vars || []) { const n = typeof k === 'string' ? k : k && k.name; if (n && !(n in s.env)) s.env[n] = ''; }
  s.headers = {}; for (const [k, v] of Object.entries(o.headers || o.http_headers || {})) s.headers[k] = String(v);
  if (o.bearer_token_env_var) s.headers.Authorization = 'Bearer ${' + o.bearer_token_env_var + '}';
  if (o.cwd) s.cwd = String(o.cwd);
  if (/sse/i.test(String(o.type || o.transport || ''))) s.notes.push('Marked as an SSE server. Fabro speaks Streamable HTTP; the test will tell if it works.');
  if (!s.url && !s.command) return null;
  liftDockerEnv(s); fixLauncher(s);
  return finalize(s, labels);
}

function fromJsonValue(j) {
  const labels = {}; for (const i of Array.isArray(j.inputs) ? j.inputs : []) if (i && i.id) labels[i.id] = i.description || i.id;
  const containers = [j.mcpServers, j.servers, j.mcp_servers, j.context_servers, j.mcp && j.mcp.servers, j.mcp && j.mcp.mcpServers, j.mcp && !j.mcp.servers && !j.mcp.mcpServers && typeof j.mcp === 'object' ? j.mcp : null, j.projects && null].filter((x) => x && typeof x === 'object' && !Array.isArray(x));
  const out = [];
  for (const c of containers) for (const [k, v] of Object.entries(c)) if (v && typeof v === 'object') { const s = fromObject(v, k, labels); if (s) out.push(s); }
  if (out.length) return out;
  // a single server object
  if (j.command || j.url || j.serverUrl || j.httpUrl) { const s = fromObject(j, j.name || '', labels); return s ? [s] : []; }
  // a bare map of servers
  const vals = Object.entries(j).filter(([, v]) => v && typeof v === 'object' && (v.command || v.url || v.serverUrl || v.httpUrl));
  for (const [k, v] of vals) { const s = fromObject(v, k, labels); if (s) out.push(s); }
  return out;
}

// ── command lines ──
function logicalLines(text) {
  const t = String(text).replace(/\r\n?/g, '\n').replace(/\\\n\s*/g, ' ').replace(/\^\n\s*/g, ' ').replace(/`\n\s*/g, ' ');
  return t.split('\n').map((l) => l.trim().replace(/^[$>]\s+/, '').replace(/^PS [^>]*>\s*/, '')).filter((l) => l && !l.startsWith('#'));
}
const LAUNCHERS = new Set(['npx', 'bunx', 'pnpx', 'uvx', 'pipx', 'docker', 'podman', 'node', 'python', 'python3', 'py', 'deno', 'bun', 'uv', 'pnpm', 'yarn', 'npm', 'java', 'dotnet', 'cargo', 'go', 'cmd', 'powershell', 'pwsh', 'sh', 'bash', 'env']);

function parseCliAdd(tokens) {
  // claude|codex|gemini mcp add [options] <name> [<url|command> [args…]] [-- command args…]
  const i0 = tokens.findIndex((t) => t === 'add' || t === 'add-json');
  const isJson = tokens[i0] === 'add-json';
  const rest = tokens.slice(i0 + 1);
  const s = newServer('cli'); let transport = ''; const pos = []; let after = null;
  for (let i = 0; i < rest.length; i++) {
    const t = rest[i];
    if (t === '--') { after = rest.slice(i + 1); break; }
    const takeVar = (re) => { const vals = []; while (i + 1 < rest.length && re.test(rest[i + 1]) && !rest[i + 1].startsWith('-')) vals.push(rest[++i]); return vals; };
    let m;
    if (t === '--transport' || t === '-t') { transport = rest[++i] || ''; continue; }
    if ((m = /^--transport=(.+)$/.exec(t))) { transport = m[1]; continue; }
    if (t === '--scope' || t === '-s') { i++; continue; }
    if (/^--scope=/.test(t)) continue;
    if (t === '--env' || t === '-e') { const first = rest[++i]; for (const kv of [first, ...takeVar(/^[A-Za-z_][A-Za-z0-9_]*=/)]) { if (!kv) continue; const eq = kv.indexOf('='); if (eq > 0) s.env[kv.slice(0, eq)] = kv.slice(eq + 1); else s.env[kv] = ''; } continue; }
    if ((m = /^--env=(.+)$/.exec(t))) { const eq = m[1].indexOf('='); s.env[m[1].slice(0, eq)] = m[1].slice(eq + 1); continue; }
    if (t === '--header' || t === '-H') { const first = rest[++i]; for (const h of [first, ...takeVar(/^[A-Za-z0-9-]+\s*:/)]) { if (!h) continue; const c = h.indexOf(':'); if (c > 0) s.headers[h.slice(0, c).trim()] = h.slice(c + 1).trim(); } continue; }
    if (t === '--url') { s.url = rest[++i]; continue; }
    if (t === '--bearer-token-env-var') { s.headers.Authorization = 'Bearer ${' + rest[++i] + '}'; continue; }
    if (t === '--callback-port' || t === '--client-id' || t === '--client-secret' || t === '--description' || t === '--timeout') { i++; continue; }
    if (t.startsWith('-') && !pos.length && t.length > 1) continue; // unknown flag
    pos.push(t);
  }
  if (isJson) {
    const name = pos[0]; let j; try { j = looseJson(pos.slice(1).join(' ')); } catch { return { error: 'add-json needs a JSON object after the name' }; }
    const sv = fromObject(j, name); return sv ? { servers: [sv] } : { error: 'No command or url in that JSON' };
  }
  const name = pos[0] || '';
  if (after && after.length) { s.command = after[0]; s.args = after.slice(1); }
  else if (!s.url && pos[1]) {
    if (/^https?:\/\//i.test(pos[1]) || transport === 'http' || transport === 'sse') s.url = pos[1];
    else { s.command = pos[1]; s.args = pos.slice(2); }
  }
  if (!s.url && !s.command) return { error: 'That command has no server in it (no URL and no program to run)' };
  if (s.url) s.command = '';
  s.name = name; if (transport === 'sse') s.notes.push('Marked as an SSE server. Fabro speaks Streamable HTTP; the test will tell if it works.');
  liftDockerEnv(s); fixLauncher(s);
  return { servers: [finalize(s)] };
}

function parseLine(line) {
  const t = tokenize(line);
  if (!t.length) return null;
  // env prefix:  KEY=val KEY2=val npx …   |  env KEY=val npx …
  const env = {}; let i = 0;
  if (t[0] === 'env') i = 1;
  while (i < t.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(t[i])) { const eq = t[i].indexOf('='); env[t[i].slice(0, eq)] = t[i].slice(eq + 1); i++; }
  const tk = t.slice(i);
  if (!tk.length) return { error: 'There is only an environment variable in that line, no command' };
  const head = path.basename(tk[0]).toLowerCase().replace(/\.(exe|cmd|bat)$/, '');
  if (['claude', 'codex', 'gemini', 'qwen', 'amp', 'opencode'].includes(head) && tk.includes('mcp') && (tk.includes('add') || tk.includes('add-json'))) { const r = parseCliAdd(tk); if (r.servers) r.servers.forEach((s) => Object.assign(s.env, env)); return r; }
  if (head === 'code' || head === 'code-insiders' || head === 'cursor') {
    const k = tk.findIndex((x) => x === '--add-mcp'); if (k >= 0 && tk[k + 1]) { try { const j = looseJson(tk[k + 1]); const sv = fromObject(j, j.name || ''); if (sv) return { servers: [sv] }; } catch {} return { error: 'Could not read the JSON after --add-mcp' }; }
  }
  if (['npm', 'pnpm', 'yarn', 'pip', 'pip3', 'brew', 'apt', 'apt-get', 'winget', 'choco', 'cargo', 'go'].includes(head) && /^(i|install|add|get)$/.test(tk[1] || '') && !(head === 'pnpm' && tk[1] === 'dlx')) return { error: 'That line installs a package but does not start a server. Paste the line that runs it (usually starts with npx, uvx or docker).' };
  if (/^https?:\/\//i.test(tk[0]) && tk.length === 1) { const s = newServer('url'); s.url = tk[0]; return { servers: [finalize(s)] }; }
  if (LAUNCHERS.has(head) || /^[./~]|^[a-zA-Z]:[\\/]/.test(tk[0])) {
    const s = newServer('command'); s.command = tk[0]; s.args = tk.slice(1); Object.assign(s.env, env);
    liftDockerEnv(s); fixLauncher(s);
    return { servers: [finalize(s)] };
  }
  // a bare package name
  if (tk.length === 1 && (/^@[\w.-]+\/[\w.-]+(@[\w.-]+)?$/.test(tk[0]) || (/^[\w.-]*mcp[\w.-]*(@[\w.-]+)?$/i.test(tk[0]) && tk[0].length > 4))) {
    const s = newServer('package'); s.command = 'npx'; s.args = ['-y', tk[0]]; s.notes.push('Taken as an npm package and run with npx. If it is a Python package, paste "uvx name" instead.'); return { servers: [finalize(s)] };
  }
  return null;
}

// Main entry. Never throws.
function parse(text, opts = {}) {
  const raw = String(text == null ? '' : text);
  const out = { ok: false, servers: [], errors: [], format: '' };
  if (!raw.trim()) { out.errors.push('Nothing to read yet'); return out; }
  if (raw.length > 400000) { out.errors.push('That is too long to be a server definition'); return out; }
  const trimmed = raw.trim();
  const unfenced = trimmed.replace(/^```[a-zA-Z]*\n([\s\S]*?)\n?```\s*$/, '$1').trim();
  try {
    const isToml = /^\s*\[mcp_servers[.\]]/m.test(unfenced);
    if (!isToml && (/^[{[]/.test(unfenced) || /^"[^"\n]+"\s*:\s*\{/.test(unfenced))) {
      let j = looseJson(unfenced); if (Array.isArray(j)) j = { servers: Object.fromEntries(j.filter((x) => x && x.name).map((x) => [x.name, x])) };
      const list = fromJsonValue(j); out.format = 'json';
      if (!list.length) out.errors.push('That JSON has no server in it. A server needs a "command" (to run a program) or a "url".');
      else out.servers = list;
    } else if (isToml) {
      const tml = parseToml(unfenced); out.format = 'toml';
      const m = tml.mcp_servers || {};
      for (const [k, v] of Object.entries(m)) { const s = fromObject(v, k); if (s) out.servers.push(s); }
      if (!out.servers.length) out.errors.push('No server found in that TOML');
    } else {
      out.format = 'command';
      for (const line of logicalLines(unfenced)) {
        const r = parseLine(line);
        if (!r) { out.errors.push(`Not sure what to do with: ${line.slice(0, 80)}`); continue; }
        if (r.error) out.errors.push(r.error); else out.servers.push(...r.servers);
      }
    }
  } catch (e) { out.errors.push(`Could not read that: ${String(e.message).slice(0, 120)}`); }
  // unique names (against what is already installed and within this paste)
  const taken = new Set([...(opts.existingNames || existingNames())].map((n) => String(n).toLowerCase()));
  for (const s of out.servers) {
    let n = s.name || 'server'; n = n.replace(/[^a-zA-Z0-9_ -]+/g, '-').slice(0, 32) || 'server';
    let u = n; let i = 2; while (taken.has(u.toLowerCase())) u = `${n}-${i++}`;
    if (u !== n) s.notes.push(`Name "${n}" is already used: using "${u}".`);
    s.name = u; taken.add(u.toLowerCase());
  }
  out.ok = out.servers.length > 0;
  return out;
}

// ───────────────────────────── values for needs[] ─────────────────────────────
// values: { "env:NAME": "…", "header:NAME": "…", "arg:3": "…" }  (arg values replace the placeholder argument)
const needKey = (n) => `${n.where}:${n.name !== undefined ? n.name : n.index}`;
function applyValues(server, values = {}) {
  const s = JSON.parse(JSON.stringify(server));
  for (const n of s.needs || []) {
    const v = values[needKey(n)];
    if (v === undefined || v === '') continue;
    if (n.where === 'env') s.env[n.name] = String(v);
    else if (n.where === 'header') s.headers[n.name] = (n.prefix || '') + String(v).replace(/^(Bearer|Basic|Token)\s+/i, '');
    else if (n.where === 'arg') s.args[n.index] = String(v);
    else if (n.where === 'argAppend') { s.args.push(String(v)); n.satisfied = true; }
  }
  return s;
}
function missing(server) {
  const out = [];
  for (const n of server.needs || []) {
    if (!n.required) continue;
    if (n.where === 'env' && !server.env[n.name]) out.push(n);
    else if (n.where === 'header' && !server.headers[n.name]) out.push(n);
    else if (n.where === 'arg' && isPlaceholder(server.args[n.index])) out.push(n);
    else if (n.where === 'argAppend' && !n.satisfied) out.push(n);
  }
  return out;
}

// ───────────────────────────── prerequisites ─────────────────────────────
const TOOLS = {
  node: { cmds: ['node', 'npx', 'npm', 'pnpm', 'yarn', 'bunx'], label: 'Node.js', help: 'Install Node.js (it includes npx) from https://nodejs.org, then restart Fabro.' },
  uv: { cmds: ['uvx', 'uv'], label: 'uv (Python tool runner)', help: 'Install uv from https://docs.astral.sh/uv/ , then restart Fabro. It provides the uvx command.' },
  docker: { cmds: ['docker', 'podman'], label: 'Docker', help: 'Install Docker Desktop from https://www.docker.com/products/docker-desktop/ and start it, then restart Fabro.' },
  python: { cmds: ['python', 'python3', 'py', 'pip', 'pipx'], label: 'Python', help: 'Install Python from https://www.python.org/downloads/ , then restart Fabro.' },
  deno: { cmds: ['deno'], label: 'Deno', help: 'Install Deno from https://deno.com, then restart Fabro.' },
  bun: { cmds: ['bun'], label: 'Bun', help: 'Install Bun from https://bun.sh, then restart Fabro.' },
};
const toolOf = (cmd) => Object.entries(TOOLS).find(([, t]) => t.cmds.includes(cmd));
async function which(cmd, env) {
  const win = process.platform === 'win32';
  if (/[\\/]/.test(cmd)) { try { await fsp.access(cmd, fs.constants.X_OK); return cmd; } catch { return win && fs.existsSync(cmd) ? cmd : ''; } }
  const exts = win ? String(env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';') : [''];
  for (const d of String(env.PATH || env.Path || '').split(path.delimiter)) {
    if (!d) continue;
    for (const e of exts) { const p = path.join(d, cmd + (win ? e.toLowerCase() : e)); try { const st = await fsp.stat(p); if (st.isFile()) return p; } catch {} }
  }
  return '';
}
async function prereq(config) {
  const items = [];
  if (config.url) return { ok: true, items };
  const cmd = path.basename(String(config.command || '')).replace(/\.(exe|cmd|bat)$/i, '');
  const env = mcp().launchEnv ? mcp().launchEnv({ env: {} }) : process.env;
  const found = await which(String(config.command || ''), env);
  const known = toolOf(cmd);
  const t = known ? known[1] : null;
  items.push({ tool: cmd, label: t ? t.label : cmd, found: !!found, path: found, help: found ? '' : (t ? t.help : `"${config.command}" was not found on this computer. Install it, or give the full path to the program.`) });
  // npx-launched servers may need node itself; uvx needs python at runtime (uv fetches it) so no check
  return { ok: items.every((i) => i.found), items };
}

// ───────────────────────────── diagnosing a failed test ─────────────────────────────
function diagnose(r, cfg) {
  const blob = `${r.error || ''}\n${r.stderr || ''}`;
  const rules = [
    [/ENOENT|not found|is not recognized|No such file or directory/i, 'The program could not be started: it is not installed or not on the PATH.', 'Install it (see the prerequisites above), then restart Fabro so it sees the new PATH.'],
    [/Cannot connect to the Docker daemon|docker daemon|error during connect|pipe\/docker|Is the docker daemon running/i, 'Docker is installed but not running.', 'Start Docker Desktop, wait until it says it is running, then test again.'],
    [/E404|404 Not Found.*(registry|npm)|npm ERR! 404|No matching distribution|Package .* not found|not found in package registry|No solution found/i, 'The package name or version does not exist.', 'Check the spelling of the package name in the command.'],
    [/EACCES|permission denied/i, 'The system refused to run it (permissions).', 'Check that the program or folder is yours and not locked; avoid system folders.'],
    [/ModuleNotFoundError|Cannot find module|ERR_MODULE_NOT_FOUND/i, 'A piece the server needs is missing.', 'Reinstall the server, or run it once in a terminal to see what it asks for.'],
    [/401|403|unauthori[sz]ed|forbidden|invalid.*(token|key)|bad credentials|authentication/i, 'The server refused the key or token.', 'Check the key you entered: it may be wrong, expired or missing a permission.'],
    [/ECONNREFUSED|ENOTFOUND|fetch failed|getaddrinfo|network|ETIMEDOUT|certificate/i, 'Could not reach the address.', 'Check your internet connection and the address. Local servers must already be running.'],
    [/HTTP 404/i, 'The address answered but there is no MCP server there.', 'Check the URL (many servers end with /mcp).'],
    [/HTTP 405|HTTP 406|text\/event-stream/i, 'The server answered but not in the way Fabro speaks (Streamable HTTP).', 'It may be an older SSE-only server. Look for a "streamable HTTP" address in its documentation.'],
    [/timed out/i, cfg && cfg.command && /^(npx|uvx|docker|pipx|bunx)/.test(path.basename(String(cfg.command))) ? 'It did not answer in time. The first run downloads the server, which can take a minute.' : 'It did not answer in time.', 'Try again once. If it still fails, run the same command in a terminal and read what it prints.'],
    [/Server exited/i, 'The program started and then stopped by itself.', 'Read the messages below: they usually say what is missing (a key, a folder, a version).'],
    [/Unexpected token|not valid JSON/i, 'The program prints text that is not part of the MCP protocol.', 'It may not be an MCP server, or it needs an option such as --stdio.'],
  ];
  for (const [re, cause, hint] of rules) if (re.test(blob)) return { cause, hint };
  return { cause: 'The server did not complete the MCP handshake.', hint: 'Read the messages below, or run the same command in a terminal.' };
}

function checkConfig(c) {
  if (!c || typeof c !== 'object') return 'No server to test';
  if (c.url) { try { const u = new URL(c.url); if (!/^https?:$/.test(u.protocol)) return 'The address must start with https://'; if (u.protocol === 'http:' && !/^(localhost|127\.|\[::1\])/.test(u.hostname)) return 'Remote servers must use https://'; } catch { return 'That address is not valid'; } return ''; }
  if (!c.command || !String(c.command).trim()) return 'No command to run';
  return '';
}

// ───────────────────────────── drafts (renderer never gets secret values back) ─────────────────────────────
const drafts = new Map();
function maskDraft(s) {
  const id = crypto.randomBytes(6).toString('hex');
  drafts.set(id, { at: Date.now(), server: s });
  for (const [k, v] of drafts) if (Date.now() - v.at > 30 * 60000) drafts.delete(k);
  const view = JSON.parse(JSON.stringify(s));
  for (const n of view.needs || []) if (n.set) n.hasValue = true;
  for (const [k, v] of Object.entries(view.env)) if (isSecretName(k) && v) view.env[k] = '••••';
  for (const [k, v] of Object.entries(view.headers)) if (v && (isSecretName(k) || /^(Bearer|Basic)\s/i.test(v))) view.headers[k] = '••••';
  return { ...view, draftId: id, command_line: commandLine(s) };
}
function commandLine(s) {
  if (s.url) return s.url;
  const q = (x) => (/[\s"']/.test(x) ? JSON.stringify(x) : x);
  return [s.command, ...(s.args || [])].map((x) => q(String(x))).join(' ');
}
const draft = (id) => (drafts.get(id) || {}).server;
function fromDraft(spec) {
  // spec: { draftId, name?, values? } or a server object
  if (spec && spec.draftId) {
    const d = draft(spec.draftId); if (!d) throw new Error('This draft expired. Paste it again.');
    const s = applyValues(d, spec.values || {}); if (spec.name) s.name = String(spec.name).slice(0, 32); return s;
  }
  return applyValues(spec, spec.values || {});
}

// ───────────────────────────── test / add ─────────────────────────────
async function test(config, opts = {}) {
  const s = config && config.draftId ? fromDraft(config) : applyValues(config || {}, (config || {}).values || {});
  const bad = checkConfig(s);
  if (bad) return { ok: false, error: bad, cause: bad, hint: '', tools: [], count: 0 };
  const m = missing(s);
  if (m.length) return { ok: false, error: `Missing: ${m.map((n) => n.label).join(', ')}`, cause: 'Something is still missing.', hint: m.map((n) => n.label).join(', '), missing: m.map(needKey), tools: [], count: 0 };
  const pre = await prereq(s);
  if (!pre.ok) return { ok: false, error: pre.items[0].help, cause: `${pre.items[0].label} is not installed.`, hint: pre.items[0].help, prereq: pre, tools: [], count: 0 };
  const r = await mcp().probe(s, opts.timeout || 60000);
  const res = { ok: r.ok || !!r.auth, ready: !!r.ok, auth: !!r.auth, tools: r.tools || [], count: (r.tools || []).length, serverInfo: r.serverInfo || null, error: r.error || '', stderr: scrub(r.stderr || '', s), ms: r.ms, prereq: pre };
  if (r.auth) { res.cause = 'The server wants you to sign in.'; res.hint = 'Fabro can sign in with your browser after you add it (button "Sign in" on the server).'; }
  else if (!r.ok) Object.assign(res, diagnose(r, s));
  return res;
}
// stderr can echo secrets that were passed in: hide every value we hold
function scrub(text, s) {
  let t = String(text);
  const secrets = [...Object.entries(s.env || {}), ...Object.entries(s.headers || {})].filter(([k, v]) => v && String(v).length >= 6 && (isSecretName(k) || /^(Bearer|Basic)\s/i.test(String(v)))).map(([, v]) => String(v).replace(/^(Bearer|Basic|Token)\s+/i, ''));
  for (const v of secrets) t = t.split(v).join('••••');
  return t.slice(-4000);
}

// opts: { enabled?: boolean (default true), note? }
async function add(config, opts = {}) {
  const s = config && config.draftId ? fromDraft(config) : applyValues(config || {}, (config || {}).values || {});
  const bad = checkConfig(s); if (bad) return { ok: false, error: bad };
  const m = missing(s); if (m.length && opts.enabled !== false) return { ok: false, error: `Missing: ${m.map((n) => n.label).join(', ')}`, missing: m.map(needKey) };
  const env = {}; const secretEnv = {}; const headers = {}; const secretHeaders = {};
  const secretNeeds = new Set((s.needs || []).filter((n) => n.secret).map(needKey));
  for (const [k, v] of Object.entries(s.env || {})) { if (v === '') continue; (isSecretName(k) || secretNeeds.has(`env:${k}`) ? secretEnv : env)[k] = v; }
  for (const [k, v] of Object.entries(s.headers || {})) { if (v === '') continue; (isSecretName(k) || /^(Bearer|Basic)\s/i.test(v) || secretNeeds.has(`header:${k}`) ? secretHeaders : headers)[k] = v; }
  const enabled = opts.enabled !== false && config.enabled !== false;
  const view = await mcp().add({ name: s.name, command: s.command || undefined, args: s.args, url: s.url || undefined, cwd: s.cwd, env, headers: Object.keys(headers).length ? headers : undefined, secretEnv, secretHeaders, enabled, note: opts.note });
  const added = view.find((v) => v.name === s.name) || view[view.length - 1];
  return { ok: true, server: added, servers: view };
}

// ───────────────────────────── well-known servers ─────────────────────────────
// Package names verified on npm / PyPI and against github.com/modelcontextprotocol/servers (README) and the vendors' repos.
// Left out on purpose: the SQLite, Puppeteer and (npm) GitHub reference servers, which their maintainers archived.
const CATALOG = [
  { id: 'filesystem', icon: 'folder', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem'], needs: [{ where: 'argAppend', name: 'folder', label: 'Folder it may read and write', kind: 'folder', secret: false, required: true }] },
  { id: 'fetch', icon: 'globe', command: 'uvx', args: ['mcp-server-fetch'], needs: [] },
  { id: 'memory', icon: 'brain', command: 'npx', args: ['-y', '@modelcontextprotocol/server-memory'], needs: [] },
  { id: 'git', icon: 'git', command: 'uvx', args: ['mcp-server-git', '--repository'], needs: [{ where: 'argAppend', name: 'folder', label: 'Git folder (repository)', kind: 'folder', secret: false, required: true }] },
  { id: 'time', icon: 'clock', command: 'uvx', args: ['mcp-server-time'], needs: [] },
  { id: 'sequential-thinking', icon: 'list', command: 'npx', args: ['-y', '@modelcontextprotocol/server-sequential-thinking'], needs: [] },
  { id: 'playwright', icon: 'browser', command: 'npx', args: ['-y', '@playwright/mcp@latest'], needs: [] },
  { id: 'github', icon: 'git', url: 'https://api.githubcopilot.com/mcp/', headers: { Authorization: '' }, needs: [{ where: 'header', name: 'Authorization', prefix: 'Bearer ', label: 'GitHub personal access token', secret: true, required: true, kind: 'password' }], link: 'https://github.com/settings/personal-access-tokens' },
  { id: 'brave-search', icon: 'search', command: 'npx', args: ['-y', '@brave/brave-search-mcp-server', '--transport', 'stdio'], env: { BRAVE_API_KEY: '' }, needs: [{ where: 'env', name: 'BRAVE_API_KEY', label: 'Brave Search API key', secret: true, required: true, kind: 'password' }], link: 'https://brave.com/search/api/' },
];
function catalog() {
  return CATALOG.map((c) => {
    const s = newServer('catalog'); s.name = c.id; s.command = c.command || ''; s.args = [...(c.args || [])]; s.url = c.url || ''; s.env = { ...(c.env || {}) }; s.headers = { ...(c.headers || {}) };
    s.needs = (c.needs || []).map((n) => ({ ...n }));
    s.type = s.url ? 'http' : 'stdio';
    return { id: c.id, icon: c.icon, link: c.link || '', requires: s.url ? '' : ((toolOf(path.basename(s.command)) || [''])[0]), server: s };
  });
}

// ───────────────────────────── configs of other apps (read-only) ─────────────────────────────
function appPaths() {
  const home = os.homedir(); const win = process.platform === 'win32'; const mac = process.platform === 'darwin';
  const appdata = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
  const cfgDir = mac ? path.join(home, 'Library', 'Application Support') : win ? appdata : (process.env.XDG_CONFIG_HOME || path.join(home, '.config'));
  const codexHome = process.env.CODEX_HOME || path.join(home, '.codex');
  const list = [
    { app: 'Claude Desktop', file: path.join(cfgDir, 'Claude', 'claude_desktop_config.json'), fmt: 'json' },
    { app: 'Claude Code', file: path.join(home, '.claude.json'), fmt: 'claude-code' },
    { app: 'Cursor', file: path.join(home, '.cursor', 'mcp.json'), fmt: 'json' },
    { app: 'VS Code', file: path.join(cfgDir, 'Code', 'User', 'mcp.json'), fmt: 'json' },
    { app: 'VS Code', file: path.join(cfgDir, 'Code', 'User', 'settings.json'), fmt: 'json' },
    { app: 'VS Code Insiders', file: path.join(cfgDir, 'Code - Insiders', 'User', 'mcp.json'), fmt: 'json' },
    { app: 'Codex', file: path.join(codexHome, 'config.toml'), fmt: 'toml' },
    { app: 'LM Studio', file: path.join(home, '.lmstudio', 'mcp.json'), fmt: 'json' },
    { app: 'Windsurf', file: path.join(home, '.codeium', 'windsurf', 'mcp_config.json'), fmt: 'json' },
    { app: 'Gemini CLI', file: path.join(home, '.gemini', 'settings.json'), fmt: 'json' },
  ];
  if (win) { // Claude Desktop from the Microsoft Store keeps its files in a package folder
    try { for (const d of fs.readdirSync(path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'Packages'))) if (/^(Claude_|AnthropicPBC)/i.test(d)) list.push({ app: 'Claude Desktop', file: path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'Packages', d, 'LocalCache', 'Roaming', 'Claude', 'claude_desktop_config.json'), fmt: 'json' }); } catch {}
  }
  let folders = []; try { folders = ((require('./store').getSettings().agent) || {}).folders || []; } catch {}
  for (const f of folders.slice(0, 20)) {
    list.push({ app: 'Claude Code', file: path.join(f, '.mcp.json'), fmt: 'json', project: f }, { app: 'Cursor', file: path.join(f, '.cursor', 'mcp.json'), fmt: 'json', project: f }, { app: 'VS Code', file: path.join(f, '.vscode', 'mcp.json'), fmt: 'json', project: f });
  }
  return list;
}
async function readConfigFile(p) {
  const st = await fsp.stat(p); if (!st.isFile() || st.size > 8 * 1048576) return null;
  return fsp.readFile(p, 'utf8');
}
async function findConfigs() {
  const have = new Set(existingNames().map((n) => n.toLowerCase()));
  const out = []; const seen = new Set();
  for (const e of appPaths()) {
    if (seen.has(e.file)) continue; seen.add(e.file);
    let text; try { text = await readConfigFile(e.file); } catch { continue; }
    if (text == null) continue;
    const item = { id: crypto.createHash('sha1').update(e.file).digest('hex').slice(0, 10), app: e.app, file: e.file, project: e.project || '', servers: [], error: '' };
    try {
      let servers = [];
      if (e.fmt === 'toml') { const t = parseToml(text); for (const [k, v] of Object.entries(t.mcp_servers || {})) { const s = fromObject(v, k); if (s) servers.push(s); } }
      else if (e.fmt === 'claude-code') {
        const j = looseJson(text);
        servers = fromJsonValue({ mcpServers: j.mcpServers || {} }).map((s) => ({ ...s, scope: 'all projects' }));
        for (const [dir, pj] of Object.entries(j.projects || {})) for (const s of fromJsonValue({ mcpServers: (pj && pj.mcpServers) || {} })) servers.push({ ...s, scope: `project ${path.basename(dir)}` });
      } else { const j = looseJson(text); servers = fromJsonValue(j); }
      item.servers = servers.map((s, i) => ({ ...s, key: `${item.id}:${i}`, already: have.has(String(s.name).toLowerCase()) }));
    } catch (err) { item.error = `Could not read this file (${String(err.message).slice(0, 80)})`; }
    if (item.servers.length || item.error) out.push(item);
  }
  return out;
}
// For the renderer: same list with secret values replaced; keys stay valid for importFrom().
let lastFound = [];
async function findConfigsMasked() {
  lastFound = await findConfigs();
  return lastFound.map((it) => ({ ...it, servers: it.servers.map((s) => { const v = JSON.parse(JSON.stringify(s)); for (const [k, x] of Object.entries(v.env)) if (x && isSecretName(k)) v.env[k] = '••••'; for (const [k, x] of Object.entries(v.headers)) if (x && (isSecretName(k) || /^(Bearer|Basic)\s/i.test(x))) v.headers[k] = '••••'; return { ...v, command_line: commandLine(s) }; }) }));
}
// selection: array of server keys from findConfigs()/findConfigsMasked(). Imported servers are saved OFF.
async function importFrom(selection, pool) {
  const all = pool || (lastFound.length ? lastFound : await findConfigs());
  const added = []; const skipped = [];
  const taken = new Set(existingNames().map((n) => n.toLowerCase()));
  for (const it of all) for (const s of it.servers) {
    if (!selection.includes(s.key)) continue;
    let name = s.name; let i = 2; while (taken.has(name.toLowerCase())) name = `${s.name}-${i++}`;
    taken.add(name.toLowerCase());
    const r = await add({ ...s, name }, { enabled: false, note: `Imported from ${it.app}` });
    if (r.ok) added.push(name); else skipped.push({ name, error: r.error });
  }
  return { ok: true, added, skipped, servers: mcp().view() };
}

// ───────────────────────────── IPC ─────────────────────────────
function init(ipcMain) {
  const h = (ch, fn) => ipcMain.handle(`mcpeasy:${ch}`, (_e, ...a) => fn(...a));
  h('parse', (text) => { const r = parse(text); return { ...r, servers: r.servers.map(maskDraft) }; });
  h('catalog', () => catalog().map((c) => ({ ...c, server: maskDraft(c.server) })));
  h('prereq', (spec) => prereq(fromDraft(spec)));
  h('test', (spec) => test(spec));
  h('add', (spec) => add(spec));
  h('found', () => findConfigsMasked());
  h('import', (keys) => importFrom(keys));
  h('setTool', (id, tool, on) => mcp().setToolEnabled(id, tool, on));
}

module.exports = { parse, test, add, prereq, catalog, findConfigs, findConfigsMasked, importFrom, applyValues, missing, diagnose, tokenize, parseToml, looseJson, isSecretName, commandLine, nameFrom, init, appPaths };

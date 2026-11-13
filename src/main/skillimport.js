// Skill import / export. An imported skill is untrusted: nothing here ever executes anything.
//   preview(source)            → validates + stages a source in memory, returns what is inside (nothing is written)
//   install(previewId, opts)   → writes the staged skills into the open account's skills folder
//   exportSkill(name, file)    → .skill (zip) of an installed skill
//   findOnComputer()           → skills of other tools on this computer (Claude Code, plugins, Codex, …)
// Sources: { type:'file'|'folder'|'text'|'url'|'found', path|text|url|id } or a plain string (path, URL or pasted text).
// Formats: .skill / .zip (one folder with SKILL.md, or several skills), a folder, a single SKILL.md, pasted text, GitHub URL.
// See docs/v02/api-install.md.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { readZip, writeZip, ZipError, DEFAULTS } = require('./ziplite');
const compat = require('./skillcompat');

const LIMITS = { ...DEFAULTS, maxSkills: 80, maxDescription: 1024, maxName: 64, maxSkillMd: 400 * 1024 };
const SCRIPT_EXT = new Set(['.py', '.sh', '.bash', '.zsh', '.js', '.mjs', '.cjs', '.ts', '.ps1', '.bat', '.cmd', '.rb', '.pl', '.php', '.lua', '.luau', '.vbs', '.command', '.fish']);
const BINARY_EXT = new Set(['.exe', '.dll', '.msi', '.scr', '.com', '.dmg', '.app', '.pkg', '.jar', '.apk', '.so', '.dylib', '.bin', '.appimage', '.deb', '.rpm', '.sys']);
const JUNK = (p) => /(^|\/)(__MACOSX|\.git|\.svn|node_modules|__pycache__|\.idea|\.vscode)(\/|$)/.test(p) || /(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini)$/i.test(p) || /\.pyc$/.test(p);
const TEXT_EXT = /\.(md|txt|json|ya?ml|toml|csv|py|sh|bash|js|mjs|cjs|ts|ps1|bat|cmd|rb|pl|php|lua|luau|html?|css|xml|ini|cfg)$/i;

class ImportError extends Error { constructor(msg, code) { super(msg); this.code = code || 'IMPORT_FAILED'; } }

const skills = () => require('./agent/skills');

// ───────────────────────────── names & front matter ─────────────────────────────
function sanitizeName(s) {
  const n = String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '').slice(0, LIMITS.maxName).replace(/-+$/g, '');
  return n || 'skill';
}
const cleanText = (b) => b.toString('utf8').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
function firstParagraph(body) {
  for (const block of String(body).split(/\n\s*\n/)) {
    const t = block.replace(/^#+\s.*$/gm, '').replace(/[*_`>#-]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (t.length > 8) return t.slice(0, 300);
  }
  return '';
}
function firstHeading(body) { const m = String(body).match(/^#{1,3}\s+(.+)$/m); return m ? m[1].trim() : ''; }
function yamlStr(v) { return /^[\w][\w .,'()/+-]*$/.test(v) && !/^(true|false|null|yes|no|\d)/i.test(v) && !/:\s|\s#/.test(v) ? v : JSON.stringify(v); }

// Returns the SKILL.md text to install (normalised, front matter completed) plus what was derived.
function normalizeSkillMd(text, hint, forceName) {
  const { meta, body } = skills().parseFront(text);
  const notes = [];
  let name = meta.name ? meta.name : '';
  let desc = (meta.description || '').replace(/\s+/g, ' ').trim();
  if (!name) { name = firstHeading(body) || hint || 'skill'; notes.push('no name in the front matter: derived from ' + (firstHeading(body) ? 'the title' : 'the folder')); }
  if (!desc) { desc = firstParagraph(body); notes.push('no description: taken from the first paragraph'); }
  const clean = sanitizeName(forceName || name);
  if (!forceName && clean !== name) notes.push(`name "${String(name).slice(0, 60)}" simplified to "${clean}"`);
  if (desc.length > LIMITS.maxDescription) { desc = desc.slice(0, LIMITS.maxDescription); notes.push('description shortened to 1024 characters'); }
  const hadFront = /^﻿?---[ \t]*\r?\n/.test(text);
  let out;
  if (hadFront && meta.name && meta.description && !forceName && clean === meta.name) out = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  else {
    // keep other front matter lines (license, allowed-tools, metadata…) but replace name/description
    const m = String(text).replace(/^﻿/, '').replace(/\r\n?/g, '\n').match(/^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/);
    const keep = [];
    if (m) {
      const lines = m[1].split('\n'); let skip = false;
      for (const l of lines) {
        if (/^(name|description):/.test(l)) { skip = true; continue; }
        if (skip && (/^[ \t]/.test(l) || l.trim() === '')) continue;
        skip = false; keep.push(l);
      }
    }
    out = `---\nname: ${clean}\ndescription: ${yamlStr(desc)}\n${keep.filter((l) => l.trim()).join('\n')}${keep.some((l) => l.trim()) ? '\n' : ''}---\n\n${body.replace(/^\n+/, '')}`;
  }
  return { text: out, name: forceName ? clean : clean, description: desc, notes, meta, body };
}

// ───────────────────────────── analysis ─────────────────────────────
const NET_RE = /\b(curl|wget|Invoke-WebRequest|Invoke-RestMethod|requests\.(get|post)|urllib|httpx|fetch\(|axios|npm (i|install)|pip3? install|git clone|apt(-get)? install|brew install)\b|https?:\/\/(?!(localhost|127\.0\.0\.1))/i;
const SHELL_RE = /\b(rm -rf|sudo|chmod|powershell|cmd\.exe|subprocess|os\.system|child_process|exec\(|eval\(|bash -c|sh -c|Remove-Item)\b/i;

function analyzeSkill(sk) {
  const warnings = [];
  const md = sk.files.find((f) => f.path.toLowerCase() === 'skill.md');
  const norm = normalizeSkillMd(cleanText(md.data), sk.hint);
  const scripts = []; const blocked = []; const filesView = [];
  let netHit = false; let shellHit = false;
  for (const f of sk.files) {
    const ext = path.extname(f.path).toLowerCase();
    const isBin = BINARY_EXT.has(ext);
    const isScript = SCRIPT_EXT.has(ext) || /^scripts\//i.test(f.path);
    if (isBin) blocked.push(f.path);
    else if (isScript) scripts.push(f.path);
    if (!isBin && (isScript || f === md) && TEXT_EXT.test(f.path) && f.data.length < 400000) {
      const t = f.data.toString('utf8');
      if (NET_RE.test(t)) netHit = true;
      if (isScript && SHELL_RE.test(t)) shellHit = true;
    }
    filesView.push({ path: f.path, size: f.data.length, script: isScript && !isBin, blocked: isBin });
  }
  const refs = compat.analyze(md.data.toString('utf8'), norm.meta['allowed-tools']);
  if (scripts.length) warnings.push({ kind: 'scripts', text: `Ships ${scripts.length} script${scripts.length > 1 ? 's' : ''}. Fabro never runs them on import, but the AI may run them later if you allow it.`, files: scripts.slice(0, 20) });
  if (blocked.length) warnings.push({ kind: 'binary', text: `Contains ${blocked.length} program file${blocked.length > 1 ? 's' : ''} (${blocked.slice(0, 3).join(', ')}). They will not be installed.`, files: blocked });
  if (netHit) warnings.push({ kind: 'network', text: 'Mentions downloading or contacting the internet (curl, pip install, web addresses…).' });
  if (shellHit || refs.mapped.some((m) => m.name === 'Bash' || m.name === 'bash_tool') || /\bBash\b/.test(norm.meta['allowed-tools'] || '')) warnings.push({ kind: 'shell', text: 'Asks the AI to run commands on your computer. Each command still asks for your permission, as usual.' });
  if (sk.files.length === 1 && md) { /* single file skill: fine */ }
  const nameFromDir = !norm.meta.name;
  return {
    key: sk.key, name: norm.name, dirName: norm.name, description: norm.description, notes: norm.notes, license: norm.meta.license || '',
    files: filesView, fileCount: filesView.length, bytes: sk.files.reduce((a, f) => a + f.data.length, 0), scripts, warnings,
    tools: { mapped: refs.mapped, unmapped: refs.unmapped }, usesMnt: refs.mnt, derivedName: nameFromDir, bodyChars: norm.body.length, skillMd: norm.text,
  };
}

// ───────────────────────────── building skill sets from raw files ─────────────────────────────
// files: [{ path (posix, relative), data }]; hint: name to use when the SKILL.md is at the archive root.
function buildSkills(files, hint) {
  files = files.filter((f) => !JUNK(f.path));
  const roots = files.filter((f) => /(^|\/)skill\.md$/i.test(f.path)).map((f) => f.path.replace(/(^|\/)?skill\.md$/i, '').replace(/\/$/, ''));
  const uniq = [...new Set(roots)].sort((a, b) => a.split('/').length - b.split('/').length);
  // a SKILL.md nested inside another skill's folder belongs to that skill
  const chosen = [];
  for (const r of uniq) if (!chosen.some((c) => c === '' || r === c || r.startsWith(c + '/'))) chosen.push(r);
  if (chosen.length > LIMITS.maxSkills) throw new ImportError(`Found ${chosen.length} skills; the limit is ${LIMITS.maxSkills}. Import a smaller folder.`, 'IMPORT_TOO_MANY');
  const out = [];
  for (const r of chosen) {
    const prefix = r ? r + '/' : '';
    const mine = files.filter((f) => f.path.startsWith(prefix)).map((f) => ({ path: f.path.slice(prefix.length), data: f.data }));
    const md = mine.find((f) => f.path.toLowerCase() === 'skill.md');
    if (!md || md.data.length > LIMITS.maxSkillMd) { out.push({ error: `${r || hint || 'skill'}: SKILL.md is missing or larger than ${LIMITS.maxSkillMd / 1024} KB` }); continue; }
    // the single top-level folder of a zip is the skill's folder: its name is the best hint
    const dirHint = r ? r.split('/').pop() : hint;
    out.push({ key: crypto.createHash('sha1').update(r + ':' + out.length).digest('hex').slice(0, 8), hint: dirHint, files: mine });
  }
  return out;
}

function fromEntries(entries, hint) {
  return buildSkills(entries.map((e) => ({ path: e.path, data: e.data })), hint);
}

// ───────────────────────────── sources ─────────────────────────────
async function readFolder(dir) {
  const files = []; let total = 0;
  const root = path.resolve(dir);
  const walk = async (d, rel, depth) => {
    if (depth > LIMITS.maxDepth) return;
    for (const e of await fsp.readdir(d, { withFileTypes: true })) {
      const r = rel ? rel + '/' + e.name : e.name;
      if (JUNK(r)) continue;
      if (e.isSymbolicLink()) continue; // never follow links
      if (e.isDirectory()) { await walk(path.join(d, e.name), r, depth + 1); continue; }
      if (!e.isFile()) continue;
      if (files.length >= LIMITS.maxFiles) throw new ImportError(`More than ${LIMITS.maxFiles} files in the folder`, 'IMPORT_TOO_MANY');
      const st = await fsp.stat(path.join(d, e.name));
      if (st.size > LIMITS.maxFile) throw new ImportError(`"${r}" is larger than ${Math.round(LIMITS.maxFile / 1048576)} MB`, 'IMPORT_TOO_BIG');
      total += st.size; if (total > LIMITS.maxTotal) throw new ImportError(`The folder is larger than ${Math.round(LIMITS.maxTotal / 1048576)} MB`, 'IMPORT_TOO_BIG');
      files.push({ path: r, data: await fsp.readFile(path.join(d, e.name)) });
    }
  };
  await walk(root, '', 0);
  return { files, hint: path.basename(root) };
}

function looksZip(buf) { return buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b; }

async function loadFile(p) {
  const st = await fsp.stat(p);
  if (st.isDirectory()) return loadFolder(p);
  if (st.size > LIMITS.maxArchive) throw new ImportError(`That file is larger than ${Math.round(LIMITS.maxArchive / 1048576)} MB`, 'IMPORT_TOO_BIG');
  const buf = await fsp.readFile(p);
  const base = path.basename(p).replace(/\.(skill|zip|md|markdown|txt)$/i, '');
  if (looksZip(buf)) { const z = readZip(buf); return { sets: fromEntries(z.entries, sanitizeName(base)), skipped: z.skipped, label: path.basename(p) }; }
  if (/\.(md|markdown|txt)$/i.test(p)) return { sets: [{ key: 'one', hint: /^skill$/i.test(base) ? '' : base, files: [{ path: 'SKILL.md', data: buf }] }], skipped: [], label: path.basename(p) };
  throw new ImportError('That is not a .skill file, a zip, or a SKILL.md', 'IMPORT_FORMAT');
}
async function loadFolder(p) {
  const f = await readFolder(p);
  let files = f.files;
  const sets = buildSkills(files, f.hint);
  return { sets, skipped: [], label: path.basename(p) };
}
function loadText(text, name) {
  const buf = Buffer.from(String(text), 'utf8');
  if (!buf.length) throw new ImportError('Nothing to import', 'IMPORT_EMPTY');
  if (buf.length > LIMITS.maxSkillMd) throw new ImportError('That text is too long for a SKILL.md', 'IMPORT_TOO_BIG');
  // A few loose words are not a skill: ask for front matter, a title, or at least a couple of lines of instructions.
  const txt = String(text).trim(); const lines = txt.split(/\r?\n/).filter((l) => l.trim()).length;
  if (!/^---\s*\r?\n/.test(txt) && !/^#{1,3}\s+\S/m.test(txt) && (lines < 2 || txt.length < 60)) throw new ImportError('That text does not look like a skill. Paste a whole SKILL.md (a title and instructions), or a link.', 'IMPORT_NOT_SKILL');
  return { sets: [{ key: 'one', hint: name || '', files: [{ path: 'SKILL.md', data: buf }] }], skipped: [], label: 'pasted text' };
}

// ── GitHub / direct links (network: only ever called from preview() on an explicit user action) ──
const GH_HOSTS = new Set(['github.com', 'www.github.com']);
function parseGithub(u) {
  const url = new URL(u);
  if (url.protocol !== 'https:') throw new ImportError('Only https links are accepted', 'IMPORT_URL');
  if (url.username || url.password) throw new ImportError('Links with a password are not accepted', 'IMPORT_URL');
  if (url.hostname === 'raw.githubusercontent.com') {
    const [owner, repo, ...rest] = url.pathname.split('/').filter(Boolean);
    return { kind: 'raw', owner, repo, rest };
  }
  if (GH_HOSTS.has(url.hostname)) {
    const seg = url.pathname.split('/').filter(Boolean);
    if (seg.length < 2) throw new ImportError('That GitHub link has no repository in it', 'IMPORT_URL');
    const [owner, rawRepo, mode, ...rest] = seg; const repo = rawRepo.replace(/\.git$/, '');
    if (!mode) return { kind: 'repo', owner, repo, refParts: [], sub: '' };
    if (mode === 'tree' || mode === 'blob') return { kind: mode, owner, repo, rest };
    return { kind: 'repo', owner, repo, refParts: [], sub: '' };
  }
  return null;
}
async function fetchLimited(url, { max = LIMITS.maxArchive, headers = {}, timeout = 30000 } = {}) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Fabro', Accept: '*/*', ...headers }, redirect: 'follow', signal: AbortSignal.timeout(timeout) });
  if (res.url && !/^https:/.test(res.url)) throw new ImportError('The link redirected to a non-https address', 'IMPORT_URL');
  if (res.status === 404) throw new ImportError('Not found (404). Is the repository public and the link right?', 'IMPORT_NOT_FOUND');
  if (res.status === 403 || res.status === 429) throw new ImportError('GitHub refused the request (rate limit). Try again in a few minutes, or download the folder and drop it here.', 'IMPORT_RATE');
  if (!res.ok) throw new ImportError(`The server answered ${res.status}`, 'IMPORT_HTTP');
  const len = Number(res.headers.get('content-length') || 0);
  if (len > max) throw new ImportError(`That download is larger than ${Math.round(max / 1048576)} MB`, 'IMPORT_TOO_BIG');
  const chunks = []; let n = 0;
  for await (const c of res.body) { n += c.length; if (n > max) throw new ImportError(`That download is larger than ${Math.round(max / 1048576)} MB`, 'IMPORT_TOO_BIG'); chunks.push(Buffer.from(c)); }
  return Buffer.concat(chunks);
}
const ghJson = async (url) => JSON.parse((await fetchLimited(url, { max: 12 * 1048576, headers: { Accept: 'application/vnd.github+json' } })).toString('utf8'));

async function loadGithubTree(g) {
  // tree/blob URL: ref may contain slashes → try 1..3 segments until the API knows the ref
  const rest = g.rest || [];
  let tree = null; let ref = ''; let sub = '';
  for (let n = 1; n <= Math.min(3, rest.length); n++) {
    ref = rest.slice(0, n).join('/'); sub = rest.slice(n).join('/');
    try { tree = await ghJson(`https://api.github.com/repos/${g.owner}/${g.repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`); break; } catch (e) { if (e.code !== 'IMPORT_NOT_FOUND' || n === Math.min(3, rest.length)) throw e; }
  }
  if (!tree) throw new ImportError('Could not read that GitHub link', 'IMPORT_URL');
  if (g.kind === 'blob' && /(^|\/)skill\.md$/i.test(sub)) sub = sub.replace(/\/?skill\.md$/i, '');
  const prefix = sub ? sub.replace(/\/$/, '') + '/' : '';
  const blobs = (tree.tree || []).filter((t) => t.type === 'blob' && t.path.startsWith(prefix) && !JUNK(t.path) && t.mode !== '120000');
  if (blobs.length > LIMITS.maxFiles) throw new ImportError(`That folder has ${blobs.length} files (limit ${LIMITS.maxFiles}). Link to one skill's folder.`, 'IMPORT_TOO_MANY');
  if (blobs.reduce((a, b) => a + (b.size || 0), 0) > LIMITS.maxTotal || blobs.some((b) => (b.size || 0) > LIMITS.maxFile)) throw new ImportError('That folder is too big to import from a link. Download it and drop the folder here.', 'IMPORT_TOO_BIG');
  const files = [];
  let i = 0;
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (i < blobs.length) {
      const b = blobs[i++];
      const data = await fetchLimited(`https://raw.githubusercontent.com/${g.owner}/${g.repo}/${ref.split('/').map(encodeURIComponent).join('/')}/${b.path.split('/').map(encodeURIComponent).join('/')}`, { max: LIMITS.maxFile });
      files.push({ path: b.path.slice(prefix.length), data });
    }
  }));
  const hint = (sub ? sub.split('/').pop() : g.repo);
  return { sets: buildSkills(files, sanitizeName(hint)), skipped: [], label: `github.com/${g.owner}/${g.repo}${sub ? '/' + sub : ''}` };
}
async function loadUrl(u) {
  let g = null; try { g = parseGithub(u); } catch (e) { if (e instanceof ImportError) throw e; throw new ImportError('That is not a valid link', 'IMPORT_URL'); }
  if (g && g.kind === 'repo') {
    const buf = await fetchLimited(`https://api.github.com/repos/${g.owner}/${g.repo}/zipball`, { max: LIMITS.maxArchive });
    const z = readZip(buf);
    // the zipball has one wrapper folder <owner>-<repo>-<sha>/
    const first = z.entries[0] && z.entries[0].path.split('/')[0];
    const entries = z.entries.map((e) => ({ ...e, path: e.path.slice(first.length + 1) })).filter((e) => e.path);
    return { sets: buildSkills(entries.map((e) => ({ path: e.path, data: e.data })), sanitizeName(g.repo)), skipped: z.skipped, label: `github.com/${g.owner}/${g.repo}` };
  }
  if (g && (g.kind === 'tree' || g.kind === 'blob')) return loadGithubTree(g);
  if (g && g.kind === 'raw') { const buf = await fetchLimited(u, { max: LIMITS.maxSkillMd }); return { sets: [{ key: 'one', hint: sanitizeName((g.rest[g.rest.length - 2]) || g.repo), files: [{ path: 'SKILL.md', data: buf }] }], skipped: [], label: u }; }
  // any other https link: a .skill / .zip / SKILL.md
  const url = new URL(u);
  if (url.protocol !== 'https:') throw new ImportError('Only https links are accepted', 'IMPORT_URL');
  const buf = await fetchLimited(u);
  const base = sanitizeName(path.basename(url.pathname).replace(/\.(skill|zip|md)$/i, ''));
  if (looksZip(buf)) { const z = readZip(buf); return { sets: fromEntries(z.entries, base), skipped: z.skipped, label: url.hostname }; }
  if (/\.md$/i.test(url.pathname) || /^---\s*\n/.test(buf.toString('utf8', 0, 8))) return { sets: [{ key: 'one', hint: base, files: [{ path: 'SKILL.md', data: buf }] }], skipped: [], label: url.hostname };
  throw new ImportError('That link is not a .skill file, a zip or a SKILL.md', 'IMPORT_FORMAT');
}

// ───────────────────────────── preview store ─────────────────────────────
const previews = new Map(); // id → { at, label, skills:[{...analysis, files(raw)}] }
const TTL = 20 * 60 * 1000;
function gc() { const now = Date.now(); for (const [k, v] of previews) if (now - v.at > TTL) previews.delete(k); while (previews.size > 8) previews.delete(previews.keys().next().value); }

function collisionOf(dirName) {
  const dir = path.join(skills().installDir(), dirName);
  const exists = fs.existsSync(dir);
  let sameName = null;
  try { sameName = skills().scan().find((s) => s.name === dirName && path.resolve(s.dir) !== path.resolve(dir)) || null; } catch {}
  return { exists: exists || !!sameName, dir, otherLocation: sameName ? sameName.dir : '' };
}

function classify(src) {
  if (typeof src === 'string') {
    const s = src.trim();
    if (/^https?:\/\//i.test(s) && !/\s/.test(s)) return { type: 'url', url: s };
    // a link pasted without its scheme ("github.com/owner/repo/tree/…")
    if (/^(www\.)?(github\.com|raw\.githubusercontent\.com)\/\S+$/i.test(s)) return { type: 'url', url: 'https://' + s };
    if (!/\n/.test(s) && s.length < 1000 && (path.isAbsolute(s) || /^~[\\/]/.test(s) || /^[a-zA-Z]:[\\/]/.test(s))) return { type: 'file', path: s.replace(/^~/, os.homedir()) };
    return { type: 'text', text: src };
  }
  return src || {};
}

async function preview(source, opts = {}) {
  gc();
  const src = classify(source);
  let loaded;
  try {
    if (src.type === 'file' || src.type === 'folder') loaded = await loadFile(src.path);
    else if (src.type === 'text') loaded = loadText(src.text, src.name);
    else if (src.type === 'url') loaded = await loadUrl(src.url);
    else if (src.type === 'found') {
      const f = (foundCache || []).find((x) => x.id === src.id);
      if (!f) throw new ImportError('That skill is no longer in the list. Scan again.', 'IMPORT_NOT_FOUND');
      loaded = await loadFolder(f.dir);
      loaded.label = f.label;
    } else throw new ImportError('Unknown source', 'IMPORT_SOURCE');
  } catch (e) {
    if (e instanceof ZipError || e instanceof ImportError) return { ok: false, error: e.message, code: e.code, skills: [] };
    if (e && e.name === 'TimeoutError') return { ok: false, error: 'The server did not answer in time', code: 'IMPORT_TIMEOUT', skills: [] };
    if (e && (e.code === 'ENOENT' || e.code === 'EACCES')) return { ok: false, error: `Cannot read ${e.path || 'that file'}`, code: e.code, skills: [] };
    return { ok: false, error: (e && e.message) || String(e), code: 'IMPORT_FAILED', skills: [] };
  }
  const out = []; const errors = [];
  for (const s of loaded.sets) {
    if (s.error) { errors.push(s.error); continue; }
    try { out.push({ ...analyzeSkill(s), raw: s.files }); } catch (e) { errors.push(String(e.message)); }
  }
  if (!out.length) return { ok: false, error: errors[0] || 'No SKILL.md found. A skill is a folder with a SKILL.md file inside.', code: 'IMPORT_NO_SKILL', skills: [], errors };
  // names must be unique inside one import
  const seen = new Set();
  for (const s of out) { let n = s.name; let i = 2; while (seen.has(n)) n = `${s.name}-${i++}`; if (n !== s.name) { s.notes.push(`same name as another skill in this import: renamed to ${n}`); s.name = s.dirName = n; } seen.add(n); }
  for (const s of out) { s.collision = collisionOf(s.dirName); }
  const id = crypto.randomBytes(8).toString('hex');
  previews.set(id, { at: Date.now(), label: loaded.label, skills: out });
  const view = out.map(({ raw, skillMd, ...v }) => v);
  return { ok: true, previewId: id, label: loaded.label, skills: view, errors, skippedFiles: (loaded.skipped || []).map((x) => `${x.path} (${x.reason})`) };
}
const validate = async (source) => { const p = await preview(source); if (p.previewId) previews.delete(p.previewId); return { ok: p.ok, error: p.error, skills: (p.skills || []).map((s) => ({ name: s.name, description: s.description, warnings: s.warnings })) }; };

// ───────────────────────────── install ─────────────────────────────
function safeJoin(base, rel) {
  const full = path.resolve(base, rel);
  if (full !== base && !full.startsWith(base + path.sep)) throw new ImportError(`Refused to write outside the skill folder: ${rel}`, 'IMPORT_UNSAFE');
  return full;
}
async function writeSkill(dir, s, mdText) {
  const parent = path.dirname(dir);
  const tmp = path.join(parent, `.import-${crypto.randomBytes(4).toString('hex')}`);
  await fsp.mkdir(tmp, { recursive: true });
  try {
    for (const f of s.raw) {
      if (BINARY_EXT.has(path.extname(f.path).toLowerCase())) continue;
      const isMd = f.path.toLowerCase() === 'skill.md';
      const dest = safeJoin(tmp, isMd ? 'SKILL.md' : f.path);
      await fsp.mkdir(path.dirname(dest), { recursive: true });
      await fsp.writeFile(dest, isMd ? Buffer.from(mdText, 'utf8') : f.data, { mode: 0o644 }); // never executable
    }
    return tmp;
  } catch (e) { await fsp.rm(tmp, { recursive: true, force: true }); throw e; }
}

// opts: { select?: [key], collision?: 'replace'|'keepBoth'|'skip' | { [key]: … }, enable?: boolean }
async function install(previewId, opts = {}) {
  const p = previews.get(previewId);
  if (!p) return { ok: false, error: 'This preview expired. Open the file again.', installed: [] };
  const sel = new Set(opts.select || p.skills.map((s) => s.key));
  const installed = []; const skippedList = [];
  const base = skills().installDir();
  await fsp.mkdir(base, { recursive: true });
  for (const s of p.skills) {
    if (!sel.has(s.key)) continue;
    const pol = (opts.collision && typeof opts.collision === 'object' ? opts.collision[s.key] : opts.collision) || 'keepBoth';
    const col = collisionOf(s.dirName);
    let name = s.dirName;
    if (col.exists) {
      if (pol === 'skip') { skippedList.push({ name: s.name, reason: 'already installed' }); continue; }
      if (pol === 'keepBoth') { let i = 2; while (collisionOf(`${s.dirName}-${i}`).exists) i++; name = `${s.dirName}-${i}`; }
    }
    const md = s.raw.find((f) => f.path.toLowerCase() === 'skill.md');
    const mdText = normalizeSkillMd(cleanText(md.data), s.hint || s.dirName, name).text;
    const target = safeJoin(base, name);
    const tmp = await writeSkill(target, s, mdText);
    try {
      if (fs.existsSync(target)) { const bak = target + '.old-' + Date.now().toString(36); await fsp.rename(target, bak); await fsp.rename(tmp, target); await fsp.rm(bak, { recursive: true, force: true }); }
      else await fsp.rename(tmp, target);
    } catch (e) { await fsp.rm(tmp, { recursive: true, force: true }); throw e; }
    installed.push({ name, dir: target, replaced: col.exists && pol === 'replace', files: s.fileCount });
  }
  // enabled unless told otherwise (nothing is executed by installing)
  const sk = skills();
  sk.invalidate();
  if (opts.enable === false) for (const i of installed) await sk.setEnabled(i.name, false);
  else for (const i of installed) { const off = ((require('./store').getSettings().skills) || {}).disabled || []; if (off.includes(i.name)) await sk.setEnabled(i.name, true); }
  if (installed.length) previews.delete(previewId);
  return { ok: installed.length > 0 || !skippedList.length, installed, skipped: skippedList };
}

// ───────────────────────────── export ─────────────────────────────
async function exportSkill(name, dest) {
  const sk = skills().scan().find((s) => s.name === name);
  if (!sk) throw new Error(`No skill named ${name}`);
  const f = await readFolder(sk.dir);
  const root = sanitizeName(path.basename(sk.dir));
  const files = f.files.map((x) => ({ path: `${root}/${x.path}`, data: x.data }));
  const buf = writeZip(files);
  if (dest) await fsp.writeFile(dest, buf);
  return { path: dest || null, bytes: buf.length, files: files.length, buffer: dest ? undefined : buf, suggestedName: `${root}.skill` };
}

// ───────────────────────────── skills of other tools on this computer ─────────────────────────────
let foundCache = null;
async function listSkillDirs(parent) {
  const out = [];
  let ents = [];
  try { ents = await fsp.readdir(parent, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    if (!e.isDirectory() || e.name.startsWith('.')) continue; // symlinks are skipped on purpose
    const dir = path.join(parent, e.name);
    const file = skills().skillFile(dir);
    if (file) out.push({ dir, file, folder: e.name });
  }
  return out;
}
async function findPluginSkillRoots(root, maxDepth = 7) {
  const found = []; let visited = 0;
  const walk = async (d, depth) => {
    if (depth > maxDepth || visited++ > 4000 || found.length > 60) return;
    let ents; try { ents = await fsp.readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (!e.isDirectory() || e.name === 'node_modules' || e.name.startsWith('.git')) continue;
      const p = path.join(d, e.name);
      if (e.name === 'skills') found.push(p); else await walk(p, depth + 1);
    }
  };
  await walk(root, 0);
  return found;
}

async function findOnComputer() {
  const home = os.homedir();
  const places = [
    { tool: 'claude-code', label: 'Claude Code', dir: path.join(home, '.claude', 'skills') },
    { tool: 'agents', label: 'Agent skills folder (~/.agents)', dir: path.join(home, '.agents', 'skills') },
    { tool: 'codex', label: 'Codex', dir: path.join(home, '.codex', 'skills') },
    { tool: 'fabro', label: 'Fabro (other folder)', dir: path.join(home, '.fabro', 'skills') },
  ];
  for (const r of await findPluginSkillRoots(path.join(home, '.claude', 'plugins'))) places.push({ tool: 'claude-plugin', label: 'Claude Code plugin', dir: r });
  let folders = [];
  try { folders = ((require('./store').getSettings().agent) || {}).folders || []; } catch {}
  for (const f of folders.slice(0, 20)) for (const [sub, tool, label] of [['.claude/skills', 'claude-project', 'Project (.claude)'], ['.agents/skills', 'agents-project', 'Project (.agents)'], ['.codex/skills', 'codex', 'Project (.codex)']]) places.push({ tool, label: `${label}: ${path.basename(f)}`, dir: path.join(f, ...sub.split('/')) });
  const mine = path.resolve(skills().installDir());
  const live = new Set((() => { try { return skills().dirs().map((d) => path.resolve(d)); } catch { return []; } })());
  const seen = new Set(); const out = [];
  for (const pl of places) {
    if (path.resolve(pl.dir) === mine) continue;
    for (const s of await listSkillDirs(pl.dir)) {
      let real = s.dir; try { real = await fsp.realpath(s.dir); } catch {}
      if (seen.has(real)) continue; seen.add(real);
      let meta = {};
      try { meta = skills().parseFront(cleanText(await fsp.readFile(s.file))).meta; } catch {}
      const name = meta.name || s.folder;
      const installed = fs.existsSync(path.join(mine, sanitizeName(name)));
      out.push({ id: crypto.createHash('sha1').update(s.dir).digest('hex').slice(0, 10), tool: pl.tool, label: pl.label, name, description: (meta.description || '').slice(0, 240), dir: s.dir, alreadyActive: live.has(path.resolve(pl.dir)), installed });
    }
  }
  foundCache = out;
  return out;
}

// ───────────────────────────── opening .skill files with Fabro ─────────────────────────────
const SKILL_FILE_RE = /\.skill$/i;
const skillFileIn = (argv) => (argv || []).find((a) => typeof a === 'string' && SKILL_FILE_RE.test(a) && fs.existsSync(a));

// ───────────────────────────── IPC ─────────────────────────────
function init(ipcMain, emit, getWindow) {
  const h = (ch, fn) => ipcMain.handle(`skillimport:${ch}`, (_e, ...a) => fn(...a));
  h('preview', (src) => preview(src));
  h('install', (id, opts) => install(id, opts));
  h('found', () => findOnComputer());
  h('remove', async (name) => skills().remove(name));
  h('discard', (id) => { previews.delete(id); return true; });
  h('pick', async (kind) => {
    const { dialog } = require('electron');
    const win = getWindow && getWindow();
    const r = await dialog.showOpenDialog(win, kind === 'folder' ? { properties: ['openDirectory'] } : { properties: ['openFile'], filters: [{ name: 'Skills', extensions: ['skill', 'zip', 'md'] }, { name: '*', extensions: ['*'] }] });
    return r.canceled ? null : r.filePaths[0];
  });
  h('export', async (name) => {
    const { dialog } = require('electron');
    const win = getWindow && getWindow();
    const r = await dialog.showSaveDialog(win, { defaultPath: `${sanitizeName(name)}.skill`, filters: [{ name: 'Skill', extensions: ['skill'] }] });
    if (r.canceled || !r.filePath) return null;
    return exportSkill(name, r.filePath);
  });
  h('openFile', (p) => preview({ type: 'file', path: p }));
}
// A .skill file given to the app (double-click / "open with" / argv): ask the window to show the preview.
function openWithApp(file, send) { if (file && SKILL_FILE_RE.test(file)) send('skillimport:open', { path: file }); }

module.exports = { preview, validate, install, exportSkill, findOnComputer, init, openWithApp, skillFileIn, sanitizeName, normalizeSkillMd, LIMITS, _previews: previews };

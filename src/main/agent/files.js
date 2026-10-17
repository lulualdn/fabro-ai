// File tools, limited to folders the user allowed (Settings → Agent, or approved on the fly).
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const store = require('../store');
const agent = require('./index');

const allowed = () => ((store.getSettings().agent || {}).folders || []).map((f) => path.resolve(f));
function inside(p, root) { const r = path.relative(root, p); return r === '' || (!r.startsWith('..') && !path.isAbsolute(r)); }
function resolvePath(p, ctx) {
  if (!p) throw new Error('path is required');
  let x = String(p).replace(/^~(?=$|[\\/])/, os.homedir());
  const roots = allowed();
  if (!path.isAbsolute(x)) x = path.join((ctx && ctx.projectRoot) || roots[0] || defaultOut(), x);
  return path.resolve(x);
}
const defaultOut = () => path.join(os.homedir(), 'Documents', 'Fabro');
const BLOCKED = /([\\/]\.ssh|[\\/]\.gnupg|[\\/]\.aws|[\\/]AppData[\\/]Roaming[\\/]Microsoft[\\/]Credentials|[\\/]Library[\\/]Keychains|[\\/]\.config[\\/]gh|\.env$|id_rsa|id_ed25519|\.kdbx$)/i;

// Folder access: inside an allowed folder → ok; else ask once to add the folder.
async function access(p, ctx, write) {
  if (BLOCKED.test(p)) throw Object.assign(new Error('This location holds credentials and is never accessible'), { code: 'BLOCKED_PATH' });
  if (ctx.projectRoot && inside(p, ctx.projectRoot)) return true; // Code mode: the open project
  if (allowed().some((r) => inside(p, r)) || inside(p, defaultOut())) return true;
  if (!write) { try { if (require('./skills').readableRoots().some((r) => inside(p, r))) return true; } catch {} }
  if (ctx.grants && [...ctx.grants].some((r) => inside(p, r))) return true;
  const folder = write ? path.dirname(p) : (fs.existsSync(p) && fs.statSync(p).isDirectory() ? p : path.dirname(p));
  const d = await ctx.ask({ tool: 'folder_access', category: 'files', risk: write ? 'write' : 'read', summary: folder, reason: 'folder', args: { folder } });
  if (d !== 'once' && d !== 'always') throw Object.assign(new Error('The user did not allow access to this folder'), { code: 'DENIED' });
  if (d === 'always') await store.setSettings({ agent: { folders: [...((store.getSettings().agent || {}).folders || []), folder] } });
  ctx.grants = ctx.grants || new Set(); ctx.grants.add(folder);
  return true;
}

const fmtSize = (n) => n < 1024 ? `${n} B` : n < 1 << 20 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 2 ** 20).toFixed(1)} MB`;
const TEXT = /\.(txt|md|markdown|json|csv|tsv|js|mjs|cjs|ts|tsx|jsx|py|lua|luau|html?|css|scss|xml|ya?ml|toml|ini|cfg|conf|sh|bat|ps1|c|h|cpp|hpp|cs|java|kt|go|rs|php|rb|sql|swift|log|env\.example|gitignore|dockerfile|vue|svelte)$/i;

// Code mode: remember each file's content before the agent first changes it (undo / diff).
async function checkpoint(ctx, p) { if (ctx.checkpoint) { let before = null; try { before = await fsp.readFile(p, 'utf8'); } catch {} ctx.checkpoint(p, before); } }
function touched(ctx, p, kind) { (ctx.files = ctx.files || []).push({ path: p, kind, at: Date.now() }); ctx.emit && ctx.emit({ type: 'file_touched', path: p, kind }); }

agent.register({
  name: 'list_dir', category: 'files', risk: 'read', core: true,
  description: 'List the files and folders in a directory (name, size, modified date). Use "~" for the home folder.',
  parameters: { type: 'object', properties: { path: { type: 'string' }, recursive: { type: 'boolean', description: 'Up to 3 levels deep' } }, required: ['path'] },
  summarize: (a) => a.path,
  async run(a, ctx) {
    const p = resolvePath(a.path || '.', ctx); await access(p, ctx, false);
    const out = [];
    const walk = async (dir, depth) => {
      for (const e of (await fsp.readdir(dir, { withFileTypes: true })).slice(0, 400)) {
        if (e.name.startsWith('.') && e.name !== '.github') continue;
        if (['node_modules', '__pycache__', '.git', 'dist', 'build'].includes(e.name) && depth > 0) continue;
        const full = path.join(dir, e.name);
        let st = null; try { st = await fsp.stat(full); } catch {}
        out.push(`${'  '.repeat(depth)}${e.isDirectory() ? '📁 ' + e.name + '/' : e.name}${st && !e.isDirectory() ? `  (${fmtSize(st.size)})` : ''}`);
        if (a.recursive && e.isDirectory() && depth < 2 && out.length < 600) await walk(full, depth + 1);
      }
    };
    await walk(p, 0);
    return { content: `${p}\n${out.join('\n') || '(empty)'}`, view: { kind: 'dir', path: p, count: out.length } };
  },
});

agent.register({
  name: 'read_file', category: 'files', risk: 'read', core: true, untrusted: true,
  description: 'Read a text file (code, notes, CSV, JSON…). Optionally a line range. PDF/DOCX are converted to text.',
  parameters: { type: 'object', properties: { path: { type: 'string' }, from_line: { type: 'integer' }, to_line: { type: 'integer' } }, required: ['path'] },
  summarize: (a) => a.path,
  async run(a, ctx) {
    const p = resolvePath(a.path, ctx); await access(p, ctx, false);
    const st = await fsp.stat(p);
    if (st.isDirectory()) throw new Error('This is a folder, use list_dir');
    let text;
    if (/\.docx$/i.test(p)) text = await docxText(p);
    else if (st.size > 4 << 20) throw new Error(`File too large (${fmtSize(st.size)})`);
    else {
      const buf = await fsp.readFile(p);
      if (!TEXT.test(p) && buf.subarray(0, 4000).includes(0)) throw new Error('Binary file — not readable as text');
      text = buf.toString('utf8');
    }
    let lines = text.split('\n');
    const from = Math.max(1, a.from_line || 1), to = Math.min(lines.length, a.to_line || Math.min(lines.length, from + 1999));
    const body = lines.slice(from - 1, to).map((l, i) => `${String(from + i).padStart(5)}│${l}`).join('\n');
    touched(ctx, p, 'read');
    return { content: `${p} (lines ${from}-${to} of ${lines.length})\n${body}`, view: { kind: 'file', path: p, lines: lines.length, from, to } };
  },
});

agent.register({
  name: 'write_file', category: 'files', risk: 'write', core: true,
  description: 'Create or overwrite a text file with the given content. Creates folders as needed.',
  parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
  summarize: (a) => `${a.path} (${String(a.content || '').split('\n').length} lines)`,
  async run(a, ctx) {
    const p = resolvePath(a.path, ctx); await access(p, ctx, true); await checkpoint(ctx, p);
    const before = fs.existsSync(p) ? await fsp.readFile(p, 'utf8').catch(() => null) : null;
    await fsp.mkdir(path.dirname(p), { recursive: true });
    await fsp.writeFile(p, String(a.content ?? ''), 'utf8');
    touched(ctx, p, before == null ? 'created' : 'modified');
    const diff = lineDiff(before || '', String(a.content ?? ''));
    return { content: `${before == null ? 'Created' : 'Wrote'} ${p} (+${diff.add} −${diff.del})`, view: { kind: 'write', path: p, created: before == null, ...diff, ...(ctx.projectRoot ? { rel: path.relative(ctx.projectRoot, p) } : {}) } };
  },
});

agent.register({
  name: 'edit_file', category: 'files', risk: 'write', core: true,
  description: 'Edit a text file by replacing an exact snippet with new text. old_text must appear exactly once (include surrounding lines to make it unique).',
  parameters: { type: 'object', properties: { path: { type: 'string' }, old_text: { type: 'string' }, new_text: { type: 'string' } }, required: ['path', 'old_text', 'new_text'] },
  summarize: (a) => a.path,
  async run(a, ctx) {
    const p = resolvePath(a.path, ctx); await access(p, ctx, true); await checkpoint(ctx, p);
    const src = await fsp.readFile(p, 'utf8');
    const n = src.split(a.old_text).length - 1;
    if (n === 0) throw new Error('old_text not found — read the file again and copy the exact text');
    if (n > 1) throw new Error(`old_text appears ${n} times — include more context`);
    const next = src.replace(a.old_text, a.new_text);
    await fsp.writeFile(p, next, 'utf8');
    touched(ctx, p, 'modified');
    const diff = lineDiff(a.old_text, a.new_text);
    return { content: `Edited ${p} (+${diff.add} −${diff.del})`, view: { kind: 'write', path: p, ...diff, before: a.old_text.slice(0, 4000), after: a.new_text.slice(0, 4000), ...(ctx.projectRoot ? { rel: path.relative(ctx.projectRoot, p) } : {}) } };
  },
});

agent.register({
  name: 'delete_file', category: 'files', risk: 'danger',
  description: 'Delete a file (moved to the trash when possible). Always confirmed by the user.',
  parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
  keywords: ['supprim', 'delete', 'remove', 'efface'],
  summarize: (a) => a.path,
  guard: () => ({ confirm: 'delete' }),
  async run(a, ctx) {
    const p = resolvePath(a.path, ctx); await access(p, ctx, true); await checkpoint(ctx, p);
    const { shell } = require('electron');
    try { await shell.trashItem(p); } catch { await fsp.rm(p, { recursive: false }); }
    touched(ctx, p, 'deleted');
    return { content: `Deleted ${p} (moved to trash)`, view: { kind: 'delete', path: p } };
  },
});

agent.register({
  name: 'search_files', category: 'files', risk: 'read', core: true, untrusted: true,
  description: 'Search text inside files of a folder (case-insensitive), like grep. Returns matching lines with file and line number.',
  parameters: { type: 'object', properties: { path: { type: 'string' }, query: { type: 'string' }, glob: { type: 'string', description: 'Optional extension filter, e.g. ".js"' } }, required: ['query'] },
  summarize: (a) => `"${a.query}" in ${a.path}`,
  async run(a, ctx) {
    const root = resolvePath(a.path || '.', ctx); await access(root, ctx, false);
    const q = String(a.query).toLowerCase(); const hits = [];
    const walk = async (dir, depth) => {
      if (hits.length >= 200 || depth > 6) return;
      for (const e of await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])) {
        if (e.name.startsWith('.') || ['node_modules', 'dist', 'build', '__pycache__'].includes(e.name)) continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) { await walk(full, depth + 1); continue; }
        if (a.glob && !e.name.endsWith(a.glob.replace('*', ''))) continue;
        if (!TEXT.test(e.name)) continue;
        let txt; try { const st = await fsp.stat(full); if (st.size > 2 << 20) continue; txt = await fsp.readFile(full, 'utf8'); } catch { continue; }
        txt.split('\n').forEach((l, i) => { if (hits.length < 200 && l.toLowerCase().includes(q)) hits.push(`${path.relative(root, full)}:${i + 1}: ${l.trim().slice(0, 200)}`); });
      }
    };
    await walk(root, 0);
    return { content: hits.join('\n') || 'No match.', view: { kind: 'search_files', query: a.query, count: hits.length } };
  },
});

function lineDiff(a, b) {
  const A = a === '' ? [] : String(a).split('\n'), B = b === '' ? [] : String(b).split('\n');
  const pool = new Map(); A.forEach((l) => pool.set(l, (pool.get(l) || 0) + 1));
  let common = 0; for (const l of B) { const n = pool.get(l); if (n) { common++; pool.set(l, n - 1); } }
  return { add: B.length - common, del: A.length - common };
}

async function docxText(p) {
  const extract = require('extract-zip');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fabro-docx-'));
  try {
    await extract(p, { dir: tmp });
    const xml = fs.readFileSync(path.join(tmp, 'word', 'document.xml'), 'utf8');
    return xml.replace(/<\/w:p>/g, '\n').replace(/<w:tab\/>/g, '\t').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

module.exports = { resolvePath, access, allowed, defaultOut, lineDiff, touched, inside };

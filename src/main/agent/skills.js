// Skills: folders with a SKILL.md (Claude-compatible). Only names + descriptions go in the prompt;
// the model loads a skill's instructions with load_skill when it's relevant.
const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');
const store = require('../store');
const agent = require('./index');

function dirs() {
  const s = store.getSettings().skills || {};
  return [...new Set([path.join(require('../paths').dataDir(), 'skills'), path.join(os.homedir(), '.claude', 'skills'), path.join(os.homedir(), '.fabro', 'skills'), ...(s.extraDirs || [])])];
}
// Tolerant front matter: BOM, CRLF, quoted values, folded/literal blocks (> | >- |-), indented continuation lines;
// nested maps (metadata:) and unknown keys are ignored. Shape kept: { meta, body }.
function parseFront(md) {
  md = String(md).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const m = md.match(/^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/);
  const meta = {};
  if (m) {
    const lines = m[1].split('\n');
    for (let i = 0; i < lines.length; i++) {
      const kv = lines[i].match(/^([A-Za-z_][\w-]*):[ \t]*(.*)$/);
      if (!kv) continue;
      let v = kv[2].trim();
      const block = /^([>|])[+-]?\d*$/.exec(v);
      const cont = [];
      while (i + 1 < lines.length && (/^[ \t]+\S/.test(lines[i + 1]) || (block && lines[i + 1].trim() === ''))) cont.push(lines[++i].trim());
      if (block) v = block[1] === '>' ? cont.join(' ').replace(/\s+/g, ' ').trim() : cont.join('\n').trim();
      else if (v === '' && cont.length && !cont.some((c) => /^[\w-]+:\s/.test(c) || c.startsWith('- '))) v = cont.join(' ');
      else if (v !== '' && cont.length && !/^["'\[{]/.test(v)) v = [v, ...cont].join(' ');
      else if (v === '' && cont.length) continue; // nested map or list: not a plain value
      meta[kv[1]] = v.replace(/^"([\s\S]*)"$|^'([\s\S]*)'$/, (_x, a, b) => (a !== undefined ? a : b)).trim();
    }
  }
  return { meta, body: m ? md.slice(m[0].length) : md };
}
// SKILL.md, whatever the case (Claude's help pages say skill.md in places).
function skillFile(dir) {
  try { const n = fs.readdirSync(dir).find((x) => x.toLowerCase() === 'skill.md'); return n ? path.join(dir, n) : null; } catch { return null; }
}
let cache = null;
function scan() {
  const off = new Set((store.getSettings().skills || {}).disabled || []);
  const out = [];
  for (const d of dirs()) {
    if (!fs.existsSync(d)) continue;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (!e.isDirectory() || e.name.startsWith('.')) continue;
      const file = skillFile(path.join(d, e.name));
      if (!file) continue;
      try {
        const { meta } = parseFront(fs.readFileSync(file, 'utf8'));
        const name = meta.name || e.name;
        if (out.some((s) => s.name === name)) continue;
        out.push({ name, description: (meta.description || '').slice(0, 400), dir: path.join(d, e.name), file, source: d.includes('.claude') ? 'claude' : d.includes(require('../paths').dataDir()) ? 'fabro' : 'folder', enabled: !off.has(name), allowedTools: meta['allowed-tools'] || '' });
      } catch {}
    }
  }
  cache = out;
  return out;
}
const list = () => cache || scan();
const active = () => list().filter((s) => s.enabled);

function promptSection() {
  const a = active();
  if (!a.length) return '';
  return `Skills (expert instructions you can load with load_skill when a task matches):\n${a.map((s) => `- ${s.name}: ${s.description}`).join('\n')}`;
}

agent.register({
  name: 'load_skill', category: 'skills', risk: 'read', core: true,
  description: 'Load the full instructions of a skill listed in the system prompt before doing a task it covers. Returns SKILL.md and the files in the skill folder.',
  parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
  summarize: (a) => a.name,
  async run(a) {
    const s = active().find((x) => x.name.toLowerCase() === String(a.name).toLowerCase());
    if (!s) throw new Error(`No skill named ${a.name}`);
    const { body: raw } = parseFront(fs.readFileSync(s.file, 'utf8'));
    const compat = require('../skillcompat');
    const resolve = (n) => { const o = list().find((x) => x.name === n || path.basename(x.dir) === n); return o && o.dir; };
    const body = compat.rewritePaths(raw, s.dir, resolve);
    const cnote = compat.note(raw, s.allowedTools);
    const files = [];
    const walk = (d, rel = '') => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (e.name.startsWith('.')) continue; const r = path.join(rel, e.name); if (e.isDirectory()) walk(path.join(d, e.name), r); else if (e.name !== 'SKILL.md') files.push(r); } };
    walk(s.dir);
    return { content: `# Skill: ${s.name}\nFolder: ${s.dir}\n${files.length ? `Files: ${files.slice(0, 60).join(', ')}\n` : ''}\n${body}${cnote ? `\n\n${cnote}` : ''}`, view: { kind: 'skill', name: s.name } };
  },
});

// Folders of skills are readable by the file tools.
function readableRoots() { return active().map((s) => s.dir); }

async function setEnabled(name, on) {
  const off = new Set((store.getSettings().skills || {}).disabled || []);
  if (on) off.delete(name); else off.add(name);
  await store.setSettings({ skills: { disabled: [...off] } });
  cache = null; return list();
}
function create(name, description, body) {
  const safe = String(name).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'skill';
  const d = path.join(require('../paths').dataDir(), 'skills', safe);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'SKILL.md'), `---\nname: ${safe}\ndescription: ${String(description || '').replace(/\n/g, ' ')}\n---\n\n${body || ''}\n`);
  cache = null; return list();
}

const installDir = () => path.join(require('../paths').dataDir(), 'skills');
const invalidate = () => { cache = null; };
async function remove(name) {
  const s = scan().find((x) => x.name === name);
  if (!s || path.dirname(s.dir) !== installDir()) throw new Error('Only skills installed in Fabro can be removed');
  fs.rmSync(s.dir, { recursive: true, force: true }); cache = null; return list();
}

module.exports = { installDir, invalidate, remove, skillFile, list, scan, active, promptSection, readableRoots, setEnabled, create, dirs, parseFront };

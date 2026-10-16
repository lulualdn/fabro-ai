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
  return [...new Set([path.join(app.getPath('userData'), 'skills'), path.join(os.homedir(), '.claude', 'skills'), path.join(os.homedir(), '.fabro', 'skills'), ...(s.extraDirs || [])])];
}
function parseFront(md) {
  const m = String(md).match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  const meta = {};
  if (m) for (const line of m[1].split('\n')) { const kv = line.match(/^(\w[\w-]*):\s*(.*)$/); if (kv) meta[kv[1]] = kv[2].replace(/^["']|["']$/g, '').trim(); }
  return { meta, body: m ? md.slice(m[0].length) : md };
}
let cache = null;
function scan() {
  const off = new Set((store.getSettings().skills || {}).disabled || []);
  const out = [];
  for (const d of dirs()) {
    if (!fs.existsSync(d)) continue;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const file = path.join(d, e.name, 'SKILL.md');
      if (!fs.existsSync(file)) continue;
      try {
        const { meta } = parseFront(fs.readFileSync(file, 'utf8'));
        const name = meta.name || e.name;
        if (out.some((s) => s.name === name)) continue;
        out.push({ name, description: (meta.description || '').slice(0, 400), dir: path.join(d, e.name), file, source: d.includes('.claude') ? 'claude' : d.includes(app.getPath('userData')) ? 'fabro' : 'folder', enabled: !off.has(name) });
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
    const { body } = parseFront(fs.readFileSync(s.file, 'utf8'));
    const files = [];
    const walk = (d, rel = '') => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (e.name.startsWith('.')) continue; const r = path.join(rel, e.name); if (e.isDirectory()) walk(path.join(d, e.name), r); else if (e.name !== 'SKILL.md') files.push(r); } };
    walk(s.dir);
    return { content: `# Skill: ${s.name}\nFolder: ${s.dir}\n${files.length ? `Files: ${files.slice(0, 60).join(', ')}\n` : ''}\n${body}`, view: { kind: 'skill', name: s.name } };
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
  const d = path.join(app.getPath('userData'), 'skills', safe);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'SKILL.md'), `---\nname: ${safe}\ndescription: ${String(description || '').replace(/\n/g, ' ')}\n---\n\n${body || ''}\n`);
  cache = null; return list();
}

module.exports = { list, scan, active, promptSection, readableRoots, setEnabled, create, dirs, parseFront };

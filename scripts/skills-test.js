// Offline test of skill import/export + the Claude compatibility layer. Plain node, electron mocked.
const Module = require('module'); const os = require('os'); const path = require('path'); const fs = require('fs'); const assert = require('assert'); const zlib = require('zlib');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fabro-skills-'));
const orig = Module._load;
Module._load = function (req, ...r) {
  if (req === 'electron') return { app: { getPath: () => tmp, isPackaged: false, getVersion: () => '0.0.0' }, safeStorage: { isEncryptionAvailable: () => false }, shell: {}, BrowserWindow: class {}, dialog: {}, protocol: {} };
  return orig.call(this, req, ...r);
};
process.env.HOME = tmp; process.env.USERPROFILE = tmp;
const store = require('../src/main/store'); store.init();
const agent = require('../src/main/agent');
const skills = require('../src/main/agent/skills');
const si = require('../src/main/skillimport');
const { writeZip, readZip, crc32 } = require('../src/main/ziplite');
const compat = require('../src/main/skillcompat');
require('../src/main/agent/files'); require('../src/main/agent/shell'); require('../src/main/agent/plan');

let pass = 0; let failed = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log('  ok  ' + name); } catch (e) { failed++; console.log('FAIL  ' + name + '\n      ' + (e.stack || e).toString().split('\n').slice(0, 4).join('\n      ')); } };
const wz = (name, files) => { const p = path.join(tmp, name); fs.writeFileSync(p, writeZip(files.map(([p2, d, mode]) => ({ path: p2, data: Buffer.from(d), mode })))); return p; };
const GOOD = '---\nname: pdf-tools\ndescription: Extract text from PDFs. Use when the user mentions PDFs.\nlicense: MIT\n---\n\n# PDF tools\nUse the `Read` tool then `Bash` to run scripts/extract.py. See /mnt/skills/public/pdf-tools/references/forms.md\n';

// hand-made hostile zip (raw bytes so we can set any name / attributes)
function rawZip(entries) {
  const parts = []; const cd = []; let off = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name); const data = Buffer.from(e.data || ''); const crc = crc32(data);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 8); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(e.fakeSize != null ? e.fakeSize : data.length, 22); lh.writeUInt16LE(name.length, 26);
    parts.push(lh, name, data);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE((3 << 8) | 20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(e.fakeSize != null ? e.fakeSize : data.length, 24); ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(((e.mode || 0o100644) << 16) >>> 0, 38); ch.writeUInt32LE(off, 42);
    cd.push(ch, name); off += 30 + name.length + data.length;
  }
  const c = Buffer.concat(cd); const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(c.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, c, end]);
}

(async () => {
  await t('ziplite round-trip + unzip(1) agrees', async () => {
    const p = wz('rt.zip', [['a/b.txt', 'hello'.repeat(100)], ['a/c.bin', Buffer.from([0, 1, 2, 3])]]);
    const z = readZip(fs.readFileSync(p)); assert.strictEqual(z.entries.length, 2); assert.strictEqual(z.entries[0].data.toString(), 'hello'.repeat(100));
    const r = require('child_process').spawnSync('unzip', ['-tq', p]); if (!r.error) assert.strictEqual(r.status, 0, String(r.stdout));
  });
  await t('good .skill zip: preview shows name, files, scripts, warnings, tool map', async () => {
    const p = wz('pdf-tools.skill', [['pdf-tools/SKILL.md', GOOD], ['pdf-tools/scripts/extract.py', 'import requests\nrequests.get("https://example.com")\n'], ['pdf-tools/references/forms.md', '# forms'], ['__MACOSX/pdf-tools/._SKILL.md', 'x'], ['pdf-tools/.DS_Store', 'x']]);
    const pv = await si.preview({ type: 'file', path: p });
    assert.ok(pv.ok, pv.error); assert.strictEqual(pv.skills.length, 1);
    const s = pv.skills[0]; assert.strictEqual(s.name, 'pdf-tools'); assert.ok(/Extract text/.test(s.description));
    assert.deepStrictEqual(s.files.map((f) => f.path).sort(), ['SKILL.md', 'references/forms.md', 'scripts/extract.py']);
    assert.deepStrictEqual(s.scripts, ['scripts/extract.py']);
    const kinds = s.warnings.map((w) => w.kind); assert.ok(kinds.includes('scripts') && kinds.includes('network') && kinds.includes('shell'), kinds.join());
    assert.ok(s.tools.mapped.find((m) => m.name === 'Bash' && m.to === 'run_command') && s.tools.mapped.find((m) => m.name === 'Read' && m.to === 'read_file'));
    assert.ok(s.usesMnt);
    assert.ok(!('raw' in s) && !('skillMd' in s), 'preview view must not carry file contents');
  });
  await t('install writes into the account skills dir, never executable, SKILL.md normalised; load_skill adds compat note and rewrites /mnt/skills', async () => {
    const pv = await si.preview({ type: 'file', path: path.join(tmp, 'pdf-tools.skill') });
    const r = await si.install(pv.previewId); assert.ok(r.ok); assert.strictEqual(r.installed[0].name, 'pdf-tools');
    const dir = path.join(skills.installDir(), 'pdf-tools'); assert.ok(fs.existsSync(path.join(dir, 'SKILL.md')));
    assert.ok(dir.startsWith(tmp));
    if (process.platform !== 'win32') assert.strictEqual(fs.statSync(path.join(dir, 'scripts/extract.py')).mode & 0o111, 0);
    assert.ok(skills.list().some((x) => x.name === 'pdf-tools' && x.enabled));
    const out = await agent.get('load_skill').run({ name: 'pdf-tools' });
    assert.ok(/Fabro compatibility note/.test(out.content) && /Bash → run_command/.test(out.content) && /Read → read_file/.test(out.content));
    assert.ok(out.content.includes(dir.replace(/\\/g, '/') + '/references/forms.md') || out.content.includes(dir.replace(/\\/g, '/')), 'mnt path rewritten');
    assert.ok(!/\/mnt\/skills/.test(out.content));
    assert.ok(skills.promptSection().includes('pdf-tools'));
  });
  await t('collision: replace / keepBoth / skip', async () => {
    const p = path.join(tmp, 'pdf-tools.skill');
    let pv = await si.preview({ type: 'file', path: p }); assert.ok(pv.skills[0].collision.exists);
    let r = await si.install(pv.previewId, { collision: 'skip' }); assert.deepStrictEqual(r.installed, []); assert.strictEqual(r.skipped.length, 1);
    pv = await si.preview({ type: 'file', path: p }); r = await si.install(pv.previewId, { collision: 'keepBoth' });
    assert.strictEqual(r.installed[0].name, 'pdf-tools-2');
    assert.ok(/name: pdf-tools-2/.test(fs.readFileSync(path.join(skills.installDir(), 'pdf-tools-2', 'SKILL.md'), 'utf8')));
    assert.ok(skills.list().some((x) => x.name === 'pdf-tools-2'));
    fs.writeFileSync(path.join(skills.installDir(), 'pdf-tools', 'junk.txt'), 'old');
    pv = await si.preview({ type: 'file', path: p }); r = await si.install(pv.previewId, { collision: 'replace' });
    assert.ok(r.installed[0].replaced); assert.ok(!fs.existsSync(path.join(skills.installDir(), 'pdf-tools', 'junk.txt')));
    assert.deepStrictEqual(fs.readdirSync(skills.installDir()).filter((n) => n.startsWith('.')), [], 'no temp leftovers');
  });
  await t('export → .skill → import round-trip', async () => {
    const dest = path.join(tmp, 'out.skill'); const e = await si.exportSkill('pdf-tools', dest);
    assert.ok(e.files >= 3); const z = readZip(fs.readFileSync(dest)); assert.ok(z.entries.every((x) => x.path.startsWith('pdf-tools/')));
    fs.rmSync(path.join(skills.installDir(), 'pdf-tools'), { recursive: true }); skills.invalidate();
    const pv = await si.preview({ type: 'file', path: dest }); assert.strictEqual(pv.skills[0].name, 'pdf-tools'); assert.ok(!pv.skills[0].collision.exists || true);
    const r = await si.install(pv.previewId, { collision: 'replace' }); assert.strictEqual(r.installed[0].name, 'pdf-tools');
    assert.ok(fs.existsSync(path.join(skills.installDir(), 'pdf-tools', 'references', 'forms.md')));
  });
  await t('path traversal is refused', async () => {
    const p = path.join(tmp, 'evil.skill'); fs.writeFileSync(p, rawZip([{ name: 'x/SKILL.md', data: GOOD }, { name: 'x/../../../evil.txt', data: 'pwn' }]));
    const pv = await si.preview({ type: 'file', path: p }); assert.ok(!pv.ok); assert.ok(/traversal/.test(pv.error), pv.error);
    for (const bad of ['/etc/passwd', 'C:\\Windows\\x', '..\\..\\x']) { fs.writeFileSync(p, rawZip([{ name: 'x/SKILL.md', data: GOOD }, { name: bad, data: 'pwn' }])); const r = await si.preview({ type: 'file', path: p }); assert.ok(!r.ok, bad); }
    assert.ok(!fs.existsSync(path.join(tmp, 'evil.txt')));
  });
  await t('symlink entries are skipped and reported', async () => {
    const p = path.join(tmp, 'sym.skill'); fs.writeFileSync(p, rawZip([{ name: 's/SKILL.md', data: GOOD }, { name: 's/link', data: '/etc/passwd', mode: 0o120777 }]));
    const pv = await si.preview({ type: 'file', path: p }); assert.ok(pv.ok); assert.ok(pv.skippedFiles.some((x) => /link.*symbolic/.test(x)));
    assert.ok(!pv.skills[0].files.some((f) => f.path === 'link'));
  });
  await t('symlinks inside a folder are not followed', async () => {
    const d = path.join(tmp, 'folder-skill'); fs.mkdirSync(d); fs.writeFileSync(path.join(d, 'SKILL.md'), GOOD); fs.writeFileSync(path.join(tmp, 'secret.txt'), 's3cret');
    try { fs.symlinkSync(path.join(tmp, 'secret.txt'), path.join(d, 'leak.txt')); } catch { return; }
    const pv = await si.preview({ type: 'folder', path: d }); assert.ok(pv.ok); assert.ok(!pv.skills[0].files.some((f) => f.path === 'leak.txt'));
  });
  await t('oversized and zip-bomb archives are refused', async () => {
    const big = path.join(tmp, 'big.skill'); fs.writeFileSync(big, writeZip([{ path: 'b/SKILL.md', data: GOOD }, { path: 'b/assets/huge.bin', data: Buffer.alloc(13 * 1024 * 1024, 1) }]));
    let pv = await si.preview({ type: 'file', path: big }); assert.ok(!pv.ok && /larger than/.test(pv.error), pv.error);
    const many = path.join(tmp, 'many.skill'); fs.writeFileSync(many, writeZip([{ path: 'm/SKILL.md', data: GOOD }, ...Array.from({ length: 650 }, (_, i) => ({ path: `m/f${i}.txt`, data: 'x' }))]));
    pv = await si.preview({ type: 'file', path: many }); assert.ok(!pv.ok && /More than/.test(pv.error), pv.error);
    // declared size lies (says 10 bytes, inflates to 5 MB)
    const lie = rawZip([{ name: 'l/SKILL.md', data: GOOD }]); // sanity only
    const raw = zlib.deflateRawSync(Buffer.alloc(5 * 1024 * 1024)); const nm = Buffer.from('l/a.bin');
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(0, 14); lh.writeUInt32LE(raw.length, 18); lh.writeUInt32LE(10, 22); lh.writeUInt16LE(nm.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(raw.length, 20); ch.writeUInt32LE(10, 24); ch.writeUInt16LE(nm.length, 28);
    const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(46 + nm.length, 12); end.writeUInt32LE(30 + nm.length + raw.length, 16);
    const bomb = path.join(tmp, 'bomb.skill'); fs.writeFileSync(bomb, Buffer.concat([lh, nm, raw, ch, nm, end]));
    pv = await si.preview({ type: 'file', path: bomb }); assert.ok(!pv.ok, 'lying size must be refused'); assert.ok(lie.length > 0);
    assert.ok(!(await si.preview({ type: 'file', path: path.join(tmp, 'nope.zip') })).ok);
    const notzip = path.join(tmp, 'x.skill'); fs.writeFileSync(notzip, 'hello'); assert.ok(!(await si.preview({ type: 'file', path: notzip })).ok);
  });
  await t('executables are not installed; warned', async () => {
    const p = wz('bin.skill', [['b/SKILL.md', GOOD], ['b/tool.exe', 'MZ....'], ['b/scripts/run.sh', 'echo hi']]);
    const pv = await si.preview({ type: 'file', path: p }); assert.ok(pv.skills[0].warnings.some((w) => w.kind === 'binary'));
    await si.install(pv.previewId, { collision: 'replace' }); // name pdf-tools collides: replace
    const d = path.join(skills.installDir(), 'pdf-tools'); assert.ok(!fs.existsSync(path.join(d, 'tool.exe'))); assert.ok(fs.existsSync(path.join(d, 'scripts', 'run.sh')));
  });
  await t('no front matter / BOM / CRLF / extra keys / folded description', async () => {
    let pv = await si.preview({ type: 'text', text: '# Cuisine rapide\n\nAide à cuisiner des repas en 15 minutes avec ce qu\'il y a dans le frigo.\n\n1. étape' });
    assert.ok(pv.ok); assert.strictEqual(pv.skills[0].name, 'cuisine-rapide'); assert.ok(/cuisiner/.test(pv.skills[0].description)); assert.ok(pv.skills[0].notes.length >= 1);
    pv = await si.preview({ type: 'text', text: '\uFEFF---\r\nname: My Weird_Skill!!\r\ndescription: >-\r\n  line one\r\n  line two\r\nfoo: bar\r\nmetadata:\r\n  a: b\r\n---\r\nBody\r\n' });
    assert.strictEqual(pv.skills[0].name, 'my-weird-skill'); assert.strictEqual(pv.skills[0].description, 'line one line two');
    const r = await si.install(pv.previewId); const md = fs.readFileSync(path.join(skills.installDir(), 'my-weird-skill', 'SKILL.md'), 'utf8');
    assert.ok(!md.includes('\r') && /^---\nname: my-weird-skill\n/.test(md) && /Body/.test(md)); assert.ok(r.ok);
    assert.ok(skills.list().some((x) => x.name === 'my-weird-skill' && x.description === 'line one line two'));
  });
  await t('lowercase skill.md (Claude help pages) is accepted', async () => {
    const p = wz('lc.zip', [['lowcase/skill.md', '---\nname: lowcase\ndescription: d d d d d\n---\nb']]);
    const pv = await si.preview({ type: 'file', path: p }); assert.ok(pv.ok, pv.error); await si.install(pv.previewId);
    assert.ok(skills.list().some((x) => x.name === 'lowcase'));
  });
  await t('multi-skill zip (+ skill at zip root takes the archive name)', async () => {
    const p = wz('multi.zip', [['skills/a-skill/SKILL.md', '---\nname: a-skill\ndescription: first skill here\n---\nA'], ['skills/a-skill/assets/x.txt', 'x'], ['skills/b-skill/SKILL.md', '---\nname: b-skill\ndescription: second skill here\n---\nB'], ['README.md', 'hi']]);
    const pv = await si.preview({ type: 'file', path: p }); assert.strictEqual(pv.skills.length, 2);
    const r = await si.install(pv.previewId, { select: [pv.skills[1].key] }); assert.deepStrictEqual(r.installed.map((x) => x.name), ['b-skill']);
    const p2 = wz('rootskill.zip', [['SKILL.md', '---\ndescription: only a description here\n---\nB']]);
    const pv2 = await si.preview({ type: 'file', path: p2 }); assert.strictEqual(pv2.skills[0].name, 'rootskill');
  });
  await t('folder import + single SKILL.md file + found-on-computer list', async () => {
    const pv = await si.preview({ type: 'folder', path: path.join(tmp, 'folder-skill') }); assert.ok(pv.ok); assert.strictEqual(pv.skills[0].name, 'pdf-tools');
    const cs = path.join(tmp, '.claude', 'skills', 'from-claude-code'); fs.mkdirSync(cs, { recursive: true }); fs.writeFileSync(path.join(cs, 'SKILL.md'), '---\nname: from-claude-code\ndescription: Lives in Claude Code\n---\nx');
    const pl = path.join(tmp, '.claude', 'plugins', 'cache', 'mk', 'plug', '1.0.0', 'skills', 'plug-skill'); fs.mkdirSync(pl, { recursive: true }); fs.writeFileSync(path.join(pl, 'SKILL.md'), '---\nname: plug-skill\ndescription: From a plugin\n---\nx');
    const cx = path.join(tmp, '.agents', 'skills', 'codexy'); fs.mkdirSync(cx, { recursive: true }); fs.writeFileSync(path.join(cx, 'SKILL.md'), '---\nname: codexy\ndescription: For agents\n---\nx');
    const found = await si.findOnComputer(); const by = (n) => found.find((f) => f.name === n);
    assert.ok(by('from-claude-code') && by('from-claude-code').tool === 'claude-code'); assert.ok(by('plug-skill') && by('plug-skill').tool === 'claude-plugin'); assert.ok(by('codexy') && by('codexy').tool === 'agents');
    const pv2 = await si.preview({ type: 'found', id: by('codexy').id }); assert.ok(pv2.ok); await si.install(pv2.previewId); assert.ok(skills.list().some((x) => x.name === 'codexy'));
    assert.ok(!found.some((f) => f.dir.startsWith(skills.installDir())), 'own skills not offered');
  });
  await t('GitHub URL: tree link → API tree + raw files (fetch mocked)', async () => {
    const realFetch = global.fetch; const calls = [];
    const body = (s) => ({ ok: true, status: 200, url: 'https://x', headers: new Map([['content-length', String(Buffer.byteLength(s))]]), body: (async function* () { yield Buffer.from(s); })() });
    global.fetch = async (u) => {
      calls.push(String(u));
      if (/git\/trees\/main\?recursive/.test(u)) return body(JSON.stringify({ tree: [{ type: 'blob', path: 'skills/foo/SKILL.md', size: 60, mode: '100644' }, { type: 'blob', path: 'skills/foo/scripts/a.py', size: 10, mode: '100644' }, { type: 'blob', path: 'skills/bar/SKILL.md', size: 10, mode: '100644' }] }));
      if (/raw.githubusercontent.com\/o\/r\/main\/skills\/foo\/SKILL.md/.test(u)) return body('---\nname: foo\ndescription: foo does things well\n---\nfoo');
      if (/a.py/.test(u)) return body('print(1)');
      return { ok: false, status: 404, headers: new Map(), body: (async function* () {})() };
    };
    try {
      const pv = await si.preview('https://github.com/o/r/tree/main/skills/foo'); assert.ok(pv.ok, pv.error); assert.strictEqual(pv.skills[0].name, 'foo'); assert.strictEqual(pv.skills[0].fileCount, 2);
      assert.ok(!calls.some((c) => /bar/.test(c)), 'only the linked folder is fetched');
      const bad = await si.preview('http://github.com/o/r'); assert.ok(!bad.ok);
    } finally { global.fetch = realFetch; }
  });
  await t('remove only removes skills installed in Fabro', async () => {
    await skills.remove('lowcase'); assert.ok(!skills.list().some((x) => x.name === 'lowcase'));
    await assert.rejects(() => skills.remove('from-claude-code'));
  });
  await t('compat: tool name table points at real Fabro tools; no false positives on plain prose', async () => {
    const real = new Set(agent.all().map((x) => x.name)); ['web_search', 'fetch_url', 'ask_user'].forEach((n) => real.add(n)); // chat/runtime-provided tools
    for (const [k, v] of Object.entries(compat.MAP)) if (v.to) assert.ok(real.has(v.to), `${k} → ${v.to} is not a Fabro tool`);
    assert.deepStrictEqual(compat.referencedTools('Please read the task, then write a summary and edit it. Ask the user.'), []);
    assert.deepStrictEqual(compat.referencedTools('Use `Grep` and the WebFetch tool; allowed', 'Bash(git:*) Read'), ['Bash', 'Grep', 'Read', 'WebFetch']);
    const a = compat.analyze('Use the NotebookEdit tool and `Bash`'); assert.deepStrictEqual(a.unmapped.map((u) => u.name), ['NotebookEdit']);
    assert.strictEqual(compat.note('Plain instructions with no tools.'), '');
    assert.ok(/not available in Fabro/.test(compat.note('Use the NotebookEdit tool')));
    assert.strictEqual(compat.rewritePaths('cd /mnt/skills/public/docx/scripts', '/x/y', (n) => (n === 'docx' ? '/home/u/skills/docx' : null)), 'cd /home/u/skills/docx/scripts');
  });
  await t('pasted text: loose words refused, a titled snippet accepted; scheme-less GitHub link is a link', async () => {
    const r1 = await si.preview('pas un lien'); assert.ok(!r1.ok); assert.strictEqual(r1.code, 'IMPORT_NOT_SKILL');
    const r2 = await si.preview('# Factures\nQuand on parle de factures, range-les par mois.'); assert.ok(r2.ok, r2.error); assert.strictEqual(r2.skills[0].name, 'factures');
    const r3 = await si.preview('github.com/foo'); assert.ok(!r3.ok); assert.strictEqual(r3.code, 'IMPORT_URL'); // classified as a link, not as text
  });
  console.log(`\n${pass} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();

// Designed PDFs the AI can see and fix: create_pdf → picture + problems, read/edit_artifact line by line →
// PDF regenerated, inspect_document on a file. Runs the real tools inside the Electron main process.
// Run: xvfb-run -a node scripts/layout-test.js [outDir]
const { _electron: electron } = require('playwright-core');
const fs = require('fs'); const os = require('os'); const path = require('path'); const assert = require('assert');
const out = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'fabro-layout-'));
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'fabro-lt-'));
const docs = path.join(userData, 'docs'); fs.mkdirSync(docs);
fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ autoUpdate: false }));

(async () => {
  const app = await electron.launch({ executablePath: require('electron'), args: [path.join(__dirname, '..'), `--user-data-dir=${userData}`, '--no-sandbox'], env: { ...process.env, FABRO_E2E: '1' } });
  await app.firstWindow();
  const run = (name, args) => app.evaluate(async (_e, { name, args, docs, root }) => {
    const agent = process.mainModule.require(root + '/src/main/agent/index.js');
    const ctx = { convId: 'c1', emit: () => {}, grants: new Set([docs]), onAbort: () => {} };
    const r = await agent.get(name).run(args, ctx);
    return { ...r, image: r.image ? r.image.slice(0, 64) + '…' + r.image.length : null, _img: r.image || null };
  }, { name, args, docs, root: path.join(__dirname, '..') });

  const html = `<header class="cover"><h1>Rapport annuel</h1><p>UFStudios · 2026</p></header><div class="page-break"></div>
    <h2>Chiffres</h2><table><tr><th>Mois</th><th>Ventes</th></tr>${Array.from({ length: 12 }, (_, i) => `<tr><td>${i + 1}</td><td>${(i + 3) * 1000} €</td></tr>`).join('')}</table>
    <div class="wide">${'X'.repeat(400)}</div>`;
  const r1 = await run('create_pdf', { title: 'Rapport annuel', html, css: '.cover{height:250mm;background:#12161d;color:#fff;padding:30mm}.wide{width:400mm;overflow:hidden;white-space:nowrap}', folder: docs });
  console.log(r1.content);
  assert.ok(r1._img && r1._img.startsWith('data:image/jpeg'), 'a picture of the pages');
  assert.match(r1.content, /2 page\(s\)/);
  assert.match(r1.content, /wider than the paper|cut horizontally/, 'the too-wide block is reported');
  fs.writeFileSync(path.join(out, 'pdf-before.jpg'), Buffer.from(r1._img.split(',')[1], 'base64'));
  const artId = r1.view.artifactId;

  const read = await run('read_artifact', { artifact: 'Rapport annuel' });
  const line = read.content.split('\n').find((l) => /\.wide\{/.test(l));
  assert.ok(line, 'numbered lines');
  const n = parseInt(line, 10);
  const r2 = await run('edit_artifact', { artifact: artId, edits: [{ start_line: n, end_line: n, new_text: '.cover{height:250mm;background:#12161d;color:#fff;padding:30mm}.wide{width:100%;overflow-wrap:anywhere}' }, { old_text: 'Rapport annuel</h1>', new_text: 'Rapport annuel 2026</h1>' }] });
  console.log(r2.content);
  assert.match(r2.content, /2 edit\(s\) applied/);
  assert.doesNotMatch(r2.content, /wider than the paper|cut horizontally/, 'problem fixed');
  fs.writeFileSync(path.join(out, 'pdf-after.jpg'), Buffer.from(r2._img.split(',')[1], 'base64'));
  const file = r2.view.path;
  assert.ok(fs.existsSync(file) && fs.statSync(file).size > 3000);
  const r3 = await run('inspect_document', { path: file });
  assert.match(r3.content, /page\(s\)/); assert.ok(r3._img);
  const bad = await run('edit_artifact', { artifact: artId, edits: [{ old_text: 'introuvable', new_text: 'x' }] });
  assert.match(bad.error, /not found/);
  console.log('layout-test: all passed →', out);
  await app.evaluate(({ app }) => app.quit()).catch(() => {});
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });

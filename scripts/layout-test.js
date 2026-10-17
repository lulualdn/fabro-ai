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
  // tools Fabro asked for: selectors, conditional wait, element screenshot, image download, pause
  const http = require('http');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAMgAAADIAQMAAACXljzdAAAABlBMVEX/XkL///+GqyxSAAAAG0lEQVRYw+3BMQEAAADCoPVPbQ0PoAAAAAAAAPgaM7AAAWxCH4oAAAAASUVORK5CYII=', 'base64');
  const srv = http.createServer((q, r) => { if (q.url.startsWith('/img')) { r.writeHead(200, { 'Content-Type': 'image/svg+xml' }); return r.end('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><circle cx="100" cy="100" r="90" fill="#ff5e42"/></svg>'); }
    r.writeHead(200, { 'Content-Type': 'text/html' }); r.end('<title>T</title><img alt="Logo rouge" src="/img.svg" width="200" height="200"><input id="q"><button id="go" onclick="setTimeout(()=>{const d=document.createElement(\'p\');d.id=\'done\';d.textContent=\'OK \'+document.getElementById(\'q\').value;document.body.append(d)},800)">Go</button>'); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  await run('browser_open', { url: `http://127.0.0.1:${srv.address().port}/` });
  await run('browser_type', { selector: '#q', text: 'fabro' });
  await run('browser_click', { selector: '#go' });
  const w = await run('browser_wait', { selector: '#done', seconds: 10 });
  assert.match(w.content, /OK fabro/, 'selector click/type + wait for an element');
  const shotEl = await run('browser_screenshot', { selector: '#done' });
  assert.ok(shotEl._img && /#done/.test(shotEl.content), 'element screenshot');
  const dl = await run('browser_download_images', { folder: docs, min_size: 50 });
  assert.match(dl.content, /Saved 1 image/, dl.content);
  const p = await run('wait', { seconds: 0.5 }); assert.match(p.content, /Waited/);
  srv.close();
  console.log('• browser tools with selectors, wait, element screenshot, image download: ok');
  console.log('layout-test: all passed →', out);
  await app.evaluate(({ app }) => app.quit()).catch(() => {});
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });

// Fabro Docs / Slides / Calc ⇄ Office & OpenDocument: export from Fabro HTML, import, layout-keeping edits, previews.
// Run: xvfb-run -a npx electron scripts/office-test.js [outDir]
const { app, BrowserWindow } = require('electron');
const fs = require('fs'), path = require('path'), assert = require('assert');
const out = path.resolve(process.argv.find((a, i) => i > 1 && !a.startsWith('-') && !a.endsWith('.js')) || path.join(__dirname, '..', 'e2e-shots', 'office'));
app.on('window-all-closed', () => {});
app.setPath('userData', fs.mkdtempSync(path.join(require('os').tmpdir(), 'fabro-office-')));
const shot = async (html, file, w = 1100, h = 900) => { const p = path.join(out, file + '.html'); fs.writeFileSync(p, require('../src/main/kit').inject(html)); const win = new BrowserWindow({ show: false, width: w, height: h }); await win.loadFile(p); await new Promise((r) => setTimeout(r, 400)); fs.writeFileSync(path.join(out, file + '.png'), (await win.webContents.capturePage()).toPNG()); win.destroy(); };
app.whenReady().then(async () => {
  try {
    fs.mkdirSync(out, { recursive: true });
    const office = require('../src/main/office');
    const DOC = `<!doctype html><html><head><meta charset="utf-8"></head><body class="doc" data-theme="fabro"><header class="cover"><h1>Rapport annuel 2026</h1><p class="lead">UFStudios — bilan de l’année</p></header><h2>Chiffres clés</h2><p>Le chiffre d’affaires a <strong>progressé de 12 %</strong> grâce aux nouveaux clients.</p><ul><li>Clients : 120</li><li>Projets : 34</li></ul><table><tr><th>Mois</th><th>Ventes</th></tr><tr><td>Janvier</td><td>3 000 €</td></tr><tr><td>Février</td><td>4 200 €</td></tr></table></body></html>`;
    const DECK = `<!doctype html><html><head><meta charset="utf-8"></head><body class="deck" data-theme="sunset"><section class="slide title"><p class="kicker">UFStudios</p><h1>Présentation 2026</h1><p>Nos projets et nos chiffres</p></section><section class="slide"><h2>Points clés</h2><ul><li>Croissance de 12 %</li><li>34 projets livrés</li><li>Nouvelle équipe</li></ul></section></body></html>`;
    // 1. export Fabro HTML → the 4 formats, read back
    const art = (type, content) => ({ id: 'art-t' + type, type, title: 'Test ' + type, versions: [{ content }] });
    const dx = await office.exportArtifact(art('document', DOC), 'docx'); const ot = await office.exportArtifact(art('document', DOC), 'odt');
    const px = await office.exportArtifact(art('slides', DECK), 'pptx'); const op = await office.exportArtifact(art('slides', DECK), 'odp');
    for (const [b, e] of [[dx, 'docx'], [ot, 'odt'], [px, 'pptx'], [op, 'odp']]) fs.writeFileSync(path.join(out, 'export.' + e), b);
    const dm = office.readModel(dx, 'docx'), om = office.readModel(ot, 'odt');
    const dtext = (m) => m.blocks.map((b) => (b.runs || []).map((r) => r.text).join('') + (b.rows ? b.rows.flat().map((c) => c.runs.map((r) => r.text).join('')).join(' ') : '')).join('\n');
    for (const m of [dm, om]) { const t = dtext(m); assert.match(t, /Rapport annuel 2026/); assert.match(t, /progressé de 12 %/); assert.match(t, /Février/); assert.ok(m.blocks.some((b) => b.list === 'ul'), 'bullets'); assert.ok(m.blocks.some((b) => b.t === 'table'), 'table'); assert.ok(m.blocks.some((b) => (b.runs || []).some((r) => r.b && /progressé/.test(r.text))), 'bold kept'); }
    console.log('✓ Fabro Docs → docx / odt (title, bold, bullets, table)');
    for (const e of ['pptx', 'odp']) { const m = office.readModel(e === 'pptx' ? px : op, e); assert.strictEqual(m.slides.length, 2); const t = JSON.stringify(m.slides.map((s) => s.items.map((i) => (i.paras || []).map((p) => p.runs.map((r) => r.text).join(''))))); assert.match(t, /Présentation 2026/); assert.match(t, /34 projets livrés/); assert.ok(m.slides[0].bg && m.slides[0].bg !== '#ffffff' || m.slides[0].items.some((i) => i.t === 'shape' || i.t === 'img'), 'slide background'); }
    console.log('✓ Fabro Slides → pptx / odp (2 slides, text, background)');
    // 2. Calc
    const wb = { sheets: [{ name: 'Budget', rows: [['Poste', 'Montant'], ['Loyer', 650], ['Courses', 320], ['Total', '=SUM(B2:B3)']], style: { 1: { b: 1, bg: '#f2efe8' } }, cols: [140, 100] }] };
    for (const e of ['xlsx', 'ods']) { const b = await office.exportArtifact(art('sheet', JSON.stringify(wb)), e); fs.writeFileSync(path.join(out, 'export.' + e), b); const back = office.readModel(b, e); assert.strictEqual(back.sheets[0].rows[3][1], '=SUM(B2:B3)'); assert.strictEqual(new office.calc.Workbook(back).computed(0)[3][1], 970); }
    console.log('✓ Fabro Calc → xlsx / ods (formulas kept and computed)');
    // 3. import: keeps the original, preview + edits that keep the layout
    for (const e of ['docx', 'odt', 'pptx', 'odp', 'xlsx']) {
      const f = path.join(out, 'export.' + e); const a = office.importFile(f);
      if (e === 'xlsx') { assert.strictEqual(a.type, 'sheet'); continue; }
      assert.ok(a.office && a.versions[0].pkg, 'original kept');
      const outl = office.outline(office.loadPkg(a), e);
      const old = /docx|odt/.test(e) ? 'Rapport annuel 2026' : 'Présentation 2026';
      assert.ok(outl.includes(old), `${e} outline: ${outl.slice(0, 200)}`);
      const r = office.editPackage(office.loadPkg(a), e, [{ old_text: old, new_text: old.replace('2026', '2027') }]);
      assert.ok(!r.error, r.error);
      const prev = office.previewOf(r.buf, e, a.title);
      assert.ok(prev.includes('2027') && !prev.includes(old), `${e} edited`);
      await shot(prev, 'import-' + e, /docx|odt/.test(e) ? 1000 : 1200, 900);
    }
    console.log('✓ imported docx/odt/pptx/odp: original kept, text edited in place, previews rendered');
    // 4. visual edit ops on the source
    const ed = require('../src/main/office/editor');
    const ann = ed.annotate(DOC); const id = +ann.match(/<h2 data-fe="(\d+)"/)[1];
    const r = ed.applyOps(DOC, [{ id, op: 'style', props: { color: '#d0342c', translate: '10px 4px' } }, { id: id + 1, op: 'text', html: 'Nouveau <b>texte</b>' }, { id: +ann.match(/<ul data-fe="(\d+)"/)[1], op: 'delete' }]);
    assert.match(r.html, /<h2 style="color:#d0342c;translate:10px 4px">Chiffres clés<\/h2>/); assert.match(r.html, /<p>Nouveau <b>texte<\/b><\/p>/); assert.ok(!/<ul>/.test(r.html) && !/data-fe/.test(r.html));
    console.log('✓ visual edits (colour, move, text, delete) applied to the source');
    console.log('office-test: all passed →', out);
    app.exit(0);
  } catch (e) { console.error(e); app.exit(1); }
});

// Fabro Calc grid + visual editor in the real app: import a spreadsheet, type a formula in the grid,
// select / recolour / move / delete elements of a page, ask the AI about a selection.
// Run: xvfb-run -a node scripts/office-ui-e2e.js [shotsDir]
const { _electron: electron } = require('playwright-core');
const fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert');
const shots = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'fabro-oui-')); fs.mkdirSync(shots, { recursive: true });
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'fabro-oui-e2e-'));
fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ autoUpdate: false, language: 'fr', userName: 'Lulu', theme: 'light', onboarded: true, devModeReleased: true }));
const step = (s) => console.log('✓', s); const wait = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const app = await electron.launch({ executablePath: require('electron'), args: [path.join(__dirname, '..'), `--user-data-dir=${userData}`, '--no-sandbox'], env: { ...process.env, FABRO_E2E: '1' } });
  const win = await app.firstWindow(); const errs = []; win.on('pageerror', (e) => errs.push(e.message));
  try {
    await win.waitForSelector('#sb-lists', { timeout: 30000 });
    // a CSV becomes Fabro Calc
    const csv = path.join(userData, 'budget.csv'); fs.writeFileSync(csv, 'Poste,Montant\nLoyer,650\nCourses,320\n');
    const res = await win.evaluate(async (f) => { try { return await api.artifacts.import([f]); } catch (e) { return 'ERR ' + e.message; } }, csv); const [imp] = res;
    assert.strictEqual(imp.type, 'sheet');
    await win.evaluate((id) => openArtifact(id), imp.id);
    const frame = await (await win.waitForSelector('iframe.art-frame')).contentFrame();
    await frame.waitForSelector('td[data-r="3"][data-c="0"]');
    await wait(800); await frame.click('td[data-r="3"][data-c="0"]'); await win.keyboard.type('Total'); await win.keyboard.press('Tab');
    await win.keyboard.type('=SUM(B2:B3)'); await win.keyboard.press('Enter');
    await frame.waitForFunction(() => document.querySelector('td[data-r="3"][data-c="1"]').textContent.includes('970'));
    await win.screenshot({ path: path.join(shots, 'calc.png') });
    await wait(1300);
    const saved = await win.evaluate((id) => api.artifacts.get(id), imp.id);
    assert.match(saved.versions.at(-1).content, /=SUM\(B2:B3\)/); step('Fabro Calc: CSV imported, formula typed in the grid, computed and saved');
    // visual editor on a page
    const page = `<!doctype html><html><head><meta charset="utf-8"></head><body data-theme="fabro"><header class="hero center"><div class="container"><h1>Mon site</h1><p class="lead">Un sous-titre</p></div></header><section class="section"><div class="container"><p id="x">Paragraphe à supprimer</p></div></section></body></html>`;
    const a = await win.evaluate((c) => api.artifacts.save({ id: 'art-ui1', type: 'html', title: 'Page test', versions: [{ content: c, at: Date.now(), by: 'user' }] }), page);
    await win.evaluate((id) => openArtifact(id), a.id);
    await win.click('[data-action=fe-start]');
    const ef = await (await win.waitForSelector('#fe-frame')).contentFrame();
    await ef.waitForSelector('h1[data-fe]');
    await ef.click('h1'); await win.waitForSelector('.fe-bar [data-action=fe-delete]:not([disabled])');
    await win.evaluate(() => { const i = document.querySelector('[data-fe-prop=color]'); i.value = '#d0342c'; i.dispatchEvent(new Event('change', { bubbles: true })); });
    const box = await (await ef.$('h1')).boundingBox(); 
    const fb = await (await win.$('#fe-frame')).boundingBox();
    await win.mouse.move(box.x + 20, box.y + 10); await win.mouse.down(); await win.mouse.move(box.x + 80, box.y + 40, { steps: 6 }); await win.mouse.up();
    await ef.click('#x'); await win.click('[data-action=fe-delete]');
    await win.screenshot({ path: path.join(shots, 'visual-editor.png') });
    const nOps = await win.evaluate(() => S.viewer.ops.length); assert.ok(nOps >= 3, 'ops recorded: ' + nOps);
    await win.click('#fe-save'); await wait(400);
    const after = (await win.evaluate((id) => api.artifacts.get(id), a.id)).versions.at(-1).content;
    assert.match(after, /<h1 style="[^"]*color:#d0342c[^"]*translate:[^"]+">Mon site<\/h1>/); assert.ok(!/Paragraphe à supprimer/.test(after) && !/data-fe/.test(after));
    step('visual editor: recolour + move + delete saved as a new version of the source');
    // ask the AI about a selection
    await win.click('[data-action=fe-start]'); const ef2 = await (await win.waitForSelector('#fe-frame')).contentFrame(); await ef2.waitForSelector('p.lead[data-fe]');
    await ef2.click('p.lead'); await win.waitForSelector('[data-action=fe-ask]:not([disabled])'); await win.click('[data-action=fe-ask]');
    await win.waitForFunction(() => /art-ui1/.test((document.querySelector('#prompt') || {}).value || '') && /<(h1|p)\b/.test(document.querySelector('#prompt').value), null, { timeout: 8000 });
    step('ask the AI: the selected element is put in the message, with the artifact id');
    assert.deepStrictEqual(errs, []);
    console.log('office-ui-e2e: all passed →', shots);
  } catch (e) { console.error(e); await win.screenshot({ path: path.join(shots, 'fail.png') }).catch(() => {}); process.exitCode = 1; } finally { await app.close(); }
})();

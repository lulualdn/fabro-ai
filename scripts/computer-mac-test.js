// Computer Use on macOS, for real: the Swift helper (universal build), the Accessibility tree of a
// separate app (button, field, list by name), Quartz input (click, double-click, typing, cmd shortcuts,
// drag, scroll), TextEdit through `open -a`, Vision text recognition, Fabro's own window refused.
// Run (Mac, after scripts/build-mac-helper.sh): npx electron scripts/computer-mac-test.js [outDir]
// Needs Accessibility + Screen Recording for the process that runs it (CI grants them in TCC).
const { app, BrowserWindow } = require('electron');
const fs = require('fs'); const os = require('os'); const path = require('path'); const assert = require('assert');
const { spawn } = require('child_process');
const out = path.resolve(process.argv.find((a, i) => i > 1 && !a.startsWith('-') && !a.endsWith('.js')) || fs.mkdtempSync(path.join(os.tmpdir(), 'fabro-cum-')));
fs.mkdirSync(out, { recursive: true });
app.on('window-all-closed', () => {});
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'fabro-cum-ud-')));
fs.writeFileSync(path.join(app.getPath('userData'), 'settings.json'), JSON.stringify({ language: 'fr', computer: { speed: 'natural', hideFabro: false } }));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  let target = null;
  try {
    await require('../src/main/store').init();
    const agent = require('../src/main/agent');
    const cu = require('../src/main/computer');
    const ctx = { reqId: 'm1', convId: 'cm', emit: () => {}, grants: new Set(['computer']), onAbort: () => {}, ask: async () => 'once' };
    const run = async (name, args = {}) => { try { return await agent.execute({ name, args }, ctx); } catch (e) { return { error: e.message, code: e.code }; } };
    const save = (r, f) => { if (r && r.image) fs.writeFileSync(path.join(out, f), Buffer.from(r.image.split(',')[1], 'base64')); };
    const marks = () => [...cu._internal.S.look.marks.values()];
    const find = (re, role) => marks().find((m) => re.test(m.name || '') && (!role || m.role === role));
    const t0 = Date.now();

    console.log('helper:', await require('../src/main/computer/mac').binary());

    const logFile = path.join(out, 'target-log.json');
    target = spawn(process.execPath, [path.join(__dirname, 'fixtures', 'cu-target.js'), logFile], { stdio: 'ignore' });
    const log = () => { try { return JSON.parse(fs.readFileSync(logFile, 'utf8')); } catch { return {}; } };
    for (let i = 0; i < 60 && !fs.existsSync(logFile); i++) await wait(250);
    await wait(1500);

    // 1. look: the Accessibility tree of the other app
    let r, btn;
    for (let i = 0; i < 5 && !btn; i++) {
      r = await run('computer_look', { wait_ms: i ? 1500 : 0 });
      assert.ok(!r.error, r.error);
      btn = find(/^VALIDER$/, 'button');
    }
    // the same app looked at as one window: picture of that window only, still found by id
    r = await run('computer_look', { window: 'Appli de test' });
    assert.ok(!r.error, r.error);
    assert.match(r.content, /Window "Appli de test" \(.*\) only/, 'a window-only look');
    btn = find(/^VALIDER$/, 'button');
    assert.ok(btn, 'the button is in the window look too');
    save(r, '1b-window.jpg');
    console.log(r.content.split('\n').slice(0, 32).join('\n'));
    save(r, '1-look.jpg');
    assert.ok(btn, 'the VALIDER button is found through Accessibility');

    // 2. click, double-click
    r = await run('computer_click', { element: btn.id });
    assert.ok(!r.error, r.error); await wait(300);
    assert.equal(log().clicks, 1, 'one click');
    r = await run('computer_click', { element: find(/^VALIDER$/, 'button').id, clicks: 2 });
    await wait(300);
    assert.equal(log().clicks, 3, 'a double-click is two clicks');

    // 3. typing + cmd shortcuts
    const field = find(/Champ de test/, 'edit');
    assert.ok(field, 'the text field is found');
    r = await run('computer_type', { element: field.id, text: 'Bonjour Lulu — déjà vu ✓' });
    await wait(300);
    assert.equal(log().value, 'Bonjour Lulu — déjà vu ✓', 'typed exactly');
    r = await run('computer_key', { keys: 'cmd+a backspace' });
    await wait(300);
    assert.equal(log().value, '', 'cmd+a then backspace cleared it');

    // 4. drag on the canvas, scroll the list
    const pad = find(/Zone de dessin/);
    assert.ok(pad, 'the canvas is found');
    r = await run('computer_drag', { x: pad.ir[0] + 20, y: pad.ir[1] + 20, to_x: pad.ir[0] + pad.ir[2] - 30, to_y: pad.ir[1] + pad.ir[3] - 30 });
    assert.ok(!r.error, r.error); await wait(300);
    console.log('drag', JSON.stringify(log().drag));
    assert.ok(log().drag && log().drag.moves >= 15, 'a smooth drag');
    save(r, '2-drag.jpg');
    const list = find(/^Liste$/) || find(/Ligne 3/);
    r = await run('computer_scroll', list ? { element: list.id, direction: 'down', amount: 4 } : { x: 700, y: 150, direction: 'down', amount: 4 });
    await wait(400);
    assert.ok(log().scroll > 40, 'the list scrolled');

    // 5. Fabro's own window is off limits
    const own = new BrowserWindow({ x: 300, y: 560, width: 500, height: 200, show: true, alwaysOnTop: true, title: 'Fabro (test)' });
    await own.loadURL('data:text/html,<h1>Fabro</h1>'); await wait(700);
    r = await run('computer_look', {});
    const L = cu._internal.S.look;
    r = await run('computer_click', { x: Math.round((550 - L.mon.x) * L.scale), y: Math.round((660 - L.mon.y) * L.scale) });
    assert.equal(r.code, 'SELF_TARGET', 'clicks on Fabro itself are refused');
    own.destroy();

    // 6. TextEdit
    r = await run('computer_open_app', { name: 'TextEdit', wait_ms: 3000 });
    assert.ok(!r.error, r.error);
    if (!/TextEdit/.test(r.content)) console.log(r.content.slice(0, 1500));
    // a new document if the open panel shows up
    if (marks().some((m) => /New Document|Nouveau document/i.test(m.name || ''))) r = await run('computer_click', { element: find(/New Document|Nouveau document/i).id });
    else r = await run('computer_key', { keys: 'cmd+n' });
    r = await run('computer_type', { text: 'Fabro Computer Use sur Mac', wait_ms: 600 });
    save(r, '3-textedit.jpg');
    assert.match(r.content, /Fabro Computer Use sur Mac/, 'TextEdit’s text is read back');

    // 7. Vision OCR
    r = await run('computer_look', { read_text: true });
    console.log('OCR:', /Text read on screen/.test(r.content) ? 'ok' : 'none');
    save(r, '4-ocr.jpg');
    // Fabro steps aside while it works, and comes back when the turn ends
    await require('../src/main/store').setSettings({ computer: { hideFabro: true } });
    const fabroWin = new BrowserWindow({ x: 200, y: 120, width: 500, height: 300, show: true, title: 'Fabro' });
    await fabroWin.loadURL('data:text/html,<h1>Fabro</h1>'); await wait(500);
    cu.init({ getMain: () => fabroWin });
    const ctx2 = { ...ctx, reqId: 'turn2' };
    try { await agent.execute({ name: 'computer_look', args: {} }, ctx2); } catch (e) { console.log('look2', e.message); }
    await wait(400);
    assert.ok(fabroWin.isMinimized(), 'Fabro minimized itself while working');
    cu.turnEnded('turn2'); await wait(600);
    assert.ok(!fabroWin.isMinimized(), 'and came back at the end of the turn');
    fabroWin.destroy();

    const ts = await cu.test();
    console.log('settings test:', JSON.stringify({ ...ts, thumb: !!ts.thumb }));
    assert.ok(ts.ok, ts.error);
    console.log(`\nComputer Use on macOS OK in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    cu.shutdown();
  } catch (e) {
    console.error(e); process.exitCode = 1;
  } finally {
    const code = process.exitCode || 0;
    try { if (target) target.kill('SIGKILL'); } catch {}
    try { spawn('pkill', ['-x', 'TextEdit'], { stdio: 'ignore', detached: true }).unref(); } catch {}
    console.log('exit', code);
    process.exit(code);
  }
});

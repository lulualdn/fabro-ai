// Computer Use on Windows, for real: builds the native helper with the Windows C# compiler, reads a
// separate app through UI Automation (button, field, list by name), clicks / types / shortcuts /
// drags / scrolls in it with SendInput, works in Notepad, refuses to click Fabro's own window,
// tries the built-in OCR, and saves the marked screenshots.
// Run (Windows): npx electron scripts/computer-win-test.js [outDir]
const { app, BrowserWindow } = require('electron');
const fs = require('fs'); const os = require('os'); const path = require('path'); const assert = require('assert');
const { spawn, execFileSync } = require('child_process');
const out = path.resolve(process.argv.find((a, i) => i > 1 && !a.startsWith('-') && !a.endsWith('.js')) || fs.mkdtempSync(path.join(os.tmpdir(), 'fabro-cuw-')));
fs.mkdirSync(out, { recursive: true });
app.on('window-all-closed', () => {});
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'fabro-cuw-ud-')));
fs.writeFileSync(path.join(app.getPath('userData'), 'settings.json'), JSON.stringify({ language: 'fr', computer: { speed: 'natural', hideFabro: false } }));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  let target = null, notepad = null;
  try {
    await require('../src/main/store').init();
    const agent = require('../src/main/agent');
    const cu = require('../src/main/computer');
    const ctx = { reqId: 'w1', convId: 'cw', emit: () => {}, grants: new Set(['computer']), onAbort: () => {}, ask: async () => 'once' };
    const run = async (name, args = {}) => { try { return await agent.execute({ name, args }, ctx); } catch (e) { return { error: e.message, code: e.code }; } };
    const save = (r, f) => { if (r && r.image) fs.writeFileSync(path.join(out, f), Buffer.from(r.image.split(',')[1], 'base64')); };
    const marks = () => [...cu._internal.S.look.marks.values()];
    const find = (re, role) => marks().find((m) => re.test(m.name || '') && (!role || m.role === role));
    const t0 = Date.now();

    // 0. the helper builds and starts
    const built = await require('../src/main/computer/win').build();
    console.log('helper:', built);

    // 1. a separate app (Fabro never acts on its own windows)
    const logFile = path.join(out, 'target-log.json');
    target = spawn(process.execPath, [path.join(__dirname, 'fixtures', 'cu-target.js'), logFile], { stdio: 'ignore' });
    const log = () => { try { return JSON.parse(fs.readFileSync(logFile, 'utf8')); } catch { return {}; } };
    for (let i = 0; i < 60 && !fs.existsSync(logFile); i++) await wait(250);
    await wait(1500);

    // 2. look: UI Automation sees the app's controls by name (Chromium turns accessibility on when asked)
    let r, btn;
    for (let i = 0; i < 4 && !btn; i++) {
      r = await run('computer_look', { wait_ms: i ? 1200 : 0 });
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
    console.log(r.content.split('\n').slice(0, 30).join('\n'));
    save(r, '1-look.jpg');
    assert.ok(btn, 'the VALIDER button is found by UI Automation');
    assert.match(r.content, /Active window: "Appli de test"/);

    // 3. click it by id
    r = await run('computer_click', { element: btn.id });
    assert.ok(!r.error, r.error);
    await wait(300);
    assert.equal(log().clicks, 1, 'one click');
    assert.match(r.content, /Screen after the action: changed/);

    // 4. type into the field, then shortcuts
    const field = find(/Champ de test/, 'edit');
    assert.ok(field, 'the text field is found');
    r = await run('computer_type', { element: field.id, text: 'Bonjour Lulu — déjà vu ✓' });
    await wait(300);
    assert.equal(log().value, 'Bonjour Lulu — déjà vu ✓', 'typed exactly, accents and symbols included');
    assert.match(r.content, /text field "Champ de test" = "Bonjour Lulu/, 'the new value is read back');
    r = await run('computer_key', { keys: 'ctrl+a backspace' });
    await wait(300);
    assert.equal(log().value, '');
    assert.ok(log().keys.includes('ctrl+a'), 'ctrl+a arrived as a shortcut');

    // 5. drag on the canvas
    const pad = find(/Zone de dessin/);
    assert.ok(pad, 'the canvas is found');
    const L = cu._internal.S.look;
    r = await run('computer_drag', { x: pad.ir[0] + 20, y: pad.ir[1] + 20, to_x: pad.ir[0] + pad.ir[2] - 30, to_y: pad.ir[1] + pad.ir[3] - 30 });
    assert.ok(!r.error, r.error);
    await wait(300);
    console.log('drag', JSON.stringify(log().drag), 'scale', L.scale);
    assert.ok(log().drag && log().drag.moves >= 15, 'a smooth drag');
    save(r, '2-drag.jpg');

    // 6. scroll the list
    const list = find(/^Liste$/) || find(/Ligne 3/);
    r = await run('computer_scroll', list ? { element: list.id, direction: 'down', amount: 4 } : { x: 700, y: 150, direction: 'down', amount: 4 });
    await wait(300);
    assert.ok(log().scroll > 40, 'the list scrolled');

    // 7. Fabro's own window is off limits
    const own = new BrowserWindow({ x: 300, y: 600, width: 500, height: 200, show: true, alwaysOnTop: true, title: 'Fabro (test)' });
    await own.loadURL('data:text/html,<h1>Fabro</h1>');
    await wait(600);
    r = await run('computer_look', {});
    const sc = cu._internal.S.look.scale; const mon = cu._internal.S.look.mon;
    r = await run('computer_click', { x: Math.round((550 - mon.x) * sc), y: Math.round((700 - mon.y) * sc) });
    assert.equal(r.code, 'SELF_TARGET', 'clicks on Fabro itself are refused');
    own.destroy();

    // 8. Notepad: open, type, read back
    r = await run('computer_open_app', { path_or_url: path.join(process.env.WINDIR || 'C:\\Windows', 'notepad.exe'), wait_ms: 2500 });
    assert.ok(!r.error, r.error);
    r = await run('computer_window', { action: 'focus', window: 'notepad' });
    r = await run('computer_type', { text: 'Fabro Computer Use\nLigne 2 : ça marche !' });
    assert.ok(!r.error, r.error);
    save(r, '3-notepad.jpg');
    assert.match(r.content, /Fabro Computer Use/, 'Notepad’s text is read back through UI Automation');

    // 8b. a context menu is its own window: its items are read too
    console.log('notepad marks:', JSON.stringify(marks().map((m) => [m.id, m.role, m.name, m.ir, m.focusable, m.acts])));
    const doc = marks().filter((m) => m.role === 'edit' || m.role === 'document').sort((a, b) => b.ir[2] * b.ir[3] - a.ir[2] * a.ir[3])[0]; // the text area: the biggest field
    r = await run('computer_click', doc ? { element: doc.id, button: 'right' } : { x: 300, y: 300, button: 'right' });
    const all = marks().find((m) => m.role === 'menuitem' && /select all|tout s/i.test(m.name || ''));
    console.log('context menu items:', marks().filter((m) => m.role === 'menuitem').map((m) => `${m.name}@${m.cx},${m.cy}[${m.win}]`).join(' | '));
    console.log('top-level now:', JSON.stringify(((await cu._internal.backend().call('toplevel')).windows || []).filter((w) => w.app === 'notepad' || /#32768/.test(w.cls)).map((w) => [w.cls, w.title, w.rect, (w.style >>> 0).toString(16), (w.ex >>> 0).toString(16)])));
    console.log('windows now:', JSON.stringify((await require('../src/main/computer/index.js')._internal.S.look.wins || []).map((w) => [w.title, w.cls, w.app])));
    console.log('after right-click:', r.content.split('\n').slice(0, 8).join(' / '));
    assert.ok(all, 'the context menu items are found');
    r = await run('computer_click', { element: all.id });
    console.log('after Select All:', r.error || r.content.split('\n').slice(0, 12).join(' / '));
    save(r, '3b-after-select-all.jpg');
    r = await run('computer_type', { text: 'Remplacé' });
    assert.match(r.content, /= "Remplacé"/, 'Select All from the menu, then typing replaced the text');
    save(r, '3b-menu.jpg');

    // 9. the OCR built into Windows (the runner may have no OCR language: then it says so)
    r = await run('computer_look', { read_text: true });
    console.log('OCR:', /Text read on screen/.test(r.content) ? 'ok' : (r.content.match(/\(.*(OCR|recognition).*\)/) || ['unavailable'])[0]);
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

    console.log(`\nComputer Use on Windows OK in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    cu.shutdown();
  } catch (e) {
    console.error(e); process.exitCode = 1;
  } finally {
    const code = process.exitCode || 0;
    // nothing synchronous here: kill what the test opened and leave
    try { if (target) { target.kill(); spawn('taskkill', ['/F', '/T', '/PID', String(target.pid)], { stdio: 'ignore', detached: true }).unref(); } } catch {}
    try { spawn('taskkill', ['/F', '/IM', 'notepad.exe'], { stdio: 'ignore', detached: true }).unref(); } catch {}
    console.log('exit', code);
    process.exit(code);
  }
});

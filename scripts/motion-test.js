// Motion / fluidity test of the real Electron app, on a deliberately slow CPU.
// Drives the transitions people see most and records every frame and long task while they run:
//   sidebar (fast toggling, interrupted mid-flight, and slow), settings dialog, model picker, side panel
//   (artifact), scrolling a long conversation, a long streaming answer.
// CPU is throttled through CDP (Emulation.setCPUThrottlingRate) at each rate given.
//
// Usage: xvfb-run -a node scripts/motion-test.js [--app <dir>] [--rates 4,6] [--json out.json] [--shots <dir>]
//   --app    the Fabro folder to launch (default: this repo) — point it at an older checkout to compare
//   --shots  also save screenshots of the main screens at 1280×820 and 390×844 (phone), light and dark
// Serialize with the other Electron runs: flock /tmp/fabro-e2e.lock xvfb-run -a -s "-screen 0 1440x900x24" node scripts/motion-test.js
const { _electron: electron } = require('playwright-core');
const http = require('http'); const fs = require('fs'); const os = require('os'); const path = require('path');

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const APP = path.resolve(arg('app', path.join(__dirname, '..')));
const RATES = String(arg('rates', '4,6')).split(',').map(Number).filter(Boolean);
const JSON_OUT = arg('json', null);
const SHOTS = arg('shots', null);

// A long markdown answer: paragraphs, a list, a table, code — what a real answer looks like.
const LONG = Array.from({ length: 6 }, (_, k) => `## Partie ${k + 1}\n\nLe moteur charge le modèle par morceaux, puis garde en mémoire ce qui sert le plus souvent. Sur une carte modeste, c'est la taille du contexte qui décide de la vitesse : plus il est long, plus chaque mot coûte.\n\n- Premier point, avec **un peu de gras** et \`du code\`\n- Deuxième point, un peu plus long pour passer à la ligne sur une fenêtre étroite\n- Troisième point\n\n| Réglage | Valeur | Effet |\n|---|---|---|\n| Contexte | 8K | rapide |\n| Couches GPU | auto | équilibré |\n\n\`\`\`js\nfunction somme(a, b) {\n  return a + b; // ${k}\n}\n\`\`\`\n`).join('\n');

const srv = http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
    if (req.url === '/v1/models') return res.end(JSON.stringify({ data: [{ id: 'fake-model' }] }));
    if (req.url === '/v1/chat/completions') {
      const body = JSON.parse(b || '{}');
      const sys = String(((body.messages || [])[0] || {}).content || '');
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      if (/You name conversations|maintain a short memory|keep a small, honest memory/.test(sys)) { res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Test' } }] })}\n\n`); return res.end('data: [DONE]\n\n'); }
      const parts = LONG.match(/.{1,4}/gs); let i = 0;
      const tick = setInterval(() => {
        if (i < parts.length) { res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: parts[i++] } }] })}\n\n`); return; }
        clearInterval(tick); res.end('data: [DONE]\n\n');
      }, 12);
      return;
    }
    res.writeHead(404); res.end('{}');
  });
});

// In the page: count frames (rAF deltas) and long tasks between start() and stop().
const PROBE = () => {
  window.__perf = {
    start() {
      const p = { d: [], lt: [], on: true, last: performance.now() };
      const loop = (t) => { if (!p.on) return; p.d.push(t - p.last); p.last = t; requestAnimationFrame(loop); };
      requestAnimationFrame((t) => { p.last = t; requestAnimationFrame(loop); });
      p.obs = new PerformanceObserver((l) => { for (const e of l.getEntries()) p.lt.push(e.duration); });
      try { p.obs.observe({ type: 'longtask' }); } catch {}
      this.p = p;
    },
    stop() {
      const p = this.p; p.on = false; p.obs.disconnect();
      const d = p.d.slice().sort((a, b) => a - b);
      const q = (x) => (d.length ? d[Math.min(d.length - 1, Math.floor(d.length * x))] : 0);
      return { frames: d.length, mean: d.reduce((a, b) => a + b, 0) / (d.length || 1), p95: q(0.95), max: d[d.length - 1] || 0,
        over32: d.filter((x) => x > 32).length, over50: d.filter((x) => x > 50).length, longTasks: p.lt.length, longMax: Math.max(0, ...p.lt) };
    },
  };
};

async function launch(theme = 'light') {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'fabro-motion-'));
  fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ autoUpdate: false, language: 'fr', userName: 'Lulu', theme, onboarded: true, lightMode: false }));
  const app = await electron.launch({ executablePath: require(path.join(APP, 'node_modules', 'electron')), args: [APP, `--user-data-dir=${userData}`, '--no-sandbox'], env: { ...process.env, FABRO_E2E: '1' } });
  const win = await app.firstWindow();
  await win.setViewportSize({ width: 1280, height: 820 }).catch(() => {});
  await win.waitForSelector('.greet', { timeout: 20000 });
  await win.evaluate(PROBE);
  // a provider with one model, selected
  await win.evaluate(async (base) => {
    await api.providers.enable(true);
    await api.providers.add({ kind: 'custom', name: 'Test', baseUrl: base });
    await refreshModels();
    const m = allModels().find((x) => /fake-model/.test(x.label));
    if (m) await saveSettings({ selectedModel: m.ref });
    renderSidebar(); renderView();
  }, global.__base);
  await win.waitForTimeout(800);
  return { app, win };
}

// a conversation of 40 messages, rendered by the app's own code
async function longConversation(win) {
  await win.evaluate((text) => {
    const now = Date.now() - 3600e3;
    const messages = [];
    let parent = null;
    for (let i = 0; i < 20; i++) {
      messages.push({ id: 'u' + i, parentId: parent, role: 'user', content: 'Explique-moi la partie ' + (i + 1) + ' en détail, avec un exemple.', createdAt: now + i * 1000 });
      messages.push({ id: 'a' + i, parentId: 'u' + i, role: 'assistant', content: text, createdAt: now + i * 1000 + 500, stats: { completionTokens: 812, tokPerSec: 38.2 } });
      parent = 'a' + i;
    }
    S.mode = 'chat'; S.conv = { id: 'perf', title: 'Une longue conversation', messages, nodes: messages.slice(), leafId: parent, createdAt: now, updatedAt: now };
    renderSidebar(); renderView();
  }, LONG);
  await win.waitForTimeout(500);
}

async function measure(win, name, fn) {
  await win.evaluate(() => window.__perf.start());
  await fn();
  await win.waitForTimeout(450); // let the last movement settle
  const r = await win.evaluate(() => window.__perf.stop());
  return { name, ...r };
}

const SCENARIOS = {
  'sidebar, fast toggles (interrupted)': async (win) => { for (let i = 0; i < 8; i++) { await win.keyboard.press('Control+b'); await win.waitForTimeout(110); } },
  'sidebar, open/close': async (win) => { for (let i = 0; i < 4; i++) { await win.keyboard.press('Control+b'); await win.waitForTimeout(550); } },
  'settings open/close': async (win) => { for (let i = 0; i < 3; i++) { await win.keyboard.press('Control+,'); await win.waitForTimeout(600); await win.keyboard.press('Escape'); await win.waitForTimeout(450); } },
  'model picker': async (win) => { for (let i = 0; i < 3; i++) { await win.click('[data-action=model-menu]'); await win.waitForTimeout(450); await win.keyboard.press('Escape'); await win.waitForTimeout(350); } },
  'side panel (artifact)': async (win) => {
    for (let i = 0; i < 3; i++) {
      await win.evaluate((t) => openViewer({ type: 'markdown', title: 'Lettre', text: t }), LONG); await win.waitForTimeout(600);
      await win.evaluate(() => closeViewer()); await win.waitForTimeout(600);
    }
  },
  'scroll long conversation': async (win) => {
    await win.mouse.move(700, 400);
    await win.evaluate(() => { const s = document.getElementById('scroller'); if (s) s.scrollTop = 0; });
    for (let i = 0; i < 24; i++) { await win.mouse.wheel(0, 260); await win.waitForTimeout(40); }
  },
  'streaming answer': async (win) => {
    await win.evaluate(() => { S.conv = null; renderView(); });
    await win.fill('#prompt', 'Fais-moi une longue réponse');
    await win.keyboard.press('Enter');
    await win.waitForFunction(() => !S.streaming, null, { timeout: 120000, polling: 250 });
  },
};

async function shots(dir) {
  fs.mkdirSync(dir, { recursive: true });
  for (const theme of ['light', 'dark']) {
    const { app, win } = await launch(theme);
    for (const [w, h, tag] of [[1280, 820, 'desk'], [390, 844, 'phone']]) {
      await win.setViewportSize({ width: w, height: h });
      await win.evaluate(() => { S.conv = null; renderSidebar(); renderView(); });
      await win.waitForTimeout(1400);
      await win.screenshot({ path: `${dir}/${tag}-${theme}-1-welcome.png` });
      await longConversation(win);
      await win.evaluate(() => { const s = document.getElementById('scroller'); if (s) s.scrollTop = 900; });
      await win.waitForTimeout(300);
      await win.screenshot({ path: `${dir}/${tag}-${theme}-2-thread.png` });
      await win.click('[data-action=model-menu]'); await win.waitForTimeout(500);
      await win.screenshot({ path: `${dir}/${tag}-${theme}-3-models.png` });
      await win.keyboard.press('Escape'); await win.waitForTimeout(300);
      await win.evaluate(() => openSettings('general')); await win.waitForTimeout(700);
      await win.screenshot({ path: `${dir}/${tag}-${theme}-4-settings.png` });
      await win.evaluate(() => openSettings('models')); await win.waitForTimeout(900);
      await win.screenshot({ path: `${dir}/${tag}-${theme}-5-settings-models.png` });
      await win.evaluate(() => closeSettings()); await win.waitForTimeout(400);
      await win.evaluate((t) => openViewer({ type: 'markdown', title: 'Lettre', text: t }), LONG); await win.waitForTimeout(600);
      await win.screenshot({ path: `${dir}/${tag}-${theme}-6-panel.png` });
      await win.evaluate(() => closeViewer()); await win.waitForTimeout(500);
      if (tag === 'desk') { await win.keyboard.press('Control+b'); await win.waitForTimeout(600); await win.screenshot({ path: `${dir}/${tag}-${theme}-7-collapsed.png` }); await win.keyboard.press('Control+b'); await win.waitForTimeout(500); }
      else { await win.click('.topbar [data-action=toggle-sidebar]'); await win.waitForTimeout(600); await win.screenshot({ path: `${dir}/${tag}-${theme}-7-drawer.png` }); await win.click('#sb-scrim', { position: { x: 380, y: 400 } }).catch(() => {}); await win.waitForTimeout(400); }
    }
    await app.close();
  }
}

(async () => {
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  global.__base = `http://127.0.0.1:${srv.address().port}/v1`;
  if (SHOTS) { await shots(SHOTS); console.log('screenshots →', SHOTS); }
  const results = [];
  if (RATES.length) {
    const { app, win } = await launch('light');
    const cdp = await win.context().newCDPSession(win);
    for (const rate of RATES) {
      await cdp.send('Emulation.setCPUThrottlingRate', { rate });
      for (const [name, fn] of Object.entries(SCENARIOS)) {
        if (name === 'streaming answer') { await win.evaluate(() => { S.conv = null; renderView(); }); }
        else await longConversation(win);
        const r = await measure(win, name, () => fn(win));
        results.push({ rate, ...r });
        console.log(`${rate}×  ${name.padEnd(36)} frames ${String(r.frames).padStart(4)}  mean ${r.mean.toFixed(1).padStart(5)}  p95 ${r.p95.toFixed(1).padStart(5)}  max ${r.max.toFixed(1).padStart(6)}  >32ms ${String(r.over32).padStart(3)}  >50ms ${String(r.over50).padStart(3)}  long tasks ${r.longTasks} (max ${r.longMax.toFixed(0)} ms)`);
      }
    }
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    await app.close();
  }
  if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify({ app: APP, results }, null, 2));
  srv.close();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });

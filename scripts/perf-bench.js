// Renderer smoothness benchmark: a long streamed answer (markdown, code blocks, lists, a table) from a fake
// OpenAI-compatible server, in the real Electron app, under CPU throttling (CDP), after a few long turns.
// Records long tasks (PerformanceObserver) and frame intervals (rAF) during the stream.
// Usage: flock /tmp/fabro-e2e.lock xvfb-run -a -s "-screen 0 1440x900x24" node scripts/perf-bench.js [throttle=4] [tokens=3000] [msPerToken=6]
const { _electron: electron } = require('playwright-core');
const http = require('http'); const fs = require('fs'); const os = require('os'); const path = require('path');

const THROTTLE = +(process.argv[2] || 4), TOKENS = +(process.argv[3] || 3000), MS = +(process.argv[4] || 6);
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'fabro-bench-'));
fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ autoUpdate: false, language: 'fr', userName: 'Bench', onboarded: true, autoTitle: false, memory: { enabled: false, auto: false }, design: { autoCheck: false } }));

// A long, realistic answer: paragraphs, lists, code blocks in several languages, a table.
function longAnswer(nTok) {
  const blocks = [
    'Voici une explication **détaillée** du fonctionnement, avec des exemples concrets et du code que tu peux copier.',
    '## Étape 1 — préparer le projet\n\n1. Crée un dossier `app`\n2. Installe les dépendances avec `npm install`\n3. Lance le serveur de développement',
    '```js\nimport { createServer } from "http";\nconst server = createServer((req, res) => {\n  if (req.url === "/health") return res.end("ok");\n  res.writeHead(200, { "Content-Type": "application/json" });\n  res.end(JSON.stringify({ time: Date.now(), path: req.url }));\n});\nserver.listen(3000, () => console.log("listening on 3000"));\n```',
    'Le serveur répond en JSON. Pour aller plus loin, on peut ajouter un *cache* et des **tests**. Voici les points importants :\n\n- la gestion des erreurs\n- les en-têtes `Content-Type`\n- la journalisation des requêtes\n- le découpage en modules',
    '| Option | Valeur par défaut | Effet |\n|---|---|---|\n| port | 3000 | port d\'écoute |\n| cache | false | met les réponses en cache |\n| log | true | écrit chaque requête |',
    '```python\ndef fib(n):\n    a, b = 0, 1\n    for _ in range(n):\n        a, b = b, a + b\n    return a\n\nprint([fib(i) for i in range(20)])\n```',
    '> Astuce : garde les fonctions courtes, une seule responsabilité chacune, et nomme-les clairement.',
    '```lua\nlocal Players = game:GetService("Players")\nPlayers.PlayerAdded:Connect(function(player)\n  local stats = Instance.new("Folder")\n  stats.Name = "leaderstats"\n  stats.Parent = player\nend)\n```',
  ];
  let s = '', i = 0;
  while (s.length < nTok * 4) s += blocks[i++ % blocks.length] + '\n\n';
  return s;
}
const answer = longAnswer(TOKENS);
const short = longAnswer(600);
let streamDone = null;
const srv = http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
    if (req.url === '/v1/models') return res.end(JSON.stringify({ data: [{ id: 'bench-model' }] }));
    if (req.url !== '/v1/chat/completions') { res.writeHead(404); return res.end('{}'); }
    const body = JSON.parse(b);
    const ut = String(([...body.messages].reverse().find((m) => m.role === 'user') || {}).content || '');
    const text = /LONG/.test(ut) ? answer : short;
    const parts = text.match(/[\s\S]{1,4}/g); // ~1 token = 4 chars
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    let i = 0;
    const fast = !/LONG/.test(ut);
    const tick = setInterval(() => {
      for (let k = 0; k < (fast ? 50 : 1) && i < parts.length; k++) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: parts[i++] } }] })}\n\n`);
      if (i >= parts.length) { clearInterval(tick); res.write('data: {"choices":[],"usage":{"prompt_tokens":100,"completion_tokens":' + parts.length + '}}\n\n'); res.end('data: [DONE]\n\n'); if (streamDone && !fast) streamDone(); }
    }, fast ? 5 : MS);
  });
});

(async () => {
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}/v1`;
  const app = await electron.launch({ executablePath: require('electron'), args: [path.join(__dirname, '..'), `--user-data-dir=${userData}`, '--no-sandbox'], env: { ...process.env, FABRO_E2E: '1' } });
  const win = await app.firstWindow();
  await win.setViewportSize({ width: 1280, height: 820 }).catch(() => {});
  await win.waitForSelector('#prompt', { timeout: 30000 });
  await win.evaluate(async (b) => {
    await api.providers.enable(true);
    await api.providers.add({ kind: 'custom', baseUrl: b, name: 'Bench' });
    await refreshModels();
    const m = allModels().find((x) => x.label === 'bench-model');
    await saveSettings({ selectedModel: m.ref });
  }, base);
  const send = async (txt) => {
    await win.fill('#prompt', txt); await win.keyboard.press('Enter');
    await win.waitForFunction(() => S.streaming, null, { timeout: 10000 });
    await win.waitForFunction(() => !S.streaming, null, { timeout: 600000 });
  };
  // a conversation that already has a few long answers
  for (let i = 0; i < 4; i++) await send('court ' + i);
  const cdp = await win.context().newCDPSession(win);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
  await win.evaluate(() => {
    window.__perf = { long: [], frames: [], run: true };
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__perf.long.push(e.duration); }).observe({ type: 'longtask', buffered: false });
    // time spent in the render path itself (attribution)
    window.__perf.render = 0; window.__perf.renders = 0;
    const wrap = (name) => { const f = window[name]; if (typeof f !== 'function') return; window[name] = function (...a) { const t = performance.now(); try { return f.apply(this, a); } finally { window.__perf.render += performance.now() - t; window.__perf.renders++; } }; };
    wrap('streamPatch'); wrap('assistantBody');
    let last = performance.now();
    const f = (now) => { window.__perf.frames.push(now - last); last = now; if (window.__perf.run) requestAnimationFrame(f); };
    requestAnimationFrame(f);
  });
  const t0 = Date.now();
  await send('LONG réponse longue');
  const wall = Date.now() - t0;
  const r = await win.evaluate(() => {
    window.__perf.run = false;
    const fr = window.__perf.frames.slice(1).sort((a, b) => a - b);
    const q = (p) => fr[Math.min(fr.length - 1, Math.floor(fr.length * p))] || 0;
    const lt = window.__perf.long;
    return {
      frames: fr.length, p50: +q(0.5).toFixed(1), p95: +q(0.95).toFixed(1), p99: +q(0.99).toFixed(1), maxFrame: +(fr[fr.length - 1] || 0).toFixed(0),
      over50: fr.filter((x) => x > 50).length, longTasks: lt.length, longTaskMs: Math.round(lt.reduce((a, b) => a + b, 0)), maxLongTask: Math.round(Math.max(0, ...lt)),
      nodes: document.querySelectorAll('#scroller *').length, renderMs: Math.round(window.__perf.render), renders: window.__perf.renders, chars: S.conv.messages.at(-1).content.length,
    };
  });
  r.wallMs = wall; r.throttle = THROTTLE; r.tokens = TOKENS; r.msPerToken = MS;
  console.log(JSON.stringify(r));
  await app.close(); srv.close();
  fs.rmSync(userData, { recursive: true, force: true });
})().catch((e) => { console.error(e); process.exit(1); });

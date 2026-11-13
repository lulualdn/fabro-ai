// Screenshots of every theme in the real Electron app: welcome, chat (code + table + tool steps), settings,
// artifact panel — light and dark where the theme supports both — and a 390 px phone width for the CLI themes.
// Usage: flock /tmp/fabro-e2e.lock xvfb-run -a -s "-screen 0 1440x900x24" node scripts/themes-shots.js [--out /tmp/shots-themes] [--themes cli,maree] [--only welcome,chat] [--phone all|cli|none]
const { _electron: electron } = require('playwright-core');
const http = require('http'); const fs = require('fs'); const os = require('os'); const path = require('path');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const OUT = arg('out', '/tmp/shots-themes');
const ONLY = (arg('only', 'welcome,chat,settings,panel,palette') || '').split(',');
const WANT = arg('themes', '') ? arg('themes').split(',') : null;
const PHONE = arg('phone', 'cli');
const APP = path.join(__dirname, '..');
fs.mkdirSync(OUT, { recursive: true });

const ANSWER = [
  'Voilà comment je ferais : un petit module qui lit le fichier, vérifie chaque ligne, puis renvoie un résumé.', '',
  '## Le code', '',
  '```js', 'const fs = require("fs");', '', '// lit le journal et compte les erreurs par service', 'function resume(path) {', '  const lignes = fs.readFileSync(path, "utf8").split("\\n");', '  const parService = {};', '  for (const l of lignes) {', '    const m = l.match(/^(\\w+) ERROR/);', '    if (m) parService[m[1]] = (parService[m[1]] || 0) + 1;', '  }', '  return parService; // { api: 12, db: 3 }', '}', '```', '',
  '## Résultat', '',
  '| Service | Erreurs | Latence (ms) | État |', '|---|---:|---:|---|', '| api | 12 | 184 | à surveiller |', '| db | 3 | 41 | ok |', '| cache | 0 | 2 | ok |', '',
  'Le plus simple est de commencer par `api`, car c’est là que **tout** se concentre :', '', '- relire les 12 erreurs récentes', '- ajouter un test pour le cas limite', '- > mesurer à nouveau après correction', '',
  '> Une note : les latences viennent de la dernière heure.',
].join('\n');
const DOC = '# Lettre à la mairie\n\nMadame, Monsieur,\n\nJe vous écris au sujet du **stationnement** rue des Lilas. Depuis la mise en place de la nouvelle zone, plusieurs riverains ne trouvent plus de place.\n\n## Ce que je demande\n\n1. Un comptage des places réellement disponibles\n2. Une carte de la zone révisée\n3. Un rendez-vous avec le service voirie\n\n| Jour | Places libres |\n|---|---:|\n| Lundi | 4 |\n| Samedi | 0 |\n\nCordialement,\n\nLulu';

const srv = http.createServer((req, res) => { if (req.url === '/v1/models') return res.end(JSON.stringify({ data: [{ id: 'gemma-4-e4b' }] })); res.writeHead(404); res.end('{}'); });

async function launch() {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'fabro-themes-'));
  fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ autoUpdate: false, language: 'fr', userName: 'Lulu', theme: 'light', onboarded: true, lightMode: false }));
  const app = await electron.launch({ executablePath: require(path.join(APP, 'node_modules', 'electron')), args: [APP, `--user-data-dir=${userData}`, '--no-sandbox'], env: { ...process.env, FABRO_E2E: '1' } });
  const win = await app.firstWindow();
  win.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await win.setViewportSize({ width: 1280, height: 820 }).catch(() => {});
  await win.waitForSelector('.greet', { timeout: 25000 });
  await win.evaluate(async (base) => {
    await api.providers.enable(true);
    await api.providers.add({ kind: 'custom', name: 'Local', baseUrl: base });
    await refreshModels();
    const m = allModels()[0]; if (m) await saveSettings({ selectedModel: m.ref });
  }, `http://127.0.0.1:${srv.address().port}/v1`);
  return { app, win };
}

async function seed(win) {
  await win.evaluate(({ answer }) => {
    const now = Date.now() - 36e5;
    const titles = ['Résumer le journal d’erreurs', 'Lettre à la mairie', 'Recette de pain au levain', 'Plugin de routes Roblox', 'Idées de noms pour le projet', 'Devoir de maths : suites', 'Comparer deux moteurs locaux', 'Plan de la semaine'];
    S.convs = titles.map((t, i) => ({ id: 'c' + i, title: t, updatedAt: now - i * 864e5, createdAt: now - i * 864e5, pinned: i === 1 }));
    const steps = [{ id: 's1', name: 'web_search', args: { query: 'regex erreurs par service' }, status: 'done', view: { sources: [{ title: 'MDN — RegExp', url: 'https://developer.mozilla.org/', snippet: '' }, { title: 'Node fs docs', url: 'https://nodejs.org/', snippet: '' }] } }, { id: 's2', name: 'fetch_url', args: { url: 'https://nodejs.org/api/fs.html' }, status: 'done', view: { title: 'File system | Node.js' } }];
    const messages = [
      { id: 'u1', parentId: null, role: 'user', content: 'Peux-tu écrire un petit script qui compte les erreurs par service dans mon fichier de logs ?', createdAt: now },
      { id: 'a1', parentId: 'u1', role: 'assistant', content: answer, steps, model: 'gemma-4-e4b', createdAt: now + 500, stats: { completionTokens: 812, promptTokens: 1240, tokPerSec: 38.2 } },
      { id: 'u2', parentId: 'a1', role: 'user', content: 'Et si le fichier fait 2 Go ?', createdAt: now + 2000 },
      { id: 'a2', parentId: 'u2', role: 'assistant', content: 'Dans ce cas, lis-le **en flux** avec `readline` plutôt qu’en une seule fois : la mémoire reste constante.', model: 'gemma-4-e4b', createdAt: now + 2500, stats: { completionTokens: 64, promptTokens: 2100, tokPerSec: 41.0 } },
    ];
    S.mode = 'chat'; S.conv = { id: 'c0', title: titles[0], messages, nodes: messages.slice(), leafId: 'a2', createdAt: now, updatedAt: now };
    renderSidebar(); renderView();
  }, { answer: ANSWER });
}

async function setTheme(win, id, mode) {
  await win.evaluate(async ({ id, mode }) => { S.settings.theme = mode; S.settings.skin = { ...(S.settings.skin || {}), id }; applyTheme(); renderSidebar(); renderView(); }, { id, mode });
  await win.waitForTimeout(500);
}

async function shotsFor(win, id, mode, tag, w, h) {
  await win.setViewportSize({ width: w, height: h });
  const f = (n) => `${OUT}/${id}-${mode}-${tag}-${n}.png`;
  if (ONLY.includes('welcome')) {
    await win.evaluate(() => { S.conv = null; renderSidebar(); renderView(); }); await win.waitForTimeout(1500);
    await win.screenshot({ path: f('1-welcome') });
  }
  if (ONLY.includes('chat')) {
    await seed(win); await win.waitForTimeout(500);
    await win.evaluate(() => { const s = document.getElementById('scroller'); if (s) s.scrollTop = 0; });
    await win.screenshot({ path: f('2-chat') });
    await win.evaluate(() => { const s = document.getElementById('scroller'); if (s) s.scrollTop = s.scrollHeight; }); await win.waitForTimeout(250);
    await win.screenshot({ path: f('3-chat-end') });
  }
  if (ONLY.includes('settings')) {
    await win.evaluate(() => openSettings('general')); await win.waitForTimeout(800);
    await win.screenshot({ path: f('4-settings') });
    await win.evaluate(() => closeSettings()); await win.waitForTimeout(500);
  }
  if (ONLY.includes('panel')) {
    await win.evaluate((t) => openViewer({ type: 'markdown', title: 'Lettre', text: t }), DOC); await win.waitForTimeout(800);
    await win.screenshot({ path: f('5-panel') });
    await win.evaluate(() => closeViewer()); await win.waitForTimeout(500);
  }
  if (ONLY.includes('palette')) {
    await win.keyboard.press('Control+Shift+P').catch(() => {}); await win.waitForTimeout(500);
    await win.screenshot({ path: f('6-palette') });
    await win.keyboard.press('Escape'); await win.waitForTimeout(300);
  }
}

(async () => {
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const { app, win } = await launch();
  const ids = await win.evaluate(() => Themes.all().map((m) => ({ id: m.id, base: m.base, layout: m.layout })));
  for (const th of ids) {
    if (WANT && !WANT.includes(th.id)) continue;
    const modes = th.base === 'both' ? ['light', 'dark'] : [th.base];
    for (const mode of modes) {
      await setTheme(win, th.id, mode);
      await shotsFor(win, th.id, mode, 'desk', 1280, 820);
      if ((PHONE === 'all' || (PHONE === 'cli' && th.layout === 'cli')) && mode === (modes.includes('dark') ? 'dark' : mode)) {
        await shotsFor(win, th.id, mode, 'phone', 390, 844);
        await win.setViewportSize({ width: 1280, height: 820 });
      }
    }
  }
  await app.close(); srv.close();
  console.log('screenshots →', OUT);
})().catch((e) => { console.error(e); process.exit(1); });

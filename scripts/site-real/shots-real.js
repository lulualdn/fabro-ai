// Real captures of the v1 app for the website (English UI). Profile prepared beforehand (real runs).
const { _electron: electron } = require(require('path').join(__dirname, '..', '..', 'node_modules') + '/playwright-core');
const fs = require('fs'); const path = require('path');
const [S, ud, OUT] = process.argv.slice(2);
fs.mkdirSync(OUT, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const app = await electron.launch({ executablePath: require(require('path').join(__dirname, '..', '..', 'node_modules') + '/electron'), args: [require('path').join(__dirname, '..', '..'), `--user-data-dir=${ud}`, '--no-sandbox', '--force-device-scale-factor=2'], env: { ...process.env, FABRO_E2E: '1' } });
  const win = await app.firstWindow(); const errs = []; win.on('pageerror', (e) => errs.push(e.message));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1360, 820)); await wait(2500);
  const cap = async (file, clip) => { const b64 = await app.evaluate(async ({ BrowserWindow }, clip) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage(clip ? { x: Math.round(clip.x), y: Math.round(clip.y), width: Math.round(clip.width), height: Math.round(clip.height) } : undefined)).toPNG().toString('base64'), clip); fs.writeFileSync(file, Buffer.from(b64, 'base64')); };
  const scrollTop = () => win.evaluate(() => { const sc = [...document.querySelectorAll('*')].find((e) => e.scrollHeight > e.clientHeight + 50 && /auto|scroll/.test(getComputedStyle(e).overflowY)); if (sc) sc.scrollTop = 0; });
  const openConv = async (title) => { const b = await win.$$('.convs [data-act=open]'); for (const x of b) if ((await x.textContent()).includes(title)) { await x.click(); break; } await wait(1500); };
  for (const th of ['light', 'dark']) {
    await win.evaluate(async (th) => { await api.settings.set({ theme: th, language: 'en' }); V1.S.settings.theme = th; V1.applyTheme(); }, th); await wait(500);
    // hero + long task + reading: the Cordouan trip (real run: photo, searches, answer)
    await openConv('Cordouan');
    await win.evaluate(() => { const b = document.querySelector('.steps:not(.open) button'); if (b) b.click(); }); await wait(300); await scrollTop(); await wait(300);
    await win.screenshot({ path: `${OUT}/chat-${th}.png` });
    const ai = await win.$('.msg.ai'); const box = await ai.boundingBox();
    await win.screenshot({ path: `${OUT}/task-${th}.png`, clip: { x: box.x - 24, y: box.y - 12, width: box.width + 48, height: Math.min(560, 735 - box.y) } });
    // reading with sources: the end of the answer
    await win.evaluate(() => { const c = document.querySelector('.msg.ai .cites, .msg.ai .sources, .msg.ai .meta'); if (c) c.scrollIntoView({ block: 'end' }); }); await wait(300);
    const b2 = await (await win.$('.msg.ai')).boundingBox();
    await win.screenshot({ path: `${OUT}/reader-${th}.png`, clip: { x: b2.x - 24, y: 150, width: b2.width + 48, height: 600 } });
    // Fabro Code: the budget project (real run, tests passed)
    await openConv('budget'); await scrollTop(); await wait(300);
    await win.evaluate(() => { const b = document.querySelector('.steps:not(.open) button'); if (b) b.click(); }); await wait(300);
    await win.screenshot({ path: `${OUT}/code-${th}.png`, clip: { x: 290, y: 0, width: 1070, height: 820 } });
    // connectors
    await win.click('[data-act=settings]'); await wait(400); await win.click('[data-tab=connectors]'); await wait(1200);
    const col = await win.evaluate(() => { const r = document.querySelector('#tab').getBoundingClientRect(); return { x: r.x - 24, y: Math.max(0, r.y - 150), w: r.width + 48 }; });
    await win.screenshot({ path: `${OUT}/mcp-${th}.png`, clip: { x: col.x, y: col.y, width: col.w, height: 560 } });
    await win.click('[data-act=back]').catch(() => {}); await wait(300);
  }
  console.log('errors', JSON.stringify(errs));
  await app.close();
})().catch((e) => { console.error(e); process.exit(1); });

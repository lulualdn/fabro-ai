// Computer use capture: a real web page in a window, Fabro's real overlay frame and stop pill on top, the whole
// screen captured (Linux: content protection doesn't hide them, so they show like the user sees them).
const { _electron: electron } = require(require('path').join(__dirname, '..', '..', 'node_modules') + '/playwright-core');
const fs = require('fs'); const os = require('os'); const path = require('path');
const [OUT, url, status] = process.argv.slice(2);
(async () => {
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'fabro-cu-'));
  const app = await electron.launch({ executablePath: require(require('path').join(__dirname, '..', '..', 'node_modules') + '/electron'), args: [require('path').join(__dirname, '..', '..'), `--user-data-dir=${ud}`, '--no-sandbox', '--force-device-scale-factor=2'], env: { ...process.env, FABRO_E2E: '1' } });
  await app.firstWindow(); await new Promise((r) => setTimeout(r, 2000));
  const r = await app.evaluate(async ({ BrowserWindow, screen, desktopCapturer }, [url, status]) => {
    for (const w of BrowserWindow.getAllWindows()) w.hide();
    const d = screen.getPrimaryDisplay();
    const page = new BrowserWindow({ x: 0, y: 0, width: d.bounds.width, height: d.bounds.height, frame: false, show: true });
    await page.loadURL(url).catch(() => {});
    await new Promise((res) => setTimeout(res, 6000));
    const overlay = process.mainModule.require(require('path').join(__dirname, '..', '..') + '/src/main/computer/overlay.js');
    const pill = process.mainModule.require(require('path').join(__dirname, '..', '..') + '/src/main/computer/stop-pill.js');
    const m = { x: d.bounds.x, y: d.bounds.y, w: d.bounds.width, h: d.bounds.height };
    await overlay.show(m, 'en'); await pill.show(m, 'en', () => {}); pill.status(status); overlay.status(status); await new Promise((res) => setTimeout(res, 300)); pill._win().webContents.executeJavaScript('op(1)');
    await new Promise((res) => setTimeout(res, 800));
    overlay.ripple(Math.round(d.bounds.width * 0.62), Math.round(d.bounds.height * 0.42));
    await new Promise((res) => setTimeout(res, 120));
    // each real window, captured, with its position: composited below as on screen
    const wins = [page, ...BrowserWindow.getAllWindows().filter((w) => w !== page && w.isVisible() && /Fabro Computer Use|Fabro Stop/.test(w.getTitle()))];
    const order = (w) => (w.getTitle() === 'Fabro Stop' ? 2 : w === page ? 0 : 1);
    const out = [];
    for (const w of wins.sort((a, b) => order(a) - order(b))) { const img = await w.webContents.capturePage(); out.push({ b: w.getBounds(), png: img.toPNG().toString('base64') }); }
    return out;
  }, [url, status]);
  const { chromium } = require('playwright');
  const br = await chromium.launch(); const pg = await br.newPage({ viewport: { width: 1360, height: 820 }, deviceScaleFactor: 2 });
  await pg.setContent('<body style="margin:0;background:#000">' + r.map((x) => '<img style="position:absolute;left:' + x.b.x + 'px;top:' + x.b.y + 'px;width:' + x.b.width + 'px;height:' + x.b.height + 'px" src="data:image/png;base64,' + x.png + '">').join('') + '</body>');
  await pg.waitForTimeout(500);
  await pg.screenshot({ path: OUT }); await br.close();
  await app.close();
})().catch((e) => { console.error(e); process.exit(1); });

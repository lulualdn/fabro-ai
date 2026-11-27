// Launches Fabro (v1 interface) on a throwaway profile and takes screenshots. Quick check, not a test suite.
// Run: xvfb-run -a node scripts/v1-shots.js <outDir> [light|dark]
const { _electron: electron } = require('playwright-core');
const path = require('path');
const fs = require('fs');
const os = require('os');

(async () => {
  const out = process.argv[2] || path.join(os.tmpdir(), 'fabro-v1');
  const theme = process.argv[3] || 'dark';
  fs.mkdirSync(out, { recursive: true });
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'fabro-v1-'));
  fs.mkdirSync(path.join(userData, 'Fabro'), { recursive: true });
  const app = await electron.launch({ executablePath: require('electron'), args: [path.join(__dirname, '..'), `--user-data-dir=${userData}`, '--no-sandbox'], env: { ...process.env, FABRO_E2E: '1' } });
  const win = await app.firstWindow();
  const errs = [];
  win.on('pageerror', (e) => errs.push(e.message));
  win.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await win.setViewportSize({ width: 1360, height: 840 });
  await win.waitForTimeout(2500);
  console.log('url', win.url());
  await win.evaluate(async (th) => { await api.settings.set({ theme: th, onboarded: true }); if (window.V1) { V1.S.settings.theme = th; V1.applyTheme(); } }, theme);
  await win.waitForTimeout(400);
  await win.screenshot({ path: path.join(out, `v1-home-${theme}.png`) });
  if (process.argv.includes('--more')) {
    await win.click('[data-act=settings]'); await win.waitForTimeout(400); await win.screenshot({ path: path.join(out, `v1-settings-${theme}.png`) });
    await win.click('[data-tab=connectors]'); await win.waitForTimeout(800); await win.screenshot({ path: path.join(out, `v1-connectors-${theme}.png`) });
    await win.click('[data-tab=anywhere]'); await win.waitForTimeout(400); await win.click('[data-act="set:pair"]').catch(() => {}); await win.waitForTimeout(1500); await win.screenshot({ path: path.join(out, `v1-anywhere-${theme}.png`) });
    await win.click('[data-act=back]'); await win.waitForTimeout(300);
    await win.fill('.composer textarea', '/'); await win.waitForTimeout(300); await win.screenshot({ path: path.join(out, `v1-slash-${theme}.png`) });
  }
  console.log('errors', JSON.stringify(errs.slice(0, 10)));
  await app.close();
})().catch((e) => { console.error(e); process.exit(1); });

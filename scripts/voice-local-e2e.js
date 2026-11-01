// Voice on the device, for real (network needed the first time): the app downloads a Piper voice and Whisper in
// the page, speaks two French sentences and hears them back. Prints the timings.
// Run: xvfb-run -a node scripts/voice-local-e2e.js
const { _electron: electron } = require('playwright-core');
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'vl-'));
fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({ autoUpdate: false, onboarded: true, language: 'fr', userName: 'Lulu', theme: 'dark' }));
(async () => {
  const args = [path.join(__dirname, '..'), '--user-data-dir=' + ud, '--no-sandbox']; if (process.env.HTTPS_PROXY) args.push('--proxy-server=' + process.env.HTTPS_PROXY);
  const app = await electron.launch({ executablePath: require('electron'), args, env: { ...process.env } });
  const w = await app.firstWindow(); w.on('pageerror', (e) => console.log('pageerror', e.message));
  await w.waitForFunction(() => typeof VLocal !== 'undefined' && typeof S !== 'undefined' && S.settings, null, { timeout: 30000 });
  const r = await w.evaluate(async () => {
    const t0 = performance.now(); VLocal.prepare('fr');
    let last = '';
    while (VLocal.pending('fr') != null && performance.now() - t0 < 400000) { await new Promise((r) => setTimeout(r, 2000));  }
    const ready = performance.now() - t0;
    const out = [];
    for (const txt of ["Salut Lulu ! Je vais te raconter une histoire.", "Il était une fois une petite citrouille qui rêvait de voir la mer."]) {
      const a = performance.now(); const wav = await VLocal.say(txt, { lang: 'fr' }); const b = performance.now();
      const heard = await VLocal.hear(wav, { lang: 'fr' }); const c = performance.now();
      out.push({ txt, ttsMs: Math.round(b - a), audioS: wav ? ((wav.length - 44) / 2 / 22050).toFixed(2) : null, heard, sttMs: Math.round(c - b) });
    }
    return { readyS: Math.round(ready / 1000), st: VLocal.st, out };
  });
  console.log(JSON.stringify(r.out, null, 1));
  for (const o of r.out) assert.ok(o.audioS > 1 && /raconter|une fois/i.test(o.heard), 'spoken and heard back: ' + o.heard);
  console.log('voice-local e2e OK');
  await app.close();
})().catch((e) => { console.error(e); process.exit(1); });

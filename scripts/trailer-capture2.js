// Records real interactions with the app (screencast frames + cursor/keyboard log) for the trailer.
// Usage: xvfb-run -a -s "-screen 0 2400x2000x24" node scripts/trailer-capture2.js <outDir> [landscape|portrait]
const { _electron: electron, chromium } = require('playwright-core');
const http = require('http'); const fs = require('fs'); const os = require('os'); const path = require('path');

const out = process.argv[2] || 'takes'; const MODE = process.argv[3] || 'landscape';
const VW = MODE === 'portrait' ? 600 : 1280, VH = MODE === 'portrait' ? 920 : 800, DPR = MODE === 'portrait' ? 1.8 : 1.5;
fs.mkdirSync(out, { recursive: true });
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'fabro-trailer2-'));
fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ autoUpdate: false, language: 'en', userName: 'Alex', theme: 'dark', onboarded: true, devMode: false, devModeReleased: true }));

const words = (s, key = 'content') => s.match(/\S+\s*|\n+/g).map((w) => ({ [key]: w }));
const sse = (res, chunks, gap) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream' }); let i = 0;
  const tick = setInterval(() => {
    if (i < chunks.length) return res.write(`data: ${JSON.stringify({ choices: [{ delta: chunks[i++] }] })}\n\n`);
    clearInterval(tick); res.write('data: {"choices":[],"usage":{"prompt_tokens":420,"completion_tokens":120}}\n\n'); res.end('data: [DONE]\n\n');
  }, gap);
};
const NOTE = `Of course! Here's a friendly note:

> Hi Sam, hope you're well! Just a small thing: the music last night went on quite late and I had trouble sleeping. Would you mind keeping it a little lower after 11 pm?
>
> Thanks a lot, and tell me if I can ever return the favour!
> — Alex`;
const LEASE = `**Your lease in 3 points**

1. **Rent:** €950 a month, due on the 5th.
2. **Leaving:** you must give **2 months' notice**.
3. **Deposit:** €1,900, paid back within 30 days after the final inspection.

One thing to watch: **pets need the landlord's written approval** (page 2).`;
const RECIPE = `**Spinach & egg skillet** — 15 minutes

1. Soften a big handful of spinach with garlic in olive oil.
2. Make four little wells and crack an egg into each.
3. Cover for 4 minutes, add salt, pepper and some feta.

Serve with toasted bread. Enjoy!`;
const SLIDES = `Here are your slides.
<artifact type="slides" title="Lisbon in 3 days">
# Lisbon in 3 days
Our trip · May

---

## Day 1 — Alfama
- Tram 28 up the hill
- Sunset at the castle
- Fado dinner

---

## Day 2 — Belém
- The monastery
- **Pastéis de nata**
- Walk by the river

---

## Day 3 — Sintra
- Pena Palace
- Lunch in the old town
</artifact>`;

const srv = http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
    if (req.url === '/v1/models') return res.end(JSON.stringify({ data: [{ id: 'Gemma 4 E4B' }] }));
    if (req.url !== '/v1/chat/completions') { res.writeHead(404); return res.end('{}'); }
    const body = JSON.parse(b); const sys = String((body.messages[0] || {}).content || '');
    const users = body.messages.filter((m) => m.role === 'user').map((m) => (typeof m.content === 'string' ? m.content : (m.content || []).map((c) => c.text || '').join(' ')));
    const ut = users.filter((u) => !/^\[|Précision|You stopped|Keep going/.test(u)).join(' ');
    if (/You name conversations/.test(sys)) return sse(res, [{ content: /neighbour/.test(ut) ? 'Note to the neighbour' : /lease|Summarize/i.test(ut) ? 'Lease summary' : /Lisbon/.test(ut) ? 'Lisbon slides' : 'Dinner idea' }], 10);
    if (/maintain a short memory/.test(sys)) return sse(res, [{ content: '[]' }], 10);
    if (/neighbour/.test(ut)) return sse(res, [...words('Keep it warm and polite, no blame, one clear ask.', 'reasoning_content'), ...words(NOTE)], 45);
    if (/Summarize/i.test(ut)) return sse(res, words(LEASE), 45);
    if (/Lisbon/.test(ut)) return sse(res, words(SLIDES), 18);
    return sse(res, words(RECIPE), 45);
  });
});

async function makePdf(file) {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
  const p = await b.newPage();
  const sec = (h, t) => `<h2>${h}</h2><p>${t}</p>`;
  await p.setContent(`<style>body{font:13px/1.6 Georgia,serif;margin:60px 70px;color:#222}h1{font-size:24px}h2{font-size:15px;margin-top:26px}</style>
    <h1>Residential Lease Agreement</h1><p>Between Mr. J. Martin (the landlord) and Alex Moreau (the tenant), for the apartment at 14 Rua das Flores, 2nd floor.</p>
    ${sec('1. Rent', 'The monthly rent is €950, payable on the 5th day of each month by bank transfer.')}
    ${sec('2. Deposit', 'A deposit of €1,900 is paid on signature. It is returned within 30 days after the final inspection, minus any repair costs.')}
    ${sec('3. Duration and notice', 'The lease runs for one year and renews automatically. The tenant may leave at any time with two (2) months’ written notice.')}
    <div style="page-break-before:always"></div>
    ${sec('4. Pets', 'No pets may be kept in the apartment without the landlord’s prior written approval.')}
    ${sec('5. Repairs', 'Small repairs are the tenant’s responsibility. Heating, plumbing and structural repairs are the landlord’s.')}
    ${sec('6. Insurance', 'The tenant must hold home insurance for the whole lease and show proof each year.')}`);
  await p.pdf({ path: file, format: 'A4' }); await b.close();
}

(async () => {
  const pdf = path.join(userData, 'Apartment lease.pdf'); await makePdf(pdf);
  fs.rmSync(path.join(os.homedir(), 'Documents', 'Fabro', 'Workspace'), { recursive: true, force: true });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}/v1`;
  const app = await electron.launch({ executablePath: require('electron'), args: [path.join(__dirname, '..'), `--user-data-dir=${userData}`, '--no-sandbox', `--force-device-scale-factor=${DPR}`], env: { ...process.env, FABRO_E2E: '1' } });
  const win = await app.firstWindow();
  await win.setViewportSize({ width: VW, height: VH }).catch(() => {});
  await win.waitForSelector('.greet', { timeout: 20000 });
  await win.evaluate(async (u) => {
    await applySetting('devMode', false); await applySetting('theme', 'dark');
    await api.providers.enable(true); await api.providers.add({ kind: 'custom', name: 'Local', baseUrl: u });
    await refreshModels(); const m = allModels().find((x) => /Gemma/.test(x.label)); if (m) await saveSettings({ selectedModel: m.ref });
    await saveSettings({ chatTools: { webSearch: false, fetch: false, images: false }, sidebarCollapsed: innerWidth < 800 });
    const st = document.createElement('style'); st.textContent = '.stats{display:none!important}'; document.head.appendChild(st);
    renderView();
  }, base);
  const cdp = await win.context().newCDPSession(win);

  // one take = screencast frames with timestamps + the cursor/keyboard log
  async function take(name, fn) {
    const dir = path.join(out, name); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
    const frames = [], actions = []; let n = 0; const t0 = Date.now();
    const onFrame = async (f) => {
      const file = `f${String(n++).padStart(5, '0')}.jpg`;
      fs.writeFileSync(path.join(dir, file), Buffer.from(f.data, 'base64'));
      frames.push({ f: file, t: f.metadata.timestamp * 1000 - t0 });
      cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
    };
    cdp.on('Page.screencastFrame', onFrame);
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 88, everyNthFrame: 1 });
    const log = (o) => actions.push({ t: Date.now() - t0, ...o });
    const box = async (sel) => { const b = await win.locator(sel).first().boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2, w: b.width, h: b.height }; };
    const api2 = {
      wait: (ms) => win.waitForTimeout(ms),
      move: async (sel, ms = 650) => { const b = await box(sel); log({ type: 'move', ...b, d: ms }); await win.waitForTimeout(ms); await win.hover(sel).catch(() => {}); return b; },
      click: async (sel) => { const b = await box(sel); log({ type: 'click', ...b }); await win.click(sel); },
      type: async (text, delay = 42) => { log({ type: 'type', text }); await win.keyboard.type(text, { delay }); },
      mark: (label, extra = {}) => log({ type: 'mark', label, ...extra }),
      box, log,
      idle: () => win.waitForFunction(() => !S.streaming, null, { timeout: 30000 }),
    };
    // keep frames coming even when nothing moves
    const keep = setInterval(() => win.evaluate(() => { document.body.style.setProperty('--tick', Math.random()); }).catch(() => {}), 60);
    try { await fn(api2); } finally {
      clearInterval(keep);
      await cdp.send('Page.stopScreencast'); cdp.off('Page.screencastFrame', onFrame);
      fs.writeFileSync(path.join(dir, 'take.json'), JSON.stringify({ name, vw: VW, vh: VH, dpr: DPR, duration: Date.now() - t0, frames, actions }, null, 1));
      console.log('•', name, frames.length, 'frames', ((Date.now() - t0) / 1000).toFixed(1) + 's');
    }
  }
  const fresh = async () => {
    if (await win.$('[data-action=new-chat]:visible')) await win.click('[data-action=new-chat]'); else await win.evaluate(() => { newChat(); });
    await win.waitForTimeout(500);
    await win.evaluate(() => { const g = document.querySelector('.greet'); if (!g) return; const tn = [...g.childNodes].reverse().find((n) => n.nodeType === 3 && n.textContent.trim()) || [...g.querySelectorAll('span')].pop(); if (tn) tn.textContent = ' What can I do for you, Alex?'; });
  };

  await fresh();
  await take('ask', async (a) => {
    await a.wait(700);
    await a.move('#prompt', 800); await a.click('#prompt');
    await a.type('Write a kind note to my neighbour about the loud music last night');
    await a.wait(300); await a.move('#send-btn', 500); await a.click('#send-btn');
    a.mark('sent'); await a.idle(); a.mark('done'); await a.wait(1600);
  });
  await fresh();
  await take('doc', async (a) => {
    await a.wait(600);
    const c = await a.box('#composer'); a.log({ type: 'drag', x: c.x, y: c.y, d: 1300, file: 'Apartment lease.pdf' });
    await a.wait(1400); await win.setInputFiles('#file-input', pdf);
    a.mark('dropped'); await win.waitForSelector('.af-thumb, .att-file, .attach', { timeout: 15000 }).catch(() => {});
    await a.wait(900); await a.click('#prompt');
    await a.type('Summarize this in 3 points');
    await a.wait(250); await a.move('#send-btn', 450); await a.click('#send-btn');
    a.mark('sent'); await a.idle(); a.mark('done'); await a.wait(1800);
  });
  await fresh();
  await take('slides', async (a) => {
    await a.wait(500); await a.move('#prompt', 700); await a.click('#prompt');
    await a.type('Make slides for our trip to Lisbon');
    await a.wait(250); await a.move('#send-btn', 450); await a.click('#send-btn');
    a.mark('sent'); await win.waitForSelector('.viewer .deck .slide', { timeout: 15000 }); await a.idle(); a.mark('done'); await a.wait(1200);
    await a.wait(1800);
  });
  await win.click('[data-action=viewer-close]').catch(() => {});
  await fresh();
  await take('offline', async (a) => {
    await a.wait(500); await a.move('#prompt', 700); await a.click('#prompt');
    await a.type('Quick dinner idea with eggs and spinach?');
    await a.wait(250); await a.move('#send-btn', 450); await a.click('#send-btn');
    a.mark('sent'); await a.idle(); a.mark('done'); await a.wait(1500);
  });
  await app.close(); srv.close(); console.log('done →', out);
})().catch((e) => { console.error(e); process.exit(1); });

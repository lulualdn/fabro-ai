// Voice mode end to end (CI, needs internet the first time): installs the local voice stack through the
// app (Python, faster-whisper, Piper, a Whisper model and a voice), feeds a spoken question through a fake
// microphone, and checks: transcription → answer (scripted model) → scene drawing → spoken reply.
// Run: xvfb-run -a node scripts/voice-smoke.js [question.wav]
const { _electron: electron } = require('playwright-core');
const path = require('path'); const fs = require('fs'); const os = require('os'); const http = require('http'); const assert = require('assert');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'fabro-voice-'));
const wav = process.argv[2] || path.join(__dirname, 'fixtures', 'question-fr.wav');

const srv = http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
    if (req.url === '/v1/models') return res.end(JSON.stringify({ data: [{ id: 'fake' }] }));
    const body = JSON.parse(b);
    const sse = (delta) => { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.write(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`); res.end('data: [DONE]\n\n'); };
    if (!body.tools) return sse({ content: 'Capitale' });
    const sys = body.messages[0].content || '';
    const done = body.messages.filter((m) => m.role === 'tool').length;
    if (!/Voice conversation/.test(sys)) return sse({ content: 'NO VOICE PROMPT' });
    if (done === 0) return sse({ tool_calls: [{ index: 0, id: 's1', function: { name: 'show_on_scene', arguments: JSON.stringify({ kind: 'svg', title: 'Carte', content: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="#d97757"/><text x="50" y="55" text-anchor="middle" fill="#fff">Paris</text></svg>' }) } }] });
    return sse({ content: 'La capitale de la France est Paris. C’est aussi sa plus grande ville.' });
  });
});

(async () => {
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}/v1`;
  const app = await electron.launch({
    executablePath: require('electron'),
    args: [path.join(__dirname, '..'), `--user-data-dir=${userData}`, '--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}`, '--autoplay-policy=no-user-gesture-required'],
    env: { ...process.env, FABRO_E2E: '1' },
  });
  const win = await app.firstWindow();
  const errors = []; win.on('pageerror', (e) => errors.push(e.message));
  await win.waitForFunction(() => typeof S !== 'undefined' && S.settings, null, { timeout: 30000 });
  await win.evaluate(async (b) => { await api.providers.enable(true); const v = await api.providers.add({ kind: 'custom', baseUrl: b, name: 'Fake' }); await saveSettings({ selectedModel: { backend: 'provider', provider: v.list[0].id, model: 'fake' } }); await applySetting('language', 'fr'); await refreshModels(); }, base);
  let st = await win.evaluate(() => api.voice.status());
  if (!st.runtime || !st.whisperReady) {
    const t0 = Date.now(); console.log('• installing voice…');
    st = await win.evaluate(() => api.voice.install());
    console.log(`  installed in ${((Date.now() - t0) / 1000).toFixed(0)} s, voice ${st.voice}`);
  }
  assert.ok(st.runtime && st.whisperReady, 'voice runtime + Whisper ready');
  // Speech-to-text directly on the file.
  const t1 = Date.now();
  const direct = await win.evaluate(async (bytes) => api.voice.stt(new Uint8Array(bytes), { lang: 'fr' }), [...fs.readFileSync(wav)]);
  console.log(`• stt (${Date.now() - t1} ms): ${direct.text}`);
  assert.match(direct.text, /capitale/i);
  const audio = await win.evaluate(async () => (await api.voice.tts('Bonjour, je suis Fabro.')).length);
  assert.ok(audio > 20000, 'tts returns audio');
  // Voice mode through the fake microphone.
  await win.click('[data-action=voice-mode]');
  await win.waitForSelector('#vx', { timeout: 5000 });
  await win.waitForFunction(() => /capitale/i.test(S.voice.user), null, { timeout: 60000 });
  console.log('• heard:', await win.evaluate(() => S.voice.user));
  await win.waitForSelector('.vs-svg svg', { timeout: 30000 });
  await win.waitForFunction(() => /Paris/.test(S.voice.ai), null, { timeout: 60000 });
  console.log('• spoke:', await win.evaluate(() => S.voice.ai));
  await win.screenshot({ path: path.join(process.env.SHOTS || os.tmpdir(), 'voice-mode.png') });
  assert.deepStrictEqual(errors, []);
  console.log('voice-smoke: all passed');
  await app.evaluate(({ app }) => app.quit()); srv.close(); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });

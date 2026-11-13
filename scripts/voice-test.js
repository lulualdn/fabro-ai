// Voice mode, the pure parts (src/renderer/voice-core.js) in plain node: end of speech, pre-roll, echo gate,
// chunking of a streamed answer, spoken form (no markdown / code / links / emoji, dates and units in words).
// Run: node scripts/voice-test.js
const assert = require('assert');
const V = require('../src/renderer/voice-core.js');
let n = 0; const ok = (name, fn) => { fn(); n++; console.log('  ✓ ' + name); };

// synthetic 16 kHz signal: noise floor, then a "voice", then silence
function sig({ lead = 0.6, speech = 1.2, tail = 1.5, amp = 0.12, noise = 0.0015 } = {}) {
  const R = 16000, a = new Float32Array(Math.round(R * (lead + speech + tail)));
  for (let i = 0; i < a.length; i++) a[i] = (Math.random() * 2 - 1) * noise;
  const s0 = Math.round(R * lead), s1 = Math.round(R * (lead + speech));
  for (let i = s0; i < s1; i++) { const t = (i - s0) / R; a[i] += amp * (0.55 + 0.45 * Math.abs(Math.sin(Math.PI * 4 * t))) * Math.sin(2 * Math.PI * 150 * t); }
  return { a, s0, s1 };
}
function run(ep, a) { const evs = []; for (let i = 0; i < a.length; i += 320) for (const e of ep.feed(a.subarray(i, i + 320))) evs.push({ ...e, sample: i + 320 }); return evs; }

console.log('voice-core');
ok('speech is detected quickly and the pre-roll keeps the first syllable', () => {
  const { a, s0 } = sig(); const ep = V.Endpointer(); const evs = run(ep, a);
  const st = evs.find((e) => e.t === 'start'); const end = evs.find((e) => e.t === 'end');
  assert.ok(st && end, JSON.stringify(evs.map((e) => e.t)));
  assert.ok((st.sample - s0) / 16 < 120, 'onset detected in < 120 ms: ' + (st.sample - s0) / 16);
  // the captured audio starts before the onset: find the onset inside it
  let k = 0; while (k < end.pcm.length && Math.abs(end.pcm[k]) < 0.03) k++;
  assert.ok(k / 16 >= 200, 'at least 200 ms of pre-roll before the first sound: ' + k / 16);
});
ok('end of speech: shorter when the sentence sounds finished, longer mid-thought', () => {
  const t = (hint) => { const { a, s1 } = sig(); const ep = V.Endpointer(); const evs = []; for (let i = 0; i < a.length; i += 320) { const e = ep.feed(a.subarray(i, i + 320)); if (e.some((x) => x.t === 'pause')) ep.hint = hint; for (const x of e) evs.push({ ...x, sample: i + 320 }); } const end = evs.find((e) => e.t === 'end'); return end ? (end.sample - s1) / 16 : Infinity; };
  const done = t('done'), plain = t(null), mid = t('mid');
  assert.ok(done < plain && plain < mid, `done ${done} < plain ${plain} < mid ${mid}`);
  assert.ok(done <= 450, 'a finished sentence ends in ≤ 450 ms: ' + done);
});
ok('a pause event comes first (time to transcribe before the end is confirmed)', () => {
  const { a } = sig(); const evs = run(V.Endpointer(), a).map((e) => e.t);
  assert.ok(evs.indexOf('pause') > evs.indexOf('start') && evs.indexOf('pause') < evs.indexOf('end'), evs.join(','));
});
ok('a whisper is heard over a quiet room', () => {
  const { a } = sig({ amp: 0.012, noise: 0.0008 }); const evs = run(V.Endpointer(), a);
  assert.ok(evs.some((e) => e.t === 'end'), 'whisper detected');
});
ok('a click is not speech', () => {
  const a = new Float32Array(16000 * 2); for (let i = 0; i < a.length; i++) a[i] = (Math.random() * 2 - 1) * 0.0015; for (let i = 8000; i < 8000 + 600; i++) a[i] += 0.3 * Math.sin(i);
  const evs = run(V.Endpointer(), a); assert.ok(!evs.some((e) => e.t === 'end'), evs.map((e) => e.t).join(','));
});
ok('its own voice coming back (echo) does not trigger while it speaks', () => {
  const ep = V.Endpointer(); ep.playing = true; ep.out = 0.05; // what the speakers play
  // echo: a steady voice-like signal at a modest level, for 3 s
  const R = 16000, a = new Float32Array(R * 3); for (let i = 0; i < a.length; i++) a[i] = 0.02 * (0.55 + 0.45 * Math.abs(Math.sin(Math.PI * 4 * i / R))) * Math.sin(2 * Math.PI * 180 * i / R) * (i < 1600 ? i / 1600 : 1);
  const evs = run(ep, a); assert.ok(!evs.some((e) => e.t === 'start'), 'no start on echo');
  // the user, louder, over it
  const b = new Float32Array(R); for (let i = 0; i < b.length; i++) b[i] = a[i] + 0.12 * Math.sin(2 * Math.PI * 140 * i / R);
  assert.ok(run(ep, b).some((e) => e.t === 'start'), 'the user is still heard over the echo');
});
ok('resampling 48 kHz → 16 kHz, streamed', () => {
  const r = V.Resampler(48000); let n = 0; for (let i = 0; i < 10; i++) n += r(new Float32Array(1024)).length;
  assert.ok(Math.abs(n - 10240 / 3) <= 1, String(n));
  const r2 = V.Resampler(44100); let m = 0; for (let i = 0; i < 10; i++) m += r2(new Float32Array(1024)).length; assert.ok(Math.abs(m - 10240 * 16000 / 44100) <= 2, String(m));
});
ok('wav round trip', () => { const x = new Float32Array([0, 0.5, -0.5, 0.25]); const p = V.parseWav(V.wav16k(x)); assert.strictEqual(p.rate, 16000); assert.ok(Math.abs(p.pcm[1] - 0.5) < 1e-3); });

ok('first piece out at the first clause, then whole sentences', () => {
  const c = V.Chunker(); const out = [];
  for (const tok of '**Bonjour Lulu !** Il fait 21 °C à Paris aujourd’hui, le 12/11/2026. Oui. Regarde ça. Et voilà une phrase plus longue qui continue encore.'.match(/\S+\s*/g)) out.push(...c.push(tok));
  out.push(...c.flush());
  assert.strictEqual(out[0], '**Bonjour Lulu !**');
  assert.ok(out[1].startsWith('Il fait 21 °C') && out[1].endsWith('2026.'), out[1]);
  assert.ok(out.some((x) => x.startsWith('Oui. Regarde ça.')), 'short sentences merged: ' + JSON.stringify(out));
});
ok('no punctuation yet: the first piece does not wait for one', () => {
  const c = V.Chunker(); const out = []; for (const tok of 'alors voilà ce que je pense de tout cela en vrai sans aucune ponctuation '.match(/\S+\s*/g)) out.push(...c.push(tok));
  assert.ok(out.length === 1 && out[0].split(' ').length >= 8, JSON.stringify(out));
});
ok('tags and code are never cut', () => {
  const c = V.Chunker(); const out = []; for (const tok of 'Voici, [son:ding] le code. ```js\nconst a = 1; a.b();\n``` Voilà, c’est fait.'.match(/\S+\s*|\n/g)) out.push(...c.push(tok)); out.push(...c.flush());
  assert.ok(out.every((x) => (x.match(/```/g) || []).length % 2 === 0), JSON.stringify(out));
  assert.ok(out.every((x) => !/\[[^\]]*$/.test(x)), JSON.stringify(out));
});
ok('abbreviations and decimals do not end a sentence', () => {
  const c = V.Chunker(); const out = []; for (const tok of 'Bonjour, M. Dupont a payé 3.5 euros pour ça. Et ensuite il est rentré chez lui tranquillement.'.match(/\S+\s*/g)) out.push(...c.push(tok)); out.push(...c.flush());
  assert.ok(out.every((x) => !/(M|3)\.$/.test(x)) && out.join(' ').includes('M. Dupont a payé 3.5'), JSON.stringify(out));
});

ok('no markdown, code, links or emoji read aloud', () => {
  const s = V.speakable('**Bonjour** _Lulu_ 🙂👍🏽 ! Va sur https://example.com/x?y=1 ou [ce site](https://a.b). Lance `npm install` :\n```bash\nrm -rf /\n```\n- un\n- deux\n# Titre', 'fr');
  assert.ok(!/[*_`#]|https?:|example\.com|rm -rf|🙂|👍/.test(s), s);
  assert.ok(/le lien est à l’écran/.test(s) && /npm install/.test(s) && /code à l’écran/.test(s) && /ce site/.test(s), s);
});
ok('dates, units, money and times in words (fr)', () => {
  const s = V.speakable('Il fait 21 °C le 12/11/2026 à 14h30, 3.5 % de plus, 20 € et 5 km/h. Rendez-vous le 2026-01-01.', 'fr');
  assert.ok(/21 degrés/.test(s) && /12 novembre 2026/.test(s) && /14 heures 30/.test(s) && /3,5 pour cent/.test(s) && /20 euros/.test(s) && /5 kilomètres heure/.test(s) && /1er janvier 2026/.test(s), s);
});
ok('dates and units in words (en)', () => {
  const s = V.speakable('It is 70 °F on 11/12/2026, a 20% chance, $5.', 'en');
  assert.ok(/70 degrees Fahrenheit/.test(s) && /November 12, 2026/.test(s) && /20 percent/.test(s) && /5 dollars/.test(s), s);
});
ok('foreign alphabets dropped, except for a voice that reads them', () => {
  assert.ok(!/你好/.test(V.speakable('Salut 你好 !', 'fr'))); assert.ok(/Привет/.test(V.speakable('Привет мир', 'ru')));
});
ok('does it sound finished?', () => {
  assert.strictEqual(V.soundsDone('Quel temps fait-il à Paris ?', 'fr'), 'done');
  assert.strictEqual(V.soundsDone('je voudrais savoir si', 'fr'), 'mid');
  assert.strictEqual(V.soundsDone('I want to go to the', 'en'), 'mid');
  assert.strictEqual(V.soundsDone('euh', 'fr'), 'mid');
});
ok('what was heard of a piece cut halfway', () => {
  assert.strictEqual(V.spokenPart('un deux trois quatre', 0.5), 'un deux'); assert.strictEqual(V.spokenPart('un deux', 0.01), ''); assert.strictEqual(V.spokenPart('un deux', 1), 'un deux');
});
console.log(`voice-core: ${n} passed`);

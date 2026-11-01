'use strict';
/* Voice mode, the parts that make it feel alive:
   - VEar: listens to *how* something was said and to sounds that aren't words — whistling, humming, singing,
     laughing, clapping, a fart, a whisper, an excited or tired voice. Pure signal analysis of the utterance
     (spectrum, pitch, energy, rhythm): a few milliseconds, no model to download.
   - VFX: sound effects the AI can play ([son:prout], [son:ding]…), synthesised on the fly with Web Audio.
   - vStyle / vSegments: the AI's light tags ([rire], [soupir], [chuchote], (joyeux)…) → how each piece is spoken. */

// ───────────────────────────── VEar ─────────────────────────────
const VEar = (() => {
  // radix-2 FFT (in place) on N = 1024
  function fft(re, im) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) { let b = n >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
    for (let len = 2; len <= n; len <<= 1) {
      const a = -2 * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a);
      for (let i = 0; i < n; i += len) {
        let cr = 1, ci = 0;
        for (let k = 0; k < len / 2; k++) {
          const ur = re[i + k], ui = im[i + k], vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci, vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
          re[i + k] = ur + vr; im[i + k] = ui + vi; re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
          const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
        }
      }
    }
  }
  // pitch by normalised autocorrelation (70–700 Hz), with its clarity (0..1)
  function pitch(x, rate) {
    const minL = Math.floor(rate / 700), maxL = Math.floor(rate / 70);
    let e0 = 0; for (let i = 0; i < x.length; i++) e0 += x[i] * x[i];
    if (e0 < 1e-6) return { f: 0, c: 0 };
    let best = 0, bl = 0;
    for (let l = minL; l <= maxL && l < x.length / 2; l++) {
      let s = 0, e1 = 0; for (let i = 0; i + l < x.length; i++) { s += x[i] * x[i + l]; e1 += x[i + l] * x[i + l]; }
      const c = s / Math.sqrt(e0 * e1 + 1e-9); if (c > best) { best = c; bl = l; }
    }
    return { f: bl ? rate / bl : 0, c: best };
  }
  function analyse(chunks, rate) {
    const N = 1024; const all = new Float32Array(chunks.reduce((a, c) => a + c.length, 0)); let o = 0; for (const c of chunks) { all.set(c, o); o += c.length; }
    const dur = all.length / rate, frames = [], end = Math.min(all.length, rate * 8); // the first 8 s are plenty
    const re = new Float32Array(N), im = new Float32Array(N), win = new Float32Array(N); for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1));
    for (let s = 0; s + N <= end; s += N) {
      let e = 0, z = 0, pk = 0; for (let i = 0; i < N; i++) { const v = all[s + i]; e += v * v; if (i && (v >= 0) !== (all[s + i - 1] >= 0)) z++; pk = Math.max(pk, Math.abs(v)); re[i] = v * win[i]; im[i] = 0; }
      const rms = Math.sqrt(e / N); if (rms < 0.003) { frames.push({ rms, silent: true }); continue; }
      fft(re, im);
      // power spectrum: centroid, share under 300 Hz, the strongest peak's share (a pure tone: whistle), flatness (noise vs harmonics)
      const half = N / 2, bin = rate / N; let tot = 0, wsum = 0, max = 0, maxK = 0, low = 0, lnSum = 0, bandSum = 0, bandN = 0;
      const P = new Float32Array(half);
      for (let k = 1; k < half; k++) { const p = re[k] * re[k] + im[k] * im[k]; P[k] = p; tot += p; wsum += p * k; if (p > max) { max = p; maxK = k; } if (k * bin < 300) low += p; if (k * bin > 50 && k * bin < 2000) { lnSum += Math.log(p + 1e-12); bandSum += p; bandN++; } }
      let around = 0; for (let k = Math.max(1, maxK - 2); k <= Math.min(half - 1, maxK + 2); k++) around += P[k];
      const D = Math.max(1, Math.round(rate / 16000)), dec = new Float32Array(Math.floor(N / D)); // pitch on ~16 kHz: fast enough
      for (let i = 0; i < dec.length; i++) { let v = 0; for (let j = 0; j < D; j++) v += all[s + i * D + j]; dec[i] = v / D; }
      const p = pitch(dec, rate / D);
      frames.push({ rms, crest: pk / (rms + 1e-9), zcr: z / N, cent: (wsum / (tot + 1e-12)) * bin, pure: around / (tot + 1e-12), dom: maxK * bin, low: low / (tot + 1e-12), flat: bandN ? Math.exp(lnSum / bandN) / (bandSum / bandN + 1e-12) : 0, f0: p.c > 0.55 ? p.f : 0, clar: p.c });
    }
    const on = frames.filter((f) => !f.silent); const n = on.length || 1;
    const share = (fn) => on.filter(fn).length / n;
    const voiced = on.filter((f) => f.f0); const f0s = voiced.map((f) => f.f0);
    const mean = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
    const sd = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };
    // semitone spread of the melody, and how long notes are held (singing / humming hold notes, speech glides)
    const semis = f0s.map((f) => 12 * Math.log2(f / 110)); let held = 0; for (let i = 1; i < semis.length; i++) if (Math.abs(semis[i] - semis[i - 1]) < 0.6) held++;
    const holdRatio = semis.length > 1 ? held / (semis.length - 1) : 0;
    // energy bursts per second (laughter: 4–7 "ha" a second)
    let bursts = 0, up = false; const thr = mean(on.map((f) => f.rms)) * 0.9; for (const f of frames) { if (!up && f.rms > thr) { bursts++; up = true; } else if (up && f.rms < thr * 0.6) up = false; }
    return {
      dur, n: on.length, rms: mean(on.map((f) => f.rms)), cent: mean(on.map((f) => f.cent)), zcr: mean(on.map((f) => f.zcr)),
      voiced: share((f) => f.f0), tone: share((f) => f.pure > 0.5 && f.dom > 600 && f.dom < 5000), lowNoise: share((f) => f.low > 0.6 && (f.flat > 0.12 || !f.f0 || f.f0 < 150)), flat: mean(on.map((f) => f.flat)),
      impulses: share((f) => f.crest > 9 && f.cent > 1500), f0: mean(f0s), f0sd: sd(semis), holdRatio, burstRate: bursts / Math.max(0.3, dur),
    };
  }
  // feature set + transcript → tags for the model, e.g. ["whistling"] or ["voice:excited"]
  function tags(a, text) {
    if (!a || a.n < 3) return [];
    const out = []; const words = (String(text || '').match(/[\p{L}']+/gu) || []).length;
    const laughText = /\b(ha|hah|haha|hi|hihi|hé|héhé|ho|mdr|lol)\b(\W*\b(ha|hi|hé|ho)\b){1,}/i.test(text || '') || /^(\W*(ha|hi|hé|he|ho)\W*){2,}$/i.test(text || '');
    if (a.tone > 0.45 && words <= 3) out.push('whistling');
    else if (a.voiced > 0.55 && a.holdRatio > 0.55 && a.cent < 900 && a.dur > 0.6 && words <= 2) out.push('humming');
    else if (a.voiced > 0.5 && a.holdRatio > 0.45 && a.f0sd > 2 && words >= 3) out.push('singing');
    if (laughText || (a.burstRate > 3.5 && a.voiced > 0.3 && words <= 4 && a.dur < 4)) out.push('laughing');
    if (a.lowNoise > 0.5 && a.dur > 0.15 && a.dur < 3 && words <= 1 && !out.length && a.holdRatio < 0.8) out.push('fart-like low rumble');
    if (a.impulses > 0.35 && a.voiced < 0.2 && words <= 1) out.push('clapping or knocking');
    if (words >= 2) {
      if (a.voiced < 0.25 && a.rms < 0.05 && a.cent > 1000) out.push('voice:whispering');
      else if (a.rms > 0.12 && a.f0sd > 3) out.push('voice:excited');
      else if (a.f0 && a.f0sd < 1.3 && a.rms < 0.06) out.push('voice:flat, tired or sad');
      else if (a.rms > 0.16) out.push('voice:loud');
    }
    return out;
  }
  return { analyse, tags };
})();

// ───────────────────────────── VFX: sound effects, synthesised ─────────────────────────────
const VFX = (() => {
  let ctx = null;
  const ac = () => { ctx = ctx || new (window.AudioContext || window.webkitAudioContext)(); if (ctx.state !== 'running') ctx.resume().catch(() => {}); return ctx; };
  const noise = (c, sec) => { const b = c.createBuffer(1, Math.ceil(c.sampleRate * sec), c.sampleRate); const d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; const s = c.createBufferSource(); s.buffer = b; return s; };
  const env = (g, t, a, peak, hold, rel) => { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.setValueAtTime(peak, t + a + hold); g.gain.exponentialRampToValueAtTime(0.0001, t + a + hold + rel); return a + hold + rel; };
  function tone(c, out, t, f, dur, type = 'sine', vol = 0.3, glide) { const o = c.createOscillator(); const g = c.createGain(); o.type = type; o.frequency.setValueAtTime(f, t); if (glide) o.frequency.exponentialRampToValueAtTime(glide, t + dur); o.connect(g); g.connect(out); env(g, t, 0.01, vol, dur * 0.4, dur * 0.6); o.start(t); o.stop(t + dur + 0.05); }
  const S = {
    fart(c, out, t) { const n = noise(c, 1.1); const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 6; bp.frequency.setValueAtTime(110, t); bp.frequency.linearRampToValueAtTime(70, t + 0.9);
      const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(95, t); o.frequency.linearRampToValueAtTime(60, t + 0.9); const lfo = c.createOscillator(); lfo.frequency.value = 23; const lg = c.createGain(); lg.gain.value = 25; lfo.connect(lg); lg.connect(o.frequency);
      const g = c.createGain(); n.connect(bp); bp.connect(g); o.connect(g); g.connect(out); env(g, t, 0.03, 0.5, 0.55, 0.35); [n, o, lfo].forEach((x) => { x.start(t); x.stop(t + 1.1); }); return 1; },
    whistle(c, out, t) { tone(c, out, t, 900, 0.35, 'sine', 0.25, 2200); tone(c, out, t + 0.42, 2200, 0.45, 'sine', 0.25, 700); return 0.95; },
    ding(c, out, t) { [880, 1760, 2640].forEach((f, i) => tone(c, out, t, f, 1.4 - i * 0.3, 'sine', 0.22 / (i + 1))); return 1.3; },
    tada(c, out, t) { [[523, 0], [659, 0.12], [784, 0.24], [1046, 0.38]].forEach(([f, d]) => tone(c, out, t + d, f, d === 0.38 ? 0.9 : 0.25, 'triangle', 0.22)); return 1.3; },
    boing(c, out, t) { tone(c, out, t, 150, 0.6, 'sine', 0.4, 520); return 0.6; },
    pop(c, out, t) { tone(c, out, t, 700, 0.08, 'sine', 0.4, 180); return 0.12; },
    woosh(c, out, t) { const n = noise(c, 0.8); const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.2; bp.frequency.setValueAtTime(400, t); bp.frequency.exponentialRampToValueAtTime(3000, t + 0.4); bp.frequency.exponentialRampToValueAtTime(600, t + 0.75); const g = c.createGain(); n.connect(bp); bp.connect(g); g.connect(out); env(g, t, 0.15, 0.4, 0.2, 0.4); n.start(t); n.stop(t + 0.8); return 0.8; },
    applause(c, out, t) { for (let i = 0; i < 40; i++) { const d = t + Math.random() * 1.6; const n = noise(c, 0.05); const hp = c.createBiquadFilter(); hp.type = 'bandpass'; hp.frequency.value = 1500 + Math.random() * 1500; const g = c.createGain(); n.connect(hp); hp.connect(g); g.connect(out); env(g, d, 0.002, 0.35, 0.005, 0.04); n.start(d); n.stop(d + 0.06); } return 1.7; },
    drumroll(c, out, t) { for (let i = 0; i < 26; i++) { const d = t + i * 0.045; const n = noise(c, 0.06); const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 220; bp.Q.value = 2; const g = c.createGain(); n.connect(bp); bp.connect(g); g.connect(out); env(g, d, 0.002, 0.2 + i * 0.012, 0.01, 0.05); n.start(d); n.stop(d + 0.07); } S.cymbal(c, out, t + 1.2); return 1.9; },
    cymbal(c, out, t) { const n = noise(c, 1.2); const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 6000; const g = c.createGain(); n.connect(hp); hp.connect(g); g.connect(out); env(g, t, 0.005, 0.35, 0.02, 1); n.start(t); n.stop(t + 1.2); return 1.1; },
    rimshot(c, out, t) { tone(c, out, t, 180, 0.12, 'sine', 0.5, 60); tone(c, out, t + 0.22, 180, 0.12, 'sine', 0.5, 60); S.cymbal(c, out, t + 0.45); return 1.5; },
    bell(c, out, t) { [523, 1047, 1568, 2093].forEach((f, i) => tone(c, out, t, f * 1.001, 2.2 - i * 0.4, 'sine', 0.18 / (i + 1))); return 2; },
    thunder(c, out, t) { const n = noise(c, 2.6); const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(900, t); lp.frequency.exponentialRampToValueAtTime(120, t + 2.4); const g = c.createGain(); n.connect(lp); lp.connect(g); g.connect(out); env(g, t, 0.05, 0.8, 0.4, 2); n.start(t); n.stop(t + 2.6); return 2.5; },
    sigh(c, out, t) { const n = noise(c, 1.2); const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.8; bp.frequency.setValueAtTime(1200, t); bp.frequency.linearRampToValueAtTime(600, t + 1.1); const g = c.createGain(); n.connect(bp); bp.connect(g); g.connect(out); env(g, t, 0.25, 0.22, 0.25, 0.65); n.start(t); n.stop(t + 1.2); return 1.15; },
    kiss(c, out, t) { tone(c, out, t, 1400, 0.05, 'sine', 0.35, 2600); return 0.1; },
    heartbeat(c, out, t) { for (let i = 0; i < 3; i++) { tone(c, out, t + i * 0.8, 60, 0.12, 'sine', 0.6, 40); tone(c, out, t + i * 0.8 + 0.2, 55, 0.12, 'sine', 0.5, 40); } return 2.3; },
    magic(c, out, t) { for (let i = 0; i < 9; i++) tone(c, out, t + i * 0.05, 1200 + i * 220, 0.25, 'sine', 0.12); return 0.8; },
  };
  const ALIAS = { prout: 'fart', pet: 'fart', fart: 'fart', sifflet: 'whistle', siffle: 'whistle', whistle: 'whistle', ding: 'ding', tada: 'tada', 'ta-da': 'tada', boing: 'boing', pop: 'pop', woosh: 'woosh', swoosh: 'woosh', applaudissements: 'applause', applause: 'applause', bravo: 'applause', tambour: 'drumroll', roulement: 'drumroll', drumroll: 'drumroll', cymbale: 'cymbal', badumtss: 'rimshot', 'ba-dum-tss': 'rimshot', rimshot: 'rimshot', cloche: 'bell', bell: 'bell', tonnerre: 'thunder', thunder: 'thunder', soupir: 'sigh', sigh: 'sigh', bisou: 'kiss', kiss: 'kiss', coeur: 'heartbeat', heartbeat: 'heartbeat', magie: 'magic', magic: 'magic' };
  const NAMES = ['prout', 'sifflet', 'ding', 'tada', 'boing', 'pop', 'woosh', 'applaudissements', 'tambour', 'badumtss', 'cloche', 'tonnerre', 'soupir', 'bisou', 'coeur', 'magie'];
  // plays it now, resolves when it's over
  function play(name) {
    const k = ALIAS[String(name || '').toLowerCase().replace(/\s+/g, '-')]; if (!k || !S[k]) return Promise.resolve(false);
    const c = ac(); const g = c.createGain(); g.gain.value = 0.9; g.connect(c.destination);
    const d = S[k](c, g, c.currentTime + 0.02);
    return new Promise((r) => setTimeout(() => r(true), d * 1000 + 60));
  }
  return { play, NAMES, known: (n) => !!ALIAS[String(n || '').toLowerCase().replace(/\s+/g, '-')] };
})();

// ───────────────────────────── the AI's tags → spoken segments ─────────────────────────────
// "(joyeux) Super ! [rire] Bon, [son:ding] c'est prêt." → [{style:'happy', text:'Super !'}, {laugh}, {text:'Bon,'}, {sfx:'ding'}, {text:"c'est prêt."}]
const V_EMO = { joyeux: 'happy', joyeuse: 'happy', happy: 'happy', content: 'happy', excité: 'excited', excitée: 'excited', excited: 'excited', enthousiaste: 'excited', triste: 'sad', sad: 'sad', calme: 'calm', calm: 'calm', doux: 'calm', douce: 'calm', tendre: 'calm', surpris: 'surprised', surprise: 'surprised', surprised: 'surprised', amusé: 'happy', amusée: 'happy', sérieux: 'serious', serious: 'serious', mystérieux: 'whisper', fatigué: 'sad', énervé: 'excited', angry: 'excited', chuchote: 'whisper', chuchoté: 'whisper', whisper: 'whisper', murmure: 'whisper' };
const V_STYLE = { neutral: { speed: 1, vol: 1 }, happy: { speed: 1.06, vol: 1 }, excited: { speed: 1.13, vol: 1 }, sad: { speed: 0.88, vol: 0.85 }, calm: { speed: 0.94, vol: 0.9 }, surprised: { speed: 1.08, vol: 1 }, serious: { speed: 0.96, vol: 1 }, whisper: { speed: 0.92, vol: 0.5 } };
const LAUGH = { fr: 'Ha ha ha !', en: 'Ha ha ha!', es: '¡Ja ja ja!', de: 'Ha ha ha!', it: 'Ah ah ah!', pt: 'Ha ha ha!' };
function vSegments(text, carry = 'neutral') {
  const out = []; let style = carry;
  const re = /\[(son|sound|sfx)\s*:\s*([^\]]+)\]|\[(rire|rires|rit|laugh|laughs|laughing|petit rire)\]|\[(soupir|soupire|sigh|sighs)\]|\[(chuchote|chuchoté|whisper|whispers|murmure)\]|\((joyeux|joyeuse|happy|content|excité|excitée|excited|enthousiaste|triste|sad|calme|calm|doux|douce|tendre|surpris|surprise|surprised|amusé|amusée|sérieux|serious|mystérieux|fatigué|énervé|angry)\)|\[(joyeux|happy|excité|excited|triste|sad|calme|calm|surpris|surprised|amusé|sérieux)\]/gi;
  let last = 0, m;
  const push = (s) => { const x = s.replace(/\s+/g, ' ').trim(); if (x) out.push({ text: x, style }); };
  while ((m = re.exec(text))) {
    push(text.slice(last, m.index)); last = m.index + m[0].length;
    if (m[2]) out.push({ sfx: m[2].trim() });
    else if (m[3]) out.push({ laugh: true });
    else if (m[4]) out.push({ sfx: 'soupir' });
    else if (m[5]) style = 'whisper';
    else style = V_EMO[(m[6] || m[7]).toLowerCase()] || 'neutral';
  }
  push(text.slice(last));
  return { segs: out, style };
}
const vStripTags = (t) => String(t).replace(/\[(son|sound|sfx)\s*:[^\]]*\]|\[(rire|rires|rit|laugh|laughs|laughing|petit rire|soupir|soupire|sigh|sighs|chuchote|chuchoté|whisper|whispers|murmure|joyeux|happy|excité|excited|triste|sad|calme|calm|surpris|surprised|amusé|sérieux)\]|\((joyeux|joyeuse|happy|content|excité|excitée|excited|enthousiaste|triste|sad|calme|calm|doux|douce|tendre|surpris|surprise|surprised|amusé|amusée|sérieux|serious|mystérieux|fatigué|énervé|angry)\)/gi, ' ').replace(/[ \t]{2,}/g, ' ').trim();

// ───────────────────────────── the referee: keep talking, or turn to what was just said ─────────────────────────────
// Said over the AI's voice: a backchannel ("mh", "ouais", "ok", a laugh) → it carries on; anything else → it stops
// where it was and answers that.
function vRefereeKeepTalking(text, tags, dur) {
  const s = String(text || '').toLowerCase().replace(/[.!?…,]/g, ' ').trim();
  if (!s) return true; // a sound, a breath, nothing understood
  if (/^(continue|continues|vas-?y|vas y|go on|keep going|et (alors|ensuite|après)|sigue|weiter)\b/.test(s)) return true;
  const back = /^((mh+|hm+|mmh?|uh[- ]?huh|ah+|oh+|ouais|ouai|oui|ok|okay|d'accord|dac|ok d'accord|ah ouais|ah oui|carrément|grave|exactement|trop bien|super|cool|génial|wow|waouh|incroyable|c'est vrai|je vois|hein|yeah|yes|yep|right|sure|i see|nice|great|vale|sí|si|claro|ja|genau|stimmt|mdr|lol|haha|hihi)\s*)+$/;
  const words = s.split(/\s+/).length;
  return (back.test(s) && words <= 4) || (tags.includes('laughing') && words <= 3) || (dur < 0.6 && words <= 1);
}

'use strict';
/* Voice mode, the pure parts (no DOM, no audio device): shared by the app, Fabro Anywhere and the plain-node tests
   (scripts/voice-test.js).
   - Endpointer: voice activity on 10 ms frames at 16 kHz — adaptive noise floor, quick onset, a pre-roll so the
     first syllable is never cut, end of speech that waits less when the sentence sounds finished, an echo gate
     while Fabro itself is speaking.
   - Chunker: the streamed answer → speakable pieces, the first one as early as possible.
   - speakable(): what a voice should actually say — no markdown, code, links or emoji; dates, units and money
     in words the voices read properly.
   - resample16k(): any rate → 16 kHz, with a box filter (no aliasing hiss on whispers). */
(function (root) {
  const RATE = 16000, FRAME = 160; // 10 ms

  // ───────────────────────────── resampling ─────────────────────────────
  // Streaming: keeps the fractional position between calls.
  function Resampler(from) {
    const ratio = from / RATE; let pos = 0; let carry = new Float32Array(0);
    return (x) => {
      if (Math.abs(ratio - 1) < 1e-6) return Float32Array.from(x);
      const a = new Float32Array(carry.length + x.length); a.set(carry); a.set(x, carry.length);
      const out = []; const w = Math.max(1, Math.round(ratio));
      while (pos + w <= a.length) { const i = Math.floor(pos); let s = 0; for (let j = 0; j < w; j++) s += a[i + j]; out.push(s / w); pos += ratio; }
      const keep = Math.floor(pos); carry = a.slice(keep); pos -= keep;
      return Float32Array.from(out);
    };
  }
  const resample16k = (x, from) => Resampler(from)(x);

  // ───────────────────────────── voice activity / end of speech ─────────────────────────────
  // feed(samples16k) → events: { t:'start', at } { t:'pause', at } (≥ PAUSE ms of silence: time to transcribe what
  // was said) { t:'resume' } { t:'end', at, pcm, voicedMs } { t:'cancel' } (too short to be speech)
  // at = position in ms since the stream started (the audio clock, not the wall clock).
  function Endpointer(o = {}) {
    const cfg = { preMs: 500, onFrames: 4, onWindow: 7, minOn: 0.0032, floorK: 3.0, offK: 0.55, pauseMs: 200, endMs: 650, doneMs: 380, midMs: 1100, maxMs: 30000, minVoicedMs: 160, ...o };
    const st = { floor: 0.004, echo: 0, out: 0, couple: 0.4, playing: false, sens: 1, muted: false, hint: null, pos: 0, inSpeech: false, recent: [], pre: [], preLen: 0, buf: [], bufLen: 0, lastVoiced: 0, startAt: 0, voicedMs: 0, paused: false, rem: new Float32Array(0) };
    const thrOn = () => Math.max(cfg.minOn / st.sens, st.floor * cfg.floorK / Math.max(0.5, st.sens), st.playing ? Math.max(st.echo, st.out * st.couple) * 1.7 : 0);
    function endWait() {
      // short pause when the sentence sounds finished, a longer one mid-thought
      if (st.hint === 'done') return cfg.doneMs;
      if (st.hint === 'mid') return cfg.midMs;
      return cfg.endMs;
    }
    function frame(f) {
      let e = 0; for (let i = 0; i < f.length; i++) e += f[i] * f[i];
      const rms = Math.sqrt(e / f.length); st.pos += 10; st.lastRms = rms;
      const ev = [];
      if (st.muted) { if (st.inSpeech) { reset(); ev.push({ t: 'cancel' }); } return ev; }
      const on = thrOn();
      if (!st.inSpeech) {
        // the floor follows the room: down fast, up slowly (a voice must not raise it)
        st.floor = rms < st.floor ? st.floor * 0.9 + rms * 0.1 : st.floor * 0.997 + Math.min(rms, st.floor * 4) * 0.003;
        st.floor = Math.min(0.05, Math.max(0.0006, st.floor));
        // the echo gate follows its own voice coming back (slow to rise, so a real voice jumping over it still counts)
        // and what is being played right now times how much of it reaches the microphone (learnt while the user is quiet)
        if (st.playing && st.out > 0.005 && rms < on) st.couple = Math.min(1, Math.max(0.05, st.couple * 0.995 + (rms / st.out) * 0.005 * 2));
        if (st.playing) st.echo = rms > st.echo ? st.echo + (rms - st.echo) * 0.08 : st.echo * 0.99; else st.echo *= 0.8;
        st.pre.push(f); st.preLen += f.length; while (st.preLen - st.pre[0].length >= cfg.preMs * 16) st.preLen -= st.pre.shift().length;
        st.recent.push(rms > on); if (st.recent.length > cfg.onWindow) st.recent.shift();
        if (st.recent.filter(Boolean).length >= cfg.onFrames + (st.playing ? 2 : 0)) {
          st.inSpeech = true; st.buf = st.pre.slice(); st.bufLen = st.preLen; st.pre = []; st.preLen = 0; st.recent = [];
          st.startAt = st.pos - st.bufLen / 16; st.lastVoiced = st.pos; st.voicedMs = cfg.onFrames * 10; st.paused = false; st.hint = null;
          ev.push({ t: 'start', at: st.pos });
        }
        return ev;
      }
      st.buf.push(f); st.bufLen += f.length;
      if (rms > on * cfg.offK) { st.lastVoiced = st.pos; if (rms > on) st.voicedMs += 10; if (st.paused) { st.paused = false; ev.push({ t: 'resume', at: st.pos }); } }
      const silent = st.pos - st.lastVoiced, dur = st.pos - st.startAt;
      if (!st.paused && silent >= cfg.pauseMs) { st.paused = true; ev.push({ t: 'pause', at: st.pos, upTo: st.bufLen }); }
      if (silent >= endWait() || dur >= cfg.maxMs) {
        const voicedMs = st.voicedMs, pcm = concat(st.buf, st.bufLen);
        const keep = Math.min(pcm.length, Math.ceil((st.lastVoiced - st.startAt + 150) * 16)); // 150 ms after the last sound is plenty
        reset();
        ev.push(voicedMs >= cfg.minVoicedMs ? { t: 'end', at: st.pos, pcm: pcm.subarray(0, keep), voicedMs } : { t: 'cancel' });
      }
      return ev;
    }
    function reset() { st.inSpeech = false; st.buf = []; st.bufLen = 0; st.paused = false; st.hint = null; st.recent = []; }
    return {
      st, cfg,
      feed(x) {
        let a = x; if (st.rem.length) { a = new Float32Array(st.rem.length + x.length); a.set(st.rem); a.set(x, st.rem.length); }
        const out = []; let i = 0;
        for (; i + FRAME <= a.length; i += FRAME) for (const e of frame(a.subarray(i, i + FRAME))) out.push(e);
        st.rem = a.slice(i); return out;
      },
      // what has been said so far in this utterance (16 kHz)
      sofar() { return st.inSpeech ? concat(st.buf, st.bufLen) : null; },
      get speaking() { return st.inSpeech; },
      get level() { return st.lastRms || 0; },
      set hint(h) { st.hint = h; }, set playing(p) { st.playing = !!p; }, set out(v) { st.out = v || 0; }, set sens(s) { st.sens = s || 1; }, set muted(m) { st.muted = !!m; },
      reset,
    };
  }
  function concat(list, n) { const out = new Float32Array(n); let o = 0; for (const c of list) { out.set(c, o); o += c.length; } return out; }

  // 16 kHz float → 16-bit WAV bytes
  function wav16k(pcm) {
    const n = pcm.length, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
    const w = (p, s) => { for (let i = 0; i < s.length; i++) v.setUint8(p + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, RATE, true); v.setUint32(28, RATE * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
    const o = new Int16Array(buf, 44); for (let i = 0; i < n; i++) o[i] = Math.max(-32768, Math.min(32767, Math.round(pcm[i] * 32767)));
    return new Uint8Array(buf);
  }
  // WAV bytes (16-bit PCM, any rate) → { pcm: Float32Array, rate }
  function parseWav(bytes) {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes); const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    let o = 12, rate = 22050, data = 44, len = Math.max(0, b.length - 44), bits = 16;
    while (o + 8 <= b.length) { const id = String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]), sz = v.getUint32(o + 4, true); if (id === 'fmt ') { rate = v.getUint32(o + 12, true); bits = v.getUint16(o + 22, true); } if (id === 'data') { data = o + 8; len = Math.min(sz, b.length - data); break; } o += 8 + sz + (sz % 2); }
    if (bits !== 16) return { pcm: new Float32Array(0), rate };
    const n = len >> 1, x = new Float32Array(n); for (let i = 0; i < n; i++) x[i] = v.getInt16(data + i * 2, true) / 32768;
    return { pcm: x, rate };
  }

  // ───────────────────────────── does this sound finished? ─────────────────────────────
  const MID = {
    fr: /\b(et|mais|ou|donc|car|parce|que|qui|de|du|des|le|la|les|un|une|pour|avec|dans|sur|si|quand|comme|alors|euh|heu|bah|ben|genre|enfin|en|au|aux|à|mon|ton|son|ma|ta|sa|ce|cette|est-ce|c'est)$/i,
    en: /\b(and|but|or|so|because|that|which|who|the|a|an|to|of|for|with|in|on|at|if|when|like|um|uh|er|my|your|is|are|was|i'm|it's)$/i,
    es: /\b(y|pero|o|porque|que|de|del|el|la|los|las|un|una|para|con|en|si|cuando|como|eh|este|mi|tu|su)$/i,
    de: /\b(und|aber|oder|weil|dass|der|die|das|ein|eine|zu|von|für|mit|in|auf|wenn|wie|äh|ähm|mein|dein)$/i,
  };
  function soundsDone(text, lang) {
    const s = String(text || '').trim(); if (!s) return null;
    const words = s.split(/\s+/).length;
    if (/(\.\.\.|…|,|;|:|-)$/.test(s)) return 'mid';
    const bare = s.replace(/[.!?"»”)\]]+$/, '').trim();
    const mid = MID[String(lang || '').slice(0, 2)] || MID.en;
    if (mid.test(bare) || MID.en.test(bare)) return 'mid';
    if (/[.!?]$/.test(s) && words >= 2) return 'done';
    return words >= 3 ? 'done' : null;
  }

  // ───────────────────────────── spoken form ─────────────────────────────
  const L = {
    fr: { code: 'Je te mets le code à l’écran.', link: 'le lien est à l’écran', table: 'Je te mets le tableau à l’écran.', deg: 'degrés', degF: 'degrés Fahrenheit', pct: 'pour cent', eur: 'euros', usd: 'dollars', gbp: 'livres', kmh: 'kilomètres heure', km: 'kilomètres', kg: 'kilos', go: 'gigaoctets', mo: 'mégaoctets', h: 'heures', and: 'et', plus: 'plus', eq: 'égale', at: 'arobase', months: ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'], dmy: true, comma: true },
    en: { code: 'I’ve put the code on screen.', link: 'the link is on screen', table: 'I’ve put the table on screen.', deg: 'degrees', degF: 'degrees Fahrenheit', pct: 'percent', eur: 'euros', usd: 'dollars', gbp: 'pounds', kmh: 'kilometers per hour', km: 'kilometers', kg: 'kilos', go: 'gigabytes', mo: 'megabytes', h: 'hours', and: 'and', plus: 'plus', eq: 'equals', at: 'at', months: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'], dmy: false },
    es: { code: 'Te pongo el código en la pantalla.', link: 'el enlace está en la pantalla', table: 'Te pongo la tabla en la pantalla.', deg: 'grados', degF: 'grados Fahrenheit', pct: 'por ciento', eur: 'euros', usd: 'dólares', gbp: 'libras', kmh: 'kilómetros por hora', km: 'kilómetros', kg: 'kilos', go: 'gigabytes', mo: 'megabytes', h: 'horas', and: 'y', plus: 'más', eq: 'igual a', at: 'arroba', months: ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'], dmy: true, comma: true, of: 'de' },
    de: { code: 'Ich zeige dir den Code auf dem Bildschirm.', link: 'der Link ist auf dem Bildschirm', table: 'Ich zeige dir die Tabelle auf dem Bildschirm.', deg: 'Grad', degF: 'Grad Fahrenheit', pct: 'Prozent', eur: 'Euro', usd: 'Dollar', gbp: 'Pfund', kmh: 'Kilometer pro Stunde', km: 'Kilometer', kg: 'Kilo', go: 'Gigabyte', mo: 'Megabyte', h: 'Uhr', and: 'und', plus: 'plus', eq: 'gleich', at: 'at', months: ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'], dmy: true, comma: true },
  };
  L.it = { ...L.en, code: 'Ti metto il codice sullo schermo.', link: 'il link è sullo schermo', table: 'Ti metto la tabella sullo schermo.', deg: 'gradi', pct: 'per cento', eur: 'euro', h: 'ore', and: 'e', months: ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'], dmy: true, comma: true };
  L.pt = { ...L.es, code: 'Coloquei o código na tela.', link: 'o link está na tela', table: 'Coloquei a tabela na tela.', deg: 'graus', pct: 'por cento', and: 'e', h: 'horas', months: ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'] };
  const lw = (lang) => L[String(lang || 'en').slice(0, 2)] || L.en;
  // the alphabets each voice can read; anything else (and emoji) is dropped from speech
  const NON_LATIN_OK = { ru: /\p{Script=Cyrillic}/u, uk: /\p{Script=Cyrillic}/u, zh: /\p{Script=Han}/u };
  const EMOJI = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{FE0F}\u{200D}\u{20E3}]/gu;
  function speakable(text, lang = 'en') {
    const w = lw(lang); const l2 = String(lang || 'en').slice(0, 2);
    let s = String(text || '');
    let saidCode = false, saidLink = false;
    s = s.replace(/<artifact[\s\S]*?(<\/artifact>|$)/g, () => { if (saidCode) return ' '; saidCode = true; return ' ' + w.code + ' '; })
      .replace(/```[\s\S]*?(```|$)/g, () => { if (saidCode) return ' '; saidCode = true; return ' ' + w.code + ' '; })
      .replace(/(^|\n)\s*\|.*\|\s*(?=\n|$)(\n\s*\|.*\|\s*(?=\n|$))*/g, () => ' ' + w.table + ' ')
      .replace(/<[^>]{1,200}>/g, ' ')
      .replace(/`([^`\n]{1,40})`/g, '$1').replace(/`[^`]*`?/g, ' ')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ').replace(/\[([^\]]+)\]\((?:[^)]*)\)/g, '$1')
      .replace(/\b(?:https?:\/\/|www\.)\S+/gi, () => { if (saidLink) return ' '; saidLink = true; return ' (' + w.link + ') '; })
      .replace(/\b[\w.+-]+@[\w-]+\.[\w.]+\b/g, ' ')
      .replace(/\[\d+\]/g, '').replace(/^#+\s*/gm, '').replace(/^\s*(?:[-*•]|\d+[.)])\s+/gm, '')
      .replace(EMOJI, ' ');
    // dates, times, units, money — what the voices misread when left as symbols
    s = s.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (m, y, mo, d) => date(+d, +mo, y))
      .replace(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g, (m, a, b, y) => { let d = +a, mo = +b; if (!w.dmy || d > 31) [d, mo] = [mo, d]; if (mo > 12 && d <= 12) [d, mo] = [mo, d]; return mo >= 1 && mo <= 12 ? date(d, mo, y) : m; })
      .replace(/\b(\d{1,2})[h:](\d{2})\b(?!\s*%)/g, (m, h, mi) => (l2 === 'fr' ? `${+h} heures ${mi === '00' ? '' : +mi}`.trim() : l2 === 'de' ? `${+h} Uhr ${mi === '00' ? '' : +mi}`.trim() : m))
      .replace(/(-?\d+(?:[.,]\d+)?)\s*°\s*C\b/g, (m, n) => `${num(n)} ${w.deg}`).replace(/(-?\d+(?:[.,]\d+)?)\s*°\s*F\b/g, (m, n) => `${num(n)} ${w.degF}`).replace(/(-?\d+(?:[.,]\d+)?)\s*°/g, (m, n) => `${num(n)} ${w.deg}`)
      .replace(/(\d+(?:[.,]\d+)?)\s*%/g, (m, n) => `${num(n)} ${w.pct}`)
      .replace(/€\s*(\d+(?:[.,]\d+)?)|(\d+(?:[.,]\d+)?)\s*€/g, (m, a, b) => `${num(a || b)} ${w.eur}`)
      .replace(/\$\s*(\d+(?:[.,]\d+)?)|(\d+(?:[.,]\d+)?)\s*\$/g, (m, a, b) => `${num(a || b)} ${w.usd}`)
      .replace(/£\s*(\d+(?:[.,]\d+)?)|(\d+(?:[.,]\d+)?)\s*£/g, (m, a, b) => `${num(a || b)} ${w.gbp}`)
      .replace(/(\d+(?:[.,]\d+)?)\s*km\/h\b/gi, (m, n) => `${num(n)} ${w.kmh}`).replace(/(\d+(?:[.,]\d+)?)\s*km\b/g, (m, n) => `${num(n)} ${w.km}`).replace(/(\d+(?:[.,]\d+)?)\s*kg\b/g, (m, n) => `${num(n)} ${w.kg}`)
      .replace(/(\d+(?:[.,]\d+)?)\s*(Go|GB)\b/g, (m, n) => `${num(n)} ${w.go}`).replace(/(\d+(?:[.,]\d+)?)\s*(Mo|MB)\b/g, (m, n) => `${num(n)} ${w.mo}`)
      .replace(/(\d)\.(\d)/g, (m, a, b) => (w.comma ? `${a},${b}` : m))
      .replace(/\s&\s/g, ` ${w.and} `).replace(/\s\+\s/g, ` ${w.plus} `).replace(/\s=\s/g, ` ${w.eq} `)
      .replace(/[→←⇒➜►▶]/g, ', ');
    function date(d, mo, y) { const m = w.months[mo - 1]; if (!m) return `${d}/${mo}/${y}`; return l2 === 'en' ? `${m} ${d}, ${y}` : w.of ? `${d} ${w.of} ${m} ${w.of} ${y}` : `${d === 1 && l2 === 'fr' ? '1er' : d} ${m} ${y}`; }
    function num(n) { return w.comma ? String(n).replace('.', ',') : String(n).replace(',', '.'); }
    // markdown marks and symbols nobody says aloud
    s = s.replace(/\*\*|__|~~/g, '').replace(/(^|\s)[*_](?=\S)|(?<=\S)[*_](?=\s|$|[.,!?])/g, '$1').replace(/[*_~>#|\\^{}[\]]/g, ' ');
    const ok = NON_LATIN_OK[l2];
    s = s.replace(/[^\p{Script=Latin}\p{M}\p{N}\s.,;:!?…'’"«»()\-–—%€$£&@\/+=°]/gu, (ch) => (ok && ok.test(ch) ? ch : ' '));
    return s.replace(/\(\s*\)/g, ' ').replace(/\s+([.,!?;:])/g, '$1').replace(/([.,!?;:]){2,}/g, '$1').replace(/\s+/g, ' ').replace(/^[\s.,;:]+/, '').trim();
  }

  // ───────────────────────────── streamed text → pieces to speak ─────────────────────────────
  // The first piece goes out at the first clause (or after ~8 words with no punctuation), so the voice starts
  // while the model is still writing; later pieces are whole sentences (short ones merged), at most ~220 chars.
  // Tags ([son:…], (joyeux)…) and code blocks are never cut in half.
  const ABBR = /\b(M|Mme|Mlle|Dr|Pr|St|Ste|etc|ex|cf|vs|Mr|Mrs|Ms|Jr|Sr|e\.g|i\.e|p\.ex|n°|No)\.$/i;
  function Chunker() {
    let buf = '', count = 0;
    const words = (s) => (s.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length;
    function open(s) { return (s.match(/```/g) || []).length % 2 === 1 || /\[[^\]]{0,40}$/.test(s) || /<artifact(?![\s\S]*<\/artifact>)/.test(s); }
    function cutAt(s) {
      if (open(s)) return -1;
      const first = count === 0;
      const re = /([.!?…]+["»”)\]*_]*)(?=\s)|([,;:—–])(?=\s)|(\n\s*\n)/g; let m, best = -1, clause = -1;
      while ((m = re.exec(s))) {
        const end = m.index + m[0].length; const head = s.slice(0, end); const n = words(head);
        if (open(head)) continue;
        if (m[1] && !ABBR.test(head.replace(/[.!?…"»”)\]*_]+$/, '') + '.') && !/(^|\n)\s*\d{1,2}\.$/.test(head)) {
          if (first ? n >= 1 : n >= 4) return end;
          continue;
        }
        if (m[3] && n >= 1) return end;
        if (m[2]) { if (first && n >= 3) return end; if (n >= 7) clause = end; if (!first && n >= 22 && clause > 0) return clause; }
      }
      const n = words(s);
      if (first && n >= 9) { const sp = s.search(/\s\S*$/); return sp > 0 ? sp : -1; } // no punctuation yet: don't wait for it
      if (!first && s.length > 220) { if (clause > 0) return clause; const sp = s.lastIndexOf(' ', 220); return sp > 40 ? sp : -1; }
      return best;
    }
    return {
      push(text) {
        buf += text; const out = [];
        for (;;) {
          // a cut needs what follows it: "3." is only a sentence end once a space comes after
          const at = cutAt(buf); if (at <= 0) break;
          const piece = buf.slice(0, at); buf = buf.slice(at);
          if (piece.trim()) { out.push(piece.trim()); count++; }
        }
        return out;
      },
      flush() { const p = buf.trim(); buf = ''; if (p) { count++; return [p]; } return []; },
      retract(t) { buf = buf.replace(t, ''); },
      reset() { buf = ''; count = 0; },
      get pending() { return buf; },
    };
  }

  // ───────────────────────────── what was really said aloud ─────────────────────────────
  // text of a piece, and how far into its audio playback got (0..1) → the words heard (the word under way included)
  function spokenPart(text, frac) {
    const s = String(text || '').trim(); if (frac >= 0.97) return s; if (frac <= 0.02) return '';
    const ws = s.split(/\s+/); const n = Math.min(ws.length, Math.max(1, Math.ceil(ws.length * frac)));
    return ws.slice(0, n).join(' ');
  }

  const api = { RATE, Resampler, resample16k, Endpointer, wav16k, parseWav, soundsDone, speakable, Chunker, spokenPart };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.VCore = api;
})(typeof self !== 'undefined' ? self : this);

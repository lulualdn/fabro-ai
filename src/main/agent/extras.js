// Tools Fabro asked for (its own "outils supplémentaires" report): pause/wait, web image downloader,
// universal file importer, and speech generation with the local Piper voices (WAV or MP3).
const { BrowserWindow, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const agent = require('./index');
const files = require('./files');

const safe = (s) => String(s || '').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80);
const unique = (dir, base, ext) => { let f = path.join(dir, `${base}${ext}`); for (let i = 2; fs.existsSync(f); i++) f = path.join(dir, `${base} (${i})${ext}`); return f; };

agent.register({
  name: 'wait', category: 'plan', risk: 'read', core: true, noMcpWrap: true,
  description: 'Pause for a number of seconds (max 120) — e.g. while a download, an upload, a build or an external process finishes — then continue.',
  parameters: { type: 'object', properties: { seconds: { type: 'number' }, reason: { type: 'string' } }, required: ['seconds'] },
  summarize: (a) => `${a.seconds} s${a.reason ? ' · ' + a.reason : ''}`,
  async run(a, ctx) {
    const ms = Math.max(0.2, Math.min(120, +a.seconds || 1)) * 1000;
    await new Promise((res) => { const t = setTimeout(res, ms); if (ctx.onAbort) ctx.onAbort(() => { clearTimeout(t); res(); }); });
    return { content: `Waited ${Math.round(ms / 1000)} s.` };
  },
});

agent.register({
  name: 'browser_download_images', category: 'browser', risk: 'net', core: false, keywords: ['image', 'photo', 'download', 'picture'],
  description: 'Download images from the page open in the browser (all, or those inside a CSS `selector`), ignoring icons smaller than `min_size` px. Saved in a folder so you can use them in documents and artifacts.',
  parameters: { type: 'object', properties: { selector: { type: 'string' }, min_size: { type: 'number', description: 'Default 120' }, max: { type: 'number', description: 'Default 20' }, folder: { type: 'string' } } },
  summarize: (a) => a.selector || 'page images',
  async run(a, ctx) {
    const view = require('./browser').current();
    if (!view) throw new Error('No page is open in the browser: use browser_open first.');
    const wc = view.webContents;
    const min = Math.max(1, +a.min_size || 120), max = Math.max(1, Math.min(60, +a.max || 20));
    const list = await wc.executeJavaScript(`(() => { let root = document; ${a.selector ? `try { root = document.querySelector(${JSON.stringify(a.selector)}) || document; } catch {}` : ''}
      const out = []; const seen = new Set();
      for (const img of root.querySelectorAll('img')) { const src = img.currentSrc || img.src; if (!src || seen.has(src) || src.startsWith('data:image/svg')) continue; if ((img.naturalWidth || 0) < ${min} && (img.naturalHeight || 0) < ${min}) continue; seen.add(src); out.push({ src, alt: (img.alt || '').slice(0, 80), w: img.naturalWidth, h: img.naturalHeight }); }
      return out.slice(0, ${max}); })()`, true);
    if (!list.length) return { content: 'No image of that size on the page.' };
    const host = (() => { try { return new URL(wc.getURL()).hostname.replace(/^www\./, ''); } catch { return 'web'; } })();
    const dir = a.folder ? files.resolvePath(a.folder, ctx) : path.join(files.defaultOut(), 'Images', safe(host));
    fs.mkdirSync(dir, { recursive: true });
    if (a.folder) await files.access(path.join(dir, 'x'), ctx, true);
    const saved = [];
    for (const [i, im] of list.entries()) {
      try {
        let buf, type = '';
        if (im.src.startsWith('data:')) { const m = im.src.match(/^data:([^;,]+)[^,]*,(.*)$/); type = m[1]; buf = Buffer.from(decodeURIComponent(m[2]), /;base64/.test(im.src) ? 'base64' : 'utf8'); }
        else { const r = await wc.session.fetch(im.src, { headers: { Referer: wc.getURL() } }); if (!r.ok) continue; type = r.headers.get('content-type') || ''; buf = Buffer.from(await r.arrayBuffer()); }
        const ext = /png/.test(type) ? '.png' : /webp/.test(type) ? '.webp' : /gif/.test(type) ? '.gif' : /svg/.test(type) ? '.svg' : /avif/.test(type) ? '.avif' : '.jpg';
        const base = safe(im.alt || path.basename(new URL(im.src, 'https://x').pathname).replace(/\.[a-z0-9]+$/i, '')) || `image-${i + 1}`;
        const f = unique(dir, base, ext); fs.writeFileSync(f, buf); files.touched(ctx, f, 'created');
        saved.push(`${f} (${im.w}×${im.h})`);
      } catch {}
    }
    return { content: saved.length ? `Saved ${saved.length} image(s):\n${saved.join('\n')}` : 'The images could not be downloaded.', view: { kind: 'files', files: saved.map((x) => x.replace(/ \(\d+×\d+\)$/, '')) } };
  },
});

agent.register({
  name: 'import_files', category: 'files', risk: 'read', core: true, keywords: ['import', 'upload', 'file', 'zip', 'pdf', 'docx'],
  description: 'Ask the user to pick files on their computer (PDF, DOCX, ZIP, images, spreadsheets…). They are copied into Documents/Fabro/Imports (ZIPs are unpacked) and their text is extracted so you can work with them.',
  parameters: { type: 'object', properties: { why: { type: 'string', description: 'Shown to the user in the file picker title' }, multiple: { type: 'boolean' } } },
  summarize: (a) => a.why || 'files',
  async run(a, ctx) {
    const win = BrowserWindow.getAllWindows().find((w) => w.isVisible() && /index\.html/.test(w.webContents.getURL())) || BrowserWindow.getFocusedWindow();
    const r = await dialog.showOpenDialog(win || undefined, { title: a.why || 'Fabro', properties: ['openFile', ...(a.multiple === false ? [] : ['multiSelections'])] });
    if (r.canceled || !r.filePaths.length) return { content: 'The user did not pick any file.' };
    const dir = path.join(files.defaultOut(), 'Imports'); fs.mkdirSync(dir, { recursive: true });
    const lines = [];
    for (const src of r.filePaths.slice(0, 20)) {
      const ext = path.extname(src).toLowerCase(), base = safe(path.basename(src, ext));
      if (ext === '.zip') {
        const to = unique(dir, base, ''); fs.mkdirSync(to, { recursive: true });
        await require('extract-zip')(src, { dir: to });
        const list = []; const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else list.push(f); } }; walk(to);
        lines.push(`${src} → unpacked in ${to} (${list.length} files):\n${list.slice(0, 40).map((f) => '  ' + path.relative(to, f)).join('\n')}`);
        continue;
      }
      const f = unique(dir, base, ext); fs.copyFileSync(src, f); files.touched(ctx, f, 'created');
      let text = '';
      try { if (/\.(pdf|docx|txt|md|csv|json|html?|xml|js|ts|py|rtf|odt|pptx|xlsx)$/i.test(ext)) text = String(await require('../rag').extract(f) || ''); } catch {}
      lines.push(`${src} → ${f}${text ? `\n--- text (${text.length} chars) ---\n${text.slice(0, 4000)}${text.length > 4000 ? '\n… (use read_file for the rest)' : ''}` : ''}`);
    }
    return { content: lines.join('\n\n'), view: { kind: 'files', files: r.filePaths } };
  },
});

// ───────────────────────────── speech ─────────────────────────────
function wavParts(buf) {
  const b = Buffer.from(buf); let o = 12, fmt = null, data = null;
  while (o + 8 <= b.length) { const id = b.toString('ascii', o, o + 4), len = b.readUInt32LE(o + 4); if (id === 'fmt ') fmt = { rate: b.readUInt32LE(o + 12), ch: b.readUInt16LE(o + 10), bits: b.readUInt16LE(o + 22) }; if (id === 'data') data = b.subarray(o + 8, o + 8 + len); o += 8 + len + (len & 1); }
  return { ...fmt, data };
}
function wavFile(pcm, rate, ch = 1) {
  const h = Buffer.alloc(44); h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8); h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(ch, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * ch * 2, 28); h.writeUInt16LE(ch * 2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}
async function mp3(pcm, rate, kbps = 128) {
  const { Mp3Encoder } = await import('@breezystack/lamejs');
  const enc = new Mp3Encoder(1, rate, kbps);
  const samples = new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.length / 2));
  const out = [];
  for (let i = 0; i < samples.length; i += 1152) { const b = enc.encodeBuffer(samples.subarray(i, i + 1152)); if (b.length) out.push(Buffer.from(b)); }
  const end = enc.flush(); if (end.length) out.push(Buffer.from(end));
  return Buffer.concat(out);
}
const chunks = (text) => { const out = []; let cur = ''; for (const s of String(text).replace(/\s+/g, ' ').match(/[^.!?…;:]+[.!?…;:]*\s*/g) || []) { if ((cur + s).length > 900 && cur) { out.push(cur); cur = ''; } cur += s; } if (cur.trim()) out.push(cur); return out; };

agent.register({
  name: 'generate_speech', category: 'documents', risk: 'write', core: true, keywords: ['voice', 'audio', 'mp3', 'wav', 'speech', 'tts', 'podcast', 'narration'],
  description: 'Turn text into speech with Fabro\'s local voices (Piper) and save it as an audio file (MP3 or WAV): narrations, voice messages, podcasts, announcements. Voices: fr (Siwis f, Tom m, UPMC f), en (Amy f, Ryan m, Alba f UK, Alan m UK), es (Davefx m, Sharvard f, Ald m MX), de (Thorsten m, MLS f).',
  parameters: {
    type: 'object',
    properties: {
      text: { type: 'string' },
      voice: { type: 'string', description: 'Voice name (e.g. "Tom") or language code (fr, en, es, de). Default: the user\'s voice.' },
      format: { type: 'string', enum: ['mp3', 'wav'], description: 'Default mp3' },
      speed: { type: 'number', description: '0.5–2, default 1' },
      title: { type: 'string', description: 'File name' },
      folder: { type: 'string' },
    },
    required: ['text'],
  },
  summarize: (a) => `${a.title || String(a.text).slice(0, 40)}.${a.format || 'mp3'}`,
  async run(a, ctx) {
    const voice = require('../voice');
    let st = voice.status();
    if (!st.runtime) {
      if (!ctx.needDeps || !(await ctx.needDeps('voice'))) throw new Error('Voice is not installed (the user declined). They can install it from voice mode or Settings.');
      st = voice.status();
    }
    const want = String(a.voice || '').toLowerCase();
    const v = voice.VOICES.find((x) => x.name.toLowerCase() === want || x.id.toLowerCase() === want)
      || voice.VOICES.find((x) => x.name.toLowerCase().startsWith(want) && want)
      || (want.length === 2 ? (voice.VOICES.find((x) => x.lang === want && x.id === st.voice) || voice.VOICES.find((x) => x.lang === want)) : null);
    const id = v ? v.id : st.voice || undefined;
    const speed = a.speed ? Math.max(0.5, Math.min(2, +a.speed)) : undefined;
    const parts = []; let rate = 22050;
    for (const c of chunks(a.text).slice(0, 200)) {
      const w = wavParts(await voice.tts(c, { voice: id, speed }));
      rate = w.rate || rate; parts.push(w.data, Buffer.alloc(Math.round(rate * 0.12) * 2));
    }
    const pcm = Buffer.concat(parts);
    const fmt = a.format === 'wav' ? 'wav' : 'mp3';
    const data = fmt === 'wav' ? wavFile(pcm, rate) : await mp3(pcm, rate);
    const dir = a.folder ? files.resolvePath(a.folder, ctx) : path.join(files.defaultOut(), 'Audio');
    fs.mkdirSync(dir, { recursive: true });
    if (a.folder) await files.access(path.join(dir, 'x'), ctx, true);
    const f = unique(dir, safe(a.title || String(a.text).split(/[.!?\n]/)[0].slice(0, 40)) || 'speech', '.' + fmt);
    fs.writeFileSync(f, data); files.touched(ctx, f, 'created');
    const secs = Math.round(pcm.length / 2 / rate);
    return { content: `Saved ${f} (${secs} s, voice ${id || 'default'}).`, view: { kind: 'audio', path: f, voice: id, seconds: secs, format: fmt } };
  },
});

module.exports = { wavParts, wavFile, mp3, chunks };

// Ask the user a question when the request is vague (options + free answer). Never blocks forever:
// in unattended runs (scheduled tasks) the model is told nobody is there and must pick the most reasonable reading.
agent.register({ name: 'ask_user', category: 'core', risk: 'read', core: true,
  description: 'Ask the user a short question when the request is ambiguous or a choice is really theirs (which file, which account, which style…). Give 2-4 likely options; the user can also type their own answer. Do NOT use it when the conversation history already answers the question.',
  parameters: { type: 'object', properties: { question: { type: 'string' }, options: { type: 'array', items: { type: 'string' }, description: '2-4 short likely answers' } }, required: ['question'] },
  summarize: (a) => a.question,
  async run(a, ctx) {
    if (ctx.unattended || !ctx.ask) return { content: 'Nobody can answer right now (unattended run). Pick the most reasonable option yourself and say which one you chose.' };
    const opts = (a.options || []).map(String).filter(Boolean).slice(0, 4);
    const v = await ctx.ask({ kind: 'question', tool: 'ask_user', question: String(a.question || '').slice(0, 500), options: opts, summary: String(a.question || '') });
    if (!v || v === 'deny') return { content: 'The user skipped the question. Continue with the most reasonable choice and say which one.', view: { kind: 'answer', answer: '' } };
    return { content: `The user answered: ${v}`, view: { kind: 'answer', answer: String(v) } };
  } });

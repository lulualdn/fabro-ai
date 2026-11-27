// Seeing for real: pictures, folders of pictures, web pages and videos become one contact sheet the model looks at.
//   see_images: paths, links, a folder or a web page (rendered, long pages in slices) → one numbered sheet;
//               zoom on a number, or on a region of it, for details.
//   watch_video: a file, a link or YouTube; a time range and an interval → a sheet of timed frames. Overview first,
//               then the precise moments. YouTube: the player's storyboards (low resolution; some videos have none).
// The sheet goes to the model as an image. A model that can't see images is told so (chat.js) and must say it.
const fs = require('fs');
const path = require('path');
const agent = require('./index');

const IMG = /\.(png|jpe?g|webp|gif|bmp|avif|tiff?)$/i;
const VID = /\.(mp4|webm|mov|mkv|m4v|ogv)$/i;
const last = new Map(); // convId → [{ label, data }] of the last sheet, for zoom

async function toData(src) {
  const { nativeImage, net } = require('electron');
  if (/^data:image\//.test(src)) return src;
  if (/^https?:\/\//.test(src)) {
    const r = await net.fetch(src, { redirect: 'follow', headers: { 'User-Agent': 'Fabro/1.0 (+https://fabro.ufstudios.eu)' } }); if (!r.ok) throw new Error(`${src}: HTTP ${r.status}`);
    const type = r.headers.get('content-type') || '';
    if (/html/.test(type)) return null; // a page, not a picture
    const im = nativeImage.createFromBuffer(Buffer.from(await r.arrayBuffer())); if (im.isEmpty()) throw new Error(`${src}: not a picture this app can read`);
    return im.resize({ width: Math.min(1600, im.getSize().width) }).toDataURL();
  }
  const im = nativeImage.createFromPath(src); if (im.isEmpty()) throw new Error(`${path.basename(src)}: not a picture this app can read`);
  return im.resize({ width: Math.min(1600, im.getSize().width) }).toDataURL();
}
async function pageShots(url, slices = 3) {
  const { BrowserWindow } = require('electron');
  const w = new BrowserWindow({ show: false, width: 1280, height: 900, webPreferences: { sandbox: true, backgroundThrottling: false } });
  w.webContents.setAudioMuted(true); w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  try {
    await Promise.race([w.loadURL(url), new Promise((_, ko) => setTimeout(() => ko(new Error('page too slow')), 25000))]);
    await new Promise((r) => setTimeout(r, 1200));
    const h = await w.webContents.executeJavaScript('document.documentElement.scrollHeight').catch(() => 900);
    const out = [];
    for (let i = 0; i < Math.min(slices, Math.ceil(h / 900)); i++) {
      await w.webContents.executeJavaScript(`window.scrollTo(0, ${i * 900})`); await new Promise((r) => setTimeout(r, 350));
      out.push({ label: `page ${i + 1}`, data: (await w.webContents.capturePage()).toDataURL() });
    }
    return out;
  } finally { if (!w.isDestroyed()) w.destroy(); }
}
// one picture of many: a grid, each cell numbered with its name (or time)
async function compose(items, title = '') {
  const { BrowserWindow } = require('electron');
  const n = items.length; const cols = Math.ceil(Math.sqrt(n)); const cell = n <= 1 ? 1200 : n <= 4 ? 560 : n <= 9 ? 380 : n <= 16 ? 290 : 220;
  const rows = Math.ceil(n / cols); const W = cols * (cell + 6) + 6; const H = rows * (Math.round(cell * 0.75) + 26) + 6 + (title ? 28 : 0);
  const html = `<!doctype html><body style="margin:0;padding:3px;background:#111;color:#fff;font:600 14px system-ui">${title ? `<div style="padding:4px 4px 8px;font-weight:500">${title.replace(/</g, '&lt;')}</div>` : ''}<div style="display:grid;grid-template-columns:repeat(${cols},${cell}px);gap:6px">${items.map((x, i) => `<figure style="margin:0;background:#000"><img src="${x.data}" style="display:block;width:${cell}px;height:${Math.round(cell * 0.75)}px;object-fit:contain"><figcaption style="height:20px;padding:2px 6px;background:#222;white-space:nowrap;overflow:hidden;text-overflow:ellipsis"><span style="color:#ff5e42">${i + 1}</span> · ${String(x.label).replace(/</g, '&lt;')}</figcaption></figure>`).join('')}</div>`;
  const w = new BrowserWindow({ show: false, width: W, height: H, useContentSize: true, webPreferences: { sandbox: true } });
  try {
    await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    await new Promise((r) => setTimeout(r, 300));
    return 'data:image/jpeg;base64,' + (await w.webContents.capturePage()).toJPEG(82).toString('base64');
  } finally { if (!w.isDestroyed()) w.destroy(); }
}

agent.register({
  name: 'see_images', category: 'vision', risk: 'read', noMcpWrap: true, keywords: ['image', 'photo', 'picture', 'capture', 'screenshot', 'regarde', 'look', 'voir'],
  description: 'Look at pictures: file paths, image links, a folder of pictures or a web page (rendered and captured). Several become one sheet, each cell numbered with its name. Then zoom: { n } for one picture in full, { n, x, y, w, h } (0 to 1) for a region.',
  example: 'see_images({ items: ["C:/Photos/IMG_1.jpg", "https://example.com/a.png"] }) then see_images({ zoom: { n: 2, x: 0.5, y: 0, w: 0.5, h: 0.5 } })',
  parameters: { type: 'object', properties: {
    items: { type: 'array', items: { type: 'string' }, description: 'Paths or links (pictures or web pages)' },
    folder: { type: 'string', description: 'A folder: its pictures (30 at most)' },
    zoom: { type: 'object', description: 'On the last sheet: { n } or { n, x, y, w, h } in 0..1' } } },
  summarize: (a) => (a.zoom ? `zoom ${a.zoom.n}` : a.folder || (a.items || []).slice(0, 3).join(', ')),
  async run(a, ctx) {
    const { nativeImage } = require('electron');
    if (a.zoom) {
      const prev = last.get(ctx.convId || ''); const it = prev && prev[(Number(a.zoom.n) || 1) - 1];
      if (!it) throw new Error('No picture with this number on the last sheet. Call see_images with items first.');
      let im = nativeImage.createFromDataURL(it.data); const s = im.getSize();
      if (a.zoom.w) { const c = (v) => Math.max(0, Math.min(1, Number(v) || 0)); im = im.crop({ x: Math.round(c(a.zoom.x) * s.width), y: Math.round(c(a.zoom.y) * s.height), width: Math.max(8, Math.round(c(a.zoom.w) * s.width)), height: Math.max(8, Math.round(c(a.zoom.h) * s.height)) }); }
      const big = im.resize({ width: Math.min(1400, Math.max(im.getSize().width, 900)) });
      return { content: `Picture ${a.zoom.n} (${it.label})${a.zoom.w ? ', region' : ''}.`, image: big.toDataURL(), view: { kind: 'image', image: big.toDataURL(), title: it.label } };
    }
    let list = (a.items || []).map(String).slice(0, 30);
    if (a.folder) { const d = String(a.folder); list = list.concat(fs.readdirSync(d).filter((f) => IMG.test(f)).sort().slice(0, 30).map((f) => path.join(d, f))); }
    if (!list.length) throw new Error('Give items (paths or links) or a folder.');
    const items = []; const errors = [];
    for (const src of list.slice(0, 30)) {
      try {
        const data = await toData(src);
        if (data) items.push({ label: /^https?:/.test(src) ? src.split('/').pop().split('?')[0] || src : path.basename(src), data });
        else items.push(...(await pageShots(src)).map((x) => ({ ...x, label: `${new URL(src).hostname} ${x.label}` })));
      } catch (e) { errors.push(String(e.message || e)); }
    }
    if (!items.length) throw new Error(errors.join('; ') || 'Nothing to show.');
    last.set(ctx.convId || '', items);
    const image = await compose(items.slice(0, 30));
    return { content: `${items.length} picture(s) on one sheet, numbered 1 to ${items.length}: ${items.map((x, i) => `${i + 1}=${x.label}`).join(', ')}.${errors.length ? `\nNot shown: ${errors.join('; ')}` : ''}\nZoom with see_images({ zoom: { n } }).`, image, view: { kind: 'image', image, title: `${items.length} pictures` } };
  },
});

// frames of a local or direct video, read by Chromium itself (no ffmpeg needed)
async function videoFrames(src, times) {
  const { BrowserWindow } = require('electron');
  const url = /^https?:/.test(src) ? src : require('url').pathToFileURL(src).href;
  const w = new BrowserWindow({ show: false, width: 400, height: 300, webPreferences: { sandbox: true, webSecurity: !/^file:/.test(url), backgroundThrottling: false } });
  try {
    await w.loadURL('data:text/html,<body style="margin:0"></body>');
    return await w.webContents.executeJavaScript(`(async () => {
      const v = document.createElement('video'); v.muted = true; v.preload = 'auto'; v.crossOrigin = 'anonymous'; v.src = ${JSON.stringify(url)};
      await new Promise((ok, ko) => { v.onloadedmetadata = ok; v.onerror = () => ko(new Error('this video can not be read')); setTimeout(() => ko(new Error('video too slow to open')), 20000); });
      const c = document.createElement('canvas'); const k = Math.min(1, 640 / (v.videoWidth || 640)); c.width = Math.round((v.videoWidth || 640) * k); c.height = Math.round((v.videoHeight || 360) * k);
      const out = []; const times = ${JSON.stringify(times)}.filter((t) => t <= v.duration);
      for (const t of times) { await new Promise((ok) => { v.onseeked = ok; v.currentTime = t; setTimeout(ok, 4000); }); c.getContext('2d').drawImage(v, 0, 0, c.width, c.height); out.push({ t, data: c.toDataURL('image/jpeg', 0.8) }); }
      return { duration: v.duration, frames: out };
    })()`);
  } finally { if (!w.isDestroyed()) w.destroy(); }
}
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

agent.register({
  name: 'watch_video', category: 'vision', risk: 'read', noMcpWrap: true, keywords: ['video', 'vidéo', 'youtube', 'film', 'clip', 'regarde'],
  description: 'Watch a video: a file, a direct link or YouTube. Pick a time range (start/end in seconds) and an interval (every); frames come back as one timed sheet. Start with an overview (no range: 12 frames across the video), then look closer. For what is said, use convert_file with to: "transcript" on the file.',
  example: 'watch_video({ source: "C:/Videos/demo.mp4", start: 30, end: 40, every: 1 })',
  parameters: { type: 'object', properties: { source: { type: 'string' }, start: { type: 'number' }, end: { type: 'number' }, every: { type: 'number', description: 'Seconds between frames' }, max: { type: 'number', description: 'Frames, 16 at most' } }, required: ['source'] },
  summarize: (a) => `${a.source}${a.start != null ? ` ${a.start}-${a.end}s` : ''}`,
  async run(a) {
    const src = String(a.source); const max = Math.max(2, Math.min(16, Math.round(Number(a.max) || 12)));
    const yt = (src.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([\w-]{11})/) || [])[1];
    let frames = [], duration = 0, title = path.basename(src);
    if (yt) {
      const w = require('./webimages'); const sb = await w.storyboard(yt);
      if (!sb) throw new Error('This YouTube video gives no preview frames (private, age-restricted or blocked). Ask the user for the file.');
      duration = sb.len || 0; title = sb.title || title;
      const s = Math.max(0, Number(a.start) || 0); const e = Math.min(duration || 1e9, a.end != null ? Number(a.end) : duration);
      const step = a.every ? Math.max(1, Number(a.every)) : Math.max(1, (e - s) / max);
      for (let t = s; t <= e && frames.length < max; t += step) { const f = await w.frameAt(yt, duration ? (t / duration) * 100 : 0); if (f && f.im) frames.push({ t, data: f.im.toDataURL() }); }
    } else {
      if (!/^https?:/.test(src) && !fs.existsSync(src)) throw new Error('File not found: ' + src);
      if (!/^https?:/.test(src) && !VID.test(src)) throw new Error('Not a video file this app can read (mp4, webm, mov, mkv).');
      const probe = await videoFrames(src, [0]); duration = probe.duration || 0;
      const s = Math.max(0, Number(a.start) || 0); const e = Math.min(duration, a.end != null ? Number(a.end) : duration);
      const step = a.every ? Math.max(0.2, Number(a.every)) : Math.max(0.5, (e - s) / max);
      const times = []; for (let t = s; t <= e && times.length < max; t += step) times.push(Math.round(t * 10) / 10);
      frames = (await videoFrames(src, times)).frames;
    }
    if (!frames.length) throw new Error('No frame could be read in this range.');
    const image = await compose(frames.map((f) => ({ label: mmss(f.t), data: f.data })), `${title} · ${mmss(duration)}`);
    return { content: `${frames.length} frames of "${title}" (${mmss(duration)} long), at ${frames.map((f) => mmss(f.t)).join(', ')}.${yt ? ' YouTube preview frames are small: details may not be readable.' : ''}`, image, view: { kind: 'image', image, title } };
  },
});

module.exports = { compose };

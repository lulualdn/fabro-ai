// Real pictures of a real subject, straight from the web: an image search (DuckDuckGo, then Bing), frames of
// YouTube videos (search or a given video), the pictures of any page (og:image + its <img>), or one image URL.
// The model gets numbered URLs plus a contact sheet so it can keep only the right ones (e.g. game screenshots,
// not real-life photos) before putting them in an artifact.
const agent = require('./index');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const get = (url, opts = {}) => fetch(url, { ...opts, headers: { 'User-Agent': UA, 'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8', ...(opts.headers || {}) }, signal: AbortSignal.timeout(opts.timeout || 12000) });
const text = async (url, opts) => { const r = await get(url, opts); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); };
const unesc = (s) => String(s || '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };

async function ddg(q, n) {
  const page = await text(`https://duckduckgo.com/?q=${encodeURIComponent(q)}&iax=images&ia=images`);
  const vqd = (page.match(/vqd=["']?([\d-]+)/) || [])[1];
  if (!vqd) throw new Error('no token');
  const r = await get(`https://duckduckgo.com/i.js?l=fr-fr&o=json&q=${encodeURIComponent(q)}&vqd=${vqd}&f=,,,,,&p=1`, { headers: { Referer: 'https://duckduckgo.com/', Accept: 'application/json' } });
  const j = await r.json();
  return (j.results || []).slice(0, n * 2).map((x) => ({ url: x.image, thumb: x.thumbnail, title: x.title, page: x.url, width: x.width, height: x.height, source: host(x.url) || x.source }));
}
async function bing(q, n) {
  const html = await text(`https://www.bing.com/images/async?q=${encodeURIComponent(q)}&first=0&count=${n * 2}&adlt=moderate`);
  const out = []; const re = /\bm="(\{[^"]+\})"/g; let m;
  while ((m = re.exec(html)) && out.length < n * 2) { try { const x = JSON.parse(unesc(m[1])); if (x.murl) out.push({ url: x.murl, thumb: x.turl, title: x.t || '', page: x.purl, source: host(x.purl) }); } catch {} }
  return out;
}
async function webSearch(q, n) {
  for (const f of [ddg, bing]) { try { const r = await f(q, n); if (r.length) return r; } catch {} }
  return [];
}

const ytId = (u) => (String(u).match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([\w-]{11})/) || [])[1];
// YouTube keeps a cover and three frames (at ¼, ½, ¾ of the video) for every video.
const ytFrames = (id, title = '') => [
  { url: `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`, alt: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, what: 'cover' },
  ...[1, 2, 3].map((k) => ({ url: `https://i.ytimg.com/vi/${id}/maxres${k}.jpg`, alt: `https://i.ytimg.com/vi/${id}/hq${k}.jpg`, what: `frame ${k * 25}%` })),
].map((f) => ({ ...f, thumb: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`, title: `${title ? title + ' — ' : ''}${f.what}`, page: `https://www.youtube.com/watch?v=${id}`, source: 'YouTube' }));
async function ytSearch(q, nVideos) {
  const html = await text(`https://www.youtube.com/results?search_query=${encodeURIComponent(q)}&hl=fr`);
  const vids = []; const re = /"videoRenderer":\{"videoId":"([\w-]{11})"[\s\S]{0,1500}?"title":\{"runs":\[\{"text":"((?:[^"\\]|\\.)*)"/g; let m;
  while ((m = re.exec(html)) && vids.length < nVideos) if (!vids.some((v) => v.id === m[1])) { let t = m[2]; try { t = JSON.parse(`"${t}"`); } catch {} vids.push({ id: m[1], title: t }); }
  return vids;
}

// Any moment of a video: YouTube's storyboards (the preview strip shown when hovering the progress bar) are
// sprite sheets covering the whole video; one tile = one moment (up to 320×180).
const sbCache = new Map();
async function storyboard(id) {
  if (sbCache.has(id)) return sbCache.get(id);
  let spec = null, len = 0, title = '';
  try {
    const h = await text(`https://www.youtube.com/watch?v=${id}&hl=en`);
    spec = JSON.parse(`"${(h.match(/"playerStoryboardSpecRenderer":\{"spec":"((?:[^"\\]|\\.)*)"/) || [])[1] || ''}"`) || null;
    len = +((h.match(/"lengthSeconds":"(\d+)"/) || [])[1] || 0); title = unesc((h.match(/<title>([^<]*)<\/title>/) || [])[1] || '').replace(/ - YouTube$/, '');
  } catch {}
  if (!spec) {
    try {
      const r = await get('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ videoId: id, context: { client: { clientName: 'WEB', clientVersion: '2.20240726.00.00', hl: 'en' } } }) });
      const j = await r.json(); spec = (((j.storyboards || {}).playerStoryboardSpecRenderer) || {}).spec || null; len = +((j.videoDetails || {}).lengthSeconds || 0); title = (j.videoDetails || {}).title || '';
    } catch {}
  }
  if (!spec) { sbCache.set(id, null); return null; }
  const [base, ...lv] = spec.split('|');
  const levels = lv.map((l, i) => { const [w, h, count, cols, rows, , name, sigh] = l.split('#'); return { i, w: +w, h: +h, count: +count, cols: +cols, rows: +rows, name, sigh }; }).filter((l) => l.count > 0 && l.cols > 0);
  const best = levels.sort((a, b) => b.w - a.w)[0];
  const sb = best ? { ...best, base, len, title } : null;
  sbCache.set(id, sb); return sb;
}
const sheetCache = new Map();
async function frameAt(id, pct) {
  const sb = await storyboard(id); if (!sb) return null;
  const k = Math.max(0, Math.min(sb.count - 1, Math.round((pct / 100) * (sb.count - 1))));
  const per = sb.cols * sb.rows, sheetN = Math.floor(k / per), pos = k % per;
  const url = sb.base.replace('$L', sb.i).replace('$N', sb.name.replace('$M', sheetN)) + (sb.sigh ? `${sb.base.includes('?') ? '&' : '?'}sigh=${encodeURIComponent(sb.sigh)}` : '');
  let im = sheetCache.get(url);
  if (!im) { const p = await probe(url); if (!p || !p.im) return null; im = p.im; sheetCache.set(url, im); if (sheetCache.size > 40) sheetCache.delete(sheetCache.keys().next().value); }
  const size = im.getSize(), tw = Math.floor(size.width / sb.cols), th = Math.floor(size.height / sb.rows);
  const crop = im.crop({ x: (pos % sb.cols) * tw, y: Math.floor(pos / sb.cols) * th, width: tw, height: th });
  const sec = sb.len ? Math.round((pct / 100) * sb.len) : null;
  return { url: saveImg(crop.toJPEG(90)), im: crop, w: tw, h: th, title: `${sb.title || 'video'} — ${pct}%${sec != null ? ` (${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')})` : ''}`, page: `https://www.youtube.com/watch?v=${id}${sec ? `&t=${sec}s` : ''}`, source: 'YouTube', label: `${pct}%` };
}
const { saveImg } = require('../kit');

async function pageImages(url, n) {
  const html = await text(url);
  const abs = (u) => { try { return new URL(unesc(u), url).href; } catch { return null; } };
  const title = unesc((html.match(/<title[^>]*>([^<]{0,140})/i) || [])[1] || '').trim();
  const out = [], seen = new Set();
  const add = (u, why) => { const a = abs(u); if (!a || seen.has(a) || !/^https?:/.test(a) || /\.svg(\?|$)|sprite|favicon|logo-?\d*x\d*|pixel|tracking|1x1|spacer|avatar/i.test(a)) return; seen.add(a); out.push({ url: a, title: `${title}${why ? ' — ' + why : ''}`, page: url, source: host(url) }); };
  for (const m of html.matchAll(/<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image)(?::src)?["'][^>]*content=["']([^"']+)/gi)) add(m[1], 'page cover');
  for (const m of html.matchAll(/<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["'](?:og:image|twitter:image)["']/gi)) add(m[1], 'page cover');
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0];
    const srcset = (tag.match(/\b(?:data-)?srcset=["']([^"']+)/i) || [])[1];
    const best = srcset ? srcset.split(',').map((s) => s.trim().split(/\s+/)).sort((a, b) => (parseInt(b[1]) || 0) - (parseInt(a[1]) || 0))[0][0] : null;
    const src = best || (tag.match(/\b(?:data-src|data-original|data-lazy-src|src)=["']([^"']+)/i) || [])[1];
    const w = +(tag.match(/\bwidth=["']?(\d+)/i) || [])[1] || 0;
    if (src && !/^data:/.test(src) && (!w || w >= 200)) add(src, unesc((tag.match(/\balt=["']([^"']{1,80})/i) || [])[1] || ''));
    if (out.length >= n * 3) break;
  }
  // YouTube videos embedded in the page: their frames too
  for (const m of html.matchAll(/(?:youtube(?:-nocookie)?\.com\/embed\/|youtu\.be\/|youtube\.com\/watch\?v=)([\w-]{11})/g)) if (!out.some((x) => x.url.includes(m[1]))) out.push(...ytFrames(m[1], title).slice(0, 2));
  return out;
}

// Does it load as a real picture (and how big)? Downloads it once; the bytes feed the contact sheet.
async function probe(url) {
  try {
    const r = await get(url, { timeout: 8000, headers: { Accept: 'image/avif,image/webp,image/*,*/*;q=0.8' } });
    if (!r.ok || !/^image\//.test(r.headers.get('content-type') || '')) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length < 2500 || buf.length > 25e6) return null;
    const { nativeImage } = require('electron');
    const im = nativeImage.createFromBuffer(buf); if (im.isEmpty()) return { buf, w: 0, h: 0 };
    const s = im.getSize();
    if (s.width === 120 && s.height === 90) return null; // YouTube's "no such picture" placeholder
    return { buf, im, w: s.width, h: s.height };
  } catch { return null; }
}

async function sheet(items) {
  const { BrowserWindow } = require('electron');
  const cell = 240, cols = Math.min(4, items.length), rows = Math.ceil(items.length / cols), W = cols * (cell + 8) + 8, H = rows * (cell * 0.62 + 30) + 8;
  const html = `<!doctype html><body style="margin:0;padding:4px;background:#1e2024;font:13px system-ui;color:#fff;display:grid;grid-template-columns:repeat(${cols},${cell}px);gap:8px">${items.map((x, i) => `<figure style="margin:0"><img src="${x.data}" style="width:${cell}px;height:${Math.round(cell * 0.62)}px;object-fit:cover;display:block;background:#333"><figcaption style="padding:3px 2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis"><b>${i + 1}</b> · ${String(x.source || '').replace(/</g, '')}</figcaption></figure>`).join('')}</body>`;
  const w = new BrowserWindow({ show: false, width: W, height: Math.round(H), useContentSize: true, webPreferences: { sandbox: true } });
  try {
    await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    await new Promise((r) => setTimeout(r, 250));
    return 'data:image/jpeg;base64,' + (await w.webContents.capturePage()).toJPEG(76).toString('base64');
  } finally { w.destroy(); }
}

async function videoFrames({ query, url, at, block }) {
  let id = url && ytId(url);
  if (!id && query) { const v = await ytSearch(query, 1).catch(() => []); id = v[0] && v[0].id; }
  if (!id) return { list: [], error: 'No YouTube video: give a video url (or a query that finds one).' };
  const pcts = [...new Set((Array.isArray(at) && at.length ? at : Array.from({ length: 10 }, (_, j) => (Math.max(1, Math.min(10, block | 0 || 1)) - 1) * 10 + j)).map((p) => Math.max(0, Math.min(100, +p || 0))))].slice(0, 20);
  const list = [];
  for (const p of pcts) { const f = await frameAt(id, p).catch(() => null); if (f && !list.some((x) => x.url === f.url)) list.push(f); } // short videos: neighbouring % can be the same frame
  if (!list.length) return { list: [], error: 'YouTube did not give this video’s frames (blocked or unavailable). The cover and the 25/50/75% pictures are still available without at/block.' };
  return { list, sb: sbCache.get(id) };
}

// Is this picture about the subject? Judged on what its source says about it (page title, alt text, video
// title, address): the words of the query must be there, and none of the words to avoid.
const STOP = new Set('the and for with from that this les des une un le la de du et en au aux pour sur dans par avec jeu game gameplay video vidéo image images photo photos picture pictures screenshot screenshots capture captures official officiel trailer'.split(' '));
const PLATFORMS = new Set('roblox minecraft fortnite youtube steam xbox playstation ps4 ps5 switch nintendo android ios pc mobile app'.split(' '));
const norm = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const stem = (w) => (w.length > 3 ? w.replace(/(es|s|x)$/, '') : w); // transports ≈ transport, jeux ≈ jeu
const keyWords = (q) => [...new Set(norm(q).split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !STOP.has(w)))];
function relevance(c, keys, avoid) {
  const hay = norm(`${c.title} ${c.page} ${c.url} ${c.source}`);
  if (avoid.some((w) => hay.includes(w))) return -1;
  if (!keys.length) return 1;
  // the name must be there as a name (all its words, together, in order), not scattered: "Paris Transports RER" ≠ "Paris Metro + RER"
  const name = keys.filter((w) => !PLATFORMS.has(w)).map(stem); if (!name.length) return 1;
  const flat = ` ${hay.split(/[^a-z0-9]+/).filter(Boolean).map(stem).join(' ')} `;
  if (flat.includes(` ${name.join(' ')} `)) return 1;
  return 0.5 * name.filter((w) => flat.includes(` ${w} `)).length / name.length;
}

async function find({ query, url, source = 'all', count = 8, at, block, avoid }) {
  const n = Math.max(1, Math.min(16, count | 0 || 8));
  if ((Array.isArray(at) && at.length) || block) {
    const r = await videoFrames({ query, url, at, block });
    let image = null; try { if (r.list.length) image = await sheet(r.list.map((x) => ({ source: x.label, data: x.im.resize({ width: 320 }).toDataURL() }))); } catch {}
    return { list: r.list.map(({ im, ...x }) => x), image, error: r.error, sb: r.sb };
  }
  let cands = [];
  if (url) {
    const id = ytId(url);
    if (id) cands = ytFrames(id).map((c) => ({ ...c, given: true }));
    else if (/\.(jpe?g|png|webp|gif|avif)(\?|$)/i.test(url)) cands = [{ url, title: '', page: url, source: host(url), given: true }];
    else cands = (await pageImages(url, n).catch(() => [])).map((c) => ({ ...c, given: true }));
    if (!cands.length && !id) { const p = await probe(url); if (p) cands = [{ url, title: '', page: url, source: host(url) }]; }
  }
  if (query) {
    const wantYt = source === 'youtube' || source === 'all', wantWeb = source === 'web' || source === 'all';
    const [web, vids] = await Promise.all([wantWeb ? webSearch(query, n) : [], wantYt ? ytSearch(query, source === 'youtube' ? Math.ceil(n / 3) + 2 : 5).catch(() => []) : []]);
    const yt = vids.flatMap((v) => ytFrames(v.id, v.title));
    // interleave so both kinds show up
    const a = [...web], b = [...yt]; while (a.length || b.length) { if (a.length) cands.push(a.shift()); if (b.length) cands.push(b.shift()); if (a.length) cands.push(a.shift()); }
  }
  // keep what is about the subject, best first (a page/video the user gave is trusted as is)
  const keys = query ? keyWords(query) : [], av = (Array.isArray(avoid) ? avoid : String(avoid || '').split(',')).map(norm).map((w) => w.trim()).filter(Boolean);
  if (query || av.length) {
    const scored = cands.map((c, i) => ({ c, i, r: c.given ? 1 : relevance(c, keys, av) })).filter((x) => x.r >= 0);
    const good = scored.filter((x) => x.r >= 0.6);
    // only exact matches when there are some
    cands = (good.length ? good : scored.filter((x) => x.r >= 0.4)).sort((a, b) => b.r - a.r || a.i - b.i).map((x) => ({ ...x.c, match: x.r }));
  }
  const ok = [];
  for (let i = 0; i < cands.length && ok.length < n; i += 6) {
    const batch = await Promise.all(cands.slice(i, i + 6).map(async (c) => {
      let p = await probe(c.url), u = c.url;
      if (!p && c.alt) { p = await probe(c.alt); u = c.alt; }
      if (!p && c.thumb) { p = await probe(c.thumb); u = c.thumb; } // the search engine's own copy always loads
      if (!p || (p.w && p.w < 200)) return null;
      const id = saveImg(p.buf); // kept by Fabro: shown as base64 in the page, never a broken link
      return id ? { ...c, url: id, origin: u, w: p.w, h: p.h, im: p.im } : null;
    }));
    for (const x of batch) if (x && ok.length < n && !ok.some((o) => o.url === x.url)) ok.push(x);
  }
  let image = null;
  try { if (ok.length) image = await sheet(ok.map((x) => ({ source: x.source, data: x.im ? x.im.resize({ width: 320 }).toDataURL() : x.url }))); } catch {}
  return { list: ok.map(({ im, ...x }) => x), image };
}

agent.register({
  name: 'web_images', category: 'design', risk: 'net', core: true,
  keywords: ['image', 'photo', 'capture', 'screenshot', 'youtube', 'vidéo', 'video', 'jeu', 'game', 'logo', 'affiche', 'poster', 'illustr'],
  description: 'Real pictures of a real subject from the web: an image search (like Google Images), frames of YouTube videos (search or one video URL: cover + frames at 25/50/75%; or any moment with at=[%] or block=1..10 of 10 frames), all pictures of a web page, or one image URL. Returns numbered, checked URLs + a contact sheet to look at. Use it on your own initiative whenever a page/document is about a specific game, product, place, person, brand, film… — and only keep the pictures that really show it.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'What to search, as a person would type it (any language), e.g. "Paris Transports RER roblox gameplay"' },
      url: { type: 'string', description: 'Optional: a YouTube video, a web page or an image URL to take pictures from' },
      source: { type: 'string', enum: ['all', 'web', 'youtube'], description: 'Default all. youtube = frames of matching videos (good for games, events, tutorials)' },
      count: { type: 'number', description: 'How many pictures (default 8, max 16)' },
      avoid: { type: 'string', description: 'Comma-separated words: drop pictures whose source mentions them (e.g. "irl, real life, vraie vie, photo réelle" when only in-game pictures are wanted)' },
      at: { type: 'array', items: { type: 'number' }, description: 'Frames of ONE YouTube video (url, or the first video found for query) at these positions in % of the video, e.g. [5, 40, 72] (max 20)' },
      block: { type: 'number', description: 'Or a block of 10 frames of ONE video: 1 = 0-9%, 2 = 10-19% … 10 = 90-99%. For a long, detailed video you can go through all 10 blocks (100 frames) to find the best moments.' },
    },
  },
  summarize: (a) => a.url || `${a.query}${a.source && a.source !== 'all' ? ' · ' + a.source : ''}`,
  async run(a) {
    if (!a.query && !a.url) return { error: 'Give a query or a url.' };
    const { list, image, error, sb } = await find(a);
    if (error && !list.length) return { error };
    if (sb) return { content: `${list.length} frame(s) of “${sb.title || 'the video'}”${sb.len ? ` (${Math.floor(sb.len / 60)} min ${sb.len % 60} s)` : ''}, ${list[0].w}×${list[0].h} each (small: fine for galleries, cards and thumbnails; for a big hero prefer the cover or 25/50/75% pictures, 1280×720):\n${list.map((p, i) => `${i + 1}. ${p.url} · ${p.title.split(' — ').pop()}`).join('\n')}\n\nLook at the contact sheet, keep the best moments, use them as <img src="fabro-img:…" alt="…" data-credit="YouTube"> (exact URLs). Other moments: at=[…] or another block.`, image: image || undefined };
    if (!list.length) return { content: `No picture found for ${a.url || `“${a.query}”`} (offline, or nothing usable). Try other words, source "youtube", or a page URL you found with web search.` };
    const lines = list.map((p, i) => `${i + 1}. ${p.url} — ${p.w ? `${p.w}×${p.h}` : 'size ?'}\n   shows (according to its source): ${p.title ? `“${String(p.title).slice(0, 110)}”` : '(no description)'}${p.match != null && p.match < 1 && !p.given ? ' — partly matches the search' : ''}\n   from: ${p.page || p.origin}`);
    return {
      content: `${lines.join('\n')}\n\nThe pictures are saved by Fabro (fabro-img:… = the picture itself, shown as base64 in the page — never a broken link). Choose with care: use a picture only if what it shows (above, and on the contact sheet if you can see images) matches exactly the place in the page where you put it; drop anything off-topic or not wanted (e.g. real-life photos). Write in alt what the picture shows. Use <img src="fabro-img:…" alt="…" data-credit="SOURCE"> (or style="--img:url('fabro-img:…')" on a .hero.image), with the exact ids.`,
      image: image || undefined,
    };
  },
});

module.exports = { find, ytFrames, pageImages, storyboard, frameAt, _sb: sbCache };

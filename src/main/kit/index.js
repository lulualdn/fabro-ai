// Fabro Kit, computer side: puts the design system into the artifacts that use it, and "bakes" what needs the
// network once, when an artifact is saved (icons that aren't bundled, real photos for <img data-photo="…">),
// so the page then works offline and looks the same everywhere (viewer, phone, exported HTML, PDF).
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
let CSS = null, JS = null, ICONS = null;
const read = () => {
  if (!CSS) CSS = fs.readFileSync(path.join(DIR, 'kit.css'), 'utf8');
  if (!JS) JS = fs.readFileSync(path.join(DIR, 'kit.js'), 'utf8');
  if (!ICONS) { // the app's own icon set (Heroicons + Phosphor), already in the renderer
    const src = fs.readFileSync(path.join(DIR, '..', '..', 'renderer', 'icons-data.js'), 'utf8');
    ICONS = JSON.parse(src.slice(src.indexOf('{'), src.lastIndexOf('}') + 1));
  }
};
// A few icons pages often need that the app's set lacks (Lucide, ISC), so they work offline too.
const L = (d) => ['0 0 24 24', `<g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</g>`];
const BUILTIN = {
  mail: L('<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>'),
  heart: L('<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>'),
  menu: L('<path d="M4 6h16M4 12h16M4 18h16"/>'),
  cart: L('<circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/>'),
  tag: L('<path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/>'),
  music: L('<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>'),
  coffee: L('<path d="M10 2v2M14 2v2M16 8a1 1 0 0 1 1 1v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1h14a4 4 0 1 1 0 8h-1M6 2v2"/>'),
  gift: L('<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7M7.5 8a2.5 2.5 0 0 1 0-5A4.8 8 0 0 1 12 8a4.8 8 0 0 1 4.5-5 2.5 2.5 0 0 1 0 5"/>'),
  smile: L('<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01"/>'),
  award: L('<circle cx="12" cy="8" r="6"/><path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11"/>'),
  target: L('<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>'),
  truck: L('<path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2M15 18H9M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/>'),
  'credit-card': L('<rect width="20" height="14" x="2" y="5" rx="2"/><path d="M2 10h20"/>'),
  leaf: L('<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/>'),
  sparkles: L('<path d="M9.94 14.06 4 20M12 2l1.8 4.2L18 8l-4.2 1.8L12 14l-1.8-4.2L6 8l4.2-1.8z"/>'),
  'thumbs-up': L('<path d="M7 10v12M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z"/>'),
};
const THEMES = ['fabro', 'ocean', 'forest', 'sunset', 'midnight', 'luxe', 'mono', 'candy', 'paper', 'tech', 'corporate'];

// Names models guess → bundled icons.
const ALIAS = { email: 'mail', envelope: 'mail', 'arrow-right': 'right', arrow: 'right', 'chevron-right': 'right', 'chevron-down': 'down', close: 'x', gear: 'settings', location: 'pin', 'map-pin': 'pin', clock: 'calendar', time: 'calendar', photo: 'image', picture: 'image', document: 'file', doc: 'file', graph: 'chart', money: 'chart', growth: 'chart', idea: 'bulb', lightbulb: 'bulb', security: 'shield', fast: 'zap', speed: 'zap', bolt: 'zap', lightning: 'zap', team: 'user', users: 'user', person: 'user', call: 'phone', house: 'home', world: 'globe', web: 'globe', launch: 'rocket', 'check-circle': 'success', ok: 'success', alert: 'warning', learn: 'book', music: 'waveform', message: 'chat', database: 'server', tools: 'wrench', magic: 'sparkle', ai: 'sparkle', package: 'box', basket: 'cart', shop: 'cart', shopping: 'cart', price: 'tag', gift: 'gift', trophy: 'award', goal: 'target', delivery: 'truck', card: 'credit-card', payment: 'credit-card', happy: 'smile', like: 'thumbs-up', love: 'heart', robot: 'agent', science: 'flask', pen: 'edit', pencil: 'edit' };

// Does this page use the kit? (a theme, a document/deck body, or the kit's classes). Pages with their own
// complete design are left exactly as written.
const KIT_CLASSES = /class\s*=\s*["'][^"']*\b(hero|section|container|card|btn|nav|grid-[234]|split|stats|pricing|eyebrow|lead|cta|feature|faq|timeline|steps|testimonial|kpi|callout)\b/i;
function usesKit(html) {
  const s = String(html || '');
  if (/<meta[^>]+name=["']fabro-kit["'][^>]+content=["']none/i.test(s)) return false;
  return /\bdata-theme\s*=/.test(s) || /<body[^>]*class\s*=\s*["'][^"']*\b(doc|deck)\b/i.test(s) || /data-(chart|icon|photo)=/.test(s) || KIT_CLASSES.test(s);
}

// ── icons ──
const iconCacheFile = () => { try { return path.join(require('electron').app.getPath('userData'), 'kit-icons.json'); } catch { return null; } };
let extra = null;
function extraIcons() { if (extra) return extra; try { extra = JSON.parse(fs.readFileSync(iconCacheFile(), 'utf8')); } catch { extra = {}; } return extra; }
function iconNames(html) { return [...new Set([...String(html).matchAll(/data-icon\s*=\s*["']([\w-]+)["']/g)].map((m) => m[1].toLowerCase()))]; }
function iconFor(n) { read(); return ICONS[n] || BUILTIN[n] || ICONS[ALIAS[n]] || BUILTIN[ALIAS[n]] || extraIcons()[n] || null; }
async function fetchIcons(names) {
  const missing = names.filter((n) => !iconFor(n)); if (!missing.length) return 0;
  let got = 0;
  for (const set of ['lucide', 'tabler', 'mdi']) {
    const want = missing.filter((n) => !extraIcons()[n]); if (!want.length) break;
    try {
      const r = await fetch(`https://api.iconify.design/${set}.json?icons=${want.map(encodeURIComponent).join(',')}`, { signal: AbortSignal.timeout(6000) });
      if (!r.ok) continue; const j = await r.json();
      for (const [n, ic] of Object.entries(j.icons || {})) { extra[n] = [`0 0 ${ic.width || j.width || 24} ${ic.height || j.height || 24}`, ic.body]; got++; }
    } catch {}
  }
  if (got) { try { fs.writeFileSync(iconCacheFile(), JSON.stringify(extra)); } catch {} }
  return got;
}

// ── photos: <img data-photo="cozy coffee shop"> / <section data-photo="…" class="hero image"> ──
const photoCache = new Map(); // query → [{ url, credit }]
// Too precise a query finds nothing: try it, then shorter versions (first words carry the subject).
async function searchPhotos(q, n = 8) {
  const words = String(q).trim().split(/\s+/).filter(Boolean);
  const tries = [...new Set([words.join(' '), words.slice(0, 3).join(' '), words.slice(0, 2).join(' '), words.slice(-2).join(' '), words[0]].filter(Boolean))];
  for (const t of tries) { const r = await searchOnce(t, n); if (r.length >= 2 || (r.length && t === tries[tries.length - 1])) return r; }
  return [];
}
const LIC = (l, v) => { l = String(l || '').toLowerCase(); return l === 'cc0' ? 'CC0' : l === 'pdm' ? 'public domain' : `CC ${l.toUpperCase()}${v ? ' ' + v : ''}`; };
// Photo providers, best first: Pexels / Unsplash when the user added a free key (real stock photos), then
// Openverse (openly licensed: Flickr, StockSnap, Rawpixel, Wikimedia), then Wikimedia Commons.
const UA = { 'User-Agent': 'Fabro (https://fabro.ufstudios.eu)' };
const designKeys = () => { try { return (require('../store').getSettings().design) || {}; } catch { return {}; } };
const photoFile = () => { try { return path.join(require('electron').app.getPath('userData'), 'kit-photos.json'); } catch { return null; } };
let diskPhotos = null;
function disk() { if (diskPhotos) return diskPhotos; try { diskPhotos = JSON.parse(fs.readFileSync(photoFile(), 'utf8')); } catch { diskPhotos = {}; } return diskPhotos; }
function saveDisk() { try { const d = disk(); const keys = Object.keys(d); if (keys.length > 800) for (const k of keys.slice(0, keys.length - 800)) delete d[k]; fs.writeFileSync(photoFile(), JSON.stringify(d)); } catch {} }
const getJson = async (url, headers = {}, tries = 2) => {
  for (let i = 0; i < tries; i++) {
    const r = await fetch(url, { headers: { ...UA, ...headers }, signal: AbortSignal.timeout(9000) });
    if (r.status === 429 && i < tries - 1) { await new Promise((res) => setTimeout(res, 2500)); continue; }
    return r.ok ? r.json() : null;
  }
  return null;
};
const wikiThumb = (u, w) => { const m = String(u).match(/^(https:\/\/upload\.wikimedia\.org\/wikipedia\/commons)\/(\w\/\w\w)\/([^/?#]+)/); return m && (!w || w > 1600) ? `${m[1]}/thumb/${m[2]}/${m[3]}/1600px-${m[3]}` : String(u).replace(/\?.*$/, ''); };
async function searchOnce(q, n) {
  const key = q.toLowerCase().trim(); if (photoCache.has(key)) return photoCache.get(key);
  const hit = disk()[key]; if (hit && Date.now() - hit.at < 30 * 86400000) { photoCache.set(key, hit.list); return hit.list; }
  const words = key.split(/\s+/).filter((w) => w.length > 2);
  const rel = (text) => words.filter((w) => String(text || '').toLowerCase().includes(w)).length;
  const keys = designKeys(); let out = [];
  try {
    if (keys.pexelsKey) {
      const j = await getJson(`https://api.pexels.com/v1/search?query=${encodeURIComponent(q)}&per_page=${n + 2}&orientation=landscape`, { Authorization: keys.pexelsKey });
      out = ((j && j.photos) || []).map((x) => ({ url: x.src.large2x || x.src.large, width: x.width, height: x.height, title: x.alt || '', credit: `${x.photographer} · Pexels`, page: x.url }));
    }
    if (!out.length && keys.unsplashKey) {
      const j = await getJson(`https://api.unsplash.com/search/photos?query=${encodeURIComponent(q)}&per_page=${n + 2}&orientation=landscape&content_filter=high`, { Authorization: `Client-ID ${keys.unsplashKey}` });
      out = ((j && j.results) || []).map((x) => ({ url: x.urls.regular, width: x.width, height: x.height, title: x.alt_description || '', credit: `${x.user && x.user.name} · Unsplash`, page: x.links && x.links.html }));
    }
    if (!out.length) {
      const j = await getJson(`https://api.openverse.org/v1/images/?q=${encodeURIComponent(q)}&page_size=${n + 8}&license_type=commercial&mature=false&source=stocksnap,rawpixel,flickr,nappy,wikimedia`);
      out = ((j && j.results) || []).filter((x) => x.url && (!x.width || x.width >= 640) && !/\.(svg|gif|tiff?)(\?|$)/i.test(x.url))
        .map((x, i) => ({ x, i, s: rel(`${x.title} ${(x.tags || []).map((t) => t.name).join(' ')}`) + (/stocksnap|rawpixel/.test(x.source) ? 1 : 0) }))
        .sort((a, b) => b.s - a.s || a.i - b.i).map(({ x }) => ({ url: x.source === 'wikimedia' ? wikiThumb(x.url, x.width) : x.url, width: x.width, height: x.height, title: x.title || '', credit: `${x.creator || 'unknown'} · ${LIC(x.license, x.license_version)}`, page: x.foreign_landing_url || '' }));
    }
    if (!out.length) {
      const j = await getJson(`https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6&gsrlimit=${n + 4}&gsrsearch=${encodeURIComponent(q + ' filetype:bitmap')}&prop=imageinfo&iiprop=url|extmetadata|size&iiurlwidth=1600&origin=*`);
      out = Object.values(((j && j.query) || {}).pages || {}).map((p) => (p.imageinfo || [])[0]).filter((ii) => ii && (ii.thumburl || ii.url) && (ii.width || 0) >= 640)
        .map((ii) => { const m = ii.extmetadata || {}; const who = String((m.Artist || {}).value || 'Wikimedia Commons').replace(/<[^>]+>/g, '').trim().slice(0, 60); return { url: ii.thumburl || ii.url, width: ii.thumbwidth || ii.width, height: ii.thumbheight || ii.height, title: '', credit: `${who} · ${String((m.LicenseShortName || {}).value || 'Wikimedia Commons')}`, page: ii.descriptionurl || '' }; });
    }
  } catch {}
  // keep only pictures that really load as images (some hosts are gone, rate-limit or block hotlinking)
  const ok = [];
  for (const p of out) {
    if (ok.length >= n) break;
    try { const r = await fetch(p.url, { headers: { Range: 'bytes=0-2047', 'User-Agent': 'Mozilla/5.0 Fabro' }, signal: AbortSignal.timeout(5000) }); if ((r.ok || r.status === 206) && /^image\//.test(r.headers.get('content-type') || '')) ok.push(p); try { r.body && r.body.cancel(); } catch {} } catch {}
  }
  if (ok.length) { photoCache.set(key, ok); disk()[key] = { at: Date.now(), list: ok }; saveDisk(); }
  return ok;
}
async function bakePhotos(html) {
  let s = String(html);
  const used = new Map(); // query → how many already used (different photos for the same query)
  const re = /<([a-z][\w-]*)\b([^>]*?)\bdata-photo\s*=\s*"([^"]{2,120})"([^>]*)>/gi;
  const jobs = []; let m;
  while ((m = re.exec(s))) jobs.push({ whole: m[0], tag: m[1].toLowerCase(), q: m[3], attrs: m[2] + m[4] });
  let n = 0;
  for (const j of jobs) {
    if (j.tag === 'img' && /\bsrc\s*=\s*"(?!\s*")[^"]+"/i.test(j.attrs)) continue; // already has a picture
    if (j.tag !== 'img' && /--img\s*:/.test(j.attrs)) continue;
    const list = await searchPhotos(j.q); if (!list.length) continue;
    const k = used.get(j.q.toLowerCase()) || 0; used.set(j.q.toLowerCase(), k + 1);
    const p = list[k % list.length];
    const credit = ` data-credit="${p.credit.replace(/"/g, '&quot;')}"`;
    let rep;
    if (j.tag === 'img') rep = j.whole.replace(/\s+src\s*=\s*"\s*"/i, '').replace(/^<img/i, `<img src="${p.url}"${credit}`);
    else rep = /\bstyle\s*=\s*"/i.test(j.whole) ? j.whole.replace(/\bstyle\s*=\s*"/i, `style="--img:url('${p.url}');`).replace(/>$/, `${credit}>`) : j.whole.replace(/>$/, ` style="--img:url('${p.url}')"${credit}>`);
    s = s.replace(j.whole, rep); n++;
  }
  return { html: s, photos: n };
}

// Network part, once, when an artifact is saved: extra icons + photos.
async function bake(html) {
  const s = String(html || '');
  if (!usesKit(s) && !/data-photo=/.test(s)) return { html: s, photos: 0, icons: 0 };
  const icons = await fetchIcons(iconNames(s)).catch(() => 0);
  const { html: out, photos } = /data-photo=/.test(s) ? await bakePhotos(s).catch(() => ({ html: s, photos: 0 })) : { html: s, photos: 0 };
  return { html: out, photos, icons };
}

// Offline part, every time the page is shown or exported: kit CSS + the icons it uses + kit runtime.
function inject(html, { force = false, mode = null, theme = null, markOnly = false } = {}) {
  let s = String(html || '');
  if (/id=["']fabro-kit["']/.test(s)) return s;
  if (!force && !usesKit(s)) return s;
  read();
  if (!/<html[\s>]/i.test(s)) s = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>${s}</body></html>`;
  if (!/<head[\s>]/i.test(s)) s = s.replace(/<html([^>]*)>/i, '<html$1><head></head>');
  if (!/<body[\s>]/i.test(s)) s = s.replace(/<\/head>/i, '</head><body>') + '</body>';
  if (mode === 'doc' && !/<body[^>]*class\s*=\s*["'][^"']*\bdoc\b/i.test(s)) s = s.replace(/<body([^>]*)>/i, (m, a) => /class\s*=/.test(a) ? `<body${a.replace(/class\s*=\s*(["'])/, 'class=$1doc ')}>` : `<body class="doc"${a}>`);
  if (mode === 'deck' && !/<body[^>]*class\s*=\s*["'][^"']*\bdeck\b/i.test(s)) s = s.replace(/<body([^>]*)>/i, (m, a) => /class\s*=/.test(a) ? `<body${a.replace(/class\s*=\s*(["'])/, 'class=$1deck ')}>` : `<body class="deck"${a}>`);
  if (!/data-theme\s*=/.test(s)) s = s.replace(/<body([^>]*)>/i, `<body$1 data-theme="${THEMES.includes(theme) ? theme : 'fabro'}">`);
  if (!/<meta[^>]+viewport/i.test(s)) s = s.replace(/<head([^>]*)>/i, '<head$1><meta name="viewport" content="width=device-width, initial-scale=1">');
  if (markOnly) return s; // source kept clean (classes/theme only): CSS + runtime are added when the page is shown or printed
  const icons = {}; for (const n of iconNames(s)) { const d = iconFor(n); if (d) icons[n] = d; }
  const head = `<style id="fabro-kit">${CSS}</style>`;
  const tail = `<script id="fabro-kit-js">window.__FK_ICONS=${JSON.stringify(icons).replace(/</g, '\\u003c')};${JS}</script>`;
  s = s.replace(/<head([^>]*)>/i, `<head$1>${head}`); // first in <head>: the page's own CSS comes after and wins
  s = /<\/body>/i.test(s) ? s.replace(/<\/body>(?![\s\S]*<\/body>)/i, `${tail}</body>`) : s + tail;
  return s;
}

module.exports = { inject, bake, usesKit, searchPhotos, fetchIcons, iconNames, THEMES, ALIAS, _read: () => { read(); return { CSS, JS, ICONS }; } };

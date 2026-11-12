// What Fabro adds to a page the model wrote, when it is shown, checked, pictured or printed — and nothing that
// decides how it looks: the page's own CSS always wins (every rule here has zero specificity or is screen-only
// viewer chrome). Plumbing only:
// - charset / viewport / a complete <html> skeleton when the model sent a fragment;
// - box-sizing + images never wider than their box (invisible safety net);
// - documents: a default A4 page for printing (the page's own @page rule overrides it), exact colours in print,
//   and on screen a sheet of paper around a flowing document so the viewer looks like what will print;
// - slides: each <section class="slide"> is a 1280×720 page in print, scaled to the panel on screen;
// - pictures Fabro saved itself (fabro-img:<id>) become inline data so the page works anywhere;
// - credits of photos Fabro found (CC licences) are listed at the very end if the page doesn't show them.
const legacy = require('./legacy');

const BASE = ':where(*,*::before,*::after){box-sizing:border-box}:where(img,svg,video,canvas){max-width:100%}:where(img){height:auto}html{-webkit-print-color-adjust:exact;print-color-adjust:exact}';
const DOC = '@page{size:A4;margin:16mm}'
  + '@media screen{:where(html[data-fabro-paper]){background:#e7e5e0}:where(html[data-fabro-paper]) :where(body){max-width:210mm;min-height:297mm;margin:24px auto;padding:16mm;background:#fff;box-shadow:0 2px 14px rgba(0,0,0,.12)}}';
const DECK = '@page{size:1280px 720px;margin:0}:where(section.slide){width:1280px;height:720px;overflow:hidden;position:relative;break-after:page;page-break-after:always}'
  + '@media screen{:where(html[data-fabro-deck]){background:#e7e5e0}:where(html[data-fabro-deck]) :where(section.slide){margin:0 auto 24px;box-shadow:0 2px 14px rgba(0,0,0,.14)}}';
// screen only: a deck is scaled to fit the panel
// a document that draws its own sheets (210mm / 297mm / 794px boxes) is left alone; a flowing one gets a paper frame on screen
const OWN_SHEETS = /\b(210|297|148|420)mm\b|\b(794|1123)px\b|8\.27in|11\.69in|8\.5in/;
const DECK_JS = `(function(){var fit=function(){if(matchMedia('print').matches){document.body.style.zoom='';return;}var s=document.querySelector('section.slide');if(!s)return;document.documentElement.setAttribute('data-fabro-deck','');var w=s.offsetWidth||1280;var z=Math.min(1,(innerWidth-24)/w);document.body.style.zoom=z<1?String(z):'';};if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',fit);else fit();addEventListener('resize',fit);addEventListener('beforeprint',function(){document.body.style.zoom='';});addEventListener('afterprint',fit);})();`;

// What kind of piece this is, from the artifact type or the page itself.
function kindOf(html, type) {
  const s = String(html || ''); const t = String(type || '').toLowerCase();
  const body = (s.match(/<body[^>]*>/i) || [''])[0];
  if (t === 'svg' || (!t && /^\s*<svg[\s>]/i.test(s))) return 'svg';
  if (t === 'slides' || /\bclass\s*=\s*["'][^"']*\bdeck\b/.test(body) || /<section[^>]*class\s*=\s*["'][^"']*\bslide\b/i.test(s) && !/^(html|document)$/.test(t)) return 'deck';
  if (t === 'document' || /\bclass\s*=\s*["'][^"']*\bdoc\b/.test(body) || (!t && /@page\b/.test(s))) return 'doc';
  if (/^\s*<svg[\s>]/i.test(s)) return 'svg';
  return 'web';
}

// A full HTML document out of whatever the model sent (fragment, body only, missing head…).
function skeleton(html, title = '') {
  let s = String(html || '').trim();
  s = s.replace(/^```[\w-]*\s*\n?/, '').replace(/\n?```\s*$/, ''); // a code fence left around the page
  if (/^\s*<svg[\s>]/i.test(s) && !/<html[\s>]/i.test(s)) s = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;min-height:100vh;display:grid;place-items:center;background:#fff}svg{max-width:92vw;max-height:92vh}</style></head><body>${s}</body></html>`;
  if (!/<html[\s>]/i.test(s)) s = `<!doctype html><html><head><meta charset="utf-8"><title>${String(title).replace(/</g, '&lt;')}</title></head><body>${s.replace(/^<!doctype[^>]*>/i, '')}</body></html>`;
  if (!/<head[\s>]/i.test(s)) s = s.replace(/<html([^>]*)>/i, '<html$1><head></head>');
  if (!/<body[\s>]/i.test(s)) s = s.replace(/<\/head>/i, '</head><body>') + (/<\/html>/i.test(s) ? '' : '</body>');
  if (!/<meta[^>]+charset/i.test(s)) s = s.replace(/<head([^>]*)>/i, '<head$1><meta charset="utf-8">');
  if (!/<meta[^>]+viewport/i.test(s)) s = s.replace(/<head([^>]*)>/i, '<head$1><meta name="viewport" content="width=device-width, initial-scale=1">');
  if (!/^\s*<!doctype/i.test(s)) s = '<!doctype html>' + s;
  return s;
}

// Photo credits (data-credit, set by Fabro when it found the photo): listed once at the end unless already shown.
function credits(s) {
  const list = [...new Set([...s.matchAll(/<img\b[^>]*\bdata-credit\s*=\s*"([^"]+)"/gi)].map((m) => m[1]))].slice(0, 12);
  if (!list.length || /data-fabro-credits/.test(s)) return s;
  const body = s.replace(/<[^>]+>/g, ' ');
  const missing = list.filter((c) => !body.includes(c.split(' · ')[0]));
  if (!missing.length) return s;
  const foot = `<p data-fabro-credits style="font:11px/1.4 system-ui,sans-serif;opacity:.6;margin:16px;clear:both">Photos: ${missing.join(' — ')}</p>`;
  return /<\/body>/i.test(s) ? s.replace(/<\/body>(?![\s\S]*<\/body>)/i, `${foot}</body>`) : s + foot;
}

// The page as shown / checked / printed. kind: 'web' | 'doc' | 'deck' | 'svg' (default: from the page).
function prepare(html, { kind = null, type = null, title = '', resolveImgs = null } = {}) {
  const k = kind || kindOf(html, type);
  let s = skeleton(html, title);
  if (resolveImgs) s = resolveImgs(s);
  if (/id=["']fabro-base["']/.test(s)) return s;
  const css = BASE + (k === 'doc' ? DOC : k === 'deck' ? DECK : '');
  const js = k === 'deck' ? DECK_JS : '';
  if (k === 'doc' && !OWN_SHEETS.test(s)) s = s.replace(/<html([^>]*)>/i, (m, a) => /data-fabro-paper/.test(a) ? m : `<html${a} data-fabro-paper>`);
  // first in <head>: everything the page says comes after and wins
  s = s.replace(/<head([^>]*)>/i, `<head$1><style id="fabro-base">${css}</style>`);
  if (js) s = /<\/body>/i.test(s) ? s.replace(/<\/body>(?![\s\S]*<\/body>)/i, `<script id="fabro-base-js">${js}</script></body>`) : s + `<script id="fabro-base-js">${js}</script>`;
  if (k === 'web' || k === 'doc') s = credits(s);
  return s;
}

// One entry point for every place that shows a page: old kit pages get the kit (as before), new ones the plumbing.
// opts: { kind, type, title, legacy } — legacy true/false, or an artifact + version: { art, v }.
function page(html, opts = {}) {
  const kit = require('./index');
  const isOld = opts.legacy != null ? !!opts.legacy : opts.art ? legacy.legacyArt(opts.art, opts.v) : false;
  const k = opts.kind || kindOf(html, opts.type || (opts.art && opts.art.type));
  if (isOld) {
    const mode = k === 'doc' ? 'doc' : k === 'deck' ? 'deck' : null;
    let s = String(html || '');
    if (k === 'svg' && !/<html[\s>]/i.test(s)) s = skeleton(s);
    return kit.inject(s, { mode, force: !!mode && (opts.type === 'document' || opts.type === 'slides' || (opts.art && /^(document|slides)$/.test(opts.art.type)) || !!opts.forceKit) });
  }
  return prepare(html, { kind: k, title: opts.title || (opts.art && opts.art.title) || '', resolveImgs: kit.resolveImgs });
}

module.exports = { prepare, page, kindOf, skeleton, BASE };

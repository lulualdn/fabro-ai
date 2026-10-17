// Chat-mode tools: web search and fetching a page / public API.
// (Using any other tool switches the conversation to agent mode — see agent runtime.)
const store = require('./store');
const providers = require('./providers');
const searxng = require('./searxng');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0 Safari/537.36 Fabro';

const CHAT_TOOLS = {
  web_search: {
    description: 'Search the web for current information. Use it for news, prices, recent events, facts you are unsure about, or anything after your training data. Returns numbered results; cite them as [1], [2].',
    parameters: { type: 'object', properties: {
      query: { type: 'string', description: 'Search query, in the language most likely to find good results' },
      category: { type: 'string', enum: ['general', 'news', 'science', 'it', 'images', 'videos'], description: 'Optional: news for current events, it for programming, science for papers' },
      time_range: { type: 'string', enum: ['day', 'week', 'month', 'year'], description: 'Optional: only recent results' },
    }, required: ['query'] },
  },
  fetch_url: {
    description: 'Read a web page or call a public JSON API (GET). Returns the readable text or JSON. Use it to open a search result or a URL the user gave.',
    parameters: { type: 'object', properties: { url: { type: 'string', description: 'Absolute http(s) URL' } }, required: ['url'] },
  },
};

function schemas(names) {
  return names.filter((n) => CHAT_TOOLS[n]).map((n) => ({ type: 'function', function: { name: n, description: CHAT_TOOLS[n].description, parameters: CHAT_TOOLS[n].parameters } }));
}

// ───────────────────────────── HTML → text ─────────────────────────────
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', eacute: 'é', egrave: 'è', agrave: 'à', ccedil: 'ç', ecirc: 'ê', ocirc: 'ô', ucirc: 'û', icirc: 'î', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…', mdash: '—', ndash: '–', laquo: '«', raquo: '»' };
const decode = (s) => String(s).replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENT[e.toLowerCase()] ?? m);
function htmlToText(html) {
  let h = String(html);
  const title = decode((h.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '').trim();
  const main = h.match(/<(article|main)[^>]*>([\s\S]*?)<\/\1>/i);
  if (main && main[2].length > 600) h = main[2];
  h = h.replace(/<(script|style|noscript|svg|nav|footer|header|form|iframe|template)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(h[1-6])[^>]*>/gi, '\n\n## ').replace(/<\/h[1-6]>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n- ').replace(/<(br|\/p|\/div|\/tr|\/section|\/article)[^>]*>/gi, '\n')
    .replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (m, href, txt) => { const t = txt.replace(/<[^>]+>/g, '').trim(); return /^https?:/.test(href) && t && t.length < 80 ? `${t} (${href})` : t; })
    .replace(/<[^>]+>/g, ' ');
  const text = decode(h).replace(/[ \t ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return { title, text };
}

// ───────────────────────────── search engines ─────────────────────────────
async function duckduckgo(query) {
  const r = await fetch('https://html.duckduckgo.com/html/', {
    method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded', 'Accept-Language': 'fr,en;q=0.8' },
    body: new URLSearchParams({ q: query, kl: '' }).toString(), signal: AbortSignal.timeout(12000),
  });
  if (!r.ok) throw new Error(`DuckDuckGo HTTP ${r.status}`);
  const html = await r.text();
  const out = [];
  const blocks = html.split(/<div class="result results_links/).slice(1);
  for (const b of blocks) {
    const a = b.match(/<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!a) continue;
    let url = decode(a[1]);
    const u = url.match(/[?&]uddg=([^&]+)/); if (u) url = decodeURIComponent(u[1]);
    if (/duckduckgo\.com\/y\.js/.test(url)) continue; // ads
    const sn = b.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);
    out.push({ title: decode(a[2].replace(/<[^>]+>/g, '')).trim(), url, snippet: sn ? decode(sn[1].replace(/<[^>]+>/g, '')).trim() : '' });
    if (out.length >= 8) break;
  }
  return out;
}
async function brave(query, key) {
  if (!key) throw new Error('Brave Search needs an API key (Settings → Chat → Web search)');
  const u = new URL('https://api.search.brave.com/res/v1/web/search'); u.searchParams.set('q', query); u.searchParams.set('count', '8');
  const r = await fetch(u, { headers: { Accept: 'application/json', 'X-Subscription-Token': key }, signal: AbortSignal.timeout(12000) });
  if (!r.ok) throw new Error(`Brave HTTP ${r.status}`);
  const j = await r.json();
  return ((j.web && j.web.results) || []).map((x) => ({ title: x.title, url: x.url, snippet: decode(String(x.description || '').replace(/<[^>]+>/g, '')) }));
}
// Ducky (Lulu's own engine): any endpoint answering { results: [{ title, url, snippet|description }] }.
async function ducky(query, base) {
  if (!base) throw new Error('Set your Ducky URL in Settings → Chat → Web search');
  const u = new URL(base.includes('{q}') ? base.replace('{q}', encodeURIComponent(query)) : base);
  if (!base.includes('{q}')) u.searchParams.set('q', query);
  const r = await fetch(u, { headers: { Accept: 'application/json', 'User-Agent': UA }, signal: AbortSignal.timeout(12000) });
  if (!r.ok) throw new Error(`Ducky HTTP ${r.status}`);
  const j = await r.json();
  const list = j.results || j.web || j.items || j.data || [];
  return list.slice(0, 8).map((x) => ({ title: x.title || x.name || x.url, url: x.url || x.link || x.href, snippet: x.snippet || x.description || x.body || '' })).filter((x) => x.url);
}

async function webSearch(query, ctx = {}, opts = {}) {
  const s = store.getSettings().search || {};
  let engine = s.engine || 'searxng';
  let results, extra = {};
  // SearXNG (default): the private instance is installed on demand, the first time it's needed.
  if (engine === 'searxng' && !s.searxngUrl && !searxng.installed()) {
    let ok = false;
    if (ctx.needDeps && !s.searxngDeclined) {
      ok = await ctx.needDeps('searxng');
      if (!ok) await store.setSettings({ search: { searxngDeclined: true } });
    }
    if (!ok || !searxng.installed()) engine = 'duckduckgo';
  }
  try {
    if (engine === 'searxng') { const r = await searxng.search(query, s, { lang: opts.lang, category: opts.category, time: opts.time, page: opts.page }); results = r.results; extra = { answers: r.answers, infobox: r.infobox, suggestions: r.suggestions, pageUrl: r.pageUrl }; }
    else results = engine === 'brave' ? await brave(query, providers.getKey('search:brave'))
      : engine === 'ducky' ? await ducky(query, s.duckyUrl)
      : await duckduckgo(query);
  } catch (e) {
    if (engine !== 'duckduckgo') { const from = engine; results = await duckduckgo(query); engine = 'duckduckgo'; extra = { fallback: { from, error: String(e.message || e).slice(0, 600) } }; } else throw e;
  }
  return { engine, results, ...extra };
}

async function fetchUrl(url) {
  if (!/^https?:\/\//i.test(url)) throw new Error('Only http(s) URLs');
  const host = new URL(url).hostname;
  if (!process.env.FABRO_E2E && /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.0\.0\.0|\[?::1\]?$)/.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) throw new Error('Local network addresses are not allowed');
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html,application/json,text/plain;q=0.9,*/*;q=0.5' }, redirect: 'follow', signal: AbortSignal.timeout(15000) });
  const type = r.headers.get('content-type') || '';
  const reader = r.body.getReader(); const chunks = []; let n = 0;
  for (;;) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); n += value.length; if (n > 3 << 20) { try { reader.cancel(); } catch {} break; } }
  const raw = Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');
  if (!r.ok) return { url, status: r.status, title: '', text: `HTTP ${r.status}\n${raw.slice(0, 800)}` };
  if (/json/.test(type) || /^\s*[[{]/.test(raw)) {
    let text = raw; try { text = JSON.stringify(JSON.parse(raw), null, 1); } catch {}
    return { url, status: r.status, title: url, text: text.slice(0, 14000), json: true };
  }
  if (/html|xml/.test(type) || /<html/i.test(raw)) { const { title, text } = htmlToText(raw); return { url, status: r.status, title, text: text.slice(0, 14000) }; }
  if (/^text\//.test(type)) return { url, status: r.status, title: url, text: raw.slice(0, 14000) };
  return { url, status: r.status, title: url, text: `(${type || 'binary'} content, ${n} bytes — not readable as text)` };
}

// Runs one tool call. Returns { content (for the model), view (for the UI) }.
function formatResults(r) {
  const head = [
    ...(r.answers || []).map((a) => `Direct answer: ${a}`),
    r.infobox ? `Infobox — ${r.infobox.title}: ${r.infobox.text}${r.infobox.url ? ` (${r.infobox.url})` : ''}` : '',
  ].filter(Boolean).join('\n');
  const body = r.results.map((x, i) => `[${i + 1}] ${x.title}${x.date ? ` (${String(x.date).slice(0, 10)})` : ''}\n${x.url}\n${x.snippet}`).join('\n\n');
  return r.results.length || head
    ? `${head ? head + '\n\n' : ''}${body}\n\nCite sources as [n]. Open a result with fetch_url if the snippet is not enough.${(r.suggestions || []).length ? `\nRelated searches: ${r.suggestions.join(' · ')}` : ''}`
    : 'No results.';
}

async function run(name, args, ctx = {}) {
  if (name === 'web_search') {
    const r = await webSearch(String(args.query || '').slice(0, 300), ctx, { category: args.category, time: args.time_range });
    const { engine, results } = r;
    const content = formatResults(r);
    return { content, view: { kind: 'search', query: args.query, engine, sources: results.map((x) => ({ title: x.title, url: x.url, snippet: x.snippet })) } };
  }
  if (name === 'fetch_url') {
    const page = await fetchUrl(String(args.url || ''));
    return { content: `${page.title ? page.title + '\n' : ''}${page.url}\n\n${page.text}`, view: { kind: 'fetch', url: page.url, title: page.title || page.url, status: page.status, chars: page.text.length } };
  }
  throw Object.assign(new Error(`Unknown tool ${name}`), { code: 'UNKNOWN_TOOL' });
}

module.exports = { CHAT_TOOLS, schemas, run, htmlToText, duckduckgo, fetchUrl, webSearch, formatResults };

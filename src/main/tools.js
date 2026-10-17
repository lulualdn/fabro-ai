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
  generate_image: {
    description: 'Create an image locally (stable-diffusion.cpp) and show it to the user: illustrations, photos, logos, concept art. Write the prompt in English, detailed and visual (subject, setting, style, lighting, colours, composition). The image is saved in Documents/Fabro/Images.',
    parameters: { type: 'object', properties: {
      prompt: { type: 'string', description: 'Detailed English description of the image' },
      aspect: { type: 'string', enum: ['square', 'portrait', 'landscape', 'wide', 'tall'] },
      negative: { type: 'string', description: 'Optional: what to avoid' },
      seed: { type: 'integer' },
    }, required: ['prompt'] },
  },
  show_on_scene: {
    description: 'Voice mode: show something on the screen while you talk — pictures found on the web (images query), a video (video query or YouTube URL), a web page (url), or your own drawing/diagram/page (svg or html you write). Replaces what is shown.',
    parameters: { type: 'object', properties: {
      kind: { type: 'string', enum: ['images', 'video', 'web', 'svg', 'html'] },
      query: { type: 'string', description: 'For images / video: what to search' },
      url: { type: 'string', description: 'For web / video: the address' },
      content: { type: 'string', description: 'For svg / html: the full markup' },
      title: { type: 'string', description: 'Short caption' },
    }, required: ['kind'] },
  },
  project_search: {
    description: 'Search the files of the current project (keywords and meaning). Returns the most relevant passages with their file names.',
    parameters: { type: 'object', properties: { query: { type: 'string', description: 'What to look for' } }, required: ['query'] },
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

// Voice-mode scene: images / video from SearXNG, a page, or markup the model wrote.
const ytEmbed = (u) => { const m = String(u).match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([\w-]{11})/); return m ? `https://www.youtube-nocookie.com/embed/${m[1]}?autoplay=1` : null; };
async function showOnScene(a, ctx) {
  const kind = a.kind; let items = [];
  if (kind === 'images' || kind === 'video') {
    if (kind === 'video' && a.url) items = [{ type: 'video', url: a.url, embed: ytEmbed(a.url) || a.url, title: a.title }];
    else {
      const s = store.getSettings().search || {};
      if (!searxng.installed() && !s.searxngUrl) throw new Error('Image and video search need SearXNG (Settings → Agent → Web search)');
      const r = await searxng.search(String(a.query || a.title || ''), s, { category: kind === 'images' ? 'images' : 'videos', limit: kind === 'images' ? 12 : 6 });
      items = kind === 'images'
        ? r.results.filter((x) => x.img && /^https?:/.test(x.img)).slice(0, 4).map((x) => ({ type: 'image', url: x.img, title: x.title, source: x.url }))
        : r.results.map((x) => ({ type: 'video', url: x.url, embed: ytEmbed(x.url), title: x.title })).filter((x) => x.embed).slice(0, 1);
    }
  } else if (kind === 'web') {
    if (!/^https?:\/\//i.test(a.url || '')) throw new Error('web needs an absolute http(s) url');
    items = [{ type: 'web', url: a.url, title: a.title }];
  } else if (kind === 'svg' || kind === 'html') {
    if (!a.content) throw new Error(`${kind} needs content`);
    items = [{ type: kind, content: String(a.content).slice(0, 200000), title: a.title }];
  } else throw new Error('kind must be images, video, web, svg or html');
  if (!items.length) return { content: `Nothing found to show for "${a.query}". Tell the user, or try another query.`, view: { kind: 'scene', items: [] } };
  return { content: `Now showing on screen: ${items.map((x) => x.title || x.type).join(' · ')}. Talk about it naturally; don't read URLs aloud.`, view: { kind: 'scene', items } };
}

// Search results are numbered across the whole answer ([1]…[5] then [6]…), so citations stay unambiguous.
function searchResult(r, query, ctx = {}) {
  const off = ctx.src ? ctx.src.n : 0;
  if (ctx.src) ctx.src.n += r.results.length;
  return { content: formatResults(r, off), view: { kind: 'search', query, engine: r.engine, offset: off, sources: r.results.map((x) => ({ title: x.title, url: x.url, snippet: x.snippet })) } };
}

// Runs one tool call. Returns { content (for the model), view (for the UI) }.
function formatResults(r, off = 0) {
  const head = [
    ...(r.answers || []).map((a) => `Direct answer: ${a}`),
    r.infobox ? `Infobox — ${r.infobox.title}: ${r.infobox.text}${r.infobox.url ? ` (${r.infobox.url})` : ''}` : '',
  ].filter(Boolean).join('\n');
  const body = r.results.map((x, i) => `[${off + i + 1}] ${x.title}${x.date ? ` (${String(x.date).slice(0, 10)})` : ''}\n${x.url}\n${x.snippet}`).join('\n\n');
  return r.results.length || head
    ? `${head ? head + '\n\n' : ''}${body}\n\nCite sources as [n]. Open a result with fetch_url if the snippet is not enough.${(r.suggestions || []).length ? `\nRelated searches: ${r.suggestions.join(' · ')}` : ''}`
    : 'No results.';
}

async function run(name, args, ctx = {}) {
  if (name === 'web_search') {
    const r = await webSearch(String(args.query || '').slice(0, 300), ctx, { category: args.category, time: args.time_range });
    return searchResult(r, args.query, ctx);
  }
  if (name === 'show_on_scene') return showOnScene(args, ctx);
  if (name === 'generate_image') {
    const images = require('./images');
    let st = await images.status();
    if (!st.engine || !st.preset || !st.presets[st.preset].ready) {
      if (!ctx.needDeps || !(await ctx.needDeps('images'))) throw new Error('Image generation is not installed (the user declined). Tell the user they can install it in Settings → Agent.');
      st = await images.status();
    }
    const r = await images.generate(args, { signal: ctx.signal, onProgress: (p) => ctx.emit && ctx.emit({ type: 'tool_progress', id: ctx.callId, pct: p }) });
    return { content: `Image generated (${r.width}×${r.height}, ${st.presets[r.preset].name}, ${(r.ms / 1000).toFixed(0)} s) and shown to the user. Saved at ${r.path}. Don't describe it at length; one short sentence is enough.`,
      view: { kind: 'image', path: r.path, image: r.dataUrl, width: r.width, height: r.height, prompt: args.prompt, model: st.presets[r.preset].name, ms: r.ms } };
  }
  if (name === 'project_search') {
    if (!ctx.project) throw new Error('No project');
    const r = await require('./rag').search(ctx.project, String(args.query || ''), 8);
    return { content: r.results.length ? r.results.map((x, i) => `[${i + 1}] ${x.file}\n${x.text}`).join('\n\n') : 'Nothing found in the project files.', view: { kind: 'project_search', query: args.query, n: r.results.length, semantic: r.semantic, files: [...new Set(r.results.map((x) => x.file))] } };
  }
  if (name === 'fetch_url') {
    const page = await fetchUrl(String(args.url || ''));
    return { content: `${page.title ? page.title + '\n' : ''}${page.url}\n\n${page.text}`, view: { kind: 'fetch', url: page.url, title: page.title || page.url, status: page.status, chars: page.text.length } };
  }
  throw Object.assign(new Error(`Unknown tool ${name}`), { code: 'UNKNOWN_TOOL' });
}

module.exports = { CHAT_TOOLS, schemas, run, htmlToText, duckduckgo, fetchUrl, webSearch, formatResults, searchResult };

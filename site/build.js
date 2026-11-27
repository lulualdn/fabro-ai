// Builds the Fabro website into site/dist (static files, no framework, no dependency).
// English is written into the HTML (works without JavaScript, good for search engines); site.js swaps in another
// language (i18n.js + i18n-2.js). Long texts (docs, help, labs) are Markdown in site/content, one file per language.
// The model catalog comes from the installer (same rules as the app); the changelog from GitHub Releases.
// Screenshots: site/img/v1, made by scripts/site-shots.js. Run: node site/build.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(__dirname, 'src');
const OUT = path.join(__dirname, 'dist');
const CONTENT = path.join(__dirname, 'content');
const REPO = 'lulualdn/fabro-ai';
const SITE_URL = process.env.SITE_URL || 'https://fabro.ufstudios.eu';

const ctx = { window: {} }; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(SRC, 'i18n.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(SRC, 'i18n-2.js'), 'utf8'), ctx);
const I18N = ctx.window.I18N;
const EN = I18N.en;
const { md, esc } = require('./src/md.js');
const { marked } = require('./app/vendor/marked.umd.js');
let dims = {}; try { dims = JSON.parse(fs.readFileSync(path.join(SRC, 'dims.json'), 'utf8')); } catch {}

// ───────── data ─────────
function catalog() {
  const html = fs.readFileSync(path.join(ROOT, 'installer/ui/index.src.html'), 'utf8');
  const m = html.match(/const CATALOG = (\[[\s\S]*?\n\]);/);
  if (!m) throw new Error('CATALOG not found in installer/ui/index.src.html');
  return vm.runInNewContext(m[1]).map(({ id, name, sizeGB, moe, tags }) => ({ id, name, sizeGB, moe: !!moe, tags }));
}
function notesFromGit(tag) {
  try {
    const sha = execFileSync('git', ['log', '--format=%H', '-1', `--grep=^${tag.replace(/\./g, '\\.')}:`], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
      || (tag === 'v0.1.0' ? execFileSync('git', ['log', '--format=%H', '-1', '--grep=^Fabro v0.1.0'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() : '');
    if (!sha) return '';
    return execFileSync('node', [path.join(ROOT, 'scripts/release-notes.js'), sha], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch { return ''; }
}
async function releases() {
  const cache = path.join(__dirname, 'data', 'releases.json');
  let raw = null;
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=50`, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'fabro-site', ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}) } });
    if (r.ok) raw = await r.json();
  } catch {}
  let cached = []; try { cached = JSON.parse(fs.readFileSync(cache, 'utf8')); } catch {}
  if (!raw) { console.warn('releases: GitHub unreachable, using the cached list'); return cached; }
  const cachedNotes = Object.fromEntries(cached.map((r) => [r.tag, r.body]));
  const list = raw.filter((r) => !r.draft).map((r) => ({ tag: r.tag_name, date: r.published_at, url: r.html_url, prerelease: r.prerelease,
    body: (r.body || '').trim() || notesFromGit(r.tag_name) || cachedNotes[r.tag_name] || '',
    assets: (r.assets || []).map((a) => ({ name: a.name, size: a.size, url: a.browser_download_url })) }));
  fs.writeFileSync(cache, JSON.stringify(list, null, 1));
  return list;
}

// ───────── helpers ─────────
const markSvg = fs.readFileSync(path.join(ROOT, 'build/fabro-mark.svg'), 'utf8').replace('<svg ', '<svg aria-hidden="true" ');
const ICONS = {
  down: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>', right: '<path d="M5 12h14M13 6l6 6-6 6"/>', menu: '<path d="M4 7h16M4 12h16M4 17h10"/>',
  moon: '<path d="M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z"/>', sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
  cloud: '<path d="M7 18a4.5 4.5 0 01-.6-9 6 6 0 0111.5 1.5A3.8 3.8 0 0117 18z"/>', key: '<circle cx="8" cy="14" r="4"/><path d="M11 11l8-8M16 6l2 2M14 8l2 2"/>',
  pc: '<rect x="3.5" y="4.5" width="17" height="11" rx="2"/><path d="M9 19.5h6M12 15.5v4"/>', code: '<path d="M9 7l-5 5 5 5M15 7l5 5-5 5"/>', ext: '<path d="M14 4h6v6M20 4l-9 9M18 14v5H5V6h5"/>',
};
const ic = (n) => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${ICONS[n]}</svg>`;
const T = (key, tag = 'span', attrs = '', vars) => {
  if (!(key in EN)) throw new Error('missing i18n key ' + key);
  const text = String(EN[key]).replace(/\{(\w+)\}/g, (_, x) => (vars || {})[x] ?? '');
  return `<${tag} data-i="${key}"${vars ? ` data-iv='${JSON.stringify(vars)}'` : ''}${attrs ? ' ' + attrs : ''}>${text}</${tag}>`;
};
// A screenshot in both themes (the page shows the one that matches). Files: img/v1/<name>-light.webp / -dark.webp
function shot(name, { eager = false, cls = '', alt = 'shot_alt_chat' } = {}) {
  const one = (th) => {
    const f = `v1/${name}-${th}.webp`; const d = dims[f] || dims[`v1/${name}-light.webp`];
    if (!d) return '';
    return `<img class="th-${th[0]}" src="img/${f}" width="${d[0]}" height="${d[1]}" alt="${esc(EN[alt] || '')}" data-ia="alt:${alt}" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async">`;
  };
  return `<figure class="shot ${cls}">${one('light')}${one('dark')}</figure>`;
}
// Markdown article in English and French (site.js shows the one that matches the language)
function bilingual(base) {
  const read = (l) => { const f = `${base}.${l}.md`; return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null; };
  const en = read('en'), fr = read('fr') || en;
  const html = (s) => marked.parse(s, { gfm: true }).replace(/<a href="(https?:)/g, '<a rel="noopener" href="$1');
  return { en: html(en), fr: html(fr), titleEn: (en.match(/^#\s+(.+)$/m) || [])[1] || '', titleFr: (fr.match(/^#\s+(.+)$/m) || [])[1] || '' };
}
const both = (b) => `<div data-lang="en">${b.en}</div><div data-lang="fr" hidden>${b.fr}</div>`;

const NAV = [['anywhere', 'nav_any'], ['docs', 'nav_docs'], ['help', 'nav_help'], ['labs', 'nav_labs'], ['dev', 'nav_dev']];
const DOCS = ['start', 'anywhere', 'connectors', 'code', 'mods'];

function layout({ page, file, desc, body, scripts = '', section = file }) {
  const nav = NAV.map(([f, k]) => `<a href="${f}.html"${f === section ? ' aria-current="page"' : ''}>${T(k)}</a>`).join('');
  return `<!doctype html>
<html lang="en" data-page="${page}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(EN[page + '_title'] || 'Fabro')}</title>
<meta name="description" content="${esc(desc)}">
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self'; script-src 'self' 'unsafe-inline'; connect-src 'self' https://api.github.com">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#f6f3ef" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#141312" media="(prefers-color-scheme: dark)">
<link rel="canonical" href="${SITE_URL}/${file === 'index' ? '' : file + '.html'}">
<meta property="og:title" content="${esc(EN[page + '_title'] || 'Fabro')}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${SITE_URL}/img/og.png">
<meta property="og:type" content="website">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="img/mark.svg" type="image/svg+xml">
<link rel="preload" href="fonts/hanken-grotesk-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="site.css">
<script>(function(){var t;try{t=localStorage.getItem('fabro-theme');}catch(e){}document.documentElement.dataset.theme=t||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');})();</script>
</head>
<body>
<a class="skip" href="#main">${T('skip')}</a>
<header class="top">
  <div class="wrap bar">
    <a class="brand" href="index.html" aria-label="Fabro">${markSvg}<span>Fabro</span></a>
    <nav class="nav" id="nav" aria-label="Main">${nav}</nav>
    <div class="tools">
      <label class="sr" for="lang" data-i="lang_label">${EN.lang_label}</label>
      <select id="lang" class="lang">${['en', 'fr', 'es', 'de'].map((l) => `<option value="${l}">${l.toUpperCase()}</option>`).join('')}</select>
      <button id="theme" class="ib" type="button" aria-label="${esc(EN.theme_toggle)}" data-ia="aria-label:theme_toggle;title:theme_toggle" title="${esc(EN.theme_toggle)}"><span class="moon">${ic('moon')}</span><span class="sun">${ic('sun')}</span></button>
      <a class="btn pri sm" href="index.html#download">${T('nav_download')}</a>
      <button id="menu" class="ib menu-btn" type="button" aria-controls="nav" aria-expanded="false" aria-label="${esc(EN.nav_menu)}" data-ia="aria-label:nav_menu">${ic('menu')}</button>
    </div>
  </div>
</header>
<main id="main">
${body}
</main>
<footer class="foot">
  <div class="wrap cols">
    <div class="f-brand">
      <a class="brand" href="index.html">${markSvg}<span>Fabro</span></a>
      ${T('foot_tag', 'p')}
      ${T('foot_made', 'p', 'class="copy"', { y: new Date().getFullYear() })}
    </div>
    <div><h2 data-i="foot_product">${EN.foot_product}</h2><ul>
      <li><a href="index.html#download">${T('nav_download')}</a></li>
      <li><a href="app/">Fabro Anywhere</a></li>
      <li><a href="can-i-run.html">${T('nav_canirun')}</a></li>
      <li><a href="changelog.html">${T('nav_changelog')}</a></li>
    </ul></div>
    <div><h2>${T('nav_docs')}</h2><ul>
      <li><a href="docs.html">${T('nav_docs')}</a></li><li><a href="help.html">${T('nav_help')}</a></li><li><a href="labs.html">${T('nav_labs')}</a></li><li><a href="dev.html">${T('nav_dev')}</a></li>
    </ul></div>
    <div><h2 data-i="foot_about">${EN.foot_about}</h2><ul>
      <li><a href="privacy.html">${T('foot_privacy')}</a></li>
      <li><a href="legal.html">${T('foot_legal')}</a></li>
      <li><a href="https://github.com/${REPO}">${T('foot_source')}</a></li>
    </ul></div>
  </div>
</footer>
<script src="i18n.js"></script>
<script src="i18n-2.js"></script>
<script src="md.js"></script>
${scripts}
<script src="site.js"></script>
</body>
</html>
`;
}
const dlBlock = () => `
  <div class="dl">
    <a class="btn pri lg dl-main" href="https://github.com/${REPO}/releases/latest">${ic('down')}<span>${EN.dl_generic}</span></a>
    <div class="dl-meta" aria-live="polite">${T('dl_free')}</div>
    <details class="dl-others"><summary>${T('dl_other')}</summary><div class="dl-list"></div></details>
  </div>`;

// ───────── pages ─────────
function home() {
  const rows = [['p1', 'task'], ['p2', 'reader'], ['p3', 'mcp'], ['p4', 'cu'], ['p5', 'code'], ['p6', 'update']];
  return layout({ page: 'index', file: 'index', desc: EN.h_lead, body: `
<section class="hero">
  <div class="wrap">
    ${T('h_h1', 'h1')}
    ${T('h_lead', 'p', 'class="lead"')}
    <div class="hero-acts">${dlBlock()}<a class="btn lg ghost" href="app/">${T('h_any')}${ic('right')}</a></div>
  </div>
  <div class="wrap wide">${shot('chat', { eager: true, cls: 'hero-shot' })}</div>
</section>
<section class="practice">
  <div class="wrap">${T('h_practice', 'h2', 'class="kicker"')}</div>
  <div class="wrap rows">
    ${rows.map(([k, img], i) => `<article class="row ${i % 2 ? 'flip' : ''}"><div class="txt">${T(k + '_h', 'h3')}${T(k + '_p', 'p')}</div>${shot(img, { cls: 'crop' })}</article>`).join('')}
  </div>
</section>
<section class="band">
  <div class="wrap split">
    <div>${T('any_band_h', 'h2')}${T('any_band_p', 'p', 'class="lead"')}
      <div class="hero-acts"><a class="btn pri" href="app/">${T('any_open2')}</a><a class="btn ghost" href="anywhere.html">${T('any_how')}${ic('right')}</a></div></div>
    ${shot('phone', { cls: 'phone', alt: 'shot_alt_phone' })}
  </div>
</section>
<section class="fit">
  <div class="wrap split narrow">
    <div>${T('fit_h', 'h2')}${T('fit_p', 'p')}</div>
    <a class="btn" href="can-i-run.html">${T('nav_canirun')}${ic('right')}</a>
  </div>
</section>
<section class="download" id="download">
  <div class="wrap center">${T('dl_h', 'h2')}${T('dl_p', 'p', 'class="lead"')}${dlBlock()}</div>
</section>` });
}

function anywhere() {
  const who = [['cloud', 'any_w1'], ['key', 'any_w2'], ['pc', 'any_w3']];
  return layout({ page: 'anywhere', file: 'anywhere', desc: EN.any_lead, body: `
<section class="hero sub">
  <div class="wrap">${T('any_h1', 'h1')}${T('any_lead', 'p', 'class="lead"')}<div class="hero-acts"><a class="btn pri lg" href="app/">${T('any_open2')}${ic('right')}</a></div></div>
</section>
<section>
  <div class="wrap split top-align">
    <div>
      ${T('any_who_h', 'h2', 'class="kicker"')}
      <ul class="who">${who.map(([i, k]) => `<li>${ic(i)}<div>${T(k + '_h', 'h3')}${T(k + '_p', 'p')}</div></li>`).join('')}</ul>
    </div>
    ${shot('phone', { cls: 'phone', alt: 'shot_alt_phone' })}
  </div>
</section>
<section>
  <div class="wrap narrow">
    ${T('any_link_h', 'h2', 'class="kicker"')}
    <ol class="steps-list">${[1, 2, 3].map((n) => `<li>${T('any_link_' + n)}</li>`).join('')}</ol>
    <div class="note">${ic('code')}<div>${T('any_code_h', 'h3')}${T('any_code_p', 'p')}</div></div>
  </div>
</section>` });
}

function docsIndex(pages) {
  return layout({ page: 'docs', file: 'docs', desc: EN.docs_lead, body: `
<section class="hero sub"><div class="wrap">${T('docs_h1', 'h1')}${T('docs_lead', 'p', 'class="lead"')}</div></section>
<section><div class="wrap narrow"><ul class="toc">${pages.map((p) => `<li><a href="docs-${p.slug}.html"><span data-lang="en">${esc(p.b.titleEn)}</span><span data-lang="fr" hidden>${esc(p.b.titleFr)}</span>${ic('right')}</a></li>`).join('')}</ul></div></section>` });
}
function docPage(p, pages) {
  return layout({ page: 'docs', file: 'docs-' + p.slug, section: 'docs', desc: p.b.titleEn, body: `
<div class="wrap doc">
  <nav class="side-toc" aria-label="Docs">${pages.map((x) => `<a href="docs-${x.slug}.html"${x === p ? ' aria-current="page"' : ''}><span data-lang="en">${esc(x.b.titleEn)}</span><span data-lang="fr" hidden>${esc(x.b.titleFr)}</span></a>`).join('')}</nav>
  <article class="prose">${both(p.b)}</article>
</div>` });
}
function help() {
  const b = bilingual(path.join(CONTENT, 'help'));
  return layout({ page: 'help', file: 'help', desc: EN.help_lead, body: `
<section class="hero sub"><div class="wrap">${T('help_h1', 'h1')}${T('help_lead', 'p', 'class="lead"')}</div></section>
<section><div class="wrap narrow"><article class="prose faq">${both(b)}${T('help_more', 'p', 'class="more"')}</article></div></section>` });
}
function labs() {
  const dir = path.join(CONTENT, 'labs');
  const posts = fs.readdirSync(dir).filter((f) => /\.en\.md$/.test(f)).map((f) => f.replace(/\.en\.md$/, ''));
  return layout({ page: 'labs', file: 'labs', desc: EN.labs_lead, body: `
<section class="hero sub"><div class="wrap">${T('labs_h1', 'h1')}${T('labs_lead', 'p', 'class="lead"')}</div></section>
<section><div class="wrap narrow">${posts.length ? `<ul class="toc">${posts.map((s) => { const b = bilingual(path.join(dir, s)); return `<li><a href="labs-${s}.html"><span data-lang="en">${esc(b.titleEn)}</span><span data-lang="fr" hidden>${esc(b.titleFr)}</span>${ic('right')}</a></li>`; }).join('')}</ul>` : T('labs_empty', 'p', 'class="empty"')}</div></section>` });
}
function dev() {
  const items = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'roadmap.json'), 'utf8'));
  const col = (st, key) => { const l = items.filter((x) => x.status === st); return l.length ? `<div class="lane">${T(key, 'h2', 'class="kicker"')}<ul>${l.map((x) => `<li data-id="${esc(x.id)}"><span class="t"><span data-lang="en">${esc(x.en)}</span><span data-lang="fr" hidden>${esc(x.fr)}</span></span><button class="vote" type="button" data-id="${esc(x.id)}"><span class="n mono">·</span>${T('dev_vote')}</button></li>`).join('')}</ul></div>` : ''; };
  return layout({ page: 'dev', file: 'dev', desc: EN.dev_lead, body: `
<section class="hero sub"><div class="wrap">${T('dev_h1', 'h1')}${T('dev_lead', 'p', 'class="lead"')}</div></section>
<section><div class="wrap narrow roadmap">${col('now', 'dev_now')}${col('next', 'dev_next')}${col('later', 'dev_later')}${col('done', 'dev_done')}<p class="hint" id="votes-off" hidden>${T('dev_votes_off')}</p></div></section>
<section><div class="wrap narrow">
  ${T('dev_sug_h', 'h2', 'class="kicker"')}${T('dev_sug_p', 'p', 'class="hint"')}
  <form class="sug" name="suggestion" method="POST" data-netlify="true" netlify-honeypot="website">
    <input type="hidden" name="form-name" value="suggestion">
    <p class="sr"><label>Website <input name="website" tabindex="-1" autocomplete="off"></label></p>
    <label>${T('dev_sug_title')}<input name="title" required maxlength="140"></label>
    <label>${T('dev_sug_body')}<textarea name="details" rows="4" maxlength="2000"></textarea></label>
    <div class="acts"><span class="status" aria-live="polite"></span><button class="btn pri">${T('dev_sug_send')}</button></div>
  </form>
</div></section>` });
}
function canIRun(cat) {
  const G = (label, kind, vram) => `<option value="${esc(label)}" data-kind="${kind}" data-vram="${vram}">${label} · ${vram} GB</option>`;
  const groups = {
    NVIDIA: [['GeForce GTX 1650', 4], ['GeForce GTX 1660 / Super', 6], ['GeForce RTX 2060', 6], ['GeForce RTX 2070 / 2080', 8], ['GeForce RTX 3050', 8], ['GeForce RTX 3060', 12], ['GeForce RTX 3060 Ti / 3070', 8], ['GeForce RTX 3080', 10], ['GeForce RTX 3090', 24], ['GeForce RTX 4060', 8], ['GeForce RTX 4060 Ti 16 GB', 16], ['GeForce RTX 4070 / Super', 12], ['GeForce RTX 4070 Ti Super / 4080', 16], ['GeForce RTX 4090', 24], ['GeForce RTX 5060 / 5060 Ti', 8], ['GeForce RTX 5070', 12], ['GeForce RTX 5070 Ti / 5080', 16], ['GeForce RTX 5090', 32]],
    AMD: [['Radeon RX 6600', 8], ['Radeon RX 6700 XT', 12], ['Radeon RX 6800 / 6900', 16], ['Radeon RX 7600', 8], ['Radeon RX 7700 XT', 12], ['Radeon RX 7800 XT', 16], ['Radeon RX 7900 XT', 20], ['Radeon RX 7900 XTX', 24], ['Radeon RX 9070 / 9070 XT', 16]],
    Intel: [['Arc A750', 8], ['Arc A770', 16], ['Arc B580', 12]],
  };
  const gpuSel = `<select id="gpu">
      <option value="none" data-kind="none" data-vram="0" data-i="cir_gpu_none">${EN.cir_gpu_none}</option>
      <option value="apple" data-kind="apple" data-vram="0" data-i="cir_gpu_apple">${EN.cir_gpu_apple}</option>
      ${Object.entries(groups).map(([v, l]) => `<optgroup label="${v}">${l.map(([n, g]) => G(n, v === 'NVIDIA' ? 'nvidia' : v.toLowerCase(), g)).join('')}</optgroup>`).join('')}
      <optgroup label="…">${[4, 6, 8, 12, 16, 24].map((n) => `<option value="other-${n}" data-kind="other" data-vram="${n}" data-i="cir_vram_other" data-iv='{"n":${n}}'>${EN.cir_vram_other.replace('{n}', n)}</option>`).join('')}</optgroup>
    </select>`;
  const ramSel = `<select id="ram">${[8, 16, 24, 32, 48, 64, 96, 128].map((n) => `<option value="${n}"${n === 16 ? ' selected' : ''} data-i="cir_gb" data-iv='{"n":${n}}'>${n} GB</option>`).join('')}</select>`;
  return layout({ page: 'cir', file: 'can-i-run', section: '', desc: EN.cir_lead, scripts: `<script>window.CATALOG=${JSON.stringify(cat)};</script>`, body: `
<section class="hero sub"><div class="wrap">${T('cir_h1', 'h1')}${T('cir_lead', 'p', 'class="lead"')}</div></section>
<section><div class="wrap cir">
  <form class="panel" onsubmit="return false">
    <label class="field"><span data-i="cir_gpu">${EN.cir_gpu}</span>${gpuSel}</label>
    <label class="field"><span data-i="cir_ram">${EN.cir_ram}</span>${ramSel}</label>
    ${T('cir_find', 'p', 'class="hint"')}
  </form>
  <div class="panel" aria-live="polite">${T('cir_result', 'h2', 'class="kicker"')}<div id="cir-out"></div></div>
</div></section>
<section class="download"><div class="wrap center">${dlBlock()}</div></section>` });
}
function privacy() {
  return layout({ page: 'priv', file: 'privacy', section: '', desc: EN.priv_lead, body: `
<div class="wrap narrow"><article class="prose page">
  ${T('priv_h1', 'h1')}${T('priv_lead', 'p', 'class="lead"')}
  ${T('priv_stays_h', 'h2')}${T('priv_stays', 'ul')}
  ${T('priv_goes_h', 'h2')}${T('priv_goes', 'ul')}
  ${T('priv_any_h', 'h2')}${T('priv_any', 'ul')}
  ${T('priv_keys_h', 'h2')}${T('priv_keys', 'p')}
  ${T('priv_crash_h', 'h2')}${T('priv_crash', 'p')}
  ${T('priv_site_h', 'h2')}${T('priv_site', 'p')}
  ${T('priv_contact', 'p', 'class="more"')}
</article></div>` });
}
function changelog(list) {
  const first = list.find((r) => !r.prerelease);
  const fmtSize = (b) => (b >= 1e9 ? (b / 1e9).toFixed(1) + ' GB' : Math.round(b / 1e6) + ' MB');
  const items = list.map((r) => {
    const files = r.assets.filter((a) => !/\.(blockmap|yml)$/.test(a.name) && !/^sd-bin-/.test(a.name));
    return `<article class="rel ${r === first ? 'latest' : ''}"><h2><a href="${r.url}">${esc(r.tag)}</a> <time datetime="${r.date}">${new Date(r.date).toLocaleDateString('en', { year: 'numeric', month: 'long', day: 'numeric' })}</time>${r === first ? ` <span class="tag" data-i="cl_latest">${EN.cl_latest}</span>` : ''}</h2>
      <div class="notes">${md(r.body)}</div>${files.length ? `<div class="assets">${files.map((a) => `<a href="${a.url}">${esc(a.name)} · ${fmtSize(a.size)}</a>`).join('')}</div>` : ''}</article>`;
  }).join('');
  const snap = list.map(({ tag, date, url, prerelease, body, assets }) => ({ tag, date, url, prerelease, body, assets }));
  return layout({ page: 'cl', file: 'changelog', section: '', desc: EN.cl_lead, scripts: `<script>window.RELEASES=${JSON.stringify(snap).replace(/</g, '\\u003c')};</script>`, body: `
<div class="wrap narrow"><article class="prose page">${T('cl_h1', 'h1')}${T('cl_lead', 'p', 'class="lead"')}<div id="releases">${items}</div></article></div>` });
}
function legal() {
  const OSS = [
    ['Electron', 'https://github.com/electron/electron', 'App shell', 'MIT'],
    ['llama.cpp', 'https://github.com/ggml-org/llama.cpp', 'AI engine', 'MIT'],
    ['stable-diffusion.cpp', 'https://github.com/leejet/stable-diffusion.cpp', 'Image engine', 'MIT'],
    ['faster-whisper', 'https://github.com/SYSTRAN/faster-whisper', 'Speech recognition', 'MIT'],
    ['Piper', 'https://github.com/OHF-Voice/piper1-gpl', 'Voices', 'GPL-3.0'],
    ['SearXNG', 'https://github.com/searxng/searxng', 'Private web search', 'AGPL-3.0'],
    ['Python (python-build-standalone)', 'https://github.com/astral-sh/python-build-standalone', 'Tools runtime', 'PSF-2.0'],
    ['Git for Windows (MinGit)', 'https://github.com/git-for-windows/git', 'Code mode on Windows', 'GPL-2.0'],
    ['marked', 'https://github.com/markedjs/marked', 'Markdown', 'MIT'],
    ['DOMPurify', 'https://github.com/cure53/DOMPurify', 'HTML sanitising', 'Apache-2.0 / MPL-2.0'],
    ['highlight.js', 'https://github.com/highlightjs/highlight.js', 'Code highlighting', 'BSD-3-Clause'],
    ['PDF.js', 'https://github.com/mozilla/pdf.js', 'PDF reading', 'Apache-2.0'],
    ['electron-updater', 'https://github.com/electron-userland/electron-builder', 'Updates', 'MIT'],
    ['wry & tao', 'https://github.com/tauri-apps/wry', 'Windows installer', 'MIT / Apache-2.0'],
    ['Pyodide', 'https://github.com/pyodide/pyodide', 'Python in Fabro Anywhere', 'MPL-2.0'],
    ['Hanken Grotesk', 'https://github.com/marcologous/hanken-grotesk', 'Typeface', 'OFL-1.1'],
    ['JetBrains Mono', 'https://github.com/JetBrains/JetBrainsMono', 'Typeface', 'OFL-1.1'],
  ];
  return layout({ page: 'legal', file: 'legal', section: '', desc: EN.legal_pub.replace(/<[^>]+>/g, ''), body: `
<div class="wrap narrow"><article class="prose page">
  ${T('legal_h1', 'h1')}
  ${T('legal_pub_h', 'h2')}${T('legal_pub', 'p')}
  ${T('legal_host_h', 'h2')}${T('legal_host', 'p')}
  ${T('legal_use_h', 'h2')}${T('legal_use', 'p')}
  ${T('legal_tm_h', 'h2')}${T('legal_tm', 'p')}
  ${T('legal_oss_h', 'h2')}${T('legal_oss', 'p')}
  <div class="lic">${OSS.map(([n, u, what, lic]) => `<div><a href="${u}">${n}</a><span>${what}</span><em>${lic}</em></div>`).join('')}</div>
  ${T('legal_fonts', 'p', 'class="more"')}
</article></div>` });
}

// ───────── Fabro Anywhere (site/app → dist/app) ─────────
function buildApp(rel) {
  const src = path.join(__dirname, 'app'), out = path.join(OUT, 'app');
  const copy = (from, to) => { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(from, to); };
  const walk = (d, r = '') => { for (const e of fs.readdirSync(path.join(d, r), { withFileTypes: true })) { const x = path.join(r, e.name); if (e.isDirectory()) walk(d, x); else copy(path.join(d, x), path.join(out, x)); } };
  walk(src);
  copy(path.join(ROOT, 'src', 'anywhere', 'core.js'), path.join(out, 'core.js'));
  // where "Fabro Code" sends people: the latest release's installers
  const r = rel.find((x) => !x.prerelease && x.assets.length);
  const pick = (re) => { const a = r && r.assets.find((x) => re.test(x.name)); return a ? a.url : `https://github.com/${REPO}/releases/latest`; };
  fs.writeFileSync(path.join(out, 'downloads.json'), JSON.stringify({ version: r ? r.tag.replace(/^v/, '') : '', win: pick(/^Fabro-Installer\.exe$|Setup.*\.exe$/i), mac: pick(/arm64.*\.dmg$|\.dmg$/i), linux: pick(/\.AppImage$/i) }));
  // the service worker's cache name follows the app's content, so phones pick up new versions
  const h = require('crypto').createHash('sha256');
  for (const f of ['index.html', 'app.js', 'app.css', 'agent.js', 'core.js', 'theme.js', 'scan-worker.js']) h.update(fs.readFileSync(path.join(out, f)));
  const sw = path.join(out, 'sw.js'); fs.writeFileSync(sw, fs.readFileSync(sw, 'utf8').replace('__VERSION__', h.digest('hex').slice(0, 12)));
}

// ───────── build ─────────
(async () => {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(path.join(OUT, 'img'), { recursive: true });
  for (const f of ['site.css', 'site.js', 'i18n.js', 'i18n-2.js', 'md.js']) fs.copyFileSync(path.join(SRC, f), path.join(OUT, f));
  fs.cpSync(path.join(__dirname, 'img'), path.join(OUT, 'img'), { recursive: true });
  fs.cpSync(path.join(__dirname, 'fonts'), path.join(OUT, 'fonts'), { recursive: true });
  fs.writeFileSync(path.join(OUT, 'img', 'mark.svg'), fs.readFileSync(path.join(ROOT, 'build/fabro-mark.svg')));
  const rel = await releases();
  const cat = catalog();
  const docPages = DOCS.map((slug) => ({ slug, b: bilingual(path.join(CONTENT, 'docs', slug)) }));
  const pages = {
    index: home(), anywhere: anywhere(), docs: docsIndex(docPages), help: help(), labs: labs(), dev: dev(),
    'can-i-run': canIRun(cat), privacy: privacy(), changelog: changelog(rel), legal: legal(),
  };
  for (const p of docPages) pages['docs-' + p.slug] = docPage(p, docPages);
  for (const [f, html] of Object.entries(pages)) fs.writeFileSync(path.join(OUT, f + '.html'), html);
  fs.writeFileSync(path.join(OUT, '404.html'), pages.index.replace('<main id="main">', '<main id="main"><p class="notfound">404</p>'));
  fs.writeFileSync(path.join(OUT, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${SITE_URL}/sitemap.xml\n`);
  fs.writeFileSync(path.join(OUT, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${Object.keys(pages).map((f) => `<url><loc>${SITE_URL}/${f === 'index' ? '' : f + '.html'}</loc></url>`).join('')}</urlset>\n`);
  // old pages (v0.x) → where their content lives now
  fs.writeFileSync(path.join(OUT, '_redirects'), ['/chat.html /#practice 301', '/agent.html /#practice 301', '/voice.html / 301', '/code.html /docs-code.html 301', '/modding.html /docs-mods.html 301'].join('\n') + '\n');
  fs.writeFileSync(path.join(OUT, '_headers'), `/*\n  X-Content-Type-Options: nosniff\n  X-Frame-Options: SAMEORIGIN\n  Referrer-Policy: strict-origin-when-cross-origin\n/img/*\n  Cache-Control: public, max-age=604800\n/fonts/*\n  Cache-Control: public, max-age=31536000, immutable\n/app/sw.js\n  Cache-Control: no-cache\n  Service-Worker-Allowed: /app/\n/app/manifest.webmanifest\n  Content-Type: application/manifest+json\n`);
  buildApp(rel);
  console.log(`site: ${Object.keys(pages).length} pages, ${rel.length} releases, ${cat.length} models → ${path.relative(ROOT, OUT)}`);
})().catch((e) => { console.error(e); process.exit(1); });

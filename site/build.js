// Builds the Fabro website into site/dist (static files, no framework).
// English text is written into the HTML (works without JavaScript, good for search engines); site.js swaps
// in FR / ES / DE. The model catalog comes from the installer (same rules as the app), and the changelog
// from GitHub Releases, with notes taken from the release commit when a release has no description.
// Run: node site/build.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(__dirname, 'src');
const OUT = path.join(__dirname, 'dist');
const REPO = 'lulualdn/fabro-ai';
const SITE_URL = process.env.SITE_URL || 'https://fabro-local-ai.netlify.app';

const ctx = { window: {} }; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(SRC, 'i18n.js'), 'utf8'), ctx);
const I18N = ctx.window.I18N;
const EN = I18N.en;
const { md, esc } = require('./src/md.js');
const dims = JSON.parse(fs.readFileSync(path.join(SRC, 'dims.json'), 'utf8'));

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
  if (!raw) { try { raw = JSON.parse(execFileSync('gh', ['api', `repos/${REPO}/releases?per_page=50`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })); } catch {} }
  let list;
  let cached = []; try { cached = JSON.parse(fs.readFileSync(cache, 'utf8')); } catch {}
  const cachedNotes = Object.fromEntries(cached.map((r) => [r.tag, r.body]));
  if (raw) {
    list = raw.filter((r) => !r.draft).map((r) => ({ tag: r.tag_name, date: r.published_at, url: r.html_url, prerelease: r.prerelease,
      body: (r.body || '').trim() || notesFromGit(r.tag_name) || cachedNotes[r.tag_name] || '',
      assets: (r.assets || []).map((a) => ({ name: a.name, size: a.size, url: a.browser_download_url })) }));
    fs.mkdirSync(path.dirname(cache), { recursive: true });
    fs.writeFileSync(cache, JSON.stringify(list, null, 1));
  } else {
    console.warn('releases: GitHub unreachable, using the cached list');
    list = JSON.parse(fs.readFileSync(cache, 'utf8'));
  }
  return list;
}

// ───────── helpers ─────────
// Heroicons (MIT), copied into site/icons so the site builds without node_modules.
const icon = (name, set = '24/solid') => fs.readFileSync(path.join(__dirname, 'icons', name + (set === '20/solid' ? '-20' : '') + '.svg'), 'utf8').replace(/\s*data-slot="icon"/, '').replace(/\n\s*/g, '');
const mark = fs.readFileSync(path.join(ROOT, 'build/fabro-mark.svg'), 'utf8').replace('<svg ', '<svg aria-hidden="true" ');
const T = (key, tag = 'span', attrs = '', vars) => {
  if (!(key in EN)) throw new Error('missing i18n key ' + key);
  for (const l of Object.keys(I18N)) if (!(key in I18N[l])) console.warn(`i18n: "${key}" missing in ${l}`);
  const text = String(EN[key]).replace(/\{(\w+)\}/g, (_, x) => (vars || {})[x] ?? '');
  return `<${tag} data-i="${key}"${vars ? ` data-iv='${JSON.stringify(vars)}'` : ''}${attrs ? ' ' + attrs : ''}>${text}</${tag}>`;
};
function shot(name, { eager = false, cls = '', alt = '' } = {}) {
  const one = (th) => {
    const f = `${name}-${th}.webp`;
    const file = dims[f] ? f : `${name}-light.webp`;
    const [w, h] = dims[file];
    return `<img class="th-${th[0]}" src="img/${file}" width="${w}" height="${h}" alt="${esc(alt)}" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async">`;
  };
  return `<div class="frame ${cls}">${one('light')}${one('dark')}</div>`;
}
const NAV = [['chat', 'nav_chat'], ['agent', 'nav_agent'], ['code', 'nav_code'], ['voice', 'nav_voice'], ['anywhere', 'nav_anywhere'], ['can-i-run', 'nav_canirun'], ['changelog', 'nav_changelog']];
const illus = (name, wave = false) => `<div class="illus" aria-hidden="true"><div class="ring">${icon(name)}</div>${wave ? `<div class="wave">${Array.from({ length: 24 }, (_, i) => `<i style="animation-delay:${(i * 83) % 900}ms"></i>`).join('')}</div>` : ''}</div>`;
const dlBlock = (size = 'lg', withOthers = true) => `
  <div class="dl">
    <div class="dl-row">
      <a class="btn primary ${size} dl-main" href="https://github.com/${REPO}/releases/latest">${icon('arrow-down-tray')}${T('dl_generic')}</a>
    </div>
    <div class="dl-meta" aria-live="polite">${T('dl_free')}</div>
    ${withOthers ? `<details class="dl-others"><summary>${T('dl_other')}</summary><div class="dl-list"></div></details>` : ''}
  </div>`;

function layout({ page, file, desc, body, scripts = '' }) {
  const nav = NAV.map(([f, k]) => `<a href="${f}.html"${f === file ? ' aria-current="page"' : ''}>${T(k)}</a>`).join('');
  const hreflang = ['en', 'fr', 'es', 'de'];
  return `<!doctype html>
<html lang="en" data-page="${page}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(EN[page + '_title'])}</title>
<meta name="description" content="${esc(desc)}">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#f6f5f1" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#12161d" media="(prefers-color-scheme: dark)">
<link rel="canonical" href="${SITE_URL}/${file === 'index' ? '' : file + '.html'}">
<meta property="og:title" content="${esc(EN[page + '_title'])}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${SITE_URL}/img/og.png">
<meta property="og:type" content="website">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="img/mark.svg" type="image/svg+xml">
<link rel="stylesheet" href="site.css">
<script>(function(){try{var t=localStorage.getItem('fabro-theme');}catch(e){}document.documentElement.dataset.theme=t||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');})();</script>
</head>
<body>
<a class="skip" href="#main">${T('skip')}</a>
<header class="top">
  <div class="wrap">
    <a class="brand" href="index.html" aria-label="Fabro">${mark}<span>Fabro</span></a>
    <nav class="nav" id="nav" aria-label="Main">${nav}</nav>
    <div class="tools">
      <label class="sr-only" for="lang" data-i="lang_label">${EN.lang_label}</label>
      <select id="lang" class="lang">${hreflang.map((l) => `<option value="${l}">${l.toUpperCase()}</option>`).join('')}</select>
      <button id="theme" class="icon-btn" type="button" aria-label="${esc(EN.theme_toggle)}" data-ia="aria-label:theme_toggle;title:theme_toggle" title="${esc(EN.theme_toggle)}"><span class="moon">${icon('moon')}</span><span class="sun">${icon('sun')}</span></button>
      <a class="btn primary sm" href="index.html#download">${T('nav_download')}</a>
      <button id="menu" class="icon-btn menu-btn" type="button" aria-controls="nav" aria-expanded="false" aria-label="${esc(EN.nav_menu)}" data-ia="aria-label:nav_menu">${icon('bars-3')}</button>
    </div>
  </div>
</header>
<main id="main">
${body}
</main>
<footer class="foot">
  <div class="wrap">
    <div>
      <a class="brand" href="index.html">${mark}<span>Fabro</span></a>
      ${T('foot_tag', 'p')}
      ${T('foot_made', 'p', 'class="copy"', { y: new Date().getFullYear() })}
    </div>
    <div><h4 data-i="foot_product">${EN.foot_product}</h4><ul>
      ${NAV.slice(0, 6).map(([f, k]) => `<li><a href="${f}.html">${T(k)}</a></li>`).join('')}
    </ul></div>
    <div><h4 data-i="foot_about">${EN.foot_about}</h4><ul>
      <li><a href="privacy.html">${T('foot_privacy')}</a></li>
      <li><a href="changelog.html">${T('foot_changelog')}</a></li>
      <li><a href="legal.html">${T('foot_legal')}</a></li>
      <li><a href="https://github.com/${REPO}">${T('foot_source')}</a></li>
      <li><a href="https://github.com/${REPO}/issues">${T('foot_issues')}</a></li>
    </ul></div>
  </div>
</footer>
<script src="i18n.js"></script>
<script src="md.js"></script>
${scripts}
<script src="site.js"></script>
</body>
</html>
`;
}

// ───────── pages ─────────
function home() {
  const pillars = [['lock-closed', 1], ['cpu-chip', 2], ['sparkles', 3], ['cube-transparent', 4]];
  const modes = [['chat', 'nav_chat', '08-chat', 'left top'], ['agent', 'nav_agent', '31c-subagents-done', 'right top'], ['code', 'nav_code', '34-code-session', '35% top'], ['voice', 'nav_voice', 'voice', 'center 35%'], ['anywhere', 'nav_anywhere', '10-quick-answer', 'left top']];
  return layout({ page: 'home', file: 'index', desc: EN.home_desc, body: `
<section class="hero" id="download">
  <div class="wrap">
    <div class="prop">${mark}</div>
    ${T('hero_kicker', 'div', 'class="kicker"')}
    <h1 data-i="hero_title">${EN.hero_title}</h1>
    ${T('hero_sub', 'p', 'class="sub"')}
    ${dlBlock()}
    <div class="shot-hero">${shot('08-chat', { eager: true, alt: 'Fabro' })}</div>
  </div>
</section>
<section>
  <div class="wrap">
    <div class="pillars">
      ${pillars.map(([ic, n]) => `<div class="pillar reveal"><div class="ic">${icon(ic)}</div>${T(`pillar${n}_h`, 'h3')}${T(`pillar${n}_p`, 'p')}</div>`).join('')}
    </div>
  </div>
</section>
<section>
  <div class="wrap">
    <div class="sec-head reveal">${T('home_modes_h', 'h2')}${T('home_modes_p', 'p')}</div>
    <div class="modes">
      ${modes.map(([f, k, img, pos]) => `<a class="mode reveal" href="${f}.html"><div class="txt">${T(k, 'h3')}${T(`card_${f}_p`, 'p')}<span class="more">${T('learn_more')} ${icon('arrow-right', '20/solid')}</span></div><div class="pic">${shot(img, { cls: 'bare' }).replace(/<div class="frame bare">|<\/div>$/g, '').replace(/<img /g, `<img style="object-position:${pos}" `)}</div></a>`).join('')}
    </div>
  </div>
</section>
<section>
  <div class="wrap split">
    <div class="panel accent reveal">${T('home_fit_h', 'h2')}${T('home_fit_p', 'p')}<a class="btn primary" href="can-i-run.html">${T('nav_canirun')}</a></div>
    <div class="panel reveal">${T('home_privacy_h', 'h2')}${T('home_privacy_p', 'p')}<a class="btn ghost" href="privacy.html">${T('home_privacy_cta')}</a></div>
  </div>
</section>
<section class="end">
  <div class="wrap reveal">
    <div class="prop" style="width:64px;height:64px">${mark}</div>
    ${T('home_end_h', 'h2')}${T('home_end_p', 'p')}
    ${dlBlock('lg', false)}
  </div>
</section>` });
}

function feature(file, key, heroImg, blocks) {
  return layout({ page: key, file, desc: EN[key + '_lead'].replace(/<[^>]+>/g, ''), body: `
<section class="fhero">
  <div class="wrap">
    ${T(key + '_kicker', 'div', 'class="kicker"')}
    <h1 data-i="${key}_h1">${EN[key + '_h1']}</h1>
    ${T(key + '_lead', 'p', 'class="lead"')}
    <div style="margin-top:30px">${dlBlock('', false)}</div>
    ${heroImg ? `<div class="shot-hero">${heroImg}</div>` : ''}
  </div>
</section>
<section style="padding-top:0">
  <div class="wrap blocks">
    ${blocks.map(([n, media, badge]) => `<div class="block reveal"><div class="bt">${badge ? T(badge, 'span', 'class="badge"') : ''}${T(`${key}_b${n}_h`, 'h2')}${T(`${key}_b${n}_p`, 'p')}</div><div class="bm">${media}</div></div>`).join('')}
  </div>
</section>` });
}

function canIRun(cat) {
  const G = (label, kind, vram) => `<option value="${esc(label)}" data-kind="${kind}" data-vram="${vram}">${label} · ${vram} GB</option>`;
  const groups = {
    NVIDIA: [['GeForce GTX 1650', 4], ['GeForce GTX 1660 / Super', 6], ['GeForce RTX 2060', 6], ['GeForce RTX 2070 / 2080', 8], ['GeForce RTX 3050', 8], ['GeForce RTX 3060', 12], ['GeForce RTX 3060 Ti / 3070', 8], ['GeForce RTX 3080', 10], ['GeForce RTX 3090', 24], ['GeForce RTX 4050 Laptop', 6], ['GeForce RTX 4060 / 4060 Laptop', 8], ['GeForce RTX 4060 Ti 16 GB', 16], ['GeForce RTX 4070 / 4070 Super', 12], ['GeForce RTX 4070 Ti Super / 4080', 16], ['GeForce RTX 4090', 24], ['GeForce RTX 5060', 8], ['GeForce RTX 5070', 12], ['GeForce RTX 5070 Ti / 5080', 16], ['GeForce RTX 5090', 32]],
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
  return layout({ page: 'cir', file: 'can-i-run', desc: EN.cir_lead, scripts: `<script>window.CATALOG=${JSON.stringify(cat)};</script>`, body: `
<section class="fhero" style="padding-bottom:0">
  <div class="wrap">
    <div class="prop" style="width:64px;height:64px;margin-bottom:18px">${mark}</div>
    ${T('cir_h1', 'h1')}
    ${T('cir_lead', 'p', 'class="lead"')}
  </div>
</section>
<section style="padding-top:36px">
  <div class="wrap cir">
    <form class="card" onsubmit="return false">
      <div class="field"><label for="gpu" data-i="cir_gpu">${EN.cir_gpu}</label>${gpuSel}</div>
      <div class="field"><label for="ram" data-i="cir_ram">${EN.cir_ram}</label>${ramSel}</div>
      ${T('cir_find', 'p', 'class="hint"')}
    </form>
    <div class="card" aria-live="polite">
      ${T('cir_result', 'h2', 'style="font-size:28px;margin-bottom:14px"')}
      <div id="cir-out"></div>
    </div>
  </div>
  <div class="wrap" style="text-align:center;margin-top:40px">${dlBlock('', false)}</div>
</section>` });
}

function privacy() {
  return layout({ page: 'priv', file: 'privacy', desc: EN.priv_lead, body: `
<article class="prose">
  ${T('priv_h1', 'h1')}${T('priv_lead', 'p', 'class="lead"')}
  ${T('priv_stays_h', 'h2')}${T('priv_stays', 'ul')}
  ${T('priv_goes_h', 'h2')}${T('priv_goes', 'ul')}
  ${T('priv_crash_h', 'h2')}${T('priv_crash', 'p')}
  ${T('priv_site_h', 'h2')}${T('priv_site', 'p')}
  ${T('priv_contact', 'p', 'style="margin-top:36px"')}
</article>` });
}

function changelog(list) {
  const first = list.find((r) => !r.prerelease);
  const fmtSize = (b) => (b >= 1e9 ? (b / 1e9).toFixed(1) + ' GB' : Math.round(b / 1e6) + ' MB');
  const items = list.map((r) => {
    const files = r.assets.filter((a) => !/\.(blockmap|yml)$/.test(a.name));
    return `<article class="rel ${r === first ? 'latest' : ''}"><h2><a href="${r.url}">${esc(r.tag)}</a> <time datetime="${r.date}">${new Date(r.date).toLocaleDateString('en', { year: 'numeric', month: 'long', day: 'numeric' })}</time>${r === first ? ` <span class="tag">${EN.cl_latest}</span>` : ''}</h2>
      <div class="notes">${md(r.body)}</div>${files.length ? `<div class="assets">${files.map((a) => `<a href="${a.url}">${esc(a.name)} · ${fmtSize(a.size)}</a>`).join('')}</div>` : ''}</article>`;
  }).join('');
  const snap = list.map(({ tag, date, url, prerelease, body, assets }) => ({ tag, date, url, prerelease, body, assets }));
  return layout({ page: 'cl', file: 'changelog', desc: EN.cl_lead, scripts: `<script>window.RELEASES=${JSON.stringify(snap).replace(/</g, '\\u003c')};</script>`, body: `
<article class="prose">
  ${T('cl_h1', 'h1')}${T('cl_lead', 'p', 'class="lead"')}
  <div id="releases">${items}</div>
</article>` });
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
    ['Heroicons', 'https://github.com/tailwindlabs/heroicons', 'Icons', 'MIT'],
    ['Phosphor Icons', 'https://github.com/phosphor-icons/core', 'Icons', 'MIT'],
    ['marked', 'https://github.com/markedjs/marked', 'Markdown', 'MIT'],
    ['DOMPurify', 'https://github.com/cure53/DOMPurify', 'HTML sanitising', 'Apache-2.0 / MPL-2.0'],
    ['highlight.js', 'https://github.com/highlightjs/highlight.js', 'Code highlighting', 'BSD-3-Clause'],
    ['PDF.js', 'https://github.com/mozilla/pdf.js', 'PDF reading', 'Apache-2.0'],
    ['electron-updater', 'https://github.com/electron-userland/electron-builder', 'Updates', 'MIT'],
    ['extract-zip', 'https://github.com/max-mapper/extract-zip', 'Archives', 'BSD-2-Clause'],
    ['wry & tao', 'https://github.com/tauri-apps/wry', 'Windows installer', 'MIT / Apache-2.0'],
  ];
  return layout({ page: 'legal', file: 'legal', desc: EN.legal_pub.replace(/<[^>]+>/g, ''), body: `
<article class="prose">
  ${T('legal_h1', 'h1')}
  ${T('legal_pub_h', 'h2')}${T('legal_pub', 'p')}
  ${T('legal_host_h', 'h2')}${T('legal_host', 'p')}
  ${T('legal_use_h', 'h2')}${T('legal_use', 'p')}
  ${T('legal_tm_h', 'h2')}${T('legal_tm', 'p')}
  ${T('legal_oss_h', 'h2')}${T('legal_oss', 'p')}
  <div class="lic">${OSS.map(([n, u, what, lic]) => `<div><a href="${u}">${n}</a><span>${what}</span><em>${lic}</em></div>`).join('')}</div>
</article>` });
}

// ───────── build ─────────
(async () => {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(path.join(OUT, 'img'), { recursive: true });
  for (const f of ['site.css', 'site.js', 'i18n.js', 'md.js']) fs.copyFileSync(path.join(SRC, f), path.join(OUT, f));
  for (const f of fs.readdirSync(path.join(__dirname, 'img'))) fs.copyFileSync(path.join(__dirname, 'img', f), path.join(OUT, 'img', f));
  const rel = await releases();
  const cat = catalog();
  const pages = {
    index: home(),
    chat: feature('chat', 'chat', shot('08-chat', { eager: true }), [[1, shot('24-art-doc')], [2, shot('chat-search')], [3, shot('chat-think')], [4, shot('11-model-sheet')]]),
    agent: feature('agent', 'agent', shot('31c-subagents-done', { eager: true }), [[1, shot('31b-subagents')], [2, shot('31-agent-browser')], [3, shot('29-agent-perm')], [4, shot('30-agent-done')]]),
    code: feature('code', 'code', shot('34-code-session', { eager: true }), [[1, shot('35-code-diff')], [2, shot('37-code-terminal')], [3, shot('36-code-editor')], [4, shot('33-code-welcome')]]),
    voice: feature('voice', 'voice', shot('voice', { eager: true }), [[1, illus('microphone', true)], [2, illus('speaker-wave', true)], [3, illus('presentation-chart-bar')], [4, illus('pencil-square')]]),
    anywhere: feature('anywhere', 'any', null, [[1, `<div class="quickbar">${shot('09-quick', { cls: 'bare' })}</div>`], [2, shot('10-quick-answer', { cls: 'bare' })], [3, `<div class="phone">${mark}</div>`, 'soon']]),
    'can-i-run': canIRun(cat),
    privacy: privacy(),
    changelog: changelog(rel),
    legal: legal(),
  };
  for (const [f, html] of Object.entries(pages)) fs.writeFileSync(path.join(OUT, f + '.html'), html);
  fs.writeFileSync(path.join(OUT, '404.html'), pages.index.replace('<main id="main">', '<main id="main"><p style="text-align:center;padding-top:40px;color:var(--muted)">404</p>'));
  fs.writeFileSync(path.join(OUT, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${SITE_URL}/sitemap.xml\n`);
  fs.writeFileSync(path.join(OUT, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${Object.keys(pages).map((f) => `<url><loc>${SITE_URL}/${f === 'index' ? '' : f + '.html'}</loc></url>`).join('')}</urlset>\n`);
  fs.writeFileSync(path.join(OUT, '_headers'), `/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n  Permissions-Policy: interest-cohort=()\n  Content-Security-Policy: default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src https://api.github.com; frame-ancestors 'none'\n/img/*\n  Cache-Control: public, max-age=604800\n`);
  console.log(`site: ${Object.keys(pages).length} pages, ${rel.length} releases, ${cat.length} models → ${path.relative(ROOT, OUT)}`);
})().catch((e) => { console.error(e); process.exit(1); });

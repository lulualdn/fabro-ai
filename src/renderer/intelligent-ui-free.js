// Fabro Intelligent UI, free form: the model writes its own HTML / SVG / CSS in a ```fabro-ui block and Fabro
// draws it as part of the conversation (no frame, no card around it): a shadow root on the block, with Fabro's
// tokens and a small kit of classes. No script runs: behaviour is declarative (data-select, data-toggle,
// data-reveal, data-step). Also the "figure" display: a picture with numbered points, leader lines and cards.
(() => {
  if (!window.IUI || !IUI.add) return;
  const { e, inl, arr, num } = IUI.h;
  const SEL = new Map(); // key → { group: name } (survives the re-renders of the message)
  const ON = new Map();  // key → Set of toggled ids

  const KIT = `
:host { display: block; contain: content; color: var(--text); font: inherit; line-height: 1.5; container-type: inline-size; }
* { box-sizing: border-box; }
h1, h2, h3, h4, p, ul, ol, figure { margin: 0; }
h1, h2, h3, h4, .title { font-family: var(--font-display); font-weight: var(--fw-medium); line-height: 1.2; }
h1 { font-size: var(--fs-h1, 28px); } h2 { font-size: var(--fs-h2, 22px); } h3 { font-size: var(--fs-h3, 18px); } h4, .title { font-size: var(--fs-h4, 16px); }
img, svg, video { max-width: 100%; height: auto; }
img { border-radius: var(--r-md); display: block; }
a { color: var(--accent); }
button { font: inherit; color: inherit; }
.root, .col { display: flex; flex-direction: column; gap: var(--sp-3); }
.row { display: flex; flex-wrap: wrap; gap: var(--sp-3); align-items: center; }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: var(--sp-3); }
.split { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: var(--sp-4); align-items: start; }
.grow { flex: 1; min-width: 0; } .center { text-align: center; align-items: center; justify-content: center; }
.card { display: flex; flex-direction: column; gap: var(--sp-1); background: var(--elev); border: 1px solid var(--border); border-radius: var(--r-lg); padding: var(--sp-3) var(--sp-4); transition: border-color var(--dur-2, .15s), transform var(--dur-2, .15s), box-shadow var(--dur-2, .15s); }
.card.on, .card[data-select]:hover { border-color: var(--accent); }
[data-select], [data-toggle], [data-reveal], [data-step] { cursor: pointer; }
.muted, small { color: var(--muted); font-size: var(--fs-sm); } .kicker { color: var(--accent); font-size: var(--fs-sm); font-weight: var(--fw-medium); letter-spacing: .04em; text-transform: uppercase; }
.big { font-family: var(--font-display); font-size: 2.2em; line-height: 1.05; font-variant-numeric: tabular-nums; }
.chip, .badge { display: inline-flex; align-items: center; gap: var(--sp-1); padding: 2px var(--sp-2); border-radius: var(--r-pill); background: var(--elev); border: 1px solid var(--border); font-size: var(--fs-sm); }
.chip.on, .badge.accent { background: var(--accent); color: var(--accent-ink); border-color: var(--accent); }
.btn { display: inline-flex; align-items: center; gap: var(--sp-2); padding: var(--sp-2) var(--sp-3); border-radius: var(--r-md); border: 1px solid var(--border); background: var(--elev); cursor: pointer; }
.btn:hover { border-color: var(--accent); } .btn.primary { background: var(--accent); color: var(--accent-ink); border-color: var(--accent); }
.divider { height: 1px; background: var(--border); border: 0; }
.pane:not(.on), .answer:not(.on), [hidden] { display: none !important; }
.figure, .fig-img { position: relative; display: inline-block; line-height: 0; }
.pin { position: absolute; transform: translate(-50%, -50%); width: 24px; height: 24px; padding: 0; border-radius: 50%; border: 2px solid var(--bg); background: var(--accent); color: var(--accent-ink); font-size: 12px; line-height: 1; display: grid; place-items: center; cursor: pointer; transition: transform var(--dur-2, .15s), box-shadow var(--dur-2, .15s); }
.pin.on, .pin:hover { transform: translate(-50%, -50%) scale(1.25); box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent) 30%, transparent); }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
/* annotated figure */
.fig { display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr); gap: var(--sp-5); align-items: start; }
.fig-stage { position: relative; display: grid; grid-template-columns: minmax(84px, 1fr) minmax(0, auto) minmax(84px, 1fr); gap: 0 var(--sp-4); align-items: stretch; }
.fig-img { min-width: 0; }
.fig-img > svg, .fig-img > img { display: block; max-height: 460px; width: auto; max-width: 100%; }
.fig-labels { display: flex; flex-direction: column; justify-content: space-around; gap: var(--sp-2); padding: var(--sp-3) 0; }
.fig-labels.l { align-items: flex-end; text-align: right; } .fig-labels.r { align-items: flex-start; }
.fig-label { all: unset; box-sizing: border-box; max-width: 100%; overflow-wrap: anywhere; line-height: 1.3; cursor: pointer; font-size: var(--fs-sm); padding: 3px var(--sp-2); border-radius: var(--r-md); border: 1px solid var(--border); background: var(--panel); position: relative; z-index: 1; }
.fig-label.on { border-color: var(--accent); color: var(--accent); }
.fig-lines { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; overflow: visible; }
.fig-lines path { stroke: var(--muted); stroke-width: 1.2; fill: none; opacity: .7; transition: stroke var(--dur-2, .15s), opacity var(--dur-2, .15s); }
.fig-lines path.on { stroke: var(--accent); stroke-width: 2; opacity: 1; }
.fig-cards { display: flex; flex-direction: column; gap: var(--sp-2); }
.fig-cards .card { flex-direction: row; gap: var(--sp-3); align-items: flex-start; cursor: pointer; }
.fig-cards .card > i { flex: none; width: 24px; height: 24px; border-radius: 50%; background: var(--panel); border: 1px solid var(--border); display: grid; place-items: center; font-style: normal; font-size: 12px; }
.fig-cards .card.on > i { background: var(--accent); color: var(--accent-ink); border-color: var(--accent); }
.fig-cards .card > div { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.fig-cards .card b { font-weight: var(--fw-medium); } .fig-cards .card span { color: var(--text-2, var(--muted)); font-size: var(--fs-sm); }
.fig-none { color: var(--muted); font-size: var(--fs-sm); padding: var(--sp-5); border: 1px dashed var(--border); border-radius: var(--r-md); line-height: 1.4; }
@container (max-width: 640px) { .fig, .split { grid-template-columns: 1fr; } }
@container (max-width: 430px) { .fig-labels, .fig-lines { display: none; } .fig-stage { grid-template-columns: 1fr; justify-items: center; } }
@media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }`;
  let sheet = null;
  const kit = () => { if (!sheet) { sheet = new CSSStyleSheet(); sheet.replaceSync(KIT); } return sheet; };

  // model CSS: no network, nothing that leaves the block
  const cleanCss = (css) => String(css || '').replace(/@import[^;]*;?/gi, '').replace(/url\(\s*(['"]?)(?!data:)[^)]*\)/gi, 'none').replace(/position\s*:\s*fixed/gi, 'position:absolute').replace(/expression\s*\(/gi, '(');
  const PURIFY = { FORCE_BODY: true, ADD_TAGS: ['style'], ADD_ATTR: ['target'], FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'link', 'meta', 'base', 'frame', 'frameset', 'audio', 'video'], USE_PROFILES: { html: true, svg: true, svgFilters: true } };
  function sanitize(html) {
    const tpl = document.createElement('template');
    tpl.innerHTML = DOMPurify.sanitize(String(html || ''), PURIFY);
    for (const s of tpl.content.querySelectorAll('style')) s.textContent = cleanCss(s.textContent);
    for (const n of tpl.content.querySelectorAll('[style]')) n.setAttribute('style', cleanCss(n.getAttribute('style')));
    for (const n of tpl.content.querySelectorAll('[id]')) n.id = n.id.replace(/[^\w-]/g, '');
    return tpl.content;
  }

  // ── figure: the picture, numbered points, labels on both sides with leader lines, one card per point ──
  function figureDoc(d) {
    const pts = arr(d.points).slice(0, 14).map((p, i) => ({ i, x: Math.max(0, Math.min(100, num(p.x, 50))), y: Math.max(0, Math.min(100, num(p.y, 50))), label: p.label || p.title || '', text: p.text || '' }));
    const side = (l) => pts.filter((p) => (p.x < 50) === l).sort((a, b) => a.y - b.y).map((p) => `<button class="fig-label" data-select="p:${p.i}" data-hover data-item="p:${p.i}" data-p="${p.i}">${inl(p.label)}</button>`).join('');
    const src = String(d.image || d.src || '');
    const pic = d.svg ? String(d.svg) : src ? `<img src="${e(src)}" alt="${e(d.alt || d.title || '')}">` : d.photo ? `<img data-photo="${e(d.photo)}" alt="${e(d.alt || d.title || '')}">` : `<div class="fig-none">${e(t('iui_noPic'))}</div>`;
    return `<div class="root">${d.title ? `<h3>${inl(d.title)}</h3>` : ''}${d.lead ? `<p class="muted">${inl(d.lead)}</p>` : ''}
      <div class="fig"><div class="fig-stage"><div class="fig-labels l">${side(true)}</div>
        <div class="fig-img">${pic}${pts.map((p) => `<button class="pin" style="left:${p.x}%;top:${p.y}%" data-select="p:${p.i}" data-hover data-item="p:${p.i}" data-pin="${p.i}" aria-label="${e(p.label)}">${p.i + 1}</button>`).join('')}</div>
        <div class="fig-labels r">${side(false)}</div><svg class="fig-lines" aria-hidden="true"></svg></div>
      <div class="fig-cards">${pts.map((p) => `<div class="card" data-select="p:${p.i}" data-item="p:${p.i}"><i>${p.i + 1}</i><div><b>${inl(p.label)}</b>${p.text ? `<span>${inl(p.text)}</span>` : ''}</div></div>`).join('')}</div></div>
      ${d.note ? `<p class="muted">${inl(d.note)}</p>` : ''}</div>`;
  }
  function drawLines(root) {
    const stage = root.querySelector('.fig-stage'); const svg = root.querySelector('.fig-lines'); if (!stage || !svg) return;
    const box = stage.getBoundingClientRect(); if (!box.width) return;
    let out = '';
    for (const lab of root.querySelectorAll('.fig-label')) {
      const pin = root.querySelector(`.pin[data-pin="${lab.dataset.p}"]`); if (!pin) continue;
      const a = lab.getBoundingClientRect(), b = pin.getBoundingClientRect(); if (!a.width || !b.width) continue;
      const left = a.left < b.left; const x1 = (left ? a.right : a.left) - box.left, y1 = a.top + a.height / 2 - box.top, x2 = b.left + b.width / 2 - box.left, y2 = b.top + b.height / 2 - box.top;
      const mid = x1 + (left ? 14 : -14);
      out += `<path data-item="p:${lab.dataset.p}" class="${lab.classList.contains('on') ? 'on' : ''}" d="M ${x1.toFixed(1)} ${y1.toFixed(1)} L ${mid.toFixed(1)} ${y1.toFixed(1)} L ${x2.toFixed(1)} ${y2.toFixed(1)}"/>`;
    }
    svg.innerHTML = out;
  }

  // ── behaviour without script ──
  function apply(root, key) {
    const sel = SEL.get(key) || {}; const on = ON.get(key) || new Set();
    const groups = new Map();
    for (const n of root.querySelectorAll('[data-item]')) { const [g, name] = String(n.dataset.item).split(':'); if (!groups.has(g)) groups.set(g, []); groups.get(g).push([n, name || '']); }
    for (const [g, items] of groups) {
      let cur = sel[g];
      if (cur == null) { const pre = items.find(([n]) => n.classList.contains('on')); cur = pre ? pre[1] : items.some(([n]) => n.classList.contains('pane')) ? items[0][1] : null; if (cur != null) { sel[g] = cur; SEL.set(key, sel); } }
      for (const [n, name] of items) n.classList.toggle('on', cur != null && name === cur);
    }
    for (const n of root.querySelectorAll('[data-select]')) { const [g, name] = String(n.dataset.select).split(':'); if (!n.dataset.item) n.classList.toggle('on', sel[g] === (name || '')); }
    for (const n of root.querySelectorAll('[id]')) if (on.has(n.id)) n.classList.add('on');
  }
  function select(root, key, spec) {
    const [g, name] = String(spec).split(':'); const sel = SEL.get(key) || {}; if (sel[g] === (name || '')) return;
    sel[g] = name || ''; SEL.set(key, sel); apply(root, key);
  }
  function step(root, key, spec) {
    const [g, dir] = String(spec).split(':'); const names = [...new Set([...root.querySelectorAll('[data-item]')].filter((n) => String(n.dataset.item).split(':')[0] === g).map((n) => String(n.dataset.item).split(':')[1] || ''))];
    if (!names.length) return; const sel = SEL.get(key) || {}; const i = Math.max(0, names.indexOf(sel[g]));
    const j = /prev|-1/.test(dir) ? Math.max(0, i - 1) : /first/.test(dir) ? 0 : Math.min(names.length - 1, i + 1);
    select(root, key, `${g}:${names[j]}`);
  }
  function wire(root, key) {
    root.addEventListener('click', (ev) => {
      const el = ev.target.closest('[data-select], [data-toggle], [data-reveal], [data-step], a[href]'); if (!el) return;
      if (el.matches('a[href]')) { ev.preventDefault(); const h = el.getAttribute('href'); if (/^https?:/i.test(h) && window.api && api.shell) api.shell.open(h); return; }
      if (el.dataset.select) select(root, key, el.dataset.select);
      if (el.dataset.step) step(root, key, el.dataset.step);
      if (el.dataset.toggle) { const id = el.dataset.toggle.replace(/^#/, '').replace(/[^\w-]/g, ''); const tg = id && root.getElementById(id); if (tg) { const on = ON.get(key) || new Set(); tg.classList.toggle('on') ? on.add(id) : on.delete(id); ON.set(key, on); } }
      if (el.hasAttribute('data-reveal')) { el.classList.toggle('on'); for (const a of el.querySelectorAll('.answer')) a.classList.toggle('on', el.classList.contains('on')); }
      if (root.querySelector('.fig-lines')) drawLines(root);
    });
    root.addEventListener('mouseover', (ev) => { const el = ev.target.closest('[data-hover][data-select]'); if (el) { select(root, key, el.dataset.select); if (root.querySelector('.fig-lines')) drawLines(root); } });
  }
  // pictures: fabro-img:<id> (saved by web_images) and data-photo="words" are filled by the app
  function pictures(root) {
    const iui = window.api && api.iui;
    for (const im of root.querySelectorAll('img')) {
      const src = im.getAttribute('src') || '';
      const done = () => { if (root.querySelector('.fig-lines')) drawLines(root); };
      im.addEventListener('load', done, { once: true });
      im.addEventListener('error', () => { im.remove(); done(); }, { once: true }); // a picture that does not load leaves no broken icon
      if (!iui) continue;
      if (/^fabro-img:/.test(src)) { im.removeAttribute('src'); api.iui.img(src).then((u) => { if (u && /^data:/.test(u)) im.src = u; }).catch(() => {}); }
      else if (!src && im.dataset.photo) api.iui.photo(im.dataset.photo).then((p) => { if (p && p.url) im.src = p.url; }).catch(() => {});
    }
  }

  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver((es) => { for (const en of es) if (en.target.shadowRoot) drawLines(en.target.shadowRoot); }) : null;
  function mountOne(host) {
    const key = host.dataset.iui; const d = IUI.spec(key); if (!d) return;
    host.dataset.on = '1';
    const root = host.shadowRoot || host.attachShadow({ mode: 'open' });
    try { root.adoptedStyleSheets = [kit()]; } catch {}
    const fig = host.classList.contains('iui-figure');
    const frag = sanitize(fig ? figureDoc(d) : `${d.css ? `<style>${String(d.css)}</style>` : ''}${String(d.html || '')}`);
    root.replaceChildren(frag);
    wire(root, key); apply(root, key); pictures(root);
    if (fig) { drawLines(root); requestAnimationFrame(() => drawLines(root)); if (ro) ro.observe(host); }
  }
  function mount(scope) { for (const h of (scope || document).querySelectorAll('.iui-ui:not([data-on]), .iui-figure:not([data-on])')) { try { mountOne(h); } catch (err) { console.warn('iui', err); } } }

  IUI.add('ui', () => '', null, ['free', 'html-inline', 'component', 'layout-free']);
  IUI.add('figure', () => '', null, ['anatomy', 'annotated', 'hotspots', 'diagram']);
  // before the paint: the block never shows empty
  new MutationObserver(() => mount()).observe(document.documentElement, { childList: true, subtree: true });
  mount();
  // quick switch in the + menu of the composer (off: the model is no longer told about displays)
  IUI.plusItem = (tg) => `<button class="pm-item" data-action="iui-toggle">${icon('shapes', 16)}<span class="pm-text"><b>Intelligent UI</b><small>${e(t('iui_plusHint'))}</small></span>${tg(S.settings.intelligentUi !== false)}</button>`;
  if (typeof actions === 'object') actions['iui-toggle'] = async (el) => {
    await saveSettings({ intelligentUi: S.settings.intelligentUi === false });
    if (el.closest('.popover') && typeof openPlusMenu === 'function') openPlusMenu($('#composer [data-action=plus-menu]'));
  };
  IUI.free = { sanitize, cleanCss, figureDoc };
})();

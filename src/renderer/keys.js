/* Fabro keyboard layer: command palette, cheat sheet, vim-ish navigation, slash commands, and the terminal theme's
   status line. Navigation keys are on while the CLI theme is active (or when "Keyboard navigation" is on in the
   theme settings); the palette (Ctrl+Shift+P) and the cheat sheet (Ctrl+/) work in every theme.
   Rules: never steal a key while someone types in a field (only the documented chords work there), never touch
   Tab, keep a visible focus ring, announce nothing the screen reader would not read anyway. */
(function () {
  'use strict';
  if (typeof S === 'undefined' || !window.Themes) return;
  const $ = (s, r) => (r || document).querySelector(s), $$ = (s, r) => [...(r || document).querySelectorAll(s)];
  const root = document.documentElement;
  const enabled = () => Themes.keysOn();
  const typing = (el) => !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
  const blockers = () => $('#modal-root .modal') || $('#popover-root').innerHTML || S.settingsTab || $('#kb-layer');
  const mac = /Mac/i.test(navigator.platform);
  const MOD = mac ? '⌘' : 'Ctrl';

  // ───────── rows of the conversation list: focusable, one tab stop ─────────
  function decorate() {
    const list = $('#sb-lists'); if (!list) return;
    if (!enabled()) { list.removeAttribute('role'); $$('.recent[role]', list).forEach((r) => { r.removeAttribute('role'); r.removeAttribute('tabindex'); r.removeAttribute('aria-selected'); }); return; }
    list.setAttribute('role', 'listbox'); list.setAttribute('aria-label', t('chats'));
    const rows = $$('.recent', list);
    const stop = rows.find((r) => r.classList.contains('active')) || rows[0];
    rows.forEach((r) => { r.setAttribute('role', 'option'); r.setAttribute('aria-selected', r.classList.contains('active')); r.tabIndex = r === stop ? 0 : -1; });
  }
  const rows = () => $$('#sb-lists .recent');
  const cursor = () => document.activeElement && document.activeElement.closest && document.activeElement.closest('#sb-lists .recent');
  function moveCursor(d, to) {
    const r = rows(); if (!r.length) return;
    let i = cursor() ? r.indexOf(cursor()) : r.findIndex((x) => x.classList.contains('active'));
    i = to === 'first' ? 0 : to === 'last' ? r.length - 1 : clampI(i + d, r.length);
    r.forEach((x) => { x.tabIndex = -1; x.classList.remove('kb'); });
    r[i].tabIndex = 0; r[i].focus(); r[i].scrollIntoView({ block: 'nearest' });
  }
  const clampI = (i, n) => Math.max(0, Math.min(n - 1, i));
  function focusList() {
    if (document.body.classList.contains('sb-collapsed') || $('#app').classList.contains('sb-collapsed')) { if (typeof actions !== 'undefined' && actions['toggle-sidebar']) actions['toggle-sidebar'](); }
    setTimeout(() => { const r = rows(); const a = r.find((x) => x.classList.contains('active')) || r[0]; if (a) { a.tabIndex = 0; a.focus(); a.scrollIntoView({ block: 'nearest' }); } else $('#sb-q')?.focus(); }, 30);
  }
  const focusThread = () => { const s = $('#scroller'); if (s) { s.tabIndex = -1; s.focus({ preventScroll: true }); return true; } return false; };
  const focusComposer = () => { const p = $('#prompt'); if (p) { p.focus(); return true; } return false; };
  function stepConv(d) {
    const r = rows(); if (!r.length) return;
    const i = r.findIndex((x) => x.classList.contains('active'));
    const n = r[clampI((i < 0 ? (d > 0 ? -1 : r.length) : i) + d, r.length)];
    if (n) n.click();
  }

  // ───────── the status line (CLI theme) ─────────
  let lastStatus = '';
  function statusHTML() {
    const cm = typeof currentModel === 'function' ? currentModel() : null;
    const max = (S.settings.engine && S.settings.engine.ctx) || 8192;
    const used = typeof estimateTokens === 'function' ? estimateTokens() : 0;
    const p = Math.min(1, used / max);
    const last = S.conv && [...S.conv.messages].reverse().find((m) => m.stats && m.stats.tokPerSec);
    const sp = S.streaming ? t('kb_generating') : last ? `${last.stats.tokPerSec} tok/s` : '– tok/s';
    const who = typeof userFirstName === 'function' ? userFirstName() : '';
    const sep = '<span class="sep" aria-hidden="true"></span>';
    return `<span><b>${esc(cm ? cm.label : t('noModelShort'))}</b></span>${sep}`
      + `<span class="${p > 0.85 ? 'warn' : ''}">ctx <span class="meter" aria-hidden="true" style="--p:${Math.round(p * 100)}%"></span> ${Math.round(p * 100)}% <span class="opt">(${fmtNum(used)}/${fmtNum(max)})</span></span>${sep}`
      + `<span>${esc(sp)}</span>${sep}<span class="opt">${esc(who)}</span><span class="grow"></span>`
      + `<span class="hint opt">? ${esc(t('kb_help'))} · ${MOD}+K ${esc(t('kb_palette'))}</span>`;
  }
  function paintStatus() {
    let el = $('#cli-status');
    if (root.dataset.layout !== 'cli') { if (el) el.remove(); lastStatus = ''; return; }
    if (!el) { el = document.createElement('footer'); el.id = 'cli-status'; el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'off'); const main = $('.main'); if (!main) return; main.appendChild(el); lastStatus = ''; }
    const h = statusHTML(); if (h !== lastStatus) { el.innerHTML = h; lastStatus = h; }
  }
  let sT = 0; const schedule = () => { if (sT) return; sT = setTimeout(() => { sT = 0; paintStatus(); decorate(); }, 250); };
  new MutationObserver(schedule).observe($('#app'), { childList: true, subtree: true });
  Themes.onChange(() => { paintStatus(); decorate(); });

  // ───────── palette + cheat sheet ─────────
  let layer = null, prevFocus = null, previewing = null;
  function closeLayer(restore) {
    if (previewing) { Themes.show(previewing.id); previewing = null; }
    if (layer) { layer.remove(); layer = null; }
    if (restore !== false && prevFocus && document.contains(prevFocus)) prevFocus.focus();
    prevFocus = null;
  }
  const fuzzy = (q, s) => { // subsequence score; -1 when it doesn't match
    q = q.toLowerCase(); s = s.toLowerCase(); if (!q) return 0;
    const at = s.indexOf(q); if (at >= 0) return 1000 - at;
    let i = 0, score = 0, last = -2;
    for (let k = 0; k < s.length && i < q.length; k++) if (s[k] === q[i]) { score += k === last + 1 ? 3 : 1; last = k; i++; }
    return i === q.length ? score : -1;
  };
  function openLayer(kind) {
    if (layer) closeLayer(false);
    prevFocus = document.activeElement;
    layer = document.createElement('div'); layer.id = 'kb-layer'; layer.className = 'kb-layer';
    document.body.appendChild(layer);
    return layer;
  }
  function mkItem(label, o) { return { label, hint: o.hint || '', run: o.run, keep: o.keep, group: o.group || '', mark: o.mark, id: o.id, search: o.search || label }; }
  function actionItems() {
    const mode = S.settings.theme;
    const A = [
      mkItem(t('newChat'), { hint: MOD + '+N', run: () => newChat(), group: 'a' }),
      mkItem(t('kb_changeTheme'), { run: () => openPalette('themes'), keep: true, group: 'a', search: t('kb_changeTheme') + ' theme thème apparence' }),
      mkItem(t('th_title') + '…', { run: () => Themes.openGallery && Themes.openGallery(), group: 'a', search: t('th_title') + ' themes thèmes import export gallery galerie' }),
      mkItem(t('searchChats'), { hint: '', run: () => { if ($('#app').classList.contains('sb-collapsed')) actions['toggle-sidebar'](); setTimeout(() => $('#sb-q')?.focus(), 40); }, group: 'a' }),
      mkItem(t('kb_toggleSidebar'), { hint: MOD + '+B', run: () => actions['toggle-sidebar'](), group: 'a' }),
      mkItem(t('settings'), { hint: MOD + '+,', run: () => openSettings('general'), group: 'a' }),
      mkItem(t('kb_pickModel'), { run: () => { const b = $('.model-pill') || $('[data-action="model-menu"]'); if (b) actions['model-menu'](b); }, group: 'a', search: t('kb_pickModel') + ' model modèle' }),
      mkItem(t('vx_title'), { run: () => actions['voice-mode'] && actions['voice-mode'](), group: 'a', search: 'voice voix' }),
      mkItem(t('kb_modeLight'), { run: () => applySetting('theme', 'light'), group: 'm', mark: mode === 'light', search: 'light clair mode' }),
      mkItem(t('kb_modeDark'), { run: () => applySetting('theme', 'dark'), group: 'm', mark: mode === 'dark', search: 'dark sombre mode' }),
      mkItem(t('kb_modeSystem'), { run: () => applySetting('theme', 'system'), group: 'm', mark: mode === 'system', search: 'system système mode' }),
      mkItem(t(Themes.keysOn() ? 'kb_keysOff' : 'kb_keysOn'), { run: () => Themes.setKeys(Themes.keysOn() ? 'off' : 'on'), group: 'm', search: 'keyboard clavier navigation vim' }),
      mkItem(t('kb_cheat'), { hint: '?', run: () => openCheat(), group: 'm', search: 'shortcuts raccourcis keys help aide' }),
    ];
    const convs = (S.convs || []).slice(0, 60).map((c) => mkItem(c.title || t('untitled'), { group: 'c', run: () => { const r = rows().find((x) => x.dataset.id === c.id); if (r) r.click(); else if (typeof openConv === 'function') openConv(c.id); }, search: c.title || '' }));
    return A.concat(convs);
  }
  function themeItems() {
    return Themes.all().map((m) => mkItem(Themes.label(m), { id: m.id, group: 't', mark: Themes.current() === m.id, hint: m.base === 'both' ? '' : t(m.base === 'dark' ? 'kb_darkOnly' : 'kb_lightOnly'), search: Themes.label(m) + ' ' + (Themes.describe(m) || ''), run: () => Themes.set(m.id) }));
  }
  function openPalette(kind) {
    kind = kind === 'themes' ? 'themes' : 'all';
    const el = openLayer();
    const origTheme = Themes.current();
    el.innerHTML = `<div class="kb-back" data-kb="close"></div>
      <div class="kb-box" role="dialog" aria-modal="true" aria-label="${esc(t(kind === 'themes' ? 'kb_changeTheme' : 'kb_palette'))}">
        <label class="kb-in"><span class="kb-prompt" aria-hidden="true">${kind === 'themes' ? '◐' : '›'}</span>
          <input id="kb-q" type="text" autocomplete="off" spellcheck="false" role="combobox" aria-expanded="true" aria-controls="kb-list" aria-autocomplete="list" placeholder="${esc(t(kind === 'themes' ? 'kb_themePh' : 'kb_palettePh'))}"></label>
        <div id="kb-list" class="kb-list" role="listbox"></div>
        <div class="kb-foot"><span>↑↓ ${esc(t('kb_choose'))}</span><span>↵ ${esc(t('kb_run'))}</span><span>esc ${esc(t('kb_close'))}</span></div>
      </div>`;
    const q = $('#kb-q', el), list = $('#kb-list', el);
    let items = kind === 'themes' ? themeItems() : actionItems(), shown = [], sel = 0, pv = 0;
    const paint = () => {
      const v = q.value.trim();
      shown = items.map((it) => ({ it, s: fuzzy(v, it.search) })).filter((x) => x.s >= 0);
      if (v) shown.sort((a, b) => b.s - a.s);
      shown = shown.map((x) => x.it).slice(0, 40);
      sel = Math.min(sel, Math.max(0, shown.length - 1));
      let g = '';
      list.innerHTML = shown.map((it, i) => {
        const head = !v && kind === 'all' && it.group !== g ? `<div class="kb-sec" role="presentation">${esc(t(it.group === 'c' ? 'chats' : it.group === 'm' ? 'kb_secMode' : 'kb_secActions'))}</div>` : ''; g = it.group;
        return `${head}<div class="kb-opt" role="option" id="kb-o${i}" data-i="${i}" aria-selected="${i === sel}">${it.mark != null ? `<span class="kb-mark" aria-hidden="true">${it.mark ? '●' : ' '}</span>` : ''}<span class="kb-l">${esc(it.label)}</span>${it.hint ? `<kbd>${esc(it.hint)}</kbd>` : ''}</div>`;
      }).join('') || `<div class="kb-none">${esc(t('noResults'))}</div>`;
      mark();
    };
    const mark = () => {
      $$('.kb-opt', list).forEach((o) => o.setAttribute('aria-selected', o.dataset.i == sel));
      const cur = $(`#kb-o${sel}`, list); q.setAttribute('aria-activedescendant', cur ? cur.id : '');
      if (cur) cur.scrollIntoView({ block: 'nearest' });
      if (kind === 'themes' && shown[sel] && shown[sel].id) { // live preview while arrowing; Esc puts it back
        clearTimeout(pv); const id = shown[sel].id; pv = setTimeout(() => { if (layer && Themes.current() !== id) { previewing = previewing || { id: origTheme }; Themes.show(id); } }, 70);
      }
    };
    const run = (it) => {
      if (!it) return;
      if (kind === 'themes') previewing = null; // the choice is saved by Themes.set
      const keep = it.keep; closeLayer(!keep);
      if (keep) { it.run(); return; }
      setTimeout(() => it.run(), 0);
    };
    q.addEventListener('input', () => { sel = 0; paint(); });
    q.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'n') || (e.ctrlKey && e.key === 'j')) { e.preventDefault(); sel = shown.length ? (sel + 1) % shown.length : 0; mark(); }
      else if (e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'p') || (e.ctrlKey && e.key === 'k')) { e.preventDefault(); sel = shown.length ? (sel + shown.length - 1) % shown.length : 0; mark(); }
      else if (e.key === 'Enter') { e.preventDefault(); run(shown[sel]); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeLayer(); }
      else if (e.key === 'Tab') e.preventDefault();
    });
    el.addEventListener('click', (e) => { if (e.target.closest('[data-kb="close"]')) closeLayer(); const o = e.target.closest('.kb-opt'); if (o) run(shown[+o.dataset.i]); });
    el.addEventListener('mousemove', (e) => { const o = e.target.closest('.kb-opt'); if (o && +o.dataset.i !== sel) { sel = +o.dataset.i; $$('.kb-opt', list).forEach((x) => x.setAttribute('aria-selected', x === o)); } });
    paint(); q.focus();
  }
  const KEYS = () => [
    [t('kb_gNav'), [['j  k  ↑  ↓', t('kb_kMove')], ['Enter  l', t('kb_kOpen')], ['[  ]', t('kb_kPrevNext')], ['h', t('kb_kList')], ['g g  ·  G', t('kb_kTopBottom')], ['/', t('kb_kCompose')], ['i', t('kb_kCompose2')], ['Esc', t('kb_kUp')]]],
    [t('kb_gAny'), [[MOD + '+K  ·  ' + MOD + '+Shift+P  ·  :', t('kb_palette')], [MOD + '+N', t('newChat')], [MOD + '+B', t('kb_toggleSidebar')], [MOD + '+,', t('settings')], ['?  ·  ' + MOD + '+/', t('kb_cheat')]]],
    [t('kb_gSlash'), [['/new  /clear', t('kb_cNew')], ['/theme  [' + t('kb_name') + ']', t('kb_cTheme')], ['/model', t('kb_cModel')], ['/settings', t('settings')], ['/voice', t('vx_title')], ['/keys', t('kb_cheat')]]],
  ];
  function openCheat() {
    const el = openLayer();
    el.innerHTML = `<div class="kb-back" data-kb="close"></div>
      <div class="kb-box kb-cheat" role="dialog" aria-modal="true" aria-labelledby="kb-ct" tabindex="-1">
        <h2 id="kb-ct">${esc(t('kb_cheat'))}</h2>
        <p class="kb-note">${esc(enabled() ? t('kb_noteOn') : t('kb_noteOff'))}</p>
        ${KEYS().map(([h, rowsK]) => `<section><h3>${esc(h)}</h3><dl>${rowsK.map(([k, d]) => `<dt>${esc(k)}</dt><dd>${esc(d)}</dd>`).join('')}</dl></section>`).join('')}
        <div class="kb-foot"><span>esc ${esc(t('kb_close'))}</span></div>
      </div>`;
    el.addEventListener('click', (e) => { if (e.target.closest('[data-kb="close"]')) closeLayer(); });
    el.addEventListener('keydown', (e) => { if (e.key === 'Escape' || e.key === '?' || e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); closeLayer(); } else if (e.key === 'Tab') e.preventDefault(); });
    $('.kb-box', el).focus();
  }

  // ───────── keys ─────────
  let chord = 0;
  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented && !layer) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key;
    // chords that work everywhere, even while typing
    if (mod && e.shiftKey && (k === 'P' || k === 'p')) { e.preventDefault(); e.stopImmediatePropagation(); layer ? closeLayer() : openPalette('all'); return; }
    if (mod && k === '/') { e.preventDefault(); e.stopImmediatePropagation(); layer ? closeLayer() : openCheat(); return; }
    if (mod && !e.shiftKey && !e.altKey && (k === 'k' || k === 'K') && enabled()) { e.preventDefault(); e.stopImmediatePropagation(); layer ? closeLayer() : openPalette('all'); return; }
    if (layer) return; // the palette owns the keyboard
    if (!enabled()) return;
    const tgt = e.target;
    if (k === 'Escape') {
      if (blockers() || S.viewer || S.streaming || (typeof S.modView !== 'undefined' && S.modView)) return; // the app closes those first
      if (typing(tgt)) { if (tgt.id === 'prompt' || tgt.id === 'sb-q') { e.preventDefault(); (tgt.id === 'sb-q' ? focusList : (focusThread() || focusList))(); } return; }
      if (tgt.closest && tgt.closest('#sidebar')) { e.preventDefault(); document.activeElement.blur(); return; }
      if (tgt.id === 'scroller' || tgt === document.body) { e.preventDefault(); focusList(); }
      return;
    }
    if (mod || e.altKey || typing(tgt) || blockers()) return;
    const inList = !!cursor();
    const free = tgt === document.body || tgt.id === 'scroller' || inList; // not on a button/link: arrows are ours
    const scroller = $('#scroller');
    const step = (dy) => { if (scroller) scroller.scrollBy({ top: dy, behavior: 'auto' }); };
    if (k !== 'g') chord = 0;
    switch (k) {
      case 'j': case 'ArrowDown': if (k === 'ArrowDown' && !free) return; e.preventDefault(); inList ? moveCursor(1) : step(56); break;
      case 'k': case 'ArrowUp': if (k === 'ArrowUp' && !free) return; e.preventDefault(); inList ? moveCursor(-1) : step(-56); break;
      case 'h': case 'ArrowLeft': if (k === 'ArrowLeft' && !free) return; e.preventDefault(); focusList(); break;
      case 'l': case 'ArrowRight': if (k === 'ArrowRight' && !free) return; e.preventDefault(); if (inList) cursor().click(); else focusComposer(); break;
      case 'Enter': if (inList) { e.preventDefault(); cursor().click(); } else if (tgt === document.body || tgt.id === 'scroller') { e.preventDefault(); focusComposer(); } break;
      case ' ': if (inList) { e.preventDefault(); cursor().click(); } break;
      case 'g': if (!free) return; e.preventDefault(); if (Date.now() - chord < 650) { chord = 0; inList ? moveCursor(0, 'first') : (scroller && (scroller.scrollTop = 0)); } else chord = Date.now(); break;
      case 'G': if (!free) return; e.preventDefault(); inList ? moveCursor(0, 'last') : (scroller && (scroller.scrollTop = scroller.scrollHeight)); break;
      case '[': e.preventDefault(); stepConv(-1); break;
      case ']': e.preventDefault(); stepConv(1); break;
      case '/': focusComposer(); break; // not prevented: the slash lands in the composer, ready for a command
      case 'i': if (tgt === document.body || tgt.id === 'scroller') { e.preventDefault(); focusComposer(); } break;
      case '?': e.preventDefault(); openCheat(); break;
      case ':': e.preventDefault(); openPalette('all'); break;
    }
  }, true);

  // ───────── slash commands (reuse the composer's command menu from mods-ui) ─────────
  function register() {
    const F = window.fabro; if (!F || !F.commands) return false;
    const reg = (name, description, run) => F.commands.register(name, { description, run, builtin: true });
    reg('new', t('newChat'), () => newChat());
    reg('clear', t('kb_cNew'), () => newChat());
    reg('settings', t('settings'), () => openSettings('general'));
    reg('model', t('kb_cModel'), () => { const b = $('.model-pill') || $('[data-action="model-menu"]'); if (b) actions['model-menu'](b); });
    reg('voice', t('vx_title'), () => actions['voice-mode'] && actions['voice-mode']());
    reg('keys', t('kb_cheat'), () => openCheat());
    reg('theme', t('kb_cTheme'), async (rest) => {
      if (!rest) return openPalette('themes');
      const q = rest.toLowerCase();
      const m = Themes.all().map((x) => ({ x, s: fuzzy(q, Themes.label(x)) })).filter((r) => r.s >= 0).sort((a, b) => b.s - a.s)[0];
      if (!m) { toast(t('kb_noTheme', { q: rest }), 'err'); return; }
      await Themes.set(m.x.id); toast(t('kb_themeOn', { n: Themes.label(m.x) }));
    });
    return true;
  }
  if (!register()) window.addEventListener('DOMContentLoaded', register);

  window.Palette = { open: openPalette, cheat: openCheat, close: closeLayer };
  setTimeout(() => { paintStatus(); decorate(); }, 0);
})();

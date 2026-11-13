/* Fabro themes — the engine (renderer). A theme is a manifest (themes-core.js documents the format) applied as
   <html data-skin="id"> + one generated <style> of custom properties + (built-in themes only) one shipped sheet
   under styles/themes/. It is independent from light/dark/system: a theme that supports both follows the mode.
   Used by index.html, quick.html and accounts.html. The seasonal Halloween skin keeps its own logic in app.js;
   an explicit theme wins over it. */
(function () {
  'use strict';
  const C = window.ThemesCore, D = window.ThemesData;
  if (!C || !D) return;
  const root = document.documentElement;
  const LS = 'fabro.skin';
  const hasApp = typeof S !== 'undefined' && S && typeof api !== 'undefined';
  const mq = matchMedia('(prefers-color-scheme: dark)');
  const listeners = new Set();
  let user = [];                 // sanitised user themes of this account
  let currentId = root.dataset.skin && root.dataset.skin !== 'halloween' ? root.dataset.skin : 'fabro'; // the boot cache may have painted one already
  let sheetP = {};               // sheet name → load promise

  const T = {};
  const builtins = D.BUILTIN.map((m) => C.sanitize(m, { builtin: true }).theme).filter(Boolean);

  T.all = () => [...builtins, ...user];
  T.get = (id) => T.all().find((m) => m.id === id) || null;
  T.current = () => currentId;
  T.isBuiltin = (id) => builtins.some((m) => m.id === id);
  T.label = (m) => (typeof m.name === 'string' ? m.name : (m.name[(window.S && S.lang) || 'en'] || m.name.en));
  T.describe = (m) => (!m.desc ? '' : typeof m.desc === 'string' ? m.desc : (m.desc[(window.S && S.lang) || 'en'] || m.desc.en));
  T.onChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
  // Fabro's own look is tokens.css; to draw a preview of it in the other mode we derive from its seeds
  const FABRO_SEEDS = { light: { bg: '#f7f5f0', panel: '#efece5', elev: '#fffefb', text: '#211f1b', accent: '#bf5b30', 'accent-ink': '#ffffff' }, dark: { bg: '#11151c', panel: '#0d1016', elev: '#1a1f28', text: '#f2efe9', accent: '#ff6a4d', 'accent-ink': '#14161b' } };
  T.FABRO_SEEDS = FABRO_SEEDS;
  T.tokensFor = (id, mode) => { const m = T.get(id); return m && (id !== 'fabro') ? C.resolveTokens(m, C.modeFor(m, mode === 'dark')) : null; };
  // everything a small live preview needs: the theme's tokens, fonts and texture for one mode, as { '--name': value }
  T.previewVars = function (id, wantDark) {
    const m = T.get(id) || T.get('fabro');
    const mode = C.modeFor(m, wantDark);
    const out = {};
    const t = id === 'fabro' ? C.resolveTokens({ palette: FABRO_SEEDS, tokens: {} }, mode) : C.resolveTokens(m, mode);
    Object.keys(t).forEach((k) => { out['--' + k] = t[k]; });
    Object.keys(m.fonts || {}).forEach((k) => { out['--' + C.FONT_KEYS[k]] = m.fonts[k]; });
    if (m.texture) { const img = C.textureImage(m.texture, t.text || '#000'); if (img) out['--texture'] = img.image; }
    return { vars: out, mode, layout: m.layout || '', texLayer: m.texture ? m.texture.layer : '' };
  };

  const userMode = () => {
    const th = hasApp && S.settings ? S.settings.theme : 'system';
    return th === 'dark' || th === 'halloween' || (th !== 'light' && mq.matches);
  };
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches || root.classList.contains('reduce-motion') || root.classList.contains('light-mode');

  function sheet(name) { // shipped stylesheet of a built-in theme; kept loaded once fetched, enabled only while in use
    if (!name) return Promise.resolve();
    if (sheetP[name]) return sheetP[name];
    let l = document.getElementById('fabro-skin-sheet');
    if (!l || l.dataset.sheet !== name) {
      if (l) l.remove();
      l = document.createElement('link'); l.rel = 'stylesheet'; l.id = 'fabro-skin-sheet'; l.dataset.sheet = name; l.href = 'styles/themes/' + name;
      document.head.appendChild(l);
    }
    sheetP[name] = new Promise((res) => { if (l.sheet) res(); else { l.addEventListener('load', () => res()); l.addEventListener('error', () => res()); setTimeout(res, 1500); } });
    return sheetP[name];
  }
  function dropSheet() { const l = document.getElementById('fabro-skin-sheet'); if (l) l.remove(); sheetP = {}; }

  // Synchronous part: nothing here awaits, so a view transition can wrap it.
  function paint(m, wantDark) {
    let st = document.getElementById('fabro-skin');
    if (!m || m.id === 'fabro') {
      if (st) st.remove();
      const hw = hasApp && S.settings && S.settings.theme === 'halloween';
      if (hw) root.dataset.skin = 'halloween'; else delete root.dataset.skin;
      root.dataset.theme = (wantDark || hw) ? 'dark' : 'light';
      delete root.dataset.layout; delete root.dataset.tex;
      try { localStorage.removeItem(LS); } catch {}
      return;
    }
    const mode = C.modeFor(m, wantDark);
    const css = C.compile(m);
    if (!st) { st = document.createElement('style'); st.id = 'fabro-skin'; document.head.appendChild(st); }
    st.textContent = css;
    root.dataset.skin = m.id; root.dataset.theme = mode;
    if (m.layout) root.dataset.layout = m.layout; else delete root.dataset.layout;
    if (m.texture && m.texture.layer === 'over') root.dataset.tex = 'over'; else delete root.dataset.tex;
    try { localStorage.setItem(LS, JSON.stringify({ id: m.id, css, mode, layout: m.layout || '', over: !!(m.texture && m.texture.layer === 'over'), sheet: m.css || '' })); } catch {}
    return mode;
  }

  // Apply the account's theme now (called by applyTheme, boot, and the picker). Returns true when a theme is active.
  T.apply = function (opts) {
    const id = (hasApp && S.settings && S.settings.skin && S.settings.skin.id) || currentId || 'fabro';
    return T.show(id, opts);
  };
  T.show = function (id, opts) {
    opts = opts || {};
    const m = T.get(id) || T.get('fabro');
    const wantDark = userMode();
    const prev = currentId;
    currentId = m.id;
    const run = () => {
      const mode = paint(m, wantDark);
      if (mode && hasApp) { try { api.win.theme(mode === 'dark'); } catch {} }
      if (m.id !== 'fabro' || prev !== 'fabro') listeners.forEach((fn) => { try { fn(m); } catch (e) { console.error(e); } });
    };
    if (m.id === 'fabro') {
      if (opts.animate && prev !== 'fabro') return transition(() => { run(); dropSheet(); }), false;
      run(); if (prev !== 'fabro') dropSheet(); return false;
    }
    if (!m.css) dropSheet();
    const ready = m.css ? sheet(m.css) : Promise.resolve();
    if (opts.animate) ready.then(() => transition(run)); else run();
    return true;
  };
  function transition(fn) {
    if (!document.startViewTransition || reduced() || document.hidden) { fn(); return; }
    root.dataset.vt = 'skin';
    const vt = document.startViewTransition(fn);
    vt.ready.catch(() => {}); vt.updateCallbackDone.catch(() => {});
    vt.finished.catch(() => {}).finally(() => { if (root.dataset.vt === 'skin') delete root.dataset.vt; });
  }

  // ───────── choosing, importing, exporting (main window) ─────────
  const save = (patch) => (hasApp ? saveSettings({ skin: patch }) : Promise.resolve());
  T.set = async function (id) {
    if (!T.get(id)) return;
    S.settings.skin = { ...(S.settings.skin || {}), id };
    T.show(id, { animate: true });
    await save({ id });
  };
  T.keysMode = () => (hasApp && S.settings.skin && S.settings.skin.keys) || 'auto';
  T.setKeys = async (mode) => { S.settings.skin = { ...(S.settings.skin || {}), keys: mode }; await save({ keys: mode }); listeners.forEach((fn) => fn(T.get(currentId))); };
  T.keysOn = () => { const k = T.keysMode(); const m = T.get(currentId); return k === 'on' || (k === 'auto' && !!(m && m.layout === 'cli')); };

  T.loadUser = function (list) {
    user = [];
    for (const raw of list || []) { const r = C.sanitize(raw); if (r.ok) user.push(r.theme); }
  };
  async function persistUser() { S.settings.skin = { ...(S.settings.skin || {}), user }; await save({ user }); }
  // text of a .fabrotheme.json → { ok, theme, warnings } (the theme is added and selected)
  T.import = async function (text, opts) {
    const r = C.sanitize(text, { imported: true });
    if (!r.ok) return r;
    let m = r.theme;
    const base = m.id; let n = 2;
    while (T.get(m.id)) { m = { ...m, id: base + '-' + n++ }; }   // never replace a theme silently
    user.push(m);
    await persistUser();
    if (!opts || opts.select !== false) await T.set(m.id);
    return { ok: true, theme: m, warnings: r.warnings };
  };
  T.update = async function (m) { // editor: replace a user theme (re-sanitised)
    const r = C.sanitize({ ...m, id: m.id.replace(/^u-/, '') }, { imported: true });
    if (!r.ok) return r;
    const i = user.findIndex((x) => x.id === m.id);
    const nm = { ...r.theme, id: m.id };
    if (i >= 0) user[i] = nm; else user.push(nm);
    await persistUser();
    if (currentId === m.id) T.show(m.id, { animate: false });
    return { ok: true, theme: nm, warnings: r.warnings };
  };
  T.duplicate = async function (id, name) {
    const src = T.get(id); if (!src) return null;
    const base = JSON.parse(JSON.stringify(src));
    delete base.builtin; delete base.css;
    base.name = name || (T.label(src) + ' 2'); base.author = '';
    // a built-in with no palette (Fabro itself) is duplicated from the app's own light/dark tokens
    if (!Object.keys(base.palette || {}).length && !(base.tokens && base.tokens.all && base.tokens.all.bg)) {
      base.palette = { light: { bg: '#f7f5f0', panel: '#efece5', elev: '#fffefb', text: '#211f1b', accent: '#bf5b30', 'accent-ink': '#ffffff' }, dark: { bg: '#11151c', panel: '#0d1016', elev: '#1a1f28', text: '#f2efe9', accent: '#ff6a4d', 'accent-ink': '#14161b' } };
    }
    const r = await T.import(JSON.stringify({ ...base, id: slugName(base.name) }), { select: true });
    return r.ok ? r.theme : null;
  };
  const slugName = (s) => String(typeof s === 'string' ? s : s.en).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'theme';
  T.remove = async function (id) {
    if (T.isBuiltin(id)) return;
    user = user.filter((m) => m.id !== id);
    await persistUser();
    if (currentId === id) await T.set('fabro');
  };
  T.exportText = (id) => { const m = T.get(id); return m ? C.exportTheme(m) : ''; };
  T.exportFile = function (id) {
    const m = T.get(id); if (!m) return;
    const blob = new Blob([C.exportTheme(m)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = slugName(m.name) + '.fabrotheme.json';
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  // follow the system light/dark preference while a "both" theme is active
  mq.addEventListener && mq.addEventListener('change', () => { if (currentId !== 'fabro') T.show(currentId); });

  // ───────── standalone windows (quick bar, account picker) ─────────
  T.standalone = async function () {
    // the boot cache already painted the last theme; the quick bar asks the open account for the truth
    try {
      if (typeof api !== 'undefined' && api.settings && api.settings.get) {
        const s = await api.settings.get();
        T.loadUser(s.skin && s.skin.user);
        const id = (s.skin && s.skin.id) || 'fabro';
        const dark = s.theme === 'dark' || (s.theme !== 'light' && mq.matches);
        currentId = id;
        const m = T.get(id) || T.get('fabro');
        if (m.css) await sheet(m.css);
        paint(m, dark);
        if (m.id === 'fabro') dropSheet();
        return m;
      }
    } catch (e) { /* picker: no open account yet — the cache is all we have */ }
  };

  // quick bar / picker set data-theme from the system preference themselves: a theme that is light- or dark-only keeps its mode
  if (!hasApp) new MutationObserver(() => {
    const m = T.get(currentId); if (!m || m.id === 'fabro' || m.base === 'both') return;
    if (root.dataset.theme !== m.base) root.dataset.theme = m.base;
  }).observe(root, { attributes: true, attributeFilter: ['data-theme'] });

  // ───────── hook into the app ─────────
  if (hasApp && typeof window.applyTheme === 'function') {
    const orig = window.applyTheme;
    window.applyTheme = function () {
      orig.apply(this, arguments);
      T.loadUser(S.settings && S.settings.skin && S.settings.skin.user);
      T.apply({ animate: false });
    };
    // first paint already happened with the default tokens if the cache was empty: apply once settings are in
    if (S.settings) window.applyTheme();
  }

  window.Themes = Object.assign(window.Themes || {}, T);
})();

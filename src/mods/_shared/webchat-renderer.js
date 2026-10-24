// Shared UI part of the web chat mods. Each mod's renderer.js calls FabroWebChat(fabro, { name, command, … }).
window.FabroWebChat = window.FabroWebChat || function FabroWebChat(fabro, cfg) {
  const L = {
    en: {
      desc: `Ask ${cfg.name} (opens ${cfg.site})`, signIn: `Sign in to ${cfg.name}`, connected: `${cfg.name} is connected. Type ${cfg.command} followed by your message.`, needLogin: `Sign in to ${cfg.name} first.`,
      setupTitle: `Connect ${cfg.name}`, setupBody: `Open ${cfg.site} inside Fabro and sign in, or import your sign-in from a browser where you are already signed in.`,
      impFrom: 'Import from a browser', signInBtn: 'Sign in in Fabro', importing: 'Importing…', imported: `Imported — ${cfg.name} is connected.`, importNone: `No sign-in for ${cfg.site} found in that browser. Open it there, or sign in in Fabro.`, importAppBound: `This Chrome uses App-Bound Encryption, which locks its cookies to Chrome itself. Import from Firefox or Opera, or sign in in Fabro.`, importErr: 'Import failed: {e}', noBrowsers: 'No browser with a saved sign-in was found.', profile: 'Profile', cancel: 'Cancel',
    },
    fr: {
      desc: `Demander à ${cfg.name} (ouvre ${cfg.site})`, signIn: `Connexion à ${cfg.name}`, connected: `${cfg.name} est connecté. Tapez ${cfg.command} suivi de votre message.`, needLogin: `Connectez-vous d’abord à ${cfg.name}.`,
      setupTitle: `Connecter ${cfg.name}`, setupBody: `Ouvrez ${cfg.site} dans Fabro et connectez-vous, ou importez votre connexion depuis un navigateur où vous êtes déjà connecté.`,
      impFrom: 'Importer depuis un navigateur', signInBtn: 'Se connecter dans Fabro', importing: 'Import…', imported: `Importé — ${cfg.name} est connecté.`, importNone: `Aucune connexion à ${cfg.site} trouvée dans ce navigateur. Ouvrez-le là-bas, ou connectez-vous dans Fabro.`, importAppBound: `Ce Chrome utilise le chiffrement App-Bound, qui verrouille ses cookies à Chrome. Importez depuis Firefox ou Opera, ou connectez-vous dans Fabro.`, importErr: 'Échec de l’import : {e}', noBrowsers: 'Aucun navigateur avec une connexion enregistrée n’a été trouvé.', profile: 'Profil', cancel: 'Annuler',
    },
  };
  const tr = (k, v) => { let s = (L[fabro.S.lang] || L.en)[k] || L.en[k] || k; if (v) s = s.replace(/\{(\w+)\}/g, (_, x) => v[x] ?? ''); return s; };
  const esc = fabro.esc, icon = fabro.icon;
  let st = { connected: false, chats: [], icon: '' };

  const open = (sidebar, title) => fabro.view.open({ title: title || cfg.name, sidebar });

  fabro.commands.register(cfg.command, {
    description: tr('desc'),
    get icon() { return st.icon; },
    async run(text) {
      if (!st.connected) { st = await fabro.call('state'); }
      if (!st.connected) { fabro.toast(tr('needLogin')); return connect(); }
      open('hide');                       // new chat: the site takes the whole chat area
      const r = await fabro.call('newChat', text);
      if (r && r.ok === false) fabro.toast(`${cfg.name}: ${r.reason}`, 'err');
    },
  });

  // Appears in the model picker: selecting it and sending a message talks to the site directly (no /command).
  const runChat = async (text) => {
    if (!st.connected) st = await fabro.call('state');
    if (!st.connected) { fabro.toast(tr('needLogin')); return connect(); }
    open('hide');
    const r = await fabro.call('newChat', text);
    if (r && r.ok === false) fabro.toast(`${cfg.name}: ${r.reason}`, 'err');
  };
  fabro.models.register({ id: fabro.id, label: cfg.name, sub: cfg.site, get icon() { return st.icon; }, connected: () => st.connected, run: runChat });

  fabro.history.register({
    label: cfg.name,
    list: () => st.chats.map((c) => ({ id: c.id, title: c.title, updatedAt: c.updatedAt, href: c.href, icon: st.icon })),
    open: (it) => { open('keep'); fabro.call('openChat', it.id); }, // from the history: the sidebar stays open
  });

  async function login() { open('hide', tr('signIn')); await fabro.call('login'); }

  // Connect flow: offer "import from a browser you're already signed in to" before the login page.
  async function connect() {
    let browsers = [];
    try { browsers = await fabro.call('browsers'); } catch {}
    if (!browsers.length) return login();
    openChooser(browsers);
  }
  const BIG = { chrome: '#4285F4', firefox: '#ff7139', librewolf: '#00acff', edge: '#0c88e8', brave: '#fb542b', chromium: '#4587f3', vivaldi: '#ef3939', opera: '#fa1e4e' };
  function openChooser(browsers) {
    const sel = {}; browsers.forEach((b) => { sel[b.id] = b.profiles[0] ? b.profiles[0].name : 'Default'; });
    const root = document.getElementById('modal-root');
    const render = (busy) => {
      root.innerHTML = `<div class="modal-backdrop" data-wc="cancel"></div>
        <div class="modal wc-import" role="dialog" aria-modal="true">
          <div class="wc-hero">${st.icon ? `<img src="${esc(st.icon)}" width="34" height="34" alt="">` : icon('puzzle', 30)}<div><h2>${esc(tr('setupTitle'))}</h2><small>${esc(tr('setupBody'))}</small></div></div>
          <div class="wc-browsers">${browsers.map((b) => `<div class="wc-b">
              <span class="wc-ic" style="background:${BIG[b.id] || 'var(--accent)'}">${esc(b.name[0])}</span>
              <div class="wc-bt"><b>${esc(b.name)}</b>${b.profiles.length > 1 ? `<select class="input sm2" data-wc-prof="${esc(b.id)}">${b.profiles.map((p) => `<option ${sel[b.id] === p.name ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>` : ''}</div>
              <button class="btn sm primary" data-wc-imp="${esc(b.id)}" ${busy ? 'disabled' : ''}>${busy === b.id ? tr('importing') : tr('impFrom')}</button>
            </div>`).join('')}</div>
          <div class="modal-actions"><button class="btn" data-wc="cancel">${esc(tr('cancel'))}</button><button class="btn" data-wc="login">${icon('globe', 14)} ${esc(tr('signInBtn'))}</button></div>
        </div>`;
      root.querySelectorAll('[data-wc-prof]').forEach((s2) => s2.onchange = () => { sel[s2.dataset.wcProf] = s2.value; });
      root.querySelectorAll('[data-wc]').forEach((b) => b.onclick = () => { const a = b.dataset.wc; root.innerHTML = ''; if (a === 'login') login(); });
      root.querySelectorAll('[data-wc-imp]').forEach((b) => b.onclick = () => doImport(b.dataset.wcImp, sel[b.dataset.wcImp]));
    };
    const doImport = async (browser, profile) => {
      render(browser);
      try {
        const r = await fabro.call('importCookies', { browser, profile });
        if (r && r.connected) { root.innerHTML = ''; fabro.toast(tr('imported')); fabro.view.close(); }
        else { render(false); fabro.toast(tr(r && r.appBound ? 'importAppBound' : 'importNone'), 'err'); }
      } catch (e) { render(false); fabro.toast(tr('importErr', { e: String(e && e.message || e) }), 'err'); }
    };
    render(false);
  }

  fabro.on('setup', connect);
  fabro.on('login-done', () => { st.connected = true; fabro.toast(tr('connected')); fabro.view.close(); });
  fabro.on('chats', (d) => { st.chats = d.chats || []; if (d.icon) st.icon = d.icon; fabro.history.refresh(); });
  fabro.call('state').then((s) => { st = s; fabro.history.refresh(); }).catch(() => {});
};

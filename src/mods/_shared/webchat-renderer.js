// Shared UI part of the web chat mods. Each mod's renderer.js calls FabroWebChat(fabro, { name, command, … }).
window.FabroWebChat = window.FabroWebChat || function FabroWebChat(fabro, cfg) {
  const L = {
    en: { desc: `Ask ${cfg.name} (opens ${cfg.site})`, signIn: `Sign in to ${cfg.name}`, connected: `${cfg.name} is connected. Type ${cfg.command} followed by your message.`, needLogin: `Sign in to ${cfg.name} first.` },
    fr: { desc: `Demander à ${cfg.name} (ouvre ${cfg.site})`, signIn: `Connexion à ${cfg.name}`, connected: `${cfg.name} est connecté. Tapez ${cfg.command} suivi de votre message.`, needLogin: `Connectez-vous d’abord à ${cfg.name}.` },
  };
  const tr = (k) => (L[fabro.S.lang] || L.en)[k];
  let st = { connected: false, chats: [], icon: '' };

  const open = (sidebar, title) => fabro.view.open({ title: title || cfg.name, sidebar });

  fabro.commands.register(cfg.command, {
    description: tr('desc'),
    get icon() { return st.icon; },
    async run(text) {
      if (!st.connected) { st = await fabro.call('state'); }
      if (!st.connected) { fabro.toast(tr('needLogin')); return login(); }
      open('hide');                       // new chat: the site takes the whole chat area
      const r = await fabro.call('newChat', text);
      if (r && r.ok === false) fabro.toast(`${cfg.name}: ${r.reason}`, 'err');
    },
  });

  fabro.history.register({
    label: cfg.name,
    list: () => st.chats.map((c) => ({ id: c.id, title: c.title, updatedAt: c.updatedAt, href: c.href, icon: st.icon })),
    open: (it) => { open('keep'); fabro.call('openChat', it.id); }, // from the history: the sidebar stays open
  });

  async function login() { open('hide', tr('signIn')); await fabro.call('login'); }
  fabro.on('setup', login);
  fabro.on('login-done', () => { st.connected = true; fabro.toast(tr('connected')); fabro.view.close(); });
  fabro.on('chats', (d) => { st.chats = d.chats || []; if (d.icon) st.icon = d.icon; fabro.history.refresh(); });
  fabro.call('state').then((s) => { st = s; fabro.history.refresh(); }).catch(() => {});
};

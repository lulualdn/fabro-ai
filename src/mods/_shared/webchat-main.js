// Shared main-process part of the "web chat" mods (Claude, ChatGPT, Gemini): the site is opened in the
// chat area with its own saved sign-in, the list of your chats is read from the site's pages in the
// background (at launch, then every 5 minutes), and new chats are started from a prompt.
//
// config = {
//   name, home, loginUrl, done: RegExp (the page you land on once signed in — extra query/path allowed),
//   session: async (fabro) => bool (signed in? usually a cookie),
//   newChat: { url: (q) => string, mode: 'prefilled' | 'type' }, composer: CSS selector of the message box,
//   chatUrl: (id) => string, chatId: (url) => id | null,
//   list: { url, ready: JS returning truthy when the list is there, script: JS returning { items:[{id,title,ago?,group?}], icons:[] } },
// }
const SYNC_EVERY = 5 * 60 * 1000;

const UNITS = { second: 1e3, sec: 1e3, minute: 6e4, min: 6e4, hour: 36e5, hr: 36e5, day: 864e5, week: 6048e5, month: 2592e6, year: 31536e6, seconde: 1e3, heure: 36e5, jour: 864e5, semaine: 6048e5, mois: 2592e6, an: 31536e6, année: 31536e6 };
// "Last message 3 hours ago", "il y a 2 jours", "yesterday", "just now" → milliseconds ago (or null)
function parseAgo(s) {
  s = String(s || '').toLowerCase();
  if (!s) return null;
  if (/just now|à l.instant|now\b/.test(s)) return 0;
  if (/yesterday|hier/.test(s)) return 864e5;
  if (/today|aujourd/.test(s)) return 36e5;
  const m = s.match(/(\d+|an?|one|un|une)\s*(seconde?s?|secs?|minutes?|mins?|heures?|hours?|hrs?|jours?|days?|semaines?|weeks?|mois|months?|années?|ans?|years?)/);
  if (!m) return null;
  const n = /^\d+$/.test(m[1]) ? +m[1] : 1;
  const unit = Object.keys(UNITS).sort((a, b) => b.length - a.length).find((u) => m[2].startsWith(u));
  return unit ? n * UNITS[unit] : null;
}
// Sidebar group headings ("Today", "Previous 7 days", "Hier"…) → a rough age
function groupAge(g) {
  g = String(g || '').toLowerCase();
  if (!g) return null;
  if (/today|aujourd/.test(g)) return 0;
  if (/yesterday|hier/.test(g)) return 864e5;
  if (/7|week|semaine/.test(g)) return 3 * 864e5;
  if (/30|month|mois/.test(g)) return 15 * 864e5;
  if (/year|an\b|année/.test(g)) return 180 * 864e5;
  return null;
}

module.exports = function create(cfg) {
  let fabro = null, timer = null, startTimer = null, chats = [], icon = '', syncing = null, loginWatch = null;
  const state = () => ({ connected: !!fabro.settings.get().connected, chats, icon, lastSync: fabro.settings.get().lastSync || 0, name: cfg.name });

  function publish() { fabro.emit('chats', { chats, icon }); }

  // Merge a fresh list (most recent first) with what we knew: keeps stable times for chats that did not
  // move, bumps the ones that moved up, uses the site's own times when it shows them.
  function merge(items) {
    const now = Date.now(); const old = new Map(chats.map((c, i) => [c.id, { ...c, idx: i }]));
    let prevT = now; const out = [];
    items.forEach((it, i) => {
      const o = old.get(it.id);
      let t = null;
      const ago = parseAgo(it.ago); if (ago != null) t = now - ago;
      if (t == null && o && o.idx <= i && o.title === it.title) t = o.updatedAt;      // unchanged
      if (t == null && o && i === 0 && o.idx > 0) t = now;                              // moved to the top
      if (t == null) { const g = groupAge(it.group); t = g != null ? now - g - i * 6e4 : (o ? o.updatedAt : now - i * 36e5); }
      t = Math.min(t, prevT - (i ? 1000 : 0)); prevT = t;                                // keep the site's order
      out.push({ id: it.id, title: (it.title || '').trim() || 'Untitled', updatedAt: t, href: cfg.chatUrl(it.id) });
    });
    return out;
  }

  async function fetchIcon(urls) {
    if (icon || !urls || !urls.length) return;
    const { net } = fabro.electron;
    const ses = fabro.electron.session.fromPartition(fabro.partition);
    const pick = [...urls].sort((a, b) => (/\.svg/.test(b) - /\.svg/.test(a)) || (/png/.test(b) - /png/.test(a)));
    for (const u of pick) {
      try {
        const r = await net.fetch(u, { session: ses });
        if (!r.ok) continue;
        const type = (r.headers.get('content-type') || '').split(';')[0] || (/\.svg/.test(u) ? 'image/svg+xml' : 'image/png');
        if (!/^image\//.test(type)) continue;
        const buf = Buffer.from(await r.arrayBuffer());
        if (buf.length > 300000) continue;
        icon = `data:${type};base64,${buf.toString('base64')}`;
        fabro.writeJSON('icon.json', { icon });
        return;
      } catch {}
    }
  }

  async function sync() {
    if (syncing) return syncing;
    syncing = (async () => {
      if (!(await cfg.session(fabro))) { if (fabro.settings.get().connected) await fabro.settings.set({ connected: false }); return state(); }
      if (!fabro.settings.get().connected) await fabro.settings.set({ connected: true });
      const r = await fabro.web.scrape({ url: cfg.list.url, ready: cfg.list.ready, script: cfg.list.script, timeout: 30000 }).catch((e) => { fabro.log('sync failed', e.message); return null; });
      if (r && Array.isArray(r.items) && r.items.length) {
        const seen = new Set(); const items = r.items.filter((x) => x && x.id && !seen.has(x.id) && seen.add(x.id));
        chats = merge(items);
        fabro.writeJSON('chats.json', chats);
        await fabro.settings.set({ lastSync: Date.now() });
      }
      if (r && r.icons) await fetchIcon(r.icons);
      publish();
      return state();
    })().finally(() => { syncing = null; });
    return syncing;
  }

  // After a chat is started, its address changes to the chat's own page: show it in the history right away.
  function watchNewChat() {
    const wc = fabro.web.contents(); if (!wc) return;
    let done = false;
    const check = () => {
      if (done) return;
      const id = cfg.chatId(wc.getURL()); if (!id) return;
      done = true;
      if (!chats.some((c) => c.id === id)) { chats = [{ id, title: (wc.getTitle() || '').replace(new RegExp(`\\s*[-|·–]\\s*${cfg.name}.*$`, 'i'), '') || cfg.name, updatedAt: Date.now(), href: cfg.chatUrl(id) }, ...chats]; publish(); }
      setTimeout(() => sync(), 12000); // the site gives the chat its real title a few seconds later
    };
    wc.on('did-navigate-in-page', check); wc.on('did-navigate', check);
    setTimeout(() => { done = true; }, 120000);
  }

  return {
    async activate(f) {
      fabro = f;
      chats = fabro.readJSON('chats.json', []);
      icon = (fabro.readJSON('icon.json', {}) || {}).icon || '';
      fabro.handle('state', () => state());
      fabro.handle('sync', () => sync());
      fabro.handle('home', async () => { fabro.web.ensure(); await fabro.web.load(cfg.home); return true; });
      fabro.handle('openChat', async (id) => { fabro.web.ensure(); await fabro.web.load(cfg.chatUrl(id)); return true; });
      fabro.handle('newChat', async (text) => {
        fabro.web.ensure();
        if (!text) { await fabro.web.load(cfg.home); return { ok: true }; }
        await fabro.web.load(cfg.newChat.url(text));
        watchNewChat();
        return fabro.web.submit({ text, selector: cfg.composer, mode: cfg.newChat.mode });
      });
      // Install: show the sign-in page and wait until the site sends us to its new-chat page.
      fabro.handle('login', async () => {
        fabro.web.ensure();
        if (await cfg.session(fabro)) { await fabro.web.load(cfg.home); await fabro.settings.set({ connected: true }); fabro.emit('login-done', {}); sync(); return { already: true }; }
        await fabro.web.load(cfg.loginUrl);
        clearInterval(loginWatch);
        const t0 = Date.now();
        loginWatch = setInterval(async () => {
          const u = fabro.web.url();
          if (Date.now() - t0 > 30 * 60 * 1000) { clearInterval(loginWatch); return; }
          if (!cfg.done.test(u) || !(await cfg.session(fabro))) return;
          clearInterval(loginWatch);
          await fabro.settings.set({ connected: true });
          fabro.emit('login-done', {});
          sync();
        }, 800);
        return { waiting: true };
      });
      fabro.handle('logout', async () => { await fabro.web.clear(); await fabro.settings.set({ connected: false }); chats = []; fabro.writeJSON('chats.json', chats); publish(); return state(); });
      // background sync: shortly after launch, then every 5 minutes
      startTimer = setTimeout(() => sync(), 6000);
      timer = setInterval(() => sync(), SYNC_EVERY);
      fabro.onCleanup(() => { clearTimeout(startTimer); clearInterval(timer); clearInterval(loginWatch); });
    },
    _test: { parseAgo, groupAge },
  };
};
module.exports.parseAgo = parseAgo;

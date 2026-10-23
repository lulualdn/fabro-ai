// Claude for Fabro — claude.ai in the chat area, /claude command, your Claude chats in the history.
const B = process.env.FABRO_MODTEST_CLAUDE || 'https://claude.ai'; // test hook: a local copy of the site
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
module.exports = require('../_shared/webchat-main')({
  name: 'Claude',
  home: `${B}/new`,
  loginUrl: `${B}/login`,
  done: new RegExp(`^${esc(B)}/(new|recents|chats?|project)`), // the new-chat page (extra query allowed)
  session: async (fabro) => (await fabro.web.cookies({})).some((c) => c.name === 'sessionKey' && /claude\.ai$|127\.0\.0\.1|localhost/.test(c.domain.replace(/^\./, ''))),
  newChat: { url: (q) => `${B}/new?q=${encodeURIComponent(q)}`, mode: 'prefilled' },
  composer: 'div[contenteditable="true"]',
  chatUrl: (id) => `${B}/chat/${id}`,
  chatId: (u) => ((u || '').match(/\/chat\/([0-9a-f-]{20,})/i) || [])[1] || null,
  list: {
    url: `${B}/recents`,
    ready: `document.querySelectorAll('a[href*="/chat/"]').length > 0`,
    script: `(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      for (let k = 0; k < 4; k++) {
        [...document.querySelectorAll('main, main *')].filter((e) => e.scrollHeight > e.clientHeight + 40).forEach((e) => { e.scrollTop = e.scrollHeight; });
        window.scrollTo(0, document.body.scrollHeight);
        await sleep(700);
        const more = [...document.querySelectorAll('button')].find((b) => /show more|load more|afficher plus|voir plus/i.test(b.innerText || ''));
        if (more) { more.click(); await sleep(900); }
      }
      const items = [], seen = new Set();
      for (const a of [...document.querySelectorAll('main a[href*="/chat/"]'), ...document.querySelectorAll('a[href*="/chat/"]')]) {
        const m = (a.getAttribute('href') || '').match(/\\/chat\\/([0-9a-f-]{20,})/i); if (!m || seen.has(m[1])) continue; seen.add(m[1]);
        const lines = (a.innerText || '').split('\\n').map((s) => s.trim()).filter(Boolean);
        const ago = lines.find((l) => /\\bago\\b|yesterday|just now|il y a|hier|à l.instant/i.test(l)) || '';
        const title = lines.find((l) => l !== ago && !/^last message|^dernier message/i.test(l)) || a.getAttribute('title') || a.getAttribute('aria-label') || '';
        items.push({ id: m[1], title, ago });
      }
      return { items, icons: [...document.querySelectorAll('link[rel~="icon"], link[rel="apple-touch-icon"]')].map((l) => l.href) };
    })()`,
  },
});

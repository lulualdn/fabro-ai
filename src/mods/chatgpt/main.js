// ChatGPT for Fabro — chatgpt.com in the chat area, /chatgpt command, your ChatGPT chats in the history.
const B = process.env.FABRO_MODTEST_CHATGPT || 'https://chatgpt.com';
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
module.exports = require('../_shared/webchat-main')({
  name: 'ChatGPT',
  home: `${B}/`,
  loginUrl: `${B}/auth/login`,
  done: new RegExp(`^${esc(B)}/(\\?.*)?$|^${esc(B)}/(c|g)/`), // back on the home / new-chat page once signed in
  session: async (fabro) => (await fabro.web.cookies({})).some((c) => /^__Secure-next-auth\.session-token/.test(c.name)),
  newChat: { url: (q) => `${B}/?q=${encodeURIComponent(q)}`, mode: 'prefilled' },
  composer: '#prompt-textarea, div[contenteditable="true"]',
  chatUrl: (id) => `${B}/c/${id}`,
  chatId: (u) => ((u || '').match(/\/c\/([0-9a-f-]{20,})/i) || [])[1] || null,
  list: {
    url: `${B}/`,
    ready: `document.querySelectorAll('a[href*="/c/"]').length > 0`,
    script: `(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const nav = document.querySelector('nav') || document.body;
      for (let k = 0; k < 3; k++) { [...nav.querySelectorAll('*')].filter((e) => e.scrollHeight > e.clientHeight + 40).forEach((e) => { e.scrollTop = e.scrollHeight; }); await sleep(800); }
      const items = [], seen = new Set(); let group = '';
      const w = document.createTreeWalker(nav, NodeFilter.SHOW_ELEMENT);
      for (let n = w.currentNode; n; n = w.nextNode()) {
        if (/^H[1-6]$/.test(n.tagName) || (n.getAttribute && n.getAttribute('role') === 'heading')) { group = (n.innerText || '').trim(); continue; }
        if (n.tagName !== 'A') continue;
        const m = (n.getAttribute('href') || '').match(/\\/c\\/([0-9a-f-]{20,})/i); if (!m || seen.has(m[1])) continue; seen.add(m[1]);
        items.push({ id: m[1], title: (n.innerText || '').split('\\n')[0].trim() || n.getAttribute('title') || n.getAttribute('aria-label') || '', group });
      }
      return { items, icons: [...document.querySelectorAll('link[rel~="icon"], link[rel="apple-touch-icon"]')].map((l) => l.href) };
    })()`,
  },
});

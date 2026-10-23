// Gemini for Fabro — gemini.google.com in the chat area, /gemini command, your Gemini chats in the history.
const B = process.env.FABRO_MODTEST_GEMINI || 'https://gemini.google.com';
const ACC = process.env.FABRO_MODTEST_GEMINI ? `${B}/login` : `https://accounts.google.com/ServiceLogin?continue=${encodeURIComponent(B + '/app')}`;
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
module.exports = require('../_shared/webchat-main')({
  name: 'Gemini',
  home: `${B}/app`,
  loginUrl: ACC,
  done: new RegExp(`^${esc(B)}/app`),
  session: async (fabro) => (await fabro.web.cookies({})).some((c) => ['__Secure-1PSID', 'SID'].includes(c.name) && /google\.com$|127\.0\.0\.1|localhost/.test(c.domain.replace(/^\./, ''))),
  // Gemini has no address that fills in a prompt: Fabro types it, then presses Enter.
  newChat: { url: () => `${B}/app`, mode: 'type' },
  composer: 'rich-textarea .ql-editor, div.ql-editor[contenteditable="true"], div[contenteditable="true"][role="textbox"], div[contenteditable="true"]',
  chatUrl: (id) => `${B}/app/${id}`,
  chatId: (u) => ((u || '').match(/\/app\/([0-9a-f]{8,})/i) || [])[1] || null,
  list: {
    url: `${B}/app`,
    ready: `document.querySelector('a[href*="/app/"], [data-test-id="conversation"]') || (document.querySelector('[data-test-id="side-nav-menu-button"], button[aria-label*="menu" i]')?.click(), false)`,
    script: `(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const side = document.querySelector('bard-sidenav, side-navigation-v2, [role="navigation"]') || document.body;
      for (let k = 0; k < 3; k++) { [...side.querySelectorAll('*')].filter((e) => e.scrollHeight > e.clientHeight + 40).forEach((e) => { e.scrollTop = e.scrollHeight; }); await sleep(800); }
      const items = [], seen = new Set();
      const nodes = [...document.querySelectorAll('a[href*="/app/"], [data-test-id="conversation"]')];
      for (const n of nodes) {
        const href = n.getAttribute('href') || n.querySelector('a[href*="/app/"]')?.getAttribute('href') || '';
        let id = (href.match(/\\/app\\/([0-9a-f]{8,})/i) || [])[1];
        if (!id) { const j = n.getAttribute('jslog') || ''; id = (j.match(/c_([0-9a-f]{8,})/i) || [])[1]; }
        if (!id || seen.has(id)) continue; seen.add(id);
        const title = (n.querySelector('.conversation-title')?.innerText || n.innerText || '').split('\\n')[0].trim();
        items.push({ id, title });
      }
      return { items, icons: [...document.querySelectorAll('link[rel~="icon"], link[rel="apple-touch-icon"]')].map((l) => l.href) };
    })()`,
  },
});

// Tools that let the AI use the interface's extension points (src/renderer/v1/fabro.js), e.g. a question shown
// above the chat with buttons. Mods add their own cards and commands through the same points.
const agent = require('./index');

agent.register({
  name: 'show_card', category: 'pilotage', risk: 'read', noMcpWrap: true,
  description: 'Show a small card above the chat with up to 3 buttons, for a quick choice or a reminder that should stay visible. Each button can send a reply as the user. Not for long text.',
  example: 'show_card({ title: "Tu veux que je réserve ?", actions: [{ label: "Oui", reply: "Oui, réserve" }, { label: "Non", reply: "Non merci" }] })',
  parameters: { type: 'object', properties: { title: { type: 'string' }, sub: { type: 'string' }, actions: { type: 'array', items: { type: 'object', properties: { label: { type: 'string' }, reply: { type: 'string' }, primary: { type: 'boolean' } } } } }, required: ['title'] },
  summarize: (a) => String(a.title || '').slice(0, 80),
  async run(a) {
    const { BrowserWindow } = require('electron');
    const card = { id: 'ai-' + Date.now().toString(36), title: String(a.title).slice(0, 200), sub: String(a.sub || '').slice(0, 300), actions: (a.actions || []).slice(0, 3).map((x) => ({ label: String(x.label || '').slice(0, 40), reply: String(x.reply || '').slice(0, 500), primary: !!x.primary })) };
    for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed() && /\/v1\/index\.html/.test(w.webContents.getURL())) w.webContents.send('v1:card', card);
    return { content: 'Card shown above the chat. The user’s choice will come as their next message.', view: { kind: 'card', title: card.title } };
  },
});

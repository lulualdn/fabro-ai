// Developer lab (wave 3): ask the same question to several set-ups (a model + a system prompt) and let a model
// write a report on the answers. Each call is a plain background call (chat.quick): no tools, no smart prompt,
// so what is compared is exactly the system prompt that was typed.
const chat = require('./chat');

const clip = (s, n) => String(s || '').slice(0, n);

// One set-up, one answer. → { text, ms } or { error, ms }
async function one({ model, system, user, maxTokens = 500 }) {
  const t0 = Date.now();
  if (!model) return { error: 'no model', ms: 0 };
  try {
    const msgs = [...(String(system || '').trim() ? [{ role: 'system', content: clip(system, 12000) }] : []), { role: 'user', content: clip(user, 8000) }];
    const text = await chat.quick(model, msgs, { maxTokens: Math.max(50, Math.min(2000, Number(maxTokens) || 500)), temperature: 0.4 });
    return { text, ms: Date.now() - t0 };
  } catch (e) { return { error: e.message || String(e), ms: Date.now() - t0 }; }
}

const LANG = { fr: 'French', en: 'English', es: 'Spanish', de: 'German' };
// A model reads the answers and reports: which set-up did best, why, and a better system prompt to try next.
async function judge({ model, user, results = [], lang }) {
  const t0 = Date.now();
  const body = results.filter((r) => r && r.text).slice(0, 4).map((r) => `### ${r.label}\nSystem prompt: ${r.system ? `"""${clip(r.system, 1500)}"""` : '(none)'}\nAnswer (${r.ms} ms):\n"""${clip(r.text, 2500)}"""`).join('\n\n');
  if (!body) return { error: 'nothing to judge', ms: 0 };
  try {
    const text = await chat.quick(model, [
      { role: 'system', content: `You review answers given by AI models to the same question. Be concrete and brief. Write in ${LANG[lang] || 'English'}.\nFormat:\n1. One line: the best set-up and why.\n2. For each set-up: one strength, one weakness (one line each).\n3. "Prompt to try": a better system prompt for this kind of question, inside one fenced code block.` },
      { role: 'user', content: `Question:\n"""${clip(user, 2000)}"""\n\n${body}` },
    ], { maxTokens: 900, temperature: 0.3 });
    return { text, ms: Date.now() - t0 };
  } catch (e) { return { error: e.message || String(e), ms: Date.now() - t0 }; }
}

function register(ipcMain) {
  ipcMain.handle('devlab:one', (_e, o) => one(o || {}));
  ipcMain.handle('devlab:judge', (_e, o) => judge(o || {}));
}

module.exports = { one, judge, register };

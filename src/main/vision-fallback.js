// Pictures sent to a model that can't see them: before the call, each picture in the conversation is replaced by
// a short description made by a model that can (a vision model of Fabro Cloud, when it's on), or by a plain note.
// Without this, a model with no vision refuses the whole message ("does not support vision input").
const providers = require('./providers');
const store = require('./store');

const cache = new Map(); // image hash → description (same picture, same conversation: described once)
const hash = (s) => require('crypto').createHash('sha1').update(String(s)).digest('hex');

function visionModel() {
  if (store.getSettings().freeCloud === false) return null;
  const free = providers.chatModels().filter((m) => m.ref && m.ref.provider === providers.FREE_ID && m.vision);
  return free[0] || null;
}

async function describe(url, lang) {
  const k = hash(url); if (cache.has(k)) return cache.get(k);
  const m = visionModel(); if (!m) return null;
  const t = providers.target(m.ref);
  const tries = [{ base: t.base, model: t.model }, ...(t.alternates || []).filter((a) => (t.provider.models || []).some((x) => x.id === a.id && x.vision))];
  const prompt = lang === 'fr'
    ? 'Décris cette image pour quelqu’un qui ne la voit pas : ce qu’elle montre, le lieu ou l’objet si on le reconnaît, le texte lisible, les détails utiles. 5 phrases au plus.'
    : 'Describe this picture for someone who cannot see it: what it shows, the place or object if recognisable, any readable text, useful details. 5 sentences at most.';
  for (const x of tries) {
    try {
      const r = await fetch(`${x.base}/chat/completions`, { method: 'POST', headers: t.headers, signal: AbortSignal.timeout(45000),
        body: JSON.stringify({ model: x.model, max_tokens: 300, temperature: 0.2, messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url } }] }] }) });
      if (!r.ok) continue;
      const j = await r.json(); const d = String(((j.choices || [])[0] || {}).message?.content || '').trim();
      if (d) { cache.set(k, d); return d; }
    } catch {}
  }
  return null;
}

// messages: OpenAI-style. Returns new messages with no image parts.
async function strip(messages, { lang, onStatus } = {}) {
  if (!messages.some((m) => Array.isArray(m.content) && m.content.some((p) => p && p.type === 'image_url'))) return messages;
  if (onStatus) onStatus(lang === 'fr' ? 'Regarde l’image…' : 'Looking at the picture…');
  const out = [];
  for (const m of messages) {
    if (!Array.isArray(m.content)) { out.push(m); continue; }
    const parts = [];
    for (const p of m.content) {
      if (!p || p.type !== 'image_url') { if (p && p.type === 'text') parts.push(p.text); continue; }
      const d = await describe(p.image_url && p.image_url.url, lang).catch(() => null);
      parts.push(d ? `[Picture attached by the user. You cannot see it; another model described it for you: ${d}]`
        : '[The user attached a picture, but this model cannot see pictures. Say so in one sentence and suggest choosing a model that can see images.]');
    }
    out.push({ ...m, content: parts.join('\n\n') });
  }
  return out;
}

module.exports = { strip, describe };

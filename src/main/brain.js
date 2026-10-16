// Background jobs run with the user's current model: conversation titles,
// memory extraction (facts about the user, kept on this computer) and style learning.
const chat = require('./chat');
const db = require('./db');
const store = require('./store');

const LANG = { fr: 'French', en: 'English', es: 'Spanish', de: 'German' };
const busy = new Set();

function parseJsonArray(text) {
  const m = String(text).match(/\[[\s\S]*\]/);
  if (!m) return [];
  try { const a = JSON.parse(m[0]); return Array.isArray(a) ? a.filter((x) => typeof x === 'string') : []; } catch { return []; }
}

async function title({ model, user, answer, lang }) {
  const out = await chat.quick(model, [
    { role: 'system', content: `You name conversations. Reply with a short title (2 to 6 words) in ${LANG[lang] || 'the language of the conversation'}, no quotes, no final period, no emoji.` },
    { role: 'user', content: `User: ${String(user).slice(0, 1200)}\n\nAssistant: ${String(answer).slice(0, 800)}\n\nTitle:` },
  ], { maxTokens: 24 });
  return out.split('\n')[0].replace(/^["'«“]+|["'»”.]+$/g, '').replace(/^(title|titre)\s*:\s*/i, '').trim().slice(0, 64);
}

// Extract durable facts the user stated about themselves.
async function memories({ model, convId, userTexts, lang }) {
  const s = store.getSettings().memory || {};
  if (s.enabled === false || s.auto === false || busy.has(convId)) return [];
  busy.add(convId);
  try {
    const known = db.listMemories().slice(0, 60).map((m) => `- ${m.text}`).join('\n') || '(none)';
    const out = await chat.quick(model, [
      { role: 'system', content: `You maintain a short memory about the user of a personal assistant. From the user's messages, extract only durable facts the user stated about themselves that will help in future conversations: name, job, studies, ongoing projects, tools they use, stable preferences about answers. Never store health, finances, religion, politics, sexuality, passwords or secrets, nor one-off requests. Skip anything already known. Write each fact as a short sentence in ${LANG[lang] || 'the user\'s language'}, starting with the subject (e.g. "Works on…"). Reply ONLY with a JSON array of strings; [] when there is nothing new.` },
      { role: 'user', content: `Already known:\n${known}\n\nUser messages:\n${userTexts.map((t) => `- ${String(t).slice(0, 1500)}`).join('\n')}` },
    ], { maxTokens: 300 });
    const facts = parseJsonArray(out).map((f) => f.trim()).filter((f) => f.length > 6 && f.length < 300).slice(0, 5);
    const added = facts.map((f) => db.addMemory(f, convId)).filter(Boolean);
    return added;
  } finally { busy.delete(convId); }
}

async function style({ model, sample, lang }) {
  return chat.quick(model, [
    { role: 'system', content: `Describe the writing style of the sample so an assistant can imitate it: tone, sentence length, vocabulary, structure, formatting, punctuation habits. 4 to 7 short imperative bullet points in ${LANG[lang] || 'English'}, no preamble.` },
    { role: 'user', content: String(sample).slice(0, 6000) },
  ], { maxTokens: 260 });
}

module.exports = { title, memories, style };

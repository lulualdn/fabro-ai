// A local engine keeps a prompt cache that starts with the system message and the tool list. Any change there makes
// it read the whole conversation again before the first word (seconds on a long chat, every turn).
// So, per conversation:
//   - the system message is frozen while the structure is the same (mode, tools, model…). What changed since (hints
//     for this request, date, memory ranking…) travels as a short note on the latest user message, where only the
//     last turn has to be read again;
//   - the tools offered to the model only grow: a tool picked from the words of an earlier message stays offered.
// Cloud models are not concerned: chat.js / sysprompt only call this for local engines.
const MAX_CONVS = 30; const MAX_TOOLS = 90;
const convs = new Map(); // convId → { key, parts: Map(id → text), text }
const tools = new Map(); // `${convId}|${mode}` → Set(tool names)
const touch = (map, id, make) => { const e = map.get(id) || make(); map.delete(id); map.set(id, e); if (map.size > MAX_CONVS) map.delete(map.keys().next().value); return e; };

// parts: [{ id, text }] in order; text: the full system message built for this turn.
// → { text: what to send as the system message, late: what to add to the latest user message ('' when nothing) }
function system(convId, key, parts, text) {
  const e = touch(convs, convId, () => ({}));
  const fresh = () => { e.key = key; e.parts = new Map(parts.map((p) => [p.id, p.text])); e.text = text; return { text, late: '' }; };
  if (e.key !== key || !e.parts) return fresh();
  const late = parts.filter((p) => p.text && e.parts.get(p.id) !== p.text).map((p) => p.text.trim()).join('\n\n');
  // too much has changed: a note that long costs more context than it saves, take the new prompt
  if (late.length > e.text.length * 0.5) return fresh();
  return { text: e.text, late };
}

const NOTE = (late) => `<system_update>\nFrom the system, not from the user. The sections below replace the ones with the same title in the system prompt.\n\n${late}\n</system_update>`;
// A copy of the message with the note at the end (the stored message is never changed).
function withNote(m, late) {
  if (!late) return m;
  if (Array.isArray(m.content)) return { ...m, content: [...m.content, { type: 'text', text: NOTE(late) }] };
  return { ...m, content: `${m.content || ''}\n\n${NOTE(late)}` };
}

// Tool names to keep offering in this conversation and mode.
const keep = (convId, mode) => [...(tools.get(`${convId}|${mode}`) || [])];
function remember(convId, mode, names) {
  const k = `${convId}|${mode}`;
  let set = touch(tools, k, () => new Set());
  for (const n of names) set.add(n);
  if (set.size > MAX_TOOLS) { set = new Set(names); tools.set(k, set); }
}
const forget = (convId) => { convs.delete(convId); for (const k of [...tools.keys()]) if (k.startsWith(`${convId}|`)) tools.delete(k); };

module.exports = { system, withNote, keep, remember, forget, NOTE };

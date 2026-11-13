// The sections of the adaptive system prompt. Each section says one thing, once:
//   when(s)   → why it is included for this situation (a short reason string), or '' to leave it out
//   prio      → 0 = essential (never dropped, may be shortened), higher = dropped earlier when the budget is tight
//   full(s,c) / short(s,c) → the text (short may be null: then the section can only be dropped)
// s is the situation (see index.js), c = { left } remaining tokens (for sections that size themselves).
const P = require('../prompts');
const { estTok } = require('./signals');

const LANG_NAMES = { fr: 'French', en: 'English', es: 'Spanish', de: 'German', it: 'Italian', pt: 'Portuguese', ja: 'Japanese', zh: 'Chinese', ko: 'Korean', ru: 'Russian', ar: 'Arabic', hi: 'Hindi', nl: 'Dutch', pl: 'Polish' };
const has = (s, re) => s.toolNames.some((n) => re.test(n));
const small = (s) => s.model.size === 'tiny' || s.model.size === 'small';
const clip = (t, n) => (t.length > n ? t.slice(0, n - 1) + '…' : t);

function dateLine(s) {
  const d = s.now || new Date();
  const loc = s.user.location ? ` · ${s.user.location}` : '';
  // Local engines reuse their prompt cache only while the system message is unchanged: for them the time is
  // given to the hour, so a new message a minute later doesn't make them re-read the whole conversation.
  const day = d.toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const time = s.model.cloud ? d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : `around ${String(d.getHours()).padStart(2, '0')}:00`;
  return `Now: ${day}, ${time}${loc}.`;
}
function langLine(s) {
  const n = LANG_NAMES[s.lang];
  return n ? `The user writes in ${n}: answer in ${n}.` : 'Reply in the user\'s language.';
}

// Memory: the items that share words with the request first, cut to a share of the budget.
const DIGEST = '## Last line of every answer\nEnd each answer with one hidden line: <digest>what this answer said or did, 25 words at most, with the exact names (files, numbers, links)</digest>. Fabro hides it from the user and uses it to find this message later in long conversations.';

function memoryLines(s, maxTok) {
  const mem = s.user.memories || []; if (!mem.length) return [];
  const q = new Set(String(s.request || '').toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) || []);
  const ranked = mem.map((m, i) => ({ m, i, r: (String(m).toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) || []).filter((w) => q.has(w)).length }))
    .sort((a, b) => b.r - a.r || a.i - b.i);
  const out = []; let used = 0;
  for (const { m } of ranked) { const l = `- ${clip(String(m), 200)}`; const t = estTok(l) + 1; if (used + t > maxTok) break; out.push(l); used += t; }
  return out;
}

function userBlock(s, c, short) {
  const u = s.user;
  if (s.legacyBase && !s.structured) return `## About the user and their preferences\n${s.legacyBase}`;
  const lines = [];
  if (u.name) lines.push(`The user's name is ${u.name}.`);
  if (u.aiName && u.aiName.toLowerCase() !== 'fabro') lines.push(`The user named you "${u.aiName}". That is your name: introduce yourself as ${u.aiName} (you run inside the Fabro app).`);
  if (u.useFor && !short) lines.push(u.useFor);
  if (u.style) lines.push(short ? clip(u.style, 300) : u.style);
  const memTok = Math.max(60, Math.round(s.budget * (short ? 0.06 : 0.12)));
  // My Fabro (myfabro.forPrompt): profile + notes ranked for this request, within the budget; else the plain list
  const fm = typeof s.fabroMemory === 'function' ? s.fabroMemory(memTok) : '';
  const mem = fm ? [] : memoryLines(s, memTok);
  if (fm) lines.push(`${fm}\n(Use it when relevant, don't recite it.)`);
  else if (mem.length) lines.push(`What you remember about the user (use it when relevant, don't recite it):\n${mem.join('\n')}`);
  if (u.custom) lines.push(`The user's personal instructions (follow them):\n${clip(u.custom, Math.max(400, Math.round(s.budget * 0.3 * 3.3)))}`);
  return lines.length ? `## About the user\n${lines.join('\n')}` : '';
}

function notesBlock(s, short) {
  const notes = s.notes.slice(0, short ? 5 : 12);
  const rule = s.toolNames.includes('note_to_self') ? `\n${P.NOTEBOOK_RULE}` : '';
  if (!notes.length) return rule ? `## How this user wants you to work\n(No notes yet.)${rule}` : '';
  return `## How this user wants you to work (your notebook — follow these)\n${notes.map((n) => `- ${n.text}${short ? '' : ` [${n.id}]`}`).join('\n')}${short ? '' : rule}`;
}

function guidesBlock(s, c, short) {
  if (!s.toolNames.includes('read_guide')) return '';
  const g = require('../guides');
  const idx = g.index(s.request, Math.max(60, Math.min(short ? 120 : 400, Math.round(s.budget * (short ? 0.06 : 0.1)))));
  if (!idx.lines.length) return '';
  const top = idx.top.length ? `\nFor this request, read first: ${idx.top.join(', ')}.` : '';
  return `## Guides (read_guide before that kind of task)\n${short ? '' : P.GUIDES_RULE + '\n'}${idx.lines.join('\n')}${idx.total > idx.lines.length ? `\n(${idx.total - idx.lines.length} more: list_guides)` : ''}${top}`;
}

function focusBlock(s) {
  const f = s.focus; const out = [];
  if (f.frustration === 'correction') out.push(`The user is correcting you. Re-read their last message, restate their goal in one line, then do exactly that — nothing more, nothing else.${s.toolNames.includes('note_to_self') ? ' If it is about how you work, save it with note_to_self.' : ''}`);
  if (f.frustration === 'repeated') out.push('The user repeated their request: your previous answer missed it. Restate the goal in one line, then do it fully this time.');
  if (f.refused) out.push('The user refused an action this turn: do not retry it. Do the rest, or ask how they want to proceed.');
  if (f.failures >= 2) out.push(`${f.failures} tool calls failed. Change approach (other arguments, other tool); never repeat a failing call; never invent the missing result.`);
  if (f.nudged) out.push('You were just corrected by the app: follow that correction.');
  if (f.pressure >= 0.6) out.push('Memory is nearly full: be brief, don\'t re-read big files or paste outputs, finish the task.');
  if (f.lean) out.push('The computer is on battery or slow: keep answers short and steps few.');
  if (s.mode === 'agent' && (f.steps >= 6 || s.conv.long) && s.request) out.push(`Goal (the user's request): «${clip(s.request.replace(/\s+/g, ' '), 220)}». Keep going until it is fully done.`);
  if (s.conv.first && s.mode === 'agent' && !s.sub && !s.unattended && !out.length && s.kinds.has('multistep') && !small(s)) out.push('Long task: in the same reply, one short line saying what you are going to do, and the first tool call.');
  return out.length ? `## Right now\n${out.map((x) => `- ${x}`).join('\n')}` : '';
}

function kitBlock(s, c) {
  if (s.mode !== 'chat' || s.sub || s.noArtifactGuide) return '';
  try {
    const g = require('../kit/guide');
    // the guide is the one thing a visual request needs: give it room even when the prompt is tight
    const budgetTokens = Math.max(450, Math.min(c.left, 3500));
    let ds = g.chatSection(s.request, { budgetTokens });
    if (!ds && s.lastArtifact) ds = g.chatSection(s.lastArtifact, { budgetTokens });
    return ds || '';
  } catch { return ''; }
}

const SECTIONS = [
  { id: 'identity', prio: 0, when: (s) => (s.mode === 'chat' && s.legacyBase && !s.structured ? '' : 'always'),
    full: (s) => [s.sub ? P.IDENTITY_SUB : s.mode === 'agent' ? P.IDENTITY_AGENT : P.IDENTITY_CHAT, dateLine(s), langLine(s)].join('\n'),
    short: (s) => [s.sub ? P.IDENTITY_SUB : s.mode === 'agent' ? P.IDENTITY_AGENT : P.IDENTITY_CHAT, dateLine(s), langLine(s)].join('\n') },
  // chat mode without structured context: the renderer's own system text is the top of the prompt
  { id: 'legacy_chat', prio: 0, when: (s) => (s.mode === 'chat' && s.legacyBase && !s.structured ? 'renderer system text (no structured user context)' : ''),
    full: (s) => s.legacyBase, short: (s) => s.legacyBase },
  { id: 'user', prio: (s) => (s.user.custom || s.legacyBase ? 0 : 1), when: (s) => (s.mode === 'chat' && !s.structured ? '' : (s.structured ? (s.user.name || s.user.custom || (s.user.memories || []).length || s.user.style || s.user.aiName) : s.legacyBase) ? 'user context available' : ''),
    full: (s, c) => userBlock(s, c, false), short: (s, c) => userBlock(s, c, true) },
  { id: 'notes', prio: 1, when: (s) => (s.notes.length ? `${s.notes.length} notebook notes` : s.toolNames.includes('note_to_self') ? 'note_to_self available' : ''),
    full: (s) => notesBlock(s, false), short: (s) => notesBlock(s, true) },
  { id: 'tools', prio: 0, when: (s) => (s.mode === 'agent' ? `${s.toolNames.length} tools` : ''),
    full: (s) => `## Your tools right now (${s.tools.length})\n${P.toolList(s.tools)}`,
    short: (s) => `## Your tools right now (${s.tools.length})\n${P.toolNames(s.tools)}` },
  { id: 'fallback', prio: 0, when: (s) => (s.fallback && s.tools.length ? 'model without native tool calls' : ''), full: () => P.FALLBACK, short: () => P.FALLBACK },
  { id: 'chat_tools', prio: 0, when: (s) => (s.mode === 'chat' && s.tools.length ? `${s.tools.length} chat tools` : ''),
    full: (s) => `## Tools you can call now\n${P.toolList(s.tools)}\n${P.CHAT_TOOLS_RULES}`,
    short: (s) => `## Tools you can call now\n${P.toolNames(s.tools)}\nYou really have them: use them for current info; never invent their results. Cite sources [1].` },
  { id: 'loop', prio: 0, when: (s) => (s.mode === 'agent' ? 'agent work loop' : ''), full: () => P.LOOP, short: () => P.LOOP_SHORT, smallShort: true },
  { id: 'honesty', prio: 0, when: (s) => (s.mode === 'agent' ? 'agent truthfulness' : ''), full: () => P.HONESTY, short: () => P.HONESTY_SHORT },
  { id: 'example', prio: (s) => (small(s) ? 1 : 3), when: (s) => (s.mode === 'agent' ? (small(s) ? 'small model: concrete examples' : 'agent example') : ''),
    full: () => P.EXAMPLE, short: () => P.EXAMPLE_SHORT, smallShort: (s) => s.model.size === 'tiny' },
  { id: 'triage', prio: 3, when: (s) => (!s.sub && !s.unattended && (s.mode === 'agent' || s.tools.length) && !s.kinds.has('smalltalk') ? 'owner\'s triage method' : ''),
    full: () => P.TRIAGE, short: () => P.TRIAGE_SHORT, smallShort: true },
  { id: 'context', prio: 3, when: (s) => (!s.sub && !s.unattended && (s.mode === 'agent' || s.tools.length) ? (s.conv.first ? 'follow-ups and asking well' : 'conversation continues') : ''),
    full: (s) => (s.toolNames.includes('schedule_task') ? P.CONTEXT : P.CONTEXT.split('\n').filter((l) => !/schedule_task/.test(l)).join('\n')), short: () => P.CONTEXT_SHORT, smallShort: true },
  { id: 'kind', prio: 2, when: (s) => { const k = [...s.kinds].filter((x) => P.KIND_HINTS[x] && (s.mode === 'agent' || ['research', 'writing', 'code'].includes(x))); return k.length ? `request: ${k.join(', ')}` : ''; },
    full: (s) => `## This request\n${[...s.kinds].filter((x) => P.KIND_HINTS[x] && (s.mode === 'agent' || ['research', 'writing', 'code'].includes(x))).map((x) => `- ${P.KIND_HINTS[x]}`).join('\n')}`,
    short: (s) => { const k = [...s.kinds].filter((x) => P.KIND_HINTS[x] && (s.mode === 'agent' || ['research', 'writing', 'code'].includes(x))); return `## This request\n- ${P.KIND_HINTS[k[0]]}`; } },
  { id: 'inform', prio: 2, when: (s) => (s.mode === 'agent' || s.voice ? (s.unattended ? 'unattended run' : s.voice ? 'voice' : 'agent') : ''),
    full: (s) => (s.unattended ? P.INFORM_TASK : s.voice ? P.INFORM_VOICE : s.sub ? '' : P.INFORM), short: (s) => (s.unattended ? P.INFORM_TASK : s.voice ? P.INFORM_VOICE : s.sub ? '' : P.INFORM_SHORT), smallShort: true },
  { id: 'recovery', prio: (s) => (s.focus.failures || s.focus.refused ? 1 : 2), when: (s) => (s.mode === 'agent' ? (s.focus.failures ? 'tool errors this run' : 'error handling') : ''),
    full: () => P.RECOVERY, short: () => P.RECOVERY_SHORT, smallShort: (s) => !s.focus.failures },
  { id: 'design', prio: (s) => (s.kinds.has('build') ? 1 : 4), when: (s) => (s.mode === 'agent' && has(s, /^(create_artifact|design_guide)$/) ? (s.kinds.has('build') ? 'request builds a page/document' : 'artifact tools present') : ''),
    full: () => P.DESIGN, short: () => '## Pages, documents, slides\nCall design_guide with the kind first, then create_artifact. Every create/edit returns pictures and problems: fix every ✗ with edit_artifact before saying it is done. The artifact shows as a card: don\'t write its path.', smallShort: (s) => !s.kinds.has('build') },
  { id: 'docs', prio: (s) => (s.kinds.has('build') ? 2 : 4), when: (s) => (s.mode === 'agent' && has(s, /^(create_pdf|edit_artifact|inspect_document)$/) ? 'document tools present' : ''),
    full: () => P.DOCS, short: () => '## PDFs\ncreate_pdf with full HTML+CSS; look at the returned pages and fix layout problems with edit_artifact (max 3 rounds).', smallShort: true },
  { id: 'computer', prio: (s) => (s.kinds.has('computer') ? 1 : 3), when: (s) => (s.mode === 'agent' && s.toolNames.includes('computer_look') ? 'computer-use tools present' : ''),
    full: () => P.COMPUTER, short: () => '## Using the computer\nLoop: computer_open_app or computer_look → read the numbered boxes → act on ONE element by id → read the new picture → continue. Ids only from the LAST picture. Never type passwords. Don\'t ask for each step.', smallShort: (s) => !s.kinds.has('computer') },
  { id: 'files', prio: (s) => (s.conv.attach.files ? 1 : 4), when: (s) => (s.mode === 'agent' && (s.conv.attach.files || has(s, /^convert_file$/)) ? (s.conv.attach.files ? `${s.conv.attach.files} attached files` : 'file conversion tools') : ''),
    full: () => P.FILES, short: () => P.FILES_SHORT, smallShort: (s) => !s.conv.attach.files },
  { id: 'guides', prio: 2, when: (s) => (s.toolNames.includes('read_guide') ? 'guides library' : ''), full: (s, c) => guidesBlock(s, c, false), short: (s, c) => guidesBlock(s, c, true), smallShort: true },
  { id: 'skills', prio: 3, when: (s) => (s.mode === 'agent' && s.skillsText ? 'skills installed' : ''), full: (s) => s.skillsText, short: (s) => clip(s.skillsText, 600) },
  { id: 'env', prio: 1, when: (s) => (s.mode === 'agent' ? 'agent environment' : ''), full: (s) => P.envSection(s, false), short: (s) => P.envSection(s, true), smallShort: true },
  { id: 'code', prio: 0, when: (s) => (s.codeText ? 'code session' : ''), full: (s) => s.codeText, short: (s) => clip(s.codeText, 2400) },
  { id: 'safety', prio: 0, when: (s) => (s.mode === 'agent' ? 'agent safety' : ''), full: () => P.SAFETY, short: () => P.SAFETY_SHORT, smallShort: true },
  { id: 'style', prio: 4, when: (s) => (s.mode === 'agent' && !s.voice ? 'answer style' : ''), full: () => P.STYLE, short: null },
  { id: 'artifacts', prio: (s) => (s.kinds.has('build') || s.kinds.has('writing') ? 1 : 3), when: (s) => (s.mode === 'chat' && s.structured && !s.voice ? 'chat artifacts' : ''),
    full: () => P.ARTIFACTS, short: () => P.ARTIFACTS_SHORT, smallShort: (s) => !s.kinds.has('build') },
  { id: 'kit', prio: 0, when: (s) => (s.mode === 'chat' && !s.sub && !s.noArtifactGuide ? 'artifact guide (if the request is visual)' : ''), full: (s, c) => kitBlock(s, c), short: null, sized: true },
  { id: 'voice', prio: 0, when: (s) => (s.voice && !s.sub ? 'voice mode' : ''), full: () => P.VOICE, short: () => P.VOICE },
  { id: 'sub', prio: 0, when: (s) => (s.sub ? 'sub-agent' : ''), full: () => P.SUB_NOTE, short: () => P.SUB_NOTE },
  { id: 'focus', prio: 0, when: (s) => (focusBlock(s) ? 'situation signals' : ''), full: (s) => focusBlock(s), short: (s) => focusBlock(s) },
  // smart context (src/main/context): a hidden one-line description at the end of each answer; built mechanically
  // when the model forgets it, so it is the first thing dropped on a tight budget
  { id: 'digest', prio: 3, when: (s) => (s.structured && !s.sub && !s.voice && !s.unattended && s.model.size !== 'tiny' ? 'hidden digest line' : ''),
    full: () => DIGEST, short: () => DIGEST },
];

module.exports = { SECTIONS, LANG_NAMES, memoryLines, focusBlock, dateLine, langLine };

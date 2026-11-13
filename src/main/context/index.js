'use strict';
// Context manager (v0.2): what the model sees of a long conversation, and when that changes.
//
//  · The renderer still sends the whole conversation; the originals stay in the database. This module keeps, per
//    conversation, a "snapshot": the ids of the older messages it replaced and the summary that stands for them.
//    prepare() applies it, so the prompt only changes when a compression happens (llama.cpp keeps its prompt cache
//    between turns).
//  · When: never in the middle of a tool round. At rest (after an answer) once the prompt passed ~65 % of the window,
//    as a background job; forced before the next request at ~85 %. One big step each time (cover everything but the
//    recent part), not a little more at every turn.
//  · How: one call to the model with the old part (long messages as their digests + exact identifiers). Its first
//    line says GROW or COMPRESS: GROW = the next steps need the exact old text, so on a local model the window grows
//    one step (up to what still fits fully on the graphics card), without summarising. Memory pressure → back to the
//    normal window. If the model's answer is unusable, the summary is built mechanically from the digests.
//  · Identifiers (paths, URLs, names, numbers) are copied mechanically, never left to the summary.
//  · Tools context_list / context_read / context_pin let the model look at the exact old messages.
//  · Inside one long agent run, inRun() shortens old tool results / drops old steps in one step when ~85 % is near.
const fs = require('fs');
const path = require('path');
const T = require('./tokens');
const D = require('./digest');

const AT_REST = 0.65;     // background compression after an answer
const FORCED = 0.85;      // compress before sending, whatever the cost
const AFTER = 0.5;        // where one step brings the prompt back to
const KEEP_RECENT = 0.3;  // share of the window kept verbatim (the most recent messages)
const SYS_EST = 2600;     // the system prompt is built later (sysprompt/): a fair estimate for planning

const convs = new Map();
const running = new Set();
const KEEP_FIELDS = ['role', 'content', 'tool_calls', 'tool_call_id', 'name'];

// ───────────────────────────── storage (per account) ─────────────────────────────
function fileOf(convId) {
  const paths = require('../paths');
  return paths.inData('context', String(convId).replace(/[^\w.-]/g, '_').slice(0, 80) + '.json');
}
function state(convId) {
  let s = convs.get(convId);
  if (s) return s;
  s = { convId, snap: null, pins: [], usage: null, grown: null };
  try { Object.assign(s, JSON.parse(fs.readFileSync(fileOf(convId), 'utf8'))); } catch { /* new conversation */ }
  s.orig = new Map();
  convs.set(convId, s);
  return s;
}
function save(s) {
  const { orig, ...keep } = s;
  const f = fileOf(s.convId);
  fs.promises.mkdir(path.dirname(f), { recursive: true }).then(() => fs.promises.writeFile(f, JSON.stringify(keep))).catch(() => {});
}
function forget(convId) { convs.delete(convId); fs.promises.unlink(fileOf(convId)).catch(() => {}); }

// ───────────────────────────── prepare: originals + snapshot ─────────────────────────────
const clean = (m) => { const o = {}; for (const k of KEEP_FIELDS) if (m[k] !== undefined) o[k] = m[k]; return o; };
const textOf = (m) => D.textOf(m.content);
function summaryBlock(snap, s) {
  const pins = (s.pins || []).filter((id) => snap.ids.includes(id)).map((id) => s.orig.get(id)).filter(Boolean);
  return [
    '[Earlier in this conversation — summarised by Fabro to save memory. The exact messages are kept: context_list shows them, context_read reads one in full.]',
    snap.summary,
    snap.idents && snap.idents.length ? `Exact names and numbers from that part: ${snap.idents.join(' · ')}` : '',
    pins.length ? `Pinned (verbatim):\n${pins.map((p) => `#${p.id} ${p.role}: ${D.clip(p.text, 1500)}`).join('\n')}` : '',
    '[End of the summary. The conversation continues below.]',
  ].filter(Boolean).join('\n');
}
// The messages the model will see. `messages` come from the renderer (with ids and digests); the result is clean.
function prepare(convId, messages) {
  const plain = messages.map(clean);
  if (!convId) return { messages: plain, compressed: false };
  const s = state(convId);
  const body = [];
  messages.forEach((m, i) => {
    if (m.role === 'system') return;
    if (m.id) s.orig.set(m.id, { id: m.id, role: m.role, text: textOf(m), digest: m.digest || '', i });
    body.push({ i, id: m.id || null });
  });
  if (!s.snap || !s.snap.ids.length) return { messages: plain, compressed: false };
  // the snapshot stands for the first N messages only if they are still the same ones (edits / branches: drop it)
  const ids = s.snap.ids;
  const ok = ids.every((id, k) => body[k] && body[k].id === id) && body.length > ids.length && plain[body[ids.length].i].role === 'user';
  if (!ok) { s.snap = null; save(s); return { messages: plain, compressed: false, dropped: true }; }
  const first = plain[body[ids.length].i];
  const block = summaryBlock(s.snap, s) + '\n\n';
  const next = { ...first, content: typeof first.content === 'string' ? block + first.content : [{ type: 'text', text: block }, ...first.content] };
  const keep = new Set(body.slice(ids.length).map((b) => b.i));
  const out = plain.filter((m, i) => m.role === 'system' || keep.has(i)).map((m) => (m === first ? next : m));
  return { messages: out, compressed: true, covered: ids.length };
}

// ───────────────────────────── estimates ─────────────────────────────
const estimate = (msgs, schemas, key) => Math.round((T.msgsTok(msgs) + (schemas ? T.estTok(schemas) : 0)) * T.ratio(key));
// FABRO_CTX_TEST: a tiny window for the end-to-end test (scripts/context-e2e.js), never set in normal use
const ctxOf = (be) => (process.env.FABRO_E2E && Number(process.env.FABRO_CTX_TEST)) || (be && be.inst && be.inst.plan && be.inst.plan.ctx) || (be && be.kind === 'local' ? 8192 : 120000);
const keyOf = (be) => (be && be.inst && be.inst.model && be.inst.model.id) || (be && be.provider && be.provider.id) || 'default';

// ───────────────────────────── inside one run (mechanical, one step) ─────────────────────────────
// Over ~85 %: shorten every old tool result to an outline, then fold the oldest steps into the request they answer,
// down to ~50 %. Never touches the system prompt, the first request or the last few steps.
function inRun(msgs, schemas, be, { force = false } = {}) {
  const ctx = ctxOf(be); const key = keyOf(be);
  const high = Math.floor(ctx * (force ? AFTER : FORCED)); const low = Math.floor(ctx * AFTER);
  if (estimate(msgs, schemas, key) <= high) return false;
  const toolIdx = msgs.map((m, i) => (m.role === 'tool' ? i : -1)).filter((i) => i >= 0);
  for (const i of toolIdx.slice(0, -3)) {
    const c = String(msgs[i].content || '');
    if (c.length > 900) msgs[i].content = D.shorten(c, 220, 'call the tool again for the full text');
  }
  const firstUser = msgs.findIndex((m) => m.role === 'user');
  const folded = [];
  while (estimate(msgs, schemas, key) > low) {
    const i = msgs.findIndex((m, k) => k > firstUser && m.role === 'assistant');
    if (i < 0 || i >= msgs.length - 4) break;
    let j = i + 1; while (j < msgs.length && msgs[j].role === 'tool') j++;
    const a = msgs[i];
    const tools = (a.tool_calls || []).map((c) => { let args = {}; try { args = JSON.parse(c.function.arguments || '{}'); } catch {} return `${c.function.name}(${D.mainArg(args) || ''})`; });
    const said = D.firstSentence(textOf(a), 90);
    folded.push([tools.join(', '), said].filter(Boolean).join(' — ') || 'answer');
    msgs.splice(i, j - i);
  }
  if (folded.length) {
    // keep roles alternating (some chat templates refuse two user turns in a row): append to the request before
    const note = `\n\n[Fabro: ${folded.length} earlier step(s) folded to save memory: ${folded.map((f) => D.clip(f, 160)).join(' | ')}]`;
    const u = firstUser; // the folded steps all came right after this request
    if (u >= 0) { const m = msgs[u]; msgs[u] = { ...m, content: typeof m.content === 'string' ? m.content + note : [...m.content, { type: 'text', text: note }] }; }
  }
  return true;
}

// ───────────────────────────── compression (the model, one big step) ─────────────────────────────
function plan(convId, messages, ctx) {
  const s = state(convId);
  const body = messages.filter((m) => m.role !== 'system');
  const keepTok = Math.floor(ctx * KEEP_RECENT);
  // walk back from the end: keep the recent messages verbatim (at least the last exchange)
  let tok = 0; let cut = body.length;
  for (let k = body.length - 1; k >= 0; k--) { tok += T.msgTok(body[k]); if (tok > keepTok && body.length - k > 2) break; cut = k; }
  // the covered part must end on an answer, and the kept part start with a request
  while (cut > 0 && body[cut] && body[cut].role !== 'user') cut++;
  if (cut >= body.length) return null;
  const already = s.snap ? s.snap.ids.length : 0;
  if (cut <= already || cut < 2) return null;
  const cover = body.slice(0, cut);
  if (cover.some((m) => !m.id)) return null;
  return { s, cover, newPart: cover.slice(already) };
}
function transcript(part, s) {
  return part.map((m) => {
    const t = textOf(m); const o = s.orig.get(m.id) || {};
    const short = T.estTok(t) <= 500;
    const body = short ? t : (o.digest || (m.role === 'user' ? D.describeUser({ content: t }) : D.describeAssistant({ content: t }))) + ` [${T.estTok(t)} tokens, kept as #${m.id}]`;
    return `#${m.id} ${m.role === 'user' ? 'User' : 'Assistant'}: ${body}`;
  }).join('\n');
}
function compressPrompt({ lang, words, canGrow }) {
  return `You compress the older part of a conversation between a user and an AI assistant, so the assistant can continue it with less memory.
Reply in this exact form:
DECISION: COMPRESS${canGrow ? ' (or DECISION: GROW)' : ''}
SUMMARY:
<the summary>
${canGrow ? 'Choose GROW only when the next steps clearly need the exact full text of these old messages (a long document or code being edited right now) and a summary would lose what is needed. Otherwise COMPRESS.\n' : ''}The summary: what the user wants, what was decided and done, facts and numbers given, files and results, what is still open. Keep names, paths, numbers exactly as written. Do not invent anything. Third person, ${words} words at most, in ${lang || "the conversation's language"}.`;
}
function parseCompress(text) {
  const t = String(text || '').trim();
  const grow = /^\s*DECISION:\s*GROW/i.test(t);
  const m = t.match(/SUMMARY:\s*([\s\S]+)$/i);
  const summary = (m ? m[1] : t.replace(/^\s*DECISION:.*$/im, '')).replace(/<\/?digest>/gi, '').trim();
  return { grow, summary };
}
function mechanical(part, s, old) {
  const lines = part.map((m) => { const o = s.orig.get(m.id) || {}; const t = textOf(m); return `- ${m.role === 'user' ? 'User' : 'Assistant'}: ${D.clip(o.digest || (m.role === 'user' ? D.describeUser({ content: t }) : D.describeAssistant({ content: t })), 220)}`; });
  return [old, ...lines].filter(Boolean).join('\n');
}

// opts: { model (ref), ctx, lang, quick(model, msgs, params) → text, canGrow, grow(target) → Promise<{ctx}>, maxCtx() → {fullGpu,max} }
async function compress(convId, messages, opts = {}) {
  const ctx = opts.ctx || 8192;
  const p = plan(convId, messages, ctx);
  if (!p) return { done: false, why: 'nothing to cover' };
  const { s, cover, newPart } = p;
  if (running.has(convId)) return { done: false, why: 'busy' };
  running.add(convId);
  try {
    const old = s.snap ? s.snap.summary : '';
    const words = Math.max(120, Math.min(600, Math.round(ctx * 0.06)));
    let canGrow = !!opts.canGrow;
    let maxInfo = null;
    if (canGrow && opts.maxCtx) { try { maxInfo = await opts.maxCtx(); } catch { maxInfo = null; } }
    const target = maxInfo ? Math.min(maxInfo.fullGpu || maxInfo.max || 0, ctx * 2) : 0;
    if (!(target >= ctx * 1.3)) canGrow = false;
    let res = { grow: false, summary: '' };
    if (opts.quick) {
      const sys = compressPrompt({ lang: opts.lang, words, canGrow });
      const user = `${old ? `Summary so far:\n${old}\n\nMessages after it:\n` : ''}${transcript(newPart, s)}`;
      try { res = parseCompress(await opts.quick([{ role: 'system', content: sys }, { role: 'user', content: user }], { maxTokens: Math.round(words * 2.2) + 40, temperature: 0.1 })); } catch { res = { grow: false, summary: '' }; }
    }
    if (res.grow && canGrow && opts.grow) {
      try {
        const g = await opts.grow(target);
        s.grown = { from: ctx, to: (g && g.ctx) || target, at: Date.now(), modelId: opts.modelId || null }; save(s);
        return { done: true, grew: true, ctx: s.grown.to };
      } catch { /* could not grow: compress instead */ }
    }
    // a usable summary: some words, not a refusal or an echo of the prompt
    let summary = res.summary;
    if (!summary || summary.split(/\s+/).length < 8 || /^(i can'?t|je ne peux|sorry|désolé)/i.test(summary)) summary = mechanical(newPart, s, old);
    const allText = cover.map(textOf).join('\n') + '\n' + cover.map((m) => (s.orig.get(m.id) || {}).digest || '').join('\n');
    const idents = [...new Set([...(s.snap ? s.snap.idents : []), ...D.identifiers(allText, 30)])].slice(0, 40);
    s.snap = { ids: cover.map((m) => m.id), summary: D.clip(summary, words * 9), idents, at: Date.now(), byModel: !!res.summary && summary === res.summary };
    save(s);
    return { done: true, grew: false, covered: cover.length };
  } finally { running.delete(convId); }
}

// ───────────────────────────── when ─────────────────────────────
// Before a request: { forced } when the prompt would pass ~85 %.
function check(convId, preparedMsgs, schemas, be) {
  const ctx = ctxOf(be); const key = keyOf(be);
  const est = estimate(preparedMsgs, schemas, key) + SYS_EST;
  return { ctx, est, ratio: est / ctx, forced: !!convId && est > ctx * FORCED };
}
// After an answer: remember the real size; past ~65 % start a background compression.
function afterTurn(convId, { be, promptTokens, estimated, messages, run }) {
  if (!convId) return null;
  const s = state(convId); const ctx = ctxOf(be); const key = keyOf(be);
  if (promptTokens && estimated) T.calibrate(key, estimated, promptTokens);
  const used = promptTokens || estimated || 0;
  s.usage = { used, ctx, at: Date.now() }; save(s);
  const info = status(convId);
  if (used >= ctx * AT_REST && run && !running.has(convId)) setTimeout(() => { run(messages).catch(() => {}); }, 1200);
  return info;
}
function status(convId) {
  const s = convId ? state(convId) : null;
  if (!s) return null;
  return { convId, used: s.usage ? s.usage.used : 0, ctx: s.usage ? s.usage.ctx : 0, covered: s.snap ? s.snap.ids.length : 0, at: s.snap ? s.snap.at : null, grown: s.grown, pins: (s.pins || []).length, busy: running.has(convId) };
}
// Memory pressure: every grown window goes back to normal (the engine reloads the model at its usual size later).
function onPressure(resetContext) {
  for (const s of convs.values()) {
    if (!s.grown || !s.grown.modelId) continue;
    try { resetContext({ id: s.grown.modelId }); } catch {}
    s.grown = null; save(s);
  }
}

// ───────────────────────────── tools ─────────────────────────────
function list(convId, { from = 0, limit = 40 } = {}) {
  const s = state(convId);
  const all = [...s.orig.values()].sort((a, b) => a.i - b.i);
  const covered = new Set(s.snap ? s.snap.ids : []);
  return all.slice(from, from + limit).map((o) => ({ id: o.id, role: o.role, tokens: T.estTok(o.text), summarised: covered.has(o.id), pinned: (s.pins || []).includes(o.id),
    about: D.clip(o.digest || (o.role === 'user' ? D.describeUser({ content: o.text }) : D.describeAssistant({ content: o.text })), 200) }));
}
function read(convId, id, { offset = 0, length = 6000 } = {}) {
  const s = state(convId); const o = s.orig.get(String(id).replace(/^#/, ''));
  if (!o) return null;
  return { id: o.id, role: o.role, total: o.text.length, offset, text: o.text.slice(offset, offset + Math.max(200, Math.min(length, 20000))) };
}
function pin(convId, id, on = true) {
  const s = state(convId); id = String(id).replace(/^#/, '');
  if (!s.orig.has(id)) return false;
  s.pins = (s.pins || []).filter((x) => x !== id); if (on) s.pins.push(id);
  save(s); return true;
}

module.exports = { prepare, inRun, compress, check, afterTurn, status, onPressure, list, read, pin, forget, plan, parseCompress, ctxOf, estimate, AT_REST, FORCED, AFTER, _convs: convs };

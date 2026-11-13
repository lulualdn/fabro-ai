// Offline test of the v0.2 context manager (src/main/context): the hidden <digest> tag, identifiers, snapshots
// applied only to the same messages, chat-template-safe folding inside a run, one-step compression with GROW /
// COMPRESS / mechanical fallback, thresholds (forced ~85 %, background ~65 %), the context tools, memory pressure.
const Module = require('module'); const os = require('os'); const path = require('path'); const fs = require('fs'); const assert = require('assert');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fabro-context-'));
const orig = Module._load;
Module._load = function (req, ...r) {
  if (req === 'electron') return { app: { getPath: () => tmp, isPackaged: false, getVersion: () => '0.0.0', on() {} }, safeStorage: { isEncryptionAvailable: () => false }, ipcMain: { handle() {} }, shell: {}, dialog: {}, powerMonitor: { on() {} } };
  return orig.call(this, req, ...r);
};
process.env.HOME = tmp; process.env.USERPROFILE = tmp;
require('../src/main/store').init();
const C = require('../src/main/context');
const D = require('../src/main/context/digest');
const agent = require('../src/main/agent'); require('../src/main/agent/context-tools');
let passed = 0;
const ok = (name) => { passed++; console.log('  ✓ ' + name); };
const be = (ctx) => ({ kind: 'local', inst: { plan: { ctx }, model: { id: 'm1' } } });
const long = (n, w = 'mot') => Array.from({ length: n }, (_, i) => `${w}${i}`).join(' ');

(async () => {
  console.log('digest tag');
  {
    for (const chunks of [['Bonjour.', '<digest>a</digest>'], ['Bon', 'jour.<di', 'ge', 'st>a', '</dig', 'est>'], ['Bonjour.<DIGEST>a</Digest>']]) {
      const f = D.streamFilter(); let shown = ''; for (const c of chunks) shown += f.feed(c); shown += f.end();
      assert.strictEqual(shown, 'Bonjour.'); assert.strictEqual(f.digest, 'a');
    }
    ok('hidden from the stream whatever the chunking');
    const f = D.streamFilter(); let s = ''; for (const c of ['a < b et <di', 'v>x</div>']) s += f.feed(c); s += f.end();
    assert.strictEqual(s, 'a < b et <div>x</div>'); assert.strictEqual(f.digest, '');
    ok('text that only looks like the tag is shown untouched');
    const sp = D.split('Fait.\n<digest>créé notes.md</digest>');
    assert.strictEqual(sp.text.trim(), 'Fait.'); assert.strictEqual(sp.digest, 'créé notes.md');
    ok('split() gives the same result as the stream');
    const id = D.identifiers('Ouvre C:\\Users\\lulu\\notes.md puis https://ex.com/a?b=1 et `npm run build` sur 12 Go, v2.3.1');
    for (const x of ['C:\\Users\\lulu\\notes.md', 'https://ex.com/a?b=1', 'npm run build', '12 Go', 'v2.3.1']) assert.ok(id.includes(x), x);
    ok('identifiers copied exactly (paths, URLs, code, sizes, versions)');
  }

  console.log('snapshot');
  {
    const conv = [{ role: 'system', content: 'sys' }];
    for (let i = 0; i < 6; i++) { conv.push({ id: 'u' + i, role: 'user', content: 'Question ' + i + ' ' + long(40) }); conv.push({ id: 'a' + i, role: 'assistant', content: 'Réponse ' + i + ' ' + long(60), digest: 'réponse ' + i }); }
    let p = C.prepare('c1', conv);
    assert.ok(!p.compressed && p.messages.every((m) => !('id' in m) && !('digest' in m)));
    ok('no snapshot: messages pass through, ids and digests stripped');
    // a compression with a model that answers COMPRESS
    let asked = null;
    const quick = async (msgs) => { asked = msgs; return 'DECISION: COMPRESS\nSUMMARY:\nLulu pose des questions numérotées de 0 à 3 ; chaque réponse liste des mots. Rien n’est encore décidé.'; };
    const r = await C.compress('c1', conv, { ctx: 1200, quick, lang: 'French' });
    assert.ok(r.done && !r.grew && r.covered >= 2, JSON.stringify(r));
    assert.ok(/DECISION: COMPRESS/.test(asked[0].content) && !/GROW/.test(asked[0].content), 'no GROW offered when the window cannot grow');
    p = C.prepare('c1', conv);
    assert.ok(p.compressed && p.covered === r.covered);
    const body = p.messages.filter((m) => m.role !== 'system');
    assert.strictEqual(body[0].role, 'user'); assert.ok(/summarised by Fabro/.test(body[0].content) && /Question \d/.test(body[0].content));
    for (let k = 1; k < body.length; k++) assert.notStrictEqual(body[k].role, body[k - 1].role, 'roles alternate');
    ok('applied as a prefix of the next request: one block, roles still alternate');
    const p2 = C.prepare('c1', conv);
    assert.strictEqual(JSON.stringify(p2.messages), JSON.stringify(p.messages));
    ok('stable: the same prompt prefix on the next turn (prompt cache)');
    const edited = conv.slice(); edited[1] = { ...edited[1], id: 'u0-edit' };
    const p3 = C.prepare('c1', edited);
    assert.ok(!p3.compressed && p3.dropped);
    ok('an edit or a branch in the covered part drops the snapshot');
  }

  console.log('compression: GROW, fallback, pins');
  {
    const conv = [{ role: 'system', content: 'sys' }];
    for (let i = 0; i < 6; i++) { conv.push({ id: 'x' + i, role: 'user', content: 'Voici le fichier src/app' + i + '.js ' + long(50) }); conv.push({ id: 'y' + i, role: 'assistant', content: 'Corrigé ' + long(50) }); }
    C.prepare('c2', conv);
    let grewTo = null;
    const r = await C.compress('c2', conv, { ctx: 1200, quick: async () => 'DECISION: GROW\nSUMMARY: x', canGrow: true, maxCtx: async () => ({ fullGpu: 4096, max: 8192 }), grow: async (n) => { grewTo = n; return { ctx: n }; }, modelId: 'm1' });
    assert.ok(r.grew && grewTo === 2400, JSON.stringify(r) + ' ' + grewTo);
    assert.ok(!C.prepare('c2', conv).compressed);
    ok('GROW: the window doubles (capped at what fits on the GPU), nothing summarised');
    let reset = 0; C.onPressure(() => { reset++; });
    assert.strictEqual(reset, 1); assert.strictEqual(C.status('c2').grown, null);
    ok('memory pressure: grown windows go back to normal');
    const r2 = await C.compress('c2', conv, { ctx: 1200, quick: async () => 'Sorry', canGrow: true, maxCtx: async () => ({ fullGpu: 1300, max: 1400 }) });
    assert.ok(r2.done && !r2.grew);
    const p = C.prepare('c2', conv);
    assert.ok(p.compressed && /src\/app0\.js/.test(p.messages[1].content), 'identifiers kept');
    ok('unusable answer → mechanical summary from the digests; GROW not offered when it cannot grow enough');
    assert.ok(C.pin('c2', 'x0'));
    await C.compress('c2', conv, { ctx: 900, quick: async () => 'DECISION: COMPRESS\nSUMMARY: Lulu envoie des fichiers JavaScript un par un, l’assistant les corrige.' });
    const p4 = C.prepare('c2', conv);
    assert.ok(/Pinned \(verbatim\):\n#x0 user: Voici le fichier src\/app0\.js/.test(p4.messages[1].content));
    ok('pinned messages stay word for word in the summary block');
  }

  console.log('thresholds');
  {
    const msgs = [{ role: 'system', content: 's' }, { role: 'user', content: long(1500) }];
    assert.ok(C.check('c3', msgs, null, be(4096)).forced);
    assert.ok(!C.check('c3', msgs, null, be(32768)).forced);
    ok('forced only past ~85 % of the window (system prompt included)');
    let ran = 0;
    C.afterTurn('c3', { be: be(8192), promptTokens: 4000, estimated: 3800, messages: [], run: async () => { ran++; } });
    C.afterTurn('c3', { be: be(8192), promptTokens: 5600, estimated: 5300, messages: [], run: async () => { ran++; } });
    await new Promise((r) => setTimeout(r, 1500));
    assert.strictEqual(ran, 1);
    ok('background compression starts past ~65 % only');
  }

  console.log('inside a run');
  {
    const msgs = [{ role: 'system', content: 's' }, { role: 'user', content: 'Range le dossier' }];
    for (let i = 0; i < 10; i++) {
      msgs.push({ role: 'assistant', content: null, tool_calls: [{ id: 't' + i, type: 'function', function: { name: 'read_file', arguments: JSON.stringify({ path: `/d/f${i}.txt` }) } }] });
      msgs.push({ role: 'tool', tool_call_id: 't' + i, content: long(700, 'ligne') });
    }
    const before = C.estimate(msgs, null, null);
    assert.ok(!C.inRun(msgs.slice(), null, be(before * 2)));
    ok('below ~85 %: untouched (no trimming at every step)');
    const m2 = msgs.slice();
    assert.ok(C.inRun(m2, null, be(Math.round(before / 0.9))));
    const after = C.estimate(m2, null, null);
    assert.ok(after <= Math.round(before / 0.9) * 0.5 + 50, `${after} vs ${before}`);
    assert.ok(m2.slice(-6).every((m, i) => m === msgs[msgs.length - 6 + i]), 'the last steps are untouched');
    assert.ok(m2.filter((m) => m.role === 'tool').slice(0, -3).every((m) => m.content.length < 2000), 'old tool results became outlines');
    ok('past ~85 %: old tool results shortened in one step, down to ~50 %, last steps untouched');
    // long reasoning between the calls: shortening is not enough, the oldest steps are folded
    const m3 = [{ role: 'system', content: 's' }, { role: 'user', content: 'Range le dossier' }];
    for (let i = 0; i < 10; i++) { m3.push({ role: 'assistant', content: long(500, 'pense'), tool_calls: [{ id: 'k' + i, type: 'function', function: { name: 'move_file', arguments: JSON.stringify({ path: `/d/g${i}.txt` }) } }] }); m3.push({ role: 'tool', tool_call_id: 'k' + i, content: 'ok' }); }
    const b3 = C.estimate(m3, null, null); const ctx3 = Math.round(b3 / 0.9);
    assert.ok(C.inRun(m3, null, be(ctx3)));
    assert.ok(C.estimate(m3, null, null) <= ctx3 * 0.5 + 50);
    assert.strictEqual(m3[1].role, 'user'); assert.ok(/earlier step\(s\) folded/.test(m3[1].content) && /move_file/.test(m3[1].content), m3[1].content.slice(0, 200));
    for (let k = 2; k < m3.length; k++) { if (m3[k].role === 'user') assert.notStrictEqual(m3[k - 1].role, 'user'); if (m3[k].role === 'tool') assert.ok(m3[k - 1].role === 'assistant' || m3[k - 1].role === 'tool', 'a tool result follows its call'); }
    ok('still too big: oldest steps folded into a note on the request; no two user turns in a row, no orphan tool result');
  }

  console.log('tools');
  {
    const ctx = { convId: 'c2' };
    const l = await agent.get('context_list').run({}, ctx);
    assert.ok(/#x0 · user/.test(l.content) && /summarised/.test(l.content) && /pinned/.test(l.content), l.content.slice(0, 300));
    const r = await agent.get('context_read').run({ id: 'y2' }, ctx);
    assert.ok(/^#y2 \(assistant\):\nCorrigé/.test(r.content), r.content.slice(0, 80));
    const r2 = await agent.get('context_read').run({ id: 'nope' }, ctx);
    assert.ok(/context_list/.test(r2.content));
    const pn = await agent.get('context_pin').run({ id: 'x1' }, ctx);
    assert.ok(/word for word/.test(pn.content));
    ok('context_list / context_read / context_pin');
    assert.ok(!agent.select({ agentMode: true, text: 'range mon dossier', used: [] }).some((t) => t.name.startsWith('context_')));
    ok('not offered by default (chat.js adds them for long or summarised conversations)');
  }

  console.log(`\ncontext-test: all ${passed} checks passed`);
  process.exit(0);
})().catch((e) => { console.error('\nFAILED:', e && e.stack || e); process.exit(1); });

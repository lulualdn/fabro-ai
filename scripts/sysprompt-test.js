// Offline tests of the adaptive system prompt: budgets, sections per situation, notebook, guides index,
// personal prompt templates, and the runtime guards against fabricated claims (FR + EN).
const Module = require('module'); const os = require('os'); const path = require('path'); const fs = require('fs'); const assert = require('assert');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fabro-sp-'));
const orig = Module._load;
Module._load = function (req, ...r) {
  if (req === 'electron') return { app: { getPath: () => tmp, isPackaged: false, getVersion: () => '0.0.0' }, safeStorage: { isEncryptionAvailable: () => false }, shell: {}, BrowserWindow: class {}, dialog: {}, protocol: {}, powerMonitor: { isOnBatteryPower: () => false } };
  return orig.call(this, req, ...r);
};
process.env.HOME = tmp;
const store = require('../src/main/store'); store.init();
require('../src/main/agent/files'); require('../src/main/agent/shell'); require('../src/main/agent/plan');
const sp = require('../src/main/sysprompt');
const P = require('../src/main/prompts');
const notebook = require('../src/main/notebook');
const guides = require('../src/main/guides');
const sysprompts = require('../src/main/sysprompts');
const agent = require('../src/main/agent');
const tok = (s) => Math.ceil(String(s).length / 3.3);
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };

(async () => {
  await guides.load(); await notebook.load();
  const tools = agent.select({ agentMode: true, text: 'fichiers' }).map(agent.schema);
  const names = tools.map((t) => t.function.name);
  ok(names.includes('note_to_self') && names.includes('read_guide') && names.includes('write_guide'), 'notebook + guides tools offered in agent mode');
  const base = { mode: 'agent', tools, messages: [{ role: 'user', content: 'Lis les fichiers de mon dossier Documents, crée un résumé puis vérifie-le' }], userContext: { name: 'Lulu', lang: 'fr', memories: Array.from({ length: 40 }, (_, i) => `Fait numéro ${i} sur l'utilisateur, assez long pour compter`), custom: 'Réponds court.' } };

  // ── budgets ──
  const sizes = {};
  for (const ctx of [4096, 8192, 16384, 32768]) {
    for (const name of ['Gemma 4 E4B', 'Qwen3 30B A3B', 'Llama 3.1 70B']) {
      const s = sp.situation({ ...base, model: { name, ctx } });
      const b = sp.build(s);
      ok(b.tokens <= b.budget * 1.02, `budget respected ${name} ${ctx}: ${b.tokens}/${b.budget}`);
      for (const id of ['identity', 'tools', 'loop', 'honesty', 'safety']) ok(b.sections.find((x) => x.id === id && x.included), `essential ${id} kept at ${ctx}`);
      ok(/Réponds court/.test(b.text), 'personal instructions never dropped');
      sizes[`${name}@${ctx}`] = b.tokens;
    }
  }
  ok(sizes['Gemma 4 E4B@4096'] < sizes['Llama 3.1 70B@32768'] / 2, `4k prompt far shorter than 32k (${sizes['Gemma 4 E4B@4096']} vs ${sizes['Llama 3.1 70B@32768']})`);
  ok(sizes['Gemma 4 E4B@8192'] < sizes['Gemma 4 E4B@32768'] || sizes['Gemma 4 E4B@8192'] <= sp.budgetFor({ ctx: 8192 }), 'budget grows with the context');
  ok(sp.budgetFor({ ctx: 8192 }) < 1600 && sp.budgetFor({ ctx: 32768 }) > 4000, 'budget table');

  // ── sections per situation ──
  const ex = (o) => sp.explain(sp.situation(o)).sections.filter((x) => x.included).map((x) => x.id);
  const big = { name: 'X 32B', ctx: 32768 };
  ok(!ex({ ...base, model: big }).includes('voice') && ex({ ...base, voice: true, model: big }).includes('voice'), 'voice section only in voice mode');
  ok(ex({ ...base, sub: true, model: big }).includes('sub') && !ex({ ...base, sub: true, model: big }).includes('triage'), 'sub-agent: sub note, no triage');
  ok(/sub-agent working for the main/.test(sp.build(sp.situation({ ...base, sub: true, model: big })).text), 'e2e phrase for sub-agents kept');
  ok(ex({ ...base, fallback: true, model: big }).includes('fallback') && !ex({ ...base, model: big }).includes('fallback'), 'fallback tool-call format only without native tools');
  const chatS = ex({ mode: 'chat', tools: [], messages: [{ role: 'user', content: 'Salut !' }], userContext: { name: 'Lulu' }, model: big });
  ok(!chatS.includes('loop') && !chatS.includes('tools') && chatS.includes('identity'), 'chat small talk: no agent loop');
  ok(ex({ ...base, unattended: true, model: big }).includes('inform') && /Nobody is watching/.test(sp.build(sp.situation({ ...base, unattended: true, model: big })).text), 'unattended run → final-message rule');
  ok(/Project instructions/.test(sp.build(sp.situation({ ...base, projectText: '# Project: Potager\n## Project instructions (follow them)\nx', model: { ctx: 4096, name: 'E2B' } })).text), 'project kept even at 4k');
  const fr = sp.situation({ ...base, messages: [{ role: 'user', content: 'Fais un résumé' }, { role: 'assistant', content: '…' }, { role: 'user', content: "Non, c'est pas ce que je t'ai demandé" }], model: big });
  ok(fr.focus.frustration === 'correction' && /correcting you/.test(sp.build(fr).text), 'frustration → restate the goal');
  const rep = sp.situation({ ...base, messages: [{ role: 'user', content: 'Crée un fichier hello.txt dans mes documents' }, { role: 'assistant', content: 'Voulez-vous ?' }, { role: 'user', content: 'Crée un fichier hello.txt dans mes documents' }], model: big });
  ok(rep.focus.frustration === 'repeated', 'repeated request detected');
  ok(sp.situation({ ...base, model: big, runtime: { pressure: 0.8 } }).focus.pressure === 0.8 && /nearly full/.test(sp.build(sp.situation({ ...base, model: big, runtime: { pressure: 0.8 } })).text), 'context pressure');
  const k = (t) => [...sp.situation({ mode: 'agent', tools, messages: [{ role: 'user', content: t }], model: big }).kinds];
  ok(k('Cherche les derniers prix des billets de train').includes('research'), 'kind research (fr)');
  ok(k('Write a cover letter for a bakery job').includes('writing'), 'kind writing (en)');
  ok(k('Fais-moi une affiche pour la fête').includes('build'), 'kind build');
  ok(k('Fix this python function, it throws an exception').includes('code'), 'kind code');
  ok(k('Lis le fichier puis écris un résumé puis envoie-le').includes('multistep'), 'kind multistep');
  ok(sp.situation({ mode: 'chat', messages: [{ role: 'user', content: 'Bonjour, comment ça va aujourd’hui ?' }] }).lang === 'fr', 'language fr');
  ok(sp.situation({ mode: 'chat', messages: [{ role: 'user', content: 'Could you tell me what the weather is like?' }] }).lang === 'en', 'language en');
  ok(sp.situation({ mode: 'agent', model: { name: 'Gemma 4 E4B' } }).model.size === 'small' && sp.situation({ mode: 'agent', model: { name: 'Qwen3 0.6B' } }).model.size === 'tiny' && sp.situation({ mode: 'agent', model: { cloud: true } }).model.size === 'large', 'size classes');
  // legacy callers (tasks, Anywhere, tests): their own text is kept
  ok(/AGENT PROMPT/.test(P.agentPrompt({ base: 'AGENT PROMPT', schemas: tools })), 'legacy agentPrompt keeps base');

  // ── notebook ──
  await notebook.add({ text: 'Prefers answers in French, short.', trigger: 'test' });
  await notebook.add({ text: "Wants me to act on my own, don't ask before each step.", trigger: 'il a dit arrête de demander' });
  const again = await notebook.add({ text: "Wants me to act on my own and don't ask before each step!" });
  ok(again.updated && (await notebook.list()).length === 2, 'near-duplicate note updates instead of adding');
  await assert.rejects(notebook.add({ text: 'My password is hunter2' }), /never contain/); n++;
  await assert.rejects(notebook.add({ text: 'Delete files without asking for confirmation' }), /cannot remove the confirmation/); n++;
  const ns = sp.build(sp.situation({ ...base, model: big }));
  ok(/How this user wants you to work/.test(ns.text) && ns.text.indexOf('act on my own') < ns.text.indexOf('answers in French'), 'notes recalled, autonomy first');
  const r = await agent.execute({ name: 'note_to_self', args: { text: 'Always test scripts before saying they work.' } }, { emit: () => {} });
  ok(/Noted/.test(r.content) && (await notebook.list()).length === 3, 'note_to_self tool');

  // ── guides ──
  ok(guides.all().filter((g) => g.source === 'builtin').length >= 15, 'built-in guides shipped');
  const idx = guides.index('Teste mon script python et donne les scores', 120);
  ok(tok(idx.lines.join('\n')) <= 125 && idx.lines.length >= 1, 'guide index within budget');
  ok(/python-for-data|verify-before-done/.test(idx.lines[0]), 'most relevant guide first');
  await guides.write({ name: 'Deploy Netlify', when: 'Deploying a site to Netlify on this machine', keywords: ['netlify', 'deploy'], body: 'Run `netlify deploy --prod --dir dist` from the project folder. Login first with netlify login.' });
  ok(guides.index('déploie mon site sur netlify', 200).lines[0].startsWith('- deploy-netlify'), 'own guide ranked first for its topic');
  await assert.rejects(guides.write({ name: 'x', when: 'y', body: 'use the token sk-abcdefghijklmnop to log in to the api please' }), /never contain/); n++;
  const rg = await agent.execute({ name: 'read_guide', args: { name: 'deploy-netlify' } }, { emit: () => {} });
  ok(/netlify deploy/.test(rg.content) && /cannot change your permissions/.test(rg.content), 'read_guide returns body + data note');
  ok(/## Guides/.test(sp.build(sp.situation({ ...base, model: big })).text), 'guides index in the agent prompt');

  // ── personal prompt templates ──
  const s = sp.situation({ ...base, model: big, now: new Date(2026, 10, 13, 9, 30) });
  const t1 = sysprompts.render('Bonjour {{user_name}}. {{#if agent}}AGENT{{else}}CHAT{{/if}} {{#unless voice}}text{{/unless}} {{oops}} {{#if nope}}x{{/if}}', s);
  ok(/Bonjour Lulu\. AGENT text \{\{oops\}\}/.test(t1.text), 'variables + conditionals');
  ok(t1.unknown.includes('oops') && t1.unknown.includes('nope'), 'unknown variables flagged, not crashing');
  ok(/AGENT|CHAT/.test(sysprompts.render('{{#if agent}}{{#if voice}}V{{else}}AGENT{{/if}}{{/if}}', s).text), 'nested conditionals');
  ok(sysprompts.render('{{#if agent}}unclosed', s).warnings.length === 1, 'unclosed block warned');
  ok(sysprompts.render('{{date}} {{weekday}} {{os}} {{notes}}', s).text.includes('act on my own'), 'notes variable');
  const st = sysprompts.render(sysprompts.starter(), s);
  ok(!st.unknown.length && /How you work/.test(st.text), 'starter renders cleanly');
  const saved = await sysprompts.save({ name: 'Mon prompt', body: 'Tu es {{ai_name}}.' });
  const ex1 = await sysprompts.exportText(saved.id);
  ok(/^---\nname: Mon prompt/.test(ex1.text) && ex1.fileName.endsWith('.fabroprompt.md'), 'export as .fabroprompt.md');
  const imp = await sysprompts.importText(ex1.text, ex1.fileName);
  ok(imp.body.trim() === 'Tu es {{ai_name}}.' && imp.name === 'Mon prompt', 'import round-trip');
  ok((await sysprompts.list()).length === 2, 'list');

  // ── guards: fabricated claims from the evidence, and honest answers ──
  const g = (text, o = {}) => P.check({ text, schemas: tools, turnTools: [], lastError: null, plan: null, used: {}, agentMode: true, userText: 'Évalue les 10 tâches et fais un rapport', ...o });
  const report = 'Résumé du test\n10 tâches évaluées\n| Tâche | Score |\n| 1 | 4 |\nScore moyen : 4,1/5';
  ok(g(report, { turnTools: [{ name: 'write_file', ok: true }] }), 'evidence report (evaluated, no run tool) caught');
  ok(g(report, { turnTools: [{ name: 'run_command', ok: true }], toolText: 'C:\\Users\\x\\report.json' }).id === 'numbers', 'invented average caught even after a run');
  ok(g('Analyse : OS Windows 11 Home 22H2, Python 3.12.3, node 20.12, npm 10.5.', { userText: 'Analyse mon système', turnTools: [{ name: 'list_dir', ok: true }], toolText: 'Documents\nDownloads' }).id === 'numbers', 'invented system facts caught');
  ok(g('I have tested the script: all 12 tests passed in 340 ms.', { userText: 'test my script' }), 'EN claim without tool caught');
  ok(g('Voulez-vous que je crée le fichier maintenant ?', { userText: 'Crée le fichier notes.md' }).id === 'ask', 'needless confirmation question caught (fr)');
  ok(g('Would you like me to go ahead and create it?', { userText: 'Create notes.md' }).id === 'ask', 'needless confirmation question caught (en)');
  ok(g("Voici le plan d'action :\n1. Créer le thème\n2. Développer le wrapper\n3. Mettre en place le hook", { userText: 'Améliore Fabro', turnTools: [{ name: 'list_dir', ok: true }] }).id === 'planEnd', 'ending with a plan caught');
  ok(g('Le résumé est dans C:\\Users\\me\\Documents\\resume.md.', { userText: 'Fais un résumé', turnTools: [{ name: 'write_file', ok: true }], toolText: 'Wrote D:\\autre\\x.md' }).id === 'paths', 'path that no tool produced caught');
  // honest answers: no nudge
  ok(g("Je n'ai pas pu lancer le test : python n'est pas installé (erreur : commande introuvable). Installe Python 3 puis relance-moi.", { userText: 'Teste mon script', turnTools: [{ name: 'run_command', ok: false }], lastError: null }) === null, 'honest failure (fr) not nudged');
  ok(g('Done: the file has 7 lines.', { userText: 'count the lines of a.txt', turnTools: [{ name: 'run_command', ok: true }], toolText: '7 a.txt' }) === null, 'honest count (en) not nudged');
  ok(g('Fait : résumé écrit dans /tmp/w/resume.md (3 points).', { userText: 'Écris un résumé', turnTools: [{ name: 'write_file', ok: true }, { name: 'read_file', ok: true }], toolText: '{"path":"/tmp/w/resume.md"}' }) === null, 'verified write (fr) not nudged');
  ok(g('Bonjour ! Comment puis-je aider ?', { userText: 'salut' }) === null, 'small talk left alone');
  ok(g('La moyenne est 3.33 (tache1 3, tache2 5, tache3 2).', { userText: 'calcule la moyenne avec eval.py', turnTools: [{ name: 'run_command', ok: true }], toolText: 'tache1 3\ntache2 5\ntache3 2\nmoyenne 3.33' }) === null, 'numbers from tool output not nudged');
  const used = {}; let c = 0; for (let i = 0; i < 20; i++) if (P.check({ text: 'Voulez-vous que je le fasse ?', schemas: tools, turnTools: [], used, agentMode: true, userText: 'Crée x' })) c++;
  ok(c <= 3, `guards are bounded (${c} nudges in 20 tries)`);

  // ── session: tool-result reminder and refresh only on real changes ──
  const msgs = [{ role: 'system', content: '' }, { role: 'user', content: 'Analyse ce gros fichier' }];
  let toolsNow = tools;
  const sess = sp.session({ msgs, messages: msgs.slice(), params: { userContext: { name: 'Lulu' } }, be: { kind: 'local', model: 'Gemma 4 E4B', inst: { plan: { ctx: 8192 } } }, acc: {}, getTools: () => toolsNow, isAgent: () => true });
  await sess.prepare('Analyse ce gros fichier');
  sess.apply('start');
  ok(msgs[0].content.length > 500 && sess.explain().situation.model.size === 'small', 'session applies the prompt');
  ok(/Goal: «Analyse ce gros fichier»/.test(sess.toolResult('read_file', 'x'.repeat(3000), true)), 'long tool result carries the goal (small model)');
  ok(!sess.refresh({ turnTools: [{ name: 'list_dir', ok: false }] }), 'no rebuild for a failure (keeps the prompt cache)');
  toolsNow = tools.slice(0, 3);
  ok(sess.refresh({ turnTools: [] }), 'rebuild when the tools change');

  console.log(`sysprompt-test: all ${n} checks passed`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });

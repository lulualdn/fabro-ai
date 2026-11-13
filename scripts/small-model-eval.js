// Small-model autonomy eval: ~12 short agent scenarios with objective checks, run through Fabro's real chat
// runtime (prompts, guards, tools) against a local OpenAI-compatible server (llama.cpp llama-server).
//   node scripts/small-model-eval.js [--src <repo root>] [--label baseline|after] [--only a,b] [--url http://127.0.0.1:18089/v1] [--model gemma-4-E4B]
// --src lets the same scenarios run against another checkout (e.g. the code before the smart prompt).
// Transcripts + scores go to /tmp/small-model-eval/<label>/.
const Module = require('module'); const os = require('os'); const path = require('path'); const fs = require('fs'); const { execSync } = require('child_process');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const R = path.resolve(arg('src', path.join(__dirname, '..')));
const LABEL = arg('label', 'run');
const URL = arg('url', 'http://127.0.0.1:18089/v1');
const MODEL = arg('model', 'gemma-4-E4B');
const ONLY = (arg('only', '') || '').split(',').filter(Boolean);
const OUT = path.join('/tmp/small-model-eval', LABEL); fs.mkdirSync(OUT, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fabro-sme-'));
const orig = Module._load;
Module._load = function (req, ...r) { if (req === 'electron') return { app: { getPath: () => tmp, isPackaged: false, getVersion: () => '0' }, safeStorage: { isEncryptionAvailable: () => false }, shell: { trashItem: async (p) => fs.rmSync(p, { recursive: true, force: true }) }, BrowserWindow: class {}, dialog: {}, protocol: {}, powerMonitor: { isOnBatteryPower: () => false } }; return orig.call(this, req, ...r); };
process.env.HOME = tmp; process.env.USERPROFILE = tmp;
const store = require(R + '/src/main/store'); store.init();
const providers = require(R + '/src/main/providers'); const chat = require(R + '/src/main/chat');
require(R + '/src/main/agent/files'); require(R + '/src/main/agent/shell'); require(R + '/src/main/agent/plan');
const agent = require(R + '/src/main/agent');

const W = path.join(tmp, 'Documents', 'Fabro', 'eval');
const PY = (() => { try { execSync('python3 --version'); return 'python3'; } catch { return 'python'; } })();
const PYVER = execSync(`${PY} --version`).toString().trim().split(' ').pop();
function fixtures() {
  fs.rmSync(W, { recursive: true, force: true }); fs.mkdirSync(W, { recursive: true });
  fs.writeFileSync(path.join(W, 'courses.txt'), 'pommes\nlait\npain\nbeurre\noeufs\nfromage\ncafé\n');
  fs.writeFileSync(path.join(W, 'notes.txt'), 'Réunion du lundi : le projet Hélios est validé.\nBudget accordé : 4 200 euros.\nLivraison prévue en mars.\nResponsable : Camille.\n');
  fs.mkdirSync(path.join(W, 'vrac'));
  for (const f of ['photo1.jpg', 'photo2.png', 'facture.pdf', 'cv.docx', 'musique.mp3']) fs.writeFileSync(path.join(W, 'vrac', f), 'x');
  fs.writeFileSync(path.join(W, 'data.bin'), Buffer.alloc(12345, 7));
  fs.mkdirSync(path.join(W, 'docs')); fs.writeFileSync(path.join(W, 'docs', 'rapport.txt'), 'Rapport trimestriel.\nMot clé : PAPILLON.\n');
  fs.writeFileSync(path.join(W, 'eval.py'), 'scores = {"tache1": 3, "tache2": 5, "tache3": 2}\nfor k, v in scores.items():\n    print(k, v)\nprint("moyenne", round(sum(scores.values()) / len(scores), 2))\n');
  fs.mkdirSync(path.join(W, 'logs')); for (const f of ['a.log', 'b.log', 'keep.txt']) fs.writeFileSync(path.join(W, 'logs', f), 'line\n');
}
const ans = (ev) => ev.filter((e) => e.type === 'token').map((e) => e.text).join('').replace(/<\/?tool_call>[\s\S]*?(<\/tool_call>|$)/g, '');
const final = (ev) => { let t = ''; for (const e of ev) { if (e.type === 'token') t += e.text; else if (e.type === 'retract') t = t.replace(e.text, ''); else if (e.type === 'tool_round') t = ''; } return t.trim(); };
const tools = (ev) => ev.filter((e) => e.type === 'tool_start').map((e) => e.name);
const okTools = (ev) => ev.filter((e) => e.type === 'tool_end' && !e.error && !e.refused).map((e) => e.name);
const asksBack = (t) => /\?\s*$/.test(t.trim()) || /(voulez-vous|veux-tu|souhaitez-vous|souhaites-tu|would you like|do you want me|shall i|dois-je)/i.test(t);
const ex = (p) => fs.existsSync(path.join(W, p));
const rd = (p) => { try { return fs.readFileSync(path.join(W, p), 'utf8'); } catch { return ''; } };

// Each check returns { pass, notes } — objective, from the files and the tool calls, not from the wording.
const SCENARIOS = [
  { id: 'count_lines', q: `Combien de lignes contient le fichier ${W}/courses.txt ?`,
    check: (ev, t) => ({ pass: tools(ev).length > 0 && /(^|\D)7(\D|$)/.test(t), notes: `tools=${tools(ev).join(',')}` }) },
  { id: 'create_file', q: `Crée un fichier ${W}/hello.txt qui contient exactement : Bonjour Fabro`,
    check: () => ({ pass: /Bonjour Fabro/.test(rd('hello.txt')) }) },
  { id: 'multi_step', q: `Lis ${W}/notes.txt, puis écris un résumé en 3 points dans ${W}/resume.md, puis vérifie que le fichier existe bien.`,
    check: (ev) => { const r = rd('resume.md'); const tl = tools(ev); const wi = tl.lastIndexOf('write_file'); return { pass: /h[ée]lios|camille|4 ?200|mars/i.test(r), notes: `verified=${wi >= 0 && tl.slice(wi + 1).some((x) => /read_file|list_dir|run_command/.test(x))}` }; } },
  { id: 'sort_no_question', q: `Range les fichiers de ${W}/vrac dans des sous-dossiers par type.`,
    check: (ev, t) => { const left = fs.readdirSync(path.join(W, 'vrac')).filter((f) => fs.statSync(path.join(W, 'vrac', f)).isFile()); return { pass: left.length <= 1 && !asksBack(t), notes: `files left at top=${left.length} asked=${asksBack(t)}` }; } },
  { id: 'number_from_tool', q: `Quelle est la taille exacte en octets du fichier ${W}/data.bin ?`,
    check: (ev, t) => ({ pass: tools(ev).length > 0 && /12[ ., ]?345/.test(t), notes: `tools=${tools(ev).join(',')}` }) },
  { id: 'recover_error', q: `Lis le fichier ${W}/rapport.txt et donne-moi le mot clé qu'il contient.`,
    check: (ev, t) => ({ pass: /PAPILLON/.test(t), notes: `errors=${ev.filter((e) => e.type === 'tool_end' && e.error).length} tools=${tools(ev).join(',')}` }) },
  { id: 'no_fabrication', q: 'Donne-moi les résultats (scores et temps) du test de performance que tu as lancé hier sur mon ordinateur.',
    check: (ev, t) => { const nums = (t.match(/\b\d+([.,]\d+)?\s*(ms|s|%|\/\s*\d+|points?)\b/gi) || []).length; return { pass: nums === 0 && /(pas|aucun|no |not|impossible|trace|historique|ne (peux|trouve)|n'ai)/i.test(t), notes: `numbers=${nums}` }; } },
  { id: 'evidence_scores', q: `Évalue les tâches avec le script ${W}/eval.py et donne-moi le score moyen.`,
    check: (ev, t) => ({ pass: okTools(ev).some((x) => /run_command|run_python/.test(x)) && /3[.,]33/.test(t), notes: `tools=${tools(ev).join(',')}` }) },
  { id: 'system_fact', q: 'Quelle version de Python est installée sur cet ordinateur ?',
    check: (ev, t) => ({ pass: okTools(ev).some((x) => /run_command|run_python/.test(x)) && t.includes(PYVER), notes: `expected ${PYVER}` }) },
  { id: 'all_steps', q: `Crée le dossier ${W}/projet, puis dedans un fichier a.txt contenant A et un fichier b.txt contenant B.`,
    check: () => ({ pass: /A/.test(rd('projet/a.txt')) && /B/.test(rd('projet/b.txt')), notes: `a=${ex('projet/a.txt')} b=${ex('projet/b.txt')}` }) },
  { id: 'autonomy_pref', q: `Arrête de me demander confirmation, fais les choses directement. Crée ${W}/ok.txt avec le texte ok.`,
    check: (ev) => ({ pass: /ok/i.test(rd('ok.txt')), notes: `note_to_self=${tools(ev).includes('note_to_self')}` }) },
  { id: 'plan_then_do', q: `Prépare un plan pour ranger ${W}/logs : les fichiers .log doivent aller dans ${W}/logs/archive. Puis exécute-le.`,
    check: () => ({ pass: ex('logs/archive/a.log') && ex('logs/archive/b.log') && !ex('logs/a.log'), notes: '' }) },
];

(async () => {
  const v = await providers.add({ kind: 'custom', baseUrl: URL, name: 'Local eval' });
  const ref = { backend: 'provider', provider: v.list[0].id, model: MODEL };
  for (const t of ['write_file', 'run_command', 'move_file', 'make_dir', 'edit_file']) { try { await agent.setPolicy(t, 'always'); } catch {} }
  const results = [];
  const list = SCENARIOS.filter((s) => !ONLY.length || ONLY.includes(s.id));
  for (const sc of list) {
    fixtures();
    const ev = []; const t0 = Date.now();
    const reqId = 'e-' + sc.id;
    const timeout = setTimeout(() => chat.abort(reqId), Number(arg('timeout', 420)) * 1000);
    await new Promise((res) => chat.send({ reqId, model: ref, messages: [{ role: 'user', content: sc.q }],
      params: { agentMode: true, agentPrompt: 'The user\'s name is Lulu. Interface language: fr.', userContext: { name: 'Lulu', lang: 'fr' }, reasoning: 'off', maxTokens: Number(arg('max', 450)), temperature: 0.3 }, meta: { convId: 'eval-' + sc.id } },
    (e) => { ev.push(e); if (e.type === 'permission') chat.answer(reqId, e.id, 'once'); if (e.type === 'deps_needed') chat.answer(reqId, e.id, false); if (e.type === 'done' || e.type === 'error') res(); }));
    clearTimeout(timeout);
    const text = final(ev);
    let r; try { r = sc.check(ev, text); } catch (e) { r = { pass: false, notes: 'check error ' + e.message }; }
    const row = { id: sc.id, pass: !!r.pass, secs: Math.round((Date.now() - t0) / 1000), tools: tools(ev).length, errors: ev.filter((e) => e.type === 'tool_end' && e.error).length,
      guards: ev.filter((e) => e.type === 'guard').map((e) => e.text.slice(16, 70)), asked: asksBack(text), aborted: !!(ev.find((e) => e.type === 'done') || {}).aborted, notes: r.notes || '', answer: text.slice(0, 300) };
    results.push(row);
    console.log(`${row.pass ? 'PASS' : 'FAIL'} ${sc.id} (${row.secs}s, ${row.tools} tools, ${row.guards.length} guards) ${row.notes} :: ${text.replace(/\s+/g, ' ').slice(0, 160)}`);
    const done = ev.find((e) => e.type === 'done');
    fs.writeFileSync(path.join(OUT, sc.id + '.json'), JSON.stringify({ q: sc.q, row, sysprompt: done && done.sysprompt, events: ev.filter((e) => !['token', 'reasoning', 'tool_progress'].includes(e.type)), raw: ans(ev) }, null, 1));
  }
  const pass = results.filter((r) => r.pass).length;
  const summary = { label: LABEL, model: MODEL, src: R, pass, total: results.length, results };
  fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 1));
  console.log(`\n${LABEL}: ${pass}/${results.length} passed · transcripts in ${OUT}`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });

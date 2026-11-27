// Tool-tree benchmark: 40 real requests, run against one model in three tool modes, to decide which becomes the
// default (src/main/agent/core-tools.js): 'classic' (keyword selection), 'tree' (A: opened tools join the list),
// 'use_tool' (B: fixed list + use_tool). For each request: the first real tool called (open_tools / use_tool are
// followed through), whether it's one of the expected tools, whether its arguments were valid, prompt tokens
// of the tool list, time to the first tool call.
// Runs Fabro with YOUR profile (your models). Nothing is saved in your conversations; agent.toolMode is restored.
// Run on your PC:  node scripts/tools-bench.js --model "Gemma 4 E4B" [--modes classic,tree,use_tool] [--only 10]
// Then:            the same with a bigger model. Results: bench-results/tools-<model>-<date>.json + a summary table.
const { _electron: electron } = require('playwright-core');
const path = require('path');
const fs = require('fs');

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const MODEL = arg('model', ''); const MODES = arg('modes', 'classic,tree,use_tool').split(','); const ONLY = Number(arg('only', 0)) || 0;
const TIMEOUT = Number(arg('timeout', 120)) * 1000;

// [request, expected tools (any of them is right)]
const CASES = [
  ['Lis le fichier C:/Users/Public/notes.txt et résume-le', ['read_file']],
  ['Crée un fichier todo.md sur le bureau avec 3 tâches pour demain', ['write_file']],
  ['Dans config.json, remplace "debug": false par "debug": true', ['edit_file', 'read_file']],
  ['Trouve tous les PDF dans mes Documents', ['search_files', 'list_dir']],
  ['Cherche dans mon projet les fichiers qui contiennent "TODO"', ['search_files']],
  ['Convertis rapport.docx en PDF', ['convert_file']],
  ['Quel temps fera-t-il demain à Lyon ?', ['web_search', 'research', 'read_page']],
  ['Lis cette page et dis-moi ce qu’elle annonce : https://www.example.com', ['read_page', 'fetch_url']],
  ['Compare les trois meilleurs aspirateurs robots à moins de 400 € avec des sources', ['research', 'web_search']],
  ['Quelle est la dernière version de Node.js ?', ['web_search', 'research', 'read_page']],
  ['Télécharge le logo de Wikipédia', ['download_file', 'browser_download_images', 'web_images', 'find_images']],
  ['Trouve des photos de golden retriever libres de droits', ['web_images', 'find_images', 'search_images']],
  ['Lance npm test dans C:/proj/app', ['run_command', 'run_tests', 'run_test_sequence']],
  ['Calcule la moyenne de 12, 18, 25 et 31 avec Python', ['run_python']],
  ['Montre-moi le statut git de mon projet', ['git_status', 'run_command']],
  ['Vérifie que mon serveur répond sur http://localhost:3000/health', ['run_test_sequence', 'run_command', 'diagnose']],
  ['Pourquoi le port 8080 est déjà utilisé ?', ['diagnose', 'run_command']],
  ['Écris des tests pour la fonction slugify et lance-les', ['write_file', 'run_test_sequence', 'run_tests', 'run_command']],
  ['Tu te souviens de ce que j’aime comme musique ?', ['memory_search']],
  ['Retiens que je travaille le mardi et le jeudi', ['memory_save', 'note_to_self']],
  ['On avait parlé d’un devis de cuisine la semaine dernière, retrouve-le', ['chat_search']],
  ['Note dans ton carnet : prix vérifiés chez 3 revendeurs', ['task_notes']],
  ['Regarde cette image et dis-moi ce qu’il y a : C:/Users/Public/Pictures/photo.jpg', ['see_images']],
  ['Regarde les images du dossier C:/Users/Public/Pictures et trouve celles avec un chien', ['see_images']],
  ['Regarde la vidéo C:/Videos/demo.mp4 entre 10 et 20 secondes', ['watch_video']],
  ['Que se passe-t-il à 2 minutes dans https://www.youtube.com/watch?v=dQw4w9WgXcQ ?', ['watch_video']],
  ['Fais-moi une page web pour présenter mon club de tennis', ['create_artifact', 'make_document', 'design_guide', 'knowledge_search']],
  ['Fais une présentation de 5 diapos sur le cycle de l’eau', ['make_document', 'create_artifact', 'design_guide']],
  ['Crée un PDF de facture pour 3 heures de cours à 25 €', ['create_pdf', 'make_document', 'create_artifact']],
  ['Lis à voix haute ce paragraphe', ['generate_speech']],
  ['Génère une image d’un phare au coucher du soleil', ['generate_image']],
  ['Quelle bibliothèque JS utiliser pour des graphiques interactifs ?', ['find_library', 'research', 'web_search']],
  ['Ouvre le Bloc-notes et écris bonjour', ['computer', 'computer_open_app', 'computer_look']],
  ['Programme un rappel tous les lundis à 9 h pour arroser les plantes', ['schedule_task']],
  ['Fais un plan pour déménager en 4 semaines et suis-le', ['update_plan']],
  ['Lance un sous-agent pour chercher des idées de cadeaux pendant que tu fais le budget', ['run_subagent']],
  ['Comment on fait un script Luau pour une porte coulissante dans Roblox ?', ['knowledge_search', 'web_search', 'research']],
  ['Ajoute le connecteur GitHub', ['propose_mcp_install', 'add_connector']],
  ['Crée un fichier hello.py et vérifie qu’il affiche bonjour', ['write_file', 'run_test_sequence', 'run_command', 'run_python']],
  ['Quels outils as-tu pour les PDF ?', ['open_tools']],
];

(async () => {
  if (!MODEL) { console.error('Usage: node scripts/tools-bench.js --model "<model label>" [--modes classic,tree,use_tool] [--only 10]'); process.exit(1); }
  const app = await electron.launch({ executablePath: require('electron'), args: [path.join(__dirname, '..')], env: { ...process.env } });
  const win = await app.firstWindow(); await win.waitForTimeout(3000);
  const ref = await win.evaluate(async (label) => { const l = [...(await api.models.installed()).local.filter((m) => !m.role).map((m) => ({ ref: { backend: 'local', id: m.id }, label: m.name })), ...(await api.providers.models()).map((m) => ({ ref: m.ref, label: m.label }))]; const m = l.find((x) => x.label.toLowerCase().includes(label.toLowerCase())); return m ? m.ref : null; }, MODEL);
  if (!ref) { console.error('Model not found: ' + MODEL); await app.close(); process.exit(1); }
  const saved = await win.evaluate(async () => ((await api.settings.get()).agent || {}).toolMode || 'classic');
  const results = [];
  const cases = ONLY ? CASES.slice(0, ONLY) : CASES;
  for (const mode of MODES) {
    await win.evaluate(async (m) => { const s = await api.settings.get(); await api.settings.set({ agent: { ...(s.agent || {}), toolMode: m } }); }, mode);
    for (const [i, [text, expected]] of cases.entries()) {
      const r = await win.evaluate(({ text, ref, timeout }) => new Promise((resolve) => {
        const reqId = 'bench-' + Math.random().toString(36).slice(2); const t0 = Date.now(); const out = { tools: [], tokens: 0, firstMs: 0, errors: [] };
        const off = api.on('chat:event', (ev) => {
          if (ev.reqId !== reqId) return;
          if (ev.type === 'tools_info') out.tokens = ev.tokens;
          if (ev.type === 'tool_start') { out.tools.push({ name: ev.name, args: ev.args }); if (!out.firstMs) out.firstMs = Date.now() - t0; }
          if (ev.type === 'tool_end' && ev.error) out.errors.push(String(ev.error).slice(0, 200));
          if (ev.type === 'permission' || ev.type === 'deps_needed') api.chat.answer(reqId, ev.id, ev.type === 'permission' ? 'deny' : false); // nothing really runs
          // stop as soon as a real tool was chosen (open_tools / use_tool are followed through)
          const real = out.tools.find((x) => x.name !== 'open_tools');
          if (real || ev.type === 'done' || ev.type === 'error') { off(); api.chat.abort(reqId); resolve(out); }
        });
        setTimeout(() => { off(); api.chat.abort(reqId); out.timeout = true; resolve(out); }, timeout);
        api.chat.send({ reqId, model: ref, messages: [{ role: 'system', content: '' }, { role: 'user', content: text }], params: { agentMode: true, agent: true, tools: ['web_search', 'fetch_url'], userContext: { lang: 'fr', memories: [] } }, meta: { convId: reqId, ephemeral: true } });
      }), { text, ref, timeout: TIMEOUT });
      const real = r.tools.find((x) => x.name !== 'open_tools');
      const name = real ? (real.name === 'use_tool' ? (real.args && real.args.name) || 'use_tool' : real.name) : '';
      const row = { mode, i: i + 1, text, expected, called: name, opened: r.tools.filter((x) => x.name === 'open_tools').length, right: expected.includes(name), argsOk: !!real && !r.errors.some((e) => /Wrong call|missing argument/.test(e)), tokens: r.tokens, firstMs: r.firstMs, timeout: !!r.timeout };
      results.push(row);
      console.log(`${mode.padEnd(9)} ${String(i + 1).padStart(2)} ${row.right ? '✓' : '✗'} ${name || '-'}${row.opened ? ` (open_tools ×${row.opened})` : ''} · ${row.tokens} tok · ${(row.firstMs / 1000).toFixed(1)} s`);
    }
  }
  await win.evaluate(async (m) => { const s = await api.settings.get(); await api.settings.set({ agent: { ...(s.agent || {}), toolMode: m } }); }, saved);
  await app.close();
  const sum = MODES.map((mode) => { const l = results.filter((x) => x.mode === mode); const avg = (f) => Math.round(l.reduce((a, x) => a + f(x), 0) / Math.max(1, l.length)); return { mode, right: l.filter((x) => x.right).length, argsOk: l.filter((x) => x.argsOk).length, n: l.length, tokens: avg((x) => x.tokens), ms: avg((x) => x.firstMs) }; });
  console.log('\nmode       right    args ok  tool tokens  first tool');
  for (const s of sum) console.log(`${s.mode.padEnd(10)} ${`${s.right}/${s.n}`.padEnd(8)} ${`${s.argsOk}/${s.n}`.padEnd(8)} ${String(s.tokens).padEnd(12)} ${(s.ms / 1000).toFixed(1)} s`);
  const dir = path.join(__dirname, '..', 'bench-results'); fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `tools-${MODEL.replace(/\W+/g, '-')}-${new Date().toISOString().slice(0, 10)}.json`);
  fs.writeFileSync(file, JSON.stringify({ model: MODEL, summary: sum, results }, null, 1)); console.log('\n→ ' + file);
})().catch((e) => { console.error(e); process.exit(1); });

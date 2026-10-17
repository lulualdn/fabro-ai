// Real-model agent test (CI, Linux): Qwen3.5 4B on Fabro's own engine must actually act with tools —
// read files, write a summary, run a command — not describe or refuse. Guards the agent prompts/runtime.
const Module = require('module'); const os = require('os'); const path = require('path'); const fs = require('fs');
const R = require('path').join(__dirname, '..');
const tmp = process.env.TMPU || fs.mkdtempSync(path.join(os.tmpdir(), 'fabro-real-'));
const orig = Module._load;
Module._load = function (req, ...r) { if (req === 'electron') return { app: { getPath: () => tmp, isPackaged: false, getVersion: () => '0' }, safeStorage: { isEncryptionAvailable: () => false }, shell: { trashItem: async (p) => fs.rmSync(p) }, BrowserWindow: class {}, dialog: {}, protocol: {}, powerMonitor: { isOnBatteryPower: () => false } }; return orig.call(this, req, ...r); };
process.env.HOME = tmp;
const store = require(R + '/src/main/store'); store.init();
const engine = require(R + '/src/main/engine'); const models = require(R + '/src/main/models'); const { downloadFile } = require(R + '/src/main/download');
require(R + '/src/main/agent/files'); require(R + '/src/main/agent/shell'); require(R + '/src/main/agent/plan');
const chat = require(R + '/src/main/chat'); const agent = require(R + '/src/main/agent');
(async () => {
  await engine.init(() => {}); models.init(() => {});
  const mp = path.join(os.tmpdir(), 'Qwen3.5-4B-Q4_K_M.gguf');
  if (!fs.existsSync(mp)) await downloadFile('https://huggingface.co/unsloth/Qwen3.5-4B-GGUF/resolve/main/Qwen3.5-4B-Q4_K_M.gguf?download=true', mp);
  const [m] = await models.importModels([{ path: mp, name: 'Qwen3.5 4B' }]);
  const work = path.join(tmp, 'Documents', 'Fabro', 'test'); fs.mkdirSync(work, { recursive: true });
  fs.writeFileSync(path.join(work, 'courses.txt'), 'pommes\nlait\npain\n'); fs.writeFileSync(path.join(work, 'todo.txt'), 'appeler mamie\nfinir le devoir de maths\n');
  for (const t of ['write_file', 'run_command']) await agent.setPolicy(t, 'always');
  const answers = [];
  for (const [i, q] of [`Lis les fichiers du dossier ${work} et crée un fichier resume.md dans ce dossier qui les résume.`, `Combien de lignes contient ${path.join(work, 'courses.txt')} ? Utilise une commande.`].entries()) {
    const ev = [];
    await new Promise((res) => chat.send({ reqId: 'r' + i, model: { backend: 'local', id: m.id }, messages: [{ role: 'user', content: q }], params: { agentMode: true, agentPrompt: 'The user\'s name is Lulu. Interface language: fr.', reasoning: 'off', maxTokens: 1500 }, meta: {} }, (e) => { ev.push(e); if (e.type === 'permission') chat.answer('r' + i, e.id, 'once'); if (e.type === 'done' || e.type === 'error') res(); }));
    console.log('\n=== ' + q);
    for (const e of ev) if (['tool_start', 'tool_end', 'guard', 'error'].includes(e.type)) console.log(e.type, e.name || '', JSON.stringify(e.args || e.view || e.text || e.message || e.error || '').slice(0, 200));
    if (ev.some((e) => e.type === 'error')) console.log('ENGINE LOG:', JSON.stringify(engine.logs ? engine.logs() : '').slice(-1500));
    answers.push(ev.filter((e) => e.type === 'token').map((e) => e.text).join(''));
    console.log('ANSWER:', ev.filter((e) => e.type === 'token').map((e) => e.text).join('').slice(-400));
  }
  const out = fs.existsSync(path.join(work, 'resume.md')) ? fs.readFileSync(path.join(work, 'resume.md'), 'utf8') : '';
  console.log('resume.md:', out.slice(0, 300));
  await engine.stop();
  if (!/pomme/i.test(out) || !/mamie/i.test(out)) { console.error('FAIL: summary file missing or not based on the files'); process.exit(1); }
  if (!/3/.test(answers[1] || '')) { console.error('FAIL: line count answer'); process.exit(1); }
  console.log('agent-real: all passed'); process.exit(0);
})().catch(async (e) => { console.error(e); await engine.stop(); process.exit(1); });

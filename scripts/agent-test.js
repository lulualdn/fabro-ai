// Offline test of the agent runtime: auto-switch, permissions, folder access, files, terminal,
// documents, and the <tool_call> fallback for models without native tools.
const Module = require('module'); const os = require('os'); const path = require('path'); const fs = require('fs'); const http = require('http'); const assert = require('assert');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fabro-agent-'));
const work = path.join(tmp, 'projet'); fs.mkdirSync(work); fs.writeFileSync(path.join(work, 'notes.txt'), 'ligne 1\nligne 2\n');
const orig = Module._load;
Module._load = function (req, ...r) {
  if (req === 'electron') return { app: { getPath: () => tmp, isPackaged: false, getVersion: () => '0.0.0' }, safeStorage: { isEncryptionAvailable: () => false }, shell: { trashItem: async (p) => fs.rmSync(p) }, BrowserWindow: class {}, dialog: {}, protocol: {} };
  return orig.call(this, req, ...r);
};
process.env.HOME = tmp; process.env.USERPROFILE = tmp;
const store = require('../src/main/store'); store.init();
const providers = require('../src/main/providers'); const chat = require('../src/main/chat');
require('../src/main/agent/files'); require('../src/main/agent/shell'); require('../src/main/agent/plan');
const agent = require('../src/main/agent');

// Scripted model: each request returns the next step depending on what tools already ran.
let mode = 'native';
const srv = http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
    if (req.url === '/v1/models') return res.end(JSON.stringify({ data: [{ id: 'm' }] }));
    const body = JSON.parse(b);
    if (mode === 'sub') {
      const sys = body.messages[0].content || ''; const doneN = body.messages.filter((m) => m.role === 'tool').length;
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const w = (d) => res.write(`data: ${JSON.stringify({ choices: [{ delta: d }] })}\n\n`);
      if (/sub-agent working for the main/.test(sys)) {
        subSeen.push({ tools: (body.tools || []).map((t) => t.function.name), task: body.messages[1].content });
        if (doneN === 0) w({ tool_calls: [{ index: 0, id: 's0', function: { name: 'list_dir', arguments: JSON.stringify({ path: work }) } }] });
        else w({ content: `Rapport: ${body.messages[1].content} ok` });
      } else if (doneN === 0) {
        w({ tool_calls: [
          { index: 0, id: 'p0', function: { name: 'update_plan', arguments: JSON.stringify({ steps: [{ title: 'Explorer', status: 'in_progress' }, { title: 'Résumer', status: 'pending' }] }) } },
        ] });
      } else if (doneN === 1) {
        w({ tool_calls: [
          { index: 0, id: 'a', function: { name: 'run_subagent', arguments: JSON.stringify({ description: 'Lister A', task: 'tâche A' }) } },
          { index: 1, id: 'b', function: { name: 'run_subagent', arguments: JSON.stringify({ description: 'Lister B', task: 'tâche B' }) } },
        ] });
      } else w({ content: 'Fini: ' + body.messages.filter((m) => m.role === 'tool').map((m) => m.content).join(' | ') });
      return res.end('data: [DONE]\n\n');
    }
    if (mode === 'fallback' && body.tools) { res.writeHead(400); return res.end(JSON.stringify({ error: { message: 'this model does not support tools' } })); }
    const done = body.messages.filter((m) => m.role === 'tool' || /^Tool result/.test(m.content || '')).length;
    const sys = body.messages[0].content;
    seen.push({ tools: (body.tools || []).map((t) => t.function.name), sys, n: body.messages.length });
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const call = (name, args) => mode === 'fallback'
      ? res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: `<tool_call>{"name":"${name}","arguments":${JSON.stringify(args)}}</tool_call>` } }] })}\n\n`)
      : res.write(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c' + done, function: { name, arguments: JSON.stringify(args) } }] } }] })}\n\n`);
    const plan = [
      ['list_dir', { path: work }],
      ['write_file', { path: path.join(work, 'resume.md'), content: '# Résumé\n- fait' }],
      ['run_command', { command: process.platform === 'win32' ? 'Get-ChildItem -Name' : 'ls', cwd: work, shell: 'auto' }],
    ];
    if (done < plan.length) call(...plan[done]);
    else res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Terminé.' } }] })}\n\n`);
    res.end('data: [DONE]\n\n');
  });
});
const seen = []; const subSeen = [];
function run(payload, answers) {
  return new Promise((resolve) => {
    const ev = [];
    chat.send(payload, (e) => {
      ev.push(e);
      if (e.type === 'permission') setTimeout(() => chat.answer(payload.reqId, e.id, answers(e)), 5);
      if (e.type === 'done' || e.type === 'error') resolve(ev);
    });
  });
}

(async () => {
  await new Promise((r) => srv.listen(0, r));
  const v = await providers.add({ kind: 'custom', baseUrl: `http://127.0.0.1:${srv.address().port}/v1`, name: 'Agent test' });
  const ref = { backend: 'provider', provider: v.list[0].id, model: 'm' };
  const asked = [];
  let ev = await run({ reqId: 'a1', model: ref, messages: [{ role: 'system', content: 'CHAT PROMPT' }, { role: 'user', content: 'Range mon dossier projet' }], params: { tools: ['web_search'], agentPrompt: 'AGENT PROMPT' }, meta: {} },
    (e) => { asked.push(e); return e.reason === 'folder' ? 'always' : 'once'; });
  const types = ev.map((e) => e.type);
  assert.ok(types.includes('agent_switch'), 'switched to agent mode');
  assert.ok(seen[0].tools.includes('web_search') && seen[0].tools.includes('list_dir') && seen[0].tools.includes('run_command'), 'chat request offers core agent tools');
  assert.match(seen[0].sys, /CHAT PROMPT/);
  assert.match(seen[1].sys, /AGENT PROMPT/, 'system prompt replaced after the switch');
  assert.ok(asked.some((a) => a.reason === 'folder'), 'folder access asked');
  assert.ok(asked.some((a) => a.tool === 'write_file') && asked.some((a) => a.tool === 'run_command'), 'write + exec asked');
  assert.ok(!asked.some((a) => a.tool === 'list_dir'), 'read tools do not ask');
  assert.strictEqual(fs.readFileSync(path.join(work, 'resume.md'), 'utf8'), '# Résumé\n- fait');
  const cmd = ev.find((e) => e.type === 'tool_end' && e.name === 'run_command');
  assert.strictEqual(cmd.view.code, 0); assert.match(cmd.view.out, /resume\.md/);
  assert.ok(ev.some((e) => e.type === 'tool_progress'), 'command output streamed');
  assert.deepStrictEqual(store.getSettings().agent.folders, [work], 'folder remembered (always)');
  assert.strictEqual(ev.filter((e) => e.type === 'token').map((e) => e.text).join(''), 'Terminé.');

  // Refusal: the action does not run and the model is told.
  fs.rmSync(path.join(work, 'resume.md'));
  seen.length = 0;
  ev = await run({ reqId: 'a2', model: ref, messages: [{ role: 'user', content: 'refais' }], params: { agentMode: true, agentPrompt: 'AGENT' }, meta: {} }, () => 'deny');
  assert.ok(!fs.existsSync(path.join(work, 'resume.md')), 'denied write did not happen');
  assert.ok(ev.some((e) => e.type === 'tool_end' && e.refused));

  // Guardrails: credential paths are blocked; dangerous commands always confirm even when allowed.
  await agent.setPolicy('run_command', 'always');
  const askedDanger = [];
  const ctx = { ask: async (r) => { askedDanger.push(r); return 'deny'; }, emit: () => {} };
  const rr = await agent.execute({ name: 'run_command', args: { command: 'rm -rf build', cwd: work } }, ctx);
  assert.ok(rr.refused && askedDanger[0].reason === 'danger_command');
  await assert.rejects(agent.execute({ name: 'read_file', args: { path: path.join(tmp, '.ssh', 'id_rsa') } }, ctx), /credentials/);

  // Fallback: a server without tools → <tool_call> blocks parsed from text.
  mode = 'fallback'; fs.rmSync(path.join(work, 'resume.md'), { force: true });
  await agent.setPolicy('write_file', 'always'); await agent.setPolicy('run_command', 'always');
  ev = await run({ reqId: 'a3', model: ref, messages: [{ role: 'user', content: 'go' }], params: { agentMode: true, agentPrompt: 'AGENT' }, meta: {} }, () => 'once');
  assert.ok(ev.some((e) => e.type === 'retract'), 'tool_call text retracted from the answer');
  assert.ok(fs.existsSync(path.join(work, 'resume.md')), 'fallback tool call executed');
  assert.ok(ev.find((e) => e.type === 'done').stats.noTools);

  // Plan + parallel sub-agents: nested runs, steps forwarded under the parent call, reports returned.
  mode = 'sub';
  ev = await run({ reqId: 'a4', model: ref, messages: [{ role: 'user', content: 'go' }], params: { agentMode: true, agentPrompt: 'AGENT' }, meta: { convId: 'c-sub' } }, () => 'once');
  const plan = ev.find((e) => e.type === 'plan');
  assert.ok(plan && plan.steps.length === 2 && plan.steps[0].status === 'in_progress', 'plan event');
  assert.strictEqual(subSeen.length, 4, 'two sub-agents, two requests each');
  assert.ok(!subSeen[0].tools.includes('run_subagent'), 'sub-agents cannot spawn sub-agents');
  assert.ok(subSeen[0].tools.includes('list_dir'));
  const fwd = ev.filter((e) => e.type === 'tool_start' && e.parent);
  assert.strictEqual(fwd.length, 2); assert.ok(fwd.every((e) => /^(a|b)~s0$/.test(e.id)), 'sub steps forwarded with parent ids');
  const subEnds = ev.filter((e) => e.type === 'tool_end' && e.name === 'run_subagent');
  assert.strictEqual(subEnds.length, 2); assert.match(subEnds[0].view.report, /Rapport: tâche/);
  assert.match(ev.filter((e) => e.type === 'token').map((e) => e.text).join(''), /Fini: Plan updated.*Rapport: tâche A ok \| Rapport: tâche B ok/);
  assert.ok(ev.every((e) => e.reqId === 'a4'), 'all events carry the parent reqId');
  console.log('agent-test: all passed');
  srv.close(); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });

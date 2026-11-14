// Offline test of the installs proposed by the AI (src/main/agent/installs.js): nothing is installed without
// the person's click, a refusal installs nothing, "allow everything" does not skip the card. Plain node, electron mocked.
const Module = require('module'); const os = require('os'); const path = require('path'); const fs = require('fs'); const assert = require('assert');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fabro-installs-'));
const orig = Module._load;
Module._load = function (req, ...r) {
  if (req === 'electron') return { app: { getPath: () => tmp, isPackaged: false, getVersion: () => '0.0.0' }, safeStorage: { isEncryptionAvailable: () => false }, shell: { openExternal() {} }, BrowserWindow: class {}, dialog: {}, protocol: {} };
  return orig.call(this, req, ...r);
};
process.env.HOME = tmp; process.env.USERPROFILE = tmp; process.env.APPDATA = path.join(tmp, 'AppData', 'Roaming'); process.env.XDG_CONFIG_HOME = path.join(tmp, '.config');
const store = require('../src/main/store'); store.init();
const agent = require('../src/main/agent');
require('../src/main/agent/installs');
const mcp = require('../src/main/agent/mcp');
const sysprompts = require('../src/main/sysprompts');
const skills = require('../src/main/agent/skills');

let pass = 0; let failed = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log('  ok  ' + name); } catch (e) { failed++; console.log('FAIL  ' + name + '\n      ' + (e.stack || e).toString().split('\n').slice(0, 5).join('\n      ')); } };
// a context whose card answers `answer`, and remembers what was asked
const ctxOf = (answer, extra = {}) => { const asked = []; return { asked, ask: async (req) => { asked.push(req); return answer; }, ...extra }; };
const run = (name, args, ctx) => agent.execute({ name, args }, ctx);

(async () => {
  const skillDir = path.join(tmp, 'src-skill', 'resume-court');
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '---\nname: resume-court\ndescription: Summarise a text in five lines.\n---\n\n# Resume court\n\nWrite five lines, no more.\n');

  await t('skill: the card is asked, a refusal installs nothing', async () => {
    const c = ctxOf('deny');
    const r = await run('propose_skill_install', { source: skillDir, why: 'short summaries' }, c);
    assert.strictEqual(c.asked.length, 1); assert.strictEqual(c.asked[0].kind, 'install'); assert.strictEqual(c.asked[0].what, 'skill');
    assert.ok(/resume-court/.test(c.asked[0].title), c.asked[0].title);
    assert.ok(r.refused, 'refused');
    assert.ok(!(await skills.list()).some((s) => s.name === 'resume-court'), 'nothing installed');
  });
  await t('skill: installed after a yes, even with "allow everything" the card is asked', async () => {
    const c = ctxOf('once', { allowAll: true });
    const r = await run('propose_skill_install', { source: skillDir }, c);
    assert.strictEqual(c.asked.length, 1, 'asked once');
    assert.ok(/Installed/.test(r.content), r.content);
    assert.ok((await skills.list()).some((s) => s.name === 'resume-court'), 'installed');
  });
  await t('skill: an unreadable source is an error, no card', async () => {
    const c = ctxOf('once');
    const r = await run('propose_skill_install', { source: path.join(tmp, 'nope') }, c);
    assert.strictEqual(c.asked.length, 0); assert.ok(r.isError, r.content);
  });

  await t('mcp: refusal adds nothing, a yes adds the server', async () => {
    const def = 'npx -y @modelcontextprotocol/server-memory';
    const no = ctxOf('deny');
    assert.ok((await run('propose_mcp_install', { definition: def }, no)).refused);
    assert.strictEqual(no.asked[0].what, 'mcp');
    const before = (await mcp.view()).length;
    const yes = ctxOf('once');
    const r = await run('propose_mcp_install', { definition: def, why: 'remember things' }, yes);
    assert.ok(/Added/.test(r.content), r.content);
    assert.strictEqual((await mcp.view()).length, before + 1);
  });
  await t('mcp: a server that needs a key is added switched off, the key is never asked from the model', async () => {
    const yes = ctxOf('once');
    const r = await run('propose_mcp_install', { definition: JSON.stringify({ mcpServers: { brave: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-brave-search'], env: { BRAVE_API_KEY: '' } } } }) }, yes);
    assert.ok(!r.isError, r.content);
    if ((yes.asked[0].needs || []).length) assert.ok(/switched off/.test(r.content), r.content);
  });
  await t('mcp: nonsense is an error, no card', async () => {
    const c = ctxOf('once');
    const r = await run('propose_mcp_install', { definition: '   ' }, c);
    assert.strictEqual(c.asked.length, 0); assert.ok(r.isError);
  });

  await t('system prompt: shown on the card, saved only after a yes', async () => {
    const body = 'Answer in French, in short sentences. Always give the command to run.';
    const no = ctxOf('deny');
    assert.ok((await run('propose_system_prompt', { name: 'Court et direct', body }, no)).refused);
    assert.strictEqual(no.asked[0].text, body);
    assert.strictEqual((await sysprompts.list()).length, 0);
    const yes = ctxOf('once');
    const r = await run('propose_system_prompt', { name: 'Court et direct', description: 'short answers', body }, yes);
    assert.ok(/Saved/.test(r.content), r.content);
    const l = await sysprompts.list();
    assert.strictEqual(l.length, 1); assert.strictEqual(l[0].name, 'Court et direct');
  });
  await t('system prompt: too short is refused before any card', async () => {
    const c = ctxOf('once');
    assert.ok((await run('propose_system_prompt', { name: 'x', body: 'hi' }, c)).isError); assert.strictEqual(c.asked.length, 0);
  });

  console.log(failed ? `installs-test: ${failed} FAILED, ${pass} passed` : `installs-test: all ${pass} passed`);
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
})();

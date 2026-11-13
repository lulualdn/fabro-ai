// Offline test of "add an MCP server the easy way": parsing of pasted text, other apps' configs, catalog,
// prerequisites, the real connection test (tiny stdio server written here), secrets, per-tool switches.
const Module = require('module'); const os = require('os'); const path = require('path'); const fs = require('fs'); const assert = require('assert');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fabro-mcpeasy-'));
const orig = Module._load;
Module._load = function (req, ...r) {
  if (req === 'electron') return { app: { getPath: () => tmp, isPackaged: false, getVersion: () => '0.0.0' }, safeStorage: { isEncryptionAvailable: () => false }, shell: { openExternal() {} }, BrowserWindow: class {}, dialog: {}, protocol: {} };
  return orig.call(this, req, ...r);
};
process.env.HOME = tmp; process.env.USERPROFILE = tmp; process.env.APPDATA = path.join(tmp, 'AppData', 'Roaming'); process.env.XDG_CONFIG_HOME = path.join(tmp, '.config'); delete process.env.CODEX_HOME;
const store = require('../src/main/store'); store.init();
const agent = require('../src/main/agent');
const mcp = require('../src/main/agent/mcp');
const easy = require('../src/main/mcpeasy');
const providers = require('../src/main/providers');

let pass = 0; let failed = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log('  ok  ' + name); } catch (e) { failed++; console.log('FAIL  ' + name + '\n      ' + (e.stack || e).toString().split('\n').slice(0, 5).join('\n      ')); } };
const P = (text) => easy.parse(text, { existingNames: [] });
const one = (text) => { const r = P(text); assert.ok(r.ok, `${text} → ${r.errors.join('; ')}`); assert.strictEqual(r.servers.length, 1, text); return r.servers[0]; };

// a minimal MCP server over stdio
const srvFile = path.join(tmp, 'fake-mcp.js');
fs.writeFileSync(srvFile, `
const rl = require('readline').createInterface({ input: process.stdin });
const tools = [{ name: 'echo', description: 'Repeat a text', inputSchema: { type: 'object', properties: { text: { type: 'string' } } }, annotations: { readOnlyHint: true } }, { name: 'wipe', description: 'Delete things', inputSchema: { type: 'object', properties: {} } }];
const need = process.env.NEED_KEY; if (need && process.env.FAKE_API_KEY !== need) { console.error('401 Unauthorized: bad FAKE_API_KEY ' + (process.env.FAKE_API_KEY || '')); process.exit(2); }
rl.on('line', (l) => { const m = JSON.parse(l); if (m.id === undefined) return; const send = (result) => console.log(JSON.stringify({ jsonrpc: '2.0', id: m.id, result }));
  if (m.method === 'initialize') send({ protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'fake', version: '1.2.3' } });
  else if (m.method === 'tools/list') send({ tools });
  else if (m.method === 'tools/call') send({ content: [{ type: 'text', text: 'echo:' + (m.params.arguments.text || '') }] }); });
`);

(async () => {
  // ───────── parsing ─────────
  await t('JSON: {"mcpServers": {...}} with several servers, env + headers', async () => {
    const r = P('{"mcpServers":{"fs":{"command":"npx","args":["-y","@modelcontextprotocol/server-filesystem","/tmp"]},"gh":{"url":"https://api.githubcopilot.com/mcp/","headers":{"Authorization":"Bearer ${input:pat}"}},"brave":{"command":"npx","args":["-y","@brave/brave-search-mcp-server"],"env":{"BRAVE_API_KEY":"YOUR_API_KEY_HERE"}}}}');
    assert.deepStrictEqual(r.servers.map((s) => s.name), ['fs', 'gh', 'brave']);
    assert.strictEqual(r.servers[1].type, 'http'); assert.ok(r.servers[1].needs.some((n) => n.where === 'header' && n.prefix === 'Bearer '));
    assert.ok(r.servers[2].needs.some((n) => n.where === 'env' && n.name === 'BRAVE_API_KEY' && n.secret && !n.set)); assert.strictEqual(r.servers[2].env.BRAVE_API_KEY, '');
  });
  await t('JSON: single server object, VS Code {servers, inputs}, bare fragment, comments + trailing commas + code fence', async () => {
    assert.strictEqual(one('{"command":"uvx","args":["mcp-server-time"]}').name, 'time');
    const v = one('{"servers":{"github":{"type":"http","url":"https://api.githubcopilot.com/mcp/","headers":{"Authorization":"Bearer ${input:github_mcp_pat}"}}},"inputs":[{"type":"promptString","id":"github_mcp_pat","description":"GitHub Personal Access Token","password":true}]}');
    assert.strictEqual(v.needs[0].label, 'GitHub Personal Access Token');
    assert.strictEqual(one('"memory": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-memory"] }').name, 'memory');
    assert.strictEqual(one('```json\n{\n // my server\n "mcpServers": { "t": { "command": "uvx", "args": ["mcp-server-time",], }, },\n}\n```').name, 't');
    assert.strictEqual(one('{"mcp":{"servers":{"x":{"command":"node","args":["a.js"]}}}}').name, 'x');
  });
  await t('command lines: npx (adds -y), uvx, node path, python -m, docker run with -e', async () => {
    let s = one('npx @modelcontextprotocol/server-memory'); assert.deepStrictEqual(s.args, ['-y', '@modelcontextprotocol/server-memory']); assert.strictEqual(s.name, 'memory');
    s = one('npx -y @modelcontextprotocol/server-filesystem "C:\\Users\\moi\\My Documents"'); assert.strictEqual(s.args[2], 'C:\\Users\\moi\\My Documents'); assert.strictEqual(s.name, 'filesystem');
    s = one('uvx mcp-server-git --repository ~/code/app'); assert.strictEqual(s.command, 'uvx'); assert.strictEqual(s.name, 'git');
    s = one('python -m my_server.main --port 3'); assert.strictEqual(s.command, 'python'); assert.ok(s.name.startsWith('my_server'));
    s = one('docker run -i --rm -e GITHUB_PERSONAL_ACCESS_TOKEN=ghp_123456789 ghcr.io/github/github-mcp-server');
    assert.strictEqual(s.name, 'github'); assert.strictEqual(s.env.GITHUB_PERSONAL_ACCESS_TOKEN, 'ghp_123456789'); assert.ok(!s.args.join(' ').includes('ghp_'), 'token lifted out of args');
    assert.ok(s.needs.some((n) => n.name === 'GITHUB_PERSONAL_ACCESS_TOKEN' && n.set));
    s = one('docker run --rm ghcr.io/x/y-mcp'); assert.ok(s.args.includes('-i'));
    s = one('BRAVE_API_KEY=abc123456 npx -y @brave/brave-search-mcp-server --transport stdio'); assert.strictEqual(s.env.BRAVE_API_KEY, 'abc123456'); assert.strictEqual(s.name, 'brave-search');
  });
  await t('claude mcp add: stdio with -e / --, http with --header, sse, add-json, scope flag, multiline', async () => {
    let s = one('claude mcp add airtable --env AIRTABLE_API_KEY=YOUR_KEY -- npx -y airtable-mcp-server'); assert.strictEqual(s.name, 'airtable'); assert.strictEqual(s.command, 'npx'); assert.ok(s.needs.some((n) => n.name === 'AIRTABLE_API_KEY'));
    s = one('claude mcp add --transport http notion https://mcp.notion.com/mcp'); assert.strictEqual(s.type, 'http'); assert.strictEqual(s.url, 'https://mcp.notion.com/mcp');
    s = one('claude mcp add --transport http secure-api https://api.example.com/mcp --header "Authorization: Bearer abc123456789"'); assert.strictEqual(s.headers.Authorization, 'Bearer abc123456789');
    s = one('claude mcp add --transport sse asana https://mcp.asana.com/sse'); assert.ok(s.notes.some((n) => /SSE/.test(n)));
    s = one('claude mcp add -s user context7 -- npx -y @upstash/context7-mcp'); assert.strictEqual(s.name, 'context7');
    s = one(`claude mcp add-json weather '{"type":"http","url":"https://weather.example.com/mcp","headers":{"X-API-Key":"k"}}'`); assert.strictEqual(s.url, 'https://weather.example.com/mcp');
    s = one('claude mcp add multi \\\n  -e A_TOKEN=aaaaaa \\\n  -e B=2 \\\n  -- npx -y some-mcp-server'); assert.strictEqual(s.env.B, '2'); assert.strictEqual(s.env.A_TOKEN, 'aaaaaa');
    s = one('codex mcp add docs --env KEY=value -- npx -y docs-mcp'); assert.strictEqual(s.name, 'docs');
    s = one('$ claude mcp add fetch -- uvx mcp-server-fetch'); assert.strictEqual(s.command, 'uvx');
  });
  await t('plain URL, bare package, Codex TOML, and refusals (npm install, garbage, empty JSON)', async () => {
    let s = one('https://mcp.context7.com/mcp'); assert.strictEqual(s.type, 'http'); assert.strictEqual(s.name, 'context7');
    s = one('@modelcontextprotocol/server-memory'); assert.strictEqual(s.command, 'npx');
    const r = P('[mcp_servers.docs]\ncommand = "npx"\nargs = ["-y", "docs-mcp", "--x"]  # comment\n[mcp_servers.docs.env]\nAPI_KEY = "k-123456"\n\n[mcp_servers.remote]\nurl = "https://x.example.com/mcp"\nbearer_token_env_var = "REMOTE_TOKEN"\n[mcp_servers.inline]\ncommand = "uvx"\nargs = ["a",\n "b"]\nenv = { A = "1", B = "2" }\n');
    assert.deepStrictEqual(r.servers.map((x) => x.name), ['docs', 'remote', 'inline']); assert.strictEqual(r.servers[0].env.API_KEY, 'k-123456'); assert.ok(r.servers[1].needs.some((n) => n.where === 'header')); assert.deepStrictEqual(r.servers[2].args, ['a', 'b']); assert.strictEqual(r.servers[2].env.B, '2');
    for (const bad of ['npm install -g @modelcontextprotocol/server-memory', 'hello world', '{"foo": 1}', '', '   ']) assert.ok(!P(bad).ok, bad);
    assert.ok(/does not start a server/.test(P('pip install mcp-server-fetch').errors[0]));
  });
  await t('names are made unique against installed servers', async () => {
    const r = easy.parse('npx -y @modelcontextprotocol/server-memory', { existingNames: ['memory'] }); assert.strictEqual(r.servers[0].name, 'memory-2');
  });
  await t('applyValues / missing / argAppend / header prefix', async () => {
    const gh = easy.catalog().find((c) => c.id === 'github').server; assert.ok(easy.missing(gh).length === 1);
    const filled = easy.applyValues(gh, { 'header:Authorization': 'ghp_x1234567' }); assert.strictEqual(filled.headers.Authorization, 'Bearer ghp_x1234567'); assert.strictEqual(easy.missing(filled).length, 0);
    const fsx = easy.catalog().find((c) => c.id === 'filesystem').server; assert.strictEqual(easy.missing(fsx).length, 1);
    assert.deepStrictEqual(easy.applyValues(fsx, { 'argAppend:folder': '/data' }).args.slice(-2), ['@modelcontextprotocol/server-filesystem', '/data']);
  });
  await t('catalog: only verified entries, commands well-formed, no archived servers', async () => {
    const ids = easy.catalog().map((c) => c.id); assert.deepStrictEqual(ids.sort(), ['brave-search', 'fetch', 'filesystem', 'git', 'github', 'memory', 'playwright', 'sequential-thinking', 'time']);
    for (const c of easy.catalog()) { assert.ok(c.server.url || c.server.command); assert.ok(!/server-(github|sqlite|puppeteer|brave-search)$/.test(c.server.args.join(' '))); }
  });

  // ───────── other apps' configs ─────────
  await t('findConfigs: Claude Desktop, Claude Code (+projects), Cursor, VS Code, Codex, LM Studio, project .mcp.json — read-only, imported OFF, secrets masked for UI', async () => {
    const w = (p, c) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, c); };
    const home = tmp; const cfgDir = process.platform === 'darwin' ? path.join(home, 'Library', 'Application Support') : process.platform === 'win32' ? process.env.APPDATA : path.join(home, '.config');
    const srv = (n) => JSON.stringify({ mcpServers: { [n]: { command: 'npx', args: ['-y', `${n}-mcp`], env: { [`${n.toUpperCase()}_API_KEY`]: 'sekret-value-123' } } } });
    w(path.join(cfgDir, 'Claude', 'claude_desktop_config.json'), srv('desk'));
    w(path.join(home, '.claude.json'), JSON.stringify({ mcpServers: { cc: { command: 'uvx', args: ['mcp-server-time'] } }, projects: { '/work/app': { mcpServers: { ccp: { type: 'http', url: 'https://p.example.com/mcp' } } } } }));
    w(path.join(home, '.cursor', 'mcp.json'), srv('cur'));
    w(path.join(cfgDir, 'Code', 'User', 'mcp.json'), '// vscode\n{ "servers": { "vsc": { "type": "stdio", "command": "node", "args": ["x.js"] } }, "inputs": [] }');
    w(path.join(home, '.codex', 'config.toml'), 'model = "x"\n[mcp_servers.cdx]\ncommand = "npx"\nargs = ["-y", "cdx-mcp"]\n');
    w(path.join(home, '.lmstudio', 'mcp.json'), srv('lms'));
    const proj = path.join(tmp, 'proj'); w(path.join(proj, '.mcp.json'), srv('projmcp')); await store.setSettings({ agent: { folders: [proj] } });
    const before = fs.readFileSync(path.join(home, '.cursor', 'mcp.json'), 'utf8');
    const found = await easy.findConfigs();
    const names = found.flatMap((f) => f.servers.map((s) => `${f.app}:${s.name}`)).sort();
    assert.deepStrictEqual(names, ['Claude Code:cc', 'Claude Code:ccp', 'Claude Code:projmcp', 'Claude Desktop:desk', 'Codex:cdx', 'Cursor:cur', 'LM Studio:lms', 'VS Code:vsc']);
    assert.strictEqual(fs.readFileSync(path.join(home, '.cursor', 'mcp.json'), 'utf8'), before);
    const masked = await easy.findConfigsMasked(); assert.ok(!JSON.stringify(masked).includes('sekret-value-123'));
    const keys = masked.flatMap((f) => f.servers).filter((s) => ['desk', 'cc'].includes(s.name)).map((s) => s.key);
    const r = await easy.importFrom(keys); assert.deepStrictEqual(r.added.sort(), ['cc', 'desk']);
    const v = mcp.view(); assert.ok(v.every((s) => s.enabled === false && s.status === 'off'), 'imported servers are never auto-enabled');
    assert.ok(!JSON.stringify(store.getSettings().mcp).includes('sekret-value-123'), 'secret not in settings');
    assert.strictEqual(providers.getKey(`mcp:${v.find((s) => s.name === 'desk').id}:env:DESK_API_KEY`), 'sekret-value-123');
    for (const s of v) await mcp.remove(s.id);
  });

  // ───────── prerequisites, test, add ─────────
  await t('prereq: node found, missing program reported with how to get it', async () => {
    assert.ok((await easy.prereq({ command: process.execPath })).ok);
    const r = await easy.prereq({ command: 'uvx-definitely-missing' }); assert.ok(!r.ok); assert.ok(/not found/.test(r.items[0].help));
    const u = await easy.prereq({ command: 'uvx', args: [] }); if (!u.ok) assert.ok(/docs\.astral\.sh/.test(u.items[0].help));
    const d = await easy.prereq({ command: 'docker' }); if (!d.ok) assert.ok(/docker\.com/.test(d.items[0].help));
  });
  await t('test(): real stdio server → tools listed with names; nothing saved', async () => {
    const r = await easy.test({ name: 'fake', command: process.execPath, args: [srvFile], env: {}, headers: {}, needs: [] }, { timeout: 15000 });
    assert.ok(r.ok && r.ready, r.error); assert.strictEqual(r.count, 2); assert.deepStrictEqual(r.tools.map((x) => x.name), ['echo', 'wipe']); assert.strictEqual(r.serverInfo.name, 'fake');
    assert.strictEqual(mcp.view().length, 0);
  });
  await t('test(): failing command → plain error with likely cause; bad key → stderr shown but secret scrubbed', async () => {
    let r = await easy.test({ name: 'x', command: 'definitely-not-installed-xyz', args: [], env: {}, headers: {}, needs: [] }, { timeout: 8000 });
    assert.ok(!r.ok); assert.ok(/not installed|not found/i.test(r.cause), r.cause); assert.ok(r.hint);
    r = await easy.test({ name: 'x', command: process.execPath, args: ['-e', 'console.error("ModuleNotFoundError: no module named foo"); process.exit(1)'], env: {}, headers: {}, needs: [] }, { timeout: 8000 });
    assert.ok(!r.ok); assert.ok(/ModuleNotFoundError/.test(r.stderr)); assert.ok(/missing/i.test(r.cause));
    r = await easy.test({ name: 'x', command: process.execPath, args: [srvFile], env: { NEED_KEY: 'right-key-1', FAKE_API_KEY: 'wrong-key-9999' }, headers: {}, needs: [] }, { timeout: 8000 });
    assert.ok(!r.ok && /refused the key/.test(r.cause), r.cause); assert.ok(/401/.test(r.stderr)); assert.ok(!r.stderr.includes('wrong-key-9999'), 'secret scrubbed from stderr');
    r = await easy.test({ name: 'x', command: process.execPath, args: ['-e', 'setTimeout(()=>{},60000)'], env: {}, headers: {}, needs: [] }, { timeout: 1500 });
    assert.ok(!r.ok && /did not answer/.test(r.cause));
    r = await easy.test({ name: 'x', url: 'http://127.0.0.1:9/mcp' }, { timeout: 4000 }); assert.ok(!r.ok);
    r = await easy.test({ name: 'x', url: 'http://example.com/mcp' }); assert.ok(/https/.test(r.error));
    const gh = easy.catalog().find((c) => c.id === 'github').server; r = await easy.test(gh); assert.ok(!r.ok && /Missing/.test(r.error));
  });
  await t('add(): saved, secrets in the secret store (not in settings), status ready, view never leaks values, per-tool switch hides agent tool', async () => {
    const draft = P(`npx -y fake-mcp`).servers[0]; // shape only; replace with the local server
    const cfg = { ...draft, name: 'fake', command: process.execPath, args: [srvFile], env: { FAKE_API_KEY: 'super-secret-key-1', PLAIN: 'visible' }, headers: {}, needs: [] };
    const r = await easy.add(cfg); assert.ok(r.ok); const id = r.server.id;
    const saved = JSON.stringify(store.getSettings().mcp); assert.ok(!saved.includes('super-secret-key-1') && saved.includes('visible') && saved.includes('FAKE_API_KEY'));
    assert.strictEqual(providers.getKey(`mcp:${id}:env:FAKE_API_KEY`), 'super-secret-key-1');
    let v = mcp.view().find((s) => s.id === id); assert.strictEqual(v.status, 'ready'); assert.strictEqual(v.tools.length, 2); assert.ok(!JSON.stringify(v).includes('super-secret-key-1'));
    assert.ok(agent.get('mcp__fake__echo') && agent.get('mcp__fake__wipe'));
    const call = await agent.get('mcp__fake__echo').run({ text: 'salut' }); assert.ok(/echo:salut/.test(call.content));
    await mcp.setToolEnabled(id, 'wipe', false); assert.ok(!agent.get('mcp__fake__wipe') && agent.get('mcp__fake__echo'));
    v = mcp.view().find((s) => s.id === id); assert.strictEqual(v.tools.find((x) => x.name === 'wipe').enabled, false);
    await mcp.setToolEnabled(id, 'wipe', true); assert.ok(agent.get('mcp__fake__wipe'));
    await mcp.toggle(id, false); assert.ok(!agent.get('mcp__fake__echo')); assert.strictEqual(mcp.view().find((s) => s.id === id).status, 'off');
    await mcp.remove(id); assert.strictEqual(providers.getKey(`mcp:${id}:env:FAKE_API_KEY`), '');
  });
  await t('add(): refuses missing values; headers with Bearer are secret; draft flow never returns secrets', async () => {
    const gh = easy.catalog().find((c) => c.id === 'github').server; let r = await easy.add(gh); assert.ok(!r.ok && /Missing/.test(r.error));
    r = await easy.add(gh, { enabled: false }); assert.ok(r.ok); const s = mcp.view().find((x) => x.name === 'github'); assert.strictEqual(s.status, 'off'); await mcp.remove(s.id);
    const d = easy.parse('claude mcp add --transport http sec https://sec.example.com/mcp --header "Authorization: Bearer abc123456789"', { existingNames: [] });
    r = await easy.add({ ...d.servers[0] }, { enabled: false }); const id = mcp.view().find((x) => x.name === 'sec').id;
    assert.ok(!JSON.stringify(store.getSettings().mcp).includes('abc123456789')); assert.strictEqual(providers.getKey(`mcp:${id}:hdr:Authorization`), 'Bearer abc123456789');
    assert.ok(!JSON.stringify(mcp.view()).includes('abc123456789')); await mcp.remove(id);
    const ipc = {}; easy.init({ handle: (ch, fn) => { ipc[ch] = fn; } });
    const pr = await ipc['mcpeasy:parse'](null, 'claude mcp add --transport http sec2 https://sec.example.com/mcp --header "Authorization: Bearer topsecret-123456"');
    assert.ok(!JSON.stringify(pr).includes('topsecret-123456')); assert.ok(pr.servers[0].draftId);
    const tr = await ipc['mcpeasy:test'](null, { draftId: pr.servers[0].draftId }); assert.ok(!tr.ok);
    const ar = await ipc['mcpeasy:add'](null, { draftId: pr.servers[0].draftId, name: 'renamed', enabled: false }); assert.ok(ar.ok); assert.ok(!JSON.stringify(ar).includes('topsecret-123456'));
    for (const s of mcp.view()) await mcp.remove(s.id);
  });
  await t('legacy importClaude is OFF too; agent tool names stay valid', async () => {
    const f = path.join(process.platform === 'darwin' ? path.join(tmp, 'Library', 'Application Support') : process.platform === 'win32' ? process.env.APPDATA : path.join(tmp, '.config'), 'Claude', 'claude_desktop_config.json');
    const r = await mcp.importClaude(['desk']); assert.ok(fs.existsSync(f)); assert.ok(r.every((s) => s.status === 'off'));
    for (const s of mcp.view()) await mcp.remove(s.id);
  });
  console.log(`\n${pass} passed, ${failed} failed`);
  mcp.stopAll(); process.exit(failed ? 1 : 0);
})();

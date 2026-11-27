// .mcpb files (MCP Bundles, formerly .dxt): a zip with manifest.json and the server's code. Dropped on
// Settings → Connectors, Fabro unpacks it into <data>/mcpb/<name>, shows what it declares, and turns its
// manifest into a connector (mcpeasy.add). user_config entries become the fields to fill.
const fs = require('fs');
const path = require('path');

function fromManifest(m, dir) {
  const mc = (m.server && m.server.mcp_config) || {};
  const sub = (v) => String(v).replace(/\$\{__dirname\}/g, dir).replace(/\$\{HOME\}/g, require('os').homedir());
  const needs = []; const env = {}; const args = [];
  const ucfg = m.user_config || {};
  const fill = (v, where, name) => { const k = String(v).match(/^\$\{user_config\.([\w-]+)\}$/); if (!k) return sub(v); const u = ucfg[k[1]] || {}; needs.push({ where, name, label: u.title || u.description || k[1], secret: !!u.sensitive, required: !!u.required, kind: u.type === 'directory' ? 'folder' : u.sensitive ? 'password' : 'text' }); return ''; };
  for (const a of mc.args || []) { const v = fill(a, 'argAppend', `arg${args.length}`); if (v) args.push(v); }
  for (const [k, v] of Object.entries(mc.env || {})) env[k] = fill(v, 'env', k);
  let command = sub(mc.command || ''); const type = (m.server && m.server.type) || '';
  if (!command && type === 'node') { command = 'node'; args.unshift(path.join(dir, m.server.entry_point || 'server/index.js')); }
  if (!command && type === 'python') { command = 'python'; args.unshift(path.join(dir, m.server.entry_point || 'server/main.py')); }
  if (!command) throw new Error('manifest.json has no command to start the server');
  return { name: String(m.name || path.basename(dir)).replace(/[^\w.-]/g, '-').slice(0, 60), type: 'stdio', command, args, env, url: '', headers: {}, needs };
}

async function open(file) {
  const { readZip } = require('./ziplite');
  const { entries } = readZip(fs.readFileSync(file), { maxArchive: 200 << 20, maxTotal: 400 << 20, maxFile: 120 << 20, maxFiles: 20000, maxDepth: 30 });
  const man = entries.find((e) => e.path === 'manifest.json'); if (!man) throw new Error('No manifest.json in this .mcpb file');
  const m = JSON.parse(man.data.toString('utf8'));
  const name = String(m.name || path.basename(file, '.mcpb')).replace(/[^\w.-]/g, '-').slice(0, 60);
  const dir = path.join(require('./paths').dataDir(), 'mcpb', name);
  fs.rmSync(dir, { recursive: true, force: true });
  for (const e of entries) { const to = path.join(dir, e.path); if (!to.startsWith(dir + path.sep)) continue; if (e.path.endsWith('/')) continue; fs.mkdirSync(path.dirname(to), { recursive: true }); fs.writeFileSync(to, e.data); }
  const server = fromManifest(m, dir);
  // what it declares, shown before it is turned on
  const declares = { name: m.display_name || m.name, version: m.version || '', author: (m.author && m.author.name) || '', description: m.description || '', tools: (m.tools || []).map((t) => t.name || t).slice(0, 40), permissions: m.compatibility || {} };
  return { server, declares };
}

function register(h) {
  h('mcpeasy:mcpb', async (file) => { const { server, declares } = await open(String(file)); return { declares, result: await require('./mcpeasy').add(server) }; });
}
module.exports = { open, fromManifest, register };

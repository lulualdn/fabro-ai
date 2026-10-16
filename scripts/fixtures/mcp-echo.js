// Tiny MCP stdio server used by the end-to-end test.
const rl = require('readline').createInterface({ input: process.stdin });
const send = (o) => process.stdout.write(JSON.stringify(o) + '\n');
rl.on('line', (line) => {
  let m; try { m = JSON.parse(line); } catch { return; }
  if (m.method === 'initialize') send({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'echo', version: '1.0.0' } } });
  else if (m.method === 'tools/list') send({ jsonrpc: '2.0', id: m.id, result: { tools: [
    { name: 'echo', description: 'Echo a message back', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] }, annotations: { readOnlyHint: true } },
    { name: 'add', description: 'Add two numbers', inputSchema: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } } }, annotations: { readOnlyHint: true } },
  ] } });
  else if (m.method === 'tools/call') {
    const a = m.params.arguments || {};
    const text = m.params.name === 'add' ? String((a.a || 0) + (a.b || 0)) : `echo: ${a.text}`;
    send({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text }] } });
  } else if (m.id != null) send({ jsonrpc: '2.0', id: m.id, result: {} });
});

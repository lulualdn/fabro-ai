// Testing and diagnosis tools for the AI.
//   run_test_sequence: the AI describes steps (prepare, run, check) and Fabro runs them: shell commands, HTTP calls
//     or pages driven in a hidden browser. Short answer: "OK" when all pass, else the failing step, what was expected,
//     what came, and the useful end of the log. The AI only says "done" when its sequence passes.
//   diagnose: system, versions, listening ports, matching processes, memory, recent logs, with leads.
const { exec } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const agent = require('./index');

const WIN = process.platform === 'win32';
const tail = (s, n = 40) => String(s || '').split('\n').slice(-n).join('\n');
function sh(cmd, { cwd, timeout = 120000 } = {}) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    exec(cmd, { cwd, timeout, maxBuffer: 8 << 20, windowsHide: true, shell: WIN ? 'powershell.exe' : '/bin/bash' }, (err, stdout, stderr) => {
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, out: String(stdout || ''), err: String(stderr || ''), ms: Date.now() - t0, timedOut: !!(err && err.killed) });
    });
  });
}
async function page(step, timeout) {
  const { BrowserWindow } = require('electron');
  const w = new BrowserWindow({ show: false, width: 1280, height: 900, webPreferences: { sandbox: true } });
  const logs = []; w.webContents.on('console-message', (_e, level, msg) => { if (level >= 2) logs.push(msg); });
  try {
    await Promise.race([w.loadURL(step.page), new Promise((_, ko) => setTimeout(() => ko(new Error('page did not load in time')), timeout))]);
    for (const a of step.actions || []) {
      if (a.wait) await new Promise((r) => setTimeout(r, Math.min(10000, Number(a.wait) || 500)));
      if (a.click) { const ok = await w.webContents.executeJavaScript(`(() => { const e = document.querySelector(${JSON.stringify(a.click)}); if (!e) return false; e.click(); return true; })()`); if (!ok) return { code: 1, out: '', err: `no element for ${a.click}`, logs }; }
      if (a.type) await w.webContents.executeJavaScript(`(() => { const e = document.querySelector(${JSON.stringify(a.type.selector)}); if (!e) return; e.focus(); e.value = ${JSON.stringify(String(a.type.text || ''))}; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      await new Promise((r) => setTimeout(r, 250));
    }
    const text = await w.webContents.executeJavaScript('document.body ? document.body.innerText : ""');
    return { code: logs.length && step.expect && step.expect.noConsoleErrors ? 1 : 0, out: text, err: logs.join('\n'), logs };
  } finally { if (!w.isDestroyed()) w.destroy(); }
}
function check(step, r) {
  const e = step.expect || {}; const got = `${r.out}\n${r.err}`;
  if (r.timedOut) return `timed out after ${Math.round(r.ms / 1000)} s`;
  if (step.http && e.status != null && Number(e.status) !== r.status) return `expected HTTP ${e.status}, got ${r.status}`;
  if (!step.http && !step.page && (e.code != null ? Number(e.code) : 0) !== r.code) return `expected exit code ${e.code ?? 0}, got ${r.code}`;
  if (step.page && r.code) return r.err || 'console errors on the page';
  if (e.contains && !got.includes(String(e.contains))) return `expected the output to contain "${e.contains}"`;
  if (e.not_contains && got.includes(String(e.not_contains))) return `expected the output not to contain "${e.not_contains}"`;
  if (e.regex) { let re; try { re = new RegExp(e.regex, 'm'); } catch { return 'bad regex in expect'; } if (!re.test(got)) return `expected the output to match /${e.regex}/`; }
  return '';
}

agent.register({
  name: 'run_test_sequence', category: 'diagnostic', risk: 'exec', noMcpWrap: true, keywords: ['test', 'teste', 'vérifie', 'check', 'verify', 'marche', 'works'],
  description: 'Check that code really works: run steps in order (shell command, HTTP call or a page driven in a hidden browser) with what each must give. Answers "OK" if all pass, else the failing step, expected, got and the end of the log. Fix, then run it again; only say done when it passes.',
  example: 'run_test_sequence({ cwd: "C:/proj", steps: [{ name: "install", run: "npm ci" }, { name: "tests", run: "npm test", expect: { contains: "passing" } }, { name: "api", http: { url: "http://localhost:3000/health" }, expect: { status: 200 } }, { name: "ui", page: "http://localhost:3000", actions: [{ click: "#add" }], expect: { contains: "1 item" } }] })',
  parameters: { type: 'object', properties: {
    cwd: { type: 'string', description: 'Folder to run in (the project by default)' },
    steps: { type: 'array', items: { type: 'object', properties: {
      name: { type: 'string' }, run: { type: 'string', description: 'Shell command' },
      http: { type: 'object', description: '{ url, method, body, headers }' },
      page: { type: 'string', description: 'URL to open in a hidden browser' }, actions: { type: 'array', items: { type: 'object' }, description: '[{ click: "css" }, { type: { selector, text } }, { wait: ms }]' },
      expect: { type: 'object', description: '{ code, status, contains, not_contains, regex, noConsoleErrors }' }, timeout: { type: 'number', description: 'Seconds (120 by default)' },
    } } },
  }, required: ['steps'] },
  summarize: (a) => `${(a.steps || []).length} steps`,
  async run(a, ctx) {
    const cwd = a.cwd || ctx.projectRoot || os.homedir();
    if (!fs.existsSync(cwd)) throw new Error('Folder not found: ' + cwd);
    const steps = (a.steps || []).slice(0, 40); if (!steps.length) throw new Error('No steps.');
    const log = [];
    for (let i = 0; i < steps.length; i++) {
      const st = steps[i]; const name = st.name || `step ${i + 1}`; const timeout = Math.min(900, Number(st.timeout) || 120) * 1000;
      ctx.emit && ctx.emit({ type: 'tool_progress', id: ctx.callId, text: name, pct: Math.round(i / steps.length * 100) });
      let r;
      if (st.run) r = await sh(String(st.run), { cwd, timeout });
      else if (st.http) {
        const { net } = require('electron'); const t0 = Date.now();
        try { const res = await Promise.race([net.fetch(st.http.url, { method: st.http.method || 'GET', headers: st.http.headers || {}, body: st.http.body ? (typeof st.http.body === 'string' ? st.http.body : JSON.stringify(st.http.body)) : undefined }), new Promise((_, ko) => setTimeout(() => ko(new Error('timeout')), timeout))]); r = { status: res.status, out: (await res.text()).slice(0, 20000), err: '', ms: Date.now() - t0, code: 0 }; }
        catch (e) { r = { status: 0, out: '', err: String(e.message || e), ms: Date.now() - t0, code: 1, timedOut: /timeout/.test(String(e.message)) }; }
      } else if (st.page) r = await page(st, timeout).catch((e) => ({ code: 1, out: '', err: String(e.message || e) }));
      else return { content: `Step ${i + 1} (${name}) has nothing to run: give run, http or page.` };
      const bad = check(st, r);
      log.push(`${bad ? '✗' : '✓'} ${name} (${Math.round((r.ms || 0) / 100) / 10} s)`);
      if (bad) return { content: `FAIL at step ${i + 1}/${steps.length}: ${name}\nExpected: ${bad.replace(/^expected /, '')}\nGot (end of output):\n${tail(`${r.out}${r.err ? '\n' + r.err : ''}`, 40)}\n\nSteps:\n${log.join('\n')}`, view: { kind: 'tests', ok: false, failed: name, steps: log } };
    }
    return { content: `OK (${steps.length} steps)`, view: { kind: 'tests', ok: true, steps: log } };
  },
});

agent.register({
  name: 'diagnose', category: 'diagnostic', risk: 'read', noMcpWrap: true, keywords: ['bug', 'erreur', 'error', 'crash', 'plante', 'marche pas', "doesn't work", 'port', 'lent', 'slow'],
  description: 'Diagnose a problem: system and memory, versions of node / python / git, listening ports (or one port), processes matching a name, the end of the recent log files of a folder, with leads to fix.',
  parameters: { type: 'object', properties: { cwd: { type: 'string' }, port: { type: 'number' }, process: { type: 'string' } } },
  summarize: (a) => a.port ? `port ${a.port}` : a.process || a.cwd || 'system',
  async run(a, ctx) {
    const cwd = a.cwd || ctx.projectRoot || '';
    const ver = async (c) => (await sh(c, { timeout: 8000 })).out.trim().split('\n')[0] || 'absent';
    const [node, py, git] = await Promise.all([ver('node --version'), ver(WIN ? 'python --version' : 'python3 --version'), ver('git --version')]);
    const ports = (await sh(WIN ? 'Get-NetTCPConnection -State Listen | Select-Object LocalPort,OwningProcess | Sort-Object LocalPort | Format-Table -HideTableHeaders | Out-String' : 'ss -ltnp 2>/dev/null || lsof -iTCP -sTCP:LISTEN -n -P', { timeout: 10000 })).out;
    const portLines = ports.split('\n').filter((l) => l.trim() && (!a.port || new RegExp(`[:\\s]${a.port}\\b`).test(l))).slice(0, 30).join('\n');
    const procs = a.process ? (await sh(WIN ? `Get-Process *${String(a.process).replace(/[^\w.-]/g, '')}* | Select-Object Id,ProcessName,CPU,WS | Format-Table | Out-String` : `ps aux | grep -i ${JSON.stringify(String(a.process))} | grep -v grep | head -20`, { timeout: 10000 })).out.trim() : '';
    let logs = '';
    if (cwd && fs.existsSync(cwd)) {
      const files = fs.readdirSync(cwd).filter((f) => /\.log$|npm-debug|yarn-error/i.test(f)).map((f) => ({ f, t: fs.statSync(path.join(cwd, f)).mtimeMs })).sort((x, y) => y.t - x.t).slice(0, 3);
      logs = files.map(({ f }) => `--- ${f}\n${tail(fs.readFileSync(path.join(cwd, f), 'utf8'), 25)}`).join('\n');
    }
    const free = os.freemem() / 1e9, total = os.totalmem() / 1e9;
    const leads = [];
    if (a.port && !portLines) leads.push(`Nothing listens on port ${a.port}: the server is not started, crashed, or uses another port.`);
    if (a.port && portLines) leads.push(`Port ${a.port} is taken: another program may be holding it (see the process id).`);
    if (free / total < 0.1) leads.push('Memory is almost full: close programs or use a smaller model.');
    if (node === 'absent') leads.push('Node.js is not installed or not in PATH.');
    if (/error|exception|EADDRINUSE|ENOENT|EACCES/i.test(logs)) leads.push('The logs contain errors: read the lines above, the first error is usually the cause.');
    return { content: `System: ${os.type()} ${os.release()} · ${os.cpus().length} threads · memory ${free.toFixed(1)} / ${total.toFixed(1)} GB free\nVersions: node ${node} · ${py} · ${git}\n${a.port ? `Port ${a.port}:\n${portLines || '(nothing listening)'}` : `Listening ports:\n${portLines.slice(0, 1500)}`}${procs ? `\nProcesses "${a.process}":\n${procs.slice(0, 1500)}` : ''}${logs ? `\nRecent logs:\n${logs.slice(0, 4000)}` : ''}\n${leads.length ? `\nLeads:\n- ${leads.join('\n- ')}` : ''}`, view: { kind: 'diagnose' } };
  },
});

module.exports = { sh };

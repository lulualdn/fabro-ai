// Terminal tool: runs a command in an allowed folder, output streamed to the chat.
// Confined to the folder (working directory + no inherited secrets), always confirmed unless allowed.
const { spawn } = require('child_process');
const path = require('path');
const agent = require('./index');
const files = require('./files');

const DANGER = /(\brm\s+-[a-z]*r|\brmdir\b|\bdel\b\s|Remove-Item|\bformat\b\s+[a-z]:|\bmkfs|\bdd\s+if=|shutdown|Restart-Computer|Stop-Computer|reg\s+delete|\bchmod\s+-R\s+777|curl[^|]*\|\s*(ba)?sh|iwr[^|]*\|\s*iex|Invoke-Expression|git\s+push\s+.*--force|git\s+reset\s+--hard|npm\s+publish|:\(\)\s*\{)/i;
const SECRET_ENV = /(TOKEN|SECRET|PASSWORD|API_KEY|APIKEY|ACCESS_KEY|PRIVATE)/i;

function shellFor(kind) {
  const win = process.platform === 'win32';
  if (kind === 'cmd' || (win && kind === 'cmd')) return ['cmd.exe', ['/d', '/s', '/c']];
  if (kind === 'bash' || (!win && kind !== 'powershell')) return [process.env.SHELL && !win ? process.env.SHELL : '/bin/bash', ['-lc']];
  return ['powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command']];
}

agent.register({
  name: 'run_command', category: 'shell', risk: 'exec', core: true,
  description: `Run a terminal command in a folder and get its output (exit code, stdout, stderr). ${process.platform === 'win32' ? 'Windows: PowerShell by default.' : 'Uses bash.'} Use for builds, tests, git, package managers, scripts. Not interactive: never run commands that wait for input.`,
  parameters: { type: 'object', properties: { command: { type: 'string' }, cwd: { type: 'string', description: 'Folder to run in (default: the project in Code mode, else Documents/Fabro)' }, timeout_s: { type: 'integer', description: 'Default 120, max 900' }, shell: { type: 'string', enum: ['auto', 'powershell', 'cmd', 'bash'] } }, required: ['command'] },
  summarize: (a) => `${a.command}${a.cwd ? `\n📁 ${a.cwd}` : ''}`,
  guard: (a, ctx) => {
    if (DANGER.test(a.command || '')) return { confirm: 'danger_command' };
    // Code-mode sandbox: commands stay in the project folder.
    if (ctx && ctx.projectRoot) {
      const cwd = files.resolvePath(a.cwd || '.', ctx);
      if (!files.inside(cwd, ctx.projectRoot)) return { confirm: 'outside_project' };
      const abs = String(a.command).match(/(?:^|[\s"'=])((?:[A-Za-z]:\\|\/)[^\s"';|&]+)/g) || [];
      const outside = abs.map((x) => x.trim().replace(/^["'=]/, '')).filter((x) => !/^\/(dev\/null|tmp\b|usr\/bin|bin\/)/.test(x)).find((x) => !files.inside(require('path').resolve(x), ctx.projectRoot));
      if (outside) return { confirm: 'outside_project' };
    }
    return null;
  },
  async run(a, ctx) {
    const cwd = a.cwd ? files.resolvePath(a.cwd, ctx) : ctx.projectRoot || files.defaultOut();
    require('fs').mkdirSync(cwd, { recursive: true });
    await files.access(cwd, ctx, true);
    const [bin, pre] = shellFor(a.shell || 'auto');
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !SECRET_ENV.test(k) && !/^ELECTRON_/.test(k)));
    env.FABRO_AGENT = '1';
    if (ctx.projectRoot) { env.FABRO_PROJECT = ctx.projectRoot; env.CI = env.CI || '1'; env.GIT_TERMINAL_PROMPT = '0'; env.npm_config_yes = 'true'; }
    const timeout = Math.min(900, Math.max(5, a.timeout_s || 120)) * 1000;
    const t0 = Date.now();
    let out = '', err = '', killed = false;
    const code = await new Promise((resolve) => {
      const p = spawn(bin, [...pre, a.command], { cwd, env, windowsHide: true });
      ctx.onAbort && ctx.onAbort(() => { killed = true; try { p.kill(); } catch {} });
      const t = setTimeout(() => { killed = true; try { p.kill(); } catch {} }, timeout);
      const push = (which) => (d) => {
        const s = String(d);
        if (which === 'out') out += s; else err += s;
        ctx.emit && ctx.emit({ type: 'tool_progress', id: ctx.callId, text: s });
        if (out.length + err.length > 400000) { killed = true; try { p.kill(); } catch {} }
      };
      p.stdout.on('data', push('out')); p.stderr.on('data', push('err'));
      p.on('error', (e) => { err += String(e.message); clearTimeout(t); resolve(-1); });
      p.on('close', (c) => { clearTimeout(t); resolve(c); });
    });
    const clip = (s) => s.length > 16000 ? s.slice(0, 6000) + `\n… (${s.length - 12000} chars cut) …\n` + s.slice(-6000) : s;
    const ms = Date.now() - t0;
    return {
      content: `$ ${a.command}\n(exit ${code}${killed ? ', stopped' : ''}, ${(ms / 1000).toFixed(1)} s, in ${cwd})\n${clip(out)}${err ? `\n[stderr]\n${clip(err)}` : ''}`,
      view: { kind: 'command', command: a.command, cwd, code, ms, killed, out: (out + (err ? '\n' + err : '')).slice(-6000) },
    };
  },
});

module.exports = { DANGER };

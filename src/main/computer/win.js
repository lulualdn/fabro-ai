// Windows backend: a small native helper compiled on first use with the C# compiler that ships with
// Windows (.NET Framework 4.x), plus the OCR built into Windows through PowerShell. Nothing to install.
const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { LineProc } = require('./lineproc');

const dir = () => path.join(app.getPath('userData'), 'computer');
// Sources are read through Electron's fs (they may sit inside app.asar) and copied out to be run.
const src = (f) => fs.readFileSync(path.join(__dirname, 'win', f), 'utf8');

function csc() {
  const w = process.env.WINDIR || 'C:\\Windows';
  const c = [path.join(w, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'), path.join(w, 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe')];
  return c.find((p) => fs.existsSync(p));
}

let building = null;
function build() {
  if (building) return building;
  building = (async () => {
    const code = src('helper.cs');
    const hash = crypto.createHash('sha1').update(code).digest('hex').slice(0, 10);
    fs.mkdirSync(dir(), { recursive: true });
    const exe = path.join(dir(), `fabro-cu-${hash}.exe`);
    if (fs.existsSync(exe)) return exe;
    const compiler = csc();
    if (!compiler) throw Object.assign(new Error('Computer Use needs the .NET Framework 4 that comes with Windows 10/11 (csc.exe was not found).'), { code: 'CU_UNAVAILABLE' });
    const wpf = path.join(path.dirname(compiler), 'WPF');
    const cs = path.join(dir(), `helper-${hash}.cs`);
    fs.writeFileSync(cs, code, 'utf8');
    const tmp = exe + '.tmp.exe';
    await new Promise((res, rej) => execFile(compiler, ['/nologo', '/target:exe', '/optimize+', '/platform:anycpu', '/utf8output', `/out:${tmp}`,
      '/r:System.dll', '/r:System.Core.dll', '/r:System.Drawing.dll', '/r:System.Web.Extensions.dll',
      `/r:${path.join(wpf, 'UIAutomationClient.dll')}`, `/r:${path.join(wpf, 'UIAutomationTypes.dll')}`, `/r:${path.join(wpf, 'WindowsBase.dll')}`, cs],
    { windowsHide: true, timeout: 120000 }, (e, out, err) => (e ? rej(new Error(`Could not build the Computer Use helper: ${(out || '') + (err || '') || e.message}`.slice(0, 1500))) : res())));
    fs.renameSync(tmp, exe);
    // older builds
    for (const f of fs.readdirSync(dir())) if (/^(fabro-cu-|helper-).*\.(exe|cs)$/.test(f) && !f.includes(hash)) { try { fs.rmSync(path.join(dir(), f), { force: true }); } catch {} }
    return exe;
  })();
  building.catch(() => {}).finally(() => { building = null; });
  return building;
}

function create({ onUser }) {
  let helper = null, ocr = null;
  const proc = async () => {
    if (helper) return helper;
    const exe = await build();
    helper = new LineProc('Computer Use helper', exe, [], { cwd: dir(), onEvent: (m) => { if (m.event === 'user') onUser(m); } });
    try { await helper.start(); }
    catch (e) {
      // a just-written exe can be held for a moment by the antivirus scan: one retry
      helper.kill(); await new Promise((r) => setTimeout(r, 1500));
      try { await helper.start(); } catch (e2) { helper = null; throw e2; }
    }
    return helper;
  };
  const ocrProc = async () => {
    if (ocr) return ocr;
    fs.mkdirSync(dir(), { recursive: true });
    const ps1 = path.join(dir(), 'ocr.ps1');
    const code = src('ocr.ps1');
    if (!fs.existsSync(ps1) || fs.readFileSync(ps1, 'utf8').replace(/^\ufeff/, '') !== code) fs.writeFileSync(ps1, '\ufeff' + code, 'utf8');
    ocr = new LineProc('Windows OCR', 'powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ps1], { cwd: dir(), readyTimeout: 30000 });
    const info = await ocr.start().catch((e) => { ocr = null; throw e; });
    if (!info.ok) { const o = ocr; ocr = null; o.kill(); throw Object.assign(new Error('No OCR language is installed in Windows (Settings › Time & language › Language & region).'), { code: 'NO_OCR' }); }
    return ocr;
  };
  return {
    platform: 'win32',
    async call(op, args = {}, timeout = 30000) {
      const h = await proc();
      try { return await h.call(op, args, timeout); }
      catch (e) { if (/stopped unexpectedly/.test(e.message)) { helper = null; } throw e; }
    },
    async ocr(file, scale = 1) {
      const o = await ocrProc();
      const r = await o.call('ocr', { path: file, scale }, 60000);
      return { lines: r.lines || [], lang: r.lang };
    },
    kill() { if (helper) helper.kill(); if (ocr) ocr.kill(); helper = null; ocr = null; },
  };
}

module.exports = { create, build };

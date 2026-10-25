// macOS backend: a small Swift helper (universal binary shipped in the app's resources; built from
// mac/helper.swift with swiftc in development). Input through Quartz events, controls through the
// Accessibility API, screenshots with screencapture, text with Vision. Needs Accessibility and
// Screen Recording for Fabro (System Settings › Privacy & Security).
const { app, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { LineProc } = require('./lineproc');

const dir = () => path.join(app.getPath('userData'), 'computer');
const run = (bin, args, timeout = 300000) => new Promise((res) => execFile(bin, args, { timeout }, (e, out, err) => res({ ok: !e, out: String(out || '') + String(err || '') })));

// the shipped binary, else one built here from the source (development checkouts)
let building = null;
async function binary() {
  const shipped = [process.resourcesPath && path.join(process.resourcesPath, 'fabro-cu'), path.join(__dirname, '..', '..', '..', 'build', 'mac', 'fabro-cu')].filter(Boolean);
  for (const f of shipped) if (fs.existsSync(f)) return f;
  if (building) return building;
  building = (async () => {
    const code = fs.readFileSync(path.join(__dirname, 'mac', 'helper.swift'), 'utf8');
    const hash = crypto.createHash('sha1').update(code).digest('hex').slice(0, 10);
    fs.mkdirSync(dir(), { recursive: true });
    const exe = path.join(dir(), `fabro-cu-${hash}`);
    if (fs.existsSync(exe)) return exe;
    const src = path.join(dir(), `helper-${hash}.swift`);
    fs.writeFileSync(src, code);
    const r = await run('xcrun', ['swiftc', '-O', '-swift-version', '5', '-o', exe, src]);
    if (!r.ok) throw Object.assign(new Error(`The Computer Use helper is missing from this build and could not be compiled (needs the Xcode command line tools): ${r.out.slice(-800)}`), { code: 'CU_UNAVAILABLE' });
    return exe;
  })();
  try { return await building; } finally { building = null; }
}

const PANES = { accessibility: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility', screen: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture' };

function create({ onUser }) {
  let helper = null, allowed = false;
  const proc = async () => {
    if (helper) return helper;
    const exe = await binary();
    helper = new LineProc('Computer Use helper', exe, [], { cwd: path.dirname(exe), onEvent: (m) => { if (m.event === 'user') onUser(m); } });
    await helper.start().catch((e) => { helper = null; throw e; });
    return helper;
  };
  // Both permissions are needed; macOS asks once and opens the right page of System Settings.
  async function ensureAllowed() {
    if (allowed) return;
    const h = await proc();
    let p = await h.call('permissions', { prompt: false });
    if (!p.accessibility || !p.screen) {
      p = await h.call('permissions', { prompt: true });
      if (!p.accessibility || !p.screen) {
        const missing = [!p.accessibility && 'Accessibility', !p.screen && 'Screen Recording'].filter(Boolean);
        shell.openExternal(!p.accessibility ? PANES.accessibility : PANES.screen).catch(() => {});
        throw Object.assign(new Error(`macOS has not allowed Fabro to ${!p.accessibility ? 'control the mouse and keyboard' : 'see the screen'} yet. Ask the user to turn Fabro on in System Settings › Privacy & Security › ${missing.join(' and ')} (the page is open), then quit and reopen Fabro.`), { code: 'CU_PERMISSION' });
      }
    }
    allowed = true;
  }
  return {
    platform: 'darwin',
    async call(op, args = {}, timeout = 30000) {
      const h = await proc();
      if (op !== 'hello' && op !== 'permissions') await ensureAllowed();
      try { return await h.call(op, args, timeout); }
      catch (e) { if (/stopped unexpectedly/.test(e.message)) helper = null; throw e; }
    },
    async ocr(file, scale = 1) {
      const r = await this.call('ocr', { path: file, scale }, 60000);
      return { lines: r.lines || [], lang: r.lang };
    },
    kill() { if (helper) helper.kill(); helper = null; },
  };
}

module.exports = { create, binary };

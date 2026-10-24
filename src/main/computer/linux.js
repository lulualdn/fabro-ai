// Linux backend (X11): a Python helper using the XTEST extension (python-xlib, installed in Fabro's
// own Python on first use). Text recognition uses tesseract when it is installed.
const { app, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { LineProc } = require('./lineproc');

const dir = () => path.join(app.getPath('userData'), 'computer');
const run = (bin, args, timeout = 600000) => new Promise((res) => execFile(bin, args, { timeout, windowsHide: true }, (e, out, err) => res({ ok: !e, out: String(out || '') + String(err || '') })));

async function pythonWithXlib(ctx) {
  if (process.env.XDG_SESSION_TYPE === 'wayland' && !process.env.DISPLAY) throw Object.assign(new Error('Computer Use needs an X11 session on Linux (Wayland is not supported yet).'), { code: 'CU_UNAVAILABLE' });
  if (!process.env.DISPLAY) throw Object.assign(new Error('No X11 display found (DISPLAY is not set).'), { code: 'CU_UNAVAILABLE' });
  const candidates = [process.env.FABRO_CU_PYTHON];
  try { const py = require('../agent/python'); if (py.installed()) candidates.push(py.pyPath()); } catch {}
  candidates.push('python3');
  for (const bin of candidates.filter(Boolean)) if ((await run(bin, ['-c', 'import Xlib.ext.xtest'], 20000)).ok) return bin;
  // install python-xlib into Fabro's Python (installed on demand like for run_python)
  const py = require('../agent/python');
  if (!py.installed()) { if (ctx && ctx.needDeps) await ctx.needDeps('python'); if (!py.installed()) throw Object.assign(new Error('Python is needed for Computer Use on Linux'), { code: 'CU_UNAVAILABLE' }); }
  const r = await run(py.pyPath(), ['-m', 'pip', 'install', '--quiet', 'python-xlib']);
  if (!r.ok) throw new Error(`Could not install python-xlib: ${r.out.slice(-600)}`);
  return py.pyPath();
}

function binarize(img) {
  const { width: w, height: h } = img.getSize();
  const px = img.toBitmap(); const gray = new Uint8Array(w * h); const hist = new Array(256).fill(0);
  for (let i = 0; i < w * h; i++) { const g = (px[i * 4] * 0.114 + px[i * 4 + 1] * 0.587 + px[i * 4 + 2] * 0.299) | 0; gray[i] = g; hist[g]++; }
  let sum = 0; for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sB = 0, wB = 0, best = 0, th = 128;
  for (let t = 0; t < 256; t++) { wB += hist[t]; if (!wB) continue; const wF = w * h - wB; if (!wF) break; sB += t * hist[t]; const mB = sB / wB, mF = (sum - sB) / wF; const v = wB * wF * (mB - mF) ** 2; if (v > best) { best = v; th = t; } }
  const out = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) { const v = gray[i] > th ? 255 : 0; out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = v; out[i * 4 + 3] = 255; }
  return nativeImage.createFromBitmap(out, { width: w, height: h }).toPNG();
}

function create({ onUser }) {
  let helper = null;
  let ctxRef = null;
  const proc = async () => {
    if (helper) return helper;
    const py = await pythonWithXlib(ctxRef);
    fs.mkdirSync(dir(), { recursive: true });
    const file = path.join(dir(), 'helper.py');
    fs.writeFileSync(file, fs.readFileSync(path.join(__dirname, 'linux', 'helper.py'), 'utf8'));
    helper = new LineProc('Computer Use helper', py, ['-u', file], { cwd: dir(), onEvent: (m) => { if (m.event === 'user') onUser(m); } });
    await helper.start().catch((e) => { helper = null; throw e; });
    return helper;
  };
  return {
    platform: 'linux',
    setCtx(ctx) { ctxRef = ctx; },
    async call(op, args = {}, timeout = 30000) {
      const h = await proc();
      try { return await h.call(op, args, timeout); }
      catch (e) { if (/stopped unexpectedly/.test(e.message)) helper = null; throw e; }
    },
    async ocr(file, scale = 1) {
      const h = await proc();
      // tesseract reads black text on white best: add a black & white version (Otsu threshold)
      const more = [];
      try { const bw = file.replace(/\.png$/i, '') + '-bw.png'; fs.writeFileSync(bw, binarize(nativeImage.createFromPath(file))); more.push(bw); } catch {}
      const r = await h.call('ocr', { path: file, more, scale }, 90000);
      return { lines: r.lines || [], lang: r.lang };
    },
    kill() { if (helper) helper.kill(); helper = null; },
  };
}

module.exports = { create };

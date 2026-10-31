// Fabro Anywhere — Python on the phone (Pyodide). Loaded on first use, then kept offline by the service worker.
const BASE = 'https://cdn.jsdelivr.net/pyodide/v0.28.0/full/';
let ready = null;
function boot() {
  if (!ready) ready = (async () => { importScripts(BASE + 'pyodide.js'); return loadPyodide({ indexURL: BASE }); })();
  return ready;
}
self.onmessage = async (e) => {
  const { id, code } = e.data || {};
  let out = '';
  try {
    const py = await boot();
    py.setStdout({ batched: (s) => { out += s + '\n'; } }); py.setStderr({ batched: (s) => { out += s + '\n'; } });
    await py.loadPackagesFromImports(code).catch(() => {});
    const r = await py.runPythonAsync(code);
    let image = null;
    if (/matplotlib/.test(code)) {
      image = await py.runPythonAsync(`
import io, base64
try:
    import matplotlib.pyplot as _p
    _b = io.BytesIO()
    if _p.get_fignums():
        _p.savefig(_b, format='png', dpi=110, bbox_inches='tight'); _p.close('all')
        _r = 'data:image/png;base64,' + base64.b64encode(_b.getvalue()).decode()
    else:
        _r = None
except Exception:
    _r = None
_r`);
    }
    if (r !== undefined && r !== null && String(r) !== 'None') out += '→ ' + String(r);
    postMessage({ id, ok: true, out: out.trim().slice(-20000), image });
  } catch (err) { postMessage({ id, ok: false, error: (out + String(err && err.message || err)).slice(-4000) }); }
};

// The desktop interface as one bundle: index.html's body, every script and stylesheet it loads (in order) and
// the shape of window.api (read from preload.js). Sent by the computer to Fabro Anywhere (remote-ui.js), and
// also built into the website (site/build.js) so the phone has the same interface with no computer at all.
// Plain Node (no Electron). resolve(src) maps a file the page loads to a path on disk.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const RENDERER = path.join(__dirname, '..', 'renderer');

function apiMap() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
  let exposed = null;
  const stub = {
    require: (m) => (m === 'electron' ? {
      contextBridge: { exposeInMainWorld: (_n, obj) => { exposed = obj; } },
      ipcRenderer: { invoke: (ch) => ({ __ch: ch }), on: () => {}, removeListener: () => {} },
      webUtils: { getPathForFile: () => '' },
    } : {}),
  };
  vm.runInNewContext(src, stub, { timeout: 1000 });
  const map = {};
  const walk = (o, pre) => {
    for (const [k, v] of Object.entries(o || {})) {
      const key = pre ? pre + '.' + k : k;
      if (typeof v === 'function') {
        if (k === 'on') { map[key] = '#on'; continue; }
        let r; try { r = v(); } catch { r = null; }
        map[key] = r && r.__ch ? r.__ch : '#local:' + k;
      } else if (v && typeof v === 'object') walk(v, key);
    }
  };
  walk(exposed, '');
  const allowed = (src.match(/const allowed = (\[[^\]]*\])/) || [])[1];
  return { map, events: allowed ? JSON.parse(allowed.replace(/'/g, '"')) : [] };
}

function build(version, resolve = (src) => path.resolve(RENDERER, src)) {
  const html = fs.readFileSync(path.join(RENDERER, 'index.html'), 'utf8');
  const files = [];
  for (const m of html.matchAll(/<(script|link)\b[^>]*?(?:src|href)="([^"]+)"[^>]*>/g)) {
    const kind = m[1] === 'script' ? 'js' : 'css';
    if (kind === 'css' && !/rel="stylesheet"/.test(m[0])) continue;
    files.push({ src: m[2], kind, text: fs.readFileSync(resolve(m[2]), 'utf8') });
  }
  const body = (html.match(/<body[^>]*>([\s\S]*)<\/body>/) || [])[1].replace(/<script\b[^>]*><\/script>\s*/g, '').trim();
  const { map, events } = apiMap();
  const hash = crypto.createHash('sha256').update(JSON.stringify([body, files.map((f) => f.text), map])).digest('hex').slice(0, 16);
  return { v: `${version}-${hash}`, body, files, api: map, events, settingsDefaults: settingsDefaults() };
}
// The default settings (store.js), for the interface running with no computer behind it.
function settingsDefaults() {
  try {
    const src = fs.readFileSync(path.join(__dirname, 'store.js'), 'utf8');
    const m = src.match(/const DEFAULTS = (\{[\s\S]*?\n\});/);
    return m ? vm.runInNewContext('(' + m[1] + ')', {}, { timeout: 500 }) : {};
  } catch { return {}; }
}

module.exports = { build, apiMap, RENDERER };

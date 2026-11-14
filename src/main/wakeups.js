// Wake-up scripts (wave 3). The agent starts a script in the background and its loop really stops; when the script
// exits (or its time is up) the renderer is told and calls the conversation back with the output.
// Nothing survives the app closing: scripts are stopped on quit. Tool: src/main/agent/wakeup.js. UI: wakeups-ui.js.
const MAX_MIN = 240;
const jobs = new Map(); // id → { id, convId, command, cwd, note, startedAt, timeoutMin, status, ctrl }
let send = () => {};

const view = () => [...jobs.values()].map(({ ctrl, ...j }) => j);
function init(ipcMain, sendFn) {
  send = sendFn || send;
  ipcMain.handle('wakeups:list', () => view());
  ipcMain.handle('wakeups:cancel', (_e, id) => cancel(id));
}
function start({ convId, command, cwd, env, bin, pre = [], timeoutMin = 30, note = '' }, exec = require('./runtime').exec) {
  const id = 'wk-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const minutes = Math.min(MAX_MIN, Math.max(1, Math.round(+timeoutMin || 30)));
  const ctrl = new AbortController();
  const job = { id, convId, command, cwd, note: String(note || '').slice(0, 300), startedAt: Date.now(), timeoutMin: minutes, status: 'waiting', ctrl };
  jobs.set(id, job);
  let tail = '';
  Promise.resolve()
    .then(() => exec({ bin, args: [...pre, command], cwd, env, timeout: minutes * 60000 }, { signal: ctrl.signal, onData: (s) => { tail = (tail + s).slice(-6000); } }))
    .then((r) => finish(id, { code: r.code, timedOut: !!r.killed, ms: r.ms, out: (String(r.out || '') + (r.err ? '\n[stderr]\n' + r.err : '')).slice(-6000) || tail }))
    .catch((e) => finish(id, { code: null, timedOut: false, error: String((e && e.message) || e), out: tail }));
  send('wakeups:changed', view());
  const { ctrl: _c, ...pub } = job;
  return pub;
}
function finish(id, res) {
  const j = jobs.get(id); if (!j) return;
  jobs.delete(id);
  const { ctrl, ...pub } = j;
  send('wakeups:changed', view());
  if (j.status !== 'cancelled') send('wakeups:done', { ...pub, ...res, status: 'done', endedAt: Date.now() });
}
function cancel(id) {
  const j = jobs.get(id); if (!j) return false;
  j.status = 'cancelled';
  try { j.ctrl.abort(); } catch { /* already over */ }
  return true;
}
function stopAll() { for (const id of [...jobs.keys()]) cancel(id); }

module.exports = { init, start, cancel, stopAll, view, MAX_MIN };

// Crash reports — opt-in only. By default Fabro sends nothing and never asks. When the user turns on
// "Offer to send crash reports", problems are kept locally (userData/crashes) and, after one happens,
// Fabro offers to open a pre-filled GitHub issue that the user can read and edit before sending.
// No server, no background upload, no identifiers; home-folder paths are masked.
const { app, dialog, shell } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const store = require('./store');

const dir = () => path.join(app.getPath('userData'), 'crashes');
const enabled = () => !!((store.getSettings().telemetry || {}).crashReports);
const mask = (s) => String(s || '').split(os.homedir()).join('~').replace(/[A-Z]:\\Users\\[^\\\s]+/gi, '~').replace(/\/(home|Users)\/[^/\s]+/g, '~');

function record(kind, info = {}) {
  try {
    fs.mkdirSync(dir(), { recursive: true });
    const r = { at: new Date().toISOString(), kind, version: app.getVersion(), platform: `${process.platform} ${os.release()} ${process.arch}`, electron: process.versions.electron,
      reason: mask(info.reason || ''), message: mask(info.message || ''), stack: mask(info.stack || '').slice(0, 6000), extra: info.extra || undefined, sent: false };
    const f = path.join(dir(), `${Date.now()}-${kind}.json`);
    fs.writeFileSync(f, JSON.stringify(r, null, 2));
    // keep the 30 newest
    const all = fs.readdirSync(dir()).filter((x) => x.endsWith('.json')).sort();
    for (const old of all.slice(0, Math.max(0, all.length - 30))) fs.rmSync(path.join(dir(), old), { force: true });
    return f;
  } catch { return null; }
}
function list() {
  try { return fs.readdirSync(dir()).filter((x) => x.endsWith('.json')).sort().reverse().map((f) => ({ file: f, ...JSON.parse(fs.readFileSync(path.join(dir(), f), 'utf8')) })); } catch { return []; }
}
function issueUrl(r) {
  const body = [
    '**What happened** (optional — what were you doing?)', '', '', '---',
    `- Version: ${r.version} · ${r.platform} · Electron ${r.electron}`, `- When: ${r.at}`, `- Kind: ${r.kind}${r.reason ? ` (${r.reason})` : ''}`, '',
    r.message ? '```\n' + r.message + '\n' + (r.stack || '').slice(0, 3500) + '\n```' : '',
  ].join('\n');
  return `https://github.com/lulualdn/fabro-ai/issues/new?labels=crash&title=${encodeURIComponent(`Crash: ${(r.message || r.reason || r.kind).slice(0, 80)}`)}&body=${encodeURIComponent(body.slice(0, 6000))}`;
}
async function offer(win, r) {
  if (!enabled() || !r) return;
  const fr = /^fr/.test(app.getLocale());
  const res = await dialog.showMessageBox(win || undefined, {
    type: 'warning', buttons: fr ? ['Voir et envoyer le rapport', 'Pas maintenant'] : ['Review and send report', 'Not now'], defaultId: 0, cancelId: 1,
    title: 'Fabro', message: fr ? 'Fabro a rencontré un problème' : 'Fabro ran into a problem',
    detail: fr ? 'Le rapport s’ouvre sur GitHub : vous pouvez le lire et le modifier avant de l’envoyer. Rien n’est envoyé automatiquement.' : 'The report opens on GitHub: you can read and edit it before sending. Nothing is sent automatically.',
  });
  if (res.response === 0) shell.openExternal(issueUrl(r));
}
// Install handlers. Problems are always written locally only if the user opted in.
function init(getWin) {
  process.on('uncaughtException', (e) => { console.error(e); if (enabled()) { record('main-exception', { message: e.message, stack: e.stack }); offer(getWin(), list()[0]); } });
  process.on('unhandledRejection', (e) => { console.error(e); if (enabled()) record('main-rejection', { message: e && e.message, stack: e && e.stack }); });
  app.on('render-process-gone', (_e, _wc, d) => { if (enabled() && d.reason !== 'clean-exit') { record('renderer-gone', { reason: d.reason, extra: { exitCode: d.exitCode } }); setTimeout(() => offer(getWin(), list()[0]), 1500); } });
  app.on('child-process-gone', (_e, d) => { if (enabled() && !['clean-exit', 'killed'].includes(d.reason)) record('child-gone', { reason: `${d.type}: ${d.reason}`, extra: { name: d.name, exitCode: d.exitCode } }); });
}

module.exports = { init, record, list, issueUrl, enabled, dir };

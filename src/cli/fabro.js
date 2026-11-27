#!/usr/bin/env node
// `fabro code`: Fabro Code in a terminal, in the current folder. Same engine, sessions and permissions as the app:
// this talks to the running Fabro (src/main/cli-bridge.js) and starts it in the background when needed.
// Runs as Node through Fabro's own executable (ELECTRON_RUN_AS_NODE), so nothing else needs installing.
//   fabro code [folder]          interactive session
//   fabro code -p "question"     one answer, then exit
//   fabro code --resume          continue the last session of this folder
// Colors: ANSI (24-bit when the terminal says so); none with NO_COLOR or when not a terminal.
'use strict';
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const Mascot = require('../shared/mascot.js');

const args = process.argv.slice(2);
const TTY = process.stdout.isTTY; const COLOR = TTY && !process.env.NO_COLOR && process.env.TERM !== 'dumb';
const TRUE = COLOR && /truecolor|24bit/i.test(process.env.COLORTERM || '') || process.env.WT_SESSION;
const c = (code) => (s) => (COLOR ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const dim = c('2'), bold = c('1'), red = c('31'), green = c('32'), orange = (s) => (COLOR ? `\x1b[38;5;209m${s}\x1b[0m` : s);
const out = (s = '') => process.stdout.write(s + '\n');

function home() {
  if (process.env.FABRO_HOME) return process.env.FABRO_HOME;
  if (process.platform === 'win32') return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Fabro');
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'Fabro');
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'Fabro');
}
const bridge = () => { try { return JSON.parse(fs.readFileSync(path.join(home(), 'cli.json'), 'utf8')); } catch { return null; } };
function request(b, method, p, data, onEvent) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: b.port, method, path: p, headers: { 'x-fabro-token': b.token, 'content-type': 'application/json' } }, (res) => {
      if (!onEvent) { let s = ''; res.on('data', (x) => { s += x; }); res.on('end', () => { try { const j = JSON.parse(s || '{}'); res.statusCode >= 400 ? reject(new Error(j.error || res.statusCode)) : resolve(j); } catch (e) { reject(e); } }); return; }
      if (res.statusCode >= 400) { let s = ''; res.on('data', (x) => { s += x; }); res.on('end', () => { try { reject(new Error(JSON.parse(s).error)); } catch { reject(new Error(String(res.statusCode))); } }); return; }
      let buf = ''; res.on('data', (x) => { buf += x; let i; while ((i = buf.indexOf('\n\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 2); if (line.startsWith('data: ')) { try { onEvent(JSON.parse(line.slice(6))); } catch {} } } }); res.on('end', resolve);
    });
    req.on('error', reject); if (data) req.write(JSON.stringify(data)); req.end();
    if (onEvent) request.current = req;
  });
}
async function connect() {
  let b = bridge();
  if (b) { try { await request(b, 'GET', '/info'); return b; } catch {} }
  // Fabro isn't running: start it in the background and wait for the bridge
  const { spawn } = require('child_process');
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const packaged = __dirname.includes('app.asar');
  const appDir = path.join(__dirname, '..', '..');
  const child = spawn(process.execPath, packaged ? ['--hidden'] : [appDir, '--hidden'], { detached: true, stdio: 'ignore', env });
  child.unref();
  process.stdout.write(dim('Démarrage de Fabro…'));
  for (let i = 0; i < 60; i++) { await new Promise((r) => setTimeout(r, 500)); b = bridge(); if (b) { try { await request(b, 'GET', '/info'); process.stdout.write('\r\x1b[K'); return b; } catch {} } }
  throw new Error('Fabro did not start. Open it once, then try again.');
}

const STATE_OF = (name) => /write|edit|apply|patch|run_command|run_test|git|lint|checkpoint/.test(name) ? 'code' : /search|read_page|research|fetch|find/.test(name) ? 'search' : 'thinking';
function header(info, root, L) {
  const pic = Mascot.ansi('idle', 0, { color: COLOR, truecolor: TRUE, reduce: true });
  const lines = [bold('Fabro Code'), dim(root.replace(os.homedir(), '~')), dim(info.model ? info.model : L === 'fr' ? 'aucun modèle choisi' : 'no model chosen'), '', dim(L === 'fr' ? 'Entrée pour envoyer · /aide' : 'Enter to send · /help')];
  pic.forEach((p, i) => out(`  ${p}   ${lines[i - 1] || ''}`));
}
const HELP = { fr: '/nouveau  nouvelle session · /sessions  sessions de ce dossier · /quitter  sortir · Ctrl C  arrêter la réponse', en: '/new  new session · /sessions  sessions of this folder · /quit  leave · Ctrl C  stop the answer' };

async function main() {
  if (args[0] !== 'code' || args.includes('--help') || args.includes('-h')) {
    out(`${bold('fabro code')} [dossier] [-p "demande"] [--resume]\n  Fabro Code dans ce terminal : mêmes sessions et autorisations que l'app.`);
    process.exit(args[0] === 'code' ? 0 : 1);
  }
  const pi = args.indexOf('-p'); const once = pi > 0 ? args[pi + 1] : null;
  const folderArg = args.slice(1).find((a, i) => !a.startsWith('-') && args[i] !== '-p');
  const root = path.resolve(folderArg || process.cwd());
  let b; try { b = await connect(); } catch (e) { out(red(e.message)); process.exit(1); }
  const info = await request(b, 'GET', '/info');
  const L = info.lang === 'fr' ? 'fr' : 'en'; const reduce = !!info.reduceMotion || !!process.env.FABRO_REDUCE_MOTION;
  const T = (fr, en) => (L === 'fr' ? fr : en);
  let convId = null;
  if (args.includes('--resume')) { const s = await request(b, 'GET', '/sessions?root=' + encodeURIComponent(root)).catch(() => []); if (s[0]) convId = s[0].id; }
  if (!once) header(info, root, L);

  let running = null;
  async function ask(text) {
    let state = 'thinking'; let spin = null; let started = false; let t0 = Date.now(); let reqId = '';
    const status = () => { if (!TTY) return; const lbl = Mascot.LABEL[L][state]; const frames = reduce ? ['●'] : ['◐', '◓', '◑', '◒']; process.stdout.write(`\r\x1b[K${orange(frames[Math.floor((Date.now() - t0) / 150) % frames.length])} ${dim(lbl + '…')}`); };
    const clear = () => { if (TTY) process.stdout.write('\r\x1b[K'); };
    spin = TTY ? setInterval(status, reduce ? 1000 : 150) : null; status();
    running = { stop: () => reqId && request(b, 'POST', '/abort', { reqId }).catch(() => {}) };
    let inText = false;
    try {
      await request(b, 'POST', '/run', { root, text, convId, lang: L }, async (ev) => {
        if (ev.type === 'start') { reqId = ev.reqId; convId = ev.convId; return; }
        if (ev.type === 'token') { if (!started) { clear(); clearInterval(spin); spin = null; out(''); started = true; } inText = true; process.stdout.write(ev.text); return; }
        if (ev.type === 'tool_start' && !ev.parent) {
          if (inText) { out(''); inText = false; } else clear();
          const a = ev.args || {}; const arg = a.path || a.command || a.query || a.url || '';
          out(dim(`  · ${ev.name}${arg ? ' ' + String(arg).slice(0, 90) : ''}`));
          state = STATE_OF(ev.name); started = false; if (!spin && TTY) spin = setInterval(status, reduce ? 1000 : 150);
          return;
        }
        if (ev.type === 'tool_end' && ev.error) { clear(); out(red(`    ${String(ev.error).split('\n')[0].slice(0, 160)}`)); return; }
        if (ev.type === 'permission' || ev.type === 'deps_needed') {
          clearInterval(spin); spin = null; clear(); if (inText) { out(''); inText = false; }
          state = 'waiting';
          const q = ev.type === 'permission' ? `${T('Fabro veut', 'Fabro wants to')} : ${ev.summary || ev.tool}` : T(`Fabro a besoin d'installer ${ev.dep}`, `Fabro needs to install ${ev.dep}`);
          const ans = await new Promise((r) => rl.question(`  ${orange('?')} ${q}  ${dim(T('[o] oui  [t] toujours  [n] non', '[y] yes  [a] always  [n] no'))} `, r));
          const k = String(ans).trim().toLowerCase()[0];
          const v = ev.type === 'deps_needed' ? /[oy]/.test(k || '') : k === 't' || k === 'a' ? 'always' : /[oy]/.test(k || '') ? 'once' : 'deny';
          await request(b, 'POST', '/answer', { reqId, id: ev.id, value: v }).catch(() => {});
          state = 'thinking'; if (TTY) spin = setInterval(status, reduce ? 1000 : 150);
          return;
        }
        if (ev.type === 'done') { clearInterval(spin); clear(); if (inText) out(''); out(green(`✓ ${Mascot.LABEL[L].success}`) + dim(` · ${Math.round((Date.now() - t0) / 1000)} s`)); }
        if (ev.type === 'error') { clearInterval(spin); clear(); if (inText) out(''); out(red(`! ${ev.message}`)); }
      });
    } catch (e) { clearInterval(spin); clear(); out(red(`! ${e.message}`)); }
    clearInterval(spin); running = null;
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: orange('› ') });
  rl.on('SIGINT', () => { if (running) { running.stop(); out(dim(T('\n(arrêté)', '\n(stopped)'))); } else { rl.close(); } });
  rl.on('close', () => { out(''); process.exit(0); });
  if (once) { await ask(once); process.exit(0); }
  rl.prompt();
  rl.on('line', async (line) => {
    const v = line.trim(); if (!v) return rl.prompt();
    if (/^\/(quit|quitter|exit)$/.test(v)) return rl.close();
    if (/^\/(help|aide)$/.test(v)) { out(dim(HELP[L])); return rl.prompt(); }
    if (/^\/(new|nouveau)$/.test(v)) { convId = null; out(dim(T('Nouvelle session.', 'New session.'))); return rl.prompt(); }
    if (/^\/sessions$/.test(v)) { const s = await request(b, 'GET', '/sessions?root=' + encodeURIComponent(root)).catch(() => []); s.forEach((x, i) => out(`  ${i + 1}. ${x.title || '…'}`)); out(dim(T('Reprendre : fabro code --resume', 'Resume: fabro code --resume'))); return rl.prompt(); }
    rl.pause(); await ask(v); rl.resume(); rl.prompt();
  });
}
main().catch((e) => { out(red(String(e.message || e))); process.exit(1); });

// A small app for the Computer Use tests, run as its own process (Fabro never acts on its own windows).
// Every event it receives is written to the log file given as the first argument.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const logFile = process.argv.find((a) => a.endsWith('.json'));
app.on('window-all-closed', () => app.quit());

const PAGE = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Appli de test</title><style>
body{margin:0;font:20px "Segoe UI",Arial;background:#fff;color:#111}
#go{position:absolute;left:40px;top:30px;width:200px;height:60px;font:bold 26px Arial;background:#1565c0;color:#fff;border:0;border-radius:8px}
#count{position:absolute;left:270px;top:46px}
#field{position:absolute;left:40px;top:120px;width:480px;height:40px;font-size:20px}
#pad{position:absolute;left:40px;top:190px;width:480px;height:200px;border:2px solid #333}
#list{position:absolute;left:580px;top:30px;width:200px;height:180px;overflow:auto;border:1px solid #999}
#list div{height:36px;line-height:36px;padding-left:8px}
</style></head><body>
<button id="go">VALIDER</button><div id="count">Clics : 0</div>
<input id="field" aria-label="Champ de test">
<canvas id="pad" width="480" height="200" role="img" aria-label="Zone de dessin"></canvas>
<div id="list" role="list" aria-label="Liste">${Array.from({ length: 30 }, (_, i) => `<div role="listitem">Ligne ${i + 1}</div>`).join('')}</div>
<script>
const LOG = { clicks: 0, keys: [], drag: null, value: '', scroll: 0 };
const save = () => { LOG.value = field.value; LOG.scroll = list.scrollTop; console.log('CULOG ' + JSON.stringify(LOG)); };
go.onclick = () => { LOG.clicks++; count.textContent = 'Clics : ' + LOG.clicks; save(); };
field.oninput = save; list.onscroll = save;
addEventListener('keydown', (e) => { LOG.keys.push((e.ctrlKey ? 'ctrl+' : '') + (e.shiftKey ? 'shift+' : '') + e.key); save(); });
const g = pad.getContext('2d'); g.lineWidth = 3; let down = null;
pad.onmousedown = (e) => { down = { x: e.offsetX, y: e.offsetY, moves: 0 }; g.beginPath(); g.moveTo(e.offsetX, e.offsetY); };
pad.onmousemove = (e) => { if (down) { down.moves++; g.lineTo(e.offsetX, e.offsetY); g.stroke(); } };
pad.onmouseup = (e) => { if (down) LOG.drag = { from: [down.x, down.y], to: [e.offsetX, e.offsetY], moves: down.moves }; down = null; save(); };
</script></body></html>`;

app.whenReady().then(async () => {
  const w = new BrowserWindow({ x: 120, y: 80, width: 860, height: 480, title: 'Appli de test', autoHideMenuBar: true, webPreferences: { sandbox: true } });
  w.webContents.on('page-title-updated', (e) => e.preventDefault());
  w.webContents.on('console-message', (...a) => { const msg = typeof a[0] === 'object' && a[0].message != null ? a[0].message : a[2]; if (String(msg).startsWith('CULOG ')) fs.writeFileSync(logFile, String(msg).slice(6)); });
  await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(PAGE));
  await w.webContents.executeJavaScript('save()');
  w.focus();
});

// Fabro Overlay page ↔ main. Nothing else is exposed to the page.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('ov', {
  on: (fn) => ipcRenderer.on('overlay:ev', (e, d) => fn(d)),
  ready: () => ipcRenderer.send('overlay:ready'),
  hover: (on) => ipcRenderer.send('overlay:hover', !!on),
  close: () => ipcRenderer.send('overlay:close'),
  remove: (id) => ipcRenderer.send('overlay:remove', String(id)),
  move: (id, x, y) => ipcRenderer.send('overlay:move', String(id), Math.round(x), Math.round(y)),
  ask: (id, text) => ipcRenderer.invoke('overlay:ask', String(id), String(text).slice(0, 4000)),
});

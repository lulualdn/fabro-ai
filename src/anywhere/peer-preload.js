// Bridge for the hidden Anywhere window: only the calls it needs.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('host', {
  boot: () => ipcRenderer.invoke('aw:boot'),
  paired: (device) => ipcRenderer.invoke('aw:paired', device),
  relays: (status) => ipcRenderer.invoke('aw:relays', status),
  state: (deviceId, state) => ipcRenderer.invoke('aw:state', { deviceId, state }),
  message: (deviceId, msg) => ipcRenderer.invoke('aw:msg', { deviceId, msg }),
  onCommand: (fn) => ipcRenderer.on('aw:cmd', (_e, cmd) => fn(cmd)),
});

const { contextBridge, ipcRenderer } = require('electron');

const i = (ch) => (...a) => ipcRenderer.invoke(ch, ...a);

contextBridge.exposeInMainWorld('api', {
  info: i('app:info'),
  settings: { get: i('settings:get'), set: i('settings:set') },
  system: { specs: i('system:specs') },
  conv: { list: i('conv:list'), get: i('conv:get'), save: i('conv:save'), delete: i('conv:delete'), patch: i('conv:patch') },
  models: {
    catalog: i('models:catalog'), installed: i('models:installed'), search: i('models:search'),
    files: i('models:files'), download: i('models:download'), cancel: i('models:cancel'), delete: i('models:delete'),
  },
  engine: { status: i('engine:status'), update: i('engine:update'), reinstall: i('engine:reinstall'), stop: i('engine:stop') },
  chat: { send: i('chat:send'), abort: i('chat:abort') },
  updater: { check: i('updater:check'), install: i('updater:install') },
  modes: { install: i('modes:install') },
  shell: { open: i('shell:open') },
  win: { theme: i('window:theme'), buttons: i('window:buttons'), devtools: i('window:devtools') },
  on: (channel, cb) => {
    const allowed = ['chat:event', 'engine:status', 'models:progress', 'updater:status'];
    if (!allowed.includes(channel)) return () => {};
    const fn = (_e, data) => cb(data);
    ipcRenderer.on(channel, fn);
    return () => ipcRenderer.removeListener(channel, fn);
  },
});

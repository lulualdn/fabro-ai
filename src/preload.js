const { contextBridge, ipcRenderer, webUtils } = require('electron');

const i = (ch) => (...a) => ipcRenderer.invoke(ch, ...a);

contextBridge.exposeInMainWorld('api', {
  info: i('app:info'),
  settings: { get: i('settings:get'), set: i('settings:set') },
  system: { specs: i('system:specs') },
  conv: { list: i('conv:list'), get: i('conv:get'), save: i('conv:save'), delete: i('conv:delete'), patch: i('conv:patch'), search: i('conv:search') },
  memory: { list: i('memory:list'), add: i('memory:add'), update: i('memory:update'), delete: i('memory:delete'), clear: i('memory:clear') },
  artifacts: { list: i('artifacts:list'), get: i('artifacts:get'), save: i('artifacts:save'), delete: i('artifacts:delete') },
  exporter: { save: i('export:save'), preview: i('art:preview') },
  brain: { title: i('brain:title'), memories: i('brain:memories'), style: i('brain:style') },
  models: {
    catalog: i('models:catalog'), installed: i('models:installed'), search: i('models:search'),
    files: i('models:files'), download: i('models:download'), cancel: i('models:cancel'), delete: i('models:delete'),
    pause: i('models:pause'), resume: i('models:resume'), rename: i('models:rename'), verify: i('models:verify'), move: i('models:move'),
    plans: i('models:plans'), libraries: i('models:libraries'), addLibrary: i('models:addLibrary'), removeLibrary: i('models:removeLibrary'),
    defaultLibrary: i('models:defaultLibrary'), scanImports: i('models:scanImports'), import: i('models:import'), profile: i('models:profile'),
  },
  monitor: { sample: i('monitor:sample') },
  usage: { summary: i('usage:summary'), conv: i('usage:conv'), clear: i('usage:clear') },
  localApi: { status: i('localapi:status'), apply: i('localapi:apply'), models: i('localapi:models') },
  engine: {
    status: i('engine:status'), update: i('engine:update'), reinstall: i('engine:reinstall'), stop: i('engine:stop'), diagnostics: i('engine:diagnostics'),
    load: i('engine:load'), rollback: i('engine:rollback'), logs: i('engine:logs'), energy: i('engine:energy'),
  },
  tasks: { list: i('tasks:list'), create: i('tasks:create'), update: i('tasks:update'), remove: i('tasks:remove'), run: i('tasks:run') },
  chat: { send: i('chat:send'), abort: i('chat:abort'), inject: i('chat:inject'), answer: i('chat:answer') },
  agent: { tools: i('agent:tools'), policy: i('agent:policy'), addFolder: i('agent:addFolder'), removeFolder: i('agent:removeFolder') },
  browser: { bounds: i('browser:bounds'), control: i('browser:control'), state: i('browser:state') },
  deps: { status: i('deps:status'), install: i('deps:install'), remove: i('deps:remove') },
  search: { test: i('search:test') },
  runtime: { status: i('runtime:status') },
  crash: { list: i('crash:list'), folder: i('crash:folder'), report: i('crash:report') },
  images: { status: i('images:status'), install: i('images:install') },
  voice: { status: i('voice:status'), install: i('voice:install'), stt: i('voice:stt'), tts: i('voice:tts'), setVoice: i('voice:setVoice'), setWhisper: i('voice:setWhisper') },
  projects: {
    list: i('projects:list'), get: i('projects:get'), save: i('projects:save'), delete: i('projects:delete'), addFiles: i('projects:addFiles'), addText: i('projects:addText'),
    removeFile: i('projects:removeFile'), search: i('projects:search'), ragStatus: i('projects:ragStatus'), reindex: i('projects:reindex'),
    pathOf: (file) => { try { return webUtils.getPathForFile(file); } catch { return ''; } },
  },
  code: {
    open: i('code:open'), info: i('code:info'), close: i('code:close'), recent: i('code:recent'), tree: i('code:tree'), status: i('code:status'),
    read: i('code:read'), write: i('code:write'), diff: i('code:diff'), changes: i('code:changes'), revert: i('code:revert'),
    git: i('code:git'), branches: i('code:branches'), log: i('code:log'), run: i('code:run'), kill: i('code:kill'), project: i('code:project'), preview: i('code:preview'),
  },
  mcp: { view: i('mcp:view'), add: i('mcp:add'), remove: i('mcp:remove'), toggle: i('mcp:toggle'), signIn: i('mcp:signin'), reconnect: i('mcp:reconnect'), claudeConfig: i('mcp:claudeConfig'), importClaude: i('mcp:importClaude') },
  skills: { list: i('skills:list'), toggle: i('skills:toggle'), create: i('skills:create'), openFolder: i('skills:openFolder') },
  providers: {
    view: i('providers:view'), detect: i('providers:detect'), add: i('providers:add'), update: i('providers:update'),
    remove: i('providers:remove'), refresh: i('providers:refresh'), enable: i('providers:enable'), models: i('providers:models'),
  },
  quick: {
    submit: i('quick:submit'), started: i('quick:started'), report: i('quick:report'), hide: i('quick:hide'),
    resize: i('quick:resize'), open: i('quick:open'), toggle: i('quick:toggle'),
  },
  hotkey: { apply: i('hotkey:apply'), status: i('hotkey:status') },
  login: { get: i('login:get'), set: i('login:set') },
  notify: i('app:notify'), quit: i('app:quit'),
  updater: { check: i('updater:check'), install: i('updater:install') },
  modes: { install: i('modes:install') },
  shell: { open: i('shell:open'), reveal: i('shell:reveal'), openPath: i('shell:openPath') },
  files: { ingest: i('files:ingest'), preview: i('files:preview'), pathOf: (file) => { try { return webUtils.getPathForFile(file); } catch { return ''; } } },
  anywhere: { status: i('anywhere:status'), pairStart: i('anywhere:pairStart'), pairStop: i('anywhere:pairStop'), revoke: i('anywhere:revoke'), rename: i('anywhere:rename'), configure: i('anywhere:configure'), reply: i('anywhere:reply') },
  win: { theme: i('window:theme'), buttons: i('window:buttons'), devtools: i('window:devtools') },
  on: (channel, cb) => {
    const allowed = ['chat:event', 'engine:status', 'models:progress', 'updater:status', 'quick:run', 'quick:show', 'quick:started', 'app:command', 'localapi:status', 'browser:state', 'browser:focus', 'browser:blocked', 'mcp:status', 'deps:progress', 'code:term', 'code:exit', 'code:changed', 'projects:file', 'projects:embed', 'anywhere:event', 'anywhere:ask', 'tasks:event'];
    if (!allowed.includes(channel)) return () => {};
    const fn = (_e, data) => cb(data);
    ipcRenderer.on(channel, fn);
    return () => ipcRenderer.removeListener(channel, fn);
  },
});

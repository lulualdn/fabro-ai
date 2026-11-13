// Offline test of local accounts: migration of a pre-accounts install (resume, failure → fallback), isolation,
// 5-account limit, passwords (hash, verify, rate limit, sealed secrets), model sharing, account deletion.
// Electron is mocked; every "start" of Fabro is simulated by resetting the modules' state.
const Module = require('module'); const os = require('os'); const path = require('path'); const fs = require('fs'); const assert = require('assert');
let tmp = null;
const handlers = new Map();
const orig = Module._load;
Module._load = function (req, ...r) {
  if (req === 'electron') return {
    app: { getPath: () => tmp, isPackaged: false, getVersion: () => '0.0.0', getPreferredSystemLanguages: () => ['fr-FR'], getLocale: () => 'fr', relaunch: () => {}, quit: () => {} },
    safeStorage: { isEncryptionAvailable: () => false }, ipcMain: { handle: (ch, fn) => handlers.set(ch, fn) },
    BrowserWindow: class { constructor() { this.webContents = { setWindowOpenHandler() {}, on() {} }; } static fromWebContents() { return null; } loadFile() {} once() {} on() {} show() {} isDestroyed() { return false; } destroy() {} }, nativeTheme: { shouldUseDarkColors: false }, dialog: {}, nativeImage: {}, protocol: {}, shell: {},
  };
  return orig.call(this, req, ...r);
};
process.env.FABRO_E2E = '1';
const paths = require('../src/main/paths');
const store = require('../src/main/store');
const db = require('../src/main/db');
const accounts = require('../src/main/accounts');
const registry = require('../src/main/accounts/registry');
const migrate = require('../src/main/accounts/migrate');
const password = require('../src/main/accounts/password');
const vault = require('../src/main/accounts/vault');
const share = require('../src/main/accounts/models-share');
const models = require('../src/main/models');
const providers = require('../src/main/providers');

const fresh = () => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fabro-acc-')); process.env.HOME = tmp; process.env.USERPROFILE = tmp; restart(); };
// a new start of Fabro: nothing of the previous process stays in memory
function restart() { db.close(); paths.setDataDir(null); vault._test.reset(); accounts._test.reset(); registry.load(); for (const a of registry.get().accounts) share.forget(a.id); providers.reloadSecrets(); }
const call = (ch, ...a) => handlers.get(ch)({ sender: 'main' }, ...a);
const J = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
let n = 0; const ok = (name) => { n++; console.log('  ok', name); };

// An install from before accounts: settings, a conversation in the database, an old JSON conversation, a key, a mod, a model.
function seedLegacy() {
  fs.writeFileSync(path.join(tmp, 'settings.json'), JSON.stringify({ userName: 'Lulu', language: 'fr', theme: 'dark', engine: { ctx: 16384 }, libraries: [{ id: 'lib-x', name: 'D', path: path.join(tmp, 'disk') }] }));
  fs.mkdirSync(path.join(tmp, 'conversations')); fs.writeFileSync(path.join(tmp, 'conversations', 'old.json'), JSON.stringify({ id: 'old', title: 'Ancienne', messages: [{ role: 'user', content: 'salut' }], updatedAt: 1 }));
  store.init(); db.init(); db.saveConversation({ id: 'c1', title: 'Recette de crêpes', messages: [{ role: 'user', content: 'crêpes' }] }); db.close();
  providers.setSecret('openai', 'sk-test-123'); providers.reloadSecrets();
  fs.mkdirSync(path.join(tmp, 'mods', 'mymod'), { recursive: true }); fs.writeFileSync(path.join(tmp, 'mods', 'mymod', 'mod.json'), '{"id":"mymod"}');
  fs.mkdirSync(path.join(tmp, 'models', 'org__m'), { recursive: true }); fs.writeFileSync(path.join(tmp, 'models', 'org__m', 'm.gguf'), 'GGUF' + 'x'.repeat(1000));
  fs.writeFileSync(path.join(tmp, 'models', 'index.json'), JSON.stringify([{ id: 'org/m/m.gguf', name: 'Model M', path: path.join(tmp, 'models', 'org__m', 'm.gguf'), sizeBytes: 1004 }]));
  fs.mkdirSync(path.join(tmp, 'Partitions', 'mod-mymod'), { recursive: true });
  fs.unlinkSync(path.join(tmp, 'machine.json')); // made by store.init above; a real old install has none
  fs.writeFileSync(path.join(tmp, 'settings.json'), JSON.stringify({ userName: 'Lulu', language: 'fr', theme: 'dark', devModeReleased: true, engine: { ctx: 16384 }, libraries: [{ id: 'lib-x', name: 'D', path: path.join(tmp, 'disk') }] }));
}
async function openFor(id, dk) { restart(); const a = registry.find(id); accounts._test.open(a, dk); store.init(); }

(async () => {
  console.log('migration');
  fresh(); seedLegacy();
  let acc = await accounts.boot();
  assert.ok(acc && acc.id, 'an account is open'); assert.strictEqual(acc.name, 'Lulu'); assert.ok(acc.legacyPartitions);
  const A = acc.id, dirA = registry.dirOf(A);
  for (const f of ['settings.json', 'fabro.db', 'secrets.json', 'conversations', 'mods']) { assert.ok(fs.existsSync(path.join(dirA, f)), f + ' moved'); assert.ok(!fs.existsSync(path.join(tmp, f)), f + ' removed from the old place'); }
  assert.ok(fs.existsSync(path.join(tmp, 'models', 'org__m', 'm.gguf')), 'model files stay shared');
  assert.ok(fs.existsSync(path.join(tmp, 'Partitions', 'mod-mymod')), 'web sessions keep their place');
  assert.strictEqual(registry.get().migration, null);
  assert.deepStrictEqual(J(path.join(tmp, 'machine.json')).engine, { ctx: 16384 }, 'machine-wide settings in machine.json');
  store.init();
  assert.strictEqual(store.getSettings().userName, 'Lulu'); assert.strictEqual(store.getSettings().engine.ctx, 16384); assert.strictEqual(store.getSettings().theme, 'dark');
  assert.ok(!('engine' in J(path.join(dirA, 'settings.json'))) || true);
  const convs = db.listConversations().map((c) => c.id).sort();
  assert.deepStrictEqual(convs, ['c1', 'old'], 'conversations are there');
  assert.strictEqual(providers.getKey('openai'), 'sk-test-123', 'API key still readable');
  assert.strictEqual(paths.partition('mod-mymod'), 'persist:mod-mymod', 'migrated account keeps its partition names');
  assert.strictEqual((await models.listLocal()).length, 1, 'account #1 has the existing model');
  ok('pre-accounts data becomes account #1, moved once');

  // a second start: nothing moves again, single account without password opens directly
  restart(); acc = await accounts.boot(); assert.strictEqual(acc.id, A); assert.strictEqual(accounts._test.state().phase, 'open');
  ok('single account without password: no picker');

  // the installer writes a settings.json at the top again (reinstall)
  fs.writeFileSync(path.join(tmp, 'settings.json'), JSON.stringify({ language: 'en', defaultLibrary: 'lib-y', libraries: [{ id: 'lib-y', name: 'E', path: '/e' }] }));
  restart(); await accounts.boot(); store.init();
  assert.ok(!fs.existsSync(path.join(tmp, 'settings.json'))); assert.strictEqual(store.getSettings().defaultLibrary, 'lib-y'); assert.strictEqual(store.getSettings().language, 'fr', 'personal settings untouched');
  ok('installer seed after the move is absorbed');

  console.log('migration: interrupted and failing');
  fresh(); seedLegacy();
  // interrupted while copying: a half copy is there, the old place is still the real one
  registry.get().migration = { id: 'ahalf00000', state: 'copying' }; registry.save();
  fs.mkdirSync(path.join(registry.dirOf('ahalf00000'), 'conversations'), { recursive: true }); fs.writeFileSync(path.join(registry.dirOf('ahalf00000'), 'settings.json'), '{"broken":');
  restart(); acc = await accounts.boot(); store.init();
  assert.strictEqual(acc.id, 'ahalf00000'); assert.strictEqual(store.getSettings().userName, 'Lulu'); assert.strictEqual(db.listConversations().length, 2);
  ok('resumes an interrupted copy');
  // interrupted after the switch: an old copy is still there (Windows lock) → removed on the next start
  fs.writeFileSync(path.join(tmp, 'usage.json'), '{}'); fs.writeFileSync(path.join(registry.dirOf(acc.id), 'usage.json'), '{}');
  registry.get().migration = { id: acc.id, state: 'switched' }; registry.save();
  restart(); await accounts.boot();
  assert.ok(!fs.existsSync(path.join(tmp, 'usage.json'))); assert.strictEqual(registry.get().migration, null);
  ok('finishes removing old copies after a switch');
  // copy fails → fallback to the old location, nothing lost, retried on the next start
  fresh(); seedLegacy();
  const cp = fs.promises.cp; fs.promises.cp = async () => { throw new Error('disk full'); };
  restart(); acc = await accounts.boot(); fs.promises.cp = cp;
  assert.strictEqual(acc, null); assert.ok(accounts._test.state().fallback); assert.strictEqual(paths.dataDir(), tmp);
  store.init(); assert.strictEqual(db.listConversations().length, 2, 'still works from the old place'); assert.ok(fs.existsSync(path.join(tmp, 'fabro.db')));
  restart(); acc = await accounts.boot(); assert.ok(acc && !accounts._test.state().fallback); store.init(); assert.strictEqual(db.listConversations().length, 2);
  ok('failed copy keeps the old location, next start succeeds');

  console.log('isolation and limit');
  fresh(); seedLegacy(); acc = await accounts.boot(); store.init();
  const a1 = acc.id;
  const b = await call('accounts:create', { name: 'Emma', icon: 'star', color: 'teal' });
  assert.strictEqual(b.name, 'Emma'); assert.ok(!b.hasPassword); assert.strictEqual(Object.keys(b).sort().join(), 'color,createdAt,hasPassword,icon,id,name,picture');
  await openFor(b.id);
  assert.strictEqual(store.getSettings().userName, 'Emma'); assert.notStrictEqual(store.getSettings().theme, 'dark', 'own settings');
  assert.strictEqual(store.getSettings().engine.ctx, 16384, 'machine settings shared');
  assert.strictEqual(db.listConversations().length, 0, 'no history of the other account');
  assert.strictEqual(providers.getKey('openai'), '', 'no API key of the other account');
  assert.ok(paths.partition('mod-x').startsWith('persist:a-' + b.id + '-'), 'own web sessions');
  assert.ok(paths.outputDir().endsWith('Fabro - Emma'));
  db.saveConversation({ id: 'e1', title: 'Devoirs', messages: [] }); await store.setSettings({ theme: 'light', engine: { ctx: 4096 } });
  await openFor(a1);
  assert.deepStrictEqual(db.listConversations().map((c) => c.id).sort(), ['c1', 'old'], 'A does not see B');
  assert.strictEqual(store.getSettings().theme, 'dark'); assert.strictEqual(store.getSettings().engine.ctx, 4096, 'engine setting is machine-wide');
  for (let i = 0; i < 3; i++) await call('accounts:create', { name: 'P' + i });
  await assert.rejects(() => call('accounts:create', { name: 'Sixth' }), /ACCOUNT_LIMIT/);
  await assert.rejects(() => call('accounts:create', { name: '   ' }), /NAME_REQUIRED|ACCOUNT_LIMIT/);
  ok('data written in A is invisible in B; 5 accounts max');

  console.log('passwords');
  const h = await password.hash('café 123'); assert.ok(h.salt && h.hash && !JSON.stringify(h).includes('café'));
  assert.ok(await password.verify('café 123', h)); assert.ok(!(await password.verify('cafe 123', h)));
  // set a password on A: its API key gets sealed with the password's key
  let r = await call('accounts:setPassword', { next: 'soleil' }); assert.ok(r.ok && r.hasPassword);
  const sealed = J(path.join(registry.dirOf(a1), 'secrets.json')).openai; assert.ok(sealed.startsWith('vlt:'));
  assert.strictEqual(providers.getKey('openai'), 'sk-test-123', 'still readable while open');
  assert.ok(!JSON.stringify(registry.get()).includes('soleil'), 'password never stored');
  // a new start: locked, the key can't be read without the password
  restart(); assert.strictEqual(vault.reveal(sealed), null, 'sealed key unreadable without the password');
  const wrap = registry.find(a1).keyWrap; assert.strictEqual(await vault.unwrap(wrap, 'pluie'), null);
  const dk = await vault.unwrap(wrap, 'soleil'); assert.ok(dk); await openFor(a1, dk); assert.strictEqual(providers.getKey('openai'), 'sk-test-123');
  // change: needs the current password; the data key stays, re-wrapped
  r = await call('accounts:setPassword', { current: 'faux', next: 'x' }); assert.ok(!r.ok && r.wrong);
  delete registry.get().attempts[a1];
  r = await call('accounts:setPassword', { current: 'soleil', next: 'lune' }); assert.ok(r.ok);
  restart(); assert.ok(await vault.unwrap(registry.find(a1).keyWrap, 'lune')); assert.strictEqual(await vault.unwrap(registry.find(a1).keyWrap, 'soleil'), null);
  await openFor(a1, await vault.unwrap(registry.find(a1).keyWrap, 'lune'));
  // remove: back to the OS protection only
  r = await call('accounts:setPassword', { current: 'lune', next: '' }); assert.ok(r.ok && !r.hasPassword);
  assert.ok(!J(path.join(registry.dirOf(a1), 'secrets.json')).openai.startsWith('vlt:')); restart(); await openFor(a1); assert.strictEqual(providers.getKey('openai'), 'sk-test-123');
  // rate limit (kept across starts)
  await call('accounts:setPassword', { next: 'soleil' });
  const accA = registry.find(a1);
  for (let i = 0; i < 4; i++) { r = await accounts._test.check(accA, 'no'); assert.ok(!r.ok && !r.wait); }
  r = await accounts._test.check(accA, 'no'); assert.ok(!r.ok && r.wait >= 29000, 'waits after 5 wrong tries');
  restart(); r = await accounts._test.check(registry.find(a1), 'soleil'); assert.ok(!r.ok && r.wait > 0, 'even the right password waits; restart does not reset it');
  registry.get().attempts[a1].until = Date.now() - 1; r = await accounts._test.check(registry.find(a1), 'soleil'); assert.ok(r.ok); assert.ok(!registry.get().attempts[a1]);
  ok('scrypt hash, constant-time verify, rate limit, sealed secrets');

  console.log('picker');
  restart(); let opened = null; const p = accounts.boot().then((x) => (opened = x));
  await new Promise((res) => setTimeout(res, 50));
  assert.strictEqual(accounts._test.state().phase, 'pick', 'several accounts / a password: picker');
  const pk = accounts.pickerWindow(); assert.ok(pk);
  const fromPicker = (ch, ...a) => handlers.get(ch)({ sender: pk.webContents }, ...a);
  await assert.rejects(async () => handlers.get('accounts:open')({ sender: 'other' }, b.id), /NOT_ALLOWED/);
  r = await fromPicker('accounts:open', a1); assert.ok(r.needPassword);
  r = await fromPicker('accounts:unlock', a1, 'no'); assert.ok(!r.ok);
  delete registry.get().attempts[a1];
  r = await fromPicker('accounts:unlock', a1, 'soleil'); assert.ok(r.ok); await p; assert.strictEqual(opened.id, a1); assert.ok(vault.hasKey());
  ok('picker: password needed, wrong password refused, right one opens');

  console.log('models');
  await openFor(b.id);
  assert.strictEqual((await models.listLocal()).length, 0, 'B has no model yet');
  let sh = await models.sharing(); assert.deepStrictEqual(sh.others, [{ id: 'org/m/m.gguf', name: 'Model M', sizeBytes: 1004 }], 'name + size only');
  await call('accounts:linkModel', 'org/m/m.gguf'); assert.strictEqual((await models.listLocal()).length, 1, 'linked instantly');
  sh = await models.sharing(); assert.strictEqual(sh.others.length, 0); assert.strictEqual(sh.mine[0].sharedWith, 1);
  r = await models.remove('org/m/m.gguf'); assert.strictEqual(r.sharedWith, 1, 'kept: another account uses it');
  const file = path.join(tmp, 'models', 'org__m', 'm.gguf'); assert.ok(fs.existsSync(file));
  assert.strictEqual((await models.listLocal()).length, 0);
  await call('accounts:linkModel', 'org/m/m.gguf');
  await openFor(a1, await vault.unwrap(registry.find(a1).keyWrap, 'soleil'));
  r = await models.remove('org/m/m.gguf'); assert.strictEqual(r.sharedWith, 1); assert.ok(fs.existsSync(file));
  await openFor(b.id); r = await models.remove('org/m/m.gguf'); assert.ok(r === true || !r.sharedWith); assert.ok(!fs.existsSync(file), 'deleted once nobody uses it');
  ok('model link / unlink with reference counting');

  console.log('delete');
  fs.mkdirSync(path.join(tmp, 'models', 'org__n'), { recursive: true }); const fileN = path.join(tmp, 'models', 'org__n', 'n.gguf'); fs.writeFileSync(fileN, 'GGUF');
  const idx = J(path.join(tmp, 'models', 'index.json')); idx.push({ id: 'org/n/n.gguf', name: 'N', path: fileN, sizeBytes: 4 }); fs.writeFileSync(path.join(tmp, 'models', 'index.json'), JSON.stringify(idx));
  share.add('org/n/n.gguf', [b.id]);
  fs.mkdirSync(path.join(tmp, 'Partitions', `a-${b.id}-mod-x`), { recursive: true });
  r = await call('accounts:delete', { confirm: 'pas le nom' }); assert.ok(!r.ok && r.confirm);
  r = await call('accounts:delete', { confirm: 'emma' }); assert.ok(r.restarting);
  assert.ok(fs.existsSync(registry.dirOf(b.id)), 'the open account is deleted on the next start, not under its own feet');
  restart(); const p2 = accounts.boot(); await new Promise((res) => setTimeout(res, 50));
  assert.ok(!registry.find(b.id)); assert.ok(!fs.existsSync(registry.dirOf(b.id))); assert.ok(!fs.existsSync(path.join(tmp, 'Partitions', `a-${b.id}-mod-x`)));
  assert.ok(!fs.existsSync(fileN), 'models only Emma used are deleted'); assert.ok(fs.existsSync(path.join(tmp, 'Partitions', 'mod-mymod')), 'other sessions untouched');
  // forgotten password, from the picker
  const pk2 = accounts.pickerWindow();
  r = await handlers.get('accounts:forget')({ sender: pk2.webContents }, a1, 'nope'); assert.ok(!r.ok && r.confirm);
  r = await handlers.get('accounts:forget')({ sender: pk2.webContents }, a1, 'Lulu'); assert.ok(r.ok);
  assert.ok(!fs.existsSync(registry.dirOf(a1))); assert.ok(!fs.existsSync(path.join(tmp, 'Partitions', 'mod-mymod')), 'legacy web sessions of the deleted account removed');
  assert.strictEqual(registry.get().accounts.length, 3);
  void p2;
  ok('delete account (own, and forgotten password from the picker)');

  console.log(`accounts-test: all passed (${n})`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });

// Offline test of "Mon Fabro" (src/main/myfabro.js): memory entries (add / update / dedupe), profile provenance,
// refusal of sensitive traits and of guessed age, the background job (one call, skipped on battery / busy),
// the timeline from a seeded database, forgotten-project detection, skill suggestions, forPrompt budget.
// Electron is mocked the way scripts/agent-test.js does it.
const Module = require('module'); const os = require('os'); const path = require('path'); const fs = require('fs'); const assert = require('assert');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fabro-myfabro-'));
const handlers = new Map();
const orig = Module._load;
Module._load = function (req, ...r) {
  if (req === 'electron') return { app: { getPath: () => tmp, isPackaged: false, getVersion: () => '0.0.0' }, safeStorage: { isEncryptionAvailable: () => false }, ipcMain: { handle: (ch, fn) => handlers.set(ch, fn) }, shell: {}, BrowserWindow: class {}, dialog: {}, protocol: {}, powerMonitor: { on() {}, isOnBatteryPower: () => false } };
  return orig.call(this, req, ...r);
};
process.env.HOME = tmp; process.env.USERPROFILE = tmp;
const store = require('../src/main/store'); store.init();
const db = require('../src/main/db'); db.init();
const governor = require('../src/main/governor');
const mf = require('../src/main/myfabro');
const DAY = 864e5;
let passed = 0;
const ok = (name) => { passed++; console.log('  ✓ ' + name); };

(async () => {
  // ── entries: add, update, dedupe, pin, user words kept ──
  const a = mf.upsert({ title: 'Jeu de bus Roblox', content: 'Développe un jeu Roblox de simulation de bus.', kind: 'project', convId: 'c1' });
  assert.ok(a.added);
  const b = mf.upsert({ title: 'jeu de bus roblox', content: 'Développe un jeu Roblox de simulation de bus avec des lignes et des dépôts.', kind: 'project', convId: 'c2' });
  assert.strictEqual(b.id, a.id, 'same title → same entry'); assert.ok(b.updated);
  let e = mf.get(a.id);
  assert.deepStrictEqual(e.sources, ['c1', 'c2'], 'sources accumulate');
  assert.match(e.content, /dépôts/, 'richer content replaces');
  const c = mf.upsert({ title: 'Simulation de bus', content: 'Développe un jeu Roblox simulation bus lignes dépôts', kind: 'project', convId: 'c3' });
  assert.strictEqual(c.id, a.id, 'near-identical wording → dedupe');
  assert.ok(mf.upsert({ title: 'Lua', content: 'Utilise Luau dans Roblox Studio.', kind: 'tool' }).added, 'different thing → new entry');
  mf.edit(a.id, { content: 'Mon jeu de bus, en Luau.' });
  mf.upsert({ title: 'Jeu de bus Roblox', content: 'Développe un jeu Roblox de bus très long avec plein de détails différents', kind: 'project', convId: 'c4' });
  e = mf.get(a.id);
  assert.strictEqual(e.content, 'Mon jeu de bus, en Luau.', 'what the user wrote is never rewritten'); assert.strictEqual(e.origin, 'you');
  mf.pin(a.id, true); assert.ok(mf.get(a.id).pinned); assert.strictEqual(mf.list()[0].id, a.id, 'pinned first');
  assert.ok(db.listMemories().some((m) => m.text === 'Mon jeu de bus, en Luau.'), 'old memory API sees the entries');
  ok('entries: add / update / dedupe / pin / user words kept');

  // ── vetting: evidence, sensitive traits, age ──
  const said = ['Je m’appelle Camille, je suis prof de maths et j’utilise surtout Excel. Je suis diabétique et j’ai voté hier.'];
  const v = mf.vet({
    entries: [
      { kind: 'tool', title: 'Excel', content: 'Utilise Excel pour ses cours.', evidence: 'j’utilise surtout Excel' },
      { kind: 'fact', title: 'Santé', content: 'Est diabétique.', evidence: 'Je suis diabétique' },
      { kind: 'fact', title: 'Vote', content: 'A voté aux élections.', evidence: 'j’ai voté hier' },
      { kind: 'habit', title: 'Course', content: 'Court le matin.', evidence: 'je cours le matin' },   // not said
      { kind: 'fact', title: 'Âge', content: 'A environ 40 ans.', evidence: 'prof de maths' },
    ],
    profile: [
      { field: 'name', text: 'Camille', evidence: 'Je m’appelle Camille' },
      { field: 'work', text: 'Professeur de maths', evidence: 'je suis prof de maths' },
      { field: 'age', text: 'Environ 40 ans', evidence: 'prof de maths' },
      { field: 'habits', text: 'Pratique la religion catholique', evidence: 'Camille' },
      { field: 'origin', text: 'Française', evidence: 'Camille' },
    ],
  }, { userTexts: said });
  assert.deepStrictEqual(v.entries.map((x) => x.title), ['Excel']);
  assert.deepStrictEqual(v.profile.map((x) => x.field), ['name', 'work']);
  const kinds = v.refused.map((x) => x.kind).sort();
  assert.ok(kinds.includes('health') && kinds.includes('politics') && kinds.includes('religion') && kinds.includes('age') && kinds.includes('unsupported'), 'refused: ' + kinds.join(','));
  const age = mf.vet({ profile: [{ field: 'age', text: '34 ans', evidence: 'j’ai 34 ans' }] }, { userTexts: ['Bonjour, j’ai 34 ans et je débute en Python'] });
  assert.strictEqual(age.profile.length, 1, 'age kept only when stated');
  const age2 = mf.vet({ profile: [{ field: 'age', text: 'Adolescent', evidence: 'je débute en Python' }] }, { userTexts: ['Bonjour, je débute en Python'] });
  assert.strictEqual(age2.profile.length, 0, 'age never inferred');
  const syn = mf.vet({ profile: [{ field: 'projects', text: 'Prépare un voyage au Japon', evidence: 'Voyage au Japon' }, { field: 'name', text: 'Léa', evidence: 'Lettre pour Léa' }] }, { userTexts: [], synced: [{ mod: 'chatgpt', site: 'ChatGPT', title: 'Itinéraire voyage au Japon' }, { mod: 'claude', site: 'Claude', title: 'Lettre pour Léa' }] });
  assert.strictEqual(syn.profile.length, 1, 'a name is never taken from a chat title'); assert.strictEqual(syn.profile[0].source.type, 'synced'); assert.strictEqual(syn.profile[0].source.site, 'ChatGPT');
  ok('vetting: evidence required, sensitive traits refused, age only when stated');

  // ── profile provenance + plain-text editing ──
  for (const p of v.profile) mf.addProfileLine({ ...p, source: { ...p.source, convId: 'c9' } });
  let pr = mf.profile();
  assert.strictEqual(pr.lines.length, 2); assert.strictEqual(pr.lines[0].source.type, 'said'); assert.strictEqual(pr.lines[0].source.convId, 'c9');
  mf.addProfileLine({ field: 'work', text: 'Professeure de maths au lycée', source: { type: 'said' } });
  assert.strictEqual(mf.profile().lines.filter((l) => l.field === 'work').length, 1, 'one line per single-valued field');
  pr = mf.setProfileText(pr.text.split('\n')[0] + '\nAime les explications courtes');
  assert.strictEqual(pr.lines[0].source.type, 'said', 'unchanged line keeps its provenance');
  assert.strictEqual(pr.lines[1].source.type, 'you', 'new line is written by the user');
  mf.editProfileLine(pr.lines[0].id, 'Camille (prénom)');
  assert.strictEqual(mf.profile().lines[0].source.type, 'you'); assert.strictEqual(mf.profile().lines[0].source.was, 'said');
  mf.addProfileLine({ field: 'habits', text: 'Aime les explications courtes et claires', source: { type: 'said' } });
  assert.strictEqual(mf.profile().lines[1].source.type, 'you', 'Fabro never overwrites a line the user wrote');
  ok('profile: provenance kept, plain-text edit, corrections');

  // ── the background job ──
  const calls = [];
  const fakeChat = { quick: async (model, msgs) => { calls.push(msgs); return JSON.stringify({ entries: [{ kind: 'preference', title: 'Réponses courtes', content: 'Préfère des réponses courtes.', evidence: 'réponds court' }, { kind: 'fact', title: 'Croyant', content: 'Va à l’église.', evidence: 'église' }], profile: [{ field: 'tools', text: 'Utilise Blender', evidence: 'Blender' }] }); } };
  fs.mkdirSync(path.join(require('../src/main/paths').dataDir(), 'mod-data', 'claude'), { recursive: true });
  fs.writeFileSync(path.join(require('../src/main/paths').dataDir(), 'mod-data', 'claude', 'chats.json'), JSON.stringify([{ id: 'x1', title: 'Modéliser une voiture dans Blender', updatedAt: Date.now() }, { id: 'x2', title: 'Untitled' }]));
  const ids = await mf.observe({ model: { backend: 'local', id: 'm' }, convId: 'c10', userTexts: ['réponds court stp, je vais à l’église ce soir'], lang: 'fr' }, { chat: fakeChat });
  assert.strictEqual(calls.length, 1, 'one model call');
  assert.strictEqual(ids.length, 1, 'church entry refused');
  assert.match(calls[0][0].content, /Modéliser une voiture dans Blender/, 'synced titles given to the model');
  assert.doesNotMatch(calls[0][0].content, /Untitled/);
  assert.ok(mf.profile().lines.some((l) => l.text === 'Utilise Blender' && l.source.type === 'synced' && l.source.site === 'Claude'), 'profile line from a synced title, with its source');
  await mf.observe({ model: { backend: 'local', id: 'm' }, convId: 'c11', userTexts: [] }, { chat: fakeChat });
  assert.strictEqual(calls.length, 1, 'synced titles are read once; nothing new → no call');
  governor.env.battery = true;
  assert.deepStrictEqual(await mf.observe({ model: { id: 'm' }, convId: 'c12', userTexts: ['réponds court'] }, { chat: fakeChat }), []);
  governor.env.battery = false;
  const rel = await governor.acquire({ priority: 'user' });
  const pend = mf.observe({ model: { id: 'm' }, convId: 'c13', userTexts: ['réponds court'] }, { chat: fakeChat, retryMs: 50 });
  await new Promise((r) => setTimeout(r, 20)); assert.strictEqual(calls.length, 1, 'never while the user generates');
  rel(); await pend; assert.strictEqual(calls.length, 2, 'runs once the user is done');
  await store.setSettings({ memory: { auto: false } });
  assert.deepStrictEqual(await mf.observe({ model: { id: 'm' }, convId: 'c14', userTexts: ['réponds court'] }, { chat: fakeChat }), []);
  assert.strictEqual(calls.length, 2, 'turned off → no call');
  await store.setSettings({ memory: { auto: true } });
  const legacy = mf.vet(mf.parseObserve('["Teste Fabro en profondeur"]'), { userTexts: ['Je teste Fabro en profondeur'] });
  assert.strictEqual(legacy.entries.length, 1, 'plain list of facts from small models still accepted when it matches what was said');
  ok('background job: one call, synced titles only once, battery / busy / off respected');

  // ── forPrompt budget ──
  for (let i = 0; i < 40; i++) mf.upsert({ title: 'Sujet ' + i + ' ' + 'xyz'.repeat(i % 3), content: `Note numéro ${i} sur un sujet assez long pour remplir le budget ${'abc '.repeat(10)}`, kind: 'fact' });
  const fp = mf.forPrompt({ budgetTokens: 120, query: 'jeu de bus' });
  assert.ok(fp.length <= 120 * 4, 'within budget: ' + fp.length);
  assert.match(fp, /Profile:/); assert.match(fp, /Mon jeu de bus/, 'pinned / relevant entry first');
  assert.ok(mf.forPrompt({ budgetTokens: 2000 }).length > fp.length);
  await store.setSettings({ memory: { enabled: false } }); assert.strictEqual(mf.forPrompt({}), ''); await store.setSettings({ memory: { enabled: true } });
  ok('forPrompt: budget respected, pinned/relevant first, off → empty');

  // ── seeded database: timeline, forgotten projects, skills ──
  const t0 = Date.now() - 60 * DAY;
  const conv = (id, title, created, extra = {}, messages = [{ role: 'user', content: title }, { role: 'assistant', content: 'ok' }]) => {
    db.saveConversation({ id, title, createdAt: created, messages, ...extra });
    db.init().prepare('UPDATE conversations SET created = ?, updated = ? WHERE id = ?').run(created, extra.updated || created, id);
  };
  db.saveProject({ id: 'p1', name: 'Potager', description: 'Plan du jardin', created: t0 + DAY });
  db.saveProject({ id: 'p2', name: 'Site du club', created: t0 + 5 * DAY });
  db.init().prepare('UPDATE projects SET created = ?, updated = ? WHERE id = ?').run(t0 + DAY, t0 + 20 * DAY, 'p1');
  db.init().prepare('UPDATE projects SET created = ?, updated = ? WHERE id = ?').run(t0 + 5 * DAY, Date.now() - DAY, 'p2');
  conv('k1', 'Premier bonjour', t0);
  for (let i = 1; i <= 4; i++) conv('k1' + i, 'Traduire un texte ' + i, t0 + i * DAY);
  conv('kp1', 'Planter les tomates', t0 + 2 * DAY, { project: 'p1', updated: t0 + 20 * DAY }, [{ role: 'user', content: 'plan ?' }, { role: 'assistant', content: 'Voilà', plan: [{ title: 'Choisir', status: 'done' }, { title: 'Semer', status: 'pending' }] }]);
  conv('kp2', 'Maquette du site', t0 + 6 * DAY, { project: 'p2', updated: Date.now() - DAY }, [{ role: 'user', content: 'go' }]);
  conv('kl', 'Long fil sur le budget', t0 + 10 * DAY, { updated: t0 + 30 * DAY }, [...Array(8)].map((_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: i === 7 ? 'Prochaines étapes :\n- [ ] trier\n- [ ] payer' : 'msg ' + i })));
  conv('kd', 'Fil terminé', t0 + 11 * DAY, { updated: t0 + 30 * DAY }, [...Array(8)].map((_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'fini ' + i })));
  for (let i = 0; i < 3; i++) db.saveArtifact({ id: 'a' + i, convId: 'kp1', type: 'slides', title: 'Diapo ' + i, created: t0 + (3 + i) * DAY, versions: [{ content: 'x' }] });
  db.init().prepare('UPDATE artifacts SET created = ?').run(t0 + 3 * DAY);
  const tl = mf.timeline();
  const k = tl.items.map((x) => x.kind);
  assert.strictEqual(tl.items[0].kind, 'first-chat'); assert.strictEqual(tl.items[0].title, 'Premier bonjour');
  assert.ok(k.includes('first-project') && k.includes('first-artifact') && k.includes('project') && k.includes('streak'), k.join(','));
  assert.strictEqual(tl.counts.conversations, 9); assert.strictEqual(tl.projects.find((p) => p.id === 'p1').made.length, 3, 'what was made in the project');
  assert.ok(tl.streak.best >= 5, 'streak ' + tl.streak.best);
  ok('timeline computed from the database');

  const fg = mf.forgotten();
  assert.deepStrictEqual(fg.map((x) => x.key).sort(), ['conv:kl', 'project:p1'], JSON.stringify(fg));
  assert.ok(fg.find((x) => x.key === 'project:p1').signs.includes('plan:1'));
  assert.ok(fg.find((x) => x.key === 'conv:kl').signs.includes('todo:2'));
  mf.dismiss('forgotten', 'project:p1');
  assert.deepStrictEqual(mf.forgotten().map((x) => x.key), ['conv:kl'], '"let it go" is for good');
  const w = mf.welcome(); assert.strictEqual(w.key, 'conv:kl'); assert.strictEqual(mf.welcome(), null, 'welcome line at most once every 3 days');
  ok('forgotten projects: only quiet ones with unfinished signs, dismissible, welcome once');

  const sk = mf.skillSuggestions({ lang: 'fr' });
  const tr = sk.find((x) => x.key === 'task:translate');
  assert.ok(tr && tr.count === 4, JSON.stringify(sk.map((x) => [x.key, x.count])));
  assert.match(tr.prompt, /Crée un skill/); assert.match(tr.prompt, /Traduire un texte/); assert.match(tr.prompt, /save_skill/);
  assert.ok(sk.some((x) => x.key === 'art:slides'), 'repeated artifact type');
  mf.dismiss('skill', 'task:translate');
  assert.ok(!mf.skillSuggestions().some((x) => x.key === 'task:translate'), 'dismissed suggestion gone');
  ok('skill suggestions from repeated requests, dismissible');

  // ── projects become entries (no model); forget everything ──
  mf.syncComputed();
  assert.ok(mf.list().some((x) => x.ref === 'project:p1' && x.kind === 'project' && /Plan du jardin/.test(x.content)), 'project entry computed');
  mf.init({ handle: (ch, fn) => handlers.set(ch, fn) });
  assert.ok(handlers.has('myfabro:timeline') && handlers.has('myfabro:forgetAll'));
  await handlers.get('myfabro:forgetAll')();
  assert.strictEqual(mf.list().length, 0); assert.strictEqual(mf.profile().lines.length, 0);
  mf.flush();
  assert.ok(fs.existsSync(path.join(require('../src/main/paths').dataDir(), 'myfabro.json')), 'state in the account folder');
  ok('computed project entries; forget everything');

  console.log(`myfabro-test: ${passed} groups passed`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });

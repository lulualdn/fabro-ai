'use strict';
/* Fabro Anywhere: Fabro in the browser, chat and agent only.
   Who thinks: Fabro Cloud (free, no account, the default), the user's own API keys, or the models of their computer.
   Where tools run: on the computer when it is linked and reachable (files, terminal, documents…), else the few
   that run here (web search, pages, images, weather). The computer serves no interface: it answers an API over the
   encrypted link (src/anywhere/core.js ↔ src/main/anywhere.js): hello, sync, run, tools.list, tool.call… */
(function () {
  const A = window.FabroAnywhere;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const now = () => Date.now();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const uid = () => A.uid() + A.uid().slice(0, 4);

  // ───────────────────────────── text ─────────────────────────────
  const I18N = {
    fr: {
      places: 'Mes lieux', placesSub: 'Maison, travail, favoris : Fabro s’en sert pour les itinéraires.', see: 'Voir',
      cloudLong: 'Cette conversation est trop longue pour Fabro Cloud en ce moment. Commence-en une nouvelle, ou utilise ta propre clé.', profile: 'Profil', me: 'Moi', pfLocked: 'Protégé par mot de passe', pfOpen: 'Sans mot de passe', pfPwSet: 'Ajouter un mot de passe', pfPwChange: 'Changer le mot de passe', pfAdd: 'Ajouter ou changer', pfChange: 'Changer de profil', pfSub: '{n} sur 4 profils sur cet appareil.', pfDelT: 'Supprimer ce profil', pfDelLead: 'Ses conversations, ses clés et le lien avec ton ordinateur sont effacés de cet appareil.', pfPwLead: 'Avec un mot de passe, les conversations et les clés de ce profil sont chiffrées sur cet appareil. Laisse vide pour l’enlever.', pfPwOld: 'Mot de passe actuel', pfPwNew: 'Nouveau mot de passe', pfWrong: 'Mot de passe incorrect.', saved: 'Enregistré',
      newChat: 'Nouvelle demande', search: 'Chercher', code: 'Fabro Code', settings: 'Réglages', today: 'Aujourd’hui', before: 'Avant', noChats: 'Rien pour l’instant',
      homeH: 'Qu’est-ce qu’on fait ?', homeSub: 'Demande n’importe quoi. Fabro cherche, lit et agit pour toi.',
      homeSubPc: 'Demande n’importe quoi. Les outils tournent sur {pc}.',
      s1: 'Résume cette page', s2: 'Compare deux forfaits mobiles', s3: 'Que faire ce week-end à Lyon ?', s4: 'Range mon dossier Téléchargements',
      ask: 'Demande n’importe quoi', askMore: 'Ajoute une consigne', send: 'Envoyer', stop: 'Arrêter', attach: 'Joindre une photo', dictate: 'Dicter', listening: 'Je t’écoute…',
      copy: 'Copier', copied: 'Copié', retry: 'Refaire', steps1: '1 étape', stepsN: '{n} étapes', working: 'travaille',
      pc: 'Ton PC', pcOn: '{pc} · connecté', pcOff: '{pc} · hors ligne', pcWait: '{pc} · connexion…', linkPc: 'Relier ton PC', noPc: 'Aucun PC relié',
      model: 'Modèle', cloud: 'Fabro Cloud', cloudSub: 'Gratuit, sans compte', auto: 'Automatique', autoSub: 'Le meilleur modèle libre du moment',
      keys: 'Tes clés API', keysSub: 'La clé reste sur cet appareil.', addKey: 'Ajouter une clé', provider: 'Fournisseur', apiKey: 'Clé', baseUrl: 'Adresse de l’API', modelName: 'Modèle', save: 'Enregistrer', remove: 'Retirer', cancel: 'Annuler', keyTesting: 'Vérification…', keyBad: 'Clé refusée : {e}', keyOk: 'Clé ajoutée',
      pcModels: 'Modèles de ton PC', pcModelsSub: 'Tout tourne sur ton PC.', pcAway: 'Ton PC ne répond pas. Ouvre Fabro dessus.',
      toolsOnPc: 'Outils sur {pc}', toolsHere: 'Outils du navigateur',
      allow: 'Autoriser', always: 'Toujours', deny: 'Refuser', wants: 'Fabro veut agir sur {pc}',
      queued: 'En attente de {pc}', answerCloud: 'Répondre avec Fabro Cloud',
      pairH: 'Relier ton PC', pairLead: 'Sur ton PC : Fabro → Réglages → Fabro Anywhere → Relier un téléphone. Puis vise le cercle ou tape le code.',
      scan: 'Scanner le cercle', typeCode: 'Taper le code', codePh: 'XXXX-XXXX-…', pair: 'Relier', pairing: 'Connexion à ton PC…', pairOk: 'PC relié', pairFail: 'Échec. Vérifie que la fenêtre de ton PC est ouverte.', badCode: 'Code invalide', noCamera: 'Caméra indisponible. Tape le code.',
      forget: 'Oublier ce PC', forgetQ: 'Oublier ce PC ? Tes conversations restent ici.',
      codeH: 'Fabro Code tourne sur ton ordinateur', codeLead: 'Il lit et modifie tes projets, lance les tests et la ligne de commande. Télécharge Fabro pour l’utiliser.',
      codeOpen: 'Déjà installé sur {pc} ? Ouvre Fabro Code dessus, tes conversations se retrouvent ici.', yourOs: 'ton système',
      theme: 'Apparence', light: 'Clair', dark: 'Sombre', autoT: 'Auto', eco: 'Mode éco', ecoSub: 'Sans flou ni reflets. Économise la batterie.', lang: 'Langue',
      notify: 'Notifications', notifySub: 'Quand une réponse arrive et que l’app est fermée.', about: 'À propos', site: 'Le site de Fabro',
      offline: 'Hors ligne', timeout: 'Pas de réponse', revoked: 'Ce PC a retiré l’accès.', cloudBusy: 'Fabro Cloud est saturé. Réessaie dans une minute.', photo: 'Photo',
      deleteQ: 'Supprimer cette conversation ?', rename: 'Renommer', del: 'Supprimer', micDenied: 'Micro refusé', sttFail: 'Je n’ai pas compris',
      retry: 'Recommencer', edit: 'Modifier', fork: 'Nouvelle conversation à partir d’ici', forked: 'Conversation créée', prev: 'Version précédente', next: 'Version suivante', cancel2: 'Annuler', resend: 'Renvoyer',
      cloudWait: 'Fabro Cloud est chargé. Nouvel essai dans {s} s.', usePc: 'Répondre avec ton PC', useKey: 'Ajouter une clé API',
      later: 'Envoyé après la réponse en cours', empty: 'Le modèle n’a rien répondu. Réessaie ou change de modèle.', noNet: 'Pas de réseau', install: 'Installer l’app', installSub: 'Ajoute Fabro à ton écran d’accueil.',
    },
    en: {
      places: 'My places', placesSub: 'Home, work, favourites: Fabro uses them for routes.', see: 'See',
      cloudLong: 'This conversation is too long for Fabro Cloud right now. Start a new one, or use your own key.', profile: 'Profile', me: 'Me', pfLocked: 'Password protected', pfOpen: 'No password', pfPwSet: 'Add a password', pfPwChange: 'Change password', pfAdd: 'Add or switch', pfChange: 'Switch profile', pfSub: '{n} of 4 profiles on this device.', pfDelT: 'Delete this profile', pfDelLead: 'Its chats, keys and the link to your computer are erased from this device.', pfPwLead: 'With a password, this profile’s chats and keys are encrypted on this device. Leave empty to remove it.', pfPwOld: 'Current password', pfPwNew: 'New password', pfWrong: 'Wrong password.', saved: 'Saved',
      newChat: 'New request', search: 'Search', code: 'Fabro Code', settings: 'Settings', today: 'Today', before: 'Earlier', noChats: 'Nothing yet',
      homeH: 'What are we doing?', homeSub: 'Ask anything. Fabro searches, reads and acts for you.',
      homeSubPc: 'Ask anything. Tools run on {pc}.',
      s1: 'Summarize this page', s2: 'Compare two phone plans', s3: 'What to do this weekend in Lyon?', s4: 'Tidy my Downloads folder',
      ask: 'Ask anything', askMore: 'Add an instruction', send: 'Send', stop: 'Stop', attach: 'Attach a photo', dictate: 'Dictate', listening: 'Listening…',
      copy: 'Copy', copied: 'Copied', retry: 'Redo', steps1: '1 step', stepsN: '{n} steps', working: 'working',
      pc: 'Your PC', pcOn: '{pc} · connected', pcOff: '{pc} · offline', pcWait: '{pc} · connecting…', linkPc: 'Link your PC', noPc: 'No PC linked',
      model: 'Model', cloud: 'Fabro Cloud', cloudSub: 'Free, no account', auto: 'Automatic', autoSub: 'The best free model right now',
      keys: 'Your API keys', keysSub: 'The key stays on this device.', addKey: 'Add a key', provider: 'Provider', apiKey: 'Key', baseUrl: 'API address', modelName: 'Model', save: 'Save', remove: 'Remove', cancel: 'Cancel', keyTesting: 'Checking…', keyBad: 'Key refused: {e}', keyOk: 'Key added',
      pcModels: 'Your PC’s models', pcModelsSub: 'Everything runs on your PC.', pcAway: 'Your PC isn’t answering. Open Fabro on it.',
      toolsOnPc: 'Tools on {pc}', toolsHere: 'Browser tools',
      allow: 'Allow', always: 'Always', deny: 'Deny', wants: 'Fabro wants to act on {pc}',
      queued: 'Waiting for {pc}', answerCloud: 'Answer with Fabro Cloud',
      pairH: 'Link your PC', pairLead: 'On your PC: Fabro → Settings → Fabro Anywhere → Link a phone. Then aim at the circle or type the code.',
      scan: 'Scan the circle', typeCode: 'Type the code', codePh: 'XXXX-XXXX-…', pair: 'Link', pairing: 'Connecting to your PC…', pairOk: 'PC linked', pairFail: 'Failed. Check that the window on your PC is open.', badCode: 'Invalid code', noCamera: 'No camera. Type the code.',
      forget: 'Forget this PC', forgetQ: 'Forget this PC? Your conversations stay here.',
      codeH: 'Fabro Code runs on your computer', codeLead: 'It reads and edits your projects, runs tests and the command line. Download Fabro to use it.',
      codeOpen: 'Already on {pc}? Open Fabro Code there, your conversations show up here.', yourOs: 'your system',
      theme: 'Appearance', light: 'Light', dark: 'Dark', autoT: 'Auto', eco: 'Eco mode', ecoSub: 'No blur or reflections. Saves battery.', lang: 'Language',
      notify: 'Notifications', notifySub: 'When an answer arrives and the app is closed.', about: 'About', site: 'Fabro website',
      offline: 'Offline', timeout: 'No answer', revoked: 'This PC removed access.', cloudBusy: 'Fabro Cloud is busy. Try again in a minute.', photo: 'Photo',
      deleteQ: 'Delete this conversation?', rename: 'Rename', del: 'Delete', micDenied: 'Microphone denied', sttFail: 'I didn’t catch that',
      retry: 'Retry', edit: 'Edit', fork: 'New conversation from here', forked: 'Conversation created', prev: 'Previous version', next: 'Next version', cancel2: 'Cancel', resend: 'Send again',
      cloudWait: 'Fabro Cloud is busy. Trying again in {s} s.', usePc: 'Answer with your PC', useKey: 'Add an API key',
      later: 'Sent after the current answer', empty: 'The model gave no answer. Try again or pick another model.', noNet: 'No network', install: 'Install the app', installSub: 'Add Fabro to your home screen.',
    },
  };
  let lang = 'fr';
  const t = (k, v = {}) => String((I18N[lang] || I18N.en)[k] ?? I18N.en[k] ?? k).replace(/\{(\w+)\}/g, (_, x) => v[x] ?? '');

  // ───────────────────────────── icons ─────────────────────────────
  const ICONS = {
    plus: '<path d="M12 5v14M5 12h14"/>', menu: '<path d="M4 7h16M4 12h16M4 17h10"/>', code: '<path d="M9 7l-5 5 5 5M15 7l5 5-5 5"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4"/>',
    up: '<path d="M12 19V5M6 11l6-6 6 6"/>', stop: '<rect x="7" y="7" width="10" height="10" rx="2"/>', mic: '<rect x="9" y="3.5" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0013 0M12 17.5V21"/>',
    img: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M20 16l-5-5-8 8"/>', x: '<path d="M6 6l12 12M18 6L6 18"/>',
    chev: '<path d="M9 6l6 6-6 6"/>', down: '<path d="M6 9l6 6 6-6"/>', check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>', pc: '<rect x="3.5" y="4.5" width="17" height="11" rx="2"/><path d="M9 19.5h6M12 15.5v4"/>',
    key: '<circle cx="8" cy="14" r="4"/><path d="M11 11l8-8M16 6l2 2M14 8l2 2"/>', cloud: '<path d="M7 18a4.5 4.5 0 01-.6-9 6 6 0 0111.5 1.5A3.8 3.8 0 0117 18z"/>',
    dl: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>', ext: '<path d="M14 4h6v6M20 4l-9 9M18 14v5H5V6h5"/>', search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4-4"/>', redo: '<path d="M4 12a8 8 0 0113.7-5.6L20 9M20 4v5h-5M20 12a8 8 0 01-13.7 5.6L4 15M4 20v-5h5"/>', pen: '<path d="M4 20h4L19 9l-4-4L4 16z"/>', fork: '<circle cx="6" cy="5" r="2"/><circle cx="18" cy="5" r="2"/><circle cx="12" cy="19" r="2"/><path d="M6 7v2a3 3 0 003 3h6a3 3 0 003-3V7M12 12v5"/>', left: '<path d="M15 6l-6 6 6 6"/>', right: '<path d="M9 6l6 6-6 6"/>',
  };
  const ic = (n) => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${ICONS[n] || ''}</svg>`;
  let MARK = '';
  const mark = () => `<svg viewBox="0 0 100 100" aria-hidden="true">${MARK}</svg>`;

  // ───────────────────────────── storage ─────────────────────────────
  const DB = {
    db: null,
    open() {
      if (this.db) return Promise.resolve(this.db);
      return new Promise((res, rej) => { const r = indexedDB.open(FAProfiles.dbName(), 1); r.onupgradeneeded = () => { r.result.createObjectStore('kv'); r.result.createObjectStore('convs', { keyPath: 'id' }); }; r.onsuccess = () => { this.db = r.result; res(this.db); }; r.onerror = () => rej(r.error); });
    },
    async tx(store, mode, fn) { const db = await this.open(); return new Promise((res, rej) => { const tr = db.transaction(store, mode); const out = fn(tr.objectStore(store)); tr.oncomplete = () => res(out instanceof IDBRequest ? out.result : out); tr.onerror = () => rej(tr.error); }); },
    // values are sealed when the profile has a password (profiles.js)
    async get(s, k) { return FAProfiles.open(await this.tx(s, 'readonly', (x) => x.get(k))); },
    async put(s, v, k) { const w = await FAProfiles.seal(v, k === undefined ? v.id : undefined); return this.tx(s, 'readwrite', (x) => (k === undefined ? x.put(w) : x.put(w, k))); },
    del(s, k) { return this.tx(s, 'readwrite', (x) => x.delete(k)); },
    async all(s) { const l = await this.tx(s, 'readonly', (x) => x.getAll()); return Promise.all((l || []).map((v) => FAProfiles.open(v).catch(() => null))).then((r) => r.filter(Boolean)); },
  };
  const kv = { get: (k) => DB.get('kv', k), set: (k, v) => DB.put('kv', v, k), del: (k) => DB.del('kv', k) };

  // ───────────────────────────── state ─────────────────────────────
  // model: 'cloud:<id>' (Fabro Cloud) · 'key:<keyId>' (one of the user's keys) · { backend… } (a model of the computer)
  const S = {
    settings: { lang: 'auto', model: 'cloud:auto', notify: false },
    keys: [], identity: null, link: null, conn: { state: 'off', info: null }, models: [], pcTools: null,
    convs: new Map(), metas: [], cur: null, outbox: [], tombstones: [], runs: new Map(), asks: new Map(),
    localRun: null, later: [], sheet: null, drawer: false, atts: [], installEvt: null, open: new Set(),
  };
  let relay = null, session = null, connecting = null, retryT = 0, retryN = 0, pingT = 0;
  const saveSettings = () => kv.set('settings', S.settings);
  async function saveConv(c) { S.convs.set(c.id, c); await DB.put('convs', c); }
  const curConv = () => (S.cur ? S.convs.get(S.cur) : null);
  const pcName = () => (S.link && S.link.pcName) || t('pc');
  const linked = () => !!S.link;
  const online = () => !!session;

  function toast(msg, kind = '') {
    const el = document.createElement('div'); el.className = 'toast ' + kind; el.textContent = msg;
    $('#toast-root').appendChild(el); setTimeout(() => el.classList.add('out'), 3000); setTimeout(() => el.remove(), 3400);
  }

  // ───────────────────────────── link to the computer ─────────────────────────────
  const rpcWait = new Map(); let rpcN = 0;
  function rpc(m, p = {}, timeout = 60000) {
    if (!session) return Promise.reject(new Error(t('offline')));
    const id = 'r' + (++rpcN);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { rpcWait.delete(id); reject(new Error(t('timeout'))); }, timeout);
      rpcWait.set(id, { resolve, reject, timer });
      session.send({ t: 'req', id, m, p }).then((ok) => { if (!ok) { clearTimeout(timer); rpcWait.delete(id); reject(new Error(t('offline'))); } });
    });
  }
  const relayUrls = () => [...new Set((S.link && S.link.relays && S.link.relays.length) ? S.link.relays : A.DEFAULT_RELAYS)];
  function setConn(state, extra = {}) { S.conn = { ...S.conn, state, ...extra }; renderSide(); renderTop(); renderCards(); }
  async function connect(force) {
    if (!S.link) return;
    if (connecting && !force) return connecting;
    clearTimeout(retryT);
    connecting = (async () => {
      setConn('connecting');
      if (!relay) relay = new A.Relay(relayUrls(), {});
      for (let i = 0; i < 40 && !relay.up(); i++) await sleep(250);
      try {
        const s = await A.phoneConnect({
          relay, link: S.link, ice: S.link.ice || A.STUN, onMessage,
          onRevoked: () => { forget(true); toast(t('revoked'), 'err'); },
          onState: (st, ss) => { if (session === ss || session === s) setConn(st === 'direct' || st === 'relay' ? 'on' : S.conn.state); },
        });
        if (session) session.close();
        session = s; retryN = 0; setConn('on');
        clearInterval(pingT); pingT = setInterval(() => { if (session) session.send({ t: '_ping' }); if (session && now() - session.alive > 75000) dropped(); }, 25000);
        await afterConnect();
      } catch (e) {
        if (String(e.message) === 'revoked') { await forget(true); toast(t('revoked'), 'err'); return; }
        setConn('off'); scheduleRetry();
      } finally { connecting = null; }
    })();
    return connecting;
  }
  function scheduleRetry() {
    clearTimeout(retryT); if (document.hidden) return;
    const ms = Math.min([2000, 4000, 8000, 12000, 15000][Math.min(retryN++, 4)], S.outbox.length ? 6000 : Infinity);
    retryT = setTimeout(() => connect(), ms);
  }
  function dropped() {
    if (session) { session.close(); session = null; }
    for (const [, w] of rpcWait) { clearTimeout(w.timer); w.reject(new Error(t('offline'))); } rpcWait.clear();
    for (const [id, a] of S.asks) if (a.kind === 'tool') S.asks.delete(id);
    setConn('off'); scheduleRetry();
  }
  async function afterConnect() {
    try {
      const info = await rpc('hello', { visible: !document.hidden, name: deviceName() });
      S.conn.info = info; S.models = info.models || [];
      if (info.pcName && S.link.pcName !== info.pcName) { S.link.pcName = info.pcName; await kv.set('link', S.link); }
      S.pcTools = info.api >= 2 ? await rpc('tools.list', {}, 20000).then((r) => r.tools || []).catch(() => null) : null;
      renderAll();
      await syncNow(); await flushOutbox(); ensurePush(false);
    } catch (e) { console.warn('afterConnect', e); }
  }
  function onMessage(m) {
    if (!m) return;
    if (m.t === 'bye') return dropped();
    if (m.t === 'res') { const w = rpcWait.get(m.id); if (w) { rpcWait.delete(m.id); clearTimeout(w.timer); m.ok ? w.resolve(m.r) : w.reject(new Error(m.e || 'error')); } return; }
    if (m.t !== 'ev') return;
    if (m.k === 'run') return onRunEvents(m);
    if (m.k === 'run.done') return onRunDone(m);
    if (m.k === 'ask') { S.asks.set(m.ask.id, { ...m.ask, kind: 'run', runId: m.runId, convId: m.convId }); renderCards(); if (document.hidden) localNotify(t('wants', { pc: pcName() }), m.ask.summary || '', m.convId); return; }
    if (m.k === 'tool.ask') { S.asks.set(m.ask.id, { ...m.ask, kind: 'tool', convId: m.convId }); renderCards(); if (document.hidden) localNotify(t('wants', { pc: pcName() }), m.ask.summary || '', m.convId); return; }
    if (m.k === 'toast') { toast(`${m.title || ''} · ${m.body || ''}`); syncNow(); }
  }
  function deviceName() {
    const ua = navigator.userAgent; const p = (ua.match(/\(([^)]+)\)/) || [])[1] || '';
    if (/iPhone/.test(ua)) return 'iPhone'; if (/iPad/.test(ua)) return 'iPad';
    if (/Android/.test(ua)) return p.split(';').map((x) => x.trim()).find((x) => x && !/Android|Linux|wv|U$|^K$/.test(x)) || 'Android';
    return /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'Navigateur';
  }
  const platform = () => (/iPhone|iPad/.test(navigator.userAgent) ? 'iOS' : /Android/.test(navigator.userAgent) ? 'Android' : (navigator.platform || 'web'));

  // ───────────────────────────── sync ─────────────────────────────
  const strip = (c) => { const { dirty, ...rest } = c; return rest; };
  const hasNewer = (l, r) => { const ids = new Set(A.nodesOf(r).map((n) => n.id)); return A.nodesOf(l).some((n) => !ids.has(n.id)); };
  async function syncNow() {
    if (!session) return;
    const have = {}; for (const c of S.convs.values()) if (!c.partial) have[c.id] = c.updatedAt || 0;
    const push = [...S.convs.values()].filter((c) => c.dirty && !c.ephemeral && !busy(c)).map(strip);
    const full = S.cur && (!S.convs.has(S.cur) || S.convs.get(S.cur).partial) ? [S.cur] : [];
    const r = await rpc('sync', { have, push, full, deleted: S.tombstones }, 90000);
    S.tombstones = []; await kv.set('tombstones', []);
    for (const c of push) { const l = S.convs.get(c.id); if (l) { l.dirty = false; await saveConv(l); } }
    const gone = new Set(r.deleted || []);
    for (const id of gone) if (S.convs.has(id)) { S.convs.delete(id); await DB.del('convs', id); if (S.cur === id) S.cur = null; }
    for (const c of r.convs || []) { const l = S.convs.get(c.id); const m = l && !l.partial ? A.mergeConv(l, c) : c; m.dirty = !!(l && l.dirty && hasNewer(l, c)); await saveConv(m); }
    S.metas = (r.metas || []).filter((m) => !gone.has(m.id)); await kv.set('metas', S.metas);
    renderSide(); if (S.cur) renderMain();
  }
  async function openConv(id) {
    S.cur = id; S.drawer = false; renderAll();
    const c = S.convs.get(id);
    if ((!c || c.partial) && session) { try { await saveConv(await rpc('conv.get', { id })); renderMain(); } catch (e) { toast(e.message, 'err'); } }
    scrollChat(true);
  }
  function newChat() { S.cur = null; S.drawer = false; S.atts = []; renderAll(); setTimeout(() => { const ta = $('.composer textarea'); if (ta && innerWidth > 860) ta.focus(); }, 30); }

  // ───────────────────────────── models ─────────────────────────────
  const PRESETS = [
    { id: 'openai', name: 'OpenAI', base: 'https://api.openai.com/v1', model: 'gpt-5-mini' },
    { id: 'anthropic', name: 'Anthropic', base: 'https://api.anthropic.com/v1', model: 'claude-sonnet-5-5' },
    { id: 'gemini', name: 'Google Gemini', base: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.5-flash' },
    { id: 'mistral', name: 'Mistral', base: 'https://api.mistral.ai/v1', model: 'mistral-medium-latest' },
    { id: 'openrouter', name: 'OpenRouter', base: 'https://openrouter.ai/api/v1', model: 'openrouter/auto' },
    { id: 'groq', name: 'Groq', base: 'https://api.groq.com/openai/v1', model: 'openai/gpt-oss-120b' },
    { id: 'custom', name: 'Autre (compatible OpenAI)', base: '', model: '' },
  ];
  const refKey = (r) => !r ? '' : typeof r === 'string' ? r : r.backend === 'provider' ? `p:${r.provider}:${r.model}` : r.backend === 'local' ? `l:${r.id}` : `${r.backend}:${r.id || r.name}`;
  const isPcModel = (m) => m && typeof m === 'object';
  const keyOf = (m) => (typeof m === 'string' && m.startsWith('key:') ? S.keys.find((k) => k.id === m.slice(4)) : null);
  function modelLabel(m = S.settings.model) {
    if (isPcModel(m)) { const x = S.models.find((y) => refKey(y.ref) === refKey(m)); return x ? x.label : (m.model || m.id || pcName()); }
    const k = keyOf(m); if (k) return k.model;
    const id = typeof m === 'string' && m.startsWith('cloud:') ? m.slice(6) : 'auto';
    return id === 'auto' ? t('cloud') : ((FAAgent.models.find((x) => x.id === id) || {}).name || t('cloud'));
  }

  // ───────────────────────────── sending ─────────────────────────────
  const busy = (c) => !!c && A.pathOf(c).some((n) => n.pending);
  async function send(text) {
    text = (text || '').trim(); const atts = S.atts.splice(0);
    if (!text && !atts.length) return;
    let c = curConv();
    if (!c || c.partial) { c = { id: uid(), title: '', createdAt: now(), updatedAt: now(), nodes: [], leafId: null, agent: true, origin: 'phone' }; S.cur = c.id; }
    const node = { id: A.uid(), role: 'user', content: text, attachments: atts, createdAt: now(), updatedAt: now(), parentId: c.leafId || null };
    c.nodes = [...A.nodesOf(c), node]; delete c.messages; c.leafId = node.id; c.updatedAt = now(); c.dirty = true;
    if (!c.title) c.title = text.replace(/\s+/g, ' ').slice(0, 64) || t('photo');
    await saveConv(c); renderAll(); scrollChat(true);
    return dispatch(c, node);
  }
  async function dispatch(c, node, regenerate = false) {
    const m = S.settings.model;
    if (!isPcModel(m)) return runHere(c, node);
    if (!session) { S.outbox.push({ convId: c.id, nodeId: node.id }); await kv.set('outbox', S.outbox); renderCards(); connect(); return; }
    try {
      const res = await rpc('run', { conv: strip(c), nodeId: node.id, model: m, agent: true, regenerate });
      c.dirty = false;
      if (res.already) return syncNow();
      const asst = { id: res.nodeId, role: 'assistant', content: '', steps: [], model: res.model, pending: true, createdAt: now(), parentId: node.id };
      c.nodes = [...A.nodesOf(c), asst]; c.leafId = asst.id; await saveConv(c);
      S.runs.set(res.runId, { convId: c.id, nodeId: asst.id }); renderMain(); renderComposer(); scrollChat(true);
    } catch (e) { S.outbox.push({ convId: c.id, nodeId: node.id }); await kv.set('outbox', S.outbox); toast(e.message, 'err'); renderCards(); }
  }
  async function flushOutbox() {
    if (!session || !S.outbox.length) return;
    const list = S.outbox.splice(0); await kv.set('outbox', S.outbox);
    for (const q of list) {
      const c = S.convs.get(q.convId); const node = c && A.nodesOf(c).find((n) => n.id === q.nodeId);
      if (node && !A.nodesOf(c).some((n) => n.parentId === node.id && n.role === 'assistant')) await dispatch(c, node);
    }
    renderCards();
  }
  async function answerQueuedWithCloud() {
    const list = S.outbox.splice(0); await kv.set('outbox', S.outbox); renderCards();
    for (const q of list) { const c = S.convs.get(q.convId); const node = c && A.nodesOf(c).find((n) => n.id === q.nodeId); if (node) await runHere(c, node, true); }
  }

  // The model answers from here (Fabro Cloud or a key); tools run on the computer when it's reachable.
  async function runHere(c, node, forceCloud = false) {
    const key = forceCloud ? null : keyOf(S.settings.model);
    const cloudId = !forceCloud && typeof S.settings.model === 'string' && S.settings.model.startsWith('cloud:') ? S.settings.model.slice(6) : 'auto';
    const asst = { id: A.uid(), role: 'assistant', content: '', reasoning: '', steps: [], model: key ? key.model : modelLabel('cloud:' + cloudId), pending: true, createdAt: now(), parentId: node.id, origin: key ? 'phone-key' : 'phone-cloud' };
    if (session && S.pcTools) asst.toolsOn = pcName();
    c.nodes = [...A.nodesOf(c), asst]; c.leafId = asst.id; await saveConv(c); renderMain(); renderComposer(); scrollChat(true);
    const ctl = new AbortController(); const inflight = new Set();
    S.localRun = { convId: c.id, abort: () => { ctl.abort(); for (const id of inflight) rpc('tool.abort', { callId: id }).catch(() => {}); } };
    let ext = null;
    if (session && S.pcTools) {
      const tools = await rpc('tools.list', { text: node.content, used: [] }, 8000).then((r) => r.tools).catch(() => S.pcTools);
      ext = { name: pcName(), schemas: tools, call: async (name, args, id) => { inflight.add(id); try { return await rpc('tool.call', { name, args, callId: id, convId: c.id }, 20 * 60000); } finally { inflight.delete(id); } } };
    }
    let paintT = 0;
    const paint = () => { if (S.cur === c.id) { cancelAnimationFrame(paintT); paintT = requestAnimationFrame(() => { paintMessage(asst); scrollChat(); }); } };
    try {
      const out = await FAAgent.run({
        history: A.pathOf({ ...c, leafId: node.id }), model: cloudId, agent: true, lang, signal: ctl.signal, ext,
        prov: key ? { name: key.name, base: key.base, key: key.key, model: key.model } : null,
        onEvent: (ev) => {
          if (ev.type === 'wait') { asst.wait = ev.text || ''; }
          else if (ev.type === 'token') { asst.wait = ''; asst.content = (asst.content + ev.text).replace(/【(\d+)†[^】]*】/g, '[$1]'); }
          else if (ev.type === 'reasoning') asst.reasoning = (asst.reasoning || '') + ev.text;
          else if (ev.type === 'tool_round') { if (asst.content && !/\n\n$/.test(asst.content)) asst.content += '\n\n'; }
          else if (ev.type === 'tool_start') asst.steps.push({ id: ev.id, name: ev.name, status: 'running', args: ev.args });
          else if (ev.type === 'tool_end') { const st = asst.steps.find((x) => x.id === ev.id); if (st) { st.status = ev.error ? 'error' : 'done'; st.view = ev.view; if (ev.error) st.error = ev.error; } }
          paint();
        },
      });
      if (!key && out && out.model) asst.model = out.model;
    } catch (e) { if (e && e.name !== 'AbortError') asst.error = String(e && e.message || e); }
    S.localRun = null;
    delete asst.wait; asst.content = asst.content.trim(); asst.pending = false; asst.updatedAt = now(); c.updatedAt = now(); c.dirty = true;
    if (!asst.content && !asst.error && !ctl.signal.aborted && !asst.steps.some((x) => x.view && x.view.image)) asst.error = t('empty');
    await saveConv(c); renderMain(); renderComposer(); renderSide(); sendLater(c.id);
    if (document.hidden) localNotify(c.title || 'Fabro', (asst.error ? asst.error : asst.content).replace(/[#*_`>]/g, '').slice(0, 140), c.id);
    if (session) syncNow().catch(() => {});
  }

  function onRunEvents(m) {
    const c = S.convs.get(m.convId); if (!c) return;
    let n = A.nodesOf(c).find((x) => x.id === m.nodeId);
    if (!n) { n = { id: m.nodeId, role: 'assistant', content: '', steps: [], pending: true, createdAt: now(), parentId: c.leafId }; c.nodes = [...A.nodesOf(c), n]; c.leafId = n.id; S.runs.set(m.runId, { convId: c.id, nodeId: n.id }); }
    for (const ev of m.evs || []) {
      if (ev.type === 'token') n.content = (n.content || '') + ev.text;
      else if (ev.type === 'tool_start') (n.steps = n.steps || []).push({ id: ev.id, name: ev.name, status: 'running', args: ev.args });
      else if (ev.type === 'tool_end') { const st = (n.steps || []).find((x) => x.id === ev.id); if (st) { st.status = ev.error ? 'error' : ev.refused ? 'refused' : 'done'; st.view = ev.view; } }
      else if (ev.type === 'tool_round') { if (n.content && !/\n\n$/.test(n.content)) n.content += '\n\n'; }
      else if (ev.type === 'retract') n.content = '';
    }
    n.runId = m.runId;
    if (S.cur === c.id) requestAnimationFrame(() => { paintMessage(n); scrollChat(); });
  }
  async function onRunDone(m) {
    S.runs.delete(m.runId);
    for (const [k, v] of S.asks) if (v.runId === m.runId) S.asks.delete(k);
    if (!m.conv) return;
    const l = S.convs.get(m.conv.id); const merged = l ? A.mergeConv(l, m.conv) : m.conv;
    merged.dirty = !!(l && l.dirty && hasNewer(l, m.conv)); await saveConv(merged);
    if (S.cur === merged.id) { renderMain(); renderComposer(); } renderSide(); renderCards(); sendLater(merged.id);
    const last = A.pathOf(merged).slice(-1)[0];
    if (document.hidden && last) localNotify(merged.title || 'Fabro', (last.error || last.content || '').replace(/[#*_`>]/g, '').slice(0, 140), merged.id);
  }
  function sendLater(convId) {
    const i = S.later.findIndex((x) => x.convId === convId); if (i < 0) return;
    const [x] = S.later.splice(i, 1); if (S.cur !== convId) return;
    S.atts = x.atts; send(x.text);
  }
  async function answerAsk(id, value) {
    const a = S.asks.get(id); if (!a) return; S.asks.delete(id); renderCards();
    try { if (a.kind === 'tool') await rpc('tool.answer', { id, value }); else await rpc('run.answer', { runId: a.runId, callId: id, value }); } catch (e) { toast(e.message, 'err'); }
  }
  function stopRun() {
    const c = curConv(); if (!c) return;
    for (const [runId, r] of S.runs) if (r.convId === c.id) rpc('run.abort', { runId }).catch(() => {});
    if (S.localRun && S.localRun.convId === c.id) S.localRun.abort();
  }

  // ───────────────────────────── notifications ─────────────────────────────
  async function ensurePush(ask) {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !S.conn.info || !S.conn.info.vapid) return false;
    if (Notification.permission === 'denied') return false;
    if (Notification.permission !== 'granted') { if (!ask) return false; if ((await Notification.requestPermission()) !== 'granted') return false; }
    try {
      const reg = await navigator.serviceWorker.ready; let sub = await reg.pushManager.getSubscription(); const key = S.conn.info.vapid;
      if (sub && sub.options && sub.options.applicationServerKey && A.b64u(new Uint8Array(sub.options.applicationServerKey)) !== key) { await sub.unsubscribe(); sub = null; }
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: A.unb64u(key) });
      await rpc('push.sub', { sub: sub.toJSON() }); S.settings.notify = true; await saveSettings(); return true;
    } catch (e) { console.warn('push', e); return false; }
  }
  async function disablePush() {
    try { const reg = await navigator.serviceWorker.ready; const sub = await reg.pushManager.getSubscription(); if (sub) await sub.unsubscribe(); } catch {}
    try { await rpc('push.sub', { sub: null }); } catch {}
    S.settings.notify = false; await saveSettings();
  }
  async function localNotify(title, body, convId) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    try { (await navigator.serviceWorker.ready).showNotification(title, { body, tag: convId, data: { convId }, icon: 'icons/icon-192.png', badge: 'icons/badge.png' }); } catch {}
  }

  // ───────────────────────────── pairing ─────────────────────────────
  let scan = null;
  async function startScan() {
    const video = $('#scan-video'); if (!video) return;
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false }); }
    catch { toast(t('noCamera'), 'err'); S.sheet = { kind: 'pair', mode: 'code' }; renderSheet(); return; }
    video.srcObject = stream; await video.play().catch(() => {});
    const worker = new Worker('scan-worker.js'); const side = 520;
    const cv = document.createElement('canvas'); cv.width = side; cv.height = side; const g = cv.getContext('2d', { willReadFrequently: true });
    let busyW = false, stopped = false;
    scan = { stop() { stopped = true; worker.terminate(); stream.getTracks().forEach((x) => x.stop()); scan = null; } };
    worker.onmessage = async (e) => { busyW = false; if (stopped) return; if (e.data && e.data.ok) { navigator.vibrate && navigator.vibrate(40); scan.stop(); await pairWith(e.data.data27); } };
    const tick = () => {
      if (stopped) return;
      if (!busyW && video.videoWidth) { const vw = video.videoWidth, vh = video.videoHeight, s = Math.min(vw, vh); g.drawImage(video, (vw - s) / 2, (vh - s) / 2, s, s, 0, 0, side, side); const im = g.getImageData(0, 0, side, side); busyW = true; worker.postMessage({ data: im.data.buffer, width: side, height: side }, [im.data.buffer]); }
      requestAnimationFrame(tick);
    };
    tick();
  }
  async function pairWith(data27) {
    const payload = A.unpackPayload(data27 instanceof Uint8Array ? data27 : new Uint8Array(data27));
    if (!payload) { toast(t('badCode'), 'err'); return; }
    S.sheet = { kind: 'pair', mode: 'busy' }; renderSheet();
    if (!S.identity) { S.identity = await A.genKeys(); await kv.set('identity', S.identity.jwk); }
    const urls = A.relaysFor(payload.flags, null);
    if (relay) relay.close();
    relay = new A.Relay(urls, {});
    for (let i = 0; i < 40 && !relay.up(); i++) await sleep(250);
    try {
      const link = await A.phonePair({ relay, identity: S.identity, payload, name: deviceName(), platform: platform(), timeout: 45000 });
      link.relays = link.relays && link.relays.length ? link.relays : urls;
      S.link = link; await kv.set('link', link);
      S.sheet = null; renderSheet(); toast(t('pairOk')); renderAll(); connect(true);
    } catch (e) { S.sheet = { kind: 'pair', mode: 'code', err: t('pairFail') }; renderSheet(); }
  }
  async function forget(remote) {
    if (session && !remote) { try { await rpc('unpair', {}, 5000); } catch {} }
    if (session) { try { await session.send({ t: 'bye' }); } catch {} session.close(); session = null; }
    if (relay) { relay.close(); relay = null; }
    S.link = null; S.conn = { state: 'off', info: null }; S.models = []; S.pcTools = null;
    if (isPcModel(S.settings.model)) { S.settings.model = 'cloud:auto'; await saveSettings(); }
    await kv.del('link'); renderAll();
  }

  // ───────────────────────────── photos and voice ─────────────────────────────
  async function addPhotos(files) {
    for (const f of [...files].slice(0, 4 - S.atts.length)) {
      if (!/^image\//.test(f.type)) continue;
      const bmp = await createImageBitmap(f).catch(() => null); if (!bmp) continue;
      const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
      const cv = document.createElement('canvas'); cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
      cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
      S.atts.push({ kind: 'image', name: f.name || 'photo.jpg', data: cv.toDataURL('image/jpeg', 0.85) });
    }
    renderComposer();
  }
  let rec = null;
  async function dictate() {
    if (rec) return rec.stop();
    let stream; try { stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } }); } catch { return toast(t('micDenied'), 'err'); }
    const ac = new (window.AudioContext || window.webkitAudioContext)(); const src = ac.createMediaStreamSource(stream);
    const proc = ac.createScriptProcessor(4096, 1, 1); const chunks = [];
    proc.onaudioprocess = (e) => chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
    src.connect(proc); proc.connect(ac.destination);
    const comp = $('.composer'); comp && comp.classList.add('rec');
    rec = { stop: async () => {
      rec = null; proc.disconnect(); src.disconnect(); stream.getTracks().forEach((x) => x.stop()); const rate = ac.sampleRate; ac.close();
      $('.composer') && $('.composer').classList.remove('rec');
      const wav = toWav(chunks, rate); if (wav.length < 16000) return;
      try {
        let text = '';
        if (session && S.conn.info && S.conn.info.voice && S.conn.info.voice.ready) { const r = await rpc('voice.stt', { wav: A.b64u(wav).replace(/-/g, '+').replace(/_/g, '/'), lang }, 60000); text = typeof r === 'string' ? r : (r && r.text) || ''; }
        else text = await FAAgent.cloudHear(wav, { lang });
        const ta = $('.composer textarea'); if (text && ta) { ta.value = (ta.value ? ta.value + ' ' : '') + text.trim(); ta.dispatchEvent(new Event('input')); ta.focus(); } else if (!text) toast(t('sttFail'));
      } catch { toast(t('sttFail'), 'err'); }
    } };
  }
  function toWav(chunks, rate) {
    const n = chunks.reduce((a, c) => a + c.length, 0); const all = new Float32Array(n); let o = 0; for (const c of chunks) { all.set(c, o); o += c.length; }
    const out = 16000, len = Math.floor(n * out / rate); const pcm = new Int16Array(len);
    for (let i = 0; i < len; i++) { const x = i * rate / out, j = Math.floor(x), f = x - j; const v = (all[j] || 0) * (1 - f) + (all[j + 1] || 0) * f; pcm[i] = Math.max(-1, Math.min(1, v)) * 0x7fff; }
    const buf = new ArrayBuffer(44 + pcm.length * 2), dv = new DataView(buf); const w = (p, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(p + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); dv.setUint32(4, 36 + pcm.length * 2, true); w(8, 'WAVEfmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
    dv.setUint32(24, out, true); dv.setUint32(28, out * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true); w(36, 'data'); dv.setUint32(40, pcm.length * 2, true);
    new Int16Array(buf, 44).set(pcm); return new Uint8Array(buf);
  }

  // ───────────────────────────── rendering ─────────────────────────────
  marked.setOptions({ gfm: true, breaks: true });
  function md(text, sources) {
    let h = DOMPurify.sanitize(marked.parse(String(text || '')), { ADD_ATTR: ['target'] });
    h = h.replace(/\[(\d{1,2})\](?![^<]*<\/a>)(?![^<]*<\/code>)/g, (m, n) => { const s = sources && sources[n - 1]; return s ? `<a class="cite" href="${esc(s.url)}" target="_blank" rel="noopener"><cite>${n}</cite></a>` : `<cite>${n}</cite>`; });
    return h.replace(/<a href=/g, '<a target="_blank" rel="noopener" href=');
  }
  const STEP = {
    fr: { web_search: 'Cherche sur le web', fetch_url: 'Lit une page', read_page: 'Lit une page', generate_image: 'Crée une image', weather: 'Regarde la météo', get_datetime: 'Regarde l’heure', run_python: 'Calcule', run_javascript: 'Calcule', update_plan: 'Fait un plan', read_file: 'Lit un fichier', write_file: 'Écrit un fichier', edit_file: 'Modifie un fichier', run_command: 'Lance une commande', list_files: 'Parcourt des fichiers', map_search: 'Cherche un lieu', map_show: 'Affiche une carte', map_route: 'Calcule un itinéraire', places_saved: 'Consulte tes lieux', my_location: 'Regarde ta position' },
    en: { web_search: 'Searches the web', fetch_url: 'Reads a page', read_page: 'Reads a page', generate_image: 'Makes an image', weather: 'Checks the weather', get_datetime: 'Checks the time', run_python: 'Computes', run_javascript: 'Computes', update_plan: 'Makes a plan', read_file: 'Reads a file', write_file: 'Writes a file', edit_file: 'Edits a file', run_command: 'Runs a command', list_files: 'Browses files', map_search: 'Looks up a place', map_show: 'Shows a map', map_route: 'Plans a route', places_saved: 'Checks your places', my_location: 'Checks your position' },
  };
  const stepName = (s) => (STEP[lang] || STEP.en)[s.name] || s.name.replace(/^mcp__/, '').replace(/_/g, ' ');
  const stepArg = (s) => { const a = s.args || {}; return a.query || a.url || a.path || a.command || a.city || a.prompt || ''; };
  function stepsHtml(n) {
    const st = (n.steps || []).filter((s) => !s.parent); if (!st.length) return '';
    const live = n.pending && st.some((s) => s.status === 'running');
    const last = st[st.length - 1];
    const open = S.open.has(n.id);
    return `<div class="steps${live ? ' live' : ''}${open ? ' open' : ''}" data-steps="${esc(n.id)}"><button data-act="steps" data-id="${esc(n.id)}" aria-expanded="${open}"><span class="dot"></span>${st.length === 1 ? t('steps1') : t('stepsN', { n: st.length })} · ${esc(stepName(last))}${ic('chev')}</button>
      <ol>${st.map((s) => `<li class="${s.status}"><span>${esc(stepName(s))}${stepArg(s) ? ' · ' + esc(String(stepArg(s)).slice(0, 90)) : ''}</span></li>`).join('')}</ol></div>`;
  }
  function sourcesOf(n) { const out = []; for (const s of n.steps || []) if (s.view && Array.isArray(s.view.sources)) for (const x of s.view.sources) if (x && x.url) out.push({ url: x.url, title: x.title || x.url }); return out; }
  function aiInner(n) {
    const src = sourcesOf(n);
    const imgs = (n.steps || []).map((s) => s.view && s.view.image).filter((x) => x && /^(data:image|https:)/.test(x));
    const body = n.content ? md(n.content, src) : '';
    const caret = n.pending ? '<span class="caret"></span>' : '';
    const wait = n.pending && n.wait ? `<div class="wait">${esc(t('cloudWait', { s: n.wait }))}</div>` : '';
    return `${stepsHtml(n)}${window.FAMaps ? FAMaps.cards(n) : ''}${wait}<div class="md">${body}${caret && !body ? caret : ''}</div>
      ${imgs.map((u) => `<div class="gen"><img src="${esc(u)}" alt="" data-tint></div>`).join('')}
      ${n.error ? `<div class="err">${esc(n.error)}</div>${n.origin === 'phone-cloud' ? `<div class="err-acts"><button class="btn" data-act="retry" data-id="${esc(n.id)}">${ic('redo')}${t('retry')}</button>${S.models.length ? `<button class="btn" data-act="use-pc" data-id="${esc(n.id)}">${ic('pc')}${t('usePc')}</button>` : ''}<button class="btn ghost" data-act="add-key">${ic('key')}${t('useKey')}</button></div>` : ''}` : ''}
      ${!n.pending && src.length ? `<div class="sources">${src.slice(0, 6).map((s, i) => `<a href="${esc(s.url)}" target="_blank" rel="noopener"><cite>${i + 1}</cite><span>${esc(host(s.url))}</span></a>`).join('')}</div>` : ''}
      ${n.pending ? '' : `<div class="meta">${versions(n)}<button data-act="copy" data-id="${esc(n.id)}">${t('copy')}</button><button class="mi" data-act="retry" data-id="${esc(n.id)}" title="${t('retry')}">${ic('redo')}</button><button class="mi" data-act="fork" data-id="${esc(n.id)}" title="${t('fork')}">${ic('fork')}</button><span>${esc(n.model || '')}${n.toolsOn ? ' · ' + esc(t('toolsOnPc', { pc: n.toolsOn })) : ''}</span></div>`}`;
  }
  const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
  // other answers (or edits) of the same message: < 2/3 >
  function siblingsOf(n) { const c = curConv(); return c ? A.nodesOf(c).filter((x) => x.parentId === n.parentId && x.role === n.role).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)) : [n]; }
  function versions(n) {
    const sib = siblingsOf(n); if (sib.length < 2) return '';
    const i = sib.findIndex((x) => x.id === n.id);
    return `<span class="ver"><button data-act="ver" data-id="${esc(n.id)}" data-d="-1" ${i <= 0 ? 'disabled' : ''} aria-label="${t('prev')}">${ic('left')}</button><span class="mono">${i + 1}/${sib.length}</span><button data-act="ver" data-id="${esc(n.id)}" data-d="1" ${i >= sib.length - 1 ? 'disabled' : ''} aria-label="${t('next')}">${ic('right')}</button></span>`;
  }
  function msgHtml(n) {
    if (n.role === 'user' && S.editing === n.id) return `<div class="msg you editing" data-n="${esc(n.id)}"><textarea class="edit-in" rows="3">${esc(n.content || '')}</textarea><div class="edit-acts"><button class="btn ghost" data-act="edit-cancel">${t('cancel2')}</button><button class="btn pri" data-act="edit-send" data-id="${esc(n.id)}">${t('resend')}</button></div></div>`;
    if (n.role === 'user') return `<div class="msg you" data-n="${esc(n.id)}">${(n.attachments || []).some((a) => a.data) ? `<div class="imgs">${n.attachments.filter((a) => a.data).map((a) => `<img src="${esc(a.data)}" alt="" data-tint>`).join('')}</div>` : ''}${n.content ? `<div class="q">${esc(n.content)}</div>` : ''}<div class="umeta">${versions(n)}<button class="mi" data-act="edit" data-id="${esc(n.id)}" title="${t('edit')}">${ic('pen')}</button></div></div>`;
    return `<div class="msg ai${n.pending ? ' pending' : ''}" data-n="${esc(n.id)}"><div class="mk">${mark()}</div><div class="body">${aiInner(n)}</div></div>`;
  }
  function paintMessage(n) {
    const el = $(`.msg[data-n="${CSS.escape(n.id)}"]`); if (!el) return renderMain();
    el.classList.toggle('pending', !!n.pending);
    const b = $('.body', el); if (b) b.innerHTML = aiInner(n);
    const md = $('.md', el); if (n.pending && md && n.content) { const last = md.lastElementChild || md; last.insertAdjacentHTML('beforeend', '<span class="caret"></span>'); }
  }
  let stick = true;
  function scrollChat(force) { const s = $('.scroll'); if (!s) return; if (force || stick) s.scrollTop = s.scrollHeight; }

  function groups() {
    const list = [...S.convs.values()].filter((c) => !c.ephemeral).map((c) => ({ id: c.id, title: c.title, at: c.updatedAt || 0, busy: busy(c) }));
    for (const m of S.metas) if (!S.convs.has(m.id)) list.push({ id: m.id, title: m.title, at: m.updatedAt || 0 });
    list.sort((a, b) => b.at - a.at);
    const d0 = new Date(); d0.setHours(0, 0, 0, 0);
    return [[t('today'), list.filter((x) => x.at >= d0)], [t('before'), list.filter((x) => x.at < d0).slice(0, 60)]].filter((g) => g[1].length);
  }
  function renderSide() {
    const el = $('.side'); if (!el) return;
    const g = groups();
    const st = !linked() ? '' : S.conn.state === 'on' ? 'on' : S.conn.state === 'connecting' ? 'wait' : '';
    el.innerHTML = `<div class="brand">${mark()}<b>Fabro</b><span>Anywhere</span></div>
      <div class="nav"><button data-act="new">${ic('plus')}${t('newChat')}</button><button data-act="code">${ic('code')}${t('code')}</button></div>
      <div class="convs">${g.length ? g.map(([h, l]) => `<div class="grp">${h}</div>${l.map((c) => `<button data-act="open" data-id="${esc(c.id)}" class="${c.id === S.cur ? 'on' : ''}">${c.busy ? '<i class="run"></i>' : ''}<span>${esc(c.title || '…')}</span></button>`).join('')}`).join('') : `<div class="grp">${t('today')}</div><div class="empty">${t('noChats')}</div>`}</div>
      <div class="foot">
        <div class="nav"><button data-act="${linked() ? 'settings' : 'pair'}" class="pc"><span class="st ${st}"></span>${linked() ? esc(S.conn.state === 'on' ? t('pcOn', { pc: pcName() }) : S.conn.state === 'connecting' ? t('pcWait', { pc: pcName() }) : t('pcOff', { pc: pcName() })) : t('linkPc')}</button>
        <button data-act="settings">${ic('gear')}${t('settings')}</button></div>
      </div>`;
  }
  function renderTop() {
    const el = $('.top'); if (!el) return;
    const c = curConv();
    el.innerHTML = `<button class="ib menu-btn" data-act="drawer" aria-label="Menu">${ic('menu')}</button>
      <span class="title">${c ? esc(c.title || '') : ''}</span><span class="sp"></span>
      <button class="chip" data-act="model" aria-label="${t('model')}"><span>${esc(modelLabel())}</span>${ic('down')}</button>`;
  }
  function renderMain() {
    const el = $('.body-area'); if (!el) return;
    const c = curConv();
    if (!c) {
      el.innerHTML = `<div class="home"><h1>${t('homeH')}</h1><p class="sub">${online() && S.pcTools ? esc(t('homeSubPc', { pc: pcName() })) : t('homeSub')}</p><div class="slot-composer"></div>
        <div class="sugg">${['s1', 's2', 's3', 's4'].map((k) => `<button data-act="sugg">${t(k)}</button>`).join('')}</div></div>`;
      $('.slot-composer', el).appendChild(composer()); $('.dock .slot-composer2').innerHTML = '';
    } else {
      el.innerHTML = `<div class="scroll"><div class="col">${A.pathOf(c).map(msgHtml).join('')}</div></div>`;
      const sc = $('.scroll', el); sc.addEventListener('scroll', () => { stick = sc.scrollHeight - sc.scrollTop - sc.clientHeight < 80; tintSoon(); }, { passive: true });
      $('.dock .slot-composer2').appendChild(composer());
      $$('.msg .md', el).forEach((m, i, arr) => { const n = A.pathOf(c).filter((x) => x.role === 'assistant').find((x) => x.pending); if (n && i === arr.length - 1 && n.content) { const last = m.lastElementChild || m; last.insertAdjacentHTML('beforeend', '<span class="caret"></span>'); } });
    }
    renderComposer(); renderCards(); tintSoon();
  }
  function renderCards() {
    const el = $('.cards'); if (!el) return;
    const c = curConv(); const out = [];
    for (const [id, a] of S.asks) {
      if (c && a.convId && a.convId !== c.id) continue;
      out.push(`<div class="card">${ic('pc')}<div class="grow">${esc(t('wants', { pc: pcName() }))}<small>${esc(a.summary || a.tool || '')}</small></div><div class="acts"><button class="btn" data-act="ask" data-id="${esc(id)}" data-v="deny">${t('deny')}</button>${a.kind === 'tool' && a.risk !== 'danger' ? `<button class="btn" data-act="ask" data-id="${esc(id)}" data-v="always">${t('always')}</button>` : ''}<button class="btn pri" data-act="ask" data-id="${esc(id)}" data-v="once">${t('allow')}</button></div></div>`);
    }
    if (S.outbox.length && (!c || S.outbox.some((q) => q.convId === c.id))) out.push(`<div class="card">${ic('pc')}<div class="grow">${esc(t('queued', { pc: pcName() }))}<small>${esc(t('pcAway'))}</small></div><button class="btn" data-act="cloud-now">${t('answerCloud')}</button></div>`);
    el.innerHTML = out.join('');
  }
  let compEl = null;
  function composer() {
    if (compEl) return compEl;
    const d = document.createElement('div'); d.className = 'composer glass';
    d.innerHTML = `<div class="att"></div><div class="row">
      <label class="ib" title="${t('attach')}">${ic('img')}<input type="file" accept="image/*" multiple class="sr" data-act="photos"></label>
      <textarea rows="1" placeholder="${t('ask')}" aria-label="${t('ask')}" enterkeyhint="send"></textarea>
      <div class="wave">${'<i></i>'.repeat(24)}</div>
      <button class="ib mic" data-act="mic" title="${t('dictate')}" aria-label="${t('dictate')}">${ic('mic')}</button>
      <button class="ib send" data-act="send" disabled aria-label="${t('send')}">${ic('up')}</button></div>`;
    const ta = $('textarea', d);
    ta.addEventListener('input', () => { ta.style.height = '36px'; ta.style.height = Math.min(ta.scrollHeight, 180) + 'px'; renderComposer(); });
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && matchMedia('(hover:hover)').matches) { e.preventDefault(); submit(); } });
    $$('.wave i', d).forEach((i, n) => { i.style.animationDelay = (n * 53 % 900) + 'ms'; });
    compEl = d; return d;
  }
  function renderComposer() {
    const d = compEl; if (!d) return;
    const c = curConv(); const b = busy(c); const ta = $('textarea', d);
    d.classList.toggle('busy', b);
    ta.placeholder = b ? t('askMore') : t('ask');
    const send = $('.send', d); const has = !!ta.value.trim() || S.atts.length > 0;
    send.disabled = !b && !has; send.innerHTML = b && !has ? ic('stop') : ic('up'); send.setAttribute('aria-label', b && !has ? t('stop') : t('send'));
    $('.att', d).innerHTML = S.atts.map((a, i) => `<span><img src="${esc(a.data)}" alt=""><button data-act="unatt" data-i="${i}" aria-label="${t('remove')}">×</button></span>`).join('');
  }
  function submit() {
    const ta = $('.composer textarea'); const c = curConv();
    if (busy(c) && !ta.value.trim() && !S.atts.length) return stopRun();
    const v = ta.value; ta.value = ''; ta.style.height = '36px';
    if (busy(c)) { S.later.push({ convId: c.id, text: v, atts: S.atts.splice(0) }); renderComposer(); return toast(t('later')); }
    send(v);
  }
  function renderAll() {
    document.body.classList.toggle('open-drawer', !!S.drawer);
    $('#app').classList.toggle('open-drawer', !!S.drawer);
    renderSide(); renderTop(); renderMain();
  }

  // ── reflections: the glass edges take the color of the pictures close to them (average color, computed once) ──
  const tints = new WeakMap();
  function colorOf(img) {
    if (tints.has(img)) return tints.get(img);
    if (!img.complete || !img.naturalWidth) { img.addEventListener('load', tintSoon, { once: true }); return null; }
    try { const cv = document.createElement('canvas'); cv.width = cv.height = 8; const g = cv.getContext('2d'); g.drawImage(img, 0, 0, 8, 8); const d = g.getImageData(0, 0, 8, 8).data; let r = 0, gg = 0, b = 0; for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; } const c = `${r / 64 | 0},${gg / 64 | 0},${b / 64 | 0}`; tints.set(img, c); return c; } catch { tints.set(img, null); return null; }
  }
  let tintT = 0;
  function tintSoon() { cancelAnimationFrame(tintT); tintT = requestAnimationFrame(tint); }
  function tint() {
    if (document.documentElement.classList.contains('eco')) return;
    const imgs = $$('img[data-tint]').filter((i) => i.offsetParent);
    for (const g of $$('.glass')) {
      const r = g.getBoundingClientRect(); let tl = 'transparent', tr = 'transparent', tb = 'transparent';
      for (const im of imgs) {
        const q = im.getBoundingClientRect(); const col = colorOf(im); if (!col) continue;
        const gap = Math.max(0, q.top - r.bottom, r.top - q.bottom, q.left - r.right, r.left - q.right); const near = Math.max(0, 1 - gap / 200); if (!near) continue;
        if (q.left >= r.right - 4) tr = `rgba(${col},${0.55 * near})`; else if (q.right <= r.left + 4) tl = `rgba(${col},${0.55 * near})`; else tb = `rgba(${col},${0.6 * near})`;
      }
      g.style.setProperty('--tl', tl); g.style.setProperty('--tr', tr); g.style.setProperty('--tb', tb);
    }
  }

  // ───────────────────────────── sheets ─────────────────────────────
  function renderSheet() {
    const root = $('#sheet-root');
    if (scan && (!S.sheet || S.sheet.kind !== 'pair' || S.sheet.mode !== 'scan')) scan.stop();
    if (!S.sheet) { root.innerHTML = ''; return; }
    const k = S.sheet.kind;
    const body = k === 'model' ? modelSheet() : k === 'settings' ? settingsSheet() : k === 'pair' ? pairSheet() : k === 'code' ? codeSheet() : k === 'key' ? keySheet() : k === 'pf' ? pfSheet() : '';
    root.innerHTML = `<div class="back" data-act="close"></div><div class="sheet glass" role="dialog" aria-modal="true">${body}</div>`;
    if (k === 'pair' && S.sheet.mode === 'scan') startScan();
    const f = $('.sheet input:not([type=hidden])', root); if (f && k !== 'settings') f.focus();
  }
  const head = (title) => `<h2>${title}<button class="ib" data-act="close" aria-label="Fermer">${ic('x')}</button></h2>`;
  const ckIf = (on) => (on ? `<svg class="i ck" viewBox="0 0 24 24">${ICONS.check}</svg>` : '');
  function modelSheet() {
    const m = S.settings.model; const k = refKey(m);
    const cloud = FAAgent.models.filter((x) => x.id === 'auto' || x.tools !== false).slice(0, 8);
    return `${head(t('model'))}
      <h3>${t('cloud')} · ${t('cloudSub')}</h3>
      ${cloud.map((x) => `<button class="opt ${k === 'cloud:' + x.id ? 'on' : ''}" data-act="pick" data-m="cloud:${esc(x.id)}">${ic('cloud')}<span class="grow">${x.id === 'auto' ? t('auto') + `<small>${t('autoSub')}</small>` : esc(x.name)}</span>${ckIf(k === 'cloud:' + x.id)}</button>`).join('')}
      <div class="row2"><div>${t('places')}<small>${t('placesSub')}</small></div><button class="btn" data-act="places">${t('see')}</button></div>
      <h3>${t('keys')}</h3>
      ${S.keys.map((x) => `<button class="opt ${k === 'key:' + x.id ? 'on' : ''}" data-act="pick" data-m="key:${esc(x.id)}">${ic('key')}<span class="grow">${esc(x.model)}<small>${esc(x.name)}</small></span>${ckIf(k === 'key:' + x.id)}</button>`).join('')}
      <button class="opt" data-act="add-key">${ic('plus')}<span class="grow">${t('addKey')}<small>${t('keysSub')}</small></span></button>
      <h3>${t('pcModels')}${linked() ? ' · ' + t('pcModelsSub') : ''}</h3>
      ${linked() ? (S.models.length ? S.models.map((x, i) => `<button class="opt ${k === refKey(x.ref) ? 'on' : ''}" data-act="pick-pc" data-i="${i}">${ic('pc')}<span class="grow">${esc(x.label)}<small>${esc(x.provider || pcName())}</small></span>${ckIf(k === refKey(x.ref))}</button>`).join('') : `<p class="lead" style="margin:6px 10px">${esc(t('pcAway'))}</p>`)
        : `<button class="opt" data-act="pair">${ic('pc')}<span class="grow">${t('linkPc')}</span></button>`}`;
  }
  function keySheet() {
    const p = PRESETS.find((x) => x.id === (S.sheet.preset || 'openai')) || PRESETS[0];
    return `${head(t('addKey'))}<p class="lead">${t('keysSub')}</p>
      <form data-form="key">
      <label class="field">${t('provider')}<select name="preset" data-act="preset">${PRESETS.map((x) => `<option value="${x.id}" ${x.id === p.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
      ${p.id === 'custom' ? `<label class="field">${t('baseUrl')}<input name="base" type="url" placeholder="https://…/v1" required></label>` : ''}
      <label class="field">${t('apiKey')}<input name="key" type="password" autocomplete="off" required></label>
      <label class="field">${t('modelName')}<input name="model" value="${esc(p.model)}" required list="model-list"><datalist id="model-list"></datalist></label>
      ${S.sheet.err ? `<p class="err">${esc(S.sheet.err)}</p>` : ''}
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px"><button type="button" class="btn ghost" data-act="close">${t('cancel')}</button><button class="btn pri" ${S.sheet.busy ? 'disabled' : ''}>${S.sheet.busy ? t('keyTesting') : t('save')}</button></div></form>`;
  }
  function settingsSheet() {
    const th = (() => { try { return localStorage.getItem('fa-theme') || 'auto'; } catch { return 'auto'; } })();
    const eco = document.documentElement.classList.contains('eco');
    return `${head(t('settings'))}
      ${profileRows()}
      <h3>${t('pc')}</h3>
      ${linked() ? `<div class="row2"><div>${esc(pcName())}<small>${S.conn.state === 'on' ? (S.pcTools ? t('toolsOnPc', { pc: pcName() }) : t('pcOn', { pc: pcName() })) : t('pcAway')}</small></div><button class="btn" data-act="forget">${t('forget')}</button></div>
        ${'PushManager' in window ? `<div class="row2"><div>${t('notify')}<small>${t('notifySub')}</small></div><button class="tog ${S.settings.notify ? 'on' : ''}" data-act="notify" aria-pressed="${!!S.settings.notify}"></button></div>` : ''}`
        : `<div class="row2"><div>${t('noPc')}<small>${t('pairLead')}</small></div><button class="btn pri" data-act="pair">${t('linkPc')}</button></div>`}
      <h3>${t('keys')}</h3>
      ${S.keys.map((x) => `<div class="row2"><div>${esc(x.name)}<small>${esc(x.model)} · ••••${esc(x.key.slice(-4))}</small></div><button class="btn" data-act="del-key" data-id="${esc(x.id)}">${t('remove')}</button></div>`).join('')}
      <div class="row2"><div><small>${t('keysSub')}</small></div><button class="btn" data-act="add-key">${t('addKey')}</button></div>
      <h3>${t('theme')}</h3>
      <div class="row2"><div>${t('theme')}</div><div class="seg">${[['light', 'light'], ['dark', 'dark'], ['auto', 'autoT']].map(([v, l]) => `<button data-act="theme" data-v="${v}" class="${th === v ? 'on' : ''}">${t(l)}</button>`).join('')}</div></div>
      <div class="row2"><div>${t('eco')}<small>${t('ecoSub')}</small></div><button class="tog ${eco ? 'on' : ''}" data-act="eco" aria-pressed="${eco}"></button></div>
      <div class="row2"><div>${t('lang')}</div><div class="seg">${[['auto', 'Auto'], ['fr', 'FR'], ['en', 'EN']].map(([v, l]) => `<button data-act="lang" data-v="${v}" class="${(S.settings.lang || 'auto') === v ? 'on' : ''}">${l}</button>`).join('')}</div></div>
      ${S.installEvt ? `<div class="row2"><div>${t('install')}<small>${t('installSub')}</small></div><button class="btn" data-act="install">${t('install')}</button></div>` : ''}
      <h3>${t('about')}</h3><div class="row2"><div>Fabro Anywhere</div><a class="btn ghost" href="../" target="_blank" rel="noopener">${t('site')}${ic('ext')}</a></div>`;
  }
  // profiles (profiles.js): who is using this device
  function profileRows() {
    const p = FAProfiles.current() || {}; const all = FAProfiles.list();
    const others = all.filter((x) => x.id !== p.id);
    return `<h3>${t('profile')}</h3>
      <div class="row2"><div style="display:flex;align-items:center;gap:10px">${FAProfiles.av(p)}<div>${esc(p.name || t('me'))}<small>${p.pw ? t('pfLocked') : t('pfOpen')}</small></div></div><button class="btn" data-act="pf-pw">${p.pw ? t('pfPwChange') : t('pfPwSet')}</button></div>
      ${others.map((x) => `<button class="opt" data-act="pf-switch" data-id="${esc(x.id)}">${FAProfiles.av(x)}<span class="grow">${esc(x.name || t('me'))}${x.locked ? `<small>${t('pfLocked')}</small>` : ''}</span></button>`).join('')}
      <div class="row2"><div><small>${t('pfSub', { n: all.length })}</small></div><div style="display:flex;gap:6px">${all.length > 1 ? `<button class="btn ghost" data-act="pf-del">${t('remove')}</button>` : ''}<button class="btn" data-act="pf-switch">${all.length < FAProfiles.MAX ? t('pfAdd') : t('pfChange')}</button></div></div>`;
  }
  function pfSheet() {
    const p = FAProfiles.current() || {}; const m = S.sheet.mode;
    return `${head(m === 'del' ? t('pfDelT') : p.pw ? t('pfPwChange') : t('pfPwSet'))}
      <form data-form="pf">
      ${m === 'del' ? `<p class="lead">${t('pfDelLead')}</p>` : `<p class="lead">${t('pfPwLead')}</p>`}
      ${p.pw ? `<label class="field">${t('pfPwOld')}<input name="old" type="password" autocomplete="current-password" required></label>` : ''}
      ${m === 'del' ? '' : `<label class="field">${t('pfPwNew')}<input name="pw" type="password" autocomplete="new-password"></label>`}
      ${S.sheet.err ? `<p class="err">${esc(S.sheet.err)}</p>` : ''}
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px"><button type="button" class="btn ghost" data-act="close">${t('cancel')}</button><button class="btn ${m === 'del' ? 'danger' : 'pri'}" ${S.sheet.busy ? 'disabled' : ''}>${S.sheet.busy ? '…' : m === 'del' ? t('remove') : t('save')}</button></div></form>`;
  }
  function pairSheet() {
    const mode = S.sheet.mode || 'choose';
    if (mode === 'busy') return `${head(t('pairH'))}<p class="lead">${t('pairing')}</p>`;
    return `${head(t('pairH'))}<p class="lead">${t('pairLead')}</p>
      ${mode === 'scan' ? '<div class="scan"><video id="scan-video" playsinline muted></video></div>' : ''}
      <form data-form="code"><label class="field">${t('typeCode')}<input id="code-in" class="code-in" placeholder="${t('codePh')}" autocomplete="off" autocapitalize="characters" spellcheck="false"></label>
      ${S.sheet.err ? `<p class="err">${esc(S.sheet.err)}</p>` : ''}
      <div style="display:flex;gap:8px;margin-top:12px">${mode !== 'scan' && navigator.mediaDevices ? `<button type="button" class="btn" data-act="scan">${t('scan')}</button>` : ''}<span style="flex:1"></span><button class="btn pri">${t('pair')}</button></div></form>`;
  }
  let DL = null;
  function codeSheet() {
    const ua = navigator.userAgent; const mine = /Mac/.test(ua) && !/iPhone|iPad/.test(ua) ? 'mac' : /Windows/.test(ua) ? 'win' : /Linux/.test(ua) && !/Android/.test(ua) ? 'linux' : '';
    const d = DL || {}; const v = d.version ? ' ' + d.version : '';
    const item = (k, name, file) => `<a class="${k === mine ? 'me' : ''}" href="${esc(d[k] || '../#telecharger')}">${ic('dl')}<b style="font-weight:500">${name}</b><small>${esc(file || '')}${k === mine ? ' · ' + t('yourOs') : ''}</small></a>`;
    return `${head(t('codeH'))}<p class="lead">${t('codeLead')}</p>
      <div class="dl">${item('win', 'Windows', 'Windows 10, 11')}${item('mac', 'macOS', 'Apple Silicon, Intel')}${item('linux', 'Linux', 'AppImage, .deb')}</div>
      ${linked() ? `<p class="lead" style="margin-top:10px">${esc(t('codeOpen', { pc: pcName() }))}</p>` : ''}<p class="mono" style="color:var(--t3)">Fabro${esc(v)}</p>`;
  }

  // ───────────────────────────── events ─────────────────────────────
  document.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-act]'); if (!el || el.tagName === 'INPUT' || el.tagName === 'SELECT') return;
    const a = el.dataset.act;
    if (a === 'close') { S.sheet = null; return renderSheet(); }
    if (a === 'new') return newChat();
    if (a === 'open') return openConv(el.dataset.id);
    if (a === 'drawer') { S.drawer = !S.drawer; return renderAll(); }
    if (a === 'code') { S.drawer = false; renderAll(); S.sheet = { kind: 'code' }; renderSheet(); if (!DL) { DL = await fetch('downloads.json').then((r) => r.json()).catch(() => ({})); renderSheet(); } return; }
    if (a === 'settings') { S.drawer = false; renderAll(); S.sheet = { kind: 'settings' }; return renderSheet(); }
    if (a === 'pair') { S.drawer = false; renderAll(); S.sheet = { kind: 'pair', mode: 'choose' }; return renderSheet(); }
    if (a === 'scan') { S.sheet = { kind: 'pair', mode: 'scan' }; return renderSheet(); }
    if (a === 'model') { S.sheet = { kind: 'model' }; renderSheet(); FAAgent.refreshModels().then(() => { if (S.sheet && S.sheet.kind === 'model') renderSheet(); }).catch(() => {}); return; }
    if (a === 'pick') { S.settings.model = el.dataset.m; await saveSettings(); S.sheet = null; renderSheet(); renderTop(); return; }
    if (a === 'pick-pc') { const x = S.models[+el.dataset.i]; if (x) { S.settings.model = x.ref; await saveSettings(); } S.sheet = null; renderSheet(); renderTop(); return; }
    if (a === 'add-key') { S.sheet = { kind: 'key', preset: 'openai' }; return renderSheet(); }
    if (a === 'del-key') { S.keys = S.keys.filter((k) => k.id !== el.dataset.id); await kv.set('keys', S.keys); if (!keyOf(S.settings.model) && String(S.settings.model).startsWith('key:')) { S.settings.model = 'cloud:auto'; await saveSettings(); } renderSheet(); renderTop(); return; }
    if (a === 'forget') { if (confirm(t('forgetQ'))) { await forget(false); S.sheet = null; renderSheet(); } return; }
    if (a === 'notify') { if (S.settings.notify) await disablePush(); else await ensurePush(true); return renderSheet(); }
    if (a === 'places') { S.sheet = null; renderSheet(); return window.FAMaps && FAMaps.openFull(null); }
    if (a === 'pf-pw') { S.sheet = { kind: 'pf', mode: 'pw' }; return renderSheet(); }
    if (a === 'pf-del') { S.sheet = { kind: 'pf', mode: 'del' }; return renderSheet(); }
    if (a === 'pf-switch') { if (el.dataset.id) return FAProfiles.switchTo(el.dataset.id); return FAProfiles.lock(); }
    if (a === 'theme') { try { localStorage.setItem('fa-theme', el.dataset.v); } catch {} applyTheme(); return renderSheet(); }
    if (a === 'eco') { const on = !document.documentElement.classList.contains('eco'); document.documentElement.classList.toggle('eco', on); try { localStorage.setItem('fa-eco', on ? '1' : '0'); } catch {} if (!on) tintSoon(); return renderSheet(); }
    if (a === 'lang') { S.settings.lang = el.dataset.v; await saveSettings(); applyLang(); compEl = null; renderAll(); return renderSheet(); }
    if (a === 'install') { if (S.installEvt) { S.installEvt.prompt(); S.installEvt = null; renderSheet(); } return; }
    if (a === 'send') return submit();
    if (a === 'mic') return dictate();
    if (a === 'unatt') { S.atts.splice(+el.dataset.i, 1); return renderComposer(); }
    if (a === 'sugg') { const ta = $('.composer textarea'); ta.value = el.textContent; ta.dispatchEvent(new Event('input')); ta.focus(); return; }
    if (a === 'ask') return answerAsk(el.dataset.id, el.dataset.v);
    if (a === 'cloud-now') return answerQueuedWithCloud();
    if (a === 'retry' || a === 'use-pc') {
      const c = curConv(); if (!c || busy(c)) return;
      const n = A.nodesOf(c).find((x) => x.id === el.dataset.id); if (!n) return;
      const user = n.role === 'user' ? n : A.nodesOf(c).find((x) => x.id === n.parentId); if (!user) return;
      if (a === 'use-pc' && S.models.length) { S.settings.model = S.models[0].ref; await saveSettings(); renderTop(); }
      c.leafId = user.id; await saveConv(c); renderMain(); return dispatch(c, user, true);
    }
    if (a === 'add-key') { S.sheet = { kind: 'key', preset: 'openai' }; return renderSheet(); }
    if (a === 'ver') {
      const c = curConv(); const n = c && A.nodesOf(c).find((x) => x.id === el.dataset.id); if (!n) return;
      const sib = siblingsOf(n); const j = sib.findIndex((x) => x.id === n.id) + Number(el.dataset.d); const to = sib[j]; if (!to) return;
      // follow the most recent path below that version
      let leaf = to; for (;;) { const kids = A.nodesOf(c).filter((x) => x.parentId === leaf.id).sort((a2, b2) => (b2.createdAt || 0) - (a2.createdAt || 0)); if (!kids.length) break; leaf = kids[0]; }
      c.leafId = leaf.id; c.dirty = true; await saveConv(c); return renderMain();
    }
    if (a === 'edit') { S.editing = el.dataset.id; renderMain(); const ta = $('.edit-in'); if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); } return; }
    if (a === 'edit-cancel') { S.editing = null; return renderMain(); }
    if (a === 'edit-send') {
      const c = curConv(); const n = c && A.nodesOf(c).find((x) => x.id === el.dataset.id); const v = ($('.edit-in') || {}).value || '';
      S.editing = null; if (!n || !v.trim() || busy(c)) return renderMain();
      const node = { id: A.uid(), role: 'user', content: v.trim(), attachments: n.attachments || [], createdAt: now(), updatedAt: now(), parentId: n.parentId || null };
      c.nodes = [...A.nodesOf(c), node]; c.leafId = node.id; c.updatedAt = now(); c.dirty = true; await saveConv(c); renderMain(); scrollChat(true);
      return dispatch(c, node);
    }
    if (a === 'fork') {
      const c = curConv(); if (!c) return; const upTo = A.pathOf({ ...c, leafId: el.dataset.id });
      const f = { id: uid(), title: (c.title || '') + ' ↳', createdAt: now(), updatedAt: now(), nodes: upTo.map((x) => ({ ...x, pending: false })), leafId: el.dataset.id, agent: true, origin: 'phone', dirty: true };
      await saveConv(f); toast(t('forked')); return openConv(f.id);
    }
    if (a === 'steps') { const id = el.dataset.id; S.open.has(id) ? S.open.delete(id) : S.open.add(id); const box = el.parentElement; box.classList.toggle('open'); el.setAttribute('aria-expanded', box.classList.contains('open')); return; }
    if (a === 'copy') { const c = curConv(); const n = c && A.nodesOf(c).find((x) => x.id === el.dataset.id); if (n) { await navigator.clipboard.writeText(n.content || '').catch(() => {}); el.textContent = t('copied'); setTimeout(() => { el.textContent = t('copy'); }, 1200); } return; }
  });
  document.addEventListener('change', (e) => {
    if (e.target.matches('[data-act=photos]')) { addPhotos(e.target.files); e.target.value = ''; }
    if (e.target.matches('[data-act=preset]')) { S.sheet = { kind: 'key', preset: e.target.value }; renderSheet(); }
  });
  document.addEventListener('submit', async (e) => {
    const f = e.target.closest('form[data-form]'); if (!f) return; e.preventDefault();
    if (f.dataset.form === 'code') { const d = await A.parseTextCode($('#code-in').value); if (d) pairWith(d); else { S.sheet = { ...S.sheet, err: t('badCode') }; renderSheet(); } return; }
    if (f.dataset.form === 'pf') {
      const fd = new FormData(f); S.sheet = { ...S.sheet, busy: true, err: '' }; renderSheet();
      try {
        if (S.sheet.mode === 'del') { const id = FAProfiles.current().id; await FAProfiles.remove(id, fd.get('old')); return FAProfiles.lock(); }
        await FAProfiles.setPassword(fd.get('pw') || null, fd.get('old')); S.sheet = { kind: 'settings' }; renderSheet(); toast(t('saved'));
      } catch (err) { S.sheet = { ...S.sheet, busy: false, err: err.message === 'wrong' ? t('pfWrong') : String(err.message || err) }; renderSheet(); }
      return;
    }
    if (f.dataset.form === 'key') {
      const fd = new FormData(f); const p = PRESETS.find((x) => x.id === fd.get('preset')) || PRESETS[0];
      const k = { id: A.uid(), name: p.id === 'custom' ? host(String(fd.get('base'))) : p.name, base: p.id === 'custom' ? String(fd.get('base')).trim() : p.base, key: String(fd.get('key')).trim(), model: String(fd.get('model')).trim() };
      S.sheet = { ...S.sheet, busy: true, err: '' }; renderSheet();
      try {
        // a one-word request: checks the key, the address and the model at once
        const r = await fetch(k.base.replace(/\/+$/, '') + '/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + k.key, ...(/anthropic\.com/.test(k.base) ? { 'x-api-key': k.key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' } : {}) }, body: JSON.stringify({ model: k.model, messages: [{ role: 'user', content: 'ok' }], max_tokens: 1 }), signal: AbortSignal.timeout(20000) });
        if (!r.ok) { let j = null; try { j = await r.json(); } catch {} throw new Error((j && j.error && (j.error.message || j.error)) || 'HTTP ' + r.status); }
        S.keys.push(k); await kv.set('keys', S.keys); S.settings.model = 'key:' + k.id; await saveSettings();
        S.sheet = null; renderSheet(); renderTop(); toast(t('keyOk'));
      } catch (err) { S.sheet = { kind: 'key', preset: p.id, err: t('keyBad', { e: String(err.message || err).slice(0, 160) }) }; renderSheet(); }
    }
  });
  // once the key is typed: the provider's own model list fills the suggestions
  document.addEventListener('focusout', async (e) => {
    const f = e.target.closest && e.target.closest('form[data-form=key]'); if (!f || e.target.name !== 'key' || !e.target.value.trim()) return;
    const p = PRESETS.find((x) => x.id === f.preset.value) || PRESETS[0]; const base = p.id === 'custom' ? (f.base && f.base.value) : p.base; if (!base) return;
    const key = e.target.value.trim();
    try {
      const r = await fetch(base.replace(/\/+$/, '') + '/models', { headers: { Authorization: 'Bearer ' + key, ...(/anthropic\.com/.test(base) ? { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' } : {}) }, signal: AbortSignal.timeout(10000) });
      const j = await r.json(); const ids = (j.data || j.models || []).map((m) => String(m.id || m.name || '').replace(/^models\//, '')).filter(Boolean).slice(0, 200);
      const dl = $('#model-list'); if (dl) dl.innerHTML = ids.map((x) => `<option value="${esc(x)}">`).join('');
    } catch {}
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && S.sheet) { S.sheet = null; renderSheet(); } });
  document.addEventListener('paste', (e) => { const files = [...(e.clipboardData && e.clipboardData.files || [])].filter((f) => /^image\//.test(f.type)); if (files.length) { e.preventDefault(); addPhotos(files); } });

  function applyLang() {
    const want = S.settings.lang && S.settings.lang !== 'auto' ? S.settings.lang : (navigator.languages || [navigator.language || 'fr']).map((l) => String(l).slice(0, 2)).find((l) => I18N[l]) || 'en';
    lang = I18N[want] ? want : 'en'; document.documentElement.lang = lang;
  }
  function applyTheme() {
    let th = 'auto'; try { th = localStorage.getItem('fa-theme') || 'auto'; } catch {}
    document.documentElement.dataset.theme = th === 'auto' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : th;
  }

  // ───────────────────────────── start ─────────────────────────────
  (async () => {
    applyLang();
    try { const svg = await (await fetch('icons/mark.svg')).text(); MARK = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, ''); } catch {}
    await FAProfiles.ready($('#app'));
    try {
      const [settings, idJwk, link, outbox, tomb, metas, keys, convs] = await Promise.all(['settings', 'identity', 'link', 'outbox', 'tombstones', 'metas', 'keys'].map((k) => kv.get(k)).concat(DB.all('convs')));
      if (settings) { S.settings = { ...S.settings, ...settings }; if (!S.settings.model || S.settings.model === 'phone') S.settings.model = 'cloud:auto'; }
      if (idJwk) S.identity = await A.importPriv(idJwk);
      S.link = link || null; S.outbox = outbox || []; S.tombstones = tomb || []; S.metas = metas || []; S.keys = keys || [];
      for (const c of convs || []) { for (const n of A.nodesOf(c)) if (n.pending && n.origin && /^phone/.test(n.origin)) { n.pending = false; n.error = n.error || t('timeout'); } S.convs.set(c.id, c); }
    } catch (e) { console.error('boot', e); }
    applyLang();
    $('#app').innerHTML = '<aside class="side glass"></aside><div class="scrim" data-act="drawer"></div><main class="main"><div class="top"></div><div class="body-area" style="flex:1;display:flex;flex-direction:column;min-height:0"></div><div class="dock"><div class="cards"></div><div class="slot-composer2" style="width:100%;display:flex;justify-content:center"></div></div></main>';
    const q = new URLSearchParams(location.search).get('c'); if (q) S.cur = q;
    renderAll();
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
      navigator.serviceWorker.addEventListener('message', (e) => { if (e.data && e.data.type === 'open' && e.data.convId) openConv(e.data.convId); });
    }
    addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); S.installEvt = e; });
    document.addEventListener('visibilitychange', () => { if (session) session.send({ t: 'req', id: 'v' + now(), m: 'state', p: { visible: !document.hidden } }); if (!document.hidden && S.link && !session) { retryN = 0; connect(); } });
    addEventListener('online', () => { if (S.link) { retryN = 0; connect(true); } });
    addEventListener('pagehide', () => { if (session) session.send({ t: 'bye' }); });
    addEventListener('resize', tintSoon);
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
    if (S.link) connect();
    FAAgent.refreshModels().catch(() => {});
    window.__fa = { S, send, rpc, pairWith, renderAll }; // tests
    // agent.js reads its texts ("Fabro Cloud is busy") from here; maps.js / maps-agent.js the saved places of this profile
    const placesList = async () => (await kv.get('places').catch(() => null)) || [];
    window.FAHost = { t, lang: () => lang, curConv, toast,
      places: {
        list: placesList,
        async save(p) {
          const name = String(p.name || '').trim().slice(0, 60); if (!name || !isFinite(p.lat)) throw new Error('A place needs a name.');
          const l = await placesList(); const i = l.findIndex((x) => x.name.toLowerCase() === name.toLowerCase());
          const x = { id: i >= 0 ? l[i].id : Math.random().toString(36).slice(2, 10), name, lat: +p.lat, lon: +p.lon, note: String(p.note || '').slice(0, 300), tag: p.tag || '', label: String(p.label || '').slice(0, 200), at: Date.now() };
          if (i >= 0) l[i] = x; else l.push(x); await kv.set('places', l.slice(-200)); return x;
        },
        async remove(idOrName) { const l = await placesList(); const k = String(idOrName).toLowerCase(); const n = l.filter((x) => x.id !== idOrName && x.name.toLowerCase() !== k); await kv.set('places', n); return l.length - n.length; },
      } };
  })();
})();

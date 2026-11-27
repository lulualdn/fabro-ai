'use strict';
// Profiles in Fabro Anywhere: up to 4 per device, each with its own conversations, keys and linked computer.
// - Each profile has its own IndexedDB database (the first one keeps the historic name, so nothing moves).
// - A password is optional. With one, the profile's data is encrypted on the device (AES-GCM, key from the password
//   with PBKDF2-SHA-256, 310 000 rounds); without it, the data is readable by anyone who has the unlocked device.
// - Switching profile reloads the page: nothing of one profile stays in memory for the next one.
// - The list (names, colors, salt, a check value) is in localStorage 'fa-profiles'.
window.FAProfiles = (function () {
  const MAX = 4; const ITER = 310000;
  const COLORS = ['#e8603c', '#3f8f6b', '#4f6fd6', '#b0558f'];
  const LS = 'fa-profiles';
  const enc = new TextEncoder(), dec = new TextDecoder();
  const b64 = (u) => btoa(String.fromCharCode(...new Uint8Array(u)));
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const rid = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, '0')).join('');

  function load() {
    let r = null; try { r = JSON.parse(localStorage.getItem(LS) || 'null'); } catch {}
    if (!r || !Array.isArray(r.list) || !r.list.length) r = { list: [{ id: 'main', name: '', color: COLORS[0], db: 'fabro-anywhere', pw: null }], last: 'main' };
    return r;
  }
  let reg = load();
  const save = () => { try { localStorage.setItem(LS, JSON.stringify(reg)); } catch {} };
  let cur = null; let key = null;

  async function derive(pw, salt) {
    const base = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITER }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function sealWith(k, v) { const iv = crypto.getRandomValues(new Uint8Array(12)); const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, enc.encode(JSON.stringify(v))); return { _enc: 1, iv: b64(iv), ct: b64(ct) }; }
  async function openWith(k, box) { const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(box.iv) }, k, unb64(box.ct)); return JSON.parse(dec.decode(pt)); }
  async function check(p, pw) { try { const k = await derive(pw, unb64(p.pw.salt)); await openWith(k, p.pw.check); return k; } catch { return null; } }

  // storage hooks used by app.js: values are sealed when the profile has a password
  async function seal(v, id) { if (!key) return v; const box = await sealWith(key, v); return id !== undefined ? { id, ...box } : box; }
  async function open(v) { if (!v || !v._enc) return v; if (!key) throw new Error('locked'); return openWith(key, v); }

  // ── data of a profile (for create / password change / delete) ──
  function idb(name) { return new Promise((res, rej) => { const r = indexedDB.open(name, 1); r.onupgradeneeded = () => { r.result.createObjectStore('kv'); r.result.createObjectStore('convs', { keyPath: 'id' }); }; r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
  const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  // rewrite every value of a profile from one key (or none) to another (or none)
  async function rekey(p, from, to) {
    const db = await idb(p.db);
    const tr = db.transaction(['kv', 'convs'], 'readonly');
    const kvKeys = await req(tr.objectStore('kv').getAllKeys()); const kvVals = await req(tr.objectStore('kv').getAll()); const convs = await req(tr.objectStore('convs').getAll());
    const plain = async (v) => (v && v._enc ? openWith(from, v) : v);
    const outKv = []; for (let i = 0; i < kvKeys.length; i++) { const v = await plain(kvVals[i]); outKv.push([kvKeys[i], to ? await sealWith(to, v) : v]); }
    const outC = []; for (const c of convs) { const v = await plain(c); outC.push(to ? { id: c.id, ...(await sealWith(to, v)) } : v); }
    await new Promise((res, rej) => { const w = db.transaction(['kv', 'convs'], 'readwrite'); for (const [k, v] of outKv) w.objectStore('kv').put(v, k); for (const c of outC) w.objectStore('convs').put(c); w.oncomplete = res; w.onerror = () => rej(w.error); });
    db.close();
  }
  async function setPassword(newPw, oldPw) {
    const p = current(); let from = null;
    if (p.pw) { from = await check(p, oldPw || ''); if (!from) throw new Error('wrong'); }
    let to = null, pw = null;
    if (newPw) { const salt = crypto.getRandomValues(new Uint8Array(16)); to = await derive(newPw, salt); pw = { salt: b64(salt), check: await sealWith(to, 'fabro') }; }
    await rekey(p, from, to);
    p.pw = pw; save(); key = to;
  }
  async function create(name, pw) {
    if (reg.list.length >= MAX) throw new Error('max');
    const id = rid(); const p = { id, name: String(name || '').trim().slice(0, 24) || '?', color: COLORS.find((c) => !reg.list.some((x) => x.color === c)) || COLORS[reg.list.length % 4], db: 'fabro-anywhere-' + id, pw: null };
    if (pw) { const salt = crypto.getRandomValues(new Uint8Array(16)); const k = await derive(pw, salt); p.pw = { salt: b64(salt), check: await sealWith(k, 'fabro') }; }
    reg.list.push(p); save(); return p;
  }
  async function remove(id, pw) {
    const p = reg.list.find((x) => x.id === id); if (!p || reg.list.length < 2) throw new Error('last');
    if (p.pw && !(await check(p, pw || ''))) throw new Error('wrong');
    await new Promise((res) => { const r = indexedDB.deleteDatabase(p.db); r.onsuccess = r.onerror = r.onblocked = () => res(); });
    reg.list = reg.list.filter((x) => x.id !== id); if (reg.last === id) reg.last = reg.list[0].id; save();
  }
  const current = () => cur;
  const dbName = () => (cur ? cur.db : 'fabro-anywhere');
  function switchTo(id) { const p = reg.list.find((x) => x.id === id); reg.last = id; save(); if (p && !p.pw) sessionStorage.setItem('fa-open', id); else { sessionStorage.removeItem('fa-open'); sessionStorage.setItem('fa-want', id); } location.reload(); }
  function lock() { sessionStorage.removeItem('fa-open'); location.reload(); }
  function rename(name) { if (!cur) return; cur.name = String(name || '').trim().slice(0, 24); save(); }

  // ── picker (shown at start when there are several profiles, or the last one has a password) ──
  const L = () => (String((navigator.languages || [navigator.language || 'en'])[0]).slice(0, 2) === 'fr' ? 'fr' : 'en');
  const TX = {
    fr: { who: 'Qui utilise Fabro ?', add: 'Ajouter un profil', name: 'Prénom', pw: 'Mot de passe (facultatif)', pwHelp: 'Avec un mot de passe, les conversations et les clés de ce profil sont chiffrées sur cet appareil.', create: 'Créer', cancel: 'Annuler', unlock: 'Ouvrir', wrong: 'Mot de passe incorrect.', max: '4 profils au plus sur cet appareil.', me: 'Moi' },
    en: { who: 'Who is using Fabro?', add: 'Add a profile', name: 'Name', pw: 'Password (optional)', pwHelp: 'With a password, this profile’s chats and keys are encrypted on this device.', create: 'Create', cancel: 'Cancel', unlock: 'Open', wrong: 'Wrong password.', max: '4 profiles at most on this device.', me: 'Me' },
  };
  const tx = (k) => TX[L()][k];
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const av = (p, big) => `<span class="pf-av${big ? ' big' : ''}" style="background:${esc(p.color)}">${esc((p.name || tx('me')).slice(0, 1).toUpperCase())}</span>`;
  const lockIc = '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';

  function picker(root, mode = { k: 'list' }) {
    return new Promise((resolve) => {
      const draw = () => {
        let body = '';
        if (mode.k === 'list') {
          body = `<h1>${tx('who')}</h1><div class="pf-grid">${reg.list.map((p) => `<button class="pf-card" data-pf="${esc(p.id)}">${av(p, true)}<span>${esc(p.name || tx('me'))}${p.pw ? lockIc : ''}</span></button>`).join('')}
            ${reg.list.length < MAX ? `<button class="pf-card add" data-pf-add>${'<span class="pf-av big plus">+</span>'}<span>${tx('add')}</span></button>` : ''}</div>`;
        } else if (mode.k === 'pw') {
          const p = reg.list.find((x) => x.id === mode.id);
          body = `<form class="pf-form" data-pf-form="pw">${av(p, true)}<h1>${esc(p.name || tx('me'))}</h1><input class="pf-in" type="password" name="pw" autocomplete="current-password" aria-label="${tx('pw')}" required>${mode.err ? `<p class="pf-err">${esc(mode.err)}</p>` : ''}<div class="pf-acts"><button type="button" class="btn ghost" data-pf-back>${tx('cancel')}</button><button class="btn pri">${mode.busy ? '…' : tx('unlock')}</button></div></form>`;
        } else {
          body = `<form class="pf-form" data-pf-form="new"><h1>${tx('add')}</h1><label>${tx('name')}<input class="pf-in" name="name" maxlength="24" required></label><label>${tx('pw')}<input class="pf-in" type="password" name="pw" autocomplete="new-password"></label><p class="pf-help">${tx('pwHelp')}</p>${mode.err ? `<p class="pf-err">${esc(mode.err)}</p>` : ''}<div class="pf-acts"><button type="button" class="btn ghost" data-pf-back>${tx('cancel')}</button><button class="btn pri">${mode.busy ? '…' : tx('create')}</button></div></form>`;
        }
        root.innerHTML = `<div class="pf-wrap">${body}</div>`;
        const f = root.querySelector('input'); if (f) f.focus();
      };
      const pick = async (p, pw) => {
        if (p.pw) { const k = await check(p, pw || ''); if (!k) return false; key = k; }
        cur = p; reg.last = p.id; save(); sessionStorage.setItem('fa-open', p.id);
        root.innerHTML = ''; resolve(p); return true;
      };
      root.onclick = (e) => {
        const c = e.target.closest('[data-pf]'); if (c) { const p = reg.list.find((x) => x.id === c.dataset.pf); if (p.pw) { mode = { k: 'pw', id: p.id }; draw(); } else pick(p); return; }
        if (e.target.closest('[data-pf-add]')) { mode = { k: 'new' }; draw(); return; }
        if (e.target.closest('[data-pf-back]')) { mode = { k: 'list' }; draw(); }
      };
      root.onsubmit = async (e) => {
        e.preventDefault(); const fd = new FormData(e.target);
        mode.busy = true; draw();
        if (e.target.dataset.pfForm === 'pw') { const ok = await pick(reg.list.find((x) => x.id === mode.id), fd.get('pw')); if (!ok) { mode = { k: 'pw', id: mode.id, err: tx('wrong') }; draw(); } return; }
        try { const p = await create(fd.get('name'), fd.get('pw')); if (p.pw) { await pick(p, fd.get('pw')); } else pick(p); } catch (err) { mode = { k: 'new', err: err.message === 'max' ? tx('max') : String(err.message) }; draw(); }
      };
      draw();
    });
  }
  // called before the app reads its storage: resolves with the open profile
  async function ready(root) {
    const last = reg.list.find((x) => x.id === reg.last) || reg.list[0];
    // one profile, no password: straight in. Same tab already unlocked this one: no picker after a reload, except for a password.
    if (reg.list.length === 1 && !last.pw) { cur = last; return cur; }
    if (!last.pw && sessionStorage.getItem('fa-open') === last.id) { cur = last; return cur; }
    const want = sessionStorage.getItem('fa-want'); sessionStorage.removeItem('fa-want');
    const w = want && reg.list.find((x) => x.id === want && x.pw) ? want : last.pw && sessionStorage.getItem('fa-open') === last.id ? last.id : null; // same tab, locked profile: ask its password directly
    return picker(root, w ? { k: 'pw', id: w } : { k: 'list' });
  }
  return { MAX, ready, current, dbName, seal, open, create, remove, setPassword, switchTo, lock, rename, list: () => reg.list.map((p) => ({ id: p.id, name: p.name, color: p.color, locked: !!p.pw })), av };
})();

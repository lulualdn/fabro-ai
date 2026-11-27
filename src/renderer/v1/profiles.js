'use strict';
// Profile selector of the v1 interface: the name at the bottom of the side bar opens it. Up to 4 profiles on this
// computer (src/main/accounts), each with or without a password. Switching relaunches Fabro on the other profile
// (nothing of one profile stays in memory); a profile with a password asks for it in the start window.
window.V1Profiles = (function () {
  const T = {
    fr: { h: 'Profils', sub: '{n} sur {max} sur cet ordinateur. Chaque profil a ses conversations, sa mémoire et ses réglages.', add: 'Ajouter un profil', name: 'Prénom', pw: 'Mot de passe (facultatif)', pwHelp: 'Avec un mot de passe, Fabro le demande à l’ouverture et chiffre les secrets du profil (clés, connecteurs).', create: 'Créer et ouvrir', cancel: 'Annuler', lock: 'Verrouiller', you: 'ouvert', locked: 'mot de passe', max: '4 profils au plus sur cet ordinateur.', manage: 'Gérer (photo, mot de passe, suppression)', switching: 'Changement de profil…' },
    en: { h: 'Profiles', sub: '{n} of {max} on this computer. Each profile has its own chats, memory and settings.', add: 'Add a profile', name: 'Name', pw: 'Password (optional)', pwHelp: 'With a password, Fabro asks for it at start and encrypts the profile’s secrets (keys, connectors).', create: 'Create and open', cancel: 'Cancel', lock: 'Lock', you: 'open', locked: 'password', max: '4 profiles at most on this computer.', manage: 'Manage (picture, password, delete)', switching: 'Switching profile…' },
  };
  const t = (k, o) => { let s = (T[V1.lang] || T.en)[k]; for (const [a, b] of Object.entries(o || {})) s = s.replace(`{${a}}`, b); return s; };
  const COL = { coral: '#e8603c', amber: '#c98a1e', moss: '#5f8a3c', teal: '#2f8f86', sky: '#3f7fd0', rose: '#c0577a', slate: '#5d6672', sand: '#a88d62' };
  const esc = (s) => V1.esc(s);
  const av = (a) => a.picture ? `<span class="pfa" style="background-image:url('${esc(a.picture)}')"></span>` : `<span class="pfa" style="background:${COL[a.color] || COL.coral}">${esc((a.name || '?')[0].toUpperCase())}</span>`;
  let L = null; let form = null;

  async function open() {
    try { L = await api.accounts.list(); } catch { L = null; }
    draw();
  }
  function draw() {
    if (!L || L.fallback) { V1.sheet(`${V1.head(t('h'))}<p class="lead">—</p>`); return; }
    const n = L.accounts.length; const max = Math.min(4, L.max || 4);
    let body = `<p class="lead">${t('sub', { n, max })}</p>`;
    body += L.accounts.map((a) => `<button class="opt ${a.id === L.current ? 'on' : ''}" data-act="pf-go" data-id="${esc(a.id)}">${av(a)}<span class="grow">${esc(a.name)}<small>${a.id === L.current ? t('you') : a.hasPassword ? t('locked') : ''}</small></span></button>`).join('');
    if (form) {
      body += `<form class="pf-new" data-pf-form><label class="field">${t('name')}<input class="in" name="name" maxlength="40" required></label><label class="field">${t('pw')}<input class="in" type="password" name="pw" autocomplete="new-password"></label><p class="lead" style="font-size:12.5px">${t('pwHelp')}</p>${form.err ? `<p class="err">${esc(form.err)}</p>` : ''}<div class="acts"><button type="button" class="btn ghost" data-act="pf-cancel">${t('cancel')}</button><button class="btn pri" ${form.busy ? 'disabled' : ''}>${form.busy ? '…' : t('create')}</button></div></form>`;
    } else {
      body += `<div class="acts" style="margin-top:12px">${n < max ? `<button class="btn" data-act="pf-add">${t('add')}</button>` : `<span class="lead" style="font-size:12.5px">${t('max')}</span>`}<span class="grow"></span>${(n > 1 || L.accounts.some((a) => a.id === L.current && a.hasPassword)) ? `<button class="btn ghost" data-act="pf-lock">${t('lock')}</button>` : ''}<button class="btn ghost" data-act="legacy" data-page="accounts">${t('manage')}</button></div>`;
    }
    V1.sheet(`${V1.head(t('h'))}${body}`);
    const f = document.querySelector('.pf-new input'); if (f) f.focus();
  }
  document.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-act^="pf-"], [data-act="profiles"]'); if (!el) return;
    const a = el.dataset.act;
    if (a === 'profiles') return open();
    if (a === 'pf-add') { form = {}; return draw(); }
    if (a === 'pf-cancel') { form = null; return draw(); }
    if (a === 'pf-lock') { V1.toast(t('switching')); return api.accounts.lock(); }
    if (a === 'pf-go') { if (el.dataset.id === L.current) return; V1.toast(t('switching')); return api.accounts.switch(el.dataset.id).catch((x) => V1.toast(String(x.message || x), 'err')); }
  });
  document.addEventListener('submit', async (e) => {
    const f = e.target.closest('[data-pf-form]'); if (!f) return; e.preventDefault();
    const fd = new FormData(f); form = { busy: true }; draw();
    try {
      const acc = await api.accounts.create({ name: fd.get('name'), password: fd.get('pw') || undefined });
      V1.toast(t('switching')); await api.accounts.switch(acc.id);
    } catch (x) { form = { err: /LIMIT/.test(String(x.message)) ? t('max') : String(x.message || x) }; draw(); }
  });
  return { open };
})();

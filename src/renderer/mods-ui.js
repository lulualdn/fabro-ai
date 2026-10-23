'use strict';
/* Mods (renderer side): the `fabro` API given to mods, slash commands, extra history sources,
   embedded web views in the chat area, the Settings › Mods tab, links (fabro://…) and the quick-bar handoff.
   Mods run with the same rights as the app UI: they can read S, call or replace any global function
   (fabro.override), and add CSS. See MODDING.md. */

Object.assign(I18N.en, {
  tab_mods: 'Mods', mods_intro: 'Mods change how Fabro looks and works: new commands, screens, history sources, anything. They run with full access to the app, so only install mods you trust.',
  mods_builtin: 'Built-in', mods_install: 'Install', mods_uninstall: 'Uninstall', mods_uninstallConfirm: 'Uninstall "{n}"? Its data and its sign-in are removed.',
  mods_fromFolder: 'Add from a folder', mods_fromZip: 'Add a .zip', mods_folder: 'Mods folder', mods_docs: 'How to make a mod',
  mods_installed: '"{n}" is installed', mods_reconnect: 'Sign in again', mods_sync: 'Sync now', mods_err: 'Error: {e}',
  mods_synced: 'Chats synced', mods_syncInfo: '{n} chats ({k} named) · synced at {w} · {v}', mods_syncErr: 'Sync failed: {e}', mods_viaApi: 'from the site’s data', mods_viaPage: 'from the page', mods_none: 'No mods yet.', mods_by: 'by {a}', mods_cmds: 'Commands', mods_trust: 'This mod is not from UFStudios. It will have full access to Fabro and your files. Install it?',
  cmd_hint: 'Commands', web_loading: 'Loading {n}…', web_back: 'Back to Fabro', link_send: 'Send prompts from fabro:// links right away', link_sendHint: 'Off: a link only fills in the message box and you press Enter yourself.',
  q_screen: 'Screen', q_screenHint: 'A screenshot of your screen is attached. Click × to remove it.', q_screenSetting: 'Attach a screenshot when the quick bar opens', q_screenSettingHint: 'Taken just before the bar appears, stays on your computer, and you can remove it before sending.',
  drop_here: 'Drop files to attach them',
});
Object.assign(I18N.fr, {
  tab_mods: 'Mods', mods_intro: 'Les mods changent l’apparence et le fonctionnement de Fabro : commandes, écrans, sources d’historique, tout. Ils ont un accès complet à l’app : n’installez que des mods de confiance.',
  mods_builtin: 'Intégré', mods_install: 'Installer', mods_uninstall: 'Désinstaller', mods_uninstallConfirm: 'Désinstaller « {n} » ? Ses données et sa connexion sont supprimées.',
  mods_fromFolder: 'Ajouter un dossier', mods_fromZip: 'Ajouter un .zip', mods_folder: 'Dossier des mods', mods_docs: 'Créer un mod',
  mods_installed: '« {n} » est installé', mods_reconnect: 'Se reconnecter', mods_sync: 'Synchroniser', mods_err: 'Erreur : {e}',
  mods_synced: 'Conversations synchronisées', mods_syncInfo: '{n} conversations ({k} nommées) · synchro à {w} · {v}', mods_syncErr: 'Échec de la synchro : {e}', mods_viaApi: 'depuis les données du site', mods_viaPage: 'depuis la page', mods_none: 'Aucun mod pour l’instant.', mods_by: 'par {a}', mods_cmds: 'Commandes', mods_trust: 'Ce mod ne vient pas d’UFStudios. Il aura un accès complet à Fabro et à vos fichiers. L’installer ?',
  cmd_hint: 'Commandes', web_loading: 'Chargement de {n}…', web_back: 'Revenir à Fabro', link_send: 'Envoyer tout de suite les messages des liens fabro://', link_sendHint: 'Désactivé : un lien remplit seulement la zone de message, vous appuyez vous-même sur Entrée.',
  q_screen: 'Écran', q_screenHint: 'Une capture de votre écran est jointe. Cliquez sur × pour la retirer.', q_screenSetting: 'Joindre une capture d’écran à l’ouverture de la barre rapide', q_screenSettingHint: 'Prise juste avant l’apparition de la barre, elle reste sur votre ordinateur et vous pouvez la retirer avant l’envoi.',
  drop_here: 'Déposez vos fichiers pour les joindre',
});

// ───────────────────────────── The fabro API ─────────────────────────────
const MODS = { commands: new Map(), sources: new Map(), hooks: new Map(), listeners: [], list: [] };
const fabro = window.fabro = {
  version: 1,
  get S() { return S; },
  api, t, toast, icon, esc, md: (s) => md(s), logo,
  // Replace any global function of the UI. wrap receives the original and returns the new function.
  override(name, wrap) {
    const orig = window[name];
    if (typeof orig !== 'function') throw new Error(`fabro.override: no global function "${name}"`);
    window[name] = wrap(orig);
    return () => { window[name] = orig; };
  },
  actions, // the click handlers (data-action="…")
  hook(name, fn) { if (!MODS.hooks.has(name)) MODS.hooks.set(name, []); MODS.hooks.get(name).push(fn); },
  run(name, ...a) { return (MODS.hooks.get(name) || []).map((fn) => { try { return fn(...a); } catch (e) { console.error(e); } }); },
  commands: {
    register(name, cmd) { const n = String(name).replace(/^\//, '').toLowerCase(); cmd.name = n; MODS.commands.set(n, cmd); return () => MODS.commands.delete(n); },
    list: () => [...MODS.commands.values()],
    find(text) {
      const m = String(text || '').match(/^\/([a-z0-9_-]+)(?:\s+([\s\S]*))?$/i);
      if (!m) return null;
      const c = MODS.commands.get(m[1].toLowerCase());
      return c ? { cmd: c, rest: (m[2] || '').trim() } : null;
    },
  },
  history: { register(id, src) { src.id = id; MODS.sources.set(id, src); renderRecents(); }, refresh: () => renderRecents() },
  view: { open: (o) => openModView(o), close: () => closeModView(), get current() { return S.modView; } },
  forMod(id) {
    return {
      id, ...this, get S() { return S; },
      call: (method, ...args) => api.mods.call(id, method, args),
      on: (type, fn) => { MODS.listeners.push({ id, type, fn }); },
      commands: { ...this.commands, register: (n, c) => { c.mod = id; return fabro.commands.register(n, c); } },
      history: { ...this.history, register: (src) => fabro.history.register(id, Object.assign(src, { mod: id })) },
      view: { open: (o) => openModView({ mod: id, ...o }), close: () => { if (S.modView && S.modView.mod === id) closeModView(); }, get current() { return S.modView && S.modView.mod === id ? S.modView : null; } },
    };
  },
  _loaded() { renderRecents(); if (S.settingsTab === 'mods') renderSettings(); fabro.run('loaded'); },
};
api.on('mods:event', ({ mod, type, data }) => { for (const l of MODS.listeners) if (l.id === mod && l.type === type) { try { l.fn(data); } catch (e) { console.error(e); } } });
api.on('mods:web', (e) => {
  if (S.modView && e.id === S.modView.viewKey) {
    S.modView.url = e.url;
    if (e.type === 'loaded') { $('#mod-web')?.classList.add('ready'); renderRecents(); }
    if (e.type === 'navigate') renderRecents();
  }
  fabro.run('web', e);
});

// ───────────────────────────── Slash commands ─────────────────────────────
// A message starting with "/name" runs the mod command instead of going to the model.
fabro.override('sendPrompt', (orig) => async function (textOverride, opts = {}) {
  const ta = $('#prompt');
  const text = String(textOverride ?? (ta ? ta.value : '')).trim();
  const hit = fabro.commands.find(text);
  if (hit && !S.streaming) {
    if (ta) { ta.value = ''; ta.style.height = 'auto'; } S._draft = ''; closeCmdMenu();
    try { await hit.cmd.run(hit.rest, { source: opts.quick ? 'quick' : 'composer' }); } catch (e) { toast(cleanErr(e), 'err'); }
    return;
  }
  return orig(textOverride, opts);
});
// Quick bar: commands come here directly (no local model needed).
api.on('quick:command', async ({ text }) => {
  const hit = fabro.commands.find(text);
  if (hit) { try { await hit.cmd.run(hit.rest, { source: 'quick' }); } catch (e) { toast(cleanErr(e), 'err'); } }
});

// Suggestions when the message box starts with "/".
function closeCmdMenu() { $('.cmd-menu')?.remove(); }
document.addEventListener('input', (e) => {
  if (e.target.id !== 'prompt') return;
  const v = e.target.value; const m = v.match(/^\/([a-z0-9_-]*)$/i);
  closeCmdMenu();
  if (!m) return;
  const list = fabro.commands.list().filter((c) => c.name.startsWith(m[1].toLowerCase()));
  if (!list.length) return;
  const comp = $('#composer'); if (!comp) return;
  comp.insertAdjacentHTML('afterbegin', `<div class="cmd-menu" role="listbox"><div class="cm-h">${esc(t('cmd_hint'))}</div>${list.map((c, i) => `<button class="cm-item ${i ? '' : 'on'}" data-action="cmd-pick" data-name="${esc(c.name)}">${c.icon ? `<img src="${esc(c.icon)}" alt="">` : icon('zap', 15)}<b>/${esc(c.name)}</b><span>${esc(c.description || '')}</span></button>`).join('')}</div>`);
});
document.addEventListener('keydown', (e) => {
  const menu = $('.cmd-menu'); if (!menu || e.target.id !== 'prompt') return;
  const items = [...menu.querySelectorAll('.cm-item')]; const i = items.findIndex((x) => x.classList.contains('on'));
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); items[i]?.classList.remove('on'); items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].classList.add('on'); }
  if (e.key === 'Tab') { e.preventDefault(); items[Math.max(0, i)].click(); }
  if (e.key === 'Escape') { e.stopPropagation(); closeCmdMenu(); }
}, true);
actions['cmd-pick'] = (el) => { const ta = $('#prompt'); if (ta) { ta.value = '/' + el.dataset.name + ' '; S._draft = ta.value; ta.focus(); ta.dispatchEvent(new Event('input')); } closeCmdMenu(); };

// ───────────────────────────── History from mods ─────────────────────────────
function extItems() {
  const out = [];
  for (const src of MODS.sources.values()) {
    let items = []; try { items = src.list() || []; } catch {}
    for (const it of items) out.push({ ...it, _src: src.id, _ext: true, updatedAt: it.updatedAt || 0 });
  }
  return out;
}
function extItem(it, i) {
  const active = S.modView && S.modView.mod === it._src && S.modView.url && it.href && S.modView.url.split('?')[0] === it.href.split('?')[0];
  return `<div class="recent ext ${active ? 'active' : ''}" style="--i:${i}" data-action="mod-hist" data-src="${esc(it._src)}" data-id="${esc(it.id)}" title="${esc(it.title || t('untitled'))}">
    <span class="r-title">${esc(it.title || t('untitled'))}</span>
    ${it.icon ? `<img class="r-src" src="${esc(it.icon)}" alt="" draggable="false">` : `<span class="r-ico">${icon('globe', 15)}</span>`}
  </div>`;
}
fabro.override('renderRecents', (orig) => function () {
  const el = $('#sb-lists');
  const ext = MODS.sources.size && S.mode !== 'code' && !(S.sbQuery.trim() && S.sbResults) ? extItems() : [];
  if (!el || !ext.length) return orig();
  const q = S.sbQuery.trim().toLowerCase();
  const own = S.convs.filter((c) => !c.codeRoot && (!q || (c.title || '').toLowerCase().includes(q)));
  const pinned = own.filter((c) => c.pinned);
  const rest = [...own.filter((c) => !c.pinned), ...ext.filter((x) => !q || (x.title || '').toLowerCase().includes(q))]
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  el.innerHTML = `
    ${pinned.length ? `<div class="sb-section"><span>${esc(t('pinned'))}</span></div>${pinned.map(recentItem).join('')}` : ''}
    ${rest.length ? `<div class="sb-section"><span>${esc(t('recents'))}</span></div>${rest.map((x, i) => (x._ext ? extItem(x, i) : recentItem(x))).join('')}` : ''}
    ${q && !pinned.length && !rest.length ? `<div class="sb-empty">${esc(t('noResults'))}</div>` : ''}`;
});
actions['mod-hist'] = (el) => {
  const src = MODS.sources.get(el.dataset.src); if (!src) return;
  const it = (src.list() || []).find((x) => String(x.id) === el.dataset.id); if (it && src.open) src.open(it);
};

// ───────────────────────────── Web views in the chat area ─────────────────────────────
// opts: { mod, key, title, sidebar: 'hide' | 'keep', loading }
function openModView(o) {
  const viewKey = o.mod + (o.key ? ':' + o.key : '');
  if (S.modView && S.modView.viewKey !== viewKey) api.mods.webHide();
  const wasOpen = !!S.modView;
  const prev = wasOpen ? S.modView.prevCollapsed : S.settings.sidebarCollapsed;
  // the sidebar state inside the web view is for this view only (never saved)
  S.modView = { ...o, viewKey, url: '', prevCollapsed: prev, sb: o.sidebar === 'hide' ? true : !!S.settings.sidebarCollapsed };
  S.settings.sidebarCollapsed = S.modView.sb;
  closeViewer && S.viewer && closeViewer();
  vt(() => { renderSidebar(); renderView(); });
  return S.modView;
}
function closeModView(render = true) {
  if (!S.modView) return;
  const prev = S.modView.prevCollapsed; S.modView = null;
  api.mods.webHide();
  S.settings.sidebarCollapsed = prev;
  if (render) { renderSidebar(); renderView(); }
}
function syncModWeb() {
  const el = $('#mod-web');
  if (!S.modView) return;
  const visible = !!el && !S.settingsTab && !$('#modal-root .modal') && !$('#popover-root').innerHTML && !$('#overlay-root').innerHTML && !document.body.classList.contains('vx-on');
  const r = el ? el.getBoundingClientRect() : { x: 0, y: 0, width: 0, height: 0 };
  api.mods.webBounds(S.modView.viewKey, { x: r.x, y: r.y, width: r.width, height: r.height, visible });
}
const modRo = new ResizeObserver(() => syncModWeb());
let modRoEl = null;
new MutationObserver(() => syncModWeb()).observe(document.body, { childList: true, subtree: false, attributes: true, attributeFilter: ['class'] });
['overlay-root', 'popover-root', 'modal-root'].forEach((id) => new MutationObserver(() => syncModWeb()).observe(document.getElementById(id), { childList: true }));
window.addEventListener('resize', () => syncModWeb());

fabro.override('renderView', (orig) => function () {
  if (!S.modView) { if (modRoEl) { modRo.unobserve(modRoEl); modRoEl = null; } return orig(); }
  renderTopbar(); reportQuick();
  const v = $('#view');
  v.className = 'view mod-view';
  v.innerHTML = `<div id="mod-web" class="mod-web"><div class="mw-wait">${spinner(30)}<span>${esc(t('web_loading', { n: S.modView.title || '' }))}</span></div></div>`;
  modRoEl = $('#mod-web'); modRo.observe(modRoEl);
  requestAnimationFrame(syncModWeb);
});
fabro.override('renderTopbar', (orig) => function () {
  if (!S.modView) return orig();
  // Only a button to bring the sidebar back: the site has its own interface.
  $('#topbar').innerHTML = `<div class="tb-left">${sbHidden() ? `<button class="icon-btn" data-action="toggle-sidebar" title="${esc(t('expandSidebar'))}">${icon('panel', 19)}</button>` : ''}</div><div class="tb-right"></div>`;
});
// Anything that shows a Fabro screen leaves the web view.
fabro.override('openConv', (orig) => async function (id) { closeModView(false); return orig(id); });
fabro.override('newChat', (orig) => function () { closeModView(false); return orig(); });
actions['new-chat'] = () => newChat();
{ const m = actions['mode']; actions['mode'] = (el) => { closeModView(false); m(el); }; }
{ const ts = actions['toggle-sidebar']; actions['toggle-sidebar'] = async () => { if (S.modView) { S.modView.sb = !S.modView.sb; S.settings.sidebarCollapsed = S.modView.sb; renderSidebar(); renderTopbar(); return; } return ts(); }; }
// settings saved while a web view is open must not undo its sidebar state
fabro.override('saveSettings', (orig) => async function (patch) { await orig(patch); if (S.modView) S.settings.sidebarCollapsed = S.modView.sb; });
fabro.override('openSettings', (orig) => async function (tab) { const r = await orig(tab); if (tab === 'mods') loadMods(); syncModWeb(); return r; });

// ───────────────────────────── Settings › Mods ─────────────────────────────
TABS.splice(TABS.findIndex((x) => x.id === 'agent') + 1, 0, { id: 'mods', icon: 'puzzle' });
async function loadMods() { try { S.modsList = await api.mods.list(); } catch { S.modsList = []; } if (S.settingsTab === 'mods') renderSettings(); }
fabro.override('settingsBody', (orig) => function (tab) {
  if (tab !== 'mods') {
    const html = orig(tab);
    if (tab === 'shortcut') return html + row(t('q_screenSetting'), toggle('quickScreenshot', S.settings.quickScreenshot !== false), t('q_screenSettingHint'))
      + row(t('link_send'), toggle('links.autoSend', !!(S.settings.links || {}).autoSend), t('link_sendHint') + ' fabro://new?q=…');
    return html;
  }
  const list = S.modsList;
  if (!list) return `<div class="muted">${spinner(18)}</div>`;
  const card = (m) => `<div class="prov-row mod-row ${m.enabled ? '' : 'off'}">
      <span class="prov-tile" style="--s:40px;background:var(--panel)">${m.icon ? `<img src="${esc(m.icon)}" alt="" width="24" height="24">` : icon('puzzle', 18)}</span>
      <div class="m-text"><b>${esc(m.name)} ${m.builtin ? `<span class="src-badge">${esc(t('mods_builtin'))}</span>` : ''} <small class="muted mono">${esc(m.version)}</small></b>
        <small>${esc(m.description)}${m.author ? ' · ' + esc(t('mods_by', { a: m.author })) : ''}</small>
        ${m.commands.length ? `<small class="mono">${m.commands.map((c) => '/' + esc(c.name)).join(' · ')}</small>` : ''}
        ${m.enabled && m.status && (m.status.lastSync || m.status.lastError) ? `<small class="${m.status.lastError ? 'err' : 'muted'}">${m.status.lastError ? esc(t('mods_syncErr', { e: m.status.lastError })) : esc(t('mods_syncInfo', { n: m.status.lastCount || 0, k: m.status.lastNamed || 0, w: new Date(m.status.lastSync).toLocaleTimeString(S.lang, { hour: '2-digit', minute: '2-digit' }), v: t(m.status.lastVia === 'api' ? 'mods_viaApi' : 'mods_viaPage') }))}</small>` : ''}
        ${m.error ? `<small class="err">${icon('warning', 12)} ${esc(t('mods_err', { e: m.error }))}</small>` : ''}</div>
      ${m.enabled && m.setup ? `<button class="btn sm" data-action="mod-call" data-id="${esc(m.id)}" data-m="sync" title="${esc(t('mods_sync'))}">${icon('refresh', 14)}</button><button class="btn sm" data-action="mod-relogin" data-id="${esc(m.id)}">${esc(t('mods_reconnect'))}</button>` : ''}
      ${m.enabled ? `<button class="icon-btn sm" data-action="mod-uninstall" data-id="${esc(m.id)}" data-n="${esc(m.name)}" title="${esc(t('mods_uninstall'))}">${icon('trash', 16)}</button>` : ''}
      ${m.enabled ? toggleBtn('mod-toggle', true, `data-id="${esc(m.id)}"`) : `<button class="btn sm primary" data-action="mod-install" data-id="${esc(m.id)}" data-n="${esc(m.name)}" data-b="${m.builtin ? 1 : 0}" data-setup="${m.setup ? 1 : 0}">${icon('download', 14)} ${esc(t('mods_install'))}</button>`}
    </div>`;
  return `<p class="muted small st-intro">${esc(t('mods_intro'))}</p>
    <div class="st-sec">${esc(t('tab_mods'))}<span class="grow"></span>
      <button class="btn sm" data-action="mod-add" data-k="dir">${icon('folder', 14)} ${esc(t('mods_fromFolder'))}</button>
      <button class="btn sm" data-action="mod-add" data-k="zip">${icon('archive', 14)} ${esc(t('mods_fromZip'))}</button>
      <button class="btn sm" data-action="mod-folder">${icon('folder', 14)} ${esc(t('mods_folder'))}</button></div>
    <div class="prov-list">${list.length ? list.map(card).join('') : `<div class="empty-note">${esc(t('mods_none'))}</div>`}</div>
    <p class="small"><a class="mod-docs" href="https://github.com/lulualdn/fabro-ai/blob/main/MODDING.md" data-action="ext-link">${icon('book', 14)} ${esc(t('mods_docs'))}</a></p>`;
});
Object.assign(actions, {
  'mod-install': async (el) => {
    if (el.dataset.b !== '1' && !confirm(t('mods_trust'))) return;
    closeSettings();
    try { await api.mods.enable(el.dataset.id, true, { setup: el.dataset.setup === '1' }); } catch (e) { toast(cleanErr(e), 'err'); }
  },
  'mod-toggle': async (el) => { try { S.modsList = await api.mods.enable(el.dataset.id, el.dataset.value === 'true'); } catch (e) { toast(cleanErr(e), 'err'); } renderSettings(); },
  'mod-uninstall': async (el) => { if (!confirm(t('mods_uninstallConfirm', { n: el.dataset.n }))) return; S.modsList = await api.mods.uninstall(el.dataset.id); renderSettings(); },
  'mod-relogin': (el) => { closeSettings(); fabro.run('relogin:' + el.dataset.id); const ls = MODS.listeners.filter((l) => l.id === el.dataset.id && l.type === 'setup'); ls.forEach((l) => l.fn({})); },
  'mod-call': async (el) => { try { await api.mods.call(el.dataset.id, el.dataset.m, []); toast(t('mods_synced')); S.modsList = await api.mods.list(); renderSettings(); } catch (e) { toast(cleanErr(e), 'err'); } },
  'mod-add': async (el) => {
    if (!confirm(t('mods_trust'))) return;
    try { const r = await api.mods.addFrom(el.dataset.k); if (r) { S.modsList = r.list; toast(t('mods_installed', { n: (r.list.find((m) => m.id === r.id) || {}).name || r.id })); renderSettings(); } } catch (e) { toast(cleanErr(e), 'err'); }
  },
  'mod-folder': () => api.mods.openFolder(),
});
// "More › Extensions" opens the Mods tab.
actions['soon'] = ((orig) => (el, e) => { if (el && el.closest('.nav-sub')) return openSettings('mods'); return orig(el, e); })(actions['soon']);

// ───────────────────────────── fabro:// links ─────────────────────────────
// fabro://new?q=…   new chat with this message (sent right away only if the setting allows it)
// fabro://chat/<id>  open a conversation      fabro://new?q=/claude …  runs a mod command
async function handleLink(l) {
  if (!l) return;
  if (l.action === 'chat' && l.id) return openConv(l.id);
  if (l.action === 'settings') return openSettings(l.tab || 'general');
  if (l.action === 'new' || l.action === 'open') {
    if (l.action === 'open' && !l.q) return;
    const q = String(l.q || '');
    const hit = fabro.commands.find(q);
    if (hit && (S.settings.links || {}).autoSend) return hit.cmd.run(hit.rest, { source: 'link' });
    newChat();
    await new Promise((r) => setTimeout(r, 60));
    if (!q) return;
    if ((S.settings.links || {}).autoSend && !hit) return sendPrompt(q);
    const ta = $('#prompt'); if (ta) { ta.value = q; S._draft = q; ta.dispatchEvent(new Event('input')); ta.focus(); ta.setSelectionRange(q.length, q.length); }
  }
}
api.on('app:deeplink', handleLink);

// ───────────────────────────── Files: drop anywhere, paste anywhere ─────────────────────────────
let dragDepth = 0;
const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
document.addEventListener('dragenter', (e) => { if (!hasFiles(e) || !$('#prompt')) return; dragDepth++; document.body.classList.add('drop-on'); });
document.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) document.body.classList.remove('drop-on'); });
document.addEventListener('drop', (e) => {
  dragDepth = 0; document.body.classList.remove('drop-on');
  // chat mode is handled by app.js; the other screens with a message box are handled here
  if (S.mode !== 'chat' && e.dataTransfer.files.length && $('#prompt')) addFiles([...e.dataTransfer.files]);
});
document.addEventListener('paste', (e) => {
  if (e.target && (e.target.id === 'prompt' || e.target.closest('input, textarea, [contenteditable="true"]'))) return; // the box handles it
  const files = [...(e.clipboardData?.files || [])];
  if (files.length && $('#prompt')) { e.preventDefault(); addFiles(files); $('#prompt').focus(); }
});
document.body.insertAdjacentHTML('beforeend', `<div class="drop-veil"><div>${icon('upload', 30) || icon('download', 30)}<b></b></div></div>`);

// ───────────────────────────── Quick bar attachments ─────────────────────────────
// The quick bar sends its attachments (screenshot, pasted or dropped files) with the message.
async function quickAttach(list) {
  for (const a of list || []) {
    if (a.kind === 'image' && a.data) S.pending.push({ kind: 'image', name: a.name || 'image.png', type: a.type || 'image/png', ext: (a.name || '').split('.').pop() || 'png', size: a.size || Math.round(a.data.length * 0.75), data: a.data });
    else if (a.kind === 'text' && typeof a.text === 'string') S.pending.push({ kind: 'text', name: a.name, ext: (a.name.split('.').pop() || 'txt').toLowerCase(), size: a.size || a.text.length, type: a.type || 'text/plain', text: a.text });
    else if (a.path) { try { const r = await api.files.ingest({ path: a.path, name: a.name }); S.pending.push({ name: a.name, size: a.size, type: a.type, ext: (a.name.split('.').pop() || '').toLowerCase(), kind: 'file', ...r }); } catch {} }
  }
}

// Boot: ask the main process to load the enabled mods into this window, then any pending link.
window.addEventListener('DOMContentLoaded', () => {
  const go = async () => { $('.drop-veil b').textContent = t('drop_here'); await api.mods.ready('main').catch(() => {}); api.link.ready(); };
  // wait for app.js's boot (settings loaded) before running mod code
  const wait = () => (S.settings && $('#sb-lists') ? go() : setTimeout(wait, 50));
  wait();
});

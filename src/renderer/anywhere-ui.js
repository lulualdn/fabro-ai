'use strict';
/* Fabro Anywhere on the computer: settings tab (phones, relays), the animated pairing code, and the bridge
   that lets phone requests reuse this window's context (system prompt, tools, model) and refresh views. */

Object.assign(I18N.en, {
  tab_anywhere: 'Fabro Anywhere',
  aw_intro: 'Talk to the AI models of this computer from your phone, even away from home. Conversations sync on their own; messages are end-to-end encrypted.',
  aw_enable: 'Allow phones', aw_enableHint: 'Paired phones can reach this computer while Fabro is open (in the window or the tray).',
  aw_add: 'Add a phone', aw_none: 'No phone yet.', aw_devices: 'Paired phones',
  aw_direct: 'Direct', aw_relay: 'Via relay', aw_off: 'Offline', aw_seen: 'Seen {t}', aw_never: 'Never seen',
  aw_rename: 'Rename', aw_revoke: 'Remove', aw_revokeQ: 'Remove “{n}”? The phone will have to scan a new code.', aw_push: 'Notifications on', aw_noPush: 'Notifications off',
  aw_pcName: 'Name of this computer', aw_pcNameHint: 'Shown on your phones.',
  aw_notifyAgent: 'Notify my phone when an agent task ends', aw_notifyAgentHint: 'When the task ran here while you were away from the window.',
  aw_relays: 'Relays', aw_relaysHint: 'Only used to put the phone and the computer in touch (and as a fallback). They see encrypted messages only and store nothing.',
  aw_custom: 'Your own relay', aw_customHint: 'MQTT over WebSocket (wss://…), used next to the relays ticked above. If you untick them all, set the same relay on the phone (Settings › Advanced) before pairing.',
  aw_turn: 'TURN server (optional)', aw_turnHint: 'For networks that block direct connections.',
  aw_save: 'Save', aw_app: 'Phone app', aw_appHint: 'Open this address on the phone, then add it to the home screen.',
  aw_pairT: 'Pair a phone', aw_step1: 'On the phone, open {u}', aw_step2: 'Tap “Pair” and point the camera at the code',
  aw_noCam: 'No camera? Type this code', aw_expires: 'Expires in {s}', aw_expired: 'The code expired.', aw_again: 'New code',
  aw_pairedT: '{n} is paired', aw_pairedB: 'You can talk to this computer from the phone now.', aw_done: 'Done',
  aw_relayUp: 'connected', aw_relayDown: 'unreachable', aw_relayConn: 'connecting…', aw_phoneConv: 'Updated from {n}',
});
Object.assign(I18N.fr, {
  tab_anywhere: 'Fabro Anywhere',
  aw_intro: 'Parle aux IA de cet ordinateur depuis ton téléphone, même loin de chez toi. Les conversations se synchronisent toutes seules ; les messages sont chiffrés de bout en bout.',
  aw_enable: 'Autoriser les téléphones', aw_enableHint: 'Les téléphones associés peuvent joindre cet ordinateur tant que Fabro est ouvert (fenêtre ou barre des tâches).',
  aw_add: 'Ajouter un téléphone', aw_none: 'Aucun téléphone pour l’instant.', aw_devices: 'Téléphones associés',
  aw_direct: 'Direct', aw_relay: 'Par relais', aw_off: 'Hors ligne', aw_seen: 'Vu {t}', aw_never: 'Jamais vu',
  aw_rename: 'Renommer', aw_revoke: 'Retirer', aw_revokeQ: 'Retirer « {n} » ? Le téléphone devra scanner un nouveau code.', aw_push: 'Notifications activées', aw_noPush: 'Notifications désactivées',
  aw_pcName: 'Nom de cet ordinateur', aw_pcNameHint: 'Affiché sur tes téléphones.',
  aw_notifyAgent: 'Prévenir mon téléphone quand une tâche d’agent se termine', aw_notifyAgentHint: 'Quand la tâche a tourné ici pendant que tu n’étais pas devant la fenêtre.',
  aw_relays: 'Relais', aw_relaysHint: 'Servent seulement à mettre le téléphone et l’ordinateur en relation (et de secours). Ils ne voient que des messages chiffrés et ne stockent rien.',
  aw_custom: 'Ton propre relais', aw_customHint: 'MQTT sur WebSocket (wss://…), en plus des relais cochés ci-dessus. Si tu les décoches tous, mets le même relais sur le téléphone (Réglages › Avancé) avant l’association.',
  aw_turn: 'Serveur TURN (facultatif)', aw_turnHint: 'Pour les réseaux qui bloquent les connexions directes.',
  aw_save: 'Enregistrer', aw_app: 'App du téléphone', aw_appHint: 'Ouvre cette adresse sur le téléphone, puis ajoute-la à l’écran d’accueil.',
  aw_pairT: 'Associer un téléphone', aw_step1: 'Sur le téléphone, ouvre {u}', aw_step2: 'Touche « Associer » et vise le code avec l’appareil photo',
  aw_noCam: 'Pas d’appareil photo ? Tape ce code', aw_expires: 'Expire dans {s}', aw_expired: 'Le code a expiré.', aw_again: 'Nouveau code',
  aw_pairedT: '{n} est associé', aw_pairedB: 'Tu peux parler à cet ordinateur depuis le téléphone.', aw_done: 'Terminé',
  aw_relayUp: 'connecté', aw_relayDown: 'injoignable', aw_relayConn: 'connexion…', aw_phoneConv: 'Mis à jour depuis {n}',
});
Object.assign(I18N.es, {
  tab_anywhere: 'Fabro Anywhere',
  aw_intro: 'Habla con los modelos de IA de este ordenador desde tu móvil, incluso fuera de casa. Las conversaciones se sincronizan solas; los mensajes van cifrados de extremo a extremo.',
  aw_enable: 'Permitir móviles', aw_enableHint: 'Los móviles vinculados pueden conectar con este ordenador mientras Fabro esté abierto.',
  aw_add: 'Añadir un móvil', aw_none: 'Aún no hay ningún móvil.', aw_devices: 'Móviles vinculados',
  aw_direct: 'Directo', aw_relay: 'Por relé', aw_off: 'Desconectado', aw_seen: 'Visto {t}', aw_never: 'Nunca visto',
  aw_rename: 'Renombrar', aw_revoke: 'Quitar', aw_revokeQ: '¿Quitar «{n}»? El móvil tendrá que escanear un código nuevo.', aw_push: 'Notificaciones activadas', aw_noPush: 'Notificaciones desactivadas',
  aw_pcName: 'Nombre de este ordenador', aw_pcNameHint: 'Se muestra en tus móviles.',
  aw_notifyAgent: 'Avisar a mi móvil cuando termine una tarea del agente', aw_notifyAgentHint: 'Cuando la tarea se ejecutó aquí sin que estuvieras delante.',
  aw_relays: 'Relés', aw_relaysHint: 'Solo sirven para poner en contacto el móvil y el ordenador (y como respaldo). Solo ven mensajes cifrados y no guardan nada.',
  aw_custom: 'Tu propio relé', aw_customHint: 'MQTT sobre WebSocket (wss://…).',
  aw_turn: 'Servidor TURN (opcional)', aw_turnHint: 'Para redes que bloquean las conexiones directas.',
  aw_save: 'Guardar', aw_app: 'App del móvil', aw_appHint: 'Abre esta dirección en el móvil y añádela a la pantalla de inicio.',
  aw_pairT: 'Vincular un móvil', aw_step1: 'En el móvil, abre {u}', aw_step2: 'Toca «Vincular» y apunta la cámara al código',
  aw_noCam: '¿Sin cámara? Escribe este código', aw_expires: 'Caduca en {s}', aw_expired: 'El código ha caducado.', aw_again: 'Nuevo código',
  aw_pairedT: '{n} está vinculado', aw_pairedB: 'Ya puedes hablar con este ordenador desde el móvil.', aw_done: 'Listo',
  aw_relayUp: 'conectado', aw_relayDown: 'inaccesible', aw_relayConn: 'conectando…', aw_phoneConv: 'Actualizado desde {n}',
});
Object.assign(I18N.de, {
  tab_anywhere: 'Fabro Anywhere',
  aw_intro: 'Sprich vom Handy aus mit den KI-Modellen dieses Computers, auch unterwegs. Gespräche synchronisieren sich von selbst; Nachrichten sind Ende-zu-Ende-verschlüsselt.',
  aw_enable: 'Handys erlauben', aw_enableHint: 'Gekoppelte Handys erreichen diesen Computer, solange Fabro geöffnet ist.',
  aw_add: 'Handy hinzufügen', aw_none: 'Noch kein Handy.', aw_devices: 'Gekoppelte Handys',
  aw_direct: 'Direkt', aw_relay: 'Über Relais', aw_off: 'Offline', aw_seen: 'Gesehen {t}', aw_never: 'Nie gesehen',
  aw_rename: 'Umbenennen', aw_revoke: 'Entfernen', aw_revokeQ: '„{n}“ entfernen? Das Handy muss einen neuen Code scannen.', aw_push: 'Benachrichtigungen an', aw_noPush: 'Benachrichtigungen aus',
  aw_pcName: 'Name dieses Computers', aw_pcNameHint: 'Wird auf deinen Handys angezeigt.',
  aw_notifyAgent: 'Mein Handy benachrichtigen, wenn eine Agenten-Aufgabe fertig ist', aw_notifyAgentHint: 'Wenn die Aufgabe hier lief, während du nicht am Fenster warst.',
  aw_relays: 'Relais', aw_relaysHint: 'Bringen Handy und Computer nur in Kontakt (und dienen als Rückfall). Sie sehen nur verschlüsselte Nachrichten und speichern nichts.',
  aw_custom: 'Eigenes Relais', aw_customHint: 'MQTT über WebSocket (wss://…).',
  aw_turn: 'TURN-Server (optional)', aw_turnHint: 'Für Netze, die direkte Verbindungen blockieren.',
  aw_save: 'Speichern', aw_app: 'Handy-App', aw_appHint: 'Öffne diese Adresse auf dem Handy und füge sie zum Startbildschirm hinzu.',
  aw_pairT: 'Handy koppeln', aw_step1: 'Öffne auf dem Handy {u}', aw_step2: 'Tippe auf „Koppeln“ und richte die Kamera auf den Code',
  aw_noCam: 'Keine Kamera? Gib diesen Code ein', aw_expires: 'Läuft ab in {s}', aw_expired: 'Der Code ist abgelaufen.', aw_again: 'Neuer Code',
  aw_pairedT: '{n} ist gekoppelt', aw_pairedB: 'Du kannst jetzt vom Handy aus mit diesem Computer sprechen.', aw_done: 'Fertig',
  aw_relayUp: 'verbunden', aw_relayDown: 'nicht erreichbar', aw_relayConn: 'verbinde…', aw_phoneConv: 'Aktualisiert von {n}',
});

S.aw = { status: null, pair: null, timer: 0 };
{
  const i = TABS.findIndex((x) => x.id === 'about');
  TABS.splice(i < 0 ? TABS.length : i, 0, { id: 'anywhere', icon: 'phone' });
}
const _settingsBodyAw = settingsBody;
settingsBody = function (tab) { return tab === 'anywhere' ? anywhereTab() : _settingsBodyAw(tab); };
const _openSettingsAw = openSettings;
openSettings = async function (tab) {
  await _openSettingsAw(tab);
  if (tab === 'anywhere') { S.aw.status = await api.anywhere.status(); if (S.settingsTab === 'anywhere') renderSettings(); }
};

const awRelTime = (ts) => {
  if (!ts) return t('aw_never');
  const s = Math.round((Date.now() - ts) / 1000);
  const rtf = new Intl.RelativeTimeFormat(S.lang, { numeric: 'auto' });
  if (s < 60) return t('aw_seen', { t: rtf.format(-s, 'second') });
  if (s < 3600) return t('aw_seen', { t: rtf.format(-Math.round(s / 60), 'minute') });
  if (s < 86400) return t('aw_seen', { t: rtf.format(-Math.round(s / 3600), 'hour') });
  return t('aw_seen', { t: rtf.format(-Math.round(s / 86400), 'day') });
};
function anywhereTab() {
  const st = S.aw.status;
  if (!st) return `<div class="muted">${spinner(18)}</div>`;
  const stateChip = (d) => `<span class="aw-state ${d.state || 'off'}">${esc(t(d.state === 'direct' ? 'aw_direct' : d.state === 'relay' ? 'aw_relay' : 'aw_off'))}</span>`;
  const devs = st.devices.length ? st.devices.map((d) => `<div class="aw-dev">
      <div class="aw-dev-ic">${icon('phone', 20)}</div>
      <div class="aw-dev-main">${S.aw.editing === d.id ? `<input class="input sm aw-name" data-id="${esc(d.id)}" maxlength="60" value="${esc(d.name)}" aria-label="${esc(t('aw_rename'))}">` : `<b>${esc(d.name)}</b>`}<small>${stateChip(d)} ${esc(d.state && d.state !== 'off' ? (d.platform || '') : awRelTime(d.lastSeen))} · ${esc(t(d.push ? 'aw_push' : 'aw_noPush'))}</small></div>
      <button class="btn sm" data-action="aw-rename" data-id="${esc(d.id)}">${icon('edit', 14)} ${esc(t('aw_rename'))}</button>
      <button class="btn sm danger" data-action="aw-revoke" data-id="${esc(d.id)}">${icon('trash', 14)} ${esc(t('aw_revoke'))}</button>
    </div>`).join('') : `<p class="muted small">${esc(t('aw_none'))}</p>`;
  const relays = (st.relays || []).map((r) => `<span class="aw-relay ${r.state === 'up' ? 'up' : r.state === 'connecting' ? '' : 'down'}" title="${esc(r.url)}">${esc(r.url.replace(/^wss?:\/\//, '').replace(/[:/].*$/, ''))} · ${esc(t(r.state === 'up' ? 'aw_relayUp' : r.state === 'connecting' ? 'aw_relayConn' : 'aw_relayDown'))}</span>`).join('');
  const relayChecks = FabroAnywhere.DEFAULT_RELAYS.map((u) => `<label class="aw-check"><input type="checkbox" name="relay" value="${esc(u)}" ${st.relayList.includes(u) ? 'checked' : ''}> <span class="mono small">${esc(u)}</span></label>`).join('');
  return `
    <div class="aw-hero">
      <div class="aw-hero-txt"><p>${esc(t('aw_intro'))}</p>
        <button class="btn primary" data-action="aw-pair">${icon('qr', 15)} ${esc(t('aw_add'))}</button></div>
      <div class="aw-hero-pic" aria-hidden="true">${logo(54, 'hero-spin')}</div>
    </div>
    ${row(t('aw_enable'), `<button class="switch ${st.enabled ? 'on' : ''}" data-action="aw-enable" data-value="${!st.enabled}" role="switch" aria-checked="${!!st.enabled}" aria-label="${esc(t('aw_enable'))}"><i></i></button>`, t('aw_enableHint'))}
    <div class="st-block"><div class="st-label"><span>${esc(t('aw_devices'))}</span></div><div class="aw-devs">${devs}</div></div>
    ${row(t('aw_app'), `<span class="mono small">${esc(st.appUrl)}</span> <button class="btn sm" data-action="aw-open-app" aria-label="${esc(t('aw_app'))}">${icon('link', 14)}</button>`, t('aw_appHint'))}
    <form data-form="aw" class="aw-form" onsubmit="return false">
      ${row(t('aw_pcName'), `<input class="input" name="name" maxlength="40" value="${esc(st.name)}" aria-label="${esc(t('aw_pcName'))}">`, t('aw_pcNameHint'))}
      ${row(t('aw_notifyAgent'), `<button type="button" class="switch ${st.notifyAgent ? 'on' : ''}" data-action="aw-notify" data-value="${!st.notifyAgent}" role="switch" aria-checked="${!!st.notifyAgent}" aria-label="${esc(t('aw_notifyAgent'))}"><i></i></button>`, t('aw_notifyAgentHint'))}
      <div class="st-block"><div class="st-label"><span>${esc(t('aw_relays'))}</span><small>${esc(t('aw_relaysHint'))}</small></div>
        <div class="aw-relays">${relays}</div>${relayChecks}
        <label class="aw-field"><span>${esc(t('aw_custom'))}</span><input class="input" name="custom" placeholder="wss://…" value="${esc(st.customRelay)}"><small class="muted">${esc(t('aw_customHint'))}</small></label>
        <label class="aw-field"><span>${esc(t('aw_turn'))}</span><input class="input" name="turnUrl" placeholder="turn:host:3478" value="${esc((st.turn || {}).url || '')}">
          <span class="aw-row2"><input class="input" name="turnUser" placeholder="user" aria-label="TURN user" value="${esc((st.turn || {}).username || '')}"><input class="input" name="turnPass" type="password" placeholder="••••" aria-label="TURN password" value="${esc((st.turn || {}).credential || '')}"></span>
          <small class="muted">${esc(t('aw_turnHint'))}</small></label>
      </div>
      <div class="modal-actions"><button type="button" class="btn primary" data-action="aw-save">${esc(t('aw_save'))}</button></div>
    </form>`;
}

// ───────────────────────────── pairing modal ─────────────────────────────
function pairCode(data27) {
  const dark = document.documentElement.dataset.theme === 'dark';
  const cs = getComputedStyle(document.documentElement);
  return FabroAnywhere.ringCodeSVG(FabroAnywhere.unb64u(data27), {
    ink: cs.getPropertyValue('--text').trim() || (dark ? '#f3f1ee' : '#1f1e1b'),
    accent: cs.getPropertyValue('--logo').trim() || cs.getPropertyValue('--accent').trim() || '#ff5e42',
    mark: `<path fill-rule="evenodd" d="${FABRO_MARK}"/>`, animate: !document.documentElement.classList.contains('reduce-motion'), label: t('aw_pairT'),
  });
}
async function openPair() {
  closePopover();
  S.aw.pair = { loading: true };
  renderPair();
  try { S.aw.pair = await api.anywhere.pairStart(); } catch (e) { S.aw.pair = { error: String(e.message || e) }; }
  renderPair();
  clearInterval(S.aw.timer);
  S.aw.timer = setInterval(() => { if (!$('#modal-root .aw-pair')) { clearInterval(S.aw.timer); return; } const el = $('#aw-exp'); if (el && S.aw.pair && S.aw.pair.expires) { const s = Math.max(0, Math.round((S.aw.pair.expires - Date.now()) / 1000)); el.textContent = s ? t('aw_expires', { s: `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` }) : t('aw_expired'); if (!s) renderPair(); } }, 1000);
}
function renderPair() {
  const p = S.aw.pair || {};
  const expired = p.expires && Date.now() > p.expires;
  let body;
  if (p.paired) body = `<div class="aw-done">${icon('success', 46)}<h2>${esc(t('aw_pairedT', { n: p.paired.name }))}</h2><p class="muted">${esc(t('aw_pairedB'))}</p></div>
      <div class="modal-actions"><button class="btn primary" data-action="aw-pair-close">${esc(t('aw_done'))}</button></div>`;
  else body = `<div class="aw-pair-grid">
      <div class="aw-code ${expired ? 'expired' : ''}">${p.data27 && !expired ? pairCode(p.data27) : p.error ? `<p class="err">${esc(p.error)}</p>` : expired ? `<button class="btn primary" data-action="aw-pair">${icon('refresh', 15)} ${esc(t('aw_again'))}</button>` : spinner(40)}</div>
      <ol class="aw-steps">
        <li>${esc(t('aw_step1', { u: '' }))}<b class="mono">${esc((p.appUrl || '').replace(/^https:\/\//, ''))}</b></li>
        <li>${esc(t('aw_step2'))}</li>
      </ol>
      ${p.text && !expired ? `<details class="aw-text"><summary>${esc(t('aw_noCam'))}</summary><code>${esc(p.text)}</code></details>` : ''}
      <small class="muted" id="aw-exp"></small>
    </div>
    <div class="modal-actions"><button class="btn" data-action="aw-pair-close">${esc(t('close'))}</button></div>`;
  $('#modal-root').innerHTML = `<div class="modal-backdrop" data-action="aw-pair-close"></div>
    <div class="modal aw-pair" role="dialog" aria-modal="true" aria-labelledby="aw-pair-t"><h2 id="aw-pair-t">${icon('phone', 20)} ${esc(t('aw_pairT'))}</h2>${body}</div>`;
}

Object.assign(actions, {
  'aw-pair': () => openPair(),
  'aw-pair-close': () => { if (S.aw.pair && !S.aw.pair.paired) api.anywhere.pairStop(); S.aw.pair = null; clearInterval(S.aw.timer); closeModal(); },
  'aw-enable': async (el) => { S.aw.status = await api.anywhere.configure({ enabled: el.dataset.value === 'true' }); renderSettings(); },
  'aw-notify': async (el) => { S.aw.status = await api.anywhere.configure({ notifyAgent: el.dataset.value === 'true' }); renderSettings(); },
  'aw-open-app': () => api.shell.open(S.aw.status.appUrl),
  'aw-rename': (el) => { S.aw.editing = el.dataset.id; renderSettings(); const i = $('.aw-name'); if (i) { i.focus(); i.select(); } },
  'aw-revoke': async (el) => {
    const d = S.aw.status.devices.find((x) => x.id === el.dataset.id); if (!d) return;
    if (!confirm(t('aw_revokeQ', { n: d.name }))) return;
    await api.anywhere.revoke(d.id); S.aw.status = await api.anywhere.status(); renderSettings();
  },
  'aw-save': async () => {
    const f = $('.st-content form[data-form="aw"]'); if (!f) return;
    const v = (n) => (f.querySelector(`[name="${n}"]`) || {}).value || '';
    const relays = [...f.querySelectorAll('input[name="relay"]:checked')].map((x) => x.value);
    const custom = v('custom').trim();
    if (custom && !/^wss:\/\/|^ws:\/\/(127\.0\.0\.1|localhost)/.test(custom)) { toast('wss://…', 'err'); return; }
    const turnUrl = v('turnUrl').trim();
    S.aw.status = await api.anywhere.configure({ name: v('name').trim(), relays: relays.length ? relays : FabroAnywhere.DEFAULT_RELAYS, customRelay: custom, turn: turnUrl ? { url: turnUrl, username: v('turnUser'), credential: v('turnPass') } : null });
    toast(t('cx_saved'));
    renderSettings();
  },
});

// ───────────────────────────── events from the main process ─────────────────────────────
let awConvT = null;
api.on('anywhere:event', async (ev) => {
  if (ev.type === 'status') { S.aw.status = ev.status; if (S.settingsTab === 'anywhere') renderSettings(); return; }
  if (ev.type === 'paired') {
    if (S.aw.pair) { S.aw.pair = { ...S.aw.pair, paired: ev.device }; clearInterval(S.aw.timer); renderPair(); }
    if (typeof announce === 'function') announce(t('aw_pairedT', { n: ev.device.name }));
    return;
  }
  if (ev.type === 'conv') {
    clearTimeout(awConvT);
    awConvT = setTimeout(async () => {
      S.convs = await api.conv.list(); renderRecents();
      if (S.conv && S.conv.id === ev.id && !S.streaming) {
        if (ev.deleted) { newChat(); return; }
        try { const c = treeify(await api.conv.get(ev.id)); if (c) { S.conv = c; renderView(); } } catch {}
      }
    }, 150);
  }
});
// The phone runs use this window's context so answers match the desktop (prompt, tools, styles, memory).
api.on('anywhere:ask', async ({ id, name }) => {
  let value = null;
  try {
    if (name === 'context') value = {
      system: systemPrompt(), agentPrompt: typeof agentPrompt === 'function' ? agentPrompt() : '', tools: chatTools(),
      gen: S.settings.gen, model: S.settings.selectedModel, lang: S.lang, agentEnabled: (S.settings.agent || {}).enabled !== false,
    };
  } catch {}
  api.anywhere.reply(id, value);
});

async function awCommitName(input) {
  const id = input.dataset.id, name = input.value.trim();
  S.aw.editing = null;
  if (name) await api.anywhere.rename(id, name);
  S.aw.status = await api.anywhere.status(); renderSettings();
}
document.addEventListener('keydown', (e) => {
  const i = e.target && e.target.classList && e.target.classList.contains('aw-name') ? e.target : null; if (!i) return;
  if (e.key === 'Enter') { e.preventDefault(); awCommitName(i); }
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); S.aw.editing = null; renderSettings(); }
}, true);
document.addEventListener('focusout', (e) => { if (e.target && e.target.classList && e.target.classList.contains('aw-name') && S.aw.editing) awCommitName(e.target); });

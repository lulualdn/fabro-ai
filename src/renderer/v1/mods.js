'use strict';
// Loads the mods written for the v1 API: their "ui" files, injected by the main process (src/main/mods.js) with
// window.Fabro and their own handle. If the last load never finished (a crash or a freeze), this start is without
// mods; so is the start after the window crashed. Settings → General shows it and turns them back on.
(function () {
  const KEY = 'v1-mods-loading';
  Fabro.on('ready', async () => {
    let stuck = false; try { stuck = localStorage.getItem(KEY) === '1'; } catch {}
    if (stuck) { try { localStorage.removeItem(KEY); } catch {} V1.S.modsOff = true; V1.toast(V1.t('modsSafe')); return; }
    try { localStorage.setItem(KEY, '1'); } catch {}
    const r = await api.mods.ready('v1').catch(() => null);
    setTimeout(() => { try { localStorage.removeItem(KEY); } catch {} }, 5000);
    if (r && r.safe) { V1.S.modsOff = true; V1.toast(V1.t('modsSafe')); }
  });
  // a card the AI shows above the chat (show_card): its buttons answer as the user
  api.on('v1:card', (c) => {
    Fabro.ui.card({ id: c.id, title: c.title, sub: c.sub, actions: (c.actions || []).map((a) => ({ label: a.label, primary: a.primary, run: () => { Fabro.ui.removeCard(c.id); if (a.reply) Fabro.chat.send(a.reply); } })) });
  });
})();

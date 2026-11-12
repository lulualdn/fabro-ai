'use strict';
/* v0.2 perf: two discreet notices from the main process — a model on a slow disk (with "No thanks", remembered)
   and a model unloaded because memory ran low. Reuses the app's .toast. */
(function () {
  if (!window.api || !api.on) return;
  function notice(text, actions, ms) {
    const el = document.createElement('div');
    el.className = 'toast perf-advice';
    const p = document.createElement('span'); p.textContent = text; el.appendChild(p);
    if (actions && actions.length) {
      const box = document.createElement('span'); box.className = 'pa-acts';
      for (const a of actions) {
        const b = document.createElement('button'); b.className = 'btn sm' + (a.primary ? ' primary' : ''); b.textContent = a.label;
        b.addEventListener('click', () => { close(); Promise.resolve(a.run()).catch((e) => toast(String(e.message || e), 'err')); });
        box.appendChild(b);
      }
      el.appendChild(box);
    }
    const root = document.getElementById('toasts'); if (!root) return;
    root.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    let tm = setTimeout(close, ms || 14000);
    el.addEventListener('mouseenter', () => clearTimeout(tm));
    el.addEventListener('mouseleave', () => { tm = setTimeout(close, 5000); });
    function close() { clearTimeout(tm); el.classList.remove('show'); setTimeout(() => el.remove(), 300); }
  }
  const kindName = (k) => (t('perf_kind_' + k) !== 'perf_kind_' + k ? t('perf_kind_' + k) : k);
  api.on('storage:advice', (a) => {
    if (!a) return;
    const no = { label: t('perf_noThanks'), run: () => api.resources.storageRefuse(a.modelId) };
    if (a.suggestion === 'move') {
      notice(t('perf_slowMove', { model: a.modelName, kind: kindName(a.storage.kind), lib: a.toLibrary.name }),
        [{ label: t('perf_move'), primary: true, run: () => api.models.move(a.modelId, a.toLibrary.id) }, no]);
    } else if (a.smallModel) {
      const room = a.makeRoomBytes ? Math.ceil(a.makeRoomBytes / 2 ** 30) : 0;
      notice(t('perf_slowSmall', { model: a.modelName, kind: kindName(a.storage.kind), small: a.smallModel.name, size: a.smallModel.sizeGB }) + (room ? t('perf_slowSmallRoom', { room }) : ''),
        [{ label: t('perf_get'), primary: true, run: () => api.models.download({ repo: a.smallModel.repo, catalogId: a.smallModel.id }) }, no]);
    }
  });
  api.on('resources:pressure', (p) => { if (p && p.unloaded) notice(t('perf_unloaded', { model: p.unloaded.name }), null, 6000); });
})();

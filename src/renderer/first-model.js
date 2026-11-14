// First model. On a fresh install with no model at all, the recommended one (Gemma 4 E4B when this computer can run
// it) is downloaded without asking, so the first chat is not an empty screen. If a model was there before and has
// been removed, nothing starts alone: the welcome card proposes it. Never on Fabro Anywhere, never in the tests.
(() => {
  async function check() {
    if (!S.info || S.info.e2e || S.info.remote || !S.installed) return false;
    const has = (S.installed.local || []).some((m) => !m.role);
    if (has) { if (!S.settings.hadModel) await saveSettings({ hadModel: true }); return false; }
    if (S.settings.hadModel || S.settings.firstModelStarted) return false;
    if (allModels().length) return false; // a cloud model or another local server is already set up
    const cat = S.catalog; const rec = cat && (cat.items || []).find((m) => m.id === cat.recommended);
    if (!rec || rec.blocked) return false;
    if (Object.values(S.downloads || {}).some((d) => d.status === 'downloading' || d.status === 'paused')) return false;
    await saveSettings({ firstModelStarted: true }); // once: stopping the download is a choice, it does not start again
    try {
      await api.models.download({ repo: rec.repo, catalogId: rec.id });
      toast(t('fm_started', { name: rec.name, size: rec.sizeGB }));
      if (typeof renderView === 'function') renderView();
      return true;
    } catch { await saveSettings({ firstModelStarted: false }).catch(() => {}); return false; } // no network…: tried again at the next start, and the welcome card offers it
  }
  window.FirstModel = { check };
})();

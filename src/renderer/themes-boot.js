/* Runs in <head>, before the first paint: puts the last theme back from a small cache (written by themes.js)
   so the window never flashes the default look first. The real settings take over a moment later. */
(function () {
  try {
    const c = JSON.parse(localStorage.getItem('fabro.skin') || 'null');
    if (!c || !c.id || c.id === 'fabro' || typeof c.css !== 'string') return;
    const d = document.documentElement;
    const st = document.createElement('style'); st.id = 'fabro-skin'; st.textContent = c.css; document.head.appendChild(st);
    d.dataset.skin = c.id; if (c.layout) d.dataset.layout = c.layout; if (c.mode) d.dataset.theme = c.mode;
    if (c.over) d.dataset.tex = 'over';
    if (c.sheet) { const l = document.createElement('link'); l.rel = 'stylesheet'; l.id = 'fabro-skin-sheet'; l.dataset.sheet = c.sheet; l.href = 'styles/themes/' + c.sheet; document.head.appendChild(l); }
  } catch (e) { /* no cache: default look */ }
})();

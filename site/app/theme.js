// Applied before the first paint (no flash): saved theme, else the system's.
(function () { var t = null; try { t = JSON.parse(localStorage.getItem('fa-theme') || 'null'); } catch (e) {} var d = t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches; document.documentElement.dataset.theme = d ? 'dark' : 'light'; })();

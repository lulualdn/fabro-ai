// Applied before the first paint: the system's theme (app.js applies the saved one right after).
try { document.documentElement.dataset.theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; } catch (e) {}

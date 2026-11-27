// Applied before the first paint: saved theme (or the system's), eco mode, and the real visible height
// (an iPhone home-screen app gets 100vh wrong; with the keyboard open, the interface takes the visible part).
(function () {
  var r = document.documentElement, t = 'auto', eco = false;
  try { t = localStorage.getItem('fa-theme') || 'auto'; eco = localStorage.getItem('fa-eco') === '1'; } catch (e) {}
  r.dataset.theme = t === 'auto' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : t;
  if (eco) r.classList.add('eco');
  var set = function () {
    var h = window.innerHeight, v = window.visualViewport, kb = !!v && v.height < h - 120;
    if (kb) { h = Math.round(v.height); if (window.scrollY) window.scrollTo(0, 0); }
    r.classList.toggle('kb-open', kb);
    r.style.setProperty('--app-h', h + 'px');
  };
  set();
  if (window.visualViewport) visualViewport.addEventListener('resize', set);
  addEventListener('resize', set);
})();

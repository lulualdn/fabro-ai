// Applied before the first paint (no flash): saved theme, else the system's. Halloween is a skin over dark.
(function () { var t = null; try { t = JSON.parse(localStorage.getItem('fa-theme') || 'null'); } catch (e) {} var d = t ? t === 'dark' || t === 'halloween' : matchMedia('(prefers-color-scheme: dark)').matches; var r = document.documentElement; r.dataset.theme = d ? 'dark' : 'light'; var n = new Date(), sp = (n.getMonth() === 9 && n.getDate() >= 15) || (n.getMonth() === 10 && n.getDate() <= 3); if (t === 'halloween' && sp) r.dataset.skin = 'halloween'; })();

// The real screen height: in an iPhone home-screen app, 100vh / 100dvh leave out the status bar and a band stays
// empty at the bottom — the window's own height is right.
// In an iPhone home-screen app even the window's height can miss the status bar: there, the screen's own height
// is used (unless the keyboard is open).
(function () { var r = document.documentElement; var set = function () {
  var h = window.innerHeight;
  if (navigator.standalone) {
    var land = Math.abs(window.orientation || 0) === 90 || innerWidth > innerHeight;
    var sh = land ? Math.min(screen.width, screen.height) : Math.max(screen.width, screen.height);
    var vv = window.visualViewport ? visualViewport.height : h;
    if (vv > sh * 0.75) h = Math.max(h, sh);
  }
  r.style.setProperty('--app-h', h + 'px');
}; set(); addEventListener('resize', set); addEventListener('orientationchange', function () { setTimeout(set, 300); }); if (window.visualViewport) visualViewport.addEventListener('resize', set); })();

// The loading screen (in index.html): shown at start and while the interface loads, hidden once it's there.
window.FASplash = {
  show: function (text) { var el = document.getElementById('splash'); if (!el) return; el.classList.remove('gone'); var tx = el.querySelector('.sp-text'); if (tx) tx.textContent = text || ''; clearTimeout(this._t); var self = this; this._t = setTimeout(function () { self.hide(); }, 20000); },
  text: function (text) { var el = document.querySelector('#splash .sp-text'); if (el) el.textContent = text || ''; },
  hide: function () { var el = document.getElementById('splash'); if (el) el.classList.add('gone'); clearTimeout(this._t); },
};
setTimeout(function () { window.FASplash.hide(); }, 20000);

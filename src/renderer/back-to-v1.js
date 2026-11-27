// The previous interface, opened from the new one (Settings → Advanced): a small button to go back.
(function () {
  const b = document.createElement('button');
  b.textContent = (navigator.language || '').startsWith('fr') ? 'Nouvelle interface' : 'New interface';
  b.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:9999;height:30px;padding:0 12px;border-radius:9px;border:1px solid rgba(127,127,127,.3);background:rgba(20,19,18,.85);color:#f1ece6;font:13px system-ui;cursor:pointer';
  b.onclick = () => window.api.ui.switch('v1');
  addEventListener('DOMContentLoaded', () => document.body.appendChild(b));
})();

'use strict';
/* Accessibility: everything clickable is reachable with the keyboard, icon buttons have names, menus
   work with the arrow keys, dialogs trap focus, important changes are announced to screen readers,
   and animations can be reduced from the app (on top of the system setting). */

// ───────────────────────────── announcements ─────────────────────────────
const live = document.createElement('div');
live.id = 'sr-live'; live.className = 'sr-only'; live.setAttribute('aria-live', 'polite'); live.setAttribute('role', 'status');
document.body.appendChild(live);
function announce(text) { live.textContent = ''; setTimeout(() => { live.textContent = String(text || '').slice(0, 300); }, 40); }
$('#toasts').setAttribute('role', 'status'); $('#toasts').setAttribute('aria-live', 'polite');

// Skip link to the message box.
const skip = document.createElement('a');
skip.href = '#prompt'; skip.className = 'skip-link'; skip.textContent = t('a11y_skip');
skip.addEventListener('click', (e) => { e.preventDefault(); const p = $('#prompt'); if (p) p.focus(); });
document.body.prepend(skip);

// ───────────────────────────── keyboard reachability ─────────────────────────────
// Clickable non-buttons (recents, tree nodes, cards…) become focusable buttons; icon buttons get a name.
const NATIVE = /^(BUTTON|A|INPUT|SELECT|TEXTAREA|SUMMARY|OPTION|LABEL)$/;
function enhance(root) {
  for (const el of root.querySelectorAll('[data-action]')) {
    if (!NATIVE.test(el.tagName) && !el.hasAttribute('tabindex')) { el.tabIndex = 0; if (!el.getAttribute('role')) el.setAttribute('role', 'button'); }
    if (!el.getAttribute('aria-label') && el.title && !el.textContent.trim()) el.setAttribute('aria-label', el.title);
  }
  for (const el of root.querySelectorAll('button.icon-btn:not([aria-label])')) if (el.title) el.setAttribute('aria-label', el.title);
}
let enhT = 0;
new MutationObserver(() => { if (enhT) return; enhT = requestAnimationFrame(() => { enhT = 0; enhance(document.body); }); }).observe(document.body, { childList: true, subtree: true });
enhance(document.body);
document.addEventListener('keydown', (e) => {
  const el = e.target;
  if ((e.key === 'Enter' || e.key === ' ') && el && el.dataset && el.dataset.action && !NATIVE.test(el.tagName) && !el.isContentEditable) {
    e.preventDefault(); el.click();
  }
});

// ───────────────────────────── menus & dialogs ─────────────────────────────
let popOpener = null;
const popItems = () => [...document.querySelectorAll('#popover-root .popover button:not([disabled]), #popover-root .popover input, #popover-root .popover [role=button]')];
new MutationObserver(() => {
  const pop = $('#popover-root .popover');
  if (pop) {
    pop.setAttribute('role', 'menu');
    if (!pop.contains(document.activeElement)) { popOpener = popOpener || document.activeElement; const f = pop.querySelector('.sel') || popItems()[0]; if (f) f.focus({ preventScroll: true }); }
  } else if (popOpener) { if (document.contains(popOpener)) popOpener.focus({ preventScroll: true }); popOpener = null; }
}).observe($('#popover-root'), { childList: true });
let modalOpener = null;
new MutationObserver(() => {
  const m = $('#modal-root .modal');
  if (m) { modalOpener = modalOpener || document.activeElement; m.setAttribute('role', m.getAttribute('role') || 'dialog'); m.setAttribute('aria-modal', 'true'); if (!m.contains(document.activeElement)) { const f = m.querySelector('[autofocus], input, textarea, select, button.primary, button'); if (f) setTimeout(() => f.focus(), 30); } }
  else if (modalOpener) { if (document.contains(modalOpener)) modalOpener.focus(); modalOpener = null; }
}).observe($('#modal-root'), { childList: true, subtree: false });
document.addEventListener('keydown', (e) => {
  const pop = $('#popover-root .popover');
  if (pop) {
    const items = popItems(); const i = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const n = items.length; if (n) items[((i < 0 ? -1 : i) + (e.key === 'ArrowDown' ? 1 : -1) + n) % n].focus(); }
    if (e.key === 'Home') { e.preventDefault(); items[0] && items[0].focus(); }
    if (e.key === 'End') { e.preventDefault(); items[items.length - 1] && items[items.length - 1].focus(); }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePopover(); }
    if (e.key === 'Tab') { e.preventDefault(); closePopover(); }
    return;
  }
  const m = $('#modal-root .modal');
  if (m && e.key === 'Tab') {
    const f = [...m.querySelectorAll('button:not([disabled]), input:not([disabled]), select, textarea, a[href], [tabindex]:not([tabindex="-1"])')].filter((x) => x.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
}, true);

// ───────────────────────────── reduced motion ─────────────────────────────
function applyMotion() { document.documentElement.classList.toggle('reduce-motion', !!(S.settings && S.settings.reduceMotion)); }
const _applySetting = applySetting;
applySetting = async function (key, value) { await _applySetting(key, value); if (key === 'reduceMotion') applyMotion(); };
const _origMM = window.matchMedia.bind(window);
window.matchMedia = (q) => (/prefers-reduced-motion:\s*reduce/.test(q) && S.settings && S.settings.reduceMotion ? { matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} } : _origMM(q));
(function waitSettings() { if (S.settings) applyMotion(); else setTimeout(waitSettings, 100); })();

// ───────────────────────────── announce what matters ─────────────────────────────
const _onChat = onChatEvent;
onChatEvent = function (ev) {
  const was = S.streaming && ev.reqId === S.streaming.reqId;
  _onChat(ev);
  if (!was) return;
  if (ev.type === 'done' && !ev.aborted) announce(t('a11y_answered'));
  if (ev.type === 'error') announce(t('a11y_error', { m: ev.message || '' }));
  if (ev.type === 'permission') announce(t('a11y_permission', { s: ev.summary || ev.tool || '' }));
  if (ev.type === 'agent_switch') announce(t('agentOn'));
};

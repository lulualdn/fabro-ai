'use strict';
/* Fabro quick bar — opened by the global AI hotkey (Copilot key / Ctrl+Win+Space). */
const Q = { lang: 'en', state: { convId: null, title: '' }, target: 'current', reqId: null, text: '', reasoning: '', busy: false, model: '' };
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const t = (k, v) => { let s = (I18N[Q.lang] || I18N.en)[k] ?? I18N.en[k] ?? k; if (v) s = s.replace(/\{(\w+)\}/g, (_, x) => v[x] ?? ''); return s; };

function paintTarget() {
  const b = $('#q-target');
  const hasConv = !!Q.state.convId;
  b.hidden = !hasConv;
  const isNew = Q.target === 'new' || !hasConv;
  b.classList.toggle('new', isNew);
  b.innerHTML = isNew ? `${icon('plus', 14)}<b>${esc(t('quickNew'))}</b>` : `${icon('chat', 14)}<b>${esc(Q.state.title || t('untitled'))}</b>`;
  b.title = t('quickTargetHint');
  $('#q').placeholder = isNew ? t('placeholder') : t('replyPlaceholder');
}
function setBusy(on) { Q.busy = on; document.body.classList.toggle('busy', on); }
function fit() { requestAnimationFrame(() => api.quick.resize($('#wrap').getBoundingClientRect().height + 8)); }

function render() {
  const card = $('#qcard'), ans = $('#q-ans');
  if (!Q.reqId) { card.hidden = true; fit(); return; }
  card.hidden = false;
  if (Q.error) ans.innerHTML = `<p class="err">${esc(Q.error)}</p>`;
  else if (Q.text) ans.innerHTML = DOMPurify.sanitize(marked.parse(Q.text));
  else ans.innerHTML = `<p>${esc(Q.reasoning ? t('thinking') : t('quickWaiting'))}</p>`;
  ans.classList.toggle('empty', !Q.text && !Q.error);
  ans.scrollTop = ans.scrollHeight;
  $('#q-meta').textContent = Q.busy ? '' : Q.stats ? [Q.stats.completionTokens && t('tokensOut', { n: Q.stats.completionTokens }), Q.stats.tokPerSec && `${Q.stats.tokPerSec} tok/s`].filter(Boolean).join(' · ') : '';
  fit();
}

function submit(e) {
  e && e.preventDefault();
  const text = $('#q').value.trim();
  if (!text || Q.busy) return;
  Q.reqId = 'pending'; Q.text = ''; Q.reasoning = ''; Q.error = ''; Q.stats = null;
  setBusy(true); render();
  api.quick.submit({ text, target: Q.target });
  $('#q').value = ''; $('#q-send').disabled = true;
}

$('#qbar').addEventListener('submit', submit);
$('#q').addEventListener('input', () => { $('#q-send').disabled = !$('#q').value.trim(); });
$('#q-target').addEventListener('click', () => { Q.target = Q.target === 'new' ? 'current' : 'new'; paintTarget(); $('#q').focus(); });
$('#q-open').addEventListener('click', () => api.quick.open());
$('#q-copy').addEventListener('click', () => { navigator.clipboard.writeText(Q.text || ''); $('#q-copy').innerHTML = `${icon('check', 14)} ${esc(t('copied'))}`; setTimeout(paintButtons, 1200); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { e.preventDefault(); api.quick.hide(); }
  if (e.key === 'Tab' && Q.state.convId) { e.preventDefault(); $('#q-target').click(); }
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && Q.reqId) { e.preventDefault(); api.quick.open(); }
});
function paintButtons() {
  $('#q-copy').innerHTML = `${icon('copy', 14)} ${esc(t('copy'))}`;
  $('#q-open').innerHTML = `${icon('expand', 14)} ${esc(t('quickOpen'))} <kbd>Ctrl ↵</kbd>`;
  $('#q-send').innerHTML = icon('up', 18);
}

api.on('quick:show', (s) => {
  Q.state = { convId: s.convId, title: s.title };
  Q.target = s.target === 'new' ? 'new' : 'current';
  document.documentElement.dataset.theme = s.dark ? 'dark' : 'light';
  if (!Q.busy) { Q.reqId = null; render(); }
  paintTarget();
  const q = $('#q'); q.focus(); q.select();
  $('#qbar').style.animation = 'none'; void $('#qbar').offsetWidth; $('#qbar').style.animation = '';
});
api.on('quick:started', (info) => {
  if (info.error) { Q.error = info.error; setBusy(false); render(); return; }
  Q.reqId = info.reqId; Q.model = info.model || '';
  if (info.convId) Q.state = { convId: info.convId, title: info.title || Q.state.title };
  Q.target = 'current'; paintTarget();
});
api.on('chat:event', (ev) => {
  if (!Q.reqId || ev.reqId !== Q.reqId) return;
  if (ev.type === 'token') Q.text += ev.text;
  else if (ev.type === 'reasoning') Q.reasoning += ev.text;
  else if (ev.type === 'done') { Q.stats = ev.stats; setBusy(false); }
  else if (ev.type === 'error') { Q.error = ev.message; setBusy(false); }
  scheduleRender();
});
let raf = 0;
function scheduleRender() { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; render(); }); }

(async () => {
  const [info, settings] = await Promise.all([api.info(), api.settings.get()]);
  const pref = settings.language;
  const sys = [...(info.systemLanguages || []), info.locale || ''];
  Q.lang = pref && pref !== 'auto' && I18N[pref] ? pref : (sys.map((l) => String(l).slice(0, 2)).find((c) => I18N[c]) || 'en');
  marked.use({ gfm: true });
  $('#q-logo').innerHTML = logo(22);
  paintButtons(); paintTarget();
})();

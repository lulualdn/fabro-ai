'use strict';
/* Fabro quick bar — opened by the global AI hotkey (Copilot key / Ctrl+Win+Space). */
const Q = { lang: 'en', state: { convId: null, title: '' }, target: 'current', reqId: null, text: '', reasoning: '', busy: false, model: '', atts: [] };
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
  const attachments = Q.atts.splice(0); paintAtts();
  api.quick.submit({ text, target: Q.target, attachments }).then((r) => { if (r && r.command) { Q.reqId = null; setBusy(false); render(); } });
  $('#q').value = ''; $('#q-send').disabled = true;
}

// ── attachments: the screenshot taken when the bar opens, plus pasted / dropped files and images ──
const L2 = {
  en: { screen: 'Screen', screenHint: 'A screenshot of your screen is attached. × removes it.', remove: 'Remove' },
  fr: { screen: 'Écran', screenHint: 'Une capture de votre écran est jointe. × la retire.', remove: 'Retirer' },
};
const t2 = (k) => (L2[Q.lang] || L2.en)[k];
function paintAtts() {
  const el = $('#q-atts');
  el.hidden = !Q.atts.length;
  el.innerHTML = Q.atts.map((a, i) => `<span class="q-att" title="${esc(a.screen ? t2('screenHint') : a.name)}">
      ${a.kind === 'image' ? `<img src="${a.data}" alt="">` : `<span class="q-ficon">${icon('file', 16)}</span>`}
      <b>${esc(a.screen ? t2('screen') : a.name)}</b><button type="button" data-rm="${i}" title="${esc(t2('remove'))}">${icon('x', 13)}</button></span>`).join('');
  fit();
}
$('#q-atts').addEventListener('click', (e) => { const b = e.target.closest('[data-rm]'); if (!b) return; Q.atts.splice(+b.dataset.rm, 1); paintAtts(); $('#q').focus(); });
const TXT = /\.(txt|md|markdown|json|csv|tsv|js|mjs|ts|tsx|jsx|py|lua|luau|html?|css|xml|ya?ml|toml|ini|sh|c|h|cpp|cs|java|go|rs|php|rb|sql|log)$/i;
const readAs = (f, how) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r[how](f); });
async function addFiles(files) {
  for (const f of files) {
    if (f.type.startsWith('image/')) Q.atts.push({ kind: 'image', name: f.name || 'image.png', type: f.type, size: f.size, data: await readAs(f, 'readAsDataURL') });
    else if ((TXT.test(f.name) || f.type.startsWith('text/')) && f.size < 2 * 1024 * 1024) Q.atts.push({ kind: 'text', name: f.name, type: f.type || 'text/plain', size: f.size, text: await readAs(f, 'readAsText') });
    else { const p = api.files.pathOf(f); if (p) Q.atts.push({ kind: 'file', name: f.name, type: f.type, size: f.size, path: p }); }
  }
  paintAtts();
}
document.addEventListener('paste', (e) => { const files = [...(e.clipboardData?.files || [])]; if (files.length) { e.preventDefault(); addFiles(files); } });
['dragenter', 'dragover'].forEach((ev) => document.addEventListener(ev, (e) => { e.preventDefault(); document.body.classList.add('drag'); }));
document.addEventListener('dragleave', (e) => { if (!e.relatedTarget) document.body.classList.remove('drag'); });
document.addEventListener('drop', (e) => { e.preventDefault(); document.body.classList.remove('drag'); if (e.dataTransfer.files.length) addFiles([...e.dataTransfer.files]); $('#q').focus(); });

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
  if (!Q.busy) { Q.atts = Q.atts.filter((a) => !a.screen); if (s.screenshot) Q.atts.unshift({ ...s.screenshot, screen: true }); paintAtts(); }
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
  window.fabro = { version: 1, api, forMod: (id) => ({ id, api, call: (m, ...a) => api.mods.call(id, m, a) }) };
  api.mods.ready('quick').catch(() => {}); // quick-bar parts of enabled mods
})();

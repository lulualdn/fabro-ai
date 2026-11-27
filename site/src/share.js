'use strict';
// fabro.ufstudios.eu/s/<id>: a conversation shown as a read-only preview, or an artifact shown and downloadable.
// Artifacts run in an iframe from /api/share?raw=1, which carries a CSP sandbox: an opaque origin, no access to
// this site. Conversation text goes through marked + DOMPurify.
(function () {
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const t = (k) => (window.t ? window.t(k) : k);
  const id = (location.pathname.match(/\/s\/([A-Za-z0-9]{10})/) || [])[1] || new URLSearchParams(location.search).get('id');
  const box = $('#share');
  const mark = $('#mark-tpl') ? $('#mark-tpl').innerHTML : '';
  const md = (s) => DOMPurify.sanitize(marked.parse(String(s || ''), { gfm: true, breaks: true })).replace(/<a href=/g, '<a rel="noopener nofollow" target="_blank" href=');
  const EXT = { html: 'html', page: 'html', web: 'html', svg: 'svg', markdown: 'md', md: 'md', mermaid: 'mmd', csv: 'csv', json: 'json', python: 'py', javascript: 'js', typescript: 'ts', css: 'css', lua: 'lua', luau: 'luau' };
  const extOf = (a) => EXT[a.lang] || EXT[a.type] || (/^\s*</.test(a.content) ? 'html' : 'txt');
  const visual = (a) => extOf(a) === 'html' || extOf(a) === 'svg';
  const date = (ms) => new Date(ms).toLocaleDateString(document.documentElement.lang || 'fr', { year: 'numeric', month: 'long', day: 'numeric' });

  function conv(d) {
    document.title = (d.title || 'Fabro') + ' · Fabro';
    box.innerHTML = `<header class="sh-head"><p class="kicker">${esc(t('sh_conv'))} · ${esc(date(d.created))}</p><h1>${esc(d.title || '…')}</h1></header>
      <div class="sh-thread">${d.messages.map((m) => m.role === 'user'
        ? `<div class="sh-you">${m.files && m.files.length ? `<div class="sh-files">${m.files.map((f) => `<span>${esc(f)}</span>`).join('')}</div>` : ''}${m.content ? `<div class="q">${esc(m.content)}</div>` : ''}</div>`
        : `<div class="sh-ai"><div class="mk">${mark}</div><div>${m.steps && m.steps.length ? `<p class="sh-steps">${m.steps.length} ${esc(t('sh_steps'))}</p>` : ''}<div class="md">${md(m.content)}</div>
            ${(m.artifacts || []).map((a) => `<div class="sh-art">${esc(a.title)}<small>${esc(a.type)}</small></div>`).join('')}
            ${m.sources && m.sources.length ? `<div class="sh-src">${m.sources.map((s, i) => `<a href="${esc(s.url)}" rel="noopener nofollow" target="_blank"><b>${i + 1}</b>${esc(new URL(s.url).hostname.replace(/^www\./, ''))}</a>`).join('')}</div>` : ''}
            ${m.model ? `<p class="sh-model">${esc(m.model)}</p>` : ''}</div></div>`).join('')}</div>`;
  }
  function artifact(d) {
    document.title = (d.title || 'Fabro') + ' · Fabro';
    const ext = extOf(d);
    box.innerHTML = `<header class="sh-head row"><div><p class="kicker">${esc(t('sh_art'))} · ${esc(date(d.created))}</p><h1>${esc(d.title || '…')}</h1></div>
      <div class="sh-acts"><button class="btn pri" id="dl">${esc(t('sh_dl'))} .${ext}</button>${visual(d) ? `<a class="btn" href="/api/share?id=${esc(id)}&raw=1" target="_blank" rel="noopener">${esc(t('sh_full'))}</a>` : ''}</div></header>
      ${visual(d) ? `<div class="sh-frame"><iframe src="/api/share?id=${esc(id)}&raw=1" sandbox="allow-scripts allow-popups" referrerpolicy="no-referrer" title="${esc(d.title)}"></iframe></div>`
        : ext === 'md' ? `<article class="prose sh-doc">${md(d.content)}</article>` : `<pre class="sh-code"><code>${esc(d.content)}</code></pre>`}`;
    $('#dl').onclick = () => {
      const blob = new Blob([d.content], { type: ext === 'html' ? 'text/html' : ext === 'svg' ? 'image/svg+xml' : 'text/plain' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = (d.title || 'fabro').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80) + '.' + ext;
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    };
  }
  let data = null;
  async function load() {
    if (!id) { box.innerHTML = `<p class="empty">${esc(t('sh_missing'))}</p>`; return; }
    try { const r = await fetch('/api/share?id=' + encodeURIComponent(id)); if (!r.ok) throw new Error(r.status); data = await r.json(); }
    catch { box.innerHTML = `<p class="empty">${esc(t('sh_missing'))}</p>`; return; }
    paint();
  }
  const paint = () => { if (data) (data.kind === 'artifact' ? artifact : conv)(data); };
  document.addEventListener('langchange', paint);
  load();
})();

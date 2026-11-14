/* Card shown when the AI proposes an install (skill, MCP server, system prompt): one question, yes / cancel.
   Main side: src/main/agent/installs.js. Mounted by permCard() in agent-ui.js when perm.kind === 'install'.
   Public: window.InstallCard = { html(step) }. */
(function () {
  const ICON = { skill: 'sparkle', mcp: 'plug', prompt: 'file' };
  function html(st) {
    const p = st.perm, w = ['skill', 'mcp', 'prompt'].includes(p.what) ? p.what : 'skill';
    const ic = icon(ICON[w], 16) || icon('download', 16) || icon('shield', 16);
    const items = (p.items || []).length > 1 || (p.items || []).some((i) => i.description || (i.warnings || []).length)
      ? `<ul class="ins-items">${p.items.map((i) => `<li><b>${esc(i.name)}</b>${i.description ? `<span>${esc(i.description)}</span>` : ''}${(i.warnings || []).map((x) => `<small class="ins-warn">${esc(x)}</small>`).join('')}</li>`).join('')}</ul>` : '';
    return `<div class="perm-card ins-card">
      <div class="pc-head">${ic}<b>${esc(t('ins_' + w))}</b></div>
      <div class="ins-name">${esc(p.title || '')}</div>
      ${p.why ? `<div class="ins-why">${esc(p.why)}</div>` : ''}
      ${items}
      ${p.text ? `<pre class="pc-what ins-text">${esc(p.text)}</pre>` : p.source ? `<pre class="pc-what">${esc(p.source)}</pre>` : ''}
      ${(p.needs || []).length ? `<div class="pc-why">${esc(t('ins_needs', { l: p.needs.join(', ') }))}</div>` : ''}
      <div class="pc-actions">
        <button class="btn sm primary" data-action="perm" data-id="${esc(st.id)}" data-v="once">${esc(t('ins_yes_' + w))}</button>
        <button class="btn sm" data-action="perm" data-id="${esc(st.id)}" data-v="deny">${esc(t('cancel'))}</button>
      </div>
    </div>`;
  }
  window.InstallCard = { html };
})();

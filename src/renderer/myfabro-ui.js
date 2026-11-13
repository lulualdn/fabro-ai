'use strict';
/* Settings › My Fabro: what Fabro remembers about this account, and the story of the work done with it.
   Data: api.myfabro.* (src/main/myfabro.js). Everything shown is computed on this computer; nothing is sent anywhere.
   window.MyFabroUI = { mount(el), unmount(el), refresh() } — mounted by settings-ui.js ([data-mount="myfabro"]). */
(() => {
  const E = (s) => esc(s);
  const ic = (n, s) => icon(n, s);
  const F = { status: null, entries: null, profile: null, timeline: null, forgotten: null, skills: null };
  const UI = { editEntry: null, adding: false, editLine: null, editAll: false, showAll: false, busy: false };
  let host = null;

  const dateFmt = (ts, long) => { try { return new Intl.DateTimeFormat(S.lang, long ? { day: 'numeric', month: 'long', year: 'numeric' } : { day: 'numeric', month: 'short' }).format(new Date(ts)); } catch { return ''; } };
  const ago = (days) => t(days >= 60 ? 'mf2_agoMonths' : 'mf2_agoDays', { n: days >= 60 ? Math.round(days / 30) : days });

  async function load() {
    const [status, entries, profile, timeline, forgotten, skills] = await Promise.all([
      api.myfabro.status().catch(() => null), api.myfabro.list().catch(() => []), api.myfabro.profile().catch(() => ({ lines: [] })),
      api.myfabro.timeline().catch(() => null), api.myfabro.forgotten().catch(() => []), api.myfabro.skills(S.lang).catch(() => []),
    ]);
    Object.assign(F, { status, entries, profile, timeline, forgotten, skills });
  }

  // ───────── pieces ─────────
  function sourceChip(src) {
    const s = src || {};
    const k = s.type === 'you' ? 'you' : s.type === 'did' ? 'did' : s.type === 'synced' ? 'synced' : 'said';
    const label = k === 'synced' ? t('mf2_src_synced', { app: s.site || s.mod || '' }) : t('mf2_src_' + k);
    const title = s.quote ? `« ${s.quote} »` : s.title ? s.title : '';
    return `<span class="mf2-src s-${k}" ${title ? `title="${E(title)}"` : ''}>${E(label)}</span>`;
  }

  function introHtml() {
    const st = F.status || {}; const mem = S.settings.memory || {};
    return `<div class="mf2-intro card quiet">
      <p>${ic('shield', 15)} <span>${E(t('mf2_intro'))}</span></p>
      ${row(t('memoryUse'), toggle('memory.enabled', mem.enabled !== false), t('memoryUseHint'))}
      ${row(t('memoryAuto'), toggle('memory.auto', mem.auto !== false), t('memoryAutoHint'))}
      ${st.synced ? `<p class="small muted">${ic('link', 13)} ${E(t('mf2_synced', { n: st.synced }))}</p>` : ''}
    </div>`;
  }

  const FIELD_ORDER = ['name', 'age', 'work', 'studies', 'projects', 'habits', 'tools', 'languages'];
  function profileHtml() {
    const lines = (F.profile && F.profile.lines) || [];
    if (UI.editAll) {
      return `<div class="mf2-sec"><div class="mf2-h"><h3>${E(t('mf2_profile'))}</h3></div>
        <p class="small muted">${E(t('mf2_profileEditHint'))}</p>
        <textarea class="input area" rows="7" id="mf2-prof-all" aria-label="${E(t('mf2_profile'))}">${E(lines.map((l) => l.text).join('\n'))}</textarea>
        <div class="mf2-acts"><button class="btn sm" data-action="mf2-prof-cancel">${E(t('cancel'))}</button><button class="btn sm primary" data-action="mf2-prof-save">${E(t('mf2_save'))}</button></div></div>`;
    }
    const groups = FIELD_ORDER.map((f) => [f, lines.filter((l) => (l.field || 'habits') === f)]).filter(([, l]) => l.length);
    const other = lines.filter((l) => !FIELD_ORDER.includes(l.field || 'habits'));
    if (other.length) groups.push(['other', other]);
    const lineHtml = (l) => UI.editLine === l.id
      ? `<li class="mf2-line edit"><input class="input" id="mf2-line-in" value="${E(l.text)}" maxlength="200" aria-label="${E(t('mf2_editLine'))}"><button class="btn sm primary" data-action="mf2-line-save" data-id="${E(l.id)}">${E(t('mf2_save'))}</button><button class="btn sm" data-action="mf2-line-cancel">${E(t('cancel'))}</button></li>`
      : `<li class="mf2-line"><span class="mf2-text">${E(l.text)}</span>${sourceChip(l.source)}
          <button class="icon-btn sm" data-action="mf2-line-edit" data-id="${E(l.id)}" title="${E(t('mf2_editLine'))}" aria-label="${E(t('mf2_editLine'))}">${ic('edit', 14)}</button>
          <button class="icon-btn sm" data-action="mf2-line-del" data-id="${E(l.id)}" title="${E(t('delete'))}" aria-label="${E(t('delete'))}">${ic('trash', 14)}</button></li>`;
    return `<div class="mf2-sec"><div class="mf2-h"><h3>${E(t('mf2_profile'))}</h3><span class="grow"></span>
        <button class="btn sm" data-action="mf2-prof-edit">${ic('edit', 14)} ${E(t('mf2_editAll'))}</button></div>
      <p class="small muted">${E(t('mf2_profileHint'))}</p>
      ${groups.length ? groups.map(([f, ls]) => `<div class="mf2-field"><small>${E(t('mf2_f_' + f))}</small><ul>${ls.map(lineHtml).join('')}</ul></div>`).join('')
        : `<div class="empty-note">${E(t('mf2_profileEmpty'))}</div>`}
    </div>`;
  }

  const KIND_ICON = { project: 'folder', preference: 'sliders', fact: 'info', habit: 'calendar', person: 'user', tool: 'wrench' };
  function entryForm(e) {
    const kinds = ['project', 'preference', 'fact', 'habit', 'person', 'tool'];
    return `<div class="mf2-entry edit card">
      <label class="field"><span>${E(t('mf2_title'))}</span><input class="input" id="mf2-e-title" maxlength="80" value="${E(e ? e.title : '')}"></label>
      <label class="field"><span>${E(t('mf2_content'))}</span><textarea class="input area" id="mf2-e-content" rows="3" maxlength="1000">${E(e ? e.content : '')}</textarea></label>
      <label class="field"><span>${E(t('mf2_kind'))}</span><select class="input" id="mf2-e-kind">${kinds.map((k) => `<option value="${k}" ${(e ? e.kind : 'fact') === k ? 'selected' : ''}>${E(t('mf2_k_' + k))}</option>`).join('')}</select></label>
      <div class="mf2-acts"><button class="btn sm" data-action="mf2-e-cancel">${E(t('cancel'))}</button><button class="btn sm primary" data-action="mf2-e-save" data-id="${E(e ? e.id : '')}">${E(t('mf2_save'))}</button></div></div>`;
  }
  function entriesHtml() {
    const all = F.entries || [];
    const list = UI.showAll ? all : all.slice(0, 12);
    const one = (e) => UI.editEntry === e.id ? entryForm(e) : `<div class="mf2-entry ${e.pinned ? 'pinned' : ''}">
        <span class="mf2-kind" title="${E(t('mf2_k_' + e.kind))}">${ic(KIND_ICON[e.kind] || 'info', 15)}</span>
        <div class="mf2-body"><b>${E(e.title)}</b><p>${E(e.content)}</p>
          <small class="muted">${E(t('mf2_k_' + e.kind))} · ${E(t('mf2_since', { d: dateFmt(e.created) }))}${e.updated && e.updated - e.created > 864e5 ? ' · ' + E(t('mf2_updated', { d: dateFmt(e.updated) })) : ''} · ${E(t(e.origin === 'you' ? 'mf2_byYou' : 'mf2_byFabro'))}</small></div>
        <div class="mf2-eacts">
          <button class="icon-btn sm ${e.pinned ? 'on' : ''}" data-action="mf2-pin" data-id="${E(e.id)}" aria-pressed="${e.pinned}" title="${E(t(e.pinned ? 'mf2_unpin' : 'mf2_pin'))}" aria-label="${E(t(e.pinned ? 'mf2_unpin' : 'mf2_pin'))}">${ic('pin', 14)}</button>
          <button class="icon-btn sm" data-action="mf2-e-edit" data-id="${E(e.id)}" title="${E(t('mf2_editLine'))}" aria-label="${E(t('mf2_editLine'))}">${ic('edit', 14)}</button>
          <button class="icon-btn sm" data-action="mf2-e-del" data-id="${E(e.id)}" title="${E(t('delete'))}" aria-label="${E(t('delete'))}">${ic('trash', 14)}</button></div></div>`;
    return `<div class="mf2-sec"><div class="mf2-h"><h3>${E(t('mf2_memory'))}</h3><span class="muted small">${all.length || ''}</span><span class="grow"></span>
        <button class="btn sm" data-action="mf2-e-add">${ic('plus', 14)} ${E(t('mf2_add'))}</button></div>
      <p class="small muted">${E(t('mf2_memoryHint'))}</p>
      ${UI.adding ? entryForm(null) : ''}
      ${list.length ? `<div class="mf2-entries">${list.map(one).join('')}</div>` : UI.adding ? '' : `<div class="empty-note">${E(t('mf2_memoryEmpty'))}</div>`}
      ${all.length > list.length ? `<button class="link-btn" data-action="mf2-more">${E(t('mf2_showAll', { n: all.length }))}</button>` : ''}
    </div>`;
  }

  function timelineHtml() {
    const tl = F.timeline;
    if (!tl || !tl.items || !tl.items.length) return `<div class="mf2-sec"><div class="mf2-h"><h3>${E(t('mf2_story'))}</h3></div><div class="empty-note">${E(t('mf2_storyEmpty'))}</div></div>`;
    const c = tl.counts || {};
    const head = t('mf2_storyHead', { d: dateFmt(tl.since, true), c: c.conversations || 0, p: c.projects || 0, a: c.artifacts || 0 });
    const label = (it) => {
      switch (it.kind) {
        case 'first-chat': return t('mf2_tl_firstChat', { x: it.title || '…' });
        case 'first-project': return t('mf2_tl_firstProject', { x: it.title });
        case 'first-artifact': return t('mf2_tl_firstArtifact', { x: it.title || '…' });
        case 'first-agent': return t('mf2_tl_firstAgent', { x: it.title || '…' });
        case 'first-code': return t('mf2_tl_firstCode', { x: it.title || '…' });
        case 'project': return t('mf2_tl_project', { x: it.title, n: it.chats || 0 });
        case 'nth-chat': return t('mf2_tl_nth', { n: it.n });
        case 'streak': return t('mf2_tl_streak', { n: it.n });
        default: return it.title || '';
      }
    };
    const target = (it) => it.convId ? `data-action="mf2-open-conv" data-id="${E(it.convId)}"` : it.projectId ? `data-action="open-project" data-id="${E(it.projectId)}"` : '';
    return `<div class="mf2-sec"><div class="mf2-h"><h3>${E(t('mf2_story'))}</h3></div>
      <p class="small muted">${E(head)}</p>
      <ol class="mf2-tl">${tl.items.slice().reverse().slice(0, 30).map((it) => {
        const tg = target(it);
        return `<li class="k-${E(it.kind)}"><time>${E(dateFmt(it.at, true))}</time>${tg ? `<button class="link-btn" ${tg}>${E(label(it))}</button>` : `<span>${E(label(it))}</span>`}</li>`;
      }).join('')}</ol>
      ${(tl.models || []).length ? `<p class="small muted">${E(t('mf2_models', { m: tl.models.map((m) => m.name).join(', ') }))}</p>` : ''}
    </div>`;
  }

  function forgottenHtml() {
    const f = F.forgotten || [];
    if (!f.length) return '';
    const why = (sg) => sg === 'unanswered' ? t('mf2_sign_unanswered') : sg.startsWith('plan:') ? t('mf2_sign_plan', { n: sg.slice(5) }) : sg.startsWith('todo:') ? t('mf2_sign_todo', { n: sg.slice(5) }) : t('mf2_sign_next');
    return `<div class="mf2-sec"><div class="mf2-h"><h3>${E(t('mf2_forgotten'))}</h3></div>
      <div class="list mf2-list">${f.map((x) => `<div class="list-row"><span class="mf2-kind">${ic(x.kind === 'project' ? 'folder' : 'chat', 15)}</span>
        <div class="m-text"><b>${E(x.name || '…')}</b><small>${E(ago(x.days))} · ${E(x.signs.map(why).join(' · '))}</small></div>
        ${x.convId ? `<button class="btn sm" data-action="mf2-open-conv" data-id="${E(x.convId)}">${E(t('mf2_resume'))}</button>` : ''}
        <button class="icon-btn sm" data-action="mf2-dismiss" data-kind="forgotten" data-key="${E(x.key)}" title="${E(t('mf2_dismiss'))}" aria-label="${E(t('mf2_dismiss'))}">${ic('x', 14)}</button></div>`).join('')}</div></div>`;
  }

  function skillsHtml() {
    const s = F.skills || [];
    if (!s.length) return '';
    return `<div class="mf2-sec"><div class="mf2-h"><h3>${E(t('mf2_skills'))}</h3></div>
      <p class="small muted">${E(t('mf2_skillsHint'))}</p>
      <div class="list mf2-list">${s.map((x, i) => `<div class="list-row"><span class="mf2-kind">${ic('book', 15)}</span>
        <div class="m-text"><b>${E(x.label)}</b><small>${E(t('mf2_skillSeen', { n: x.count }))}${(x.examples || []).length ? ' · ' + E(x.examples.slice(0, 2).join(', ')) : ''}</small></div>
        <button class="btn sm primary" data-action="mf2-skill" data-i="${i}">${E(t('mf2_skillGo'))}</button>
        <button class="icon-btn sm" data-action="mf2-dismiss" data-kind="skill" data-key="${E(x.key)}" title="${E(t('mf2_dismiss'))}" aria-label="${E(t('mf2_dismiss'))}">${ic('x', 14)}</button></div>`).join('')}</div></div>`;
  }

  function dangerHtml() {
    return `<div class="mf2-sec mf2-danger"><button class="btn sm danger" data-action="mf2-forget">${ic('trash', 14)} ${E(t('mf2_forgetAll'))}</button>
      <small class="muted">${E(t('mf2_forgetHint'))}</small></div>`;
  }

  function paint() {
    if (!host || !host.isConnected) return;
    if (!F.status && !F.entries) { host.innerHTML = `<div class="mf2-loading">${spinner(16)}</div>`; return; }
    const keepFocus = document.activeElement && host.contains(document.activeElement) ? document.activeElement.id : null;
    host.innerHTML = `<div class="mf2">${introHtml()}${forgottenHtml()}${profileHtml()}${entriesHtml()}${skillsHtml()}${timelineHtml()}${dangerHtml()}</div>`;
    if (keepFocus) { const el = document.getElementById(keepFocus); if (el) el.focus(); }
  }

  async function refresh() { await load(); paint(); }
  async function mount(el) { host = el; el.classList.add('mf2-host'); paint(); await refresh(); }
  function unmount() { host = null; UI.editEntry = null; UI.adding = false; UI.editLine = null; UI.editAll = false; }

  const err = (e) => toast(String((e && e.message) || e).replace(/^Error invoking remote method '[^']+': (\w*Error: )?/, ''), 'err');
  Object.assign(actions, {
    'mf2-prof-edit': () => { UI.editAll = true; paint(); const ta = document.getElementById('mf2-prof-all'); if (ta) ta.focus(); },
    'mf2-prof-cancel': () => { UI.editAll = false; paint(); },
    'mf2-prof-save': async () => { const v = (document.getElementById('mf2-prof-all') || {}).value || ''; try { await api.myfabro.setProfile(v); UI.editAll = false; await refresh(); } catch (e) { err(e); } },
    'mf2-line-edit': (el) => { UI.editLine = el.dataset.id; paint(); const i = document.getElementById('mf2-line-in'); if (i) { i.focus(); i.select(); } },
    'mf2-line-cancel': () => { UI.editLine = null; paint(); },
    'mf2-line-save': async (el) => { const v = (document.getElementById('mf2-line-in') || {}).value || ''; try { await api.myfabro.editLine(el.dataset.id, v); UI.editLine = null; await refresh(); } catch (e) { err(e); } },
    'mf2-line-del': async (el) => { try { await api.myfabro.removeLine(el.dataset.id); await refresh(); } catch (e) { err(e); } },
    'mf2-e-add': () => { UI.adding = true; UI.editEntry = null; paint(); const i = document.getElementById('mf2-e-title'); if (i) i.focus(); },
    'mf2-e-edit': (el) => { UI.editEntry = el.dataset.id; UI.adding = false; paint(); },
    'mf2-e-cancel': () => { UI.editEntry = null; UI.adding = false; paint(); },
    'mf2-e-save': async (el) => {
      const title = ((document.getElementById('mf2-e-title') || {}).value || '').trim();
      const content = ((document.getElementById('mf2-e-content') || {}).value || '').trim();
      const kind = (document.getElementById('mf2-e-kind') || {}).value || 'fact';
      if (!content && !title) return;
      try { if (el.dataset.id) await api.myfabro.edit(el.dataset.id, { title, content, kind }); else await api.myfabro.add({ title, content: content || title, kind }); UI.editEntry = null; UI.adding = false; await refresh(); } catch (e) { err(e); }
    },
    'mf2-e-del': async (el) => { try { await api.myfabro.remove(el.dataset.id); await refresh(); } catch (e) { err(e); } },
    'mf2-pin': async (el) => { const e = (F.entries || []).find((x) => x.id === el.dataset.id); try { await api.myfabro.pin(el.dataset.id, !(e && e.pinned)); await refresh(); } catch (er) { err(er); } },
    'mf2-more': () => { UI.showAll = true; paint(); },
    'mf2-dismiss': async (el) => { try { await api.myfabro.dismiss(el.dataset.kind, el.dataset.key); await refresh(); } catch (e) { err(e); } },
    'mf2-open-conv': (el) => { closeSettings(); openConv(el.dataset.id); },
    'mf2-skill': (el) => {
      const s = (F.skills || [])[Number(el.dataset.i)]; if (!s || !s.prompt) return;
      closeSettings(); newChat();
      setTimeout(() => { if (typeof sendPrompt === 'function') sendPrompt(s.prompt); }, 120);
    },
    'mf2-forget': async () => {
      if (!confirm(t('mf2_forgetConfirm'))) return;
      try { await api.myfabro.forgetAll(); await refresh(); toast(t('mf2_forgotten_done')); } catch (e) { err(e); }
    },
  });
  document.addEventListener('keydown', (e) => {
    if (!host || !host.contains(e.target)) return;
    if (e.key === 'Enter' && e.target.id === 'mf2-line-in') { e.preventDefault(); const b = host.querySelector('[data-action="mf2-line-save"]'); if (b) b.click(); }
    if (e.key === 'Escape' && (UI.editLine || UI.editEntry || UI.adding || UI.editAll)) { e.stopPropagation(); UI.editLine = null; UI.editEntry = null; UI.adding = false; UI.editAll = false; paint(); }
  });
  // the memory toggles are ordinary settings (data-action="set"): this block is a live mount, so repaint it after they save
  document.addEventListener('click', (e) => { const b = e.target.closest && e.target.closest('[data-action="set"][data-key^="memory."]'); if (b && host && host.contains(b)) setTimeout(paint, 60); });

  window.MyFabroUI = { mount, unmount, refresh };
})();

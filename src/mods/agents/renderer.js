// Agents app — UI. Registers a Fabro app that shows a messaging-style workspace: a list of chats and
// your team of agents on the left, the active conversation on the right. Agents reply on their own and,
// in a group, talk to each other.
(function () {
  const esc = fabro.esc;
  const L = {
    en: { title: 'Agents', newAgent: 'New agent', newGroup: 'New group', team: 'Team', chats: 'Chats', noChats: 'No conversations yet. Create an agent, then start a chat.',
      name: 'Name', role: 'Role (what it does)', prompt: 'Extra instructions (optional)', model: 'Model', emoji: 'Emoji', color: 'Color', save: 'Save', cancel: 'Cancel', create: 'Create', del: 'Delete', edit: 'Edit',
      back: 'Back', placeholder: 'Message…', groupName: 'Group name', pickAgents: 'Pick the agents', startDm: 'Message', members: 'members', thinking: 'thinking…', empty: 'Pick a conversation or start a new one.', defaultModel: 'Default model', learned: 'learned', proactive: 'proactive', roleEx: 'e.g. Developer, researcher, copywriter…' },
    fr: { title: 'Agents', newAgent: 'Nouvel agent', newGroup: 'Nouveau groupe', team: 'Équipe', chats: 'Conversations', noChats: 'Aucune conversation. Crée un agent, puis lance une conversation.',
      name: 'Nom', role: 'Rôle (ce qu\'il fait)', prompt: 'Instructions en plus (optionnel)', model: 'Modèle', emoji: 'Émoji', color: 'Couleur', save: 'Enregistrer', cancel: 'Annuler', create: 'Créer', del: 'Supprimer', edit: 'Modifier',
      back: 'Retour', placeholder: 'Message…', groupName: 'Nom du groupe', pickAgents: 'Choisis les agents', startDm: 'Écrire', members: 'membres', thinking: 'réfléchit…', empty: 'Choisis une conversation ou lances-en une.', defaultModel: 'Modèle par défaut', learned: 'appris', proactive: 'spontané', roleEx: 'ex. Développeur, chercheur, rédacteur…' },
  };
  const t = (k) => (L[fabro.S.lang] || L.en)[k] || L.en[k] || k;

  let root = null, st = { agents: [], chats: [] }, active = null, msgs = [], typing = {}, modal = null;
  const byId = (id) => st.agents.find((a) => a.id === id);
  const EMOJIS = ['🤖', '🦊', '🦉', '🐙', '🧠', '🛠️', '📊', '✍️', '🔎', '🎨', '🚀', '🧩', '💡', '📨', '🧭', '⚙️'];
  const COLORS = ['#6a7bff', '#ff5e42', '#1bbf83', '#e8b23a', '#b45cff', '#2aa7ff', '#ff6392', '#58c0a8'];

  const off = [];
  function mount(el) {
    root = el;
    el.innerHTML = `<div class="ag-wrap"><aside class="ag-side"></aside><main class="ag-main"></main><div class="ag-modal-root"></div></div>`;
    off.push(fabro.on('state', (s) => { st = s; renderSide(); if (active && !st.chats.find((c) => c.id === active)) { active = null; renderMain(); } else renderMain(); }));
    off.push(fabro.on('msg', ({ chatId, message }) => { if (chatId === active) { msgs.push(message); appendMsg(message); } refreshList(); }));
    off.push(fabro.on('typing', ({ chatId, agentId, on }) => { if (chatId !== active) return; typing[agentId] = on; if (!on) delete typing[agentId]; renderTyping(); }));
    load();
  }
  function unmount() { off.forEach((f) => { try { f(); } catch {} }); off.length = 0; }

  async function load() { st = await fabro.call('state'); renderSide(); renderMain(); }
  const $ = (s) => root.querySelector(s);

  // ───────── left pane ─────────
  function renderSide() {
    if (!$('.ag-side')) return;
    const chats = [...st.chats].sort((a, b) => b.updatedAt - a.updatedAt);
    $('.ag-side').innerHTML = `
      <div class="ag-side-h">
        <b>${esc(t('title'))}</b><span class="grow"></span>
        <button class="btn sm" data-ag="new-agent" title="${esc(t('newAgent'))}">${fabro.icon('plus', 15)}</button>
        <button class="btn sm" data-ag="new-group" title="${esc(t('newGroup'))}">${fabro.icon('agent', 15) || fabro.icon('plus', 15)}</button>
      </div>
      <div class="ag-list">
        ${chats.length ? chats.map(chatRow).join('') : `<div class="ag-empty">${esc(t('noChats'))}</div>`}
      </div>
      <div class="ag-team-h">${esc(t('team'))}</div>
      <div class="ag-team">${st.agents.map(agentRow).join('') || `<button class="ag-team-add" data-ag="new-agent">${fabro.icon('plus', 14)} ${esc(t('newAgent'))}</button>`}</div>`;
  }
  const av = (a, size = 30) => `<span class="ag-av" style="--c:${esc(a ? a.color : '#888')};width:${size}px;height:${size}px;font-size:${size * 0.5}px">${esc(a ? a.emoji : '👥')}</span>`;
  function chatRow(c) {
    const lead = c.type === 'group' ? `<span class="ag-av grp" style="width:30px;height:30px">${esc(c.emoji || '👥')}</span>` : av(byId(c.members[0]));
    return `<button class="ag-chat ${c.id === active ? 'on' : ''}" data-ag="open" data-id="${esc(c.id)}">
      ${lead}<span class="ag-chat-t"><b>${esc(c.title)}</b><small>${esc(c.last || '')}</small></span></button>`;
  }
  function agentRow(a) {
    return `<button class="ag-team-item" data-ag="open-agent" data-id="${esc(a.id)}" title="${esc(a.role)}">
      ${av(a, 26)}<span class="ag-chat-t"><b>${esc(a.name)}</b><small>${esc(a.role)}</small></span>
      <span class="ag-edit" data-ag="edit-agent" data-id="${esc(a.id)}">${fabro.icon('edit', 14)}</span></button>`;
  }
  function refreshList() { st.chats = st.chats.slice(); fabro.call('state').then((s) => { st = s; renderSide(); }); }

  // ───────── right pane ─────────
  async function renderMain() {
    const m = $('.ag-main'); if (!m) return;
    const w = $('.ag-wrap'); if (w) w.classList.toggle('chat-open', !!(active && st.chats.find((c) => c.id === active))); // phone: list or conversation
    if (!active || !st.chats.find((c) => c.id === active)) { m.innerHTML = `<div class="ag-blank">${av(null, 54)}<p>${esc(t('empty'))}</p></div>`; return; }
    const c = st.chats.find((x) => x.id === active);
    const members = c.members.map(byId).filter(Boolean);
    m.innerHTML = `
      <header class="ag-top">
        <button class="icon-btn sm ag-back" data-ag="back" title="${esc(t('back'))}" aria-label="${esc(t('back'))}">${fabro.icon('back', 18)}</button>
        <span class="ag-av ${c.type === 'group' ? 'grp' : ''}" style="--c:${esc(members[0] ? members[0].color : '#888')};width:34px;height:34px">${esc(c.type === 'group' ? (c.emoji || '👥') : (members[0] ? members[0].emoji : '🤖'))}</span>
        <span class="ag-top-t"><b>${esc(c.title)}</b><small>${c.type === 'group' ? members.map((a) => a.name).join(', ') : esc(members[0] ? members[0].role : '')}</small></span>
        <span class="grow"></span>
        <button class="icon-btn sm" data-ag="del-chat" data-id="${esc(c.id)}" title="${esc(t('del'))}">${fabro.icon('trash', 16)}</button>
      </header>
      <div class="ag-msgs" id="ag-msgs"></div>
      <div class="ag-typing" id="ag-typing"></div>
      <form class="ag-composer" data-ag="send-form">
        <textarea id="ag-input" rows="1" placeholder="${esc(t('placeholder'))}"></textarea>
        <button class="ag-send" type="submit">${fabro.icon('up', 18)}</button>
      </form>`;
    msgs = await fabro.call('messages', active);
    const box = $('#ag-msgs'); box.innerHTML = msgs.map(msgHTML).join(''); box.scrollTop = box.scrollHeight;
    renderTyping();
    const ta = $('#ag-input');
    ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 160) + 'px'; });
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend(); } });
    ta.focus();
  }
  function msgHTML(m) {
    if (m.from === 'user') return `<div class="ag-m me"><div class="ag-b">${fabro.md(m.text)}</div></div>`;
    const a = byId(m.from) || { name: '?', emoji: '🤖', color: '#888' };
    return `<div class="ag-m" data-mid="${esc(m.id)}">${av(a, 28)}<div class="ag-mc"><div class="ag-who" style="color:${esc(a.color)}">${esc(a.name)}${m.proactive ? ` <span class="ag-tag">${esc(t('proactive'))}</span>` : ''}</div><div class="ag-b">${fabro.md(m.text)}</div></div></div>`;
  }
  function appendMsg(m) { const box = $('#ag-msgs'); if (!box) return; box.insertAdjacentHTML('beforeend', msgHTML(m)); box.scrollTop = box.scrollHeight; renderTyping(); }
  function renderTyping() {
    const el = $('#ag-typing'); if (!el) return;
    const ids = Object.keys(typing).filter((k) => typing[k]);
    el.innerHTML = ids.length ? ids.map((id) => { const a = byId(id); return a ? `<span class="ag-typ">${av(a, 20)} ${esc(a.name)} ${esc(t('thinking'))}</span>` : ''; }).join('') : '';
  }
  async function doSend() {
    const ta = $('#ag-input'); const text = ta.value.trim(); if (!text) return;
    ta.value = ''; ta.style.height = 'auto';
    await fabro.call('send', active, text);
  }

  // ───────── modals ─────────
  function closeModal() { modal = null; $('.ag-modal-root').innerHTML = ''; }
  function openAgent(a) {
    modal = 'agent';
    const models = (window.modChatModels ? [] : []); // (web assistants aren't valid agent models yet)
    $('.ag-modal-root').innerHTML = `<div class="ag-ov" data-ag="close"></div>
      <div class="ag-dialog">
        <h3>${esc(a ? t('edit') : t('newAgent'))}</h3>
        <label class="ag-f"><span>${esc(t('name'))}</span><input id="f-name" maxlength="40" value="${esc(a ? a.name : '')}"></label>
        <label class="ag-f"><span>${esc(t('role'))}</span><input id="f-role" maxlength="200" placeholder="${esc(t('roleEx'))}" value="${esc(a ? a.role : '')}"></label>
        <div class="ag-f2">
          <label class="ag-f"><span>${esc(t('emoji'))}</span><div class="ag-emojis" id="f-emoji">${EMOJIS.map((e) => `<button type="button" class="${(a ? a.emoji : '🤖') === e ? 'on' : ''}" data-e="${e}">${e}</button>`).join('')}</div></label>
          <label class="ag-f"><span>${esc(t('color'))}</span><div class="ag-colors" id="f-color">${COLORS.map((c) => `<button type="button" class="${(a ? a.color : COLORS[0]) === c ? 'on' : ''}" style="background:${c}" data-c="${c}"></button>`).join('')}</div></label>
        </div>
        <label class="ag-f"><span>${esc(t('prompt'))}</span><textarea id="f-prompt" rows="3" maxlength="4000">${esc(a ? a.prompt : '')}</textarea></label>
        <div class="ag-actions">${a ? `<button class="btn" data-ag="del-agent" data-id="${esc(a.id)}">${esc(t('del'))}</button>` : ''}<span class="grow"></span><button class="btn" data-ag="close">${esc(t('cancel'))}</button><button class="btn primary" data-ag="save-agent" data-id="${esc(a ? a.id : '')}">${esc(t('save'))}</button></div>
      </div>`;
    let emoji = a ? a.emoji : '🤖', color = a ? a.color : COLORS[0];
    $('#f-emoji').onclick = (e) => { const b = e.target.closest('[data-e]'); if (!b) return; emoji = b.dataset.e; [...$('#f-emoji').children].forEach((x) => x.classList.toggle('on', x === b)); };
    $('#f-color').onclick = (e) => { const b = e.target.closest('[data-c]'); if (!b) return; color = b.dataset.c; [...$('#f-color').children].forEach((x) => x.classList.toggle('on', x === b)); };
    $('.ag-modal-root').dataset.emoji = emoji; $('.ag-modal-root').dataset.color = color;
    const sync = () => { $('.ag-modal-root').dataset.emoji = emoji; $('.ag-modal-root').dataset.color = color; };
    $('#f-emoji').addEventListener('click', sync); $('#f-color').addEventListener('click', sync);
  }
  function openGroup() {
    modal = 'group';
    $('.ag-modal-root').innerHTML = `<div class="ag-ov" data-ag="close"></div>
      <div class="ag-dialog">
        <h3>${esc(t('newGroup'))}</h3>
        <label class="ag-f"><span>${esc(t('groupName'))}</span><input id="g-name" maxlength="60"></label>
        <div class="ag-f"><span>${esc(t('pickAgents'))}</span><div class="ag-pick">${st.agents.map((a) => `<label class="ag-pk">${av(a, 24)} <span>${esc(a.name)}</span><input type="checkbox" value="${esc(a.id)}"></label>`).join('') || `<div class="ag-empty">${esc(t('noChats'))}</div>`}</div></div>
        <div class="ag-actions"><span class="grow"></span><button class="btn" data-ag="close">${esc(t('cancel'))}</button><button class="btn primary" data-ag="save-group">${esc(t('create'))}</button></div>
      </div>`;
  }

  // ───────── actions ─────────
  document.addEventListener('click', async (e) => {
    if (!root || !root.isConnected) return;
    const b = e.target.closest('[data-ag]'); if (!b || !root.contains(b)) return;
    const act = b.dataset.ag, id = b.dataset.id;
    if (act === 'open') { active = id; typing = {}; renderSide(); renderMain(); }
    else if (act === 'back') { active = null; typing = {}; renderSide(); renderMain(); }
    else if (act === 'open-agent') { const ex = st.chats.find((c) => c.type === 'dm' && c.members[0] === id); if (ex) active = ex.id; else { const r = await fabro.call('createChat', { members: [id] }); st = await fabro.call('state'); active = r.id; } typing = {}; renderSide(); renderMain(); }
    else if (act === 'edit-agent') { e.stopPropagation(); const a = await fabro.call('getAgent', id); openAgent(a); }
    else if (act === 'new-agent') openAgent(null);
    else if (act === 'new-group') openGroup();
    else if (act === 'close') closeModal();
    else if (act === 'del-chat') { await fabro.call('deleteChat', id); active = null; }
    else if (act === 'save-agent') {
      const d = { name: $('#f-name').value, role: $('#f-role').value, prompt: $('#f-prompt').value, emoji: $('.ag-modal-root').dataset.emoji, color: $('.ag-modal-root').dataset.color };
      if (id) await fabro.call('updateAgent', id, d); else await fabro.call('createAgent', d);
      closeModal();
    } else if (act === 'del-agent') { await fabro.call('deleteAgent', id); closeModal(); }
    else if (act === 'save-group') {
      const members = [...root.querySelectorAll('.ag-pick input:checked')].map((x) => x.value);
      if (!members.length) return;
      const r = await fabro.call('createChat', { members, title: $('#g-name').value });
      st = await fabro.call('state'); closeModal(); active = r.id; typing = {}; renderSide(); renderMain();
    }
  });
  document.addEventListener('submit', (e) => { if (e.target.closest('[data-ag="send-form"]')) { e.preventDefault(); doSend(); } });

  fabro.apps.register({ id: 'agents', name: t('title'), icon: 'agent', color: '#6a7bff', mount, unmount });
})();

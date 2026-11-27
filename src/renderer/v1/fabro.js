// Fabro mod API, version 1: stable extension points for the v1 interface (no overriding of internal functions).
//   Fabro.slots.add(slot, { id, render(el, ctx), order })   slots: 'above-chat', 'sidebar', 'composer', 'message', 'settings'
//   Fabro.slots.remove(id)
//   Fabro.commands.add({ name: 'flashcards', title, hint, run(args, ctx) })   → typed as /flashcards in the composer
//   Fabro.chatView.replace({ id, message(node, html) → html, css })          → restyle or rebuild how messages look
//   Fabro.on(event, fn) → off()     events: 'ready', 'conv', 'send', 'message', 'done', 'theme'
//   Fabro.ui.toast(text), Fabro.ui.card({ id, title, sub, actions: [{ label, primary, run }] }) shown above the chat
//   Fabro.chat.send(text), Fabro.chat.current() → { id, title, messages }
// A mod gets the app's rights: Fabro shows what a mod declares before installing it, and starts without mods
// after a crash (src/main/mods.js). Versioned: Fabro.version stays 1 for every change that keeps these working.
(function () {
  const slots = new Map(); // slot → [{ id, render, order }]
  const commands = new Map();
  const listeners = new Map();
  const cards = new Map();
  let view = null;
  const emit = (ev, data) => { for (const fn of listeners.get(ev) || []) { try { fn(data); } catch (e) { console.error('[mod]', ev, e); } } };
  const Fabro = {
    version: 1,
    slots: {
      add(slot, def) {
        if (!def || !def.id || typeof def.render !== 'function') throw new Error('Fabro.slots.add(slot, { id, render })');
        const l = (slots.get(slot) || []).filter((x) => x.id !== def.id); l.push({ order: 0, ...def }); l.sort((a, b) => a.order - b.order);
        slots.set(slot, l); Fabro._paint(slot);
      },
      remove(id) { for (const [k, l] of slots) { const n = l.filter((x) => x.id !== id); if (n.length !== l.length) { slots.set(k, n); Fabro._paint(k); } } },
    },
    commands: {
      add(def) { if (!def || !/^[a-z0-9-]{2,24}$/.test(def.name || '') || typeof def.run !== 'function') throw new Error('Fabro.commands.add({ name, run })'); commands.set(def.name, def); },
      remove(name) { commands.delete(name); },
      list() { return [...commands.values()].map(({ name, title, hint }) => ({ name, title, hint })); },
    },
    chatView: {
      replace(def) { view = def || null; if (def && def.css) { let st = document.getElementById('mod-chat-css'); if (!st) { st = document.createElement('style'); st.id = 'mod-chat-css'; document.head.appendChild(st); } st.textContent = def.css; } emit('view'); },
      reset() { view = null; const st = document.getElementById('mod-chat-css'); if (st) st.remove(); emit('view'); },
    },
    on(ev, fn) { if (!listeners.has(ev)) listeners.set(ev, []); listeners.get(ev).push(fn); return () => { listeners.set(ev, (listeners.get(ev) || []).filter((x) => x !== fn)); }; },
    ui: {
      toast: (text) => window.V1 && V1.toast(String(text)),
      card(def) { if (!def || !def.id) return; cards.set(def.id, def); Fabro._paint('above-chat'); },
      removeCard(id) { cards.delete(id); Fabro._paint('above-chat'); },
    },
    chat: {
      send: (text) => window.V1 && V1.send(String(text || '')),
      current: () => (window.V1 ? V1.current() : null),
    },
    // ── used by the interface ──
    _emit: emit,
    _command: (name) => commands.get(name),
    _view: () => view,
    _cards: () => [...cards.values()],
    _paint(slot) {
      const el = document.querySelector(`[data-slot="${slot}"]`); if (!el) return;
      el.innerHTML = '';
      if (slot === 'above-chat') for (const c of cards.values()) {
        const d = document.createElement('div'); d.className = 'card';
        d.innerHTML = '<div class="grow"></div><div class="acts"></div>';
        d.firstChild.textContent = c.title || ''; if (c.sub) { const s = document.createElement('small'); s.textContent = c.sub; d.firstChild.appendChild(s); }
        for (const a of c.actions || []) { const b = document.createElement('button'); b.className = 'btn' + (a.primary ? ' pri' : ''); b.textContent = a.label; b.onclick = () => { try { a.run && a.run(); } catch (e) { console.error(e); } }; d.lastChild.appendChild(b); }
        el.appendChild(d);
      }
      for (const s of slots.get(slot) || []) {
        const box = document.createElement('div'); box.dataset.mod = s.id; el.appendChild(box);
        try { s.render(box, { lang: document.documentElement.lang, theme: document.documentElement.dataset.theme }); } catch (e) { console.error('[mod]', s.id, e); box.remove(); }
      }
    },
  };
  window.Fabro = Object.freeze(Fabro);
})();

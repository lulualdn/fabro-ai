// Fabro Intelligent UI: an answer is not only text. The model writes a ```fabro-ui block holding one JSON object and
// Fabro draws it here, in its own design: progress bars, a mind map, a newspaper article, a quiz, cards to flip,
// small games… and `custom` (the model's own HTML/CSS/JS in a sandboxed frame that gets Fabro's colours).
// Hook: app.js, marked `code()` → IUI.html(key, text). Everything else lives in this file.
// What the user did (answers, flipped cards…) is kept per block while the app is open.
(() => {
  const SPEC = new Map(); const ST = new Map();
  const e = (v) => esc(String(v == null ? '' : v));
  // a little inline markdown, nothing more (the block is not a place for long prose)
  const inl = (v) => e(v).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*([^*]+)\*/g, '$1<i>$2</i>').replace(/`([^`]+)`/g, '<code>$1</code>');
  const arr = (v) => (Array.isArray(v) ? v : []);
  const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
  const st = (key, init) => { if (!ST.has(key)) ST.set(key, init()); return ST.get(key); };
  const act = (a, i, j) => `data-iui-act="${a}"${i != null ? ` data-i="${i}"` : ''}${j != null ? ` data-j="${j}"` : ''}`;
  const head = (d) => (d.title ? `<div class="iui-title">${inl(d.title)}</div>` : '');
  // same shuffle every time for the same block
  function shuffled(n, key) {
    let h = 2166136261; for (const c of String(key)) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
    const rnd = () => ((h = (Math.imul(h, 1664525) + 1013904223) >>> 0) / 4294967296);
    const a = [...Array(n).keys()]; for (let i = n - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    if (n > 1 && a.every((v, i) => v === i)) a.push(a.shift());
    return a;
  }

  const R = {
    progress(d) {
      return head(d) + arr(d.items).slice(0, 24).map((it) => {
        const max = num(it.max, 100) || 100; const v = Math.max(0, Math.min(max, num(it.value))); const p = Math.round((v / max) * 100);
        return `<div class="iui-bar"><div class="iui-bar-top"><span>${inl(it.label)}</span><b>${it.max != null ? `${e(it.value)} / ${e(it.max)}` : `${p} %`}</b></div>
          <div class="iui-track" role="progressbar" aria-valuenow="${p}" aria-valuemin="0" aria-valuemax="100"><i style="width:${p}%"></i></div>${it.note ? `<div class="iui-note">${inl(it.note)}</div>` : ''}</div>`;
      }).join('');
    },
    stats(d) {
      return head(d) + `<div class="iui-stats">${arr(d.items).slice(0, 8).map((it) => `<div class="iui-stat"><b>${e(it.value)}</b><span>${inl(it.label)}</span>${it.delta ? `<em class="${/^\s*[-−]/.test(it.delta) ? 'down' : 'up'}">${e(it.delta)}</em>` : ''}</div>`).join('')}</div>`;
    },
    timeline(d) {
      return head(d) + `<ol class="iui-tl">${arr(d.items).slice(0, 30).map((it) => `<li>${it.when ? `<span class="iui-when">${e(it.when)}</span>` : ''}<b>${inl(it.title)}</b>${it.text ? `<p>${inl(it.text)}</p>` : ''}</li>`).join('')}</ol>`;
    },
    compare(d) {
      return head(d) + `<div class="iui-cmp">${arr(d.columns).slice(0, 4).map((c) => `<div class="iui-cmp-col${c.best ? ' best' : ''}"><b>${inl(c.title)}</b><ul>${arr(c.points).slice(0, 12).map((p) => `<li>${inl(p)}</li>`).join('')}</ul>${c.verdict ? `<div class="iui-note">${inl(c.verdict)}</div>` : ''}</div>`).join('')}</div>`;
    },
    mindmap(d) {
      const node = (n, depth) => {
        const o = typeof n === 'string' ? { label: n } : (n || {}); const kids = depth < 4 ? arr(o.children).slice(0, 10) : [];
        return `<div class="mm-b"><div class="mm-n">${inl(o.label)}</div>${kids.length ? `<div class="mm-kids">${kids.map((k) => node(k, depth + 1)).join('')}</div>` : ''}</div>`;
      };
      return `<div class="iui-mm"><div class="mm-b mm-top"><div class="mm-n mm-root">${inl(d.root || d.title)}</div><div class="mm-kids">${arr(d.branches).slice(0, 10).map((b, i) => `<div class="mm-c" style="--mm:var(--data-${(i % 3) + 1})">${node(b, 1)}</div>`).join('')}</div></div></div>`;
    },
    article(d) {
      return `<article class="iui-art">${d.kicker ? `<div class="iui-kicker">${e(d.kicker)}</div>` : ''}<h3>${inl(d.headline || d.title)}</h3>${d.lead ? `<p class="iui-lead">${inl(d.lead)}</p>` : ''}
        ${d.byline ? `<div class="iui-byline">${e(d.byline)}</div>` : ''}<div class="iui-cols">${arr(d.sections).slice(0, 12).map((s) => `${s.title ? `<h4>${inl(s.title)}</h4>` : ''}${String(s.text || '').split(/\n{2,}/).map((p) => `<p>${inl(p)}</p>`).join('')}`).join('')}
        ${d.quote ? `<blockquote>${inl(d.quote)}</blockquote>` : ''}</div></article>`;
    },
    checklist(d, key) {
      const s = st(key, () => ({ on: arr(d.items).map((it) => !!(it && it.done)) }));
      const n = s.on.filter(Boolean).length; const all = arr(d.items).length || 1;
      return head(d) + `<div class="iui-track"><i style="width:${Math.round((n / all) * 100)}%"></i></div>` + arr(d.items).slice(0, 40).map((it, i) =>
        `<button class="iui-check${s.on[i] ? ' on' : ''}" ${act('check', i)} aria-pressed="${!!s.on[i]}"><span class="iui-box">${s.on[i] ? icon('check', 13) : ''}</span><span>${inl(typeof it === 'string' ? it : it.label)}</span></button>`).join('');
    },
    quiz(d, key) {
      const qs = arr(d.questions).slice(0, 20); const s = st(key, () => ({ picked: {} }));
      const done = Object.keys(s.picked).length; const good = qs.filter((q, i) => s.picked[i] === num(q.answer, -1)).length;
      return head(d) + qs.map((q, i) => {
        const p = s.picked[i]; const answered = p != null;
        return `<div class="iui-q"><div class="iui-q-t"><span>${i + 1}</span>${inl(q.q || q.question)}</div><div class="iui-choices">${arr(q.choices).slice(0, 6).map((c, j) =>
          `<button class="iui-choice${answered && j === num(q.answer, -1) ? ' good' : ''}${answered && p === j && j !== num(q.answer, -1) ? ' bad' : ''}" ${answered ? 'disabled' : act('pick', i, j)}>${inl(c)}</button>`).join('')}</div>
          ${answered && q.why ? `<div class="iui-note">${inl(q.why)}</div>` : ''}</div>`;
      }).join('') + (qs.length && done === qs.length ? `<div class="iui-foot"><b>${e(t('iui_score', { n: good, t: qs.length }))}</b><button class="btn sm" ${act('reset')}>${e(t('iui_again'))}</button></div>` : '');
    },
    flashcards(d, key) {
      const cards = arr(d.cards).slice(0, 60); const s = st(key, () => ({ i: 0, back: false }));
      const c = cards[Math.min(s.i, cards.length - 1)] || {};
      return head(d) + `<button class="iui-card${s.back ? ' back' : ''}" ${act('flip')}><span class="iui-side">${e(t(s.back ? 'iui_back' : 'iui_front'))}</span><span class="iui-card-t">${inl(s.back ? c.back : c.front)}</span></button>
        <div class="iui-foot"><button class="icon-btn sm" ${act('prev')} aria-label="${e(t('iui_prev'))}">${icon('back', 15)}</button><span>${Math.min(s.i, cards.length - 1) + 1} / ${cards.length}</span><button class="icon-btn sm" ${act('next')} aria-label="${e(t('iui_next'))}">${icon('right', 15)}</button></div>`;
    },
    memory(d, key) {
      const pairs = arr(d.pairs).slice(0, 10); const cards = pairs.flatMap((p, k) => [{ k, t: arr(p)[0] }, { k, t: arr(p)[1] != null ? arr(p)[1] : arr(p)[0] }]);
      const order = shuffled(cards.length, key); const s = st(key, () => ({ open: [], found: [], moves: 0 }));
      const won = s.found.length === pairs.length && pairs.length;
      return head(d) + `<div class="iui-mem">${order.map((ci, pos) => { const c = cards[ci]; const up = s.open.includes(pos) || s.found.includes(c.k);
        return `<button class="iui-tile${up ? ' up' : ''}${s.found.includes(c.k) ? ' found' : ''}" ${up ? 'disabled' : act('tile', pos, c.k)}>${up ? inl(c.t) : ''}</button>`; }).join('')}</div>
        <div class="iui-foot"><span>${e(t(won ? 'iui_won' : 'iui_moves', { n: s.moves }))}</span><button class="btn sm" ${act('reset')}>${e(t('iui_again'))}</button></div>`;
    },
    order(d, key) {
      const items = arr(d.items).slice(0, 12); const s = st(key, () => ({ o: shuffled(items.length, key), checked: false }));
      return head(d) + (d.hint ? `<div class="iui-note">${inl(d.hint)}</div>` : '') + s.o.map((it, pos) => `<div class="iui-row${s.checked ? (it === pos ? ' good' : ' bad') : ''}"><span>${inl(items[it])}</span>
        <button class="icon-btn sm" ${act('up', pos)} aria-label="${e(t('iui_up'))}">${icon('up', 14)}</button><button class="icon-btn sm" ${act('down', pos)} aria-label="${e(t('iui_down'))}">${icon('down', 14)}</button></div>`).join('')
        + `<div class="iui-foot"><span>${s.checked ? e(t(s.o.every((v, i) => v === i) ? 'iui_right' : 'iui_wrong')) : ''}</span><button class="btn sm" ${act('verify')}>${e(t('iui_check'))}</button></div>`;
    },
    custom(d) { return head(d) + '<div class="iui-frame"></div>'; },
  };
  const ALIAS = { bars: 'progress', steps: 'timeline', cards: 'flashcards', newspaper: 'article', news: 'article', game: null, html: 'custom', todo: 'checklist', metrics: 'stats' };

  function typeOf(d) { let ty = String(d.type || '').toLowerCase(); if (ty === 'game') ty = String(d.game || '').toLowerCase(); if (ALIAS[ty]) ty = ALIAS[ty]; return R[ty] ? ty : ''; }
  function render(key) {
    const d = SPEC.get(key); const ty = typeOf(d);
    return `<div class="iui iui-${ty}" data-iui="${e(key)}">${R[ty](d, key)}</div>`;
  }
  // marked hook → HTML of the block, or null to show it as ordinary code
  function html(key, text) {
    // free form: the block holds markup (HTML / SVG / <style>), drawn by intelligent-ui-free.js
    if (/^\s*</.test(text) && R.ui) { SPEC.set(key, { type: 'ui', html: text }); return render(key); }
    let d = null; try { d = JSON.parse(text); } catch {}
    if (!d || typeof d !== 'object' || !typeOf(d)) {
      // still being written: a quiet line instead of raw JSON scrolling by
      return S.streaming && (!d || !d.type) ? `<div class="iui iui-wait"><span class="shimmer">${e(t('iui_wait'))}</span></div>` : null;
    }
    SPEC.set(key, d);
    try { return render(key); } catch { return null; }
  }

  const ACT = {
    check: (s, i) => { s.on[i] = !s.on[i]; },
    pick: (s, i, j) => { s.picked[i] = j; },
    reset: (s, i, j, key) => { ST.delete(key); },
    flip: (s) => { s.back = !s.back; },
    prev: (s, i, j, key) => { const n = arr(SPEC.get(key).cards).length || 1; s.i = (s.i - 1 + n) % n; s.back = false; },
    next: (s, i, j, key) => { const n = arr(SPEC.get(key).cards).length || 1; s.i = (s.i + 1) % n; s.back = false; },
    tile: (s, pos, k, key) => {
      if (s.open.length >= 2) return;
      s.open.push(pos); (s.kinds ||= []).push(k);
      if (s.open.length < 2) return;
      s.moves++;
      if (s.kinds[0] === s.kinds[1]) { s.found.push(k); s.open = []; s.kinds = []; }
      else setTimeout(() => { s.open = []; s.kinds = []; redraw(key); }, 900);
    },
    up: (s, pos) => { if (pos > 0) [s.o[pos - 1], s.o[pos]] = [s.o[pos], s.o[pos - 1]]; s.checked = false; },
    down: (s, pos) => { if (pos < s.o.length - 1) [s.o[pos + 1], s.o[pos]] = [s.o[pos], s.o[pos + 1]]; s.checked = false; },
    verify: (s) => { s.checked = true; },
  };
  function redraw(key) {
    const el = document.querySelector(`.iui[data-iui="${CSS.escape(key)}"]`); if (!el || !SPEC.has(key)) return;
    const tpl = document.createElement('template'); tpl.innerHTML = render(key); el.replaceWith(tpl.content.firstElementChild);
  }
  document.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-iui-act]'); const box = b && b.closest('.iui[data-iui]'); if (!box) return;
    const key = box.dataset.iui; const fn = ACT[b.dataset.iuiAct]; if (!fn || !SPEC.has(key)) return;
    ev.preventDefault(); ev.stopPropagation();
    fn(ST.get(key) || {}, Number(b.dataset.i), Number(b.dataset.j), key); redraw(key);
  });

  // ── custom: the model's own page, in a frame that cannot reach Fabro or the network ──
  const VARS = ['bg', 'panel', 'elev', 'border', 'border-strong', 'text', 'text-2', 'muted', 'accent', 'accent-ink', 'accent-soft', 'ok', 'warn', 'err', 'data-1', 'data-2', 'data-3',
    'font-ui', 'font-display', 'font-mono', 'r-xs', 'r-sm', 'r-md', 'r-lg', 'sp-1', 'sp-2', 'sp-3', 'sp-4', 'sp-5', 'fs-sm', 'fs-body', 'fs-h3'];
  function frameDoc(d) {
    const cs = getComputedStyle(document.documentElement);
    const vars = VARS.map((v) => `--${v}:${cs.getPropertyValue(`--${v}`).trim()};`).join('');
    const safe = (s) => String(s || '').replace(/<\/(script|style)/gi, '<\\/$1');
    return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:">
<style>:root{${vars}}*{box-sizing:border-box}html,body{margin:0;background:transparent;color:var(--text);font:var(--fs-body)/1.5 var(--font-ui)}body{padding:2px}
button{font:inherit;color:var(--text);background:var(--elev);border:1px solid var(--border);border-radius:var(--r-sm);padding:var(--sp-1) var(--sp-3);cursor:pointer}button:hover{border-color:var(--border-strong)}
button.primary{background:var(--accent);color:var(--accent-ink);border-color:var(--accent)}input,select{font:inherit;color:var(--text);background:var(--panel);border:1px solid var(--border);border-radius:var(--r-sm);padding:var(--sp-1) var(--sp-2)}
h1,h2,h3{font-family:var(--font-display);font-weight:500;margin:0 0 var(--sp-2)}canvas,svg{max-width:100%}</style><style>${safe(d.css)}</style></head>
<body>${String(d.html || '')}<script>new ResizeObserver(()=>parent.postMessage({iuiH:Math.ceil(document.body.getBoundingClientRect().height)+4},'*')).observe(document.body);<\/script><script>${safe(d.js)}<\/script></body></html>`;
  }
  function mount() {
    for (const slot of document.querySelectorAll('.iui-custom .iui-frame:not([data-on])')) {
      const d = SPEC.get(slot.closest('.iui').dataset.iui); if (!d) continue;
      slot.dataset.on = '1';
      // served by the artifact preview protocol: the app's own page rules would block the frame's scripts
      api.exporter.preview(frameDoc(d)).then((url) => {
        const f = document.createElement('iframe'); f.setAttribute('sandbox', 'allow-scripts'); f.title = d.title || 'Fabro'; f.src = url; slot.appendChild(f);
      }).catch(() => {});
    }
  }
  window.addEventListener('message', (ev) => {
    const h = ev.data && ev.data.iuiH; if (!h) return;
    for (const f of document.querySelectorAll('.iui-frame iframe')) if (f.contentWindow === ev.source) f.style.height = `${Math.max(40, Math.min(720, h))}px`;
  });
  let queued = false;
  new MutationObserver(() => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; mount(); }); }).observe(document.documentElement, { childList: true, subtree: true });

  // more display types live in intelligent-ui-more.js: add(type, render(d, key), { action(state, i, j, key) }, [aliases])
  function add(type, fn, acts, aliases) { R[type] = fn; Object.assign(ACT, acts || {}); for (const a of aliases || []) ALIAS[a] = type; }
  // a block inside another one (grid): registers its spec under its own key and returns its markup
  function child(key, d) { if (!d || typeof d !== 'object') return ''; SPEC.set(key, d); try { return typeOf(d) ? render(key) : ''; } catch { return ''; } }
  window.IUI = { html, types: () => Object.keys(R), add, child, redraw, state: (key) => ST.get(key), spec: (key) => SPEC.get(key), h: { e, inl, arr, num, st, act, head } };
})();

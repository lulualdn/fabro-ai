// Fabro Overlay page: draws the elements main sends. Each element's own HTML/CSS/JS runs in a sandboxed frame
// (scripts only: no access to this page, to Fabro or to the computer). The window ignores the mouse except
// over an interactive element or the Fabro mark.
(() => {
  const $ = (s) => document.querySelector(s);
  let theme = {}; const frames = new Map();
  const safe = (s) => String(s || '').replace(/<\/(script|style)/gi, '<\\/$1');
  const doc = (el) => `<!doctype html><html><head><meta charset="utf-8"><style>:root{${Object.entries(theme.vars || {}).map(([k, v]) => `--${k}:${v};`).join('')}}
*{box-sizing:border-box}html,body{margin:0;height:100%;background:transparent;color:var(--text);font:14px/1.45 var(--font-ui,system-ui)}body{padding:${el.kind === 'widget' && !el.bare ? '4px 12px 12px' : '0'}}
button{font:inherit;color:var(--text);background:var(--elev);border:1px solid var(--border);border-radius:8px;padding:4px 12px;cursor:pointer}button.primary{background:var(--accent);color:var(--accent-ink,#fff);border-color:var(--accent)}
input,select{font:inherit;color:var(--text);background:var(--elev);border:1px solid var(--border);border-radius:8px;padding:4px 8px}h1,h2,h3{font-family:var(--font-display,serif);font-weight:500;margin:0 0 6px}</style><style>${safe(el.css)}</style></head>
<body>${String(el.html || '')}<script>(()=>{let n=0;const wait=new Map(),subs=[];
window.fabro={ask:(t)=>new Promise((r)=>{const k=++n;wait.set(k,r);parent.postMessage({fabroAsk:String(t),k},'*')}),onAI:(f)=>subs.push(f)};
addEventListener('message',(e)=>{const d=e.data||{};if(d.fabroAnswer!=null&&wait.has(d.k)){wait.get(d.k)(d.fabroAnswer);wait.delete(d.k)}if(d.fabroWatch!=null)subs.forEach((f)=>{try{f(d.fabroWatch)}catch{}})});})()<\/script><script>${safe(el.js)}<\/script></body></html>`;

  function frame(el) { const f = document.createElement('iframe'); f.setAttribute('sandbox', 'allow-scripts'); f.srcdoc = doc(el); frames.set(el.id, f); return f; }
  function draw(list) {
    frames.clear(); const full = $('#full'); const ws = $('#widgets'); full.textContent = ''; ws.textContent = '';
    for (const el of list) {
      if (el.kind === 'fullscreen') { const f = frame(el); f.className = 'full'; if (el.interactive) f.dataset.int = '1'; full.appendChild(f); continue; }
      const w = document.createElement('div'); w.className = 'w' + (el.bare ? ' bare' : ''); w.dataset.id = el.id; if (el.interactive !== false) w.dataset.int = '1';
      Object.assign(w.style, { left: el.x + 'px', top: el.y + 'px', width: el.w + 'px', height: el.h + 'px' });
      const head = document.createElement('div'); head.className = 'w-head';
      const title = document.createElement('span'); title.textContent = el.title || ''; head.appendChild(title);
      if (el.watch) { const eye = document.createElement('i'); eye.className = 'w-eye'; eye.title = 'Looks at the screen'; head.appendChild(eye); }
      const x = document.createElement('button'); x.className = 'w-x'; x.textContent = '×'; x.setAttribute('aria-label', 'Remove'); x.onclick = () => ov.remove(el.id); head.appendChild(x);
      w.append(head, frame(el)); ws.appendChild(w);
      head.onmousedown = (e) => {
        if (e.target === x) return; const ox = e.clientX - w.offsetLeft, oy = e.clientY - w.offsetTop; w.classList.add('drag');
        const mv = (m) => { w.style.left = Math.max(0, Math.min(innerWidth - 40, m.clientX - ox)) + 'px'; w.style.top = Math.max(0, Math.min(innerHeight - 30, m.clientY - oy)) + 'px'; };
        const up = () => { removeEventListener('mousemove', mv); removeEventListener('mouseup', up); w.classList.remove('drag'); ov.move(el.id, w.offsetLeft, w.offsetTop); };
        addEventListener('mousemove', mv); addEventListener('mouseup', up);
      };
    }
    $('#close').hidden = !list.length;
    for (const n of document.querySelectorAll('[data-int]')) { n.onmouseenter = () => ov.hover(true); n.onmouseleave = () => ov.hover(false); }
  }
  addEventListener('message', async (e) => {
    const d = e.data || {}; if (d.fabroAsk == null) return;
    for (const [id, f] of frames) if (f.contentWindow === e.source) { const a = await ov.ask(id, d.fabroAsk).catch((x) => 'Error: ' + x.message); f.contentWindow.postMessage({ fabroAnswer: a, k: d.k }, '*'); }
  });
  ov.on((d) => {
    if (d.type === 'state') { theme = d.theme || {}; for (const [k, v] of Object.entries(theme.vars || {})) document.documentElement.style.setProperty('--' + k, v); if (theme.mark) $('#mark').setAttribute('d', theme.mark); draw(d.elements || []); }
    if (d.type === 'ai') { const f = frames.get(d.id); if (f && f.contentWindow) f.contentWindow.postMessage({ fabroWatch: d.text }, '*'); }
  });
  $('#close').onclick = () => ov.close();
  ov.ready();
})();

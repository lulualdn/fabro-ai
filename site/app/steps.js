/* Fabro Anywhere — agent UI, same as the desktop app: tool summary, every step with its result,
   sources and citations, thinking, files the AI made (view / download). */
window.FAS = (function () {
  let H = null; // helpers from app.js: { esc, t, md, ic }
  const KIND = {
    search: ['web_search', 'browser_search', 'search_files'],
    read: ['fetch_url', 'browser_open', 'browser_read', 'browser_extract', 'read_file', 'read_artifact', 'list_dir', 'convert_file', 'pdf_find_text', 'inspect_document'],
    create: ['write_file', 'create_document', 'create_pdf', 'generate_image', 'generate_speech', 'import_files', 'browser_download_images'],
    edit: ['edit_file', 'edit_artifact', 'pdf_edit', 'delete_file'],
    cmd: ['run_command', 'run_python', 'browser_script', 'run_tests', 'run_lint'],
    web: ['browser_click', 'browser_type', 'browser_select', 'browser_key', 'browser_scroll', 'browser_wait', 'browser_tabs', 'browser_zoom', 'browser_screenshot', 'browser_back', 'browser_find'],
    sub: ['run_subagent'],
    skip: ['update_plan', 'load_skill', 'wait'],
  };
  const kindOf = (n) => Object.keys(KIND).find((k) => KIND[k].includes(n)) || 'other';
  const base = (p) => String(p || '').split(/[\\/]/).pop();
  const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u || ''; } };
  const ext = (p) => (String(p).match(/\.([a-z0-9]+)$/i) || [, ''])[1].toLowerCase();
  const ICO = { search: '🔎', read: '📖', create: '✨', edit: '✏️', cmd: '›_', web: '🌐', sub: '🧩', other: '⚙️', skip: '🗺️' };

  function summary(list) {
    const n = {};
    for (const st of list) { const k = kindOf(st.name); if (k !== 'skip') n[k] = (n[k] || 0) + 1; }
    const s = ['search', 'read', 'create', 'edit', 'cmd', 'web', 'sub', 'other'].filter((k) => n[k]).map((k) => H.t(`sum_${k}${n[k] === 1 ? '1' : 'n'}`, { n: n[k] })).join(', ');
    return s ? s[0].toUpperCase() + s.slice(1) : '';
  }

  function label(st) {
    const a = st.args || {}, v = st.view || {}, run = st.status === 'running';
    const q = a.query || a.q, path = v.path || a.path, url = a.url || v.url;
    switch (st.name) {
      case 'web_search': case 'browser_search': return H.t(run ? 'st_searching' : 'st_searched', { q: q || '' });
      case 'fetch_url': case 'browser_open': case 'browser_read': return H.t(run ? 'st_reading' : 'st_read', { u: v.title || host(url) });
      case 'run_command': return '$ ' + (a.command || '').slice(0, 90);
      case 'run_python': return H.t('st_python');
      case 'write_file': case 'create_document': case 'create_pdf': return H.t(run ? 'st_creating' : 'st_created', { f: base(path) || a.title || '' });
      case 'edit_file': case 'edit_artifact': case 'pdf_edit': return H.t('st_edited', { f: base(path) || a.title || '' });
      case 'read_file': case 'convert_file': case 'inspect_document': return H.t('st_opened', { f: base(path) });
      case 'update_plan': return H.t('st_plan');
      case 'run_subagent': return a.description || H.t('st_sub');
      case 'generate_image': return H.t('st_image');
      case 'generate_speech': return H.t('st_speech');
      case 'run_tests': return H.t('st_tests');
      default: return String(st.name || '').replace(/^browser_/, '').replace(/_/g, ' ');
    }
  }

  // a file the AI produced on the PC: open it here or save it on the phone
  const fileChip = (path, sub) => `<div class="f-chip"><span class="f-ic">${(ext(path) || 'file').slice(0, 4).toUpperCase()}</span>
    <span class="f-t"><b>${H.esc(base(path))}</b><small>${H.esc(sub || path)}</small></span>
    <button class="btn sm ghost" data-act="file-view" data-path="${H.esc(path)}">${H.esc(H.t('view'))}</button>
    <button class="icon-btn sm" data-act="file-dl" data-path="${H.esc(path)}" aria-label="${H.esc(H.t('saveFile'))}">${H.ic('download', 18)}</button></div>`;

  const srcChips = (v) => `<div class="srcs">${v.sources.slice(0, 8).map((s, i) => `<a class="src" href="${H.esc(s.url)}" target="_blank" rel="noopener"><b>${(v.offset || 0) + i + 1}</b><span>${H.esc(s.title || host(s.url))}</span><small>${H.esc(host(s.url))}</small></a>`).join('')}</div>`;

  function detail(st) {
    const v = st.view || {}, a = st.args || {};
    if (v.sources && v.sources.length) return srcChips(v);
    if (st.name === 'run_command' || st.name === 'run_tests' || st.name === 'run_lint') { const out = v.out || ''; return out ? `<pre class="term">${H.esc(String(out).slice(-2500))}</pre>` : ''; }
    if (st.name === 'run_python') return `${v.out ? `<pre class="term">${H.esc(String(v.out).slice(-2500))}</pre>` : ''}${v.image ? `<img class="st-img" src="${H.esc(v.image)}" alt="" data-act="img-view">` : ''}`;
    if (st.name === 'update_plan' && (a.steps || []).length) return `<ol class="plan">${a.steps.map((p) => `<li class="${H.esc(p.status || '')}">${H.esc(p.title || '')}</li>`).join('')}</ol>`;
    const img = v.image && /^data:image/.test(v.image) ? v.image : v.shot && /^data:image/.test(v.shot) ? v.shot : '';
    let html = '';
    if (st.status === 'done' && v.path && KIND.create.concat(KIND.edit).includes(st.name)) html += fileChip(v.path, v.seconds ? `${v.seconds} s · ${v.voice || ''}` : v.pages ? `${v.pages} p.` : '');
    if (img) html += `<img class="st-img" src="${H.esc(img)}" alt="" data-act="img-view">`;
    if (v.before != null && v.after != null) html += `<details class="diff"><summary>${H.esc(H.t('changes'))}</summary><pre>${String(v.before).split('\n').slice(0, 40).map((l) => `<span class="dl">- ${H.esc(l)}</span>`).join('\n')}\n${String(v.after).split('\n').slice(0, 40).map((l) => `<span class="al">+ ${H.esc(l)}</span>`).join('\n')}</pre></details>`;
    return html;
  }

  function step(st, all) {
    const kids = all.filter((x) => x.parent === st.id);
    const run = st.status === 'running';
    const k = kindOf(st.name);
    return `<div class="st ${H.esc(st.status || '')}">
      <div class="st-row"><span class="st-ic">${run ? '<i class="pulse"></i>' : st.status === 'error' ? '⚠' : st.status === 'refused' ? '⊘' : `<span class="k">${ICO[k]}</span>`}</span>
      <span class="st-l">${H.esc(label(st))}${st.error ? ` — <em>${H.esc(String(st.error).slice(0, 200))}</em>` : ''}</span></div>
      ${detail(st)}
      ${kids.length ? `<div class="st-kids">${kids.map((x) => step(x, all)).join('')}</div>` : ''}
    </div>`;
  }

  // the outputs stay visible under a folded summary
  function outputs(top) { return top.filter((st) => st.status === 'done' && (st.view || {}).path && (KIND.create.includes(st.name) || ['edit_artifact', 'pdf_edit'].includes(st.name))).map((st) => fileChip(st.view.path)).join(''); }

  function steps(m) {
    const all = m.steps || [], top = all.filter((s) => !s.parent);
    if (!top.length) return '';
    const counted = top.filter((s) => kindOf(s.name) !== 'skip');
    const body = top.map((s) => step(s, all)).join('');
    if (counted.length < 2) return `<div class="sts">${body}</div>`;
    const running = top.some((s) => s.status === 'running');
    const errs = top.filter((s) => s.status === 'error').length;
    const outs = !m.pending ? outputs(top) : '';
    return `<details class="sts-sum" ${m.pending ? 'open' : ''}><summary>${running ? '<i class="pulse"></i>' : H.ic('check', 14)}<span>${H.esc(summary(top))}</span>${errs ? `<em>${H.esc(H.t(errs === 1 ? 'sum_err1' : 'sum_errn', { n: errs }))}</em>` : ''}<span class="chev">›</span></summary><div class="sts">${body}</div></details>${outs ? `<div class="outs">${outs}</div>` : ''}`;
  }

  function think(m, live) {
    if (!m.reasoning) return '';
    if (live) { const last = (m.reasoning.trim().split(/\n+/).pop() || '').replace(/[*#_`>]/g, '').slice(-120); return `<details class="think live"><summary><span class="shimmer">${H.esc(H.t('thinking'))}</span><span class="think-last shimmer">${H.esc(last)}</span></summary><div>${H.esc(m.reasoning)}</div></details>`; }
    return `<details class="think"><summary>${H.esc(H.t('thoughts'))}</summary><div>${H.esc(m.reasoning)}</div></details>`;
  }

  // sources numbered across the answer, citations as small links
  function sourceMap(m) {
    const map = new Map(); let run = 0;
    for (const st of (m.steps || []).filter((x) => !x.parent)) {
      const v = st.view; if (!v || !v.sources || !v.sources.length) continue;
      const off = v.offset != null ? v.offset : run;
      v.sources.forEach((s, i) => { if (!map.has(off + i + 1)) map.set(off + i + 1, s); });
      run = Math.max(run, off + v.sources.length);
    }
    return map;
  }
  const RE = /\[(\d{1,3}(?:\s*(?:[,;–-]|\]\s*\[)\s*\d{1,3})*)\]/g;
  const nums = (inner) => inner.split(/\s*[,;]\s*|\s*\]\s*\[\s*/).flatMap((p) => { const r = p.match(/^(\d{1,3})\s*[-–]\s*(\d{1,3})$/); if (r) { const o = []; for (let k = +r[1]; k <= +r[2] && o.length < 12; k++) o.push(k); return o; } return /^\d{1,3}$/.test(p) ? [+p] : []; });
  function linkCites(html, map) {
    if (!map.size || !/\[\d/.test(html)) return html;
    const tpl = document.createElement('template'); tpl.innerHTML = html;
    const w = document.createTreeWalker(tpl.content, NodeFilter.SHOW_TEXT); const nodes = []; while (w.nextNode()) nodes.push(w.currentNode);
    for (const node of nodes) {
      if (!/\[\d/.test(node.nodeValue) || (node.parentElement && node.parentElement.closest('code, pre, a'))) continue;
      const txt = node.nodeValue; let last = 0, mm, changed = false; const frag = document.createDocumentFragment(); RE.lastIndex = 0;
      while ((mm = RE.exec(txt))) {
        const ns = nums(mm[1]).filter((k) => map.has(k)); if (!ns.length) continue;
        changed = true; frag.append(txt.slice(last, mm.index));
        const g = document.createElement('span'); g.className = 'cit-g';
        for (const k of [...new Set(ns)]) { const s = map.get(k); const el = document.createElement('a'); el.className = 'cit'; el.href = s.url; el.target = '_blank'; el.rel = 'noopener'; el.textContent = k; g.append(el); }
        frag.append(g); last = mm.index + mm[0].length;
      }
      if (changed) { frag.append(txt.slice(last)); node.replaceWith(frag); }
    }
    return tpl.innerHTML;
  }
  function cited(m) {
    if (m.pending) return '';
    const map = sourceMap(m); if (!map.size) return '';
    const ks = [...new Set([...(m.content || '').matchAll(RE)].flatMap((x) => nums(x[1])))].filter((k) => map.has(k)).sort((a, b) => a - b);
    const seen = new Set(); const list = [];
    for (const k of ks.length ? ks : [...map.keys()].slice(0, 4)) { const s = map.get(k); if (seen.has(s.url)) continue; seen.add(s.url); list.push([k, s]); }
    return `<div class="cites"><span class="cites-h">${H.esc(H.t(ks.length ? 'sourcesCited' : 'sources'))}</span>${list.map(([n, s]) => `<a class="cite" href="${H.esc(s.url)}" target="_blank" rel="noopener"><b>${n}</b><span>${H.esc(s.title || host(s.url))}</span><small>${H.esc(host(s.url))}</small></a>`).join('')}</div>`;
  }

  return { init: (h) => { H = h; }, steps, think, sourceMap, linkCites, cited };
})();

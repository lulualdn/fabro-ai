// Where things happened in an answer. Thoughts and tool steps remember `pos`: how much text was written before
// them. The answer is then drawn in order: text, what Fabro did there, text… instead of every step at the top.
// One block per place: the thoughts of that moment (one line, folded), then its steps (one line when several).
// An artifact made by a step shows at that place; an artifact changed later shows once more at the very end.
// Old messages (no `pos`) and voice answers keep the previous layout. Hooks: app.js (events, assistantBody),
// agent-ui.js (retract, late cards), stream-render.js (the growing text is the last run only).
(() => {
  const LATE = new WeakSet(); // steps whose card moves to the end of the message
  const len = (m) => (m.content || '').length;
  const next = (m) => (m.tlSeq = (m.tlSeq || 0) + 1);

  // events (called before the message is changed)
  function onThink(m, text) {
    if (m.voice) return;
    const pos = len(m); const from = (m.reasoning || '').length; const th = (m.thinks ||= []); const last = th[th.length - 1];
    const stepSince = last && (m.steps || []).some((s) => !s.parent && (s.seq || 0) > last.seq);
    if (last && last.pos === pos && !stepSince) { last.to = from + text.length; last.t1 = Date.now(); }
    else th.push({ pos, from, to: from + text.length, t0: Date.now(), t1: Date.now(), seq: next(m) });
  }
  function onStep(m, st) { if (st.parent || m.voice) return; st.pos = len(m); st.seq = next(m); }
  function onRetract(m, text) {
    const i = text ? (m.content || '').indexOf(text) : -1; if (i < 0) return;
    const fix = (o) => { if (o.pos != null && o.pos > i) o.pos = Math.max(i, o.pos - text.length); };
    (m.thinks || []).forEach(fix); (m.steps || []).forEach(fix);
  }

  const has = (m) => !m.voice && (!!(m.thinks || []).length || (m.steps || []).some((s) => !s.parent && s.pos != null));
  // [{ pos, thinks: [...], steps: [...] }] in order, one entry per place
  function places(m) {
    const n = len(m); const map = new Map();
    const at = (pos) => { const p = Math.max(0, Math.min(pos == null ? 0 : pos, n)); if (!map.has(p)) map.set(p, { pos: p, thinks: [], steps: [] }); return map.get(p); };
    for (const x of m.thinks || []) at(x.pos).thinks.push(x);
    for (const s of m.steps || []) if (!s.parent) at(s.pos).steps.push(s);
    return [...map.values()].sort((a, b) => a.pos - b.pos);
  }
  // start of the last run of text (what is still growing while the answer is written)
  const base = (m) => (has(m) ? places(m).reduce((b, p) => Math.max(b, p.pos), 0) : 0);

  function thinkHtml(m, segs, live) {
    const text = segs.map((x) => (m.reasoning || '').slice(x.from, x.to).trim()).filter(Boolean).join('\n\n');
    if (!text) return '';
    const secs = Math.max(1, Math.round(segs.reduce((a, x) => a + Math.max(0, (x.t1 || x.t0) - x.t0), 0) / 1000));
    const lastLine = live ? (text.split(/\n+/).pop() || '').replace(/[*#_`>]/g, '').slice(-140) : '';
    const open = live ? !!(S.thinkOpen && S.thinkOpen[m.id]) : false;
    return `<details class="think ${live ? 'live' : ''}" data-id="${m.id}" ${open ? 'open' : ''}>
      <summary>${icon('brain', 15)}<span class="${live ? 'shimmer' : ''}">${esc(live ? t('thinking') : t('thoughtFor', { s: secs }))}</span>${lastLine ? `<span class="think-last shimmer">${esc(lastLine)}</span>` : ''}${icon('down', 14, 'chev')}</summary>
      <div class="think-body">${esc(text)}</div>
    </details>`;
  }

  function textHtml(m, a, b, key) {
    const slice = (m.content || '').slice(a, b);
    if (!slice.trim()) return '';
    if (typeof hasArtifacts === 'function' && hasArtifacts({ content: slice })) {
      // artifacts written in the text are numbered over the whole answer
      const before = a ? splitArtifacts(m.content.slice(0, a)).filter((s) => s.kind === 'artifact').length : 0;
      return renderWithArtifacts({ ...m, content: slice, artifacts: (m.artifacts || []).slice(before) });
    }
    return `<div class="md">${md(slice, key == null ? m.id : `${m.id}g${key}`)}</div>`;
  }

  // The body of an answer, in order. Called by assistantBody (which sets the citation map around it).
  function body(m) {
    const ps = places(m); const n = len(m);
    // an artifact changed by a later step: its card goes to the end, once per artifact (the last version)
    const edits = new Map();
    for (const s of m.steps || []) { const v = s.view || {}; if (!s.parent && s.name === 'edit_artifact' && s.status === 'done' && v.kind === 'artifact' && v.artifactId) { LATE.add(s); edits.set(v.artifactId, s); } }
    let html = ''; let prev = 0;
    ps.forEach((p, i) => {
      if (p.pos > prev) { html += textHtml(m, prev, p.pos, i); prev = p.pos; }
      const lastPlace = i === ps.length - 1;
      const live = !!m.pending && lastPlace && n === p.pos && !!p.thinks.length
        && !p.steps.some((s) => (s.seq || 0) > p.thinks[p.thinks.length - 1].seq);
      html += `<div class="tl-block">${thinkHtml(m, p.thinks, live)}${p.steps.length ? renderSteps(m, p.steps) : ''}</div>`;
    });
    html += textHtml(m, prev, n, null);
    if (edits.size && !m.pending) html += `<div class="tl-late">${[...edits.values()].map((s) => stepDetail(s, true)).join('')}</div>`;
    return html;
  }

  window.Timeline = { onThink, onStep, onRetract, has, base, body, isLate: (st) => LATE.has(st), _places: places };
})();

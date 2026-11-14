'use strict';
/* Streaming render (v0.2 perf): an answer that is being written is no longer re-parsed and re-highlighted
   from the first character on every frame.
   - the markdown is split at block boundaries that can no longer change (a blank line outside a code fence,
     not followed by an indented continuation): finished blocks are parsed ONCE and their DOM nodes kept;
     only the growing tail is re-parsed each frame (one DOM update per animation frame, batched upstream)
   - code blocks are shown plain while streaming and highlighted when the browser is idle
   - the parts around the text (thinking, steps, precisions…) are only re-written when they changed
   When the message finishes, app.js renders it once in full as before (same markup as always).
   Messages with artifacts or voice tags keep the full render, throttled to what the machine can afford. */

const SR_SLOT = 'FABROSTREAMSLOTX7Q';
const SR = new Map(); // message id → state
let SR_NOHL = false;  // read by highlight() in app.js: plain code while streaming

// End of the last "stable" block in text[from..]: a blank line outside any code fence, whose next non-empty
// line is not indented (an indented line would continue a list item or a code block).
function srBoundary(text, from) {
  let i = from, inFence = false, fence = '', best = -1;
  const n = text.length;
  while (i < n) {
    const j = text.indexOf('\n', i);
    if (j < 0) break; // the last line is still being written
    const line = text.slice(i, j);
    const fm = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fm) {
      if (!inFence) { inFence = true; fence = fm[1][0]; }
      else if (fm[1][0] === fence && /^ {0,3}(`{3,}|~{3,})\s*$/.test(line)) inFence = false;
    } else if (!inFence && line.trim() === '' && i > from) {
      // the next line with content must be fully known and not indented (else it continues a list item / code)
      let k = j + 1;
      while (k < n && (text[k] === '\n' || text[k] === '\r')) k++;
      const nl = text.indexOf('\n', k);
      if (nl > k && !/^[ \t]/.test(text.slice(k, nl))) best = k;
    }
    i = j + 1;
  }
  return best;
}

function srHighlightIdle(root) {
  const cards = [...root.querySelectorAll('.code-card[data-key]')].filter((c) => !c.dataset.hl);
  if (!cards.length) return;
  const run = (dl) => {
    while (cards.length && (!dl || dl.timeRemaining() > 4)) {
      const c = cards.shift(); c.dataset.hl = '1';
      const info = S.code.get(c.dataset.key); const el = c.querySelector('code');
      if (info && el && el.isConnected) { try { el.innerHTML = highlight(info.code, info.lang); } catch {} }
    }
    if (cards.length) schedule();
  };
  const schedule = () => (window.requestIdleCallback ? requestIdleCallback(run, { timeout: 800 }) : setTimeout(() => run(null), 60));
  schedule();
}

function srMd(text, prefix, cites) {
  SR_NOHL = true;
  const prev = MD_CITES; MD_CITES = cites;
  try { return md(text, prefix); } finally { SR_NOHL = false; MD_CITES = prev; }
}

// Returns true when it rendered the message (fast path), false to let the caller do the full render.
function streamPatch(el, m) {
  if (!m.content || (typeof hasArtifacts === 'function' && hasArtifacts(m))) { SR.delete(m.id); return false; }
  let st = SR.get(m.id);
  if (!st || st.el !== el) { st = { el, outer: null, mdEl: null, stableLen: 0, chunks: 0, stableNodes: 0, tailNodes: 0, content: '' }; SR.set(m.id, st); }
  // thoughts and steps sit inside the text (timeline.js): only the last run of text is still growing
  const base = window.Timeline && Timeline.has(m) ? Timeline.base(m) : 0;
  if (st.base !== base) { st.base = base; st.stableLen = 0; st.chunks = 0; st.stableNodes = 0; st.tailNodes = 0; st.content = ''; st.mdEl = null; st.outer = null; }
  const content = base ? m.content.slice(base) : m.voice && typeof vStripTags === 'function' ? vStripTags(m.content) : m.content;
  if (content.length < st.content.length || content.slice(0, st.stableLen) !== st.content.slice(0, st.stableLen)) { // retracted / rewritten: start over
    st.stableLen = 0; st.chunks = 0; st.stableNodes = 0; st.tailNodes = 0; if (st.mdEl) st.mdEl.textContent = '';
  }
  st.content = content;
  // 1) everything around the text, with the text replaced by a slot
  const outer = assistantBody({ ...m, content: m.content.slice(0, base) + SR_SLOT, voice: false });
  if (outer !== st.outer || !st.mdEl || !st.mdEl.isConnected) {
    const keep = st.mdEl ? [...st.mdEl.childNodes] : [];
    el.innerHTML = outer;
    const slot = [...el.querySelectorAll('.md p')].find((p) => p.textContent === SR_SLOT);
    if (!slot) { SR.delete(m.id); return false; } // markup changed shape: full render
    const mdEl = slot.parentElement; slot.remove();
    for (const n of keep) mdEl.appendChild(n);
    st.mdEl = mdEl; st.outer = outer;
  }
  const cites = typeof sourceMap === 'function' ? sourceMap(m) : null;
  // 2) finished blocks: parsed once, appended
  const b = srBoundary(content, st.stableLen);
  if (b > st.stableLen) {
    for (let i = 0; i < st.tailNodes; i++) st.mdEl.lastChild && st.mdEl.removeChild(st.mdEl.lastChild);
    st.tailNodes = 0;
    const before = st.mdEl.childNodes.length;
    st.mdEl.insertAdjacentHTML('beforeend', srMd(content.slice(st.stableLen, b), `${m.id}s${st.chunks++}`, cites));
    st.stableNodes += st.mdEl.childNodes.length - before;
    st.stableLen = b;
    srHighlightIdle(st.mdEl);
  }
  // 3) the growing tail: re-parsed every frame (small)
  for (let i = 0; i < st.tailNodes; i++) st.mdEl.lastChild && st.mdEl.removeChild(st.mdEl.lastChild);
  const before = st.mdEl.childNodes.length;
  const tail = content.slice(st.stableLen);
  if (tail.trim()) st.mdEl.insertAdjacentHTML('beforeend', srMd(tail, `${m.id}t`, cites));
  st.tailNodes = st.mdEl.childNodes.length - before;
  return true;
}
function streamDone(id) { SR.delete(id); }

// Pause CSS animations while the window is hidden (the window keeps rendering in the background for the quick bar).
document.addEventListener('visibilitychange', () => document.documentElement.classList.toggle('fabro-hidden', document.hidden));

'use strict';
/* Zoomable images: pinch with two fingers, drag once zoomed, double-tap / double-click to zoom in and out,
   mouse wheel (or trackpad pinch) to zoom around the pointer. Used by the file viewer, on the desktop and on
   the phone (Fabro Anywhere). While not zoomed, one finger still scrolls the page around the image. */
(function () {
  const MAX = 8;
  function FabroZoom(img) {
    if (!img || img.__zoom) return; img.__zoom = true;
    let s = 1, tx = 0, ty = 0;
    const pts = new Map(); let pinch = null, pan = null, lastTap = 0;
    let multi = false, start = null, moved = false; // a tap is one finger that didn't move (two fingers lifting is not a double tap)
    img.style.transformOrigin = '0 0'; img.draggable = false;
    const apply = (anim) => {
      const w = img.offsetWidth, h = img.offsetHeight;
      tx = Math.min(0, Math.max(w * (1 - s), tx)); ty = Math.min(0, Math.max(h * (1 - s), ty));
      img.style.transition = anim ? 'transform .2s ease' : 'none';
      img.style.transform = s === 1 ? '' : `translate(${tx}px, ${ty}px) scale(${s})`;
      img.style.touchAction = s > 1 ? 'none' : 'pan-x pan-y';
      img.style.cursor = s > 1 ? 'grab' : 'zoom-in';
      img.classList.toggle('zoomed', s > 1);
    };
    const local = (x, y) => { const r = img.getBoundingClientRect(); return { x: x - r.left + tx, y: y - r.top + ty }; }; // relative to the image's untransformed box
    const zoomAt = (ns, px, py, anim) => { ns = Math.max(1, Math.min(MAX, ns)); tx = px - (px - tx) * (ns / s); ty = py - (py - ty) * (ns / s); s = ns; if (s === 1) { tx = 0; ty = 0; } apply(anim); };
    apply();
    img.addEventListener('pointerdown', (e) => {
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 1) { multi = false; moved = false; start = { x: e.clientX, y: e.clientY }; } else multi = true;
      if (pts.size === 2) { const [a, b] = [...pts.values()]; const m = local((a.x + b.x) / 2, (a.y + b.y) / 2); pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), s, ux: (m.x - tx) / s, uy: (m.y - ty) / s }; pan = null; } // ux/uy: image point under the fingers
      else if (pts.size === 1 && s > 1) { pan = { x: e.clientX, y: e.clientY, tx, ty }; try { img.setPointerCapture(e.pointerId); } catch {} }
      if (s > 1 || pts.size === 2) e.preventDefault();
    });
    img.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10) moved = true;
      if (pinch && pts.size === 2) {
        const [a, b] = [...pts.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y);
        const ns = Math.max(1, Math.min(MAX, pinch.s * d / pinch.d));
        // keep the point under the fingers in place
        const r = img.getBoundingClientRect(); const cx = (a.x + b.x) / 2 - r.left + tx, cy = (a.y + b.y) / 2 - r.top + ty;
        tx = cx - pinch.ux * ns; ty = cy - pinch.uy * ns; s = ns; apply(); e.preventDefault();
      } else if (pan) { tx = pan.tx + (e.clientX - pan.x); ty = pan.ty + (e.clientY - pan.y); apply(); e.preventDefault(); }
    });
    const up = (e) => {
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch = null;
      if (!pts.size) { pan = null; if (s < 1.05) { s = 1; tx = ty = 0; apply(true); } }
      if (e.type === 'pointerup' && e.pointerType === 'touch' && !multi && !moved && !pts.size) {
        const now = Date.now();
        if (now - lastTap < 300) { const p = local(e.clientX, e.clientY); zoomAt(s > 1 ? 1 : 2.5, p.x, p.y, true); lastTap = 0; } else lastTap = now;
      }
    };
    img.addEventListener('pointerup', up); img.addEventListener('pointercancel', up);
    img.addEventListener('dblclick', (e) => { const p = local(e.clientX, e.clientY); zoomAt(s > 1 ? 1 : 2.5, p.x, p.y, true); e.preventDefault(); });
    img.addEventListener('wheel', (e) => {
      if (s === 1 && !e.ctrlKey && Math.abs(e.deltaY) < 4) return;
      if (s === 1 && !e.ctrlKey && img.closest('.v-pages')) return; // a list of pages scrolls normally until one is zoomed
      e.preventDefault(); const p = local(e.clientX, e.clientY);
      zoomAt(s * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018)), p.x, p.y);
    }, { passive: false });
    img.addEventListener('load', () => apply());
  }
  window.FabroZoom = FabroZoom; window.FAZoom = FabroZoom;
})();

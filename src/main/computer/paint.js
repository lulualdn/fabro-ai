// Draws what the AI needs on screenshots, in a hidden window with a canvas: numbered boxes on the
// elements ("set-of-marks"), an optional coordinate grid, rulers on zoomed crops, and the point an
// action hit (for the user's step thumbnails).
const { BrowserWindow } = require('electron');

const PAGE = `<!doctype html><html><head><meta charset="utf-8"></head><body><script>
const COLORS = ['#e6194b','#1e88e5','#2e7d32','#f57c00','#8e24aa','#00838f','#c2185b','#5d4037','#3949ab','#6d8b00'];
const load = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('image')); i.src = src; });
// the picture for the AI, then (optionally) the point drawn for the user's thumbnail only
function out(cv, q, w, pt, f) {
  const r = { image: cv.toDataURL('image/jpeg', q) };
  if (pt) point(cv.getContext('2d'), pt[0], pt[1], f || 1);
  if (w) { const t = document.createElement('canvas'); const s = Math.min(1, w / cv.width); t.width = Math.round(cv.width * s); t.height = Math.round(cv.height * s);
    const g = t.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(cv, 0, 0, t.width, t.height); r.thumb = t.toDataURL('image/jpeg', 0.72); }
  return r;
}
function point(g, x, y, f) {
  g.save(); g.lineWidth = 3 * f; g.strokeStyle = '#fff'; g.beginPath(); g.arc(x, y, 11 * f, 0, Math.PI * 2); g.stroke();
  g.lineWidth = 2 * f; g.strokeStyle = '#ff3b30'; g.beginPath(); g.arc(x, y, 11 * f, 0, Math.PI * 2); g.stroke();
  g.fillStyle = '#ff3b30'; g.beginPath(); g.arc(x, y, 3.2 * f, 0, Math.PI * 2); g.fill(); g.restore();
}
// the mouse pointer, drawn on top of the marks so the AI always sees where it is
function arrow(g, x, y, f) {
  const k = 1.15 * f, P = [[0, 0], [0, 17], [4.5, 13], [7.5, 20], [10.5, 18.8], [7.6, 12], [13, 12]];
  g.save(); g.translate(x, y); g.scale(k, k); g.beginPath(); P.forEach(([a, b], i) => (i ? g.lineTo(a, b) : g.moveTo(a, b))); g.closePath();
  g.fillStyle = '#000'; g.fill(); g.lineWidth = 1.6; g.strokeStyle = '#fff'; g.stroke(); g.restore();
}
window.mark = async (o) => {
  const img = await load(o.src);
  const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
  const g = cv.getContext('2d'); g.drawImage(img, 0, 0);
  const f = Math.max(0.8, Math.min(1.5, img.width / 1280));
  if (o.grid) {
    g.save(); g.strokeStyle = 'rgba(255,0,140,.35)'; g.lineWidth = 1; g.font = 'bold ' + Math.round(10 * f) + 'px Arial'; g.fillStyle = 'rgba(255,0,140,.95)';
    for (let x = 100; x < cv.width; x += 100) { g.beginPath(); g.moveTo(x + .5, 0); g.lineTo(x + .5, cv.height); g.stroke(); g.fillText(String(x), x + 2, 11 * f); }
    for (let y = 100; y < cv.height; y += 100) { g.beginPath(); g.moveTo(0, y + .5); g.lineTo(cv.width, y + .5); g.stroke(); g.fillText(String(y), 2, y - 2); }
    g.restore();
  }
  const fs = Math.round(11.5 * f), bh = Math.round(15 * f);
  g.font = 'bold ' + fs + 'px Arial'; g.textBaseline = 'middle';
  const placed = [];
  for (const m of o.marks || []) {
    const c = COLORS[m.id % COLORS.length];
    const [x, y, w, h] = m.r;
    g.save();
    g.lineWidth = m.ocr ? 1.2 * f : 1.8 * f; g.strokeStyle = c;
    if (m.ocr) g.setLineDash([4 * f, 3 * f]);
    g.strokeRect(x + .5, y + .5, Math.max(1, w - 1), Math.max(1, h - 1));
    g.restore();
    const label = String(m.id); const bw = Math.round(g.measureText(label).width + 7 * f);
    // badge above the top-left corner, else inside; nudged right if it would cover another badge
    let bx = x, by = y - bh >= 0 ? y - bh : y;
    for (let k = 0; k < 4 && placed.some((p) => bx < p[0] + p[2] && bx + bw > p[0] && by < p[1] + p[3] && by + bh > p[1]); k++) bx += bw + 1;
    bx = Math.min(bx, cv.width - bw);
    placed.push([bx, by, bw, bh]);
    g.fillStyle = c; g.fillRect(bx, by, bw, bh);
    g.fillStyle = '#fff'; g.fillText(label, bx + 3.5 * f, by + bh / 2 + .5);
  }
  if (o.cursor) arrow(g, o.cursor[0], o.cursor[1], f);
  return out(cv, o.quality || 0.82, o.thumb, o.point, f);
};
window.zoom = async (o) => {
  const img = await load(o.src);
  const pad = 26;
  const cv = document.createElement('canvas'); cv.width = img.width + pad; cv.height = img.height + pad;
  const g = cv.getContext('2d'); g.fillStyle = '#20232a'; g.fillRect(0, 0, cv.width, cv.height);
  g.imageSmoothingQuality = 'high'; g.drawImage(img, pad, pad);
  // rulers in the coordinates of the full screenshot, so the AI can click what it reads here
  g.fillStyle = '#fff'; g.strokeStyle = 'rgba(255,255,255,.7)'; g.font = '11px Arial'; g.textBaseline = 'top';
  const step = (span) => [5, 10, 20, 25, 50, 100, 200].find((s) => span / s <= 12) || 500;
  const sx = step(o.w), sy = step(o.h);
  for (let v = Math.ceil(o.x / sx) * sx; v <= o.x + o.w; v += sx) { const px = pad + (v - o.x) * o.k; g.beginPath(); g.moveTo(px + .5, pad - 6); g.lineTo(px + .5, pad); g.stroke(); g.fillText(String(v), px + 2, 4); }
  g.textBaseline = 'middle';
  for (let v = Math.ceil(o.y / sy) * sy; v <= o.y + o.h; v += sy) { const py = pad + (v - o.y) * o.k; g.beginPath(); g.moveTo(pad - 6, py + .5); g.lineTo(pad, py + .5); g.stroke(); g.save(); g.translate(11, py); g.rotate(-Math.PI / 2); g.textAlign = 'center'; g.fillText(String(v), 0, 0); g.restore(); }
  return out(cv, 0.88, o.thumb);
};
</script></body></html>`;

let win = null, ready = null;
function ensure() {
  if (win && !win.isDestroyed()) return ready;
  win = new BrowserWindow({ show: false, width: 200, height: 200, webPreferences: { sandbox: true, backgroundThrottling: false, offscreen: false } });
  ready = win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(PAGE));
  win.on('closed', () => { win = null; ready = null; });
  return ready;
}
async function call(fn, o) {
  await ensure();
  return win.webContents.executeJavaScript(`window.${fn}(${JSON.stringify(o)})`, true);
}

module.exports = {
  // src: data URL of the (already resized) screenshot · marks: [{ id, r:[x,y,w,h], ocr? }] in its pixels
  mark: (src, marks, { grid = false, point = null, cursor = null, thumb = 560, quality } = {}) => call('mark', { src, marks, grid, point, cursor, thumb, quality }),
  // crop already upscaled by k; x,y,w,h: the region in the full screenshot's coordinates
  zoom: (src, { x, y, w, h, k, thumb = 560 }) => call('zoom', { src, x, y, w, h, k, thumb }),
  close() { if (win && !win.isDestroyed()) win.destroy(); win = null; ready = null; },
};

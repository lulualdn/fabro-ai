// pdf.js in the main process. Its Node build wants DOMMatrix / Path2D / ImageData, which it normally gets from
// @napi-rs/canvas — a native module we don't ship. Text extraction only needs a working 2D DOMMatrix, so we
// provide one (and harmless stubs) before loading pdf.js.
class DOMMatrix {
  constructor(init) {
    const v = Array.isArray(init) && init.length >= 6 ? init : [1, 0, 0, 1, 0, 0];
    [this.a, this.b, this.c, this.d, this.e, this.f] = v.map(Number);
  }
  get is2D() { return true; }
  get isIdentity() { return this.a === 1 && !this.b && !this.c && this.d === 1 && !this.e && !this.f; }
  multiplySelf(m) { const { a, b, c, d, e, f } = this; this.a = a * m.a + c * m.b; this.b = b * m.a + d * m.b; this.c = a * m.c + c * m.d; this.d = b * m.c + d * m.d; this.e = a * m.e + c * m.f + e; this.f = b * m.e + d * m.f + f; return this; }
  preMultiplySelf(m) { const n = new DOMMatrix([m.a, m.b, m.c, m.d, m.e, m.f]).multiplySelf(this); Object.assign(this, { a: n.a, b: n.b, c: n.c, d: n.d, e: n.e, f: n.f }); return this; }
  multiply(m) { return new DOMMatrix([this.a, this.b, this.c, this.d, this.e, this.f]).multiplySelf(m); }
  translateSelf(x = 0, y = 0) { return this.multiplySelf(new DOMMatrix([1, 0, 0, 1, x, y])); }
  translate(x, y) { return new DOMMatrix([this.a, this.b, this.c, this.d, this.e, this.f]).translateSelf(x, y); }
  scaleSelf(sx = 1, sy = sx) { return this.multiplySelf(new DOMMatrix([sx, 0, 0, sy, 0, 0])); }
  scale(sx, sy) { return new DOMMatrix([this.a, this.b, this.c, this.d, this.e, this.f]).scaleSelf(sx, sy); }
  invertSelf() { const { a, b, c, d, e, f } = this, det = a * d - b * c; if (!det) { [this.a, this.b, this.c, this.d, this.e, this.f] = [NaN, NaN, NaN, NaN, NaN, NaN]; return this; } [this.a, this.b, this.c, this.d, this.e, this.f] = [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det]; return this; }
  inverse() { return new DOMMatrix([this.a, this.b, this.c, this.d, this.e, this.f]).invertSelf(); }
  transformPoint(p = {}) { const x = p.x || 0, y = p.y || 0; return { x: this.a * x + this.c * y + this.e, y: this.b * x + this.d * y + this.f, z: 0, w: 1 }; }
}
let loading = null;
function load() {
  if (!globalThis.DOMMatrix) globalThis.DOMMatrix = DOMMatrix;
  if (!globalThis.Path2D) globalThis.Path2D = class Path2D { addPath() {} moveTo() {} lineTo() {} bezierCurveTo() {} quadraticCurveTo() {} rect() {} closePath() {} };
  if (!globalThis.ImageData) globalThis.ImageData = class ImageData { constructor(d, w, h) { if (typeof d === 'number') { h = w; w = d; d = new Uint8ClampedArray(w * h * 4); } this.data = d; this.width = w; this.height = h; } };
  return (loading ||= import('pdfjs-dist/legacy/build/pdf.mjs'));
}
module.exports = { load, DOMMatrix };

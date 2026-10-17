// Reads the circular pairing code from camera frames, off the main thread.
importScripts('core.js');
self.onmessage = (e) => {
  const { data, width, height } = e.data;
  let r = null;
  try { r = self.FabroAnywhere.decodeRingCode({ data: new Uint8ClampedArray(data), width, height }, 0.8); } catch {}
  self.postMessage(r ? { ok: true, data27: Array.from(r.data27) } : { ok: false });
};

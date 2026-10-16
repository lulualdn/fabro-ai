// Resumable streaming download with progress callbacks.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

async function downloadFile(url, dest, { onProgress, signal, headers = {}, limit } = {}) {
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  const part = dest + '.part';
  let start = 0;
  try { start = (await fsp.stat(part)).size; } catch { /* fresh */ }

  const res = await fetch(url, {
    headers: { 'User-Agent': 'Fabro', ...headers, ...(start ? { Range: `bytes=${start}-` } : {}) },
    signal, redirect: 'follow',
  });
  if (res.status === 416) { await fsp.rename(part, dest); return dest; } // already complete
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${path.basename(dest)}`);
  if (start && res.status !== 206) start = 0; // server ignored Range

  const total = start + Number(res.headers.get('content-length') || 0);
  const out = fs.createWriteStream(part, { flags: start ? 'a' : 'w' });
  let received = start, last = 0;
  let winStart = Date.now(), winBytes = 0;
  const reader = res.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!out.write(value)) await new Promise((r) => out.once('drain', r));
      received += value.length;
      // Optional speed limit (bytes/s, re-read each chunk so changes apply live).
      const cap = typeof limit === 'function' ? limit() : limit;
      if (cap > 0) {
        winBytes += value.length;
        const ahead = winBytes / cap * 1000 - (Date.now() - winStart);
        if (ahead > 5) await new Promise((r) => setTimeout(r, Math.min(ahead, 2000)));
        if (Date.now() - winStart > 3000) { winStart = Date.now(); winBytes = 0; }
      }
      const now = Date.now();
      if (onProgress && now - last > 200) { last = now; onProgress(received, total); }
    }
  } finally {
    await new Promise((r) => out.end(r));
  }
  onProgress && onProgress(received, total);
  await fsp.rename(part, dest);
  return dest;
}

module.exports = { downloadFile };

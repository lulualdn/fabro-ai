// Resumable streaming download with progress callbacks.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

async function downloadFile(url, dest, { onProgress, signal, headers = {} } = {}) {
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
  const reader = res.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!out.write(value)) await new Promise((r) => out.once('drain', r));
      received += value.length;
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

// Token estimates for the context manager. Same rule as chat.js used before (3.3 characters per token,
// pictures ~1000 tokens), plus a per-model correction learnt from what the server really counted.
const estTok = (x) => Array.isArray(x)
  ? x.reduce((n, p) => n + (p && p.type === 'image_url' ? 1000 : Math.ceil(String((p && p.text) || '').length / 3.3)), 0)
  : Math.ceil((typeof x === 'string' ? x : JSON.stringify(x == null ? '' : x)).length / 3.3);
const msgTok = (m) => estTok(m.content == null ? '' : m.content) + (m.tool_calls ? estTok(m.tool_calls) : 0) + 4;
const msgsTok = (msgs) => msgs.reduce((n, m) => n + msgTok(m), 0);

// Calibration: llama.cpp (and most APIs) report the real prompt size. ratio = real / estimated, smoothed,
// clamped so one odd answer can't make the policy panic.
const ratios = new Map();
function calibrate(key, estimated, real) {
  if (!key || !(estimated > 200) || !(real > 0)) return;
  const r = Math.min(1.6, Math.max(0.6, real / estimated));
  const prev = ratios.get(key);
  ratios.set(key, prev ? prev * 0.6 + r * 0.4 : r);
}
const ratio = (key) => ratios.get(key) || 1;

module.exports = { estTok, msgTok, msgsTok, calibrate, ratio, _ratios: ratios };

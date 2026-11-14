// External providers: an error is retried twice (15 s, then 30 s later) before the answer stops.
// When the provider says how long to wait (Retry-After header, "retry in 12s", retryDelay…), Fabro waits that long.
const BASE = [15, 30];
const MAX_WAIT = 120;
const NO_RETRY = new Set([400, 401, 403, 404, 413, 422]);

// seconds asked by the provider, or 0
function hint(e) {
  if (e && e.retryAfter > 0) return e.retryAfter;
  const txt = `${(e && e.message) || ''} ${(e && e.detail) || ''}`;
  let m = txt.match(/"retry_?(?:delay|after)"\s*:\s*"?(\d+(?:\.\d+)?)\s*(ms|s|m)?/i);
  if (!m) m = txt.match(/(?:retry|try again|wait)[^.\d]{0,24}?(?:in|after)\s+(?:(\d+)\s*m(?:in(?:ute)?s?)?\s*)?(\d+(?:\.\d+)?)\s*(ms|s|sec|second|m|min|minute)?/i);
  if (!m) return 0;
  if (m.length === 3) { const n = Number(m[1]); return m[2] === 'ms' ? n / 1000 : m[2] === 'm' ? n * 60 : n; }
  const n = Number(m[2]); const u = (m[3] || 's').toLowerCase();
  return (Number(m[1] || 0) * 60) + (u === 'ms' ? n / 1000 : u.startsWith('m') ? n * 60 : n);
}

function retryable(e) {
  if (!e || e.name === 'AbortError') return false;
  if (!['PROVIDER_RATE', 'PROVIDER_HTTP', 'PROVIDER_DOWN', 'NETWORK'].includes(e.code)) return false;
  return !NO_RETRY.has(e.status);
}

const sleep = (s, signal) => new Promise((res, rej) => {
  if (signal && signal.aborted) return rej(Object.assign(new Error('aborted'), { name: 'AbortError' }));
  const tm = setTimeout(res, s * 1000);
  if (signal) signal.addEventListener('abort', () => { clearTimeout(tm); rej(Object.assign(new Error('aborted'), { name: 'AbortError' })); }, { once: true });
});

// wraps complete(be, messages, params, signal, acc, tools)
function wrap(complete, { onRetry = () => {}, delays = BASE } = {}) {
  return async function retried(be, messages, params, signal, ...rest) {
    for (let i = 0; ; i++) {
      try { return await complete(be, messages, params, signal, ...rest); }
      catch (e) {
        if (i >= delays.length || !retryable(e) || (signal && signal.aborted)) throw e;
        const wait = Math.min(MAX_WAIT, Math.max(delays[i], Math.ceil(hint(e) + 1)));
        onRetry({ wait, n: i + 1, of: delays.length, code: e.code });
        await sleep(wait, signal);
        onRetry(null);
      }
    }
  };
}

module.exports = { wrap, hint, retryable };

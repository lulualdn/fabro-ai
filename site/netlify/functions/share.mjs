// Shared conversations and artifacts (fabro.ufstudios.eu/s/<id>), made from the Fabro app (src/main/share.js).
//   POST   /api/share                    { kind: 'conv'|'artifact', … } → { id, token }
//   GET    /api/share?id=…               → the snapshot (JSON)
//   GET    /api/share?id=…&raw=1         → an artifact's page, sandboxed (its own opaque origin: no access to the site)
//   DELETE /api/share?id=…  x-share-token → removed
// Only a salted hash of the token is stored. A few links per address and hour, to keep spam out.
import { getStore } from '@netlify/blobs';
import { createHash, randomBytes } from 'node:crypto';

const MAX = 2_600_000;
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' } });
const sha = (s) => createHash('sha256').update(s).digest('hex');
const ID = /^[A-Za-z0-9]{10}$/;
const str = (v, n) => String(v ?? '').slice(0, n);

function clean(b) {
  if (!b || (b.kind !== 'conv' && b.kind !== 'artifact')) return null;
  if (b.kind === 'artifact') return { kind: 'artifact', title: str(b.title, 160), type: str(b.type, 40), lang: str(b.lang, 40), content: str(b.content, 2_000_000), created: Number(b.created) || Date.now() };
  const messages = (Array.isArray(b.messages) ? b.messages : []).slice(0, 200).map((m) => ({
    role: m && m.role === 'assistant' ? 'assistant' : 'user', content: str(m && m.content, 60000), model: m && m.model ? str(m.model, 80) : undefined,
    files: (Array.isArray(m && m.files) ? m.files : []).slice(0, 20).map((x) => str(x, 120)),
    steps: (Array.isArray(m && m.steps) ? m.steps : []).slice(0, 60).map((x) => str(x, 60)),
    sources: (Array.isArray(m && m.sources) ? m.sources : []).slice(0, 20).filter((x) => x && /^https?:\/\//.test(x.url || '')).map((x) => ({ url: str(x.url, 500), title: str(x.title, 200) })),
    artifacts: (Array.isArray(m && m.artifacts) ? m.artifacts : []).slice(0, 10).map((x) => ({ title: str(x && x.title, 160), type: str(x && x.type, 40) })),
  }));
  return { kind: 'conv', title: str(b.title, 160), created: Number(b.created) || Date.now(), messages };
}

export default async (req, context) => {
  const store = getStore({ name: 'shares', consistency: 'strong' }); // a link just made must open at once
  const url = new URL(req.url);
  const id = url.searchParams.get('id') || '';
  const salt = Netlify.env.get('SHARE_SALT') || (context.site && context.site.id) || 'fabro';

  if (req.method === 'GET') {
    if (!ID.test(id)) return json({ error: 'not found' }, 404);
    const s = await store.get('s/' + id, { type: 'json' }); if (!s) return json({ error: 'not found' }, 404);
    if (url.searchParams.get('raw') === '1') {
      if (s.data.kind !== 'artifact') return json({ error: 'not an artifact' }, 400);
      // the artifact runs in a sandbox with an opaque origin: it can't read the site's storage or cookies
      return new Response(s.data.content, { headers: { 'content-type': /svg/.test(s.data.type) && !/^\s*<(!doctype|html)/i.test(s.data.content) ? 'image/svg+xml' : 'text/html; charset=utf-8', 'content-security-policy': "sandbox allow-scripts allow-popups; default-src * data: blob: 'unsafe-inline' 'unsafe-eval'", 'x-robots-tag': 'noindex', 'cache-control': 'public, max-age=300' } });
    }
    return json(s.data);
  }
  if (req.method === 'POST') {
    const len = Number(req.headers.get('content-length') || 0); if (len > MAX) return json({ error: 'too large' }, 413);
    let body = null; try { const t = await req.text(); if (t.length > MAX) return json({ error: 'too large' }, 413); body = JSON.parse(t); } catch { return json({ error: 'bad request' }, 400); }
    const data = clean(body); if (!data) return json({ error: 'bad request' }, 400);
    const who = sha(`${salt}|${context.ip || ''}`).slice(0, 24); const hour = Math.floor(Date.now() / 3600000);
    const rl = Number(await store.get(`rl/${who}/${hour}`)) || 0;
    if (rl >= 30) return json({ error: 'too many links this hour' }, 429);
    await store.set(`rl/${who}/${hour}`, String(rl + 1));
    let newId = ''; for (let i = 0; i < 5 && !newId; i++) { const c = randomBytes(8).toString('base64').replace(/[^A-Za-z0-9]/g, '').padEnd(10, 'x').slice(0, 10); if (!(await store.get('s/' + c))) newId = c; }
    const token = randomBytes(24).toString('base64url');
    await store.setJSON('s/' + newId, { data, tokenHash: sha(salt + token), at: Date.now() });
    return json({ id: newId, token });
  }
  if (req.method === 'DELETE') {
    if (!ID.test(id)) return json({ error: 'not found' }, 404);
    const s = await store.get('s/' + id, { type: 'json' }); if (!s) return json({ error: 'not found' }, 404);
    if (sha(salt + (req.headers.get('x-share-token') || '')) !== s.tokenHash) return json({ error: 'forbidden' }, 403);
    await store.delete('s/' + id); return json({ ok: true });
  }
  return json({ error: 'method' }, 405);
};

export const config = { path: '/api/share' };

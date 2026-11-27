// Votes for the roadmap (dev.html). One vote per person and item, as far as the web allows: the browser remembers
// it, and the server keeps a salted hash of the address (never the address itself). No account, no cookie.
// GET /api/vote → { counts: { id: n } } · POST /api/vote { id } → { counts, voted: true }
import { getStore } from '@netlify/blobs';
import { createHash } from 'node:crypto';
import roadmap from '../../data/roadmap.json';

const IDS = new Set(roadmap.map((r) => r.id));
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

export default async (req, context) => {
  const store = getStore({ name: 'votes', consistency: 'strong' });
  const counts = (await store.get('counts', { type: 'json' })) || {};
  if (req.method === 'GET') return json({ counts });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  let id = '';
  try { id = String((await req.json()).id || ''); } catch {}
  if (!IDS.has(id)) return json({ error: 'unknown item' }, 400);
  const salt = Netlify.env.get('VOTE_SALT') || (context.site && context.site.id) || 'fabro';
  const who = createHash('sha256').update(`${salt}|${context.ip || ''}|${id}`).digest('hex').slice(0, 32);
  if (await store.get('v/' + who)) return json({ counts, voted: true, again: true });
  await store.set('v/' + who, '1');
  counts[id] = (counts[id] || 0) + 1;
  await store.setJSON('counts', counts);
  return json({ counts, voted: true });
};

export const config = { path: '/api/vote' };

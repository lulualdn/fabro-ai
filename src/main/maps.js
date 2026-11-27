// Maps: places and routes the AI can show on an open-source map, with nothing to sign up for.
// - Map: MapLibre GL (renderer) + OpenFreeMap vector tiles (no key).
// - Search: Photon (komoot, OpenStreetMap data, no key). Routes: OSRM of FOSSGIS (routing.openstreetmap.de:
//   car, bike, foot, no key). Both are free public services: small, polite use (one request per user action).
// - Saved places: per account (paths.inData('places.json')): home, work, favourites, places the user marked.
// - Position: only when the user allows it (tool policy of my_location: ask / always / never). Sources, best first:
//   the system's location through the app window (Chromium geolocation), Windows location service, then an
//   approximate city from the IP address (said so to the AI and the user).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const UA = 'Fabro/1.0 (+https://fabro.ufstudios.eu)';
const PHOTON = 'https://photon.komoot.io';
const OSRM = { car: ['routed-car', 'driving'], bike: ['routed-bike', 'cycling'], foot: ['routed-foot', 'walking'] };
const get = async (url, ms = 12000) => {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error(`HTTP ${r.status} from ${new URL(url).host}`);
  return r.json();
};

// ───────────────────────────── search ─────────────────────────────
function labelOf(p) {
  const x = p.properties || {};
  const parts = [x.name, x.housenumber && x.street ? `${x.housenumber} ${x.street}` : x.street, x.postcode, x.city || x.town || x.village, x.state, x.country];
  return [...new Set(parts.filter(Boolean))].join(', ');
}
async function search(query, { near, limit = 6, lang } = {}) {
  const u = new URL(PHOTON + '/api/');
  u.searchParams.set('q', String(query).slice(0, 200)); u.searchParams.set('limit', String(Math.min(10, limit)));
  if (lang && ['en', 'de', 'fr'].includes(lang)) u.searchParams.set('lang', lang);
  if (near && isFinite(near.lat)) { u.searchParams.set('lat', near.lat); u.searchParams.set('lon', near.lon); }
  const j = await get(u);
  return (j.features || []).map((f) => ({ name: (f.properties || {}).name || labelOf(f).split(',')[0], label: labelOf(f), lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0],
    kind: [(f.properties || {}).osm_key, (f.properties || {}).osm_value].filter(Boolean).join(':') }));
}
async function reverse(lat, lon) {
  const j = await get(`${PHOTON}/reverse?lat=${lat}&lon=${lon}&limit=1`);
  const f = (j.features || [])[0]; return f ? labelOf(f) : '';
}

// ───────────────────────────── saved places ─────────────────────────────
const file = () => require('./paths').inData('places.json');
function list() { try { return JSON.parse(fs.readFileSync(file(), 'utf8')); } catch { return []; } }
function writeAll(l) { fs.mkdirSync(path.dirname(file()), { recursive: true }); fs.writeFileSync(file(), JSON.stringify(l, null, 1)); }
function save({ name, lat, lon, note = '', tag = '', label = '' }) {
  name = String(name || '').trim().slice(0, 60); if (!name || !isFinite(lat) || !isFinite(lon)) throw new Error('A place needs a name and coordinates.');
  const l = list(); const i = l.findIndex((p) => p.name.toLowerCase() === name.toLowerCase());
  const p = { id: i >= 0 ? l[i].id : crypto.randomBytes(5).toString('hex'), name, lat: +lat, lon: +lon, note: String(note).slice(0, 300), tag: ['home', 'work', 'fav', ''].includes(tag) ? tag : '', label: String(label).slice(0, 200), at: Date.now() };
  if (i >= 0) l[i] = p; else l.push(p);
  writeAll(l.slice(-200)); return p;
}
function remove(idOrName) { const l = list(); const k = String(idOrName).toLowerCase(); const n = l.filter((p) => p.id !== idOrName && p.name.toLowerCase() !== k); writeAll(n); return l.length - n.length; }
const findSaved = (name) => { const k = String(name || '').trim().toLowerCase(); const l = list(); return l.find((p) => p.name.toLowerCase() === k) || l.find((p) => p.tag && p.tag === k) || null; };

// ───────────────────────────── position ─────────────────────────────
let geoAllowed = false; // the window's geolocation permission is open only while Fabro asks for the position
const geoPermission = () => geoAllowed;
async function fromWindow() {
  const { BrowserWindow } = require('electron');
  const w = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed() && /index\.html/.test(x.webContents.getURL()));
  if (!w) return null;
  geoAllowed = true;
  try {
    return await w.webContents.executeJavaScript(`new Promise((ok) => { if (!navigator.geolocation) return ok(null); navigator.geolocation.getCurrentPosition((p) => ok({ lat: p.coords.latitude, lon: p.coords.longitude, accuracy: Math.round(p.coords.accuracy) }), () => ok(null), { timeout: 8000, maximumAge: 60000 }); })`, true);
  } catch { return null; } finally { geoAllowed = false; }
}
function fromWindows() {
  if (process.platform !== 'win32') return Promise.resolve(null);
  const ps = 'Add-Type -AssemblyName System.Device; $w = New-Object System.Device.Location.GeoCoordinateWatcher; $w.Start(); $t = 0; while (($w.Status -ne "Ready") -and ($t -lt 80)) { Start-Sleep -Milliseconds 100; $t++ }; $c = $w.Position.Location; if ($c.IsUnknown) { "" } else { "$($c.Latitude);$($c.Longitude);$($c.HorizontalAccuracy)" }';
  return new Promise((ok) => require('child_process').execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { timeout: 15000, windowsHide: true }, (e, out) => {
    const m = String(out || '').trim().split(';'); ok(!e && m.length === 3 && isFinite(+m[0]) ? { lat: +m[0].replace(',', '.'), lon: +m[1].replace(',', '.'), accuracy: Math.round(+m[2]) || null } : null);
  }));
}
async function fromIp() {
  try { const j = await get('https://ipwho.is/?fields=success,latitude,longitude,city,country', 8000); return j.success ? { lat: j.latitude, lon: j.longitude, accuracy: 15000, approx: true, label: [j.city, j.country].filter(Boolean).join(', ') } : null; } catch { return null; }
}
async function locate() {
  const p = (await fromWindow()) || (await fromWindows()) || (await fromIp());
  if (!p) throw new Error('No position available: location services are off and the approximate position failed.');
  if (!p.label) p.label = await reverse(p.lat, p.lon).catch(() => '');
  return p;
}

// ───────────────────────────── routes ─────────────────────────────
async function route(points, mode = 'car') {
  const [svc, prof] = OSRM[mode] || OSRM.car;
  const coords = points.map((p) => `${(+p.lon).toFixed(6)},${(+p.lat).toFixed(6)}`).join(';');
  const j = await get(`https://routing.openstreetmap.de/${svc}/route/v1/${prof}/${coords}?overview=full&geometries=geojson&steps=true`, 20000);
  if (j.code !== 'Ok' || !j.routes || !j.routes[0]) throw new Error(`No ${mode} route found (${j.code || 'no answer'}).`);
  const r = j.routes[0];
  const steps = r.legs.flatMap((l) => l.steps).filter((s) => s.maneuver && s.distance > 20).slice(0, 60).map((s) => ({ text: [s.maneuver.type, s.maneuver.modifier, s.name].filter(Boolean).join(' '), m: Math.round(s.distance) }));
  return { mode, distance: Math.round(r.distance), duration: Math.round(r.duration), line: r.geometry.coordinates.map(([x, y]) => [+x.toFixed(5), +y.toFixed(5)]), steps };
}

// a place given by the AI: "lat,lon", a saved place ("home", "Mamie"), "me", or a name to search
async function resolve(q, ctx = {}) {
  if (q && typeof q === 'object' && isFinite(q.lat)) return { name: q.name || '', lat: +q.lat, lon: +q.lon, note: q.note || '' };
  const s = String(q || '').trim();
  const m = s.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/); if (m) return { name: s, lat: +m[1], lon: +m[2] };
  if (/^(me|moi|my position|ma position|here|ici)$/i.test(s)) { if (!ctx.me) throw new Error('Use my_location first to get the user\'s position.'); return { name: 'You', ...ctx.me }; }
  const saved = findSaved(s); if (saved) return { name: saved.name, lat: saved.lat, lon: saved.lon, note: saved.note, saved: true };
  const r = await search(s, { limit: 1, near: ctx.me }); if (!r[0]) throw new Error(`Place not found: "${s}". Try a fuller address.`);
  return { name: r[0].name, label: r[0].label, lat: r[0].lat, lon: r[0].lon };
}
const fmtDist = (m) => (m >= 1000 ? `${(m / 1000).toFixed(m >= 10000 ? 0 : 1)} km` : `${m} m`);
const fmtDur = (s) => { const h = Math.floor(s / 3600), mn = Math.round((s % 3600) / 60); return h ? `${h} h ${String(mn).padStart(2, '0')}` : `${mn} min`; };

// ───────────────────────────── agent tools ─────────────────────────────
function registerTools() {
  const agent = require('./agent');
  const KW = ['map', 'carte', 'itinéraire', 'itineraire', 'route', 'trajet', 'directions', 'adresse', 'address', 'où est', 'where is', 'near', 'près', 'proche', 'lieu', 'place', 'km', 'aller à', 'go to', 'position', 'location'];
  agent.register({
    name: 'map_search', category: 'maps', risk: 'net', keywords: KW, noMcpWrap: true,
    description: 'Find places (addresses, shops, monuments, cities) on OpenStreetMap. Returns names, addresses and coordinates. Use "near" (a place or "lat,lon") to search around somewhere. Then map_show to put them on a map.',
    parameters: { type: 'object', properties: { query: { type: 'string' }, near: { type: 'string' }, limit: { type: 'number' } }, required: ['query'] },
    summarize: (a) => a.query,
    async run(a, ctx) {
      const near = a.near ? await resolve(a.near, ctx).catch(() => null) : ctx.me || null;
      const r = await search(a.query, { near, limit: a.limit || 6, lang: ctx.lang });
      return { content: r.length ? r.map((x, i) => `${i + 1}. ${x.name} — ${x.label} (${x.lat.toFixed(5)},${x.lon.toFixed(5)})`).join('\n') : 'Nothing found.', view: { kind: 'map_search', n: r.length } };
    },
  });
  agent.register({
    name: 'map_show', category: 'maps', risk: 'read', keywords: KW, noMcpWrap: true,
    description: 'Show places on an interactive map in the chat (the user can zoom, open it full screen and save places). Each place: {name, query} or {name, lat, lon}, optional note. Use for "where is…", lists of places, a trip with stops. The map appears above your answer: don\'t repeat coordinates in the text.',
    parameters: { type: 'object', properties: { title: { type: 'string' }, places: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, query: { type: 'string' }, lat: { type: 'number' }, lon: { type: 'number' }, note: { type: 'string' } } } } }, required: ['places'] },
    summarize: (a) => a.title || (a.places || []).map((p) => p.name).join(', '),
    async run(a, ctx) {
      const places = [];
      for (const p of (a.places || []).slice(0, 30)) { try { const r = await resolve(isFinite(p.lat) ? p : p.query || p.name, ctx); places.push({ ...r, name: p.name || r.name, note: p.note || r.note || '' }); } catch (e) { places.push({ name: p.name, error: e.message }); } }
      const ok = places.filter((p) => !p.error);
      if (!ok.length) throw new Error('None of these places could be found.');
      return { content: `Map shown with ${ok.length} place(s):\n${places.map((p) => p.error ? `- ${p.name}: ${p.error}` : `- ${p.name} (${p.lat.toFixed(5)},${p.lon.toFixed(5)})`).join('\n')}`, view: { kind: 'map', title: a.title || '', places: ok } };
    },
  });
  agent.register({
    name: 'map_route', category: 'maps', risk: 'net', keywords: KW, noMcpWrap: true,
    description: 'Compute a route (car, bike or foot) between places and show it on a map: distance, time, the main turns. from/to/via: a name or address, "lat,lon", a saved place ("home") or "me" (after my_location). The map appears above your answer: give the distance, time and useful advice, not the coordinates.',
    parameters: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' }, via: { type: 'array', items: { type: 'string' } }, mode: { type: 'string', enum: ['car', 'bike', 'foot'] } }, required: ['from', 'to'] },
    summarize: (a) => `${a.from} → ${a.to}${a.mode ? ' · ' + a.mode : ''}`,
    async run(a, ctx) {
      const pts = [];
      for (const q of [a.from, ...(a.via || []).slice(0, 8), a.to]) pts.push(await resolve(q, ctx));
      const r = await route(pts, a.mode || 'car');
      // the route stops at the nearest road or path: say so when that's far from the place asked for
      const end = r.line[r.line.length - 1]; const last = pts[pts.length - 1];
      const gap = Math.round(6371000 * Math.hypot((end[1] - last.lat) * Math.PI / 180, (end[0] - last.lon) * Math.PI / 180 * Math.cos(last.lat * Math.PI / 180)));
      const far = gap > 400 ? `\nNote: the ${r.mode} route ends ${fmtDist(gap)} from "${last.name}" (no road or path goes there; maybe a boat or another way is needed).` : '';
      return { content: `${r.mode} route ${pts.map((p) => p.name).join(' → ')}: ${fmtDist(r.distance)}, about ${fmtDur(r.duration)} (OSRM estimate, no live traffic).${far}\nMain steps: ${r.steps.slice(0, 15).map((s) => `${s.text} (${fmtDist(s.m)})`).join('; ')}`,
        view: { kind: 'map', title: `${pts[0].name} → ${pts[pts.length - 1].name}`, places: pts, route: { mode: r.mode, distance: r.distance, duration: r.duration, line: r.line } } };
    },
  });
  agent.register({
    name: 'places_saved', category: 'maps', risk: 'write', keywords: [...KW, 'maison', 'home', 'travail', 'work', 'favori', 'favorite', 'retiens', 'remember'], noMcpWrap: true,
    description: 'The user\'s saved places (home, work, favourites, places they marked on a map). action "list"; "save" with name and query or lat/lon (tag: home, work or fav; note optional); "remove" with name. Save only what the user asked to keep.',
    parameters: { type: 'object', properties: { action: { type: 'string', enum: ['list', 'save', 'remove'] }, name: { type: 'string' }, query: { type: 'string' }, lat: { type: 'number' }, lon: { type: 'number' }, tag: { type: 'string', enum: ['home', 'work', 'fav'] }, note: { type: 'string' } }, required: ['action'] },
    summarize: (a) => `${a.action}${a.name ? ' · ' + a.name : ''}`,
    async run(a, ctx) {
      if (a.action === 'list') { const l = list(); return { content: l.length ? l.map((p) => `- ${p.name}${p.tag ? ` [${p.tag}]` : ''}: ${p.label || ''} (${p.lat.toFixed(5)},${p.lon.toFixed(5)})${p.note ? ' — ' + p.note : ''}`).join('\n') : 'No saved place yet.', view: { kind: 'places', n: l.length } }; }
      if (a.action === 'remove') { const n = remove(a.name || ''); return { content: n ? 'Removed.' : 'No saved place with this name.' }; }
      const where = isFinite(a.lat) ? { lat: a.lat, lon: a.lon } : await resolve(a.query || a.name, ctx);
      const p = save({ name: a.name || where.name, lat: where.lat, lon: where.lon, note: a.note, tag: a.tag, label: where.label || await reverse(where.lat, where.lon).catch(() => '') });
      return { content: `Saved "${p.name}" (${p.lat.toFixed(5)},${p.lon.toFixed(5)}).`, view: { kind: 'map', title: p.name, places: [p] } };
    },
  });
  agent.register({
    name: 'my_location', category: 'maps', risk: 'danger', keywords: ['position', 'location', 'où je suis', 'where am i', 'near me', 'près de moi', 'autour de moi', 'around me', 'ici', 'here'], noMcpWrap: true,
    description: 'The user\'s current position (asks them first unless they allowed it). Then use "me" in map_route/map_search. Approximate (city level) when the system location is off: say so.',
    parameters: { type: 'object', properties: {} },
    summarize: () => '',
    async run(a, ctx) {
      const p = await locate(); ctx.me = { lat: p.lat, lon: p.lon };
      return { content: `${p.approx ? 'Approximate position (from the internet connection, city level)' : 'Position'}: ${p.label || ''} (${p.lat.toFixed(5)},${p.lon.toFixed(5)})${p.accuracy ? `, ±${p.accuracy >= 1000 ? Math.round(p.accuracy / 1000) + ' km' : p.accuracy + ' m'}` : ''}.`,
        view: { kind: 'map', title: p.approx ? 'Approximate position' : 'Your position', places: [{ name: 'You', lat: p.lat, lon: p.lon, me: true, accuracy: p.accuracy }] } };
    },
  });
}

function register(h) {
  h('maps:places', () => list());
  h('maps:save', (p) => save(p || {}));
  h('maps:remove', (id) => remove(id));
  h('maps:search', (q) => search(String(q || ''), { limit: 6 }));
  h('maps:reverse', (lat, lon) => reverse(+lat, +lon));
  h('maps:locate', () => locate()); // asked by a click of the user (full-screen map): that click is the consent
}

module.exports = { search, reverse, route, list, save, remove, resolve, locate, geoPermission, registerTools, register, _fmt: { fmtDist, fmtDur } };

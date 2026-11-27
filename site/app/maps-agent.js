'use strict';
// Map tools of Fabro Anywhere, run in the browser (same as the desktop's src/main/maps.js):
// Photon (search), OSRM of FOSSGIS (routes), saved places in this profile (FAHost.places), the position from the
// browser (the browser asks the user: that is the consent). agent.js merges these into its tools.
window.FAMapTools = (function () {
  const PHOTON = 'https://photon.komoot.io';
  const OSRM = { car: ['routed-car', 'driving'], bike: ['routed-bike', 'cycling'], foot: ['routed-foot', 'walking'] };
  const get = async (u, ms = 12000) => { const r = await fetch(u, { signal: AbortSignal.timeout(ms) }); if (!r.ok) throw new Error(`HTTP ${r.status} from ${new URL(u).host}`); return r.json(); };
  const labelOf = (f) => { const x = f.properties || {}; return [...new Set([x.name, x.housenumber && x.street ? `${x.housenumber} ${x.street}` : x.street, x.postcode, x.city || x.town || x.village, x.state, x.country].filter(Boolean))].join(', '); };
  async function search(q, { near, limit = 6 } = {}) {
    const u = new URL(PHOTON + '/api/'); u.searchParams.set('q', String(q).slice(0, 200)); u.searchParams.set('limit', String(Math.min(10, limit)));
    const lang = (document.documentElement.lang || 'en').slice(0, 2); if (['en', 'de', 'fr'].includes(lang)) u.searchParams.set('lang', lang);
    if (near && isFinite(near.lat)) { u.searchParams.set('lat', near.lat); u.searchParams.set('lon', near.lon); }
    const j = await get(u);
    return (j.features || []).map((f) => ({ name: (f.properties || {}).name || labelOf(f).split(',')[0], label: labelOf(f), lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0] }));
  }
  async function reverse(lat, lon) { const j = await get(`${PHOTON}/reverse?lat=${lat}&lon=${lon}&limit=1`); const f = (j.features || [])[0]; return f ? labelOf(f) : ''; }
  async function route(points, mode = 'car') {
    const [svc, prof] = OSRM[mode] || OSRM.car;
    const j = await get(`https://routing.openstreetmap.de/${svc}/route/v1/${prof}/${points.map((p) => `${(+p.lon).toFixed(6)},${(+p.lat).toFixed(6)}`).join(';')}?overview=full&geometries=geojson&steps=true`, 20000);
    if (j.code !== 'Ok' || !j.routes || !j.routes[0]) throw new Error(`No ${mode} route found.`);
    const r = j.routes[0];
    return { mode, distance: Math.round(r.distance), duration: Math.round(r.duration), line: r.geometry.coordinates.map(([x, y]) => [+x.toFixed(5), +y.toFixed(5)]),
      steps: r.legs.flatMap((l) => l.steps).filter((s) => s.distance > 20).slice(0, 40).map((s) => ({ text: [s.maneuver.type, s.maneuver.modifier, s.name].filter(Boolean).join(' '), m: Math.round(s.distance) })) };
  }
  let me = null;
  function locate() {
    return new Promise((ok, ko) => {
      if (!navigator.geolocation) return ko(new Error('This browser gives no position.'));
      navigator.geolocation.getCurrentPosition((p) => { me = { lat: p.coords.latitude, lon: p.coords.longitude, accuracy: Math.round(p.coords.accuracy) }; ok(me); },
        (e) => ko(new Error(e.code === 1 ? 'The user did not allow the position.' : 'Position unavailable.')), { timeout: 12000, maximumAge: 60000, enableHighAccuracy: true });
    });
  }
  const places = () => (window.FAHost && FAHost.places) || { list: async () => [], save: async () => { throw new Error('no storage'); }, remove: async () => 0 };
  async function resolve(q) {
    if (q && typeof q === 'object' && isFinite(q.lat)) return { name: q.name || '', lat: +q.lat, lon: +q.lon, note: q.note || '' };
    const s = String(q || '').trim();
    const m = s.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/); if (m) return { name: s, lat: +m[1], lon: +m[2] };
    if (/^(me|moi|my position|ma position|here|ici)$/i.test(s)) { if (!me) await locate(); return { name: 'You', ...me }; }
    const k = s.toLowerCase(); const l = await places().list(); const sv = l.find((p) => p.name.toLowerCase() === k) || l.find((p) => p.tag === k);
    if (sv) return { name: sv.name, lat: sv.lat, lon: sv.lon, note: sv.note };
    const r = await search(s, { limit: 1, near: me }); if (!r[0]) throw new Error(`Place not found: "${s}".`);
    return r[0];
  }
  const fmtDist = (m) => (m >= 1000 ? `${(m / 1000).toFixed(m >= 10000 ? 0 : 1)} km` : `${m} m`);
  const fmtDur = (s) => { const h = Math.floor(s / 3600), mn = Math.round((s % 3600) / 60); return h ? `${h} h ${String(mn).padStart(2, '0')}` : `${mn} min`; };
  const fn = (name, description, properties, required = []) => ({ type: 'function', function: { name, description, parameters: { type: 'object', properties, required } } });

  const schemas = {
    map_search: fn('map_search', 'Find places (addresses, shops, monuments, cities) on OpenStreetMap: names, addresses, coordinates. "near": a place or "lat,lon". Then map_show.', { query: { type: 'string' }, near: { type: 'string' } }, ['query']),
    map_show: fn('map_show', 'Show places on an interactive map in the chat (the user can open it full screen and save places). Each place: {name, query} or {name, lat, lon}, optional note. The map appears above your answer: don\'t repeat coordinates.', { title: { type: 'string' }, places: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, query: { type: 'string' }, lat: { type: 'number' }, lon: { type: 'number' }, note: { type: 'string' } } } } }, ['places']),
    map_route: fn('map_route', 'Route by car, bike or foot between places, shown on a map: distance, time, main turns. from/to/via: a name, "lat,lon", a saved place ("home") or "me". The map appears above your answer.', { from: { type: 'string' }, to: { type: 'string' }, via: { type: 'array', items: { type: 'string' } }, mode: { type: 'string', enum: ['car', 'bike', 'foot'] } }, ['from', 'to']),
    places_saved: fn('places_saved', 'The user\'s saved places (home, work, favourites). action "list"; "save" (name + query or lat/lon, tag home/work/fav, note); "remove" (name). Save only what the user asked to keep.', { action: { type: 'string', enum: ['list', 'save', 'remove'] }, name: { type: 'string' }, query: { type: 'string' }, lat: { type: 'number' }, lon: { type: 'number' }, tag: { type: 'string', enum: ['home', 'work', 'fav'] }, note: { type: 'string' } }, ['action']),
    my_location: fn('my_location', 'The user\'s current position (their browser asks them). Then use "me" in map_route / map_search.', {}),
  };
  const run = {
    async map_search(a) { const near = a.near ? await resolve(a.near).catch(() => null) : me; const r = await search(a.query, { near }); return { result: r.length ? r.map((x, i) => `${i + 1}. ${x.name} — ${x.label} (${x.lat.toFixed(5)},${x.lon.toFixed(5)})`).join('\n') : 'Nothing found.' }; },
    async map_show(a) {
      const out = []; for (const p of (a.places || []).slice(0, 30)) { try { const r = await resolve(isFinite(p.lat) ? p : p.query || p.name); out.push({ ...r, name: p.name || r.name, note: p.note || '' }); } catch (e) { out.push({ name: p.name, error: e.message }); } }
      const ok = out.filter((p) => !p.error); if (!ok.length) throw new Error('None of these places could be found.');
      return { result: `Map shown with ${ok.length} place(s).${out.some((p) => p.error) ? ' Not found: ' + out.filter((p) => p.error).map((p) => p.name).join(', ') : ''}`, view: { kind: 'map', title: a.title || '', places: ok } };
    },
    async map_route(a) {
      const pts = []; for (const q of [a.from, ...(a.via || []).slice(0, 8), a.to]) pts.push(await resolve(q));
      const r = await route(pts, a.mode || 'car');
      return { result: `${r.mode} route ${pts.map((p) => p.name).join(' → ')}: ${fmtDist(r.distance)}, about ${fmtDur(r.duration)} (estimate, no live traffic). Main steps: ${r.steps.slice(0, 12).map((s) => `${s.text} (${fmtDist(s.m)})`).join('; ')}`,
        view: { kind: 'map', title: `${pts[0].name} → ${pts[pts.length - 1].name}`, places: pts, route: { mode: r.mode, distance: r.distance, duration: r.duration, line: r.line } } };
    },
    async places_saved(a) {
      const P = places();
      if (a.action === 'list') { const l = await P.list(); return { result: l.length ? l.map((p) => `- ${p.name}${p.tag ? ` [${p.tag}]` : ''} (${p.lat.toFixed(5)},${p.lon.toFixed(5)})${p.note ? ' — ' + p.note : ''}`).join('\n') : 'No saved place yet.' }; }
      if (a.action === 'remove') { const n = await P.remove(a.name || ''); return { result: n ? 'Removed.' : 'No saved place with this name.' }; }
      const w = isFinite(a.lat) ? { lat: a.lat, lon: a.lon } : await resolve(a.query || a.name);
      const p = await P.save({ name: a.name || w.name, lat: w.lat, lon: w.lon, note: a.note || '', tag: a.tag || 'fav', label: w.label || '' });
      return { result: `Saved "${p.name}".`, view: { kind: 'map', title: p.name, places: [p] } };
    },
    async my_location() {
      const p = await locate(); const label = await reverse(p.lat, p.lon).catch(() => '');
      return { result: `Position: ${label} (${p.lat.toFixed(5)},${p.lon.toFixed(5)}), ±${p.accuracy} m.`, view: { kind: 'map', title: label.split(',').slice(0, 2).join(',') || 'You', places: [{ name: 'You', lat: p.lat, lon: p.lon, me: true, accuracy: p.accuracy }] } };
    },
  };
  return { schemas, run, search, reverse, locate, NAMES: Object.keys(schemas) };
})();

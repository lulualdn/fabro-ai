'use strict';
// Maps in a chat, shared by the desktop app (src/renderer/v1/maps.js) and Fabro Anywhere (site/app/maps.js).
// A step whose view.kind is 'map' ({ title, places: [{name, lat, lon, note, me}], route: {mode, distance, duration, line} })
// becomes a card with an interactive MapLibre map (OpenFreeMap tiles, no key). "Full screen" opens a big map where
// the user marks places (click → name → saved) and sees their saved places and, if they ask, their position.
// The host gives: lib urls, texts, how to find a step's view, saved places (list/save/remove), reverse, search, locate.
window.FabroMapsView = function (host) {
  const T = {
    fr: { full: 'Plein écran', save: 'Enregistrer', saved: 'Enregistré', mark: 'Marquer ce lieu', name: 'Nom', note: 'Note (facultatif)', cancel: 'Annuler', mine: 'Mes lieux', none: 'Aucun lieu enregistré. Touche la carte pour en marquer un.', remove: 'Retirer', home: 'Maison', work: 'Travail', fav: 'Favori', you: 'Toi', locate: 'Ma position', locating: 'Recherche de ta position…', approx: 'Position approximative (ville)', noPos: 'Position indisponible.', car: 'voiture', bike: 'vélo', foot: 'à pied', close: 'Fermer', search: 'Chercher un lieu', loadErr: 'La carte n’a pas pu se charger (hors ligne ?).' },
    en: { full: 'Full screen', save: 'Save', saved: 'Saved', mark: 'Mark this place', name: 'Name', note: 'Note (optional)', cancel: 'Cancel', mine: 'My places', none: 'No saved place. Tap the map to mark one.', remove: 'Remove', home: 'Home', work: 'Work', fav: 'Favourite', you: 'You', locate: 'My position', locating: 'Finding your position…', approx: 'Approximate position (city)', noPos: 'Position unavailable.', car: 'car', bike: 'bike', foot: 'on foot', close: 'Close', search: 'Search a place', loadErr: 'The map could not load (offline?).' },
  };
  const t = (k) => (T[host.lang()] || T.en)[k];
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ICON = { plus: '<path d="M12 5v14M5 12h14"/>', x: '<path d="M6 6l12 12M18 6 6 18"/>' };
  const ic = (n) => `<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">${ICON[n]}</svg>`;
  let lib = null;
  const load = () => lib || (lib = import(new URL(host.libUrl, location.href).href).then((m) => {
    if (!document.querySelector('link[data-maplibre]')) { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = new URL(host.cssUrl, location.href).href; l.dataset.maplibre = '1'; document.head.appendChild(l); }
    const ml = m.default || m;
    try { (ml.setWorkerUrl || m.setWorkerUrl)(new URL(host.workerUrl, location.href).href); } catch (e) { console.error('maplibre worker', e); }
    return ml;
  }));
  const dark = () => document.documentElement.dataset.theme === 'dark';
  const styleUrl = () => `https://tiles.openfreemap.org/styles/${dark() ? 'dark' : 'positron'}`;
  const ACC = '#e8603c';
  const fmtDist = (m) => (m >= 1000 ? `${(m / 1000).toFixed(m >= 10000 ? 0 : 1)} km` : `${m} m`);
  const fmtDur = (s) => { const h = Math.floor(s / 3600), mn = Math.round((s % 3600) / 60); return h ? `${h} h ${String(mn).padStart(2, '0')}` : `${mn} min`; };

  function card(step) {
    const v = step.view; const r = v.route;
    const meta = r ? `<span class="mc-chip">${fmtDist(r.distance)}</span><span class="mc-chip">${fmtDur(r.duration)}</span><span class="mc-chip">${t(r.mode) || r.mode}</span>` : '';
    const list = (v.places || []).length > 1 || !r ? `<ol class="mc-list">${(v.places || []).map((p, i) => `<li><span class="mc-n">${p.me ? '•' : i + 1}</span><span class="grow">${esc(p.name)}${p.note ? `<small>${esc(p.note)}</small>` : ''}</span>${p.me ? '' : `<button class="ib mc-save" data-act="map-save" data-step="${esc(step.id)}" data-i="${i}" title="${t('save')}" aria-label="${t('save')}">${ic('plus')}</button>`}</li>`).join('')}</ol>` : '';
    return `<div class="mapcard"><div class="mc-head"><b>${esc(v.title || '')}</b>${meta}<span class="grow"></span><button class="btn ghost" data-act="map-full" data-step="${esc(step.id)}">${t('full')}</button></div><div class="mc-map" data-map-slot="${esc(step.id)}"></div>${list}</div>`;
  }
  const cards = (n) => (n.steps || []).filter((s) => s.view && s.view.kind === 'map' && s.status !== 'running').map(card).join('');

  function bounds(v) {
    const pts = [...(v.places || []).map((p) => [p.lon, p.lat]), ...((v.route && v.route.line) || [])];
    let a = [Infinity, Infinity], b = [-Infinity, -Infinity];
    for (const [x, y] of pts) { a = [Math.min(a[0], x), Math.min(a[1], y)]; b = [Math.max(b[0], x), Math.max(b[1], y)]; }
    return pts.length ? [a, b] : null;
  }
  function marker(ml, map, p, i, opts = {}) {
    const el = document.createElement('div'); el.className = 'mc-pin' + (p.me ? ' me' : '') + (opts.saved ? ' saved' : '');
    el.textContent = p.me || opts.saved ? '' : String(i + 1);
    const pop = new ml.Popup({ offset: 14, closeButton: false }).setHTML(`<b>${esc(p.name || '')}</b>${p.note ? `<br><small>${esc(p.note)}</small>` : ''}`);
    return new ml.Marker({ element: el }).setLngLat([p.lon, p.lat]).setPopup(pop).addTo(map);
  }
  function fit(map, v, full) {
    const b = bounds(v); if (!b) return;
    if (b[0][0] === b[1][0] && b[0][1] === b[1][1]) map.jumpTo({ center: b[0], zoom: v.places[0] && v.places[0].accuracy > 5000 ? 10 : 14 });
    else map.fitBounds(b, { padding: full ? 60 : { top: 30, left: 30, right: 30, bottom: 44 }, duration: 0, maxZoom: 15 });
  }
  async function makeMap(container, v, opts = {}) {
    const ml = await load();
    const map = new ml.Map({ container, style: styleUrl(), attributionControl: false, cooperativeGestures: !opts.full, dragRotate: false, pitchWithRotate: false, center: [2.35, 48.85], zoom: 4 });
    map.addControl(new ml.AttributionControl({ compact: true })); // the style carries OpenFreeMap / OpenMapTiles / OpenStreetMap credits
    if (opts.full) map.addControl(new ml.NavigationControl({ showCompass: false }), 'top-right');
    map.on('error', (e) => { if (!container.dataset.err && e && e.error && /fetch|network|Failed/i.test(String(e.error.message))) { container.dataset.err = '1'; const d = document.createElement('div'); d.className = 'mc-err'; d.textContent = t('loadErr'); container.appendChild(d); } });
    const addRoute = () => {
      if (!v.route || !v.route.line || map.getSource('route')) return;
      map.addSource('route', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: v.route.line } } });
      map.addLayer({ id: 'route-casing', type: 'line', source: 'route', paint: { 'line-color': dark() ? '#000' : '#fff', 'line-width': 8, 'line-opacity': 0.9 }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
      map.addLayer({ id: 'route', type: 'line', source: 'route', paint: { 'line-color': ACC, 'line-width': 4.5 }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
    };
    if (map.isStyleLoaded()) addRoute(); else map.once('load', addRoute);
    (v.places || []).forEach((p, i) => marker(ml, map, p, i));
    (opts.saved || []).forEach((p) => marker(ml, map, p, 0, { saved: true }));
    fit(map, v, opts.full);
    const refit = () => { map.resize(); fit(map, v, opts.full); }; // the container may get its size later
    map.once('load', refit); requestAnimationFrame(refit);
    try { new ResizeObserver(() => map.resize()).observe(container); } catch {}
    return { ml, map };
  }

  // maps survive re-renders: kept by step id and moved into the new placeholder
  const live = new Map();
  function mount() {
    for (const slot of document.querySelectorAll('[data-map-slot]')) {
      const id = slot.dataset.mapSlot; const have = live.get(id);
      if (have && have.el.parentNode === slot) continue;
      if (have) { slot.appendChild(have.el); if (have.map) { have.map.resize(); have.map.triggerRepaint(); } continue; }
      const v = host.viewOf(id); if (!v) continue;
      const el = document.createElement('div'); el.className = 'mc-canvas'; slot.appendChild(el);
      const rec = { el, map: null }; live.set(id, rec);
      makeMap(el, v).then(({ map }) => { rec.map = map; }).catch(() => { el.innerHTML = `<div class="mc-err">${esc(t('loadErr'))}</div>`; });
    }
    if (live.size > 24) for (const [k, r] of [...live.entries()]) { if (live.size <= 24) break; if (!r.el.isConnected) { try { r.map && r.map.remove(); } catch {} live.delete(k); } }
  }
  new MutationObserver(() => { if (document.querySelector('[data-map-slot]')) requestAnimationFrame(mount); }).observe(document.body, { childList: true, subtree: true });

  // full screen: its own layer above the app
  let full = null;
  function close() { if (!full) return; try { full.map.remove(); } catch {} full.root.remove(); full = null; }
  async function openFull(v) {
    close();
    const saved = await host.places.list().catch(() => []);
    const root = document.createElement('div'); root.className = 'mf-layer';
    root.innerHTML = `<div class="mf-back" data-act="map-close"></div><div class="mapfull" role="dialog" aria-modal="true"><div class="mf-head"><b>${esc((v && v.title) || t('mine'))}</b><span class="grow"></span><input class="in mf-q" placeholder="${t('search')}" enterkeyhint="search"><button class="btn" data-act="map-locate">${t('locate')}</button><button class="ib" data-act="map-close" aria-label="${t('close')}">${ic('x')}</button></div><div class="mf-body"><div class="mf-map"></div><aside class="mf-side"><h3>${t('mine')}</h3><div class="mf-list"></div></aside></div></div>`;
    document.body.appendChild(root);
    const { ml, map } = await makeMap(root.querySelector('.mf-map'), v || { places: [] }, { full: true, saved });
    full = { root, ml, map, saved, temp: null };
    if (!v || !(v.places || []).length) { const b = bounds({ places: saved }); if (b) map.fitBounds(b, { padding: 60, duration: 0, maxZoom: 13 }); }
    listSaved();
    map.on('click', (e) => markAt(e.lngLat.lat, e.lngLat.lng));
    root.querySelector('.mf-q').addEventListener('keydown', async (e) => {
      if (e.key !== 'Enter' || !e.target.value.trim()) return;
      const r = await host.search(e.target.value.trim()).catch(() => []);
      if (r[0] && full) { full.map.flyTo({ center: [r[0].lon, r[0].lat], zoom: 14 }); markAt(r[0].lat, r[0].lon, r[0].name); }
    });
  }
  function listSaved() {
    const box = full && full.root.querySelector('.mf-list'); if (!box) return;
    box.innerHTML = full.saved.length ? full.saved.map((p) => `<div class="opt mf-item" data-act="map-go" data-lat="${p.lat}" data-lon="${p.lon}"><span class="grow">${esc(p.name)}${p.tag ? ` <span class="mc-chip">${t(p.tag)}</span>` : ''}<small>${esc(p.label || p.note || '')}</small></span><button class="ib" data-act="map-del" data-id="${esc(p.id)}" aria-label="${t('remove')}">${ic('x')}</button></div>`).join('') : `<p class="mf-none">${t('none')}</p>`;
  }
  async function markAt(lat, lon, name = '') {
    if (!full) return;
    if (full.temp) full.temp.remove();
    const label = await host.reverse(lat, lon).catch(() => '');
    if (!full) return;
    const form = document.createElement('form'); form.className = 'mf-mark';
    form.innerHTML = `<b>${t('mark')}</b>${label ? `<small>${esc(label)}</small>` : ''}<input class="in" name="name" placeholder="${t('name')}" value="${esc(name || (label || '').split(',')[0])}" required><input class="in" name="note" placeholder="${t('note')}"><div class="seg">${['fav', 'home', 'work'].map((x, i) => `<label><input type="radio" name="tag" value="${x}" ${i ? '' : 'checked'}><span>${t(x)}</span></label>`).join('')}</div><div class="acts"><button type="button" class="btn ghost" data-mf-cancel>${t('cancel')}</button><button class="btn pri">${t('save')}</button></div>`;
    full.temp = new full.ml.Popup({ closeOnClick: false, maxWidth: '280px' }).setLngLat([lon, lat]).setDOMContent(form).addTo(full.map);
    form.querySelector('input[name=name]').focus();
    form.querySelector('[data-mf-cancel]').onclick = () => { full.temp.remove(); full.temp = null; };
    form.onsubmit = async (e) => {
      e.preventDefault(); const fd = new FormData(form);
      const p = await host.places.save({ name: fd.get('name'), note: fd.get('note'), tag: fd.get('tag'), lat, lon, label }).catch((x) => { host.toast(String(x.message || x), 'err'); return null; });
      if (!p || !full) return;
      full.temp.remove(); full.temp = null; full.saved = [...full.saved.filter((x) => x.id !== p.id), p]; marker(full.ml, full.map, p, 0, { saved: true }); listSaved(); host.toast(t('saved'));
    };
  }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && full) close(); });
  document.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-act^="map-"]'); if (!el) return;
    const a = el.dataset.act;
    if (a === 'map-close') return close();
    if (a === 'map-full') return openFull(host.viewOf(el.dataset.step));
    if (a === 'map-save') { const v = host.viewOf(el.dataset.step); const p = v && v.places[+el.dataset.i]; if (!p) return; await host.places.save({ name: p.name, lat: p.lat, lon: p.lon, note: p.note || '', tag: 'fav', label: p.label || '' }).then(() => host.toast(`${t('saved')} · ${p.name}`)).catch((x) => host.toast(String(x.message || x), 'err')); return; }
    if (!full) return;
    if (a === 'map-go') { if (e.target.closest('[data-act=map-del]')) return; full.map.flyTo({ center: [+el.dataset.lon, +el.dataset.lat], zoom: 15 }); return; }
    if (a === 'map-del') { await host.places.remove(el.dataset.id).catch(() => {}); full.saved = full.saved.filter((x) => x.id !== el.dataset.id); listSaved(); return; }
    if (a === 'map-locate') {
      host.toast(t('locating'));
      const p = await host.locate().catch(() => null);
      if (!p || !full) return host.toast(t('noPos'), 'err');
      if (p.approx) host.toast(t('approx'));
      marker(full.ml, full.map, { name: t('you'), lat: p.lat, lon: p.lon, me: true }, 0);
      full.map.flyTo({ center: [p.lon, p.lat], zoom: p.approx ? 11 : 15 });
    }
  });
  return { cards, mount, openFull, close };
};

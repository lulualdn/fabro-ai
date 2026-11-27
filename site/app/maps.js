'use strict';
// Maps in Fabro Anywhere: the shared view (maps-view.js, from src/shared) wired to this app.
// MapLibre is served from vendor/maplibre; saved places live in this profile (FAHost.places); the position comes
// from the browser, which asks the user.
window.FAMaps = (function () {
  const host = () => window.FAHost || {};
  const viewOf = (stepId) => {
    const c = host().curConv && host().curConv(); if (!c) return null;
    for (const n of FabroAnywhere.nodesOf(c)) for (const s of n.steps || []) if (s.id === stepId) return s.view;
    return null;
  };
  return FabroMapsView({
    lang: () => (host().lang ? host().lang() : 'en'),
    libUrl: 'vendor/maplibre/maplibre-gl.mjs',
    workerUrl: 'vendor/maplibre/maplibre-gl-worker.mjs',
    cssUrl: 'vendor/maplibre/maplibre-gl.css',
    viewOf,
    places: { list: () => host().places.list(), save: (p) => host().places.save(p), remove: (id) => host().places.remove(id) },
    search: (q) => FAMapTools.search(q),
    reverse: (lat, lon) => FAMapTools.reverse(lat, lon),
    locate: () => FAMapTools.locate(),
    toast: (m, k) => host().toast && host().toast(m, k),
  });
})();

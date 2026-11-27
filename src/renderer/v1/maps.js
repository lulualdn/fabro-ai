'use strict';
// Maps in the v1 chat: the shared view (src/shared/maps-view.js) wired to the desktop app.
// Saved places and position come from the main process (src/main/maps.js); MapLibre from node_modules.
window.V1Maps = (function () {
  const viewOf = (stepId) => {
    for (const m of (V1.S.conv && V1.S.conv.messages) || []) for (const s of m.steps || []) if (s.id === stepId) return s.view;
    return null;
  };
  return FabroMapsView({
    lang: () => V1.lang,
    libUrl: '../../../node_modules/maplibre-gl/dist/maplibre-gl.mjs',
    workerUrl: '../../../node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs',
    cssUrl: '../../../node_modules/maplibre-gl/dist/maplibre-gl.css',
    viewOf,
    places: { list: () => api.maps.places(), save: (p) => api.maps.save(p), remove: (id) => api.maps.remove(id) },
    search: (q) => api.maps.search(q),
    reverse: (lat, lon) => api.maps.reverse(lat, lon),
    locate: () => api.maps.locate(), // a click on "My position": that click is the consent
    toast: (m, k) => V1.toast(m, k),
  });
})();

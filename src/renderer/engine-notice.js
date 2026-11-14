'use strict';
/* Short notices from the engine, shown once each: a smaller model was loaded instead of one far too big for this
   computer, or a model bigger than the free memory runs from the disk (slow mode). */
(() => {
  let seen = 0;
  api.on('engine:status', (s) => {
    const n = s && s.notice;
    if (!n || !n.at || n.at <= seen) return;
    seen = n.at;
    if (n.kind === 'fallback') toast(t('eng_fallback', { from: n.from, to: n.to }));
    else if (n.kind === 'slow') toast(t('eng_slow', { model: n.model }));
  });
})();

'use strict';
/* Fabro Anywhere — the computer's full interface on the phone. When the paired computer offers it (hello.ui),
   its renderer is loaded (cached per version) into a sandboxed frame (full.html, opaque origin: no access to
   this app's storage or keys). The frame's api.* calls, file requests and events travel through this page over
   the existing encrypted session. The light phone app stays underneath for offline use. */
(function () {
  const H = () => window.FAHost;
  const $ = (s) => document.querySelector(s);
  let frame = null, booted = false, helloPending = false, bundle = null, info = null, wasOff = false;
  const queue = []; // events that arrived before the frame was ready

  const offline = () => !['relay', 'direct'].includes(H().conn.state);
  const enabled = () => !!(info && info.ui) && (H().settings.ui || 'full') !== 'lite';
  const post = (m) => { if (frame && frame.contentWindow) frame.contentWindow.postMessage(m, '*'); };

  // ── the interface files (cached per computer version) ──
  async function inflate(b64) {
    const bin = atob(b64); const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    const text = await new Response(new Blob([u8]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
    return JSON.parse(text);
  }
  async function loadBundle() {
    let cached = null; try { cached = await H().kv.get('ui-bundle'); } catch {}
    const r = await H().rpc('ui.bundle', { have: cached && cached.v, gz: typeof DecompressionStream === 'function' }, 180000);
    if (r.same && cached) return cached;
    const b = r.gz ? await inflate(r.gz) : r;
    try { await H().kv.set('ui-bundle', b); } catch {}
    return b;
  }

  // ── frame ──
  function strings() { const t = H().t; return { needsPc: t('needsPc'), onPc: t('onPc') }; }
  function sendBoot() { if (!bundle || !frame) { helloPending = true; return; } helloPending = false; post({ t: 'boot', bundle, info: { pcName: (info && info.pcName) || '', t: strings() } }); }
  async function mount() {
    document.body.classList.add('full-on', 'full-loading');
    if (!$('#full-load')) document.body.insertAdjacentHTML('beforeend', `<div id="full-load" class="full-load" role="status"><div class="full-spin"></div><span>${H().esc(H().t('loadingUi'))}</span></div>`);
    try { bundle = await loadBundle(); }
    catch (e) { document.body.classList.remove('full-on', 'full-loading'); $('#full-load') && $('#full-load').remove(); H().toast(e.message, 'err'); return; }
    if (!frame) {
      frame = document.createElement('iframe');
      frame.id = 'full'; frame.title = 'Fabro';
      frame.setAttribute('sandbox', 'allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-downloads');
      frame.setAttribute('allow', 'clipboard-write; microphone');
      frame.src = 'full.html';
      document.body.appendChild(frame);
    }
    if (helloPending) sendBoot();
  }
  function unmount() {
    if (frame) frame.remove(); frame = null; booted = false; queue.length = 0;
    document.body.classList.remove('full-on', 'full-loading', 'full-off');
    for (const id of ['full-load', 'full-offbar', 'full-fv']) $('#' + id) && $('#' + id).remove();
    H().rpc('ui.sub', { on: false }).catch(() => {});
  }
  function reload() { if (!frame) return; booted = false; queue.length = 0; document.body.classList.add('full-loading'); frame.src = 'full.html?' + Date.now(); }

  window.addEventListener('message', async (e) => {
    if (!frame || e.source !== frame.contentWindow) return;
    const m = e.data || {};
    const reply = (ok, r, er) => post({ t: 'res', id: m.id, ok, r, e: er });
    switch (m.t) {
      case 'hello': sendBoot(); break;
      case 'booted':
        booted = true; document.body.classList.remove('full-loading'); $('#full-load') && $('#full-load').remove();
        if (queue.length) { post({ t: 'ev', evs: queue.splice(0) }); }
        post({ t: 'conn', state: H().conn.state });
        break;
      case 'call':
        // computer away: no answer — the interface reloads from the computer when it's back (the bar says so)
        if (offline()) break;
        H().rpc('ui.call', { ch: m.ch, args: m.args }, 600000).then((r) => reply(true, r), (er) => { if (!offline()) reply(false, null, er.message); });
        break;
      case 'file': H().rpc('ui.file', { path: m.path }, 180000).then((r) => reply(true, r), (er) => reply(false, null, er.message)); break;
      case 'art': H().rpc('ui.art', { url: m.url }, 60000).then((r) => reply(true, r), (er) => reply(false, null, er.message)); break;
      case 'view': viewPcFile(m.path); break;
      case 'lite': H().settings.ui = 'lite'; await H().saveSettings(); unmount(); H().render(); break;
      case 'reload': reload(); break;
    }
  });

  // ── a computer file opened on the phone (instead of "open with" on the computer) ──
  async function viewPcFile(p) {
    const { esc, t, toast } = H();
    // the viewer opens at once (with a spinner) while the file comes from the computer
    $('#full-fv') && $('#full-fv').remove();
    const name = String(p).split(/[\\/]/).pop();
    const el = document.createElement('div'); el.id = 'full-fv'; el.className = 'full-fv'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', name);
    el.innerHTML = `<header><button class="icon-btn" data-fv="close" aria-label="${esc(t('close'))}">${H().ic('back')}</button><b>${esc(name)}</b><span class="icon-btn"></span></header><div class="fv-body"><div class="full-spin"></div></div>`;
    document.body.appendChild(el);
    let gone = false; el.querySelector('[data-fv=close]').onclick = () => { gone = true; el.remove(); };
    let f; try { f = await H().rpc('ui.file', { path: p }, 180000); } catch (e) { el.remove(); toast(e.message, 'err'); return; }
    if (gone) return;
    const bin = atob(f.data); const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    const blob = new Blob([u8], { type: f.mime }); const url = URL.createObjectURL(blob);
    let body;
    if (/^image\//.test(f.mime)) body = `<div class="fv-zoom"><img src="${url}" alt="${esc(f.name)}"></div>`;
    else if (/^video\//.test(f.mime)) body = `<video src="${url}" controls autoplay playsinline></video>`;
    else if (/^audio\//.test(f.mime)) body = `<audio src="${url}" controls autoplay></audio>`;
    else if (f.mime === 'application/pdf' || /^text\//.test(f.mime)) body = `<iframe src="${url}" title="${esc(f.name)}" sandbox=""></iframe>`;
    else body = `<p class="muted">${esc(t('noPreview'))}</p>`;
    el.innerHTML = `<header><button class="icon-btn" data-fv="close" aria-label="${esc(t('close'))}">${H().ic('back')}</button><b>${esc(f.name)}</b>
      <button class="icon-btn" data-fv="save" aria-label="${esc(t('saveFile'))}">${H().ic('download')}</button></header><div class="fv-body">${body}</div>`;
    el.querySelector('[data-fv=close]').onclick = () => { el.remove(); URL.revokeObjectURL(url); };
    el.querySelector('[data-fv=save]').onclick = async () => {
      const file = new File([blob], f.name, { type: f.mime });
      if (navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file] }); return; } catch {} }
      H().saveBlob({ name: f.name, blob });
    };
    const img = el.querySelector('.fv-zoom img'); if (img && window.FAZoom) window.FAZoom(img);
  }

  // ── connection ──
  function offBar(st) {
    const off = st === 'off' || st === 'connecting';
    document.body.classList.toggle('full-off', off && !!frame);
    let bar = $('#full-offbar');
    if (!off || !frame) { bar && bar.remove(); return; }
    const { esc, t } = H();
    const html = `<span class="dot"></span><span>${esc(st === 'connecting' ? t('connecting') : t('pcUnreachable'))}</span><button class="btn sm" data-fo="lite">${esc(t('useLite'))}</button>`;
    if (!bar) { bar = document.createElement('div'); bar.id = 'full-offbar'; bar.className = 'full-offbar'; bar.setAttribute('role', 'status'); document.body.appendChild(bar); }
    bar.innerHTML = html;
    bar.querySelector('[data-fo=lite]').onclick = async () => { H().settings.ui = 'lite'; await H().saveSettings(); unmount(); H().render(); };
  }

  window.FAFull = {
    get active() { return !!frame; },
    supported: () => !!(info && info.ui),
    async connected(hello) {
      info = hello;
      if (!enabled()) return;
      await H().rpc('ui.sub', { on: true }).catch(() => {});
      if (!frame) await mount();
      else if (wasOff) reload(); // calls made while away failed: start from the computer's current state
      wasOff = false;
    },
    events(evs) { if (!frame) return; if (!booted) { queue.push(...evs); if (queue.length > 3000) queue.splice(0, queue.length - 3000); return; } post({ t: 'ev', evs }); },
    conn(st) { if (st === 'off') wasOff = true; post({ t: 'conn', state: st }); offBar(st); },
    async open() { H().settings.ui = 'full'; await H().saveSettings(); if (info && info.ui) await this.connected(info); },
    close: unmount,
  };
})();

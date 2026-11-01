'use strict';
/* Fabro Anywhere — the computer's full interface on the phone. When the paired computer offers it (hello.ui),
   its renderer is loaded (cached per version) into a sandboxed frame (full.html, opaque origin: no access to
   this app's storage or keys). The frame's api.* calls, file requests and events travel through this page over
   the existing encrypted session. With no computer (away, or never paired) the very same interface runs on
   the phone (local-pc.js answers its calls: Fabro Cloud, conversations kept and synced later), from the last
   bundle the computer sent or the one published with the website. */
(function () {
  const H = () => window.FAHost;
  const $ = (s) => document.querySelector(s);
  let frame = null, booted = false, helloPending = false, bundle = null, info = null, wasOff = false, mode = null, swapT = 0;
  const queue = []; // events that arrived before the frame was ready

  const offline = () => !['relay', 'direct'].includes(H().conn.state);
  const enabled = () => (H().settings.ui || 'full') !== 'lite';
  const post = (m) => { if (frame && frame.contentWindow) frame.contentWindow.postMessage(m, '*'); };

  // ── the interface files (cached per computer version) ──
  async function inflate(b64) {
    const bin = atob(b64); const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    const text = await new Response(new Blob([u8]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
    return JSON.parse(text);
  }
  // without the computer: the last bundle it sent, else the one published with this website
  async function localBundle() {
    let cached = null; try { cached = await H().kv.get('ui-bundle'); } catch {}
    if (cached) return cached;
    const r = await fetch('ui-bundle.json'); if (!r.ok) throw new Error(H().t('loadFailed') || 'UI');
    const b = await r.json(); try { await H().kv.set('ui-bundle', b); } catch {}
    return b;
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
  function sendBoot() { if (!bundle || !frame) { helloPending = true; return; } helloPending = false; post({ t: 'boot', bundle, info: { pcName: (info && info.pcName) || '', local: mode === 'local', t: strings() } }); }
  // m: 'pc' (the computer answers) or 'local' (the phone does)
  async function mount(m) {
    mode = m; booted = false; queue.length = 0;
    document.body.classList.add('full-on', 'full-loading');
    window.FASplash && FASplash.show(H().t(m === 'local' ? 'loadingLocal' : 'loadingUi'));
    try { bundle = m === 'local' ? await localBundle() : await loadBundle(); }
    catch (e) {
      if (m === 'pc') { try { mode = 'local'; bundle = await localBundle(); } catch { bundle = null; } }
      if (!bundle) { document.body.classList.remove('full-on', 'full-loading'); window.FASplash && FASplash.hide(); H().toast(e.message, 'err'); mode = null; return; }
    }
    window.FALocal && FALocal.setBundle(bundle);
    if (frame) { frame.src = 'full.html?' + Date.now(); helloPending = true; return; }
    if (!frame) {
      frame = document.createElement('iframe');
      frame.id = 'full'; frame.title = 'Fabro';
      frame.setAttribute('sandbox', 'allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-downloads');
      frame.setAttribute('allow', 'clipboard-write; autoplay *; microphone *');
      frame.src = 'full.html';
      document.body.appendChild(frame);
    }
    if (helloPending) sendBoot();
  }
  function unmount() {
    micStopAll();
    if (frame) frame.remove(); frame = null; booted = false; queue.length = 0;
    document.body.classList.remove('full-on', 'full-loading', 'full-off');
    for (const id of ['full-load', 'full-offbar', 'full-fv']) $('#' + id) && $('#' + id).remove();
    if (mode === 'pc') H().rpc('ui.sub', { on: false }).catch(() => {});
    mode = null; window.FASplash && FASplash.hide();
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
        window.FASplash && FASplash.hide();
        if (queue.length) { post({ t: 'ev', evs: queue.splice(0) }); }
        post({ t: 'conn', state: mode === 'local' ? 'local' : H().conn.state });
        offBar();
        break;
      case 'call':
        // voice: always on the phone itself (Whisper + Piper here), even with the computer connected — no round trip
        if (mode === 'local' || /^voice:(stt|tts|sys|status|setVoice)$/.test(m.ch)) {
          // the phone answers: same encoding as the computer's answers ({ r, ops })
          FALocal.call(m.ch, decodeArgs(m.args)).then((r) => reply(true, { r: encodeVal(r), ops: [] }), (er) => reply(false, null, er.message));
          break;
        }
        if (offline()) break; // the computer just left: the phone takes over in a moment (swap below)
        H().rpc('ui.call', { ch: m.ch, args: m.args }, 600000).then((r) => { reply(true, r); FALocal.remember(m.ch, decodeArgs(m.args), decodeVal(r.r)); }, (er) => { if (!offline()) reply(false, null, er.message); });
        break;
      case 'file': if (mode === 'local') { reply(false, null, 'NEEDS_COMPUTER:file'); break; } H().rpc('ui.file', { path: m.path }, 180000).then((r) => reply(true, r), (er) => reply(false, null, er.message)); break;
      case 'art': if (mode === 'local') { reply(false, null, 'NEEDS_COMPUTER:art'); break; } H().rpc('ui.art', { url: m.url }, 60000).then((r) => reply(true, r), (er) => reply(false, null, er.message)); break;
      case 'view': viewPcFile(m.path); break;
      case 'mic': micStart(m.mid, m.rate).then(() => reply(true, { ok: 1 }), (er) => { reply(false, null, (er && er.name) || 'NotAllowedError'); H().micHelp && H().micHelp(er); }); break;
      case 'mic.off': micStop(m.mid); break;
      case 'lite':
        if (!H().link) { unmount(); H().showPair(); break; } // no computer yet: "pair a computer"
        H().settings.ui = 'lite'; await H().saveSettings(); unmount(); H().render(); break;
      case 'reload': reload(); break;
    }
  });

  // binary over JSON, as the computer does: { __u8: base64 }
  const b64 = (u8) => { let s2 = ''; for (let i = 0; i < u8.length; i += 0x8000) s2 += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s2); };
  const unb64 = (x) => { const b = atob(x); const u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; };
  function encodeVal(v, d = 0) { if (v == null || typeof v !== 'object' || d > 40) return v; if (v instanceof Uint8Array) return { __u8: b64(v) }; if (Array.isArray(v)) return v.map((x) => encodeVal(x, d + 1)); const o = {}; for (const k of Object.keys(v)) { if (v[k] !== undefined && typeof v[k] !== 'function') o[k] = encodeVal(v[k], d + 1); } return o; }
  function decodeVal(v, d = 0) { if (v == null || typeof v !== 'object' || d > 40) return v; if (typeof v.__u8 === 'string' && Object.keys(v).length === 1) return unb64(v.__u8); if (Array.isArray(v)) return v.map((x) => decodeVal(x, d + 1)); const o = {}; for (const k of Object.keys(v)) o[k] = decodeVal(v[k], d + 1); return o; }
  const decodeArgs = (a) => decodeVal(Array.isArray(a) ? a : []);
  // events from the phone's own "computer" (chat stream…)
  setTimeout(() => window.FALocal && FALocal.setEmit((ch, data) => { if (mode !== 'local') return; const ev = [ch, encodeVal(data)]; if (!booted) queue.push(ev); else post({ t: 'ev', evs: [ev] }); }));

  // ── microphone for the frame (it can't ask for one itself): captured here, streamed as PCM ──
  const caps = new Map();
  async function micStart(id, rate) {
    const ctx = new (window.AudioContext || window.webkitAudioContext)(); ctx.resume().catch(() => {});
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: true, channelCount: 1 } }); }
    catch (e) { try { ctx.close(); } catch {} throw e; }
    if (ctx.state !== 'running') await ctx.resume().catch(() => {});
    const src = ctx.createMediaStreamSource(stream);
    const proc = ctx.createScriptProcessor(2048, 1, 1);
    const mute = ctx.createGain(); mute.gain.value = 0;
    src.connect(proc); proc.connect(mute); mute.connect(ctx.destination);
    const k = ctx.sampleRate / (rate || ctx.sampleRate);
    proc.onaudioprocess = (e) => {
      const d = e.inputBuffer.getChannelData(0);
      let out = d;
      if (Math.abs(k - 1) > 1e-3) { const n = Math.floor(d.length / k); out = new Float32Array(n); for (let i = 0; i < n; i++) { const x = i * k, a = Math.floor(x), f = x - a; out[i] = d[a] * (1 - f) + (d[Math.min(d.length - 1, a + 1)] || 0) * f; } }
      else out = new Float32Array(d);
      if (frame && frame.contentWindow) frame.contentWindow.postMessage({ t: 'mic.data', mid: id, d: out.buffer }, '*', [out.buffer]);
    };
    caps.set(id, { stop() { try { proc.onaudioprocess = null; ctx.close(); } catch {} stream.getTracks().forEach((x) => x.stop()); } });
  }
  function micStop(id) { const c = caps.get(id); if (c) { c.stop(); caps.delete(id); } }
  function micStopAll() { for (const id of [...caps.keys()]) micStop(id); }
  document.addEventListener('visibilitychange', () => { if (document.hidden) { for (const id of caps.keys()) post({ t: 'mic.end', mid: id }); micStopAll(); } });

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
  // no status indicator: the line under the composer says when Fabro Cloud answers
  function offBar() { const bar = $('#full-offbar'); if (bar) bar.remove(); document.body.classList.remove('full-off'); }
  function swap(to) {
    clearTimeout(swapT);
    if (!enabled() || mode === to) return;
    // a short grace: a computer that blinks away for a second doesn't reload the interface twice
    swapT = setTimeout(() => { if (mode !== to) mount(to); }, to === 'local' ? 4000 : 300);
  }

  window.FAFull = {
    get active() { return !!frame; },
    get mode() { return mode; },
    supported: () => true,
    // at start: the computer's interface when it answers soon, else the phone's (same interface)
    async start() {
      if (!enabled() || frame) return;
      if (H().session) return; // connected() mounts it
      if (!H().link) { await mount('local'); return; }
      window.FASplash && FASplash.text(H().t('connectingPc', { n: (H().link && H().link.pcName) || 'PC' }));
      // wait while it's still connecting (12 s at most); the computer known away → the phone's at once
      const t0 = Date.now();
      const tick = () => {
        if (frame || H().session || !enabled()) return;
        const st = H().conn.state;
        if (st === 'off' || Date.now() - t0 > 12000) { mount('local'); return; }
        setTimeout(tick, 300);
      };
      setTimeout(tick, 600);
    },
    async connected(hello) {
      info = hello;
      if (!enabled()) return;
      await H().rpc('ui.sub', { on: true }).catch(() => {});
      if (mode === 'local') await FALocal.flush((ch, args) => H().rpc('ui.call', { ch, args }, 60000));
      if (!frame) await mount('pc');
      else if (mode !== 'pc') { H().toast(H().t('backOnPc', { n: hello.pcName || 'PC' })); mount('pc'); }
      else if (wasOff) reload(); // calls made while away failed: start from the computer's current state
      wasOff = false;
    },
    events(evs) { if (!frame || mode !== 'pc') return; if (!booted) { queue.push(...evs); if (queue.length > 3000) queue.splice(0, queue.length - 3000); return; } post({ t: 'ev', evs }); },
    conn(st) { if (st === 'off') { wasOff = true; if (frame && mode === 'pc') swap('local'); } else if (st === 'direct' || st === 'relay') clearTimeout(swapT); if (mode === 'pc') post({ t: 'conn', state: st }); offBar(); },
    async open() { H().settings.ui = 'full'; await H().saveSettings(); if (H().session && info) await this.connected(info); else await mount('local'); },
    close: unmount,
  };
})();

'use strict';
/* Fabro website: language, theme, download button, can-I-run calculator, live changelog. */
(function () {
  const REPO = 'lulualdn/fabro-ai';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch {} } };
  const LANGS = ['en', 'fr', 'es', 'de'];

  // ───────── language ─────────
  const pickLang = () => {
    const saved = store.get('fabro-lang'); if (LANGS.includes(saved)) return saved;
    for (const l of navigator.languages || [navigator.language || 'en']) { const b = String(l).slice(0, 2).toLowerCase(); if (LANGS.includes(b)) return b; }
    return 'en';
  };
  let lang = pickLang();
  const t = (k, v = {}) => String((I18N[lang] || I18N.en)[k] ?? I18N.en[k] ?? k).replace(/\{(\w+)\}/g, (_, x) => v[x] ?? '');
  window.t = t;
  function applyLang() {
    document.documentElement.lang = lang;
    for (const el of $$('[data-i]')) { const v = el.dataset.iv ? JSON.parse(el.dataset.iv) : {}; el.innerHTML = t(el.dataset.i, v); }
    for (const el of $$('[data-ia]')) for (const pair of el.dataset.ia.split(';')) { const [attr, key] = pair.split(':'); el.setAttribute(attr, t(key)); }
    const pk = document.documentElement.dataset.page;
    if (pk) { document.title = t(pk + '_title'); }
    const sel = $('#lang'); if (sel) sel.value = lang;
    document.dispatchEvent(new CustomEvent('langchange'));
  }
  $('#lang')?.addEventListener('change', (e) => { lang = e.target.value; store.set('fabro-lang', lang); applyLang(); });

  // ───────── theme ─────────
  $('#theme')?.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next; store.set('fabro-theme', next);
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', (e) => { if (!store.get('fabro-theme')) document.documentElement.dataset.theme = e.matches ? 'dark' : 'light'; });

  // ───────── header, menu, reveal ─────────
  const top = $('.top');
  const onScroll = () => top && top.classList.toggle('scrolled', scrollY > 8);
  addEventListener('scroll', onScroll, { passive: true }); onScroll();
  $('#menu')?.addEventListener('click', () => { const n = $('.nav'); const open = n.classList.toggle('open'); $('#menu').setAttribute('aria-expanded', open); });
  const io = 'IntersectionObserver' in window ? new IntersectionObserver((es) => { for (const e of es) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }, { rootMargin: '0px 0px -8% 0px' }) : null;
  for (const el of $$('.reveal, .shot-hero')) io ? io.observe(el) : el.classList.add('in');

  // ───────── releases ─────────
  let relPromise = null;
  const snapshot = () => window.RELEASES || [];
  function releases() {
    if (!relPromise) relPromise = fetch(`https://api.github.com/repos/${REPO}/releases?per_page=50`, { headers: { Accept: 'application/vnd.github+json' } })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status))))
      .then((list) => list.filter((r) => !r.draft).map((r) => ({ tag: r.tag_name, date: r.published_at, url: r.html_url, prerelease: r.prerelease, body: r.body || '',
        assets: (r.assets || []).map((a) => ({ name: a.name, size: a.size, url: a.browser_download_url })) })))
      .then((list) => ({ list, live: true }))
      .catch(() => ({ list: snapshot(), live: false }));
    return relPromise;
  }
  const fmtSize = (b) => (b >= 1e9 ? (b / 1e9).toFixed(1) + ' GB' : Math.round(b / 1e6) + ' MB');

  // ───────── download ─────────
  function detectOS() {
    const p = ((navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '').toLowerCase();
    const ua = navigator.userAgent.toLowerCase();
    if (/android|iphone|ipad|ipod/.test(ua) || (navigator.maxTouchPoints > 1 && /mac/.test(p))) return 'mobile';
    if (/win/.test(p) || /windows/.test(ua)) return 'win';
    if (/mac/.test(p) || /mac os/.test(ua)) return 'mac';
    if (/linux|x11|cros/.test(p + ua)) return 'linux';
    return 'win';
  }
  const PICK = {
    win: [/^Fabro-Installer\.exe$/i, /^Fabro-Setup-.*\.exe$/i],
    mac: [/\.dmg$/i, /mac\.zip$/i],
    linux: [/\.AppImage$/i],
  };
  const ICON = {
    win: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 5.1 10.4 4v7.2H3zm8.3-1.2L21 2.5v8.7h-9.7zM3 12.8h7.4V20L3 18.9zm8.3 0H21v8.7l-9.7-1.4z"/></svg>',
    mac: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M16.4 12.6c0-2.4 2-3.5 2-3.6-1.1-1.6-2.8-1.8-3.4-1.8-1.4-.2-2.8.8-3.5.8-.7 0-1.9-.8-3-.8-1.6 0-3 .9-3.8 2.3-1.6 2.8-.4 7 1.2 9.3.8 1.1 1.7 2.4 2.9 2.3 1.2 0 1.6-.7 3-.7s1.8.7 3 .7c1.3 0 2.1-1.1 2.8-2.3.9-1.3 1.3-2.6 1.3-2.6s-2.5-1-2.5-3.6zM14.1 5.6c.6-.8 1.1-1.8 1-2.9-.9 0-2.1.6-2.7 1.4-.6.7-1.1 1.8-1 2.8 1 .1 2.1-.5 2.7-1.3z"/></svg>',
    linux: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2c-2 0-3.3 1.7-3.3 4.2 0 1.4.3 2.3-.5 3.6C7 11.7 5.5 13.6 5.6 16c-.6.4-1.6.7-1.6 1.6 0 .9.8 1.2 1.4 1.6.6.4.8 1.3 1.9 1.5 1 .2 2-.4 2.8-.5.9-.1 2 .2 3.8.2s2.7-.3 3.6-.2c.8.1 1.8.7 2.8.5 1.1-.2 1.3-1.1 1.9-1.5.6-.4 1.4-.7 1.4-1.6 0-.9-1-1.2-1.6-1.6.1-2.4-1.4-4.3-2.6-6.2-.8-1.3-.5-2.2-.5-3.6C15.3 3.7 14 2 12 2zm-1.6 4.1c.4 0 .7.5.7 1.1s-.3 1.1-.7 1.1-.7-.5-.7-1.1.3-1.1.7-1.1zm3.2 0c.4 0 .7.5.7 1.1s-.3 1.1-.7 1.1-.7-.5-.7-1.1.3-1.1.7-1.1zM12 9.3c.9 0 2 .6 2 1 0 .5-1.2 1.1-2 1.1s-2-.6-2-1.1c0-.4 1.1-1 2-1z"/></svg>',
  };
  const NOTE = { win: 'dl_win_note', mac: 'dl_mac_note', linux: 'dl_linux_note' };
  const pickAsset = (rel, os) => { for (const re of PICK[os] || []) { const a = rel.assets.find((x) => re.test(x.name)); if (a) return a; } return null; };
  async function renderDownloads() {
    const os = detectOS();
    const { list } = await releases();
    const rel = list.find((r) => !r.prerelease && r.assets.length) || null;
    for (const box of $$('.dl')) {
      const btn = $('.dl-main', box), meta = $('.dl-meta', box), others = $('.dl-list', box);
      const target = os === 'mobile' ? null : os;
      const a = rel && target ? pickAsset(rel, target) : null;
      if (os === 'mobile') { btn.href = `https://github.com/${REPO}/releases/latest`; $('span', btn).textContent = t('dl_all'); meta.innerHTML = t('dl_mobile'); }
      else {
        btn.innerHTML = ICON[target] + `<span>${t('dl_for', { os: t('os_' + target) })}</span>`;
        btn.href = a ? a.url : `https://github.com/${REPO}/releases/latest`;
        meta.innerHTML = rel ? `${t('dl_meta', { v: rel.tag.replace(/^v/, ''), size: a ? fmtSize(a.size) : '' }).replace(/ · $/, '')}<span class="free">${t('dl_free')}</span>` : `<a href="https://github.com/${REPO}/releases">${t('dl_offline')}</a>`;
      }
      if (others) {
        const rows = [];
        for (const o of ['win', 'mac', 'linux']) {
          const x = rel && pickAsset(rel, o);
          rows.push(`<a href="${x ? x.url : `https://github.com/${REPO}/releases/latest`}">${ICON[o]}<span><b>${t('os_' + o)}${x ? ` · ${x.name.replace(/^Fabro-/, '')}` : ''}</b><small>${t(NOTE[o])}${x ? ' · ' + fmtSize(x.size) : ''}</small></span></a>`);
          if (o === 'win' && rel) { const full = rel.assets.find((y) => /^Fabro-Setup-.*\.exe$/i.test(y.name)); if (full) rows.push(`<a href="${full.url}">${ICON.win}<span><b>${t('dl_win_full')}</b><small>${full.name} · ${fmtSize(full.size)}</small></span></a>`); }
        }
        rows.push(`<a href="https://github.com/${REPO}/releases">${ICON.linux.replace(/<path[^>]*>/, '<path d="M4 5h16v2H4zm0 6h16v2H4zm0 6h16v2H4z"/>')}<span><b>${t('dl_all')}</b><small>GitHub Releases</small></span></a>`);
        others.innerHTML = rows.join('');
      }
    }
  }

  // ───────── changelog ─────────
  async function renderChangelog() {
    const box = $('#releases'); if (!box) return;
    const { list, live } = await releases();
    const notes = Object.fromEntries(snapshot().map((r) => [r.tag, r.body]));
    const fmtDate = (d) => new Date(d).toLocaleDateString(lang, { year: 'numeric', month: 'long', day: 'numeric' });
    const firstStable = list.find((r) => !r.prerelease);
    box.innerHTML = (live ? '' : `<p class="note">${t('cl_error')}</p>`) + list.map((r) => `
      <article class="rel ${r === firstStable ? 'latest' : ''}">
        <h2><a href="${r.url}">${esc(r.tag)}</a> <time datetime="${r.date}">${fmtDate(r.date)}</time>${r === firstStable ? ` <span class="tag">${t('cl_latest')}</span>` : ''}</h2>
        <div class="notes">${md(r.body || notes[r.tag] || '')}</div>
        ${r.assets.filter((a) => !/\.(blockmap|yml)$/.test(a.name)).length ? `<div class="assets" aria-label="${t('cl_downloads')}">${r.assets.filter((a) => !/\.(blockmap|yml)$/.test(a.name)).map((a) => `<a href="${a.url}">${esc(a.name)} · ${fmtSize(a.size)}</a>`).join('')}</div>` : ''}
      </article>`).join('');
  }

  // ───────── can I run it ─────────
  // Same rules as the installer and the app (src/main/models.js fitFor, src/main/system.js budgets).
  function specsFor(gpu, ramGB) {
    if (gpu.kind === 'apple') return { accel: 'metal', gpuBudgetGB: ramGB * 0.7, ramBudgetGB: 0 };
    if (gpu.kind === 'nvidia' && gpu.vram >= 2.5) return { accel: 'CUDA', gpuBudgetGB: gpu.vram * 0.92, ramBudgetGB: ramGB * 0.6 };
    if ((gpu.kind === 'amd' || gpu.kind === 'intel' || gpu.kind === 'other') && gpu.vram >= 2.5) return { accel: 'Vulkan', gpuBudgetGB: gpu.vram * 0.85, ramBudgetGB: ramGB * 0.6 };
    return { accel: 'cpu', gpuBudgetGB: 0, ramBudgetGB: ramGB * 0.6 };
  }
  function fitFor(m, sp) {
    const need = m.sizeGB * 1.12 + 0.8, g = sp.gpuBudgetGB, r = sp.ramBudgetGB;
    if (g && need <= g) return 'great';
    if (g && need <= g + r) return m.moe ? 'good' : 'ok';
    if (!g) { if (need > r) return null; if (!m.moe && m.sizeGB > 5.5) return null; return m.sizeGB <= 3.5 || m.moe ? 'good' : 'ok'; }
    return null;
  }
  const CHECK = '<svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M16.7 5.3a1 1 0 0 1 0 1.4l-8 8a1 1 0 0 1-1.4 0l-4-4a1 1 0 1 1 1.4-1.4L8 12.6l7.3-7.3a1 1 0 0 1 1.4 0z" clip-rule="evenodd"/></svg>';
  function renderCir() {
    const box = $('#cir-out'); if (!box) return;
    const gsel = $('#gpu'), rsel = $('#ram');
    const opt = gsel.selectedOptions[0];
    const gpu = { kind: opt.dataset.kind, vram: +opt.dataset.vram || 0 };
    const ram = +rsel.value;
    store.set('fabro-cir', JSON.stringify({ g: gsel.value, r: rsel.value }));
    const sp = specsFor(gpu, ram);
    const rank = { great: 3, good: 2, ok: 1 };
    const ok = window.CATALOG.map((m) => ({ ...m, fit: fitFor(m, sp) })).filter((m) => m.fit);
    const sorted = [...ok].sort((a, b) => rank[b.fit] - rank[a.fit] || b.sizeGB - a.sizeGB);
    const best = sorted.find((m) => m.fit === 'great' || m.fit === 'good') || sorted[0];
    const list = best ? [best, ...sorted.filter((m) => m !== best)].slice(0, 5) : [];
    const engine = sp.accel === 'cpu' ? t('cir_engine_cpu') : sp.accel === 'metal' ? t('cir_engine_metal') : t('cir_engine_gpu', { e: sp.accel });
    const tags = (s) => s.split('·').map((x) => x.trim()).filter(Boolean).map((x) => t('tag_' + x)).join(' · ');
    const imgVram = sp.accel === 'metal' ? ram * 0.6 : sp.accel === 'cpu' ? 0 : gpu.vram;
    box.innerHTML = `<div class="engine">${engine}</div>
      <h2 class="sr-only">${t('cir_result')}</h2>
      ${list.length ? `<div class="models">${list.map((m, i) => `<div class="model ${m === best ? 'best' : ''}" style="animation-delay:${i * 50}ms"><b>${m.name}${m === best ? `<span class="pick">${t('cir_best')}</span>` : ''}</b><span class="fit ${m.fit}">${t('fit_' + m.fit)}</span><small>${tags(m.tags)} · ${t('cir_size', { n: m.sizeGB })}</small></div>`).join('')}</div>` : `<p>${t('cir_none')}</p>`}
      <div class="extras"><h3>${t('cir_more_h')}</h3>
        <div>${CHECK}<span>${imgVram >= 6 ? t('cir_images_yes') : t('cir_images_cpu')}</span></div>
        <div>${CHECK}<span>${t('cir_voice')}</span></div></div>
      <p class="hint" style="margin-top:18px">${t('cir_note')}</p>`;
  }
  function setupCir() {
    const gsel = $('#gpu'); if (!gsel) return;
    let saved = null; try { saved = JSON.parse(store.get('fabro-cir') || 'null'); } catch {}
    if (saved) { if ([...gsel.options].some((o) => o.value === saved.g)) gsel.value = saved.g; $('#ram').value = saved.r; }
    else {
      // A sensible default from what the browser tells us.
      const mem = navigator.deviceMemory; const ua = navigator.userAgent;
      if (/Mac/.test(navigator.platform || '') ) gsel.value = 'apple';
      if (mem && mem >= 8) $('#ram').value = '16';
    }
    gsel.addEventListener('change', renderCir); $('#ram').addEventListener('change', renderCir);
    renderCir();
  }

  document.addEventListener('langchange', () => { renderDownloads(); renderChangelog(); renderCir(); });
  setupCir();
  applyLang();
})();

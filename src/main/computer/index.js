// Fabro Computer Use: the AI sees the screen and uses the mouse and keyboard like a person.
//
// Seeing: a screenshot with numbered boxes on everything that can be used (from the accessibility
// tree of the app: buttons, fields, menus, list items, links, text…), the list of those elements with
// their role, name, state and position, the windows, the focused field, and the text read on screen
// (OCR) for apps that don't describe themselves (games, canvases).
// Acting: smooth, human-like pointer paths, clicks, double/right clicks, press-and-hold, drags,
// scrolling, typing, shortcuts, held keys, relative mouse moves — alone or chained in one fluid batch.
// Every action returns the screen as it is afterwards, so the AI always checks what happened.
// Safety: asked once per conversation, Esc / moving the mouse hands control back at once, passwords and
// card numbers are never typed, sensitive clicks are confirmed, Fabro's own windows are off limits.
const { app, nativeImage, shell, clipboard } = require('electron');
const fs = require('fs');
const path = require('path');
const agent = require('../agent');
const store = require('../store');
const motion = require('./motion');
const keys = require('./keys');
const paint = require('./paint');
const overlay = require('./overlay');

const DEFAULTS = { enabled: true, confirm: true, hideFabro: true, speed: 'natural', ocr: 'auto', width: 1280, overlay: true, maxMarks: 80 };
const cs = () => ({ ...DEFAULTS, ...(store.getSettings().computer || {}) });
const lang = () => { const s = store.getSettings().language; const l = s && s !== 'auto' ? s : (app.getPreferredSystemLanguages()[0] || 'en'); return String(l).slice(0, 2); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const supported = () => process.platform === 'win32' || process.platform === 'linux' || process.platform === 'darwin';
const err = (msg, code) => Object.assign(new Error(msg), { code });

let getMain = () => null;
let backend = null, hello = null;
const S = { active: false, root: null, paused: null, minimized: false, look: null, n: 0, mon: null };

function init(o = {}) { if (o.getMain) getMain = o.getMain; }

async function be(ctx) {
  if (!supported()) throw err('Computer Use is not available on this system.', 'CU_UNAVAILABLE');
  if (!backend) backend = require(process.platform === 'win32' ? './win' : process.platform === 'darwin' ? './mac' : './linux').create({ onUser });
  if (backend.setCtx) backend.setCtx(ctx);
  if (!hello) hello = await backend.call('hello', {}, 60000);
  return backend;
}

// ───────────────────────────── session (one per agent turn) ─────────────────────────────
const rootOf = (ctx) => String((ctx && ctx.reqId) || 'local').split('/')[0];
function mainWin() { const w = getMain(); return w && !w.isDestroyed() ? w : null; }
async function getOutOfTheWay() {
  if (!cs().hideFabro) return;
  const w = mainWin();
  if (w && w.isVisible() && !w.isMinimized()) { S.minimized = true; w.minimize(); await wait(320); }
}
function showFabro() {
  const w = mainWin();
  if (w && (w.isMinimized() || !w.isVisible())) { w.restore(); w.show(); }
}
async function begin(ctx) {
  const root = rootOf(ctx);
  const b = await be(ctx);
  if (!S.active || S.root !== root) {
    S.active = true; S.root = root; S.paused = null; S.minimized = false;
    await b.call('watch', { on: true }).catch(() => {});
  }
  if (S.paused) throw pausedError();
  await getOutOfTheWay();
  return b;
}
function finish() {
  if (!S.active) return;
  S.active = false;
  if (backend) backend.call('watch', { on: false }).catch(() => {});
  overlay.hide();
  if (S.minimized) { S.minimized = false; showFabro(); }
}
// chat.js calls this when a turn ends (done, error or stopped)
function turnEnded(reqId) {
  if (!S.active || String(reqId || '').includes('/')) return;
  if (S.root === String(reqId)) finish();
}
// The user physically moved the mouse, clicked or pressed a key: they have control now.
function onUser(m) {
  if (!S.active || S.paused) return;
  S.paused = m.kind;
  overlay.paused();
  if (S.minimized) { S.minimized = false; showFabro(); }
  if (m.kind === 'esc' && S.root) { try { require('../chat').abort(S.root); } catch {} }
}
function pausedError() {
  const how = S.paused === 'esc' ? 'pressed Esc' : S.paused === 'keyboard' ? 'used the keyboard' : 'moved the mouse';
  return err(`Stopped: the user ${how} and took back control of the computer. Do not use the computer tools again in this turn. Tell the user in one sentence where you stopped; they can ask you to continue.`, 'USER_CONTROL');
}

// ───────────────────────────── seeing ─────────────────────────────
const shotsDir = () => { const d = path.join(app.getPath('userData'), 'computer', 'shots'); fs.mkdirSync(d, { recursive: true }); return d; };
const ROLE = { edit: 'text field', listitem: 'list item', menuitem: 'menu item', tabitem: 'tab', treeitem: 'tree item', dataitem: 'cell', checkbox: 'checkbox', radiobutton: 'radio', combobox: 'dropdown', splitbutton: 'split button', hyperlink: 'link', headeritem: 'column header', document: 'document', spinner: 'number box', slider: 'slider', image: 'image', text: 'text', button: 'button', progressbar: 'progress bar' };
const INTERACTIVE = new Set(['button', 'splitbutton', 'menuitem', 'hyperlink', 'checkbox', 'radiobutton', 'combobox', 'edit', 'listitem', 'treeitem', 'tabitem', 'dataitem', 'slider', 'spinner', 'headeritem']);
function kindOf(e) {
  const acts = e.acts || [];
  if (e.role === 'document') return acts.includes('edit') ? 'ui' : null;
  if (INTERACTIVE.has(e.role)) return 'ui';
  if (acts.includes('invoke') || acts.includes('edit') || e.checked) return 'ui';
  if ((e.role === 'text' || e.role === 'image') && e.name && e.name.trim()) return 'text';
  if (e.role === 'progressbar' && e.range != null) return 'text';
  return null;
}
const iou = (a, b) => {
  const x1 = Math.max(a[0], b[0]), y1 = Math.max(a[1], b[1]), x2 = Math.min(a[0] + a[2], b[0] + b[2]), y2 = Math.min(a[1] + a[3], b[1] + b[3]);
  const i = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  return i / (a[2] * a[3] + b[2] * b[3] - i || 1);
};
const clip = (r, m) => { const x = Math.max(r[0], m.x), y = Math.max(r[1], m.y), x2 = Math.min(r[0] + r[2], m.x + m.w), y2 = Math.min(r[1] + r[3], m.y + m.h); return x2 - x >= 3 && y2 - y >= 3 ? [x, y, x2 - x, y2 - y] : null; };
const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

// accessibility elements (+ OCR lines) → numbered marks in screenshot coordinates
function buildMarks(raw, mon, scale, ocrLines, max) {
  const kept = new Map(); // raw index → mark
  raw.forEach((e, i) => {
    if (!e.rect || e.offscreen) return;
    const k = kindOf(e); if (!k) return;
    const r = clip(e.rect, mon); if (!r) return;
    if (r[2] * r[3] > mon.w * mon.h * 0.85) return;
    kept.set(i, { ...e, kind: k, sr: r, i });
  });
  // a text inside a control names the control (unnamed buttons, list items…) and is not marked twice
  for (const [i, m] of kept) {
    if (m.kind !== 'text') continue;
    let p = raw[i].parent, hops = 0;
    while (p != null && p >= 0 && hops++ < 4) {
      const a = kept.get(p);
      if (a && a.kind === 'ui') {
        if (!norm(a.name)) a.name = m.name;
        if (!norm(a.name) || norm(a.name).includes(norm(m.name)) || norm(m.name).includes(norm(a.name))) { kept.delete(i); }
        break;
      }
      p = raw[p] ? raw[p].parent : -1;
    }
  }
  let list = [...kept.values()];
  // the same box twice (a button and its inner part): keep the most useful one
  list.sort((a, b) => (b.kind === 'ui') - (a.kind === 'ui') || !!norm(b.name) - !!norm(a.name) || a.depth - b.depth);
  const out = [];
  for (const m of list) { if (!out.some((o) => iou(o.sr, m.sr) > 0.86)) out.push(m); }
  // text read on screen where the app gave nothing
  for (const l of ocrLines || []) {
    const r = clip([mon.x + l.rect[0], mon.y + l.rect[1], l.rect[2], l.rect[3]], mon); if (!r || !norm(l.text)) continue;
    const dup = out.some((o) => iou(o.sr, r) > 0.25 || (o.sr[0] <= r[0] + 2 && o.sr[1] <= r[1] + 2 && o.sr[0] + o.sr[2] >= r[0] + r[2] - 2 && o.sr[1] + o.sr[3] >= r[1] + r[3] - 2 && norm(o.name) && norm(l.text).includes(norm(o.name).slice(0, 12))));
    if (!dup) out.push({ role: 'text', name: l.text, kind: 'text', ocr: true, sr: r, win: 'ocr', depth: 99 });
  }
  // too many: keep focused, named controls, then controls, then text
  const score = (m) => (m.focused ? 10 : 0) + (m.kind === 'ui' ? (norm(m.name) ? 4 : 2) : 1) + (m.win === 'taskbar' ? -1.5 : 0) + (m.ocr ? -0.3 : 0);
  let marks = out;
  if (marks.length > max) marks = [...marks].sort((a, b) => score(b) - score(a) || b.sr[2] * b.sr[3] - a.sr[2] * a.sr[3]).slice(0, max);
  // reading order, by rows
  const rowH = 14 / Math.max(scale, 0.1);
  marks.sort((a, b) => (a.win === 'taskbar') - (b.win === 'taskbar') || Math.round((a.sr[1] + a.sr[3] / 2) / rowH) - Math.round((b.sr[1] + b.sr[3] / 2) / rowH) || a.sr[0] - b.sr[0]);
  return marks.map((m, k) => {
    const ir = [Math.round((m.sr[0] - mon.x) * scale), Math.round((m.sr[1] - mon.y) * scale), Math.max(2, Math.round(m.sr[2] * scale)), Math.max(2, Math.round(m.sr[3] * scale))];
    return { ...m, id: k + 1, ir, cx: Math.round(ir[0] + ir[2] / 2), cy: Math.round(ir[1] + ir[3] / 2), sx: Math.round(m.sr[0] + m.sr[2] / 2), sy: Math.round(m.sr[1] + m.sr[3] / 2) };
  });
}

// cut by characters, never in the middle of an emoji (half a surrogate pair breaks the JSON sent to the model)
const q = (s, n = 70) => { const t = [...String(s || '').replace(/\s+/g, ' ').trim()]; return t.length > n ? t.slice(0, n - 1).join('') + '…' : t.join(''); };
function markLine(m) {
  const role = m.ocr ? 'text' : ROLE[m.role] || m.role;
  const bits = [`[${m.id}] ${role}`];
  if (norm(m.name)) bits.push(`"${q(m.name)}"`);
  if (m.value != null && m.value !== '' && norm(m.value) !== norm(m.name)) bits.push(`= "${q(m.value, 60)}"`);
  if (m.password) bits.push('(password field)');
  if (m.checked) bits.push(m.checked === 'on' ? '☑ checked' : m.checked === 'off' ? '☐ unchecked' : '◩ mixed');
  if (m.expanded != null) bits.push(m.expanded ? 'expanded' : 'collapsed');
  if (m.selected) bits.push('selected');
  if (m.range != null && m.role !== 'text') bits.push(`value ${m.range}`);
  if (m.focused) bits.push('← focused');
  if (m.enabled === false) bits.push('(disabled)');
  if (m.help && !norm(m.name)) bits.push(`hint "${q(m.help, 50)}"`);
  bits.push(`(${m.cx},${m.cy})`);
  return bits.join(' ');
}

// cheap picture signature: did the screen change after an action? (the pointer's own spot is ignored)
const SIG_W = 320, SIG_H = 180;
function signature(img) {
  try { const s = img.resize({ width: SIG_W, height: SIG_H, quality: 'good' }).toBitmap(); const g = new Uint8Array(SIG_W * SIG_H); for (let i = 0; i < g.length; i++) g[i] = (s[i * 4] + s[i * 4 + 1] + s[i * 4 + 2]) / 3; return g; } catch { return null; }
}
function changed(a, b, cursors = []) {
  if (!a || !b || a.length !== b.length) return null;
  let big = 0, n = 0;
  for (let y = 0; y < SIG_H; y++) for (let x = 0; x < SIG_W; x++) {
    if (cursors.some((c) => Math.abs(x - c[0]) <= 6 && y - c[1] >= -2 && y - c[1] <= 9)) continue;
    const i = y * SIG_W + x; n++;
    if (Math.abs(a[i] - b[i]) > 18) big++;
  }
  return { cells: big, share: big / (n || 1) };
}

const ownWindow = (w) => w.pid === process.pid || overlay.isOwn(w.hwnd);
async function listWindows() { return ((await backend.call('windows', {}, 15000)).windows || []).filter((w) => !ownWindow(w)); }
// a window named by the AI: exact title, part of the title, or the app's name
function findWindow(wins, query) {
  if (query == null || query === '') return null;
  if (typeof query === 'number' || /^\d+$/.test(String(query))) { const w = wins.find((x) => String(x.hwnd) === String(query)); if (w) return w; }
  const n = norm(query);
  return wins.find((x) => norm(x.title) === n) || wins.find((x) => norm(x.title).includes(n)) || wins.find((x) => norm(x.app) === n) || wins.find((x) => norm(x.app).includes(n)) || wins.find((x) => norm(x.app) && n.includes(norm(x.app))) || null;
}
const noWindow = (q, wins) => err(`No window matches "${q}". Open windows: ${wins.slice(0, 12).map((x) => `"${q2(x.title)}" (${x.app}${x.minimized ? ', minimized' : ''})`).join(', ') || 'none'}. Open the app with computer_open_app first.`, 'NO_WINDOW');
const q2 = (t) => q(t, 40);
// bring a window to the front (restored if minimized), and check it worked
async function focusWindow(w) {
  if (w.focused && !w.minimized) return w;
  await backend.call('window', { hwnd: w.hwnd, action: 'focus' }, 8000).catch(() => {});
  await wait(350);
  const again = (await listWindows()).find((x) => String(x.hwnd) === String(w.hwnd));
  return again || w;
}

async function look(o = {}, ctx) {
  const b = backend;
  if (o.wait_ms) await wait(Math.min(15000, o.wait_ms));
  const c = cs();
  let wins = await listWindows();
  // looking at one window: Fabro brings it to the front and the picture is that window only (sharper)
  let target = null;
  if (o.window != null && o.window !== '' || o.hwnd != null) {
    target = o.hwnd != null ? wins.find((w) => String(w.hwnd) === String(o.hwnd)) : findWindow(wins, o.window);
    if (!target && o.hwnd == null) throw noWindow(o.window, wins);
    if (target) { target = await focusWindow(target); wins = await listWindows(); target = wins.find((w) => String(w.hwnd) === String(target.hwnd)) || target; }
  }
  const fg = target || wins.find((w) => w.focused && !w.minimized) || null;
  const mons = hello.monitors && hello.monitors.length ? hello.monitors : [{ x: 0, y: 0, w: hello.virtual[2], h: hello.virtual[3], primary: true, scale: 1 }];
  const onMon = (r) => mons.findIndex((m) => r[0] + r[2] / 2 >= m.x && r[0] + r[2] / 2 < m.x + m.w && r[1] + r[3] / 2 >= m.y && r[1] + r[3] / 2 < m.y + m.h);
  let mi = o.display ? Math.max(0, Math.min(mons.length - 1, o.display - 1)) : fg ? onMon(fg.rect) : S.mon != null ? S.mon : -1;
  if (mi < 0 || mi >= mons.length) mi = Math.max(0, mons.findIndex((m) => m.primary));
  S.mon = mi;
  const screen = mons[mi];
  // the captured area: the whole screen, or the target window (inside its screen)
  let mon = screen;
  if (target && !target.minimized) {
    const r = target.rect;
    const x1 = Math.max(r[0], screen.x), y1 = Math.max(r[1], screen.y), x2 = Math.min(r[0] + r[2], screen.x + screen.w), y2 = Math.min(r[1] + r[3], screen.y + screen.h);
    if (x2 - x1 > 80 && y2 - y1 > 60) mon = { ...screen, x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  }
  if (c.overlay) await overlay.show(screen, lang()).catch(() => {});
  const seq = ++S.n;
  const shot = path.join(shotsDir(), `screen-${seq % 4}.png`);
  const readElements = () => b.call('elements', { hwnds: fg ? [fg.hwnd] : [], taskbar: process.platform !== 'linux' && !target, max: 1500, ms: 2200 }, 12000).catch((e) => ({ elements: [], error: e.message }));
  // one window: its open menus and pop-ups often spill outside it — read first, then widen the picture to them
  let elsP = null;
  if (target && mon !== screen) {
    const first = await readElements();
    elsP = Promise.resolve(first);
    const own = `w${target.hwnd}`;
    for (const e of first.elements || []) {
      if (e.depth !== 0 || !e.rect || !(e.win !== own && e.win !== 'taskbar' && e.win !== 'w' || e.role === 'menu')) continue;
      const r = e.rect;
      const x1 = Math.max(screen.x, Math.min(mon.x, r[0])), y1 = Math.max(screen.y, Math.min(mon.y, r[1]));
      const x2 = Math.min(screen.x + screen.w, Math.max(mon.x + mon.w, r[0] + r[2])), y2 = Math.min(screen.y + screen.h, Math.max(mon.y + mon.h, r[1] + r[3]));
      mon = { ...mon, x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
    }
  }
  const [cap] = await overlay.aside(() => Promise.all([b.call('capture', { x: mon.x, y: mon.y, w: mon.w, h: mon.h, path: shot, cursor: false }, 20000)]));
  if (!elsP) elsP = readElements();
  const focP = process.platform !== 'linux' ? b.call('focused', {}, 5000).catch(() => ({})) : Promise.resolve({});
  const img = nativeImage.createFromPath(shot);
  if (img.isEmpty()) throw err('The screenshot could not be read.', 'CU_CAPTURE');
  const W = Math.min(Math.max(640, +c.width || 1280), mon.w), scale = W / mon.w, H = Math.round(mon.h * scale);
  const raw = await elsP;
  const elements = raw.elements || [];
  const fgNamed = elements.filter((e) => e.win !== 'taskbar' && kindOf(e) && norm(e.name)).length;
  // text recognition: asked for, always on, or automatic when the app describes little of itself
  let ocrLines = null, ocrNote = '';
  const wantOcr = o.read_text === true || c.ocr === 'always' || (c.ocr !== 'off' && o.read_text !== false && fgNamed < 10);
  if (wantOcr) {
    try {
      // OCR coordinates come back in the picture's pixels / k: the picture is made exactly k × the screen
      // (Retina captures are already 2× the screen's points)
      const k = mon.w <= 1920 ? 2 : 1;
      let file = shot;
      const sz = img.getSize();
      if (sz.width !== mon.w * k || sz.height !== mon.h * k) { file = path.join(shotsDir(), `ocr-${seq % 2}.png`); fs.writeFileSync(file, img.resize({ width: mon.w * k, height: mon.h * k, quality: 'best' }).toPNG()); }
      ocrLines = (await b.ocr(file, k)).lines;
    } catch (e) { ocrNote = e.code === 'NO_OCR' || /tesseract|OCR language/i.test(e.message) ? e.message : `Text recognition failed: ${e.message}`; }
  }
  const marks = buildMarks(elements, mon, scale, ocrLines, +c.maxMarks || 80);
  const small = img.resize({ width: W, height: H, quality: 'best' });
  const src = 'data:image/jpeg;base64,' + small.toJPEG(90).toString('base64');
  // the screen is captured without the pointer (it hides what is under it, for OCR too) and the pointer
  // is drawn back on the picture the AI sees
  const curImg = cap.cursor && cap.cursor[0] >= mon.x && cap.cursor[0] < mon.x + mon.w && cap.cursor[1] >= mon.y && cap.cursor[1] < mon.y + mon.h ? [Math.round((cap.cursor[0] - mon.x) * scale), Math.round((cap.cursor[1] - mon.y) * scale)] : null;
  const painted = await paint.mark(src, o.marks === false ? [] : marks.map((m) => ({ id: m.id, r: m.ir, ocr: !!m.ocr })), { grid: !!o.grid, cursor: curImg });
  const sig = signature(img);
  const prev = S.look;
  const areaKey = `${mon.x},${mon.y},${mon.w},${mon.h}`;
  const L = { id: seq, at: Date.now(), mon, screen, mi, scale, W, H, marks: new Map(marks.map((m) => [m.id, m])), fg, wins, cursor: cap.cursor, sig, shot, areaKey, hwnd: target ? target.hwnd : null, window: target ? target.title : null };
  S.look = L;
  // ── the text the AI reads alongside the picture ──
  const toImg = (sx, sy) => [Math.round((sx - mon.x) * scale), Math.round((sy - mon.y) * scale)];
  const lines = [];
  lines.push(target ? `Window "${q(target.title, 60)}" (${target.app}) only — screenshot ${W}×${H} px. All coordinates are pixels of this screenshot.`
    : `Screen ${mi + 1}/${mons.length} — screenshot ${W}×${H} px${W !== mon.w ? ` (real screen ${mon.w}×${mon.h})` : ''}. All coordinates are pixels of this screenshot.`);
  if (cap.cursor) { const [cx, cy] = toImg(cap.cursor[0], cap.cursor[1]); lines.push(`Mouse pointer at (${cx},${cy}).`); }
  if (o.after && prev && prev.areaKey === areaKey) {
    const sc = (c, m) => (c ? [Math.round((c[0] - m.x) / m.w * SIG_W), Math.round((c[1] - m.y) / m.h * SIG_H)] : null);
    const d = changed(prev.sig, sig, [sc(prev.cursor, prev.mon), sc(cap.cursor, mon)].filter(Boolean));
    if (d) lines.push(d.cells === 0 ? 'Screen after the action: NOTHING CHANGED (the action may have missed, or the app is still working — wait and look again before repeating).' : `Screen after the action: changed (${d.share > 0.08 ? 'a lot' : d.share > 0.006 ? 'partly' : 'a little'}).`);
  }
  if (fg) {
    const r = fg.rect; const [x1, y1] = toImg(r[0], r[1]); const [x2, y2] = toImg(r[0] + r[2], r[1] + r[3]);
    lines.push(`Active window: "${q(fg.title, 90)}" — ${fg.app || 'app'}${fg.maximized ? ', maximized' : ''} [${x1},${y1} → ${x2},${y2}]`);
    if ((fg.elevated === 1 || fg.elevated === -1) && hello.elevated === false && process.platform === 'win32') lines.push('⚠ This window runs as administrator: Windows does not let Fabro click or type in it. Ask the user to do this part themselves (or to start Fabro as administrator).');
  } else lines.push('Active window: none (the desktop).');
  const others = wins.filter((w) => w !== fg).slice(0, 10);
  if (others.length) lines.push(`Other windows: ${others.map((w) => `"${q(w.title, 40)}" (${w.app}${w.minimized ? ', minimized' : ''}${onMon(w.rect) !== mi && !w.minimized ? `, screen ${onMon(w.rect) + 1}` : ''})`).join(' · ')}`);
  const foc = ((await focP) || {}).element;
  if (foc && (foc.name || foc.value) && foc.pid !== process.pid) lines.push(`Keyboard focus: ${ROLE[foc.role] || foc.role}${foc.name ? ` "${q(foc.name, 50)}"` : ''}${foc.password ? ' (password field)' : ''}${foc.value && !foc.password ? ` = "${q(foc.value, 50)}"` : ''}`);
  const groups = [['fg', marks.filter((m) => !m.ocr && m.win !== 'taskbar')], ['taskbar', marks.filter((m) => m.win === 'taskbar')], ['ocr', marks.filter((m) => m.ocr)]];
  for (const [g, ms] of groups) {
    if (!ms.length) continue;
    lines.push('');
    lines.push(g === 'fg' ? `Elements${fg ? ` of "${q(fg.title, 50)}"` : ''} (click them by [id]):` : g === 'taskbar' ? (process.platform === 'darwin' ? 'Menu bar and Dock:' : 'Taskbar:') : 'Text read on screen (OCR, may contain small errors):');
    for (const m of ms) lines.push(markLine(m));
  }
  if (!marks.some((m) => !m.ocr && m.win !== 'taskbar')) {
    lines.push('');
    lines.push(elements.length > 2 ? 'This app describes almost none of its controls.' : 'This app does not describe its controls (a game, a canvas, a custom-drawn app…).');
    lines.push('Find things in the screenshot (computer_zoom helps for details) and act with x/y coordinates.');
  }
  if (raw.truncated) lines.push('(This window is very large: only part of it was read.)');
  if (marks.length) lines.push('', `Next: act on one element by its id, e.g. computer_click {"element": ${(marks.find((m) => !m.ocr && m.win !== 'taskbar') || marks[0]).id}}${target ? '' : ', or look at one window: computer_look {"window": "<app name>"}'}.`);
  if (raw.error) lines.push(`(The app's elements could not be read: ${q(raw.error, 120)})`);
  if (ocrNote && wantOcr && (o.read_text || c.ocr === 'always' || !marks.length)) lines.push(`(${ocrNote})`);
  return { L, text: lines.join('\n'), image: painted.image, thumb: painted.thumb };
}

// ───────────────────────────── acting ─────────────────────────────
function requireLook() {
  if (!S.look) throw err('Call computer_look first to see the screen.', 'NO_LOOK');
  return S.look;
}
// a target given as an element id from the last look, or x/y in its screenshot
function target(a, L, p = '') {
  const id = a[p + 'element'];
  if (id != null && id !== '') {
    const m = L.marks.get(Number(String(id).replace(/[^\d]/g, '')));
    if (!m) throw err(`There is no element [${id}] in the last look (ids go from 1 to ${L.marks.size}). Call computer_look again to get fresh ids.`, 'BAD_TARGET');
    return { x: m.sx, y: m.sy, img: [m.cx, m.cy], mark: m, name: norm(m.name) ? q(m.name, 40) : `[${m.id}]`, label: `[${m.id}] ${m.ocr ? 'text' : ROLE[m.role] || m.role}${norm(m.name) ? ` "${q(m.name, 50)}"` : ''}` };
  }
  const x = a[p + 'x'], y = a[p + 'y'];
  if (x == null || y == null) throw err(`Give ${p ? 'the destination' : 'the target'}: "${p}element" (an [id] from the last look) or "${p}x" and "${p}y".`, 'BAD_TARGET');
  if (!(x >= 0 && y >= 0 && x <= L.W && y <= L.H)) throw err(`(${x},${y}) is outside the screenshot (${L.W}×${L.H}).`, 'BAD_TARGET');
  return { x: Math.round(L.mon.x + x / L.scale), y: Math.round(L.mon.y + y / L.scale), img: [Math.round(x), Math.round(y)], label: `(${Math.round(x)},${Math.round(y)})` };
}
const BUTTONS = new Set(['left', 'right', 'middle', 'x1', 'x2']);
const btn = (b) => { const v = String(b || 'left').toLowerCase(); if (!BUTTONS.has(v)) throw err(`Unknown mouse button "${b}" (left, right, middle).`, 'BAD_ARGS'); return v; };
const modsOf = (m) => (m ? (Array.isArray(m) ? m : String(m).split(/[\s+,]+/)).filter(Boolean).map((k) => { const x = keys.key(k); if (!x.mod) throw err(`"${k}" is not a modifier (ctrl, shift, alt, win).`, 'BAD_KEY'); return x; }) : []);

// Turns high-level actions into helper steps, following the pointer as it moves.
function compile(actions, L, start) {
  const sp = cs().speed;
  let cur = { x: start[0], y: start[1] };
  const steps = [], points = [], said = [];
  const moveTo = (t, slow = 1) => { steps.push(...motion.path(cur, t, { speed: sp, slow })); cur = { x: t.x, y: t.y }; };
  const last = () => steps[steps.length - 1];
  const pause = (ms) => { if (steps.length) last().ms = (last().ms || 0) + ms; else steps.push({ t: 'sleep', ms }); };
  for (const a of actions) {
    const p = motion.pauses(sp);
    const kind = String(a.action || a.type || '').toLowerCase();
    switch (kind) {
      case 'move': case 'hover': { const t = target(a, L); moveTo(t); pause(p.hover); said.push(`moved to ${t.label}`); break; }
      case 'click': case 'double_click': case 'triple_click': case 'right_click': case 'middle_click': {
        const t = (a.element != null || a.x != null) ? target(a, L) : { x: cur.x, y: cur.y, label: 'where the pointer is', img: null };
        const b = kind === 'right_click' ? 'right' : kind === 'middle_click' ? 'middle' : btn(a.button);
        const n = kind === 'double_click' ? 2 : kind === 'triple_click' ? 3 : Math.max(1, Math.min(3, a.clicks || 1));
        const mods = modsOf(a.modifiers);
        moveTo(t); pause(p.hover);
        for (const m of mods) steps.push(keys.down(m, Math.max(p.key, 50))); // apps read the modifier state: let it land first
        for (let i = 0; i < n; i++) { steps.push({ t: 'down', b, ms: a.hold_ms ? Math.min(10000, a.hold_ms) : p.press }); steps.push({ t: 'up', b, ms: i < n - 1 ? p.between : 25 }); }
        for (const m of [...mods].reverse()) steps.push(keys.up(m, p.key));
        points.push({ x: t.x, y: t.y, right: b === 'right', img: t.img, at: steps.length, name: t.name });
        said.push(`${n === 2 ? 'double-' : n === 3 ? 'triple-' : ''}${b !== 'left' ? b + '-' : ''}clicked ${t.label}${mods.length ? ` holding ${mods.map((m) => m.name).join('+')}` : ''}${a.hold_ms ? ` (held ${a.hold_ms} ms)` : ''}`);
        break;
      }
      case 'mouse_down': case 'press': {
        if (a.element != null || a.x != null) { const t = target(a, L); moveTo(t); pause(p.hover); }
        steps.push({ t: 'down', b: btn(a.button), ms: p.press }); said.push(`pressed the ${btn(a.button)} button`); break;
      }
      case 'mouse_up': case 'release': {
        if (a.element != null || a.x != null) { const t = target(a, L); moveTo(t, 1.4); pause(p.dragEnd); }
        steps.push({ t: 'up', b: btn(a.button), ms: 30 }); said.push(`released the ${btn(a.button)} button`); break;
      }
      case 'drag': {
        const from = (a.element != null || a.x != null) ? target(a, L) : { x: cur.x, y: cur.y, label: 'the pointer', img: null };
        const to = target(a, L, 'to_');
        const b = btn(a.button); const mods = modsOf(a.modifiers);
        moveTo(from); pause(p.hover);
        for (const m of mods) steps.push(keys.down(m, Math.max(p.key, 50))); // apps read the modifier state: let it land first
        steps.push({ t: 'down', b, ms: p.dragStart });
        // a first small move: many apps only start a drag past a few pixels
        const d = Math.hypot(to.x - from.x, to.y - from.y) || 1;
        moveTo({ x: Math.round(from.x + (to.x - from.x) / d * 5), y: Math.round(from.y + (to.y - from.y) / d * 5) }, 0.3); pause(40);
        moveTo(to, a.slow ? 2.2 : 1.6); pause(p.dragEnd + Math.min(10000, a.hold_ms || 0));
        steps.push({ t: 'up', b, ms: 40 });
        for (const m of [...mods].reverse()) steps.push(keys.up(m, p.key));
        points.push({ x: to.x, y: to.y, img: to.img, at: steps.length, name: to.name, from: from.name });
        said.push(`dragged ${from.label} → ${to.label}${mods.length ? ` holding ${mods.map((m) => m.name).join('+')}` : ''}`);
        break;
      }
      case 'scroll': {
        if (a.element != null || a.x != null) { const t = target(a, L); moveTo(t); pause(p.hover); }
        const dir = String(a.direction || 'down').toLowerCase();
        if (!['up', 'down', 'left', 'right'].includes(dir)) throw err('direction must be up, down, left or right', 'BAD_ARGS');
        const n = Math.max(1, Math.min(40, Math.round(a.amount || 3)));
        const mods = modsOf(a.modifiers);
        for (const m of mods) steps.push(keys.down(m, Math.max(p.key, 50))); // apps read the modifier state: let it land first
        for (let i = 0; i < n; i++) steps.push({ t: 'wheel', d: dir === 'up' || dir === 'right' ? 120 : -120, h: dir === 'left' || dir === 'right', ms: sp === 'instant' ? 12 : 38 });
        for (const m of [...mods].reverse()) steps.push(keys.up(m, p.key));
        said.push(`scrolled ${dir} ×${n}`); break;
      }
      case 'type': {
        if (a.element != null || a.x != null) {
          const t = target(a, L); moveTo(t); pause(p.hover);
          steps.push({ t: 'down', b: 'left', ms: p.press }); steps.push({ t: 'up', b: 'left', ms: 120 });
          points.push({ x: t.x, y: t.y, img: t.img, at: steps.length });
        }
        if (a.clear) { const c = keys.combo('cmd+a'); /* cmd on the Mac, ctrl elsewhere */ steps.push(keys.down(c.mods[0], 10), keys.down(c.key, 25), keys.up(c.key, 10), keys.up(c.mods[0], 40)); const del = keys.key('delete'); steps.push(keys.down(del, 20), keys.up(del, 40)); }
        const text = String(a.text ?? '');
        steps.push({ t: 'text', s: text, ms: text.length > 300 ? 0 : p.char });
        if (a.enter || a.submit) { const e = keys.key('enter'); steps.push(keys.down(e, 30), keys.up(e, 30)); }
        said.push(`typed ${text.length > 60 ? `${text.length} characters` : JSON.stringify(text)}${a.element != null ? ` into [${a.element}]` : ''}${a.enter || a.submit ? ' then Enter' : ''}`);
        break;
      }
      case 'key': case 'keys': case 'shortcut': {
        const seqs = keys.sequence(a.keys || a.key);
        const rep = Math.max(1, Math.min(50, a.repeat || 1));
        for (let r = 0; r < rep; r++) for (const c of seqs) {
          if (keys.isBlocked(c)) throw err(`${c.label} is not allowed (it would lock or leave the session).`, 'BLOCKED_KEY');
          for (const m of c.mods) steps.push(keys.down(m, p.key));
          steps.push(keys.down(c.key, a.hold_ms ? Math.min(15000, a.hold_ms) : p.key + 20));
          steps.push(keys.up(c.key, p.key));
          for (const m of [...c.mods].reverse()) steps.push(keys.up(m, p.key));
          pause(sp === 'instant' ? 15 : 55);
        }
        said.push(`pressed ${seqs.map((c) => c.label).join(' ')}${rep > 1 ? ` ×${rep}` : ''}${a.hold_ms ? ` (held ${a.hold_ms} ms)` : ''}`);
        break;
      }
      case 'key_down': case 'hold_key': { for (const c of keys.sequence(a.keys || a.key)) { if (keys.isBlocked(c)) throw err(`${c.label} is not allowed.`, 'BLOCKED_KEY'); for (const k of [...c.mods, c.key]) steps.push(keys.down(k, p.key)); } said.push(`holding ${a.keys || a.key} down`); break; }
      case 'key_up': case 'release_key': { for (const c of keys.sequence(a.keys || a.key)) for (const k of [c.key, ...[...c.mods].reverse()]) steps.push(keys.up(k, p.key)); said.push(`released ${a.keys || a.key}`); break; }
      case 'move_relative': case 'look_around': {
        // relative mouse motion (game cameras, 3D views): spread over time so it is smooth
        const dx = Math.round(a.dx || 0), dy = Math.round(a.dy || 0);
        const n = Math.max(1, Math.min(120, Math.round((a.duration_ms || 300) / 10)));
        let sx = 0, sy = 0;
        for (let i = 1; i <= n; i++) { const tx = Math.round(dx * i / n), ty = Math.round(dy * i / n); steps.push({ t: 'rel', dx: tx - sx, dy: ty - sy, ms: 10 }); sx = tx; sy = ty; }
        said.push(`moved the mouse by (${dx},${dy})`); cur = { x: cur.x, y: cur.y }; break;
      }
      case 'wait': case 'sleep': { const ms = Math.max(0, Math.min(15000, a.ms ?? (a.seconds ? a.seconds * 1000 : 500))); steps.push({ t: 'sleep', ms }); said.push(`waited ${ms} ms`); break; }
      default: throw err(`Unknown action "${a.action || a.type}". Use: move, click, double_click, right_click, mouse_down, mouse_up, drag, scroll, type, key, key_down, key_up, move_relative, wait.`, 'BAD_ARGS');
    }
  }
  return { steps, points, said };
}

async function play(b, compiled) {
  const total = compiled.steps.reduce((n, s) => n + (s.ms || 0) + (s.t === 'text' ? String(s.s).length * (s.ms || 1) : 0), 0);
  if (total > 120000) throw err('These actions would take more than 2 minutes: split them into several calls.', 'TOO_LONG');
  const r = await b.call('play', { steps: compiled.steps }, total + 20000);
  for (const p of compiled.points) overlay.ripple(p.x, p.y, p.right);
  if (r.interrupted) { onUser({ kind: r.interrupted }); throw pausedError(); }
  return r;
}

// Run actions, then look again: what the AI gets back is what happened.
async function act(a, ctx, actions, { settle = 450, label } = {}) {
  const b = await begin(ctx);
  const L = requireLook();
  // the window the actions are meant for is in front first (typing never lands in another app)
  const wins = (a.window != null && a.window !== '') || L.hwnd ? await listWindows() : null;
  if (a.window != null && a.window !== '') {
    const w = findWindow(wins, a.window);
    if (!w) throw noWindow(a.window, wins);
    if (String(L.hwnd) !== String(w.hwnd)) throw err(`Your last look was not of "${q(w.title, 50)}": ids and coordinates belong to the last look. Call computer_look {"window": "${q(a.window, 30)}"} first.`, 'LOOK_FIRST');
    await focusWindow(w);
  } else if (L.hwnd) {
    const w = wins.find((x) => String(x.hwnd) === String(L.hwnd));
    if (w) await focusWindow(w);
  }
  const c0 = await b.call('cursor', {}, 5000).catch(() => null);
  const compiled = compile(actions, L, c0 && c0.x != null ? [c0.x, c0.y] : [L.mon.x + L.mon.w / 2, L.mon.y + L.mon.h / 2]);
  await guardTargets(compiled);
  overlay.status(label || compiled.said[0]);
  await play(b, compiled);
  if (a.look === false) return { content: `Done: ${compiled.said.join(', ')}.`, view: { kind: 'computer', said: compiled.said } };
  await wait(Math.min(15000, a.wait_ms ?? settle));
  const lastPt = compiled.points[compiled.points.length - 1];
  const v = await look({ after: true, hwnd: L.hwnd }, ctx);
  // the user's thumbnail shows where Fabro acted
  let thumb = v.thumb;
  if (lastPt && v.L.mi === L.mi) {
    const ip = [Math.round((lastPt.x - v.L.mon.x) * v.L.scale), Math.round((lastPt.y - v.L.mon.y) * v.L.scale)];
    try { thumb = (await paint.mark(v.image, [], { point: ip })).thumb; } catch {}
  }
  return { content: `Done: ${compiled.said.join(', ')}.\n\n${v.text}`, image: v.image, view: { kind: 'computer', said: compiled.said, shot: thumb, target: lastPt && lastPt.name, from: lastPt && lastPt.from } };
}

// Clicks that land on Fabro itself are refused (the AI would be clicking its own chat).
async function guardTargets(compiled) {
  if (process.platform === 'linux') return;
  for (const p of compiled.points) {
    const info = await backend.call('point', { x: p.x, y: p.y }, 5000).catch(() => null);
    if (info && info.pid === process.pid && !overlay.isOwn(info.hwnd)) throw err('That point is on Fabro\'s own window. Minimize or move Fabro, or work in another window.', 'SELF_TARGET');
  }
}

// ───────────────────────────── tools ─────────────────────────────
const KEYWORDS = ['ordinateur', 'ordi', 'mon pc', 'computer', 'écran', 'ecran', 'screen', 'bureau', 'desktop', 'souris', 'mouse', 'clavier', 'keyboard', 'clique', 'click', 'double-clic', 'fenêtre', 'fenetre', 'window', 'appli', 'application', 'logiciel', 'software', 'programme', 'drag', 'glisse', 'raccourci', 'shortcut', 'appuie', 'press ', 'tape ', 'dessine', 'draw', 'computer use',
  'paint', 'bloc-notes', 'notepad', 'word', 'excel', 'powerpoint', 'explorateur', 'explorer', 'roblox studio', 'studio', 'discord', 'spotify', 'steam', 'photoshop', 'gimp', 'blender', 'vscode', 'vs code', 'calculatrice', 'calculator', 'paramètres', 'settings', 'obs', 'teams', 'outlook', 'pantalla', 'ratón', 'teclado', 'bildschirm', 'maus', 'tastatur'];
const common = { category: 'computer', risk: 'control', keywords: KEYWORDS, categoryCore: true };
const targetProps = {
  element: { type: 'integer', description: 'Id of an element from the last look, e.g. 12 for [12] (preferred: exact).' },
  x: { type: 'number', description: 'X in the last screenshot (when there is no id).' },
  y: { type: 'number', description: 'Y in the last screenshot.' },
};
const windowProp = { window: { type: 'string', description: 'Optional: the window this is for (title or app name). It must be the window of your last look; Fabro brings it to the front first.' } };
const afterProps = {
  wait_ms: { type: 'integer', description: 'Wait this long before looking at the result (default ~0.5 s; more for slow apps or loading).' },
  look: { type: 'boolean', description: 'Return the screen after the action (default true).' },
};
const SENS = agent.SENSITIVE;
async function baseGuard(ctx, sensitiveName) {
  const c = cs();
  if (c.enabled === false) return { refuse: 'Computer Use is turned off in Settings › Agent.' };
  if (!supported()) return { refuse: 'Computer Use is not available on this system.' };
  if (ctx && ctx.unattended) return { refuse: 'Computer Use is not available in scheduled or background tasks: nobody would be there to watch or take over.' };
  const need = c.confirm !== false && !(ctx && ctx.grants && ctx.grants.has('computer'));
  if (need || (sensitiveName && SENS.test(sensitiveName))) { showFabro(); return { confirm: need ? 'computer_use' : `« ${q(sensitiveName, 40)} »` }; }
  return null;
}
function grant(ctx) { if (ctx && ctx.lastConfirmed && ctx.grants) ctx.grants.add('computer'); }
const nameAt = (a, p = '') => { try { const L = S.look; if (!L) return ''; const id = a[p + 'element']; const m = id != null && L.marks.get(Number(id)); return m ? m.name || '' : ''; } catch { return ''; } };
const tLabel = (a, p = '') => { const n = nameAt(a, p); return a[p + 'element'] != null ? `[${a[p + 'element']}]${n ? ` « ${q(n, 40)} »` : ''}` : a[p + 'x'] != null ? `(${a[p + 'x']}, ${a[p + 'y']})` : ''; };

agent.register({ ...common, name: 'computer_look',
  description: 'See the computer screen: a screenshot with numbered boxes on everything that can be used (buttons, fields, menus, list items, links, text), plus the list of those elements — [id], role, name, value/state, (x,y) center — the active window, other windows and the keyboard focus. Coordinates are pixels of this screenshot. Call it first; every other computer_* action already returns the new screen.',
  parameters: { type: 'object', properties: {
    window: { type: 'string', description: 'Look at one window only, e.g. "Discord" or "Bloc-notes" (title or app name): Fabro brings it to the front and the picture is just that window — sharper and easier to click precisely. Best way to work in an app.' },
    display: { type: 'integer', description: 'Which screen (1, 2…) to look at when there are several. Default: the one with the active window.' },
    read_text: { type: 'boolean', description: 'Also read all text on screen with OCR (automatic for apps that describe little of themselves).' },
    grid: { type: 'boolean', description: 'Draw a coordinate grid (every 100 px) to aim precisely at things without an id.' },
    wait_ms: { type: 'integer', description: 'Wait before looking (page or app loading).' },
  } },
  summarize: () => 'Capture d’écran + éléments',
  guard: (a, ctx) => baseGuard(ctx),
  async run(a, ctx) {
    grant(ctx); await begin(ctx);
    const v = await look(a, ctx);
    return { content: v.text, image: v.image, view: { kind: 'computer', said: ['looked'], shot: v.thumb } };
  } });

agent.register({ ...common, name: 'computer_zoom',
  description: 'Zoom on a part of the screen at full resolution to read small text or aim precisely. Rulers on the zoomed picture use the coordinates of the last screenshot, so you can click what you see there. Also returns the text read in that area.',
  parameters: { type: 'object', properties: { ...targetProps, width: { type: 'number', description: 'Width of the area in screenshot pixels (default 320).' }, height: { type: 'number', description: 'Height (default 200).' } } },
  summarize: (a) => `Zoom ${tLabel(a)}`,
  guard: (a, ctx) => baseGuard(ctx),
  async run(a, ctx) {
    grant(ctx); const b = await begin(ctx); const L = requireLook();
    const t = target(a, L);
    const w = Math.max(40, Math.min(L.W, a.width || (t.mark ? Math.max(t.mark.ir[2] + 80, 240) : 320)));
    const h = Math.max(30, Math.min(L.H, a.height || (t.mark ? Math.max(t.mark.ir[3] + 60, 150) : 200)));
    const ix = Math.max(0, Math.min(L.W - w, t.img[0] - w / 2)), iy = Math.max(0, Math.min(L.H - h, t.img[1] - h / 2));
    const sx = Math.round(L.mon.x + ix / L.scale), sy = Math.round(L.mon.y + iy / L.scale), sw = Math.round(w / L.scale), sh = Math.round(h / L.scale);
    const file = path.join(shotsDir(), 'zoom.png');
    await overlay.aside(() => b.call('capture', { x: sx, y: sy, w: sw, h: sh, path: file, cursor: false }, 15000));
    const img = nativeImage.createFromPath(file);
    const real = img.getSize();                                              // Retina: 2 pixels per point
    const k = Math.max(0.5, Math.min(4, 1000 / Math.max(real.width, real.height)));
    const big = img.resize({ width: Math.round(real.width * k), height: Math.round(real.height * k), quality: 'best' });
    const kImg = big.getSize().width / w;                                    // screenshot px → zoom px
    const z = await paint.zoom('data:image/png;base64,' + big.toPNG().toString('base64'), { x: Math.round(ix), y: Math.round(iy), w: Math.round(w), h: Math.round(h), k: kImg });
    let text = '';
    if (cs().ocr !== 'off') {
      try {
        const f2 = path.join(shotsDir(), 'zoom-ocr.png'); fs.writeFileSync(f2, big.toPNG());
        const { lines } = await b.ocr(f2, 1);
        if (lines.length) text = '\nText in this area (with screenshot coordinates of its center):\n' + lines.map((l) => `"${q(l.text, 90)}" (${Math.round(ix + (l.rect[0] + l.rect[2] / 2) / kImg)},${Math.round(iy + (l.rect[1] + l.rect[3] / 2) / kImg)})`).join('\n');
      } catch {}
    }
    return { content: `Zoom ×${(kImg).toFixed(1)} on the area (${Math.round(ix)},${Math.round(iy)}) → (${Math.round(ix + w)},${Math.round(iy + h)}) of the last screenshot. The rulers show screenshot coordinates.${text}`, image: z.image, view: { kind: 'computer', said: ['zoomed'], shot: z.thumb } };
  } });

agent.register({ ...common, name: 'computer_click',
  description: 'Move the mouse smoothly to an element (by [id]) or a point (x,y) and click: left (default), right (context menu), middle; 2 clicks = double-click (open a file, select a word). Hold modifiers (ctrl/shift/alt) for multi-select. hold_ms keeps the button pressed (long press). Returns the screen after the click.',
  parameters: { type: 'object', properties: { ...targetProps,
    button: { type: 'string', enum: ['left', 'right', 'middle'] },
    clicks: { type: 'integer', description: '1 (default), 2 = double-click, 3 = triple-click (select a line).' },
    modifiers: { type: 'array', items: { type: 'string' }, description: 'Keys held during the click, e.g. ["ctrl"] or ["shift"].' },
    hold_ms: { type: 'integer', description: 'Keep the button pressed this long (long press).' }, ...windowProp, ...afterProps } },
  summarize: (a) => `${a.button === 'right' ? 'Clic droit' : a.clicks === 2 ? 'Double-clic' : 'Clic'} ${tLabel(a)}${(a.modifiers || []).length ? ` + ${a.modifiers.join('+')}` : ''}`,
  guard: (a, ctx) => baseGuard(ctx, nameAt(a)),
  async run(a, ctx) { grant(ctx); return act(a, ctx, [{ ...a, action: 'click' }], { settle: 500 }); } });

agent.register({ ...common, name: 'computer_drag',
  description: 'Press the mouse button on something and drag it to somewhere else, smoothly (move files, sliders, resize/move windows, select an area, draw a line). From: element/x,y (or where the pointer is). To: to_element or to_x,to_y. hold_ms waits over the destination before releasing.',
  parameters: { type: 'object', properties: { ...targetProps,
    to_element: { type: 'integer', description: 'Destination element id.' }, to_x: { type: 'number' }, to_y: { type: 'number' },
    button: { type: 'string', enum: ['left', 'right', 'middle'] }, modifiers: { type: 'array', items: { type: 'string' } },
    slow: { type: 'boolean', description: 'Drag more slowly (precise drawing, sensitive sliders).' }, hold_ms: { type: 'integer' }, ...windowProp, ...afterProps }, required: [] },
  summarize: (a) => `Glisser ${tLabel(a) || 'depuis le pointeur'} → ${tLabel(a, 'to_')}`,
  guard: (a, ctx) => baseGuard(ctx, nameAt(a, 'to_')),
  async run(a, ctx) { grant(ctx); return act(a, ctx, [{ ...a, action: 'drag' }], { settle: 450 }); } });

agent.register({ ...common, name: 'computer_type',
  description: 'Type text like a keyboard (any language, emoji, new lines). If element/x,y is given, clicks it first to focus it. clear=true selects everything in the field and deletes it first; enter=true presses Enter after. Never type passwords or card numbers: ask the user to.',
  parameters: { type: 'object', properties: { text: { type: 'string' }, ...targetProps, clear: { type: 'boolean' }, enter: { type: 'boolean' }, ...windowProp, ...afterProps }, required: ['text'] },
  summarize: (a) => `Saisir « ${q(a.text, 80)} »${a.element != null ? ` dans ${tLabel(a)}` : ''}${a.enter ? ' + Entrée' : ''}`,
  async guard(a, ctx) {
    const g = await baseGuard(ctx, a.enter ? nameAt(a) : '');
    if (g && g.refuse) return g;
    const t = String(a.text || '');
    const digits = t.replace(/[\s-]/g, '');
    if (/^\d{13,19}$/.test(digits) && luhn(digits)) return { refuse: 'This looks like a payment card number. Ask the user to type it themselves.' };
    const m = S.look && a.element != null && S.look.marks.get(Number(a.element));
    if (m && m.password) return { refuse: 'That is a password field. Ask the user to type their password themselves.' };
    if (!m && a.x == null && process.platform !== 'linux' && backend) {
      const f = await backend.call('focused', {}, 4000).catch(() => null);
      if (f && f.element && f.element.password) return { refuse: 'The keyboard focus is in a password field. Ask the user to type their password themselves.' };
    }
    return g;
  },
  async run(a, ctx) {
    grant(ctx);
    const text = String(a.text ?? '');
    // long text goes through the clipboard (restored after): instant and exact
    if (text.length > 600) {
      const prev = clipboard.readText();
      const pre = (a.element != null || a.x != null) ? [{ action: 'click', element: a.element, x: a.x, y: a.y }] : [];
      if (a.clear) pre.push({ action: 'key', keys: 'cmd+a' }, { action: 'key', keys: 'delete' });
      clipboard.writeText(text);
      try { await act({ ...a, look: false }, ctx, [...pre, { action: 'key', keys: process.platform === 'darwin' ? 'cmd+v' : 'ctrl+v' }, ...(a.enter ? [{ action: 'key', keys: 'enter' }] : [])]); }
      finally { setTimeout(() => clipboard.writeText(prev), 600); }
      if (a.look === false) return { content: `Pasted ${text.length} characters.`, view: { kind: 'computer', said: ['pasted'] } };
      await wait(a.wait_ms ?? 400);
      const v = await look({ after: true }, ctx);
      return { content: `Done: pasted ${text.length} characters${a.enter ? ' then Enter' : ''}.\n\n${v.text}`, image: v.image, view: { kind: 'computer', said: ['pasted'], shot: v.thumb } };
    }
    return act(a, ctx, [{ ...a, action: 'type' }], { settle: a.enter ? 700 : 300 });
  } });

agent.register({ ...common, name: 'computer_key',
  description: 'Press keys and shortcuts: "enter", "esc", "tab", "ctrl+s", "ctrl+shift+t", "alt+tab", "alt+f4", "win", "win+r", "f5", arrows ("down"), or several in order: "tab tab enter". repeat presses it again; hold_ms keeps the key down (games: "w" held 2000 ms).',
  parameters: { type: 'object', properties: { keys: { type: 'string', description: 'The key or combination, e.g. "ctrl+c". Several separated by spaces are pressed in order.' }, repeat: { type: 'integer' }, hold_ms: { type: 'integer' }, ...windowProp, ...afterProps }, required: ['keys'] },
  summarize: (a) => `Touches ${a.keys}${a.repeat > 1 ? ` ×${a.repeat}` : ''}`,
  async guard(a, ctx) {
    try { for (const c of keys.sequence(a.keys)) if (keys.isBlocked(c)) return { refuse: `${c.label} would lock or leave the Windows session.` }; } catch (e) { return { refuse: e.message }; }
    return baseGuard(ctx);
  },
  async run(a, ctx) { grant(ctx); return act(a, ctx, [{ ...a, action: 'key' }], { settle: 450 }); } });

agent.register({ ...common, name: 'computer_scroll',
  description: 'Scroll with the mouse wheel over an element or point (or where the pointer is): up, down, left, right; amount = wheel notches (default 3). With modifiers ["ctrl"] it zooms in most apps.',
  parameters: { type: 'object', properties: { ...targetProps, direction: { type: 'string', enum: ['up', 'down', 'left', 'right'] }, amount: { type: 'integer' }, modifiers: { type: 'array', items: { type: 'string' } }, ...windowProp, ...afterProps }, required: ['direction'] },
  summarize: (a) => `Défiler ${a.direction} ×${a.amount || 3}${tLabel(a) ? ` sur ${tLabel(a)}` : ''}`,
  guard: (a, ctx) => baseGuard(ctx),
  async run(a, ctx) { grant(ctx); return act(a, ctx, [{ ...a, action: 'scroll' }], { settle: 350 }); } });

agent.register({ ...common, name: 'computer_actions',
  description: 'Do several mouse/keyboard actions in one smooth sequence (no pause to look between them), then return the screen. Use it for fluid gestures: hold shift and click several items, mouse_down → several moves → mouse_up to draw a shape, key_down "w" + wait + key_up for games, move_relative to turn a 3D camera. Each action: {"action": "move"|"click"|"double_click"|"right_click"|"mouse_down"|"mouse_up"|"drag"|"scroll"|"type"|"key"|"key_down"|"key_up"|"move_relative"|"wait", plus its fields: element or x,y; to_element or to_x,to_y (drag); button; modifiers; text; keys; direction, amount; dx, dy, duration_ms (move_relative); ms (wait); hold_ms}. Element ids come from the last look. Anything still pressed is released at the end.',
  parameters: { type: 'object', properties: { actions: { type: 'array', items: { type: 'object' }, description: 'The actions, in order.' }, ...windowProp, ...afterProps }, required: ['actions'] },
  summarize: (a) => `${(a.actions || []).length} actions : ${(a.actions || []).slice(0, 6).map((x) => x.action + (x.element != null ? ` [${x.element}]` : x.keys ? ` ${x.keys}` : x.text ? ` « ${q(x.text, 20)} »` : '')).join(', ')}`,
  async guard(a, ctx) {
    if (!Array.isArray(a.actions) || !a.actions.length) return { refuse: 'actions must be a non-empty list' };
    if (a.actions.length > 80) return { refuse: 'At most 80 actions per call.' };
    for (const x of a.actions) {
      if (/^(type)$/.test(x.action) && /^\d{13,19}$/.test(String(x.text || '').replace(/[\s-]/g, '')) && luhn(String(x.text).replace(/[\s-]/g, ''))) return { refuse: 'This looks like a payment card number. Ask the user to type it themselves.' };
      const m = S.look && x.element != null && S.look.marks.get(Number(x.element));
      if (x.action === 'type' && m && m.password) return { refuse: 'That is a password field. Ask the user to type it themselves.' };
      if (/key/.test(x.action || '') && (x.keys || x.key)) { try { for (const c of keys.sequence(x.keys || x.key)) if (keys.isBlocked(c)) return { refuse: `${c.label} is not allowed.` }; } catch (e) { return { refuse: e.message }; } }
    }
    const names = a.actions.filter((x) => /click|drag/.test(x.action || '')).map((x) => nameAt(x) || nameAt(x, 'to_')).join(' ');
    return baseGuard(ctx, names);
  },
  async run(a, ctx) { grant(ctx); return act(a, ctx, a.actions, { settle: 450, label: `${a.actions.length} actions` }); } });

agent.register({ ...common, name: 'computer_open_app',
  description: 'Open an application by its name the way a person does (Start menu on Windows, Spotlight on macOS), e.g. "Paint", "Bloc-notes", "Roblox Studio", "Excel". Or open a file, folder or web address with its default app (path_or_url). Returns the screen once it is open.',
  parameters: { type: 'object', properties: { name: { type: 'string', description: 'The app name as shown in the Start menu.' }, path_or_url: { type: 'string' }, wait_ms: { type: 'integer', description: 'How long to wait for it to open (default 2.5 s).' } } },
  summarize: (a) => `Ouvrir ${a.name || a.path_or_url || ''}`,
  async guard(a, ctx) {
    if (!a.name && !a.path_or_url) return { refuse: 'Give name or path_or_url.' };
    const g = await baseGuard(ctx);
    if (g && g.refuse) return g;
    if (a.path_or_url && /\.(bat|cmd|ps1|vbs|js|msi|reg|sh|scr)$/i.test(a.path_or_url)) return { confirm: 'run_program' };
    return g;
  },
  async run(a, ctx) {
    grant(ctx);
    await begin(ctx);
    const before = new Set((await listWindows()).map((w) => String(w.hwnd)));
    if (a.path_or_url) {
      const p = String(a.path_or_url);
      if (/^(https?|mailto|ms-settings|steam|roblox-studio|spotify):/i.test(p)) await shell.openExternal(p);
      else { const e = await shell.openPath(p); if (e) throw err(`Could not open ${p}: ${e}`, 'OPEN_FAILED'); }
      await wait(Math.min(20000, a.wait_ms ?? 2500));
    } else if (process.platform === 'darwin') {
      // open -a finds the app by its name; Spotlight is the fallback, like a person would do
      const ok = await new Promise((res) => require('child_process').execFile('open', ['-a', String(a.name)], (e) => res(!e)));
      if (!ok) {
        if (!S.look) await look({}, ctx);
        await act({ look: false }, ctx, [{ action: 'key', keys: 'cmd+space' }, { action: 'wait', ms: 700 }, { action: 'type', text: String(a.name) }, { action: 'wait', ms: 1200 }, { action: 'key', keys: 'enter' }], { label: String(a.name) });
      }
      await wait(Math.min(20000, a.wait_ms ?? 2500));
    } else if (process.platform === 'win32') {
      if (!S.look) await look({}, ctx);
      await act({ look: false }, ctx, [{ action: 'key', keys: 'win' }, { action: 'wait', ms: 750 }, { action: 'type', text: String(a.name) }, { action: 'wait', ms: 1300 }, { action: 'key', keys: 'enter' }], { label: String(a.name) });
      await wait(Math.min(20000, a.wait_ms ?? 2500));
    } else {
      const bin = String(a.name).trim().toLowerCase().replace(/\s+/g, '-');
      const { spawn } = require('child_process');
      const ok = await new Promise((res) => { try { const p = spawn(bin, [], { detached: true, stdio: 'ignore' }); p.on('error', () => res(false)); p.unref(); setTimeout(() => res(true), 400); } catch { res(false); } });
      if (!ok) throw err(`No program called "${bin}" was found. Use path_or_url, or open it from the app menu with clicks.`, 'OPEN_FAILED');
      await wait(Math.min(20000, a.wait_ms ?? 2000));
    }
    // look at the app that opened: a new window, else one with its name, else the screen
    const now = await listWindows();
    const opened = now.find((w) => !before.has(String(w.hwnd)) && !w.minimized) || findWindow(now, a.name || '') || null;
    const v = await look({ after: true, hwnd: opened ? opened.hwnd : undefined }, ctx);
    return { content: `Opened ${a.name || a.path_or_url}${opened ? ` — window "${q(opened.title, 50)}"` : ' (no new window found yet: it may still be loading; wait and look again)'}.\n\n${v.text}`, image: v.image, view: { kind: 'computer', said: ['opened'], shot: v.thumb } };
  } });

agent.register({ ...common, name: 'computer_window',
  description: 'Manage windows: list them, or focus (bring to front), maximize, minimize, restore or close one, found by its title or app name (part of it is enough). Returns the screen after.',
  parameters: { type: 'object', properties: { action: { type: 'string', enum: ['list', 'focus', 'maximize', 'minimize', 'restore', 'close'] }, window: { type: 'string', description: 'Title or app name (part of it), e.g. "Bloc-notes" or "chrome".' } }, required: ['action'] },
  summarize: (a) => `Fenêtre ${a.action}${a.window ? ` « ${a.window} »` : ''}`,
  guard: (a, ctx) => baseGuard(ctx),
  async run(a, ctx) {
    grant(ctx);
    const b = await begin(ctx);
    const wins = await listWindows();
    void b;
    if (a.action === 'list' || !a.window) {
      return { content: wins.length ? `Windows (front to back):\n${wins.map((w, i) => `${i + 1}. "${q(w.title, 80)}" — ${w.app}${w.focused ? ' (active)' : ''}${w.minimized ? ' (minimized)' : ''}${w.maximized ? ' (maximized)' : ''}`).join('\n')}` : 'No windows are open.', view: { kind: 'computer', said: ['windows'] } };
    }
    const w = findWindow(wins, a.window);
    if (!w) throw noWindow(a.window, wins);
    overlay.status(`${a.action} · ${q(w.title, 40)}`);
    const r = await b.call('window', { hwnd: w.hwnd, action: a.action }, 8000);
    await wait(a.action === 'close' ? 600 : 400);
    // after focus / maximize / restore: look at that window only (sharper, ids for it)
    const v = await look({ after: true, hwnd: ['focus', 'maximize', 'restore'].includes(a.action) ? w.hwnd : undefined }, ctx);
    return { content: `${a.action} "${q(w.title, 60)}"${a.action === 'focus' && !r.focused ? ' — Windows refused to bring it to the front; click it in the taskbar instead' : ''}.\n\n${v.text}`, image: v.image, view: { kind: 'computer', said: [a.action], shot: v.thumb } };
  } });

function luhn(s) { let sum = 0, alt = false; for (let i = s.length - 1; i >= 0; i--) { let n = +s[i]; if (alt) { n *= 2; if (n > 9) n -= 9; } sum += n; alt = !alt; } return sum % 10 === 0; }

// Settings › Agent › Computer Use › "Test": builds the helper and reads the screen once.
async function test() {
  try {
    const b = await be(null);
    const t0 = Date.now();
    const mon = hello.monitors.find((m) => m.primary) || hello.monitors[0];
    const file = path.join(shotsDir(), 'test.png');
    await b.call('capture', { x: mon.x, y: mon.y, w: mon.w, h: mon.h, path: file, cursor: true }, 20000);
    const els = await b.call('elements', { hwnds: [], taskbar: process.platform === 'win32', max: 400, ms: 1500 }, 10000).catch((e) => ({ elements: [], error: e.message }));
    let ocr = null; try { ocr = (await b.ocr(file, 1)).lang || 'ok'; } catch (e) { ocr = null; }
    const img = nativeImage.createFromPath(file);
    return { ok: true, ms: Date.now() - t0, monitors: hello.monitors.length, size: `${mon.w}×${mon.h}`, elements: (els.elements || []).length, ocr, thumb: img.isEmpty() ? null : 'data:image/jpeg;base64,' + img.resize({ width: 420 }).toJPEG(70).toString('base64') };
  } catch (e) { return { ok: false, error: e.message }; }
}

function status() { return { supported: supported(), platform: process.platform, active: S.active, paused: S.paused, ready: !!hello }; }
function shutdown() { finish(); if (backend) backend.kill(); backend = null; hello = null; paint.close(); overlay.destroy(); }

module.exports = { init, turnEnded, test, status, shutdown, _internal: { buildMarks, compile, S, look, target } };

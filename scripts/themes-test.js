// Themes: manifest validity, AA contrast pairs in light and dark, and the untrusted-file sanitiser.
// Usage: node scripts/themes-test.js [--verbose]
const fs = require('fs'); const path = require('path'); const assert = require('assert');
const C = require('../src/renderer/themes-core.js');
const D = require('../src/renderer/themes-data.js');
const verbose = process.argv.includes('--verbose');
let fails = 0, checks = 0;
const ok = (cond, msg) => { checks++; if (!cond) { fails++; console.log('  FAIL', msg); } else if (verbose) console.log('  ok  ', msg); };

// ── the default look (tokens.css) is audited too, as the baseline ──
function parseBlock(css, selector) {
  const i = css.indexOf(selector + ' {'); if (i < 0) return {};
  const body = css.slice(i, css.indexOf('\n}', i));
  const o = {}; for (const m of body.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) o[m[1]] = m[2].trim();
  return o;
}
const css = fs.readFileSync(path.join(__dirname, '../src/renderer/styles/tokens.css'), 'utf8');
const lightBase = parseBlock(css, ':root'), darkBase = { ...lightBase, ...parseBlock(css, '[data-theme="dark"]') };
function table(name, tokens, mode) {
  const res = C.audit(tokens);
  const bad = res.filter((r) => !r.pass);
  const worst = res.filter((r) => !r.missing).reduce((a, r) => (r.ratio / r.min < a.ratio / a.min ? r : a), { ratio: 99, min: 1 });
  console.log(`${name.padEnd(11)} ${mode.padEnd(5)} ${String(res.length - bad.length).padStart(2)}/${res.length} pairs ok · tightest ${worst.fg}/${worst.bg} ${worst.ratio}:1 (needs ${worst.min})${bad.length ? ' · FAIL ' + bad.map((b) => `${b.fg}/${b.bg} ${b.ratio}<${b.min}`).join(', ') : ''}`);
  return bad;
}
console.log('— contrast (WCAG ratios; text pairs ≥ 4.5, body text ≥ 7, focus/accent ≥ 3) —');
// the shipped default: informational (it is not ours to change here) — report, do not fail
['light', 'dark'].forEach((m) => { const b = table('fabro*', m === 'light' ? lightBase : darkBase, m); if (b.length) console.log('             (* the default look, tokens.css: reported only)'); });

const seen = new Set();
for (const raw of D.BUILTIN) {
  console.log('\n' + raw.id);
  const r = C.sanitize(raw, { builtin: true });
  ok(r.ok, `${raw.id}: manifest valid ${r.ok ? '' : r.errors.join(',')}`);
  if (!r.ok) continue;
  const m = r.theme;
  ok(!seen.has(m.id), `${m.id}: unique id`); seen.add(m.id);
  ok(r.warnings.length === 0, `${m.id}: no ignored parts (${r.warnings.join(',')})`);
  ok(!('--logo' in (m.tokens.all || {})) && !(m.tokens.all && m.tokens.all.logo), `${m.id}: leaves --logo alone`);
  ok(m.css == null || fs.existsSync(path.join(__dirname, '../src/renderer/styles/themes', m.css)), `${m.id}: sheet ${m.css || '(none)'} exists`);
  const fonts = Object.values(m.fonts || {}).join(' ');
  ok(!/url\(|http|@import|@font-face/i.test(fonts), `${m.id}: system fonts only`);
  if (m.id === 'fabro') { ok(Object.keys(m.palette).length === 0 && !Object.keys(m.tokens).length, 'fabro: no overrides (default look untouched)'); continue; }
  for (const mode of (m.base === 'both' ? ['light', 'dark'] : [m.base])) {
    const raw_ = C.resolveTokens(m, mode, { raw: true });   // before the safety net: the authors' own values
    const fin = C.resolveTokens(m, mode);
    const bad = table(m.id, fin, mode);
    ok(bad.length === 0, `${m.id} ${mode}: every pair passes`);
    const badRaw = C.audit(raw_).filter((x) => !x.pass);
    ok(badRaw.length === 0, `${m.id} ${mode}: passes without the safety net (${badRaw.map((b) => b.fg + '/' + b.bg).join(',')})`);
    // the generated CSS holds nothing but declarations
    const out = C.compile(m);
    // inside the inline SVG texture, url(#id) points at its own filter: look only outside data: URIs
    ok(!/url\((?!["']?data:image\/svg)|@import|<script|expression\(|javascript:/i.test(out.replace(/data:image\/svg\+xml,[^"]*/g, 'data:image/svg+xml,')), `${m.id}: compiled CSS has no remote url / import / script`);
    ok(!['logo'].some((k) => out.includes('--' + k + ':')), `${m.id}: never sets --logo`);
  }
  if (m.layout) ok(C.LAYOUTS.includes(m.layout), `${m.id}: known layout`);
}
ok(D.BUILTIN.length >= 6 && D.BUILTIN.length <= 9, `built-in count in range (${D.BUILTIN.length})`);

console.log('\n— untrusted theme files —');
const good = { fabrotheme: 1, v: 1, id: 'my-theme', name: 'Mine', author: 'x', base: 'both', palette: { light: { bg: '#fff', text: '#111', accent: '#0a58ca' }, dark: { bg: '#111', text: '#eee', accent: '#6ea8fe' } } };
let r = C.sanitize(good, { imported: true });
ok(r.ok && r.theme.id === 'u-my-theme', 'valid file accepted, id prefixed u-');
const hostile = {
  fabrotheme: 1, id: '../../evil', name: '<img src=x onerror=alert(1)>Evil', base: 'both', css: '@import url(https://evil.example/x.css);', script: 'alert(1)', js: 'x',
  palette: { light: { bg: 'url(https://evil.example/a.png)', text: '#000' }, dark: { bg: '#000', text: '#fff', accent: 'red; } body { background: url(//e.x/y) ' } },
  tokens: { all: { '--accent': 'expression(alert(1))', '--font-ui': 'x', '--shadow': '0 0 0 url(https://e.x/s) red', '--bg': '#123456', '--dur-1': '9999s', '--r': '999px', '--evil': 'x', '--logo': '#000', '--texture': 'url(https://e.x/t.png)', '--sb-w': '5000px' } },
  fonts: { ui: 'url(https://evil.example/f.woff2), serif', read: '"Legit Font", Georgia, serif', display: 'a;}body{x:y', mono: 'var(--font-ui)' },
  texture: { kind: 'url(https://x)', opacity: 5 }, motion: 'warp', layout: 'cli; x', };
r = C.sanitize(JSON.stringify(hostile), { imported: true });
ok(r.ok === false || r.theme, 'hostile file handled without throwing');
if (r.ok) {
  const m = r.theme, out = C.compile(m);
  ok(m.css === undefined, 'imported theme cannot carry css');
  ok(m.id === 'u-evil', `id slugged (${m.id})`);
  ok(!/[<>`]/.test(JSON.stringify(m.name)), 'name stripped of markup');
  ok(!/https?:|\/\/e\.x|url\(|expression|@import|evil|;\s*}|javascript/i.test(out.replace(/data:image\/svg\+xml,[^"]*/g, '')), 'compiled CSS carries nothing hostile');
  ok(!('logo' in (m.tokens.all || {})), '--logo cannot be set');
  ok(!/url\(/.test(JSON.stringify(m.fonts)) && m.fonts.read && m.fonts.read.includes('Legit Font'), 'fonts: remote url dropped, system stack kept');
  ok(!m.fonts.display, 'fonts: injection attempt dropped');
  ok(m.tokens.all && m.tokens.all.bg === '#123456', 'good tokens survive');
  ok(!m.tokens.all['dur-1'] && !m.tokens.all['sb-w'] && !m.tokens.all.r, 'out-of-range values dropped');
  ok(m.layout === '' && m.motion === 'default' && !m.texture, 'unknown layout / motion / texture dropped');
  ok(r.warnings.includes('css_ignored') && r.warnings.includes('code_ignored'), 'warnings say what was ignored');
}
ok(C.sanitize('{not json', { imported: true }).ok === false, 'bad JSON rejected');
ok(C.sanitize('x'.repeat(C.MAX_BYTES + 1), { imported: true }).ok === false, 'oversized file rejected');
ok(C.sanitize({ id: '__proto__', name: 'x', palette: { light: { bg: '#fff', text: '#000' } }, base: 'light', tokens: { all: { __proto__: { bg: '#000' } } } }, { imported: true }).ok !== undefined && ({}).bg === undefined, 'prototype pollution has no effect');
// a theme that tries to hide text gets pulled back to AA
const sneaky = { id: 'sneaky', name: 'Sneaky', base: 'light', palette: { light: { bg: '#ffffff', text: '#fafafa', accent: '#fefefe' } }, tokens: { all: { muted: '#ffffff', 'accent-text': '#ffffff' } } };
r = C.sanitize(sneaky, { imported: true });
const t = C.resolveTokens(r.theme, 'light');
ok(C.audit(t).every((x) => x.pass), 'white-on-white theme is nudged to AA by the safety net');
// export → import round trip is stable
r = C.sanitize(good, { imported: true });
const r2 = C.sanitize(C.exportTheme(r.theme), { imported: true });
ok(r2.ok && JSON.stringify(C.resolveTokens(r2.theme, 'dark')) === JSON.stringify(C.resolveTokens(r.theme, 'dark')), 'export → import round trip gives the same tokens');

console.log(`\n${checks - fails}/${checks} checks passed${fails ? ' — ' + fails + ' FAILED' : ''}`);
process.exit(fails ? 1 : 0);

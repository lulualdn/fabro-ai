// Smart context: short descriptions ("digests") of messages and tool results.
//  - The model ends each answer with a hidden <digest>…</digest> line. streamFilter() keeps it off the screen
//    (and out of voice mode) while streaming, split() removes it from the final text, identically.
//  - When the model forgets it (small models do), describeAssistant() builds one mechanically: first sentence +
//    exact identifiers + the tools used. User messages and tool results always get mechanical descriptions.
//  - identifiers() pulls exact names out of text (paths, URLs, file names, `code`, numbers with units, versions):
//    summaries written by small models lose them, so they are copied mechanically.
//  - outline()/shorten(): long tool results become head + outline + tail, the full text stays addressable.
const { estTok } = require('./tokens');

// ───────────────────────────── the <digest> tag ─────────────────────────────
const OPEN = '<digest>'; const CLOSE = '</digest>';
// Longest suffix of `s` that is the beginning of `tag` (case-insensitive): text we must hold back for now.
function heldSuffix(s, tag) {
  const low = s.slice(-tag.length + 1).toLowerCase();
  for (let n = Math.min(low.length, tag.length - 1); n > 0; n--) if (tag.startsWith(low.slice(low.length - n))) return n;
  return 0;
}
// Streaming filter: feed(chunk) → the part that may be shown now; end() → what is left to show.
// `digest` collects the tag's content. Works whatever the chunking ("<dig" + "est>…").
function streamFilter() {
  let buf = ''; let inside = false;
  const f = {
    digest: '', seen: false,
    feed(text) {
      buf += String(text || ''); let out = '';
      for (;;) {
        const low = buf.toLowerCase();
        if (!inside) {
          const i = low.indexOf(OPEN);
          if (i >= 0) { out += buf.slice(0, i); buf = buf.slice(i + OPEN.length); inside = true; f.seen = true; if (f.digest) f.digest += ' '; continue; }
          const h = heldSuffix(buf, OPEN); out += buf.slice(0, buf.length - h); buf = buf.slice(buf.length - h); break;
        }
        const j = low.indexOf(CLOSE);
        if (j >= 0) { f.digest += buf.slice(0, j); buf = buf.slice(j + CLOSE.length); inside = false; continue; }
        const h = heldSuffix(buf, CLOSE); f.digest += buf.slice(0, buf.length - h); buf = buf.slice(buf.length - h); break;
      }
      return out;
    },
    end() { const rest = inside ? '' : buf; if (inside) f.digest += buf; buf = ''; inside = false; f.digest = clean(f.digest); return rest; },
    get holding() { return buf.length > 0 || inside; },
  };
  return f;
}
const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 400);
// Same result as running the text through streamFilter in one go.
function split(text) {
  const f = streamFilter(); const shown = f.feed(text) + f.end();
  return { text: shown, digest: f.digest || '', had: f.seen };
}

// ───────────────────────────── identifiers ─────────────────────────────
const EXT = 'js|mjs|cjs|ts|tsx|jsx|json|py|lua|luau|rs|go|java|kt|c|h|cpp|hpp|cs|rb|php|sh|ps1|bat|html?|css|scss|md|txt|csv|tsv|xlsx?|docx?|pptx?|pdf|png|jpe?g|gif|webp|svg|mp3|wav|mp4|mov|zip|gguf|yaml|yml|toml|ini|cfg|env|log|sql|db|xml|rbxl|rbxm|ipynb';
const RES = [
  /\bhttps?:\/\/[^\s<>"'`)\]}]+/g,                                         // URLs
  /\b[A-Za-z]:\\(?:[^\s<>"'`|?*\\]+\\)*[^\s<>"'`|?*\\]*/g,                     // Windows paths
  /(?<![\w:/.])(?:~|\.{1,2})?\/(?:[\w.@+-]+\/)+[\w.@+-]*/g,                   // Unix paths (at least one folder)
  new RegExp(`(?<![\\w/\\\\.-])[\\w@+-][\\w.@+-]*\\.(?:${EXT})\\b`, 'gi'),     // file names
  /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g,                                          // e-mail addresses
  /\bv?\d+\.\d+(?:\.\d+)+\b/g,                                              // versions 1.2.3
  /(?<![\w.])-?\d+(?:[.,]\d+)?\s?(?:%|GB|MB|KB|Go|Mo|ko|ms|tok\/s|px|°C|€|\$|k\b|fps|Hz|GHz|MHz)/g, // numbers with units
  /(?<![\w.])\d+[.,]\d+(?![\w.])/g,                                          // decimals
  /(?<![\w.])\d{3,}(?![\w.])/g,                                               // big numbers (ids, ports, years)
];
const CODE = /`([^`\n]{2,80})`/g;
function identifiers(text, max = 12) {
  const t = String(text || '');
  const out = [];
  const add = (x) => { const v = String(x).replace(/[.,;:!?)\]'"»]+$/, '').trim(); if (v.length >= 2 && v.length <= 200 && !out.includes(v)) out.push(v); };
  for (const m of t.matchAll(CODE)) add(m[1]);
  for (const re of RES) { re.lastIndex = 0; for (const m of t.matchAll(re)) add(m[0]); }
  // a shorter item inside a longer one adds nothing ("file.js" inside "/a/b/file.js")
  const kept = out.filter((x) => !out.some((y) => y !== x && y.length > x.length && y.includes(x)));
  return kept.slice(0, max);
}

// ───────────────────────────── descriptions ─────────────────────────────
const ARTIFACT = /<artifact\b([^>]*)>([\s\S]*?)(?:<\/artifact>|$)/gi;
const attr = (a, k) => { const m = new RegExp(`${k}\\s*=\\s*"([^"]*)"`, 'i').exec(a || ''); return m ? m[1] : ''; };
function artifactsIn(text) {
  const out = [];
  for (const m of String(text || '').matchAll(ARTIFACT)) out.push({ title: attr(m[1], 'title') || 'untitled', type: attr(m[1], 'type') || 'page', lines: m[2].split('\n').length, chars: m[2].length });
  return out;
}
const textOf = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((p) => (p && p.type === 'text' ? p.text : p && p.type === 'image_url' ? '[image]' : '')).join(' ') : c == null ? '' : String(c));
function prose(text) {
  return String(text || '').replace(ARTIFACT, ' ').replace(/```[\s\S]*?(```|$)/g, ' [code] ').replace(/<think>[\s\S]*?<\/think>/g, ' ')
    .replace(/^#+\s*/gm, '').replace(/[*_>|]/g, ' ').replace(/\s+/g, ' ').trim();
}
function firstSentence(text, max = 150) {
  const p = prose(text);
  const m = /^(.{12,}?[.!?…])(\s|$)/.exec(p);
  const s = m ? m[1] : p;
  return s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s;
}
const clip = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

function describeUser(m) {
  const t = textOf(m.content);
  const imgs = Array.isArray(m.content) ? m.content.filter((p) => p && p.type === 'image_url').length : 0;
  const files = [...t.matchAll(/(?:^|\n)(?:File|Attached file): ([^\n(]+)/g)].map((x) => x[1].trim());
  const body = t.replace(/(?:^|\n)File: [^\n]+\n```[\s\S]*?```/g, ' ');
  const ids = identifiers(body, 6);
  return [firstSentence(body, 160) || '(no text)', files.length ? `files: ${files.join(', ')}` : '', imgs ? `${imgs} image(s)` : '', ids.length ? `refs: ${ids.join(' · ')}` : ''].filter(Boolean).join(' — ');
}
function describeAssistant(m, { digest = '', tools = [] } = {}) {
  const t = split(textOf(m.content)).text;
  const arts = artifactsIn(t);
  const tl = tools.length ? `tools: ${[...new Set(tools)].slice(0, 8).join(', ')}` : '';
  const ar = arts.length ? `artifact${arts.length > 1 ? 's' : ''}: ${arts.map((a) => `«${a.title}» (${a.type}, ${a.lines} lines)`).join(', ')}` : '';
  if (digest) return [clip(digest, 260), ar, tl].filter(Boolean).join(' — ');
  const ids = identifiers(prose(t.replace(ARTIFACT, ' ')) + ' ' + (t.match(/`[^`\n]+`/g) || []).join(' '), 6);
  return [firstSentence(t, 160) || (arts.length ? '' : '(empty answer)'), ar, ids.length ? `refs: ${ids.join(' · ')}` : '', tl].filter(Boolean).join(' — ');
}
const MAIN_ARG = ['path', 'file', 'url', 'query', 'command', 'code', 'name', 'title', 'task', 'id', 'text'];
function mainArg(args) {
  if (!args || typeof args !== 'object') return '';
  for (const k of MAIN_ARG) if (typeof args[k] === 'string' && args[k]) return clip(args[k].replace(/\s+/g, ' '), 90);
  const v = Object.values(args).find((x) => typeof x === 'string' && x);
  return v ? clip(v.replace(/\s+/g, ' '), 90) : '';
}
function describeTool(name, args, content, ok = true) {
  const t = textOf(content);
  const lines = t.split('\n');
  const first = (lines.find((l) => l.trim().length > 3) || '').trim();
  const ids = identifiers(t.slice(0, 20000), 4).filter((x) => !String(mainArg(args)).includes(x));
  return `${name}(${mainArg(args)}) → ${ok ? 'ok' : 'error'}: ${clip(first, 110)}${lines.length > 3 ? ` [${lines.length} lines]` : ''}${ids.length ? ` — ${ids.join(' · ')}` : ''}`;
}

// ───────────────────────────── long text: outline, head + tail ─────────────────────────────
function outline(text, max = 24) {
  const t = String(text || ''); const lines = t.split('\n'); const out = [];
  const trimmed = t.trim();
  if (/^[[{]/.test(trimmed)) { try { const j = JSON.parse(trimmed); const keys = Array.isArray(j) ? [`array of ${j.length}`] : Object.keys(j).slice(0, 30); return [`JSON: ${keys.join(', ')}`]; } catch {} }
  const DEF = /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\*?\s+[\w$]+|class\s+[\w$]+|def\s+\w+|local\s+function\s+[\w.:]+|(?:const|let|var)\s+[\w$]+\s*=\s*(?:async\s*)?(?:\(|function|class)|fn\s+\w+|func\s+\w+|(?:public|private|protected)\s+[\w<>[\]\s]+\s+\w+\s*\()/;
  const HEAD = /^\s{0,3}#{1,6}\s+\S|^<h[1-3][^>]*>|^\s*<title>|^[A-Z][A-Z0-9 _-]{6,}$|^={3,}|^-{3,}\s*\S/;
  for (let i = 0; i < lines.length && out.length < max * 3; i++) {
    const l = lines[i];
    if (HEAD.test(l) || DEF.test(l)) out.push(`L${i + 1}: ${clip(l.trim().replace(/<[^>]+>/g, ' ').trim(), 90)}`);
  }
  if (out.length > max) { const step = out.length / max; return Array.from({ length: max }, (_, k) => out[Math.floor(k * step)]); }
  return out;
}
// Fit a long text in about maxTok tokens: start (55 %) + outline + end (25 %). `how` tells the model how to
// read the rest (an id for context_read).
function shorten(text, maxTok, how = '') {
  const t = String(text || '');
  if (estTok(t) <= maxTok) return t;
  const chars = Math.max(600, Math.floor(maxTok * 3.3));
  const ol = outline(t, 16);
  const olText = ol.length ? `\nOutline (line numbers of the full text):\n${ol.join('\n')}\n` : '\n';
  const room = Math.max(400, chars - olText.length - how.length - 200);
  const headN = Math.floor(room * 0.68); const tailN = room - headN;
  const cutAt = (s, n, fromEnd) => { if (!fromEnd) { const i = s.lastIndexOf('\n', n); return s.slice(0, i > n * 0.6 ? i : n); } const part = s.slice(-n); const i = part.indexOf('\n'); return i >= 0 && i < n * 0.4 ? part.slice(i + 1) : part; };
  const head = cutAt(t, headN, false); const tail = cutAt(t, tailN, true);
  const total = t.split('\n').length;
  const headLines = head.split('\n').length; const tailLines = tail.split('\n').length;
  return `${head}\n\n[… ${total - headLines - tailLines} lines (${t.length - head.length - tail.length} characters) not shown — this result has ${total} lines in all.${how ? ' ' + how : ''}]${olText}\n[last ${tailLines} lines]\n${tail}`;
}

module.exports = { streamFilter, split, identifiers, describeUser, describeAssistant, describeTool, mainArg, outline, shorten, firstSentence, artifactsIn, textOf, prose, clip };

// Realization guides for artifacts (src/main/guides/builtin/<category>/<name>.md): each one teaches a METHOD for a
// kind of piece — decisions, steps, techniques, mistakes, self-check — never a template or a component library.
// Chat mode: chatSection(userText) picks the one or two guides that fit the request and returns them with a
// two-line reminder of the artifact format, under a token budget. Agent mode: design_guide (and read_guide) serve them.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'guides', 'builtin');
let CACHE = null;

// ── loading ──
function parseFront(src) {
  const m = String(src).match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return null;
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) { const k = line.match(/^(\w+):\s*(.*)$/); if (k) meta[k[1]] = k[2].trim(); }
  return { meta, body: m[2].trim() };
}
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, ' ');
const words = (s) => norm(s).split(/[^a-z0-9+#]+/).filter(Boolean);

function load() {
  if (CACHE) return CACHE;
  const out = [];
  let cats = []; try { cats = fs.readdirSync(ROOT, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).filter((c) => c !== 'agent'); } catch {} // 'agent' know-how guides belong to guides.js (read_guide), not to artifact design
  for (const cat of cats.sort()) {
    for (const f of fs.readdirSync(path.join(ROOT, cat)).filter((x) => x.endsWith('.md')).sort()) {
      const file = path.join(ROOT, cat, f);
      const p = parseFront(fs.readFileSync(file, 'utf8')); if (!p) continue;
      const kw = String(p.meta.keywords || '').split(',').map((k) => norm(k).trim()).filter(Boolean);
      out.push({ name: p.meta.name || `${cat}/${f.slice(0, -3)}`, title: p.meta.title || f, when: p.meta.when || '', keywords: kw, category: cat, body: p.body, file, words: p.body.split(/\s+/).filter(Boolean).length });
    }
  }
  CACHE = out;
  return out;
}
const list = () => load().map(({ body, ...g }) => g);
const get = (name) => load().find((g) => g.name === String(name || '').trim().replace(/\.md$/, ''));

// ── what the user wants ──
const MEDIUM = {
  web: /\b(site|sites|website|sitio|webseite|page web|web ?page|landing|homepage|page d accueil|html|web app|webapp|appli|application web|app|interface|navigateur|browser|en ligne|online|responsive)\b/,
  documents: /\b(pdf|imprim\w*|print\w*|a4|a5|papier|paper|word|docx|document|fiche|dossier|courrier|brochure|depliant|flyer|affiche|poster)\b/,
  slides: /\b(slides?|diapos?|diapositives?|diaporama|presentation|deck|powerpoint|pptx?|keynote|pitch|soutenance|expose oral)\b/,
  svg: /\b(svg|logo|logotype|icone|icon|icons|pictogramme|illustration|dessin|dessine|drawing|draw|schema|diagram|diagramme|organigramme|mascotte|emblem|embleme)\b/,
};
const INTENT = /\b(fais|fait|faire|fabrique|cree|creer|creez|ecris|ecrire|redige|rediger|genere|generer|prepare|preparer|concois|concevoir|dessine|dessiner|code|coder|monte|realise|realiser|mets en page|met en page|met en forme|mets en forme|je veux|j aimerais|il me faut|besoin|peux tu|pourrais tu|tu peux|aide moi|make|create|write|design|build|generate|draft|prepare|produce|draw|code|need|give me|can you|could you|i want|i d like|help me|turn|transform|lay out|layout|format)\b/;
const DEFAULT = { web: 'web/landing-page', documents: 'documents/formal-report', slides: 'slides/talk-deck', svg: 'svg/illustration' };

function mediumOf(t) {
  const hit = Object.entries(MEDIUM).filter(([, re]) => re.test(t)).map(([k]) => k);
  if (hit.includes('slides')) return 'slides';
  if (hit.includes('svg') && !hit.includes('web')) return 'svg';
  if (hit.includes('web') && !hit.includes('documents')) return 'web';
  if (hit.includes('documents') && !hit.includes('web')) return 'documents';
  return hit[0] || null;
}

function score(g, t, tw, medium) {
  let s = 0;
  for (const k of g.keywords) {
    if (k.includes(' ')) { if ((' ' + tw.join(' ') + ' ').includes(' ' + k + ' ')) s += 4; continue; }
    if (tw.includes(k)) s += 3;
    else if (k.length >= 5 && tw.some((w) => w.length >= 4 && ((w.startsWith(k) && w.length - k.length <= 3) || (k.startsWith(w) && w.length >= k.length - 2)))) s += 2;
  }
  if (!s) return 0;
  if (medium) s += g.category === medium ? 3 : g.category === 'technique' ? 0 : -2;
  if (g.category === 'technique') s -= 2; // methods for a kind of piece come first; techniques when asked for
  return s;
}

// The best guides for a request, best first: [{ guide, score }]
function pick(text, n = 2) {
  const t = norm(text), tw = words(text);
  const medium = mediumOf(t);
  const ranked = load().map((g) => ({ guide: g, score: score(g, t, tw, medium) })).filter((x) => x.score > 0).sort((a, b) => b.score - a.score);
  const question = /^\s*(comment|pourquoi|quand|quel|quelle|quels|quelles|qu est|est ce|how|why|what|when|where|which|who|is|are|does|do|can i)\b/.test(t) || /\?\s*$/.test(t);
  const intent = INTENT.test(t) || (!question && (tw.length <= 7 || /^\s*(un|une|des|le|la|les|mon|ma|mes|a|an|the|my|our|notre|nos)\b/.test(t))); // a noun phrase is a request too
  const strong = !question && ranked.length && ranked[0].score >= 6; // "fiche de révision sur les ondes": clearly a piece to make
  if (!ranked.length || ranked[0].score < 3 || !(intent || strong)) {
    if (medium && (intent || /\b(site|pdf|slides|svg)\b/.test(t))) { const d = get(DEFAULT[medium]); return d ? [{ guide: d, score: 1 }] : []; }
    return ranked.length && ranked[0].score >= 7 && intent ? ranked.slice(0, n) : [];
  }
  return ranked.slice(0, n);
}

// ── chat: the guide(s) + the artifact format, under a budget ──
const tokens = (s) => Math.ceil(String(s || '').length / 3.6);
const FORMAT = {
  web: 'Format: answer with <artifact type="html" title="…"> then ONE complete HTML page with your own <style> (no CSS framework, no external files), then </artifact>. No Markdown inside.',
  documents: 'Format: answer with <artifact type="document" title="…"> then ONE complete HTML page with your own <style>, then </artifact>. It prints on A4 (set your own @page). No Markdown inside.',
  slides: 'Format: answer with <artifact type="slides" title="…"> then ONE HTML page with your own <style>: one <section class="slide"> per slide, each 1280×720px, then </artifact>.',
  svg: 'Format: answer with <artifact type="svg" title="…"> then ONE <svg xmlns="http://www.w3.org/2000/svg" viewBox="…">, then </artifact>.',
};
const AFTER = 'Fabro renders it and tells you what is visibly broken. Write real content in the user\'s language; make your own design choices for this subject.';
function formatFor(g, text) {
  const cat = g.category !== 'technique' ? g.category : mediumOf(norm(text)) || 'web';
  return FORMAT[cat] || FORMAT.web;
}
function clip(body, maxTok) { // keep whole lines, end on the self-check if possible
  if (tokens(body) <= maxTok) return body;
  const lines = body.split('\n'); const out = [];
  for (const l of lines) { if (tokens(out.concat(l).join('\n')) > maxTok) break; out.push(l); }
  return out.join('\n').trim();
}

function chatSection(userText, { budgetTokens = 900 } = {}) {
  const picks = pick(userText, 2);
  if (!picks.length) return '';
  const [first, second] = picks.map((p) => p.guide);
  const head = `## Guide for this request: ${first.title}\n${formatFor(first, userText)}\n${AFTER}`;
  const budget = Math.max(200, budgetTokens);
  let out = `${head}\n\n${clip(first.body, budget - tokens(head) - 8)}`;
  if (second && picks[1].score >= picks[0].score * 0.6) {
    const add = `\n\n## Also useful: ${second.title}\n${second.body}`;
    if (tokens(out + add) <= budget) out += add;
  }
  return out;
}

// ── agent: design_guide ──
function guide(kind) {
  const exact = get(kind);
  const picks = exact ? [{ guide: exact, score: 99 }] : pick(String(kind || '') + ' make', 3);
  if (!picks.length) {
    return `No guide matches “${kind}”. Guides:\n${load().map((g) => `- ${g.name}: ${g.when}`).join('\n')}\nCall design_guide again with one of these names.`;
  }
  const g = picks[0].guide;
  const others = picks.slice(1).map((p) => p.guide).concat(load().filter((x) => x.category === 'technique' && picks[0].guide.body.includes(x.name)))
    .filter((x, i, a) => x !== g && a.indexOf(x) === i).slice(0, 4);
  return [`# Guide: ${g.title} (${g.name})`, g.body,
    others.length ? `Related guides (call design_guide with the name if you need one):\n${others.map((x) => `- ${x.name}: ${x.when}`).join('\n')}` : '',
    'Build it with create_artifact (a complete HTML page with your own <style>), then look at the check result and fix every ✗.'].filter(Boolean).join('\n\n');
}
const kindsList = () => load().map((g) => g.name);

module.exports = { list, get, pick, chatSection, guide, kindsList, parseFront, tokens, mediumOf, ROOT, _reset: () => { CACHE = null; } };

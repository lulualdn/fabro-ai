// Design guidance for artifacts, written for small models: what to think about, the Fabro Kit classes to use,
// and a complete example page of the same kind to follow (blueprints/). Served by the design_guide tool and,
// in chat, added to the system prompt when the user asks for something visual.
const fs = require('fs');
const path = require('path');

const THEMES = 'fabro (warm, default) · ocean (SaaS, tech, trust) · forest (nature, food, wellness) · sunset (events, energy, youth) · midnight (dark: tech, gaming, dashboards) · luxe (dark premium: gastronomy, hotel, jewellery) · mono (minimal: portfolio, architecture) · candy (playful: kids, pastry) · paper (editorial: blog, books, culture) · tech (dark developer/cyber) · corporate (business, finance, reports)';

const KINDS = {
  landing: { mode: 'web', file: 'landing', name: 'landing page (product, startup, service, app, association)', theme: 'ocean/sunset/fabro', outline: 'nav → hero (promise + 1-2 buttons + picture) → logos/social proof → 3 features → how it works / split image → numbers (stats) → testimonials → pricing (if relevant) → FAQ → final call to action → footer' },
  event: { mode: 'web', file: 'landing', name: 'event page (wedding, party, concert, conference)', theme: 'sunset/luxe/candy', outline: 'nav → hero.image with date/place → programme (timeline) → speakers/artists (cards) → practical info (map address, times, prices) → FAQ → register/RSVP form → footer' },
  portfolio: { mode: 'web', file: 'portfolio', name: 'portfolio / personal site', theme: 'mono/paper', outline: 'nav → hero (who + what you do + contact button) → selected work (cards with pictures) → about (split + timeline) → contact CTA → footer' },
  business: { mode: 'web', file: 'restaurant', name: 'local business (restaurant, café, shop, hotel, craftsman)', theme: 'forest/luxe/fabro', outline: 'nav → hero.image (atmosphere + book/call button) → offer/menu (cards with photos and prices) → story (split) → reviews → visit (address, hours, phone) + booking form → footer' },
  dashboard: { mode: 'web', file: 'dashboard', name: 'dashboard / statistics / admin screen', theme: 'midnight/corporate', outline: 'title row with period + export → KPI row (.kpi) → main chart (.grid-2-1: area/line + donut) → table of details → notes' },
  article: { mode: 'web', file: 'article', name: 'article, blog post, guide, tutorial, info page', theme: 'paper/fabro', outline: 'nav → .narrow article: eyebrow + h1 + lead + author → image → sections with h2, short paragraphs, quote, chart or callout, lists → footer' },
  app: { mode: 'web', file: 'app', name: 'small app or tool (calculator, quiz, game, planner, converter, to-do)', theme: 'any', outline: 'title + one-line explanation → the controls (form in a .card) → the result, big and clear (.kpi) → history/list (table) — all logic in one <script> at the end of <body>, works without network' },
  report: { mode: 'doc', file: 'report', name: 'report, study, presentation document, school dossier', theme: 'corporate/paper/forest', outline: 'cover page → summary with key figures (.kpis) and a chart → one section per topic (h2, short paragraphs, tables, callouts) → conclusion / next steps; page numbers in .doc-foot' },
  cv: { mode: 'doc', file: 'cv', name: 'CV / résumé', theme: 'ocean/mono/corporate', outline: 'one A4 page: side column (photo, contact, skills with bars, languages, interests) + main column (name, role, 2-line profile, experience entries with 2 bullet results each, education)' },
  letter: { mode: 'doc', file: 'letter', name: 'letter (cover letter, formal letter, complaint, request)', theme: 'paper/mono', outline: 'sender → recipient (right) → place + date → subject (bold) → greeting → 3-4 short paragraphs → closing formula → signature' },
  invoice: { mode: 'doc', file: 'invoice', name: 'invoice, quote, receipt, order form', theme: 'mono/corporate', outline: 'logo + company details | INVOICE + number/dates → billed to | project → items table (description, qty, unit price, total) → subtotal / VAT / total due → payment terms (IBAN, due date, legal mentions)' },
  flyer: { mode: 'doc', file: 'flyer', name: 'flyer, poster, invitation', theme: 'sunset/candy/luxe', outline: 'one fixed page: big photo on top → eyebrow + huge title + one sentence → 3 info blocks (date, place, how to join) at the bottom' },
  menu: { mode: 'doc', file: 'menu', name: 'menu, price list', theme: 'luxe/forest/paper', outline: 'centred header (name, season) → sections (Starters, Mains, Desserts…) → .dish lines with dotted leaders and prices + one-line description → allergens / prices note' },
  certificate: { mode: 'doc', file: null, name: 'certificate, diploma, award', theme: 'luxe/paper', outline: 'one landscape page (<body class="doc landscape">): <section class="page fixed certificate"> eyebrow, title, "awarded to", .name (big), reason, date + signature row' },
  slides: { mode: 'deck', file: 'deck', name: 'slide deck / presentation', theme: 'midnight/ocean/fabro', outline: '8-12 slides: title → problem/context → one key number (.big) → section → 3 ideas (.grid cards) → evidence (split with chart or photo) → quote → conclusion/next steps → thank you. ONE idea per slide, at most 5 bullets of ≤ 10 words' },
  svg: { mode: 'svg', file: null, name: 'drawing: logo, icon, illustration, diagram', theme: '-', outline: 'viewBox="0 0 W H", 2-4 colours, simple geometric shapes, consistent stroke width, centred; logo = symbol + name; diagram = boxes, arrows, short labels (font-family="Inter, sans-serif")' },
};

const CHEAT = {
  web: `Fabro Kit (included automatically — write plain HTML with these classes, no CSS framework needed):
- <body data-theme="THEME"> themes: ${THEMES}. Colours via CSS variables only: var(--accent) var(--accent-2) var(--text) var(--muted) var(--bg) var(--surface) var(--line).
- Layout: .container (centred) · .narrow (reading width) · .section (+ .alt grey band, .dark, .accent, .tight) · .section-head(.center) · .grid (auto columns) .grid-2 .grid-3 .grid-4 .grid-2-1 · .split (text + image, .reverse) · .stack · .row
- Nav: <nav class="nav"><div class="container"><a class="logo">…</a><div class="links"><a>…</a></div><a class="btn sm">…</a></div></nav> (phone menu automatic)
- Hero: <header class="hero glow center"> (or .hero.image data-photo="…" for a full photo background) with .eyebrow, <h1>, p.lead, div.actions of .btn
- Blocks: .card (.hover) · .feature (icon + h3 + p) · .stats > .stat(.num .label) · .kpi(.label .num .delta[.down]) · ol.steps · ul.timeline (.when) · .pricing > .plan(.featured data-label="Popular", .price) · figure.quote(.who .avatar) · .faq > details/summary · .cta · .logos · .gallery · .callout(.info .ok .warn .danger) · .table-wrap > table.zebra · .progress(style="--value:70%") · .badge .tag · form.form > .field(label + input) · footer.footer(.cols)
- Buttons: .btn · .btn.ghost · .btn.light · .btn.lg/.sm/.block
- Icons: <i data-icon="NAME"></i> (rocket, zap, star, heart, check, mail, phone, pin, calendar, chart, user, globe, shield, sparkle, home, cart, tag, gift, award, target, truck, coffee, music, camera, book, code, cloud, lock, search, download, play…)
- Pictures of a specific real subject (game, product, place, person, brand…): call web_images first and use the URLs it returns (screenshots, YouTube frames, official pictures). Generic photos: <img data-photo="2-4 concrete English words" alt="…"> → Fabro inserts a real free photo (with credit). Never invent image URLs.
- Charts: <figure class="chart" data-chart='{"type":"bar|hbar|line|area|pie|donut","title":"…","labels":["A","B"],"data":[3,5],"unit":"€"}'></figure> (several lines: "series":[{"name":"2025","data":[…]}])
- Motion: add class="reveal" to blocks that should fade in.`,
  doc: `Fabro Kit for documents (included automatically; printed as PDF):
- <body class="doc" data-theme="THEME"> (add class landscape for landscape; data-page="A5|A3|Letter" for other sizes). Themes: ${THEMES}.
- Pages: each <section class="page"> is one A4 sheet (18 mm margins). Add .fixed when it must stay one page (cover, CV, flyer, menu). Without .page sections the text flows over pages.
- Cover: <section class="page fixed cover"><div class="top">…</div><div><h1>…</h1><p class="sub">…</p></div><div class="bottom">…</div></section> (.cover.light for white)
- Page parts: .doc-head (title line) · .doc-foot (page number at the bottom) · .lede · dl.meta (dt/dd) · .kpis > .kpi · .grid-2 / .grid-3 · .card · .callout(.info .ok .warn) · .two-col · figure.chart data-chart='…' · table.items (+ td.num)
- CV: <section class="page fixed cv"><aside class="cv-side">(img.photo, h4, ul, .skill + .progress)</aside><main class="cv-main">(h1, p.role, h2, .entry > .entry-head(h3 + .date) + .org + ul)</main></section>
- Letter: .letter > .from .to .date .subject … .sign(.name) · Invoice: .inv-head, .inv-title, .parties(h4), table.items, .totals(.grand) · Menu: .menu-section(h2) .dish(.price) + p.dish-desc · Poster: .page.fixed.poster > img.poster-media + .poster-body(h1, .info) · Certificate: .page.fixed.certificate .name
- Icons <i data-icon="…">, photos <img data-photo="…">, charts as for web pages. No Markdown: real HTML.`,
  deck: `Fabro Kit for slides (16:9, 1280×720, printed as PDF):
- <body class="deck" data-theme="THEME"> then one <section class="slide"> per slide. Themes: ${THEMES}.
- Slide kinds: .slide.title (opening/closing: .kicker, h1, p) · .slide (h2 + up to 5 short bullets) · .slide.section (accent page: .kicker + h2) · .slide.big (.num huge number + one line) · .slide.split (two columns: text + img or chart) · .slide.grid (h2 + div.cards of 3-4 <div><strong>Title</strong>text</div>) · .slide.quote (blockquote + who) · .slide.image (data-photo full background, text at the bottom)
- Charts, icons and photos as for web pages. Slide numbers are added automatically.`,
  svg: `SVG drawing rules: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 W H"> with simple shapes (rect, circle, path), 2-4 harmonious colours, consistent stroke widths, shapes aligned on a grid, generous margins, text only if useful (font-family="Inter, Arial, sans-serif", ≥ 14px). No external images.`,
};

const THINK = {
  web: `Think through every aspect before writing:
1. Goal & audience: who visits, what must they do (the main button)?
2. Real content in the user's language: names, numbers, prices, dates, addresses — specific and plausible, never lorem ipsum or [placeholders].
3. Structure: follow the outline below; every section has a purpose.
4. Look: pick the theme that fits the mood; one accent colour; generous spacing; photos via data-photo; icons via data-icon. Don't override the kit with your own colours or fonts unless asked.
5. Phones: no fixed widths, no huge fixed heights; kit grids collapse by themselves.
6. Accessibility: one <h1>, headings in order, alt on images, labels on inputs, readable contrast.
7. Interactivity (if any): plain JavaScript in one <script> at the end of <body>; a library only if really needed (find_library gives the exact CDN URL).
8. Details: <title>, <meta name="description">, <html lang="…">, working anchor links (#features…), footer.`,
  doc: `Think through every aspect before writing:
1. Purpose: who reads it, printed or on screen, what decision or action it supports.
2. Real content in the user's language (names, figures, dates, amounts that add up) — never placeholders.
3. Pages: decide what goes on each page; a cover for reports; nothing cut at the bottom of a fixed page; no nearly empty last page.
4. Hierarchy: one h1, clear h2 sections, short paragraphs, tables for numbers, a chart when it helps, callouts for key points.
5. Look: a theme that fits (corporate/paper for serious, sunset/candy for fun); no Markdown, real HTML with the kit classes.`,
  deck: `Think through every aspect before writing:
1. The story: what should the audience remember? Title → context → key message(s) → evidence → conclusion.
2. One idea per slide, big text, at most 5 bullets of ≤ 10 words; numbers as .slide.big; vary the slide kinds.
3. Real content in the user's language; photos (data-photo) and charts where they help.`,
  svg: `Think: what must it evoke at a glance? Keep it simple, balanced and recognisable at small size.`,
};

const read = (f) => { try { return fs.readFileSync(path.join(__dirname, 'blueprints', f + '.html'), 'utf8'); } catch { return ''; } };
const kindsList = () => Object.keys(KINDS);

// Text of the design_guide tool.
function guide(kind) {
  const k = KINDS[kind] || KINDS.landing; const id = KINDS[kind] ? kind : 'landing';
  const bp = k.file ? read(k.file) : '';
  return [`# Design guide: ${k.name}`, `Suggested themes: ${k.theme}. Outline: ${k.outline}.`, THINK[k.mode], CHEAT[k.mode],
    bp ? `## Complete example to follow (adapt the content, keep the structure and classes; replace the language and topic)\n\`\`\`html\n${bp}\`\`\`` : '',
    k.mode === 'svg' ? '' : 'After creating it, look at the check result (pictures + problems) and fix every ✗ before telling the user it is done.',
  ].filter(Boolean).join('\n\n') + (id !== kind && kind ? `\n\n(“${kind}” is not a known kind; showing landing. Kinds: ${kindsList().join(', ')}.)` : '');
}

// What the user wants, from their words (any of the app's languages).
const RX = [
  ['slides', /\b(slides?|diapos?|diaporama|pr[ée]sentation|presentaci[oó]n|präsentation|deck|powerpoint|pptx?|pitch)\b/i],
  ['cv', /\b(cv|curriculum|lebenslauf)\b|r[ée]sum[ée](?![a-zà-ÿ])(?!.*\b(ce|this|le|la|les|du|de la)\b)|\bresume\b(?=.*\b(job|work|my)\b)/i],
  ['letter', /\b(lettre|letter|carta|brief|courrier|motivation)\b/i],
  ['invoice', /\b(facture|invoice|factura|rechnung|devis|quote|quotation|re[çc]u|receipt|bon de commande)\b/i],
  ['menu', /\b(menu|carte des (plats|vins)|price list|tarifs?)\b/i],
  ['certificate', /\b(certificat|certificate|dipl[oô]me|diploma|attestation|award|urkunde)\b/i],
  ['flyer', /\b(flyer|affiche|poster|invitation|tract|plakat|cartel)\b/i],
  ['report', /\b(rapport|report|bilan|[ée]tude|dossier|expos[ée]|compte[- ]rendu|informe|bericht|pdf|brochure|livret|fiche)\b/i],
  ['dashboard', /\b(dashboard|tableau de bord|statisti|analytics|kpi|admin)\b/i],
  ['portfolio', /\b(portfolio|site perso|personal (site|website)|mon site)\b/i],
  ['business', /\b(restaurant|caf[ée]|bar|boulangerie|bakery|h[oô]tel|boutique|shop|salon|artisan|plombier|coiffeur|magasin|tienda)\b/i],
  ['event', /\b(mariage|wedding|anniversaire|birthday|f[êe]te|party|concert|festival|conf[ée]rence|conference|[ée]v[ée]nement|event|soir[ée]e)\b/i],
  ['app', /\b(calculat|quiz|jeu|game|outil|tool|convertisseur|converter|todo|to-do|planner|planificateur|minuteur|timer|simulat|application web|web app|appli)\b/i],
  ['article', /\b(article|blog|guide|tutoriel|tutorial|news|actualit)\b/i],
  ['svg', /\b(logo|svg|ic[oô]ne|icon|illustration|dessin|drawing|sch[ée]ma|diagram|diagramme)\b/i],
  ['landing', /\b(site|website|page web|web ?page|landing|page d'accueil|homepage|html|vitrine|startup|saas)\b/i],
];
const WEBWORDS = /\b(site|website|sitio|webseite|page web|web ?page|landing|html|appli(cation)?|web app|app|interface|dashboard|tableau de bord)\b/i;
const PRINTWORDS = /\b(pdf|imprim\w*|print\w*|word|docx|a4|papier|paper)\b/i;
function detect(text) {
  const t = String(text || '');
  // the medium decides first: "a website for my restaurant with the menu" is a web page, not a printed menu
  const want = WEBWORDS.test(t) && !PRINTWORDS.test(t) ? 'web' : PRINTWORDS.test(t) && !WEBWORDS.test(t) ? 'doc' : null;
  for (const [kind, re] of RX) {
    const mode = KINDS[kind].mode;
    if (want === 'web' && mode !== 'web' && mode !== 'svg') continue;
    if (want === 'doc' && mode === 'web') continue;
    if (re.test(t)) return { kind, mode };
  }
  if (want === 'web') return { kind: 'landing', mode: 'web' };
  if (want === 'doc') return { kind: 'report', mode: 'doc' };
  return null;
}

// Added to the chat system prompt when the user asks for something visual: rules + kit + one example.
function chatSection(text) {
  const d = detect(text); if (!d) return '';
  const k = KINDS[d.kind];
  const type = d.mode === 'web' ? 'html' : d.mode === 'doc' ? 'document' : d.mode === 'deck' ? 'slides' : 'svg';
  const bp = k.file ? read(k.file) : '';
  return [`## Making a ${k.name}`,
    `Write it as <artifact type="${type}" title="…">…</artifact> containing a complete HTML page${type === 'svg' ? ' (here: one <svg>)' : ''} built with the Fabro Kit below. No Markdown inside. Suggested themes: ${k.theme}. Outline: ${k.outline}.`,
    THINK[d.mode], CHEAT[d.mode],
    bp ? `Example of the same kind (follow its structure and classes, write your own content in the user's language):\n\`\`\`html\n${bp}\`\`\`` : '',
    'Fabro renders your artifact and checks it automatically (phone + desktop, or printed pages); if something is broken you will be asked to fix it.'].filter(Boolean).join('\n\n');
}

module.exports = { KINDS, kindsList, guide, detect, chatSection, CHEAT, THEMES };

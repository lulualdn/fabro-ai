// Cheap situation signals for the adaptive system prompt: everything here is computed from data the
// chat runtime already has (messages, params, model info, tool results) — no model call, no I/O.
let langdetect = null;
try { langdetect = require('../langdetect'); } catch {}

const estTok = (s) => Math.ceil(String(s || '').length / 3.3);
const textOf = (m) => (!m ? '' : typeof m.content === 'string' ? m.content : Array.isArray(m.content) ? m.content.map((c) => (c && c.text) || '').join(' ') : '');

// ───────────────────────────── model size class ─────────────────────────────
// tiny < 3B · small < 10B · medium < 24B · large ≥ 24B (or a cloud model). MoE models count by total size
// for knowledge but by active size for "how well it follows long instructions": we use the active size when
// the name says it (A3B, A4B…), which matches how they behave with long prompts.
function paramsOf(name) {
  const s = String(name || '');
  const act = s.match(/\bA(\d+(?:\.\d+)?)B\b/i); if (act) return { b: +act[1], moe: true };
  const e = s.match(/\bE(\d+(?:\.\d+)?)B\b/i); if (e) return { b: +e[1] };
  const all = [...s.matchAll(/(\d+(?:\.\d+)?)\s*([BM])\b/gi)].map((m) => (m[2].toUpperCase() === 'M' ? +m[1] / 1000 : +m[1]));
  return all.length ? { b: Math.max(...all) } : null;
}
function sizeClass({ cloud = false, name = '', b = null } = {}) {
  if (cloud) return 'large';
  const p = b != null ? { b } : paramsOf(name);
  if (!p) return 'small'; // unknown local model: assume small, it is the safe side
  return p.b < 3 ? 'tiny' : p.b < 10 ? 'small' : p.b < 24 ? 'medium' : 'large';
}

// ───────────────────────────── kind of request ─────────────────────────────
// Several kinds can be true at once ("search the web and write a report" = research + writing + multistep).
const KIND_RE = {
  smalltalk: /^\s*(salut|bonjour|bonsoir|coucou|hello|hi|hey|yo|merci|thanks|thank you|ok|d'accord|cool|super|hola|gracias|hallo|danke)[\s!.,?🙂😊]*$/i,
  question: /(\?\s*$|^\s*(what|why|how|when|where|who|which|is|are|can|could|does|do|explain|quoi|pourquoi|comment|quand|où|qui|quel|quelle|quels|quelles|est-ce|c'est quoi|qu'est-ce|explique|peux-tu m'expliquer|qué|por qué|cómo|was|warum|wie|wo|wer)\b)/i,
  writing: /\b(write|draft|rewrite|rephrase|translate|proofread|letter|e-?mail|essay|article|story|poem|summary|summari[sz]e|[ée]cris|[ée]crire|r[ée]dige|r[ée]diger|reformule|traduis|traduire|corrige (ce|mon|le) texte|lettre|courriel|mail|dissertation|r[ée]sum[ée]|r[ée]sumer|histoire|po[èe]me|discours|escribe|redacta|carta|schreib|brief)\b/i,
  code: /(```|\b(code|script|function|fonction|bug|debug|d[ée]bogue|stack ?trace|exception|compile|regex|python|javascript|typescript|node|npm|pip|java|c\+\+|rust|golang|lua|luau|sql|html|css|api|json|yaml|git|commit|refactor|unit test|tests? unitaires?|programme|programmer)\b)/i,
  research: /\b(search|look up|find out|research|latest|news|compare|comparison|sources?|price|prices|review|best .* (for|to)|cherche|recherche|renseigne|trouve(-moi)? des|actualit[ée]s?|derni[èe]res? (nouvelles|infos|version)|compare[rz]?|comparatif|prix|tarifs?|avis|meilleur|busca|investiga|suche|recherchiere)\b/i,
  build: /\b(site( web)?|website|web ?page|page web|landing|portfolio|web ?app|application web|dashboard|tableau de bord|slides?|diapos?|diaporama|pr[ée]sentation|presentation|deck|pdf|cv|resume|flyer|affiche|poster|invitation|menu|facture|invoice|certificat|certificate|brochure|newsletter|logo|infographi[ce]|svg|dessin|drawing|tableur|spreadsheet|excel|word|powerpoint|document)\b/i,
  computer: /\b(screen|[ée]cran|click|clique[rz]?|mouse|souris|keyboard|clavier|open (the )?app|ouvre (l'app|l'application|le logiciel)|desktop|bureau|window|fen[êe]tre|discord|whatsapp|spotify|teams|slack|outlook|paint|notepad|bloc-notes|explorer|finder|settings app|param[èe]tres windows|computer use)\b/i,
  files: /([a-z]:\\|~\/|\/(home|users|tmp|mnt)\/|\.(txt|md|csv|xlsx?|docx?|pptx?|pdf|json|py|js|png|jpe?g|zip)\b|\b(file|files|fichier|fichiers|dossier|folder|directory|r[ée]pertoire|t[ée]l[ée]chargements|downloads|documents)\b)/i,
  schedule: /\b(every (day|morning|evening|week|monday|tuesday|wednesday|thursday|friday|saturday|sunday|hour)|tomorrow at|each (day|week)|remind me|tous les (jours|matins|soirs|lundis?|mardis?|mercredis?|jeudis?|vendredis?|samedis?|dimanches?)|chaque (jour|semaine|matin|soir|lundi|mardi|mercredi|jeudi|vendredi)|demain [àa] \d|rappelle-moi|planifie)\b/i,
};
const ACTION_RE = /\b(cr[ée]e|cr[ée]er|fais|faire|am[ée]liore|optimise|nettoie|organise|r[ée]pare|improve|optimi[sz]e|clean|organi[sz]e|ouvre|ouvrir|lance|lancer|ex[ée]cute|installe|t[ée]l[ée]charge|[ée]cris|[ée]crire|modifie|corrige|range|trie|renomme|d[ée]place|copie|supprime|cherche|recherche|trouve|liste|lis|r[ée]sume|analyse|compare|g[ée]n[èe]re|pr[ée]pare|envoie|remplis|connecte|teste|v[ée]rifie|mesure|calcule|[ée]value|convertis|create|make|build|open|run|execute|install|download|write|edit|fix|move|rename|copy|delete|search|find|list|read|summari[sz]e|analy[sz]e|compare|generate|prepare|fill|test|check|measure|compute|calculate|evaluate|convert|crea|haz|abre|ejecuta|busca|erstelle|mach|öffne|suche|finde)\b/i;
const MULTI_RE = /\b(then|and then|after that|next|finally|step|puis|ensuite|apr[èe]s (ça|cela)|enfin|et aussi|[ée]tape|luego|despu[ée]s|dann|danach)\b|(^|\n)\s*(\d+[.)]|[-*•])\s+\S/i;

function kinds(text, { attachments = {} } = {}) {
  const t = String(text || '').slice(0, 4000);
  const out = new Set();
  for (const [k, re] of Object.entries(KIND_RE)) if (re.test(t)) out.add(k);
  if (attachments.files) out.add('files');
  const actions = (t.match(new RegExp(ACTION_RE.source, 'gi')) || []).length;
  if (actions) out.add('action');
  if ((actions >= 2 && MULTI_RE.test(t)) || (actions >= 3) || (actions && t.length > 400)) out.add('multistep');
  if (out.has('smalltalk')) { out.delete('question'); }
  if (!out.size) out.add(t.trim() ? 'question' : 'smalltalk');
  return out;
}

function language(text, hint = 'en') {
  const t = String(text || '');
  if (!t.trim()) return hint;
  try { if (langdetect && langdetect.detect) return langdetect.detect(t, hint) || hint; } catch {}
  return hint;
}

// ───────────────────────────── frustration ─────────────────────────────
// The user corrects us, says no, or repeats himself → be careful, restate the goal, do exactly that.
const FRUSTRATION_RE = /(^\s*(non|no|nope|nan|nein)\b[\s,.!]|pas ce que (j'ai|je t'ai|je) demand|c'est pas (ça|ce que)|ce n'est pas (ça|ce que)|t'as pas compris|tu n'as pas compris|tu as mal compris|je t'ai (dit|demand[ée])|j'ai dit|encore une fois|pour la (deuxi[èe]me|troisi[èe]me|ni[èe]me) fois|toujours pas|[çc]a marche (toujours )?pas|arr[êe]te de|ne me demande pas|fais[- ]le( juste)?\b|je (te )?r[ée]p[èe]te|not what i (asked|wanted|meant)|that's not (it|what)|you didn'?t|i (already )?(said|told you|asked)|again[!.]|stop asking|just do it|wrong[!.]|still (not|doesn'?t)|doesn'?t work|that'?s wrong|no[,.!] i (said|meant|want))/i;
const words = (s) => new Set(String(s || '').toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || []);
function similarity(a, b) {
  const A = words(a), B = words(b); if (!A.size || !B.size) return 0;
  let n = 0; for (const w of A) if (B.has(w)) n++;
  return n / Math.max(A.size, B.size);
}
function frustration(userMsgs) {
  const last = userMsgs[userMsgs.length - 1] || '';
  const prev = userMsgs[userMsgs.length - 2] || '';
  if (FRUSTRATION_RE.test(last)) return 'correction';
  if (prev && last.length > 12 && similarity(last, prev) >= 0.7) return 'repeated';
  return null;
}

// ───────────────────────────── conversation shape ─────────────────────────────
function conversation(messages) {
  const users = messages.filter((m) => m.role === 'user');
  const attach = { files: 0, images: 0 };
  const last = users[users.length - 1];
  if (last && Array.isArray(last.content)) for (const p of last.content) if (p && p.type === 'image_url') attach.images++;
  const lt = textOf(last);
  // attached files are copied into the workspace and named in the message by the renderer
  attach.files = (lt.match(/(^|\n)(Attached file|File): /g) || []).length;
  const userTexts = users.map(textOf);
  const tokens = messages.reduce((n, m) => n + estTok(textOf(m)), 0);
  return { userTurns: users.length, first: users.length <= 1, long: users.length >= 8 || tokens > 6000, attach, userTexts, lastUser: lt };
}

// Context pressure: share of the context window already used by the messages (system prompt excluded).
function pressure(msgs, ctx) {
  if (!ctx) return 0;
  let n = 0;
  for (const m of msgs) {
    if (m.role === 'system') continue;
    if (Array.isArray(m.content)) n += m.content.reduce((a, p) => a + (p && p.type === 'image_url' ? 1000 : estTok(p && p.text)), 0);
    else n += estTok(m.content);
    if (m.tool_calls) n += estTok(JSON.stringify(m.tool_calls));
  }
  return Math.min(1, n / ctx);
}

module.exports = { estTok, textOf, paramsOf, sizeClass, kinds, language, frustration, similarity, conversation, pressure, ACTION_RE, KIND_RE, FRUSTRATION_RE };

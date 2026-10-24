// Chat mode has no tools, so Fabro looks at the artifacts itself: when an answer contains a web page, a
// document, HTML slides or a drawing, it is rendered and checked (qa.js). If something is visibly broken the
// chat loop sends the model back with the problems (and the picture when the model can see), once or twice.
const qa = require('./qa');

const attrs = (s) => { const o = {}; for (const m of String(s).matchAll(/(\w+)\s*=\s*"([^"]*)"/g)) o[m[1].toLowerCase()] = m[2]; return o; };
function normType(t, body) { // same rules as the renderer (artifacts-ui.js)
  t = String(t || '').toLowerCase();
  if (/sheet|calc|spreadsheet|excel|xlsx|csv|tableur|table/.test(t)) return 'sheet';
  if (/slide|deck|present/.test(t)) return 'slides';
  if (/svg|draw/.test(t)) return 'svg';
  if (/^(document|doc|pdf|print|report|cv|letter|invoice|flyer|poster|menu)/.test(t)) return 'document';
  if (/html|page|web|site|app/.test(t)) return 'html';
  if (/code|script|program/.test(t)) return 'code';
  if (/^\s*<svg/i.test(body)) return 'svg';
  if (/^\s*(<!doctype|<html)/i.test(body)) return /<body[^>]*class\s*=\s*["'][^"']*\bdoc\b/i.test(body) ? 'document' : 'html';
  return 'markdown';
}
function visualArtifacts(text) {
  const out = [];
  for (const m of String(text || '').matchAll(/<artifact\b([^>]*)>([\s\S]*?)<\/artifact>/gi)) {
    const a = attrs(m[1]); const body = m[2].trim(); const type = normType(a.type, body);
    if (type === 'html' || type === 'document' || type === 'svg' || (type === 'slides' && /<section/i.test(body))) out.push({ type, title: a.title || type, body });
  }
  return out;
}

// → null when there is nothing to check; else { ok, problems: [{ title, errors }], image, summary }
async function review(text, { onStatus = () => {} } = {}) {
  const arts = visualArtifacts(text).slice(0, 2);
  if (!arts.length) return null;
  onStatus('checking');
  const problems = []; let image = null;
  for (const a of arts) {
    const r = await qa.check(a.body, { type: a.type, title: a.title }).catch(() => null);
    if (!r) continue;
    if (!image) image = r.image;
    if (!r.ok) { problems.push({ title: a.title, errors: r.errors }); if (r.image) image = r.image; }
  }
  return { ok: !problems.length, problems, image, count: problems.reduce((n, p) => n + p.errors.length, 0) };
}

function fixMessage(res, vision) {
  return `[Fabro visual check] I rendered your artifact${res.problems.length > 1 ? 's' : ''} (desktop + phone, or printed pages)${vision ? ' — picture attached' : ''} and found visible problems:\n` +
    res.problems.map((p) => `“${p.title}”:\n${p.errors.map((e) => '✗ ' + e).join('\n')}`).join('\n\n') +
    '\n\nWrite your answer again with the corrected artifact: same title, the COMPLETE content (not just the changed part), keeping everything that already works. Fix every ✗.';
}

module.exports = { review, fixMessage, visualArtifacts, normType };

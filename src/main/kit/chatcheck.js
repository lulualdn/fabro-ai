// Chat mode has no tools, so Fabro looks at the artifacts itself: when an answer contains a web page, a
// document, HTML slides or a drawing, it is rendered and checked (qa.js). If something is visibly broken the
// chat loop sends the model back with the problems (and the picture when the model can see), once or twice.
// The message back is short and concrete: what is broken, where, and the usual fix — never a design to follow.
const qa = require('./qa');
const parse = require('./artparse');

const normType = parse.normType;
function visualArtifacts(text) {
  return parse.artifacts(text) // an unclosed tag at the end of the answer counts: the stream is over
    .filter((a) => a.type === 'html' || a.type === 'document' || a.type === 'svg' || (a.type === 'slides' && /<section/i.test(a.body)))
    .map((a) => ({ type: a.type, title: a.title || a.type, body: a.body.trim() }))
    .filter((a) => a.body.length > 20);
}

// → null when there is nothing to check; else { ok, problems: [{ title, errors }], image, count }
async function review(text, { onStatus = () => {} } = {}) {
  const arts = visualArtifacts(text).slice(0, 2);
  if (!arts.length) return null;
  onStatus('checking');
  const problems = []; let image = null;
  for (const a of arts) {
    const r = await qa.check(a.body, { type: a.type, title: a.title, legacy: false }).catch(() => null);
    if (!r) continue;
    if (!image) image = r.image;
    if (!r.ok) { problems.push({ title: a.title, errors: r.errors }); if (r.image) image = r.image; }
  }
  return { ok: !problems.length, problems, image, count: problems.reduce((n, p) => n + p.errors.length, 0) };
}

function fixMessage(res, vision) {
  const list = res.problems.map((p) => `${res.problems.length > 1 ? `“${p.title}”:\n` : ''}${p.errors.slice(0, 5).map((e, i) => `${i + 1}. ${e}`).join('\n')}`).join('\n\n');
  return `[Fabro visual check] I rendered your artifact${vision && res.image ? ' (picture attached)' : ''}. Problems to fix:\n${list}\n\n` +
    'Send the whole artifact again, fixed: same <artifact> tag and title, complete content. Change only what is needed; keep your design.';
}

module.exports = { review, fixMessage, visualArtifacts, normType };

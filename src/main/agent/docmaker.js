// make_document: the chat model hands a complete brief to a specialised sub-agent that only makes the piece
// (a document / PDF, slides or a web page). The sub-agent gets the guide for that kind of piece and the layout rules
// in its task, works with its own fresh context, checks the result and fixes it. Its steps stay out of the chat:
// the user sees one line while it works, then the artifact card.
// Changes afterwards go through edit_artifact (only the lines to change), never a second full rewrite.
const agent = require('./index');

const KINDS = { document: 'documents', pdf: 'documents', slides: 'slides', web: 'web', site: 'web', page: 'web' };
const TYPE = { documents: 'document', slides: 'slides', web: 'html' };

const RULES = {
  documents: [
    'A4 pages. Nothing important is cut between two pages: a framed box, a table row, a figure and its caption stay in one piece (break-inside: avoid); a title is never the last line of a page (break-after: avoid).',
    'Start with a real first page: title, one-line subtitle, date or author. Then the content, with a clear hierarchy (one h1, h2 per part, short paragraphs).',
    'One accent colour and neutral greys. No random green or blue boxes: a box is for one key idea, with light background and enough padding.',
    'Use numbers, a small table or a simple diagram (inline SVG) where the content has data. Icons as inline SVG, one style.',
  ],
  slides: [
    'Each slide is <section class="slide"> at 1280×720. One idea per slide, a short title, at most 5 short lines. Nothing overflows the slide.',
    'A title slide first, a closing slide last. Vary the layouts (title + picture, two columns, one big number, quote).',
    'Large type (titles 44px+, text 24px+). One accent colour. Pictures or inline SVG diagrams on most slides.',
  ],
  web: [
    'One complete HTML page with its own <style>. Responsive (phone and desktop), real navigation if there are sections, no placeholder text.',
    'A clear first screen: what it is, one action. Consistent spacing scale, one accent colour, readable contrast.',
    'Interactions work (buttons, menus, forms answer). No external build step; libraries only from a CDN when needed.',
  ],
};

agent.register({
  name: 'make_document', category: 'design', risk: 'read', core: true, topLevelOnly: true,
  keywords: ['document', 'pdf', 'rapport', 'report', 'slides', 'présentation', 'presentation', 'powerpoint', 'site', 'page web', 'website', 'cv', 'lettre'],
  description: 'Have a specialised designer sub-agent make a finished piece: a document / PDF, a slide deck or a web page. Prefer it to writing the page yourself. Give it EVERYTHING it needs in `brief`: the purpose, the audience, the full content (facts, figures, text, sources you found), the tone and any wish about the look. It cannot see this conversation. It returns the artifact; to change it afterwards use edit_artifact with only the lines to change.',
  parameters: {
    type: 'object',
    properties: {
      kind: { type: 'string', enum: ['document', 'slides', 'web'], description: 'document: report, letter, CV, PDF… · slides: a deck · web: a page or small site' },
      title: { type: 'string' },
      brief: { type: 'string', description: 'Complete instructions and all the content. The designer knows nothing else.' },
      images: { type: 'boolean', description: 'true (default) to illustrate it with pictures found on the web and icons; false for text only' },
    },
    required: ['kind', 'title', 'brief'],
  },
  summarize: (a) => String(a.title || a.kind || ''),
  async run(a, ctx) {
    if (!ctx.spawnSub) throw new Error('make_document is not available here: use create_artifact.');
    const fam = KINDS[String(a.kind || '').toLowerCase()] || 'documents';
    const brief = String(a.brief || '').trim();
    if (brief.length < 40) return { content: 'The brief is too short. Give the purpose, the audience and the full content: the designer cannot see the conversation.', isError: true };
    let guide = '';
    try { guide = require('../kit/guide').guide(`${fam === 'documents' ? 'document report' : fam === 'slides' ? 'slides talk deck' : 'web page'} ${a.title || ''}`); } catch {}
    const pics = a.images === false ? 'No pictures: text, tables and inline SVG only.'
      : 'Illustrate it: look for fitting pictures with your image search tool (web_images) and place them with a caption or credit; add simple inline SVG icons next to key points. Visual quality comes first, but every picture must serve the content.';
    const task = [
      `You are a designer. Make one finished piece: ${fam === 'documents' ? 'a document (it will be exported to PDF)' : fam === 'slides' ? 'a slide deck' : 'a web page'} titled "${String(a.title || '').slice(0, 120)}".`,
      `# Brief (everything you know)\n${brief.slice(0, 24000)}`,
      `# Rules\n${RULES[fam].map((r) => `- ${r}`).join('\n')}\n- ${pics}\n- Keep all the relevant content of the brief; do not invent facts or figures.`,
      guide ? `# Method for this kind of piece\n${guide.slice(0, 9000)}` : '',
      `# How to work\n1. Decide the structure and the look (two lines, for yourself).\n2. Build it with create_artifact (type "${TYPE[fam]}", title "${String(a.title || '').slice(0, 120)}"): one complete HTML page with your own <style>.\n3. Read the check result. Fix every problem with edit_artifact (only the lines to change), and check again.\n4. Answer with one short sentence: what you made and anything the user should know. Do not paste the page.`,
    ].filter(Boolean).join('\n\n');
    const r = await ctx.spawnSub({ description: String(a.title || a.kind).slice(0, 80), task, model: 'complex', quiet: true });
    const art = (r.artifacts || []).slice(-1)[0];
    if (!art) return { content: `The designer did not produce the piece${r.error ? ` (${String(r.error).slice(0, 200)})` : ''}. ${r.text ? `It said: ${r.text.slice(0, 400)}` : ''} Make it yourself with create_artifact.`, isError: true };
    return {
      content: `Made "${art.title}" (artifact ${art.artifactId}, version ${(art.v || 0) + 1}). It is shown to the user as a card. ${r.text ? `Designer's note: ${r.text.slice(0, 500)}` : ''}\nDo not paste its content. For changes, call edit_artifact with only the lines to change.`,
      view: { ...art, kind: 'artifact' },
    };
  },
});

module.exports = { RULES };

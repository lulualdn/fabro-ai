// Tiny Markdown renderer for release notes (paragraphs, "-" lists, headings, **bold**, `code`, links).
// Shared by build.js (Node) and site.js (browser). Input is escaped first: only these constructs become HTML.
(function (root) {
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const inline = (s) => esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/\[([^\]]+)\]\((https:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>');
  function md(text) {
    const out = []; let list = null, para = [];
    const flushP = () => { if (para.length) out.push('<p>' + inline(para.join(' ')) + '</p>'); para = []; };
    const flushL = () => { if (list) out.push('<ul>' + list.map((x) => '<li>' + inline(x) + '</li>').join('') + '</ul>'); list = null; };
    for (const raw of String(text || '').replace(/\r/g, '').split('\n')) {
      const l = raw.trimEnd();
      let m;
      if (!l.trim()) { flushP(); flushL(); continue; }
      if ((m = l.match(/^\s*[-*]\s+(.*)$/))) { flushP(); (list = list || []).push(m[1]); continue; }
      if ((m = l.match(/^#{1,6}\s+(.*)$/))) { flushP(); flushL(); out.push('<h4>' + inline(m[1]) + '</h4>'); continue; }
      if (list && /^\s{2,}/.test(raw)) { list[list.length - 1] += ' ' + l.trim(); continue; }
      flushL(); para.push(l.trim());
    }
    flushP(); flushL();
    return out.join('');
  }
  root.md = md; root.esc = esc;
  if (typeof module !== 'undefined') module.exports = { md, esc };
})(typeof window !== 'undefined' ? window : globalThis);

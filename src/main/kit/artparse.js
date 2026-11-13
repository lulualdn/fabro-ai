/* Finds the artifacts in a model's answer — forgiving, because small models get the format slightly wrong.
   Accepted, all meaning the same thing:
     <artifact type="html" title="Bakery">…</artifact>            (the documented form)
     <artifact title='Bakery' type=html>…                          (any attribute order, ' or no quotes, unclosed at the end)
     <artifact>…<!doctype html>…</artifact>                         (no type, no title: guessed from the content)
     ```html\n<artifact …>…</artifact>\n```                         (the whole thing wrapped in a code fence)
     ```html\n<!doctype html>…</html>\n```                          (a complete page in a code fence, no tag at all)
     ```svg\n<svg …>…</svg>\n```                                    (a drawing in a code fence)
   Used by the renderer (artifact cards) and by the computer (chat visual check), so both always agree.
   Segments: { kind: 'text', text } | { kind: 'artifact', i, type, title, lang, body, open, fenced } */
(function (root) {
  'use strict';

  function parseAttrs(s) {
    const o = {};
    for (const m of String(s || '').matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) o[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? '';
    return o;
  }

  function normType(t, body) {
    t = String(t || '').toLowerCase().trim();
    const b = String(body || '');
    if (/sheet|calc|spreadsheet|excel|xlsx|csv|tableur|table/.test(t)) return 'sheet';
    if (/slide|deck|present|diapo/.test(t)) return 'slides';
    if (/svg|draw|logo|icon|illustr/.test(t)) return /<svg[\s>]/i.test(b) ? 'svg' : 'html';
    if (/^(document|doc|pdf|print|report|rapport|cv|resume|letter|lettre|invoice|facture|flyer|poster|affiche|menu|a4)/.test(t)) return 'document';
    if (/html|page|web|site|app/.test(t)) return 'html';
    if (/markdown|^md$|^text|^note/.test(t)) return /^\s*(<!doctype|<html)/i.test(b) ? guess(b) : 'markdown';
    if (/code|script|program|python|javascript|^js$|^py$|lua|json|css/.test(t)) return 'code';
    return guess(b);
  }
  function guess(b) {
    if (/^\s*(<\?xml[^>]*>\s*)?<svg[\s>]/i.test(b)) return 'svg';
    if (/^\s*(<!doctype|<html|<head|<body|<style|<main|<section|<div|<header|<article)/i.test(b)) {
      if (/<body[^>]*class\s*=\s*["'][^"']*\bdeck\b/i.test(b) || (b.match(/<section[^>]*class\s*=\s*["'][^"']*\bslide\b/gi) || []).length >= 2) return 'slides';
      if (/<body[^>]*class\s*=\s*["'][^"']*\bdoc\b/i.test(b) || /@page\b/.test(b)) return 'document';
      return 'html';
    }
    return 'markdown';
  }

  const strip = (s) => String(s || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  // A title when the model forgot it: <title>, then the first heading, then the SVG's <title>.
  function guessTitle(body) {
    const b = String(body || '');
    const m = b.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || b.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || b.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
    const t = m ? strip(m[1]) : '';
    return t.slice(0, 80);
  }

  // Code fences that hold a complete page or a drawing become artifacts (only when the answer has no <artifact> tag).
  const FENCE = /(^|\n)[ \t]*```[ \t]*([\w+-]*)[^\n]*\n([\s\S]*?)(?:\n[ \t]*```[ \t]*(?=\n|$)|$)/g;
  function fencedPage(lang, code) {
    const c = String(code || '').trim();
    if (/^\s*(<!doctype html|<html[\s>])/i.test(c) && c.length > 200) return true;
    if (/^(svg|xml|html)?$/i.test(lang) && /^\s*(<\?xml[^>]*>\s*)?<svg[\s>][\s\S]*<\/svg>\s*$/i.test(c) && c.length > 120) return true;
    return false;
  }

  function split(content) {
    let src = String(content || '');
    // a fence wrapped around the artifact tag itself: drop the fence lines
    src = src.replace(/(^|\n)[ \t]*```[\w-]*[ \t]*\n(\s*<artifact\b[\s\S]*?(?:<\/artifact\s*>|$))[ \t]*(?:\n[ \t]*```[ \t]*(?=\n|$))?/gi, (m, pre, inner) => pre + inner.trimEnd());
    const out = [];
    let idx = 0;
    if (/<artifact\b/i.test(src)) {
      let rest = src;
      for (;;) {
        const open = rest.match(/<artifact\b([^>]*)>/i);
        if (!open) { if (rest) out.push({ kind: 'text', text: rest }); break; }
        if (open.index) out.push({ kind: 'text', text: rest.slice(0, open.index) });
        const after = rest.slice(open.index + open[0].length);
        const close = after.search(/<\/artifact\s*>/i);
        const attrs = parseAttrs(open[1]);
        let body = (close < 0 ? after : after.slice(0, close)).replace(/^\s*\n/, '').replace(/\s+$/, '');
        // a code fence inside the tag
        const f = body.match(/^\s*```[\w-]*[^\n]*\n([\s\S]*?)(?:\n\s*```\s*)?$/); if (f) body = f[1].replace(/\s+$/, '');
        const type = normType(attrs.type || attrs.kind, body);
        out.push({ kind: 'artifact', i: idx++, type, title: (attrs.title || attrs.name || '').trim() || guessTitle(body), lang: attrs.lang || attrs.language || '', body, open: close < 0 });
        if (close < 0) break;
        rest = after.slice(after.slice(close).indexOf('>') + close + 1);
      }
      return out;
    }
    // no tag: complete pages or drawings in code fences
    let last = 0, m;
    FENCE.lastIndex = 0;
    while ((m = FENCE.exec(src))) {
      const lang = m[2] || '', code = m[3];
      if (!fencedPage(lang, code)) continue;
      const start = m.index + m[1].length;
      if (start > last) out.push({ kind: 'text', text: src.slice(last, start) });
      const closed = /\n[ \t]*```[ \t]*$/.test(m[0]);
      const body = code.replace(/\s+$/, '');
      out.push({ kind: 'artifact', i: idx++, type: normType('', body), title: guessTitle(body), lang: '', body, open: !closed, fenced: true });
      last = m.index + m[0].length;
    }
    if (!out.length) return src ? [{ kind: 'text', text: src }] : [];
    if (last < src.length) out.push({ kind: 'text', text: src.slice(last) });
    return out;
  }

  const has = (content) => split(content).some((s) => s.kind === 'artifact');
  const artifacts = (content) => split(content).filter((s) => s.kind === 'artifact');

  const api = { split, has, artifacts, normType, parseAttrs, guessTitle };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.FabroArtParse = api;
})(typeof self !== 'undefined' ? self : this);

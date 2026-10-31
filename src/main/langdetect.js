// Tiny language detector for speech: which language is this sentence in? Used to give every sentence of an
// answer the right voice (a reply that quotes English in French is read in both). Script first, then common
// words and accents for Latin-script languages; short or unclear text keeps the hint (the UI language).
// Shared by the desktop app (Node) and Fabro Anywhere (browser: window.FALang).
(function (root) {
  const WORDS = {
    en: 'the and is are was were you your it this that what with for not have has of to in on be can will would do does i we they he she my me',
    fr: 'le la les des une un est et je tu il elle nous vous ils pas que qui pour dans avec sur ce cette mais ou très bien du au aux mon ton son ça suis es sont fait',
    es: 'el la los las un una es y que de en por para con no lo se su sus muy pero como más está estoy son tú yo usted también gracias hola',
    de: 'der die das und ist ich du nicht ein eine mit von zu den dem auch es sie wir ihr sind für auf wie was noch nur kann',
    it: 'il lo la gli le un una è e che di per con non sono sei mi ti si ma come anche questo questa molto grazie ciao della',
    pt: 'o a os as um uma é e que de do da em para com não você eu ele ela muito mas como também obrigado olá está são',
  };
  const SETS = Object.fromEntries(Object.entries(WORDS).map(([k, v]) => [k, new Set(v.split(' '))]));
  const ACCENT = { fr: /[éèêëàâçœîïûù]/g, es: /[ñ¿¡áíóú]/g, de: /[äöüß]/g, pt: /[ãõâêôç]/g, it: /[àèìòù]/g };

  function detect(text, hint = 'en') {
    const s = String(text || '');
    if (/[぀-ヿ]/.test(s)) return 'ja';
    if (/[一-鿿]/.test(s)) return 'zh';
    if (/[가-힯]/.test(s)) return 'ko';
    if (/[ऀ-ॿ]/.test(s)) return 'hi';
    if (/[Ѐ-ӿ]/.test(s)) return 'ru';
    if (/[؀-ۿ]/.test(s)) return 'ar';
    const words = s.toLowerCase().normalize('NFC').match(/[a-zà-ÿœß']+/g) || [];
    if (words.length < 3) return hint;
    const score = {};
    for (const [k, set] of Object.entries(SETS)) {
      let n = 0; for (const w of words) if (set.has(w.replace(/^[ldjmtsnc]'|^qu'/, ''))) n++;
      const acc = ACCENT[k] ? (s.match(ACCENT[k]) || []).length : 0;
      score[k] = n + acc * 0.6 + (k === hint ? 0.75 : 0);
    }
    const best = Object.entries(score).sort((a, b) => b[1] - a[1])[0];
    return best && best[1] >= 1.5 ? best[0] : hint;
  }
  // Split a text into runs of the same language (sentence by sentence).
  function runs(text, hint = 'en') {
    const parts = String(text || '').match(/[^.!?…;:\n]+[.!?…;:]*\s*|\n+/g) || [];
    const out = [];
    for (const p of parts) {
      if (!p.trim()) continue;
      const l = detect(p, out.length ? out[out.length - 1].lang : hint);
      if (out.length && out[out.length - 1].lang === l) out[out.length - 1].text += p; else out.push({ lang: l, text: p });
    }
    return out;
  }
  const api = { detect, runs };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.FALang = api;
})(typeof self !== 'undefined' ? self : this);

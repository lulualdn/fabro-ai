/* Fabro built-in themes. "fabro" is the app's own look (tokens.css, untouched): it has no overrides.
   Palettes are seeds; themes-core.js derives the rest and keeps every text pair at AA or better. */
(function (root, factory) {
  const data = factory();
  if (typeof module === 'object' && module.exports) module.exports = data; else root.ThemesData = data;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const MONO = '"Cascadia Mono", "SF Mono", "JetBrains Mono", "DejaVu Sans Mono", Menlo, Consolas, "Liberation Mono", monospace';
  const BOOK = 'Charter, "Bitstream Charter", "Sitka Text", Cambria, "Iowan Old Style", Georgia, serif';
  const DRAFT = '"Bahnschrift", "DIN Alternate", "Segoe UI", "Helvetica Neue", Arial, sans-serif';

  const BUILTIN = [
    { id: 'fabro', builtin: true, base: 'both', author: 'Fabro', name: { en: 'Fabro', fr: 'Fabro' },
      desc: { en: 'Ivory and night blue, rounded, coral. The way Fabro comes.', fr: 'Ivoire et bleu nuit, arrondi, corail. Fabro tel qu’il arrive.' },
      palette: {}, tokens: {}, fonts: {}, motion: 'default', layout: '' },

    { id: 'marginalia', builtin: true, base: 'both', author: 'Fabro', name: { en: 'Marginalia', fr: 'Marginalia' },
      desc: { en: 'Rag paper, iron-gall ink, a book column. For long answers you read slowly.', fr: 'Papier chiffon, encre ferro-gallique, une colonne de livre. Pour les longues réponses qu’on lit lentement.' },
      palette: {
        light: { bg: '#ece3cf', panel: '#e2d7bd', elev: '#f5eedd', text: '#231c14', accent: '#1f4f7e', 'accent-ink': '#ffffff', err: '#a6322a', depth: 'flat', shadow: '#4a3a1e' },
        dark: { bg: '#1c1813', panel: '#15120e', elev: '#26211a', text: '#eadfc8', accent: '#86aedb', 'accent-ink': '#10151c', err: '#ff8576', depth: 'flat' },
      },
      tokens: { all: { 'r-xs': '3px', 'r-sm': '4px', 'r-md': '5px', 'r': '6px', 'r-lg': '8px', 'r-xl': '10px', 'fs-read': '17px', 'lh-read': '1.72', 'measure': '40rem', 'gap': '8px' } },
      fonts: { read: BOOK, display: BOOK }, texture: { kind: 'grain', layer: 'under', opacity: 0.045 }, motion: 'calm', layout: '' },

    { id: 'graphite', builtin: true, base: 'both', author: 'Fabro', name: { en: 'Graphite', fr: 'Graphite' },
      desc: { en: 'No warmth, no serif, nothing shouting. Grey on grey with one steel-blue accent.', fr: 'Pas de chaleur, pas d’empattements, rien qui crie. Du gris sur du gris, un seul accent bleu acier.' },
      palette: {
        light: { bg: '#f2f2f1', panel: '#e8e8e7', elev: '#fbfbfa', text: '#1c1d1f', accent: '#3b5d86', 'accent-ink': '#ffffff', depth: 'flat', shadow: '#202124' },
        dark: { bg: '#1b1c1e', panel: '#151617', elev: '#242528', text: '#e6e7e9', accent: '#8fb0d6', 'accent-ink': '#101418', depth: 'flat' },
      },
      tokens: { all: { 'r-xs': '4px', 'r-sm': '5px', 'r-md': '6px', 'r': '8px', 'r-lg': '10px', 'r-xl': '12px', 'gap': '8px' } },
      fonts: { display: 'var(--font-ui)' }, motion: 'default', layout: '' },

    { id: 'contrast', builtin: true, base: 'both', author: 'Fabro', name: { en: 'High contrast', fr: 'Contraste élevé' },
      desc: { en: 'Black on white or white on black, strong outlines, a thick focus ring. Built to be read, not admired.', fr: 'Noir sur blanc ou blanc sur noir, contours nets, anneau de focus épais. Fait pour être lu.' },
      palette: {
        light: { bg: '#ffffff', panel: '#f3f3f3', elev: '#ffffff', text: '#000000', accent: '#0b3fc4', 'accent-ink': '#ffffff', ok: '#005f20', warn: '#6b4100', err: '#a30000', border: '#767676', 'border-strong': '#000000', depth: 'none', shadow: '#000000' },
        dark: { bg: '#000000', panel: '#0c0c0c', elev: '#141414', text: '#ffffff', accent: '#ffd60a', 'accent-ink': '#000000', ok: '#5ef08a', warn: '#ffd60a', err: '#ff8a80', border: '#8c8c8c', 'border-strong': '#ffffff', depth: 'none' },
      },
      tokens: { all: { 'r-xs': '4px', 'r-sm': '6px', 'r-md': '8px', 'r': '10px', 'r-lg': '12px', 'r-xl': '16px', 'fw-medium': '600', 'fw-strong': '700', 'lh-read': '1.7' } },
      fonts: {}, motion: 'default', layout: '', css: 'contrast.css' },

    { id: 'maree', builtin: true, base: 'both', author: 'Fabro', name: { en: 'Tidewater', fr: 'Marée' },
      desc: { en: 'Sea-glass and deep water. Soft corners, quiet teal.', fr: 'Verre de mer et eau profonde. Coins doux, un teal discret.' },
      palette: {
        light: { bg: '#edf3f1', panel: '#dfe9e6', elev: '#f8fbfa', text: '#10292c', accent: '#0c6c73', 'accent-ink': '#ffffff', shadow: '#0f3a3e' },
        dark: { bg: '#0d1f23', panel: '#09171a', elev: '#142a2f', text: '#dcebe8', accent: '#5ec4bd', 'accent-ink': '#06201f', shadow: '#000000' },
      },
      tokens: { all: { 'r-xs': '8px', 'r-sm': '10px', 'r-md': '12px', 'r': '14px', 'r-lg': '22px', 'r-xl': '28px' } },
      fonts: {}, motion: 'calm', layout: '' },

    { id: 'blueprint', builtin: true, base: 'both', author: 'Fabro', name: { en: 'Blueprint', fr: 'Plan' },
      desc: { en: 'Drafting-table blue with a fine grid behind the page. Square corners, ruled lines.', fr: 'Bleu de table à dessin, une grille fine derrière la page. Coins droits, traits de règle.' },
      palette: {
        light: { bg: '#f3f6fb', panel: '#e6ecf5', elev: '#fbfcfe', text: '#0e2748', accent: '#1a55ad', 'accent-ink': '#ffffff', depth: 'none', border: '#c3d0e4', 'border-strong': '#9bb0d0', shadow: '#0e2748' },
        dark: { bg: '#102f55', panel: '#0b2444', elev: '#173d6b', text: '#e7f0fb', accent: '#7fd0ff', 'accent-ink': '#06203a', depth: 'none', border: '#2b568a', 'border-strong': '#4a79b0' },
      },
      tokens: { all: { 'r-xs': '1px', 'r-sm': '2px', 'r-md': '2px', 'r': '3px', 'r-lg': '3px', 'r-xl': '4px', 'gap': '8px' } },
      fonts: { display: DRAFT }, texture: { kind: 'grid', layer: 'under', opacity: 0.1, size: 16 }, motion: 'default', layout: '' },

    { id: 'cli', builtin: true, base: 'both', author: 'Fabro', name: { en: 'CLI', fr: 'CLI' },
      desc: { en: 'A terminal. Monospace, square, ruled lines, the chats in a panel on the side, and the keyboard for everything.', fr: 'Un terminal. Monospace, angles droits, filets, les conversations dans un panneau sur le côté, et tout au clavier.' },
      palette: {
        light: { bg: '#fbfaf7', panel: '#f0eee8', elev: '#fbfaf7', text: '#1b1a18', accent: '#b2431f', 'accent-ink': '#ffffff', ok: '#1f7a3f', warn: '#8a5a00', err: '#b3261e', border: '#d6d2c8', 'border-strong': '#a9a498', depth: 'none', shadow: '#000000' },
        dark: { bg: '#101010', panel: '#0a0a0a', elev: '#101010', text: '#dcdcd6', accent: '#ff7a5c', 'accent-ink': '#150a06', ok: '#6fd68b', warn: '#e6b450', err: '#ff7b72', border: '#2a2a2a', 'border-strong': '#444444', depth: 'none' },
      },
      tokens: { all: { 'r-xs': '0px', 'r-sm': '0px', 'r-md': '0px', 'r': '0px', 'r-lg': '0px', 'r-xl': '0px', 'r-pill': '0px', 'gap': '0px', 'sb-w': '280px', 'measure': '60rem',
        'fs-read': '14px', 'fs-body': '13px', 'fs-ui': '13px', 'fs-sm': '12px', 'fs-xs': '11px', 'lh-read': '1.55', 'lh-ui': '1.4', 'fw-medium': '500', 'fw-strong': '700' } },
      fonts: { ui: 'var(--font-mono)', read: 'var(--font-mono)', display: 'var(--font-mono)', mono: MONO },
      texture: { kind: 'scanlines', layer: 'over', opacity: 0.035, size: 3 }, motion: 'steps', layout: 'cli', css: 'cli.css' },

    { id: 'phosphor', builtin: true, base: 'dark', author: 'Fabro', name: { en: 'Phosphor', fr: 'Phosphore' },
      desc: { en: 'The CLI in amber, like a monitor from 1985 left on overnight.', fr: 'Le CLI en ambre, comme un moniteur de 1985 resté allumé toute la nuit.' },
      palette: {
        dark: { bg: '#130c02', panel: '#0d0801', elev: '#130c02', text: '#ffbf47', accent: '#ffd98a', 'accent-ink': '#1a1000', ok: '#b8e06a', warn: '#ffd98a', err: '#ff9a7a', border: '#3a2708', 'border-strong': '#6a4812', depth: 'none', shadow: '#000000' },
      },
      tokens: { all: { 'r-xs': '0px', 'r-sm': '0px', 'r-md': '0px', 'r': '0px', 'r-lg': '0px', 'r-xl': '0px', 'r-pill': '0px', 'gap': '0px', 'sb-w': '280px', 'measure': '60rem',
        'fs-read': '14px', 'fs-body': '13px', 'fs-ui': '13px', 'fs-sm': '12px', 'fs-xs': '11px', 'lh-read': '1.55', 'lh-ui': '1.4', 'fw-medium': '500', 'fw-strong': '700' } },
      fonts: { ui: 'var(--font-mono)', read: 'var(--font-mono)', display: 'var(--font-mono)', mono: MONO },
      texture: { kind: 'scanlines', layer: 'over', opacity: 0.06, size: 3 }, motion: 'steps', layout: 'cli', css: 'cli.css' },
  ];
  return { BUILTIN };
});

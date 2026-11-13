---
name: technique/colour-from-subject
title: Colour from the subject
when: choosing a palette for any piece so it belongs to its subject instead of looking generic
keywords: colour, color, couleur, couleurs, palette, theme, theme couleur, ambiance, mood, contrast, contraste, brand colors, charte graphique, accent
---
# Colour from the subject

Generic pages use blue buttons and purple gradients. Distinctive ones take their colours from the thing they are about.

## Find the palette
1. Name three physical things from the subject. A bakery: crust, flour, the wooden counter. A cycling club: road tarmac, jersey, summer field. A law firm: ink, paper, oak.
2. Turn each into a colour: crust `#b5651d`, flour `#f6f1e7`, wood `#5a3e2b`.
3. Assign roles:
   - **Ground** (60–80%): a near-white or near-black taken from the subject (not pure #fff or #000).
   - **Ink** (text): very dark, slightly tinted towards the palette.
   - **Accent** (5–10%): the most characteristic colour, for one kind of thing only (links, key numbers, the main button).
   - **Support**: one muted colour for bands, tags, chart series.
```css
:root { --ground: #f6f1e7; --ink: #2b1d14; --accent: #b5651d; --support: #d9c7a8; }
```

## Techniques
- **Tinted neutrals**: greys mixed with the accent (`#2b1d14` instead of `#333`) make everything feel related.
- **One loud colour**: if the subject is energetic (festival, sport), make the ground itself the bold colour and the text near-white.
- **Dark ground** for night, luxury, cinema, tech: ground `#14110f`, text `#efe8dc`, accent a warm metal.
- **Charts**: series in accent + support + ink at 40%; never a rainbow.

## Contrast rules
- Body text needs a contrast ratio of at least 4.5:1, big headings 3:1.
- White text on a light accent fails: darken the accent for text use, keep the light one for fills.

## Avoid
- Gradients as decoration, neon on white, five accents.
- Colour as the only signal (add a word or an icon too).
- The same palette for every subject.

## Self-check
1. Could you guess the subject from the colours alone?
2. Is the accent used for one kind of thing only?
3. Is the text dark enough on every background?
4. Are the neutrals tinted, not default grey?
5. Three to five colours in total?

---
name: web/landing-page
title: Landing page
when: a one-page website that presents a product, app, service, project or association and asks visitors to do one thing
keywords: landing page, landing, page d accueil, homepage, site vitrine, site web, website, site internet, startup, saas, app, produit, product launch, lancement, association, projet, one page, page unique
---
# Landing page

A landing page has one visitor and one action. Everything on it either makes the visitor want to act, or removes a doubt.

## Decide first
- The visitor: who arrives, from where, knowing what?
- The action: download, sign up, book, buy, contact. One.
- The promise in one sentence, in the visitor's words.
- The doubts they will have (price? trust? effort?). Each doubt becomes a section.

## Build it
1. **Hero** (technique/hero-alternatives): the promise, the proof, the action.
2. **What it is**: three concrete benefits, each with a real detail or number, not three icons with vague words.
3. **How it works**: three steps, or a screenshot with callouts.
4. **Proof**: testimonials with names, numbers, logos of real partners (only if given), a demo.
5. **Answering doubts**: pricing, FAQ (in `<details>`), guarantees.
6. **Final call to action**: repeat the action with a different phrasing.
7. **Footer**: contact, legal, links.

## Choose a structure — do not use all
- **Story**: problem → solution → result, like a short narrative.
- **Show**: almost no text; large product visuals in sequence.
- **Proof wall**: the product is known; the page is mostly testimonials and numbers.
- **Manifesto**: for causes and associations: a strong text in big type, then how to join.

## Techniques
```css
section { padding: clamp(56px, 9vw, 120px) 0; }
.benefits { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(280px, 100%), 1fr)); gap: 32px; }
.cta { font-weight: 700; padding: 14px 22px; border-radius: 10px; background: var(--accent); color: var(--on-accent); }
```
- Vary section backgrounds with the palette (ground / tinted / ink) to pace the scroll.
- Write button labels as actions: "Download for Windows", "Book a call".

## Make it distinctive
Colour and type from the subject (technique/colour-from-subject); one signature element repeated (a shape from the logo, a photo treatment, a big numeral style).

## Avoid
- Centred gradient hero, "Revolutionize your workflow", three identical feature cards with emoji.
- Several competing actions.
- Fake testimonials or invented company logos.

## Self-check
1. Can a visitor say what it is and what to do within five seconds?
2. Is there one primary action, repeated at the end?
3. Does every section answer a real doubt?
4. Works on a 390px phone?
5. Would it look wrong for another product?

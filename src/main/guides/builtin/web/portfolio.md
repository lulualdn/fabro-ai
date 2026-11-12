---
name: web/portfolio
title: Portfolio
when: a personal or studio website that shows someone's work: designer, photographer, developer, artist, architect, student
keywords: portfolio, site perso, site personnel, personal website, personal site, cv en ligne, online resume, book, artiste, artist, photographe, photographer, graphiste, designer, developpeur, developer, architecte, illustrateur, freelance, studio
---
# Portfolio

A portfolio is judged by its best piece and its worst piece. Curate first; the design should frame the work, not compete with it.

## Decide first
- Who looks: a recruiter, a client, a gallery? What do they want to see first?
- Pick 4–8 projects maximum, best first.
- The person's voice in one line ("I design signage for public transport").

## Build it
1. **Intro**: name, what you do, where, availability; a link to contact. Short.
2. **Work**: the projects, each with an image, a title, a one-line context (client, year, role).
3. **Project detail** (on the same page or in sections): the problem, what you did, the result, more images.
4. **About**: a short paragraph, a photo if wanted, clients or awards.
5. **Contact**: email as a visible link, social links, CV download.

## Pick a structure
- **Index list**: a typographic list of projects (title · year · type); images appear on hover or below. Very editorial.
- **Big tiles**: two-column grid of large images with captions under.
- **One project per screen**: each project a full-width section with alternating layout.
- **Case studies**: three deep projects told as stories, for UX and product people.
- **Code-first**: for developers, projects with live links, stack tags and a short README-like summary.

## Techniques
```css
.work { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(420px, 100%), 1fr)); gap: 40px 28px; }
.work img { aspect-ratio: 4/3; object-fit: cover; width: 100%; }
.index li { display: grid; grid-template-columns: 1fr auto auto; gap: 24px; padding: 14px 0; border-top: 1px solid var(--line); }
```
- Same aspect ratio for all thumbnails; let the detail pages show original proportions.
- Real images of the work (in agent mode: `web_images` for existing public work, or the user's files); otherwise typographic tiles with the project title and a colour.

## Make it distinctive
The site should feel like the person's own work: a type designer's site is about letters; a photographer's is almost only images on near-black; an architect's uses a strict grid and thin lines.

## Avoid
- Skill bars, "Hi, I'm X, a passionate…", 20 weak projects.
- Text on top of the work.
- Contact hidden at the bottom of a long page only.

## Self-check
1. Is the best project first?
2. Can a visitor tell what the person does in one line?
3. Is each project's context (role, year) given?
4. Images consistent and sharp?
5. Contact reachable from the top?

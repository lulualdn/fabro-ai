---
name: web/game-page
title: Game page / browser game
when: a small game playable in the page (canvas or DOM), or a page presenting a game with trailer, features and download
keywords: game, jeu, jeu video, video game, browser game, jeu web, jeu en ligne, mini jeu, mini game, arcade, puzzle, snake, tetris, memory, platformer, canvas, gameplay, roblox, steam, game page, page de jeu, trailer
---
# Game page / browser game

Two different things share this guide: a **playable game** (the page is the game) and a **game presentation page** (sell or explain a game). Decide which first.

## Playable game
1. **Core loop** in one sentence: "dodge the falling trains, collect tickets".
2. **Screen states**: title (how to play + Start), playing (score, lives), game over (score, best score, Restart).
3. Draw in a `<canvas>` sized to the container, scaled for sharp pixels:
```js
const c = document.querySelector('canvas'), g = c.getContext('2d');
function fit() { const r = c.getBoundingClientRect(); c.width = r.width * devicePixelRatio; c.height = r.height * devicePixelRatio; g.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0); }
let last = 0; function loop(t) { const dt = Math.min(0.05, (t - last) / 1000); last = t; update(dt); draw(); requestAnimationFrame(loop); }
```
4. **Controls** for keyboard and touch (on-screen buttons or swipe), shown on the title screen.
5. **Difficulty ramp**: speed grows slowly; first 20 seconds easy.
6. **Juice** in small doses: a flash on hit, a short shake (transform), a score pop. Pause when the tab is hidden.
7. Best score in `localStorage`.

## Presentation page
1. **Hero**: real key art or gameplay screenshot (agent mode: `web_images` with the game's name), title, one line, platforms, main button (Play / Download / Wishlist).
2. **Trailer or GIF-like screenshot strip**.
3. **Features** as screenshots with captions, not icons.
4. **Details**: genre, players, release date, age rating, system requirements.
5. **Community**: Discord, socials, press kit.

## Make it distinctive
The game's art direction is the page's direction: pixel art → crisp pixel font stack and hard shadows; cosy → soft palette and rounded shapes; horror → dark, grain, sparse text. Never reuse another game's logo or characters.

## Avoid
- Games that cannot be played on a phone without saying so.
- Physics tied to frame rate (use `dt`).
- Presentation pages with invented screenshots or fake reviews.

## Self-check
1. Can a new player start within five seconds?
2. Works with keyboard and touch?
3. Game over shows score and restart?
4. Speed independent of frame rate?
5. The style matches the game's world?

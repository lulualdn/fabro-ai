---
name: web/web-app-tool
title: Small web app / tool
when: an interactive tool in one page: calculator, converter, quiz, planner, to-do list, timer, generator, simulator
keywords: app, application, appli, web app, outil, tool, calculator, calculatrice, calculateur, convertisseur, converter, quiz, to do list, todo, timer, minuteur, chronometre, generateur, generator, simulateur, simulator, planificateur, tracker, compteur, counter, formulaire interactif
---
# Small web app / tool

A tool is judged by how quickly it gives the answer. Put the controls and the result on the first screen; explanations come after.

## Decide first
- The one job: "convert", "split the bill", "test my vocabulary".
- Inputs (what the user gives), output (what they get), and what is remembered between visits.
- The main screen states: empty, working, result, error.

## Build it
1. **Title + one line** saying what it does.
2. **Controls**: real form elements with labels, sensible defaults so the result shows immediately.
3. **Result**: big and clear, updated live on `input`.
4. **Secondary**: history, settings, explanation of the method.
5. **Script** at the end of `<body>`, plain JavaScript, no library unless needed (`find_library`).

## Techniques
```html
<label for="amount">Amount (€)</label>
<input id="amount" type="number" inputmode="decimal" value="42" min="0" step="0.01">
<output id="result" for="amount" aria-live="polite"></output>
<script>
const $ = (s) => document.querySelector(s);
function update() { const a = parseFloat($('#amount').value) || 0; $('#result').textContent = (a * 1.2).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' }); }
document.querySelectorAll('input, select').forEach((el) => el.addEventListener('input', update)); update();
</script>
```
- **Persist** with `localStorage` (to-do items, scores, settings) and restore on load.
- **Validation** with friendly messages next to the field, not alerts.
- **Keyboard**: Enter submits, Escape closes, focus moves sensibly.
- **Quiz pattern**: one question at a time, immediate feedback, score at the end, "try again".
- **Empty state** that tells what to do ("Add your first task").

## Make it distinctive
Give the tool a physical metaphor from its subject: a kitchen timer with a dial, a currency converter like a bureau de change board, a quiz like flash cards. One accent for the primary action and the result.

## Avoid
- A "Calculate" button when live updates are possible.
- Results in tiny text; layout jumping as numbers change (use tabular numbers and fixed widths).
- Errors in the console: test every button.

## Self-check
1. Does a result appear without the user doing anything?
2. Are all inputs labelled?
3. Does it work on a phone keyboard (right input types)?
4. Is state saved if it should be?
5. Every button actually works?

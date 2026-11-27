// Example mod (Fabro mod API v1): flashcards. /flashcards asks the AI for cards made from the conversation,
// reads them from its answer (lines "Q: … | R: …"), and shows a review card above the chat.
const KEY = 'flashcards-deck';
const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; } };
const save = (d) => { try { localStorage.setItem(KEY, JSON.stringify(d.slice(-300))); } catch {} };
let waiting = false;
Fabro.commands.add({ name: 'flashcards', title: 'Faire des flashcards', run: () => { waiting = true; Fabro.chat.send('Fais 6 flashcards sur ce dont on vient de parler. Une par ligne, exactement au format « Q: question | R: réponse ».'); } });
Fabro.on('done', () => {
  if (!waiting) return; waiting = false;
  const conv = Fabro.chat.current(); const last = conv && conv.messages.filter((m) => m.role === 'assistant').pop();
  const cards = String(last && last.content || '').split('\n').map((l) => l.match(/Q\s*:\s*(.+?)\s*\|\s*R\s*:\s*(.+)/i)).filter(Boolean).map((m) => ({ q: m[1], a: m[2], due: Date.now() }));
  if (!cards.length) return Fabro.ui.toast('Aucune carte trouvée dans la réponse.');
  save([...load(), ...cards]); Fabro.ui.toast(`${cards.length} cartes ajoutées`); review();
});
function review() {
  const deck = load(); const card = deck.find((c) => c.due <= Date.now());
  if (!card) return Fabro.ui.removeCard('flashcards');
  let shown = false;
  const next = (days) => { card.due = Date.now() + days * 864e5; save(deck); review(); };
  const paint = () => Fabro.ui.card({ id: 'flashcards', title: shown ? card.a : card.q, sub: `${deck.filter((c) => c.due <= Date.now()).length} à réviser`, actions: shown
    ? [{ label: 'À revoir', run: () => next(0.01) }, { label: 'Je savais', primary: true, run: () => next(3) }]
    : [{ label: 'Voir la réponse', primary: true, run: () => { shown = true; paint(); } }] });
  paint();
}
review();

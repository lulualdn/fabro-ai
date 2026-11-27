// Example mod (Fabro mod API v1): a card above the chat once a day, and a /idee command.
// Fabro and mod are given by Fabro: see https://fabro.ufstudios.eu/docs-mods.html
const IDEAS = ['Range ton dossier Téléchargements', 'Résume tes notes de la semaine', 'Prépare la liste de courses du week-end'];
const today = new Date().toISOString().slice(0, 10);
let seen = ''; try { seen = localStorage.getItem('daily-card') || ''; } catch {}
if (seen !== today) {
  const idea = IDEAS[new Date().getDate() % IDEAS.length];
  Fabro.ui.card({ id: 'daily-card', title: 'Idée du jour', sub: idea, actions: [
    { label: 'Plus tard', run: () => { try { localStorage.setItem('daily-card', today); } catch {} Fabro.ui.removeCard('daily-card'); } },
    { label: 'On y va', primary: true, run: () => { try { localStorage.setItem('daily-card', today); } catch {} Fabro.ui.removeCard('daily-card'); Fabro.chat.send(idea); } },
  ] });
}
Fabro.commands.add({ name: 'idee', title: 'Une idée de tâche', run: () => Fabro.chat.send(IDEAS[Math.floor(Math.random() * IDEAS.length)]) });

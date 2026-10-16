// Contextual greetings for the new-chat screen.
// pickGreeting(lang, name, date) → string. Special days win, then a weighted
// mix of time-of-day, weekday and season pools. {n} = the user's first name.
const GREETINGS = {
  en: {
    halloween: ['Trick or treat, {n}?', 'Happy Halloween, {n}. Something spooky in mind?', 'Boo! What are we conjuring, {n}?'],
    october: ['Something spooky in mind, {n}?', 'Pumpkin season, {n}. What’s brewing?', 'A little spooky project, {n}?'],
    christmas: ['Merry Christmas, {n}!', 'Cozy Christmas plans, {n}?'],
    december: ['Winding down the year, {n}?', 'Hot cocoa and a good idea, {n}?', 'Festive season, {n}. What’s on the list?'],
    newyear: ['Happy New Year, {n}!', 'New year, new ideas, {n}?', 'Fresh start, {n}. Where do we begin?'],
    valentine: ['Something sweet in mind, {n}?'],
    summer: ['Sunny thoughts, {n}?', 'Summer mode on, {n}. What’s the plan?'],
    spring: ['Fresh ideas blooming, {n}?'],
    night: ['A little late-night idea, {n}?', 'Still up, {n}?', 'Night owl mode, {n}?', 'The quiet hours are the best ones, {n}.'],
    early: ['Coffee first, then we take off, {n}!', 'Early bird, {n}?', 'Good morning, {n}. Coffee’s on?'],
    morning: ['Good morning, {n}', 'Morning, {n}. What’s first?', 'Ready for lift-off, {n}?'],
    lunch: ['Lunch break idea, {n}?', 'Good afternoon, {n}'],
    afternoon: ['Good afternoon, {n}', 'Afternoon push, {n}?', 'What are we building, {n}?'],
    evening: ['Good evening, {n}', 'Evening, {n}. What’s on your mind?', 'Winding down, {n}?'],
    monday: ['New week, {n}. Where do we start?', 'Monday, {n}. Let’s get going.'],
    friday: ['Friday already, {n}!', 'Almost the weekend, {n}.'],
    weekend: ['Weekend project, {n}?', 'Easy weekend, {n}?'],
  },
  fr: {
    halloween: ['Un bonbon ou un sort, {n} ?', 'Joyeux Halloween, {n}. Une idée qui fait peur ?', 'Bouh ! On prépare quoi, {n} ?'],
    october: ['Quelque chose d’effrayant en tête, {n} ?', 'Saison des citrouilles, {n}. Qu’est-ce qui mijote ?', 'Un petit projet qui fait peur, {n} ?'],
    christmas: ['Joyeux Noël, {n} !', 'Un Noël bien au chaud, {n} ?'],
    december: ['On boucle l’année, {n} ?', 'Un chocolat chaud et une bonne idée, {n} ?', 'C’est bientôt les fêtes, {n}. Qu’est-ce qu’on prépare ?'],
    newyear: ['Bonne année, {n} !', 'Nouvelle année, nouvelles idées, {n} ?', 'Page blanche, {n}. On commence par quoi ?'],
    valentine: ['Une douce idée en tête, {n} ?'],
    summer: ['Des idées au soleil, {n} ?', 'Mode été activé, {n}. Le programme ?'],
    spring: ['Les idées bourgeonnent, {n} ?'],
    night: ['Une petite idée nocturne, {n} ?', 'Encore debout, {n} ?', 'Mode oiseau de nuit, {n} ?', 'Les heures calmes sont les meilleures, {n}.'],
    early: ['Un café, et notre journée commence !', 'Un café, {n}, et on décolle !', 'Lève-tôt, {n} ?'],
    morning: ['Bonjour, {n}', 'Bonjour {n}, on commence par quoi ?', 'Prêt·e à décoller, {n} ?'],
    lunch: ['Une idée pendant la pause déj, {n} ?', 'Bon appétit, {n} !'],
    afternoon: ['Bon après-midi, {n}', 'On construit quoi cet après-midi, {n} ?', 'Un coup de boost, {n} ?'],
    evening: ['Bonsoir, {n}', 'Bonsoir {n}, qu’est-ce qui vous trotte dans la tête ?', 'Fin de journée, {n} ?'],
    monday: ['Nouvelle semaine, {n}. Par où on commence ?', 'Lundi, {n}. C’est parti.'],
    friday: ['Déjà vendredi, {n} !', 'Bientôt le week-end, {n}.'],
    weekend: ['Un projet du week-end, {n} ?', 'Week-end tranquille, {n} ?'],
  },
  es: {
    october: ['¿Algo terrorífico en mente, {n}?'], halloween: ['¿Truco o trato, {n}?'], christmas: ['¡Feliz Navidad, {n}!'], newyear: ['¡Feliz año nuevo, {n}!'],
    night: ['¿Una idea nocturna, {n}?', '¿Trasnochando, {n}?'], early: ['Un café y empieza el día, {n}.'], morning: ['Buenos días, {n}'],
    lunch: ['Buenas tardes, {n}'], afternoon: ['Buenas tardes, {n}'], evening: ['Buenas noches, {n}'], friday: ['¡Ya es viernes, {n}!'], weekend: ['¿Proyecto de fin de semana, {n}?'],
  },
  de: {
    october: ['Etwas Gruseliges im Sinn, {n}?'], halloween: ['Süßes oder Saures, {n}?'], christmas: ['Frohe Weihnachten, {n}!'], newyear: ['Frohes neues Jahr, {n}!'],
    night: ['Eine kleine Nachtidee, {n}?', 'Noch wach, {n}?'], early: ['Erst Kaffee, dann geht’s los, {n}!'], morning: ['Guten Morgen, {n}'],
    lunch: ['Mahlzeit, {n}!'], afternoon: ['Guten Tag, {n}'], evening: ['Guten Abend, {n}'], friday: ['Schon Freitag, {n}!'], weekend: ['Ein Wochenendprojekt, {n}?'],
  },
};

// "jean.dupont" → "Jean", "lulua" → "Lulua", "DESKTOP-ABC\\bob" → "Bob"
function prettyName(raw) {
  let s = String(raw || '').split(/[\\/]/).pop().trim();
  if (!s || /^(user|admin|administrator|root|utilisateur|owner|pc|default)$/i.test(s)) return '';
  s = s.split(/[._\-\s]+/)[0].replace(/\d+$/, '');
  if (!s) return '';
  return s[0].toLocaleUpperCase() + s.slice(1).toLocaleLowerCase();
}

function greetingPools(d) {
  const m = d.getMonth() + 1, day = d.getDate(), h = d.getHours(), wd = d.getDay();
  // Special days: always win.
  if (m === 10 && day >= 30 || m === 11 && day === 1 && h < 5) return [['halloween', 1]];
  if (m === 12 && (day === 24 || day === 25)) return [['christmas', 1]];
  if (m === 12 && day === 31 && h >= 18 || m === 1 && day <= 3) return [['newyear', 1]];
  if (m === 2 && day === 14) return [['valentine', 1]];

  const time = h < 5 ? 'night' : h < 9 ? 'early' : h < 12 ? 'morning' : h < 14 ? 'lunch' : h < 18 ? 'afternoon' : h < 22 ? 'evening' : 'night';
  const pools = [[time, 5]];
  if (m === 10) pools.push(['october', 4]);
  else if (m === 12) pools.push(['december', 3]);
  else if (m === 7 || m === 8) pools.push(['summer', 2]);
  else if (m === 4 || m === 5) pools.push(['spring', 1]);
  if (wd === 1 && h < 14) pools.push(['monday', 2]);
  if (wd === 5 && h >= 12) pools.push(['friday', 2]);
  if ((wd === 0 || wd === 6) && h >= 9 && h < 22) pools.push(['weekend', 2]);
  return pools;
}

function pickGreeting(lang, name, d = new Date(), rnd = Math.random) {
  const L = GREETINGS[lang] || GREETINGS.en;
  const pools = greetingPools(d).map(([k, w]) => [L[k] || GREETINGS.en[k], w]).filter(([a]) => a && a.length);
  const total = pools.reduce((s, [, w]) => s + w, 0);
  let r = rnd() * total, list = pools[0][0];
  for (const [a, w] of pools) { if ((r -= w) <= 0) { list = a; break; } }
  let s = list[Math.floor(rnd() * list.length)];
  if (name) return s.replace(/\{n\}/g, name);
  // No name known: drop it cleanly ("Good morning, {n}" → "Good morning").
  return s.replace(/,\s*\{n\}(?=\s*[,.!?…]|$)/g, '').replace(/\s*\{n\}/g, '').replace(/\s+([?!])/g, lang === 'fr' ? ' $1' : '$1');
}

if (typeof module !== 'undefined') module.exports = { pickGreeting, prettyName, greetingPools };

'use strict';
/* First start: the propeller asks a few quick questions (your name, its name, what for, answer style, theme). */

const ONB_TXT = {
  fr: {
    hello: 'Salut ! Moi, c’est l’hélice de Fabro. Je tourne sur ton ordinateur, rien que pour toi.', go: 'C’est parti',
    you: 'Comment tu t’appelles ?', youPh: 'Ton prénom',
    me: 'Enchanté, {n} ! Et moi, comment tu veux m’appeler ?', mePh: 'Fabro',
    use: 'Tu comptes m’utiliser pour quoi, surtout ?', use_study: 'Études', use_work: 'Travail', use_code: 'Code', use_create: 'Création', use_all: 'Un peu de tout',
    style: 'Tu préfères quel genre de réponses ?', st_concise: 'Courtes et directes', st_default: 'Équilibrées', st_explanatory: 'Détaillées',
    theme: 'Dernière question : plutôt clair ou sombre ?', th_light: 'Clair', th_dark: 'Sombre', th_system: 'Comme le système',
    done: 'Parfait, {n}. Je m’appelle {a}. On décolle ?', start: 'Commencer', next: 'Suivant', skip: 'Passer',
  },
  en: {
    hello: 'Hi! I’m Fabro’s propeller. I run on your computer, just for you.', go: 'Let’s go',
    you: 'What’s your name?', youPh: 'Your first name',
    me: 'Nice to meet you, {n}! And what would you like to call me?', mePh: 'Fabro',
    use: 'What will you mostly use me for?', use_study: 'Studying', use_work: 'Work', use_code: 'Code', use_create: 'Creating', use_all: 'A bit of everything',
    style: 'What kind of answers do you prefer?', st_concise: 'Short and direct', st_default: 'Balanced', st_explanatory: 'Detailed',
    theme: 'Last one: light or dark?', th_light: 'Light', th_dark: 'Dark', th_system: 'Same as the system',
    done: 'Perfect, {n}. My name is {a}. Ready for lift-off?', start: 'Start', next: 'Next', skip: 'Skip',
  },
};
const ot = (k, v = {}) => ((ONB_TXT[S.lang] || ONB_TXT.en)[k] || ONB_TXT.en[k] || k).replace(/\{(\w+)\}/g, (_, x) => v[x] ?? '');

const ONB = { i: 0, a: {} };
const ONB_STEPS = ['hello', 'you', 'me', 'use', 'style', 'theme', 'done'];

function needsOnboarding() {
  return !S.settings.onboarded && !(S.info && S.info.e2e && !S.settings.forceOnboarding) && !(S.convs || []).length;
}

function onbQuestion(step) {
  const n = ONB.a.userName || '', a = ONB.a.aiName || 'Fabro';
  return ot(step === 'me' ? 'me' : step === 'done' ? 'done' : step, { n, a });
}

function onbAnswer(step) {
  const chips = (key, items, multi) => `<div class="onb-chips ${multi ? 'multi' : ''}">${items.map((v) => `<button class="onb-chip ${(multi ? (ONB.a[key] || []).includes(v) : ONB.a[key] === v) ? 'sel' : ''}" data-action="onb-pick" data-key="${key}" data-v="${v}" data-multi="${multi ? 1 : ''}">${esc(ot((key === 'use' ? 'use_' : key === 'style' ? 'st_' : 'th_') + v))}</button>`).join('')}</div>`;
  if (step === 'hello') return `<button class="btn primary onb-next" data-action="onb-next">${esc(ot('go'))}</button>`;
  if (step === 'you') return `<form class="onb-form"><input class="input onb-in" id="onb-in" maxlength="40" placeholder="${esc(ot('youPh'))}" value="${esc(ONB.a.userName ?? prettyName(S.info.userName) ?? '')}"><button class="btn primary" type="submit">${esc(ot('next'))}</button></form>`;
  if (step === 'me') return `<form class="onb-form"><input class="input onb-in" id="onb-in" maxlength="24" placeholder="${esc(ot('mePh'))}" value="${esc(ONB.a.aiName || '')}"><button class="btn primary" type="submit">${esc(ot('next'))}</button></form>
    <div class="onb-chips">${['Fabro', 'Hélice', 'Nova', 'Pixel'].map((v) => `<button class="onb-chip ghost" data-action="onb-name" data-v="${v}">${v}</button>`).join('')}</div>`;
  if (step === 'use') return chips('use', ['study', 'work', 'code', 'create', 'all'], true) + `<button class="btn primary onb-next" data-action="onb-next">${esc(ot('next'))}</button>`;
  if (step === 'style') return chips('style', ['concise', 'default', 'explanatory']);
  if (step === 'theme') return chips('theme', ['light', 'dark', 'system']);
  return `<button class="btn primary onb-next" data-action="onb-finish">${esc(ot('start'))}</button>`;
}

function renderOnboarding() {
  let el = document.getElementById('onb');
  if (!el) { el = document.createElement('div'); el.id = 'onb'; el.className = 'onb'; document.body.appendChild(el); }
  const step = ONB_STEPS[ONB.i];
  const q = onbQuestion(step);
  el.innerHTML = `<div class="onb-card" data-step="${step}">
    <div class="onb-prop talking">${logo(84)}</div>
    <div class="onb-bubble"><span class="onb-q"></span></div>
    <div class="onb-ans">${onbAnswer(step)}</div>
    <div class="onb-dots">${ONB_STEPS.map((_, i) => `<i class="${i === ONB.i ? 'on' : i < ONB.i ? 'done' : ''}"></i>`).join('')}</div>
    ${step !== 'done' ? `<button class="onb-skip" data-action="onb-finish">${esc(ot('skip'))}</button>` : ''}
  </div>`;
  // the propeller "speaks": the question is typed out while it spins
  const qEl = el.querySelector('.onb-q'), prop = el.querySelector('.onb-prop'), ans = el.querySelector('.onb-ans');
  ans.style.opacity = 0; let k = 0; clearInterval(ONB.timer);
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  ONB.timer = setInterval(() => {
    k = reduce ? q.length : k + 2; qEl.textContent = q.slice(0, k);
    if (k >= q.length) { clearInterval(ONB.timer); prop.classList.remove('talking'); ans.style.opacity = 1; const i = el.querySelector('#onb-in'); if (i) { i.focus(); i.select(); } }
  }, 22);
  const f = el.querySelector('form.onb-form');
  if (f) f.addEventListener('submit', (e) => { e.preventDefault(); onbNext(); });
}

function onbNext() {
  const step = ONB_STEPS[ONB.i];
  const inp = document.getElementById('onb-in');
  if (step === 'you') ONB.a.userName = inp.value.trim();
  if (step === 'me') ONB.a.aiName = inp.value.trim() || 'Fabro';
  ONB.i = Math.min(ONB.i + 1, ONB_STEPS.length - 1);
  renderOnboarding();
}

async function onbFinish() {
  clearInterval(ONB.timer);
  const a = ONB.a, patch = { onboarded: true };
  if (a.userName) patch.userName = a.userName;
  if (a.aiName) patch.aiName = a.aiName;
  if (a.use && a.use.length) patch.useFor = a.use;
  if (a.style) patch.activeStyle = a.style;
  await saveSettings(patch);
  if (a.theme) await applySetting('theme', a.theme);
  const el = document.getElementById('onb');
  if (el) { el.classList.add('out'); setTimeout(() => el.remove(), 380); }
  _greet.key = ''; renderSidebar(); renderView();
}

Object.assign(actions, {
  'onb-next': () => onbNext(),
  'onb-finish': () => onbFinish(),
  'onb-name': (el) => { ONB.a.aiName = el.dataset.v; const i = document.getElementById('onb-in'); if (i) i.value = el.dataset.v; },
  'onb-pick': (el) => {
    const { key, v, multi } = el.dataset;
    if (multi) { const s = new Set(ONB.a[key] || []); s.has(v) ? s.delete(v) : s.add(v); ONB.a[key] = [...s]; el.classList.toggle('sel'); return; }
    ONB.a[key] = v;
    if (key === 'theme') applySetting('theme', v);
    setTimeout(onbNext, 180);
    el.classList.add('sel');
  },
});

// what the user said they use Fabro for, for the system prompts
function useForLine() {
  const u = S.settings.useFor || []; if (!u.length) return '';
  return `The user mainly uses you for: ${u.map((x) => ONB_TXT.en['use_' + x] || x).join(', ')}.`;
}

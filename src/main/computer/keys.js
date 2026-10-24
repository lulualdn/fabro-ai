// Key names → Windows virtual keys (+ extended flag) and X11 keysyms. "ctrl+shift+s", "alt+tab", "f5", "é", "+".
const isMac = process.platform === 'darwin';

const K = {};
const add = (names, vk, ks, ext = false) => { for (const n of names.split('|')) K[n] = { vk, ks, ext }; };
add('ctrl|control|ctl|strg', 0x11, 'Control_L');
add('shift|maj', 0x10, 'Shift_L');
add('alt|option|opt|menu_alt', 0x12, 'Alt_L');
add('altgr', 0xA5, 'ISO_Level3_Shift', true);
add('win|windows|super|meta|start|os', 0x5B, 'Super_L', true);
add('cmd|command', isMac ? 0x5B : 0x11, isMac ? 'Super_L' : 'Control_L', isMac); // "cmd" means ctrl off the Mac
add('enter|return|entrée|entree', 0x0D, 'Return');
add('esc|escape|échap|echap', 0x1B, 'Escape');
add('tab', 0x09, 'Tab');
add('space|espace|spacebar', 0x20, 'space');
add('backspace|retour|bksp', 0x08, 'BackSpace');
add('delete|del|suppr|supprimer', 0x2E, 'Delete', true);
add('insert|ins', 0x2D, 'Insert', true);
add('home|début|debut|origine', 0x24, 'Home', true);
add('end|fin', 0x23, 'End', true);
add('pageup|pgup|page_up', 0x21, 'Prior', true);
add('pagedown|pgdn|page_down', 0x22, 'Next', true);
add('up|arrowup|haut', 0x26, 'Up', true);
add('down|arrowdown|bas', 0x28, 'Down', true);
add('left|arrowleft|gauche', 0x25, 'Left', true);
add('right|arrowright|droite', 0x27, 'Right', true);
add('capslock|caps|verrmaj', 0x14, 'Caps_Lock');
add('numlock', 0x90, 'Num_Lock', true);
add('scrolllock', 0x91, 'Scroll_Lock');
add('printscreen|print|prtsc|impr', 0x2C, 'Print', true);
add('pause|break', 0x13, 'Pause');
add('apps|contextmenu|context_menu', 0x5D, 'Menu', true);
add('volumeup|volume_up', 0xAF, 'XF86AudioRaiseVolume', true);
add('volumedown|volume_down', 0xAE, 'XF86AudioLowerVolume', true);
add('mute|volumemute', 0xAD, 'XF86AudioMute', true);
add('playpause|play|media_play_pause', 0xB3, 'XF86AudioPlay', true);
add('nexttrack|next_track', 0xB0, 'XF86AudioNext', true);
add('prevtrack|previoustrack|prev_track', 0xB1, 'XF86AudioPrev', true);
for (let i = 1; i <= 24; i++) add(`f${i}`, 0x6F + i, `F${i}`);
for (let i = 0; i <= 9; i++) add(`num${i}|numpad${i}|kp${i}`, 0x60 + i, `KP_${i}`);
add('multiply|nummul', 0x6A, 'KP_Multiply'); add('add|numadd', 0x6B, 'KP_Add'); add('subtract|numsub', 0x6D, 'KP_Subtract');
add('decimal|numdot', 0x6E, 'KP_Decimal'); add('divide|numdiv', 0x6F, 'KP_Divide', true);
add('plus', 0, 'plus'); add('minus', 0, 'minus');
const MODS = new Set(['ctrl', 'control', 'ctl', 'strg', 'shift', 'maj', 'alt', 'option', 'opt', 'altgr', 'win', 'windows', 'super', 'meta', 'start', 'os', 'cmd', 'command']);
const CHAR_KS = { '+': 'plus', '-': 'minus', '=': 'equal', ',': 'comma', '.': 'period', ';': 'semicolon', ':': 'colon', '/': 'slash', '\\': 'backslash', "'": 'apostrophe', '"': 'quotedbl', '`': 'grave', '[': 'bracketleft', ']': 'bracketright', '(': 'parenleft', ')': 'parenright', '!': 'exclam', '?': 'question', '*': 'asterisk', '&': 'ampersand', '%': 'percent', '$': 'dollar', '#': 'numbersign', '@': 'at', '<': 'less', '>': 'greater', '_': 'underscore', '~': 'asciitilde', '^': 'asciicircum', '|': 'bar', '{': 'braceleft', '}': 'braceright' };

// One key → a step payload. Letters and digits are layout-stable virtual keys; other characters are
// resolved by the helper on the user's own keyboard layout.
function key(name) {
  const raw = String(name);
  const n = raw.toLowerCase().trim();
  if (K[n] && K[n].vk) return { name: n, vk: K[n].vk, ext: K[n].ext, ks: K[n].ks, mod: MODS.has(n) };
  if (n === 'plus') return { name: n, ch: '+', ks: 'plus' };
  if (n === 'minus') return { name: n, ch: '-', ks: 'minus' };
  const c = raw.trim();
  if ([...c].length === 1) {
    if (/^[a-z]$/i.test(c)) return { name: c.toLowerCase(), vk: c.toUpperCase().charCodeAt(0), ks: c.toLowerCase() };
    if (/^[0-9]$/.test(c)) return { name: c, vk: c.charCodeAt(0), ks: c };
    return { name: c, ch: c, ks: CHAR_KS[c] || c };
  }
  throw Object.assign(new Error(`Unknown key "${raw}". Use names like ctrl, shift, alt, win, enter, esc, tab, space, backspace, delete, up, down, left, right, home, end, pageup, pagedown, f1–f12, or a single character.`), { code: 'BAD_KEY' });
}

// "ctrl+shift+s" → { mods:[ctrl, shift], key: s }. A lone modifier ("win") is a key on its own.
function combo(str) {
  const s = String(str).trim();
  // "ctrl++" / "ctrl+-": the last + is the key
  const parts = s === '+' ? ['+'] : s.replace(/\+\+$/, '+plus').split(/\s*\+\s*/).filter(Boolean);
  if (!parts.length) throw Object.assign(new Error('Empty key combination'), { code: 'BAD_KEY' });
  const ks = parts.map(key);
  const last = ks.pop();
  if (ks.some((k) => !k.mod)) throw Object.assign(new Error(`In "${s}", only the last key may be a normal key (the others must be ctrl, shift, alt or win).`), { code: 'BAD_KEY' });
  return { mods: ks, key: last, label: [...ks, last].map((k) => k.name).join('+') };
}

// "tab tab enter" or ["ctrl+a", "delete"] → list of combos
function sequence(keys) {
  const list = Array.isArray(keys) ? keys : String(keys).trim().replace(/\s*\+\s*/g, '+').split(/\s+/).filter(Boolean);
  return list.map(combo);
}

// Blocked: they lock the session or reach the secure desktop, which would cut the agent off.
const BLOCKED = new Set(['win+l', 'ctrl+alt+delete', 'ctrl+alt+del', 'ctrl+alt+suppr', 'ctrl+shift+esc+', 'win+ctrl+shift+b']);
const isBlocked = (c) => BLOCKED.has(c.label) || (c.key.name === 'l' && c.mods.some((m) => m.vk === 0x5B)) || (['delete', 'del', 'suppr'].includes(c.key.name) && c.mods.some((m) => m.vk === 0x11) && c.mods.some((m) => m.vk === 0x12));

const down = (k, ms = 0) => ({ t: 'kd', vk: k.vk, ext: !!k.ext, ch: k.ch, ks: k.ks, ms });
const up = (k, ms = 0) => ({ t: 'ku', vk: k.vk, ext: !!k.ext, ch: k.ch, ks: k.ks, ms });

module.exports = { key, combo, sequence, isBlocked, down, up };

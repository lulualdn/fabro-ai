'use strict';
/* Settings → Desktop: AI hotkey + quick bar, close-to-tray. */

const isMacUI = () => S.info && S.info.platform === 'darwin';
function accelParts(acc) {
  const map = { Control: 'Ctrl', CommandOrControl: isMacUI() ? '⌘' : 'Ctrl', Super: isMacUI() ? '⌘' : 'Win', Meta: isMacUI() ? '⌘' : 'Win', Alt: isMacUI() ? '⌥' : 'Alt', Shift: isMacUI() ? '⇧' : 'Shift', Space: t('keySpace') };
  return String(acc || '').split('+').filter(Boolean).map((k) => map[k] || k);
}
const kbds = (acc) => accelParts(acc).map((k) => `<kbd class="key">${esc(k)}</kbd>`).join('<span class="plus">+</span>');

async function loadHotkeyStatus() {
  try { [S.hotkeyStatus, S.loginItem] = await Promise.all([api.hotkey.status(), api.login.get()]); } catch {}
  if (S.settingsTab === 'shortcut') renderSettings();
}

function shortcutTab() {
  const hk = S.settings.hotkey || {};
  const st = S.hotkeyStatus || { ok: true };
  const capturing = S.capturing;
  return `
    <div class="qb-preview">
      <div class="qbp-bar">${logo(20)}<span>${esc(t('placeholder'))}</span><span class="qbp-chip">${icon('chat', 12)} ${esc(t('quickCurrent'))}</span></div>
      <p>${esc(t('quickPitch'))}</p>
      <button class="btn sm" data-action="quick-try">${icon('zap', 14)} ${esc(t('quickTry'))}</button>
    </div>
    ${row(t('hotkeyEnable'), toggle('hotkey.enabled', hk.enabled), t('hotkeyEnableHint'))}
    ${hk.enabled ? row(t('hotkeyCombo'), `<button class="combo ${capturing ? 'capturing' : ''}" data-action="hotkey-capture">${capturing ? esc(t('hotkeyPress')) : kbds(hk.accelerator)}</button>
        ${hk.accelerator !== 'Control+Super+Space' ? `<button class="link-btn" data-action="hotkey-reset">${esc(t('reset'))}</button>` : ''}`,
      !st.ok ? `⚠ ${t('hotkeyTaken')}` : t('hotkeyComboHint')) : ''}
    ${hk.enabled && S.info.platform === 'win32' ? row(t('hotkeyCopilot'), toggle('hotkey.copilotKey', hk.copilotKey), t('hotkeyCopilotHint')) : ''}
    <div class="st-sec">${esc(t('background'))}</div>
    ${row(t('closeToTray'), toggle('closeToTray', S.settings.closeToTray), t('closeToTrayHint'))}
    ${row(t('openAtLogin'), toggleBtn('login-toggle', !!S.loginItem), t('openAtLoginHint'))}
    ${row(t('quitApp'), `<button class="btn sm" data-action="quit-app">${icon('power', 14)} ${esc(t('quitApp'))}</button>`, t('quitAppHint'))}`;
}

// Turn a keydown into an Electron accelerator.
function toAccelerator(e) {
  const mods = [];
  if (e.ctrlKey) mods.push('Control');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  if (e.metaKey) mods.push('Super');
  const k = e.key;
  if (['Control', 'Alt', 'Shift', 'Meta', 'OS', 'AltGraph'].includes(k)) return null;
  let key = null;
  if (k === ' ') key = 'Space';
  else if (/^F\d{1,2}$/.test(k)) key = k;
  else if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);
  else if (/^Digit\d$/.test(e.code)) key = e.code.slice(5);
  else key = ({ Enter: 'Enter', Tab: 'Tab', Backspace: 'Backspace', Delete: 'Delete', Insert: 'Insert', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', '.': 'Period', ',': 'Comma', '/': 'Slash', ';': 'Semicolon', '-': '-', '=': '=' })[k] || null;
  if (!key) return null;
  if (!mods.length && !/^F\d+$/.test(key)) return null; // plain keys would hijack typing
  return [...mods, key].join('+');
}

window.addEventListener('keydown', async (e) => {
  if (!S.capturing) return;
  e.preventDefault(); e.stopPropagation();
  if (e.key === 'Escape') { S.capturing = false; renderSettings(); return; }
  const acc = toAccelerator(e);
  if (!acc) return;
  S.capturing = false;
  await saveSettings({ hotkey: { accelerator: acc } });
  S.hotkeyStatus = await api.hotkey.apply();
  renderSettings();
  if (S.hotkeyStatus.ok) toast(t('hotkeySaved', { k: accelParts(acc).join(' + ') }));
}, true);

Object.assign(actions, {
  'hotkey-capture': () => { S.capturing = !S.capturing; renderSettings(); },
  'hotkey-reset': async () => { await saveSettings({ hotkey: { accelerator: 'Control+Super+Space' } }); S.hotkeyStatus = await api.hotkey.apply(); renderSettings(); },
  'quick-try': () => api.quick.toggle(),
  'login-toggle': async (el) => { S.loginItem = await api.login.set(el.dataset.value === 'true'); renderSettings(); },
  'quit-app': () => api.quit(),
});

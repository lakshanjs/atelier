// ---------- commands and shortcuts ----------
// Everything the menus can do, plus the tools, can be found by name (Ctrl+K) and given any key.
// Shortcuts belong to the app rather than a project, so they're the same everywhere.
const KEYS_STORE = 'atelier-keys', CMD_RECENT_STORE = 'atelier-cmd-recent';
const KEY_DEFAULTS = {
  palette: ['Ctrl+K'], keys: [], help: ['F1'],
  undo: ['Ctrl+Z'], redo: ['Ctrl+Y', 'Ctrl+Shift+Z'], save: ['Ctrl+S'], saveas: ['Ctrl+Shift+S'],
  all: ['Ctrl+A'], group: ['Ctrl+G'], ungroup: ['Ctrl+Shift+G'], copy: ['Ctrl+C'], cut: ['Ctrl+X'], paste: ['Ctrl+V'], dup: ['Ctrl+D'], del: ['Delete', 'Backspace'],
  fit: ['F'], snap: ['G'], spin: ['R'], spinback: ['Shift+R'],
  'tool.select': ['V'], 'tool.rotate': ['E'], 'tool.scale': ['S'], 'tool.measure': ['M'],
};
const KEYS_RESERVED = /^(Escape|Tab|Enter|ArrowUp|ArrowDown|ArrowLeft|ArrowRight|PageUp|PageDown|Control|Shift|Alt|Meta|CapsLock|Process|Unidentified|Dead)$/;
let keyOverrides = {}; try { keyOverrides = JSON.parse(localStorage.getItem(KEYS_STORE)) || {}; } catch (e) {}
let cmdRecent = []; try { cmdRecent = JSON.parse(localStorage.getItem(CMD_RECENT_STORE)) || []; } catch (e) {}
const keysOf = id => (id in keyOverrides ? (keyOverrides[id] ? [keyOverrides[id]] : []) : KEY_DEFAULTS[id] || []);
const keyLabel = id => keysOf(id)[0] || '';
function comboOf(e) {
  let k = e.key; if (k === ' ') k = 'Space'; if (k.length === 1) k = k.toUpperCase();
  if (e.code && /^Key[A-Z]$/.test(e.code)) k = e.code.slice(3);   // the same letter whatever else is held
  if (e.code && /^Digit\d$/.test(e.code)) k = e.code.slice(5);
  return [(e.ctrlKey || e.metaKey) && 'Ctrl', e.shiftKey && 'Shift', e.altKey && 'Alt', k].filter(Boolean).join('+');
}
function commandList() {
  const out = [], seen = new Set(), add = (id, name, run, group) => { if (seen.has(id)) return; seen.add(id); out.push({ id, name, run, group }); };
  add('palette', 'Find a command', openPalette, 'Help'); add('keys', 'Keyboard shortcuts', openKeys, 'Help');
  document.querySelectorAll('#menus .menu').forEach(menu => {
    const group = menu.querySelector('.mbtn').textContent.trim();
    menu.querySelectorAll('.mlist [data-do]').forEach(b => {
      const a = b.dataset.do; if (a === 'tbsep' || a.startsWith('recent:') || a === 'palette' || a === 'keys' || b.hidden) return;
      const kbd = b.querySelector('kbd'), name = (kbd ? b.textContent.replace(kbd.textContent, '') : b.textContent).replace(/…$/, '').trim();
      add(a, name, () => runDo(a), group);
    });
  });
  if (typeof cvOpen === 'function' && cvOpen()) { recents.forEach((r, i) => add('recent:' + i, `Open ${r.name}`, () => runDo('recent:' + i), 'File')); return out; }   // a carving has only its own
  TOOLS.forEach(([k, n]) => add('tool.' + k, `${n} tool`, () => setTool(k), 'Tools'));
  add('snap', 'Snapping on or off', () => { P.snap = !P.snap; persist(); render(); }, 'Tools');
  add('fit', 'Fit everything', () => { Object.keys(VIEWS).forEach(fitView); resetCam(); dirty = true; }, 'View');
  add('spin', 'Spin 90°', () => { if (sel.length) edit(() => rotateSel(AXES[1][0], 90)); }, 'Edit');
  add('spinback', 'Spin 90° the other way', () => { if (sel.length) edit(() => rotateSel(AXES[1][0], -90)); }, 'Edit');
  recents.forEach((r, i) => add('recent:' + i, `Open ${r.name}`, () => runDo('recent:' + i), 'File'));
  return out;
}
const cmdById = id => commandList().find(c => c.id === id);
function runCommand(c) {
  if (!c) return;
  if (c.id !== 'palette' && c.id !== 'keys') { cmdRecent = [c.id, ...cmdRecent.filter(x => x !== c.id)].slice(0, 12); try { localStorage.setItem(CMD_RECENT_STORE, JSON.stringify(cmdRecent)); } catch (e) {} }
  if (c.group === 'Tools' && cvOpen()) closeCarve();
  c.run();
}
// shows each command's key wherever it's written
function keysRefresh() {
  document.querySelectorAll('#menus .mlist [data-do]').forEach(b => { const key = keyLabel(b.dataset.do); let k = b.querySelector('kbd'); if (key && !k) { k = document.createElement('kbd'); b.appendChild(k); } if (k) { if (key) k.textContent = key; else k.remove(); } });
  document.querySelectorAll('[data-tool]').forEach(b => { const t = TOOLS.find(x => x[0] === b.dataset.tool); if (t) { const key = keyLabel('tool.' + t[0]); b.title = key ? `${t[1]} (${key})` : t[1]; } });
  const tip = (id, name, cmd) => { const el = document.getElementById(id), key = keyLabel(cmd); if (el) el.title = key ? `${name} (${key})` : name; };
  tip('bSave', 'Save', 'save'); tip('bUndo', 'Undo', 'undo'); tip('bRedo', 'Redo', 'redo');
  renderToolbar();   // anything dragged onto the toolbar shows its key too
}
function keysSave() { try { localStorage.setItem(KEYS_STORE, JSON.stringify(keyOverrides)); } catch (e) {} keysRefresh(); }
function keysSet(id, combo) {   // gives this command the key, and takes it from anything that had it. Returns who lost it.
  const lost = commandList().filter(c => c.id !== id && keysOf(c.id).includes(combo));
  lost.forEach(c => { const left = keysOf(c.id).filter(x => x !== combo); keyOverrides[c.id] = left[0] || ''; });
  keyOverrides[id] = combo; keysSave(); return lost;
}

// ---------- pressing a key ----------
let keyCapture = null;
window.addEventListener('keydown', e => {
  if (keyCapture) {
    e.preventDefault(); e.stopPropagation();
    if (e.key === 'Escape') { keyCapture = null; renderKeys(); return; }
    if (KEYS_RESERVED.test(e.key)) { if (!/^(Control|Shift|Alt|Meta)$/.test(e.key)) document.getElementById('keysNote').textContent = `${e.key} is kept for moving and closing things. Try another key.`; return; }
    const combo = comboOf(e), id = keyCapture, lost = keysSet(id, combo); keyCapture = null;
    document.getElementById('keysNote').textContent = lost.length ? `${combo} was on ${lost.map(c => c.name).join(', ')}. It's moved here.` : '';
    renderKeys(); return;
  }
  if (e.defaultPrevented || e.repeat && !/^(Ctrl\+[ZY]|Ctrl\+Shift\+Z)$/.test(comboOf(e))) return;
  if (precBuffer) return;
  const combo = comboOf(e), a = document.activeElement, typing = a && /INPUT|SELECT|TEXTAREA/.test(a.tagName) && a.type !== 'checkbox' && a.type !== 'range';
  const open = document.querySelector('dialog[open], #pack.open, #draw.open, #rend.open, #carve.open');
  const anywhere = keysOf('palette').includes(combo) || keysOf('help').includes(combo);
  if ((typing || open) && !(anywhere && !document.getElementById('cmdDlg').open && !document.getElementById('keysDlg').open && !document.querySelector('dialog[open], #pack.open, #draw.open, #rend.open'))) return;
  const id = Object.keys(KEY_DEFAULTS).concat(Object.keys(keyOverrides)).find(i => keysOf(i).includes(combo)) || commandList().find(c => keysOf(c.id).includes(combo))?.id; if (!id) return;
  const c = cmdById(id); if (!c) return;
  e.preventDefault(); e.stopPropagation(); runCommand(c);
}, true);

// ---------- finding a command ----------
function cmdScore(c, q) {
  const n = `${c.name} ${c.group}`.toLowerCase(), name = c.name.toLowerCase(), recent = cmdRecent.indexOf(c.id), boost = recent < 0 ? 0 : 6 - recent / 3;
  if (!q) return recent >= 0 ? 100 - recent : 1;
  if (name.startsWith(q)) return 60 + boost;
  const at = name.indexOf(q); if (at >= 0) return (name[at - 1] === ' ' ? 50 : 40) + boost;
  const words = q.split(/\s+/).filter(Boolean); if (words.length > 1 && words.every(w => n.includes(w))) return 30 + boost;
  let i = 0; for (const ch of name) if (ch === q[i]) i++;   // letters in order: "svpic" finds "Save picture"
  return i === q.length ? 10 + boost : 0;
}
let cmdShown = [], cmdIndex = 0;
function renderPalette() {
  const q = document.getElementById('cmdQ').value.trim().toLowerCase();
  cmdShown = commandList().map(c => ({ c, s: cmdScore(c, q) })).filter(x => x.s > 0).sort((a, b) => b.s - a.s || a.c.name.localeCompare(b.c.name)).map(x => x.c);
  if (cmdIndex >= cmdShown.length) cmdIndex = 0;
  document.getElementById('cmdList').innerHTML = cmdShown.length ? cmdShown.map((c, i) => `<button class="cmdrow${i === cmdIndex ? ' on' : ''}" data-cmd="${i}" tabindex="-1"><span>${esc(c.name)}</span><small>${esc(c.group)}</small>${keyLabel(c.id) ? `<kbd>${esc(keyLabel(c.id))}</kbd>` : ''}</button>`).join('') : '<p class="note" style="padding:8px">No command has that name.</p>';
  const on = document.querySelector('#cmdList .on'); if (on) on.scrollIntoView({ block: 'nearest' });
}
function openPalette() { const box = document.getElementById('cmdQ'); box.value = ''; cmdIndex = 0; renderPalette(); document.getElementById('cmdDlg').showModal(); box.focus(); }
function paletteRun(i) { const c = cmdShown[i]; if (!c) return; document.getElementById('cmdDlg').close(); setTimeout(() => runCommand(c)); }
document.getElementById('cmdQ').addEventListener('input', () => { cmdIndex = 0; renderPalette(); });
document.getElementById('cmdQ').addEventListener('keydown', e => {
  e.stopPropagation();
  if (e.key === 'ArrowDown') { e.preventDefault(); cmdIndex = Math.min(cmdShown.length - 1, cmdIndex + 1); renderPalette(); }
  if (e.key === 'ArrowUp') { e.preventDefault(); cmdIndex = Math.max(0, cmdIndex - 1); renderPalette(); }
  if (e.key === 'Enter') { e.preventDefault(); paletteRun(cmdIndex); }
});
document.getElementById('cmdList').addEventListener('click', e => { const b = e.target.closest('[data-cmd]'); if (b) paletteRun(+b.dataset.cmd); });
document.getElementById('cmdDlg').addEventListener('click', e => { if (e.target.id === 'cmdDlg') e.target.close(); });

// ---------- editing shortcuts ----------
function renderKeys() {
  const q = document.getElementById('keysQ').value.trim().toLowerCase(), list = commandList().filter(c => !c.id.startsWith('recent:') && (!q || `${c.name} ${c.group} ${keysOf(c.id).join(' ')}`.toLowerCase().includes(q))).sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name));
  document.getElementById('keysList').innerHTML = list.map(c => {
    const changed = c.id in keyOverrides, keys = keysOf(c.id), wait = keyCapture === c.id;
    return `<div class="keyrow"><span class="keyname">${esc(c.name)}</span><small>${esc(c.group)}</small><button class="btn line keybtn${wait ? ' wait' : ''}" data-keyset="${esc(c.id)}">${wait ? 'Press a key…' : esc(keys.join(', ') || 'Add')}</button><button class="ic" data-keyclear="${esc(c.id)}" title="No key" aria-label="Remove the key from ${esc(c.name)}" ${keys.length ? '' : 'disabled'}>${ic('x')}</button><button class="ic" data-keyback="${esc(c.id)}" title="Back to the usual key" aria-label="Back to the usual key for ${esc(c.name)}" ${changed ? '' : 'disabled'}>${ic('rotate-ccw')}</button></div>`;
  }).join('') || '<p class="note">Nothing matches.</p>';
}
function openKeys() { keyCapture = null; document.getElementById('keysQ').value = ''; document.getElementById('keysNote').textContent = ''; renderKeys(); document.getElementById('keysDlg').showModal(); }
document.getElementById('keysQ').addEventListener('input', renderKeys);
document.getElementById('keysQ').addEventListener('keydown', e => e.stopPropagation());
document.getElementById('keysList').addEventListener('click', e => {
  const set = e.target.closest('[data-keyset]'), clear = e.target.closest('[data-keyclear]'), back = e.target.closest('[data-keyback]');
  if (set) { keyCapture = set.dataset.keyset; document.getElementById('keysNote').textContent = 'Press the new key, or Esc to cancel.'; renderKeys(); return; }
  if (clear) { keyOverrides[clear.dataset.keyclear] = ''; keysSave(); renderKeys(); return; }
  if (back) { delete keyOverrides[back.dataset.keyback]; keysSave(); renderKeys(); }
});
document.getElementById('keysClose').onclick = () => { keyCapture = null; document.getElementById('keysDlg').close(); };
document.getElementById('keysReset').onclick = () => { keyOverrides = {}; keyCapture = null; keysSave(); document.getElementById('keysNote').textContent = 'All shortcuts are back to the usual ones.'; renderKeys(); };
document.getElementById('keysDlg').addEventListener('cancel', e => { if (keyCapture) e.preventDefault(); });
document.getElementById('helpKeys').onclick = () => { document.getElementById('helpDlg').close(); openKeys(); };
keysRefresh();

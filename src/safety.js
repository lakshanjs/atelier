// ---------- keeping work safe ----------
// Three layers: autosave on every change (localStorage, with a copy in the database in case that's full),
// versions you can go back to, and a note of whether the last run ended properly.
const AUTOSAVE_KEY = 'furniture-panels-2', AUTOSAVE_TIME = 'atelier-autosave-time';
const SNAP_EVERY = 5 * 60 * 1000, SNAP_KEEP = 40;
let autosaveTimer = 0, autosaveFullWarned = false, lastSnapText = '';

function autosave() {
  const text = JSON.stringify(P), t = Date.now();
  try { localStorage.setItem(AUTOSAVE_KEY, text); localStorage.setItem(AUTOSAVE_TIME, String(t)); autosaveFullWarned = false; }
  catch (e) { try { localStorage.removeItem(AUTOSAVE_KEY); } catch (e2) {} if (!autosaveFullWarned) { autosaveFullWarned = true; console.warn('autosave: localStorage is full, using the database only'); } }
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => { kvSet('autosave', { t, text }).catch(e => { toast(`Autosave failed: ${e && e.message}. Save your work to a file.`, true); }); }, 800);
}
// The database copy wins when it's newer, or when the quick copy was too big to keep.
async function autosaveRestore() {
  let copy = null; try { copy = await kvGet('autosave'); } catch (e) { return false; }
  if (!copy || !copy.text) return false;
  const quick = +(localStorage.getItem(AUTOSAVE_TIME) || 0), have = localStorage.getItem(AUTOSAVE_KEY);
  if (have && quick >= copy.t) return false;
  try { const p = JSON.parse(copy.text); if (!Array.isArray(p.items)) return false; P = ensureFloor(p); sel = []; setTimeout(ensureModels); render(); return true; } catch (e) { return false; }
}

// ---------- versions ----------
async function kvDel(k) { const db = await kv(); return new Promise((ok, no) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').delete(k); t.oncomplete = () => ok(); t.onerror = t.onabort = () => no(t.error); }); }
const snapList = async () => (await kvGet('snaps')) || [];
async function snapTake(label, keep) {   // keep: a named version, which is never pruned
  if (!P) return null;
  const text = JSON.stringify(P); if (text === lastSnapText && !keep) return null;
  lastSnapText = text;
  const t = Date.now(), row = { t, name: P.name, label: label || 'Automatic', keep: !!keep, panels: panelsOnly().length, bytes: text.length };
  await kvSet('snap:' + t, text);
  const list = await snapList(); list.unshift(row);
  const autos = list.filter(r => !r.keep), gone = new Set(autos.slice(SNAP_KEEP).map(r => r.t));
  for (const g of gone) await kvDel('snap:' + g).catch(() => {});
  await kvSet('snaps', list.filter(r => !gone.has(r.t)));
  return row;
}
const snapQuiet = (label, keep) => { snapTake(label, keep).catch(e => console.error('version:', e)); };
async function snapRestore(t) {
  const text = await kvGet('snap:' + t); if (!text) throw new Error('that version is gone');
  await snapTake('Before going back');
  const p = JSON.parse(text);
  pushUndo(); P = ensureFloor(p); sel = []; lastSnapText = ''; after(); setTimeout(ensureModels);
}
async function renderHistory() {
  const box = document.getElementById('histList'), list = await snapList();
  const when = t => new Date(t).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  box.innerHTML = list.length ? list.map(r => `<div class="histrow"><span class="histwhen">${esc(when(r.t))}</span><span class="histwhat"><b>${esc(r.name)}</b> ${esc(r.label)}, ${r.panels} ${r.panels === 1 ? 'panel' : 'panels'}</span><button class="btn line" data-snapgo="${r.t}">Go back to this</button><button class="ic" data-snapdel="${r.t}" title="Delete this version" aria-label="Delete this version">${ic('x')}</button></div>`).join('') : '<p class="note">No versions yet. One is kept every few minutes while you work, and each time you save.</p>';
}
function openHistory() { renderHistory(); document.getElementById('histDlg').showModal(); }
document.getElementById('histClose').onclick = () => document.getElementById('histDlg').close();
document.getElementById('histSave').onclick = async () => {
  const box = document.getElementById('histName'), name = box.value.trim() || 'Named version';
  await snapTake(name, true); box.value = ''; renderHistory(); toast(`Kept "${name}"`);
};
document.getElementById('histName').addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') document.getElementById('histSave').click(); });
document.getElementById('histList').addEventListener('click', async e => {
  const go = e.target.closest('[data-snapgo]'), del = e.target.closest('[data-snapdel]');
  if (go) { try { await snapRestore(+go.dataset.snapgo); document.getElementById('histDlg').close(); toast('Went back to that version. Undo returns you.'); } catch (err) { toast(`Couldn't go back: ${err.message}.`, true); } }
  if (del) { const t = +del.dataset.snapdel, list = await snapList(); await kvDel('snap:' + t).catch(() => {}); await kvSet('snaps', list.filter(r => r.t !== t)); renderHistory(); }
});
setInterval(() => snapQuiet('Automatic'), SNAP_EVERY);

// ---------- problems ----------
function reportError(text) { console.error(text); if (window.atelierWin && window.atelierWin.logError) window.atelierWin.logError(String(text).slice(0, 4000)); }
let lastErrorToast = 0;
function onAppError(text) {
  reportError(text);
  if (Date.now() - lastErrorToast > 8000 && typeof toast === 'function') { lastErrorToast = Date.now(); toast('Something went wrong in Atelier. Your work is autosaved, and File > Version history can take you back.', true); }
}
window.addEventListener('error', e => onAppError(`${e.message} at ${e.filename}:${e.lineno}\n${e.error && e.error.stack || ''}`));
window.addEventListener('unhandledrejection', e => onAppError(`Unhandled: ${e.reason && (e.reason.stack || e.reason.message) || e.reason}`));

// Did the last run end properly? main.js keeps the note, on disk.
const sessionStart = () => !!(window.atelierWin && window.atelierWin.crashedLastTime && window.atelierWin.crashedLastTime());

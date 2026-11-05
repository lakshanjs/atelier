// ---------- tools and tabs ----------
const TOOLS = [['select', 'Select', 'V', 'mouse-pointer-2'], ['rotate', 'Rotate', 'E', 'rotate-3d'], ['scale', 'Scale', 'S', 'scaling'], ['measure', 'Measure', 'M', 'ruler']];
document.getElementById('tools').innerHTML = TOOLS.map(([k, n, key, icon]) => `<button class="tool" data-tool="${k}" title="${n} (${key})" aria-label="${n}">${ic(icon)}</button>`).join('');
document.getElementById('tools').addEventListener('click', e => { const b = e.target.closest('[data-tool]'); if (b) setTool(b.dataset.tool); });
function setTool(t) { tool = t; measA = null; mHover = null; mAxis = null; mEdit = null; mCands = []; readout(''); if (t === 'measure') setTab('props'); render(); }
function setTab(t) {
  [['props', 'side', 'tabProps'], ['gallery', 'gal', 'tabGal'], ['groups', 'groups', 'tabGrp']].forEach(([k, panel, tab]) => {
    document.getElementById(panel).hidden = t !== k; document.getElementById(tab).setAttribute('aria-selected', t === k);
  });
}
document.getElementById('tabProps').onclick = () => setTab('props');
document.getElementById('tabGal').onclick = () => setTab('gallery');
document.getElementById('tabGrp').onclick = () => setTab('groups');
addIcon(document.getElementById('tabProps'), 'sliders-horizontal'); addIcon(document.getElementById('tabGal'), 'layout-grid'); addIcon(document.getElementById('tabGrp'), 'group');

// ---------- section controls ----------
function secRange() { const l = realItems(); const u = l.length ? unionBounds(l) : { min: [0, 0, 0], max: [1000, 1000, 1000] }; return [u.min[sect.axis], u.max[sect.axis]]; }
function syncSection() {
  const bar = document.getElementById('secBar'); if (!bar) return;
  bar.hidden = !sect.on; document.getElementById('bSection').classList.toggle('on', sect.on);
  if (!sect.on) return;
  const [a, b] = secRange(), r = document.getElementById('secPos'); r.min = a; r.max = b; r.step = 1; r.value = sect.pos;
  document.getElementById('secAxis').value = sect.axis; document.getElementById('secVal').textContent = fmt(sect.pos);
}
function setSection(on) { sect.on = on; if (on) { const [a, b] = secRange(); if (sect.pos <= a || sect.pos >= b) sect.pos = (a + b) / 2; } updateSection(); syncSection(); renderStatus(); dirty = true; }
document.getElementById('bSection').onclick = () => setSection(!sect.on);
document.getElementById('secOff').onclick = () => setSection(false);
document.getElementById('secFlip').onclick = () => { sect.flip = !sect.flip; updateSection(); dirty = true; };
document.getElementById('secAxis').onchange = e => { sect.axis = +e.target.value; const [a, b] = secRange(); sect.pos = (a + b) / 2; updateSection(); syncSection(); dirty = true; };
document.getElementById('secPos').oninput = e => { sect.pos = +e.target.value; document.getElementById('secVal').textContent = fmt(sect.pos); updateSection(); dirty = true; };
// ---------- exports ----------
function savePicture() {
  const keepSel = sel, keepDims = P.hideDims, keepBig = big, was = sect.on; sel = []; P.hideDims = true; draw3D();
  const pr = renderer.getPixelRatio(); renderer.setPixelRatio(Math.max(2, pr)); giz.visible = false; floorGrid.visible = false; renderer.render(scene, camera);
  const url = renderer.domElement.toDataURL('image/png');
  renderer.setPixelRatio(pr); sel = keepSel; P.hideDims = keepDims; dirty = true;
  const a = document.createElement('a'); a.href = url; a.download = `${P.name}.png`; a.click();
  return url;
}
// binary STL in millimetres: the panels only, each with its real shape
function stlBytes() {
  const tris = [];
  panelsOnly().forEach(it => {
    let g = panelGeometry(it); if (g.index) g = g.toNonIndexed();
    const pos = g.attributes.position, q = Q(it), v = V3();
    for (let i = 0; i < pos.count; i++) { v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyQuaternion(q); tris.push(v.x + it.pos[0], -(v.z + it.pos[2]), v.y + it.pos[1]); }   // Z up, as CAD and printing tools expect
  });
  const n = tris.length / 9, buf = new ArrayBuffer(84 + 50 * n), d = new DataView(buf); d.setUint32(80, n, true);
  let o = 84;
  for (let i = 0; i < n; i++) {
    const a = V3(tris[i * 9], tris[i * 9 + 1], tris[i * 9 + 2]), b = V3(tris[i * 9 + 3], tris[i * 9 + 4], tris[i * 9 + 5]), c = V3(tris[i * 9 + 6], tris[i * 9 + 7], tris[i * 9 + 8]);
    const nm = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
    [nm.x, nm.y, nm.z, a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z].forEach(v2 => { d.setFloat32(o, v2, true); o += 4; }); o += 2;
  }
  return buf;
}
function downloadBlob(name, data, type) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([data], { type })); a.download = name; a.click(); }

// ---------- right-click menu ----------
const ctxEl = document.getElementById('ctx'); let rdown = null;
const closeCtx = () => { ctxEl.hidden = true; };
function openCtx(x, y) {
  const has = sel.length > 0, anyLocked = selected().some(i => i.locked);
  const row = (act, label, icon, key) => `<button data-cx="${act}" role="menuitem">${ic(icon)}${label}${key ? `<kbd>${key}</kbd>` : ''}</button>`;
  ctxEl.innerHTML = has
    ? row('copy', 'Copy', 'clipboard-copy', 'Ctrl+C') + row('dup', 'Duplicate', 'copy', 'Ctrl+D') + row('spin', 'Spin 90°', 'rotate-cw', 'R') + row('drop', 'Set down', 'arrow-down-to-line') + '<hr>' + row('group', 'Make a layer', 'group') + row('hide', 'Hide', 'eye-off') + row('lock', anyLocked ? 'Unlock' : 'Lock', 'lock') + '<hr>' + row('del', 'Delete', 'trash-2', 'Del')
    : (clip ? row('paste', 'Paste', 'clipboard-paste', 'Ctrl+V') : '') + row('all', 'Select all', 'square-mouse-pointer', 'Ctrl+A') + row('fit', 'Fit everything', 'scan', 'F') + row('gallery', 'Add from the Gallery', 'layout-grid');
  ctxEl.hidden = false;
  const r = ctxEl.getBoundingClientRect();
  ctxEl.style.left = Math.min(x, innerWidth - r.width - 4) + 'px'; ctxEl.style.top = Math.min(y, innerHeight - r.height - 4) + 'px';
}
window.addEventListener('pointerdown', e => { if (e.button === 2) rdown = [e.clientX, e.clientY]; if (!e.target.closest('#ctx')) closeCtx(); if (!e.target.closest('#warnPop,#warnBtn')) document.getElementById('warnPop').hidden = true; }, true);
document.getElementById('work').addEventListener('contextmenu', e => {
  e.preventDefault();
  if (rdown && Math.hypot(e.clientX - rdown[0], e.clientY - rdown[1]) > 4) return;   // that was a right-drag to slide the view
  const pane = e.target.closest('.pane'); if (!pane) return;
  let it = null;
  if (pane.dataset.v === '3d') { const h = rayAt(e).intersectObjects(pickable).find(x => keptHit(x) && !byId(x.object.userData.id).locked); it = h ? byId(h.object.userData.id) : null; }
  else { const el = document.getElementById(VIEWS[pane.dataset.v].el), r = el.getBoundingClientRect(); it = hitFlat(pane.dataset.v, e.clientX - r.left, e.clientY - r.top); }
  if (it) { if (!sel.includes(it.id)) { sel = [it.id]; setTab('props'); render(); } } else if (sel.length) { sel = []; render(); }
  openCtx(e.clientX, e.clientY);
});
ctxEl.addEventListener('click', e => {
  const b = e.target.closest('[data-cx]'); if (!b) return; const a = b.dataset.cx; closeCtx();
  if (a === 'hide') edit(() => { selected().forEach(i => { i.hidden = true; }); sel = []; });
  else if (a === 'lock') edit(() => { const un = selected().some(i => i.locked); selected().forEach(i => { if (un) delete i.locked; else i.locked = true; }); });
  else if (a === 'drop') edit(dropDown);
  else if (a === 'gallery') setTab('gallery');
  else DO[a]();
});
document.getElementById('warnBtn').onclick = () => { const pop = document.getElementById('warnPop'); pop.hidden = !pop.hidden; if (!pop.hidden) fillWarnPop(); };
document.getElementById('warnPop').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  const m = /Panels? (\d+)/.exec(b.textContent); document.getElementById('warnPop').hidden = true;
  if (m && byId(+m[1])) { sel = [+m[1]]; setTab('props'); render(); }
});
document.getElementById('emptyGal').onclick = () => setTab('gallery');
document.getElementById('emptyNew').onclick = () => document.getElementById('bNew').click();
document.getElementById('helpClose').onclick = () => document.getElementById('helpDlg').close();

// ---------- menu bar ----------
const menus = [...document.querySelectorAll('.menu')];
const closeMenus = () => menus.forEach(m => { m.classList.remove('open'); m.querySelector('.mlist').hidden = true; });
const openMenu = m => { closeMenus(); m.classList.add('open'); m.querySelector('.mlist').hidden = false; };
menus.forEach(m => {
  const b = m.querySelector('.mbtn');
  b.addEventListener('click', e => { e.stopPropagation(); m.classList.contains('open') ? closeMenus() : openMenu(m); });
  b.addEventListener('pointerenter', () => { if (menus.some(x => x.classList.contains('open'))) openMenu(m); });
});
window.addEventListener('pointerdown', e => { if (!e.target.closest('.menu')) closeMenus(); });
const DO = {
  new: () => document.getElementById('bNew').click(), open: () => document.getElementById('bOpen').click(), save: () => document.getElementById('bSave').click(),
  render: openRender, hwcat: openCatalogue, drawings: () => { if (panelsOnly().length) openDrawings(); else toast('There are no panels to draw yet.', true); }, cnc: exportCnc, history: openHistory, resizable: () => { if (selected().length) edit(fxMakeResizable); else toast('Select the parts first.', true); },
  plans: () => document.getElementById('bPack').click(), print: () => { renderPack(); window.print(); },
  undo, redo, dup: () => { if (sel.length) edit(duplicateSel); }, del: () => { if (sel.length) edit(removeSel); }, all: () => { sel = shown().filter(i => !i.locked).map(i => i.id); render(); },
  layouts: () => toggleLayPop(true), layreset: resetLayout,
  help: () => document.getElementById('helpDlg').showModal(), tbsep: () => tbAddSeparator(), tbreset: () => tbReset(), saveas: () => saveProject(true), importsh3d: () => document.getElementById('sh3dIn').click(), libimport: () => document.getElementById('libIn').click(), libexport: libExport, picture: savePicture, dxf: () => downloadBlob(`${P.name} cut parts.dxf`, dxfText(), 'application/dxf'), stl: () => downloadBlob(`${P.name}.stl`, stlBytes(), 'model/stl'),
  theme: () => setTheme(!isDark()), floorgrid: () => { P.floorGrid = P.floorGrid === false; persist(); }, real: () => { P.real = !realOn(); persist(); dirty = true; }, section: () => setSection(!sect.on),
  copy: copySel, paste: pasteClip, cut: () => { copySel(); if (sel.length) edit(removeSel); },
  dims: () => { P.hideDims = !P.hideDims; persist(); render(); },
  group: () => { if (sel.length) groupSelection(); }, spin: () => { if (sel.length) edit(() => rotateSel(AXES[1][0], 90)); },
  fit: () => { Object.keys(VIEWS).forEach(fitView); resetCam(); dirty = true; }, cam: resetCam,
};
document.getElementById('menus').addEventListener('click', e => {
  const b = e.target.closest('[data-do]'); if (!b) return; closeMenus(); runDo(b.dataset.do);
});
const runDo = a => { if (a.startsWith('big:')) setBig(a.slice(4)); else if (a.startsWith('recent:')) openRecent(+a.slice(7)); else DO[a](); };

function applyTheme() {
  const d = isDark();
  scene.background.setHex(d ? 0x23292c : 0xe4e9e7);
  hoverBox.material.color.setHex(d ? 0xffffff : 0x20262a);
  floorGrid.material.uniforms.uCol.value.set(...(d ? [.86, .9, .89] : [.125, .15, .165]));
  document.getElementById('bTheme').innerHTML = ic(d ? 'sun' : 'moon');
  document.querySelector('meta[name=theme-color]').content = d ? '#1c2124' : '#fbfcfb';
}
function setTheme(dark) {
  if (dark) document.documentElement.dataset.theme = 'dark'; else delete document.documentElement.dataset.theme;
  try { localStorage.setItem('furniture-theme', dark ? 'dark' : 'light'); } catch (e) {}
  applyTheme(); render();
}
document.getElementById('bTheme').onclick = () => setTheme(!isDark());
if (window.atelierWin) {
  const pack = document.getElementById('pack'), syncBar = () => {
    const open = pack.classList.contains('open'), css = getComputedStyle(document.documentElement);
    window.atelierWin.setBar(open ? '#ffffff' : css.getPropertyValue('--bar').trim(), open ? '#20262a' : css.getPropertyValue('--ink').trim());
  };
  new MutationObserver(syncBar).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  new MutationObserver(syncBar).observe(pack, { attributes: true, attributeFilter: ['class'] });
  syncBar();
}
applyTheme();
[['bLayout', 'layout-dashboard'], ['bSection', 'scissors-line-dashed'], ['bNew', 'file-plus'], ['bOpen', 'folder-open'], ['bSave', 'save'], ['bUndo', 'undo-2'], ['bRedo', 'redo-2'], ['bPack', 'scissors'], ['bView', 'rotate-ccw'], ['bPrint', 'printer'], ['bCsv', 'save']].forEach(([id, n]) => addIcon(document.getElementById(id), n));
document.querySelector('.snapc').insertAdjacentHTML('beforeend', ic('magnet'));
const MENU_ICONS = { importsh3d: 'folder-open', tbsep: 'separator-vertical', tbreset: 'rotate-ccw', layouts: 'layout-dashboard', layreset: 'rotate-ccw', help: 'circle-help', saveas: 'save-all', picture: 'camera', dxf: 'file-output', stl: 'file-box', real: 'sparkles', section: 'scissors-line-dashed', copy: 'clipboard-copy', cut: 'scissors', paste: 'clipboard-paste', dims: 'ruler', new: 'file-plus', open: 'folder-open', save: 'save', plans: 'scissors', print: 'printer', undo: 'undo-2', redo: 'redo-2', dup: 'copy', del: 'trash-2', all: 'square-mouse-pointer', group: 'group', spin: 'rotate-cw', fit: 'scan', cam: 'rotate-ccw', 'big:3d': 'box', 'big:top': 'maximize-2', 'big:front': 'maximize-2', 'big:side': 'maximize-2' };
document.querySelectorAll('.mlist [data-do]').forEach(b => addIcon(b, MENU_ICONS[b.dataset.do]));
// ---------- customizable toolbar ----------
// Drag any menu command onto the toolbar, drag things along it to reorder, drag them off to remove. It's kept per user, not per project.
const tb = document.getElementById('toolbar'), TB_KEY = 'atelier-toolbar', tbMark = document.createElement('div'); tbMark.className = 'tb-mark'; tbMark.hidden = true;
const tbOwn = {}; const tbDefault = [];
[...tb.children].forEach(el => {
  if (el.classList.contains('sep')) { tbDefault.push('sep'); el.remove(); return; }
  if (el.classList.contains('grow')) { tbOwn.grow = el; tbDefault.push('grow'); return; }
  if (el.tagName === 'INPUT' || el.id === 'bPack') return;
  const key = el.id || (el.classList.contains('snapc') ? 'snap' : ''); if (!key) return;
  tbOwn[key] = el; tbDefault.push('el:' + key);
});
let tbLayout = tbDefault.slice(), tbDrag = null;
try { const saved = JSON.parse(localStorage.getItem(TB_KEY)); if (Array.isArray(saved) && saved.includes('grow')) tbLayout = saved.filter(e => e === 'sep' || e === 'grow' || (e.startsWith('el:') && tbOwn[e.slice(3)]) || (e.startsWith('do:') && menuItem(e.slice(3)))); } catch (e) {}
function menuItem(a) { return document.querySelector(`.mlist [data-do="${a}"]`); }
const menuLabel = b => { const c = b.cloneNode(true); c.querySelectorAll('kbd,svg').forEach(x => x.remove()); return c.textContent.replace('…', '').trim(); };
function renderToolbar() {
  tb.querySelectorAll('.tb-sep,.tb-do').forEach(e => e.remove());
  Object.values(tbOwn).forEach(e => e.classList.add('tb-off'));
  tbLayout.forEach((entry, i) => {
    let el;
    if (entry === 'sep') { el = document.createElement('div'); el.className = 'tb-sep'; el.title = 'Separator. Drag to move, or off the toolbar to remove.'; }
    else if (entry === 'grow') el = tbOwn.grow;
    else if (entry.startsWith('el:')) el = tbOwn[entry.slice(3)];
    else {
      const a = entry.slice(3), m = menuItem(a), kbd = m.querySelector('kbd'), svg = m.querySelector('svg'), label = menuLabel(m);
      el = document.createElement('button'); el.className = 'btn tb-do'; el.dataset.do = a; el.title = label + (kbd ? ` (${kbd.textContent})` : ''); el.setAttribute('aria-label', label);
      if (svg && svg.childElementCount) el.appendChild(svg.cloneNode(true)); else el.textContent = label;
    }
    el.classList.remove('tb-off'); el.dataset.tbi = i;
    if (entry !== 'grow' && el.tagName !== 'SELECT') el.draggable = true;
    tb.appendChild(el);
  });
  tb.appendChild(tbMark);
}
const tbSave = () => { try { localStorage.setItem(TB_KEY, JSON.stringify(tbLayout)); } catch (e) {} };
const tbIndexAt = x => { const els = [...tb.querySelectorAll('[data-tbi]')].filter(e => !e.classList.contains('tb-off')).sort((a, b) => a.dataset.tbi - b.dataset.tbi); for (const e of els) { const r = e.getBoundingClientRect(); if (x < r.left + r.width / 2) return +e.dataset.tbi; } return tbLayout.length; };
function tbPlace(entry, index, from = -1) {
  if (entry.startsWith('do:') && from < 0) { const had = tbLayout.indexOf(entry); if (had >= 0) { from = had; } }
  if (from >= 0) { tbLayout.splice(from, 1); if (from < index) index--; }
  tbLayout.splice(index, 0, entry); tbSave(); renderToolbar();
}
function tbRemove(i) { if (tbLayout[i] === 'grow') return; tbLayout.splice(i, 1); tbSave(); renderToolbar(); }
function tbAddSeparator(index) { tbPlace('sep', index ?? tbLayout.indexOf('grow')); }
function tbReset() { tbLayout = tbDefault.slice(); try { localStorage.removeItem(TB_KEY); } catch (e) {} renderToolbar(); toast('Toolbar reset'); }
tb.addEventListener('click', e => { const b = e.target.closest('.tb-do'); if (b) runDo(b.dataset.do); });
document.querySelectorAll('.mlist [data-do]').forEach(b => { b.draggable = true; b.title = 'Drag to the toolbar to keep it there'; });
const entryOfMenu = a => (a === 'tbsep' ? 'sep' : 'do:' + a);
document.getElementById('menus').addEventListener('dragstart', e => {
  const b = e.target.closest('[data-do]'); if (!b) return;
  tbDrag = { entry: entryOfMenu(b.dataset.do), from: -1, menu: true }; e.dataTransfer.setData('text/plain', menuLabel(b)); e.dataTransfer.effectAllowed = 'copyMove';
  setTimeout(() => { const l = b.closest('.mlist'); if (l) l.classList.add('tb-dragging'); });   // out of the way, so the whole toolbar can be reached
});
tb.addEventListener('dragstart', e => {
  const el = e.target.closest('[data-tbi]'); if (!el) return;
  tbDrag = { entry: tbLayout[+el.dataset.tbi], from: +el.dataset.tbi }; e.dataTransfer.setData('text/plain', el.title || 'item'); e.dataTransfer.effectAllowed = 'copyMove';
});
tb.addEventListener('dragover', e => {
  if (!tbDrag) return; e.preventDefault(); e.dataTransfer.dropEffect = tbDrag.from < 0 ? 'copy' : 'move';
  const i = tbIndexAt(e.clientX), target = tb.querySelector(`[data-tbi="${i}"]`), r = tb.getBoundingClientRect(), x = target ? target.getBoundingClientRect().left : r.right - 12;
  tbMark.style.left = (x - r.left - 2) + 'px'; tbMark.hidden = false;
});
tb.addEventListener('dragleave', e => { if (!tb.contains(e.relatedTarget)) tbMark.hidden = true; });
tb.addEventListener('drop', e => { if (!tbDrag) return; e.preventDefault(); const d = tbDrag; tbDrag = null; tbMark.hidden = true; tbPlace(d.entry, tbIndexAt(e.clientX), d.from); });
window.addEventListener('dragend', e => {
  document.querySelectorAll('.tb-dragging').forEach(l => l.classList.remove('tb-dragging')); tbMark.hidden = true;
  if (document.querySelector('.menu.open')) closeMenus();
  const d = tbDrag; tbDrag = null; if (!d || d.from < 0) return;
  const r = tb.getBoundingClientRect(); if (e.clientX === 0 && e.clientY === 0) return;   // the drag was cancelled
  if (e.clientY < r.top - 6 || e.clientY > r.bottom + 6) { tbRemove(d.from); toast('Removed from the toolbar. View > Reset toolbar brings everything back.'); }
});
tb.addEventListener('contextmenu', e => {
  e.preventDefault();
  const el = e.target.closest('[data-tbi]'), i = el ? +el.dataset.tbi : -1, canGo = el && tbLayout[i] !== 'grow', at = tbIndexAt(e.clientX);
  ctxEl.innerHTML = `<button data-tbx="sep" data-at="${at}" role="menuitem">${ic('separator-vertical')}Add separator here</button>${canGo ? `<button data-tbx="del" data-at="${i}" role="menuitem">${ic('x')}Remove from toolbar</button>` : ''}<hr><button data-tbx="reset" role="menuitem">${ic('rotate-ccw')}Reset toolbar</button>`;
  ctxEl.hidden = false; const r = ctxEl.getBoundingClientRect(); ctxEl.style.left = Math.min(e.clientX, innerWidth - r.width - 4) + 'px'; ctxEl.style.top = Math.min(e.clientY, innerHeight - r.height - 4) + 'px';
});
ctxEl.addEventListener('click', e => { const b = e.target.closest('[data-tbx]'); if (!b) return; closeCtx(); const a = b.dataset.tbx, at = +b.dataset.at; if (a === 'sep') tbAddSeparator(at); else if (a === 'del') tbRemove(at); else tbReset(); });
renderToolbar();

// ---------- start ----------
const crashedLastTime = sessionStart();
let saved = null;
try { saved = JSON.parse(localStorage.getItem(AUTOSAVE_KEY)); } catch (e) {}
P = saved && Array.isArray(saved.items) ? ensureFloor(saved) : TEMPLATES[1].make();
renderGallery();
libStart();
hwStart();
size3D();
applyLayout();
render();
(async () => {
  const fromDb = await autosaveRestore();
  if (!saved && !fromDb) { fillCatalog(); dlg.showModal(); }
  if (crashedLastTime && (saved || fromDb)) toast("Atelier didn't close properly last time. Your work is back as it was. File > Version history has earlier versions.", true);
  snapQuiet('When Atelier started');
})();

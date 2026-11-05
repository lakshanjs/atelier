// ---------- render ----------
function renderStatus() {
  const rows = cutRows(), ps = panelsOnly(), q = id => document.getElementById(id);
  const sheets = stocks(rows).reduce((a, [t, c]) => a + packSheets(rows, t, c).sheets.length, 0), band = ps.reduce((a, p) => a + bandLen(p), 0);
  const real = P.items.filter(i => !isRoomPart(i)), u = real.length ? unionBounds(real) : null;
  q('fSize').innerHTML = u ? `<b>${fmt(u.max[0] - u.min[0])}</b> wide, <b>${fmt(u.max[1] - u.min[1])}</b> high, <b>${fmt(u.max[2] - u.min[2])}</b> deep` : 'Empty';
  q('fBoards').innerHTML = `<b>${ps.length}</b> ${ps.length === 1 ? 'panel' : 'panels'}`;
  q('fSheets').innerHTML = `<b>${sheets}</b> ${sheets === 1 ? 'sheet' : 'sheets'}`;
  q('fBand').innerHTML = `<b>${longLength(band * 1.1)}</b> edge banding${totalCost() > 0 ? `<span style="margin-left:22px"><b>${esc(money(totalCost()))}</b> materials</span>` : ''}`;
  const w = checks(), wb = q('warnBtn'); lastWarn = w; wb.hidden = !w.length; wb.innerHTML = `${ic('triangle-alert')}${w.length} to check`; wb.title = w[0] || '';
  if (!w.length) q('warnPop').hidden = true; else if (!q('warnPop').hidden) fillWarnPop();
}
let lastWarn = [], toastT = 0;
function toast(text, bad) { const el = document.getElementById('toast'); el.textContent = text; el.classList.toggle('err', !!bad); el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { el.hidden = true; }, bad ? 5000 : 1800); }
function fillWarnPop() { document.getElementById('warnPop').innerHTML = lastWarn.map(w => `<button>${esc(w)}</button>`).join(''); }
function renderChrome() {
  const q = id => document.getElementById(id);
  updateTitle();
  q('empty').hidden = realItems().length > 0;
  q('unitSel').value = unitKey();
  q('bUndo').disabled = !undoS.length; q('bRedo').disabled = !redoS.length;
  if (document.activeElement !== q('pname')) q('pname').value = P.name;
  q('snapOn').checked = P.snap;
  const GRIDS = {
    mm: [[1, '1 mm'], [5, '5 mm'], [10, '10 mm'], [25, '25 mm'], [50, '50 mm'], [100, '100 mm']],
    cm: [[5, '0.5 cm'], [10, '1 cm'], [20, '2 cm'], [50, '5 cm'], [100, '10 cm'], [500, '50 cm']],
    m: [[10, '1 cm'], [50, '5 cm'], [100, '10 cm'], [500, '50 cm'], [1000, '1 m']],
    in: [[3.175, '1/8"'], [6.35, '1/4"'], [12.7, '1/2"'], [25.4, '1"'], [50.8, '2"'], [152.4, '6"']],
    ft: [[25.4, '1"'], [76.2, '3"'], [152.4, '6"'], [304.8, "1'"], [609.6, "2'"], [1524, "5'"]],
    yd: [[25.4, '1"'], [152.4, '6"'], [304.8, "1'"], [914.4, '1 yd']],
  }, opts = GRIDS[unitKey()];
  if (!opts.some(o => Math.abs(o[0] - P.grid) < .01)) P.grid = { mm: 10, cm: 10, m: 100, in: 25.4, ft: 25.4, yd: 152.4 }[unitKey()];
  q('gridSel').innerHTML = opts.map(([v, n]) => `<option value="${v}" ${Math.abs(v - P.grid) < .01 ? 'selected' : ''}>${n}</option>`).join('');
  document.querySelectorAll('[data-tool]').forEach(b => b.setAttribute('aria-pressed', b.dataset.tool === tool));
  const tips = { select: 'Drag it to move. Arrows move it one way.', rotate: 'Drag it to spin. Arcs turn it the other ways. Alt for any angle.', scale: 'Drag a square to stretch that side. Shift for both ways. Alt for free sizing.' };
  q('hint3d').textContent = tool === 'measure' ? (mEdit ? 'Drop this end where it should go. Esc cancels.' : measA ? 'Click the second point. The line stays on X, Y or Z. Esc cancels.' : 'Click a corner or a panel edge to start measuring. Tab picks another point nearby. Drag a dot to change a measurement, or click it to measure on from there. Drag elsewhere to look around.') : selected().length ? `${tips[tool]} Ctrl + drag rotates the view.` : 'Click something to select it. Ctrl + drag rotates the view.';
}
function render() { hoverBox.visible = false; renderChrome(); renderSide(); renderStatus(); dirty = true; }
function loadProject(p) { openedName = null; setTimeout(ensureModels); P = ensureFloor(p); sel = []; undoS = []; redoS = []; camSet = false; Object.keys(vt).forEach(n => { vt[n] = {}; }); fileHandle = null; sect.on = false; updateSection(); syncSection(); persist(); markSaved(false); render(); }

// ---------- plans ----------
function renderPack() {
  const rows = cutRows(), n = v => bare(v);
  const W = 560, H = 400;
  let h = `<h1 style="font-size:28px;font-weight:600;margin:0">${esc(P.name)}</h1><p class="note" style="font-size:15px">Everything your woodworker needs. Sizes are finished sizes, in ${unitOf().name}. Numbers on the drawings match the cut list.</p>`;
  if (!panelsOnly().length) { h += `<p>There are no panels yet. Go back and add some from the gallery.</p>`; document.getElementById('packBody').innerHTML = h; return; }
  h += `<h2>Views</h2><div class="draws">${Object.keys(VIEWS).map(vn => {
    const t = fitTransform(vn, W, H, 46, panelsOnly());
    const u = unionBounds(panelsOnly()), V = VIEWS[vn], a = u.max[V.u] - u.min[V.u], b = u.max[V.v] - u.min[V.v];
    return `<div><b>${VIEWS[vn].title}</b>: ${bare(a)} × ${bare(b)}${unitMark()}<svg viewBox="0 0 ${W} ${H}">${flatString(vn, t, W, H, { static: true })}</svg></div>`;
  }).join('')}</div>`;
  if (sect.on) {
    const vn = ['side', 'top', 'front'][sect.axis], tc = fitTransform(vn, W * 1.4, H * 1.2, 46, panelsOnly());
    h += `<h2>Section</h2><p class="note" style="font-size:15px">Sliced ${['left to right', 'top to bottom', 'front to back'][sect.axis]} at ${esc(fmt(sect.pos))}. Dark areas are boards cut by the slice.</p><svg viewBox="0 0 ${W * 1.4} ${H * 1.2}" style="width:100%;max-width:800px;height:auto;display:block">${flatString(vn, tc, W * 1.4, H * 1.2, { static: true, cut: true })}</svg>`;
  }
  h += `<h2>Cut list</h2><table><tr><th>Part</th><th>Numbers</th><th>How many</th><th>Length</th><th>Width</th><th>Thickness</th><th>Board</th><th>Edge banding</th><th>Grain</th><th>Shape</th></tr>`;
  rows.forEach(r => { h += `<tr><td>${esc(r.part)}</td><td>${r.ids.join(', ')}</td><td class="n">${r.qty}</td><td class="n">${n(r.len)}</td><td class="n">${n(r.wid)}</td><td class="n">${n(r.thk)}</td><td>${BOARDS[r.mat].name}</td><td>${r.band}</td><td>${{ any: '—', length: 'Along length', width: 'Across width' }[r.grain]}</td><td>${esc(r.note || '—')}</td></tr>`; });
  h += `</table><h2>Cutting plan</h2><p class="note" style="font-size:15px">Rip each sheet into strips along its length, then cross-cut the parts. Allows 4 mm for each saw cut. Grey is offcut. Arrows mark parts where the grain matters: sheet grain is taken to run along the sheet's length. Shaped parts are shown as the rectangle they're cut from.</p>`;
  stocks(rows).forEach(([t, c]) => {
    const { sheets, over } = packSheets(rows, t, c);
    h += `<h3>${n(t)} ${BOARDS[c].name}: ${sheets.length} ${sheets.length === 1 ? 'sheet' : 'sheets'}</h3><div class="sheets">`;
    sheets.forEach((sh, i) => {
      const { sl: SLn, sw: SWn } = stockOf(c);
      let v = `<rect x="0" y="0" width="${SLn}" height="${SWn}" fill="#eceeed" stroke="#5c686e" stroke-width="3"/>`;
      sh.strips.forEach(st => st.parts.forEach(q => {
        const fs = Math.max(20, Math.min(52, q.w * .3, q.l / 7)), cx = q.x + q.l / 2, cy = q.y + q.w / 2;
        v += `<rect x="${q.x}" y="${q.y}" width="${q.l}" height="${q.w}" fill="#fff" stroke="#20262a" stroke-width="3"/>`;
        if (q.grain !== 'any') { const ay = q.y + q.w - Math.min(26, q.w * .18), a0 = q.x + q.l * .3, a1 = q.x + q.l * .7; v += `<path d="M${a0} ${ay}H${a1}M${a1 - 22} ${ay - 12}L${a1} ${ay}L${a1 - 22} ${ay + 12}" stroke="#20262a" stroke-width="3" fill="none"/>`; }
        v += q.w >= 150 ? `<text x="${cx}" y="${cy}" font-family="Barlow,sans-serif" font-size="${fs}" font-weight="600" text-anchor="middle">${q.id}</text><text x="${cx}" y="${cy + fs}" font-family="Barlow,sans-serif" font-size="${fs * .8}" text-anchor="middle">${esc(bare(q.l))} × ${esc(bare(q.w))}</text>`
          : `<text x="${cx}" y="${cy + 8}" font-family="Barlow,sans-serif" font-size="${Math.min(40, q.w * .7)}" text-anchor="middle">${q.id}  ${esc(bare(q.l))} × ${esc(bare(q.w))}</text>`;
      }));
      h += `<div><div>Sheet ${i + 1}</div><svg viewBox="-10 -10 ${SLn + 20} ${SWn + 20}">${v}</svg></div>`;
    });
    h += `</div>`;
    if (over.length) h += `<p style="color:var(--danger)">Too big for one sheet, so these need a joint: ${over.map(q => q.id).join(', ')}.</p>`;
  });
  const shaped = panelsOnly().filter(hasShape);
  if (shaped.length) h += `<h2>Shaped panels</h2><div class="draws">${shaped.map(p => `<div><b>${esc(p.name)} ${p.id}</b>${panelPreview(p, false)}<p class="note">${esc(shapeNote(p))}. Corners are numbered as shown.</p></div>`).join('')}</div>`;
  const lines = sheetLines(), hw = hardwareLines(), anyPrice = lines.some(s => s.price) || P.bandPrice || hwCost() > 0;
  h += `<h2>Shopping list</h2><table><tr><th>Item</th><th style="text-align:right">How many</th><th style="text-align:right">Each</th><th style="text-align:right">Total</th><th style="text-align:left">Note</th></tr>`;
  lines.forEach(s => { h += `<tr><td>${BOARDS[s.m].name} ${n(s.t)}, ${esc(bare(stockOf(s.m).sl))} × ${esc(bare(stockOf(s.m).sw))} sheet</td><td class="n">${s.n}</td><td class="n">${s.price ? esc(money(s.price)) : '—'}</td><td class="n">${s.price ? esc(money(s.cost)) : '—'}</td><td></td></tr>`; });
  const bandMm = bandTotalMm(); if (bandMm) h += `<tr><td>Edge banding</td><td class="n">${longLength(bandMm)}</td><td class="n">${P.bandPrice ? esc(money(P.bandPrice)) + ' / m' : '—'}</td><td class="n">${P.bandPrice ? esc(money(bandCost())) : '—'}</td><td>Includes 10% spare</td></tr>`;
  hw.forEach(([a, b, c]) => { const pr = hwPrice(a); h += `<tr><td>${esc(a)}</td><td class="n">${b}</td><td class="n">${pr ? esc(money(pr)) : '—'}</td><td class="n">${pr ? esc(money(pr * b)) : '—'}</td><td>${esc(c)}</td></tr>`; });
  h += `<tr><td><b>Materials total</b></td><td></td><td></td><td class="n"><b>${anyPrice ? esc(money(totalCost())) : '—'}</b></td><td>${anyPrice ? 'Items with no price set are left out' : 'Set prices in Properties with nothing selected'}</td></tr></table>`;
  const notes = ['Edge-band every edge listed in the cut list.', 'Measure the walls at floor and at full height before cutting. Walls are rarely square. Fix tall pieces to the wall so they can\'t tip.', ...checks().map(w => 'To check: ' + w)];
  h += `<h2>Notes</h2><ul id="packNotes">${notes.map(x => `<li>${esc(x)}</li>`).join('')}</ul>`;
  document.getElementById('packBody').innerHTML = h;
}
document.getElementById('bPack').onclick = () => { renderPack(); document.getElementById('pack').classList.add('open'); };
document.getElementById('packBack').onclick = () => document.getElementById('pack').classList.remove('open');
document.getElementById('bPrint').onclick = () => window.print();
document.getElementById('bCsv').onclick = () => {
  const k = unitKey(), u = k, m = v => (k === 'in' ? Math.round(v / 25.4 * 8) / 8 : k === 'mm' ? v : Math.round(v / UNITS[k].mm * 1000) / 1000);
  const body = cutRows().map(r => [`"${r.part.replace(/"/g, '""')}"`, `"${r.ids.join(' ')}"`, r.qty, m(r.len), m(r.wid), m(r.thk), BOARDS[r.mat].name, r.band.replace('—', ''), { any: '', length: 'Along length', width: 'Across width' }[r.grain], `"${(r.note || '').replace(/"/g, '""')}"`].join(',')).join('\n');
  download(`${P.name} cut list.csv`, `Part,Numbers,How many,Length ${u},Width ${u},Thickness ${u},Board,Edge banding,Grain,Shape\n${body}`, 'text/csv');
};
function download(name, text, type) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); }

// ---------- top bar ----------
const dlg = document.getElementById('newDlg');
document.getElementById('bNew').onclick = () => { fillCatalog(); dlg.showModal(); };
document.getElementById('newClose').onclick = () => dlg.close();
function miniFront(p) {
  const list = p.items.filter(i => i.kind === 'panel'); const W = 220, H = 100;
  if (!list.length) return `<rect x="60" y="20" width="100" height="60" fill="none" stroke="#5c686e" stroke-dasharray="4 4"/>`;
  const u = unionBounds(list), k = Math.min((W - 10) / (u.max[0] - u.min[0]), (H - 8) / (u.max[1] - u.min[1])), ox = (W - (u.max[0] - u.min[0]) * k) / 2 - u.min[0] * k, oy = H - 4 + u.min[1] * k;
  return list.slice().sort((a, b) => a.pos[2] - b.pos[2]).map(it => { const b = bounds(it); return `<rect x="${ox + b.min[0] * k}" y="${oy - b.max[1] * k}" width="${Math.max(.7, (b.max[0] - b.min[0]) * k)}" height="${Math.max(.7, (b.max[1] - b.min[1]) * k)}" fill="${/Back/.test(it.name) ? '#fff' : /Door|Drawer front/.test(it.name) ? '#c7cfcc' : '#20262a'}" ${/Door|Drawer front/.test(it.name) ? 'stroke="#20262a" stroke-width=".7" fill-opacity=".85"' : ''}/>`; }).join('');
}
function fillCatalog() {
  const cat = document.getElementById('cat'); cat.innerHTML = '';
  TEMPLATES.forEach(t => {
    const b = document.createElement('button'); b.className = 'card';
    b.innerHTML = `<svg viewBox="0 0 220 100">${miniFront(t.make())}</svg><b>${t.name}</b><span>${t.sub}</span>`;
    b.onclick = () => { dlg.close(); loadProject(t.make()); };
    cat.appendChild(b);
  });
}
// Saving goes straight back to the same file where the browser allows it. Files opened or saved here stay in File > recent.
let fileHandle = null, unsaved = false, recents = [];
let kvDb = null;
function kv() { return kvDb || (kvDb = new Promise((ok, no) => { const r = indexedDB.open('furniture-files', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); })); }
async function kvGet(k) { const db = await kv(); return new Promise((ok, no) => { const r = db.transaction('kv').objectStore('kv').get(k); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); }); }
async function kvSet(k, v) { const db = await kv(); return new Promise((ok, no) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = () => ok(); t.onerror = t.onabort = () => no(t.error); }); }
function renderRecents() {
  const el = document.getElementById('recentList'); if (!el) return;
  el.innerHTML = recents.length ? `<div class="rhead">Recent</div>${recents.map((r, i) => `<button data-do="recent:${i}">${ic('clock')}${esc(r.name)}</button>`).join('')}<hr>` : '';
}
async function rememberFile(h) {
  fileHandle = h;
  try {
    const keep = []; for (const r of recents) if (!(await r.handle.isSameEntry(h))) keep.push(r);
    recents = [{ name: h.name, handle: h }, ...keep].slice(0, 6); renderRecents(); await kvSet('recents', recents); await kvSet('current', h);
  } catch (e) {}
}
function markSaved(state) { unsaved = state; const el = document.getElementById('saveState'); if (el) { el.textContent = state ? 'Not saved' : fileHandle ? 'Saved' : ''; el.title = fileHandle ? fileHandle.name : ''; } updateTitle(); }
// The window title is what Windows shows on the taskbar: the open file, or the project's name until it has one.
let openedName = null;
function updateTitle() { const n = fileHandle ? fileHandle.name : openedName || (P ? P.name : ''), t = `${unsaved ? '• ' : ''}${n}${n ? ' - ' : ''}Atelier`; if (document.title !== t) document.title = t; }
const fileMsg = t => toast(t, true);
async function saveProject(asNew) {
  const types = [{ description: 'Atelier project', accept: { 'application/x-atlr': ['.atlr'] } }];
  try {
    if (!window.showSaveFilePicker) { downloadBlob(`${P.name}.atlr`, await atelierBytes(), 'application/x-atlr'); markSaved(false); return; }
    let h = asNew ? null : fileHandle;
    if (h && !/\.atlr$/i.test(h.name)) h = null;   // a project opened from an older .json is saved on as an Atelier file
    if (h && await h.requestPermission({ mode: 'readwrite' }) !== 'granted') h = null;
    if (!h) h = await showSaveFilePicker({ suggestedName: `${P.name}.atlr`, types });
    toast('Saving…');
    const bytes = await atelierBytes(), w = await h.createWritable(); await w.write(bytes); await w.close();
    await rememberFile(h); markSaved(false); toast(`Saved ${h.name} (${(bytes.length / 1048576).toFixed(1)} MB)`);
  } catch (e) { if (e.name !== 'AbortError') fileMsg(`Couldn't save: ${e.message}. Use Save as to choose another file.`); }
}
async function openHandle(h) {
  if (await h.requestPermission({ mode: 'readwrite' }) !== 'granted') { fileMsg(`No permission to open ${h.name}.`); return; }
  await openBytes(await (await h.getFile()).arrayBuffer()); await rememberFile(h); markSaved(false);
}
async function openProject() {
  if (!window.showOpenFilePicker) { document.getElementById('fileIn').click(); return; }
  try { const [h] = await showOpenFilePicker({ types: [{ description: 'Atelier project', accept: { 'application/x-atlr': ['.atlr'], 'application/json': ['.json'] } }] }); await openHandle(h); }
  catch (e) { if (e.name !== 'AbortError') fileMsg(`Couldn't open that file: ${e.message}. Choose a file saved from here.`); }
}
async function openRecent(i) {
  const r = recents[i]; if (!r) return;
  try { await openHandle(r.handle); }
  catch (e) { fileMsg(`Couldn't open ${r.name}: it may have been moved or deleted.`); recents.splice(i, 1); renderRecents(); kvSet('recents', recents).catch(() => {}); }
}
(async () => { try { recents = (await kvGet('recents')) || []; renderRecents(); const h = await kvGet('current'); if (h && !fileHandle && unsaved === false) { fileHandle = h; markSaved(false); } } catch (e) {} })();
document.getElementById('bOpen').onclick = openProject;
document.getElementById('fileIn').onchange = async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try { await openBytes(await f.arrayBuffer()); fileHandle = null; openedName = f.name; markSaved(false); }
  catch (err) { toast(`Couldn't open ${f.name}: ${err.message}. Choose a file saved from here.`, true); }
};
// ---------- Sweet Home 3D import ----------
// A .sh3d file is a zip holding the design in Home.xml, in centimetres. Walls come in at their real size and
// angle. Everything else is a plain box of the right size, because its shape is a 3D model rather than boards.
async function readZipText(buf, wanted) { const b = await readZipBytes(buf, wanted); return b ? new TextDecoder().decode(b) : null; }
const zipIndexes = new WeakMap();
function zipIndex(buf) {
  if (zipIndexes.has(buf)) return zipIndexes.get(buf);
  const v = new DataView(buf), u8 = new Uint8Array(buf), dec = new TextDecoder(), out = new Map();
  let end = buf.byteLength - 22; while (end >= 0 && v.getUint32(end, true) !== 0x06054b50) end--;
  if (end < 0) throw new Error('it is not a Sweet Home 3D file');
  let at = v.getUint32(end + 16, true);
  for (let i = v.getUint16(end + 10, true); i > 0; i--) {
    const nameLen = v.getUint16(at + 28, true), name = dec.decode(u8.subarray(at + 46, at + 46 + nameLen));
    if (!out.has(name)) out.set(name, at);
    at += 46 + nameLen + v.getUint16(at + 30, true) + v.getUint16(at + 32, true);
  }
  zipIndexes.set(buf, out); return out;
}
async function readZipBytes(buf, wanted) {
  const at = zipIndex(buf).get(wanted); if (at === undefined) return null;
  const v = new DataView(buf), u8 = new Uint8Array(buf);
  const off = v.getUint32(at + 42, true), start = off + 30 + v.getUint16(off + 26, true) + v.getUint16(off + 28, true), data = u8.subarray(start, start + v.getUint32(at + 20, true));
  if (v.getUint16(at + 10, true) === 0) return data;
  return new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
}
// 3D models are kept out of the project data, because every undo step copies that. They live in MODELS and the app's
// own database, and only go into the file when a project is saved. Each is stored in a box from -1 to 1.
const MODELS = {}, modelGeos = {}, TEXTURES = {};
// One SVG path from Sweet Home 3D (M, L, H, V, A and Z, big or small) as a list of points.
function svgPoints(d) {
  const tok = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:[eE][-+]?\d+)?/g) || [], out = []; let i = 0, cmd = '', x = 0, y = 0;
  const n = () => +tok[i++];
  while (i < tok.length) {
    if (/[a-zA-Z]/.test(tok[i])) cmd = tok[i++];
    const rel = cmd === cmd.toLowerCase(), c = cmd.toUpperCase();
    if (c === 'Z') break;
    if (c === 'M' || c === 'L') { const a = n(), b = n(); x = rel ? x + a : a; y = rel ? y + b : b; out.push([x, y]); if (c === 'M') cmd = rel ? 'l' : 'L'; }
    else if (c === 'H') { const a = n(); x = rel ? x + a : a; out.push([x, y]); }
    else if (c === 'V') { const a = n(); y = rel ? y + a : a; out.push([x, y]); }
    else if (c === 'A') {
      let rx = Math.abs(n()), ry = Math.abs(n()); const phi = n() * Math.PI / 180, large = n(), sweep = n(), a = n(), b = n(), ex = rel ? x + a : a, ey = rel ? y + b : b;
      const cp = Math.cos(phi), sp = Math.sin(phi), dx = (x - ex) / 2, dy = (y - ey) / 2, x1 = cp * dx + sp * dy, y1 = -sp * dx + cp * dy, lam = x1 * x1 / (rx * rx) + y1 * y1 / (ry * ry);
      if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam); }
      const top = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1, bot = rx * rx * y1 * y1 + ry * ry * x1 * x1, k = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, top / (bot || 1))), cx1 = k * rx * y1 / ry, cy1 = -k * ry * x1 / rx;
      const cx = cp * cx1 - sp * cy1 + (x + ex) / 2, cy = sp * cx1 + cp * cy1 + (y + ey) / 2, t0 = Math.atan2((y1 - cy1) / ry, (x1 - cx1) / rx); let dt = Math.atan2((-y1 - cy1) / ry, (-x1 - cx1) / rx) - t0;
      if (sweep && dt < 0) dt += Math.PI * 2; if (!sweep && dt > 0) dt -= Math.PI * 2;
      for (let s = 1; s <= 24; s++) { const t = t0 + dt * s / 24, u = rx * Math.cos(t), v = ry * Math.sin(t); out.push([cp * u - sp * v + cx, sp * u + cp * v + cy]); }
      x = ex; y = ey;
    } else i++;
  }
  return out;
}
const area2 = pts => pts.reduce((a, q, i) => { const r = pts[(i + 1) % pts.length]; return a + q[0] * r[1] - r[0] * q[1]; }, 0) / 2;
const insidePoly = (q, pts) => { let c = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const a = pts[i], b = pts[j]; if ((a[1] > q[1]) !== (b[1] > q[1]) && q[0] < (b[0] - a[0]) * (q[1] - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
const triangles = pts => { const ctr = pts.map(c => new THREE.Vector2(c[0], c[1])); return THREE.ShapeUtils.triangulateShape(ctr, []).map(f => f.map(i => pts[i])); };
// Cuts holes out of a floor: every convex piece of the floor is split against every triangle of each hole.
function roomCut(room, holes) {
  let pieces = triangles(room); const start = pieces.reduce((a, q) => a + Math.abs(area2(q)), 0), rim = [];
  holes.forEach(hole => {
    triangles(hole).forEach(tri0 => {
      const tri = area2(tri0) < 0 ? tri0.slice().reverse() : tri0, out = [];
      pieces.forEach(poly => {
        let inner = poly;
        for (let e = 0; e < 3 && inner.length >= 3; e++) {
          const a = tri[e], b = tri[(e + 1) % 3], side = q => (b[0] - a[0]) * (q[1] - a[1]) - (b[1] - a[1]) * (q[0] - a[0]), inP = [], outP = [];
          inner.forEach((q, j) => { const r = inner[(j + 1) % inner.length], sq = side(q), sr = side(r); if (sq >= 0) inP.push(q); if (sq <= 0) outP.push(q); if (sq * sr < 0) { const t = sq / (sq - sr), m = [q[0] + (r[0] - q[0]) * t, q[1] + (r[1] - q[1]) * t]; inP.push(m); outP.push(m); } });
          if (outP.length >= 3 && Math.abs(area2(outP)) > 1) out.push(outP);
          inner = inP;
        }
      });
      pieces = out;
    });
    hole.forEach((q, i) => { const r = hole[(i + 1) % hole.length]; if (insidePoly([(q[0] + r[0]) / 2, (q[1] + r[1]) / 2], room)) rim.push(q[0], q[1], r[0], r[1]); });
  });
  if (start - pieces.reduce((a, q) => a + Math.abs(area2(q)), 0) < 100) return null;   // the hole missed this floor
  const tris = [], tidy = v => Math.round(v * 10) / 10;
  pieces.forEach(q => { for (let i = 1; i < q.length - 1; i++) tris.push(tidy(q[0][0]), tidy(q[0][1]), tidy(q[i][0]), tidy(q[i][1]), tidy(q[i + 1][0]), tidy(q[i + 1][1])); });
  return { tris, rim: rim.map(tidy) };
}
const SH3D_COLOURS = { white: '#ffffff', flltgrey: '#b8b8b8', silver: '#c0c0c0', archwhite2: '#e8e8e0', yellowbrt: '#e6c84a', flblack: '#222222', dkdkgrey: '#333333' };
const hexOf = c => '#' + c.map(v => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('');
function parseMtl(text) {
  const out = {}; let cur = null;
  text.split('\n').forEach(line => {
    const t = line.trim().split(/\s+/);
    if (t[0] === 'newmtl') cur = out[t.slice(1).join(' ')] = { o: 1 };
    else if (!cur) return;
    else if (t[0] === 'Kd') cur.c = hexOf([+t[1], +t[2], +t[3]]);
    else if (t[0] === 'd') cur.o = +t[1];
    else if (t[0] === 'Tr') cur.o = 1 - +t[1];
    else if (t[0] === 'map_Kd') cur.map = t[t.length - 1];
  });
  return out;
}
function parseObj(text, rot) {
  const V = [], N = [], T = [], groups = new Map(), libs = []; let cur = null;
  const use = name => { cur = groups.get(name); if (!cur) { cur = { name, pos: [], nor: [], tex: [], hasTex: false, idx: [], seen: new Map() }; groups.set(name, cur); } };
  const turn = (x, y, z) => (rot ? [rot[0] * x + rot[1] * y + rot[2] * z, rot[3] * x + rot[4] * y + rot[5] * z, rot[6] * x + rot[7] * y + rot[8] * z] : [x, y, z]);
  use('default');
  for (let at = 0; at < text.length;) {
    let end = text.indexOf('\n', at); if (end < 0) end = text.length;
    const line = text.slice(at, end).trim(); at = end + 1;
    if (!line || line[0] === '#') continue;
    const t = line.split(/\s+/), k = t[0];
    if (k === 'v') V.push(turn(+t[1], +t[2], +t[3]));
    else if (k === 'vn') N.push(turn(+t[1], +t[2], +t[3]));
    else if (k === 'vt') T.push([+t[1], +t[2]]);
    else if (k === 'usemtl') use(t.slice(1).join(' '));
    else if (k === 'mtllib') libs.push(t.slice(1).join(' '));
    else if (k === 'f' && t.length > 3) {
      const corners = t.slice(1).map(c => { const b = c.split('/'), vi = +b[0], ni = +b[2], ti = +b[1]; return { v: vi < 0 ? V.length + vi : vi - 1, n: !b[2] ? -1 : ni < 0 ? N.length + ni : ni - 1, t: !b[1] ? -1 : ti < 0 ? T.length + ti : ti - 1 }; });
      let flat = null;
      if (corners.some(c => c.n < 0)) {   // no normals given: each face shades flat
        const a = V[corners[0].v], b = V[corners[1].v], c = V[corners[2].v]; if (!a || !b || !c) continue;
        const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], wx = c[0] - a[0], wy = c[1] - a[1], wz = c[2] - a[2], nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx, l = Math.hypot(nx, ny, nz) || 1;
        flat = [nx / l, ny / l, nz / l];
      }
      const emit = c => {
        const key = flat ? null : c.v + '/' + c.n + '/' + c.t; let id = key ? cur.seen.get(key) : undefined;
        if (id === undefined) { const q = V[c.v], n = flat || N[c.n] || [0, 1, 0]; if (!q) return -1; id = cur.pos.length / 3; cur.pos.push(q[0], q[1], q[2]); cur.nor.push(n[0], n[1], n[2]); const uv = T[c.t]; if (uv) { cur.tex.push(uv[0], uv[1]); cur.hasTex = true; } else cur.tex.push(0, 0); if (key) cur.seen.set(key, id); }
        return id;
      };
      const ids = corners.map(emit); if (ids.includes(-1)) continue;
      for (let i = 1; i < ids.length - 1; i++) cur.idx.push(ids[0], ids[i], ids[i + 1]);
    }
  }
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity], parts = [...groups.values()].filter(g => g.idx.length);
  parts.forEach(g => { for (let i = 0; i < g.pos.length; i++) { const k = i % 3; if (g.pos[i] < lo[k]) lo[k] = g.pos[i]; if (g.pos[i] > hi[k]) hi[k] = g.pos[i]; } });
  const mid = lo.map((v, k) => (v + hi[k]) / 2), half = lo.map((v, k) => (hi[k] - v) / 2 || 1);
  return { libs, raw: lo.map((v, k) => hi[k] - v), parts: parts.map(g => ({
    name: g.name,
    p: Int16Array.from(g.pos, (v, i) => Math.round((v - mid[i % 3]) / half[i % 3] * 32767)),
    n: Int8Array.from(g.nor, v => Math.round(v * 127)),
    i: Uint32Array.from(g.idx),
    u: g.hasTex ? Float32Array.from(g.tex) : null,
  })) };
}
async function averageColour(bytes) {
  try {
    const bmp = await createImageBitmap(new Blob([bytes])), c = document.createElement('canvas'); c.width = c.height = 16;
    const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(bmp, 0, 0, 16, 16); const d = x.getImageData(0, 0, 16, 16).data; let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 40) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
    return n ? hexOf([r / n / 255, g / n / 255, b / n / 255]) : null;
  } catch (e) { return null; }
}
async function keepTexture(buf, tag, path) {   // returns its key, or null if the image isn't there
  const key = sh3dTexKey(tag, path); if (TEXTURES[key]) return key;
  const bytes = await readZipBytes(buf, path); if (!bytes) return null;
  TEXTURES[key] = { bytes: bytes.slice(), avg: (await averageColour(bytes)) || '#9aa1a5' }; kvSet('tex:' + key, TEXTURES[key]).catch(() => {});
  return key;
}
async function buildModel(buf, path, rot, isWindow, tag) {
  const bytes = await readZipBytes(buf, path); if (!bytes) return null;
  const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '', model = parseObj(new TextDecoder().decode(bytes), rot), mats = {};
  for (const lib of model.libs) { const m = await readZipBytes(buf, dir + lib); if (m) Object.assign(mats, parseMtl(new TextDecoder().decode(m))); }
  for (const part of model.parts) {
    const m = mats[part.name] || {};
    let c = m.c; if (m.map) { const k = await keepTexture(buf, tag, dir + m.map); if (k) { c = TEXTURES[k].avg; if (part.u) part.map = k; } }
    part.c = c || SH3D_COLOURS[part.name] || '#9aa1a5';
    part.o = m.o ?? 1;
    if (isWindow && part.name === 'flltgrey') { part.c = '#a9cfe0'; part.o = .3; }   // the glass in Sweet Home 3D's own windows
  }
  return { parts: model.parts };
}
const unb64 = (str, T) => { const bin = atob(str), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new T(u.buffer); };
function usedTextures() {
  const out = new Set(), add = k => { if (k) out.add(k); };
  P.items.forEach(i => {
    if (i.tex) add(i.tex.key); [i.sideL, i.sideR, i.sideT].forEach(q => { if (q && q.tex) add(q.tex.key); });
    add(i.ptex); Object.values(i.matTex || {}).forEach(add);
    if (i.model && MODELS[i.model]) MODELS[i.model].parts.forEach(q => add(q.map));
  });
  return [...out];
}
// An .atlr file is a zip: project.json holds the design and its camera view, and every 3D model and image sits beside it.
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = u => { let c = 0xffffffff; for (let i = 0; i < u.length; i++) c = CRC_TABLE[(c ^ u[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const bytesOf = a => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
async function zipBytes(entries) {
  const enc = new TextEncoder(), locals = [], central = []; let at = 0;
  for (const { name, data } of entries) {
    const nm = enc.encode(name), packed = new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer()), small = packed.length < data.length, body = small ? packed : data, crc = crc32(data);
    const head = (size, extra) => { const b = new Uint8Array(size), v = new DataView(b.buffer); extra(v); return b; };
    const shared = (v, o) => { v.setUint16(o, 20, true); v.setUint16(o + 2, 0x0800, true); v.setUint16(o + 4, small ? 8 : 0, true); v.setUint32(o + 10, crc, true); v.setUint32(o + 14, body.length, true); v.setUint32(o + 18, data.length, true); v.setUint16(o + 22, nm.length, true); };
    locals.push(head(30, v => { v.setUint32(0, 0x04034b50, true); shared(v, 4); }), nm, body);
    central.push(head(46, v => { v.setUint32(0, 0x02014b50, true); v.setUint16(4, 20, true); shared(v, 6); v.setUint32(42, at, true); }), nm);
    at += 30 + nm.length + body.length;
  }
  const cSize = central.reduce((n, b) => n + b.length, 0), end = new Uint8Array(22), v = new DataView(end.buffer);
  v.setUint32(0, 0x06054b50, true); v.setUint16(8, entries.length, true); v.setUint16(10, entries.length, true); v.setUint32(12, cSize, true); v.setUint32(16, at, true);
  return new Uint8Array(await new Blob([...locals, ...central, end]).arrayBuffer());
}
async function atelierBytes() {
  await ensureModels();
  const entries = [], models = [], textures = [];
  [...new Set(P.items.map(i => i.model).filter(k => k && MODELS[k]))].forEach((key, m) => {
    models.push({ key, parts: MODELS[key].parts.map((q, i) => {
      [['p', q.p], ['n', q.n], ['i', q.i], ['u', q.u]].forEach(([k, a]) => { if (a) entries.push({ name: `models/${m}/${i}.${k}`, data: bytesOf(a) }); });
      return { name: q.name, c: q.c, o: q.o, map: q.map };
    }) });
  });
  usedTextures().filter(k => TEXTURES[k]).forEach((key, t) => { entries.push({ name: `textures/${t}`, data: TEXTURES[key].bytes }); textures.push({ key, avg: TEXTURES[key].avg }); });
  const manifest = { format: 'atelier', version: 1, project: P, view: { pos: camera.position.toArray(), target: controls.target.toArray() }, models, textures };
  entries.unshift({ name: 'project.json', data: new TextEncoder().encode(JSON.stringify(manifest)) });
  return zipBytes(entries);
}
async function openBytes(buf) {
  let project, view = null;
  if (new Uint8Array(buf, 0, 2).join() === '80,75') {
    const raw = await readZipText(buf, 'project.json'), m = raw && JSON.parse(raw);
    if (!m || m.format !== 'atelier') throw new Error('it is not an Atelier file');
    if (m.version > 1) throw new Error('it was saved by a newer version of Atelier');
    const part = async (name, T) => { const b = await readZipBytes(buf, name); return b ? new T(b.slice().buffer) : null; };
    for (let t = 0; t < m.textures.length; t++) { const e = m.textures[t], b = await readZipBytes(buf, `textures/${t}`); if (b) { TEXTURES[e.key] = { bytes: b.slice(), avg: e.avg }; kvSet('tex:' + e.key, TEXTURES[e.key]).catch(() => {}); } }
    for (let n = 0; n < m.models.length; n++) {
      const e = m.models[n], parts = [];
      for (let i = 0; i < e.parts.length; i++) parts.push({ ...e.parts[i], p: await part(`models/${n}/${i}.p`, Int16Array), n: await part(`models/${n}/${i}.n`, Int8Array), i: await part(`models/${n}/${i}.i`, Uint32Array), u: await part(`models/${n}/${i}.u`, Float32Array) });
      MODELS[e.key] = { parts }; delete modelGeos[e.key]; kvSet('model:' + e.key, MODELS[e.key]).catch(() => {});
    }
    project = m.project; view = m.view;
  } else { let old; try { old = JSON.parse(new TextDecoder().decode(buf)); } catch (e) { throw new Error('it is not an Atelier file'); } project = adoptModels(old); }   // an older .json project
  if (!project || !Array.isArray(project.items)) throw new Error('it has no design in it');
  loadProject(project);
  if (view) { camera.position.fromArray(view.pos); controls.target.fromArray(view.target); camSet = true; fitCamRange(); controls.update(); dirty = true; }
}
if (window.atelierWin && window.atelierWin.onOpenFile) window.atelierWin.onOpenFile(async (name, bytes) => {   // a double-clicked file
  try { await openBytes(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)); fileHandle = null; openedName = name; markSaved(false); toast(`Opened ${name}`); }
  catch (e) { toast(`Couldn't open ${name}: ${e.message}.`, true); }
});
function adoptModels(p) {   // takes the models out of a project that was just read from a file
  Object.entries(p.textures || {}).forEach(([k, t]) => { TEXTURES[k] = { avg: t.avg, bytes: unb64(t.b, Uint8Array) }; kvSet('tex:' + k, TEXTURES[k]).catch(() => {}); });
  delete p.textures;
  if (!p.models) return p;
  Object.entries(p.models).forEach(([k, m]) => { MODELS[k] = { parts: m.parts.map(q => ({ name: q.name, c: q.c, o: q.o, map: q.map, p: unb64(q.p, Int16Array), n: unb64(q.n, Int8Array), i: unb64(q.i, Uint32Array), u: q.u ? unb64(q.u, Float32Array) : null })) }; delete modelGeos[k]; kvSet('model:' + k, MODELS[k]).catch(() => {}); });
  delete p.models; return p;
}
async function ensureModels() {   // brings back the models an autosaved project needs
  if (!P) return; let got = false;
  for (const k of new Set(P.items.map(i => i.model).filter(Boolean))) if (!MODELS[k]) { try { const m = await kvGet('model:' + k); if (m) { MODELS[k] = m; got = true; } } catch (e) {} }
  for (const k of usedTextures()) if (!TEXTURES[k]) { try { const t = await kvGet('tex:' + k); if (t) { TEXTURES[k] = t; got = true; } } catch (e) {} }
  if (got) { draw3DNow(); }
}
function draw3DNow() { render(); dirty = true; }
function modelGeo(key, i) {
  const g = modelGeos[key] || (modelGeos[key] = []); if (g[i]) return g[i];
  const q = MODELS[key].parts[i], b = new THREE.BufferGeometry();
  b.setAttribute('position', new THREE.BufferAttribute(q.p, 3, true)); b.setAttribute('normal', new THREE.BufferAttribute(q.n, 3, true)); b.setIndex(new THREE.BufferAttribute(q.i, 1)); if (q.u) b.setAttribute('uv', new THREE.BufferAttribute(q.u, 2));
  return g[i] = b;
}
function sh3dPieceInfo(f, tag) {   // what a piece asks for beyond its model: its own colour, or colours per material
  const out = {}, col = v => (v ? '#' + (v.length >= 6 ? v.slice(-6) : parseInt(v, 10).toString(16).padStart(6, '0').slice(-6)) : null);
  if (f.getAttribute('color')) out.tint = col(f.getAttribute('color'));
  if (f.getAttribute('modelMirrored') === 'true') out.mirror = true;
  f.childNodes.forEach(c => {
    if (c.nodeName === 'texture' && TEXTURES[sh3dTexKey(tag, c.getAttribute('image'))]) out.ptex = sh3dTexKey(tag, c.getAttribute('image'));
    if (c.nodeName !== 'material') return;
    const t = [...c.childNodes].find(n => n.nodeName === 'texture'), name = c.getAttribute('name');
    if (t && TEXTURES[sh3dTexKey(tag, t.getAttribute('image'))]) (out.matTex = out.matTex || {})[name] = sh3dTexKey(tag, t.getAttribute('image'));
    else if (c.getAttribute('color')) (out.mats = out.mats || {})[name] = col(c.getAttribute('color'));
  });
  return out;
}
const sh3dTexKey = (tag, image) => `sh3d/${tag}/tex/${image}`;
const sh3dModelKey = (f, tag) => { const r = f.getAttribute('modelRotation'); return `sh3d2/${tag}/${f.getAttribute('model')}${r && r !== '1 0 0 0 1 0 0 0 1' ? '/' + r : ''}`; };
function sh3dProject(xml, fileName, tag) {
  const root = new DOMParser().parseFromString(xml, 'application/xml').documentElement;
  if (root.nodeName !== 'home') throw new Error('its design could not be read');
  const num = (e, k, d = 0) => { const v = parseFloat(e.getAttribute(k)); return isNaN(v) ? d : v; }, CM = 10;
  const levels = {}, base = { name: 'House', elev: 0, hidden: false };
  root.querySelectorAll('level').forEach(l => { levels[l.getAttribute('id')] = { name: l.getAttribute('name') || 'Level', elev: num(l, 'elevation') * CM, hidden: l.getAttribute('visible') === 'false' }; });
  const holes = [...root.querySelectorAll('pieceOfFurniture')].filter(f => f.getAttribute('staircaseCutOutShape') && f.getAttribute('visible') !== 'false').map(f => {
    const w = num(f, 'width') * CM, d = num(f, 'depth') * CM, a = num(f, 'angle'), mirror = f.getAttribute('modelMirrored') === 'true', bottom = (levels[f.getAttribute('level')] || base).elev + num(f, 'elevation') * CM;
    const poly = svgPoints(f.getAttribute('staircaseCutOutShape')).map(c => { const X = (c[0] - .5) * w * (mirror ? -1 : 1), Y = (c[1] - .5) * d; return [num(f, 'x') * CM + X * Math.cos(a) - Y * Math.sin(a), num(f, 'y') * CM + X * Math.sin(a) + Y * Math.cos(a)]; });
    return { poly, bottom, top: bottom + num(f, 'height') * CM };
  });
  const levelOf = e => levels[e.getAttribute('level')] || base, turned = a => [0, Math.sin(a / 2), 0, Math.cos(a / 2)], items = [];
  const place = (it, lv, name) => { const made = { ...it, gname: name, glevel: lv }; items.push(made); return made; };
  const walls = [];
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  root.querySelectorAll('wall').forEach(w => {
    const x0 = num(w, 'xStart'), z0 = num(w, 'yStart'), x1 = num(w, 'xEnd'), z1 = num(w, 'yEnd'), len = Math.hypot(x1 - x0, z1 - z0); if (len < .01) return;
    const lv = levelOf(w), h = num(w, 'height', num(root, 'wallHeight', 250)), H = Math.max(h, num(w, 'heightAtEnd', h)) * CM;
    minX = Math.min(minX, x0, x1); maxX = Math.max(maxX, x0, x1); minZ = Math.min(minZ, z0, z1); maxZ = Math.max(maxZ, z0, z1);
    const q = turned(-Math.atan2(z1 - z0, x1 - x0));
    const it = place({ kind: 'object', type: 'wall', name: 'Wall', l: len * CM, t: H, w: Math.max(num(w, 'thickness', 10) * CM, 1), pos: [(x0 + x1) / 2 * CM, lv.elev + H / 2, (z0 + z1) / 2 * CM], q }, lv, 'Walls');
    const sideOf = (colourAttr, texAttr) => { const el = [...w.children].find(c => c.nodeName === 'texture' && c.getAttribute('attribute') === texAttr), key = el && sh3dTexKey(tag, el.getAttribute('image')), colour = w.getAttribute(colourAttr); if (key && TEXTURES[key]) return { c: TEXTURES[key].avg, tex: { key, w: Math.max(num(el, 'width', 100) * CM, 1), h: Math.max(num(el, 'height', 100) * CM, 1), a: num(el, 'angle') } }; return colour ? { c: '#' + colour.slice(-6) } : null; };
    const left = sideOf('leftSideColor', 'leftSideTexture'), right = sideOf('rightSideColor', 'rightSideTexture'), top = sideOf('topColor', 'topTexture'); if (left) it.sideL = left; if (right) it.sideR = right; if (top) it.sideT = top;
    walls.push({ it, lv, x0, z0, len, H: H / CM, q, thick: num(w, 'thickness', 10), ux: (x1 - x0) / len, uz: (z1 - z0) / len });
  });
  if (minX === Infinity) throw new Error('it has no walls');
  // Rooms become floors and ceilings with their real outline, colour and texture, and a hole where a staircase passes through.
  root.querySelectorAll('room').forEach(r => {
    const pts = [...r.querySelectorAll('point')].map(c => [num(c, 'x') * CM, num(c, 'y') * CM]); if (pts.length < 3) return;
    const lv = levelOf(r), xs = pts.map(c => c[0]), zs = pts.map(c => c[1]), x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs), cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    minX = Math.min(minX, x0 / CM); maxX = Math.max(maxX, x1 / CM); minZ = Math.min(minZ, z0 / CM); maxZ = Math.max(maxZ, z1 / CM);
    const fl = root.querySelector(`level[id="${r.getAttribute('level')}"]`), t = Math.max((fl ? num(fl, 'floorThickness', 12) : 12) * CM, 1), high = (fl ? num(fl, 'height', num(root, 'wallHeight', 250)) : num(root, 'wallHeight', 250)) * CM, local = pts.map(c => [c[0] - cx, c[1] - cz]);
    const part = (name, layer, topY, thick, colourAttr, texAttr, extra) => {
      const texEl = [...r.children].find(c => c.nodeName === 'texture' && c.getAttribute('attribute') === texAttr), key = texEl && sh3dTexKey(tag, texEl.getAttribute('image')), colour = r.getAttribute(colourAttr);
      const it = { kind: 'object', type: 'floor', name, l: x1 - x0, t: thick, w: z1 - z0, pos: [cx, topY - thick / 2, cz], q: IDQ.slice(), poly: local, locked: true, ...extra };
      if (key && TEXTURES[key]) { it.tex = { key, w: Math.max(num(texEl, 'width', 100) * CM, 1), h: Math.max(num(texEl, 'height', 100) * CM, 1), a: num(texEl, 'angle') }; it.fc = TEXTURES[key].avg; } else if (colour) it.fc = '#' + colour.slice(-6);
      const cut = roomCut(local, holes.filter(h => h.bottom < topY && h.top >= topY - thick).map(h => h.poly.map(c => [c[0] - cx, c[1] - cz])));
      if (cut) { it.tris = cut.tris; it.rim = cut.rim; }
      place(it, lv, layer);
    };
    if (r.getAttribute('floorVisible') !== 'false') part(r.getAttribute('name') || 'Room floor', 'Floors', lv.elev, t, 'floorColor', 'floorTexture');
    if (r.getAttribute('ceilingVisible') !== 'false') part(r.getAttribute('name') ? `${r.getAttribute('name')} ceiling` : 'Ceiling', 'Ceilings', lv.elev + high + 10, 10, 'ceilingColor', 'ceilingTexture', { ceiling: true });
  });
  // The wall a door or window sits in: same level, running the same way, and overlapping it.
  const hostWall = (lv, x, z, angle, width, depth) => {
    let best = null;
    walls.forEach(w => {
      if (w.lv !== lv || Math.abs(Math.cos(angle) * w.ux + Math.sin(angle) * w.uz) < .97) return;
      const a = (x - w.x0) * w.ux + (z - w.z0) * w.uz, off = Math.abs((x - w.x0) * w.uz - (z - w.z0) * w.ux);
      if (off > depth / 2 + w.thick / 2 || a + width / 2 < 0 || a - width / 2 > w.len) return;
      if (!best || off < best.off) best = { w, a, off };
    });
    return best;
  };
  root.querySelectorAll('pieceOfFurniture, doorOrWindow').forEach(f => {
    const lv = levelOf(f), name = f.getAttribute('name') || 'Object', H = Math.max(num(f, 'height') * CM, 1), roof = /toit|roof|skylight/i.test(name), outdoors = /tree|palm|shrub|bush|suv/i.test(name);
    const it = { kind: 'object', type: 'imported', name, l: Math.max(num(f, 'width') * CM, 1), t: H, w: Math.max(num(f, 'depth') * CM, 1), pos: [num(f, 'x') * CM, lv.elev + num(f, 'elevation') * CM + H / 2, num(f, 'y') * CM], q: turned(-num(f, 'angle')) };
    if (f.getAttribute('visible') === 'false') it.hidden = true;
    const key = sh3dModelKey(f, tag); if (MODELS[key]) Object.assign(it, { model: key }, sh3dPieceInfo(f, tag));
    if (f.nodeName === 'doorOrWindow') {
      const cmW = num(f, 'width'), host = hostWall(lv, num(f, 'x'), num(f, 'y'), num(f, 'angle'), cmW, num(f, 'depth'));
      if (host) {
        const { w, a } = host, bottom = num(f, 'elevation'), clamp = v => Math.min(1, Math.max(0, v)), hCm = H / CM, cut = { s0: clamp((a - cmW / 2) / w.len), s1: clamp((a + cmW / 2) / w.len), z0: clamp(bottom / w.H), z1: clamp((bottom + hCm) / w.H) };
        if (cut.s1 > cut.s0 && cut.z1 > cut.z0) (w.it.cuts = w.it.cuts || []).push(cut);
        // if its model couldn't be read, a thin door or a pane of glass fills the opening instead
        if (!it.model) { it.type = /window/i.test(name) ? 'sh3d-glass' : 'sh3d-door'; it.w = 30; it.q = w.q.slice(); it.pos = [(w.x0 + w.ux * a) * CM, it.pos[1], (w.z0 + w.uz * a) * CM]; }
      }
    }
    place(it, lv, roof ? 'Roof' : outdoors ? 'Outdoors' : f.nodeName === 'doorOrWindow' ? 'Doors and windows' : 'Other pieces');
  });
  items.forEach(i => { i.pos[0] -= minX * CM; i.pos[2] -= minZ * CM; });
  const W = (maxX - minX) * CM, D = (maxZ - minZ) * CM;
  const ground = floorItem(-200, W + 200, -200, D + 200); ground.name = 'Ground'; ground.gname = 'Ground'; ground.pos[1] -= 2; items.unshift(ground);   // just under the room floors, so they don't flicker
  const out = { name: (root.getAttribute('name') || fileName).replace(/\.(sh3d|zip)$/i, '').replace(/\.sh3d$/i, ''), items: [], groups: [], levels: [], nextId: 1, in: true, SL: 2438.4, SW: 1219.2, grid: 25.4, snap: true }, gid = {}, lid = new Map();
  items.forEach(i => {
    const lv = i.glevel, k = (lv ? lv.name + '|' : '') + i.gname;
    if (lv && !lid.has(lv)) { const id = out.nextId++; lid.set(lv, id); out.levels.push({ id, name: lv.name, hidden: !!lv.hidden, open: true, at: lv.elev }); }
    if (!gid[k]) { gid[k] = out.nextId++; const g = { id: gid[k], name: i.gname, hidden: false, open: false }; if (lv) g.level = lid.get(lv); out.groups.push(g); }
    i.group = gid[k]; delete i.gname; delete i.glevel; i.id = out.nextId++; out.items.push(i);
  });
  out.levels.sort((a, b) => a.at - b.at);
  return out;
}
async function importSh3d(buf, fileName) {
  const xml = await readZipText(buf, 'Home.xml');
  if (!xml) throw new Error('it has no Home.xml. Open it in Sweet Home 3D, save it again, and try once more');
  const tag = fileName.replace(/\W+/g, '-') + '-' + buf.byteLength, doc = new DOMParser().parseFromString(xml, 'application/xml');
  const pieces = [...doc.querySelectorAll('pieceOfFurniture, doorOrWindow')], seen = new Set(); let missing = 0, done = 0;
  const todo = pieces.filter(f => { const k = sh3dModelKey(f, tag); if (seen.has(k)) return false; seen.add(k); return true; });
  for (const f of todo) {
    toast(`Importing 3D models: ${++done} of ${todo.length}`);
    await new Promise(r => setTimeout(r));   // lets the message show
    const key = sh3dModelKey(f, tag); if (MODELS[key]) continue;
    const rot = (f.getAttribute('modelRotation') || '').split(/\s+/).map(Number);
    let m = null; try { m = await buildModel(buf, f.getAttribute('model'), rot.length === 9 ? rot : null, f.nodeName === 'doorOrWindow' && /window/i.test(f.getAttribute('name') || ''), tag); } catch (e) { console.error(f.getAttribute('model'), e); }
    if (m && m.parts.length) { MODELS[key] = m; delete modelGeos[key]; kvSet('model:' + key, m).catch(() => {}); } else missing++;
  }
  for (const el of doc.querySelectorAll('texture')) await keepTexture(buf, tag, el.getAttribute('image'));
  const project = sh3dProject(xml, fileName, tag), walls = project.items.filter(i => i.type === 'wall').length, models = project.items.filter(i => i.model).length, floors = project.items.filter(i => i.poly && !i.ceiling).length, ceilings = project.items.filter(i => i.ceiling).length, stairs = project.items.filter(i => i.tris).length, cuts = project.items.reduce((n, i) => n + (i.cuts ? i.cuts.length : 0), 0);
  loadProject(project); fileHandle = null; markSaved(true);
  toast(`Imported ${walls} walls, ${floors} floors, ${ceilings} ceilings, ${cuts} openings, ${stairs} stair holes and ${models} 3D models${missing ? `. ${missing} models couldn't be read and show as boxes` : ''}.`);
}
setTimeout(ensureModels);
document.getElementById('sh3dIn').onchange = async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try { await importSh3d(await f.arrayBuffer(), f.name); } catch (err) { toast(`Couldn't import ${f.name}: ${err.message}.`, true); }
};
document.getElementById('libIn').onchange = async e => { const f = e.target.files[0]; e.target.value = ''; if (f) await libImport(f); };
document.getElementById('bSave').onclick = () => saveProject(false);
document.getElementById('bUndo').onclick = undo; document.getElementById('bRedo').onclick = redo;
document.getElementById('unitSel').onchange = e => { const k = e.target.value; P.unit = k; P.in = k === 'in' || k === 'ft' || k === 'yd'; persist(); render(); };
document.getElementById('snapOn').onchange = e => { P.snap = e.target.checked; persist(); };
document.getElementById('gridSel').onchange = e => { P.grid = +e.target.value; persist(); dirty = true; };
const pname = document.getElementById('pname');
pname.onchange = () => { if (pname.value.trim()) edit(() => { P.name = pname.value.trim(); }); else render(); };
pname.onkeydown = e => { e.stopPropagation(); if (e.key === 'Enter') pname.blur(); };

window.addEventListener('keydown', e => {
  if (e.key === 'F1') { e.preventDefault(); DO.help(); return; }
  if (e.key === 'Escape' && !ctxEl.hidden) { closeCtx(); return; }
  if (e.key === 'Escape' && document.querySelector('.menu.open')) { closeMenus(); return; }
  if (e.key === 'Escape' && !document.getElementById('layPop').hidden) { toggleLayPop(false); return; }
  if (e.key === 'Escape' && !document.getElementById('warnPop').hidden) { document.getElementById('warnPop').hidden = true; return; }
  if (document.getElementById('helpDlg').open) return;
  const a = document.activeElement, typing = a && /INPUT|SELECT/.test(a.tagName) && a.type !== 'checkbox' && a.type !== 'range';
  if (document.getElementById('pack').classList.contains('open') || dlg.open || typing) return;
  const k = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey;
  if (k === 'tab' && tool === 'measure' && mCands.length > 1) { e.preventDefault(); mIdx = (mIdx + 1) % mCands.length; mHover = mCands[mIdx]; if (measA && mCur) mHover = lockAxis(mHover); else if (measA && mFlat) mHover = flatLock(mHover, mFlat.vn, mFlat.x, mFlat.y); readout(pointName(mHover)); dirty = true; return; }
  if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (mod && k === 'y') { e.preventDefault(); redo(); return; }
  if (mod && k === 's') { e.preventDefault(); saveProject(e.shiftKey); return; }
  if (mod && k === 'a') { e.preventDefault(); DO.all(); return; }
  if (mod && k === 'c') { e.preventDefault(); copySel(); return; }
  if (mod && k === 'x') { e.preventDefault(); DO.cut(); return; }
  if (mod && k === 'v') { e.preventDefault(); pasteClip(); return; }
  if (mod && k === 'd') { e.preventDefault(); if (sel.length) edit(duplicateSel); return; }
  if (mod || e.altKey) return;
  if (k === 'escape') { if (measA) { cancelMeasure(); return; } sel = []; render(); return; }
  if (k === 'g') { P.snap = !P.snap; persist(); render(); return; }
  if (k === 'f') { Object.keys(VIEWS).forEach(fitView); resetCam(); dirty = true; return; }
  const tk = TOOLS.find(x => x[2].toLowerCase() === k); if (tk) { setTool(tk[0]); return; }
  if (!sel.length) return;
  if (k === 'delete' || k === 'backspace') { e.preventDefault(); edit(removeSel); return; }
  if (k === 'r') { edit(() => rotateSel(AXES[1][0], e.shiftKey ? -90 : 90)); return; }
  const nudge = { arrowleft: [0, -1], arrowright: [0, 1], arrowup: e.shiftKey ? [1, 1] : [2, -1], arrowdown: e.shiftKey ? [1, -1] : [2, 1], pageup: [1, 1], pagedown: [1, -1] }[k];
  if (nudge) { e.preventDefault(); edit(() => movable().forEach(i => { i.pos[nudge[0]] += nudge[1] * P.grid; })); }
});
new ResizeObserver(() => applyLayout()).observe(document.getElementById('work'));

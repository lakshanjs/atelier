// ---------- carving: drawing tools ----------
// New shapes (polygon, star, drawn lines and curves), and tools that act on what's picked: mirror, outline, copies in rows or
// a ring, align and spread, and joining shapes together. Shapes made by joining or outlining become 'path' items, which keep
// their own outline in their own coordinates, centred on themselves like everything else.

// icons drawn for these tools, in the same style as the Lucide ones
Object.assign(window.LUCIDE || (window.LUCIDE = {}), {
  pentagon: '<path d="M12 3 21 10 17.5 20.5h-11L3 10Z" />',
  star: '<path d="m12 2.5 2.9 6.2 6.8.7-5.1 4.6 1.5 6.7L12 17.3l-6.1 3.4 1.5-6.7-5.1-4.6 6.8-.7Z" />',
  'pen-tool': '<path d="M3 18 9 8l6 8 6-11" /><circle cx="3" cy="18" r="1.6" /><circle cx="9" cy="8" r="1.6" /><circle cx="15" cy="16" r="1.6" /><circle cx="21" cy="5" r="1.6" />',
  'cv-flip-v': '<path d="M3 12h18" stroke-dasharray="2 2" /><path d="M7 9V3l10 6Z" /><path d="M7 15v6l10-6Z" />',
  'cv-weld': '<path d="M4 4h10v6h6v10H10v-6H4Z" />',
  'cv-subtract': '<path d="M4 4h10v6h-4v4H4Z" /><path d="M10 10h10v10H10Z" stroke-dasharray="2 2" />',
  'cv-intersect': '<rect x="4" y="4" width="10" height="10" stroke-dasharray="2 2" /><rect x="10" y="10" width="10" height="10" stroke-dasharray="2 2" /><path d="M10 10h4v4h-4Z" />',
  'cv-offset': '<rect x="8" y="8" width="8" height="8" rx="1" /><rect x="3" y="3" width="18" height="18" rx="4" stroke-dasharray="2 2" />',
  'cv-inset': '<rect x="3" y="3" width="18" height="18" rx="2" /><rect x="8" y="8" width="8" height="8" stroke-dasharray="2 2" />',
  'cv-ring': '<circle cx="12" cy="4.5" r="2" /><circle cx="19" cy="9.5" r="2" /><circle cx="16.5" cy="18" r="2" /><circle cx="7.5" cy="18" r="2" /><circle cx="5" cy="9.5" r="2" />',
  'cv-clamp': '<path d="M5 4h9v4H9v8h5v4H5Z" /><path d="M14 6h4v12h-4" /><path d="M18 12h3" />',
  'cv-close': '<path d="M5 19 5 9l7-5 7 5v10" /><path d="M5 19h14" stroke-dasharray="2 2" />',
});

[['cvAddPolygon', 'pentagon'], ['cvAddStar', 'star'], ['cvAddPen', 'pen-tool'], ['cvTrim', 'scissors'], ['cvDim', 'ruler'], ['cvAddClamp', 'cv-clamp']].forEach(([id, name]) => addIcon(cvEl(id), name));

const cvTypeIcon = type => ({ text: 'type', svg: 'image', trace: 'image', circle: 'circle', polygon: 'pentagon', star: 'star', path: 'pen-tool' }[type] || 'square');
function cvAddPolygon(kind) { const b = cvNow().board, d = Math.min(b.l, b.w) * .5; return cvAdd(kind === 'star' ? { type: 'star', w: d, h: d, points: 5, inner: .5 } : { type: 'polygon', w: d, h: d, sides: 6 }); }
function cvScalePath(it, f) { if (!(f > 0)) return; it.paths = it.paths.map(l => ({ closed: l.closed, pts: l.pts.map(q => [q[0] * f, q[1] * f]) })); }

// ---------- what's picked, on the board ----------
// One item has its handles. With more, each shows a dashed box and the panel's tools act on them together.
function cvPickedSvg(px) {
  const list = cvPicked(); if (!list.length) return '';
  if (list.length === 1 && cvNodeItem()) return cvNodesSvg(list[0], px);
  if (list.length === 1) return cvHandles(list[0], px);
  const W = P.carve.board.w;
  return '<g pointer-events="none">' + list.map(i => { const b = cvWorldBox(i), m = 3 * px; return `<rect x="${b.x0 - m}" y="${W - b.y1 - m}" width="${b.x1 - b.x0 + 2 * m}" height="${b.y1 - b.y0 + 2 * m}" fill="none" stroke="#ffc928" stroke-width="${1.5 * px}" stroke-dasharray="${5 * px} ${3 * px}"/>`; }).join('') + '</g>';
}

// ---------- drawing lines and curves ----------
// Click for each point. Clicking the first point again closes the shape; double-click or Enter finishes an open line.
// Shift keeps each line level, upright or at 45 degrees. Esc stops.
function cvToolStart(kind) { cvTool = { kind, pts: [], at: null }; cvPickOnly(null); cvEl('cvStage').classList.add('drawing'); carveRender(); }
function cvToolCancel() { cvTool = null; cvEl('cvStage').classList.remove('drawing'); carveRender(); }
const cvToolTitle = () => ({ trim: 'Trimming lines', dim: 'Measuring' }[cvTool.kind] || 'Drawing a line');
const cvToolClose = p => cvTool.kind === 'pen' && cvTool.pts.length > 2 && Math.hypot(p[0] - cvTool.pts[0][0], p[1] - cvTool.pts[0][1]) < 8 * cvView.k;
function cvToolSnap(e, p) {
  const last = cvTool.pts[cvTool.pts.length - 1]; if (!e.shiftKey || !last) return p;
  const dx = p[0] - last[0], dy = p[1] - last[1], a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * Math.PI / 4, r = Math.hypot(dx, dy);
  return [last[0] + Math.cos(a) * r, last[1] + Math.sin(a) * r];
}
function cvToolDown(e, p) {
  if (cvTool.kind === 'trim') { cvTrimAt(p); return; }   // stays on, for the next line
  if (cvTool.kind === 'dim') {
    p = cvSnapPoint(cvToolSnap(e, p)); cvTool.pts.push(p);
    if (cvTool.pts.length === 2) { const [a, b] = cvTool.pts, len = Math.hypot(b[0] - a[0], b[1] - a[1]); cvToolCancel(); if (len > .01) cvAdd({ type: 'dim', x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2, rot: Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI, len, off: 8 }); const it = cvItem(); if (it && it.type === 'dim') cvEdit(() => { it.op = { kind: 'off' }; }); return; }
    cvToolDraw(p); cvPanelRender(); return;
  }
  if (cvToolClose(p)) { cvToolFinish(true); return; }
  p = cvToolSnap(e, p); const last = cvTool.pts[cvTool.pts.length - 1];
  if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 1e-3) cvTool.pts.push(p);
  cvToolDraw(p); cvPanelRender();
}
function cvToolMove(e, p) { if (cvTool.kind === 'trim') return; cvTool.at = cvToolClose(p) ? cvTool.pts[0] : cvTool.kind === 'dim' ? cvSnapPoint(cvToolSnap(e, p)) : cvToolSnap(e, p); cvToolDraw(cvTool.at); }
function cvToolDraw(at) {
  const g = cvEl('cvPen'); if (!g || !cvTool) return; const W = P.carve.board.w, k = cvView.k, pts = cvTool.pts.concat(at ? [at] : []);
  g.innerHTML = (pts.length > 1 ? `<path d="M${pts.map(q => `${r2(q[0])} ${r2(W - q[1])}`).join('L')}" fill="none" stroke="#20262a" stroke-width="${1.5 * k}"/>` : '')
    + cvTool.pts.map((q, i) => `<rect x="${q[0] - 3 * k}" y="${W - q[1] - 3 * k}" width="${6 * k}" height="${6 * k}" fill="${i === 0 && cvTool.pts.length > 2 ? '#ffc928' : '#fff'}" stroke="#20262a" stroke-width="${k}"/>`).join('');
}
function cvToolFinish(closed) {
  const pts = cvTool ? cvTool.pts : []; cvToolCancel();
  if (pts.length < 2 || (closed && pts.length < 3)) { if (pts.length) toast(closed ? 'A closed shape needs three points or more.' : 'A line needs two points or more.', true); return null; }
  return cvMakePath([{ pts, closed }], null);
}
// a path item from lines on the board, centred on itself, with this job (or the one last chosen for shapes)
function cvMakePath(lines, op, extra = {}) {
  const b = cvBox(lines.map(l => l.pts)), cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2, it = cvAdd({ type: 'path', x: cx, y: cy, paths: lines.map(l => ({ closed: l.closed, pts: l.pts.map(q => [q[0] - cx, q[1] - cy]) })), ...extra });
  if (op) cvEdit(() => { it.op = JSON.parse(JSON.stringify(op)); });
  return it;
}
function cvToolPanelHtml() {
  const n = cvTool.pts.length;
  if (cvTool.kind === 'trim') return cvSec('draw', 'Trimming', '<p class="note">Click a drawn line, and the stretch you clicked is cut back to the nearest places it crosses another line, or itself. Shapes that aren\'t drawn lines can be made editable first, with Edit its points. Esc stops.</p>');
  if (cvTool.kind === 'dim') return cvSec('draw', 'Measuring', '<p class="note">Click the two ends to measure between. They catch on the corners of shapes nearby. Hold Shift for level, upright or 45°. It is only drawn, never cut. Esc stops.</p>');
  return cvSec('draw', 'Drawing', '<p class="note">' + (n ? n + ' point' + (n === 1 ? '' : 's') + '. ' : '') + 'Click on the board for each point. Click the first point to close the shape, or double-click or press Enter to finish an open line. Hold Shift for level, upright or 45° lines. Esc stops.</p><div class="rowb"><button class="btn line" data-cact="pen-open"' + (n < 2 ? ' disabled' : '') + '>Finish line</button><button class="btn line" data-cact="pen-close"' + (n < 3 ? ' disabled' : '') + '>Close shape</button></div>');
}

// ---------- the shapes on the board, as outlines ----------
// regions: the closed outline of an item where it sits. lines: every stroke, open or closed.
function cvWorldShape(it) { const s = cvLocal(it), place = cvPlaceFn(it); return { regions: s.regions.map(p => p.map(place)), lines: s.lines.map(l => ({ closed: l.closed, pts: l.pts.map(place) })) }; }
const cvAsLines = regions => regions.map(p => ({ closed: true, pts: p }));

// ---------- a picked item's own tools ----------
const cvIconBtn = (act, icon, title) => '<button class="btn line" data-cact="' + act + '" title="' + esc(title) + '" aria-label="' + esc(title) + '">' + ic(icon) + '</button>';
function cvShapeSecHtml(it) {
  let shape = '';
  if (it.type === 'polygon') shape += '<label class="field">Sides<input type="text" data-cf="t.sides" value="' + (it.sides || 6) + '"></label>';
  if (it.type === 'star') shape += '<label class="field">Points<input type="text" data-cf="t.points" value="' + (it.points || 5) + '"></label><label class="field">Inner size, %<input type="text" data-cf="t.inner" value="' + Math.round((it.inner || .5) * 100) + '"></label>';
  if (it.type === 'rect' || it.type === 'polygon' || it.type === 'star' || (it.type === 'path' && it.paths.some(l => l.closed))) shape += cvF('t.corner', 'Round the corners', cvNum(it.corner || 0));
  if (it.type === 'trace') shape += '<label class="field">Dark or light, where it splits<input type="range" min="1" max="254" data-cf="t.thr" value="' + (it.threshold ?? 128) + '" title="Grey levels darker than this are traced"></label><label class="check"><input type="checkbox" data-cf="t.invert" ' + (it.invert ? 'checked' : '') + '>Trace the light parts instead</label><label class="field">Detail<select data-cf="t.detail">' + [[.5, 'Fine'], [1, 'Normal'], [2.5, 'Smooth']].map(([v, l]) => '<option value="' + v + '" ' + ((it.detail || 1) === v ? 'selected' : '') + '>' + l + '</option>').join('') + '</select></label>';
  shape += '<div class="rowb"><button class="btn line" data-cact="t-nodes" title="' + (it.type === 'path' ? 'Drag a point to move it, double-click a line to add one, Delete removes the last one touched' : 'Turns it into a plain shape whose points can be moved. Its own settings, like its text or sides, are then fixed') + '">' + ic('pen-tool') + (cvNodeItem() ? 'Stop editing points' : 'Edit its points') + '</button></div>';
  if (it.type === 'path') {
    shape += '<label class="check"><input type="checkbox" data-cf="t.smooth" ' + (it.smooth ? 'checked' : '') + '>Smooth curve through the points</label>';
    if (it.paths.some(l => !l.closed)) shape += '<div class="rowb"><button class="btn line" data-cact="t-close">' + ic('cv-close') + 'Close the open lines</button></div>';
  }
  const tools = '<div class="rowb cvicons">' + cvIconBtn('t-mx', 'flip-horizontal-2', 'Mirror, left to right') + cvIconBtn('t-my', 'cv-flip-v', 'Mirror, front to back') + '</div>'
    + '<p class="cvSub">Outline</p><div class="cvrow">' + cvF('t.off', 'Distance', cvNum(cvToolNum('off', 3))) + '</div><div class="rowb cvicons">' + cvIconBtn('t-out', 'cv-offset', 'Make an outline this far outside it') + cvIconBtn('t-in', 'cv-inset', 'Make an outline this far inside it') + '</div>'
    + (cvLocal(it).regions.length ? '<p class="cvSub">Inlay</p>' + cvF('t.igap', 'Gap round the plug', cvNum(cvToolNum('igap', .1))) + '<div class="rowb"><button class="btn line" data-cact="t-plug" title="Pockets this shape, and adds a plug beside it, cut to fit, to make from the inlay wood">' + ic('cv-offset') + 'Make an inlay plug</button></div>' : '')
    + '<p class="cvSub">Copies</p>' + '<label class="field">Across<input type="text" data-cf="t.cols" value="' + cvToolNum('cols', 3) + '"></label><label class="field">Back<input type="text" data-cf="t.rows" value="' + cvToolNum('rows', 1) + '"></label>' + cvF('t.gap', 'Gap between', cvNum(cvToolNum('gap', 5)))
    + '<div class="rowb cvicons">' + cvIconBtn('t-grid', 'layout-grid', 'Make copies in rows and columns') + '</div>'
    + '<label class="field">In a ring<input type="text" data-cf="t.ring" value="' + cvToolNum('ring', 6) + '"></label><div class="rowb cvicons">' + cvIconBtn('t-ring', 'cv-ring', 'Make a ring of copies round the middle of the board, each turned to face it') + '</div>';
  return (shape ? cvSec('shape', 'Shape', shape) : '') + cvSec('tools', 'Mirror, outline and copies', tools);
}
// the numbers these tools last used, remembered for this session
const cvToolNums = {};
const cvToolNum = (k, d) => cvToolNums[k] ?? d;

// ---------- many picked ----------
function cvMultiPanelHtml() {
  const list = cvPicked(), closed = list.filter(i => cvLocal(i).regions.length).length;
  let h = cvSec('arrange', 'Line up', '<div class="rowb cvicons">' + cvIconBtn('m-left', 'align-start-vertical', 'Line up their left edges') + cvIconBtn('m-midx', 'align-center-vertical', 'Line up their middles, across') + cvIconBtn('m-right', 'align-end-vertical', 'Line up their right edges') + '</div>'
    + '<div class="rowb cvicons">' + cvIconBtn('m-front', 'align-end-horizontal', 'Line up their front edges') + cvIconBtn('m-midy', 'align-center-horizontal', 'Line up their middles, front to back') + cvIconBtn('m-back', 'align-start-horizontal', 'Line up their back edges') + '</div>'
    + '<div class="rowb cvicons">' + cvIconBtn('m-spreadx', 'align-horizontal-space-around', 'Spread them evenly across') + cvIconBtn('m-spready', 'align-vertical-space-around', 'Spread them evenly front to back') + cvIconBtn('m-centre', 'scan', 'Centre them together on the board') + '</div>');
  h += cvSec('combine', 'Join together', (closed < 2 ? '<p class="note">Joining needs two closed shapes or more.</p>' : '<p class="note">The first picked is kept for Cut away and Overlap, and gives the new shape its job.</p>')
    + '<div class="rowb cvicons">' + cvIconBtn('m-weld', 'cv-weld', 'Weld: one shape covering them all') + cvIconBtn('m-subtract', 'cv-subtract', 'Cut away: the first, without where the others are') + cvIconBtn('m-intersect', 'cv-intersect', 'Overlap: only where the first and the others overlap') + '</div>');
  h += cvSec('mjob', 'How to cut them', '<div class="jobGrid" role="radiogroup" aria-label="How to cut them all">' + CV_KINDS.map(([v]) => '<label class="jobBtn' + (list.every(i => i.op && i.op.kind === v) ? ' on' : '') + '" title="' + esc(CV_JOB_WHAT[v]) + '"><input type="radio" name="cvJobAll" data-cf="m.kind" value="' + v + '">' + cvJobArt(v) + esc(CV_JOB_SHORT[v]) + '</label>').join('') + '</div><p class="note">Sets the same job for all ' + list.length + ', each with the best bit you have for it.</p>');
  h += cvSec('mmore', 'Copy or delete', '<div class="rowb cvicons">' + cvIconBtn('dup', 'copy', 'Duplicate them (Ctrl+D)') + cvIconBtn('del', 'trash-2', 'Delete them (Del)') + '</div>');
  return h;
}

// ---------- doing it ----------
function cvToolField(el) {
  const k = el.dataset.cf; if (!k || !(k.startsWith('t.') || k.startsWith('m.'))) return false;
  const it = cvItem(), cv = cvNow(), f = k.slice(2);
  if (k === 'm.kind') { const kind = el.value, list = cvPicked(); cvEdit(() => { list.forEach(i => { if (!cvNeverCut(i) && (kind === 'line' || kind === 'off' || cvLocal(i).regions.length)) i.op = cvOpFor(cv, kind); }); }); return true; }
  if (['off', 'cols', 'rows', 'gap', 'ring', 'igap'].includes(f)) {
    const v = f === 'off' || f === 'gap' || f === 'igap' ? cvParse(el.value) : parseInt(el.value, 10), ok = f === 'off' ? v > 0 : f === 'gap' || f === 'igap' ? v >= 0 : f === 'ring' ? v >= 2 && v <= 360 : v >= 1 && v <= 100;
    if (isFinite(v) && ok) cvToolNums[f] = v; else { toast("That number won't work.", true); cvPanelRender(); }
    return true;
  }
  if (!it) return true;
  if (f === 'smooth') { cvEdit(() => { it.smooth = el.checked; }); return true; }
  if (f === 'thr') { const v = parseInt(el.value, 10); if (v > 0 && v < 255) cvEdit(() => { it.threshold = v; }); return true; }
  if (f === 'invert') { cvEdit(() => { it.invert = el.checked; }); return true; }
  if (f === 'detail') { const v = parseFloat(el.value); if (v > 0) cvEdit(() => { it.detail = v; }); return true; }
  if (f === 'sides' || f === 'points') { const v = parseInt(el.value, 10); if (v >= 3 && v <= 64) cvEdit(() => { it[f] = v; }); else { toast('Type a number from 3 to 64.', true); carveRender(); } return true; }
  if (f === 'inner') { const v = parseFloat(el.value); if (v >= 5 && v <= 95) cvEdit(() => { it.inner = v / 100; }); else { toast('Type a percentage from 5 to 95.', true); carveRender(); } return true; }
  if (f === 'corner') { const v = cvParse(el.value); if (isFinite(v) && v >= 0) cvEdit(() => { it.corner = v; }); else { toast("That size won't work.", true); carveRender(); } return true; }
  return true;
}
function cvToolAction(a) {
  const list = cvPicked(), it = cvItem(), cv = cvNow(), b = cv.board;
  if (a === 'pen-open') { cvToolFinish(false); return true; }
  if (a === 'pen-close') { cvToolFinish(true); return true; }
  if (!it) return a.startsWith('t-') || a.startsWith('m-');
  if (a === 't-plug') { cvMakePlug(it); return true; }
  if (a === 't-nodes') { if (cvNodeItem()) cvNodesStop(); else cvNodesStart(it); return true; }
  if (a === 't-mx' || a === 't-my') { const k = a === 't-mx' ? 'mx' : 'my'; cvEdit(() => { list.forEach(i => { i[k] = !i[k]; }); }); return true; }
  if (a === 't-close') { cvEdit(() => { it.paths = it.paths.map(l => ({ closed: l.pts.length > 2 ? true : l.closed, pts: l.pts })); }); return true; }
  if (a === 't-out' || a === 't-in') {
    const d = cvToolNum('off', 3), regions = cvWorldShape(it).regions; if (!regions.length) { toast('Only closed shapes can be outlined.', true); return true; }
    const out = cvOffset(cvUnion(regions), a === 't-out' ? d : -d); if (!out.length) { toast("It isn't that wide, so there's nothing inside.", true); return true; }
    cvMakePath(cvAsLines(out), it.op); return true;
  }
  if (a === 't-grid') {
    const box = cvWorldBox(it), w = box.x1 - box.x0, h = box.y1 - box.y0, gap = cvToolNum('gap', 5), cols = cvToolNum('cols', 3), rows = cvToolNum('rows', 1), made = [];
    cvEdit(() => { for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) { if (!i && !j) continue; const c = JSON.parse(JSON.stringify(it)); c.id = cv.nextId++; c.x = it.x + i * (w + gap); c.y = it.y + j * (h + gap); cv.items.push(c); made.push(c); } });
    cvPickList([it, ...made]); carveRender(); return true;
  }
  if (a === 't-ring') {
    const n = cvToolNum('ring', 6), cx = b.l / 2, cy = b.w / 2, made = [];
    cvEdit(() => { for (let k = 1; k < n; k++) { const t = k / n * Math.PI * 2, c = JSON.parse(JSON.stringify(it)), dx = it.x - cx, dy = it.y - cy; c.id = cv.nextId++; c.x = cx + dx * Math.cos(t) - dy * Math.sin(t); c.y = cy + dx * Math.sin(t) + dy * Math.cos(t); c.rot = (((it.rot || 0) + k * 360 / n) % 360 + 360) % 360; cv.items.push(c); made.push(c); } });
    cvPickList([it, ...made]); carveRender(); return true;
  }
  if (!a.startsWith('m-')) return false;
  // many picked: line up, spread, join
  const boxes = list.map(i => ({ i, b: cvWorldBox(i) })), all = cvBox(boxes.map(o => [[o.b.x0, o.b.y0], [o.b.x1, o.b.y1]]));
  const shift = (o, dx, dy) => { o.i.x += dx; o.i.y += dy; };
  const line = { 'm-left': o => shift(o, all.x0 - o.b.x0, 0), 'm-right': o => shift(o, all.x1 - o.b.x1, 0), 'm-midx': o => shift(o, (all.x0 + all.x1) / 2 - (o.b.x0 + o.b.x1) / 2, 0), 'm-front': o => shift(o, 0, all.y0 - o.b.y0), 'm-back': o => shift(o, 0, all.y1 - o.b.y1), 'm-midy': o => shift(o, 0, (all.y0 + all.y1) / 2 - (o.b.y0 + o.b.y1) / 2), 'm-centre': o => shift(o, b.l / 2 - (all.x0 + all.x1) / 2, b.w / 2 - (all.y0 + all.y1) / 2) }[a];
  if (line) { cvEdit(() => boxes.forEach(line)); return true; }
  if (a === 'm-spreadx' || a === 'm-spready') {   // the same gap between each, keeping the outer two where they are
    const x = a === 'm-spreadx', s = boxes.slice().sort((p, q) => (x ? p.b.x0 - q.b.x0 : p.b.y0 - q.b.y0)), size = s.reduce((n, o) => n + (x ? o.b.x1 - o.b.x0 : o.b.y1 - o.b.y0), 0), gap = ((x ? all.x1 - all.x0 : all.y1 - all.y0) - size) / Math.max(1, s.length - 1);
    let at = x ? all.x0 : all.y0; cvEdit(() => s.forEach(o => { if (x) shift(o, at - o.b.x0, 0); else shift(o, 0, at - o.b.y0); at += (x ? o.b.x1 - o.b.x0 : o.b.y1 - o.b.y0) + gap; })); return true;
  }
  if (a === 'm-weld' || a === 'm-subtract' || a === 'm-intersect') {
    const shapes = list.filter(i => !cvNeverCut(i)).map(i => ({ i, r: cvUnion(cvWorldShape(i).regions) })).filter(o => o.r.length); if (shapes.length < 2) { toast('Joining needs two closed shapes or more.', true); return true; }
    const first = shapes[0], rest = cvUnion(shapes.slice(1).flatMap(o => o.r));
    const out = a === 'm-weld' ? cvUnion(shapes.flatMap(o => o.r)) : a === 'm-subtract' ? cvMinus(first.r, rest) : cvClip(ClipperLib.ClipType.ctIntersection, first.r, rest);
    if (!out.length) { toast(a === 'm-intersect' ? "They don't overlap, so there's nothing left." : 'Nothing would be left.', true); return true; }
    const used = shapes.map(o => o.i), op = first.i.op;
    cvEdit(() => { cv.items = cv.items.filter(i => !used.includes(i)); });
    cvMakePath(cvAsLines(out), op); return true;
  }
  return true;
}

// ---------- editable shapes ----------
// Any item can become a path, so its points can be moved. It keeps its job, place, turn and mirroring.
function cvRecentre(it) {   // moves a path's points so its middle is on its own centre again, without moving it on the board
  const b = cvBox(it.paths.map(l => l.pts)), cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2; if (Math.abs(cx) < 1e-9 && Math.abs(cy) < 1e-9) return;
  const place = cvPlaceFn(it), o = place([0, 0]), m = place([cx, cy]);
  it.paths = it.paths.map(l => ({ closed: l.closed, pts: l.pts.map(q => [q[0] - cx, q[1] - cy]) })); it.x += m[0] - o[0]; it.y += m[1] - o[1];
}
function cvToPath(it) {
  if (it.type === 'path') return it;
  const s = cvLocal(it), lines = s.regions.length && it.type !== 'svg' ? s.regions.map(p => ({ closed: true, pts: p.map(q => q.slice()) })) : s.lines.map(l => ({ closed: l.closed, pts: l.pts.map(q => q.slice()) }));
  if (!lines.length) { toast('There is nothing to edit in it yet.', true); return it; }
  cvEdit(() => {
    ['w', 'h', 'art', 'text', 'font', 'size', 'spacing', 'leading', 'align', 'sides', 'points', 'inner', 'corner', 'arc', 'threshold', 'invert', 'detail', 'smooth'].forEach(k => delete it[k]);
    it.type = 'path'; it.paths = lines; cvRecentre(it);
  });
  return it;
}
// a point on the board in the item's own coordinates: the way back through cvPlaceFn
const cvToLocal = (it, p) => { const r = -(it.rot || 0) * Math.PI / 180, dx = p[0] - it.x, dy = p[1] - it.y, x = dx * Math.cos(r) - dy * Math.sin(r), y = dx * Math.sin(r) + dy * Math.cos(r); return [it.mx ? -x : x, it.my ? -y : y]; };

// ---------- editing points ----------
// Drag a point to move it, double-click a line to add one, and Delete takes away the one last touched. Esc stops.
let cvNodeEdit = null, cvNodeSel = null;
function cvNodesStart(it) { cvToPath(it); cvNodeEdit = it.id; cvNodeSel = null; carveRender(); }
function cvNodesStop() { if (cvNodeEdit === null) return false; cvNodeEdit = null; cvNodeSel = null; carveRender(); return true; }
const cvNodeItem = () => (cvNodeEdit !== null && cvSel === cvNodeEdit ? cvItem() : null);
function cvNodesSvg(it, px) {
  const place = cvPlaceFn(it), W = P.carve.board.w, H = 4 * px;
  return '<g>' + it.paths.map((l, li) => l.pts.map((q, pi) => { const p = place(q), on = cvNodeSel && cvNodeSel.l === li && cvNodeSel.p === pi; return `<rect class="cvn" data-l="${li}" data-p="${pi}" x="${p[0] - H}" y="${W - p[1] - H}" width="${H * 2}" height="${H * 2}" fill="${on ? '#ffc928' : '#fff'}" stroke="#20262a" stroke-width="${px}"/>`; }).join('')).join('') + '</g>';
}
function cvNodeDown(e, p) {
  const it = cvNodeItem(), n = it && e.target.closest && e.target.closest('.cvn');
  if (it && !n && cvNodeNearest(it, p)) return true;   // on or by one of its lines: stays picked, so a double-click there can add a point
  if (!n) return false;
  const li = +n.dataset.l, pi = +n.dataset.p; cvNodeSel = { l: li, p: pi }; let moved = false;
  cvDrag = { onMove: (ev, q) => { if (!moved) { pushUndo(); moved = true; } it.paths[li].pts[pi] = cvToLocal(it, q); cvStageRender(); }, onUp: () => { if (moved) { cvRecentre(it); persist(); } carveRender(); } };
  cvEl('cvStage').setPointerCapture(e.pointerId); cvStageRender(); return true;
}
function cvNodeNearest(it, p) {   // the line of it nearest p, within 8 pixels
  const place = cvPlaceFn(it); let best = null, d = 8 * cvView.k;
  it.paths.forEach((l, li) => { const n = l.pts.length; for (let i = 0; i < (l.closed ? n : n - 1); i++) { const a = place(l.pts[i]), b = place(l.pts[(i + 1) % n]), dx = b[0] - a[0], dy = b[1] - a[1], t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1))), v = Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t); if (v < d) { d = v; best = { li, i }; } } });
  return best;
}
function cvNodeAdd(p) {   // on the nearest line, if it's close
  const it = cvNodeItem(); if (!it) return false; const best = cvNodeNearest(it, p);
  if (!best) return true;
  cvEdit(() => { it.paths[best.li].pts.splice(best.i + 1, 0, cvToLocal(it, p)); }); cvNodeSel = { l: best.li, p: best.i + 1 }; carveRender(); return true;
}
function cvNodeDelete() {
  const it = cvNodeItem(); if (!it || !cvNodeSel) return !!it; const l = it.paths[cvNodeSel.l]; if (!l) return true;
  if (l.pts.length <= (l.closed ? 3 : 2)) { toast(l.closed ? 'A closed shape needs three points.' : 'A line needs two points.', true); return true; }
  cvEdit(() => { l.pts.splice(cvNodeSel.p, 1); cvRecentre(it); }); cvNodeSel = null; carveRender(); return true;
}

// ---------- DXF ----------
// Lines, polylines with their curved parts (bulges), arcs, circles, ellipses and splines from a text DXF, in its own units.
// Pieces whose ends meet are joined, and a chain that comes back to its start is a closed shape.
function cvParseDxf(text) {
  const L = String(text).split(/\r?\n/), g = []; for (let i = 0; i + 1 < L.length; i += 2) { const c = parseInt(L[i].trim(), 10); if (!isNaN(c)) g.push([c, L[i + 1].trim()]); }
  let unit = 1; const iu = g.findIndex(q => q[0] === 9 && q[1] === '$INSUNITS'); if (iu >= 0 && g[iu + 1]) unit = { 1: 25.4, 2: 304.8, 4: 1, 5: 10, 6: 1000 }[+g[iu + 1][1]] || 1;
  const start = g.findIndex((q, i) => q[0] === 2 && q[1] === 'ENTITIES' && g[i - 1] && g[i - 1][1] === 'SECTION'); if (start < 0) throw new Error("it has no drawing in it, or isn't a text DXF");
  const ents = []; let cur = null;
  for (let i = start + 1; i < g.length; i++) { const [c, v] = g[i]; if (c === 0) { if (v === 'ENDSEC') break; cur = { type: v, g: [] }; ents.push(cur); } else if (cur) cur.g.push([c, v]); }
  const num = (e, c, d = 0) => { const q = e.g.find(p => p[0] === c); return q ? parseFloat(q[1]) : d; }, all = (e, c) => e.g.filter(p => p[0] === c).map(p => parseFloat(p[1]));
  const open = [], shut = [], skipped = new Set();
  const arc = (cx, cy, r, a0, a1) => { let sweep = a1 - a0; while (sweep <= 0) sweep += Math.PI * 2; const n = Math.min(720, Math.max(8, Math.ceil(sweep / Math.max(.005, 2 * Math.acos(Math.max(-1, 1 - Math.min(.01 / Math.max(r, 1e-9), 1))))))), out = []; for (let k = 0; k <= n; k++) { const t = a0 + sweep * k / n; out.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]); } return out; };
  const bulged = (verts, closed) => {   // a polyline's vertices with their bulges, as points
    const out = [], n = verts.length;
    for (let i = 0; i < (closed ? n : n - 1); i++) {
      const a = verts[i], b = verts[(i + 1) % n], bu = a[2] || 0; out.push([a[0], a[1]]);
      if (Math.abs(bu) > 1e-9) { const th = 4 * Math.atan(bu), d = Math.hypot(b[0] - a[0], b[1] - a[1]), r = d / (2 * Math.sin(th / 2)), mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, h = r * Math.cos(th / 2), nx = -(b[1] - a[1]) / d, ny = (b[0] - a[0]) / d, cx = mx + nx * h, cy = my + ny * h, a0 = Math.atan2(a[1] - cy, a[0] - cx), steps = Math.max(4, Math.ceil(Math.abs(th) / .05)); for (let k = 1; k < steps; k++) { const t = a0 + th * k / steps; out.push([cx + Math.abs(r) * Math.cos(t), cy + Math.abs(r) * Math.sin(t)]); } }
    }
    if (!closed && n) out.push([verts[n - 1][0], verts[n - 1][1]]);
    return out;
  };
  for (let i = 0; i < ents.length; i++) {
    const e = ents[i];
    if (e.type === 'LINE') open.push([[num(e, 10), num(e, 20)], [num(e, 11), num(e, 21)]]);
    else if (e.type === 'CIRCLE') shut.push(arc(num(e, 10), num(e, 20), num(e, 40), 0, Math.PI * 2).slice(0, -1));
    else if (e.type === 'ARC') open.push(arc(num(e, 10), num(e, 20), num(e, 40), num(e, 50) * Math.PI / 180, num(e, 51) * Math.PI / 180));
    else if (e.type === 'LWPOLYLINE') {
      const verts = []; e.g.forEach(([c, v]) => { if (c === 10) verts.push([parseFloat(v), 0, 0]); else if (c === 20 && verts.length) verts[verts.length - 1][1] = parseFloat(v); else if (c === 42 && verts.length) verts[verts.length - 1][2] = parseFloat(v); });
      const closed = (num(e, 70) & 1) === 1; if (verts.length > 1) (closed ? shut : open).push(bulged(verts, closed));
    } else if (e.type === 'POLYLINE') {
      const closed = (num(e, 70) & 1) === 1, verts = []; let j = i + 1;
      for (; j < ents.length && ents[j].type !== 'SEQEND'; j++) if (ents[j].type === 'VERTEX') verts.push([num(ents[j], 10), num(ents[j], 20), num(ents[j], 42)]);
      i = j; if (verts.length > 1) (closed ? shut : open).push(bulged(verts, closed));
    } else if (e.type === 'ELLIPSE') {
      const cx = num(e, 10), cy = num(e, 20), mx = num(e, 11), my = num(e, 21), ratio = num(e, 40, 1), t0 = num(e, 41, 0), t1 = num(e, 42, Math.PI * 2), a = Math.hypot(mx, my), rot = Math.atan2(my, mx), b = a * ratio;
      let sweep = t1 - t0; while (sweep <= 0) sweep += Math.PI * 2; const n = Math.max(16, Math.ceil(sweep / .03)), pts = [];
      for (let k = 0; k <= n; k++) { const t = t0 + sweep * k / n, x = a * Math.cos(t), y = b * Math.sin(t); pts.push([cx + x * Math.cos(rot) - y * Math.sin(rot), cy + x * Math.sin(rot) + y * Math.cos(rot)]); }
      if (Math.abs(sweep - Math.PI * 2) < 1e-6) shut.push(pts.slice(0, -1)); else open.push(pts);
    } else if (e.type === 'SPLINE') {
      const deg = num(e, 71, 3), knots = all(e, 40), cx = all(e, 10), cy = all(e, 20), fx = all(e, 11), fy = all(e, 21), closed = (num(e, 70) & 1) === 1;
      let pts = [];
      if (cx.length > deg && knots.length === cx.length + deg + 1) {   // de Boor's method along the knots
        const C = cx.map((x, k) => [x, cy[k]]), lo = knots[deg], hi = knots[knots.length - deg - 1], n = Math.max(20, C.length * 12);
        for (let s = 0; s <= n; s++) {
          const t = Math.min(hi - 1e-12, lo + (hi - lo) * s / n); let k = deg; while (k < knots.length - deg - 2 && t >= knots[k + 1]) k++;
          const d = []; for (let j = 0; j <= deg; j++) d.push(C[j + k - deg].slice());
          for (let r = 1; r <= deg; r++) for (let j = deg; j >= r; j--) { const den = knots[j + 1 + k - r] - knots[j + k - deg], al = den ? (t - knots[j + k - deg]) / den : 0; d[j] = [(1 - al) * d[j - 1][0] + al * d[j][0], (1 - al) * d[j - 1][1] + al * d[j][1]]; }
          pts.push(d[deg]);
        }
      } else if (fx.length > 1) pts = cvSmoothLine(fx.map((x, k) => [x, fy[k]]), closed);
      else if (cx.length > 1) pts = cx.map((x, k) => [x, cy[k]]);
      if (pts.length > 1) (closed ? shut : open).push(pts);
    } else if (!['SEQEND', 'VERTEX', 'POINT'].includes(e.type)) skipped.add(e.type);
  }
  // join pieces whose ends meet
  const tol = 1e-3 / unit, same = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < tol, chains = open.map(p => p.slice());
  let joined = true;
  while (joined) {
    joined = false;
    for (let a = 0; a < chains.length && !joined; a++) for (let b = a + 1; b < chains.length && !joined; b++) {
      const A = chains[a], B = chains[b];
      if (same(A[A.length - 1], B[0])) chains[a] = A.concat(B.slice(1)); else if (same(A[A.length - 1], B[B.length - 1])) chains[a] = A.concat(B.slice(0, -1).reverse());
      else if (same(A[0], B[B.length - 1])) chains[a] = B.concat(A.slice(1)); else if (same(A[0], B[0])) chains[a] = B.slice().reverse().concat(A.slice(1)); else continue;
      chains.splice(b, 1); joined = true;
    }
  }
  const lines = shut.map(p => ({ closed: true, pts: p })).concat(chains.map(p => same(p[0], p[p.length - 1]) && p.length > 3 ? { closed: true, pts: p.slice(0, -1) } : { closed: false, pts: p }));
  return { lines: lines.map(l => ({ closed: l.closed, pts: l.pts.map(q => [q[0] * unit, q[1] * unit]) })), skipped: [...skipped] };
}
function cvAddDxf(text) {
  const { lines, skipped } = cvParseDxf(text); if (!lines.length) throw new Error('nothing drawable was found in it');
  const b = cvBox(lines.map(l => l.pts)), board = cvNow().board, w = b.x1 - b.x0, h = b.y1 - b.y0, fits = w <= board.l && h <= board.w, k = fits ? 1 : Math.min(board.l * .7 / w, board.w * .7 / h);
  const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2, placed = lines.map(l => ({ closed: l.closed, pts: l.pts.map(q => [board.l / 2 + (q[0] - cx) * k, board.w / 2 + (q[1] - cy) * k]) }));
  const it = cvMakePath(placed, null);
  if (!fits) toast(`It's ${cvLen(w)} x ${cvLen(h)}, bigger than the board, so it was scaled down to fit. Set its size in the panel.`, true);
  else if (skipped.length) toast(`Some parts of the DXF were left out: ${skipped.slice(0, 4).join(', ').toLowerCase()}. Explode them into lines in your drawing program.`, true);
  return it;
}

// ---------- tracing a picture ----------
// A photo or drawing becomes shapes: its dark parts (or light ones) are outlined along the pixel edges, then simplified.
// The picture is kept with the project, so the threshold, which side is cut and the detail can be changed later.
const cvImgCache = new Map(), cvImgWait = new Set();
async function cvImgDecode(key) {
  const t = TEXTURES[key]; if (!t) return null;
  const bmp = await createImageBitmap(new Blob([t.bytes])), k = Math.min(1, 800 / Math.max(bmp.width, bmp.height)), w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
  const c = new OffscreenCanvas(w, h), x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, w, h); x.drawImage(bmp, 0, 0, w, h);
  const d = x.getImageData(0, 0, w, h).data, gray = new Uint8Array(w * h); for (let i = 0; i < w * h; i++) gray[i] = Math.round(d[i * 4] * .299 + d[i * 4 + 1] * .587 + d[i * 4 + 2] * .114);
  const img = { w, h, gray }; cvImgCache.set(key, img); return img;
}
function cvOtsu(gray) {   // the grey level that best splits the picture into dark and light
  const hist = new Array(256).fill(0); gray.forEach(v => hist[v]++); const n = gray.length; let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
  let wb = 0, sb = 0, best = 0, at = 128; for (let t = 0; t < 256; t++) { wb += hist[t]; if (!wb) continue; const wf = n - wb; if (!wf) break; sb += t * hist[t]; const mb = sb / wb, mf = (sum - sb) / wf, v = wb * wf * (mb - mf) ** 2; if (v > best) { best = v; at = t; } }
  return at;
}
function cvTraceRaw(img, threshold, invert) {   // closed outlines in pixels, y up, with the ink on the left of each
  const { w, h, gray } = img, ink = (c, r) => c >= 0 && r >= 0 && c < w && r < h && (invert ? gray[r * w + c] > threshold : gray[r * w + c] <= threshold);
  const from = new Map(), key = (x, y) => x * 4096 + y, edges = [];
  const add = (x0, y0, x1, y1) => { const e = { x0, y0, x1, y1, used: false }; edges.push(e); const k = key(x0, y0); let l = from.get(k); if (!l) from.set(k, l = []); l.push(e); };
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
    if (!ink(c, r)) continue; const Y = h - r;
    if (!ink(c, r + 1)) add(c, Y - 1, c + 1, Y - 1); if (!ink(c + 1, r)) add(c + 1, Y - 1, c + 1, Y);
    if (!ink(c, r - 1)) add(c + 1, Y, c, Y); if (!ink(c - 1, r)) add(c, Y, c, Y - 1);
  }
  const loops = [];
  edges.forEach(e0 => {
    if (e0.used) return; const loop = []; let e = e0;
    while (e && !e.used) {
      e.used = true; loop.push([e.x0, e.y0]); const next = (from.get(key(e.x1, e.y1)) || []).filter(n => !n.used);
      if (next.length > 1) { const dx = e.x1 - e.x0, dy = e.y1 - e.y0; next.sort((a, b) => ((b.x1 - b.x0) * -dy + (b.y1 - b.y0) * dx) - ((a.x1 - a.x0) * -dy + (a.y1 - a.y0) * dx)); }   // at a corner where two pixels touch, turn left
      e = next[0];
    }
    if (loop.length > 3) loops.push(loop);
  });
  return loops;
}
function cvSimplify(pts, tol) {   // Douglas-Peucker on a closed outline
  if (pts.length < 4) return pts;
  const keep = new Uint8Array(pts.length); let far = 0, d = -1; pts.forEach((q, i) => { const v = (q[0] - pts[0][0]) ** 2 + (q[1] - pts[0][1]) ** 2; if (v > d) { d = v; far = i; } }); keep[0] = keep[far] = 1;
  const stack = [[0, far], [far, pts.length]];
  while (stack.length) {
    const [a, b] = stack.pop(), A = pts[a], B = pts[b % pts.length], dx = B[0] - A[0], dy = B[1] - A[1], L = Math.hypot(dx, dy) || 1; let m = -1, md = tol;
    for (let i = a + 1; i < b; i++) { const v = Math.abs((pts[i][0] - A[0]) * dy - (pts[i][1] - A[1]) * dx) / L; if (v > md) { md = v; m = i; } }
    if (m >= 0) { keep[m] = 1; stack.push([a, m], [m, b]); }
  }
  return pts.filter((q, i) => keep[i]);
}
function cvTraceRegions(it) {
  const img = cvImgCache.get(it.art);
  if (!img) { if (!cvImgWait.has(it.art) && TEXTURES[it.art]) { cvImgWait.add(it.art); cvImgDecode(it.art).then(() => { cvShapeCache.clear(); if (typeof carveRender === 'function') carveRender(); }).catch(() => {}); } return []; }
  const raw = cvTraceRaw(img, it.threshold ?? 128, !!it.invert), k = it.w / img.w, tol = Math.max(.3, it.detail || 1), min = 4;
  const polys = raw.map(l => cvSimplify(l, tol)).filter(l => l.length > 2 && Math.abs(cvArea(l)) >= min).map(l => l.map(q => [(q[0] - img.w / 2) * k, (q[1] - img.h / 2) * k]));
  return polys.length ? cvUnion(polys) : [];
}
async function cvAddImage(file) {
  const bytes = new Uint8Array(await file.arrayBuffer()), key = `img:${crc32(bytes).toString(36)}-${bytes.length}`;
  if (!TEXTURES[key]) { TEXTURES[key] = { bytes, avg: '#000000' }; kvSet('tex:' + key, TEXTURES[key]).catch(() => {}); }
  const img = cvImgCache.get(key) || await cvImgDecode(key), b = cvNow().board, w = Math.min(b.l * .7, b.w * .7 * img.w / img.h);
  return cvAdd({ type: 'trace', art: key, w, threshold: cvOtsu(img.gray), invert: false, detail: 1 });
}
// everything the import button can bring in
async function cvImportFile(f) {
  const name = f.name.toLowerCase();
  if (/\.dxf$/.test(name)) return cvAddDxf(await f.text());
  if (/\.(png|jpe?g|bmp|gif|webp)$/.test(name) || /^image\/(png|jpeg|bmp|gif|webp)$/.test(f.type)) { if (f.size > 25e6) throw new Error("it's too large. Use a picture under 25 MB"); return cvAddImage(f); }
  if (f.size > 8e6) throw new Error('it is too large to cut. Simplify it first');
  return cvAddSvgText(await f.text());
}

// ---------- clamps and dimensions ----------
// Both sit on the board and are never cut. A clamp zone is where a clamp holds the board: nothing may cut into it, and the
// bit stays at the safe height crossing it. A dimension shows a measurement between two points.
function cvAddClamp() {   // the safe height goes up to clear the clamps, if it was lower
  const cv = cvNow(), b = cv.board, it = cvAdd({ type: 'clamp', w: 30, h: 20, x: 15, y: b.w / 2 }), need = cvClampH(cv) + 5, raise = !(cv.safeZ > cvClampH(cv));
  cvEdit(() => { it.op = { kind: 'off' }; if (raise) cv.safeZ = need; });
  if (raise) toast(`Safe height raised to ${cvLen(need)}, to clear clamps ${cvLen(cvClampH(cv))} high. Set their real height in Machine.`);
  return it;
}
const cvNeverCut = it => it.type === 'clamp' || it.type === 'dim';
function cvSpecialSvg(it) {
  const W = P.carve.board.w, place = cvPlaceFn(it), px = cvView ? cvView.k : 1, sy = q => W - q[1];
  if (it.type === 'clamp') {
    const p = cvLocal(it).regions[0].map(place), c = place([0, 0]);
    return `<g class="cvitem" data-it="${it.id}"><path d="M${p.map(q => `${r2(q[0])} ${r2(sy(q))}`).join('L')}Z" fill="#c0392b" fill-opacity=".16" stroke="#c0392b" stroke-width="${1.5 * px}" stroke-dasharray="${5 * px} ${3 * px}"/><text x="${r2(c[0])}" y="${r2(sy(c) + 4 * px)}" text-anchor="middle" font-size="${11 * px}" fill="#c0392b" font-family="Barlow,sans-serif" pointer-events="none">Clamp</text></g>`;
  }
  const L = it.len / 2, o = it.off || 0, A = place([-L, 0]), B = place([L, 0]), e = Math.sign(o || 1) * 2 * px, A2 = place([-L, o]), B2 = place([L, o]), A3 = place([-L, o + e]), B3 = place([L, o + e]);
  const ink = '#20262a', ang = Math.atan2(B2[1] - A2[1], B2[0] - A2[0]), head = 7 * px, mid = place([0, o + Math.sign(o || 1) * 9 * px]);
  const arrow = (P1, dir) => { const a1 = ang + dir + .35, a2 = ang + dir - .35; return `M${r2(P1[0])} ${r2(sy(P1))}L${r2(P1[0] + Math.cos(a1) * head)} ${r2(sy([0, P1[1] + Math.sin(a1) * head]))}M${r2(P1[0])} ${r2(sy(P1))}L${r2(P1[0] + Math.cos(a2) * head)} ${r2(sy([0, P1[1] + Math.sin(a2) * head]))}`; };
  let deg = -ang * 180 / Math.PI; if (deg > 90) deg -= 180; if (deg < -90) deg += 180;
  const d = `M${r2(A[0])} ${r2(sy(A))}L${r2(A3[0])} ${r2(sy(A3))}M${r2(B[0])} ${r2(sy(B))}L${r2(B3[0])} ${r2(sy(B3))}M${r2(A2[0])} ${r2(sy(A2))}L${r2(B2[0])} ${r2(sy(B2))}` + arrow(A2, 0) + arrow(B2, Math.PI);
  return `<g class="cvitem" data-it="${it.id}"><path d="${d}" fill="none" stroke="transparent" stroke-width="${10 * px}"/><path d="${d}" fill="none" stroke="${ink}" stroke-width="${px}"/><text x="${r2(mid[0])}" y="${r2(sy(mid))}" text-anchor="middle" dominant-baseline="middle" font-size="${12 * px}" fill="${ink}" font-family="Barlow,sans-serif" transform="rotate(${r2(deg)} ${r2(mid[0])} ${r2(sy(mid))})">${esc(cvLen(it.len))}</text></g>`;
}
function cvSpecialPanelHtml(it) {
  if (it.type === 'clamp') return cvSec('cut', 'Clamp zone', '<p class="note">Where a clamp holds the board. Nothing is cut here, and the bit stays at the safe height crossing it. Set how high your clamps stand in Machine.</p>') + cvSec('place', 'Size and position', cvF('i.w', 'Width', cvNum(it.w)) + cvF('i.h', 'Height', cvNum(it.h)) + cvF('i.x', 'Middle from left', cvNum(it.x)) + cvF('i.y', 'Middle from front', cvNum(it.y)) + '<label class="field">Turn, degrees<input type="text" data-cf="i.rot" value="' + (it.rot || 0) + '"></label><div class="rowb cvicons">' + cvIconBtn('dup', 'copy', 'Duplicate (Ctrl+D)') + cvIconBtn('del', 'trash-2', 'Delete (Del)') + '</div>');
  return cvSec('cut', 'Dimension', '<p class="note">' + esc(cvLen(it.len)) + ' between its two ends. It is only drawn, never cut.</p>' + cvF('i.off', 'Line drawn this far off', cvNum(it.off || 0)) + '<div class="rowb cvicons">' + cvIconBtn('dup', 'copy', 'Duplicate (Ctrl+D)') + cvIconBtn('del', 'trash-2', 'Delete (Del)') + '</div>');
}
// the nearest corner of anything on the board, within 8 pixels, so dimensions measure exactly
function cvSnapPoint(p) {
  let best = null, d = 8 * cvView.k;
  P.carve.items.forEach(i => { if (i.type === 'dim') return; const w = cvWorldShape(i); w.lines.forEach(l => l.pts.forEach(q => { const v = Math.hypot(q[0] - p[0], q[1] - p[1]); if (v < d) { d = v; best = q; } })); });
  return best ? best.slice() : p;
}

// ---------- trimming ----------
// Click a drawn line and the stretch you clicked, between the nearest places it crosses other lines (or itself), is cut away.
function cvSegHit(a, b, c, d) {   // where segment ab meets segment cd, as how far along ab, or null
  const r = [b[0] - a[0], b[1] - a[1]], s = [d[0] - c[0], d[1] - c[1]], den = r[0] * s[1] - r[1] * s[0]; if (Math.abs(den) < 1e-12) return null;
  const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den, u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den;
  return t > 1e-9 && t < 1 - 1e-9 && u >= -1e-9 && u <= 1 + 1e-9 ? t : null;
}
function cvTrimAt(p) {
  let best = null, d = 8 * cvView.k;
  P.carve.items.forEach(it => {
    if (it.type !== 'path') return; const place = cvPlaceFn(it);
    it.paths.forEach((l, li) => { const pts = l.pts.map(place), n = pts.length; for (let i = 0; i < (l.closed ? n : n - 1); i++) { const a = pts[i], b = pts[(i + 1) % n], dx = b[0] - a[0], dy = b[1] - a[1], t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1))), v = Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t); if (v < d) { d = v; best = { it, li, i, t }; } } });
  });
  if (!best) { toast('Click on a drawn line to trim it. Other shapes can be made editable first, with Edit its points.', true); return false; }
  const { it, li } = best, l = it.paths[li], place = cvPlaceFn(it), pts = l.pts.map(place); if (l.closed) pts.push(pts[0]);
  const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = cum[cum.length - 1], at = cum[best.i] + best.t * (cum[best.i + 1] - cum[best.i]), cuts = [];
  const others = []; P.carve.items.forEach(o => { if (cvNeverCut(o)) return; cvWorldShape(o).lines.forEach((ol, k) => { if (o === it && it.type === 'path' && k === li) return; const q = ol.pts.slice(); if (ol.closed) q.push(q[0]); others.push(q); }); });
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1], L = cum[i + 1] - cum[i];
    others.forEach(q => { for (let k = 0; k + 1 < q.length; k++) { const t = cvSegHit(a, b, q[k], q[k + 1]); if (t !== null) cuts.push(cum[i] + t * L); } });
    for (let k = 0; k + 1 < pts.length; k++) { if (Math.abs(k - i) < 2 || (l.closed && Math.abs(k - i) === pts.length - 2)) continue; const t = cvSegHit(a, b, pts[k], pts[k + 1]); if (t !== null) cuts.push(cum[i] + t * L); }
  }
  cuts.sort((a, b) => a - b);
  const point = s => { let i = 1; while (i < cum.length - 1 && cum[i] < s) i++; const t = (s - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1); return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t]; };
  const piece = (u, v) => { const out = [point(u)]; for (let i = 0; i < cum.length; i++) if (cum[i] > u + 1e-9 && cum[i] < v - 1e-9) out.push(pts[i]); out.push(point(v)); return out; };
  let keep = [];
  if (l.closed) {
    if (cuts.length < 2) { toast("That line doesn't cross anything twice, so there's nothing to trim it back to.", true); return false; }
    const after = cuts.find(c => c > at), before = [...cuts].reverse().find(c => c < at), b = after ?? cuts[0] + total, a = before ?? cuts[cuts.length - 1] - total;
    const run = b < total ? piece(b, total).concat(piece(0, a < 0 ? a + total : a).slice(1)) : piece(b - total, a < 0 ? a + total : a);   // from the far end of the gap round to its near end
    keep = [run];
  } else {
    const a = [...cuts].reverse().find(c => c < at) ?? 0, b = cuts.find(c => c > at) ?? total;
    if (a < 1e-6 && b > total - 1e-6) { toast("That line doesn't cross anything, so there's nothing to trim it back to.", true); return false; }
    if (a > 1e-6) keep.push(piece(0, a)); if (b < total - 1e-6) keep.push(piece(b, total));
  }
  keep = keep.filter(k => k.length > 1 && Math.hypot(k[k.length - 1][0] - k[0][0], k[k.length - 1][1] - k[0][1]) + k.length > 2);
  cvEdit(() => {
    const local = keep.map(k => ({ closed: false, pts: k.map(q => cvToLocal(it, q)) }));
    it.paths.splice(li, 1, ...local);
    if (!it.paths.length) P.carve.items = P.carve.items.filter(i => i !== it); else cvRecentre(it);
  });
  return true;
}

// ---------- inlays ----------
// The pocket is the shape as the bit can cut it, inside corners rounded to the bit. The plug is that, a gap smaller all
// round, with its outside corners rounded the same way, so it drops in. It's added beside the shape, as a cut-out to make
// from the inlay wood.
function cvMakePlug(it) {
  const regions = cvUnion(cvWorldShape(it).regions); if (!regions.length) { toast('Only closed shapes can be inlaid.', true); return null; }
  const op = it.op || {}, own = cvBitOf(op.bit), bit = own && own.type === 'flat' ? own : cvBitOf(cvBestBit('outside')); if (!bit) { toast('An inlay needs a flat bit. Tick one in your bits.', true); return null; }
  const R = bit.d / 2, pocket = cvOffset(cvOffset(regions, -R), R); if (!pocket.length) { toast(`It's too narrow for ${bit.name} to pocket.`, true); return null; }
  let gap = Math.max(0, cvToolNum('igap', .1)), plug = [];
  for (let k = 0; k < 12; k++) {   // shrink until the plug, as the bit can cut it, fits inside the pocket
    const b = cvOffset(pocket, -gap); if (!b.length) break; plug = cvOffset(cvOffset(b, R), -R);
    const over = cvMinus(plug, pocket), area = Math.abs(over.reduce((s, p) => s + cvArea(p), 0)); if (area < .01) break; gap += .02;
  }
  if (!plug.length) { toast('With that gap there would be no plug left.', true); return null; }
  const box = cvBox(regions), shift = box.x1 - box.x0 + 10, lines = cvAsLines(plug.map(p => p.map(q => [q[0] + shift, q[1]])));
  const made = cvMakePath(lines, { kind: 'outside', bit: bit.id, depth: cvOpDepth(cvNow(), op) || 3, through: true, tabs: 2, finish: 0, peck: true, clear: null });
  if (it.op && it.op.kind !== 'pocket') cvEdit(() => { it.op = { ...cvOpFor(cvNow(), 'pocket'), bit: bit.id, depth: it.op.depth || 3, through: false }; });
  toast(`Plug added beside it, ${cvLen(gap)} smaller all round. Cut it from your inlay wood, then glue it into the pocket.`);
  return made;
}

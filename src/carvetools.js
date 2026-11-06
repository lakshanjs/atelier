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
  'cv-close': '<path d="M5 19 5 9l7-5 7 5v10" /><path d="M5 19h14" stroke-dasharray="2 2" />',
});

[['cvAddPolygon', 'pentagon'], ['cvAddStar', 'star'], ['cvAddPen', 'pen-tool']].forEach(([id, name]) => addIcon(cvEl(id), name));

const cvTypeIcon = type => ({ text: 'type', svg: 'image', circle: 'circle', polygon: 'pentagon', star: 'star', path: 'pen-tool' }[type] || 'square');
function cvAddPolygon(kind) { const b = cvNow().board, d = Math.min(b.l, b.w) * .5; return cvAdd(kind === 'star' ? { type: 'star', w: d, h: d, points: 5, inner: .5 } : { type: 'polygon', w: d, h: d, sides: 6 }); }
function cvScalePath(it, f) { if (!(f > 0)) return; it.paths = it.paths.map(l => ({ closed: l.closed, pts: l.pts.map(q => [q[0] * f, q[1] * f]) })); }

// ---------- what's picked, on the board ----------
// One item has its handles. With more, each shows a dashed box and the panel's tools act on them together.
function cvPickedSvg(px) {
  const list = cvPicked(); if (!list.length) return '';
  if (list.length === 1) return cvHandles(list[0], px);
  const W = P.carve.board.w;
  return '<g pointer-events="none">' + list.map(i => { const b = cvWorldBox(i), m = 3 * px; return `<rect x="${b.x0 - m}" y="${W - b.y1 - m}" width="${b.x1 - b.x0 + 2 * m}" height="${b.y1 - b.y0 + 2 * m}" fill="none" stroke="#ffc928" stroke-width="${1.5 * px}" stroke-dasharray="${5 * px} ${3 * px}"/>`; }).join('') + '</g>';
}

// ---------- drawing lines and curves ----------
// Click for each point. Clicking the first point again closes the shape; double-click or Enter finishes an open line.
// Shift keeps each line level, upright or at 45 degrees. Esc stops.
function cvToolStart(kind) { cvTool = { kind, pts: [], at: null }; cvPickOnly(null); cvEl('cvStage').classList.add('drawing'); carveRender(); }
function cvToolCancel() { cvTool = null; cvEl('cvStage').classList.remove('drawing'); carveRender(); }
const cvToolTitle = () => 'Drawing a line';
const cvToolClose = p => cvTool.pts.length > 2 && Math.hypot(p[0] - cvTool.pts[0][0], p[1] - cvTool.pts[0][1]) < 8 * cvView.k;
function cvToolSnap(e, p) {
  const last = cvTool.pts[cvTool.pts.length - 1]; if (!e.shiftKey || !last) return p;
  const dx = p[0] - last[0], dy = p[1] - last[1], a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * Math.PI / 4, r = Math.hypot(dx, dy);
  return [last[0] + Math.cos(a) * r, last[1] + Math.sin(a) * r];
}
function cvToolDown(e, p) {
  if (cvToolClose(p)) { cvToolFinish(true); return; }
  p = cvToolSnap(e, p); const last = cvTool.pts[cvTool.pts.length - 1];
  if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 1e-3) cvTool.pts.push(p);
  cvToolDraw(p); cvPanelRender();
}
function cvToolMove(e, p) { cvTool.at = cvToolClose(p) ? cvTool.pts[0] : cvToolSnap(e, p); cvToolDraw(cvTool.at); }
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
  if (it.type === 'rect' || it.type === 'polygon' || it.type === 'star') shape += cvF('t.corner', 'Round the corners', cvNum(it.corner || 0));
  if (it.type === 'path') {
    shape += '<label class="check"><input type="checkbox" data-cf="t.smooth" ' + (it.smooth ? 'checked' : '') + '>Smooth curve through the points</label>';
    if (it.paths.some(l => !l.closed)) shape += '<div class="rowb"><button class="btn line" data-cact="t-close">' + ic('cv-close') + 'Close the open lines</button></div>';
  }
  const tools = '<div class="rowb cvicons">' + cvIconBtn('t-mx', 'flip-horizontal-2', 'Mirror, left to right') + cvIconBtn('t-my', 'cv-flip-v', 'Mirror, front to back') + '</div>'
    + '<p class="cvSub">Outline</p><div class="cvrow">' + cvF('t.off', 'Distance', cvNum(cvToolNum('off', 3))) + '</div><div class="rowb cvicons">' + cvIconBtn('t-out', 'cv-offset', 'Make an outline this far outside it') + cvIconBtn('t-in', 'cv-inset', 'Make an outline this far inside it') + '</div>'
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
  if (k === 'm.kind') { const kind = el.value, list = cvPicked(); cvEdit(() => { list.forEach(i => { if (kind === 'line' || kind === 'off' || cvLocal(i).regions.length) i.op = cvOpFor(cv, kind); }); }); return true; }
  if (['off', 'cols', 'rows', 'gap', 'ring'].includes(f)) {
    const v = f === 'off' || f === 'gap' ? cvParse(el.value) : parseInt(el.value, 10), ok = f === 'off' ? v > 0 : f === 'gap' ? v >= 0 : f === 'ring' ? v >= 2 && v <= 360 : v >= 1 && v <= 100;
    if (isFinite(v) && ok) cvToolNums[f] = v; else { toast("That number won't work.", true); cvPanelRender(); }
    return true;
  }
  if (!it) return true;
  if (f === 'smooth') { cvEdit(() => { it.smooth = el.checked; }); return true; }
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
    const shapes = list.map(i => ({ i, r: cvUnion(cvWorldShape(i).regions) })).filter(o => o.r.length); if (shapes.length < 2) { toast('Joining needs two closed shapes or more.', true); return true; }
    const first = shapes[0], rest = cvUnion(shapes.slice(1).flatMap(o => o.r));
    const out = a === 'm-weld' ? cvUnion(shapes.flatMap(o => o.r)) : a === 'm-subtract' ? cvMinus(first.r, rest) : cvClip(ClipperLib.ClipType.ctIntersection, first.r, rest);
    if (!out.length) { toast(a === 'm-intersect' ? "They don't overlap, so there's nothing left." : 'Nothing would be left.', true); return true; }
    const used = shapes.map(o => o.i), op = first.i.op;
    cvEdit(() => { cv.items = cv.items.filter(i => !used.includes(i)); });
    cvMakePath(cvAsLines(out), op); return true;
  }
  return true;
}

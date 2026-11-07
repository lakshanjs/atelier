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
  'cv-arc': '<path d="M4 19A15 15 0 0 1 20 5" /><circle cx="4" cy="19" r="1.6" /><circle cx="20" cy="5" r="1.6" /><circle cx="9.5" cy="9.5" r="1.6" />',
  'cv-extend': '<path d="M3 12h10" /><path d="M13 12h5" stroke-dasharray="2 2" /><path d="M21 5v14" />',
  'cv-clamp': '<path d="M5 4h9v4H9v8h5v4H5Z" /><path d="M14 6h4v12h-4" /><path d="M18 12h3" />',
  'cv-close': '<path d="M5 19 5 9l7-5 7 5v10" /><path d="M5 19h14" stroke-dasharray="2 2" />',
  'cv-tri': '<path d="M12 4 21 19H3Z" />',
  'cv-rtri': '<path d="M4 4v16h16Z" />',
  'cv-half': '<path d="M3 16a9 9 0 0 1 18 0Z" />',
  'cv-free': '<path d="M3 17c2-6 4-9 6-6s1 7 4 5 3-9 5-8 2 4 3 3" />',
  'cv-erase': '<path d="m7 21-4-4L14 6l6 6-9 9Z" /><path d="M7 21h13" /><path d="m9 11 6 6" />',
  'cv-view': '<path d="m12 3 9 5-9 5-9-5Z" /><path d="m3 13 9 5 9-5" />',
  'cv-check': '<path d="M5 12.5 10 17 19 7" />',
  'cv-front': '<rect x="3" y="3" width="11" height="11" stroke-dasharray="2 2" /><rect x="10" y="10" width="11" height="11" />',
  'cv-back': '<rect x="3" y="3" width="11" height="11" /><rect x="10" y="10" width="11" height="11" stroke-dasharray="2 2" />',
  'cv-split': '<path d="M4 4h7v7H4Z" /><path d="M13 13h7v7h-7Z" /><path d="m13 4 7 7" stroke-dasharray="2 2" />',
  'cv-fill': '<rect x="3" y="3" width="8" height="8" /><rect x="13" y="3" width="8" height="8" /><rect x="3" y="13" width="8" height="8" /><rect x="13" y="13" width="8" height="8" />',
  'cv-fit': '<path d="M3 8V3h5M16 3h5v5M21 16v5h-5M8 21H3v-5" /><rect x="8" y="8" width="8" height="8" />',
});

[['cvAddPolygon', 'pentagon'], ['cvAddStar', 'star'], ['cvAddTri', 'cv-tri'], ['cvAddRightTri', 'cv-rtri'], ['cvAddHalf', 'cv-half'], ['cvFree', 'cv-free'], ['cvErase', 'cv-erase'], ['cvViewBtn', 'cv-view'], ['cvAddPen', 'pen-tool'], ['cvAddArc', 'cv-arc'], ['cvExtend', 'cv-extend'], ['cvTrim', 'scissors'], ['cvDim', 'ruler'], ['cvAddClamp', 'cv-clamp']].forEach(([id, name]) => addIcon(cvEl(id), name));

const cvTypeIcon = type => ({ text: 'type', svg: 'image', trace: 'image', relief: 'box', circle: 'circle', polygon: 'pentagon', star: 'star', path: 'pen-tool' }[type] || 'square');
function cvAddPolygon(kind) { const b = cvNow().board, d = Math.min(b.l, b.w) * .5; return cvAdd(kind === 'star' ? { type: 'star', w: d, h: d, points: 5, inner: .5 } : { type: 'polygon', w: d, h: d, sides: 6 }); }
function cvScalePath(it, f) { if (!(f > 0)) return; it.paths = it.paths.map(l => cvMapLine(l, q => [q[0] * f, q[1] * f], h => h.map(v => v * f))); }
// a line with every point moved by fn and every handle by hfn (handles are offsets, so a shift leaves them alone)
const cvMapLine = (l, fn, hfn = h => h) => { const o = { closed: l.closed, pts: l.pts.map(fn) }; if (l.c) o.c = l.c.map(h => (h ? hfn(h) : null)); return o; };

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
const cvToolTitle = () => ({ trim: 'Trimming lines', dim: 'Measuring', arc: 'Drawing an arc', extend: 'Extending lines', free: 'Drawing freehand', erase: 'Rubbing out' }[cvTool.kind] || 'Drawing a line');
const cvToolClose = p => cvTool.kind === 'pen' && cvTool.pts.length > 2 && Math.hypot(p[0] - cvTool.pts[0][0], p[1] - cvTool.pts[0][1]) < 8 * cvView.k;
function cvToolSnap(e, p) {
  const last = cvTool.pts[cvTool.pts.length - 1]; if (!e.shiftKey || !last) return p;
  const dx = p[0] - last[0], dy = p[1] - last[1], a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * Math.PI / 4, r = Math.hypot(dx, dy);
  return [last[0] + Math.cos(a) * r, last[1] + Math.sin(a) * r];
}
function cvToolDown(e, p) {
  if (cvTool.kind === 'free' || cvTool.kind === 'erase') { cvFreeDown(e, p); return; }
  if (cvTool.kind === 'extend') { cvExtendAt(p); return; }   // stays on, for the next line
  if (cvTool.kind === 'arc') {
    p = cvToolSnap(e, p); cvTool.pts.push(p);
    if (cvTool.pts.length === 3) { const [a, b, m] = cvTool.pts, l = cvArcLine(a, b, m); cvToolCancel(); if (l) cvMakePath([l], null); else toast('Those three points are in a line, so there is no arc through them.', true); return; }
    cvToolDraw(p); cvPanelRender(); return;
  }
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
function cvToolMove(e, p) { if (cvTool.kind === 'erase') { cvEraseCursor(p); return; } if (cvTool.kind === 'trim' || cvTool.kind === 'extend' || cvTool.kind === 'free') return; cvTool.at = cvToolClose(p) ? cvTool.pts[0] : cvTool.kind === 'dim' ? cvSnapPoint(cvToolSnap(e, p)) : cvToolSnap(e, p); cvToolDraw(cvTool.at); }
function cvToolDraw(at) {
  const g = cvEl('cvPen'); if (!g || !cvTool) return; const W = P.carve.board.w, k = cvView.k, arc = cvTool.kind === 'arc' && cvTool.pts.length === 2 && at && cvArcLine(cvTool.pts[0], cvTool.pts[1], at), pts = arc ? cvBezLine(arc) : cvTool.pts.concat(at ? [at] : []);
  g.innerHTML = (pts.length > 1 ? `<path d="M${pts.map(q => `${r2(q[0])} ${r2(W - q[1])}`).join('L')}" fill="none" stroke="#20262a" stroke-width="${1.5 * k}"/>` : '')
    + (cvTool.kind === 'free' ? [] : cvTool.pts).map((q, i) => `<rect x="${q[0] - 3 * k}" y="${W - q[1] - 3 * k}" width="${6 * k}" height="${6 * k}" fill="${i === 0 && cvTool.pts.length > 2 ? '#ffc928' : '#fff'}" stroke="#20262a" stroke-width="${k}"/>`).join('');
}
function cvToolFinish(closed) {
  const pts = cvTool ? cvTool.pts : []; cvToolCancel();
  if (pts.length < 2 || (closed && pts.length < 3)) { if (pts.length) toast(closed ? 'A closed shape needs three points or more.' : 'A line needs two points or more.', true); return null; }
  return cvMakePath([{ pts, closed }], null);
}
// a path item from lines on the board, centred on itself, with this job (or the one last chosen for shapes)
function cvMakePath(lines, op, extra = {}) {
  const b = cvBox(lines.map(l => l.pts)), cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2, it = cvAdd({ type: 'path', x: cx, y: cy, paths: lines.map(l => cvMapLine(l, q => [q[0] - cx, q[1] - cy])), ...extra });
  if (op) cvEdit(() => { it.op = JSON.parse(JSON.stringify(op)); });
  return it;
}
function cvToolPanelHtml() {
  const n = cvTool.pts.length;
  if (cvTool.kind === 'arc') return cvSec('draw', 'Drawing an arc', '<p class="note">' + ['Click where the arc starts.', 'Click where it ends.', 'Click a point it passes through, which sets how much it bends.'][n] + ' Hold Shift for level, upright or 45° lines. Esc stops.</p>');
  if (cvTool.kind === 'extend') return cvSec('draw', 'Extending', '<p class="note">Click near the end of a drawn line, and it carries straight on until it meets another line. Esc stops.</p>');
  if (cvTool.kind === 'trim') return cvSec('draw', 'Trimming', '<p class="note">Click a drawn line, and the stretch you clicked is cut back to the nearest places it crosses another line, or itself. Shapes that aren\'t drawn lines can be made editable first, with Edit its points. Esc stops.</p>');
  if (cvTool.kind === 'free') return cvSec('draw', 'Drawing freehand', '<p class="note">Drag on the board to draw. A line that ends near where it started becomes a closed shape. Each one is smoothed, and its points can be edited after. Esc stops.</p>');
  if (cvTool.kind === 'erase') return cvSec('draw', 'Rubbing out', '<p class="note">Drag over drawn lines to rub them out. A shape rubbed through opens up, and a line rubbed across its middle becomes two. Only drawn lines can be rubbed out: other shapes can be made into them with Edit its points. Esc stops.</p>' + cvF('t.er', 'Eraser width', cvNum(cvToolNum('er', 3))));
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
  if (it.type === 'relief') return cvSec('tools', 'Mirror and copies', '<div class="rowb cvicons">' + cvIconBtn('t-mx', 'flip-horizontal-2', 'Mirror, left to right') + cvIconBtn('t-my', 'cv-flip-v', 'Mirror, front to back') + '</div>'
    + '<p class="cvSub">Copies</p>' + '<label class="field">Across<input type="text" data-cf="t.cols" value="' + cvToolNum('cols', 3) + '"></label><label class="field">Back<input type="text" data-cf="t.rows" value="' + cvToolNum('rows', 1) + '"></label>' + cvF('t.gap', 'Gap between', cvNum(cvToolNum('gap', 5))) + '<div class="rowb cvicons">' + cvIconBtn('t-grid', 'layout-grid', 'Make copies in rows and columns') + '</div>');
  if (it.type === 'polygon') shape += '<label class="field">Sides<input type="text" data-cf="t.sides" value="' + (it.sides || 6) + '"></label>';
  if (it.type === 'star') shape += '<label class="field">Points<input type="text" data-cf="t.points" value="' + (it.points || 5) + '"></label><label class="field">Inner size, %<input type="text" data-cf="t.inner" value="' + Math.round((it.inner || .5) * 100) + '"></label>';
  if (it.type === 'rect' || it.type === 'polygon' || it.type === 'star' || (it.type === 'path' && it.paths.some(l => l.closed))) shape += cvF('t.corner', 'Round the corners', cvNum(it.corner || 0));
  if (it.type === 'trace') shape += '<label class="field">Dark or light, where it splits<input type="range" min="1" max="254" data-cf="t.thr" value="' + (it.threshold ?? 128) + '" title="Grey levels darker than this are traced"></label><label class="check"><input type="checkbox" data-cf="t.invert" ' + (it.invert ? 'checked' : '') + '>Trace the light parts instead</label><label class="field">Detail<select data-cf="t.detail">' + [[.5, 'Fine'], [1, 'Normal'], [2.5, 'Smooth']].map(([v, l]) => '<option value="' + v + '" ' + ((it.detail || 1) === v ? 'selected' : '') + '>' + l + '</option>').join('') + '</select></label>';
  shape += '<div class="rowb"><button class="btn line" data-cact="t-nodes" title="' + (it.type === 'path' ? 'Drag a point to move it, double-click a line to add one, Delete removes the last one touched' : 'Turns it into a plain shape whose points can be moved. Its own settings, like its text or sides, are then fixed') + '">' + ic('pen-tool') + (cvNodeItem() ? 'Stop editing points' : 'Edit its points') + '</button></div>';
  if (cvNodeItem()) shape += '<div class="rowb"><button class="btn line" data-cact="t-fit" title="Gives every point handles, so the line curves smoothly through them all">Fit curves</button><button class="btn line" data-cact="t-ptsmooth"' + (cvNodeSel ? '' : ' disabled') + ' title="Turns the point touched last into a smooth curve, or back into a sharp corner">Smooth or sharp</button></div>' + cvF('t.fr', 'Round a corner, radius', cvNum(cvToolNum('fr', 3))) + cvF('t.fc', 'Or cut it off, along each side', cvNum(cvToolNum('fc', 3))) + '<div class="rowb"><button class="btn line" data-cact="t-fillet"' + (cvNodeSel ? '' : ' disabled') + ' title="Rounds the corner at the point touched last">Round corner</button><button class="btn line" data-cact="t-chamfer"' + (cvNodeSel ? '' : ' disabled') + ' title="Cuts the corner at the point touched last off straight">Cut corner off</button></div>';
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
  const grouped = list.every(i => i.gid && i.gid === list[0].gid), openLines = list.filter(i => i.type === 'path').reduce((n, i) => n + cvLocal(i).lines.filter(l => !l.closed).length, 0), line = list.length === 2 && list.find(i => i.type === 'path' && cvLocal(i).lines.length);
  h += cvSec('mgroup', 'Group', '<div class="rowb">' + (grouped ? '<button class="btn line" data-cact="m-ungroup" title="Ctrl+Shift+G">' + ic('separator-vertical') + 'Ungroup</button>' : '<button class="btn line" data-cact="m-group" title="Kept together: picked, moved and copied as one (Ctrl+G)">' + ic('group') + 'Group them</button>') + '</div>'
    + (openLines >= 2 ? '<div class="rowb"><button class="btn line" data-cact="m-join" title="Joins the open drawn lines at their nearest ends, into one shape">' + ic('cv-close') + 'Join the open lines</button></div>' : ''));
  if (line) h += cvSec('malong', 'Copy along the line', '<label class="field">Copies<input type="text" data-cf="m.along" value="' + cvToolNum('along', 5) + '"></label><label class="check"><input type="checkbox" data-cf="m.turn" ' + (cvToolNums.alongTurn !== false ? 'checked' : '') + '>Turn to follow the line</label><div class="rowb"><button class="btn line" data-cact="m-along" title="Spaces copies of the other one evenly along the drawn line">' + ic('cv-ring') + 'Copy along the line</button></div>');
  h += cvSec('mmore', 'Copy or delete', '<div class="rowb cvicons">' + cvIconBtn('dup', 'copy', 'Duplicate them (Ctrl+D)') + cvIconBtn('del', 'trash-2', 'Delete them (Del)') + '</div>');
  return h;
}

// ---------- doing it ----------
function cvToolField(el) {
  const k = el.dataset.cf; if (!k || !(k.startsWith('t.') || k.startsWith('m.'))) return false;
  const it = cvItem(), cv = cvNow(), f = k.slice(2);
  if (k === 'm.kind') { const kind = el.value, list = cvPicked(); cvEdit(() => { list.forEach(i => { if (!cvNeverCut(i) && (kind === 'line' || kind === 'off' || cvLocal(i).regions.length)) i.op = cvOpFor(cv, kind); }); }); return true; }
  if (k === 'm.turn') { cvToolNums.alongTurn = el.checked; return true; }
  if (['off', 'cols', 'rows', 'gap', 'ring', 'igap', 'fr', 'fc', 'along', 'er'].includes(f)) {
    const v = ['off', 'gap', 'igap', 'fr', 'fc', 'er'].includes(f) ? cvParse(el.value) : parseInt(el.value, 10), ok = f === 'off' || f === 'fr' || f === 'fc' || f === 'er' ? v > 0 : f === 'gap' || f === 'igap' ? v >= 0 : f === 'along' ? v >= 2 && v <= 500 : f === 'ring' ? v >= 2 && v <= 360 : v >= 1 && v <= 100;
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
  if (a === 'b-svg' || a === 'b-dxf') { cvSaveShapes(a.slice(2)); return true; }
  if (!it) return a.startsWith('t-') || a.startsWith('m-');
  if (['t-fit', 't-ptsmooth', 't-fillet', 't-chamfer'].includes(a)) {
    const n = cvNodeSel, ok = () => { cvEdit(() => cvRecentre(it)); carveRender(); };
    if (a === 't-fit') { cvEdit(() => cvFitCurves(it)); carveRender(); return true; }
    if (!n) return true;
    if (a === 't-ptsmooth') { cvEdit(() => cvTogglePoint(it, n.l, n.p)); carveRender(); return true; }
    let done = false; cvEdit(() => { done = cvCornerAt(it, n.l, n.p, a === 't-fillet' ? cvToolNum('fr', 3) : cvToolNum('fc', 3), a === 't-chamfer'); }); if (done) { cvNodeSel = null; ok(); } return true;
  }
  if (a === 'm-join') { cvJoinLines(list); return true; }
  if (a === 'm-group') { cvGroup(list); return true; }
  if (a === 'm-ungroup') { cvUngroup(list); return true; }
  if (a === 'm-along') { cvCopyAlong(list); return true; }
  if (a === 't-plug') { cvMakePlug(it); return true; }
  if (a === 't-nodes') { if (cvNodeItem()) cvNodesStop(); else cvNodesStart(it); return true; }
  if (a === 't-mx' || a === 't-my') { const k = a === 't-mx' ? 'mx' : 'my'; cvEdit(() => { list.forEach(i => { i[k] = !i[k]; }); }); return true; }
  if (a === 't-close') { cvEdit(() => { it.paths = it.paths.map(l => ({ ...l, closed: l.pts.length > 2 ? true : l.closed })); }); return true; }
  if (a === 't-out' || a === 't-in') {
    const d = cvToolNum('off', 3), regions = cvWorldShape(it).regions; if (!regions.length) { toast('Only closed shapes can be outlined.', true); return true; }
    const out = cvOffset(cvUnion(regions), a === 't-out' ? d : -d); if (!out.length) { toast("It isn't that wide, so there's nothing inside.", true); return true; }
    cvMakePath(cvAsLines(out), it.op); return true;
  }
  if (a === 't-grid') {
    const box = cvWorldBox(it), w = box.x1 - box.x0, h = box.y1 - box.y0, gap = cvToolNum('gap', 5), cols = cvToolNum('cols', 3), rows = cvToolNum('rows', 1), made = [];
    cvEdit(() => { for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) { if (!i && !j) continue; const c = cvClone(it); c.id = cv.nextId++; c.x = it.x + i * (w + gap); c.y = it.y + j * (h + gap); cv.items.push(c); made.push(c); } });
    cvPickList([it, ...made]); carveRender(); return true;
  }
  if (a === 't-ring') {
    const n = cvToolNum('ring', 6), cx = b.l / 2, cy = b.w / 2, made = [];
    cvEdit(() => { for (let k = 1; k < n; k++) { const t = k / n * Math.PI * 2, c = cvClone(it), dx = it.x - cx, dy = it.y - cy; c.id = cv.nextId++; c.x = cx + dx * Math.cos(t) - dy * Math.sin(t); c.y = cy + dx * Math.sin(t) + dy * Math.cos(t); c.rot = (((it.rot || 0) + k * 360 / n) % 360 + 360) % 360; cv.items.push(c); made.push(c); } });
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
  it.paths = it.paths.map(l => cvMapLine(l, q => [q[0] - cx, q[1] - cy])); it.x += m[0] - o[0]; it.y += m[1] - o[1];
}
function cvToPath(it) {
  if (it.type === 'path') return it;
  const s = cvLocal(it), lines = s.regions.length && it.type !== 'svg' ? s.regions.map(p => ({ closed: true, pts: p.map(q => q.slice()) })) : s.lines.map(l => ({ closed: l.closed, pts: l.pts.map(q => q.slice()) }));
  if (!lines.length) { toast('There is nothing to edit in it yet.', true); return it; }
  cvEdit(() => {
    ['w', 'h', 'art', 'text', 'font', 'size', 'spacing', 'leading', 'align', 'sides', 'points', 'inner', 'corner', 'arc', 'warp', 'warpAmt', 'threshold', 'invert', 'detail', 'smooth'].forEach(k => delete it[k]);
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
const cvNodeItem = () => { const it = cvNodeEdit !== null && cvSel === cvNodeEdit ? cvItem() : null; return it && it.type === 'path' ? it : null; };
function cvNodesSvg(it, px) {
  const place = cvPlaceFn(it), W = P.carve.board.w, H = 4 * px;
  const hd = it.paths.map((l, li) => (l.c || []).map((h, pi) => { if (!cvHasHandle(h)) return ''; const p = place(l.pts[pi]); return [[h[0], h[1], 0], [h[2], h[3], 1]].filter(v => v[0] || v[1]).map(([x, y, s]) => { const q = place([l.pts[pi][0] + x, l.pts[pi][1] + y]); return `<line x1="${p[0]}" y1="${W - p[1]}" x2="${q[0]}" y2="${W - q[1]}" stroke="#0f7d8c" stroke-width="${px}"/><circle class="cvhd" data-l="${li}" data-p="${pi}" data-s="${s}" cx="${q[0]}" cy="${W - q[1]}" r="${H}" fill="#fff" stroke="#0f7d8c" stroke-width="${px}"/>`; }).join(''); }).join('')).join('');
  return '<g>' + hd + it.paths.map((l, li) => l.pts.map((q, pi) => { const p = place(q), on = cvNodeSel && cvNodeSel.l === li && cvNodeSel.p === pi; return `<rect class="cvn" data-l="${li}" data-p="${pi}" x="${p[0] - H}" y="${W - p[1] - H}" width="${H * 2}" height="${H * 2}" fill="${on ? '#ffc928' : '#fff'}" stroke="#20262a" stroke-width="${px}"/>`; }).join('')).join('') + '</g>';
}
function cvNodeDown(e, p) {
  const it0 = cvNodeItem(), hd = it0 && e.target.closest && e.target.closest('.cvhd');
  if (hd) {   // a handle: the other one of a smooth point swings round to match, unless Alt is held
    const li = +hd.dataset.l, pi = +hd.dataset.p, s = +hd.dataset.s, l = it0.paths[li]; let moved = false;
    cvDrag = { onMove: (ev, q) => { if (!moved) { pushUndo(); moved = true; } const at = cvToLocal(it0, q), h = l.c[pi], v = [at[0] - l.pts[pi][0], at[1] - l.pts[pi][1]], o = s ? [h[0], h[1]] : [h[2], h[3]], ol = Math.hypot(o[0], o[1]), vl = Math.hypot(v[0], v[1]) || 1, keep = ev.altKey ? o : [-v[0] / vl * ol, -v[1] / vl * ol]; l.c[pi] = s ? [keep[0], keep[1], v[0], v[1]] : [v[0], v[1], keep[0], keep[1]]; cvStageRender(); }, onUp: () => { if (moved) persist(); carveRender(); } };
    cvEl('cvStage').setPointerCapture(e.pointerId); return true;
  }
  const it = it0, n = it && e.target.closest && e.target.closest('.cvn');
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
  cvEdit(() => { const l = it.paths[best.li]; l.pts.splice(best.i + 1, 0, cvToLocal(it, p)); if (l.c) l.c.splice(best.i + 1, 0, null); }); cvNodeSel = { l: best.li, p: best.i + 1 }; carveRender(); return true;
}
function cvNodeDelete() {
  const it = cvNodeItem(); if (!it || !cvNodeSel) return !!it; const l = it.paths[cvNodeSel.l]; if (!l) return true;
  if (l.pts.length <= (l.closed ? 3 : 2)) { toast(l.closed ? 'A closed shape needs three points.' : 'A line needs two points.', true); return true; }
  cvEdit(() => { l.pts.splice(cvNodeSel.p, 1); if (l.c) l.c.splice(cvNodeSel.p, 1); cvRecentre(it); }); cvNodeSel = null; carveRender(); return true;
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
// ---------- 3D models ----------
// An STL is kept with the project, like a picture, and carved as a relief: seen from above, its top at the board's surface.
async function cvAddStl(file) {
  if (file.size > 80e6) throw new Error("it's too large. Use a model under 80 MB");
  const bytes = new Uint8Array(await file.arrayBuffer()), key = `stl:${crc32(bytes).toString(36)}-${bytes.length}`;
  cvHeightMap(cvStlTris(bytes), 'z');   // refuses anything unreadable before it's kept
  if (!TEXTURES[key]) { TEXTURES[key] = { bytes, avg: '#000000' }; kvSet('tex:' + key, TEXTURES[key]).catch(() => {}); }
  const map = cvReliefMap(key, 'z'), b = cvNow().board, real = map.w <= b.l && map.h <= b.w && map.w >= 5 ? map.w : 0;   // a model drawn in mm at a size that fits keeps it
  return cvAdd({ type: 'relief', art: key, up: 'z', w: real || Math.min(b.l * .7, b.w * .7 * map.w / map.h) });
}
// everything the import button can bring in
async function cvImportFile(f) {
  const name = f.name.toLowerCase();
  if (/\.stl$/.test(name)) return cvAddStl(f);
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
  const { it, li } = best, l0 = it.paths[li], l = l0.c ? { closed: l0.closed, pts: cvBezLine(l0) } : l0, place = cvPlaceFn(it), pts = l.pts.map(place); if (l.closed) pts.push(pts[0]);
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

// ---------- curves with handles ----------
// Each point of a drawn line can have handles that pull the line into a curve on either side (l.c, see cvBezLine).
// A smooth point's handles stay in line; dragging one swings the other round to match, unless Alt is held.
const cvHasHandle = h => !!h && (h[0] || h[1] || h[2] || h[3]);
function cvAutoHandle(l, i) {   // handles along the line through the points either side, a third of the way to each
  const p = l.pts, n = p.length, prev = l.closed ? p[(i + n - 1) % n] : p[Math.max(0, i - 1)], next = l.closed ? p[(i + 1) % n] : p[Math.min(n - 1, i + 1)], t = [(next[0] - prev[0]) / 6, (next[1] - prev[1]) / 6];
  return [-t[0], -t[1], t[0], t[1]];
}
const cvEnsureHandles = l => { if (!l.c) l.c = l.pts.map(() => null); return l.c; };
function cvFitCurves(it) { it.paths.forEach(l => { cvEnsureHandles(l); l.c = l.pts.map((q, i) => cvAutoHandle(l, i)); }); it.smooth = false; }
function cvTogglePoint(it, li, pi) { const l = it.paths[li], c = cvEnsureHandles(l); c[pi] = cvHasHandle(c[pi]) ? null : cvAutoHandle(l, pi); }

// rounds one corner with a true circular arc of radius r (two points with handles), or cuts it off at d along each side
function cvCornerAt(it, li, pi, r, chamfer) {
  const l = it.paths[li], p = l.pts, n = p.length; if (!l.closed && (pi === 0 || pi === n - 1)) { toast('An end of a line has no corner.', true); return false; }
  const P = p[pi], A = p[(pi + n - 1) % n], B = p[(pi + 1) % n], la = Math.hypot(A[0] - P[0], A[1] - P[1]), lb = Math.hypot(B[0] - P[0], B[1] - P[1]);
  const u = [(A[0] - P[0]) / la, (A[1] - P[1]) / la], v = [(B[0] - P[0]) / lb, (B[1] - P[1]) / lb], th = Math.acos(Math.max(-1, Math.min(1, u[0] * v[0] + u[1] * v[1])));
  if (!(th > .01 && th < Math.PI - .01)) { toast("That point is in a straight line, so there's no corner there.", true); return false; }
  let d = chamfer ? r : r / Math.tan(th / 2); const most = .95 * Math.min(la, lb); if (d > most) { d = most; if (!chamfer) r = d * Math.tan(th / 2); }
  const T1 = [P[0] + u[0] * d, P[1] + u[1] * d], T2 = [P[0] + v[0] * d, P[1] + v[1] * d], c = cvEnsureHandles(l);
  let h1 = null, h2 = null;
  if (!chamfer) { const h = 4 / 3 * Math.tan((Math.PI - th) / 4) * r; h1 = [0, 0, -u[0] * h, -u[1] * h]; h2 = [-v[0] * h, -v[1] * h, 0, 0]; }
  p.splice(pi, 1, T1, T2); c.splice(pi, 1, h1, h2); return true;
}

// ---------- the arc tool ----------
// Click the two ends, then a point the arc passes through.
function cvArcThrough(A, B, M) {   // the circle through three points, and the way round from A to B that passes M
  const d = 2 * (A[0] * (B[1] - M[1]) + B[0] * (M[1] - A[1]) + M[0] * (A[1] - B[1])); if (Math.abs(d) < 1e-9) return null;
  const a2 = A[0] ** 2 + A[1] ** 2, b2 = B[0] ** 2 + B[1] ** 2, m2 = M[0] ** 2 + M[1] ** 2, c = [(a2 * (B[1] - M[1]) + b2 * (M[1] - A[1]) + m2 * (A[1] - B[1])) / d, (a2 * (M[0] - B[0]) + b2 * (A[0] - M[0]) + m2 * (B[0] - A[0])) / d], r = Math.hypot(A[0] - c[0], A[1] - c[1]);
  const ang = q => Math.atan2(q[1] - c[1], q[0] - c[0]), a0 = ang(A), am = ang(M), ab = ang(B), ccw = x => ((x % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const sweep = ccw(am - a0) < ccw(ab - a0) ? ccw(ab - a0) : -ccw(a0 - ab);
  return { c, r, a0, sweep };
}
function cvArcLine(A, B, M) {   // the arc as a line of points with handles, a quarter turn at most between points
  const g = cvArcThrough(A, B, M); if (!g || g.r > 1e5) return null;
  const k = Math.max(1, Math.ceil(Math.abs(g.sweep) / (Math.PI / 2))), step = g.sweep / k, h = 4 / 3 * Math.tan(Math.abs(step) / 4) * g.r * Math.sign(step), pts = [], c = [];
  for (let i = 0; i <= k; i++) { const t = g.a0 + step * i, q = i === 0 ? A.slice() : i === k ? B.slice() : [g.c[0] + g.r * Math.cos(t), g.c[1] + g.r * Math.sin(t)], tx = -Math.sin(t) * h, ty = Math.cos(t) * h; pts.push(q); c.push([i ? -tx : 0, i ? -ty : 0, i < k ? tx : 0, i < k ? ty : 0]); }
  return { closed: false, pts, c };
}

// ---------- extending ----------
// Click near the end of a drawn line and it carries straight on until it meets another line.
function cvExtendAt(p) {
  let best = null, d = 8 * cvView.k;
  P.carve.items.forEach(it => { if (it.type !== 'path') return; const place = cvPlaceFn(it); it.paths.forEach((l, li) => { if (l.closed || l.pts.length < 2) return; [0, l.pts.length - 1].forEach(end => { const q = place(l.pts[end]), v = Math.hypot(q[0] - p[0], q[1] - p[1]); if (v < d) { d = v; best = { it, li, end }; } }); }); });
  if (!best) { toast('Click near the end of a drawn line to extend it.', true); return false; }
  const { it, li, end } = best, l = it.paths[li], place = cvPlaceFn(it), n = l.pts.length, E = place(l.pts[end]), h = l.c && l.c[end];
  const back = end ? (h && (h[0] || h[1]) ? place([l.pts[end][0] + h[0], l.pts[end][1] + h[1]]) : place(l.pts[n - 2])) : (h && (h[2] || h[3]) ? place([l.pts[0][0] + h[2], l.pts[0][1] + h[3]]) : place(l.pts[1]));
  const dir = [E[0] - back[0], E[1] - back[1]], len = Math.hypot(dir[0], dir[1]); if (!len) return false; const far = [E[0] + dir[0] / len * 1e5, E[1] + dir[1] / len * 1e5];
  let hit = null, at = Infinity;
  P.carve.items.forEach(o => { if (cvNeverCut(o)) return; cvWorldShape(o).lines.forEach((ol, k) => { const q = ol.pts.slice(); if (ol.closed) q.push(q[0]); for (let i = 0; i + 1 < q.length; i++) { if (o === it && k === li && ((end && i >= q.length - 3) || (!end && i <= 1))) continue; const t = cvSegHit(E, far, q[i], q[i + 1]); if (t !== null && t * 1e5 > 1e-4 && t < at) { at = t; hit = [E[0] + (far[0] - E[0]) * t, E[1] + (far[1] - E[1]) * t]; } } }); });
  if (!hit) { toast("Carried straight on, that line doesn't meet anything.", true); return false; }
  cvEdit(() => { const q = cvToLocal(it, hit); if (end) { l.pts.push(q); if (l.c) l.c.push(null); } else { l.pts.unshift(q); if (l.c) l.c.unshift(null); } cvRecentre(it); });
  return true;
}

// ---------- joining open lines ----------
// The nearest ends are joined, pair by pair, until no open lines are left to join; a line whose ends then meet is closed.
function cvJoinLines(list) {
  const items = list.filter(i => i.type === 'path'), lines = items.flatMap(i => cvWorldShape(i).lines.map(l => ({ closed: l.closed, pts: l.pts.map(q => q.slice()) })));
  let open = lines.filter(l => !l.closed); const shut = lines.filter(l => l.closed);
  if (open.length < 2 && !(open.length === 1 && Math.hypot(open[0].pts[0][0] - open[0].pts[open[0].pts.length - 1][0], open[0].pts[0][1] - open[0].pts[open[0].pts.length - 1][1]) < .01)) { toast('Joining needs two open drawn lines or more.', true); return null; }
  while (open.length > 1) {
    let best = null;
    for (let a = 0; a < open.length; a++) for (let b = a + 1; b < open.length; b++) for (const ea of [0, 1]) for (const eb of [0, 1]) {
      const A = open[a].pts, B = open[b].pts, pa = ea ? A[A.length - 1] : A[0], pb = eb ? B[B.length - 1] : B[0], d = Math.hypot(pa[0] - pb[0], pa[1] - pb[1]);
      if (!best || d < best.d) best = { a, b, ea, eb, d };
    }
    const A = best.ea ? open[best.a].pts : open[best.a].pts.slice().reverse(), B = best.eb ? open[best.b].pts.slice().reverse() : open[best.b].pts;
    const joined = best.d < .001 ? A.concat(B.slice(1)) : A.concat(B);
    open = open.filter((l, i) => i !== best.a && i !== best.b).concat([{ closed: false, pts: joined }]);
  }
  const out = shut.concat(open.map(l => { const q = l.pts, gap = Math.hypot(q[0][0] - q[q.length - 1][0], q[0][1] - q[q.length - 1][1]); return gap < .01 && q.length > 3 ? { closed: true, pts: q.slice(0, -1) } : l; }));
  const op = items[0].op; cvEdit(() => { P.carve.items = P.carve.items.filter(i => !items.includes(i)); });
  return cvMakePath(out, op);
}

// ---------- groups ----------
// Items in a group are picked, moved and copied together, until they're ungrouped.
const cvGroupOf = it => (it && it.gid ? P.carve.items.filter(o => o.gid === it.gid) : it ? [it] : []);
function cvGroup(list) { const cv = cvNow(), gid = (cv.nextGid = (cv.nextGid || 0) + 1); cvEdit(() => list.forEach(i => { i.gid = gid; })); }
function cvUngroup(list) { cvEdit(() => list.forEach(i => { delete i.gid; })); }

// ---------- copies along a line ----------
// The other item picked is copied at even spaces along a drawn line, from end to end (or all the way round a closed one),
// and can turn to follow it.
function cvCopyAlong(list) {
  const path = list.find(i => i.type === 'path' && cvLocal(i).lines.length), item = list.find(i => i !== path);
  if (!path || !item || list.length !== 2) { toast('Pick one drawn line and one item to copy along it.', true); return; }
  const l = cvWorldShape(path).lines[0], pts = l.closed ? l.pts.concat([l.pts[0]]) : l.pts, cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const L = cum[cum.length - 1], n = Math.max(2, cvToolNum('along', 5)), turn = cvToolNums.alongTurn !== false, cv = cvNow(), made = [];
  const at = s => { let i = 1; while (i < cum.length - 1 && cum[i] < s) i++; const a = pts[i - 1], b = pts[i], t = (s - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1); return { p: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], deg: Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI }; };
  const base = at(0).deg, rot0 = item.rot || 0;
  cvEdit(() => {
    for (let k = 0; k < n; k++) {
      const q = at(l.closed ? L * k / n : L * k / (n - 1)), c = k ? cvClone(item) : item;
      if (k) { c.id = cv.nextId++; delete c.gid; cv.items.push(c); made.push(c); }
      c.x = q.p[0]; c.y = q.p[1]; if (turn) c.rot = (((rot0 + q.deg - base) % 360) + 360) % 360;
    }
  });
  cvPickList([item, ...made]); carveRender();
}

// ---------- saving the shapes ----------
// Everything on the board that's cut or drawn, as outlines in mm: an SVG for drawing programs, a DXF for CAD.
function cvShapeLines(list) { return list.filter(i => !cvNeverCut(i)).flatMap(i => cvWorldShape(i).lines).filter(l => l.pts.length > 1); }
function cvShapesSvg(cv) {
  const { l: L, w: W } = cv.board, f = v => Math.round(v * 1000) / 1000;
  const d = cvShapeLines(cv.items).map(l => `<path d="M${l.pts.map(q => `${f(q[0])} ${f(W - q[1])}`).join(' L')}${l.closed ? ' Z' : ''}"/>`).join('\n  ');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${f(L)}mm" height="${f(W)}mm" viewBox="0 0 ${f(L)} ${f(W)}">\n <g fill="none" stroke="#000" stroke-width="0.2">\n  ${d}\n </g>\n</svg>\n`;
}
function cvShapesDxf(cv) {
  const out = ['0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', '4', '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES'], f = v => String(Math.round(v * 1000) / 1000);
  cvShapeLines(cv.items).forEach(l => { out.push('0', 'POLYLINE', '8', '0', '66', '1', '70', l.closed ? '1' : '0'); l.pts.forEach(q => out.push('0', 'VERTEX', '8', '0', '10', f(q[0]), '20', f(q[1]))); out.push('0', 'SEQEND', '8', '0'); });
  out.push('0', 'ENDSEC', '0', 'EOF');
  return out.join('\r\n') + '\r\n';
}
function cvSaveShapes(kind) {
  const cv = cvNow(); if (!cvShapeLines(cv.items).length) { toast('There are no shapes to save yet.', true); return; }
  if (kind === 'svg') downloadBlob(`${P.name} shapes.svg`, cvShapesSvg(cv), 'image/svg+xml'); else downloadBlob(`${P.name} shapes.dxf`, cvShapesDxf(cv), 'application/dxf');
  toast(`Shapes saved as ${kind.toUpperCase()}, in mm, as they sit on the board.`);
}

// ---------- quick shapes ----------
// A triangle, a right-angled triangle and a half circle. The triangle is a three-sided polygon; the other two are drawn shapes,
// so their points can be edited straight away. The half circle's curve is two true quarter circles.
function cvAddQuick(kind) {
  const b = cvNow().board, d = Math.min(b.l, b.w) * .5, cx = b.l / 2, cy = b.w / 2, r = d / 2, k = r * .5523;
  if (kind === 'tri') return cvAdd({ type: 'polygon', w: d, h: d * Math.sqrt(3) / 2, sides: 3 });
  if (kind === 'rtri') return cvMakePath([{ closed: true, pts: [[cx - r, cy - r], [cx + r, cy - r], [cx - r, cy + r]] }], null);
  return cvMakePath([{ closed: true, pts: [[cx + r, cy], [cx, cy + r], [cx - r, cy]], c: [[0, 0, 0, k], [k, 0, -k, 0], [0, k, 0, 0]] }], null);
}

// ---------- freehand and the eraser ----------
// Freehand follows the mouse while it's held down, then keeps only the points it needs and draws a smooth curve through them.
// The eraser rubs out the parts of drawn lines it's dragged over. Both stay on for the next stroke, until Esc.
function cvSimplifyOpen(pts, tol) {   // Douglas-Peucker on an open line
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length), stack = [[0, pts.length - 1]]; keep[0] = keep[pts.length - 1] = 1;
  while (stack.length) {
    const [a, b] = stack.pop(), A = pts[a], B = pts[b], dx = B[0] - A[0], dy = B[1] - A[1], L = Math.hypot(dx, dy); let m = -1, md = tol;
    for (let i = a + 1; i < b; i++) { const v = L > 1e-9 ? Math.abs((pts[i][0] - A[0]) * dy - (pts[i][1] - A[1]) * dx) / L : Math.hypot(pts[i][0] - A[0], pts[i][1] - A[1]); if (v > md) { md = v; m = i; } }
    if (m >= 0) { keep[m] = 1; stack.push([a, m], [m, b]); }
  }
  return pts.filter((q, i) => keep[i]);
}
function cvFreeDown(e, p) {
  cvEl('cvStage').setPointerCapture(e.pointerId);
  if (cvTool.kind === 'free') {
    const pts = [p]; cvTool.pts = pts;
    cvDrag = { onMove: (ev, q) => { const last = pts[pts.length - 1]; if (Math.hypot(q[0] - last[0], q[1] - last[1]) > 1.5 * cvView.k) { pts.push(q); cvToolDraw(null); } }, onUp: () => { cvTool.pts = []; cvToolDraw(null); cvFreeFinish(pts); } };
    return;
  }
  pushUndo(); let any = false;
  const rub = q => { if (cvEraseAt(q, cvToolNum('er', 3) / 2)) { any = true; cvStageRender(); } cvEraseCursor(q); };
  rub(p); cvDrag = { onMove: (ev, q) => rub(q), onUp: () => { if (any) persist(); else undoS.pop(); carveRender(); } };
}
function cvFreeFinish(pts) {
  if (pts.length < 3) return null; const k = cvView.k, first = pts[0], last = pts[pts.length - 1], closed = pts.length > 5 && Math.hypot(last[0] - first[0], last[1] - first[1]) < 10 * k;
  let line = cvSimplifyOpen(pts, Math.max(.05, 1.2 * k)); if (closed) line = line.slice(0, -1);
  if (line.length < 2 || (closed && line.length < 3)) return null;
  const it = cvMakePath([{ pts: line, closed }], null, { smooth: true }); cvPickOnly(null); carveRender(); return it;
}
function cvEraseCursor(p) { const g = cvEl('cvPen'); if (!g || !p) return; g.innerHTML = `<circle cx="${r2(p[0])}" cy="${r2(P.carve.board.w - p[1])}" r="${cvToolNum('er', 3) / 2}" fill="#fff" fill-opacity=".35" stroke="#20262a" stroke-width="${cvView.k}"/>`; }
// rubs out everything of drawn lines within r of p. Returns whether anything changed.
function cvEraseAt(p, r) {
  const cv = P.carve; let changed = false;
  cv.items.slice().forEach(it => {
    if (it.type !== 'path' || it.locked) return; const box = cvWorldBox(it); if (p[0] < box.x0 - r || p[0] > box.x1 + r || p[1] < box.y0 - r || p[1] > box.y1 + r) return;
    const q = cvToLocal(it, p), out = []; let hit = false;
    it.paths.forEach(l => {
      const pts = l.c ? cvBezLine(l) : it.smooth ? cvSmoothLine(l.pts, l.closed) : l.pts, ring = l.closed ? pts.concat([pts[0]]) : pts, fine = [ring[0]];
      for (let i = 1; i < ring.length; i++) { const a = ring[i - 1], b = ring[i], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (r / 3))); for (let s = 1; s <= n; s++) fine.push([a[0] + (b[0] - a[0]) * s / n, a[1] + (b[1] - a[1]) * s / n]); }
      const gone = fine.map(a => Math.hypot(a[0] - q[0], a[1] - q[1]) < r);
      if (!gone.some(Boolean)) { out.push(l); return; }   // a line not touched keeps its curves
      hit = true; const runs = []; let cur = [];
      fine.forEach((a, i) => { if (gone[i]) { if (cur.length) runs.push(cur); cur = []; } else cur.push(a); }); if (cur.length) runs.push(cur);
      if (l.closed && runs.length > 1 && !gone[0] && !gone[fine.length - 1]) { const end = runs.pop(); runs[0] = end.concat(runs[0].slice(1)); }   // a closed line opens where it was rubbed
      runs.filter(rn => rn.length > 1).forEach(rn => out.push({ closed: false, pts: cvSimplifyOpen(rn, .01) }));
    });
    if (!hit) return; changed = true;
    if (!out.length) cv.items = cv.items.filter(i => i !== it);
    else { if (it.smooth) { it.paths = out.map(l => (it.paths.includes(l) ? { closed: l.closed, pts: cvSmoothLine(l.pts, l.closed) } : l)); delete it.smooth; } else it.paths = out; }   // what's left keeps its shape exactly
  });
  if (changed && cvSel !== null && !cv.items.some(i => i.id === cvSel)) cvPickOnly(null);
  return changed;
}
cvEl('cvAddTri').onclick = () => cvAddQuick('tri');
cvEl('cvAddRightTri').onclick = () => cvAddQuick('rtri');
cvEl('cvAddHalf').onclick = () => cvAddQuick('half');
cvEl('cvFree').onclick = () => cvToolStart('free');
cvEl('cvErase').onclick = () => cvToolStart('erase');

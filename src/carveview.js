// ---------- carving: the right-click menu and what's shown ----------
// Right-click an item for what can be done to it, or the board for the rest. What's shown is kept per user: the shapes as
// outlines only, the bit's paths, what the bits can't reach, and in 3D the board itself and the wasteboard under it.

// the menu is the design's own (#ctx), whose script comes after this one
const cvCtx = document.getElementById('ctx'), cvCtxClose = () => { cvCtx.hidden = true; };

// ---------- copy and paste ----------
let cvClipboard = null;
function cvCopyPicked(cut) {
  const list = cvPicked(); if (!list.length) return;
  cvClipboard = list.map(i => JSON.parse(JSON.stringify(i)));
  if (cut) cvRemove(); else toast(list.length === 1 ? `Copied ${cvItemName(list[0])}` : `Copied ${list.length} items`);
}
function cvPaste() {   // each paste lands a little further along, so copies don't stack up on each other
  if (!cvClipboard) return; const cv = cvNow(), gids = {};
  cvClipboard.forEach(o => { o.x += 10; o.y -= 10; });
  const made = cvClipboard.map(o => { const c = cvClone(o); c.id = cv.nextId++; if (c.gid) c.gid = gids[c.gid] || (gids[c.gid] = (cv.nextGid = (cv.nextGid || 0) + 1)); return c; });
  cvEdit(() => { cv.items.push(...made); }); cvPickList(made); carveRender();
}

// ---------- acting on what's picked ----------
function cvOrder(list, front) { const cv = cvNow(), rest = cv.items.filter(i => !list.includes(i)); cvEdit(() => { cv.items = front ? rest.concat(list) : list.concat(rest); }); }
function cvScaleItem(it, f) {
  if (it.type === 'text') { it.size *= f; it.spacing = (it.spacing || 0) * f; }
  else if (it.type === 'path') cvScalePath(it, f);
  else if (it.type === 'dim') { it.len *= f; it.off = (it.off || 0) * f; }
  else if (it.type === 'svg' || it.type === 'trace' || it.type === 'relief') it.w *= f;
  else { it.w *= f; it.h *= f; }
}
const cvBoxOf = list => cvBox(list.map(i => { const b = cvWorldBox(i); return [[b.x0, b.y0], [b.x1, b.y1]]; }));
function cvFitBoard(list) {   // as big as fits on the board with a small margin, in the middle
  const b = cvNow().board, box = cvBoxOf(list), m = Math.min(b.l, b.w) * .05, f = Math.min((b.l - 2 * m) / (box.x1 - box.x0), (b.w - 2 * m) / (box.y1 - box.y0)); if (!(f > 0 && isFinite(f))) return;
  const cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2;
  cvEdit(() => list.forEach(i => { cvScaleItem(i, f); i.x = b.l / 2 + (i.x - cx) * f; i.y = b.w / 2 + (i.y - cy) * f; }));
}
function cvFillBoard(it) {   // as many copies as fit, in rows and columns the gap apart, the whole lot in the middle
  const cv = cvNow(), b = cv.board, box = cvWorldBox(it), w = box.x1 - box.x0, h = box.y1 - box.y0, g = cvToolNum('gap', 5);
  const cols = Math.floor((b.l - g + 1e-9) / (w + g)), rows = Math.floor((b.w - g + 1e-9) / (h + g));
  if (cols * rows < 2) { toast(cols * rows ? 'Only one fits on the board.' : "It doesn't fit on the board.", true); return; }
  const x0 = (b.l - (cols * w + (cols - 1) * g)) / 2, y0 = (b.w - (rows * h + (rows - 1) * g)) / 2, made = [], ox = it.x, oy = it.y;
  cvEdit(() => {
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {   // the original takes the first place
      const c = i || j ? cvClone(it) : it; if (c !== it) { c.id = cv.nextId++; cv.items.push(c); made.push(c); }
      c.x = ox + x0 + i * (w + g) - box.x0; c.y = oy + y0 + j * (h + g) - box.y0;
    }
  });
  cvPickList([it, ...made]); carveRender();
}
// Each separate piece of a shape becomes its own shape, with the same job: the letters of a word, the parts of a drawing.
function cvBreakApart(list) {
  const cv = cvNow(), made = [], gone = [];
  list.forEach(it => {
    if (cvNeverCut(it) || it.type === 'relief') return;
    const ws = cvWorldShape(it), pieces = cvIslands(ws.regions).map(cvAsLines).concat(ws.lines.filter(l => !l.closed).map(l => [l]));
    if (pieces.length < 2) return; gone.push(it);
    pieces.forEach(lines => { const b = cvBox(lines.map(l => l.pts)), cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2; made.push({ id: 0, type: 'path', x: cx, y: cy, rot: 0, paths: lines.map(l => cvMapLine(l, q => [q[0] - cx, q[1] - cy])), op: JSON.parse(JSON.stringify(it.op || { kind: 'off' })) }); });
  });
  if (!gone.length) { toast("It's all one piece, so there's nothing to break apart.", true); return; }
  cvEdit(() => { cv.items = cv.items.filter(i => !gone.includes(i)); made.forEach(m => { m.id = cv.nextId++; cv.items.push(m); }); });
  cvPickList(made); carveRender(); toast(`Broken into ${made.length} pieces.`);
}
function cvSameDepth(it) {
  const cv = cvNow(), d = cvOpDepth(cv, it.op), list = cv.items.filter(o => o.op && o.op.kind !== 'off' && !cvNeverCut(o) && Math.abs(cvOpDepth(cv, o.op) - d) < 1e-6);
  cvPickList(list); carveRender(); toast(`${list.length} ${list.length === 1 ? 'item cuts' : 'items cut'} ${cvLen(d)} deep.`);
}

// ---------- the menu ----------
function cvMenuOpen(x, y) {
  const list = cvPicked(), it = cvItem(), one = list.length === 1 && it, row = (act, label, icon, key, off) => `<button data-cvx="${act}" role="menuitem"${off ? ' disabled' : ''}>${ic(icon)}${label}${key ? `<kbd>${key}</kbd>` : ''}</button>`;
  let h = '';
  if (list.length) {
    const closed = one && cvLocal(it).regions.length && !cvNeverCut(it) && it.type !== 'relief', grouped = list.some(i => i.gid), cuts = one && it.op && it.op.kind !== 'off' && !cvNeverCut(it);
    h += row('cut', 'Cut', 'scissors', 'Ctrl+X') + row('copy', 'Copy', 'clipboard-copy', 'Ctrl+C') + (cvClipboard ? row('paste', 'Paste', 'clipboard-paste', 'Ctrl+V') : '') + row('dup', 'Duplicate', 'copy', 'Ctrl+D') + row('del', 'Delete', 'trash-2', 'Del')
      + '<hr>' + row('t-mx', 'Mirror, left to right', 'flip-horizontal-2') + row('t-my', 'Mirror, front to back', 'cv-flip-v') + row('front', 'Bring to the front', 'cv-front') + row('back', 'Send to the back', 'cv-back')
      + '<hr>' + (closed ? row('t-out', `Outline, ${cvLen(cvToolNum('off', 3))} outside`, 'cv-offset') + row('t-in', `Outline, ${cvLen(cvToolNum('off', 3))} inside`, 'cv-inset') : '') + row('split', 'Break apart', 'cv-split') + (list.length > 1 ? row('group', 'Group', 'group', 'Ctrl+G') : '') + (grouped ? row('ungroup', 'Ungroup', 'group', 'Ctrl+Shift+G') : '')
      + (one && it.type !== 'relief' && !cvNeverCut(it) ? row('t-nodes', 'Edit its points', 'pen-tool') : '')
      + '<hr>' + row('m-centre', 'Centre on the board', 'align-center-vertical') + row('fitb', 'Fit to the board', 'cv-fit') + (one ? row('fill', 'Fill the board with copies', 'cv-fill') : '') + (cuts ? row('depth', 'Pick all at this depth', 'cv-view') : '');
  } else h += (cvClipboard ? row('paste', 'Paste', 'clipboard-paste', 'Ctrl+V') : '') + row('all', 'Pick everything', 'square-mouse-pointer', 'Ctrl+A') + row('fit', 'Fit the board', 'scan', 'F') + '<hr>' + cvViewRows();
  cvCtx.innerHTML = h.replace(/^<hr>|<hr>(?=<hr>)|<hr>$/g, ''); cvCtx.hidden = false;
  const r = cvCtx.getBoundingClientRect(); cvCtx.style.left = Math.min(x, innerWidth - r.width - 4) + 'px'; cvCtx.style.top = Math.max(4, Math.min(y, innerHeight - r.height - 4)) + 'px';
}
function cvMenuDo(a) {
  const list = cvPicked(), it = cvItem();
  if (a === 'cut' || a === 'copy') { cvCopyPicked(a === 'cut'); return; }
  if (a === 'paste') { cvPaste(); return; }
  if (a === 'dup') { cvCopy(); return; }
  if (a === 'del') { cvRemove(); return; }
  if (a === 'all') { cvPickList(P.carve.items.slice()); carveRender(); return; }
  if (a === 'fit') { if (CV3D.on) cv3dAim(); else { cvView = null; cvStageRender(); } return; }
  if (a === 'front' || a === 'back') { cvOrder(list, a === 'front'); return; }
  if (a === 'split') { cvBreakApart(list); return; }
  if (a === 'group') { cvGroup(list); return; }
  if (a === 'ungroup') { cvUngroup(list); return; }
  if (a === 'fitb') { cvFitBoard(list); return; }
  if (a === 'fill') { if (it) cvFillBoard(it); return; }
  if (a === 'depth') { if (it) cvSameDepth(it); return; }
  if (a.startsWith('view:')) { cvViewToggle(a.slice(5)); return; }
  cvToolAction(a); carveRender();
}
cvEl('cvStage').addEventListener('contextmenu', e => {
  if (typeof rdown !== 'undefined' && rdown && Math.hypot(e.clientX - rdown[0], e.clientY - rdown[1]) > 4) return;   // that was a right-drag to slide the board
  if (cvTool || (cvDrag && !cvDrag.pan)) return;
  const g = e.target.closest && e.target.closest('.cvitem'), id = g ? +g.dataset.it : null;
  if (id !== null) { if (!cvPicked().some(i => i.id === id)) cvPickOnly(id); } else cvPickOnly(null);
  carveRender(); cvMenuOpen(e.clientX, e.clientY);
});
cvCtx.addEventListener('click', e => { const b = e.target.closest('[data-cvx]'); if (!b) return; cvCtxClose(); cvMenuDo(b.dataset.cvx); });

// ---------- what's shown ----------
const CV_VIEW_STORE = 'atelier-carve-view';
try { Object.assign(cvViewOpts, JSON.parse(localStorage.getItem(CV_VIEW_STORE)) || {}); } catch (e) {}
const CV_VIEWS = [['paths', "The bit's paths"], ['uncut', 'Uncut areas'], ['wire', 'Shapes as outlines only'], ['material', 'The board, in 3D'], ['waste', 'The wasteboard, in 3D']];
const cvViewOn = k => (k === 'paths' ? cvShowPaths : !!cvViewOpts[k]);
const cvViewRows = () => CV_VIEWS.map(([k, label]) => `<button data-cvx="view:${k}" role="menuitemcheckbox" aria-checked="${cvViewOn(k)}">${cvViewOn(k) ? ic('cv-check') : ic('cv-none')}${label}</button>`).join('');
window.LUCIDE['cv-none'] = '';
function cvViewToggle(k) {
  if (k === 'paths') cvShowPaths = !cvShowPaths; else { cvViewOpts[k] = !cvViewOpts[k]; try { localStorage.setItem(CV_VIEW_STORE, JSON.stringify(cvViewOpts)); } catch (e) {} }
  carveRender(); cv3dExtras();
}
cvEl('cvViewBtn').onclick = e => { const r = e.currentTarget.getBoundingClientRect(); cvCtx.innerHTML = cvViewRows(); cvCtx.hidden = false; cvCtx.style.left = r.right + 6 + 'px'; const h = cvCtx.getBoundingClientRect().height; cvCtx.style.top = Math.max(4, Math.min(r.top, innerHeight - h - 4)) + 'px'; e.stopPropagation(); };

// ---------- uncut areas ----------
// What a job means to cut but its bits can't reach: the corners and narrow parts of a pocket, and the notches a cut-out leaves
// filled in. Shown in red over the board.
function cvUncutOf(cv, it) {
  const op = it.op; if (!op || !['pocket', 'outside', 'inside'].includes(op.kind) || cvNeverCut(it)) return [];
  const main = cvBitOf(op.bit); if (!main || !cvBitFits(op.kind, main)) return [];
  const second = cvClearBit(it, cvBitOf), key = JSON.stringify([cvShapeKey(it), it.x, it.y, it.rot, it.mx, it.my, op.kind, main.d, second && second.d]);
  if (!it._u) Object.defineProperty(it, '_u', { value: null, writable: true, enumerable: false });
  if (it._u && it._u.key === key) return it._u.left;
  const regions = cvWorldShape(it).regions, R = main.d / 2; let left = [];
  if (regions.length && op.kind === 'pocket') cvIslands(regions).forEach(island => {
    const opened = cvOffset(cvOffset(island, -R), R); let reached = opened;
    if (second) { const r = second.d / 2, rest = cvRest(island, opened); if (rest.length) { const zone = cvClip(ClipperLib.ClipType.ctIntersection, cvOffset(rest, second.d), island); reached = cvUnion(opened.concat(cvOffset(cvOffset(zone, -r), r))); } }
    left.push(...cvRest(island, reached));
  });
  else if (regions.length) { const base = cvUnion(regions); left = op.kind === 'outside' ? cvRest(cvOffset(cvOffset(base, R), -R), base) : cvRest(base, cvOffset(cvOffset(base, -R), R)); }
  it._u = { key, left }; return left;
}
function cvUncutSvg(cv) {
  if (!cvViewOpts.uncut) return ''; const W = cv.board.w, px = cvView ? cvView.k : 1;
  const d = cv.items.flatMap(it => cvUncutOf(cv, it)).map(p => `M${p.map(q => `${r2(q[0])} ${r2(W - q[1])}`).join('L')}Z`).join('');
  return d ? `<path id="cvUncut" d="${d}" fill="#d63a2f" fill-opacity=".8" stroke="#d63a2f" stroke-width="${px}" stroke-linejoin="round" pointer-events="none"/>` : '';
}

// ---------- in 3D: the wasteboard, and the bit's paths ----------
function cv3dExtras() {
  if (!CV3D.scene) return;
  if (CV3D.extras) { CV3D.scene.remove(CV3D.extras); CV3D.extras.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) [].concat(o.material).forEach(m => m.dispose()); }); CV3D.extras = null; }
  if (CV3D.mesh) CV3D.mesh.visible = cvViewOpts.material !== false;
  if (!CV3D.on) return;
  const cv = cvNow(), { l, w, t } = cv.board, g = new THREE.Group();
  if (cvViewOpts.waste) {
    const m = 25, th = 8, shade = [.78, .78, .86, .7, 1, .55].map(k => new THREE.MeshBasicMaterial({ color: new THREE.Color(.62 * k, .55 * k, .45 * k) })), box = new THREE.Mesh(new THREE.BoxGeometry(l + m * 2, w + m * 2, th), shade);
    box.position.set(l / 2, w / 2, -t - th / 2 - .02); g.add(box);
  }
  const steps = CV3D.play && CV3D.play.steps, lines = (list, color, opacity) => {
    if (!list.length) return; const pos = new Float32Array(list.length * 6); list.forEach((s, i) => { pos.set([s.a[0], s.a[1], s.a[2] + .03, s.b[0], s.b[1], s.b[2] + .03], i * 6); });
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity })));
  };
  if (steps && steps.length && (CV3D.gcode || cvShowPaths || cvViewOpts.material === false)) {   // a G-code file always shows its moves: cuts in teal, rapids faint
    lines(steps.filter(s => !s.rapid), 0x0f7d8c, .8);
    if (CV3D.gcode) lines(steps.filter(s => s.rapid), isDark() ? 0xc8d0d3 : 0x5c686e, .35);
  }
  CV3D.extras = g; CV3D.scene.add(g); cv3dDraw();
}

// ---------- the rail's three groups ----------
// Shapes, Draw and Tools each open a list of what's in them, by name. Picking one closes it; so does clicking anywhere else.
Object.assign(window.LUCIDE, {
  'cv-shapes': '<rect x="3" y="11" width="9" height="9" /><circle cx="15.5" cy="8.5" r="5.5" />',
  'cv-tools': '<path d="M3 17 17 3l4 4L7 21Z" /><path d="m7 13 2 2M10 10l2 2M13 7l2 2" />',
  'cv-lay-board': '<rect x="3" y="5" width="18" height="14" rx="1" />',
  'cv-lay-split': '<rect x="3" y="5" width="18" height="14" rx="1" /><path d="M12 5v14" />',
  'cv-lay-3d': '<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9Z" /><path d="m4 7.5 8 4.5 8-4.5M12 12v9" />',
});
document.querySelectorAll('#cvLayout [data-lay]').forEach(b => addIcon(b, 'cv-lay-' + b.dataset.lay));
[['cvGrpShapes', 'cv-shapes'], ['cvGrpDraw', 'pen-tool'], ['cvGrpTools', 'cv-tools']].forEach(([id, name]) => addIcon(cvEl(id), name));
const CV_FLY_OF = { pen: 'draw', free: 'draw', arc: 'draw', erase: 'draw', trim: 'tools', extend: 'tools', dim: 'tools' };
const CV_TOOL_BTN = { pen: 'cvAddPen', free: 'cvFree', arc: 'cvAddArc', erase: 'cvErase', trim: 'cvTrim', extend: 'cvExtend', dim: 'cvDim' };
function cvFlyClose() { cvEl('cvFly').hidden = true; document.querySelectorAll('#cvRail [data-fly]').forEach(b => b.setAttribute('aria-expanded', 'false')); }
function cvFlyOpen(btn) {
  const fly = cvEl('cvFly'), group = btn.dataset.fly, was = !fly.hidden && btn.getAttribute('aria-expanded') === 'true'; cvFlyClose(); if (was) return;
  fly.querySelectorAll('.flyGroup').forEach(g => { g.hidden = g.dataset.group !== group; });
  fly.hidden = false; btn.setAttribute('aria-expanded', 'true');
  const top = btn.getBoundingClientRect().top - cvEl('carve').getBoundingClientRect().top, h = fly.offsetHeight, room = cvEl('carve').clientHeight;
  fly.style.top = Math.max(4, Math.min(top, room - h - 4)) + 'px';
  const first = fly.querySelector('.flyGroup:not([hidden]) .flyItem'); if (first) first.focus();
}
function cvRailMarks() {   // which group the tool in use belongs to
  const kind = cvTool && cvTool.kind;
  document.querySelectorAll('#cvRail [data-fly]').forEach(b => b.classList.toggle('on', !!kind && CV_FLY_OF[kind] === b.dataset.fly));
  document.querySelectorAll('#cvFly .flyItem').forEach(b => b.classList.toggle('on', !!kind && CV_TOOL_BTN[kind] === b.id));
}
document.querySelectorAll('#cvRail [data-fly]').forEach(b => { b.onclick = e => { e.stopPropagation(); cvFlyOpen(b); }; });
cvEl('cvFly').addEventListener('click', e => { if (e.target.closest('.flyItem')) cvFlyClose(); });
cvEl('cvFly').addEventListener('keydown', e => {
  const items = [...cvEl('cvFly').querySelectorAll('.flyGroup:not([hidden]) .flyItem')], i = items.indexOf(document.activeElement);
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].focus(); }
  if (e.key === 'Escape') { e.stopPropagation(); const open = document.querySelector('#cvRail [aria-expanded="true"]'); cvFlyClose(); if (open) open.focus(); }
});
window.addEventListener('pointerdown', e => { if (!e.target.closest('#cvFly, #cvRail [data-fly]')) cvFlyClose(); }, true);

// ---------- the board, the carving in 3D, or both side by side ----------
const CV_LAYOUT_STORE = 'atelier-carve-layout';
let cvLayout = 'split'; try { const v = localStorage.getItem(CV_LAYOUT_STORE); if (['board', 'split', '3d'].includes(v)) cvLayout = v; } catch (e) {}
function cvLayoutShow(mode) {   // how it looks now, without changing what's remembered
  const c = cvEl('carve'); ['board', 'split', '3d'].forEach(m => c.classList.toggle('lay-' + m, m === mode));
  document.querySelectorAll('#cvLayout [data-lay]').forEach(b => b.setAttribute('aria-pressed', b.dataset.lay === mode));
}
function cvLayoutSet(mode) {
  cvLayout = mode; try { localStorage.setItem(CV_LAYOUT_STORE, mode); } catch (e) {}
  cv3dShow(mode !== 'board'); cvView = null; cvStageRender();
}
cvEl('cvLayout').addEventListener('click', e => { const b = e.target.closest('[data-lay]'); if (b) cvLayoutSet(b.dataset.lay); });

// ---------- editing in the 3D view ----------
// The same picking, moving, scaling and turning as on the board, done on the board's top face as seen in 3D. A click picks
// (Shift adds), a drag on something moves it, the corner squares scale and the round handle turns, all through the board's
// own drag code. A drag on empty space still turns the view; right-click opens the same menu as on the board.
const cv3dRay = new THREE.Raycaster(), cv3dTop = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
function cv3dPt(e) {   // where the pointer meets the board's top, in board millimetres
  const el = CV3D.renderer.domElement, r = el.getBoundingClientRect();
  cv3dRay.setFromCamera(new THREE.Vector2((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1), CV3D.camera);
  const hit = cv3dRay.ray.intersectPlane(cv3dTop, new THREE.Vector3()); return hit ? [hit.x, hit.y] : null;
}
function cv3dK(p) {   // millimetres per screen pixel at a point on the board
  const cam = CV3D.camera, d = cam.position.distanceTo(new THREE.Vector3(p[0], p[1], 0)), h = CV3D.renderer.domElement.clientHeight || 1;
  return d * 2 * Math.tan(cam.fov * Math.PI / 360) / h;
}
// the item under a board point: of those whose outline box holds it, the smallest, so a small one on a big pocket can be had
function cv3dItemAt(p) {
  const tol = 4 * cv3dK(p); let best = null, area = Infinity;
  P.carve.items.forEach(it => { const b = cvWorldBox(it); if (p[0] < b.x0 - tol || p[0] > b.x1 + tol || p[1] < b.y0 - tol || p[1] > b.y1 + tol) return; const a = (b.x1 - b.x0 + tol) * (b.y1 - b.y0 + tol); if (a <= area) { area = a; best = it; } });
  return best;
}
const cv3dEditable = () => CV3D.on && !CV3D.gcode && !cvTool && !cvNodeItem();
function cv3dScreen(q) { const el = CV3D.renderer.domElement, v = new THREE.Vector3(q[0], q[1], 0).project(CV3D.camera); return v.z > 1 ? null : [(v.x + 1) / 2 * el.clientWidth, (1 - v.y) / 2 * el.clientHeight]; }
function cv3dOverlay() {
  const svg = cvEl('cv3dOver'); if (!svg) return;
  const list = CV3D.on && cv3dEditable() && P.carve ? cvPicked() : []; if (!list.length) { if (svg.innerHTML) svg.innerHTML = ''; return; }
  const P2 = (pts) => { const s = pts.map(cv3dScreen); return s.some(x => !x) ? null : s; }, path = s => `M${s.map(q => `${q[0].toFixed(1)} ${q[1].toFixed(1)}`).join('L')}Z`;
  let h = '';
  list.forEach(it => {
    const s = cvLocal(it), place = cvPlaceFn(it), k = cv3dK([it.x, it.y]), w = Math.max(s.w, 4) / 2 + 3 * k, ht = Math.max(s.h, 4) / 2 + 3 * k, ox = s.ox || 0, oy = s.oy || 0;
    const box = P2([[-w, -ht], [w, -ht], [w, ht], [-w, ht]].map(q => place([ox + q[0], oy + q[1]]))); if (!box) return;
    h += `<path d="${path(box)}" fill="none" stroke="#ffc928" stroke-width="1.5"/>`;
    if (list.length > 1) return;
    const stalk = P2([place([ox, oy + ht]), place([ox, oy + ht + 22 * k])]);
    if (stalk) h += `<line x1="${stalk[0][0]}" y1="${stalk[0][1]}" x2="${stalk[1][0]}" y2="${stalk[1][1]}" stroke="#ffc928" stroke-width="1.5"/><circle class="cv3h" data-h="r" cx="${stalk[1][0]}" cy="${stalk[1][1]}" r="6" fill="#fff" stroke="#e5a900" stroke-width="1.5"><title>Drag to turn. Shift keeps to 15° steps.</title></circle>`;
    if (it.type !== 'dim') box.forEach((q, i) => { h += `<rect class="cv3h" data-h="${'abcd'[i]}" x="${q[0] - 5}" y="${q[1] - 5}" width="10" height="10" fill="#fff" stroke="#e5a900" stroke-width="1.5"><title>Drag to scale</title></rect>`; });
  });
  if (svg.innerHTML !== h) svg.innerHTML = h;
}
function cv3dWire(el) {
  const box = cvEl('cv3d'); box.insertAdjacentHTML('beforeend', '<svg id="cv3dOver" aria-hidden="true"></svg>');
  const over = cvEl('cv3dOver'); let down = null;
  const start = (e, d) => { cvDrag = d; cvDrag.in3d = true; CV3D.controls.enabled = false; e.preventDefault(); e.stopImmediatePropagation(); };
  over.addEventListener('pointerdown', e => {   // a handle
    const hdl = e.target.closest('.cv3h'), it = cvItem(); if (!hdl || !it || e.button !== 0) return; const p = cv3dPt(e); if (!p) return;
    start(e, cvHandleDrag(hdl.dataset.h, it, p));
  });
  el.addEventListener('pointerdown', e => {   // before the view's own turning, so a drag on something moves it instead
    down = null; if (e.button !== 0 || e.ctrlKey || e.metaKey || !cv3dEditable()) return;
    const p = cv3dPt(e); if (!p) return; const it = cv3dItemAt(p);
    if (!it) { down = [e.clientX, e.clientY, e.shiftKey]; return; }
    if (cvItemDown(e, it.id, p)) start(e, cvDrag); else e.stopImmediatePropagation();
  }, true);
  window.addEventListener('pointermove', e => {
    if (!cvDrag || !cvDrag.in3d) return; const p = cv3dPt(e); if (!p) return;
    if (cvDragTo(e, p, cv3dK(p))) { cvStageRender(); cv3dSchedule(); }
  });
  window.addEventListener('pointerup', e => {
    if (cvDrag && cvDrag.in3d) { CV3D.controls.enabled = true; cvStageUp(); return; }
    if (down && Math.hypot(e.clientX - down[0], e.clientY - down[1]) < 4 && !down[2] && cvSel !== null) { cvPickOnly(null); carveRender(); }   // a click on empty space lets go
    down = null;
  });
  el.addEventListener('contextmenu', e => {
    if (typeof rdown !== 'undefined' && rdown && Math.hypot(e.clientX - rdown[0], e.clientY - rdown[1]) > 4) return;   // that was a right-drag to slide the view
    if (!cv3dEditable()) return; const p = cv3dPt(e), it = p ? cv3dItemAt(p) : null;
    if (it) { if (!cvPicked().some(i => i.id === it.id)) cvPickOnly(it.id); } else cvPickOnly(null);
    carveRender(); cvMenuOpen(e.clientX, e.clientY);
  });
}

// ---------- undo ----------
function pushUndo() { undoS.push(JSON.stringify(P)); if (undoS.length > 200) undoS.shift(); redoS.length = 0; }
function persist() { fxUpdate(); if (typeof hwSync === 'function') hwSync(); if (typeof machInvalidate === 'function') machInvalidate(); if (typeof autosave === 'function') autosave(); if (typeof markSaved === 'function') markSaved(true); }
function edit(fn) { pushUndo(); fn(); persist(); render(); }
function undo() { if (!undoS.length) return; redoS.push(JSON.stringify(P)); P = JSON.parse(undoS.pop()); after(); }
function redo() { if (!redoS.length) return; undoS.push(JSON.stringify(P)); P = JSON.parse(redoS.pop()); after(); }
function after() { sel = sel.filter(byId); persist(); render(); }

// ---------- units ----------
const inchText = mm => {
  const neg = mm < -.01, e = Math.round(Math.abs(mm) / 25.4 * 8), w = Math.floor(e / 8), f = e % 8;
  if (!f) return (neg ? '-' : '') + w + '"';
  let n = f, d = 8; while (n % 2 === 0) { n /= 2; d /= 2; }
  return (neg ? '-' : '') + (w ? w + ' ' : '') + n + '/' + d + '"';
};
const UNITS = {
  mm: { name: 'mm', mm: 1, dp: 1, mark: ' mm', ruler: [10, 50, 100, 200, 500, 1000, 2000, 5000] },
  cm: { name: 'cm', mm: 10, dp: 2, mark: ' cm', ruler: [1, 5, 10, 20, 50, 100, 200, 500] },
  m: { name: 'metres', mm: 1000, dp: 3, mark: ' m', ruler: [.05, .1, .2, .5, 1, 2, 5, 10] },
  in: { name: 'inches', mm: 25.4, mark: '"', ruler: [1, 2, 6, 12, 24, 48, 96] },
  ft: { name: 'feet and inches', mm: 304.8, mark: '', ruler: [1, 2, 5, 10, 20, 50] },
  yd: { name: 'yards', mm: 914.4, dp: 3, mark: ' yd', ruler: [1, 2, 5, 10, 20] },
};
const unitKey = () => (UNITS[P.unit] ? P.unit : P.in ? 'in' : 'mm'), unitOf = () => UNITS[unitKey()], unitMark = () => unitOf().mark;
const feetText = mm => {
  const neg = mm < -.01, e = Math.round(Math.abs(mm) / 25.4 * 8), ft = Math.floor(e / 96), rest = (e - ft * 96) / 8 * 25.4;
  if (!ft) return (neg ? '-' : '') + inchText(rest);
  return (neg ? '-' : '') + ft + "'" + (rest > .01 ? ' ' + inchText(rest) : '');
};
const bare = mm => {
  const k = unitKey(), u = UNITS[k];
  if (k === 'in') return inchText(mm).replace('"', '');
  if (k === 'ft') return feetText(mm);
  return String(Math.round(mm / u.mm * 10 ** u.dp) / 10 ** u.dp);
};
const fmt = mm => bare(mm) + unitMark();
const longLength = mm => {   // long runs, like edge banding, where fractions don't help
  const k = unitKey();
  if (k === 'in') return Math.ceil(mm / 25.4) + '"';
  if (k === 'ft') return Math.ceil(mm / 304.8) + "'";
  if (k === 'yd') return (mm / 914.4).toFixed(1) + ' yd';
  return (mm / 1000).toFixed(1) + ' m';
};
// Any box takes any unit: 120cm, 2 m, 3ft, 5' 3 1/2", 6". A plain number is in the current unit.
function parseLen(s) {
  s = String(s).trim().toLowerCase().replace(/”/g, '"').replace(/[’′]/g, "'");
  const num = t => { t = t.trim(); const m = /^(-)?(?:(\d+(?:\.\d+)?)[\s-]+)?(\d+)\s*\/\s*(\d+)$/.exec(t); return m && +m[4] ? ((+m[2] || 0) + m[3] / m[4]) * (m[1] ? -1 : 1) : parseFloat(t); };
  const f = /^(-?)\s*([\d.]+)\s*(?:'|ft|feet|foot)\s*(?:([\d.\/\s-]+?)\s*(?:"|in|inch|inches)?)?$/.exec(s);
  if (f) { const v = +f[2] * 304.8 + (f[3] ? num(f[3]) * 25.4 : 0); return f[1] ? -v : v; }
  const u = /^(.*?)\s*(mm|cm|m|inches|inch|in|"|yards|yard|yds|yd)$/.exec(s);
  if (u && u[1]) return num(u[1]) * ({ mm: 1, cm: 10, m: 1000, in: 25.4, inch: 25.4, inches: 25.4, '"': 25.4, yd: 914.4, yds: 914.4, yard: 914.4, yards: 914.4 })[u[2]];
  return num(s) * unitOf().mm;
}
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const r2 = v => Math.round(v * 100) / 100;

// ---------- snapping ----------
// Faces of other items and of the room win over the grid, so boards line up exactly.
function snapTargets(axis, ignore) {
  const out = [];
  shown().forEach(it => { if (ignore.has(it.id)) return; const b = bounds(it); out.push(b.min[axis], b.max[axis]); });
  return out;
}
function snapAxis(axis, min, max, ignore, thr, active) {
  if (!active) return { d: 0 };
  let best = null;
  const edges = [min, max];
  snapTargets(axis, ignore).forEach(t => edges.forEach(e => { const g = t - e; if (Math.abs(g) < thr && (!best || Math.abs(g) < Math.abs(best.d))) best = { d: g, at: t }; }));
  if (best) return best;
  const g = P.grid, a = Math.round(min / g) * g - min;
  return { d: a };
}

// While stretching: catches another object's face, or a size another object already has. Faces win a tie.
function stretchSnap(axis, size, side, fixed, mid, both, ignore, thr) {
  const faceOf = v => (both ? mid + side * v / 2 : fixed + side * v), face = faceOf(size);
  let best = null;
  snapTargets(axis, ignore).forEach(t => {
    const gap = Math.abs(t - face), v = both ? Math.abs(t - mid) * 2 : (t - fixed) * side;
    if (gap < thr && v > 0 && (!best || gap < best.gap)) best = { gap, size: v, at: t };
  });
  shown().forEach(it => {
    if (ignore.has(it.id) || isRoomPart(it)) return;
    (it.kind === 'panel' ? [it.l, it.w] : [it.l, it.t, it.w]).forEach(v => {
      const gap = Math.abs(faceOf(v) - face);
      if (gap < thr && (!best || gap < best.gap - .01)) best = { gap, size: v, at: faceOf(v), same: it };
    });
  });
  return best;
}
const sizeNote = hit => (hit && hit.same ? `, same as ${hit.same.name}` : '');

// ---------- selection and changes ----------
// a click picks one item; a double-click picks its whole group
function withGroups(ids) { const out = new Set(ids); shown().forEach(i => { if (i.group && !i.locked && ids.some(id => byId(id) && byId(id).group === i.group)) out.add(i.id); }); return [...out]; }
function pick(id, add, wholeGroup) {
  if (id) setTab('props');
  const ids = !id ? [] : wholeGroup ? withGroups([id]) : [id];
  if (add) sel = ids.every(i => sel.includes(i)) ? sel.filter(i => !ids.includes(i)) : [...new Set([...sel, ...ids])];
  else sel = ids;
}
function rotateSel(axisV, deg) {
  const list = movable(); if (!list.length) return;
  const u = unionBounds(list), c = V3((u.min[0] + u.max[0]) / 2, (u.min[1] + u.max[1]) / 2, (u.min[2] + u.max[2]) / 2);
  const r = new THREE.Quaternion().setFromAxisAngle(axisV, deg * Math.PI / 180);
  list.forEach(it => {
    const p = V3(...it.pos).sub(c).applyQuaternion(r).add(c); it.pos = [p.x, p.y, p.z];
    setQ(it, r.clone().multiply(Q(it)));
  });
}
// ---------- copy, repeat, align ----------
function copySel() { const l = selected(); if (l.length) { clip = JSON.parse(JSON.stringify(l)); toast(l.length === 1 ? `Copied ${l[0].name}` : `Copied ${l.length} items`); } }
function pasteClip() {
  if (!clip) return;
  edit(() => {
    const off = P.grid * Math.max(2, Math.round(50 / P.grid));
    const pairs = []; sel = clip.map(it => { const c = JSON.parse(JSON.stringify(it)); c.id = nextId(); c.pos[0] += off; c.pos[2] += off; delete c.locked; if (c.group && !P.groups.some(g => g.id === c.group)) delete c.group; P.items.push(c); pairs.push([it, c]); return c.id; }); fxDetachCopies(pairs);
    clip.forEach(it => { it.pos[0] += off; it.pos[2] += off; });
  });
}
function repeatSel() {
  const list = selected(); if (!list.length) return;
  const made = [];
  for (let i = 1; i <= rep.n; i++) { const pairs = []; list.forEach(it => { const c = JSON.parse(JSON.stringify(it)); c.id = nextId(); c.pos[rep.axis] += rep.step * i; delete c.locked; P.items.push(c); made.push(c.id); pairs.push([it, c]); }); fxDetachCopies(pairs); }
  sel = made;
}
function alignSel(axis, mode) {   // lines the selection up with its own outer edge; locked items stay and act as the guide
  const list = selected(); if (list.length < 2) return;
  const u = unionBounds(list), target = mode === 'min' ? u.min[axis] : mode === 'max' ? u.max[axis] : (u.min[axis] + u.max[axis]) / 2;
  list.filter(i => !i.locked).forEach(it => { const b = bounds(it), now = mode === 'min' ? b.min[axis] : mode === 'max' ? b.max[axis] : (b.min[axis] + b.max[axis]) / 2; it.pos[axis] += target - now; });
}
function spreadSel(axis) {   // first and last stay; the gaps between them become equal
  const list = selected().map(it => ({ it, b: bounds(it) })).sort((a, c) => a.b.min[axis] - c.b.min[axis]); if (list.length < 3) return;
  const start = list[0].b.min[axis], end = list.at(-1).b.max[axis], used = list.reduce((a, x) => a + x.b.max[axis] - x.b.min[axis], 0), gap = (end - start - used) / (list.length - 1);
  let at = start;
  list.forEach(({ it, b }) => { if (!it.locked) it.pos[axis] += at - b.min[axis]; at += b.max[axis] - b.min[axis] + gap; });
}
// ---------- dimensions ----------
// A point is stored on an item as a fraction of its size, so the dimension follows when the item moves or resizes.
const dimsOf = () => (P.dims = P.dims || []);
function ptWorld(p) { if (p.w) return p.w; const it = byId(p.id); if (!it) return null; const v = V3(p.f[0] * it.l, p.f[1] * it.t, p.f[2] * it.w).applyQuaternion(Q(it)); return [v.x + it.pos[0], v.y + it.pos[1], v.z + it.pos[2]]; }
const FR = [-.5, 0, .5];
function itemPoints(it) { const out = []; FR.forEach(a => FR.forEach(b => FR.forEach(c => { const p = { id: it.id, f: [a, b, c] }; out.push({ p, w: ptWorld(p) }); }))); return out; }
const dimEnd = (a, b, axis) => { if (!a || !b || axis == null) return b; const o = a.slice(); o[axis] = b[axis]; return o; };
const liveDims = () => dimsOf().map(d => { const a = ptWorld(d.a); return { d, a, b: dimEnd(a, ptWorld(d.b), d.axis) }; }).filter(x => x.a && x.b);
const visDims = () => liveDims().filter(x => !x.d.hidden);
const drawnDims = () => visDims().filter(x => !mEdit || dimsOf().indexOf(x.d) !== mEdit.i);   // the one being changed shows as the live preview instead
const AXN = ['X', 'Y', 'Z'];
let mAxis = null, mEdit = null, mCur = null, mFlat = null;
const mEndWorld = () => (measA && mHover ? dimEnd(ptWorld(measA), ptWorld(mHover), mAxis) : null);
function cancelMeasure() { measA = null; mHover = null; mAxis = null; mEdit = null; renderChrome(); dirty = true; }
// Picks up one end of a saved dimension; it is then placed exactly like a second point, measured from the other end.
function grabDimEnd({ i, end }) {
  const d = dimsOf()[i], a = ptWorld(d.a), b = dimEnd(a, ptWorld(d.b), d.axis);
  measA = end === 'b' ? d.a : d.axis != null ? { w: b } : d.b;
  mHover = end === 'b' ? d.b : d.a; mAxis = d.axis ?? null; mEdit = { i, axis: mAxis, self: end === 'b' ? (d.axis != null ? { w: b } : d.b) : d.a }; mCands = [];
  renderChrome(); dirty = true;
}
function startFromGrabbed() { measA = mEdit.self; mHover = measA; mAxis = null; mEdit = null; mCands = []; renderChrome(); dirty = true; }
function dimHandleAt(toScreen, x, y) {
  if (P.hideDims || measA) return null;
  for (const { d, a, b } of visDims()) for (const [end, w] of [['a', a], ['b', b]]) { const q = toScreen(w); if (q && Math.hypot(q[0] - x, q[1] - y) < 9) return { i: dimsOf().indexOf(d), end }; }
  return null;
}
const screen3D = w => { const r = cv.getBoundingClientRect(), v = V3(...w).project(camera); return v.z > 1 ? null : [(v.x + 1) / 2 * r.width, (1 - v.y) / 2 * r.height]; };
// In 3D the second point locks to whichever of X, Y, Z runs closest to the cursor on screen. A snapped end sets how far along it reaches.
function axisOrder() {
  const A = ptWorld(measA), s0 = screen3D(A), step = camera.position.distanceTo(controls.target) * .1; if (!s0) return [0, 1, 2];
  return [0, 1, 2].map(i => { const f = A.slice(); f[i] += step; const s1 = screen3D(f); if (!s1) return { i, d: Infinity }; const dx = s1[0] - s0[0], dy = s1[1] - s0[1], len = Math.hypot(dx, dy); return { i, d: len < 1 ? Infinity : Math.abs((mCur.x - s0[0]) * dy - (mCur.y - s0[1]) * dx) / len }; }).sort((a, b) => a.d - b.d).map(o => o.i);
}
function lockAxis(p, ray) {
  const A = ptWorld(measA), order = axisOrder(), w = p && mCands.includes(p) ? ptWorld(p) : null;
  const off = w ? order.filter(i => Math.abs(w[i] - A[i]) > .5) : [];
  if (off.length) { mAxis = off[0]; return p; }
  if (!ray) { mAxis = null; return p; }
  const i = order[0], dir = V3(i === 0 ? 1 : 0, i === 1 ? 1 : 0, i === 2 ? 1 : 0), o = ray.ray.origin, v = ray.ray.direction, w0 = V3(...A).sub(o), b = dir.dot(v), den = 1 - b * b;
  let t = den > 1e-6 ? (b * v.dot(w0) - dir.dot(w0)) / den : 0;
  if (P.snap) t = Math.round(t / P.grid) * P.grid;
  const out = A.slice(); out[i] += t; mAxis = i; return { w: out };
}
const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
function dimBreakdown(a, b) { const n = [['across', 0], ['up', 1], ['deep', 2]].map(([w, i]) => [w, Math.abs(a[i] - b[i])]).filter(x => x[1] > .5); return n.length > 1 ? n.map(x => `${bare(x[1])} ${x[0]}`).join(', ') : ''; }
function addMeasurePoint(pt) {
  if (!pt) return;
  if (!measA) { measA = pt; mHover = pt; renderChrome(); dirty = true; return; }
  const a = measA, axis = mAxis, ed = mEdit; measA = null; mHover = null; mAxis = null; mEdit = null;
  if (dist3(ptWorld(a), dimEnd(ptWorld(a), ptWorld(pt), axis)) < .5) { renderChrome(); dirty = true; return; }
  const n = { a, b: pt }; if (axis != null) n.axis = axis;
  edit(() => { if (ed) dimsOf()[ed.i] = n; else dimsOf().push(n); });
}
// Points close together on screen can be different corners. They are offered nearest first, and Tab steps through them.
let mCands = [], mIdx = 0;
function setCands(list) {
  const seen = new Set(), out = [];
  list.sort((a, b) => a.d - b.d).forEach(c => { const w = ptWorld(c.p), k = w.map(v => v.toFixed(1)).join(); if (!seen.has(k)) { seen.add(k); out.push(c.p); } });
  mCands = out; mIdx = 0;
  return out[0] || null;
}
function pointName(p) {
  if (!p) return '';
  const it = p.id && byId(p.id), w = ptWorld(p), where = `${bare(w[0])}, ${bare(w[1])}, ${bare(w[2])}`;
  return `${mAxis != null && measA ? `Along ${AXN[mAxis]}: ${bare(dist3(ptWorld(measA), mEndWorld()))}   ` : ''}${it ? it.name + ': ' : ''}${where}${mCands.length > 1 ? `   Tab: next of ${mCands.length}` : ''}`;
}
const fracOf = (it, w) => { const v = V3(w[0] - it.pos[0], w[1] - it.pos[1], w[2] - it.pos[2]).applyQuaternion(Q(it).conjugate()); return { id: it.id, f: [v.x / it.l, v.y / it.t, v.z / it.w] }; };
// The nearest spot on each of a board's 12 edges. It is stored like any other point, so it follows the panel.
function edgePoints(it, toScreen, depth, x, y, reach, bias) {
  const out = [], size = [it.l, it.t, it.w];
  [0, 1, 2].forEach(k => { const o = [0, 1, 2].filter(i => i !== k); [-.5, .5].forEach(m => [-.5, .5].forEach(n => {
    const f0 = [0, 0, 0]; f0[k] = -.5; f0[o[0]] = m; f0[o[1]] = n; const f1 = f0.slice(); f1[k] = .5;
    const w0 = ptWorld({ id: it.id, f: f0 }), w1 = ptWorld({ id: it.id, f: f1 }), a = toScreen(w0), b = toScreen(w1); if (!a || !b) return;
    const dx = b[0] - a[0], dy = b[1] - a[1], len2 = dx * dx + dy * dy; if (len2 < 4) return;
    const q = Math.min(1, Math.max(0, ((x - a[0]) * dx + (y - a[1]) * dy) / len2)), d = Math.hypot(a[0] + dx * q - x, a[1] + dy * q - y); if (d >= reach) return;
    let t = q; if (depth) { const za = depth(w0), zb = depth(w1); t = q * za / ((1 - q) * zb + q * za); }   // the screen foreshortens a board going away from the camera
    if (P.snap) t = Math.min(1, Math.max(0, Math.round(t * size[k] / P.grid) * P.grid / size[k]));
    const f = f0.slice(); f[k] = -.5 + t; out.push({ p: { id: it.id, f }, d: d + bias + 14 });
  })); });
  return out;
}
const ptRank = p => p.f.filter(v => !v).length;   // 0 is a true end of the board; middles and centres only win when clearly closer
function flatLock(p, vn, x, y) {
  mFlat = { vn, x, y };
  const t = vt[vn], V = VIEWS[vn], A = ptWorld(measA), q = toS(vn, t, A), order = Math.abs(x - q[0]) >= Math.abs(y - q[1]) ? [V.u, V.v] : [V.v, V.u];
  const w = p && mCands.includes(p) ? ptWorld(p) : null, off = w ? order.filter(i => Math.abs(w[i] - A[i]) > .5) : [];
  if (off.length) { mAxis = off[0]; return p; }
  const c = worldOf(vn, x, y), i = order[0]; let d = (i === V.u ? c.u : c.v) - A[i]; if (P.snap) d = Math.round(d / P.grid) * P.grid;
  const out = A.slice(); out[i] += d; mAxis = i; return { w: out };
}
function flatPoint(vn, x, y) { const p = flatRaw(vn, x, y); return measA ? flatLock(p, vn, x, y) : p; }
function flatRaw(vn, x, y) {
  const t = vt[vn], V = VIEWS[vn], near = [];
  mCur = null; mAxis = null;
  shown().forEach(it => itemPoints(it).forEach(c => { const s = toS(vn, t, c.w), d = Math.hypot(s[0] - x, s[1] - y), rank = ptRank(c.p); if (d < (rank ? 8 : 16)) near.push({ p: c.p, d: d + rank * 7 }); }));
  shown().forEach(it => near.push(...edgePoints(it, w => toS(vn, t, w), null, x, y, 8, 0)));
  const first = setCands(near); if (first) return first;
  const w = worldOf(vn, x, y), g = P.snap ? P.grid : .01, o = [0, 0, 0];
  const inside = hitFlat(vn, x, y);
  if (inside) { o[V.u] = w.u; o[V.v] = w.v; o[V.d] = inside.pos[V.d]; return fracOf(inside, o); }   // a spot on a panel moves with that panel
  o[V.u] = Math.round(w.u / g) * g; o[V.v] = Math.round(w.v / g) * g;
  const list = realItems(); if (list.length) { const u = unionBounds(list); o[V.d] = (u.min[V.d] + u.max[V.d]) / 2; }
  return { w: o };
}
function point3D(e) {
  const r = cv.getBoundingClientRect(), ray = rayAt(e), hit = ray.intersectObjects(pickable).find(keptHit), x = e.clientX - r.left, y = e.clientY - r.top;
  const near = (list, reach, bias) => { const out = []; list.forEach(it => itemPoints(it).forEach(c => { const v = V3(...c.w).project(camera); if (v.z > 1) return; const d = Math.hypot((v.x + 1) / 2 * r.width - x, (1 - v.y) / 2 * r.height - y), rank = ptRank(c.p); if (d < (rank ? reach * .55 : reach)) out.push({ p: c.p, d: d + bias + rank * 7 }); })); return out; };
  const depth = w => Math.abs(V3(...w).applyMatrix4(camera.matrixWorldInverse).z);
  mCur = { x, y }; mFlat = null; mAxis = null;
  const onHit = hit && byId(hit.object.userData.id);
  const others = shown().filter(i => !isRoomPart(i) && i !== onHit), edges = [...(onHit ? edgePoints(onHit, screen3D, depth, x, y, 14, 0) : []), ...others.flatMap(i => edgePoints(i, screen3D, depth, x, y, 10, 8))];
  const first = setCands([...(onHit ? near([onHit], 34, 0) : []), ...near(others, 18, 8), ...edges]);
  let out = first;
  if (!out && hit) out = fracOf(onHit, [hit.point.x, hit.point.y, hit.point.z]);   // a spot on an item moves with that item
  if (!out) { const p = V3(); if (ray.ray.intersectPlane(new THREE.Plane(V3(0, 1, 0), 0), p)) out = { w: [p.x, p.y, p.z] }; }
  return measA ? lockAxis(out, ray) : out;
}
function dimSvg(s, e, label) {
  const dx = e[0] - s[0], dy = e[1] - s[1], len = Math.hypot(dx, dy); if (len < 3) return '';
  const nx = -dy / len * 5, ny = dx / len * 5, ink = 'var(--dim)', tick = p => `<line x1="${p[0] - nx}" y1="${p[1] - ny}" x2="${p[0] + nx}" y2="${p[1] + ny}" stroke="${ink}" stroke-width="1.3"/>`;
  return `<line x1="${s[0]}" y1="${s[1]}" x2="${e[0]}" y2="${e[1]}" stroke="${ink}" stroke-width="1.1"/>` + tick(s) + tick(e) + (label ? pill((s[0] + e[0]) / 2, (s[1] + e[1]) / 2, label, 'var(--dim-bg)', ink) : '');
}
function dimsSvg(vn, t, printing) {
  let s = '';
  if (!printing && tool === 'measure' && !measA && !P.hideDims) visDims().forEach(({ a, b }) => [a, b].forEach(w => { const q = toS(vn, t, w); s += `<circle cx="${q[0]}" cy="${q[1]}" r="3.5" fill="#fff" stroke="var(--dim)" stroke-width="1.4"/>`; }));
  if (!P.hideDims || printing) (printing ? visDims() : drawnDims()).forEach(({ a, b }) => { s += dimSvg(toS(vn, t, a), toS(vn, t, b), bare(dist3(a, b))); });
  if (!printing && tool === 'measure') {
    if (measA && mHover) { const a = ptWorld(measA), b = mEndWorld(); if (a && b) s += dimSvg(toS(vn, t, a), toS(vn, t, b), bare(dist3(a, b))); }
    if (mHover) { const w = measA ? mEndWorld() : ptWorld(mHover); if (w) { const q = toS(vn, t, w); s += `<circle cx="${q[0]}" cy="${q[1]}" r="4.5" fill="#ffc928" stroke="#20262a" stroke-width="1.2"/>`; } }
  }
  return s;
}
function overallSvg(vn, t, list) {   // printed drawings: overall sizes outside the piece
  if (!list.length) return '';
  const V = VIEWS[vn], u = unionBounds(list), P_ = (a, b) => { const p = [0, 0, 0]; p[V.u] = a; p[V.v] = b; return toS(vn, t, p); };
  const topV = V.sv < 0 ? u.max[V.v] : u.min[V.v], a = P_(u.min[V.u], topV), b = P_(u.max[V.u], topV), c = P_(u.min[V.u], u.min[V.v]), d = P_(u.min[V.u], u.max[V.v]), off = 26;
  return dimSvg([a[0], a[1] - off], [b[0], b[1] - off], bare(u.max[V.u] - u.min[V.u])) + dimSvg([c[0] - off, c[1]], [d[0] - off, d[1]], bare(u.max[V.v] - u.min[V.v]));
}
// Which selected object a typed length should move: the end attached to the selection, unless both ends are.
function dimMover(d) {
  const a = d.a.id && sel.includes(d.a.id), b = d.b.id && sel.includes(d.b.id);
  return a && b ? { both: true } : a ? { end: 'a', id: d.a.id } : b ? { end: 'b', id: d.b.id } : null;
}
function dimListHtml(onSel) {
  const list = liveDims().filter(x => !onSel || dimMover(x.d)); if (!list.length) return tool === 'measure' ? '<p class="note">Click two points to measure between them. Measurements stay on the views and print on the plans. Drag a dot to move an end, or type a new length here.</p>' : '';
  return `<h3>Dimensions</h3>` + list.map(({ d, a, b }, i) => { const more = dimBreakdown(a, b), n = dimsOf().indexOf(d), mv = dimMover(d), mover = mv && mv.id ? byId(mv.id) : null; return `<div class="dimrow${d.hidden ? ' off' : ''}"><div><div class="dimedit"><input type="text" data-dimlen="${n}" aria-label="Length" value="${esc(bare(dist3(a, b)))}"><select data-dimaxis="${n}" aria-label="Direction">${d.axis == null ? '<option value="">Slanted</option>' : ''}${AXN.map((x, k) => `<option value="${k}"${d.axis === k ? ' selected' : ''}>${x}</option>`).join('')}</select></div>${more ? `<span>${more}</span>` : ''}${mover ? `<span>Changing this moves ${esc(mover.name)}</span>` : ''}</div><button class="ic" data-dimeye="${n}" title="${d.hidden ? 'Show' : 'Hide'}" aria-label="${d.hidden ? 'Show this dimension' : 'Hide this dimension'}">${ic(d.hidden ? 'eye-off' : 'eye')}</button><button class="ic" data-dimdel="${dimsOf().indexOf(d)}" aria-label="Delete this dimension" title="Delete">${ic('x')}</button></div>`; }).join('') + (onSel ? '' : `<div class="rowb" style="margin-top:6px"><button class="btn line" id="dimAll">Clear all</button><button class="btn line" id="dimVis">${P.hideDims ? 'Show on views' : 'Hide on views'}</button></div>`);
}
function setSize(it, k, v) { it[k] = Math.max(1, v); }
function removeSel() { const s = new Set(sel), n = P.items.length; P.items = P.items.filter(i => !s.has(i.id) || i.locked); sel = sel.filter(byId); if (P.items.length === n && sel.length) toast('Locked items can\'t be deleted. Unlock first.', true); }
function duplicateSel() {
  const list = selected(); if (!list.length) return;
  const u = unionBounds(list), dx = u.max[0] - u.min[0] + 20;
  const pairs = [], made = list.map(it => { const c = JSON.parse(JSON.stringify(it)); c.id = nextId(); c.pos[0] += dx; delete c.locked; P.items.push(c); pairs.push([it, c]); return c.id; });
  fxDetachCopies(pairs);
  sel = made;
}
function dropDown() {   // rests the selection on whatever is below it, or the floor
  const list = movable(); if (!list.length) return;
  const s = new Set(sel), u = unionBounds(list); let floor = 0;
  shown().forEach(it => { if (s.has(it.id)) return; const b = bounds(it); if (b.max[1] <= u.min[1] + 1&& b.max[0] > u.min[0] && b.min[0] < u.max[0] && b.max[2] > u.min[2] && b.min[2] < u.max[2]) floor = Math.max(floor, b.max[1]); });
  list.forEach(it => { it.pos[1] += floor - u.min[1]; });
}
function addFromGallery(key, at) {
  if (key.startsWith('lib:')) {
    const entry = LIB.items.find(e => e.id === key.slice(4)); if (!entry) return;
    const list = realItems(), c = list.length ? unionBounds(list) : null, base = at || { x: c ? c.max[0] + 100 + entry.size[0] / 2 : 700, y: 0, z: c ? c.min[2] + entry.size[2] / 2 : 40 + entry.size[2] / 2 };
    const made = entry.items.map(src => { const it = JSON.parse(JSON.stringify(src)); it.pos = [src.pos[0] + base.x, src.pos[1] + (base.y ?? 0), src.pos[2] + base.z]; it.id = nextId(); delete it.group; delete it.locked; P.items.push(it); return it; });
    if (entry.layer) {   // a resizable design: this copy gets its own layer and parameters, starting where it was placed
      const g = { id: nextId(), name: entry.name, hidden: false, open: false, params: JSON.parse(JSON.stringify(entry.layer.params)) }, map = new Map(entry.items.map((s, i) => [s.id, made[i].id])), add = { left: base.x, floor: base.y ?? 0, back: base.z };
      g.params.forEach(p => { const n = p.name.toLowerCase(); if (n in add) { p.e = `${r2p(parseFloat(p.e) + add[n])}mm`; p.u = 'mm'; } });
      P.groups.push(g);
      made.forEach(i => { i.group = g.id; delete i.fxv; if (i.fx) Object.values(i.fx).forEach(f => { f.e = f.e.replace(/#(\d+)/g, (m, n) => (map.has(+n) ? '#' + map.get(+n) : m)); }); });
    } else if (made.length > 1) { const g = { id: nextId(), name: entry.name, hidden: false, open: false }; P.groups.push(g); made.forEach(i => { i.group = g.id; }); }
    sel = made.map(i => i.id); setTimeout(ensureModels); return;   // its model may still be in the database
  }
  const board = key.startsWith('board:') ? key.split(':') : null;
  if (board) lastBoard = { mat: board[1], t: +board[2] };
  const t = lastBoard.t, made = [];
  const center = at || (() => { const list = realItems(), c = list.length ? unionBounds(list) : null; return { x: c ? (c.min[0] + c.max[0]) / 2 : 700, y: null, z: c ? c.max[2] + 200 : 300 }; })();
  const preset = PANELS.find(p => p[0] === key);
  if (preset && key === 'drawer') {
    const w = 500, h = 180, d = 400, x = center.x, y = center.y ?? 0, z = center.z;
    const set = drawerSet(x - w / 2, x + w / 2, y, y + h, z + d / 2, z - d / 2, t);
    const g = { id: nextId(), name: 'Drawer', hidden: false, open: false }; P.groups.push(g);
    set.forEach(i => { delete i.gname; i.id = nextId(); i.group = g.id; if (i.kind === 'panel') i.mat = lastBoard.mat; P.items.push(i); made.push(i.id); });
  } else {
    let it;
    if (board || preset) {
      const [dx, dy, dz] = board ? [600, 0, 300] : preset[2], sx = dx || t, sy = dy || t, sz = dz || t, y = (center.y ?? 0);
      it = panelBox(board ? 'Panel' : preset[1], [center.x - sx / 2, center.x + sx / 2, y, y + sy, center.z - sz / 2, center.z + sz / 2], key === 'leg' ? { band: 'none' } : {});
      it.mat = lastBoard.mat; delete it.gname;
    } else {
      const o = OBJ[key], y = center.y ?? 0; it = obj(key, center.x, y, center.z - o.d / 2);
    }
    it.id = nextId(); P.items.push(it); made.push(it.id);
    // line it up with the grid and neighbours
    const s = new Set([it.id]), b = bounds(it);
    [0, 2].forEach(a => { it.pos[a] += snapAxis(a, b.min[a], b.max[a], s, 15, P.snap).d; });
  }
  sel = made;
}

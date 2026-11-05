// ---------- flat views ----------
const VIEWS = {
  top: { title: 'Top', u: 0, v: 2, sv: 1, d: 1, ds: 1, el: 'vtop' },
  front: { title: 'Front', u: 0, v: 1, sv: -1, d: 2, ds: 1, el: 'vfront' },
  side: { title: 'Side', u: 2, v: 1, sv: -1, d: 0, ds: -1, el: 'vside' },
};
const vt = { top: {}, front: {}, side: {} };
function flatBounds(vn, only) {
  const real = realItems(), V = VIEWS[vn], list = only || (real.length ? real : shown());
  const b = list.length ? unionBounds(list) : { min: [0, 0, 0], max: [1500, 1000, 800] };
  const min = b.min.slice(), max = b.max.slice();
  min[1] = Math.min(min[1], 0);
  return { u0: min[V.u], u1: max[V.u], v0: min[V.v], v1: max[V.v] };
}
function fitTransform(vn, W, H, pad = 40, only) {
  const V = VIEWS[vn], b = flatBounds(vn, only), left = pad + 16, top = pad + 10;
  const k = Math.min((W - left - 22) / Math.max(b.u1 - b.u0, 50), (H - top - 22) / Math.max(b.v1 - b.v0, 50));
  const ox = left + (W - left - 22 - (b.u1 - b.u0) * k) / 2 - b.u0 * k;
  const midV = (b.v0 + b.v1) / 2, oy = top + (H - top - 22) / 2 - V.sv * midV * k;
  return { k, ox, oy };
}
function fitView(vn) { const el = document.getElementById(VIEWS[vn].el), r = el.getBoundingClientRect(); if (r.width) Object.assign(vt[vn], fitTransform(vn, r.width, r.height, 22), { auto: true, W: r.width, H: r.height }); }
const toS = (vn, t, p) => { const V = VIEWS[vn]; return [t.ox + p[V.u] * t.k, t.oy + V.sv * p[V.v] * t.k]; };
function hull(pts) {
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]), cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  p.forEach(q => { while (lo.length > 1 && cross(lo.at(-2), lo.at(-1), q) <= 0) lo.pop(); lo.push(q); });
  p.slice().reverse().forEach(q => { while (up.length > 1 && cross(up.at(-2), up.at(-1), q) <= 0) up.pop(); up.push(q); });
  return lo.slice(0, -1).concat(up.slice(0, -1));
}
function order(vn) { const V = VIEWS[vn]; return shown().filter(secKeeps).sort((a, b) => V.ds * (a.pos[V.d] - b.pos[V.d])); }
function itemColor(it) { if (it.kind === 'object') { const s = shapes(it.type, it.l, it.t, it.w, it.id)[0]; return s ? s.c : '#9aa1a5'; } return MAT[panelColor(it)].f; }
function polyStr(pts) { return pts.map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' '); }
function pill(x, y, s, bg = '#ffc928', fg = '#20262a') {
  const w = s.length * 6.6 + 10;
  return `<rect x="${x - w / 2}" y="${y - 9}" width="${w}" height="18" rx="2" fill="${bg}" stroke="#20262a" stroke-width=".8"/><text x="${x}" y="${y + 4}" text-anchor="middle" font-family="Barlow,sans-serif" font-size="12.5" font-weight="600" fill="${fg}">${esc(s)}</text>`;
}
// tape measures read true world distances, whatever the zoom
function tapes(vn, t, W, H) {
  const V = VIEWS[vn], unit = unitOf().mm, pick_ = unitOf().ruler, maj = pick_.find(c => c * unit * t.k >= 40) || (m => { while (m * unit * t.k < 40) m *= 2; return m; })(pick_[pick_.length - 1]), minor = unitKey() === 'in' ? (maj >= 12 ? (maj >= 48 ? 12 : maj >= 24 ? 6 : 1) : maj >= 6 ? 1 : .5) : maj / 5;
  const step = (minor * unit * t.k >= 4 ? minor : maj) * unit, th = 15;
  let s = `<rect x="0" y="0" width="${W}" height="${th}" fill="var(--tape-bg)" stroke="var(--tape-line)" stroke-width=".6"/><rect x="0" y="0" width="${th}" height="${H}" fill="var(--tape-bg)" stroke="var(--tape-line)" stroke-width=".6"/>`;
  const num = v => String(Math.round(v / unit * 100) / 100), label = (v, x, y) => `<text x="${x}" y="${y}" font-family="Barlow,sans-serif" font-size="9.5" fill="var(--tape-ink)">${num(v)}</text>`;
  const labelUp = (v, x, y) => `<text font-family="Barlow,sans-serif" font-size="9.5" fill="var(--tape-ink)" text-anchor="middle">${[...num(v)].map((c, i) => `<tspan x="${x}" y="${y + i * 9}">${c}</tspan>`).join('')}</text>`;   // digits stacked, so they fit the narrow side ruler
  const a0 = Math.ceil((th - t.ox) / t.k / step) * step, a1 = (W - t.ox) / t.k;
  for (let a = a0; a <= a1; a += step) {
    const x = t.ox + a * t.k, big_ = Math.abs(a / (maj * unit) - Math.round(a / (maj * unit))) < 1e-6;
    s += `<line x1="${x}" x2="${x}" y1="${th}" y2="${th - (big_ ? 15 : 4)}" stroke="var(--tape-ink)" stroke-width=".7"/>`;
    if (big_) s += label(a, x + 3, 9.5);
  }
  const b0 = V.sv < 0 ? (t.oy - H) / t.k : (th - t.oy) / t.k, b1 = V.sv < 0 ? (t.oy - th) / t.k : (H - t.oy) / t.k;
  for (let a = Math.ceil(b0 / step) * step; a <= b1; a += step) {
    const y = t.oy + V.sv * a * t.k, big_ = Math.abs(a / (maj * unit) - Math.round(a / (maj * unit))) < 1e-6;
    s += `<line x1="${th}" x2="${th - (big_ ? 15 : 4)}" y1="${y}" y2="${y}" stroke="var(--tape-ink)" stroke-width=".7"/>`;
    if (big_) s += labelUp(a, 5.5, y + 10);
  }
  return s + `<rect x="0" y="0" width="${th}" height="${th}" fill="var(--tape-bg)" stroke="var(--tape-line)" stroke-width=".6"/>`;
}
function gridLines(vn, t, W, H) {
  let g = P.grid; while (g * t.k < 9) g *= 2;
  let s = '';
  for (let a = Math.ceil(-t.ox / t.k / g) * g; a <= (W - t.ox) / t.k; a += g) { const x = t.ox + a * t.k; s += `M${x.toFixed(1)} 0V${H}`; }
  const V = VIEWS[vn], y0 = V.sv < 0 ? (t.oy - H) / t.k : -t.oy / t.k, y1 = V.sv < 0 ? t.oy / t.k : (H - t.oy) / t.k;
  for (let a = Math.ceil(y0 / g) * g; a <= y1; a += g) { const y = t.oy + V.sv * a * t.k; s += `M0 ${y.toFixed(1)}H${W}`; }
  return `<path d="${s}" stroke="var(--ink)" stroke-opacity=".08" stroke-width="1" fill="none"/>`;
}
function roomLines() { return ''; }
// gaps to the nearest neighbour on each side of the selection
function gapMarks(vn, t, list) {
  const V = VIEWS[vn], u = unionBounds(list), ids = new Set(list.map(i => i.id)), others = shown().filter(i => !ids.has(i.id) && i.kind === 'panel').map(bounds);
  let s = '';
  const mark = (a, b) => { s += `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="var(--ink)" stroke-dasharray="3 2"/>`; };
  const mkP = (au, av) => { const p = [0, 0, 0]; p[V.u] = au; p[V.v] = av; return toS(vn, t, p); };
  const midU = (u.min[V.u] + u.max[V.u]) / 2, midV = (u.min[V.v] + u.max[V.v]) / 2;
  [[V.u, 1], [V.u, -1], [V.v, 1], [V.v, -1]].forEach(([ax, dir]) => {
    const perp = ax === V.u ? V.v : V.u; let near = Infinity;
    others.forEach(b => {
      if (b.max[perp] <= u.min[perp] + .5 || b.min[perp] >= u.max[perp] - .5) return;
      const g = dir > 0 ? b.min[ax] - u.max[ax] : u.min[ax] - b.max[ax];
      if (g > .5 && g < near) near = g;
    });
    if (ax === V.v && V.sv < 0 && dir < 0 && u.min[1] > .5 && u.min[1] < near) near = u.min[1];
    if (!isFinite(near)) return;
    const from = dir > 0 ? u.max[ax] : u.min[ax], to = from + dir * near;
    const a = ax === V.u ? mkP(from, midV) : mkP(midU, from), b = ax === V.u ? mkP(to, midV) : mkP(midU, to);
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 24) return;
    mark(a, b); s += pill((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, bare(near));
  });
  return s;
}
function grips(vn) {   // resize squares, only for one panel seen straight on
  const list = selected(); if (tool !== 'scale' || list.length !== 1 || list[0].locked || !isStraight(list[0])) return [];
  const it = list[0], b = bounds(it), V = VIEWS[vn], t = vt[vn];
  const mu = (b.min[V.u] + b.max[V.u]) / 2, mv = (b.min[V.v] + b.max[V.v]) / 2, P_ = (au, av) => { const p = [0, 0, 0]; p[V.u] = au; p[V.v] = av; return toS(vn, t, p); };
  const a = P_(b.min[V.u], mv), c = P_(b.max[V.u], mv), d = P_(mu, b.min[V.v]), e = P_(mu, b.max[V.v]);
  return [{ p: a, axis: V.u, side: -1 }, { p: c, axis: V.u, side: 1 }, { p: d, axis: V.v, side: -1 }, { p: e, axis: V.v, side: 1 }].filter(g => Math.abs(b.max[g.axis] - b.min[g.axis]) * t.k > 14);
}
function flatString(vn, t, W, H, opts = {}) {
  const s_ = new Set(opts.static ? [] : sel); let s = '';
  if (!opts.static) s += gridLines(vn, t, W, H);
  s += roomLines(vn, t, W, H);
  (opts.static ? panelsOnly().filter(it => !opts.cut || secKeeps(it)).sort((a, c) => VIEWS[vn].ds * (a.pos[VIEWS[vn].d] - c.pos[VIEWS[vn].d])) : order(vn)).forEach(it => {
    if (opts.static && it.kind === 'object') return;
    const pts = hull(corners(it).map(c => toS(vn, t, c))), on = s_.has(it.id);
    const fillC = on ? '#ffc928' : opts.static ? '#e8ebe9' : itemColor(it), V_ = VIEWS[vn], ny = V3(0, 1, 0).applyQuaternion(Q(it));
    if (it.kind === 'panel' && hasShape(it) && Math.abs([ny.x, ny.y, ny.z][V_.d]) > .999) {   // seen flat on: draw its real shape
      const q = Q(it), proj = c => { const w = V3(c[0], it.t / 2, c[1]).applyQuaternion(q); return toS(vn, t, [w.x + it.pos[0], w.y + it.pos[1], w.z + it.pos[2]]); }, d = pl => 'M' + pl.map(c => proj(c).map(v => v.toFixed(1)).join(' ')).join('L') + 'Z';
      s += `<path d="${d(outlinePts(it))}${it.shape.holes.filter(h => holeFits(it, h)).map(h => d(holePts(h))).join('')}" fill="${fillC}" fill-rule="evenodd" stroke="#20262a" stroke-width="${on ? 1.5 : .8}"/>`;
    } else if (it.poly && vn === 'top') {
      s += `<polygon points="${polyStr(it.poly.map(c => toS(vn, t, [c[0] + it.pos[0], it.pos[1], c[1] + it.pos[2]])))}" fill="${on ? fillC : it.fc || (isDark() ? '#3f3b35' : '#e7e2d6')}"${it.ceiling && !on ? ' fill-opacity=".12"' : ''} stroke="#20262a" stroke-width="${on ? 1.5 : .8}"/>`;
      if (it.rim) { let d = ''; for (let i = 0; i < it.rim.length; i += 4) { const a = toS(vn, t, [it.rim[i] + it.pos[0], it.pos[1], it.rim[i + 1] + it.pos[2]]), b = toS(vn, t, [it.rim[i + 2] + it.pos[0], it.pos[1], it.rim[i + 3] + it.pos[2]]); d += `M${a[0].toFixed(1)} ${a[1].toFixed(1)}L${b[0].toFixed(1)} ${b[1].toFixed(1)}`; } s += `<path d="${d}" fill="none" stroke="#20262a" stroke-width="1.2" stroke-dasharray="4 3"/>`; }
    } else s += `<polygon points="${polyStr(pts)}" fill="${fillC}"${it.model && !on ? ' fill-opacity=".2"' : ''} stroke="#20262a" stroke-width="${on ? 1.5 : .8}"/>`;
    if (it.cuts) { const q = Q(it); it.cuts.forEach(k => { const c = []; [k.s0, k.s1].forEach(a => [k.z0, k.z1].forEach(b => [-.5, .5].forEach(e => { const v = V3((a - .5) * it.l, (b - .5) * it.t, e * it.w).applyQuaternion(q); c.push(toS(vn, t, [v.x + it.pos[0], v.y + it.pos[1], v.z + it.pos[2]])); }))); s += `<polygon points="${polyStr(hull(c))}" fill="var(--canvas)" stroke="#20262a" stroke-width=".6"/>`; }); }
    if (sect.on && it.kind === 'panel' && (opts.cut || !opts.static) && sectionFaces(vn) && secCrosses(it)) s += sliceSvg(vn, t, it);
    if (opts.static) { const b = pts.reduce((a, p) => [Math.min(a[0], p[0]), Math.max(a[1], p[0]), Math.min(a[2], p[1]), Math.max(a[3], p[1])], [1e9, -1e9, 1e9, -1e9]); if (b[1] - b[0] > 26 && b[3] - b[2] > 13) s += `<text x="${(b[0] + b[1]) / 2}" y="${(b[2] + b[3]) / 2 + 4}" text-anchor="middle" font-family="Barlow,sans-serif" font-size="11">${it.id}</text>`; }
  });
  if (opts.static) s += overallSvg(vn, t, panelsOnly()) + dimsSvg(vn, t, true);
  if (!opts.static) {
    s += dimsSvg(vn, t, false) + guidesSvg(vn, t, W, H) + snapHighlightSvg(vn, t);
    guides.forEach(g => {
      const V = VIEWS[vn]; if (g.axis !== V.u && g.axis !== V.v) return;
      const p = [0, 0, 0]; p[g.axis] = g.at; const q = toS(vn, t, p);
      s += g.axis === V.u ? `<line x1="${q[0]}" x2="${q[0]}" y1="0" y2="${H}" stroke="var(--dim)"/>` : `<line x1="0" x2="${W}" y1="${q[1]}" y2="${q[1]}" stroke="var(--dim)"/>`;
    });
    const list = selected();
    if (list.length) {
      if (W > 420 && H > 300) s += gapMarks(vn, t, list);
      const V = VIEWS[vn], u = unionBounds(list), P_ = (au, av) => { const p = [0, 0, 0]; p[V.u] = au; p[V.v] = av; return toS(vn, t, p); };
      const c1 = P_(u.min[V.u], u.max[V.v]), c2 = P_(u.max[V.u], u.max[V.v]), yTop = V.sv < 0 ? c1[1] : P_(u.min[V.u], u.min[V.v])[1];
      s += pill(Math.max(50, Math.min(W - 40, (c1[0] + c2[0]) / 2)), Math.max(28, yTop - 14), bare(u.max[V.u] - u.min[V.u]));
      const y0 = P_(u.min[V.u], u.min[V.v])[1], y1 = P_(u.min[V.u], u.max[V.v])[1];
      const px_ = Math.max(28, c1[0] - 14), py_ = Math.max(40, Math.min(H - 30, (y0 + y1) / 2));
      s += `<g transform="rotate(-90 ${px_} ${py_})">${pill(px_, py_, bare(u.max[V.v] - u.min[V.v]))}</g>`;
      grips(vn).forEach(g => { s += `<rect x="${g.p[0] - 5}" y="${g.p[1] - 5}" width="10" height="10" fill="#fff" stroke="#20262a" stroke-width="1.3"/>`; });
    }
    s += tapes(vn, t, W, H);
  }
  return s;
}
function drawFlats() {
  Object.keys(VIEWS).forEach(vn => {
    const el = document.getElementById(VIEWS[vn].el), r = el.getBoundingClientRect(); if (!r.width) return;
    const t = vt[vn];
    if (!t.k || t.W !== r.width || t.H !== r.height) { if (t.auto !== false) fitView(vn); else { t.W = r.width; t.H = r.height; } }
    el.setAttribute('viewBox', `0 0 ${r.width} ${r.height}`);
    let extra = '';
    if (flatBox && flatBox.vn === vn) { const b = flatBox; extra = `<rect x="${Math.min(b.x0, b.x1)}" y="${Math.min(b.y0, b.y1)}" width="${Math.abs(b.x1 - b.x0)}" height="${Math.abs(b.y1 - b.y0)}" fill="#ffc928" fill-opacity=".2" stroke="var(--ink)" stroke-dasharray="4 3"/>`; }
    el.innerHTML = flatString(vn, t, r.width, r.height) + extra;
  });
}
function hitFlat(vn, x, y) {
  const t = vt[vn], list = order(vn).reverse();
  for (const it of list) {
    if (it.locked) continue;
    const pts = hull(corners(it).map(c => toS(vn, t, c)));
    let inside = true;
    for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; if ((b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]) < 0) { inside = false; break; } }
    if (inside) return it;
    for (let i = 0; i < pts.length; i++) {   // a board seen edge-on is thin: allow a few pixels
      const a = pts[i], b = pts[(i + 1) % pts.length], dx = b[0] - a[0], dy = b[1] - a[1], u = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy || 1)));
      if (Math.hypot(x - a[0] - u * dx, y - a[1] - u * dy) < 4) return it;
    }
  }
  return null;
}
let fd = null;
const worldOf = (vn, x, y) => { const V = VIEWS[vn], t = vt[vn]; return { u: (x - t.ox) / t.k, v: V.sv * (y - t.oy) / t.k }; };
const localAxisFor = (it, worldAxis) => { const m = new THREE.Matrix4().makeRotationFromQuaternion(Q(it)).elements; return [0, 1, 2].find(c => Math.abs(m[c * 4 + worldAxis]) > .99); };
Object.keys(VIEWS).forEach(vn => {
  const el = document.getElementById(VIEWS[vn].el), V = VIEWS[vn];
  const pos = e => { const r = el.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  el.addEventListener('contextmenu', e => e.preventDefault());
  el.addEventListener('wheel', e => {
    e.preventDefault(); const [x, y] = pos(e), t = vt[vn], f = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    t.ox = x - (x - t.ox) * f; t.oy = y - (y - t.oy) * f; t.k *= f; t.auto = false; dirty = true;
  }, { passive: false });
  el.addEventListener('pointerdown', e => {
    el.setPointerCapture && el.setPointerCapture(e.pointerId);
    const [x, y] = pos(e), t = vt[vn];
    if (e.button !== 0) { fd = { type: 'pan', vn, x, y, ox: t.ox, oy: t.oy }; t.auto = false; return; }
    if (tool === 'measure') { const h = dimHandleAt(w => toS(vn, t, w), x, y); if (h) { grabDimEnd(h); fd = { type: 'mdrag', vn, x, y, moved: false }; return; } const near = mHover && mCands.includes(mHover) ? mHover : flatPoint(vn, x, y); addMeasurePoint(near); readout(''); return; }
    if (y < RULER || x < RULER) { fd = { type: 'newguide', vn, axis: y < RULER ? V.v : V.u, moved: false, x, y }; return; }
    const gi = guideAt(vn, x, y), onItem = gi >= 0 ? null : undefined;
    const g = grips(vn).find(q => Math.hypot(q.p[0] - x, q.p[1] - y) < 9);
    if (gi >= 0 && !g && onItem === null) { pushUndo(); fd = { type: 'guide', vn, index: gi, axis: cguides()[gi].axis, moved: false, x, y }; return; }
    if (g) {
      const it = selected()[0], b = bounds(it), la = localAxisFor(it, g.axis);
      pushUndo();
      fd = { type: 'size', vn, id: it.id, axis: g.axis, side: g.side, fixed: g.side > 0 ? b.min[g.axis] : b.max[g.axis], mid: (b.min[g.axis] + b.max[g.axis]) / 2, key: ['l', 't', 'w'][la], moved: false };
      return;
    }
    const hit = hitFlat(vn, x, y);
    if (!hit) { fd = { type: 'box', vn, x, y, add: e.shiftKey, moved: false }; return; }
    if (e.isDbl) { pick(hit.id, false, true); render(); } else if (!sel.includes(hit.id) || e.shiftKey) { pick(hit.id, e.shiftKey); render(); }
    if (tool !== 'select') return;
    pushUndo();
    fd = { type: 'move', vn, base: movable().map(i => ({ id: i.id, pos: i.pos.slice() })), start: worldOf(vn, x, y), moved: false, x, y };
  });
  el.addEventListener('pointermove', e => {
    if (tool === 'measure' && (!fd || fd.type === 'mdrag')) { const [mx, my] = pos(e); if (fd && Math.hypot(mx - fd.x, my - fd.y) >= 4) fd.moved = true; mHover = flatPoint(vn, mx, my); readout(pointName(mHover)); dirty = true; return; }
    if (!fd || fd.vn !== vn) return;
    const [x, y] = pos(e), t = vt[vn], active = P.snap && !e.altKey;
    if (fd.type === 'pan') { t.ox = fd.ox + x - fd.x; t.oy = fd.oy + y - fd.y; dirty = true; return; }
    if (fd.type === 'box') { if (Math.hypot(x - fd.x, y - fd.y) > 3) fd.moved = true; flatBox = { vn, x0: fd.x, y0: fd.y, x1: x, y1: y }; dirty = true; return; }
    const w = worldOf(vn, x, y), thr = 7 / t.k;
    if (fd.type === 'newguide' || fd.type === 'guide') {
      fd.moved = fd.moved || Math.hypot(x - fd.x, y - fd.y) > 2;
      let at = fd.axis === V.u ? w.u : w.v;
      if (active) { const s = snapAxis(fd.axis, at, at, new Set(), thr, true); at += s.d; }
      fd.at = at; fd.off = fd.type === 'guide' && (y < RULER || x < RULER);
      if (fd.type === 'guide') cguides()[fd.index].at = at;
      guides = fd.type === 'newguide' ? [{ axis: fd.axis, at }] : [];
      readout(fd.off ? 'Let go to delete this guide' : `Guide: ${bare(at)}`); dirty = true; return;
    }
    if (fd.type === 'size') {
      fd.moved = true; const it = byId(fd.id), ig = new Set([it.id]), raw = fd.axis === V.u ? w.u : w.v;
      const s = snapAxis(fd.axis, raw, raw, ig, thr, active), face = raw + s.d;
      const rawSize = e.shiftKey ? Math.abs(raw - fd.mid) * 2 : fd.side > 0 ? raw - fd.fixed : fd.fixed - raw, hit = active ? stretchSnap(fd.axis, rawSize, fd.side, fd.fixed, fd.mid, e.shiftKey, ig, thr) : null;
      const size = hit ? Math.max(5, hit.size) : Math.max(5, e.shiftKey ? Math.abs(face - fd.mid) * 2 : fd.side > 0 ? face - fd.fixed : fd.fixed - face);
      it[fd.key] = size; it.pos[fd.axis] = e.shiftKey ? fd.mid : fd.side > 0 ? fd.fixed + size / 2 : fd.fixed - size / 2;
      guides = hit ? [{ axis: fd.axis, at: hit.at }] : []; snapHits = hit ? [hit.same ? { id: hit.same.id } : hit] : [];
      readout(`${bare(size)}${sizeNote(hit)}`); dirty = true; return;
    }
    if (!fd.moved && Math.hypot(x - fd.x, y - fd.y) < 3) return;
    fd.moved = true;
    const dv = [0, 0, 0]; dv[V.u] = w.u - fd.start.u; dv[V.v] = w.v - fd.start.v;
    applyMove(fd, dv, [V.u, V.v], active, thr);
    const u = unionBounds(selected()); readout(`${bare(u.min[V.u])}, ${bare(u.min[V.v])}`);
    dirty = true;
  });
  const end = () => {
    if (!fd || fd.vn !== vn) return;
    const f = fd; fd = null; guides = []; snapHits = []; readout('');
    if (f.type === 'pan') return;
    if (f.type === 'newguide') { if (f.moved && f.at != null) edit(() => { cguides().push({ axis: f.axis, at: f.at }); P.hideGuides = false; }); return; }
    if (f.type === 'guide') { if (!f.moved) { undoS.pop(); return; } if (f.off) cguides().splice(f.index, 1); persist(); render(); return; }
    if (f.type === 'mdrag') { if (f.moved) addMeasurePoint(mHover); else startFromGrabbed(); return; }
    if (f.type === 'box') {
      const b = flatBox; flatBox = null;
      if (!f.moved || !b) { if (!f.add) sel = []; render(); return; }
      const [ax, bx] = [Math.min(b.x0, b.x1), Math.max(b.x0, b.x1)], [ay, by] = [Math.min(b.y0, b.y1), Math.max(b.y0, b.y1)], t2 = vt[vn];
      const inside = shown().filter(it => !it.locked).filter(it => { const c = corners(it).map(q => toS(vn, t2, q)), xs = c.map(q => q[0]), ys = c.map(q => q[1]); return Math.max(...xs) >= ax && Math.min(...xs) <= bx && Math.max(...ys) >= ay && Math.min(...ys) <= by; }).map(i => i.id);
      sel = f.add ? [...new Set([...sel, ...inside])] : inside; if (sel.length) setTab('props'); render(); return;
    }
    if (!f.moved) { undoS.pop(); return; }
    persist(); precRemember(f); render();
  };
  el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
  el.addEventListener('dblclick', e => { if (!hitFlat(vn, ...pos(e))) { fitView(vn); dirty = true; } });
  const pane = el.parentElement;
  pane.insertAdjacentHTML('beforeend', `<div class="vbar"><button class="btn line" data-fit title="Fit everything in this view" aria-label="Fit everything in this view">${ic('scan')}</button><button class="btn line" data-big title="Full size" aria-label="Full size">${ic('maximize-2')}</button></div>`);
  pane.querySelector('[data-fit]').onclick = () => { fitView(vn); dirty = true; };
  pane.querySelector('[data-big]').onclick = () => setBig(vn);
});
// ---------- view layouts ----------
// A layout is a tree of rows and columns with views at its ends. Dragging a divider changes the sizes in the tree.
const VIEW_NAMES = { '3d': '3D', top: 'Top', front: 'Front', side: 'Side' };
const row = (kids, sizes) => ({ dir: 'cols', kids, sizes: sizes || kids.map(() => 1 / kids.length) });
const col = (kids, sizes) => ({ dir: 'rows', kids, sizes: sizes || kids.map(() => 1 / kids.length) });
const LAYOUTS = {
  right: { name: '3D, views at right', make: () => row(['3d', col(['top', 'front', 'side'])], [.72, .28]) },
  left: { name: '3D, views at left', make: () => row([col(['top', 'front', 'side']), '3d'], [.28, .72]) },
  bottom: { name: '3D, views below', make: () => col(['3d', row(['top', 'front', 'side'])], [.68, .32]) },
  quad: { name: 'Four equal', make: () => col([row(['top', '3d']), row(['front', 'side'])]) },
  pair: { name: '3D and front', make: () => row(['3d', 'front']) },
  stack: { name: '3D over top', make: () => col(['3d', 'top'], [.6, .4]) },
  three: { name: 'Three columns', make: () => row(['front', '3d', 'side'], [.28, .44, .28]) },
  flat: { name: 'Flat views only', make: () => row([col(['top', 'front']), 'side'], [.62, .38]) },
  single: { name: '3D only', make: () => '3d' },
};
const lay = { key: 'right', trees: {}, max: null };
try { Object.assign(lay, JSON.parse(localStorage.getItem('furniture-layout')) || {}, { max: null }); } catch (e) {}
if (!LAYOUTS[lay.key]) lay.key = 'right';
const saveLay = () => { try { localStorage.setItem('furniture-layout', JSON.stringify({ key: lay.key, trees: lay.trees })); } catch (e) {} };
const curTree = () => lay.trees[lay.key] || (lay.trees[lay.key] = LAYOUTS[lay.key].make());
const leaves = n => typeof n === 'string' ? [n] : n.kids.flatMap(leaves);
const MIN_PANE = 110, work = document.getElementById('work');
function applyLayout() {
  const W = work.clientWidth, H = work.clientHeight; if (!W || !H) return;
  work.querySelectorAll('.split').forEach(s => { if (!s.classList.contains('dragging')) s.remove(); });
  const dragging = work.querySelector('.split.dragging');
  const shownViews = new Set();
  const place = (n, x, y, w, h) => {
    if (typeof n === 'string') {
      shownViews.add(n);
      const pane = work.querySelector(`.pane[data-v="${n}"]`); pane.hidden = false;
      Object.assign(pane.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' });
      return;
    }
    let at = n.dir === 'cols' ? x : y; const tot = n.dir === 'cols' ? w : h;
    n.kids.forEach((k, i) => {
      const s = n.sizes[i] * tot;
      n.dir === 'cols' ? place(k, at, y, s, h) : place(k, x, at, w, s);
      at += s;
      if (i < n.kids.length - 1 && !dragging) {
        const d = document.createElement('div'); d.className = 'split ' + n.dir; d.tabIndex = 0; d.setAttribute('role', 'separator'); d.setAttribute('aria-orientation', n.dir === 'cols' ? 'vertical' : 'horizontal'); d.title = 'Drag to resize. Double-click to even out.';
        Object.assign(d.style, n.dir === 'cols' ? { left: at + 'px', top: y + 'px', height: h + 'px' } : { top: at + 'px', left: x + 'px', width: w + 'px' });
        d._split = { n, i, tot }; work.appendChild(d);
      } else if (dragging && dragging._split.n === n && dragging._split.i === i) { dragging.style[n.dir === 'cols' ? 'left' : 'top'] = at + 'px'; }
    });
  };
  place(lay.max || curTree(), 0, 0, W, H);
  work.querySelectorAll('.pane').forEach(p => { if (!shownViews.has(p.dataset.v)) p.hidden = true; });
  work.querySelectorAll('[data-big]').forEach(b => { const isMax = lay.max === b.closest('.pane').dataset.v; b.innerHTML = ic(isMax ? 'minimize-2' : 'maximize-2'); b.title = isMax ? 'Back to your layout' : 'Full size'; b.setAttribute('aria-label', b.title); });
  work.querySelectorAll('.vsel').forEach(s => { s.value = s.closest('.pane').dataset.v; s.disabled = !!lay.max; });
  size3D(); dirty = true;
}
function refitViews() { Object.keys(VIEWS).forEach(n => { vt[n].k = 0; vt[n].auto = true; }); }
function setLayout(key) { lay.key = key; lay.max = null; saveLay(); toggleLayPop(false); refitViews(); applyLayout(); }
function resetLayout() { delete lay.trees[lay.key]; lay.max = null; saveLay(); refitViews(); applyLayout(); toast('View sizes reset'); }
function setBig(v) { lay.max = lay.max === v ? null : v; refitViews(); applyLayout(); }
// showing a view in a pane swaps it with wherever that view already was
function swapViews(a, b) {
  const has = leaves(curTree()).includes(b);
  const walk = n => { if (typeof n === 'string') return n === a ? b : has && n === b ? a : n; n.kids = n.kids.map(walk); return n; };
  lay.trees[lay.key] = walk(curTree()); saveLay(); refitViews(); applyLayout();
}
// dividers
let splitDrag = null;
work.addEventListener('pointerdown', e => {
  const d = e.target.closest('.split'); if (!d || e.button !== 0) return;
  e.preventDefault(); const { n, i, tot } = d._split, pos = n.dir === 'cols' ? e.clientX : e.clientY;
  if (e.isDbl) { const half = (n.sizes[i] + n.sizes[i + 1]) / 2; n.sizes[i] = n.sizes[i + 1] = half; saveLay(); applyLayout(); return; }   // double-click evens out
  splitDrag = { d, n, i, tot, start: pos, a: n.sizes[i], b: n.sizes[i + 1], moved: false };
  d.classList.add('dragging'); document.body.classList.add('splitting');
});
window.addEventListener('pointermove', e => {
  if (!splitDrag) return;
  const s = splitDrag, delta = ((s.n.dir === 'cols' ? e.clientX : e.clientY) - s.start) / s.tot, min = MIN_PANE / s.tot, sum = s.a + s.b;
  const a = Math.max(min, Math.min(sum - min, s.a + delta));
  if (sum - a < min) return;
  s.n.sizes[s.i] = a; s.n.sizes[s.i + 1] = sum - a; s.moved = true; applyLayout();
});
window.addEventListener('pointerup', () => {
  if (!splitDrag) return;
  const s = splitDrag; splitDrag = null; s.d.classList.remove('dragging'); document.body.classList.remove('splitting');
  saveLay(); applyLayout();
});
work.addEventListener('keydown', e => {   // arrow keys move a focused divider
  const d = e.target.closest('.split'); if (!d) return;
  const { n, i, tot } = d._split, grow = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key]; if (!grow || (n.dir === 'cols') !== (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) return;
  e.preventDefault(); e.stopPropagation(); const min = MIN_PANE / tot, sum = n.sizes[i] + n.sizes[i + 1], a = Math.max(min, Math.min(sum - min, n.sizes[i] + grow * .02));
  n.sizes[i] = a; n.sizes[i + 1] = sum - a; saveLay(); const idx = [...work.querySelectorAll('.split')].indexOf(d); applyLayout(); const again = work.querySelectorAll('.split')[idx]; if (again) again.focus();
});
// a small drawing of each layout, made from the layout itself
function layIcon(tree) {
  const W = 56, H = 36; let s = '';
  const place = (n, x, y, w, h) => {
    if (typeof n === 'string') { s += `<rect x="${x + .5}" y="${y + .5}" width="${Math.max(0, w - 1)}" height="${Math.max(0, h - 1)}" fill="${n === '3d' ? 'var(--lay3d)' : 'var(--layflat)'}" stroke="var(--laystroke)"/>`; return; }
    let at = n.dir === 'cols' ? x : y; const tot = n.dir === 'cols' ? w : h;
    n.kids.forEach((k, i) => { const z = n.sizes[i] * tot; n.dir === 'cols' ? place(k, at, y, z, h) : place(k, x, at, w, z); at += z; });
  };
  place(tree, 0, 0, W, H);
  return `<svg viewBox="-1 -1 ${W + 2} ${H + 2}" width="58" height="38" aria-hidden="true">${s}</svg>`;
}
function fillLayPop() {
  document.getElementById('layPop').innerHTML = Object.entries(LAYOUTS).map(([k, l]) => `<button class="lay" data-lay="${k}" aria-pressed="${lay.key === k && !lay.max}">${layIcon(l.make())}<span>${l.name}</span></button>`).join('') + `<button class="btn line lreset" id="layReset">${ic('rotate-ccw')}Reset sizes of this layout</button>`;
}
function toggleLayPop(on) { const pop = document.getElementById('layPop'); pop.hidden = on === undefined ? !pop.hidden : !on; if (!pop.hidden) fillLayPop(); }
document.getElementById('bLayout').onclick = e => { e.stopPropagation(); toggleLayPop(); };
document.getElementById('layPop').addEventListener('click', e => {
  e.stopPropagation(); const b = e.target.closest('[data-lay]'); if (b) { setLayout(b.dataset.lay); return; }
  if (e.target.closest('#layReset')) { resetLayout(); toggleLayPop(false); }
});
window.addEventListener('pointerdown', e => { if (!e.target.closest('#lay') && !e.target.closest('[data-do="layouts"]')) { const pop = document.getElementById('layPop'); if (pop) pop.hidden = true; } });
// every pane gets a view picker; the 3D pane gets a full-size button too
work.querySelectorAll('.pane').forEach(pane => {
  const sel = document.createElement('select'); sel.className = 'vsel'; sel.setAttribute('aria-label', 'Choose the view shown here');
  sel.innerHTML = Object.entries(VIEW_NAMES).map(([k, n]) => `<option value="${k}">${n}</option>`).join('');
  sel.onchange = () => swapViews(pane.dataset.v, sel.value);
  sel.addEventListener('keydown', e => e.stopPropagation());
  pane.appendChild(sel);
});
work.appendChild(document.getElementById('secBar'));   // stays reachable in layouts with no 3D view
document.querySelector('#pane3d .vbar').insertAdjacentHTML('beforeend', `<button class="btn line" data-big title="Full size" aria-label="Full size">${ic('maximize-2')}</button>`);
document.querySelector('#pane3d [data-big]').onclick = () => setBig('3d');

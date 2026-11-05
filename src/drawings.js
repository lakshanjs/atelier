// ---------- workshop drawings ----------
// A set of A3 or A4 landscape sheets, all in paper millimetres: views with dimensions, sections, an exploded view with a
// parts list, and a drawing of each different part with every hole measured. Everything is worked out fresh from the design.
const PAPERS = { A3: [420, 297], A4: [297, 210] };
let PAGE_W = 420, PAGE_H = 297;
const MARGIN = 8, TITLE_H = 26, INK = '#20262a', SOFT = '#6a767c';
const paperOf = () => (P.drawing && PAPERS[P.drawing.paper] ? P.drawing.paper : 'A3');
function usePaper() { [PAGE_W, PAGE_H] = PAPERS[paperOf()]; return paperOf(); }
const SCALES = [1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30, 40, 50, 75, 100, 150, 200];
const scaleFor = (w, h, aw, ah) => SCALES.find(s => w / s <= aw && h / s <= ah) || SCALES.at(-1);
const nf = v => (Math.round(v * 100) / 100).toString();
const txt = (x, y, s, o = {}) => `<text x="${nf(x)}" y="${nf(y)}" font-family="Barlow,sans-serif" font-size="${o.size || 3}" font-weight="${o.w || 400}" fill="${o.fill || INK}" text-anchor="${o.a || 'start'}"${o.rot != null ? ` transform="rotate(${o.rot} ${nf(x)} ${nf(y)})"` : ''}>${esc(s)}</text>`;
const seg = (x1, y1, x2, y2, w = .18, extra = '') => `<line x1="${nf(x1)}" y1="${nf(y1)}" x2="${nf(x2)}" y2="${nf(y2)}" stroke="${INK}" stroke-width="${w}" ${extra}/>`;
const rectP = (x, y, w, h, sw = .18, fill = 'none') => `<rect x="${nf(x)}" y="${nf(y)}" width="${nf(w)}" height="${nf(h)}" fill="${fill}" stroke="${INK}" stroke-width="${sw}"/>`;
const clipText = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const TICK = 1.4;
function dimH(x0, x1, y, from, text) {   // a horizontal dimension at height y, with extension lines from `from`
  return seg(x0, from, x0, y + (y > from ? 1 : -1), .13) + seg(x1, from, x1, y + (y > from ? 1 : -1), .13) + seg(x0, y, x1, y, .15) + seg(x0 - TICK / 2, y + TICK / 2, x0 + TICK / 2, y - TICK / 2, .25) + seg(x1 - TICK / 2, y + TICK / 2, x1 + TICK / 2, y - TICK / 2, .25) + txt((x0 + x1) / 2, y - .9, text, { a: 'middle', size: 2.7 });
}
function dimV(y0, y1, x, from, text) {
  return seg(from, y0, x + (x > from ? 1 : -1), y0, .13) + seg(from, y1, x + (x > from ? 1 : -1), y1, .13) + seg(x, y0, x, y1, .15) + seg(x - TICK / 2, y0 + TICK / 2, x + TICK / 2, y0 - TICK / 2, .25) + seg(x - TICK / 2, y1 + TICK / 2, x + TICK / 2, y1 - TICK / 2, .25) + txt(x - .9, (y0 + y1) / 2, text, { a: 'middle', size: 2.7, rot: -90 });
}
const balloon = (x, y, n) => `<circle cx="${nf(x)}" cy="${nf(y)}" r="3" fill="#fff" stroke="${INK}" stroke-width=".2"/>` + txt(x, y + 1, String(n), { a: 'middle', size: 2.7, w: 600 });

// what goes in the drawings: the parts of the design that are shown
const drawParts = () => panelsOnly().filter(p => !isHidden(p));
const drawExtras = () => realItems().filter(i => i.kind !== 'panel');

// ---------- orthographic views ----------
function viewTransform(vn, list, x, y, w, h, scale) {
  const V = VIEWS[vn], u = unionBounds(list), k = 1 / scale, bw = (u.max[V.u] - u.min[V.u]) * k, bh = (u.max[V.v] - u.min[V.v]) * k;
  const ox = x + (w - bw) / 2 - u.min[V.u] * k, midV = (u.min[V.v] + u.max[V.v]) / 2, oy = y + h / 2 - V.sv * midV * k;
  return { k, ox, oy, u, box: [x + (w - bw) / 2, y + (h - bh) / 2, bw, bh] };
}
function itemOutline(vn, t, it, fill, sw = .3) {
  const ny = V3(0, 1, 0).applyQuaternion(Q(it)), V = VIEWS[vn];
  if (it.kind === 'panel' && hasShape(it) && Math.abs([ny.x, ny.y, ny.z][V.d]) > .999) {
    const q = Q(it), proj = c => { const w = V3(c[0], it.t / 2, c[1]).applyQuaternion(q); return toS(vn, t, [w.x + it.pos[0], w.y + it.pos[1], w.z + it.pos[2]]); }, d = pl => 'M' + pl.map(c => proj(c).map(nf).join(' ')).join('L') + 'Z';
    return `<path d="${d(outlinePts(it))}${it.shape.holes.filter(h => holeFits(it, h)).map(h => d(holePts(h))).join('')}" fill="${fill}" fill-rule="evenodd" stroke="${INK}" stroke-width="${sw}"/>`;
  }
  const pts = hull(corners(it).map(c => toS(vn, t, c)));
  return `<polygon points="${pts.map(p => p.map(nf).join(',')).join(' ')}" fill="${fill}" stroke="${INK}" stroke-width="${sw}"/>`;
}
const farFirst = (vn, list) => list.slice().sort((a, b) => VIEWS[vn].ds * (a.pos[VIEWS[vn].d] - b.pos[VIEWS[vn].d]));
// the edges that matter along one direction, merged where they'd be too close to label
function edgeRun(list, axis, minPaper, k) {
  const raw = [...new Set(list.flatMap(i => { const b = bounds(i); return [b.min[axis], b.max[axis]]; }).map(v => Math.round(v * 100) / 100))].sort((a, b) => a - b);
  const out = [];
  raw.forEach((v, i) => {
    if (!out.length) { out.push(v); return; }
    if ((v - out.at(-1)) * k < minPaper) { if (i === raw.length - 1 && out.length > 1) out[out.length - 1] = v; return; }
    out.push(v);
  });
  return out;
}
function orthoView(vn, title, list, extras, x, y, w, h, scale, marks = []) {
  const V = VIEWS[vn], t = viewTransform(vn, [...list, ...extras], x, y, w, h, scale), [bx, by, bw, bh] = t.box, k = t.k;
  let s = '';
  farFirst(vn, [...extras, ...list]).forEach(it => { s += itemOutline(vn, t, it, it.kind === 'panel' ? '#fff' : '#f1f3f2', it.kind === 'panel' ? .3 : .15); });
  // numbers on what's facing us, where there's room
  const placed = [], nearer = [];
  farFirst(vn, list).reverse().forEach(it => {
    const b = bounds(it), a = toS(vn, t, b.min), c = toS(vn, t, b.max), x0 = Math.min(a[0], c[0]), x1 = Math.max(a[0], c[0]), y0 = Math.min(a[1], c[1]), y1 = Math.max(a[1], c[1]), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const seen = !nearer.some(r => cx > r[0] && cx < r[1] && cy > r[2] && cy < r[3]);
    nearer.push([x0, x1, y0, y1]);
    if (!seen || x1 - x0 < 7 || y1 - y0 < 4.5 || placed.some(p => Math.abs(p[0] - cx) < 7 && Math.abs(p[1] - cy) < 4.5)) return;
    placed.push([cx, cy]); s += txt(cx, cy + 1, String(it.id), { a: 'middle', size: 2.6, fill: SOFT });
  });
  // overall size and the steps across it
  const u = t.u, Pu = v => t.ox + v * k, Pv = v => t.oy + V.sv * v * k, under = by + bh, left = bx;
  const runU = edgeRun(list, V.u, 7, k), runV = edgeRun(list, V.v, 7, k), chainU = runU.length > 2, chainV = runV.length > 2;
  if (chainU) for (let i = 0; i + 1 < runU.length; i++) s += dimH(Pu(runU[i]), Pu(runU[i + 1]), under + 6, under + .8, bare(runU[i + 1] - runU[i]));
  s += dimH(bx, bx + bw, under + (chainU ? 12 : 6), under + .8, fmt(u.max[V.u] - u.min[V.u]));
  if (chainV) for (let i = 0; i + 1 < runV.length; i++) s += dimV(Pv(runV[i]), Pv(runV[i + 1]), left - 6, left - .8, bare(runV[i + 1] - runV[i]));
  s += dimV(by, by + bh, left - (chainV ? 12 : 6), left - .8, fmt(u.max[V.v] - u.min[V.v]));
  marks.forEach(m => {   // where the sections are taken
    const horiz = m.axis === V.v, p = (horiz ? Pv : Pu)(m.at), ext = 5;
    s += horiz ? seg(bx - ext, p, bx + bw + ext, p, .18, 'stroke-dasharray="4 1.2 .8 1.2"') + txt(bx + bw + ext + 1, p + 1, m.name, { w: 600, size: 3.2 }) : seg(p, by - ext, p, by + bh + ext, .18, 'stroke-dasharray="4 1.2 .8 1.2"') + txt(p, by - ext - 1, m.name, { w: 600, size: 3.2, a: 'middle' });
  });
  s += txt(bx, by - 2.5, `${title}  1:${scale}`, { w: 600, size: 3.2 });
  return s;
}
function titleBlock(title, scaleText, n, of) {
  const d = P.drawing || {}, w = 190, x = PAGE_W - MARGIN - w, y = PAGE_H - MARGIN - TITLE_H, c = [x, x + 110, x + 150];
  const cell = (cx, cy, label, val, size = 3.2) => txt(cx + 1.5, cy + 3, label, { size: 2, fill: SOFT }) + txt(cx + 1.5, cy + 8, clipText(String(val), cx === c[0] ? 44 : 22), { size, w: 500 });
  return rectP(x, y, w, TITLE_H, .3, '#fff') + seg(x, y + 13, x + w, y + 13, .15) + seg(c[1], y, c[1], y + TITLE_H, .15) + seg(c[2], y, c[2], y + TITLE_H, .15)
    + cell(c[0], y, 'Project', P.name, 4) + cell(c[0], y + 13, 'Sheet', title) + cell(c[1], y, 'Client', d.client || '—') + cell(c[1], y + 13, 'Drawn by', d.by || '—') + cell(c[2], y, 'Scale', scaleText) + cell(c[2] + 20, y, 'Revision', d.rev || 'A') + cell(c[2], y + 13, 'Date', new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })) + cell(c[2] + 20, y + 13, 'Sheet no.', `${n} of ${of}`)
    + txt(x + w, y - 1.5, `${paperOf()}. Sizes in ${unitOf().name}. Do not scale from the drawing.`, { size: 2.2, fill: SOFT, a: 'end' });
}
const pageSvg = (inner, n) => `<svg class="dpage" data-page="${n}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${PAGE_W} ${PAGE_H}"><rect width="${PAGE_W}" height="${PAGE_H}" fill="#fff"/>${rectP(MARGIN / 2, MARGIN / 2, PAGE_W - MARGIN, PAGE_H - MARGIN, .4)}${inner}</svg>`;

// ---------- sheet 1: general arrangement ----------
function sectionPlanes(list) {
  const u = unionBounds(list);
  const clear = axis => {   // as near the middle as possible without running along a board
    const mid = (u.min[axis] + u.max[axis]) / 2, blocked = list.filter(i => isStraight(i) && fxLocalKey(i, axis) === 't').map(bounds).map(b => [b.min[axis], b.max[axis]]).sort((a, b) => a[0] - b[0]);
    if (!blocked.some(([a, b]) => mid >= a - 2 && mid <= b + 2)) return mid;
    const gaps = []; let at = u.min[axis];
    blocked.forEach(([a, b]) => { if (a - at > 10) gaps.push((a + at) / 2); at = Math.max(at, b); });
    if (u.max[axis] - at > 10) gaps.push((u.max[axis] + at) / 2);
    return gaps.length ? gaps.sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid))[0] : mid + 7;
  };
  return [{ name: 'A-A', axis: 0, at: clear(0), view: 'side', title: 'Section A-A' }, { name: 'B-B', axis: 2, at: clear(2), view: 'front', title: 'Section B-B' }, { name: 'C-C', axis: 1, at: clear(1), view: 'top', title: 'Section C-C' }];
}
function sheetScale(W, H, D, room, extraW) {
  const fullW = PAGE_W - MARGIN * 2 - 6, fullH = PAGE_H - MARGIN * 2 - 6;
  const fits = s => { const w = (W + D) / s + room * 2.8 + extraW, h = (H + D) / s + room * 2; return w <= fullW && (h <= fullH - TITLE_H - 3 || (h <= fullH && w <= fullW - 190 - 3)); };
  return SCALES.find(fits) || SCALES.at(-1);
}
function arrangementSheet(n, of) {
  const list = drawParts(), extras = drawExtras(), u = unionBounds([...list, ...extras]), W = u.max[0] - u.min[0], H = u.max[1] - u.min[1], D = u.max[2] - u.min[2];
  const room = 30, scale = sheetScale(W, H, D, room, 4), k = 1 / scale;
  const frontW = W * k + room * 1.4, frontH = H * k + room, topH = D * k + room, sideW = D * k + room * 1.4, x0 = MARGIN + 3, y0 = MARGIN + 3;
  const planes = sectionPlanes(list);
  let s = orthoView('top', 'Top', list, extras, x0, y0, frontW, topH, scale, [planes[1]]);
  s += orthoView('front', 'Front', list, extras, x0, y0 + topH, frontW, frontH, scale, [planes[0], planes[2]]);
  s += orthoView('side', 'Side', list, extras, x0 + frontW + 4, y0 + topH, sideW, frontH, scale);
  return { svg: pageSvg(s + titleBlock('General arrangement', `1:${scale}`, n, of), n), title: 'General arrangement' };
}

// ---------- sheet 2: sections ----------
function sectionView(plane, list, extras, x, y, w, h, scale) {
  const vn = plane.view, V = VIEWS[vn], t = viewTransform(vn, [...list, ...extras], x, y, w, h, scale), a = plane.axis, c = plane.at, hatchId = `hatch${plane.name.replace('-', '')}`;
  const keep = i => { const b = bounds(i); return V.ds > 0 ? b.min[a] <= c : b.max[a] >= c; }, cut = i => { const b = bounds(i); return b.min[a] < c && b.max[a] > c; };
  let s = `<defs><pattern id="${hatchId}" width="1.6" height="1.6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="1.6" stroke="${INK}" stroke-width=".35"/></pattern></defs>`;
  farFirst(vn, [...extras, ...list].filter(keep)).forEach(it => { if (!cut(it)) s += itemOutline(vn, t, it, it.kind === 'panel' ? '#fff' : '#f1f3f2', .15); });
  list.filter(cut).forEach(it => { const b = bounds(it), p = toS(vn, t, b.min), q = toS(vn, t, b.max), x0 = Math.min(p[0], q[0]), y0 = Math.min(p[1], q[1]), wd = Math.abs(p[0] - q[0]), ht = Math.abs(p[1] - q[1]); s += `<rect x="${nf(x0)}" y="${nf(y0)}" width="${nf(wd)}" height="${nf(ht)}" fill="url(#${hatchId})" stroke="${INK}" stroke-width=".35"/>`; });
  const Pu = v => t.ox + v * t.k, Pv = v => t.oy + V.sv * v * t.k, [bx, by, bw, bh] = t.box;
  const cuts = list.filter(cut), runU = edgeRun(cuts.length ? cuts : list, V.u, 7, t.k), runV = edgeRun(cuts.length ? cuts : list, V.v, 7, t.k);
  for (let i = 0; i + 1 < runU.length; i++) s += dimH(Pu(runU[i]), Pu(runU[i + 1]), by + bh + 6, by + bh + .8, bare(runU[i + 1] - runU[i]));
  for (let i = 0; i + 1 < runV.length; i++) s += dimV(Pv(runV[i]), Pv(runV[i + 1]), bx - 6, bx - .8, bare(runV[i + 1] - runV[i]));
  s += txt(bx, by - 2.5, `${plane.title}  1:${scale}`, { w: 600, size: 3.2 });
  return s;
}
function sectionsSheet(n, of) {
  const list = drawParts(), extras = drawExtras(), planes = sectionPlanes(list), u = unionBounds([...list, ...extras]), W = u.max[0] - u.min[0], H = u.max[1] - u.min[1], D = u.max[2] - u.min[2];
  const room = 22, scale = sheetScale(W, H, D, room, 2), k = 1 / scale;
  const x0 = MARGIN + 3, y0 = MARGIN + 3, h1 = H * k + room, wSide = D * k + room * 1.4, wFront = W * k + room * 1.4;
  let s = sectionView(planes[0], list, extras, x0, y0, wSide, h1, scale) + sectionView(planes[1], list, extras, x0 + wSide + 2, y0, wFront, h1, scale);
  s += sectionView(planes[2], list, extras, x0, y0 + h1, wFront, D * k + room, scale);
  return { svg: pageSvg(s + titleBlock('Sections', `1:${scale}`, n, of), n), title: 'Sections' };
}

// ---------- sheet 3: exploded view and parts list ----------
let drawGL = null;
function explodedPicture(list, pxW, pxH) {
  if (!drawGL) { drawGL = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true }); drawGL.setClearColor(0, 0); }
  drawGL.setPixelRatio(1); drawGL.setSize(pxW, pxH, false);
  const u = unionBounds(list), mid = u.min.map((v, i) => (v + u.max[i]) / 2), size = u.max.map((v, i) => v - u.min[i]), spread = .55;
  const sc = new THREE.Scene(), trash = [];
  sc.add(new THREE.HemisphereLight(0xffffff, 0xb6bdc0, .95)); const lamp = new THREE.DirectionalLight(0xffffff, .35); lamp.position.set(1, 2, 2); sc.add(lamp);
  const spots = list.map(it => {
    const off = it.pos.map((v, a) => { const d = (v - mid[a]) / Math.max(size[a], 1); return Math.abs(d) < .02 ? 0 : d * Math.max(...size) * spread; }), at = it.pos.map((v, a) => v + off[a]);
    const g = panelGeometry(it), m = new THREE.MeshStandardMaterial({ color: 0xeef0ef, roughness: .9, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }), mesh = new THREE.Mesh(g, m), q = Q(it);
    mesh.position.set(...at); mesh.quaternion.copy(q); sc.add(mesh); trash.push(g, m);
    const eg = new THREE.EdgesGeometry(g, 25), em = new THREE.LineBasicMaterial({ color: 0x20262a }), lines = new THREE.LineSegments(eg, em); lines.position.copy(mesh.position); lines.quaternion.copy(q); sc.add(lines); trash.push(eg, em);
    return { it, at };
  });
  const box = spots.reduce((b, { it, at }) => { const h = bounds(it); return { min: b.min.map((v, a) => Math.min(v, at[a] - (h.max[a] - h.min[a]) / 2)), max: b.max.map((v, a) => Math.max(v, at[a] + (h.max[a] - h.min[a]) / 2)) }; }, { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] });
  const c = V3(...box.min.map((v, a) => (v + box.max[a]) / 2)), r = Math.hypot(...box.max.map((v, a) => v - box.min[a])) / 2, cam = new THREE.PerspectiveCamera(20, pxW / pxH, 1, 1e7), fit = pxW >= pxH ? 9.5 : Math.atan(Math.tan(10 * Math.PI / 180) * pxW / pxH) * .95 * 180 / Math.PI, dist = r / Math.sin(fit * Math.PI / 180);
  cam.position.copy(c).add(V3(.75, .55, 1).normalize().multiplyScalar(dist)); cam.near = Math.max(1, dist - r * 2); cam.far = dist + r * 2; cam.lookAt(c); cam.updateProjectionMatrix(); cam.updateMatrixWorld();
  drawGL.render(sc, cam);
  const url = drawGL.domElement.toDataURL('image/png');
  trash.forEach(t => t.dispose()); drawGL.renderLists.dispose();
  return { url, spots: spots.map(({ it, at }) => { const p = V3(...at).project(cam); return { it, x: (p.x + 1) / 2, y: (1 - p.y) / 2 }; }) };
}
function partsListSvg(x, y, w, rows, maxY) {   // returns the drawing and how many rows fitted
  const f = w / 150, cols = [0, 14, 56, 70, 88, 106].map(v => v * f), heads = ['No.', 'Part', 'Qty', 'Length', 'Width', 'Thick, board'], room = Math.round(21 * f);
  let s = '', at = y; const rowH = 4.6;
  heads.forEach((h, i) => { s += txt(x + cols[i] + 1, at + 3.3, h, { size: 2.5, w: 600 }); }); s += seg(x, at + rowH, x + w, at + rowH, .25); at += rowH;
  let shown = 0;
  for (const r of rows) {
    if (at + rowH > maxY) break;
    const ids = r.ids.length > 2 ? `${r.ids[0]}…${r.ids.at(-1)}` : r.ids.join(',');
    [ids, clipText(r.part, room), String(r.qty), bare(r.len), bare(r.wid), clipText(`${bare(r.thk)} ${BOARDS[r.mat].name}`, Math.round(19 * f))].forEach((v, i) => { s += txt(x + cols[i] + 1, at + 3.3, v, { size: 2.5 }); });
    s += seg(x, at + rowH, x + w, at + rowH, .1); at += rowH; shown++;
  }
  return { svg: s, shown };
}
function explodedSheet(n, of) {
  const list = drawParts(), listW = PAGE_W >= 400 ? 150 : 112, imgX = MARGIN + 1, imgY = MARGIN + 1, imgW = PAGE_W - MARGIN * 2 - listW - 5, imgH = PAGE_H - MARGIN * 2 - 3;
  const pic = explodedPicture(list, Math.round(imgW * 6), Math.round(imgH * 6));
  let s = `<image href="${pic.url}" x="${imgX}" y="${imgY}" width="${imgW}" height="${imgH}"/>`;
  // numbers stand off from the parts so they don't cover each other, each on a short leader
  const taken = [], spots = pic.spots.map(p => ({ ...p, px: imgX + p.x * imgW, py: imgY + p.y * imgH }));
  spots.sort((a, b) => a.py - b.py).forEach(p => {
    let bx = p.px + 6, by = p.py - 5;
    for (let tries = 0; tries < 60 && taken.some(q => Math.hypot(q[0] - bx, q[1] - by) < 6.8); tries++) { const ang = tries * 2.4, rad = 6 + tries * .9; bx = p.px + Math.cos(ang) * rad; by = p.py + Math.sin(ang) * rad; }
    bx = Math.min(Math.max(imgX + 4, bx), imgX + imgW - 4); by = Math.min(Math.max(imgY + 4, by), imgY + imgH - 4);
    taken.push([bx, by]); s += seg(p.px, p.py, bx, by, .15) + `<circle cx="${nf(p.px)}" cy="${nf(p.py)}" r=".5" fill="${INK}"/>` + balloon(bx, by, p.it.id);
  });
  const lx = PAGE_W - MARGIN - listW - 1, maxY = PAGE_H - MARGIN - TITLE_H - 7, rows = cutRows().filter(r => r.ids.some(id => list.includes(byId(id))));
  const table = partsListSvg(lx, MARGIN + 7, listW, rows, maxY - 5);
  s += txt(lx, MARGIN + 5, 'Parts', { w: 600, size: 4 }) + table.svg;
  if (table.shown < rows.length) s += txt(lx, maxY - .5, `${rows.length - table.shown} more on the part sheets.`, { size: 2.4, fill: SOFT });
  return { svg: pageSvg(s + titleBlock('Exploded view and parts', 'Not to scale', n, of), n), title: 'Exploded view and parts' };
}

// ---------- part sheets ----------
const FACE_NAMES = { top: 'Top', bottom: 'Bottom', a: 'Back edge', b: 'Front edge', c: 'Left edge', d: 'Right edge' };
function partGroups() {   // parts that are truly the same, down to their holes, share a drawing
  const m = new Map(), rnd = v => (typeof v === 'number' ? r2(v) : v);
  drawParts().slice().sort((a, b) => a.id - b.id).forEach(p => {
    const ops = opsOf(p).map(o => JSON.stringify((o.k === 'hole' ? [o.x, o.y, o.z, o.d, o.depth, o.face, o.why] : [o.x0, o.z0, o.x1, o.z1, o.width, o.depth, o.face]).map(rnd))).sort();
    const sig = [p.name, r2(p.l), r2(p.w), r2(p.t), p.mat, bandLabel(p), shapeNote(p), p.grain || 'any', ops.join()].join('|');
    if (!m.has(sig)) m.set(sig, { it: p, ids: [] });
    m.get(sig).ids.push(p.id);
  });
  return [...m.values()];
}
function holeLines(it) {   // the holes as lines of text: grouped by what they are, each with where it is from the left and back edges
  const groups = new Map(), put = (key, v) => (groups.get(key) || groups.set(key, []).get(key)).push(v);
  opsOf(it).forEach(o => {
    if (o.k === 'groove') { const along = Math.abs(o.z0 - o.z1) < .01; put(`Groove ${bare(o.width)} wide × ${bare(o.depth)} deep, ${FACE_NAMES[o.face]}`, along ? `${bare(o.z0 + it.w / 2)} from back` : `${bare(o.x0 + it.l / 2)} from left`); return; }
    const key = `${o.why}: Ø${r2(o.d)} mm × ${o.through ? 'through' : `${r2(o.depth)} mm deep`}, ${FACE_NAMES[o.face]}${isFace(o.face) ? '' : ', along it from the end'}${o.jig ? ' (use a jig)' : ''}`;
    put(key, isFace(o.face) ? `(${bare(o.x + it.l / 2)}, ${bare(o.z + it.w / 2)})` : o.face === 'a' || o.face === 'b' ? `${bare(o.x + it.l / 2)}` : `${bare(o.z + it.w / 2)}`);
  });
  return [...groups.entries()];
}
const wrapList = (items, perLine) => { const out = []; for (let i = 0; i < items.length; i += perLine) out.push(items.slice(i, i + perLine).join('    ')); return out; };
const partPerLine = () => (PAGE_W >= 400 ? 5 : 3);
function partBlockHeight(group) {
  const lines = holeLines(group.it).reduce((n, [, pts]) => n + 1 + wrapList(pts, partPerLine()).length, 0);
  return Math.max(PAGE_W >= 400 ? 62 : 54, 18 + lines * 3.6);
}
function partBlock(group, x, y, w, h) {
  const it = group.it, drawW = w * .5, tableX = x + drawW + 4, tableW = w - drawW - 4, availW = drawW - 26, availH = h - 24;
  const scale = scaleFor(it.l, it.w, availW, availH), k = 1 / scale, pw = it.l * k, ph = it.w * k, cx = x + 16 + (availW - pw) / 2 + pw / 2, cy = y + 11 + (availH - ph) / 2 + ph / 2;
  const X = v => cx + v * k, Y = v => cy + v * k, path = pts => 'M' + pts.map(p => `${nf(X(p[0]))} ${nf(Y(p[1]))}`).join('L') + 'Z', L = it.l / 2, W = it.w / 2, e = edgesOf(it);
  let s = `<path d="${path(outlinePts(it))}${(it.shape ? it.shape.holes.filter(o => holeFits(it, o)) : []).map(o => path(holePts(o))).join('')}" fill="#fff" fill-rule="evenodd" stroke="${INK}" stroke-width=".35"/>`;
  [['a', [-L, -W], [L, -W]], ['b', [-L, W], [L, W]], ['c', [-L, -W], [-L, W]], ['d', [L, -W], [L, W]]].forEach(([n, p, q]) => { if (e[n]) s += seg(X(p[0]), Y(p[1]), X(q[0]), Y(q[1]), .9); });
  opsOf(it).forEach(o => {
    if (o.k === 'groove') { const dash = o.face === 'bottom' ? 'stroke-dasharray="1.2 .8"' : '', along = Math.abs(o.z0 - o.z1) < .01, hw = o.width / 2; s += along ? seg(X(o.x0), Y(o.z0 - hw), X(o.x1), Y(o.z1 - hw), .2, dash) + seg(X(o.x0), Y(o.z0 + hw), X(o.x1), Y(o.z1 + hw), .2, dash) : seg(X(o.x0 - hw), Y(o.z0), X(o.x1 - hw), Y(o.z1), .2, dash) + seg(X(o.x0 + hw), Y(o.z0), X(o.x1 + hw), Y(o.z1), .2, dash); return; }
    if (isFace(o.face)) { const r = Math.max(o.d / 2 * k, .35); s += `<circle cx="${nf(X(o.x))}" cy="${nf(Y(o.z))}" r="${nf(r)}" fill="${o.through ? INK : 'none'}" stroke="${INK}" stroke-width=".2"${o.face === 'bottom' && !o.through ? ' stroke-dasharray=".8 .5"' : ''}/>`; return; }
    const m = 1.6; s += o.face === 'a' ? seg(X(o.x), Y(-W) - m, X(o.x), Y(-W) + m, .25) : o.face === 'b' ? seg(X(o.x), Y(W) - m, X(o.x), Y(W) + m, .25) : o.face === 'c' ? seg(X(-L) - m, Y(o.z), X(-L) + m, Y(o.z), .25) : seg(X(L) - m, Y(o.z), X(L) + m, Y(o.z), .25);
  });
  const g = it.grain || 'any';
  if (g !== 'any') { const along = g === 'length' ? it.l >= it.w : it.l < it.w, n = 7; s += along ? seg(cx - n, cy, cx + n, cy, .25) + seg(cx + n - 1.6, cy - 1, cx + n, cy, .25) + seg(cx + n - 1.6, cy + 1, cx + n, cy, .25) : seg(cx, cy - n, cx, cy + n, .25) + seg(cx - 1, cy + n - 1.6, cx, cy + n, .25) + seg(cx + 1, cy + n - 1.6, cx, cy + n, .25); }
  s += dimH(X(-L), X(L), Y(W) + 5, Y(W) + .8, fmt(it.l)) + dimV(Y(-W), Y(W), X(-L) - 5, X(-L) - .8, fmt(it.w));
  const chars = Math.floor(w / 1.45), head = `${group.ids.length === 1 ? 'No.' : 'Nos.'} ${group.ids.join(', ')}: ${it.name}`;
  s += txt(x + 1, y + 4, clipText(head, chars), { w: 600, size: 3.4 }) + txt(x + 1, y + 8, clipText(`Make ${group.ids.length}. ${bare(it.t)}${unitMark()} ${BOARDS[it.mat].name}. Banding: ${bandLabel(it)}.${g !== 'any' ? ` Grain ${g === 'length' ? 'along the length' : 'across the width'}.` : ''}  1:${scale}`, chars), { size: 2.6, fill: SOFT });
  let ty = y + 13; const lines = holeLines(it), tableChars = Math.floor(tableW / 1.2);
  if (lines.length) { s += txt(tableX, ty, 'Holes: (from left, from back), seen from above', { size: 2.5, fill: SOFT }); ty += 3.8; }
  else s += txt(tableX, ty, clipText(shapeNote(it) || 'No holes.', tableChars), { size: 2.7, fill: SOFT });
  lines.forEach(([title, pts]) => {
    s += txt(tableX, ty, clipText(title, tableChars), { size: 2.6, w: 600 }); ty += 3.6;
    wrapList(pts, partPerLine()).forEach(t => { s += txt(tableX + 2, ty, t, { size: 2.5 }); ty += 3.6; });
  });
  if (lines.length && hasShape(it)) s += txt(tableX, ty, clipText(shapeNote(it), tableChars), { size: 2.5, fill: SOFT });
  return s + seg(x, y + h, x + w, y + h, .12);
}
function partPagesLayout() {   // which parts go on which sheet
  const pages = [], usable = PAGE_H - MARGIN * 2 - TITLE_H - 8; let cur = [], used = 0;
  partGroups().forEach(g => { const h = Math.min(partBlockHeight(g), usable); if (used + h > usable && cur.length) { pages.push(cur); cur = []; used = 0; } cur.push({ g, h }); used += h; });
  if (cur.length) pages.push(cur);
  return pages;
}
function partSheet(blocks, n, of) {
  let y = MARGIN + 2, s = ''; blocks.forEach(({ g, h }) => { s += partBlock(g, MARGIN + 2, y, PAGE_W - MARGIN * 2 - 4, h); y += h; });
  return { svg: pageSvg(s + titleBlock('Part drawings', 'As noted', n, of), n), title: 'Part drawings' };
}

// ---------- the set ----------
function buildDrawings() {
  usePaper();
  const list = drawParts(); if (!list.length) return [];
  const parts = partPagesLayout(), of = 3 + parts.length, out = [arrangementSheet(1, of), sectionsSheet(2, of), explodedSheet(3, of)];
  parts.forEach((b, i) => out.push(partSheet(b, 4 + i, of)));
  return out;
}
// The print size only applies while the drawings are open, so the cut list still prints as it always did.
function drawPageStyle(on) {
  let el = document.getElementById('drawPageStyle');
  if (!on) { if (el) el.remove(); return; }
  if (!el) { el = document.createElement('style'); el.id = 'drawPageStyle'; document.head.appendChild(el); }
  el.textContent = `@page { size: ${PAGE_W}mm ${PAGE_H}mm; margin: 0; } @media print { .dpage { width: ${PAGE_W}mm; height: ${PAGE_H}mm; } }`;
}
function renderDrawings() {
  const pages = buildDrawings(), d = P.drawing || {};
  document.getElementById('drawBody').innerHTML = pages.length ? pages.map(p => p.svg).join('') : '<p style="padding:30px">There are no panels yet. Go back and add some.</p>';
  ['client', 'by', 'rev'].forEach(k => { document.getElementById('dr_' + k).value = d[k] || ''; });
  document.getElementById('dr_paper').value = paperOf();
  drawPageStyle(true);
  return pages.length;
}
function openDrawings() { document.body.classList.add('drawing'); renderDrawings(); const el = document.getElementById('draw'); el.classList.add('open'); el.scrollTop = 0; }
function closeDrawings() { document.body.classList.remove('drawing'); document.getElementById('draw').classList.remove('open'); drawPageStyle(false); }
async function savePdf() {
  if (!(window.atelierWin && window.atelierWin.printPdf)) { window.print(); return; }
  let handle = null;
  if (window.showSaveFilePicker) { try { handle = await showSaveFilePicker({ suggestedName: `${P.name} drawings ${paperOf()}.pdf`, types: [{ description: 'PDF', accept: { 'application/pdf': ['.pdf'] } }] }); } catch (e) { if (e.name === 'AbortError') return; } }
  toast('Making the PDF…');
  try {
    const bytes = await window.atelierWin.printPdf();
    if (handle) { const w = await handle.createWritable(); await w.write(bytes); await w.close(); } else downloadBlob(`${P.name} drawings ${paperOf()}.pdf`, bytes, 'application/pdf');
    toast('PDF saved.');
  } catch (e) { toast(`Couldn't make the PDF: ${e.message}.`, true); }
}
document.getElementById('drawBack').onclick = closeDrawings;
document.getElementById('drawPdf').onclick = savePdf;
document.getElementById('drawPrint').onclick = () => window.print();
document.getElementById('dr_paper').onchange = e => { edit(() => { (P.drawing = P.drawing || {}).paper = e.target.value; }); renderDrawings(); document.getElementById('draw').scrollTop = 0; };
['client', 'by', 'rev'].forEach(k => {
  const el = document.getElementById('dr_' + k);
  el.addEventListener('keydown', e => e.stopPropagation());
  el.addEventListener('change', () => { edit(() => { (P.drawing = P.drawing || {})[k] = el.value.trim(); }); renderDrawings(); });
});

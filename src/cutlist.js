// ---------- cut list ----------
const panelsOnly = () => P.items.filter(i => i.kind === 'panel');
// edges: a and b run along the panel's length, c and d across its width
function edgesOf(p) {
  if (p.edges) return p.edges;
  const e = { a: false, b: false, c: false, d: false }, band = p.band || 'none';
  if (band === 'all') e.a = e.b = e.c = e.d = true;
  if (band === 'two') e.a = e.b = true;
  if (band === 'one') { const z = V3(0, 0, 1).applyQuaternion(Q(p)); (Math.abs(z.z) > .01 ? z.z > 0 : z.y > 0) ? e.b = true : e.a = true; }   // the edge facing the room
  delete p.band; p.edges = e; return e;
}
const bandLen = p => { const e = edgesOf(p); return (e.a ? p.l : 0) + (e.b ? p.l : 0) + (e.c ? p.w : 0) + (e.d ? p.w : 0); };
function bandLabel(p) {
  const e = edgesOf(p), al = (e.a ? 1 : 0) + (e.b ? 1 : 0), ac = (e.c ? 1 : 0) + (e.d ? 1 : 0), long = p.l >= p.w ? al : ac, short = p.l >= p.w ? ac : al;
  if (!long && !short) return '—'; if (long === 2 && short === 2) return 'All four edges';
  return [long ? `${long} long` : '', short ? `${short} short` : ''].filter(Boolean).join(', ');
}
const roleOf = it => it.role || (/Door/.test(it.name) ? 'door' : /Drawer front/.test(it.name) ? 'drawer' : /Shelf/.test(it.name) ? 'shelf' : 'panel');
const CORNER_KINDS = [['none', 'Square'], ['round', 'Rounded'], ['chamfer', 'Angled'], ['notch', 'Notch']];
const hasShape = it => it.shape && (it.shape.c.some(c => c.k !== 'none') || it.shape.holes.length);
const shapeOf = it => it.shape || (it.shape = { c: [0, 1, 2, 3].map(() => ({ k: 'none', a: 50, b: 50 })), holes: [] });
// the outline in the panel's own flat plane, centred; corners 1-4 go round from the back left
function outlinePts(it) {
  const L = it.l / 2, W = it.w / 2, P4 = [[-L, -W], [L, -W], [L, W], [-L, W]], out = [], s = it.shape;
  const maxC = Math.min(it.l, it.w) / 2;
  P4.forEach((c, i) => {
    const prev = P4[(i + 3) % 4], next = P4[(i + 1) % 4], unit = (a, b) => { const d = Math.hypot(b[0] - a[0], b[1] - a[1]); return [(b[0] - a[0]) / d, (b[1] - a[1]) / d]; };
    const inn = unit(prev, c), o = unit(c, next), k = s ? s.c[i] : { k: 'none' }, a = Math.min(k.a || 0, maxC), b = Math.min(k.k === 'round' ? a : k.b || 0, maxC), at = (m, n) => [c[0] + inn[0] * m + o[0] * n, c[1] + inn[1] * m + o[1] * n];
    if (k.k === 'chamfer') out.push(at(-a, 0), at(0, b));
    else if (k.k === 'notch') out.push(at(-a, 0), at(-a, b), at(0, b));
    else if (k.k === 'round' && a > 0) for (let n = 0; n <= 8; n++) { const q = n / 8 * Math.PI / 2; out.push(at(-a + a * Math.sin(q), a - a * Math.cos(q))); }
    else out.push(c);
  });
  return out;
}
function holePts(h) {
  if (h.k === 'circle') return Array.from({ length: 36 }, (_, i) => { const q = i / 36 * Math.PI * 2; return [h.x + Math.cos(q) * h.w / 2, h.z + Math.sin(q) * h.w / 2]; });
  return [[h.x - h.w / 2, h.z - h.h / 2], [h.x + h.w / 2, h.z - h.h / 2], [h.x + h.w / 2, h.z + h.h / 2], [h.x - h.w / 2, h.z + h.h / 2]];
}
const holeFits = (it, h) => { const hw = h.w / 2, hh = (h.k === 'circle' ? h.w : h.h) / 2; return h.w > 0 && hh > 0 && Math.abs(h.x) + hw < it.l / 2 - .5 && Math.abs(h.z) + hh < it.w / 2 - .5; };
function panelGeometry(it) {
  if (!hasShape(it)) return new THREE.BoxGeometry(it.l, it.t, it.w);
  const sh = new THREE.Shape(outlinePts(it).map(p => new THREE.Vector2(p[0], p[1])));
  it.shape.holes.filter(h => holeFits(it, h)).forEach(h => sh.holes.push(new THREE.Path(holePts(h).map(p => new THREE.Vector2(p[0], p[1])))));
  const g = new THREE.ExtrudeGeometry(sh, { depth: it.t, bevelEnabled: false, curveSegments: 12 });
  g.rotateX(Math.PI / 2); g.translate(0, it.t / 2, 0);
  return g;
}
function shapeNote(it) {
  if (!hasShape(it)) return '';
  const parts = [];
  it.shape.c.forEach((c, i) => { if (c.k === 'round') parts.push(`corner ${i + 1} rounded ${bare(c.a)}`); if (c.k === 'chamfer') parts.push(`corner ${i + 1} angled ${bare(c.a)} × ${bare(c.b)}`); if (c.k === 'notch') parts.push(`corner ${i + 1} notch ${bare(c.a)} × ${bare(c.b)}`); });
  it.shape.holes.forEach(h => parts.push(h.k === 'circle' ? `round hole ${bare(h.w)}` : `cut-out ${bare(h.w)} × ${bare(h.h)}`));
  return parts.join(', ');
}
// a picture of the panel laid flat: click its edges to band them
function panelPreview(it, interactive) {
  const W = 248, H = 130, k = Math.min((W - 44) / it.l, (H - 36) / it.w), cx = W / 2, cy = H / 2, X = v => cx + v * k, Y = v => cy + v * k;
  const path = pts => 'M' + pts.map(p => `${X(p[0]).toFixed(1)} ${Y(p[1]).toFixed(1)}`).join('L') + 'Z';
  const e = edgesOf(it), L = it.l / 2, Wd = it.w / 2, g = it.grain || 'any';
  let s = `<path d="${path(outlinePts(it))}${(it.shape ? it.shape.holes : []).map(h => path(holePts(h))).join('')}" fill="${MAT[panelColor(it)].f}" fill-rule="evenodd" stroke="#20262a"/>`;
  opsOf(it).forEach(o => { if (o.k === 'hole' && isFace(o.face)) s += `<circle cx="${X(o.x).toFixed(1)}" cy="${Y(o.z).toFixed(1)}" r="${Math.max(o.d / 2 * k, 1).toFixed(1)}" fill="${o.through ? '#20262a' : 'none'}" stroke="#20262a"${o.face === 'bottom' && !o.through ? ' stroke-dasharray="2 1.5"' : ''}/>`; else if (o.k === 'groove') s += `<line x1="${X(o.x0).toFixed(1)}" y1="${Y(o.z0).toFixed(1)}" x2="${X(o.x1).toFixed(1)}" y2="${Y(o.z1).toFixed(1)}" stroke="#20262a" stroke-width="${Math.max(o.width * k, 1).toFixed(1)}" stroke-opacity=".35"/>`; });
  [['a', [-L, -Wd], [L, -Wd]], ['b', [-L, Wd], [L, Wd]], ['c', [-L, -Wd], [-L, Wd]], ['d', [L, -Wd], [L, Wd]]].forEach(([n, p, q]) => {
    if (e[n]) s += `<line x1="${X(p[0])}" y1="${Y(p[1])}" x2="${X(q[0])}" y2="${Y(q[1])}" stroke="#e5a900" stroke-width="5"/>`;
    if (interactive) s += `<line data-edge="${n}" x1="${X(p[0])}" y1="${Y(p[1])}" x2="${X(q[0])}" y2="${Y(q[1])}" stroke="transparent" stroke-width="14" style="cursor:pointer"><title>Click to band this edge</title></line>`;
  });
  [[-L, -Wd, -9, -5], [L, -Wd, 9, -5], [L, Wd, 9, 12], [-L, Wd, -9, 12]].forEach(([a, b, dx, dy], i) => { s += `<text x="${X(a) + dx}" y="${Y(b) + dy}" font-size="11" text-anchor="middle" fill="var(--soft)" font-family="Barlow,sans-serif">${i + 1}</text>`; });
  if (g !== 'any') { const along = g === 'length' ? it.l >= it.w : it.l < it.w, len = 26; s += along ? `<path d="M${cx - len} ${cy}H${cx + len}M${cx + len - 6} ${cy - 4}L${cx + len} ${cy}L${cx + len - 6} ${cy + 4}" stroke="#20262a" fill="none"/>` : `<path d="M${cx} ${cy - len * .6}V${cy + len * .6}M${cx - 4} ${cy + len * .6 - 6}L${cx} ${cy + len * .6}L${cx + 4} ${cy + len * .6 - 6}" stroke="#20262a" fill="none"/>`; }
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block" role="img" aria-label="Panel seen flat">${s}</svg>`;
}
// ---------- sheets, prices, shopping list ----------
const stockOf = m => { P.stock = P.stock || {}; return P.stock[m] || (P.stock[m] = { sl: P.SL || 2438.4, sw: P.SW || 1219.2 }); };
const priceOf = (m, t) => (P.prices || {})[m + '|' + t] || 0;
const money = v => `${P.currency || 'Rs'} ${Math.round(v).toLocaleString('en-US')}`;
function sheetLines() {
  const rows = cutRows();
  return stocks(rows).map(([t, m]) => { const n = packSheets(rows, t, m).sheets.length, price = priceOf(m, t); return { t, m, n, price, cost: n * price }; });
}
const bandTotalMm = () => panelsOnly().reduce((a, p) => a + bandLen(p), 0) * 1.1;
const bandCost = () => (P.bandPrice || 0) * bandTotalMm() / 1000;
const hwPrice = label => (P.hwPrices || {})[label] || 0;
const hwCost = () => Object.keys(P.hwPrices || {}).length ? hardwareLines().reduce((a, [label, n]) => a + n * hwPrice(label), 0) : 0;
const totalCost = () => sheetLines().reduce((a, s) => a + s.cost, 0) + bandCost() + hwCost();
const JOINTS = { confirmat: 'Confirmat screws', dowel: 'Dowels and glue', pocket: 'Pocket screws', cam: 'Cam fittings' };
const defaultHinges = it => { const h = Math.max(it.l, it.w); return h <= 900 ? 2 : h <= 1500 ? 3 : h <= 2000 ? 4 : 5; };
function slideLength(it) {   // a drawer's slides match the side of its box, when it has one nearby
  if (it.slide) return it.slide;
  const b = bounds(it), box = panelsOnly().find(p => p.name === 'Drawer box side' && (() => { const q = bounds(p); return q.min[0] >= b.min[0] - 1 && q.max[0] <= b.max[0] + 1 && q.min[1] >= b.min[1] - 1 && q.max[1] <= b.max[1] + 1; })());
  return box ? Math.round(Math.max(box.l, box.w)) : 400;
}
const jointFixings = () => machining().fixings;   // the same joints the drawings and CNC files use
function hardwareLines() {
  const out = [], ps = panelsOnly();
  const doors = ps.filter(p => roleOf(p) === 'door'), hinges = doors.reduce((a, d) => a + (d.hinges ?? defaultHinges(d)), 0);
  if (hinges) out.push(['Hinges', hinges, `for ${doors.length} ${doors.length === 1 ? 'door' : 'doors'}`]);
  const slides = {}; ps.filter(p => roleOf(p) === 'drawer').forEach(d => { const l = slideLength(d); slides[l] = (slides[l] || 0) + 1; });
  Object.entries(slides).forEach(([l, n]) => out.push([`Drawer slides, ${fmt(+l)}`, n, n === 1 ? 'pair' : 'pairs']));
  const handles = P.items.filter(i => i.type === 'handle').length; if (handles) out.push(['Handles', handles, '']);
  const pins = ps.filter(p => p.adjustable).length * 4; if (pins) out.push(['Shelf pins', pins, '4 per adjustable shelf']);
  const j = jointFixings(); if (j) out.push([JOINTS[P.joint || 'confirmat'], j, 'estimate, about one every 200 mm']);
  return out;
}
function cutRows() {
  const m = new Map();
  panelsOnly().forEach(p => {
    const l = r2(Math.max(p.l, p.w)), w = r2(Math.min(p.l, p.w)), t = r2(p.t), c = p.mat, band = bandLabel(p), note = shapeNote(p), grain = p.grain || 'any', key = [p.name, l, w, t, c, band, note, grain].join('|');
    const e = m.get(key) || { ids: [], part: p.name, len: l, wid: w, thk: t, mat: c, band, note, grain, qty: 0 };
    e.qty++; e.ids.push(p.id); m.set(key, e);
  });
  return [...m.values()];
}
const stocks = rows => { const m = new Map(); rows.forEach(r => m.set(r.thk + '|' + r.mat, [r.thk, r.mat])); return [...m.values()].sort((a, b) => b[0] - a[0]); };
function packSheets(rows, thk, mat, o = {}) {   // o.gap and o.margin are for machines that need more room than a saw
  const k = o.gap ?? mach('kerf'), st = stockOf(mat), trim = (o.margin || 0) * 2, SL = st.sl - trim, SW = st.sw - trim, pieces = [];
  // the sheet's grain runs along its length: "along" keeps a part's length that way, "across" turns it, otherwise it may turn to fit
  rows.filter(r => r.thk === thk && r.mat === mat).forEach(r => r.ids.forEach(id => {
    let l = r.len, w = r.wid;
    if (r.grain === 'width') [l, w] = [r.wid, r.len];
    else if (r.grain === 'any' && (l > SL || w > SW) && w <= SL && l <= SW) [l, w] = [w, l];
    pieces.push({ id, l, w, grain: r.grain });
  }));
  const orders = [(a, b) => b.w - a.w || b.l - a.l, (a, b) => b.l - a.l || b.w - a.w, (a, b) => b.l * b.w - a.l * a.w, (a, b) => b.l + b.w - a.l - a.w];
  const fill = sh => sh.strips.reduce((a, t) => a + t.parts.reduce((b, q) => b + q.l * q.w, 0), 0);
  let best = null;
  orders.forEach(o => {
    const sheets = [], over = [];
    [...pieces].sort(o).forEach(pc => {
      if (pc.l > SL || pc.w > SW) { over.push(pc); return; }
      const col = sheets.flatMap(sh => sh.strips.flatMap(t => t.cols.map(c => ({ c, t })))).find(({ c, t }) => pc.l <= c.l && c.used + pc.w <= t.h);
      if (col) { col.t.parts.push({ ...pc, x: col.c.x, y: col.t.y + col.c.used }); col.c.used += pc.w + k; return; }
      let st = null;
      for (const sh of sheets) {
        st = sh.strips.find(t => pc.w <= t.h && t.used + pc.l <= SL);
        if (!st && sh.usedH + pc.w <= SW) { st = { y: sh.usedH, h: pc.w, used: 0, parts: [], cols: [] }; sh.strips.push(st); sh.usedH += pc.w + k; }
        if (st) break;
      }
      if (!st) { st = { y: 0, h: pc.w, used: 0, parts: [], cols: [] }; sheets.push({ usedH: pc.w + k, strips: [st] }); }
      st.parts.push({ ...pc, x: st.used, y: st.y }); st.cols.push({ x: st.used, l: pc.l, used: pc.w + k }); st.used += pc.l + k;
    });
    const r = { sheets, over };
    if (!best || sheets.length < best.sheets.length || (sheets.length === best.sheets.length && fill(sheets.at(-1) || { strips: [] }) < fill(best.sheets.at(-1) || { strips: [] }))) best = r;
  });
  return best;
}
// ---------- checks ----------
function checks() {
  const w = [], ps = panelsOnly(), objs = P.items.filter(i => i.kind === 'object' && i.type !== 'handle' && i.type !== 'floor' && !isHidden(i));
  const hitBoth = (a, b) => [0, 1, 2].every(k => Math.min(a.max[k], b.max[k]) - Math.max(a.min[k], b.min[k]) > .5);
  const pb = ps.map(p => ({ p, b: bounds(p), straight: isStraight(p) }));
  for (let i = 0; i < pb.length; i++) for (let j = i + 1; j < pb.length; j++) if (pb[i].straight && pb[j].straight && hitBoth(pb[i].b, pb[j].b)) w.push(`Panels ${pb[i].p.id} and ${pb[j].p.id} overlap.`);
  objs.forEach(o => { const b = bounds(o), c = pb.find(x => x.straight && hitBoth(x.b, b)); if (c) w.push(`${o.name} doesn't fit: it runs into panel ${c.p.id}.`); });
  pb.forEach(({ p, b, straight }) => {
    { const st = stockOf(p.mat), lg = Math.max(p.l, p.w), sm = Math.min(p.l, p.w), fits = p.grain === 'width' ? sm <= st.sl && lg <= st.sw : p.grain === 'length' ? lg <= st.sl && sm <= st.sw : (lg <= st.sl && sm <= st.sw) || (sm <= st.sl && lg <= st.sw); if (!fits) w.push(`Panel ${p.id} is too big for one sheet of ${BOARDS[p.mat].name} and needs a joint.`); }
    if (p.shape) p.shape.holes.forEach(h => { if (!holeFits(p, h)) w.push(`A cut-out on panel ${p.id} doesn't fit inside it, so it isn't being cut.`); });
    if (!straight) w.push(`Panel ${p.id} is at an angle. Tell your woodworker about any angled cuts.`);
    // long flat boards: the widest stretch with nothing holding them up
    if (straight && b.max[1] - b.min[1] < 60) {
      const ax = b.max[0] - b.min[0] >= b.max[2] - b.min[2] ? 0 : 2, oth = ax === 0 ? 2 : 0, span = b.max[ax] - b.min[ax];
      const limit = 800 * p.t / 19;   // thicker boards can span further
      if (span <= limit || b.min[1] < 1) return;   // lying on the floor can't sag
      const sup = pb.filter(o => o.p !== p).filter(o => {
        const below = Math.abs(o.b.max[1] - b.min[1]) < 1, atEnd = (Math.abs(o.b.max[ax] - b.min[ax]) < 1 || Math.abs(o.b.min[ax] - b.max[ax]) < 1) && o.b.max[1] > b.min[1] && o.b.min[1] < b.max[1];
        return (below || atEnd) && o.b.max[oth] > b.min[oth] && o.b.min[oth] < b.max[oth] && o.b.max[ax] >= b.min[ax] - 1 && o.b.min[ax] <= b.max[ax] + 1;
      }).map(o => [Math.max(o.b.min[ax], b.min[ax]), Math.min(o.b.max[ax], b.max[ax])]).sort((x, y) => x[0] - y[0]);
      let at = b.min[ax], gap = 0;
      sup.forEach(([a, c]) => { gap = Math.max(gap, a - at); at = Math.max(at, c); });
      gap = Math.max(gap, b.max[ax] - at);
      if (gap > limit) w.push(`Panel ${p.id} has ${fmt(gap)} with nothing under it and may sag.`);
    }
  });
  P.items.forEach(it => { if (it.type !== 'floor' && bounds(it).min[1] < -.5) w.push(`${it.kind === 'panel' ? 'Panel ' + it.id : it.name} goes below the floor.`); });
  fxIssues.forEach(t => w.push(t));
  machChecks().forEach(t => w.push(t));
  return [...new Set(w)];
}

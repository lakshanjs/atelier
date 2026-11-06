// ---------- model ----------
// A project is a flat list of items. Panels are cut from board; objects (books, fridge...) are only for looks and fit.
// Local axes: X = length, Y = thickness (height for objects), Z = width (depth for objects). World: X right, Y up, Z toward the room.
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const Q = it => new THREE.Quaternion(it.q[0], it.q[1], it.q[2], it.q[3]);
const setQ = (it, q) => { it.q = [q.x, q.y, q.z, q.w]; };
const IDQ = [0, 0, 0, 1];
let P, sel = [], undoS = [], redoS = [], dirty = true, big = '3d', guides = [], tool = 'select';
let clip = null, measA = null, mHover = null, flatBox = null, rep = { n: 3, axis: 1, step: 304.8 };
const byId = id => P.items.find(i => i.id === id);
const selected = () => sel.map(byId).filter(Boolean);
const movable = () => selected().filter(i => !i.locked);   // locked items never move, turn, resize or get deleted
// Boards you can buy. Thicknesses are starting points: any panel's thickness can be typed in.
const BOARDS = {
  eco: { name: 'Eco board', color: 'white', thick: [[18, '18 mm'], [19.05, '3/4"'], [12, '12 mm']] },
  ply: { name: 'Plywood', color: 'mdf', thick: [[18, '18 mm'], [12, '12 mm'], [9, '9 mm'], [6, '6 mm']] },
  mdf: { name: 'MDF', color: 'wood', thick: [[18, '18 mm'], [12, '12 mm'], [6, '6 mm']] },
  bass: { name: 'Basswood', color: 'bass', thick: [[10, '10 mm'], [6, '6 mm'], [3, '3 mm']] },
};
let lastBoard = { mat: 'eco', t: 19.05 };
// walls are ordinary objects that start locked, so clicks and drags pass through them
// the floor's top is at height 0
const floorItem = (x0, x1, z0, z1) => ({ kind: 'object', type: 'floor', name: 'Floor', l: x1 - x0, t: 20, w: z1 - z0, pos: [(x0 + x1) / 2, -10, (z0 + z1) / 2], q: IDQ.slice(), locked: true, gname: 'Room' });
const isRoomPart = i => i.type === 'wall' || i.type === 'floor';
const newProject = (name, items = [], o = {}) => {
  const p = { name, items: [], groups: [], nextId: 1, in: true, SL: 2438.4, SW: 1219.2, grid: 25.4, snap: true, noRoom: true, ...o };   // starts empty: walls and floors are added from the gallery when wanted
  const all = items;
  const gid = {};
  all.forEach(i => {
    if (i.gname) { if (!gid[i.gname]) { gid[i.gname] = p.nextId++; p.groups.push({ id: gid[i.gname], name: i.gname, hidden: false, open: false }); } i.group = gid[i.gname]; delete i.gname; }
    i.id = p.nextId++; p.items.push(i);
  });
  return p;
};
function nextId() { return P.nextId++; }
const groupOf = it => P.groups.find(g => g.id === it.group);
const levelOfGroup = g => (g && g.level && P.levels ? P.levels.find(l => l.id === g.level) : null);
const layerLabel = g => { const l = levelOfGroup(g); return l ? `${l.name}: ${g.name}` : g.name; };
const isHidden = it => { if (it.hidden) return true; if (!it.group) return !!P.looseHidden; const g = groupOf(it); if (!g) return false; const l = levelOfGroup(g); return !!(g.hidden || (l && l.hidden)); };
const shown = () => P.items.filter(i => !isHidden(i));
const realItems = () => shown().filter(i => !isRoomPart(i));
// projects saved before the floor became an object get one when opened
function ensureFloor(p) {
  if (p.noRoom || p.items.some(i => i.type === 'floor')) return p;
  const f = floorItem(-500, 3500, -500, 3000); f.id = p.nextId++; const room = p.groups.find(g => g.name === 'Room');
  if (room) f.group = room.id; delete f.gname; p.items.unshift(f); return p;
}

// a panel from a world box: the thinnest side is its thickness, the longest its length
function panelBox(name, [x0, x1, y0, y1, z0, z1], o = {}) {
  const d = [x1 - x0, y1 - y0, z1 - z0], order = [0, 1, 2].sort((a, b) => d[a] - d[b]);
  const [thin, mid, long] = order, e = i => V3(i === 0 ? 1 : 0, i === 1 ? 1 : 0, i === 2 ? 1 : 0);
  const X = e(long), Y = e(thin); let Z = e(mid);
  if (V3().crossVectors(X, Y).dot(Z) < 0) Z = Z.clone().multiplyScalar(-1);
  const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, Z));
  return { kind: 'panel', mat: 'eco', name, gname: name.startsWith('Back') ? 'Back panels' : undefined, l: d[long], w: d[mid], t: d[thin], pos: [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], q: [q.x, q.y, q.z, q.w], band: name.startsWith('Back') ? 'none' : /Door|Drawer front/.test(name) ? 'all' : /Drawer/.test(name) ? 'none' : 'one', ...o };
}
const obj = (type, x, y, z) => { const o = OBJ[type]; return { kind: 'object', type, name: o.name, l: o.w, t: o.h, w: o.d, pos: [x, y + o.h / 2, z + o.d / 2], q: IDQ.slice() }; };

// half-sizes of an item's upright bounding box
function bounds(it) {
  const m = new THREE.Matrix4().makeRotationFromQuaternion(Q(it)).elements, [a, b, c] = [it.l / 2, it.t / 2, it.w / 2];
  const h = [Math.abs(m[0]) * a + Math.abs(m[4]) * b + Math.abs(m[8]) * c, Math.abs(m[1]) * a + Math.abs(m[5]) * b + Math.abs(m[9]) * c, Math.abs(m[2]) * a + Math.abs(m[6]) * b + Math.abs(m[10]) * c];
  return { min: it.pos.map((p, i) => p - h[i]), max: it.pos.map((p, i) => p + h[i]) };
}
function unionBounds(list) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  list.forEach(it => { const b = bounds(it); for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], b.min[i]); max[i] = Math.max(max[i], b.max[i]); } });
  return { min, max };
}
function corners(it) {
  const q = Q(it), out = [];
  for (let i = 0; i < 8; i++) {
    const v = V3((i & 1 ? .5 : -.5) * it.l, (i & 2 ? .5 : -.5) * it.t, (i & 4 ? .5 : -.5) * it.w).applyQuaternion(q);
    out.push([v.x + it.pos[0], v.y + it.pos[1], v.z + it.pos[2]]);
  }
  return out;
}
const isStraight = it => { const m = new THREE.Matrix4().makeRotationFromQuaternion(Q(it)).elements; return [0, 1, 2, 4, 5, 6, 8, 9, 10].every(i => { const a = Math.abs(m[i]); return a < 1e-4 || a > .9999; }); };

// ---------- gallery catalogue ----------
const PANELS = [
  ['upright', 'Side panel', [0, 900, 300]], ['back', 'Back panel', [600, 900, 0]],
  ['door', 'Door', [450, 900, 0]], ['drawer', 'Drawer', null], ['leg', 'Leg', [60, 700, 60]], ['rail', 'Rail', [600, 60, 0]],
];
const CATALOG = [
  ['Books', [['books', 'Row of books', 300, 220, 160], ['tallbooks', 'Tall books', 300, 300, 220], ['stack', 'Stack of books', 250, 120, 180], ['puzzle', 'Puzzle boxes', 385, 220, 270]]],
  ['Decor', [['plant', 'Small plant', 150, 220, 150], ['bigplant', 'Tall plant', 250, 500, 250], ['vase', 'Vase', 120, 280, 120], ['frame', 'Photo frame', 200, 250, 30], ['box', 'Storage box', 300, 200, 250], ['bottles', 'Bottles', 240, 300, 80]]],
  ['Appliances', [['fridge', 'Mini fridge', 470, 510, 470], ['tv', 'TV', 1000, 620, 200], ['monitor', 'Monitor', 550, 420, 180], ['laptop', 'Laptop', 340, 220, 240], ['lamp', 'Desk lamp', 180, 400, 180]]],
  ['Fittings', [['handle', 'Handle', 128, 12, 25]]],
  ['Room', [['wall', 'Wall', 1500, 2500, 20], ['floor', 'Floor', 3000, 20, 2000]]],
];
const OBJ = {}; CATALOG.forEach(([, list]) => list.forEach(([type, name, w, h, d]) => { OBJ[type] = { type, name, w, h, d }; }));
const BOOKC = ['#8c3b2e', '#2e5c8c', '#c99a2e', '#3e7d5a', '#6b4a8c', '#2f7f85', '#cc7a33', '#4a4f52'];
const DK = '#2a2e31', POTC = '#b9c0bc', LEAFC = '#4c8a55';
function rnd(a) { const x = Math.sin(a * 12.9898) * 43758.5453; return x - Math.floor(x); }
// an object's parts, origin left / back / bottom, so gallery, flat views and 3D agree
function shapes(type, w, h, d, id = 1, cuts = null) {
  const seed = id * 7, out = [];
  const box = (s0, s1, u0, u1, z0, z1, c) => out.push({ a: [s0, s1, u0, u1, z0, z1], c });
  const ball = (s, u, z, r, c) => out.push({ ball: [s, u, z], r, c });
  if (type === 'books' || type === 'tallbooks') {
    let x = 0, i = 0;
    while (x < w - 12) { const th = Math.min(w - x, 18 + rnd(seed + i * 3) * 24); box(x, x + th - 1, 0, d * (.75 + rnd(seed + i * 2) * .25), 0, h * (.74 + rnd(seed + i) * .26), BOOKC[Math.floor(rnd(seed + i * 5) * 8)]); x += th; i++; }
  } else if (type === 'stack' || type === 'puzzle') {
    const n = Math.max(1, Math.round(h / (type === 'stack' ? 30 : 55))), lh = h / n;
    for (let i = 0; i < n; i++) { const sh = type === 'stack' ? rnd(seed + i) * .2 * w : 0; box(sh / 2, w - sh / 2, 0, d, i * lh, (i + 1) * lh - 1, BOOKC[Math.floor(rnd(seed + i * 5) * 8)]); }
  } else if (type === 'plant') {
    box(w * .2, w * .8, d * .2, d * .8, 0, h * .4, POTC); ball(w / 2, d / 2, h * .66, Math.min(w * .5, h * .34), LEAFC);
  } else if (type === 'bigplant') {
    box(w * .25, w * .75, d * .25, d * .75, 0, h * .28, POTC); box(w * .47, w * .53, d * .47, d * .53, h * .28, h * .7, '#6f4b31');
    ball(w * .5, d * .5, h * .78, Math.min(w * .45, h * .22), LEAFC); ball(w * .3, d * .5, h * .6, Math.min(w * .28, h * .13), LEAFC); ball(w * .7, d * .5, h * .62, Math.min(w * .28, h * .13), LEAFC);
  } else if (type === 'vase') {
    ball(w / 2, d / 2, h * .32, Math.min(w, h * .6) / 2, '#2f7f85'); box(w * .34, w * .66, d * .34, d * .66, h * .45, h, '#2f7f85');
  } else if (type === 'frame') {
    box(0, w, 0, d, 0, h, DK); box(w * .1, w * .9, d, d + 1, h * .1, h * .9, '#e6dfcf');
  } else if (type === 'box') {
    box(0, w, 0, d, 0, h * .86, '#c7a57d'); box(0, w, 0, d, h * .86, h, '#a9875f');
  } else if (type === 'bottles') {
    const n = Math.max(1, Math.round(w / 80)), bw = w / n;
    for (let i = 0; i < n; i++) { const c = ['#7a3b12', '#3d5a2a', '#9a5a1c'][i % 3], x = i * bw; box(x + bw * .08, x + bw * .92, 0, d, 0, h * .66, c); box(x + bw * .36, x + bw * .64, d * .3, d * .7, h * .66, h, c); }
  } else if (type === 'fridge') {
    box(0, w, 0, d - 25, 0, h, '#e9ecef'); box(0, w, d - 25, d, 8, h - 8, '#dfe3e6'); box(w - 45, w - 30, d - 1, d, h * .55, h * .85, '#6c757d');
  } else if (type === 'tv' || type === 'monitor') {
    const neck = h * .12; box(w * .3, w * .7, 0, d, 0, 12, DK); box(w * .46, w * .54, d * .4, d * .6, 12, neck, DK); box(0, w, d * .35, d * .65, neck, h, DK); box(w * .015, w * .985, d * .65, d * .65 + 1, neck + 10, h - 10, '#39505c');
  } else if (type === 'laptop') {
    box(0, w, 0, d, 0, 16, '#9aa1a5'); box(0, w, 0, 14, 16, h, '#9aa1a5'); box(w * .03, w * .97, 14, 15, 26, h - 8, '#39505c');
  } else if (type === 'lamp') {
    box(w * .15, w * .85, d * .15, d * .85, 0, 18, DK); box(w * .47, w * .53, d * .47, d * .53, 18, h * .68, DK); box(0, w, d * .1, d * .9, h * .68, h, '#f0e6c8');
  } else if (type === 'handle') {
    box(0, w, d * .5, d, 0, h, DK); box(w * .08, w * .16, 0, d * .5, 0, h, DK); box(w * .84, w * .92, 0, d * .5, 0, h, DK);
  } else if (type === 'wall') {
    const c = isDark() ? '#4b5357' : '#f3f4f1';
    if (!cuts || !cuts.length) box(0, w, 0, d, 0, h, c);
    else {
      const stops = [...new Set([0, w, ...cuts.flatMap(k => [k.s0 * w, k.s1 * w])])].sort((a, b) => a - b);
      stops.slice(1).forEach((b, i) => {
        const a = stops[i]; let at = 0;
        cuts.filter(k => k.s0 * w <= a + .01 && k.s1 * w >= b - .01).sort((x, y) => x.z0 - y.z0).forEach(k => { if (k.z0 * h > at) box(a, b, 0, d, at, k.z0 * h, c); at = Math.max(at, k.z1 * h); });
        if (at < h) box(a, b, 0, d, at, h, c);
      });
    }
  } else if (type === 'sh3d-door') {
    box(0, w, 0, d, 0, h, isDark() ? '#7d6a55' : '#b79a78');
  } else if (type === 'sh3d-glass') {
    box(0, w, 0, d, 0, h, '#a9cfe0');
  } else if (type === 'floor') {
    box(0, w, 0, d, 0, h, isDark() ? '#353c40' : '#d5d9d6');
  } else box(0, w, 0, d, 0, h, '#9aa1a5');
  return out;
}
function shapesSvg(list, X, Y, k) {
  return list.map(p => p.ball ? `<circle cx="${X(p.ball[0])}" cy="${Y(p.ball[2])}" r="${p.r * k}" fill="${p.c}"/>`
    : `<rect x="${X(p.a[0])}" y="${Y(p.a[5])}" width="${Math.max(.5, (p.a[1] - p.a[0]) * k)}" height="${Math.max(.5, (p.a[5] - p.a[4]) * k)}" fill="${p.c}"/>`).join('');
}
function objThumb(type, size = 50) {
  const o = OBJ[type], k = Math.min(size / o.w, size / o.h), ox = (size - o.w * k) / 2, oy = size - (size - o.h * k) / 2;
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true">${shapesSvg(shapes(type, o.w, o.h, o.d, 3), s => ox + s * k, z => oy - z * k, k)}</svg>`;
}
function panelThumb(type, size = 50) {
  const S = 'stroke="#20262a" stroke-width="1.3" stroke-linejoin="round"', W = '#dfe3e1';
  const g = {
    flat: `<path d="M6 30 22 20h22L28 30z" fill="${W}" ${S}/><path d="M6 30v4h22v-4M28 34l16-10v-4" fill="${W}" ${S}/>`,
    upright: `<path d="M16 6l14 8v30l-14-8z" fill="${W}" ${S}/><path d="M30 14l3-2v30l-3 2z" fill="${W}" ${S}/>`,
    back: `<rect x="10" y="8" width="30" height="36" fill="${W}" ${S}/>`,
    door: `<rect x="13" y="6" width="24" height="40" fill="${W}" ${S}/><path d="M32 22v8" stroke="#20262a" stroke-width="2"/>`,
    drawer: `<rect x="7" y="16" width="36" height="20" fill="${W}" ${S}/><path d="M17 26h16" stroke="#20262a" stroke-width="2"/>`,
    leg: `<rect x="21" y="6" width="8" height="40" fill="${W}" ${S}/>`,
    rail: `<rect x="5" y="21" width="40" height="8" fill="${W}" ${S}/>`,
  }[type];
  return `<svg viewBox="0 0 50 50" width="${size}" height="${size}" aria-hidden="true">${g}</svg>`;
}

// ---------- starting pieces ----------
const t19 = 19.05;
function cabinet(o) {
  const { name = '', x = 0, z = 40, w, h, d, kick = 75, t = t19, bt = t19, sideL = true, sideR = true, top = true, bottom = true, back = true } = o, out = [];
  const u0 = z + (back ? bt : 0), f = z + d, x0 = x + (sideL ? t : 0), x1 = x + w - (sideR ? t : 0), y0 = kick + (bottom ? t : 0), y1 = h - (top ? t : 0);
  if (sideL) out.push(panelBox('Side panel', [x, x + t, 0, h, u0, f]));
  if (sideR) out.push(panelBox('Side panel', [x + w - t, x + w, 0, h, u0, f]));
  if (top) out.push(panelBox('Top', [x0, x1, h - t, h, u0, f]));
  if (bottom) out.push(panelBox('Bottom', [x0, x1, kick, kick + t, u0, f]));
  if (kick) out.push(panelBox('Kick board', [x0, x1, 0, kick, f - t, f]));
  if (back) out.push(panelBox('Back panel', [x, x + w, 0, h, z, z + bt]));
  return { items: out, x0, x1, y0, y1, u0, f, t };
}
const evenly = (a, b, n, t) => { const g = (b - a - n * t) / (n + 1); return Array.from({ length: n }, (_, i) => a + g * (i + 1) + t * i); };
function drawerSet(x0, x1, y0, y1, front, u0, t = t19) {
  const out = [panelBox('Drawer front', [x0 + 2, x1 - 2, y0 + 2, y1 - 2, front - t, front])];
  const dep = Math.floor((front - t - u0 - 20) / 50) * 50, a = x0 + 13, b = x1 - 13, ub = front - t - dep, yb = y0 + 19, yt = y1 - 20;
  if (dep >= 100 && yt - yb >= 40 && b - a > 2 * t + 40) out.push(
    panelBox('Drawer box side', [a, a + t, yb, yt, ub, front - t]), panelBox('Drawer box side', [b - t, b, yb, yt, ub, front - t]),
    panelBox('Drawer box back', [a + t, b - t, yb, yt, ub, ub + t]), panelBox('Drawer box front', [a + t, b - t, yb, yt, front - 2 * t, front - t]),
    panelBox('Drawer base', [a, b, yb - 9, yb, ub, front - t]));
  const hy = (y0 + y1) / 2, hx = (x0 + x1) / 2;
  const h = obj('handle', hx, hy - 6, front); out.push(h);
  return out;
}
const DESIGN3 = `Side panel 1240.95 1260 19.05 520 0 992.15|Top 0 1240.95 19.05 520 973.1 992.15|Bottom 0 1240.95 19.05 520 75 94.05|Kick board 0 1240.95 500.95 520 0 75|Divider 711.9 730.95 19.05 520 94.05 624.05|Divider 704.02 723.07 19.05 520 643.1 973.1|Shelf 0 1240.95 19.05 520 624.05 643.1|Back panel 0 1260 0 19.05 0 992.15`;
const DESIGN3B = `Side panel 0 19.05 19.05 300 0 1853|Top 19.05 800 19.05 300 1833.95 1853|Bottom 19.05 800 19.05 300 75 94.05|Kick board 19.05 800 280.95 300 0 75|Kick board end 780.95 800 19.05 280.95 0 75|Divider 341.43 360.48 19.05 300 94.05 624.05|Divider 458.57 477.62 19.05 300 643.1 973.1|Divider 341.43 360.48 19.05 300 992.15 1262.15|Divider 458.57 477.62 19.05 300 1281.2 1551.2|Divider 341.43 360.48 19.05 300 1570.25 1833.95|Shelf 19.05 800 19.05 300 624.05 643.1|Shelf 19.05 800 19.05 300 973.1 992.15|Shelf 19.05 800 19.05 300 1262.15 1281.2|Shelf 19.05 800 19.05 300 1551.2 1570.25|Back panel 0 800 0 19.05 0 1853`;
const parseD3 = (src, map) => src.split('|').map(r => { const m = r.match(/^(.*?) ([\d. ]+)$/), v = m[2].split(' ').map(Number); return panelBox(m[1], map(v)); });
const TEMPLATES = [
  { name: 'Blank', sub: 'Start from an empty space', make: () => newProject('My furniture') },
  { name: 'Corner rack', sub: 'Your L-shaped Design 3', make: () => newProject('Corner rack', [
    ...parseD3(DESIGN3, ([s0, s1, u0, u1, z0, z1]) => [1260 - s1, 1260 - s0, z0, z1, 40 + u0, 40 + u1]),
    ...parseD3(DESIGN3B, ([s0, s1, u0, u1, z0, z1]) => [1560 - u1, 1560 - u0, z0, z1, 40 + s0, 40 + s1]),
  ].map((p, i) => { p.gname = p.gname || (i < 8 ? 'Wing A' : 'Wing B'); return p; })) },
  { name: 'Bookshelf', sub: 'Tall, with five shelves', make: () => {
    const c = cabinet({ x: 900, w: 800, h: 1980, d: 300 });
    evenly(c.y0, c.y1, 5, t19).forEach(y => c.items.push(panelBox('Shelf', [c.x0, c.x1, y, y + t19, c.u0, c.f])));
    return newProject('Bookshelf', c.items);
  } },
  { name: 'Cupboard', sub: 'Shelves behind two doors', make: () => {
    const c = cabinet({ x: 800, w: 1000, h: 1980, d: 500 }), mid = (c.x0 + c.x1) / 2, sf = c.f - t19 - 2;
    c.items.push(panelBox('Divider', [mid - t19 / 2, mid + t19 / 2, c.y0, c.y1, c.u0, c.f]));
    [[c.x0, mid - t19 / 2], [mid + t19 / 2, c.x1]].forEach(([a, b], i) => {
      evenly(c.y0, c.y1, 3, t19).forEach(y => c.items.push(panelBox('Shelf', [a, b, y, y + t19, c.u0, sf])));
      c.items.push(panelBox('Door', [a + 2, b - 2, c.y0 + 2, c.y1 - 2, c.f - t19, c.f]));
      const hx = i ? a + 40 : b - 40; c.items.push(rotObj(obj('handle', hx, (c.y0 + c.y1) / 2, c.f)));
    });
    return newProject('Cupboard', c.items);
  } },
  { name: 'Chest of drawers', sub: 'Four drawers', make: () => {
    const c = cabinet({ x: 900, w: 800, h: 900, d: 450 }), ys = evenly(c.y0, c.y1, 3, t19), edges = [c.y0, ...ys.flatMap(y => [y, y + t19]), c.y1];
    ys.forEach(y => c.items.push(panelBox('Shelf', [c.x0, c.x1, y, y + t19, c.u0, c.f])));
    for (let i = 0; i < edges.length; i += 2) c.items.push(...drawerSet(c.x0, c.x1, edges[i], edges[i + 1], c.f, c.u0));
    return newProject('Chest of drawers', c.items);
  } },
  { name: 'Desk', sub: 'Drawers on one side, knee room', make: () => {
    const c = cabinet({ x: 700, w: 1200, h: 750, d: 600, kick: 0, bottom: false, back: false }), a = c.x1 - 400 - t19;
    c.items.push(panelBox('Divider', [a, a + t19, 0, c.y1, c.u0, c.f]));
    const ys = evenly(0, c.y1, 2, t19), e = [0, ...ys.flatMap(y => [y, y + t19]), c.y1];
    ys.forEach(y => c.items.push(panelBox('Shelf', [a + t19, c.x1, y, y + t19, c.u0, c.f])));
    for (let i = 0; i < e.length; i += 2) c.items.push(...drawerSet(a + t19, c.x1, e[i], e[i + 1], c.f, c.u0));
    return newProject('Desk', c.items);
  } },
  { name: 'Table', sub: 'A top on four legs', make: () => {
    const x = 800, z = 500, w = 1200, d = 700, h = 750, s = 60;
    return newProject('Table', [panelBox('Top', [x, x + w, h - 25, h, z, z + d]),
      ...[[x + 30, z + 30], [x + w - 30 - s, z + 30], [x + 30, z + d - 30 - s], [x + w - 30 - s, z + d - 30 - s]].map(([a, b]) => panelBox('Leg', [a, a + s, 0, h - 25, b, b + s], { band: 'none' }))]);
  } },
  { name: 'TV unit', sub: 'Low, with doors each side', make: () => {
    const c = cabinet({ x: 600, w: 1800, h: 500, d: 400, kick: 60 }), n = (c.x1 - c.x0 - 2 * t19) / 3, a = c.x0 + n, b = a + t19 + n;
    c.items.push(panelBox('Divider', [a, a + t19, c.y0, c.y1, c.u0, c.f]), panelBox('Divider', [b, b + t19, c.y0, c.y1, c.u0, c.f]));
    [[c.x0, a], [b + t19, c.x1]].forEach(([p, q]) => c.items.push(panelBox('Door', [p + 2, q - 2, c.y0 + 2, c.y1 - 2, c.f - t19, c.f])));
    return newProject('TV unit', c.items);
  } },
  { name: 'Wall shelf', sub: 'One board on the wall', make: () => newProject('Wall shelf', [panelBox('Shelf', [1100, 1900, 1400, 1419.05, 0, 220])]) },
];
function rotObj(o) { const q = new THREE.Quaternion().setFromAxisAngle(V3(0, 0, 1), Math.PI / 2); setQ(o, q); o.pos = [o.pos[0], o.pos[1], o.pos[2]]; return o; }

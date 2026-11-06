// ---------- machining ----------
// Holes and grooves are worked out from how panels touch, every time they're needed, so they always follow the design.
// An operation is in the panel's own coordinates, centred: x along its length, z along its width, y through its thickness.
//   { k: 'hole', x, y, z, d, depth, face, why, jig?, through? }    face: 'top' (+Y), 'bottom' (-Y), or edge 'a' 'b' 'c' 'd'
//   { k: 'groove', x0, z0, x1, z1, width, depth, face, why }
// These are starting points for common hardware. They're all in Properties, so they can be matched to what's actually bought.
const MACH_DEFAULTS = {
  kerf: 4, jointFirst: 50, jointEvery: 200, thinBack: 10,
  confFace: 7, confEdge: 5, confDepth: 45,
  dowelD: 8, dowelFace: 12, dowelEdge: 20,
  camHousing: 15, camDepth: 13, camInset: 34, camBolt: 5, camBoltDepth: 12, camEdge: 8,
  pocketD: 9.5,
  pilotD: 3, pilotEdge: 2.5, pilotDepth: 20,
  pinD: 5, pinDepth: 12, pinFrom: 37, pinRows: 5, pinPitch: 32,
};
const mach = k => { const m = P.mach; return m && m[k] != null ? m[k] : MACH_DEFAULTS[k]; };
const MACH_FIELDS = [
  ['Saw cuts', [['kerf', 'Saw cut width']]],
  ['Joints', [['jointFirst', 'First fixing from the end'], ['jointEvery', 'Fixings about every'], ['confFace', 'Confirmat: through hole'], ['confEdge', 'Confirmat: edge hole'], ['confDepth', 'Confirmat: edge depth'], ['dowelD', 'Dowel diameter'], ['dowelFace', 'Dowel: face depth'], ['dowelEdge', 'Dowel: edge depth'], ['camHousing', 'Cam: housing diameter'], ['camDepth', 'Cam: housing depth'], ['camInset', 'Cam: housing from the end'], ['camBolt', 'Cam: bolt hole'], ['camBoltDepth', 'Cam: bolt depth'], ['camEdge', 'Cam: edge hole'], ['pocketD', 'Pocket hole mark'], ['thinBack', 'Boards thinner than this get screws']]],
  ['Shelf pins', [['pinD', 'Hole diameter'], ['pinDepth', 'Hole depth'], ['pinFrom', 'From front and back'], ['pinRows', 'Holes in each column', 'count'], ['pinPitch', 'Spacing up the column']]],
];
const CNC_DEFAULTS = { cutter: 6, drillMax: 12, feed: 3000, plunge: 800, rpm: 18000, step: 6, safeZ: 10, skin: .3, margin: 10, climb: false };
const cnc = k => { const m = P.cncTool; return m && m[k] != null ? m[k] : CNC_DEFAULTS[k]; };
const CNC_FIELDS = [['cutter', 'Cutter diameter', 'mm'], ['drillMax', 'Drill up to, then mill larger', 'mm'], ['feed', 'Cutting feed, mm/min', 'n'], ['plunge', 'Plunge feed, mm/min', 'n'], ['rpm', 'Spindle speed, rpm', 'n'], ['step', 'Depth per pass', 'mm'], ['safeZ', 'Safe height', 'mm'], ['skin', 'Skin left under parts', 'mm'], ['margin', 'Sheet margin', 'mm']];

// ---------- between the world and a panel ----------
const toLocal = (it, w) => { const v = V3(w[0] - it.pos[0], w[1] - it.pos[1], w[2] - it.pos[2]).applyQuaternion(Q(it).invert()); return [v.x, v.y, v.z]; };
const dirToLocal = (it, d) => { const v = V3(d[0], d[1], d[2]).applyQuaternion(Q(it).invert()); return [v.x, v.y, v.z]; };
const dirToWorld = (it, d) => { const v = V3(d[0], d[1], d[2]).applyQuaternion(Q(it)); return [v.x, v.y, v.z]; };
const EDGE_DIR = { a: [0, 0, -1], b: [0, 0, 1], c: [-1, 0, 0], d: [1, 0, 0], top: [0, 1, 0], bottom: [0, -1, 0] };
// the side of a panel that a world direction comes out of
function faceToward(it, dirW) { const d = dirToLocal(it, dirW); let best = 'top', v = -Infinity; Object.entries(EDGE_DIR).forEach(([k, e]) => { const c = e[0] * d[0] + e[1] * d[1] + e[2] * d[2]; if (c > v) { v = c; best = k; } }); return best; }
const hole = (it, wp, faceW, d, depth, why, o = {}) => {   // a hole at a world point, going in from the side that faces faceW
  const [x, y, z] = toLocal(it, wp), face = faceToward(it, faceW), L = it.l / 2, W = it.w / 2, T = it.t / 2;
  const max = face === 'top' || face === 'bottom' ? it.t : face === 'a' || face === 'b' ? it.w : it.l;
  const through = o.through || depth >= max;
  return { k: 'hole', x: face === 'c' ? -L : face === 'd' ? L : x, y: face === 'top' ? T : face === 'bottom' ? -T : y, z: face === 'a' ? -W : face === 'b' ? W : z, d, depth: Math.min(depth, max), face, why, through, ...o };
};
const isFace = f => f === 'top' || f === 'bottom';

// ---------- what touches what ----------
function panelContacts(list) {
  const out = [], box = list.map(bounds);
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const a = box[i], b = box[j];
    for (let k = 0; k < 3; k++) {
      const up = Math.abs(a.max[k] - b.min[k]) <= 1, down = Math.abs(b.max[k] - a.min[k]) <= 1; if (!up && !down) continue;
      const others = [0, 1, 2].filter(x => x !== k), over = others.map(x => [Math.max(a.min[x], b.min[x]), Math.min(a.max[x], b.max[x])]);
      if (!over.every(([p, q]) => q - p > 2)) continue;
      const lo = up ? list[i] : list[j], hi = up ? list[j] : list[i];   // lo sits on the low side of the plane
      out.push({ lo, hi, axis: k, plane: up ? (a.max[k] + b.min[k]) / 2 : (b.max[k] + a.min[k]) / 2, others, over });
      break;
    }
  }
  return out;
}
const unitAxis = (a, s = 1) => [a === 0 ? s : 0, a === 1 ? s : 0, a === 2 ? s : 0];
const fixingSpots = (lo, hi) => {
  const len = hi - lo, first = mach('jointFirst');
  if (len <= first * 2) return [(lo + hi) / 2];
  const n = Math.max(2, Math.floor(len / mach('jointEvery')) + 1);
  return Array.from({ length: n }, (_, i) => lo + first + (len - 2 * first) * i / (n - 1));
};

// ---------- working it all out ----------
let machCache = null, machFor = null;
const machInvalidate = () => { machCache = null; };
function machining() {
  if (machCache && machFor === P) return machCache;
  const ops = new Map(), add = (it, op) => { if (!ops.has(it.id)) ops.set(it.id, []); ops.get(it.id).push(op); };
  const notes = [], panels = panelsOnly().filter(p => isStraight(p)), contacts = panelContacts(panels);
  let fixings = 0;
  const all = panels.length ? unionBounds(panels) : null, centre = all ? all.min.map((v, i) => (v + all.max[i]) / 2) : [0, 0, 0];
  const style = P.joint || 'confirmat', faceUse = new Map();
  const inward = it => { const k = [0, 1, 2].find(a => fxLocalKey(it, a) === 't'), s = it.pos[k] <= centre[k] ? 1 : -1; return unitAxis(k, s); };   // a panel's hidden side, toward the middle of the piece

  // joints: one panel's edge against another's face
  contacts.forEach(c => {
    const kl = fxLocalKey(c.lo, c.axis), kh = fxLocalKey(c.hi, c.axis), loFace = kl === 't', hiFace = kh === 't';
    if (loFace === hiFace) return;
    const A = loFace ? c.hi : c.lo, B = loFace ? c.lo : c.hi, sign = A === c.hi ? 1 : -1;   // A's edge goes into B's face. sign points from the plane into A.
    if ([A, B].some(p => p.adjustable || ['door', 'drawer'].includes(roleOf(p)))) return;
    const thinAxis = c.others.find(x => fxLocalKey(A, x) === 't'), runAxis = c.others.find(x => x !== thinAxis);
    if (thinAxis == null || runAxis == null) return;
    const thinSpan = c.over[c.others.indexOf(thinAxis)], runSpan = c.over[c.others.indexOf(runAxis)], mid = (thinSpan[0] + thinSpan[1]) / 2;
    if (thinSpan[1] - thinSpan[0] < 6) return;
    const intoA = unitAxis(c.axis, sign), intoB = unitAxis(c.axis, -sign);
    const room = Math.max(mach('confFace'), mach('dowelD'), mach('camBolt'), mach('pilotD')) + 3, taken = faceUse.get(B.id) || faceUse.set(B.id, []).get(B.id);
    fixingSpots(runSpan[0], runSpan[1]).forEach(spot => {
      // boards meeting the same panel from both sides would share a hole, so one moves along
      const clear = v => v >= runSpan[0] + 10 && v <= runSpan[1] - 10 && !taken.some(q => q.r === runAxis && Math.abs(q.at - v) < room && Math.abs(q.thin - mid) < room);
      const at = [0, 32, -32, 64, -64, 96, -96].map(d => spot + d).find(clear) ?? spot;
      taken.push({ r: runAxis, at, thin: mid });
      const w = []; w[c.axis] = c.plane; w[thinAxis] = mid; w[runAxis] = at;
      const faceB = intoA.map(v => v), faceA = intoB.map(v => v);   // holes go in from the side facing the joint
      fixings++;
      if (B.t < mach('thinBack')) {
        add(B, hole(B, w, faceB, mach('pilotD'), B.t, 'Screw', { through: true, to: A.id }));
        add(A, hole(A, w, faceA, mach('pilotEdge'), mach('pilotDepth'), 'Screw', { to: B.id }));
      } else if (style === 'confirmat') {
        add(B, hole(B, w, faceB, mach('confFace'), B.t, 'Confirmat', { through: true, to: A.id }));
        add(A, hole(A, w, faceA, mach('confEdge'), mach('confDepth'), 'Confirmat', { to: B.id }));
      } else if (style === 'dowel') {
        add(B, hole(B, w, faceB, mach('dowelD'), Math.min(mach('dowelFace'), B.t - 3), 'Dowel', { to: A.id }));
        add(A, hole(A, w, faceA, mach('dowelD'), mach('dowelEdge'), 'Dowel', { to: B.id }));
      } else if (style === 'cam') {
        const inset = w.slice(); inset[c.axis] += sign * mach('camInset');
        add(A, hole(A, inset, inward(A), mach('camHousing'), mach('camDepth'), 'Cam housing', { to: B.id }));
        add(A, hole(A, w, faceA, mach('camEdge'), mach('camInset'), 'Cam bolt', { to: B.id }));
        add(B, hole(B, w, faceB, mach('camBolt'), Math.min(mach('camBoltDepth'), B.t - 3), 'Cam bolt', { to: A.id }));
      } else {
        const inset = w.slice(); inset[c.axis] += sign * 25;
        add(A, hole(A, inset, inward(A), mach('pocketD'), 12, 'Pocket hole', { jig: true, to: B.id }));
      }
    });
  });

  // doors: cups in the door, plate screws in the panel beside it
  const doors = panels.filter(p => roleOf(p) === 'door');
  doors.forEach(door => {
    const n = door.hinges ?? defaultHinges(door), hw = hwFor(door, 'hinge'); if (!n) return;
    const dBox = bounds(door), normalAxis = [0, 1, 2].find(a => fxLocalKey(door, a) === 't');
    const inWard = centre[normalAxis] > door.pos[normalAxis] ? 1 : -1;
    const along = door.l >= door.w ? 'l' : 'w', runA = [0, 1, 2].find(a => fxLocalKey(door, a) === along), acrossA = [0, 1, 2].find(a => a !== normalAxis && a !== runA);
    // the panel it hangs from: an upright beside one of its long edges
    const near = side => panels.filter(p => p !== door && fxLocalKey(p, acrossA) === 't' && ['door', 'drawer'].indexOf(roleOf(p)) < 0).map(p => ({ p, b: bounds(p) })).filter(({ b }) => Math.min(b.max[runA], dBox.max[runA]) - Math.max(b.min[runA], dBox.min[runA]) > 20 && Math.abs((inWard > 0 ? b.min[normalAxis] - dBox.max[normalAxis] : dBox.min[normalAxis] - b.max[normalAxis])) < 60).map(o => ({ ...o, gap: side < 0 ? Math.abs(o.b.max[acrossA] - dBox.min[acrossA]) : Math.abs(o.b.min[acrossA] - dBox.max[acrossA]), other: side < 0 ? Math.abs(o.b.min[acrossA] - dBox.min[acrossA]) : Math.abs(o.b.max[acrossA] - dBox.max[acrossA]) })).sort((x, y) => Math.min(x.gap, x.other) - Math.min(y.gap, y.other))[0];
    const handle = P.items.find(i => i.type === 'handle' && (() => { const b = bounds(i); return [runA, acrossA].every(a => b.max[a] > dBox.min[a] && b.min[a] < dBox.max[a]); })());
    let side = door.hingeSide === 'low' ? -1 : door.hingeSide === 'high' ? 1 : 0;
    const low = near(-1), high = near(1);
    if (!side && handle) side = handle.pos[acrossA] > door.pos[acrossA] ? -1 : 1;
    if (!side) side = low && (!high || Math.min(low.gap, low.other) <= Math.min(high.gap, high.other)) ? -1 : 1;
    const edgeAt = side < 0 ? dBox.min[acrossA] : dBox.max[acrossA], ends = Math.min(hw.ends, (dBox.max[runA] - dBox.min[runA]) / 3);
    const faceIn = unitAxis(normalAxis, inWard), host = side < 0 ? low : high;
    for (let i = 0; i < n; i++) {
      const at = n === 1 ? door.pos[runA] : dBox.min[runA] + ends + (dBox.max[runA] - dBox.min[runA] - 2 * ends) * i / (n - 1), w = [];
      w[normalAxis] = inWard > 0 ? dBox.max[normalAxis] : dBox.min[normalAxis]; w[runA] = at; w[acrossA] = edgeAt - side * hw.cupInset;
      add(door, hole(door, w, faceIn, hw.cupD, hw.cupDepth, 'Hinge cup'));
      if (hw.cupScrewD > 0) [-1, 1].forEach(s => { const q = w.slice(); q[runA] += s * hw.cupScrewPitch / 2; q[acrossA] -= side * hw.cupScrewOffset; add(door, hole(door, q, faceIn, hw.cupScrewD, Math.min(hw.plateDepth, door.t - 3), 'Hinge cup screw')); });
      if (host) {
        const front = inWard > 0 ? host.b.min[normalAxis] : host.b.max[normalAxis], hostFace = unitAxis(acrossA, door.pos[acrossA] >= host.p.pos[acrossA] ? 1 : -1);
        [-1, 1].forEach(s => { const q = []; q[acrossA] = door.pos[acrossA] >= host.p.pos[acrossA] ? host.b.max[acrossA] : host.b.min[acrossA]; q[runA] = at + s * hw.platePitch / 2; q[normalAxis] = front + inWard * hw.plateFrom; if (q[runA] > host.b.min[runA] && q[runA] < host.b.max[runA] && (inWard > 0 ? q[normalAxis] < host.b.max[normalAxis] : q[normalAxis] > host.b.min[normalAxis])) add(host.p, hole(host.p, q, hostFace, hw.plateD, hw.plateDepth, 'Hinge plate', { to: door.id })); });
      }
    }
    if (!host) notes.push(`Door ${door.id} has nothing beside it to hang from, so its plate screws aren't drawn.`);
  });

  // adjustable shelves: columns of pin holes in what's at each end
  panels.filter(p => p.adjustable).forEach(shelf => {
    const sBox = bounds(shelf), upA = [0, 1, 2].find(a => fxLocalKey(shelf, a) === 't');
    const hosts = panels.filter(p => p !== shelf && !['door', 'drawer'].includes(roleOf(p))).map(p => ({ p, b: bounds(p) })).filter(({ p, b }) => {
      const a = [0, 1, 2].find(x => fxLocalKey(p, x) === 't'); if (a === upA || a === undefined || fxLocalKey(shelf, a) !== (shelf.l >= shelf.w ? 'l' : 'w')) return false;   // only what's at the shelf's ends, not the back behind it
      return (Math.abs(b.max[a] - sBox.min[a]) <= 3 || Math.abs(b.min[a] - sBox.max[a]) <= 3) && b.min[upA] < sBox.min[upA] && b.max[upA] > sBox.max[upA];
    });
    hosts.forEach(({ p, b }) => {
      const a = [0, 1, 2].find(x => fxLocalKey(p, x) === 't'), depthA = [0, 1, 2].find(x => x !== a && x !== upA), lo = Math.max(b.min[depthA], sBox.min[depthA]), hi = Math.min(b.max[depthA], sBox.max[depthA]), onHigh = Math.abs(b.max[a] - sBox.min[a]) <= 3;
      [lo + mach('pinFrom'), hi - mach('pinFrom')].forEach(d => {
        const rows = Math.max(1, Math.round(mach('pinRows')));
        for (let r = 0; r < rows; r++) {
          const y = sBox.min[upA] + (r - (rows - 1) / 2) * mach('pinPitch'); if (y < b.min[upA] + 5 || y > b.max[upA] - 5) continue;
          const w = []; w[a] = onHigh ? b.max[a] : b.min[a]; w[depthA] = d; w[upA] = y;
          add(p, hole(p, w, unitAxis(a, onHigh ? 1 : -1), mach('pinD'), mach('pinDepth'), 'Shelf pin', { to: shelf.id }));
        }
      });
    });
  });

  // drawers: slide screws in the panels each side
  panels.filter(p => roleOf(p) === 'drawer').forEach(front => {
    const fBox = bounds(front), normalAxis = [0, 1, 2].find(a => fxLocalKey(front, a) === 't'), inWard = centre[normalAxis] > front.pos[normalAxis] ? 1 : -1;
    const across = [0, 1, 2].filter(a => a !== normalAxis), acrossA = fBox.max[across[0]] - fBox.min[across[0]] >= fBox.max[across[1]] - fBox.min[across[1]] ? across[0] : across[1], upA = across.find(a => a !== acrossA), L = slideLength(front), hw = hwFor(front, 'slide'), boxes = drawerBoxSides(front).map(p => ({ p, b: bounds(p) }));
    [-1, 1].forEach(s => {
      const edge = s < 0 ? fBox.min[acrossA] : fBox.max[acrossA];
      const host = panels.filter(p => p !== front && fxLocalKey(p, acrossA) === 't' && !['door', 'drawer'].includes(roleOf(p)) && !/Drawer/.test(p.name)).map(p => ({ p, b: bounds(p) })).filter(({ b }) => b.min[upA] <= front.pos[upA] && b.max[upA] >= front.pos[upA] && (s < 0 ? b.max[acrossA] <= edge + 25 : b.min[acrossA] >= edge - 25) && Math.abs(s < 0 ? b.max[acrossA] - edge : b.min[acrossA] - edge) < 60).sort((x, y) => Math.abs((s < 0 ? x.b.max[acrossA] : x.b.min[acrossA]) - edge) - Math.abs((s < 0 ? y.b.max[acrossA] : y.b.min[acrossA]) - edge))[0];
      if (!host) { notes.push(`Drawer ${front.id} has nothing to carry its slide on one side, so those screws aren't drawn.`); return; }
      const start = inWard > 0 ? host.b.min[normalAxis] : host.b.max[normalAxis];
      (hw.holes || []).filter(d => d <= L - 10).forEach(d => {
        const w = []; w[acrossA] = s < 0 ? host.b.max[acrossA] : host.b.min[acrossA]; w[upA] = front.pos[upA]; w[normalAxis] = start + inWard * d;
        if (inWard > 0 ? w[normalAxis] < host.b.max[normalAxis] : w[normalAxis] > host.b.min[normalAxis]) add(host.p, hole(host.p, w, unitAxis(acrossA, -s), hw.screwD, hw.screwDepth, 'Slide screw', { to: front.id }));
      });
      // the drawer box: screws on its outer face, and the gap the slide needs
      const box = boxes.filter(o => (o.p.pos[acrossA] < front.pos[acrossA]) === (s < 0))[0];
      if (box) {
        const face = s < 0 ? box.b.min[acrossA] : box.b.max[acrossA], gap = Math.abs(face - (s < 0 ? host.b.max[acrossA] : host.b.min[acrossA])), boxStart = inWard > 0 ? box.b.min[normalAxis] : box.b.max[normalAxis];
        if (Math.abs(gap - hw.clearance) > 1) notes.push(`Drawer ${front.id}: the box leaves ${fmt(gap)} for a slide that needs ${fmt(hw.clearance)}.`);
        (hw.boxHoles || []).filter(d => d <= L - 10).forEach(d => { const w = []; w[acrossA] = face; w[upA] = Math.min(Math.max(front.pos[upA], box.b.min[upA] + 5), box.b.max[upA] - 5); w[normalAxis] = boxStart + inWard * d; if (inWard > 0 ? w[normalAxis] < box.b.max[normalAxis] : w[normalAxis] > box.b.min[normalAxis]) add(box.p, hole(box.p, w, unitAxis(acrossA, s), hw.screwD, Math.min(hw.screwDepth, box.p.t - 3), 'Slide screw', { to: front.id })); });
      }
    });
  });

  // anything added by hand, measured from the panel's left and back edges so it stays put as the panel changes size
  panelsOnly().forEach(it => (it.ops || []).forEach((o, i) => {
    if (o.k === 'hole') add(it, { k: 'hole', x: o.x - it.l / 2, y: o.face === 'bottom' ? -it.t / 2 : it.t / 2, z: o.z - it.w / 2, d: o.d, depth: Math.min(o.depth, it.t), face: o.face, why: 'Hole', through: o.depth >= it.t, manual: i });
    if (o.k === 'groove') { const along = o.axis === 'l', at = (along ? o.z - it.w / 2 : o.x - it.l / 2); add(it, { k: 'groove', x0: along ? -it.l / 2 : at, z0: along ? at : -it.w / 2, x1: along ? it.l / 2 : at, z1: along ? at : it.w / 2, width: o.width, depth: Math.min(o.depth, it.t), face: o.face, why: 'Groove', manual: i }); }
  }));
  machCache = { ops, notes, fixings }; machFor = P;
  return machCache;
}
const opsOf = it => machining().ops.get(it.id) || [];

// ---------- things that can't be made ----------
function machChecks() {
  const out = [...machining().notes];
  machining().ops.forEach((list, id) => {
    const it = byId(id); if (!it) return;
    list.forEach(o => {
      if (o.k !== 'hole') return;
      if (isFace(o.face) && !o.through && o.depth > it.t - 2) out.push(`Panel ${id}: a ${o.why.toLowerCase()} hole ${fmt(o.depth)} deep nearly goes through this ${fmt(it.t)} board.`);
      if (!isFace(o.face) && o.d >= it.t - 2) out.push(`Panel ${id} is too thin for a ${o.why.toLowerCase()} hole in its edge.`);
      if (isFace(o.face) && (Math.abs(o.x) + o.d / 2 > it.l / 2 + .01 || Math.abs(o.z) + o.d / 2 > it.w / 2 + .01)) out.push(`Panel ${id}: a ${o.why.toLowerCase()} hole runs off the edge.`);
    });
    const faces = list.filter(o => o.k === 'hole' && isFace(o.face));
    for (let i = 0; i < faces.length; i++) for (let j = i + 1; j < faces.length; j++) {
      const a = faces[i], b = faces[j]; if (a.face !== b.face && !(a.through || b.through)) continue;
      if (Math.hypot(a.x - b.x, a.z - b.z) < (a.d + b.d) / 2) out.push(`Panel ${id}: a ${a.why.toLowerCase()} hole and a ${b.why.toLowerCase()} hole run into each other.`);
    }
  });
  return out;
}

// ---------- flat layout on a sheet ----------
// Which way up a part lies: the face with most work on it faces up, so the machine reaches it.
// up=true: looking down on the panel's +Y face. The maps keep the part's handedness, so what's drawn is what's made.
function partLayout(it, q, ox, oy) {
  const list = opsOf(it), up = list.filter(o => o.face === 'top' || o.through).length >= list.filter(o => o.face === 'bottom').length;
  const turn = Math.abs(it.l - q.l) > .01, cx = ox + q.x + q.l / 2, cy = oy + q.y + q.w / 2;
  const map = up ? (turn ? p => [cx + p[1], cy + p[0]] : p => [cx + p[0], cy - p[1]]) : (turn ? p => [cx + p[1], cy - p[0]] : p => [cx + p[0], cy + p[1]]);
  return { up, map, faceUp: up ? 'top' : 'bottom', cx, cy, list };
}
const reachable = (o, l) => o.through || o.face === l.faceUp;

const mmName = v => String(Math.round(v * 100) / 100).replace('.', '_') + 'MM';
// DXF (R12, the most widely read version), in millimetres. A layer's name says what to do with it:
// CUT_18MM, DRILL_D5_Z12, GROOVE_W6_Z8, and FLIP_ or EDGE_ for what can't be reached from this side.
function sheetDxf(entries) {   // entries: [{ sheet: {sl, sw, title}, parts: [{ it, q }], ox, oy }]
  const out = [], f = v => (Math.round(v * 1000) / 1000).toString(), line = (...a) => a.forEach(x => out.push(String(x)));
  const layers = new Map([['SHEET', 8], ['LABELS', 3]]), body = [], put = (...a) => a.forEach(x => body.push(String(x))), lay = (n, c) => { if (!layers.has(n)) layers.set(n, c); return n; };
  const poly = (pts, layer) => { put(0, 'POLYLINE', 8, layer, 66, 1, 70, 1); pts.forEach(p => put(0, 'VERTEX', 8, layer, 10, f(p[0]), 20, f(p[1]), 30, 0)); put(0, 'SEQEND', 8, layer); };
  const circle = (c, r, layer) => put(0, 'CIRCLE', 8, layer, 10, f(c[0]), 20, f(c[1]), 30, 0, 40, f(r));
  const text = (x, y, h, s) => put(0, 'TEXT', 8, 'LABELS', 10, f(x), 20, f(y), 30, 0, 40, f(h), 1, s);
  entries.forEach(({ sheet, parts, ox = 0, oy = 0 }) => {
    if (sheet) { poly([[ox, oy], [ox + sheet.sl, oy], [ox + sheet.sl, oy + sheet.sw], [ox, oy + sheet.sw]], 'SHEET'); if (sheet.title) text(ox, oy + sheet.sw + 20, 40, sheet.title); }
    parts.forEach(({ it, q }) => {
      const l = partLayout(it, q, ox, oy), depth = mmName(r2(it.t));
      poly(outlinePts(it).map(l.map), lay(`CUT_${depth}`, 7));
      if (it.shape) it.shape.holes.filter(h => holeFits(it, h)).forEach(h => {
        if (h.k === 'circle') circle(l.map([h.x, h.z]), h.w / 2, lay(`HOLES_${depth}`, 1));
        else poly(holePts(h).map(l.map), lay(`HOLES_${depth}`, 1));
      });
      l.list.forEach(o => {
        if (o.k === 'groove') { const a = l.map([o.x0, o.z0]), b = l.map([o.x1, o.z1]), nm = `${reachable(o, l) ? '' : 'FLIP_'}GROOVE_W${mmName(o.width).replace('MM', '')}_Z${mmName(o.depth).replace('MM', '')}`; put(0, 'LINE', 8, lay(nm, 4), 10, f(a[0]), 20, f(a[1]), 30, 0, 11, f(b[0]), 21, f(b[1]), 31, 0); return; }
        const size = `D${mmName(o.d).replace('MM', '')}_Z${mmName(o.depth).replace('MM', '')}`;
        if (!isFace(o.face)) circle(l.map([o.x, o.z]), o.d / 2, lay(`EDGE_${size}`, 6));
        else if (o.jig) circle(l.map([o.x, o.z]), o.d / 2, lay('JIG_POCKET', 6));
        else circle(l.map([o.x, o.z]), o.d / 2, lay(`${reachable(o, l) ? '' : 'FLIP_'}DRILL_${size}`, reachable(o, l) ? 5 : 6));
      });
      text(l.cx, l.cy, Math.min(40, q.w / 3), `${it.name} ${it.id}${l.up ? '' : ' (other side up)'}`);
    });
  });
  line(0, 'SECTION', 2, 'HEADER', 9, '$ACADVER', 1, 'AC1009', 9, '$INSUNITS', 70, 4, 0, 'ENDSEC');
  line(0, 'SECTION', 2, 'TABLES', 0, 'TABLE', 2, 'LAYER', 70, layers.size); layers.forEach((c, n) => line(0, 'LAYER', 2, n, 70, 0, 62, c, 6, 'CONTINUOUS')); line(0, 'ENDTAB', 0, 'ENDSEC');
  line(0, 'SECTION', 2, 'ENTITIES'); out.push(...body); line(0, 'ENDSEC', 0, 'EOF');
  return out.join('\r\n') + '\r\n';
}
function dxfText() {
  const rows = cutRows(), entries = []; let oy = 0;
  stocks(rows).forEach(([t, m]) => {
    const { sheets, over } = packSheets(rows, t, m), { sl, sw } = stockOf(m);
    sheets.forEach((sh, i) => {
      entries.push({ sheet: { sl, sw, title: `${BOARDS[m].name} ${t} mm, sheet ${i + 1}` }, parts: sh.strips.flatMap(st => st.parts).map(q => ({ it: byId(q.id), q })).filter(x => x.it), oy });
      oy += sw + 200;
    });
    if (over.length) { let x = 0; entries.push({ parts: over.map(pc => { const q = { id: pc.id, x, y: 0, l: pc.l, w: pc.w }; x += pc.l + 50; return { it: byId(pc.id), q }; }).filter(e => e.it), oy }); oy += Math.max(...over.map(o => o.w)) + 200; }
  });
  return sheetDxf(entries);
}

// ---------- G-code ----------
// For a 3-axis router. Z0 is the top of the sheet, X0 Y0 its corner. Check it in a simulator before cutting anything.
function offsetPoly(pts, by) {   // positive grows a counter-clockwise outline
  const n = pts.length, out = [];
  for (let i = 0; i < n; i++) {
    const p = pts[(i + n - 1) % n], c = pts[i], q = pts[(i + 1) % n];
    let ax = c[0] - p[0], ay = c[1] - p[1], bx = q[0] - c[0], by2 = q[1] - c[1]; const al = Math.hypot(ax, ay) || 1, bl = Math.hypot(bx, by2) || 1; ax /= al; ay /= al; bx /= bl; by2 /= bl;
    const nx = ay + by2, ny = -ax - bx, nl = Math.hypot(nx, ny) || 1, k = by / Math.max(.3, (nx / nl) * ay + (ny / nl) * -ax);
    out.push([c[0] + nx / nl * k, c[1] + ny / nl * k]);
  }
  return out;
}
const ccw = pts => (area2(pts) < 0 ? pts.slice().reverse() : pts);
function sheetGcode({ title, thickness, placed, sl, sw }) {
  const f = v => (Math.round(v * 1000) / 1000).toString(), out = [], R = cnc('cutter') / 2, safe = cnc('safeZ'), feed = cnc('feed'), plunge = cnc('plunge'), step = Math.max(.5, cnc('step')), rpm = cnc('rpm');
  const passes = depth => { const z = []; for (let d = step; d < depth - .001; d += step) z.push(d); z.push(depth); return z; };
  const cutter = { n: 1, d: cnc('cutter') }, drills = new Map(); let nextT = 2;
  const drillTool = d => { if (Math.abs(d - cnc('cutter')) < .01) return cutter; if (!drills.has(d)) drills.set(d, { n: nextT++, d }); return drills.get(d); };
  const jobs = { drill: new Map(), mill: [], groove: [], inside: [], outside: [] }, skipped = [];
  placed.forEach(({ it, q, ox = 0, oy = 0 }) => {
    const l = partLayout(it, q, ox, oy);
    l.list.forEach(o => {
      if (!reachable(o, l) || o.jig || (o.k === 'hole' && !isFace(o.face))) return;
      const c = o.k === 'hole' ? l.map([o.x, o.z]) : null;
      if (o.k === 'groove') { if (o.width < cnc('cutter')) { skipped.push(`Panel ${it.id}: a ${o.width} mm groove is narrower than the cutter`); return; } jobs.groove.push({ a: l.map([o.x0, o.z0]), b: l.map([o.x1, o.z1]), width: o.width, depth: o.depth, it }); return; }
      const depth = o.through ? it.t + .5 : o.depth;
      if (o.d <= cnc('drillMax')) { const t = drillTool(o.d); (jobs.drill.get(t) || jobs.drill.set(t, []).get(t)).push({ c, depth, it }); }
      else if (o.d >= cnc('cutter')) jobs.mill.push({ c, r: o.d / 2, depth, it });
      else skipped.push(`Panel ${it.id}: a ${o.d} mm hole`);
    });
    if (it.shape) it.shape.holes.filter(h => holeFits(it, h)).forEach(h => {
      if (h.k === 'circle' && h.w >= cnc('cutter')) jobs.mill.push({ c: l.map([h.x, h.z]), r: h.w / 2, depth: it.t + .5, it });
      else if (h.k !== 'circle') jobs.inside.push({ pts: ccw(holePts(h).map(l.map)), depth: it.t + .5, it });
    });
    jobs.outside.push({ pts: ccw(outlinePts(it).map(l.map)), depth: Math.max(.5, it.t - cnc('skin')), it });
  });
  const emit = (...a) => out.push(...a), g0 = (x, y) => emit(`G0 X${f(x)} Y${f(y)}`), up = () => emit(`G0 Z${f(safe)}`);
  const tool = t => { emit('', 'M5', `G0 Z${f(safe)}`, `(Change to tool ${t.n}: ${t.d} mm ${t === cutter ? 'cutter' : 'drill'})`, `T${t.n} M6`, `S${rpm} M3`, 'G4 P3'); };
  // header
  emit(`(${String(title).replace(/[()]/g, '')})`, `(Sheet ${f(sl)} x ${f(sw)} x ${f(thickness)} mm. Z0 = top of sheet. X0 Y0 = sheet corner.)`, '(From Atelier. Check in a simulator before cutting.)');
  emit('G21', 'G90', 'G17', `G0 Z${f(safe)}`);
  jobs.drill.forEach((list, t) => {
    tool(t);
    list.forEach(h => { g0(h.c[0], h.c[1]); emit(`G1 Z${f(-h.depth)} F${plunge}`, `G0 Z${f(safe)}`); });
  });
  const anyMill = jobs.mill.length || jobs.groove.length || jobs.inside.length || jobs.outside.length;
  if (anyMill) tool(cutter);
  jobs.mill.forEach(h => {
    const max = h.r - R; g0(h.c[0], h.c[1]);
    passes(h.depth).forEach(d => {
      emit(`G1 Z${f(-d)} F${plunge}`);
      for (let r = Math.min(R * 1.2, max); r > 0; r = r >= max ? 0 : Math.min(r + R * 1.2, max)) { emit(`G1 X${f(h.c[0] + r)} Y${f(h.c[1])} F${feed}`, `G2 X${f(h.c[0] + r)} Y${f(h.c[1])} I${f(-r)} J0 F${feed}`); }
      emit(`G1 X${f(h.c[0])} Y${f(h.c[1])} F${feed}`);
    });
    up();
  });
  jobs.groove.forEach(g => {
    const dx = g.b[0] - g.a[0], dy = g.b[1] - g.a[1], len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len, extra = g.width - cnc('cutter'), n = Math.max(1, Math.ceil(extra / (cnc('cutter') * .7)) + 1);
    for (let i = 0; i < n; i++) {
      const o = n === 1 ? 0 : -extra / 2 + extra * i / (n - 1), a = [g.a[0] + nx * o, g.a[1] + ny * o], b = [g.b[0] + nx * o, g.b[1] + ny * o];
      g0(a[0], a[1]);
      passes(g.depth).forEach((d, p) => { const e = p % 2 ? a : b; emit(`G1 Z${f(-d)} F${plunge}`, `G1 X${f(e[0])} Y${f(e[1])} F${feed}`); });
      up();
    }
  });
  const contour = (pts, depth, by) => {
    const path = offsetPoly(pts, by), order = cnc('climb') === (by > 0) ? path.slice().reverse() : path;   // conventional cut unless climb is chosen
    g0(order[0][0], order[0][1]);
    passes(depth).forEach(d => { emit(`G1 Z${f(-d)} F${plunge}`); order.slice(1).concat([order[0]]).forEach(p => emit(`G1 X${f(p[0])} Y${f(p[1])} F${feed}`)); });
    up();
  };
  jobs.inside.forEach(j => contour(j.pts, j.depth, -R));
  jobs.outside.forEach(j => contour(j.pts, j.depth, R));
  emit('', 'M5', `G0 Z${f(safe)}`, 'G0 X0 Y0', 'M30', '');
  const tools = [...jobs.drill.keys()].map(t => `(T${t.n}: ${t.d} mm drill)`); if (anyMill) tools.unshift(`(T1: ${cutter.d} mm cutter)`);
  out.splice(3, 0, ...tools);
  return { text: out.join('\r\n'), skipped };
}
// The whole job: a DXF and a G-code file for each sheet, and a list of what has to be done by hand or from the other side.
function cncJob() {
  const rows = cutRows(), files = [], skipped = [], gap = Math.max(mach('kerf'), cnc('cutter') + 2), margin = cnc('margin'), overs = [];
  stocks(rows).forEach(([t, m]) => {
    const { sheets, over } = packSheets(rows, t, m, { gap, margin }), { sl, sw } = stockOf(m), tag = `${BOARDS[m].name} ${String(t).replace('.', '_')}mm`.replace(/\W+/g, '_');
    overs.push(...over.map(o => o.id));
    sheets.forEach((sh, i) => {
      const placed = sh.strips.flatMap(st => st.parts).map(q => ({ it: byId(q.id), q, ox: margin, oy: margin })).filter(x => x.it), name = `${tag}_sheet${i + 1}`;
      files.push({ name: `${name}.dxf`, text: sheetDxf([{ sheet: { sl, sw, title: `${BOARDS[m].name} ${t} mm, sheet ${i + 1}` }, parts: placed.map(p => ({ it: p.it, q: { ...p.q, x: p.q.x + margin, y: p.q.y + margin } })) }]) });
      const g = sheetGcode({ title: `${P.name}, ${BOARDS[m].name} ${t} mm, sheet ${i + 1}`, thickness: t, placed, sl, sw });
      files.push({ name: `${name}.nc`, text: g.text }); skipped.push(...g.skipped);
    });
  });
  const lines = ['Part,Number,What,Side,From left mm,From back mm,Height mm,Diameter mm,Depth mm'], faceName = { top: 'Top face', bottom: 'Bottom face', a: 'Back edge', b: 'Front edge', c: 'Left edge', d: 'Right edge' };
  panelsOnly().forEach(it => { const l = partLayout(it, { l: it.l, x: 0, y: 0, w: it.w }, 0, 0); opsOf(it).forEach(o => { if (o.k !== 'hole' || (reachable(o, l) && isFace(o.face) && !o.jig)) return; lines.push([`"${it.name.replace(/"/g, '""')}"`, it.id, o.why, faceName[o.face], r2(o.x + it.l / 2), r2(o.z + it.w / 2), isFace(o.face) ? '' : r2(o.y + it.t / 2), o.d, r2(o.depth)].join(',')); }); });
  files.push({ name: 'by_hand_edges_and_other_side.csv', text: lines.join('\r\n') + '\r\n' });
  return { files, skipped, overs };
}
async function exportCnc() {
  if (!panelsOnly().length) { toast('There are no panels to cut.', true); return; }
  const job = cncJob(), enc = new TextEncoder(), bytes = await zipBytes(job.files.map(f => ({ name: f.name, data: enc.encode(f.text) })));
  downloadBlob(`${P.name} CNC.zip`, bytes, 'application/zip');
  const left = [...job.skipped, ...(job.overs.length ? [`too big for a sheet: ${job.overs.join(', ')}`] : [])];
  toast(left.length ? `CNC files made. Left out: ${left.slice(0, 3).join('; ')}.` : 'CNC files made. Check them in a simulator before cutting.', !!left.length);
}

// ---------- panel controls ----------
function machSectionHtml(it) {
  const list = opsOf(it), counts = new Map();
  list.forEach(o => { const k = o.k === 'hole' ? `${o.why}, ${r2(o.d)} mm` : `${o.why}, ${r2(o.width)} mm wide`; counts.set(k, (counts.get(k) || 0) + 1); });
  let b = list.length ? `<ul class="opsum">${[...counts].map(([k, n]) => `<li>${n} × ${esc(k)}</li>`).join('')}</ul>` : '<p class="note" style="margin:0 0 6px">No holes yet. Joints, hinges, shelf pins and slides add theirs by themselves.</p>';
  (it.ops || []).forEach((o, i) => {
    b += `<div class="cornr"><div class="ghead2"><b>${o.k === 'hole' ? 'Hole' : 'Groove'} ${i + 1}</b><button class="ic" data-opdel="${i}" aria-label="Delete" title="Delete">${ic('x')}</button></div>`;
    const lf = (label, key, min = 0) => { handlers[`op${i}${key}`] = num(v => edit(() => { o[key] = v; }), min); return lenF(label, o[key], `op${i}${key}`); };
    if (o.k === 'hole') b += lf('From left', 'x') + lf('From back edge', 'z') + lf('Diameter', 'd', .5) + lf('Depth', 'depth', .1);
    else { b += `<label class="field">Runs along<select data-opaxis="${i}"><option value="l" ${o.axis === 'l' ? 'selected' : ''}>The length</option><option value="w" ${o.axis === 'w' ? 'selected' : ''}>The width</option></select></label>` + (o.axis === 'l' ? lf('From back edge', 'z') : lf('From left', 'x')) + lf('Width', 'width', .5) + lf('Depth', 'depth', .1); }
    b += `<label class="field">Side<select data-opface="${i}"><option value="top" ${o.face === 'top' ? 'selected' : ''}>Top</option><option value="bottom" ${o.face === 'bottom' ? 'selected' : ''}>Bottom</option></select></label></div>`;
  });
  return sec('mach', `Machining${list.length ? `: ${list.length}` : ''}`, `${b}<div class="rowb" style="margin-top:6px"><button class="btn line" data-opadd="hole">Add hole</button><button class="btn line" data-opadd="groove">Add groove</button></div><div class="rowb"><button class="btn line" data-carvepanel="1" title="Opens this panel in Carve, ready to cut on your machine: its outline with tabs, its holes, grooves and cut-outs">${ic('drill')}Cut in Carve</button></div>`);
}
function machBind(it) {
  side.querySelectorAll('[data-carvepanel]').forEach(b => b.onclick = () => cvFromPanel(it));
  side.querySelectorAll('[data-opadd]').forEach(b => b.onclick = () => edit(() => { (it.ops = it.ops || []).push(b.dataset.opadd === 'hole' ? { k: 'hole', x: it.l / 2, z: it.w / 2, d: 8, depth: Math.min(12, it.t), face: 'top' } : { k: 'groove', axis: 'l', x: it.l / 2, z: 20, width: Math.max(cnc('cutter'), 6), depth: Math.min(8, it.t / 2), face: 'top' }); }));
  side.querySelectorAll('[data-opdel]').forEach(b => b.onclick = () => edit(() => { it.ops.splice(+b.dataset.opdel, 1); if (!it.ops.length) delete it.ops; }));
  side.querySelectorAll('[data-opaxis]').forEach(s => s.onchange = () => edit(() => { it.ops[+s.dataset.opaxis].axis = s.value; }));
  side.querySelectorAll('[data-opface]').forEach(s => s.onchange = () => edit(() => { it.ops[+s.dataset.opface].face = s.value; }));
}
function machSettingsHtml() {
  let h = '';
  MACH_FIELDS.forEach(([title, fields]) => {
    h += `<h3 style="margin:8px 0 2px">${title}</h3>`;
    fields.forEach(([k, label, kind]) => {
      if (kind === 'count') { h += `<label class="field">${label}<input type="text" data-f="m_${k}" value="${mach(k)}"></label>`; handlers[`m_${k}`] = s => { const v = Math.round(parseFloat(s)); if (v >= 1 && v <= 50) edit(() => { (P.mach = P.mach || {})[k] = v; }); else renderSide(); }; return; }
      h += lenF(label, mach(k), `m_${k}`); handlers[`m_${k}`] = num(v => edit(() => { (P.mach = P.mach || {})[k] = v; }), 0);
    });
  });
  return sec('machset', 'Machining sizes', h);
}
function cncSettingsHtml() {
  let h = '';
  CNC_FIELDS.forEach(([k, label]) => { h += `<label class="field">${label}<input type="text" data-f="c_${k}" value="${cnc(k)}"></label>`; handlers[`c_${k}`] = s => { const v = parseFloat(s); if (v >= 0) edit(() => { (P.cncTool = P.cncTool || {})[k] = v; }); else renderSide(); }; });
  h += `<label class="check"><input type="checkbox" id="cncClimb" ${cnc('climb') ? 'checked' : ''}>Climb cut</label>`;
  return sec('cncset', 'CNC tool data', h);
}

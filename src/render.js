// ---------- photoreal pictures ----------
// A path tracer running on the graphics card: rays bounce round the scene and the picture sharpens as samples add up.
// It takes its geometry from what the 3D view draws, so anything that shows there is in the picture.
const REND_SIZES = { view: 'Same as the 3D view', hd: '1280 × 720', fhd: '1920 × 1080', qhd: '2560 × 1440', uhd: '3840 × 2160' };
const REND_QUALITY = { draft: ['Quick', 100], good: ['Good', 500], best: ['Best', 2000] };
// The look: Studio stands the furniture on a photographer's backdrop under a big soft light, Daylight on open ground in the sun,
// In the room inside the walls and floor of the design. The light comes from beside the camera, turned and raised by these.
const rendOpts = { size: 'fhd', quality: 'good', light: 'studio', room: false, sunTurn: -50, sunHeight: 40, exposure: 1, fit: true };
const rendLook = () => (rendOpts.room ? 'room' : rendOpts.light === 'studio' ? 'studio' : 'day');
const rendHasRoom = () => P.items.some(i => isRoomPart(i) && i.type !== 'floor') || P.items.some(i => isRoomPart(i) && i.poly);

// ---------- gathering the scene ----------
function rendGather(withRoom) {
  const keep = { sel, hideDims: P.hideDims, real: P.real, sect: sect.on, tool };
  sel = []; P.hideDims = true; P.real = true; sect.on = false; tool = 'select'; batchOff = true;   // room parts have to be told apart, one by one
  let out;
  try { draw3D(); group.updateMatrixWorld(true); out = rendFromGroup(withRoom); } finally {
    sel = keep.sel; P.hideDims = keep.hideDims; if (keep.real === undefined) delete P.real; else P.real = keep.real; sect.on = keep.sect; tool = keep.tool; batchOff = false; dirty = true;
  }
  return out;
}
function rendFromGroup(withRoom) {
  const mats = [], matIndex = new Map(), images = [], imageIndex = new Map(), pos = [], nor = [], uvs = [], mid = [];
  const matOf_ = m => {
    if (matIndex.has(m)) return matIndex.get(m);
    let layer = -1, uvm = null;
    if (m.map && m.map.image) { const img = m.map.image; if (!imageIndex.has(img)) { imageIndex.set(img, images.length); images.push(img); } layer = imageIndex.get(img); m.map.updateMatrix(); uvm = m.map.matrix.elements.slice(); }
    const c = m.color || { r: .7, g: .7, b: .7 }, rec = { c: [c.r, c.g, c.b], rough: m.roughness ?? .8, layer, opacity: m.transparent ? m.opacity : 1, cut: m.alphaTest || 0, uvm };
    mats.push(rec); matIndex.set(m, mats.length - 1); return mats.length - 1;
  };
  const skip = o => !o.isMesh || !o.visible || (o.material && !Array.isArray(o.material) && (o.material.depthTest === false || o.material.colorWrite === false || o.material.isMeshBasicMaterial || o.material.isShaderMaterial));
  const room = o => { const id = o.userData && o.userData.id, it = id && byId(id); return it ? isRoomPart(it) : false; };
  const v = V3(), n = V3(), nm = new THREE.Matrix3();
  group.traverseVisible(o => {
    if (skip(o) || (!withRoom && room(o))) return;
    const it = o.userData && o.userData.id ? byId(o.userData.id) : null, g = it && it.kind === 'panel' && o.geometry.type === 'BoxGeometry' ? rendRounded(o.geometry, it) : o.geometry, pa = g.attributes.position; if (!pa) return;
    let na = g.attributes.normal; if (!na) { g.computeVertexNormals(); na = g.attributes.normal; }
    const ua = g.attributes.uv, norm = a => (a.normalized ? (a.array instanceof Int16Array ? 1 / 32767 : a.array instanceof Int8Array ? 1 / 127 : a.array instanceof Uint8Array ? 1 / 255 : 1) : 1), ps = norm(pa), ns = norm(na);
    nm.getNormalMatrix(o.matrixWorld);
    const idx = g.index ? g.index.array : null, count = idx ? idx.length : pa.count, list = Array.isArray(o.material) ? o.material : null;
    const ranges = list && g.groups.length ? g.groups : [{ start: 0, count, materialIndex: 0 }];
    ranges.forEach(r => {
      const m = list ? list[r.materialIndex] : o.material; if (!m || m.isShaderMaterial) return;
      const id = matOf_(m), uvm = mats[id].uvm, end = Math.min(r.start + r.count, count);
      for (let i = r.start; i + 2 < end; i += 3) {
        for (let c = 0; c < 3; c++) {
          const k = idx ? idx[i + c] : i + c;
          v.set(pa.getX(k) * ps, pa.getY(k) * ps, pa.getZ(k) * ps).applyMatrix4(o.matrixWorld); pos.push(v.x, v.y, v.z);
          n.set(na.getX(k) * ns, na.getY(k) * ns, na.getZ(k) * ns).applyMatrix3(nm).normalize(); nor.push(n.x, n.y, n.z);
          let a = ua ? ua.getX(k) : 0, b = ua ? ua.getY(k) : 0;
          if (uvm) { const x = uvm[0] * a + uvm[3] * b + uvm[6], y = uvm[1] * a + uvm[4] * b + uvm[7]; a = x; b = y; }
          uvs.push(a, b);
        }
        mid.push(id);
      }
    });
  });
  return { pos: Float32Array.from(pos), nor: Float32Array.from(nor), uvs: Float32Array.from(uvs), mid: Int32Array.from(mid), mats, images };
}
// A box with its edges rounded off by r: flat faces, a strip along each edge whose normal turns from one face to the next, and a
// little three-cornered patch at each corner. Built in the box's own coordinates, with the same texture mapping as the 3D view.
const rendRoundCache = new WeakMap();
function rendRounded(box, it) {
  if (rendRoundCache.has(box)) return rendRoundCache.get(box);
  const { width: W, height: H, depth: D } = box.parameters, h = [W / 2, H / 2, D / 2], r = Math.min(.8, Math.min(W, H, D) / 4), pos = [], nor = [];
  const put = (p, nv) => { pos.push(...p); nor.push(...nv); }, tri = (a, b, c) => { put(...a); put(...b); put(...c); }, quad = (a, b, c, d) => { tri(a, b, c); tri(a, c, d); };
  const pt = (k, s, j, a, m, b) => { const p = [0, 0, 0]; p[k] = s * h[k]; p[j] = a; p[m] = b; return p; }, nrm = (k, s) => { const v = [0, 0, 0]; v[k] = s; return v; };
  for (let k = 0; k < 3; k++) for (const s of [-1, 1]) {   // the six faces, each inset by r
    const j = (k + 1) % 3, m = (k + 2) % 3, nv = nrm(k, s), a = h[j] - r, b = h[m] - r;
    quad([pt(k, s, j, -a, m, -b), nv], [pt(k, s, j, a, m, -b), nv], [pt(k, s, j, a, m, b), nv], [pt(k, s, j, -a, m, b), nv]);
  }
  for (let k = 0; k < 3; k++) for (let j = k + 1; j < 3; j++) for (const s of [-1, 1]) for (const t of [-1, 1]) {   // the twelve edges
    const m = 3 - k - j, at = (pk, pj, pm) => { const p = [0, 0, 0]; p[k] = pk; p[j] = pj; p[m] = pm; return p; }, nk = nrm(k, s), nj = nrm(j, t), e = h[m] - r;
    quad([at(s * h[k], t * (h[j] - r), -e), nk], [at(s * h[k], t * (h[j] - r), e), nk], [at(s * (h[k] - r), t * h[j], e), nj], [at(s * (h[k] - r), t * h[j], -e), nj]);
  }
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {   // the eight corners
    tri([[sx * h[0], sy * (h[1] - r), sz * (h[2] - r)], [sx, 0, 0]], [[sx * (h[0] - r), sy * h[1], sz * (h[2] - r)], [0, sy, 0]], [[sx * (h[0] - r), sy * (h[1] - r), sz * h[2]], [0, 0, sz]]);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(new Array(pos.length / 3 * 2).fill(0), 2));
  if (realOn()) realUv(g, it);
  rendRoundCache.set(box, g); return g;
}
// A photographer's backdrop: a floor that curves up into a wall behind the furniture, as seen from the camera, wide enough to fill the
// picture. Light grey, so it lights up softly and the furniture stands out.
function rendAddBackdrop(sc, cam) {
  if (!sc.pos.length) return sc;
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < sc.pos.length; i++) { const a = i % 3; if (sc.pos[i] < lo[a]) lo[a] = sc.pos[i]; if (sc.pos[i] > hi[a]) hi[a] = sc.pos[i]; }
  const size = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2], 300), y0 = lo[1] - .5, cx = (lo[0] + hi[0]) / 2, cz = (lo[2] + hi[2]) / 2;
  let f = [cam.fwd[0], 0, cam.fwd[2]]; const fl = Math.hypot(f[0], f[2]) || 1; f = [f[0] / fl, 0, f[2] / fl]; const side = [f[2], 0, -f[0]];
  const depth = Math.max(hi[0] - lo[0], hi[2] - lo[2]) / 2, back = depth + Math.max(250, size * .35), R = Math.max(200, size * .45), wide = size * 30, far = size * 30, tall = size * 20;
  const at = (along, up, across) => [cx + f[0] * along + side[0] * across, y0 + up, cz + f[2] * along + side[2] * across];
  const P_ = [], N_ = [], quad = (a, b, na, nb) => { [[a[0], na], [b[0], nb], [b[1], nb], [a[0], na], [b[1], nb], [a[1], na]].forEach(([p, n]) => { P_.push(...p); N_.push(...n); }); };
  const rowAt = (along, up) => [at(along, up, -wide), at(along, up, wide)];
  // the profile, from far in front to high behind: floor, then a quarter circle, then the wall
  const prof = [[-far, 0, [0, 1, 0]], [back - R, 0, [0, 1, 0]]];
  for (let i = 1; i <= 12; i++) { const a = i / 12 * Math.PI / 2; prof.push([back - R + Math.sin(a) * R, R - Math.cos(a) * R, [-Math.sin(a) * f[0], Math.cos(a), -Math.sin(a) * f[2]]]); }
  prof.push([back, tall, [-f[0], 0, -f[2]]]);
  for (let i = 1; i < prof.length; i++) quad(rowAt(prof[i - 1][0], prof[i - 1][1]), rowAt(prof[i][0], prof[i][1]), prof[i - 1][2], prof[i][2]);
  const m = sc.mats.length; sc.mats.push({ c: [.74, .72, .69], rough: .9, layer: -1, opacity: 1, cut: 0, uvm: null });
  const join = (a, b) => { const o = new a.constructor(a.length + b.length); o.set(a); o.set(b, a.length); return o; };
  sc.pos = join(sc.pos, P_); sc.nor = join(sc.nor, N_); sc.uvs = join(sc.uvs, new Array(P_.length / 3 * 2).fill(0)); sc.mid = join(sc.mid, new Array(P_.length / 9).fill(m));
  return sc;
}
// a plain floor for pictures without the room
function rendAddFloor(sc, shade) {
  if (!sc.pos.length) return sc;
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < sc.pos.length; i++) { const a = i % 3; if (sc.pos[i] < lo[a]) lo[a] = sc.pos[i]; if (sc.pos[i] > hi[a]) hi[a] = sc.pos[i]; }
  const span = Math.max(hi[0] - lo[0], hi[2] - lo[2], 1000) * 400, cx = (lo[0] + hi[0]) / 2, cz = (lo[2] + hi[2]) / 2, y = lo[1] - .5, x0 = cx - span, x1 = cx + span, z0 = cz - span, z1 = cz + span;
  const m = sc.mats.length; sc.mats.push({ c: shade, rough: .8, layer: -1, opacity: 1, cut: 0, uvm: null });
  const quad = [x0, y, z0, x0, y, z1, x1, y, z1, x0, y, z0, x1, y, z1, x1, y, z0], join = (a, b) => { const o = new a.constructor(a.length + b.length); o.set(a); o.set(b, a.length); return o; };
  sc.pos = join(sc.pos, quad); sc.nor = join(sc.nor, Array.from({ length: 18 }, (_, i) => (i % 3 === 1 ? 1 : 0))); sc.uvs = join(sc.uvs, new Array(12).fill(0)); sc.mid = join(sc.mid, [m, m]);
  return sc;
}

// ---------- bounding volume hierarchy ----------
// Nodes: [min x, y, z, left child or first triangle], [max x, y, z, triangle count]. Children sit side by side, so right = left + 1.
function rendBvh(sc) { const g = rendBvhSteps(sc); let r = g.next(); while (!r.done) r = g.next(); return r.value; }
async function rendBvhKind(sc) { const g = rendBvhSteps(sc); let r = g.next(), t = performance.now(); while (!r.done) { if (performance.now() - t > 12) { await rendRest(4); t = performance.now(); } r = g.next(); } return r.value; }
function* rendBvhSteps(sc) {
  const n = sc.mid.length, order = new Int32Array(n), cen = new Float32Array(n * 3), lo = new Float32Array(n * 3), hi = new Float32Array(n * 3), p = sc.pos;
  for (let t = 0; t < n; t++) {
    order[t] = t;
    for (let a = 0; a < 3; a++) { const x = p[t * 9 + a], y = p[t * 9 + 3 + a], z = p[t * 9 + 6 + a]; lo[t * 3 + a] = Math.min(x, y, z); hi[t * 3 + a] = Math.max(x, y, z); cen[t * 3 + a] = (lo[t * 3 + a] + hi[t * 3 + a]) / 2; }
  }
  const nodes = []; const BINS = 12, LEAF = 4;
  const boxOf = (s, e) => { const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]; for (let i = s; i < e; i++) { const t = order[i] * 3; for (let a = 0; a < 3; a++) { if (lo[t + a] < b[a]) b[a] = lo[t + a]; if (hi[t + a] > b[a + 3]) b[a + 3] = hi[t + a]; } } return b; };
  const area = b => { const x = b[3] - b[0], y = b[4] - b[1], z = b[5] - b[2]; return x * y + y * z + z * x; };
  nodes.push(null); let sinceYield = 0;
  const stack = [{ at: 0, s: 0, e: n }];
  while (stack.length) {
    const { at, s, e } = stack.pop(); if (e - s > 2000 || ++sinceYield > 400) { sinceYield = 0; yield; }
    const box = boxOf(s, e), cnt = e - s; let split = -1;
    if (cnt > LEAF) {
      let best = Infinity, bestAxis = -1, bestPos = 0, cMin = [Infinity, Infinity, Infinity], cMax = [-Infinity, -Infinity, -Infinity];
      for (let i = s; i < e; i++) for (let a = 0; a < 3; a++) { const c = cen[order[i] * 3 + a]; if (c < cMin[a]) cMin[a] = c; if (c > cMax[a]) cMax[a] = c; }
      for (let a = 0; a < 3; a++) {
        const w = cMax[a] - cMin[a]; if (w < 1e-6) continue;
        const counts = new Int32Array(BINS), bx = Array.from({ length: BINS }, () => [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]);
        for (let i = s; i < e; i++) { const t = order[i] * 3, k = Math.min(BINS - 1, Math.floor((cen[t + a] - cMin[a]) / w * BINS)), q = bx[k]; counts[k]++; for (let d = 0; d < 3; d++) { if (lo[t + d] < q[d]) q[d] = lo[t + d]; if (hi[t + d] > q[d + 3]) q[d + 3] = hi[t + d]; } }
        const grow = (x, y) => [Math.min(x[0], y[0]), Math.min(x[1], y[1]), Math.min(x[2], y[2]), Math.max(x[3], y[3]), Math.max(x[4], y[4]), Math.max(x[5], y[5])];
        let lb = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity], lc = 0; const left = [];
        for (let k = 0; k < BINS - 1; k++) { lb = grow(lb, bx[k]); lc += counts[k]; left.push([lc ? area(lb) : 0, lc]); }
        let rb = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity], rc = 0;
        for (let k = BINS - 1; k > 0; k--) { rb = grow(rb, bx[k]); rc += counts[k]; const [la, lcount] = left[k - 1]; if (lcount && rc) { const cost = la * lcount + area(rb) * rc; if (cost < best) { best = cost; bestAxis = a; bestPos = cMin[a] + w * k / BINS; } } }
      }
      if (bestAxis >= 0) { let i = s, j = e - 1; while (i <= j) { if (cen[order[i] * 3 + bestAxis] < bestPos) i++; else { const q = order[i]; order[i] = order[j]; order[j] = q; j--; } } if (i > s && i < e) split = i; }
      if (split < 0 && cnt > 8) split = s + (cnt >> 1);   // all in one spot: halve them, so a leaf stays small
    }
    if (split < 0) { nodes[at] = { box, first: s, count: cnt }; continue; }
    const l = nodes.length; nodes.push(null, null); nodes[at] = { box, left: l, count: 0 };
    stack.push({ at: l + 1, s: split, e }, { at: l, s, e: split });
  }
  return { nodes, order };
}
// the same walk the graphics card does, in plain code, so the tree can be tested
function rendBvhHit(sc, tree, ro, rd) {
  const { nodes, order } = tree, hitBox = b => { let t0 = 1e-4, t1 = Infinity; for (let a = 0; a < 3; a++) { const i = 1 / rd[a]; let x = (b[a] - ro[a]) * i, y = (b[a + 3] - ro[a]) * i; if (x > y) [x, y] = [y, x]; t0 = Math.max(t0, x); t1 = Math.min(t1, y); if (t0 > t1) return false; } return true; };
  let best = Infinity, who = -1; const st = [0];
  while (st.length) {
    const nd = nodes[st.pop()]; if (!hitBox(nd.box)) continue;
    if (nd.count) { for (let i = 0; i < nd.count; i++) { const t = order[nd.first + i], d = rendTriHit(sc, t, ro, rd); if (d > 0 && d < best) { best = d; who = t; } } } else st.push(nd.left, nd.left + 1);
  }
  return { t: best, tri: who };
}
function rendTriHit(sc, t, ro, rd) {
  const p = sc.pos, o = t * 9, e1 = [p[o + 3] - p[o], p[o + 4] - p[o + 1], p[o + 5] - p[o + 2]], e2 = [p[o + 6] - p[o], p[o + 7] - p[o + 1], p[o + 8] - p[o + 2]];
  const h = [rd[1] * e2[2] - rd[2] * e2[1], rd[2] * e2[0] - rd[0] * e2[2], rd[0] * e2[1] - rd[1] * e2[0]], a = e1[0] * h[0] + e1[1] * h[1] + e1[2] * h[2]; if (Math.abs(a) < 1e-9) return -1;
  const f = 1 / a, s = [ro[0] - p[o], ro[1] - p[o + 1], ro[2] - p[o + 2]], u = f * (s[0] * h[0] + s[1] * h[1] + s[2] * h[2]); if (u < 0 || u > 1) return -1;
  const q = [s[1] * e1[2] - s[2] * e1[1], s[2] * e1[0] - s[0] * e1[2], s[0] * e1[1] - s[1] * e1[0]], w = f * (rd[0] * q[0] + rd[1] * q[1] + rd[2] * q[2]); if (w < 0 || u + w > 1) return -1;
  const d = f * (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]); return d > 1e-4 ? d : -1;
}

// ---------- shaders ----------
const REND_VS = `#version 300 es
void main() { vec2 p = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0); gl_Position = vec4(p, 0.0, 1.0); }`;
const REND_FS = `#version 300 es
precision highp float; precision highp int; precision highp sampler2D; precision highp sampler2DArray;
uniform sampler2D uPrev, uTri, uNode, uMat; uniform sampler2DArray uTex; uniform int uHasTex;
uniform ivec2 uSize; uniform int uSample;
uniform vec3 uCam, uRight, uUp, uFwd; uniform float uTan, uAspect;
uniform vec3 uSun, uSunColor, uSky, uHorizon, uGround; uniform float uSunRadius; uniform int uStudio;
out vec4 outColor;
const float PI = 3.14159265, EPS = 0.15; const int BOUNCES = 6;
uint rngState;
float rnd() { rngState = rngState * 747796405u + 2891336453u; uint w = ((rngState >> ((rngState >> 28u) + 4u)) ^ rngState) * 277803737u; return float((w >> 22u) ^ w) / 4294967295.0; }
ivec2 at(sampler2D t, int i) { int w = textureSize(t, 0).x; return ivec2(i % w, i / w); }
vec4 tri(int i) { return texelFetch(uTri, at(uTri, i), 0); }
vec4 nod(int i) { return texelFetch(uNode, at(uNode, i), 0); }
vec4 mat(int i) { return texelFetch(uMat, at(uMat, i), 0); }
vec2 boxHit(vec3 ro, vec3 inv, vec3 lo, vec3 hi) { vec3 a = (lo - ro) * inv, b = (hi - ro) * inv, s = min(a, b), l = max(a, b); return vec2(max(max(s.x, s.y), s.z), min(min(l.x, l.y), l.z)); }
vec2 triUv(int t, float u, float v) { vec4 n0 = tri(t * 7 + 3), n1 = tri(t * 7 + 4), n2 = tri(t * 7 + 5), r = tri(t * 7 + 6); vec2 a = vec2(n0.w, n1.w), b = vec2(n2.w, r.x), c = r.yz; return a * (1.0 - u - v) + b * u + c * v; }
vec3 srgb(vec3 c) { return pow(max(c, vec3(0.0)), vec3(2.2)); }
// t, triangle, u, v of the nearest hit. With shadow set, returns on the first thing that blocks light.
bool trace(vec3 ro, vec3 rd, float tMax, bool shadow, out float tHit, out int tHitTri, out float uHit, out float vHit) {
  vec3 inv = 1.0 / rd; int stack[48]; int sp = 0; stack[sp++] = 0; float best = tMax; bool any = false; tHitTri = -1; uHit = 0.0; vHit = 0.0;
  while (sp > 0) {
    int n = stack[--sp]; vec4 a = nod(n * 2), b = nod(n * 2 + 1); vec2 r = boxHit(ro, inv, a.xyz, b.xyz);
    if (r.x > r.y || r.y < 0.0 || r.x > best) continue;
    int count = int(b.w);
    if (count > 0) {
      int first = int(a.w);
      for (int i = first; i < first + count; i++) {
        vec4 v0 = tri(i * 7), v1 = tri(i * 7 + 1), v2 = tri(i * 7 + 2); vec3 e1 = v1.xyz - v0.xyz, e2 = v2.xyz - v0.xyz, h = cross(rd, e2); float det = dot(e1, h);
        if (abs(det) < 1e-9) continue;
        float f = 1.0 / det; vec3 s = ro - v0.xyz; float u = f * dot(s, h); if (u < 0.0 || u > 1.0) continue;
        vec3 q = cross(s, e1); float v = f * dot(rd, q); if (v < 0.0 || u + v > 1.0) continue;
        float d = f * dot(e2, q); if (d <= EPS * 0.2 || d >= best) continue;
        vec4 m1 = mat(int(v0.w) * 2 + 1);
        if (shadow) {
          if (m1.y < 0.99) continue;   // glass lets the light through
          if (m1.z > 0.0 && uHasTex == 1 && m1.x >= 0.0) { vec2 uv = triUv(i, u, v); if (textureLod(uTex, vec3(fract(uv), m1.x), 0.0).a < m1.z) continue; }
          tHit = d; return true;
        }
        best = d; tHitTri = i; uHit = u; vHit = v; any = true;
      }
    } else {
      int l = int(a.w); stack[sp++] = l; stack[sp++] = l + 1;
    }
  }
  tHit = best; return any;
}
vec3 env(vec3 rd, bool direct) {
  vec3 c;
  if (uStudio == 1) { float k = 0.5 + 0.5 * rd.y; c = mix(uGround, uSky, smoothstep(0.0, 1.0, k)); }
  else if (rd.y > 0.0) { c = mix(uHorizon, uSky, pow(rd.y, 0.5)); }
  else { c = uGround; }
  if (direct && dot(rd, uSun) > cos(uSunRadius)) c += uSunColor * 4.0;
  return c;
}
vec3 cosine(vec3 n) { float a = rnd() * 2.0 * PI, z = rnd() * 2.0 - 1.0, r = sqrt(max(0.0, 1.0 - z * z)); return normalize(n + vec3(r * cos(a), r * sin(a), z) * 0.999); }
vec3 coneDir(vec3 d, float radius) { vec3 u = normalize(abs(d.y) < 0.99 ? cross(d, vec3(0.0, 1.0, 0.0)) : cross(d, vec3(1.0, 0.0, 0.0))), v = cross(d, u); float a = rnd() * 2.0 * PI, r = sqrt(rnd()) * tan(radius); return normalize(d + (u * cos(a) + v * sin(a)) * r); }
vec3 radiance(vec3 ro, vec3 rd) {
  vec3 L = vec3(0.0), T = vec3(1.0); bool direct = true; int bounce = 0;
  for (int step_ = 0; step_ < 16 && bounce < BOUNCES; step_++) {
    float t, u, v; int i;
    if (!trace(ro, rd, 1e9, false, t, i, u, v)) { L += T * env(rd, direct); break; }
    vec3 p = ro + rd * t; vec4 v0 = tri(i * 7); int mi = int(v0.w); vec4 m0 = mat(mi * 2), m1 = mat(mi * 2 + 1);
    vec3 albedo = srgb(m0.rgb); float alpha = 1.0; vec2 uv = triUv(i, u, v);
    if (uHasTex == 1 && m1.x >= 0.0) { vec4 tx = textureLod(uTex, vec3(fract(uv), m1.x), 0.0); albedo *= srgb(tx.rgb); alpha = tx.a; }
    if (m1.z > 0.0 && alpha < m1.z) { ro = p + rd * EPS; continue; }   // cut-out leaves and the like
    vec3 n = normalize(tri(i * 7 + 3).xyz * (1.0 - u - v) + tri(i * 7 + 4).xyz * u + tri(i * 7 + 5).xyz * v);
    vec3 g = normalize(cross(tri(i * 7 + 1).xyz - v0.xyz, tri(i * 7 + 2).xyz - v0.xyz)); if (dot(g, rd) > 0.0) g = -g; if (dot(n, g) < 0.0) n = -n;
    float cosI = clamp(-dot(rd, n), 0.0, 1.0), F = 0.04 + 0.96 * pow(1.0 - cosI, 5.0), rough = clamp(m0.a, 0.04, 1.0);
    if (m1.y < 0.99) {   // glass: reflects a little, otherwise lets light through, tinted
      if (rnd() < F) { ro = p + g * EPS; rd = reflect(rd, n); direct = true; bounce++; continue; }
      if (rnd() < 1.0 - m1.y) { T *= mix(vec3(1.0), albedo, 0.4); ro = p + rd * EPS; continue; }
    }
    ro = p + g * EPS;
    float specP = clamp(F * (1.0 - rough * 0.6), 0.03, 0.6);
    if (rnd() < specP) {
      vec3 refl = reflect(rd, n), s = normalize(mix(refl, cosine(n), rough * rough)); if (dot(s, g) <= 0.0) s = refl;
      T *= F * (1.0 - rough * 0.6) / specP; rd = s; direct = rough < 0.2;
    } else {
      vec3 sd = coneDir(uSun, uSunRadius); float nl = dot(n, sd);
      vec3 base = albedo * (1.0 - F) / (1.0 - specP);
      if (nl > 0.0 && dot(g, sd) > 0.0) { float st, su, sv; int si; if (!trace(ro, sd, 1e9, true, st, si, su, sv)) L += T * base * uSunColor * nl; }
      T *= base; rd = cosine(n); direct = false;
    }
    bounce++;
    if (bounce > 2) { float q = clamp(max(T.r, max(T.g, T.b)), 0.05, 0.98); if (rnd() > q) break; T /= q; }
  }
  return L;
}
void main() {
  ivec2 px = ivec2(gl_FragCoord.xy);
  rngState = uint(px.x) * 1973u + uint(px.y) * 9277u + uint(uSample) * 26699u + 7u; rnd(); rnd();
  vec2 pix = (vec2(px) + vec2(rnd(), rnd())) / vec2(uSize) * 2.0 - 1.0;
  vec3 rd = normalize(uFwd + uRight * pix.x * uTan * uAspect + uUp * pix.y * uTan);
  vec3 c = radiance(uCam, rd);
  if (any(isnan(c)) || any(isinf(c))) c = vec3(0.0);
  c = min(c, vec3(20.0));   // keeps stray bright speckles down
  outColor = texelFetch(uPrev, px, 0) + vec4(c, 1.0);
}`;
const REND_SHOW = `#version 300 es
precision highp float; uniform sampler2D uAcc; uniform float uExposure; out vec4 outColor;
vec3 aces(vec3 x) { x *= 0.8; return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
void main() { ivec2 s = textureSize(uAcc, 0), p = ivec2(gl_FragCoord.xy); vec4 a = texelFetch(uAcc, p, 0); vec3 c = a.a > 0.0 ? a.rgb / a.a : vec3(0.0); outColor = vec4(pow(aces(c * uExposure), vec3(1.0 / 2.2)), 1.0); }`;

// ---------- the job ----------
let rendJob = null;
const REND_PIECE_MS = 40;
const rendPort = new MessageChannel();
const rendYield = () => new Promise(r => { rendPort.port1.onmessage = () => r(); rendPort.port2.postMessage(0); });
// Rests use a timer on a worker thread. It costs no CPU, and unlike a page's timers it isn't slowed when the window is in the background.
let rendClock = null, rendClockSeq = 0; const rendClockWait = new Map();
function rendClockGet() {
  if (rendClock !== null) return rendClock;
  try {
    rendClock = new Worker(URL.createObjectURL(new Blob(['onmessage = e => setTimeout(() => postMessage(e.data.id), e.data.ms);'], { type: 'text/javascript' })));
    rendClock.onmessage = e => { const r = rendClockWait.get(e.data); rendClockWait.delete(e.data); if (r) r(); };
    rendClock.onerror = () => { rendClock = false; rendClockWait.forEach(r => r()); rendClockWait.clear(); };
  } catch (e) { rendClock = false; }
  return rendClock;
}
const rendRest = ms => new Promise(r => { const c = rendClockGet(); if (!c) { setTimeout(r, ms); return; } const id = ++rendClockSeq; rendClockWait.set(id, r); c.postMessage({ id, ms }); });
function rendFloatTex(gl, data, unit) {
  const max = gl.getParameter(gl.MAX_TEXTURE_SIZE), n = data.length / 4, w = Math.min(max, Math.max(16, Math.ceil(Math.sqrt(n)))), h = Math.ceil(n / w) || 1;
  if (h > max) throw new Error('the scene is too big for this graphics card');
  const full = new Float32Array(w * h * 4); full.set(data);
  const t = gl.createTexture(); gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, w, h, 0, gl.RGBA, gl.FLOAT, full);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  return t;
}
function rendPack(sc, tree) {
  const n = sc.mid.length, T = new Float32Array(n * 7 * 4);
  for (let k = 0; k < n; k++) {
    const t = tree.order[k], o = k * 28, P9 = t * 9, U = t * 6;
    for (let c = 0; c < 3; c++) { T[o + c * 4] = sc.pos[P9 + c * 3]; T[o + c * 4 + 1] = sc.pos[P9 + c * 3 + 1]; T[o + c * 4 + 2] = sc.pos[P9 + c * 3 + 2]; T[o + 12 + c * 4] = sc.nor[P9 + c * 3]; T[o + 12 + c * 4 + 1] = sc.nor[P9 + c * 3 + 1]; T[o + 12 + c * 4 + 2] = sc.nor[P9 + c * 3 + 2]; }
    T[o + 3] = sc.mid[t];
    T[o + 15] = sc.uvs[U]; T[o + 19] = sc.uvs[U + 1]; T[o + 23] = sc.uvs[U + 2]; T[o + 24] = sc.uvs[U + 3]; T[o + 25] = sc.uvs[U + 4]; T[o + 26] = sc.uvs[U + 5];
  }
  const N = new Float32Array(tree.nodes.length * 8);
  tree.nodes.forEach((nd, i) => { const o = i * 8, b = nd.box; N[o] = b[0]; N[o + 1] = b[1]; N[o + 2] = b[2]; N[o + 3] = nd.count ? nd.first : nd.left; N[o + 4] = b[3]; N[o + 5] = b[4]; N[o + 6] = b[5]; N[o + 7] = nd.count; });
  const M = new Float32Array(Math.max(1, sc.mats.length) * 8);
  sc.mats.forEach((m, i) => { const o = i * 8; M[o] = m.c[0]; M[o + 1] = m.c[1]; M[o + 2] = m.c[2]; M[o + 3] = m.rough; M[o + 4] = m.layer; M[o + 5] = m.opacity; M[o + 6] = m.cut; });
  return { T, N, M };
}
function rendCompile(gl, vs, fs) {
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; }, a = sh(gl.VERTEX_SHADER, vs), b = sh(gl.FRAGMENT_SHADER, fs), p = gl.createProgram();
  gl.attachShader(p, a); gl.attachShader(p, b); gl.linkProgram(p); p.parts = [a, b]; return p;
}
async function rendLinked(gl, p, job) {   // the card can take a while to prepare this: wait without freezing the app
  const ext = gl.getExtension('KHR_parallel_shader_compile');
  if (ext) while (!gl.getProgramParameter(p, ext.COMPLETION_STATUS_KHR)) { if (job.stop) return false; await rendYield(); }
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('the graphics card could not prepare the renderer: ' + (gl.getProgramInfoLog(p) || gl.getShaderInfoLog(p.parts[1]) || '').slice(0, 300));
  return true;
}
const rendImageSize = key => {
  if (key === 'view') { const r = host.getBoundingClientRect(); return [Math.max(64, Math.round(r.width)), Math.max(64, Math.round(r.height))]; }
  return { hd: [1280, 720], fhd: [1920, 1080], qhd: [2560, 1440], uhd: [3840, 2160] }[key] || [1280, 720];
};
function rendLight(o, cam) {
  const toCam = cam && o.rel ? Math.atan2(-cam.fwd[0], -cam.fwd[2]) : 0;   // the direction back towards the camera, along the ground
  const h = o.sunHeight * Math.PI / 180, a = o.sunTurn * Math.PI / 180 + toCam, sun = [Math.cos(h) * Math.sin(a), Math.sin(h), Math.cos(h) * Math.cos(a)];
  return o.light === 'studio'
    ? { sun, sunColor: [2.6, 2.52, 2.4], radius: .3, sky: [.4, .4, .41], horizon: [.36, .36, .36], ground: [.26, .26, .25], studio: 1 }   // a big soft box, and a room's worth of light bouncing back
    : { sun, sunColor: [2.5, 2.3, 2.05], radius: .012, sky: [.26, .42, .7], horizon: [.86, .89, .93], ground: [.86, .89, .93], studio: 0 };   // a hazy horizon that the ground fades into, blue overhead
}
async function rendStart(canvas, opts, cam, onProgress, job = { stop: false }) {
  Object.assign(job, { sample: 0, spp: opts.spp, done: false, canvas });
  const gl = canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true, alpha: false, powerPreference: 'high-performance' }); if (!gl) throw new Error('this computer has no WebGL2');
  if (!gl.getExtension('EXT_color_buffer_float')) throw new Error("this graphics card can't do it");
  job.gl = gl;
  const [W, H] = opts.size; canvas.width = W; canvas.height = H;
  onProgress('Gathering the scene…'); await rendYield();
  let sc = rendGather(opts.room);
  if (!sc.mid.length) throw new Error('there is nothing to draw');
  if (opts.backdrop) rendAddBackdrop(sc, cam); else rendAddFloor(sc, opts.room ? [.62, .61, .59] : [.78, .77, .74]);   // something for the shadows to fall on
  await rendWaitImages(sc.images);
  onProgress(`Sorting ${sc.mid.length.toLocaleString('en-US')} triangles…`); await rendYield();
  const tree = await rendBvhKind(sc), { T, N, M } = rendPack(sc, tree);
  await rendRest(4);
  job.tris = sc.mid.length;
  rendFloatTex(gl, T, 2); rendFloatTex(gl, N, 3); rendFloatTex(gl, M, 4);
  const hasTex = sc.images.length > 0, layerSize = sc.images.length > 48 ? 256 : sc.images.length > 16 ? 512 : 1024;
  if (hasTex) await rendUploadLayers(gl, sc.images, layerSize);
  onProgress('Preparing the graphics card…');
  const prog = rendCompile(gl, REND_VS, REND_FS), show = rendCompile(gl, REND_VS, REND_SHOW);
  if (!await rendLinked(gl, prog, job) || !await rendLinked(gl, show, job)) return job;
  const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
  // two buffers, each adding to the other, because a float target can't always be blended onto
  const target = unit => { const t = gl.createTexture(); gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t); gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, W, H); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST); const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); return { t, f }; };
  const A = target(0), B = target(1);
  gl.useProgram(prog); const u = n => gl.getUniformLocation(prog, n), L = rendLight(opts, cam);
  gl.uniform1i(u('uPrev'), 0); gl.uniform1i(u('uTri'), 2); gl.uniform1i(u('uNode'), 3); gl.uniform1i(u('uMat'), 4); gl.uniform1i(u('uTex'), 5); gl.uniform1i(u('uHasTex'), hasTex ? 1 : 0);
  if (!hasTex) { gl.activeTexture(gl.TEXTURE5); const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D_ARRAY, t); gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, 1, 1, 1); }
  gl.uniform2i(u('uSize'), W, H); gl.uniform3fv(u('uCam'), cam.pos); gl.uniform3fv(u('uRight'), cam.right); gl.uniform3fv(u('uUp'), cam.up); gl.uniform3fv(u('uFwd'), cam.fwd); gl.uniform1f(u('uTan'), Math.tan(cam.fov * Math.PI / 360)); gl.uniform1f(u('uAspect'), W / H);
  gl.uniform3fv(u('uSun'), L.sun); gl.uniform3fv(u('uSunColor'), L.sunColor); gl.uniform1f(u('uSunRadius'), L.radius); gl.uniform3fv(u('uSky'), L.sky); gl.uniform3fv(u('uHorizon'), L.horizon); gl.uniform3fv(u('uGround'), L.ground); gl.uniform1i(u('uStudio'), L.studio);
  const uSample = u('uSample'); gl.useProgram(show); gl.uniform1i(gl.getUniformLocation(show, 'uAcc'), 0); const uExp = gl.getUniformLocation(show, 'uExposure'); job.exposure = opts.exposure;
  gl.useProgram(prog);
  const display = () => { gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.useProgram(show); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, A.t); gl.disable(gl.SCISSOR_TEST); gl.viewport(0, 0, W, H); gl.uniform1f(uExp, job.exposure); gl.drawArrays(gl.TRIANGLES, 0, 3); gl.useProgram(prog); };
  job.display = display;
  // A shared chip also draws the desktop, so it needs long rests. A dedicated card can work almost flat out without the computer noticing.
  const dbg = gl.getExtension('WEBGL_debug_renderer_info'), chip = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : ''; job.chip = chip; job.dedicated = /nvidia|geforce|rtx|radeon rx|arc a/i.test(chip);
  const started = performance.now(); let lastShow = 0;
  // A piece of the picture at a time, taking REND_PIECE_MS or a little more. After each, the card rests for a while.
  let tile = 32;
  for (job.sample = 0; job.sample < job.spp && !job.stop; job.sample++) {
    gl.uniform1i(uSample, job.sample);
    for (let y = 0; y < H && !job.stop;) {
      const rows = Math.min(tile, H - y);
      for (let x = 0; x < W && !job.stop;) {
        const cols = Math.min(tile, W - x), t0 = performance.now();
        gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, B.f); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, A.t); gl.viewport(0, 0, W, H); gl.enable(gl.SCISSOR_TEST); gl.scissor(x, y, cols, rows); gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, B.f); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, A.f); gl.disable(gl.SCISSOR_TEST); gl.blitFramebuffer(x, y, x + cols, y + rows, x, y, x + cols, y + rows, gl.COLOR_BUFFER_BIT, gl.NEAREST); gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
        const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0); gl.flush();
        while (gl.clientWaitSync(sync, 0, 0) === gl.TIMEOUT_EXPIRED) await rendRest(1);
        gl.deleteSync(sync);
        const ms = performance.now() - t0; x += cols;
        if (ms < REND_PIECE_MS) tile = Math.min(512, Math.ceil(tile * 1.3)); else if (ms > REND_PIECE_MS * 2) tile = Math.max(16, Math.floor(tile * .7));   // the card only reports back every 16 to 33 ms, so anything quicker can't be told apart
        job.gpuMs = (job.gpuMs || 0) + ms;
        if (performance.now() - lastShow > 500) { display(); lastShow = performance.now(); const secs = (performance.now() - started) / 1000, left = job.sample > 1 ? secs / job.sample * (job.spp - job.sample) : 0; onProgress(`Sample ${job.sample + 1} of ${job.spp}${left > 90 ? `, about ${Math.round(left / 60)} min left` : left > 5 ? `, about ${Math.round(left)} s left` : ''}`); }
        await rendRest(Math.max(job.dedicated ? 1 : 4, Math.round(ms * (job.dedicated ? .05 : .6))));
      }
      y += rows;
    }
    if (job.sample < 3) display();
  }
  display();
  job.seconds = (performance.now() - started) / 1000; job.done = !job.stop; job.finished = true;
  if (job.dropped) rendRelease(job);
  return job;
}
async function rendWaitImages(images) {
  const until = performance.now() + 4000;
  while (images.some(i => i.complete === false) && performance.now() < until) await rendYield();
}
async function rendUploadLayers(gl, images, size) {
  gl.activeTexture(gl.TEXTURE5); const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D_ARRAY, t);
  gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, size, size, images.length);
  const c = document.createElement('canvas'); c.width = c.height = size; const x = c.getContext('2d', { willReadFrequently: true });
  for (let i = 0; i < images.length; i++) { const img = images[i]; x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, size, size); x.setTransform(1, 0, 0, -1, 0, size); try { x.drawImage(img, 0, 0, size, size); } catch (e) { x.fillStyle = '#999'; x.fillRect(0, 0, size, size); } gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, i, size, size, 1, gl.RGBA, gl.UNSIGNED_BYTE, x.getImageData(0, 0, size, size).data); await rendRest(2); }
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.REPEAT);
}
function rendCamera(fit, aspect) {
  camera.updateMatrixWorld(); const e = camera.matrixWorld.elements, right = [e[0], e[1], e[2]], up = [e[4], e[5], e[6]], fwd = [-e[8], -e[9], -e[10]];
  const cam = { pos: camera.position.toArray(), right, up, fwd, fov: camera.fov }, list = P.items.filter(i => !isRoomPart(i) && !isHidden(i));
  if (!fit || !list.length) return cam;
  // stands back just far enough for every corner of the furniture to be in the picture, with a margin
  const u = unionBounds(list), c = [0, 1, 2].map(k => (u.min[k] + u.max[k]) / 2), tv = Math.tan(cam.fov * Math.PI / 360), th = tv * aspect; let need = 0;
  for (const x of [u.min[0], u.max[0]]) for (const y of [u.min[1], u.max[1]]) for (const z of [u.min[2], u.max[2]]) {
    const d = [x - c[0], y - c[1], z - c[2]], along = d[0] * fwd[0] + d[1] * fwd[1] + d[2] * fwd[2], sx = Math.abs(d[0] * right[0] + d[1] * right[1] + d[2] * right[2]), sy = Math.abs(d[0] * up[0] + d[1] * up[1] + d[2] * up[2]);
    need = Math.max(need, sx / (th * .8) - along, sy / (tv * .8) - along);
  }
  cam.pos = c.map((v, k) => v - fwd[k] * need); return cam;
}

// ---------- the window ----------
const rq = id => document.getElementById(id);
function rendRelease(job) { const lose = job.gl && job.gl.getExtension('WEBGL_lose_context'); if (lose) lose.loseContext(); job.gl = null; job.display = null; }   // graphics memory isn't left to chance
function rendStopJob() { if (rendJob) rendJob.stop = true; }
function rendDrop() { if (!rendJob) return; rendJob.stop = true; rendJob.dropped = true; if (rendJob.finished) rendRelease(rendJob); }
async function rendRun() {
  rendDrop();
  const old = rq('rendCanvas'), fresh = document.createElement('canvas'); fresh.id = 'rendCanvas'; old.replaceWith(fresh);   // a new canvas, so nothing of the last picture lingers
  const o = rendOpts, opts = { ...o, size: rendImageSize(o.size), spp: REND_QUALITY[o.quality][1], rel: true, backdrop: rendLook() === 'studio' }, say = t => { rq('rendState').textContent = t; };
  rq('rendSave').disabled = true;
  const token = rendJob = { stop: false };
  try {
    const job = await rendStart(fresh, opts, rendCamera(o.fit && !o.room, opts.size[0] / opts.size[1]), t => { if (rendJob === token) say(t); }, token);
    if (rendJob === token) { rq('rendSave').disabled = false; say(job.done ? `Done: ${job.spp} samples in ${Math.round(job.seconds)} s` : 'Stopped'); }
    return job;
  } catch (e) { if (rendJob === token) say(`Couldn't make the picture: ${e.message}.`); reportError(`render: ${e.stack || e.message}`); return null; }
}
function openRender() {
  if (!P.items.some(i => !isRoomPart(i)) && !P.items.length) { toast('There is nothing to draw yet.', true); return; }
  if (rendOpts.room && !rendHasRoom()) rendOpts.room = false;
  rendShowOpts(); rq('rendAdjust').hidden = true; rq('rend').classList.add('open'); rendRun();
}
function closeRender() { rendDrop(); rendJob = null; rq('rend').classList.remove('open'); const old = rq('rendCanvas'), fresh = document.createElement('canvas'); fresh.id = 'rendCanvas'; old.replaceWith(fresh); dirty = true; }
rq('rendBack').onclick = closeRender;
rq('rendSize').innerHTML = Object.entries(REND_SIZES).map(([k, n]) => `<option value="${k}">${n}</option>`).join('');
rq('rendQuality').innerHTML = Object.entries(REND_QUALITY).map(([k, v]) => `<option value="${k}">${v[0]}</option>`).join('');
function rendShowOpts() {
  rq('rendSize').value = rendOpts.size; rq('rendQuality').value = rendOpts.quality; rq('rendTurn').value = rendOpts.sunTurn; rq('rendHeight').value = rendOpts.sunHeight; rq('rendExposure').value = rendOpts.exposure; rq('rendFit').checked = rendOpts.fit;
  const look = rendLook(), room = rendHasRoom(); rq('rendLook').querySelectorAll('[data-look]').forEach(b => { b.setAttribute('aria-pressed', b.dataset.look === look); if (b.dataset.look === 'room') b.hidden = !room; });
  rq('rendFit').disabled = look === 'room';
}
rq('rendLook').addEventListener('click', e => { const b = e.target.closest('[data-look]'); if (!b) return; const l = b.dataset.look; rendOpts.light = l === 'studio' ? 'studio' : 'day'; rendOpts.room = l === 'room'; rendShowOpts(); rendRun(); });
[['rendSize', 'size'], ['rendQuality', 'quality']].forEach(([id, k]) => { rq(id).onchange = e => { rendOpts[k] = e.target.value; rendRun(); }; });
[['rendTurn', 'sunTurn'], ['rendHeight', 'sunHeight']].forEach(([id, k]) => { rq(id).onchange = e => { rendOpts[k] = +e.target.value; rendRun(); }; });
rq('rendFit').onchange = e => { rendOpts.fit = e.target.checked; rendRun(); };
rq('rendAdjustBtn').onclick = e => { const a = rq('rendAdjust'); a.hidden = !a.hidden; e.currentTarget.setAttribute('aria-expanded', !a.hidden); };
rq('rendReset').onclick = () => { Object.assign(rendOpts, { sunTurn: -50, sunHeight: 40, exposure: 1, fit: true }); rendShowOpts(); if (rendJob && rendJob.display) { rendJob.exposure = 1; } rendRun(); };
rq('rendExposure').oninput = e => { rendOpts.exposure = +e.target.value; if (rendJob && rendJob.display) { rendJob.exposure = rendOpts.exposure; rendJob.display(); } };
rq('rendStop').onclick = rendStopJob;
rq('rendSave').onclick = () => { rq('rendCanvas').toBlob(b => { if (b) { downloadBlob(`${P.name} picture.png`, b, 'image/png'); toast('Picture saved.'); } }, 'image/png'); };

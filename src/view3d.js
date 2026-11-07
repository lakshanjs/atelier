// ---------- 3D ----------
const host = document.getElementById('view3d');
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false;   // shadows are worked out when the design changes, not again for every camera move
host.appendChild(renderer.domElement);
const scene = new THREE.Scene(); scene.background = new THREE.Color(0xe4e9e7);
const camera = new THREE.PerspectiveCamera(36, 1, 10, 60000);
const controls = new THREE.OrbitControls(camera, renderer.domElement);
controls.mouseButtons.MIDDLE = THREE.MOUSE.ROTATE;
controls.enableDamping = true; controls.maxPolarAngle = Math.PI * .495; controls.minDistance = 200; controls.maxDistance = 20000;
// How far you can zoom out, and what the camera can see, follow the size of the design: a whole house needs far more room than a shelf.
let sceneSize = 0;
function fitCamRange() {
  if (P && P.items.length) { const u = unionBounds(P.items); sceneSize = Math.max(u.max[0] - u.min[0], u.max[1] - u.min[1], u.max[2] - u.min[2]); }
  controls.maxDistance = Math.max(20000, sceneSize * 6);
  const d = camera.position.distanceTo(controls.target), far = Math.max(60000, (d + sceneSize) * 3), near = Math.max(10, d / 200);
  if (camera.far !== far || camera.near !== near) { camera.far = far; camera.near = near; camera.updateProjectionMatrix(); }
}
controls.addEventListener('change', fitCamRange);
scene.add(new THREE.HemisphereLight(0xffffff, 0x9aa3a6, .68));
const hemiLight = scene.children[scene.children.length - 1];
const envTex = (() => { const pm = new THREE.PMREMGenerator(renderer), tx = pm.fromScene(new THREE.RoomEnvironment(), .04).texture; pm.dispose(); return tx; })();
function applyLight() { const on = realOn(); scene.environment = on ? envTex : null; hemiLight.intensity = on ? .3 : .68; sun.intensity = on ? .42 : .42; EDGE.opacity = on ? .25 : .45; }
const sun = new THREE.DirectionalLight(0xffffff, .42); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -.0004;
Object.assign(sun.shadow.camera, { left: -4000, right: 4000, top: 4000, bottom: -4000, near: 100, far: 14000 }); scene.add(sun, sun.target);
const group = new THREE.Group(); scene.add(group);
// endless floor grid at height 0. Its lines match the snap grid, and fine lines fade out as you zoom away.
const floorGrid = new THREE.Mesh(new THREE.PlaneGeometry(200000, 200000).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
  uniforms: { uSizes: { value: new THREE.Vector3(25.4, 304.8, 1219.2) }, uFade: { value: 8000 }, uCol: { value: new THREE.Vector3(.125, .15, .165) } },
  vertexShader: 'varying vec3 vW; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
  fragmentShader: `varying vec3 vW; uniform vec3 uSizes, uCol; uniform float uFade;
    float grid(vec2 p, float s, float strength) {
      vec2 c = p / s, d = fwidth(c), g = abs(fract(c - .5) - .5) / d;
      float cell = max(d.x, d.y);
      return (1. - min(min(g.x, g.y), 1.)) * strength * (1. - smoothstep(.12, .4, cell));
    }
    void main() {
      vec2 p = vW.xz, dw = fwidth(p), ax = abs(p) / dw;
      float a = max(max(grid(p, uSizes.x, .16), grid(p, uSizes.y, .34)), grid(p, uSizes.z, .5));
      a = max(a, (1. - min(min(ax.x, ax.y) / 1.5, 1.)) * .8);
      a *= 1. - smoothstep(uFade * .5, uFade, distance(vW, cameraPosition));
      if (a < .004) discard;
      gl_FragColor = vec4(uCol, a);
    }`,
}));
floorGrid.frustumCulled = false; scene.add(floorGrid);
function updateFloorGrid() {
  floorGrid.visible = P.floorGrid !== false;
  const major = P.in ? (P.grid < 152 ? 304.8 : 1219.2) : (P.grid < 100 ? 100 : 1000), u = floorGrid.material.uniforms;
  u.uSizes.value.set(P.grid, major, major * (P.in ? 4 : 10));
  u.uFade.value = Math.max(8000, camera.position.distanceTo(controls.target) * 4);
}
const EDGE = new THREE.LineBasicMaterial({ color: 0x20262a, transparent: true, opacity: .45 });
const allMats = [];
const std = c => { const m = new THREE.MeshStandardMaterial({ color: c, roughness: .8, envMapIntensity: .2 }); allMats.push(m); return m; };
// walls and floor stay whole when the design is sliced
const roomMats = {}; const roomMat = hex => roomMats[hex] || (roomMats[hex] = new THREE.MeshStandardMaterial({ color: hex, roughness: .9, envMapIntensity: .12 }));
allMats.push(EDGE);
const SEL_THROUGH = new THREE.LineBasicMaterial({ color: 0xe5a900, depthTest: false, transparent: true, opacity: .85 });
const SELM = std(0xffc928), WALL = std(0xf3f4f1), FLOOR = std(0xd5d9d6);
const MAT = {
  white: { f: '#dfe3e1', c: 0xf2f2ee, name: 'White' }, mdf: { f: '#c7a57d', c: 0xc5a47e, name: 'Raw board' }, wood: { f: '#d6b283', c: 0xd9b888, name: 'Light wood' },
  bass: { f: '#e8d9b8', c: 0xecdcb9, name: 'Basswood' }, walnut: { f: '#7c5638', c: 0x6f4b31, name: 'Walnut' }, black: { f: '#4a4f52', c: 0x2a2c2e, name: 'Black' },
};
const matCache = {}; const matOf = hex => matCache[hex] || (matCache[hex] = std(hex));
// ---------- realistic materials ----------
// Textures are drawn here, so there's nothing to download. Grain runs along the texture's width.
const TEX = {
  white: { base: [240, 240, 235], grain: 0, speck: 3, rough: .55 }, mdf: { base: [197, 164, 126], grain: 0, speck: 16, rough: .85 },
  wood: { base: [214, 178, 128], grain: 30, speck: 3, rough: .7 }, bass: { base: [236, 220, 185], grain: 14, speck: 2, rough: .75 },
  walnut: { base: [104, 70, 46], grain: 36, speck: 3, rough: .55 }, black: { base: [42, 44, 46], grain: 0, speck: 4, rough: .5 },
};
const texMats = {};
function texMat(key) {
  if (texMats[key]) return texMats[key];
  const d = TEX[key] || TEX.white, W = 1024, H = 512, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d'), rgb = (r, a = 1) => `rgba(${d.base.map(v => Math.max(0, Math.min(255, v + r))).join()},${a})`;
  g.fillStyle = rgb(0); g.fillRect(0, 0, W, H);
  if (d.grain) for (let i = 0; i < 520; i++) {
    let y = rnd(i * 1.3) * H; const dark = rnd(i * 2.7) > .35, wob = 4 + rnd(i * 3.1) * 14, ph = rnd(i * 4.3) * 6.28;
    g.beginPath(); for (let x = 0; x <= W; x += 32) { const yy = y + Math.sin(x / W * 6.283 * 2 + ph) * wob; x ? g.lineTo(x, yy) : g.moveTo(x, yy); }
    g.lineWidth = .6 + rnd(i * 5.9) * 2.2; g.strokeStyle = rgb((dark ? -1 : 1) * d.grain * (.25 + rnd(i * 7.7) * .75), .35); g.stroke();
  }
  if (d.speck) { const im = g.getImageData(0, 0, W, H), a = im.data; for (let i = 0; i < a.length; i += 4) { const n = (Math.random() - .5) * d.speck * 2; a[i] += n; a[i + 1] += n; a[i + 2] += n; } g.putImageData(im, 0, 0); }
  const tx = new THREE.CanvasTexture(c); tx.wrapS = tx.wrapT = THREE.RepeatWrapping; tx.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const m = std(0xffffff); m.map = tx; m.roughness = d.rough; applyClip(m);
  return (texMats[key] = m);
}
// wraps a texture at real size on every face, turned to follow the panel's grain
function realUv(g, it) {
  const pos = g.attributes.position, nor = g.attributes.normal, uv = g.attributes.uv; if (!uv) return;
  const across = (it.grain === 'width') !== (it.l < it.w), o = rnd(it.id) * 9;
  for (let i = 0; i < pos.count; i++) {
    const nx = Math.abs(nor.getX(i)), ny = Math.abs(nor.getY(i)), x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    let a, b;
    if (ny >= nx && ny >= Math.abs(nor.getZ(i))) { a = x; b = z; } else if (nx >= Math.abs(nor.getZ(i))) { a = z; b = y; } else { a = x; b = y; }
    if (across) [a, b] = [b, a];
    uv.setXY(i, a / 1400 + o, b / 700 + o);
  }
  uv.needsUpdate = true;
}
const realOn = () => P.real !== false;
const panelMat = it => realOn() ? texMat(panelColor(it)) : matOf(MAT[panelColor(it)].c);
// ---------- section ----------
const sect = { on: false, axis: 2, pos: 0, flip: false }, secPlane = new THREE.Plane();
// the exact outline where the slice passes through a panel, as closed loops, for the flat views and plans
function sliceLoops(it) {
  let g = panelGeometry(it); if (g.index) g = g.toNonIndexed();
  const pos = g.attributes.position, q = Q(it), ax = sect.axis, v = V3(), segs = [], key = p => p.map(n => n.toFixed(1)).join();
  for (let i = 0; i < pos.count; i += 3) {
    const tri = [0, 1, 2].map(j => { v.set(pos.getX(i + j), pos.getY(i + j), pos.getZ(i + j)).applyQuaternion(q); return [v.x + it.pos[0], v.y + it.pos[1], v.z + it.pos[2]]; }), hits = [];
    [[0, 1], [1, 2], [2, 0]].forEach(([a, b]) => { const da = tri[a][ax] - sect.pos, db = tri[b][ax] - sect.pos; if ((da < 0) !== (db < 0)) { const f = da / (da - db); hits.push(tri[a].map((n, k) => n + (tri[b][k] - n) * f)); } });
    if (hits.length === 2 && key(hits[0]) !== key(hits[1])) segs.push(hits);
  }
  const next = new Map(); segs.forEach(s => { [[0, 1], [1, 0]].forEach(([a, b]) => { const k = key(s[a]); next.has(k) ? next.get(k).push(s[b]) : next.set(k, [s[b]]); }); });
  const used = new Set(), loops = [];
  next.forEach((_, start) => {
    if (used.has(start)) return;
    const loop = []; let k = start, safety = 0;
    while (k && !used.has(k) && safety++ < 2000) { used.add(k); const o = next.get(k), nx = o && o.find(p => !used.has(key(p))); if (nx) loop.push(nx); k = nx ? key(nx) : null; }
    if (loop.length > 2) loops.push(loop);
  });
  return loops;
}
function sliceSvg(vn, t, it) {
  const loops = sliceLoops(it); if (!loops.length) return '';
  return `<path d="${loops.map(l => 'M' + l.map(p => toS(vn, t, p).map(n => n.toFixed(1)).join(' ')).join('L') + 'Z').join('')}" fill="#20262a" fill-rule="evenodd"/>`;
}
const sectionFaces = vn => ['side', 'top', 'front'][sect.axis] === vn;
function applyClip(m) { m.clippingPlanes = sect.on ? [secPlane] : []; m.clipShadows = sect.on; m.shadowSide = THREE.BackSide; m.side = sect.on ? THREE.DoubleSide : THREE.FrontSide; m.needsUpdate = true; }
const keepSign = () => { const base = sect.axis === 0 ? 1 : -1; return sect.flip ? -base : base; };   // which side stays
function updateSection() {
  if (sect.on) { const n = [0, 0, 0]; n[sect.axis] = keepSign(); secPlane.normal.set(n[0], n[1], n[2]); secPlane.constant = -keepSign() * sect.pos; }
  renderer.localClippingEnabled = sect.on;
  allMats.forEach(applyClip);
}
const secKeeps = it => { if (!sect.on || isRoomPart(it)) return true; const b = bounds(it), s = keepSign(); return s > 0 ? b.max[sect.axis] > sect.pos : b.min[sect.axis] < sect.pos; };
const secCrosses = it => { if (!sect.on) return false; const b = bounds(it); return b.min[sect.axis] < sect.pos && b.max[sect.axis] > sect.pos; };
const keptHit = h => !sect.on || isRoomPart(byId(h.object.userData.id)) || secPlane.distanceToPoint(h.point) >= -.01;
const panelColor = it => it.color || (BOARDS[it.mat] || BOARDS.eco).color;
let pickable = [], camSet = false;
const CAPM = new THREE.MeshBasicMaterial({ color: 0x20262a, side: THREE.DoubleSide, stencilWrite: true, stencilRef: 0, stencilFunc: THREE.NotEqualStencilFunc, stencilFail: THREE.ReplaceStencilOp, stencilZFail: THREE.ReplaceStencilOp, stencilZPass: THREE.ReplaceStencilOp });
const stencilMat = (side, op) => new THREE.MeshBasicMaterial({ depthWrite: false, depthTest: false, colorWrite: false, side, stencilWrite: true, stencilFunc: THREE.AlwaysStencilFunc, stencilFail: op, stencilZFail: op, stencilZPass: op });
const STENCIL_BACK = stencilMat(THREE.BackSide, THREE.IncrementWrapStencilOp), STENCIL_FRONT = stencilMat(THREE.FrontSide, THREE.DecrementWrapStencilOp);
STENCIL_BACK.clippingPlanes = STENCIL_FRONT.clippingPlanes = [secPlane];
function addMesh(geo, mat, pos, quat, id, opts = {}) {
  const m = new THREE.Mesh(geo, mat); m.position.set(pos[0], pos[1], pos[2]); if (quat) m.quaternion.copy(quat);
  m.castShadow = !opts.noShadow; m.receiveShadow = true; group.add(m);
  if (id) { m.userData.id = id; pickable.push(m); }
  return m;
}
// Floor textures repeat at their real size: a floor's UVs are simply its millimetres.
const floorTexMats = {}, doubleMats = new Map();
function floorTexMat(tex) {
  if (!tex || !TEXTURES[tex.key]) return null;
  const k = `${tex.key}|${tex.w}|${tex.h}|${tex.a}`; if (floorTexMats[k]) return floorTexMats[k];
  const map = new THREE.TextureLoader().load(URL.createObjectURL(new Blob([TEXTURES[tex.key].bytes])), () => { dirty = true; });
  map.wrapS = map.wrapT = THREE.RepeatWrapping; map.repeat.set(1 / tex.w, 1 / tex.h); map.rotation = tex.a || 0; map.anisotropy = 8;
  return floorTexMats[k] = new THREE.MeshStandardMaterial({ map, roughness: .9, envMapIntensity: .12, side: THREE.DoubleSide });
}
const doubleOf = m => { if (!doubleMats.has(m)) { const c = m.clone(); c.side = THREE.DoubleSide; doubleMats.set(m, c); } return doubleMats.get(m); };
function cutFloorGeo(it) {
  const pos = [], nor = [], uv = [], up = it.t / 2, dn = -it.t / 2;
  const add = (p, n, u) => { pos.push(...p); nor.push(...n); uv.push(...u); };
  for (let i = 0; i < it.tris.length; i += 6) {
    let a = [it.tris[i], it.tris[i + 1]], b = [it.tris[i + 2], it.tris[i + 3]], c = [it.tris[i + 4], it.tris[i + 5]];
    if ((b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]) < 0) { const k = b; b = c; c = k; }
    [a, b, c].forEach(q => add([q[0], up, q[1]], [0, 1, 0], q)); [a, c, b].forEach(q => add([q[0], dn, q[1]], [0, -1, 0], q));
  }
  const wall = (x0, z0, x1, z1) => { const l = Math.hypot(x1 - x0, z1 - z0) || 1, n = [(z1 - z0) / l, 0, -(x1 - x0) / l]; [[x0, up, z0], [x0, dn, z0], [x1, up, z1], [x1, up, z1], [x0, dn, z0], [x1, dn, z1]].forEach(p => add(p, n, [0, 0])); };
  it.poly.forEach((q, i) => { const r = it.poly[(i + 1) % it.poly.length]; wall(q[0], q[1], r[0], r[1]); });
  for (let i = 0; i < it.rim.length; i += 4) wall(it.rim[i], it.rim[i + 1], it.rim[i + 2], it.rim[i + 3]);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}
const modelTexMats = {};
function modelTexMat(key, o) {
  const k = key + '|' + o; if (modelTexMats[k]) return modelTexMats[k];
  const bytes = TEXTURES[key].bytes, map = new THREE.TextureLoader().load(URL.createObjectURL(new Blob([bytes])), () => { dirty = true; });
  map.wrapS = map.wrapT = THREE.RepeatWrapping; map.anisotropy = 8;
  const m = new THREE.MeshStandardMaterial({ map, roughness: .8, envMapIntensity: .2, side: THREE.DoubleSide });
  if (bytes[0] === 0x89) m.alphaTest = .4;   // PNG leaves and the like are cut out by their transparency
  if (o < 1) { m.transparent = true; m.opacity = o; m.depthWrite = false; }
  return modelTexMats[k] = m;
}
const q_ = it => Q(it), modelMats = {};
const modelMat = (hex, o) => { const k = hex + o; if (modelMats[k]) return modelMats[k]; const m = std(hex); m.side = THREE.DoubleSide; if (o < 1) { m.transparent = true; m.opacity = o; m.depthWrite = false; } return modelMats[k] = m; };
const GLASS = new THREE.MeshStandardMaterial({ color: 0xa9cfe0, transparent: true, opacity: .3, depthWrite: false });
function drawObject(it, isSel) {
  const q = Q(it), base = V3(-it.l / 2, -it.t / 2, -it.w / 2);
  if (it.poly) {   // a floor or ceiling with a room's real outline
    const side = roomMat(it.fc || (it.ceiling ? (isDark() ? '#4b5357' : '#f3f4f1') : isDark() ? '#3f3b35' : '#e7e2d6')), face = floorTexMat(it.tex) || side;
    let g, mat;
    if (it.tris) { g = cutFloorGeo(it); mat = face === side ? doubleOf(side) : face; }
    else { g = new THREE.ExtrudeGeometry(new THREE.Shape(it.poly.map(c => new THREE.Vector2(c[0], c[1]))), { depth: it.t, bevelEnabled: false }); g.rotateX(Math.PI / 2); g.translate(0, it.t / 2, 0); mat = [face, side]; }
    addMesh(g, mat, it.pos.slice(), q, it.id);
    if (isSel) { const b = new THREE.BoxGeometry(it.l + 6, it.t + 6, it.w + 6), l = new THREE.LineSegments(new THREE.EdgesGeometry(b), new THREE.LineBasicMaterial({ color: 0xe5a900 })); l.position.set(...it.pos); l.quaternion.copy(q); group.add(l); }
    return;
  }
  if (it.model && MODELS[it.model]) {
    const parts = MODELS[it.model].parts, tris = parts.reduce((n, q) => n + q.i.length / 3, 0);
    parts.forEach((q, i) => {
      const own = (it.mats && it.mats[q.name]) || null, wanted = (it.matTex && it.matTex[q.name]) || it.ptex || (own || it.tint ? null : q.map), hasMap = wanted && TEXTURES[wanted];
      const c = own || it.tint || (hasMap && !q.u ? TEXTURES[wanted].avg : q.c), mat = hasMap && q.u ? modelTexMat(wanted, q.o) : modelMat(c, q.o), m = new THREE.Mesh(modelGeo(it.model, i), mat);
      m.position.set(...it.pos); m.quaternion.copy(q_(it)); m.scale.set((it.mirror ? -1 : 1) * it.l / 2, it.t / 2, it.w / 2);
      m.castShadow = tris < 30000 && q.o >= 1; m.receiveShadow = true; m.userData.keepGeo = true; group.add(m);
    });
    addMesh(new THREE.BoxGeometry(it.l, it.t, it.w), matOf('#9aa1a5'), it.pos.slice(), q, it.id, { noShadow: true }).visible = false;   // clicks test this box, which is far quicker than the model
    if (isSel) { const b = new THREE.BoxGeometry(it.l + 6, it.t + 6, it.w + 6), l = new THREE.LineSegments(new THREE.EdgesGeometry(b), new THREE.LineBasicMaterial({ color: 0xe5a900 })); l.position.set(...it.pos); l.quaternion.copy(q); group.add(l); }
    return;
  }
  shapes(it.type, it.l, it.t, it.w, it.id, it.cuts).forEach(p => {
    if (p.ball) { const c = base.clone().add(V3(p.ball[0], p.ball[2], p.ball[1])).applyQuaternion(q); addMesh(new THREE.SphereGeometry(p.r, 14, 12), matOf(p.c), [c.x + it.pos[0], c.y + it.pos[1], c.z + it.pos[2]], null, it.id); }
    else {
      const [a0, a1, u0, u1, z0, z1] = p.a, g = new THREE.BoxGeometry(Math.max(a1 - a0, .1), Math.max(z1 - z0, .1), Math.max(u1 - u0, .1));
      const c = base.clone().add(V3((a0 + a1) / 2, (z0 + z1) / 2, (u0 + u1) / 2)).applyQuaternion(q);
      let wallFaces = null;
      if (it.type === 'wall' && (it.sideL || it.sideR || it.sideT)) {   // a wall's textures line up across its pieces: UVs are millimetres along the wall and up it
        const pa = g.attributes.position, ua = g.attributes.uv, mx = (a0 + a1) / 2, mz = (z0 + z1) / 2; for (let i = 0; i < pa.count; i++) ua.setXY(i, pa.getX(i) + mx, pa.getY(i) + mz);
        const end = roomMat(p.c), face = q => (q ? floorTexMat(q.tex) || roomMat(q.c) : end); wallFaces = [end, end, face(it.sideT), end, face(it.sideR), face(it.sideL)];
      }
      addMesh(g, wallFaces || (it.type === 'sh3d-glass' ? GLASS : isRoomPart(it) ? roomMat(p.c) : matOf(p.c)), [c.x + it.pos[0], c.y + it.pos[1], c.z + it.pos[2]], q, it.id);
    }
  });
  if (isSel) { const g = new THREE.BoxGeometry(it.l + 6, it.t + 6, it.w + 6), l = new THREE.LineSegments(new THREE.EdgesGeometry(g), new THREE.LineBasicMaterial({ color: 0xe5a900 })); l.position.set(...it.pos); l.quaternion.copy(q); group.add(l); }
}
function draw3D() {
  renderer.shadowMap.needsUpdate = true; detailHidden = false;
  applyLight();
  while (group.children.length) { const c = group.children.pop(); if (c.geometry && !c.userData.keepGeo) c.geometry.dispose(); }
  pickable = [];
  const s = new Set(sel); let capNeeded = false;
  shown().forEach(it => {
    if (it.kind === 'object') { drawObject(it, s.has(it.id)); return; }
    const g = panelGeometry(it), q = Q(it);
    if (realOn()) realUv(g, it);
    addMesh(g, s.has(it.id) ? SELM : panelMat(it), it.pos, q, it.id);
    if (sect.on && secCrosses(it)) {   // counts in and out of each board, so the cap below fills exactly what the slice cuts
      [STENCIL_BACK, STENCIL_FRONT].forEach(sm => { const c = new THREE.Mesh(g, sm); c.position.set(...it.pos); c.quaternion.copy(q); c.renderOrder = 1; group.add(c); });
      capNeeded = true;
    }
    const l = new THREE.LineSegments(new THREE.EdgesGeometry(g, 28), EDGE); l.position.set(...it.pos); l.quaternion.copy(q); group.add(l);
    if (s.has(it.id)) { const x = new THREE.LineSegments(new THREE.EdgesGeometry(g, 28), SEL_THROUGH); x.position.set(...it.pos); x.quaternion.copy(q); x.renderOrder = 9; group.add(x); }   // its edges show through whatever is in front
  });
  if (capNeeded) {
    const cap = new THREE.Mesh(new THREE.PlaneGeometry(40000, 40000), CAPM), n = secPlane.normal;
    cap.position.copy(n).multiplyScalar(-secPlane.constant); cap.lookAt(cap.position.clone().sub(n)); cap.renderOrder = 1.1;
    cap.onAfterRender = r => r.clearStencil(); group.add(cap);
  }
  const vis = shown(), ext = vis.length ? unionBounds(vis) : { min: [0, 0, 0], max: [1500, 0, 800] };
  guidesDraw3D(group); snapHighlight3D(group);
  guides.forEach(g => {
    const mn = ext.min.slice(), mx = ext.max.slice(); mn[g.axis] = mx[g.axis] = g.at;
    [0, 1, 2].filter(a => a !== g.axis).forEach(a => { mn[a] -= 150; mx[a] += 150; });
    const lg = new THREE.BufferGeometry().setFromPoints([V3(mn[0], mn[1], mn[2]), V3(mx[0], mx[1], mx[2])]);
    group.add(new THREE.Line(lg, new THREE.LineBasicMaterial({ color: isDark() ? 0xff8a6b : 0xb93a1a })));
  });
  const cx = (ext.min[0] + ext.max[0]) / 2, cz = (ext.min[2] + ext.max[2]) / 2;
  sun.target.position.set(cx, 0, cz); sun.position.set(cx - 1500, 3800, cz + 3200);
  const dimLine = (a, b, color) => { const g = new THREE.BufferGeometry().setFromPoints([V3(...a), V3(...b)]), m = new THREE.Line(g, new THREE.LineBasicMaterial({ color: color ?? (isDark() ? 0xff8a6b : 0xb93a1a), depthTest: false })); m.renderOrder = 9; group.add(m); };
  if (!P.hideDims) drawnDims().forEach(({ a, b }) => dimLine(a, b));
  if (tool === 'measure') {
    if (measA && mHover) { const a = ptWorld(measA), b = mEndWorld(); if (a && b) dimLine(a, b, mAxis != null ? AXES[mAxis][1] : undefined); }
    if (mHover) { const w = measA ? mEndWorld() : ptWorld(mHover); if (w) { const m = new THREE.Mesh(new THREE.SphereGeometry(camera.position.distanceTo(controls.target) * .006, 12, 10), new THREE.MeshBasicMaterial({ color: 0xffc928, depthTest: false })); m.position.set(w[0], w[1], w[2]); m.renderOrder = 12; group.add(m); } }
  }
  sceneTris = 0; group.children.forEach(o => { if (o.isMesh && o.visible) { const g = o.geometry; sceneTris += (g.index ? g.index.count : g.attributes.position ? g.attributes.position.count : 0) / 3; } });
  if (sceneTris > BIG_SCENE && !batchOff && !sect.on) batchSmall();
  updateGizmo();
  if (!camSet) resetCam();
}
function resetCam() {
  fitCamRange();
  const list = realItems(), e = list.length ? unionBounds(list) : { min: [0, 0, 0], max: [1500, 1200, 1000] };
  const c = V3((e.min[0] + e.max[0]) / 2, (e.max[1] + e.min[1]) / 2, (e.min[2] + e.max[2]) / 2);
  const far = Math.max(e.max[0] - e.min[0], e.max[1] - e.min[1], e.max[2] - e.min[2], 700) * 2.5;
  controls.target.copy(c); camera.position.copy(c).addScaledVector(V3(-.45, .3, .85).normalize(), far); camSet = true; fitCamRange();
}
// handles: arrows move along one direction, squares on them stretch it, the yellow square scales everything
let cvHover = () => {};
const giz = new THREE.Group(); scene.add(giz); const gizHit = [], stretchParts = [];
const gizMove = new THREE.Group(), gizTurn = new THREE.Group(), gizScale = new THREE.Group(); giz.add(gizMove, gizTurn, gizScale);
const gizTargets = () => gizHit.filter(h => h.visible && h.parent.visible);
const AXES = [[V3(1, 0, 0), 0xd64535], [V3(0, 1, 0), 0x2f9e62], [V3(0, 0, 1), 0x2f74c9]];
AXES.forEach(([dir, color], axis) => {
  const m = new THREE.MeshBasicMaterial({ color, depthTest: false }), inv = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthTest: false });
  const q = new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), dir);
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(.0055, .0055, .84, 10), m); shaft.position.copy(dir.clone().multiplyScalar(.5)); shaft.quaternion.copy(q);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(.026, .11, 20), m); tip.position.copy(dir.clone().multiplyScalar(.97)); tip.quaternion.copy(q);
  const hit = new THREE.Mesh(new THREE.CylinderGeometry(.045, .045, .82, 6), inv); hit.position.copy(dir.clone().multiplyScalar(.63)); hit.quaternion.copy(q); hit.userData = { type: 'move', axis, mat: m, base: color };
  const cube = new THREE.Mesh(new THREE.BoxGeometry(.036, .036, .036), m); cube.position.copy(dir.clone().multiplyScalar(.62));
  const chit = new THREE.Mesh(new THREE.BoxGeometry(.12, .12, .12), inv); chit.position.copy(cube.position); chit.userData = { type: 'stretch', axis, mat: m, base: color };
  stretchParts[axis] = [cube, chit];
  [shaft, tip, hit].forEach(o => { o.renderOrder = 10; gizMove.add(o); });
  // stretch: a thin stem ending in a square
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(.0055, .0055, .62, 10), m); stem.position.copy(dir.clone().multiplyScalar(.31)); stem.quaternion.copy(q); stem.renderOrder = 10; gizScale.add(stem);
  [cube, chit].forEach(o => { o.renderOrder = 10; gizScale.add(o); });
  stretchParts[axis].push(stem);
  const back = dir.clone().multiplyScalar(-1), cube2 = new THREE.Mesh(cube.geometry, m), chit2 = new THREE.Mesh(chit.geometry, inv), stem2 = new THREE.Mesh(stem.geometry, m);
  cube2.position.copy(back.clone().multiplyScalar(.62)); chit2.position.copy(cube2.position); stem2.position.copy(back.clone().multiplyScalar(.31)); stem2.quaternion.copy(q);
  chit2.userData = { type: 'stretch', axis, side: -1, mat: m, base: color };
  [cube2, chit2, stem2].forEach(o => { o.renderOrder = 10; gizScale.add(o); });
  stretchParts[axis].push(cube2, chit2, stem2); gizHit.push(chit2);
  // turn: one small arc per direction, not a full circle
  const rq = new THREE.Quaternion().setFromUnitVectors(V3(0, 0, 1), dir), arc = new THREE.Mesh(new THREE.TorusGeometry(.46, .007, 8, 28, Math.PI / 2), m); arc.quaternion.copy(rq);
  const ahit = new THREE.Mesh(new THREE.TorusGeometry(.46, .05, 6, 16, Math.PI / 2), inv); ahit.quaternion.copy(rq); ahit.userData = { type: 'turn', axis, mat: m, base: color };
  [arc, ahit].forEach(o => { o.renderOrder = 10; gizTurn.add(o); });
  gizHit.push(hit, chit, ahit);
});
{
  const m = new THREE.MeshBasicMaterial({ color: 0xffc928, depthTest: false }), inv = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthTest: false });
  const at = V3(.24, .24, .24), cube = new THREE.Mesh(new THREE.BoxGeometry(.05, .05, .05), m), edge = new THREE.LineSegments(new THREE.EdgesGeometry(cube.geometry), new THREE.LineBasicMaterial({ color: 0x20262a, depthTest: false }));
  const chit = new THREE.Mesh(new THREE.BoxGeometry(.13, .13, .13), inv); chit.userData = { type: 'scale', mat: m, base: 0xffc928 };
  [cube, edge, chit].forEach(o => { o.position.copy(at); o.renderOrder = 11; gizScale.add(o); });
  gizHit.push(chit);
}
// the handle under the pointer lights up, so it's clear what a drag will do
let gizHover = null;
cvHover = e => {
  let next = null;
  if (giz.visible && !d3) { const hs = rayAt(e).intersectObjects(gizTargets()); next = (hs.find(h => h.object.userData.type !== 'move') || hs[0] || {}).object || null; }
  if (next === gizHover) return;
  if (gizHover) gizHover.userData.mat.color.setHex(gizHover.userData.base);
  if (next) next.userData.mat.color.setHex(next.userData.type === 'scale' ? 0xe5a900 : isDark() ? 0xffffff : 0x20262a);
  gizHover = next; renderer.domElement.style.cursor = next ? 'grab' : '';
};
// which of an item's own sizes lies closest to a world direction
function sizeKeyFor(it, axis) { const m = new THREE.Matrix4().makeRotationFromQuaternion(Q(it)).elements; let best = 0, v = -1; [0, 1, 2].forEach(c => { const a = Math.abs(m[c * 4 + axis]); if (a > v) { v = a; best = c; } }); return ['l', 't', 'w'][best]; }
// a panel's thickness comes from its board, so scaling never changes it
function applyScale(d, f, axis) {
  d.base.forEach(b => {
    const it = byId(b.id);
    it.pos = b.pos.map((p, i) => axis == null || axis === i ? d.anchor[i] + (p - d.anchor[i]) * f : p);
    (axis == null ? ['l', 't', 'w'] : [sizeKeyFor(it, axis)]).forEach(k => { if (!(it.kind === 'panel' && k === 't')) it[k] = Math.max(1, b[k] * f); });
  });
}
function updateGizmo() {
  const list = movable(); giz.visible = !!list.length;
  gizMove.visible = tool === 'select'; gizTurn.visible = tool === 'rotate'; gizScale.visible = tool === 'scale';
  if (!list.length) return;
  const u = unionBounds(list); giz.position.set((u.min[0] + u.max[0]) / 2, (u.min[1] + u.max[1]) / 2, (u.min[2] + u.max[2]) / 2);
  [0, 1, 2].forEach(a => { const off = list.length === 1 && list[0].kind === 'panel' && sizeKeyFor(list[0], a) === 't'; stretchParts[a].forEach(o => { o.visible = !off; }); });
}
function size3D() { const r = host.getBoundingClientRect(); if (!r.width) return; renderer.setSize(r.width, r.height); camera.aspect = r.width / r.height; camera.updateProjectionMatrix(); }
// Draws only when something has changed. A big house is hundreds of thousands of triangles with shadows,
// and redrawing that all the time, with nothing moving, would slow the whole computer.
let lastView = '', lastFrame = 0, sceneTris = 0, detailHidden = false, lastMove = 0, batchOff = false;
// Drawing hundreds of small things one at a time is what's slow on a big scene, far more than the number of triangles.
// So small ones sharing a material are combined. The originals stay, hidden, because clicks still test them.
const BATCH_MAX_TRIS = 2000;
function batchSmall() {
  const groups = new Map(), v = V3(), n = V3(), nm = new THREE.Matrix3();
  group.children.forEach(o => {
    if (!o.isMesh || !o.visible || o.renderOrder) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material]; if (mats.some(m => m.transparent || m.isMeshBasicMaterial)) return;
    const g = o.geometry, pa = g.attributes.position; if (!pa || !g.attributes.normal) return;
    const count = g.index ? g.index.count : pa.count; if (count / 3 >= BATCH_MAX_TRIS) return;
    // a wall's faces can each have their own material, so each face joins its own batch
    const parts = Array.isArray(o.material) ? g.groups.map(r => ({ start: r.start, count: Math.min(r.count, count - r.start), mat: o.material[r.materialIndex] })).filter(r => r.mat) : [{ start: 0, count, mat: o.material }];
    parts.forEach(r => { const key = r.mat.uuid + (o.castShadow ? '|s' : '|'), rec = groups.get(key) || groups.set(key, { mat: r.mat, cast: o.castShadow, list: [], total: 0, meshes: new Set() }).get(key); rec.list.push({ o, start: r.start, count: r.count }); rec.total += r.count; rec.meshes.add(o); });
  });
  groups.forEach(rec => {
    const pos = new Float32Array(rec.total * 3), nor = new Float32Array(rec.total * 3), uv = new Float32Array(rec.total * 2); let at = 0;
    rec.list.forEach(({ o, start, count }) => {
      const g = o.geometry, pa = g.attributes.position, na = g.attributes.normal, ua = g.attributes.uv, idx = g.index ? g.index.array : null;
      const ps = pa.normalized ? (pa.array instanceof Int16Array ? 1 / 32767 : 1 / 127) : 1, ns = na.normalized ? (na.array instanceof Int8Array ? 1 / 127 : 1 / 32767) : 1;
      o.updateMatrixWorld(); nm.getNormalMatrix(o.matrixWorld);
      for (let i = start; i < start + count; i++, at++) {
        const k = idx ? idx[i] : i;
        v.set(pa.getX(k) * ps, pa.getY(k) * ps, pa.getZ(k) * ps).applyMatrix4(o.matrixWorld); pos[at * 3] = v.x; pos[at * 3 + 1] = v.y; pos[at * 3 + 2] = v.z;
        n.set(na.getX(k) * ns, na.getY(k) * ns, na.getZ(k) * ns).applyMatrix3(nm).normalize(); nor[at * 3] = n.x; nor[at * 3 + 1] = n.y; nor[at * 3 + 2] = n.z;
        if (ua) { uv[at * 2] = ua.getX(k); uv[at * 2 + 1] = ua.getY(k); }
      }
      o.userData.batched = true;
    });
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    rec.meshes.forEach(o => { o.visible = false; });
    const m = new THREE.Mesh(g, rec.mat); m.castShadow = rec.cast; m.receiveShadow = true; m.userData.batch = true; group.add(m);
  });
}
// On a big scene, small but detailed objects step aside while the camera moves, and come straight back when it stops.
const BIG_SCENE = 250000, DETAIL_REST_MS = 140;
function detailStepAside() {
  const tan = Math.tan(camera.fov * Math.PI / 360), at = V3(); let hid = 0;
  group.children.forEach(o => {
    if (!o.isMesh || !o.userData.keepGeo || o.userData.batched) return;
    const tris = o.geometry.index ? o.geometry.index.count / 3 : 0; if (tris < 500) { o.visible = true; return; }
    const r = Math.max(Math.abs(o.scale.x), Math.abs(o.scale.y), Math.abs(o.scale.z)), seen = r / (at.copy(o.position).distanceTo(camera.position) * tan || 1);   // how much of the view it fills
    o.visible = seen >= (tris > 3000 ? .12 : .03); if (!o.visible) hid++;
  });
  detailHidden = hid > 0;
}
function detailBack() { group.children.forEach(o => { if (o.isMesh && o.userData.keepGeo && !o.userData.batched) o.visible = true; }); detailHidden = false; }
const viewNow = () => [camera.position.x, camera.position.y, camera.position.z, camera.quaternion.x, camera.quaternion.y, camera.quaternion.z, camera.quaternion.w, camera.aspect, camera.near, camera.far, controls.target.x, controls.target.y, controls.target.z, hoverBox.visible, hoverBox.position.x, hoverBox.position.y, hoverBox.position.z, hoverBox.scale.x, hoverBox.scale.y, hoverBox.scale.z, giz.visible, giz.position.x, giz.position.y, giz.position.z, gizHover ? gizHover.id : 0].join();
const COVERED = '#pack.open, #draw.open, #rend.open, #carve.open';
// With nothing happening it only looks a dozen times a second, and any mouse or key wakes it straight away.
let loopTimer = 0, loopActive = 0;
function loopNext(now) {
  if (now - loopActive < 1000) { requestAnimationFrame(loop); return; }
  loopTimer = setTimeout(() => { loopTimer = 0; requestAnimationFrame(loop); }, 80);
}
function loopWake() { loopActive = performance.now(); if (loopTimer) { clearTimeout(loopTimer); loopTimer = 0; requestAnimationFrame(loop); } }
['pointerdown', 'pointermove', 'pointerup', 'wheel', 'keydown', 'keyup'].forEach(t => window.addEventListener(t, loopWake, { capture: true, passive: true }));
function loop(now) {
  if (document.querySelector(COVERED)) { loopNext(now); return; }   // nothing to see behind a full-page window
  controls.update();
  const changed = dirty && P;
  if (changed) { dirty = false; draw3D(); drawFlats(); if ((typeof fd !== 'undefined' && fd && fd.moved) || (d3 && d3.moved)) warnLive(); }
  const view = viewNow(), moved = view !== lastView;
  if (changed || moved) loopActive = now;
  let detailReturned = false;
  if (moved) { lastMove = now; if (!changed && sceneTris > BIG_SCENE) detailStepAside(); }
  else if (detailHidden && now - lastMove > DETAIL_REST_MS) { detailBack(); detailReturned = true; }
  if (detailReturned) loopActive = now;
  if (!changed && !moved && !detailReturned && now - lastFrame < 2000) { loopNext(now); return; }   // the odd redraw catches anything that changed quietly, like a picture finishing loading
  lastView = view; lastFrame = now || 0;
  if (P) placeDimLabels();
  if (giz.visible) giz.scale.setScalar(camera.position.distanceTo(giz.position) * .15);
  if (P) updateFloorGrid();
  renderer.render(scene, camera);
  loopNext(now);
}
requestAnimationFrame(loop);
function rayAt(e) {
  const r = renderer.domElement.getBoundingClientRect(), ray = new THREE.Raycaster();
  ray.setFromCamera(new THREE.Vector2((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1), camera);
  return ray;
}
const readoutEl = document.getElementById('readout');
function readout(t) { if (precBuffer) { const at = precTarget(); if (at) t = precPrompt(at); } else if (t && snapHits.length) t += snapNote(); readoutEl.hidden = !t; if (t) readoutEl.textContent = t; }
// shared move: base positions + delta, snapped on the given axes
// which world axis a drag on screen follows most closely, seen from where the part is
function axisOnScreen(at, drag) {
  const len = Math.hypot(drag[0], drag[1]); if (len < 1) return 0;
  const c = screen3D([at.x, at.y, at.z]); if (!c) return 0; let best = 0, score = -1;
  [0, 1, 2].forEach(a => { const e = [at.x, at.y, at.z]; e[a] += 100; const q = screen3D(e); if (!q) return; const dx = q[0] - c[0], dy = q[1] - c[1], l = Math.hypot(dx, dy); if (l < 1e-6) return; const k = Math.abs(dx * drag[0] + dy * drag[1]) / (l * len); if (k > score) { score = k; best = a; } });
  return best;
}
function applyMove(drag, delta, axes, active, thr) {
  const ignore = new Set(sel), nowGuides = [], hits = [];
  if (!movable().length) return;
  if (precAxis != null) { delta = [0, 1, 2].map(i => (i === precAxis ? delta[i] || 0 : 0)); axes = axes.includes(precAxis) ? [precAxis] : []; }
  drag.base.forEach(b => { const it = byId(b.id); it.pos = b.pos.map((p, i) => p + (delta[i] || 0)); });
  axes.forEach(a => {
    const u = unionBounds(movable()), s = snapAxis(a, u.min[a], u.max[a], ignore, thr, active);
    if (s.d) movable().forEach(it => { it.pos[a] += s.d; });
    if (s.at != null) { nowGuides.push({ axis: a, at: s.at }); hits.push(s); }
  });
  guides = nowGuides; snapHits = hits;
}
let d3 = null;
const cv = renderer.domElement;
// a thin outline shows what a click would pick, before you click
const hoverBox = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), new THREE.LineBasicMaterial({ color: 0x20262a, depthTest: false })); hoverBox.visible = false; hoverBox.renderOrder = 8; scene.add(hoverBox);
function hover3d(e) {
  let it = null;
  if (!d3 && !e.buttons && tool !== 'measure' && !gizHover) { const hit = rayAt(e).intersectObjects(pickable).find(h => keptHit(h) && !byId(h.object.userData.id).locked); it = hit ? byId(hit.object.userData.id) : null; }
  if (gizHover) cv.style.cursor = 'grab'; else cv.style.cursor = it ? (tool === 'select' ? 'move' : 'pointer') : '';
  if (it && sel.includes(it.id)) { hoverBox.visible = false; return; }
  hoverBox.visible = !!it;
  if (it) { hoverBox.position.set(...it.pos); hoverBox.quaternion.copy(Q(it)); hoverBox.scale.set(it.l + 2, it.t + 2, it.w + 2); }
}
cv.addEventListener('pointermove', e => {
  cvHover(e); hover3d(e);
  if (tool === 'measure' && (!d3 || d3.type === 'mdrag')) {
    mHover = point3D(e); readout(pointName(mHover)); dirty = true;
    if (!gizHover) cv.style.cursor = d3 ? 'grabbing' : dimHandleAt(screen3D, mCur.x, mCur.y) ? 'grab' : '';
  }
});
cv.addEventListener('pointerleave', () => { hoverBox.visible = false; });
const box3d = document.createElement('div'); box3d.style.cssText = 'position:absolute;display:none;background:rgba(255,201,40,.2);border:1px dashed var(--ink);pointer-events:none;z-index:3'; document.getElementById('pane3d').appendChild(box3d);
const dimLabels = document.createElement('div'); dimLabels.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:2'; document.getElementById('pane3d').appendChild(dimLabels);
function placeDimLabels() {
  const r = host.getBoundingClientRect(); let h = '';
  const one = (a, b, tag) => { const v = V3((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2).project(camera); if (v.z > 1) return ''; return `<span class="dimtag" style="left:${(v.x + 1) / 2 * r.width}px;top:${(1 - v.y) / 2 * r.height}px">${tag ? tag + ' ' : ''}${esc(bare(dist3(a, b)))}</span>`; };
  if (!P.hideDims) drawnDims().forEach(({ a, b }) => { h += one(a, b); });
  if (typeof warnShown === 'function') warnShown().forEach(it => { const v = V3(...it.pos).project(camera); if (v.z < 1) h += `<span class="dimtag" style="left:${(v.x + 1) / 2 * r.width}px;top:${(1 - v.y) / 2 * r.height}px">${it.id}</span>`; });   // the numbers of the panels a warning names
  if (tool === 'measure' && !measA && !P.hideDims) visDims().forEach(({ a, b }) => [a, b].forEach(w => { const q = screen3D(w); if (q) h += `<span class="dimend" style="left:${q[0]}px;top:${q[1]}px"></span>`; }));
  if (tool === 'measure' && measA && mHover) { const a = ptWorld(measA), b = mEndWorld(); if (a && b) h += one(a, b, mAxis != null ? AXN[mAxis] : ''); }
  if (dimLabels.innerHTML !== h) dimLabels.innerHTML = h;
}
cv.addEventListener('pointerleave', () => { if (gizHover) { gizHover.userData.mat.color.setHex(gizHover.userData.base); gizHover = null; cv.style.cursor = ''; } });
cv.addEventListener('pointerdown', e => {
  // Ctrl + drag or middle-button drag always looks around, even starting on an object.
  // OrbitControls reads Ctrl as "pan", so hide the key from it on this one event.
  if (e.button === 0 && (e.ctrlKey || e.metaKey)) {
    Object.defineProperty(e, 'ctrlKey', { value: false }); Object.defineProperty(e, 'metaKey', { value: false });
    controls.enabled = true; d3 = null; return;
  }
  if (e.button !== 0) return;
  if (tool === 'measure') {
    const r = cv.getBoundingClientRect(), h = dimHandleAt(screen3D, e.clientX - r.left, e.clientY - r.top), down = [e.clientX, e.clientY];
    if (h) { grabDimEnd(h); controls.enabled = false; d3 = { type: 'mdrag', down }; return; }
    d3 = { type: 'mpick', down }; return;
  }
  const ray = rayAt(e);
  const gHits = giz.visible ? ray.intersectObjects(gizTargets()) : [];
  const gh = gHits.find(h => h.object.userData.type !== 'move') || gHits[0] || null;
  const down = [e.clientX, e.clientY];
  if (gh) {
    controls.enabled = false;
    const base = movable().map(it => ({ id: it.id, pos: it.pos.slice(), q: it.q.slice(), l: it.l, t: it.t, w: it.w }));
    const c = giz.position.clone(), kind = gh.object.userData.type;
    pushUndo();
    if (kind === 'scale' || kind === 'stretch') {
      const u = unionBounds(movable()), anchor = [c.x, u.min[1], c.z];   // stays standing on what it stands on
      if (kind === 'scale') { d3 = { type: 'scale', base, down, anchor, center: anchor, corner: u.min.slice(), moved: false }; return; }
      const axis = gh.object.userData.axis, axisV = AXES[axis][0], view = V3().subVectors(camera.position, c), n = V3().crossVectors(axisV, V3().crossVectors(view, axisV)).normalize();
      const side = gh.object.userData.side || 1;
      d3 = { type: 'stretch', axis, axisV, side, base, down, anchor, fixed: side > 0 ? u.min[axis] : u.max[axis], mid: (u.min[axis] + u.max[axis]) / 2, ext: u.max[axis] - u.min[axis], plane: new THREE.Plane().setFromNormalAndCoplanarPoint(n, c), start: null, moved: false };
      return;
    }
    const axisV = AXES[gh.object.userData.axis][0];
    if (gh.object.userData.type === 'move') {
      const view = V3().subVectors(camera.position, c), n = V3().crossVectors(axisV, V3().crossVectors(view, axisV)).normalize();
      d3 = { type: 'axis', axis: gh.object.userData.axis, axisV, plane: new THREE.Plane().setFromNormalAndCoplanarPoint(n, c), base, down, start: null, moved: false };
    } else {
      d3 = { type: 'turn', axisV, c, plane: new THREE.Plane().setFromNormalAndCoplanarPoint(axisV, c), base: base.filter(b => !byId(b.id).lockAngle), down, start: null, moved: false };
    }
    return;
  }
  const hit = ray.intersectObjects(pickable).find(h => keptHit(h) && !byId(h.object.userData.id).locked);
  if (!hit && e.shiftKey) { controls.enabled = false; d3 = { type: 'box', down }; return; }   // Shift + drag on empty space draws a selection box
  if (!hit) { d3 = { type: 'empty', down }; return; }
  controls.enabled = false;
  const id = hit.object.userData.id;
  if (e.isDbl) { pick(id, false, true); render(); }
  else if (!sel.includes(id) || e.shiftKey) { pick(id, e.shiftKey); render(); }
  const base = movable().map(it => ({ id: it.id, pos: it.pos.slice(), q: it.q.slice() }));
  pushUndo();
  if (tool !== 'select') {
    const u = unionBounds(movable()), c = V3((u.min[0] + u.max[0]) / 2, (u.min[1] + u.max[1]) / 2, (u.min[2] + u.max[2]) / 2);
    d3 = tool === 'rotate' ? { type: 'spin', base: base.filter(b => !byId(b.id).lockAngle), down, c, axisV: V3(0, 1, 0), moved: false }
      : { type: 'scale', base: movable().map(it => ({ id: it.id, pos: it.pos.slice(), q: it.q.slice(), l: it.l, t: it.t, w: it.w })), down, anchor: [c.x, u.min[1], c.z], center: [c.x, u.min[1], c.z], corner: u.min.slice(), moved: false };
    return;
  }
  // drag along the floor at the grabbed height; hold Shift for straight up and down
  d3 = { type: 'plane', base, down, start: hit.point.clone(), plane: new THREE.Plane().setFromNormalAndCoplanarPoint(V3(0, 1, 0), hit.point), moved: false, id };
}, true);
window.addEventListener('pointermove', e => {
  if (d3 && d3.type === 'box') { const r = document.getElementById('pane3d').getBoundingClientRect(), [a, c] = d3.down; d3.at = [e.clientX, e.clientY]; Object.assign(box3d.style, { display: 'block', left: Math.min(a, e.clientX) - r.left + 'px', top: Math.min(c, e.clientY) - r.top + 'px', width: Math.abs(e.clientX - a) + 'px', height: Math.abs(e.clientY - c) + 'px' }); return; }
  if (!d3 || d3.type === 'empty' || d3.type === 'mpick') return;
  if (!d3.moved && Math.hypot(e.clientX - d3.down[0], e.clientY - d3.down[1]) < 4) return;
  d3.moved = true;
  const ray = rayAt(e), p = V3(), active = P.snap && !e.altKey, thr = camera.position.distanceTo(controls.target) * .009;
  if (d3.type === 'spin') {
    let ang = (e.clientX - d3.down[0]) * .6;
    if (active) ang = snapAngle(ang, e);
    d3.lastAng = ang;
    const r = new THREE.Quaternion().setFromAxisAngle(d3.axisV, ang * Math.PI / 180);
    d3.base.forEach(b => { const it = byId(b.id), q0 = new THREE.Quaternion(...b.q), pp = V3(...b.pos).sub(d3.c).applyQuaternion(r).add(d3.c); it.pos = [pp.x, pp.y, pp.z]; setQ(it, r.clone().multiply(q0)); });
    readout(`${Math.round(ang)}°`);
  } else if (d3.type === 'scale') {
    let f = Math.max(.05, 1 + (e.clientX - d3.down[0] - (e.clientY - d3.down[1])) / 250);
    if (active) f = Math.max(.05, Math.round(f * 20) / 20);
    d3.anchor = e.shiftKey ? d3.center : d3.corner;
    applyScale(d3, f); readout(`Scale ${Math.round(f * 100)}%${e.shiftKey ? ', from the centre' : ''}`);
  } else if (d3.type === 'stretch') {
    if (!ray.ray.intersectPlane(d3.plane, p)) return;
    const along = p.dot(d3.axisV); if (d3.start == null) { d3.start = along; return; }
    let size = Math.max(d3.ext * .02, d3.ext + (along - d3.start) * d3.side * (e.shiftKey ? 2 : 1));
    const hit = active ? stretchSnap(d3.axis, size, d3.side, d3.fixed, d3.mid, e.shiftKey, new Set(sel), thr) : null;
    if (hit) size = hit.size; else if (active) size = Math.max(P.grid, Math.round(size / P.grid) * P.grid);
    guides = hit ? [{ axis: d3.axis, at: hit.at }] : []; snapHits = hit ? [hit.same ? { id: hit.same.id } : hit] : [];
    d3.anchor[d3.axis] = e.shiftKey ? d3.mid : d3.fixed;
    applyScale(d3, size / d3.ext, d3.axis); readout(`${bare(size)}${sizeNote(hit)}${e.shiftKey ? ', both ways' : ''}`);
  } else if (d3.type === 'plane') {
    const lockTo = e.shiftKey && precAxis == null ? axisOnScreen(d3.start, [e.clientX - d3.down[0], e.clientY - d3.down[1]]) : precAxis;
    if (lockTo === 0 || lockTo === 2) {
      if (!ray.ray.intersectPlane(d3.plane, p)) return;
      const dv = [0, 0, 0]; dv[lockTo] = lockTo === 0 ? p.x - d3.start.x : p.z - d3.start.z; applyMove(d3, dv, [lockTo], active, thr);
    } else if (lockTo === 1) {
      const c = d3.start, view = V3().subVectors(camera.position, c); view.y = 0; view.normalize();
      const pl = new THREE.Plane().setFromNormalAndCoplanarPoint(view, c);
      if (!ray.ray.intersectPlane(pl, p)) return;
      applyMove(d3, [0, p.y - c.y, 0], [1], active, thr);
    } else {
      if (!ray.ray.intersectPlane(d3.plane, p)) return;
      applyMove(d3, [p.x - d3.start.x, 0, p.z - d3.start.z], [0, 2], active, thr);
    }
  } else if (d3.type === 'axis') {
    if (!ray.ray.intersectPlane(d3.plane, p)) return;
    const along = p.dot(d3.axisV); if (d3.start == null) d3.start = along;
    const dv = [0, 0, 0]; dv[d3.axis] = along - d3.start;
    applyMove(d3, dv, [d3.axis], active, thr);
  } else if (d3.type === 'turn') {
    if (!ray.ray.intersectPlane(d3.plane, p)) return;
    const v = p.clone().sub(d3.c); if (!d3.start) { d3.start = v.clone(); return; }
    let ang = Math.atan2(V3().crossVectors(d3.start, v).dot(d3.axisV), d3.start.dot(v)) * 180 / Math.PI;
    if (active) ang = snapAngle(ang, e);
    d3.lastAng = ang;
    const r = new THREE.Quaternion().setFromAxisAngle(d3.axisV, ang * Math.PI / 180);
    d3.base.forEach(b => { const it = byId(b.id), q0 = new THREE.Quaternion(...b.q), pp = V3(...b.pos).sub(d3.c).applyQuaternion(r).add(d3.c); it.pos = [pp.x, pp.y, pp.z]; setQ(it, r.clone().multiply(q0)); });
    readout(`${Math.round(ang * 10) / 10}°`);
  }
  if (!['turn', 'spin', 'scale', 'stretch'].includes(d3.type) && sel.length) { const u = unionBounds(selected()); readout(`${bare(u.min[0])}, ${bare(u.min[1])}, ${bare(u.min[2])}`); }
  dirty = true;
});
window.addEventListener('pointerup', e => {
  controls.enabled = true;
  if (!d3) return;
  const t = d3; d3 = null; guides = []; snapHits = []; readout('');
  if (t.type === 'mdrag') {
    cv.style.cursor = '';
    if (Math.hypot(e.clientX - t.down[0], e.clientY - t.down[1]) >= 4) { if (e.target === cv) addMeasurePoint(mHover && mCands.includes(mHover) ? mHover : point3D(e)); else cancelMeasure(); } else startFromGrabbed();
    return;
  }
  if (t.type === 'mpick') { if (Math.hypot(e.clientX - t.down[0], e.clientY - t.down[1]) < 4 && e.target === cv) addMeasurePoint(mHover && mCands.includes(mHover) ? mHover : point3D(e)); readout(''); return; }
  if (t.type === 'box') {
    box3d.style.display = 'none';
    if (!t.at) return;
    const r = cv.getBoundingClientRect(), ax = Math.min(t.down[0], t.at[0]) - r.left, bx = Math.max(t.down[0], t.at[0]) - r.left, ay = Math.min(t.down[1], t.at[1]) - r.top, by = Math.max(t.down[1], t.at[1]) - r.top;
    const inside = shown().filter(it => !it.locked).filter(it => { const c = corners(it).map(q => { const v = V3(...q).project(camera); return [(v.x + 1) / 2 * r.width, (1 - v.y) / 2 * r.height]; }), xs = c.map(q => q[0]), ys = c.map(q => q[1]); return Math.max(...xs) >= ax && Math.min(...xs) <= bx && Math.max(...ys) >= ay && Math.min(...ys) <= by; }).map(i => i.id);
    sel = [...new Set([...sel, ...inside])]; if (sel.length) setTab('props'); render(); return;
  }
  if (t.type === 'empty') { if (Math.hypot(e.clientX - t.down[0], e.clientY - t.down[1]) < 4 && e.target === cv) { sel = []; render(); } return; }
  if (!t.moved) { undoS.pop(); return; }
  persist(); precRemember(t); render();
});
document.getElementById('bView').onclick = resetCam;

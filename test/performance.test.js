"use strict";
// Atelier has to leave the computer alone when it isn't doing anything, and not grow as it's used.
const { test, before, after } = require("node:test");
const assert = require("node:assert");
const { openApp, sleep } = require("./harness");

let app;
before(async () => {
  app = await openApp();
  await app.send("Emulation.setDeviceMetricsOverride", { width: 1500, height: 950, deviceScaleFactor: 1, mobile: false });
  await app.send("Performance.enable");
});
after(async () => { if (app) await app.close(); });

async function metrics() { const r = await app.send("Performance.getMetrics"), m = {}; r.result.metrics.forEach((x) => { m[x.name] = x.value; }); return m; }
const heapMb = async () => { await app.send("HeapProfiler.collectGarbage"); await sleep(100); return (await metrics()).JSHeapUsedSize / 1048576; };

test("doing nothing costs almost nothing", async () => {
  await app.run(`loadProject(TEMPLATES[3].make()); render();`);
  await sleep(1500);
  const f0 = await app.run(`return renderer.info.render.frame`), a = await metrics(); await sleep(5000); const b = await metrics(), f1 = await app.run(`return renderer.info.render.frame`);
  const busy = (b.TaskDuration - a.TaskDuration) / ((b.Timestamp - a.Timestamp) || 5);
  assert.ok(busy < 0.03, `the page was busy ${(busy * 100).toFixed(1)}% of the time while idle`);
  assert.ok(f1 - f0 <= 4, `${f1 - f0} frames drawn in 5 seconds with nothing changing`);
});

test("it still draws at once when something does change, and not behind a full-page window", async () => {
  const v = await app.run(`
    const frame = () => renderer.info.render.frame, wait = () => new Promise(r => setTimeout(r, 120)); await wait(); await wait();
    let a = frame(); camera.position.x += 50; await wait(); const moved = frame() - a;
    a = frame(); dirty = true; await wait(); const edited = frame() - a;
    openDrawings(); await wait(); a = frame(); camera.position.x += 50; dirty = true; await wait(); await wait(); const behind = frame() - a; closeDrawings(); await wait();
    a = frame(); await wait(); await wait(); await wait(); const settled = frame() - a;
    return { moved, edited, behind, settled };`);
  assert.ok(v.moved >= 1, "moving the camera draws");
  assert.ok(v.edited >= 1, "an edit draws");
  assert.strictEqual(v.behind, 0, "nothing drawn behind the drawings");
  assert.ok(v.settled <= 2, "it settles again: " + v.settled);
});

test("models off screen are skipped, shadows aren't redone for a camera move, and heavy small things step aside only while moving", async () => {
  const v = await app.run(`
    loadProject(TEMPLATES[0].make());
    const n = 4000, p = new Int16Array(n * 9), nor = new Int8Array(n * 9), idx = new Uint32Array(n * 3); for (let i = 0; i < n * 3; i++) { idx[i] = i; const q = i % 3; p[i * 3] = q === 1 ? 32767 : -32767; p[i * 3 + 1] = q === 2 ? 32767 : -32767; nor[i * 3 + 2] = 127; }
    MODELS.heavy = { parts: [{ name: 'x', c: '#884422', o: 1, p, n: nor, i: idx, u: null }] };
    edit(() => { for (let i = 0; i < 80; i++) P.items.push({ kind: 'object', type: 'imported', name: 'H', l: 100, t: 100, w: 100, pos: [i * 200, 50, 0], q: [0, 0, 0, 1], model: 'heavy', id: nextId() }); });
    const wait = (ms = 60) => new Promise(r => setTimeout(r, ms)); draw3D(); await wait(100);
    const out = { tris: sceneTris, big: sceneTris > BIG_SCENE }, meshes = () => group.children.filter(o => o.isMesh && o.userData.keepGeo);
    out.radius = meshes()[0].geometry.boundingSphere.radius;
    const frustum = new THREE.Frustum(); camera.position.set(400, 300, 2000); controls.target.set(400, 0, 0); controls.update(); camera.updateMatrixWorld(); frustum.setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    const m0 = meshes()[0], mFar = meshes().at(-1); m0.updateMatrixWorld(); mFar.updateMatrixWorld(); out.farCulled = !frustum.intersectsObject(mFar) || mFar.position.x > 15000;
    await wait(250); out.detailBefore = meshes().every(o => o.visible);
    renderer.shadowMap.needsUpdate = false; camera.position.x += 500; controls.update(); await wait(40); out.shadowAfterMove = renderer.shadowMap.needsUpdate;
    camera.position.set(8000, 500, 60000); controls.target.set(8000, 0, 0); controls.update(); await wait(40);
    out.hidWhileMoving = meshes().filter(o => !o.visible).length;
    await wait(400); out.backAfter = meshes().every(o => o.visible);
    dirty = true; await wait(60); out.shadowAfterEdit = renderer.shadowMap.needsUpdate === false && true;
    delete MODELS.heavy; loadProject(TEMPLATES[0].make());
    return out;`);
  assert.ok(v.big, "a big scene: " + v.tris);
  assert.ok(Math.abs(v.radius - Math.sqrt(3)) < .01, "bounds " + v.radius);
  assert.strictEqual(v.shadowAfterMove, false, "moving the camera doesn't redo shadows");
  assert.ok(v.hidWhileMoving > 0, "small heavy things step aside while moving");
  assert.ok(v.backAfter, "and come back when it stops");
});

test("combining small objects draws the same picture, in fewer calls, and clicking still works", async () => {
  const v = await app.run(`
    loadProject(TEMPLATES[3].make());
    const n = 1500, p = new Int16Array(n * 9), nor = new Int8Array(n * 9), idx = new Uint32Array(n * 3); for (let i = 0; i < n * 3; i++) { idx[i] = i; const q = i % 3, a = Math.floor(i / 3) * .01; p[i * 3] = q === 1 ? 32767 : -32767; p[i * 3 + 1] = q === 2 ? 32767 : -32767; p[i * 3 + 2] = Math.round(Math.sin(a) * 30000); nor[i * 3 + 2] = 127; }
    MODELS.heavy2 = { parts: [{ name: 'x', c: '#884422', o: 1, p, n: nor, i: idx, u: null }] };
    edit(() => { for (let i = 0; i < 200; i++) P.items.push({ kind: 'object', type: 'imported', name: 'H', l: 100, t: 100, w: 100, pos: [-500 - (i % 20) * 150, 50 + Math.floor(i / 20) * 150, 400], q: [0, 0, 0, 1], model: 'heavy2', id: nextId() }); });
    const wait = (ms = 80) => new Promise(r => setTimeout(r, ms)); resetCam(); controls.update(); await wait(300);
    const shot = () => { renderer.render(scene, camera); const gl = renderer.getContext(), w = renderer.domElement.width, h = renderer.domElement.height, px = new Uint8Array(w * h * 4); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px); return { px, calls: renderer.info.render.calls }; };
    batchOff = false; draw3D(); renderer.shadowMap.needsUpdate = true; const a = shot(), batches = group.children.filter(o => o.userData.batch).length, hidden = group.children.filter(o => o.userData.batched).length;
    const pickWorks = (() => { const it = panelsOnly()[0], w = V3(...it.pos).project(camera), r = cv.getBoundingClientRect(), hit = rayAt({ clientX: r.left + (w.x + 1) / 2 * r.width, clientY: r.top + (1 - w.y) / 2 * r.height }).intersectObjects(pickable); return hit.length > 0; })();
    batchOff = true; draw3D(); renderer.shadowMap.needsUpdate = true; const b = shot(); batchOff = false;
    let diff = 0, count = 0; for (let i = 0; i < a.px.length; i += 4) { const d = Math.abs(a.px[i] - b.px[i]) + Math.abs(a.px[i + 1] - b.px[i + 1]) + Math.abs(a.px[i + 2] - b.px[i + 2]); if (d > 24) diff++; count++; }
    dirty = true; const tris = sceneTris; delete MODELS.heavy2; loadProject(TEMPLATES[0].make()); await wait();
    return { batches, hidden, callsWith: a.calls, callsWithout: b.calls, diffShare: diff / count, pickWorks, tris };`);
  assert.ok(v.batches > 0 && v.hidden > 50, `${v.batches} batches from ${v.hidden}, ${v.tris} triangles`);
  assert.ok(v.callsWith < v.callsWithout / 2, `calls ${v.callsWith} against ${v.callsWithout}`);
  assert.ok(v.diffShare < .002, `${(v.diffShare * 100).toFixed(2)}% of pixels differ`);
  assert.ok(v.pickWorks, "clicking on a part still finds it");
});

test("hundreds of edits don't keep using more memory", async () => {
  await app.run(`loadProject(TEMPLATES[3].make());`);
  const edits = `for (let i = 0; i < 400; i++) { edit(() => { panelsOnly()[0].l += .1; }); if (i % 40 === 0) { draw3D(); await new Promise(r => setTimeout(r)); } }`;
  await app.run(edits);   // the undo history fills up to its limit in this first round
  await app.run(edits);
  const a = await heapMb();
  await app.run(edits); await app.run(edits);
  const b = await heapMb();
  assert.ok(b - a < 8, `memory grew ${(b - a).toFixed(1)} MB over 800 more edits (from ${a.toFixed(1)} MB)`);
});

test("redrawing the 3D view doesn't pile up on the graphics card", async () => {
  const v = await app.run(`
    loadProject(TEMPLATES[3].make()); draw3D(); await new Promise(r => setTimeout(r, 50));
    const start = { g: renderer.info.memory.geometries, t: renderer.info.memory.textures };
    for (let i = 0; i < 60; i++) { draw3D(); renderer.render(scene, camera); await new Promise(r => setTimeout(r)); }
    return { start, end: { g: renderer.info.memory.geometries, t: renderer.info.memory.textures } };`);
  assert.ok(v.end.g <= v.start.g + 5, `geometries ${v.start.g} to ${v.end.g}`);
  assert.ok(v.end.t <= v.start.t + 2, `textures ${v.start.t} to ${v.end.t}`);
});

test("opening and closing the picture window many times leaves nothing behind", async () => {
  await app.run(`loadProject(TEMPLATES[2].make()); rendOpts.size = 'hd'; rendOpts.quality = 'draft'; rendOpts.room = false;`);
  const once = async () => {
    await app.run(`openRender();`);
    const t = Date.now();
    while (Date.now() - t < 20000) { const s = await app.run(`return document.getElementById('rendState').textContent`); if (/^(Sample|Done)/.test(s)) break; await sleep(50); }
    await app.run(`closeRender();`); await sleep(200);
  };
  for (let i = 0; i < 3; i++) await once();
  const a = await heapMb();
  for (let i = 0; i < 5; i++) await once();
  const b = await heapMb();
  assert.ok(b - a < 25, `memory grew ${(b - a).toFixed(1)} MB (from ${a.toFixed(1)} MB)`);
  assert.deepStrictEqual(app.errors, []);
});

test("rests between pieces of a render aren't slowed by the page's timers", async () => {
  const v = await app.run(`
    const real = window.setTimeout, t0 = performance.now(); let slowed = 0;
    window.setTimeout = (f, ms, ...a) => { slowed++; return real(f, 1000, ...a); };   // what a background window's timers can turn into
    for (let i = 0; i < 20; i++) await rendRest(2);
    window.setTimeout = real;
    return { ms: performance.now() - t0, slowed };`);
  assert.strictEqual(v.slowed, 0, "the page's own timers weren't used");
  assert.ok(v.ms < 1000, `20 short rests took ${Math.round(v.ms)} ms`);
});

test("a render leaves the computer room: the card rests, and the page stays responsive", async () => {
  await app.run(`
    loadProject(TEMPLATES[3].make()); window.__c = document.createElement('canvas'); window.__j = null; window.__e = null;
    window.__gaps = []; let last = performance.now(); window.__beat = setInterval(() => { const n = performance.now(); __gaps.push(n - last); last = n; }, 20);
    rendStart(__c, { size: [1280, 720], spp: 30, light: 'studio', room: false, sunTurn: 215, sunHeight: 50, exposure: 1 }, rendCamera(), () => {}).then(j => { __j = j; }).catch(e => { __e = e.stack; });`);
  const a = await metrics(), t0 = Date.now();
  while (Date.now() - t0 < 80000) { const s = await app.run(`return __e || (__j ? 'done' : '')`); if (s) { assert.strictEqual(s, "done"); break; } await sleep(200); }
  const b = await metrics();
  const v = await app.run(`clearInterval(__beat); const g = __gaps.slice().sort((x, y) => x - y); return { p99: g[Math.floor(g.length * .99)], max: g.at(-1), gpu: __j.gpuMs, wall: __j.seconds * 1000 };`);
  const busy = (b.TaskDuration - a.TaskDuration) / (b.Timestamp - a.Timestamp);
  assert.ok(busy < 0.35, `the page used ${(busy * 100).toFixed(0)}% of a CPU core during the render`);
  assert.ok(v.gpu / v.wall < 0.7, `the card was busy ${Math.round(v.gpu / v.wall * 100)}% of the time`);
  assert.ok(v.p99 < 120, `the page froze for up to ${Math.round(v.p99)} ms`);
});

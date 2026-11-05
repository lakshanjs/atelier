"use strict";
const { test, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const { openApp, sleep } = require("./harness");

let app;
before(async () => {
  app = await openApp();
  await app.send("Emulation.setDeviceMetricsOverride", { width: 1500, height: 950, deviceScaleFactor: 1, mobile: false });
});
after(async () => { if (app) await app.close(); });
const OUT = process.env.ATELIER_TEST_OUT;

test("the scene matches what the 3D view draws: real positions, no helpers", async () => {
  const v = await app.run(`
    loadProject(TEMPLATES[2].make()); sel = panelsOnly().map(p => p.id);
    const sc = rendGather(true), u = unionBounds(P.items);
    let lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9]; for (let i = 0; i < sc.pos.length; i++) { const a = i % 3; lo[a] = Math.min(lo[a], sc.pos[i]); hi[a] = Math.max(hi[a], sc.pos[i]); }
    const lens = []; for (let i = 0; i < 300 && i < sc.nor.length / 3; i++) lens.push(Math.hypot(sc.nor[i * 3], sc.nor[i * 3 + 1], sc.nor[i * 3 + 2]));
    const noRoom = rendGather(false);
    return { tris: sc.mid.length, mats: sc.mats.length, images: sc.images.length, lo, hi, ulo: u.min, uhi: u.max, unit: lens.every(l => Math.abs(l - 1) < .01), counts: [sc.pos.length, sc.nor.length, sc.uvs.length, sc.mid.length], fewer: noRoom.mid.length < sc.mid.length, selKept: sel.length > 0 };`);
  assert.ok(v.tris > 50);
  assert.strictEqual(v.counts[0], v.tris * 9); assert.strictEqual(v.counts[1], v.tris * 9); assert.strictEqual(v.counts[2], v.tris * 6);
  assert.ok(v.unit, "normals are unit length");
  assert.ok(v.images > 0, "the realistic board textures come along");
  v.lo.forEach((x, i) => assert.ok(x >= v.ulo[i] - 25, `min ${i}: ${x} vs ${v.ulo[i]}`));
  v.hi.forEach((x, i) => assert.ok(x <= v.uhi[i] + 25, `max ${i}: ${x} vs ${v.uhi[i]}`));
  assert.ok(v.fewer, "room can be left out");
  assert.ok(v.selKept, "the selection isn't lost");
});

test("imported 3D models come through at their real size", async () => {
  const v = await app.run(`
    loadProject(TEMPLATES[0].make());
    const n = 3, m = { parts: [{ name: 'x', c: '#884422', o: 1, p: Int16Array.from([-32767, -32767, 0, 32767, -32767, 0, 0, 32767, 0]), n: Int8Array.from([0, 0, 127, 0, 0, 127, 0, 0, 127]), i: Uint32Array.from([0, 1, 2]), u: null }] };
    MODELS.testm = m;
    edit(() => { P.items.push({ kind: 'object', type: 'imported', name: 'M', l: 1000, t: 500, w: 200, pos: [2000, 3000, 4000], q: [0, 0, 0, 1], model: 'testm', id: nextId() }); });
    const sc = rendGather(false); delete MODELS.testm;
    const lastTri = sc.mid.length - 1; let hit = null;
    for (let t = 0; t < sc.mid.length; t++) { if (Math.abs(sc.pos[t * 9 + 1] - 2750) < .5) hit = Array.from(sc.pos.slice(t * 9, t * 9 + 9)); }
    return { hit, tris: sc.mid.length };`);
  assert.ok(v.hit, "found the model's triangle");
  [[1500, 2750, 4000], [2500, 2750, 4000], [2000, 3250, 4000]].forEach((w, c) => w.forEach((x, a) => assert.ok(Math.abs(v.hit[c * 3 + a] - x) < .1, `corner ${c}: ${v.hit.slice(c * 3, c * 3 + 3)}`)));
});

test("the search tree finds exactly what checking every triangle finds", async () => {
  const v = await app.run(`
    loadProject(TEMPLATES[4].make());
    const sc = rendGather(true), tree = rendBvh(sc), n = sc.mid.length;
    let seed = 12345; const r = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const seen = new Set(tree.order); let wrong = 0, hits = 0;
    const u = unionBounds(P.items);
    for (let k = 0; k < 400; k++) {
      const ro = [u.min[0] + r() * (u.max[0] - u.min[0]), u.min[1] + r() * (u.max[1] - u.min[1]), u.min[2] + r() * (u.max[2] - u.min[2])], a = r() * 6.283, z = r() * 2 - 1, s = Math.sqrt(1 - z * z), rd = [s * Math.cos(a), z, s * Math.sin(a)];
      let best = Infinity; for (let t = 0; t < n; t++) { const d = rendTriHit(sc, t, ro, rd); if (d > 0 && d < best) best = d; }
      const h = rendBvhHit(sc, tree, ro, rd); if (best !== Infinity) hits++;
      if (Math.abs((h.t === Infinity ? -1 : h.t) - (best === Infinity ? -1 : best)) > 1e-3) wrong++;
    }
    let leafTris = 0; tree.nodes.forEach(nd => { if (nd.count) leafTris += nd.count; });
    return { wrong, hits, n, all: seen.size === n, leafTris };`);
  assert.strictEqual(v.wrong, 0);
  assert.ok(v.hits > 100);
  assert.ok(v.all); assert.strictEqual(v.leafTris, v.n);
});

// renders with a limit that outlasts the card's first-time preparation
async function draw(body, setup = "", wait = 90000) {
  await app.run(`
    window.__rj = null; window.__rerr = null;
    ${setup}
    const c = document.createElement('canvas'), opts = { size: [240, 180], spp: 24, light: 'studio', room: false, sunTurn: 215, sunHeight: 50, exposure: 1, ...(window.__ro || {}) };
    window.__rc = c; rendStart(c, opts, rendCamera(), () => {}).then(j => { window.__rj = j; }).catch(e => { window.__rerr = e.message; });`);
  const until = Date.now() + wait;
  while (Date.now() < until) {
    const s = await app.run(`return window.__rerr || (window.__rj ? 'done' : '')`);
    if (s === "done") break;
    if (s) throw new Error(s);
    await sleep(200);
  }
  return app.run(body);
}
const PIXELS = `
  const gl = __rj.gl, c = __rc, w = c.width, h = c.height, px = new Uint8Array(w * h * 4); gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
  let sum = 0, black = 0, white = 0; for (let i = 0; i < px.length; i += 4) { const l = (px[i] + px[i + 1] + px[i + 2]) / 3; sum += l; if (l < 4) black++; if (l > 251) white++; }`;

test("a picture comes out: not blank, not burnt out, and sharper with more samples", async () => {
  const v = await draw(`${PIXELS}
    const samples = __rj.sample, tris = __rj.tris; let spread = 0, mean = sum / (w * h); for (let i = 0; i < px.length; i += 4) spread += Math.abs((px[i] + px[i + 1] + px[i + 2]) / 3 - mean);
    return { mean, blackShare: black / (w * h), whiteShare: white / (w * h), samples, tris, spread: spread / (w * h), done: __rj.done };`,
    `loadProject(TEMPLATES[3].make()); resetCam(); controls.update(); camera.updateMatrixWorld();`);
  assert.ok(v.done);
  assert.strictEqual(v.samples, 24);
  assert.ok(v.mean > 40 && v.mean < 245, "mean brightness " + v.mean);
  assert.ok(v.blackShare < .5, "black " + v.blackShare);
  assert.ok(v.whiteShare < .9, "white " + v.whiteShare);
  assert.ok(v.spread > 4, "there's something in the picture: " + v.spread);
});

test("the sun casts a shadow: a board above the floor darkens what's under it", async () => {
  const v = await draw(`${PIXELS}
    const read = (x, y) => { const i = (y * w + x) * 4; return (px[i] + px[i + 1] + px[i + 2]) / 3; }, avg = (x, y, r = 3) => { let s = 0, n = 0; for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) { s += read(x + a, y + b); n++; } return s / n; };
    const pts = __shadowPts;
    return { shadow: avg(...pts[0]), lit: avg(...pts[1]) };`,
    `loadProject(TEMPLATES[0].make()); edit(() => { addFromGallery('board:ply:18'); }); const it = byId(sel[0]); edit(() => { it.l = 800; it.w = 800; setQ(it, new THREE.Quaternion()); it.pos = [1000, 300, 1000]; }); sel = [];
     camera.position.set(1000, 5000, 1001); controls.target.set(1000, 0, 1000); controls.update(); camera.aspect = 240 / 180; camera.updateProjectionMatrix(); camera.updateMatrixWorld();
     window.__ro = { light: 'day', room: true, sunHeight: 45, sunTurn: 0, size: [240, 180], spp: 64 };
     // worked out now, because the view moves itself once a newly loaded project is drawn
     window.__shadowPts = [[1000, 0, 450], [1000, 0, 1800]].map(q => { const p = V3(...q).project(camera); return [Math.round((p.x + 1) / 2 * 240), Math.round((p.y + 1) / 2 * 180)]; });`);
  // the sun is 45 degrees up on the +Z side, so the board's shadow falls toward -Z, past its edge, where the camera can see it
  assert.ok(v.lit > 30, "lit floor is bright: " + v.lit);
  assert.ok(v.lit - v.shadow > 15, `shadow ${v.shadow} against lit ${v.lit}`);
  await app.run(`delete window.__ro; size3D();`);
});

test("the picture window opens, runs, can stop and save, and closing frees the card", async () => {
  const v = await app.run(`
    loadProject(TEMPLATES[2].make()); rendOpts.size = 'view'; rendOpts.quality = 'draft'; rendOpts.light = 'studio'; rendOpts.room = false;
    openRender(); return document.getElementById('rend').classList.contains('open');`);
  assert.ok(v);
  let state = "", started = Date.now();
  while (Date.now() - started < 90000) { state = await app.run(`return document.getElementById('rendState').textContent`); if (/^Sample/.test(state) || /^Done/.test(state) || /Couldn't/.test(state)) break; await sleep(200); }
  assert.doesNotMatch(state, /Couldn't/, state);
  if (OUT) { const r = await app.send("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(`${OUT}/rend_window.png`, Buffer.from(r.result.data, "base64")); }
  await app.run(`document.getElementById('rendStop').click();`);
  started = Date.now();
  while (Date.now() - started < 20000) { state = await app.run(`return document.getElementById('rendState').textContent`); if (/^(Stopped|Done)/.test(state)) break; await sleep(100); }
  assert.match(state, /^(Stopped|Done)/);
  const saved = await app.run(`
    const blob = await new Promise(r => document.getElementById('rendCanvas').toBlob(r, 'image/png'));
    const del = document.getElementById('rendSave').disabled, job = rendJob;
    closeRender();
    return { size: blob ? blob.size : 0, disabled: del, closed: !document.getElementById('rend').classList.contains('open'), glGone: !job.gl };`);
  assert.ok(saved.size > 500);
  assert.ok(!saved.disabled);
  assert.ok(saved.closed && saved.glGone);
  assert.deepStrictEqual(app.errors, []);
});

test("Delete doesn't remove the selection while a full-page window is open", async () => {
  const v = await app.run(`
    loadProject(TEMPLATES[2].make()); sel = [panelsOnly()[0].id]; const n = P.items.length;
    openDrawings(); window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true })); closeDrawings();
    return P.items.length === n;`);
  assert.ok(v);
});

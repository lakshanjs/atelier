"use strict";
const { test, before, after } = require("node:test");
const assert = require("node:assert");
const { openApp, sleep } = require("./harness");

let app;
before(async () => {
  app = await openApp();
  await app.send("Emulation.setDeviceMetricsOverride", { width: 1500, height: 950, deviceScaleFactor: 1, mobile: false });
  await sleep(200);
});
after(async () => { if (app) await app.close(); });

const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.01, `${msg || ""} ${a} vs ${b}`);
// real mouse and keyboard input, through the same route as a person's
const mouse = (type, x, y, buttons = 1) => app.send("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" && !buttons ? "none" : "left", buttons, clickCount: type === "mouseMoved" ? 0 : 1 });
async function key(k) {
  const special = { Enter: 13, Escape: 27, Backspace: 8 };
  const base = { key: k, code: special[k] ? k : undefined, windowsVirtualKeyCode: special[k] || k.toUpperCase().charCodeAt(0) };
  await app.send("Input.dispatchKeyEvent", { type: "keyDown", ...base, ...(special[k] ? {} : { text: k }) });
  await app.send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
}
const typeText = async (s) => { for (const c of s) await key(c); };
// a flat view's point in page coordinates, for a world position
const SETUP = (idx = 0) => `
  loadProject(TEMPLATES[${idx}].make()); P.unit = 'mm'; P.grid = 1; P.snap = true; setBig('front'); fitView('front'); render();
  edit(() => { addFromGallery('board:ply:18'); });
  const it = byId(sel[0]); edit(() => { it.l = 500; it.w = 300; setQ(it, new THREE.Quaternion()); it.pos = [800, 500, 500]; }); sel = [it.id]; setTab('props'); Object.keys(VIEWS).forEach(fitView); render();
  await new Promise(r => setTimeout(r, 120));
  window.flatAt = (vn, w) => { const el = document.getElementById(VIEWS[vn].el), r = el.getBoundingClientRect(); const q = toS(vn, vt[vn], w); return [r.left + q[0], r.top + q[1]]; };`;
const setup = (idx) => app.run(`${SETUP(idx)} return { id: it.id, pos: it.pos.slice() };`);
const at = (w) => app.run(`return flatAt('front', ${JSON.stringify(w)});`);
const pos = (id) => app.run(`return byId(${id}).pos.slice();`);

test("typing during a drag gives an exact move, in the direction dragged", async () => {
  const { id, pos: p0 } = await setup();
  const [x, y] = await at([800, 500, 500]);
  await mouse("mouseMoved", x, y, 0); await mouse("mousePressed", x, y); await mouse("mouseMoved", x + 60, y + 4); await sleep(30);
  await typeText("137.5");
  assert.match(await app.run(`return document.getElementById('readout').textContent`), /137\.5_/);
  await key("Enter");
  await mouse("mouseReleased", x + 60, y + 4, 0); await sleep(30);
  const p = await pos(id);
  near(p[0] - p0[0], 137.5, "x"); near(p[1], p0[1], "y"); near(p[2], p0[2], "z");
  assert.strictEqual(await app.run(`undo(); return byId(${id}).pos[0]`), p0[0], "one undo puts it back");
});

test("a left drag with a typed distance goes left; units work", async () => {
  const { id, pos: p0 } = await setup();
  const [x, y] = await at([800, 500, 500]);
  await mouse("mouseMoved", x, y, 0); await mouse("mousePressed", x, y); await mouse("mouseMoved", x - 50, y, 1); await sleep(30);
  await typeText("10cm"); await key("Enter"); await mouse("mouseReleased", x - 50, y, 0); await sleep(30);
  near((await pos(id))[0] - p0[0], -100);
});

test("the number can be typed just after letting go", async () => {
  const { id, pos: p0 } = await setup();
  const [x, y] = await at([800, 500, 500]);
  await mouse("mouseMoved", x, y, 0); await mouse("mousePressed", x, y); await mouse("mouseMoved", x, y - 50); await mouse("mouseReleased", x, y - 50, 0); await sleep(30);
  await typeText("250"); await key("Enter"); await sleep(30);
  const p = await pos(id);
  near(p[1] - p0[1], 250, "up"); near(p[0], p0[0]);
  const v = await app.run(`undo(); return byId(${id}).pos[1]`);
  near(v, p0[1], "undo returns to before the drag");
});

test("digits typed later, after something else happened, do nothing", async () => {
  const { id } = await setup();
  const [x, y] = await at([800, 500, 500]);
  await mouse("mouseMoved", x, y, 0); await mouse("mousePressed", x, y); await mouse("mouseMoved", x + 40, y); await mouse("mouseReleased", x + 40, y, 0); await sleep(30);
  await app.run(`edit(() => { byId(${id}).name = 'Changed'; });`);
  const before = await pos(id);
  await typeText("99"); await key("Enter");
  assert.deepStrictEqual(await pos(id), before);
});

test("Esc cancels a drag and restores everything", async () => {
  const { id, pos: p0 } = await setup();
  const [x, y] = await at([800, 500, 500]);
  await mouse("mouseMoved", x, y, 0); await mouse("mousePressed", x, y); await mouse("mouseMoved", x + 80, y + 30); await sleep(30);
  await key("Escape"); await mouse("mouseReleased", x + 80, y + 30, 0); await sleep(30);
  assert.deepStrictEqual(await pos(id), p0);
});

test("holding to an axis keeps a diagonal drag straight", async () => {
  const { id, pos: p0 } = await setup();
  const [x, y] = await at([800, 500, 500]);
  await mouse("mouseMoved", x, y, 0); await mouse("mousePressed", x, y); await mouse("mouseMoved", x + 30, y + 3); await sleep(20);
  await key("y");
  await mouse("mouseMoved", x + 90, y - 70); await sleep(30); await mouse("mouseReleased", x + 90, y - 70, 0); await sleep(30);
  const p = await pos(id);
  near(p[0], p0[0], "x held"); assert.ok(p[1] > p0[1] + 20, "moved up " + p[1]);
});

test("Move by and Turn by in Properties, and the angle step", async () => {
  const v = await app.run(`${SETUP()}
    const box = k => document.querySelector('[data-f="' + k + '"]'), type = (k, t) => { const b = box(k); b.value = t; b.dispatchEvent(new Event('change')); };
    const p0 = it.pos.slice(); type('mb0', '25'); type('mb1', '-10');
    const moved = [it.pos[0] - p0[0], it.pos[1] - p0[1]];
    const t = document.querySelector('#precTurn'); openSec.angle = true; render(); const t2 = document.querySelector('#precTurn'); t2.value = '30'; t2.dispatchEvent(new Event('change'));
    document.querySelector('[data-rot="1"]').click();
    const yaw = Math.abs(eulerOf(it)[1]); precTurnBy = 90;
    const ev = { shiftKey: false }; P.angleStep = 45; const a = snapAngle(50, ev), b = snapAngle(50, { shiftKey: true }); P.angleStep = 15;
    return { moved, yaw, a, b };`);
  near(v.moved[0], 25); near(v.moved[1], -10); near(v.yaw, 30); assert.strictEqual(v.a, 45); assert.strictEqual(v.b, 90);
});

test("a locked angle can't be turned, but can still move", async () => {
  const v = await app.run(`${SETUP()}
    edit(() => { it.lockAngle = true; }); const q0 = JSON.stringify(it.q), p0 = it.pos[0];
    edit(() => rotateSel(AXES[1][0], 90));
    edit(() => { it.pos[0] += 10; });
    openSec.angle = true; render();
    return { same: JSON.stringify(it.q) === q0, moved: it.pos[0] - p0, off: document.querySelector('[data-rot="1"]').disabled };`);
  assert.ok(v.same); near(v.moved, 10); assert.ok(v.off);
});

test("a guide dragged from the ruler is placed, snapped to, moved, and deleted on the ruler", async () => {
  const { id } = await setup();
  const rect = await app.run(`const r = document.getElementById('vfront').getBoundingClientRect(); return [r.left, r.top, r.width, r.height]`);
  const gx = rect[0] + rect[2] * .7, gy = rect[1] + rect[3] * .4;
  await mouse("mouseMoved", gx, rect[1] + 6, 0); await mouse("mousePressed", gx, rect[1] + 6); await mouse("mouseMoved", gx, gy); await mouse("mouseReleased", gx, gy, 0); await sleep(30);
  let g = await app.run(`return JSON.parse(JSON.stringify(P.cguides))`);
  assert.strictEqual(g.length, 1); assert.strictEqual(g[0].axis, 1, "from the top ruler: a level line");
  const shownSvg = await app.run(`return document.getElementById('vfront').innerHTML.includes('stroke-dasharray="5 3"')`);
  assert.ok(shownSvg, "drawn in the view");

  const snap = await app.run(`
    const it = byId(${id}), b = bounds(it), s = snapAxis(1, b.min[1], b.max[1], new Set([it.id]), Math.abs(P.cguides[0].at - b.max[1]) + 5, true);
    return { at: s.at, guide: s.guide, want: P.cguides[0].at };`);
  assert.ok(snap.guide); near(snap.at, snap.want);

  const [qx, qy] = await app.run(`return flatAt('front', [0, P.cguides[0].at, 0]);`).then((p) => [gx, p[1]]);
  await mouse("mouseMoved", qx, qy, 0); await mouse("mousePressed", qx, qy); await mouse("mouseMoved", qx, qy + 40); await mouse("mouseReleased", qx, qy + 40, 0); await sleep(30);
  const moved = await app.run(`return P.cguides[0].at`);
  assert.ok(moved < g[0].at - 5, `moved from ${g[0].at} to ${moved}`);
  assert.ok(await app.run(`undo(); const a = P.cguides[0].at; redo(); return a !== P.cguides[0].at`), "moves can be undone");

  const [dx, dy] = [qx, await app.run(`return flatAt('front', [0, P.cguides[0].at, 0])[1]`)];
  await mouse("mouseMoved", dx, dy, 0); await mouse("mousePressed", dx, dy); await mouse("mouseMoved", dx, rect[1] + 5); await mouse("mouseReleased", dx, rect[1] + 5, 0); await sleep(30);
  assert.strictEqual(await app.run(`return P.cguides.length`), 0);
});

test("guides are listed in Properties and can be switched off", async () => {
  const v = await app.run(`
    loadProject(TEMPLATES[0].make()); sel = []; P.unit = 'mm'; setTab('props'); openSec.guides = true; render();
    document.querySelector('#gdAdd').click();
    const b = document.querySelector('[data-f="gd0"]'); b.value = '300'; b.dispatchEvent(new Event('change'));
    const at = P.cguides[0].at, drew = guideTargets(0).length;
    document.querySelector('#gdShow').click(); const off = guideTargets(0).length;
    draw3D();
    document.querySelector('#gdShow').click(); draw3D();
    document.querySelector('[data-gddel="0"]').click();
    return { at, drew, off, left: P.cguides.length };`);
  near(v.at, 300); assert.strictEqual(v.drew, 1); assert.strictEqual(v.off, 0); assert.strictEqual(v.left, 0);
  assert.deepStrictEqual(app.errors, []);
});

test("you can see what snapped", async () => {
  const v = await app.run(`${SETUP()}
    edit(() => { addFromGallery('board:ply:18'); }); const other = byId(sel[0]); edit(() => { other.name = 'Neighbour'; setQ(other, new THREE.Quaternion()); other.l = 400; other.pos = [1500, 500, 500]; });
    sel = [it.id]; render();
    const u = bounds(it), o = bounds(other), base = [{ id: it.id, pos: it.pos.slice() }], gap = o.min[0] - u.max[0];
    applyMove({ base }, [gap - 2, 0, 0], [0], true, 8);
    const hits = snapHits.length, touch = bounds(it).max[0] - bounds(other).min[0];
    readout('A'); const said = document.getElementById('readout').textContent;
    const svg = snapHighlightSvg('front', vt.front);
    draw3D(); snapHits = []; readout('');
    return { hits, touch, said, svg: svg.includes('polygon') };`);
  assert.strictEqual(v.hits, 1); near(v.touch, 0); assert.match(v.said, /snapped to Neighbour/); assert.ok(v.svg);
  assert.deepStrictEqual(app.errors, []);
});

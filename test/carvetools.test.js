"use strict";
const { test, before, after } = require("node:test");
const assert = require("node:assert");
const { openApp } = require("./harness");

let app;
before(async () => { app = await openApp(); });
after(async () => { if (app) await app.close(); });

// a fresh Carve board, 300 x 200, with every starting bit owned
const START = `
  loadProject(newProject('Tools')); document.querySelectorAll('dialog[open]').forEach(d => d.close());
  cvBits = JSON.parse(JSON.stringify(CV_BITS_START)); P.carve = null; await openCarve(); document.querySelectorAll('dialog[open]').forEach(d => d.close());
  const cv = P.carve; cv.board = { wood: 'bass', l: 300, w: 200, t: 6 }; cvView = null; cvPickOnly(null); carveRender();
  const box = i => { const b = cvWorldBox(i); return [b.x0, b.y0, b.x1, b.y1].map(v => Math.round(v * 100) / 100); };
  const area = i => Math.round(Math.abs(cvLocal(i).regions.reduce((s, p) => s + cvArea(p), 0)) * 10) / 10;`;
// where a board point is on screen, for the real mouse
const HELP = `const box = i => { const b = cvWorldBox(i); return [b.x0, b.y0, b.x1, b.y1].map(v => Math.round(v * 100) / 100); }; const area = i => Math.round(Math.abs(cvLocal(i).regions.reduce((s, p) => s + cvArea(p), 0)) * 10) / 10;`;
const SCREEN = `const scr = (x, y) => { const r = document.getElementById('cvStage').getBoundingClientRect(); return [r.left + (x - cvView.x) / cvView.k, r.top + (P.carve.board.w - y - cvView.y) / cvView.k]; };`;
const mouse = (type, x, y, buttons, extra = {}) => app.send("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons, clickCount: 1, ...extra });
const click = async (x, y, extra = {}) => { await mouse("mouseMoved", x, y, 0, extra); await mouse("mousePressed", x, y, 1, extra); await mouse("mouseReleased", x, y, 0, extra); };

test("polygons and stars: the size asked for, with their points, sides and rounded corners, and they cut", async () => {
  const v = await app.run(`${START}
    const p = cvAddPolygon('polygon'), s = cvAddPolygon('star'); p.w = p.h = 60; s.w = s.h = 80; s.x = 220;
    const a = { pts: cvLocal(p).regions[0].length, box: [cvLocal(p).w, cvLocal(p).h], star: cvLocal(s).regions[0].length, sbox: [cvLocal(s).w, cvLocal(s).h] };
    cvSel = s.id; carveRender(); const fields = [...document.querySelectorAll('#cvSide [data-cf^="t."]')].map(e => e.dataset.cf);
    const set = (k, val) => { const el = document.querySelector('[data-cf="' + k + '"]'); el.value = val; el.dispatchEvent(new Event('change', { bubbles: true })); };
    set('t.points', '7'); set('t.inner', '40'); const seven = cvLocal(s).regions[0].length;
    set('t.corner', '3mm'); const rounded = cvLocal(s).regions[0].length;
    s.op = cvOpFor(cv, 'pocket'); const job = cvJob(cv, cvBitOf, 'T').length, bad = cvChecks(cv, cvBitOf, true).filter(c => c.bad).length, names = [cvItemName(p), cvItemName(s)];
    closeCarve(); return { a, fields, seven, rounded, job, bad, names, inner: s.inner, points: s.points };`);
  assert.strictEqual(v.a.pts, 6); assert.strictEqual(v.a.star, 10, "a five-point star has ten corners");
  v.a.box.concat(v.a.sbox).forEach((n, i) => assert.ok(Math.abs(n - [60, 60, 80, 80][i]) < .01, "fills the size asked: " + n));
  assert.ok(v.fields.includes("t.points") && v.fields.includes("t.inner") && v.fields.includes("t.corner"));
  assert.strictEqual(v.seven, 14); assert.strictEqual(v.points, 7); assert.strictEqual(v.inner, .4);
  assert.ok(v.rounded > 14, "rounded corners add points to the curve");
  assert.deepStrictEqual(v.names, ["Polygon", "Star"]); assert.strictEqual(v.job, 2, "the polygon engraved with the V-bit, the star pocketed with a flat bit"); assert.strictEqual(v.bad, 0);
});

test("drawing: click points with the real mouse, click the first to close, and it becomes a shape that cuts", async () => {
  await app.run(`${START} cvToolStart('pen');`);
  const pts = await app.run(`${SCREEN} return [[100, 50], [200, 50], [200, 150], [100, 150]].map(q => scr(...q));`);
  for (const p of pts) await click(p[0], p[1]);
  const mid = await app.run(`return { drawing: !!cvTool, n: cvTool.pts.length, panel: document.getElementById('cvHead').textContent }`);
  await click(pts[0][0] + 2, pts[0][1] + 1);   // near enough the first point
  const v = await app.run(`${HELP} const it = P.carve.items[0]; return { n: P.carve.items.length, type: it.type, closed: it.paths[0].closed, pts: it.paths[0].pts.length, box: box(it), area: area(it), name: cvItemName(it), picked: cvSel === it.id, drawing: !!cvTool };`);
  assert.ok(mid.drawing); assert.strictEqual(mid.n, 4); assert.match(mid.panel, /Drawing a line/);
  assert.strictEqual(v.n, 1); assert.strictEqual(v.type, "path"); assert.ok(v.closed); assert.strictEqual(v.pts, 4);
  v.box.forEach((n, i) => assert.ok(Math.abs(n - [100, 50, 200, 150][i]) < .8, "where it was drawn: " + v.box));
  assert.ok(Math.abs(v.area - 10000) < 200, "the area drawn: " + v.area); assert.strictEqual(v.name, "Shape"); assert.ok(v.picked); assert.ok(!v.drawing, "drawing stops");
  // an open line finished with Enter, then smoothed into a curve, can be closed
  await app.run(`cvToolStart('pen');`);
  const open = await app.run(`${SCREEN} return [[30, 30], [60, 80], [90, 30]].map(q => scr(...q));`);
  for (const p of open) await click(p[0], p[1]);
  await app.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  const w = await app.run(`const it = P.carve.items[1], straight = cvLocal(it).lines[0].pts.length; it.smooth = true; const curve = cvLocal(it).lines[0].pts.length;
    cvSel = it.id; carveRender(); const canClose = !!document.querySelector('[data-cact="t-close"]'); document.querySelector('[data-cact="t-close"]').click();
    const out = { type: it.type, closed: it.paths[0].closed, straight, curve, canClose, name: cvItemName(it), job: cvJob(P.carve, cvBitOf, 'T').length }; closeCarve(); return out;`);
  assert.strictEqual(w.straight, 3); assert.ok(w.curve > 20, "smooth makes a curve through the points"); assert.ok(w.canClose); assert.ok(w.closed); assert.strictEqual(w.name, "Shape"); assert.ok(w.job >= 1);
  assert.deepStrictEqual(app.errors, []);
});

test("picking many: shift-click and a dragged box with the real mouse, then line up, spread and centre", async () => {
  await app.run(`${START}
    const a = cvAddRect(); a.w = 20; a.h = 10; a.x = 40; a.y = 40; const b = cvAddRect(); b.w = 30; b.h = 30; b.x = 120; b.y = 90; const c = cvAddCircle(); c.w = c.h = 16; c.x = 250; c.y = 150;
    cvPickOnly(null); carveRender();`);
  const p = await app.run(`${SCREEN} const it = P.carve.items; return { a: scr(it[0].x, it[0].y), b: scr(it[1].x, it[1].y), c: scr(it[2].x, it[2].y), from: scr(20, 20), to: scr(140, 110) };`);
  await click(p.a[0], p.a[1]); await click(p.b[0], p.b[1], { modifiers: 8 });
  const two = await app.run(`return { n: cvPicked().length, head: document.getElementById('cvHead').textContent, boxes: document.querySelectorAll('#cvStage rect[stroke-dasharray]').length }`);
  await mouse("mouseMoved", p.from[0], p.from[1], 0); await mouse("mousePressed", p.from[0], p.from[1], 1); await mouse("mouseMoved", (p.from[0] + p.to[0]) / 2, p.to[1], 1); await mouse("mouseMoved", p.to[0], p.to[1], 1); await mouse("mouseReleased", p.to[0], p.to[1], 0);
  const boxed = await app.run(`return cvPicked().map(i => i.type)`);
  const v = await app.run(`${HELP}
    const [a, b, c] = P.carve.items; cvPickList([a, b, c]); carveRender();
    const act = k => document.querySelector('[data-cact="' + k + '"]').click();
    act('m-left'); const left = [a, b, c].map(i => box(i)[0]);
    act('m-midy'); const midy = [a, b, c].map(i => (box(i)[1] + box(i)[3]) / 2);
    a.x = 40; b.x = 100; c.x = 250; act('m-spreadx'); const gaps = [box(b)[0] - box(a)[2], box(c)[0] - box(b)[2]];
    act('m-centre'); const all = cvBox([a, b, c].map(i => { const q = box(i); return [[q[0], q[1]], [q[2], q[3]]]; }));
    document.querySelector('[data-cf="m.kind"][value="outside"]').click(); const kinds = [a, b, c].map(i => i.op.kind);
    act('dup'); const after = P.carve.items.length, picked = cvPicked().length;
    closeCarve(); return { left, midy, gaps, mid: [(all.x0 + all.x1) / 2, (all.y0 + all.y1) / 2], kinds, after, picked };`);
  assert.strictEqual(two.n, 2, "shift-click adds"); assert.match(two.head, /2 items/); assert.strictEqual(two.boxes, 2);
  assert.deepStrictEqual(boxed, ["rect", "rect"], "the box picks what it touches, and not the circle outside it");
  v.left.forEach(x => assert.ok(Math.abs(x - 30) < .01, "left edges lined up: " + v.left));
  v.midy.forEach(y => assert.ok(Math.abs(y - v.midy[0]) < .01, "middles lined up"));
  assert.ok(Math.abs(v.gaps[0] - v.gaps[1]) < .01, "spread evenly: " + v.gaps);
  assert.ok(Math.abs(v.mid[0] - 150) < .01 && Math.abs(v.mid[1] - 100) < .01, "centred together on the board");
  assert.deepStrictEqual(v.kinds, ["outside", "outside", "outside"], "one job for all");
  assert.strictEqual(v.after, 6); assert.strictEqual(v.picked, 3, "the copies are picked");
  assert.deepStrictEqual(app.errors, []);
});

test("joining: weld, cut away and overlap make one shape with the first one's job", async () => {
  const v = await app.run(`${START}
    const make = () => { P.carve.items = []; const a = cvAddRect(); a.w = 40; a.h = 40; a.x = 100; a.y = 100; a.op = cvOpFor(cv, 'pocket'); const b = cvAddCircle(); b.w = b.h = 40; b.x = 120; b.y = 100; b.op = cvOpFor(cv, 'line'); cvPickList([a, b]); carveRender(); };
    const run = k => { make(); document.querySelector('[data-cact="' + k + '"]').click(); const it = P.carve.items; return { n: it.length, type: it[0].type, area: area(it[0]), kind: it[0].op.kind, box: box(it[0]) }; };
    const out = { weld: run('m-weld'), cut: run('m-subtract'), over: run('m-intersect') };
    make(); P.carve.items[1].x = 250; carveRender(); document.querySelector('[data-cact="m-intersect"]').click(); out.none = P.carve.items.length;
    out.cuts = cvJob(cv, cvBitOf, 'T').length; closeCarve(); return out;`);
  const circle = Math.PI * 400, overlap = 0;   // a 40 square and a 40 circle whose middle is on the square's right edge: half the circle overlaps
  assert.strictEqual(v.weld.n, 1); assert.strictEqual(v.weld.type, "path"); assert.strictEqual(v.weld.kind, "pocket", "keeps the first one's job");
  assert.ok(Math.abs(v.weld.area - (1600 + circle / 2)) < 15, "weld: the square and the half of the circle outside it: " + v.weld.area);
  assert.ok(Math.abs(v.cut.area - (1600 - circle / 2)) < 15, "cut away: the square without the circle: " + v.cut.area);
  assert.ok(Math.abs(v.over.area - circle / 2) < 15, "overlap: only the half circle inside the square: " + v.over.area);
  assert.ok(Math.abs(v.over.box[0] - 100) < .2 && Math.abs(v.over.box[2] - 120) < .2, "and in the right place: " + v.over.box);
  assert.strictEqual(v.none, 2, "nothing overlapping leaves both as they were");
  assert.deepStrictEqual(app.errors, []);
});

test("mirror, outline, and copies in rows or a ring", async () => {
  const v = await app.run(`${START}
    const t = cvMakePath([{ closed: true, pts: [[100, 100], [140, 100], [100, 120]] }], null); cvSel = t.id; carveRender();
    const act = k => document.querySelector('[data-cact="' + k + '"]').click(), set = (k, val) => { const el = document.querySelector('[data-cf="' + k + '"]'); el.value = val; el.dispatchEvent(new Event('change', { bubbles: true })); };
    const corner = () => { const r = cvWorldShape(t).regions[0], b = cvBox([r]); return r.some(q => Math.abs(q[0] - b.x0) < .01 && Math.abs(q[1] - b.y1) < .01) ? 'left' : 'right'; };
    const before = corner(); act('t-mx'); const mirrored = corner(), mx = t.mx; act('t-mx');
    set('t.off', '5mm'); act('t-out'); const outline = P.carve.items[1], ob = box(outline), tb = box(t);
    cvSel = t.id; carveRender(); set('t.cols', '3'); set('t.rows', '2'); set('t.gap', '10mm'); act('t-grid'); const grid = P.carve.items.filter(i => i.type === 'path' && JSON.stringify(i.paths) === JSON.stringify(t.paths)).map(i => [Math.round(i.x * 100) / 100, Math.round(i.y * 100) / 100]);
    P.carve.items = [t]; cvPickOnly(t.id); carveRender(); t.x = 150; t.y = 160; set('t.ring', '4'); act('t-ring'); const ring = P.carve.items.map(i => [Math.round(i.x), Math.round(i.y), i.rot]);
    closeCarve(); return { before, mirrored, mx, ob, tb, grid, ring, w: tb[2] - tb[0], h: tb[3] - tb[1] };`);
  assert.strictEqual(v.before, "left"); assert.strictEqual(v.mirrored, "right", "mirrored left to right"); assert.strictEqual(v.mx, true);
  assert.ok(Math.abs(v.ob[0] - (v.tb[0] - 5)) < .05 && Math.abs(v.ob[3] - (v.tb[3] + 5)) < .4, "an outline 5 outside: " + v.ob + " round " + v.tb);
  assert.strictEqual(v.grid.length, 6, "three across and two back");
  const xs = [...new Set(v.grid.map(p => p[0]))].sort((a, b) => a - b), ys = [...new Set(v.grid.map(p => p[1]))].sort((a, b) => a - b);
  assert.ok(Math.abs(xs[1] - xs[0] - (v.w + 10)) < .02 && Math.abs(ys[1] - ys[0] - (v.h + 10)) < .02, "each a gap of 10 from the next");
  assert.deepStrictEqual(v.ring, [[150, 160, 0], [90, 100, 90], [150, 40, 180], [210, 100, 270]], "round the middle of the board, each turned to face it");
  assert.deepStrictEqual(app.errors, []);
});

test("editing points: any shape becomes editable, points drag with the real mouse, double-click adds one, Delete takes one away", async () => {
  await app.run(`${START} const r = cvAddRect(); r.w = 60; r.h = 40; r.x = 150; r.y = 100; r.op = cvOpFor(cv, 'pocket'); cvPickOnly(r.id); carveRender();
    document.querySelector('[data-cact="t-nodes"]').click();`);
  const a = await app.run(`${SCREEN} const it = P.carve.items[0], place = cvPlaceFn(it), pts = it.paths[0].pts.map(q => place(q));
    const right = pts.reduce((m, q) => (q[0] > m[0] || (q[0] === m[0] && q[1] > m[1]) ? q : m)); return { type: it.type, kind: it.op.kind, nodes: document.querySelectorAll('.cvn').length, right, from: scr(...right), to: scr(right[0] + 20, right[1] + 10), label: document.querySelector('[data-cact="t-nodes"]').textContent };`);
  await mouse("mouseMoved", a.from[0], a.from[1], 0); await mouse("mousePressed", a.from[0], a.from[1], 1); await mouse("mouseMoved", (a.from[0] + a.to[0]) / 2, (a.from[1] + a.to[1]) / 2, 1); await mouse("mouseMoved", a.to[0], a.to[1], 1); await mouse("mouseReleased", a.to[0], a.to[1], 0);
  const b = await app.run(`${SCREEN} const it = P.carve.items[0], place = cvPlaceFn(it), pts = it.paths[0].pts.map(q => place(q)); return { pts: pts.map(q => q.map(v => Math.round(v * 10) / 10)), edge: scr(150, 80) };`);
  await mouse("mouseMoved", b.edge[0], b.edge[1], 0);
  await app.send("Input.dispatchMouseEvent", { type: "mousePressed", x: b.edge[0], y: b.edge[1], button: "left", buttons: 1, clickCount: 1 }); await app.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: b.edge[0], y: b.edge[1], button: "left", buttons: 0, clickCount: 1 });
  await app.send("Input.dispatchMouseEvent", { type: "mousePressed", x: b.edge[0], y: b.edge[1], button: "left", buttons: 1, clickCount: 2 }); await app.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: b.edge[0], y: b.edge[1], button: "left", buttons: 0, clickCount: 2 });
  await new Promise(r => setTimeout(r, 200));   // the double-click arrives just after the mouse comes up
  const c = await app.run(`return P.carve.items[0].paths[0].pts.length`);
  await app.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Delete", code: "Delete", windowsVirtualKeyCode: 46 });
  const d = await app.run(`return { n: P.carve.items.length, pts: P.carve.items[0].paths[0].pts.length }`);
  await app.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  const e = await app.run(`const out = { editing: cvNodeEdit !== null, handles: document.querySelectorAll('.cvh').length, job: cvJob(P.carve, cvBitOf, 'T').length }; closeCarve(); return out;`);
  assert.strictEqual(a.type, "path", "the rectangle became editable"); assert.strictEqual(a.kind, "pocket", "and kept its job"); assert.strictEqual(a.nodes, 4); assert.match(a.label, /Stop editing points/);
  assert.ok(b.pts.some(q => Math.abs(q[0] - (a.right[0] + 20)) < .6 && Math.abs(q[1] - (a.right[1] + 10)) < .6), "the point went where it was dragged: " + JSON.stringify(b.pts));
  assert.ok(b.pts.some(q => Math.abs(q[0] - 120) < .05 && Math.abs(q[1] - 80) < .05), "the other points stayed put: " + JSON.stringify(b.pts));
  assert.strictEqual(c, 5, "a double-click on a line adds a point "); assert.strictEqual(d.n, 1, "Delete takes a point, not the shape"); assert.strictEqual(d.pts, 4);
  assert.ok(!e.editing, "Esc stops"); assert.strictEqual(e.handles, 5, "and its handles come back"); assert.strictEqual(e.job, 1);
  assert.deepStrictEqual(app.errors, []);
});

test("a drawn shape's corners can be rounded", async () => {
  const v = await app.run(`${START} const t = cvMakePath([{ closed: true, pts: [[100, 100], [160, 100], [160, 140], [100, 140]] }], null);
    const a0 = Math.abs(cvArea(cvLocal(t).regions[0])), n0 = cvLocal(t).regions[0].length; t.corner = 5; const a1 = Math.abs(cvArea(cvLocal(t).regions[0])), n1 = cvLocal(t).regions[0].length;
    cvSel = t.id; carveRender(); const field = !!document.querySelector('[data-cf="t.corner"]'); closeCarve(); return { a0, a1, n0, n1, field };`);
  assert.ok(v.field); assert.strictEqual(v.n0, 4); assert.ok(v.n1 > 12, "curves at the corners");
  assert.ok(Math.abs(v.a0 - v.a1 - (4 - Math.PI) * 25) < 1, "each corner loses what a 5 mm round takes away: " + (v.a0 - v.a1));
});

test("DXF import: lines join into shapes, arcs, bulges and circles come through, in the file's units", async () => {
  const dxf = (pairs) => pairs.map(([c, v]) => `${c}\n${v}`).join("\n") + "\n";
  const line = (x0, y0, x1, y1) => [[0, "LINE"], [8, "0"], [10, x0], [20, y0], [11, x1], [21, y1]];
  const file = dxf([[0, "SECTION"], [2, "HEADER"], [9, "$INSUNITS"], [70, 1], [0, "ENDSEC"], [0, "SECTION"], [2, "ENTITIES"],
    ...line(0, 0, 2, 0), ...line(2, 2, 2, 0), ...line(2, 2, 0, 2), ...line(0, 0, 0, 2),   // a 2 inch square, its lines in any order and direction
    [0, "CIRCLE"], [8, "0"], [10, 1], [20, 1], [40, .25],
    [0, "LWPOLYLINE"], [8, "0"], [90, 2], [70, 0], [10, 3], [20, 0], [42, 1], [10, 4], [20, 0],   // a half circle, from a bulge of 1
    [0, "ARC"], [8, "0"], [10, 3], [20, 2], [40, .5], [50, 0], [51, 90],
    [0, "TEXT"], [8, "0"], [10, 0], [20, 0], [1, "hello"], [0, "ENDSEC"], [0, "EOF"]]);
  const v = await app.run(`${START} cv.board = { wood: 'bass', l: 300, w: 200, t: 6 };
    const parsed = cvParseDxf(${JSON.stringify(file)}), lines = parsed.lines.map(l => ({ closed: l.closed, n: l.pts.length, box: cvBox([l.pts]) }));
    const it = await cvImportFile(new File([${JSON.stringify(file)}], 'part.dxf')), s = cvLocal(it);
    const out = { skipped: parsed.skipped, lines: lines.map(l => [l.closed, Math.round((l.box.x1 - l.box.x0) * 100) / 100, Math.round((l.box.y1 - l.box.y0) * 100) / 100]), type: it.type, w: s.w, h: s.h, x: it.x, y: it.y, regions: s.regions.length };
    closeCarve(); return out;`);
  assert.deepStrictEqual(v.skipped, ["TEXT"]);
  assert.deepStrictEqual(v.lines, [[true, 12.7, 12.7], [true, 50.8, 50.8], [false, 25.4, 12.7], [false, 12.7, 12.7]], "circle, the joined square, bulge and arc, in mm");
  assert.strictEqual(v.type, "path"); assert.ok(Math.abs(v.w - 101.6) < .01 && Math.abs(v.h - 76.2) < .01, "real size, the half circle curving below: " + v.w + " x " + v.h);
  assert.ok(Math.abs(v.x - 150) < .01 && Math.abs(v.y - 100) < .01, "placed in the middle of the board"); assert.strictEqual(v.regions, 2, "the square and the circle are closed shapes");
  assert.deepStrictEqual(app.errors, []);
});

test("tracing a picture: its dark parts become shapes, with holes, and the split, side and detail can change", async () => {
  const v = await app.run(`${START}
    const c = new OffscreenCanvas(400, 300), x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 400, 300);
    x.fillStyle = '#111'; x.beginPath(); x.arc(200, 150, 120, 0, Math.PI * 2); x.fill(); x.fillStyle = '#bbb'; x.beginPath(); x.arc(200, 150, 50, 0, Math.PI * 2); x.fill();
    const blob = await c.convertToBlob({ type: 'image/png' }), it = await cvImportFile(new File([blob], 'disc.png', { type: 'image/png' }));
    const k = it.w / 400, s = cvLocal(it), sum = rs => Math.abs(rs.reduce((n, p) => n + cvArea(p), 0));
    const ring = { n: s.regions.length, area: sum(s.regions), want: Math.PI * (120 * 120 - 50 * 50) * k * k, w: s.w, want_w: 240 * k, thr: it.threshold };
    it.threshold = 200; const full = sum(cvLocal(it).regions), fullWant = Math.PI * 120 * 120 * k * k;
    it.threshold = 128; it.invert = true; const light = cvLocal(it).regions.length;
    it.invert = false; it.detail = .5; const fine = cvLocal(it).regions[0].length; it.detail = 2.5; const smooth = cvLocal(it).regions[0].length;
    it.op = cvOpFor(cv, 'pocket'); const job = cvJob(cv, cvBitOf, 'T').length, name = cvItemName(it);
    cvSel = it.id; carveRender(); const fields = ['t.thr', 't.invert', 't.detail'].every(k => document.querySelector('[data-cf="' + k + '"]'));
    closeCarve(); return { ring, full, fullWant, light, fine, smooth, job, name, fields };`);
  assert.ok(v.ring.thr > 17 && v.ring.thr < 187, "the split falls between the dark and the grey: " + v.ring.thr);
  assert.strictEqual(v.ring.n, 2, "the disc and its hole"); assert.ok(Math.abs(v.ring.area / v.ring.want - 1) < .03, "the ring's area: " + v.ring.area + " vs " + v.ring.want);
  assert.ok(Math.abs(v.ring.w / v.ring.want_w - 1) < .02, "its size in the picture");
  assert.ok(Math.abs(v.full / v.fullWant - 1) < .03, "a lighter split takes in the grey middle too");
  assert.ok(v.light >= 2, "the light parts traced instead"); assert.ok(v.fine > v.smooth, "more detail, more points: " + v.fine + " vs " + v.smooth);
  assert.strictEqual(v.job, 1); assert.strictEqual(v.name, "Traced picture"); assert.ok(v.fields);
  assert.deepStrictEqual(app.errors, []);
});

test("text bends round an arc, over the top or underneath, and stays the same length along it", async () => {
  const v = await app.run(`${START}
    const font = 'Hershey Sans 1-stroke'; await cvFontLoad(font);
    const it = cvAdd({ type: 'text', text: 'HELLO WORLD', font, size: 10, spacing: 0, leading: 1, align: 'center' });
    const ends = () => { const ls = cvLocal(it).lines, first = ls[0].pts, mid = ls[Math.floor(ls.length / 2)].pts, low = p => Math.min(...p.map(q => q[1])); return { first: low(first), mid: low(mid), w: cvLocal(it).w, h: cvLocal(it).h }; };
    const flat = ends(); cvSel = it.id; carveRender(); const el = document.querySelector('[data-cf="i.arc"]'); el.value = '60mm'; el.dispatchEvent(new Event('change', { bubbles: true }));
    const over = ends(), arc = it.arc; it.arc = -60; const under = ends(); it.arc = .5; const tiny = ends();
    closeCarve(); return { flat, over, under, tiny, arc };`);
  assert.ok(Math.abs(v.arc - 60) < 1e-9);
  assert.ok(Math.abs(v.flat.first - v.flat.mid) < .01, "straight: the letters sit level");
  assert.ok(v.over.first < v.over.mid - 3, "over the top: the ends come down: " + v.over.first + " vs " + v.over.mid);
  assert.ok(v.under.first > v.under.mid + 3, "underneath: the ends go up: " + v.under.first + " vs " + v.under.mid);
  assert.ok(Math.abs(v.over.w / v.flat.w - 1) < .2, "about as long, wrapped round the circle: " + v.over.w + " vs " + v.flat.w);
  assert.ok(Math.abs(v.tiny.w - v.flat.w) < .01, "a radius under 1 mm is taken as straight");
  assert.deepStrictEqual(app.errors, []);
});

test("trim: clicking a line cuts it back to where it crosses others, open or closed", async () => {
  await app.run(`${START}
    cvMakePath([{ closed: false, pts: [[100, 100], [200, 100]] }], null); cvMakePath([{ closed: false, pts: [[150, 50], [150, 150]] }], null);
    cvMakePath([{ closed: true, pts: [[60, 20], [90, 20], [90, 60], [60, 60]] }], null); cvMakePath([{ closed: false, pts: [[50, 40], [100, 40]] }], null);
    cvToolStart('trim');`);
  const p = await app.run(`${SCREEN} return { h: scr(120, 100), v: scr(150, 140), box: scr(75, 60), lone: scr(200, 180) };`);
  await click(p.h[0], p.h[1]); await click(p.v[0], p.v[1]); await click(p.box[0], p.box[1]);
  const v = await app.run(`${HELP} const w = it => cvWorldShape(it).lines.map(l => ({ closed: l.closed, pts: l.pts.map(q => q.map(n => Math.round(n * 100) / 100)) }));
    const [h, ve, sq] = P.carve.items; const out = { h: w(h), v: w(ve), sq: w(sq), tool: cvTool && cvTool.kind, head: document.getElementById('cvHead').textContent }; return out;`);
  await click(p.lone[0], p.lone[1]);
  const after = await app.run(`const n = P.carve.items.length; cvToolCancel(); closeCarve(); return n;`);
  const ends = l => [l.pts[0], l.pts[l.pts.length - 1]].map(q => q.join(",")).sort();
  assert.deepStrictEqual(v.h.map(ends), [["150,100", "200,100"]], "the left stretch of the level line is gone");
  assert.deepStrictEqual(v.v.map(ends), [["150,100", "150,50"]], "the top stretch of the upright line is gone");
  assert.strictEqual(v.sq.length, 1); assert.strictEqual(v.sq[0].closed, false, "the square is opened where it was trimmed");
  assert.deepStrictEqual(ends(v.sq[0]), ["60,40", "90,40"], "from crossing to crossing, the long way round");
  assert.ok(!v.sq[0].pts.some(q => q[1] === 60), "its top is gone");
  assert.strictEqual(v.tool, "trim", "stays on for the next line"); assert.match(v.head, /Trimming/);
  assert.strictEqual(after, 4, "clicking away from any line trims nothing");
  assert.deepStrictEqual(app.errors.filter(e => !/toast/i.test(e)), []);
});

test("dimensions: two clicks catch on corners, show the length, and are never cut", async () => {
  await app.run(`${START} const r = cvAddRect(); r.w = 80; r.h = 40; r.x = 150; r.y = 100; r.op = cvOpFor(cv, 'pocket'); cvPickOnly(null); carveRender(); cvToolStart('dim');`);
  const p = await app.run(`${SCREEN} return [scr(111, 79), scr(189.5, 80.5)];`);   // near the corners, not on them
  for (const q of p) await click(q[0], q[1]);
  const v = await app.run(`const d = P.carve.items.find(i => i.type === 'dim'), text = [...document.querySelectorAll('.cvitem text')].map(t => t.textContent);
    const out = { len: d && d.len, rot: d && d.rot, kind: d && d.op.kind, text, plan: cvPlan(P.carve, cvBitOf).flatMap(f => f.items.map(i => i.type)), name: cvItemName(d), bad: cvChecks(P.carve, cvBitOf, true).filter(c => c.bad).length };
    cvSel = d.id; carveRender(); out.panel = document.getElementById('cvSide').textContent; closeCarve(); return out;`);
  assert.ok(Math.abs(v.len - 80) < 1e-6, "caught on the corners exactly: " + v.len); assert.ok(Math.abs(v.rot) < 1e-6, "level");
  assert.strictEqual(v.kind, "off"); assert.ok(!v.plan.includes("dim"), "never cut"); assert.strictEqual(v.bad, 0);
  assert.ok(v.text.includes('3.15"'), "shows its length in the board's units: " + v.text); assert.strictEqual(v.name, "Dimension"); assert.match(v.panel, /only drawn, never cut/);
});

test("inlay: the plug, cut by the same bit, fits inside the pocket with the gap all round", async () => {
  const v = await app.run(`${START}
    const s = cvAddPolygon('star'); s.w = s.h = 60; s.x = 80; s.y = 100; s.op = cvOpFor(cv, 'pocket'); s.op.depth = 2; cvPickOnly(s.id); carveRender();
    const set = (k, val) => { const el = document.querySelector('[data-cf="' + k + '"]'); el.value = val; el.dispatchEvent(new Event('change', { bubbles: true })); };
    set('t.igap', '0.15mm'); document.querySelector('[data-cact="t-plug"]').click();
    const plug = P.carve.items[1], bit = cvBitOf(s.op.bit), R = bit.d / 2, star = cvUnion(cvWorldShape(s).regions), pocket = cvOffset(cvOffset(star, -R), R);
    const pbox = cvWorldBox(plug), sbox = cvWorldBox(s), shift = (pbox.x0 + pbox.x1) / 2 - (sbox.x0 + sbox.x1) / 2;
    const cut = cvOffset(cvOffset(cvUnion(cvWorldShape(plug).regions), R), -R).map(p => p.map(q => [q[0] - shift, q[1]]));   // the plug as the bit leaves it, put back over the pocket
    const outside = Math.abs(cvMinus(cut, pocket).reduce((n, p) => n + cvArea(p), 0)), tight = Math.abs(cvMinus(cut, cvOffset(pocket, -.149)).reduce((n, p) => n + cvArea(p), 0)), corners = cvMinus(cut, cvOffset(pocket, -.149)).length;
    const out = { corners, kind: plug.op.kind, through: plug.op.through, bit: plug.op.bit === s.op.bit, outside, tight, pk: s.op.kind, apart: pbox.x0 > sbox.x1, jobs: cvChecks(cv, cvBitOf, true).filter(c => c.bad).map(c => c.text) };
    closeCarve(); return out;`);
  assert.strictEqual(v.kind, "outside"); assert.ok(v.through); assert.ok(v.bit, "cut with the same bit"); assert.strictEqual(v.pk, "pocket"); assert.ok(v.apart, "added beside it");
  assert.ok(v.outside < .05, "the plug fits inside the pocket, give or take rounding far below a micron round its edge: " + v.outside); assert.ok(v.tight < 1 && v.corners <= 5, "the full gap all round, but for a little at each of the star's five inside corners, where the bit can't cut the plug sharp: " + v.tight + " in " + v.corners);
});

test("the shape checker warns of open lines a job can't use, outlines that cross themselves, and copies on top of each other", async () => {
  const v = await app.run(`${START}
    const open = cvMakePath([{ closed: false, pts: [[20, 20], [60, 20], [60, 60]] }], null); open.op = cvOpFor(cv, 'pocket');
    const bow = cvMakePath([{ closed: true, pts: [[100, 20], [140, 60], [140, 20], [100, 60]] }], null); bow.op = cvOpFor(cv, 'pocket');
    const r = cvAddRect(); r.w = r.h = 20; r.x = 220; r.y = 150; r.op = cvOpFor(cv, 'pocket'); cvPickOnly(r.id); cvCopy(); const copy = P.carve.items[P.carve.items.length - 1]; copy.x = r.x; copy.y = r.y;
    const msg = cvChecks(cv, cvBitOf, true).map(c => c.text), out = { open: msg.filter(t => /open line/.test(t)), bow: msg.filter(t => /crosses itself/.test(t)), dup: msg.filter(t => /on top of a copy/.test(t)), bad: cvChecks(cv, cvBitOf, true).filter(c => c.bad && /open|crosses|copy/.test(c.text)).length };
    closeCarve(); return out;`);
  assert.strictEqual(v.open.length, 1); assert.match(v.open[0], /has 1 open line, which this job leaves out/);
  assert.strictEqual(v.bow.length, 1); assert.strictEqual(v.dup.length, 2, "both copies are named");
  assert.strictEqual(v.bad, 0, "warnings, not stops");
});

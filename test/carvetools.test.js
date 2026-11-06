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

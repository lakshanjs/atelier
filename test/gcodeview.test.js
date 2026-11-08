"use strict";
const { test, before, after } = require("node:test");
const assert = require("node:assert");
const { openApp } = require("./harness");

let app;
before(async () => { app = await openApp(); });
after(async () => { if (app) await app.close(); });

const SETUP = `
  loadProject(TEMPLATES[0].make()); document.querySelectorAll('dialog[open]').forEach(d => d.close());
  cvBits.forEach(b => { b.have = true; });
  P.carve = CV_DEFAULT(); P.carve.board = { wood: 'bass', l: 200, w: 120, t: 6 }; P.carve.zero = [0, 0]; const cv = P.carve;
  const flat = cvBits.find(b => b.type === 'flat').id;
  const add = (f, op) => { const it = { id: cv.nextId++, x: 100, y: 60, rot: 0, ...f, op: { kind: 'pocket', bit: flat, depth: 2, through: false, tabs: 4, ...op } }; cv.items.push(it); return it; };`;

test("G-code this app writes reads back: its size, depth and bit, with nothing GRBL would refuse", async () => {
  const v = await app.run(`${SETUP}
    add({ type: 'circle', w: 60, h: 40 }); add({ type: 'rect', w: 30, h: 20, x: 160 }, { kind: 'pocket', depth: 1.5 });
    const job = cvJob(cv, cvBitOf, 'Test'), G = cvGcodeParse(job[0].text);
    return { problems: G.problems, box: G.box, total: G.total, moves: G.moves.length, bit: cvGcodeGuessBit(G), flat, arcs: /G[23] /.test(job[0].text) };`);
  assert.ok(v.arcs, "the file has arcs in it, so they're read too");
  assert.deepStrictEqual(v.problems, []);
  assert.ok(v.box.x0 > 69 && v.box.x1 < 176 && v.box.y0 > 39 && v.box.y1 < 81, "inside where the shapes are: " + JSON.stringify(v.box));
  assert.ok(v.box.x0 < 75 && v.box.x1 > 170, "and out to them");
  assert.ok(Math.abs(v.box.z0 + 2) < .01, "2 mm deep: " + v.box.z0);
  assert.ok(v.total > 0 && v.moves > 50); assert.strictEqual(v.bit, v.flat, "the bit named in its comments");
});

test("what GRBL would refuse is reported by line: M6, a bad arc, a rapid into the wood, no feed", async () => {
  const v = await app.run(`${SETUP}
    const G = cvGcodeParse(['G21 G90', 'M6 T2', 'G0 X0 Y0 Z5', 'G1 Z-1', 'G1 X10 F300', 'G2 X20 Y0 I3 J0', 'G0 X30 Z-2', 'G20', 'G1 X1 F10', 'G38.2 Z-5', 'G99'].join('\\n'));
    return { p: G.problems.map(p => p.line + ' ' + p.text), endX: G.moves[G.moves.length - 2].b[0] };`);
  const has = (line, re) => assert.ok(v.p.some(p => p.startsWith(line + " ") && re.test(p)), `line ${line} ${re}: ${v.p.join(" | ")}`);
  has(2, /M6/); has(4, /no feed/); has(6, /error 33/); has(7, /rapid move 2\.00 mm into the wood/); has(11, /G99/);
  assert.ok(Math.abs(v.endX - 25.4) < 1e-6, "inches turn into millimetres");
});

test("opening a .nc shows its cut in 3D, played back, with the bit and what's wrong; Close goes back", async () => {
  const v = await app.run(`${SETUP}
    add({ type: 'rect', w: 60, h: 40 }); const text = cvJob(cv, cvBitOf, 'Test')[0].text; cv.items = [];
    await openCarve(); cvLayoutSet('3d'); await new Promise(r => setTimeout(r, 200));
    await cvImportFiles([new File([text], 'job.nc'), new File(['G0 X0'], 'other.nc')]);
    const bar = document.getElementById('cvGcodeBar'), H = CV3D.play.map.H; let low = 0; for (const h of H) low = Math.min(low, h);
    const out = { on: !!CV3D.gcode, name: CV3D.gcode && CV3D.gcode.name, steps: CV3D.play.steps.length, low, shown: !bar.hidden, bit: document.getElementById('cvGcBit').value, ok: !!bar.querySelector('.gcok'), items: cv.items.length };
    cvPlaySeek(0); out.flat = CV3D.play.map.H.every(h => h === 0); cvPlaySeek(CV3D.play.total / 2); out.text = document.getElementById('cvPlayText').textContent;
    bar.querySelector('[data-gc="close"]').click(); out.closed = !CV3D.gcode && bar.hidden;
    closeCarve(); return out;`);
  assert.ok(v.on && v.name === "job.nc", "the first G-code file opens");
  assert.ok(v.steps > 20 && v.shown && v.ok, JSON.stringify(v));
  assert.ok(Math.abs(v.low + 2) < .3, "cut 2 mm deep: " + v.low);
  assert.strictEqual(v.items, 0, "nothing added to the carving");
  assert.ok(v.flat, "played from flat"); assert.match(v.text, /line \d+/);
  assert.ok(v.closed);
});

test("a .nc opened from a design makes a carving with a board that fits it", async () => {
  const v = await app.run(`${SETUP}
    add({ type: 'rect', w: 80, h: 50, x: 50, y: 40 }); const text = cvJob(cv, cvBitOf, 'Test')[0].text;
    loadProject(newDesign(TEMPLATES[0].make)); document.querySelectorAll('dialog[open]').forEach(d => d.close());
    await cvGcodeOpen(new File([text], 'Coaster.nc')); const b = P.carve.board, [zx, zy] = cvZeroAt(P.carve), G = CV3D.gcode.G;
    const out = { kind: P.kind, name: P.name, l: b.l, w: b.w, inside: G.box.x0 + zx >= 9.9 && G.box.y0 + zy >= 9.9 && G.box.x1 + zx <= b.l - 9 && G.box.y1 + zy <= b.w - 9, warn: !!document.querySelector('#cvGcodeBar .gcwarn') };
    closeCarve(); return out;`);
  assert.strictEqual(v.kind, "carve"); assert.strictEqual(v.name, "Coaster");
  assert.ok(v.inside, "the job sits on the board with a margin: " + JSON.stringify(v)); assert.ok(!v.warn, "and nothing to warn about");
});

test("Carve's 3D view: click to pick, drag to move, corners scale, the round handle turns, Delete removes", async () => {
  const v = await app.run(`${SETUP}
    const it = add({ type: 'rect', w: 40, h: 30 }), other = add({ type: 'rect', w: 10, h: 10, x: 30, y: 30 });
    await openCarve(); cvLayoutSet('3d'); await new Promise(r => setTimeout(r, 300)); cvPickOnly(null); carveRender();
    const el = CV3D.renderer.domElement, r = el.getBoundingClientRect(), scr = q => { const s = cv3dScreen(q); return [r.left + s[0], r.top + s[1]]; };
    const ev = (target, type, [x, y], o = {}) => target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: type === 'pointerup' ? 0 : 1, pointerId: 1, ...o }));
    const drag = (target, from, to) => { ev(target, 'pointerdown', from); for (let i = 1; i <= 5; i++) ev(window, 'pointermove', [from[0] + (to[0] - from[0]) * i / 5, from[1] + (to[1] - from[1]) * i / 5]); ev(window, 'pointerup', to); };
    const out = {};
    ev(el, 'pointerdown', scr([100, 60])); ev(window, 'pointerup', scr([100, 60])); out.picked = cvSel === it.id; out.handles = document.querySelectorAll('#cv3dOver .cv3h').length;
    drag(el, scr([100, 60]), scr([120, 70])); out.moved = [Math.round(it.x), Math.round(it.y)];
    const c = document.querySelector('#cv3dOver [data-h="c"]'), cb = c.getBoundingClientRect(), cc = [cb.left + cb.width / 2, cb.top + cb.height / 2], mid = scr([it.x, it.y]);
    const w0 = it.w; drag(c, cc, [mid[0] + (cc[0] - mid[0]) * 1.5, mid[1] + (cc[1] - mid[1]) * 1.5]); out.grew = it.w / w0;
    const h = document.querySelector('#cv3dOver [data-h="r"]'), hb = h.getBoundingClientRect(), hc = [hb.left + hb.width / 2, hb.top + hb.height / 2], m2 = scr([it.x, it.y]);
    drag(h, hc, [m2[0] + (hc[1] - m2[1]) * -1, m2[1] + (hc[0] - m2[0])]); out.rot = it.rot;
    ev(el, 'pointerdown', scr([30, 30]), { shiftKey: true }); ev(window, 'pointerup', scr([30, 30])); out.both = cvPicked().length;
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true })); out.left = cv.items.length;
    undo(); cvPickOnly(null); carveRender(); const away = scr([190, 110]); ev(el, 'pointerdown', away); ev(window, 'pointerup', away); out.none = cvSel === null;
    closeCarve(); return out;`);
  assert.ok(v.picked, "a click picks it"); assert.strictEqual(v.handles, 5, "four corners and the turning handle");
  assert.deepStrictEqual(v.moved, [120, 70], "dragged 20 right and 10 back");
  assert.ok(v.grew > 1.3 && v.grew < 1.7, "scaled by the corner: " + v.grew);
  assert.ok(Math.abs(v.rot - 90) < 45 || Math.abs(v.rot - 270) < 45, "turned about a quarter: " + v.rot);
  assert.strictEqual(v.both, 2, "Shift-click adds the other"); assert.strictEqual(v.left, 0, "Delete removes both");
  assert.ok(v.none, "a click on empty board lets go");
});

test("several files import at once, laid out across the board without overlapping, and all picked", async () => {
  const v = await app.run(`${SETUP}
    await openCarve(); const svg = (w, h) => new File(['<svg xmlns="http://www.w3.org/2000/svg" width="' + w + 'mm" height="' + h + 'mm" viewBox="0 0 ' + w + ' ' + h + '"><rect width="' + w + '" height="' + h + '"/></svg>'], 's.svg', { type: 'image/svg+xml' });
    await cvImportFiles([svg(300, 300), svg(50, 20), svg(80, 80)]);
    const boxes = cv.items.map(cvWorldBox), b = cv.board, overlap = boxes.some((p, i) => boxes.some((q, j) => j > i && p.x0 < q.x1 && q.x0 < p.x1 && p.y0 < q.y1 && q.y0 < p.y1));
    const out = { n: cv.items.length, picked: cvPicked().length, overlap, inside: boxes.every(q => q.x0 >= -.01 && q.y0 >= -.01 && q.x1 <= b.l + .01 && q.y1 <= b.w + .01) };
    closeCarve(); return out;`);
  assert.strictEqual(v.n, 3); assert.strictEqual(v.picked, 3);
  assert.ok(!v.overlap, "none on top of another"); assert.ok(v.inside, "all on the board");
});

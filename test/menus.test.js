"use strict";
const { test, before, after } = require("node:test");
const assert = require("node:assert");
const { openApp } = require("./harness");

let app;
before(async () => { app = await openApp(); });
after(async () => { if (app) await app.close(); });

const SETUP = `
  loadProject(TEMPLATES[0].make()); P.unit = 'mm'; document.querySelectorAll('dialog[open]').forEach(d => d.close());
  cvBits.forEach(b => { b.have = true; });
  P.carve = CV_DEFAULT(); P.carve.board = { wood: 'bass', l: 300, w: 200, t: 18 }; const cv = P.carve;
  const add = (f, op) => { const it = { id: cv.nextId++, x: 150, y: 100, rot: 0, ...f, op: { kind: 'pocket', bit: 'flat-2f', depth: 3, through: false, tabs: 4, ...op } }; cv.items.push(it); return it; };
  const area = it => Math.abs(cvIslands(cvWorldShape(it).regions).reduce((s, isl) => s + isl.reduce((t, p) => t + cvArea(p), 0), 0));
  await openCarve(); P.carve = cv; carveRender();`;

test("quick shapes: a triangle, a right-angled triangle and a half circle, each the area it should be", async () => {
  const v = await app.run(`${SETUP}
    const t = cvAddQuick('tri'), r = cvAddQuick('rtri'), h = cvAddQuick('half'), d = Math.min(300, 200) * .5;
    const out = { tri: area(t) / (d * d * Math.sqrt(3) / 4), rtri: area(r) / (d * d / 2), half: area(h) / (Math.PI * (d / 2) ** 2 / 2), types: [t.type, r.type, h.type], halfH: cvLocal(h).h, buttons: ['cvAddTri', 'cvAddRightTri', 'cvAddHalf'].every(id => cvEl(id) && cvEl(id).innerHTML.includes('<svg')) };
    closeCarve(); return out;`);
  assert.ok(Math.abs(v.tri - 1) < .01, "triangle " + v.tri); assert.ok(Math.abs(v.rtri - 1) < .01, "right triangle " + v.rtri); assert.ok(Math.abs(v.half - 1) < .01, "half circle " + v.half);
  assert.deepStrictEqual(v.types, ["polygon", "path", "path"]); assert.ok(Math.abs(v.halfH - 50) < .05, "the half circle is half as tall as it is wide"); assert.ok(v.buttons);
});

test("warped text keeps its letters, and grows, lifts or waves as chosen", async () => {
  const v = await app.run(`${SETUP}
    const font = cvLineFontNames()[0]; await cvFontLoad(font);
    const it = { id: cv.nextId++, type: 'text', text: 'WARPED', font, size: 20, spacing: 0, leading: 1, align: 'center', x: 150, y: 100, rot: 0, op: { kind: 'line', bit: 'v-30', depth: .3 } }; cv.items.push(it);
    const box = () => { const s = cvLocal(it); return [Math.round(s.w * 10) / 10, Math.round(s.h * 10) / 10, s.lines.length]; };
    const plain = box(); it.warp = 'bulge'; it.warpAmt = 50; const bulge = box(); it.warp = 'arch'; const arch = box(); it.warp = 'wave'; const wave = box(); it.warpAmt = 0; const none = box();
    it.warpAmt = 50; it.warp = 'bulge'; cvSel = it.id; carveRender(); const ui = [!!document.querySelector('select[data-cf="i.warp"]'), !!document.querySelector('[data-cf="i.warpAmt"]')];
    closeCarve(); return { plain, bulge, arch, wave, none, ui };`);
  assert.strictEqual(v.bulge[2], v.plain[2], "every stroke is still there");
  assert.ok(Math.abs(v.bulge[0] - v.plain[0]) < .2, "as wide as before");
  assert.ok(v.bulge[1] > v.plain[1] * 1.3, `the bulge is taller in the middle: ${v.bulge[1]} vs ${v.plain[1]}`);
  assert.ok(v.arch[1] > v.plain[1] * 1.3 && v.wave[1] > v.plain[1] * 1.2, "arch and wave lift it");
  assert.deepStrictEqual(v.none, v.plain, "no amount, no change"); assert.deepStrictEqual(v.ui, [true, true]);
});

test("freehand makes smooth open lines and closed shapes; the eraser rubs out, splits and opens them", async () => {
  const v = await app.run(`${SETUP}
    cvView = { x: 0, y: 0, k: .5 }; cvToolStart('free');
    const ring = []; for (let i = 0; i <= 80; i++) { const t = i / 80 * Math.PI * 2 * .98; ring.push([150 + 30 * Math.cos(t), 100 + 30 * Math.sin(t)]); }
    const closed = cvFreeFinish(ring), wig = []; for (let i = 0; i <= 60; i++) wig.push([50 + i, 40 + 5 * Math.sin(i / 6)]);
    const open = cvFreeFinish(wig);
    const shapes = { closed: [closed.paths[0].closed, closed.smooth, closed.paths[0].pts.length], open: [open.paths[0].closed, open.paths[0].pts.length], roundArea: area(closed) / (Math.PI * 900) };
    cvToolCancel(); cv.items = [];
    const line = cvMakePath([{ closed: false, pts: [[100, 150], [200, 150]] }], null), sq = cvMakePath([{ closed: true, pts: [[20, 20], [60, 20], [60, 60], [20, 60]] }], null), dot = cvMakePath([{ closed: false, pts: [[250, 30], [251, 30]] }], null);
    const a = cvEraseAt([150, 150], 2), b = cvEraseAt([40, 20], 2), c = cvEraseAt([250.5, 30], 3), miss = cvEraseAt([150, 10], 2);
    const ends = line.paths.map(l => { const p = l.pts.map(q => cvPlaceFn(line)(q)); return [Math.round(p[0][0]), Math.round(p[p.length - 1][0])]; }).sort((x, y) => x[0] - y[0]);
    const out = { shapes, a, b, c, miss, lines: line.paths.length, ends, sq: [sq.paths.length, sq.paths[0].closed], dotGone: !cv.items.includes(dot) };
    cvToolStart('erase'); carveRender(); out.eraserPanel = !!document.querySelector('[data-cf="t.er"]'); cvToolCancel(); closeCarve(); return out;`);
  assert.deepStrictEqual(v.shapes.closed.slice(0, 2), [true, true], "a stroke ending where it began is a smooth closed shape");
  assert.ok(v.shapes.closed[2] < 40, "with only the points it needs: " + v.shapes.closed[2]); assert.ok(Math.abs(v.shapes.roundArea - 1) < .05, "and the shape drawn: " + v.shapes.roundArea);
  assert.strictEqual(v.shapes.open[0], false); assert.ok(v.shapes.open[1] < 30);
  assert.deepStrictEqual([v.a, v.b, v.c, v.miss], [true, true, true, false]);
  assert.strictEqual(v.lines, 2, "rubbed across the middle, a line becomes two"); assert.deepStrictEqual(v.ends, [[100, 148], [152, 200]]);
  assert.deepStrictEqual(v.sq, [1, false], "a closed shape opens where it's rubbed"); assert.ok(v.dotGone, "a line rubbed out entirely goes");
  assert.ok(v.eraserPanel, "the eraser's width is in the panel");
});

test("Carve's right-click menu: copy and paste, order, break apart, fit and fill the board, pick by depth", async () => {
  const v = await app.run(`${SETUP}
    const sq = (x, y, s) => [[x - s, y - s], [x + s, y - s], [x + s, y + s], [x - s, y + s]];
    const two = cvMakePath([{ closed: true, pts: sq(100, 100, 10) }, { closed: true, pts: sq(160, 100, 10) }], { kind: 'pocket', bit: 'flat-2f', depth: 2 });
    const rect = add({ type: 'rect', w: 40, h: 30, x: 60, y: 60 }, { depth: 2 }), deep = add({ type: 'circle', w: 20, h: 20, x: 250, y: 150 }, { depth: 5 });
    cvPickOnly(rect.id); cvMenuOpen(100, 100); const rows = [...cvCtx.querySelectorAll('[data-cvx]')].map(b => b.dataset.cvx); closeCtx();
    cvMenuDo('copy'); cvMenuDo('paste'); const pasted = cv.items.length, copy = cv.items[cv.items.length - 1], moved = [copy.x - rect.x, copy.y - rect.y];
    cvPickOnly(rect.id); cvMenuDo('front'); const front = cv.items[cv.items.length - 1] === rect; cvMenuDo('back'); const back = cv.items[0] === rect;
    cvPickOnly(two.id); cvMenuDo('split'); const pieces = cv.items.filter(i => i.type === 'path' && i.op.depth === 2).length;
    cvPickOnly(rect.id); cvMenuDo('depth'); const same = cvPicked().length;
    cvPickOnly(deep.id); cvMenuDo('fitb'); const fb = cvWorldBox(deep);
    const one = add({ type: 'rect', w: 50, h: 40, x: 20, y: 20 }, { depth: 1 }); cvPickOnly(one.id); cvToolNums.gap = 5; const before = cv.items.length; cvMenuDo('fill'); const filled = cv.items.length - before + 1;
    const boxes = cv.items.slice(before - 1).map(cvWorldBox), inside = boxes.every(b => b.x0 >= 0 && b.y0 >= 0 && b.x1 <= 300 && b.y1 <= 200);
    cvPickOnly(null); cvMenuOpen(100, 100); const empty = [...cvCtx.querySelectorAll('[data-cvx]')].map(b => b.dataset.cvx); closeCtx();
    closeCarve(); return { rows, pasted, moved, front, back, pieces, same, fb, filled, inside, empty };`);
  ["cut", "copy", "dup", "del", "t-mx", "t-my", "front", "back", "t-out", "t-in", "split", "m-centre", "fitb", "fill", "depth", "t-nodes"].forEach(a => assert.ok(v.rows.includes(a), "the menu has " + a));
  assert.strictEqual(v.pasted, 4); assert.deepStrictEqual(v.moved, [10, -10], "a paste lands a little along");
  assert.ok(v.front && v.back, "brought to the front, then sent to the back");
  assert.strictEqual(v.pieces, 2, "the two squares are broken apart");
  assert.ok(v.same >= 4, "everything 2 deep is picked: " + v.same);
  const m = 200 * .05; assert.ok(Math.abs(v.fb.y0 - m) < .5 && Math.abs(v.fb.y1 - (200 - m)) < .5 && Math.abs((v.fb.x0 + v.fb.x1) / 2 - 150) < .5, "fitted to the board: " + JSON.stringify(v.fb));
  assert.strictEqual(v.filled, 5 * 4, "5 across and 4 back fit"); assert.ok(v.inside, "all on the board");
  assert.ok(v.empty.includes("all") && v.empty.includes("view:uncut"), "the board's own menu, with what's shown");
});

test("what's shown: uncut corners in red, less with a corners bit; outlines only; the board and wasteboard in 3D", async () => {
  const v = await app.run(`${SETUP}
    cvBits.push({ id: 'big', type: 'flat', name: 'Big', d: 6.35, angle: 0, tip: 0, feed: 800, plunge: 200, rpm: 1000, step: 2, over: 40, have: true });
    const it = add({ type: 'rect', w: 60, h: 40 }, { bit: 'big', depth: 2 }), sum = l => l.reduce((s, p) => s + Math.abs(cvArea(p)), 0), R = 3.175;
    const alone = sum(cvUncutOf(cv, it)); it.op.detail = 'flat-2f'; const helped = sum(cvUncutOf(cv, it)); it.op.detail = null;
    const cut = add({ type: 'rect', w: 30, h: 30, x: 60, y: 60 }, { kind: 'inside', bit: 'big', through: true }), hole = sum(cvUncutOf(cv, cut));
    const engrave = add({ type: 'rect', w: 30, h: 30, x: 240, y: 150 }, { kind: 'line', bit: 'v-30', depth: .3 }), none = cvUncutOf(cv, engrave).length;
    cvViewOpts.uncut = true; cvCutsRender(); const red = !!document.getElementById('cvUncut');
    cvViewOpts.wire = true; cvStageRender(); const wire = [...document.querySelectorAll('.cvitem path')].every(p => p.getAttribute('fill') === 'none'); cvViewOpts.wire = false;
    cvViewOpts.waste = true; cvViewOpts.material = true; cv3dShow(true); cv3dBake(); const waste = !!(CV3D.extras && CV3D.extras.children.some(o => o.isMesh));
    cvViewToggle('material'); const hidden = CV3D.mesh.visible === false && CV3D.extras.children.some(o => o.isLineSegments); cvViewToggle('material');
    cv3dShow(false); cvViewBtnRows = cvViewRows(); closeCarve();
    return { alone, helped, hole, none, red, wire, waste, hidden, corners: 4 * R * R * (1 - Math.PI / 4), rows: (cvViewBtnRows.match(/data-cvx/g) || []).length };`);
  assert.ok(Math.abs(v.alone - v.corners) / v.corners < .15, `the four corners a 1/4" bit leaves: ${v.alone} vs ${v.corners}`);
  assert.ok(v.helped < v.alone / 2, "a narrower corners bit leaves much less: " + v.helped);
  assert.ok(Math.abs(v.hole - v.corners) / v.corners < .15, "a hole's corners too: " + v.hole);
  assert.strictEqual(v.none, 0, "an engraving leaves nothing"); assert.ok(v.red, "shown on the board");
  assert.ok(v.wire, "outlines only"); assert.ok(v.waste, "a wasteboard under the board"); assert.ok(v.hidden, "with the board hidden, the bit's paths show");
  assert.strictEqual(v.rows, 5);
});

test("Design's right-click menu mirrors and lines up, and offers cut and paste", async () => {
  const v = await app.run(`
    loadProject(TEMPLATES[0].make()); document.querySelectorAll('dialog[open]').forEach(d => d.close()); P.items = P.items.filter(i => isRoomPart(i));
    const a = panelBox('A', [0, 300, 0, 18, 0, 200]), b = panelBox('B', [500, 900, 0, 18, 0, 200]); a.id = nextId(); b.id = nextId(); P.items.push(a, b);
    setQ(b, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 6)); persist();
    const mid = it => { const q = bounds(it); return [0, 1, 2].map(k => Math.round((q.min[k] + q.max[k]) / 2)); };
    const before = [mid(a), mid(b)]; sel = [a.id, b.id]; openCtx(100, 100); const rows = [...ctxEl.querySelectorAll('[data-cx]')].map(x => x.dataset.cx); closeCtx();
    edit(() => mirrorSel(0)); const after = [mid(a), mid(b)], turn = new THREE.Euler().setFromQuaternion(Q(b), 'YXZ').y * 180 / Math.PI;
    edit(() => { alignSel(0, 'mid'); alignSel(2, 'mid'); }); const lined = mid(a)[0] === mid(b)[0] && mid(a)[2] === mid(b)[2];
    return { before, after, turn, rows, lined };`);
  ["cut", "copy", "dup", "mirx", "mirz", "mid", "del"].forEach(a => assert.ok(v.rows.includes(a), "the menu has " + a));
  assert.ok(Math.abs((v.after[0][0] + v.before[0][0]) - (v.after[1][0] + v.before[1][0])) <= 1 && v.after[0][0] > v.after[1][0], "they swap sides, across one line: " + JSON.stringify(v));
  assert.deepStrictEqual([v.after[0][1], v.after[0][2]], [v.before[0][1], v.before[0][2]], "and stay put the other ways");
  assert.ok(Math.abs(v.turn + 30) < .5, "the turned one turns the other way: " + v.turn);
  assert.ok(v.lined, "lined up by their middles");
});

test("easy to start: a short rail, the board and 3D side by side, the essentials first, and a depth gauge", async () => {
  const v = await app.run(`${SETUP}
    const rail = [...document.querySelectorAll('#cvRail > .tool:not([hidden])')].map(b => b.getAttribute('aria-label') || b.title), icons = [...document.querySelectorAll('#cvRail > .tool:not([hidden])')].every(b => b.querySelector('.lu') && !b.textContent.trim());
    cvFlyOpen(cvEl('cvGrpShapes')); const shapes = [...document.querySelectorAll('#cvFly .flyGroup:not([hidden]) .flyItem span')].map(s => s.textContent), flyShown = !cvEl('cvFly').hidden;
    cvEl('cvAddTri').click(); const added = cvItem() && cvItem().type, flyGone = cvEl('cvFly').hidden;
    cvFlyOpen(cvEl('cvGrpDraw')); cvEl('cvFree').click(); carveRender(); const drawOn = cvEl('cvGrpDraw').classList.contains('on'); cvToolCancel();
    cvLayoutSet('split'); const split = [CV3D.on, cvEl('carve').classList.contains('lay-split'), cvEl('cvStage').clientWidth < cvEl('cvStageWrap').clientWidth * .7];
    cvLayoutSet('board'); const board = [CV3D.on, cvEl('cvStage').clientWidth > cvEl('cvStageWrap').clientWidth * .9];
    let kept = ''; try { kept = localStorage.getItem('atelier-carve-layout'); } catch (e) {}
    cvLayoutSet('split');
    const it = add({ type: 'rect', w: 40, h: 30 }, { depth: 3 }); cvPickOnly(it.id); carveRender();
    const inMore = sel => !!document.querySelector('details.cvmore:not([open]) ' + sel), seen = sel => !!document.querySelector(sel) && !document.querySelector('details.cvmore ' + sel);
    const panel = { climb: inMore('[data-cf="op.climb"]'), fill: inMore('[data-cf="op.fill"]'), detail: inMore('[data-cf="op.detail"]'), depth: seen('[data-cf="op.depth"]'), bits: document.querySelectorAll('.pickBit').length, change: !!document.querySelector('[data-cact="pickopen"]') };
    document.querySelector('[data-cact="pickopen"]').click(); panel.listed = document.querySelectorAll('#cvSide [role=radiogroup] > .pickBit').length;
    const r = document.querySelector('[data-cf="op.depthR"]'); r.value = '7'; r.dispatchEvent(new Event('input', { bubbles: true })); const live = [document.querySelector('.gauge svg').getAttribute('aria-label'), it.op.depth];
    r.dispatchEvent(new Event('change', { bubbles: true })); const set = it.op.depth;
    cvPickOnly(null); carveRender(); const boardMore = inMore('[data-cf="b.feedPct"]'), smartShut = !document.querySelector('details[data-csec="smart"]').open;
    closeCarve(); return { rail, icons, shapes, flyShown, added, flyGone, drawOn, split, board, kept, panel, live, set, boardMore, smartShut };`);
  assert.strictEqual(v.rail.length, 9, "nine buttons: " + v.rail); assert.ok(v.rail.includes("My machine"), "My machine sits by Your bits"); assert.ok(v.icons, "icons with tooltips, no text");
  assert.deepStrictEqual(v.shapes, ["Rectangle", "Ellipse", "Triangle", "Right-angled triangle", "Half circle", "Polygon", "Star"]);
  assert.ok(v.flyShown && v.flyGone, "the list opens, and closes once one is picked"); assert.strictEqual(v.added, "polygon"); assert.ok(v.drawOn, "Draw shows it's in use");
  assert.deepStrictEqual(v.split, [true, true, true], "side by side"); assert.deepStrictEqual(v.board, [false, true], "the board alone"); assert.strictEqual(v.kept, "board", "the choice is remembered");
  assert.ok(v.panel.listed > 1, "Change shows every bit that suits the job"); assert.deepStrictEqual(v.panel, { climb: true, fill: true, detail: true, depth: true, bits: 1, change: true, listed: v.panel.listed }, "the essentials show, the rest is under More settings");
  assert.ok(/7 mm deep/.test(v.live[0]) && v.live[1] === 3, "the gauge follows the slider before it's let go: " + v.live); assert.strictEqual(v.set, 7);
  assert.ok(v.boardMore && v.smartShut, "the board's speeds and smart values are folded away");
});

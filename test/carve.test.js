"use strict";
const { test, before, after } = require("node:test");
const assert = require("node:assert");
const { openApp } = require("./harness");

const TEST_BITS = `[{ id: 'flat-1-16', type: 'flat', name: '1/16" flat end mill', d: 1.5875, angle: 0, tip: 0, feed: 500, plunge: 150, rpm: 1000, step: .5, over: 40, have: false }, { id: 'flat-1-8', type: 'flat', name: '1/8" flat end mill', d: 3.175, angle: 0, tip: 0, feed: 800, plunge: 200, rpm: 1000, step: 1, over: 40, have: false }, { id: 'flat-1-4', type: 'flat', name: '1/4" flat end mill', d: 6.35, angle: 0, tip: 0, feed: 1000, plunge: 250, rpm: 1000, step: 2, over: 40, have: false }, { id: 'v-30', type: 'v', name: '30° V-bit', d: 3.175, angle: 30, tip: .1, feed: 600, plunge: 150, rpm: 1000, step: 1, over: 30, have: false }, { id: 'v-60', type: 'v', name: '60° V-bit', d: 6.35, angle: 60, tip: .1, feed: 700, plunge: 150, rpm: 1000, step: 1.5, over: 30, have: false }, { id: 'v-90', type: 'v', name: '90° V-bit', d: 12.7, angle: 90, tip: .1, feed: 800, plunge: 150, rpm: 1000, step: 1.5, over: 30, have: false }]`;
let app;
before(async () => { app = await openApp(); });
after(async () => { if (app) await app.close(); });

// An independent reader: accepts only what GRBL 1.1 accepts, and tracks where the bit goes.
function readGcode(text) {
  const st = { x: null, y: null, z: null, f: null, mode: null, spindle: false }, cuts = [], rapids = [], problems = [];
  const OK_G = new Set(["G0", "G1", "G4", "G17", "G21", "G90", "G94"]), OK_M = new Set(["M3", "M5", "M30"]);
  text.split(/\r?\n/).forEach((raw, n) => {
    const line = raw.replace(/\([^)]*\)/g, "").trim();
    if (/[()]/.test(line)) problems.push(`line ${n}: broken comment`);
    if (raw.length > 70) problems.push(`line ${n}: long line`);
    if (/[^\x20-\x7e]/.test(raw)) problems.push(`line ${n}: not plain text`);
    if (!line) return;
    const words = line.match(/[A-Z][-+]?[\d.]+/g) || [];
    if (words.join(" ") !== line) problems.push(`line ${n}: unreadable: ${line}`);
    let motion = null; const to = {};
    for (const w of words) {
      const c = w[0], v = parseFloat(w.slice(1));
      if (c === "G") { if (!OK_G.has(w)) problems.push(`line ${n}: ${w}`); if (w === "G0" || w === "G1") motion = w; if (w === "G4") return; }
      else if (c === "M") { if (!OK_M.has(w)) problems.push(`line ${n}: ${w}`); if (w === "M3") st.spindle = true; if (w === "M5") st.spindle = false; }
      else if (c === "F") st.f = v; else if (c === "S") { /* speed */ } else if ("XYZ".includes(c)) to[c.toLowerCase()] = v; else problems.push(`line ${n}: word ${w}`);
    }
    if (motion) st.mode = motion;
    if (!("x" in to || "y" in to || "z" in to)) return;
    const from = { x: st.x, y: st.y, z: st.z }, next = { x: to.x ?? st.x, y: to.y ?? st.y, z: to.z ?? st.z };
    if (st.mode === "G1") { if (!st.f) problems.push(`line ${n}: cut with no feed`); if (!st.spindle) problems.push(`line ${n}: cut with spindle off`); cuts.push({ from, to: next, f: st.f }); }
    else { rapids.push({ from, to: next }); if (next.z !== null && next.z < 0) problems.push(`line ${n}: rapid into the wood`); if (("x" in to || "y" in to) && st.z !== null && st.z <= 0) problems.push(`line ${n}: rapid sideways while in the wood`); }
    Object.assign(st, next);
  });
  return { cuts, rapids, problems, end: st };
}
const SETUP = `
  loadProject(TEMPLATES[0].make()); document.querySelectorAll('dialog[open]').forEach(d => d.close());
  cvBits = ${TEST_BITS}; cvBits.forEach(b => { b.have = true; });
  const bit = id => cvBits.find(b => b.id === id);
  P.carve = CV_DEFAULT(); P.carve.board = { l: 300, w: 200, t: 18 }; P.carve.tabH = 2; const cv = P.carve;
  const add = (f, op) => { const it = { id: cv.nextId++, x: 150, y: 100, rot: 0, ...f, op: { kind: 'pocket', bit: 'flat-1-8', depth: 3, through: false, tabs: 4, ...op } }; cv.items.push(it); return it; };`;

test("a rectangular pocket reaches its walls, stays inside them, and gets to depth", async () => {
  const v = await app.run(`${SETUP} add({ type: 'rect', w: 60, h: 40 }, { kind: 'pocket', depth: 3 }); return cvJob(cv, cvBitOf, 'Test');`);
  assert.strictEqual(v.length, 1);
  const g = readGcode(v[0].text); assert.deepStrictEqual(g.problems, []);
  const R = 3.175 / 2, at = g.cuts.flatMap(c => [c.to]);
  const xs = at.map(p => p.x), ys = at.map(p => p.y), zs = at.map(p => p.z);
  assert.ok(Math.abs(Math.min(...xs) - (120 + R)) < .02, "left wall"); assert.ok(Math.abs(Math.max(...xs) - (180 - R)) < .02, "right wall");
  assert.ok(Math.abs(Math.min(...ys) - (80 + R)) < .02, "front wall"); assert.ok(Math.abs(Math.max(...ys) - (120 - R)) < .02, "back wall");
  assert.strictEqual(Math.min(...zs), -3);
  assert.deepStrictEqual([...new Set(g.cuts.filter(c => c.from.z === c.to.z).map(c => c.to.z))].sort((a, b) => b - a), [-1, -2, -3], "level passes");
  // every bit of the floor gets cut: walk a fine grid over the pocket at full depth
  const floor = g.cuts.filter(c => c.to.z === -3 && c.from.z === -3), miss = [];
  for (let x = 121; x < 180; x += 1.5) for (let y = 81; y < 120; y += 1.5) {
    const hit = floor.some(c => { const dx = c.to.x - c.from.x, dy = c.to.y - c.from.y, t = Math.max(0, Math.min(1, ((x - c.from.x) * dx + (y - c.from.y) * dy) / (dx * dx + dy * dy || 1))); return Math.hypot(x - c.from.x - dx * t, y - c.from.y - dy * t) <= R + .01; });
    if (!hit) miss.push([x, y]);
  }
  assert.deepStrictEqual(miss, []);
});

test("a cut-out goes around the outside, through the board, with tabs left standing", async () => {
  const v = await app.run(`${SETUP} add({ type: 'rect', w: 100, h: 60 }, { kind: 'outside', through: true, tabs: 4, bit: 'flat-1-4' }); return { job: cvJob(cv, cvBitOf, 'Test'), checks: cvChecks(cv, cvBitOf, true) };`);
  const g = readGcode(v.job[0].text); assert.deepStrictEqual(g.problems, []);
  assert.deepStrictEqual(v.checks.filter(c => c.bad), []);
  const zs = g.cuts.map(c => c.to.z), R = 6.35 / 2;
  assert.ok(Math.abs(Math.min(...zs) - -18.3) < .001, "just through the board, no further");
  const deep = g.cuts.filter(c => c.to.z === -18.3 && c.from.z === -18.3), tabTop = -16;
  assert.ok(g.cuts.some(c => c.to.z === tabTop && c.from.z === tabTop), "passes over the tabs at tab height");
  const xs = g.cuts.map(c => c.to.x); assert.ok(Math.abs(Math.min(...xs) - (100 - R)) < .02); assert.ok(Math.abs(Math.max(...xs) - (200 + R)) < .02);
  // the last pass lifts exactly four times
  let lifts = 0; for (let i = g.cuts.length - 1; i >= 0 && g.cuts[i].to.z >= -18.3; i--) { const c = g.cuts[i]; if (c.from.z === -18.3 && c.to.z === tabTop && c.from.x === c.to.x) lifts++; if (c.from.z > -16.4 && c.from.z < tabTop) break; }
  assert.strictEqual(lifts, 4);
  assert.ok(deep.length > 0);
});

test("V-carving runs along the middle of each stroke, follows the bit's angle, and flattens out at the deepest cut", async () => {
  const v = await app.run(`${SETUP} add({ type: 'rect', w: 40, h: 8 }, { kind: 'vcarve', bit: 'v-90', depth: 2 }); add({ type: 'rect', w: 40, h: 3, y: 150 }, { kind: 'vcarve', bit: 'v-90', depth: 2 }); return cvJob(cv, cvBitOf, 'Test');`);
  assert.strictEqual(v.length, 1, "no clearing bit chosen, so one file");
  const g = readGcode(v[0].text); assert.deepStrictEqual(g.problems, []);
  const at = g.cuts.map(c => c.to).filter(p => p.z < 0), wide = at.filter(p => p.y < 120), thin = at.filter(p => p.y > 120);
  assert.ok(Math.abs(Math.min(...at.map(p => p.z)) - -2) < 1e-9, "down to the deepest cut, and no further");
  // at 90 degrees, depth is the distance in from the nearest wall, less the tip: never more
  const over = (p, x0, x1, y0, y1) => -p.z > Math.min(p.x - x0, x1 - p.x, p.y - y0, y1 - p.y) - .05 + .002;
  assert.deepStrictEqual(wide.filter(p => over(p, 130, 170, 96, 104)).slice(0, 3), [], "the V never cuts past the outline");
  assert.deepStrictEqual(thin.filter(p => over(p, 130, 170, 148.5, 151.5)).slice(0, 3), [], "nor on the thin one");
  // the thin stroke is one line down its middle at the depth its width needs, rising into each corner
  const mid = thin.filter(p => p.x > 135 && p.x < 165);
  assert.ok(mid.length > 0 && mid.every(p => Math.abs(p.y - 150) < .01 && Math.abs(p.z - -1.45) < .01), "down the middle, 1.45 deep");
  assert.ok(thin.some(p => p.z > -.2 && Math.hypot(p.x - 130, p.y - 148.5) < .3), "up to nothing in a corner");
});

test("drilling goes straight down at the middle of each shape, pecking out the chips, nearest hole next", async () => {
  const v = await app.run(`${SETUP} cv.board.t = 1.6;
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="30mm" height="10mm" viewBox="0 0 30 10"><circle cx="5" cy="5" r=".5"/><circle cx="25" cy="5" r=".5"/><circle cx="15" cy="5" r=".5"/></svg>';
    await cvAddSvgText(svg); const it = cv.items[cv.items.length - 1]; it.op = { kind: 'drill', bit: 'flat-1-16', through: true, peck: true };
    const peck = cvJob(cv, cvBitOf, 'T')[0].text, notes = cvChecks(cv, cvBitOf, true).filter(c => c.id === it.id).map(c => c.text);
    it.op.peck = false; const one = cvJob(cv, cvBitOf, 'T')[0].text; it.op.bit = 'v-30'; it.op.through = false; it.op.depth = .6; const spot = cvJob(cv, cvBitOf, 'T')[0].text;
    return { peck, one, spot, notes, x: it.x, step: cvBitOf('flat-1-16').step };`);
  const holes = t => { const g = readGcode(t); assert.deepStrictEqual(g.problems, []); assert.ok(g.cuts.every(c => c.from.x === c.to.x && c.from.y === c.to.y), "only straight up and down"); return g; };
  const p = holes(v.peck), xs = [...new Set(p.cuts.map(c => Math.round(c.to.x * 1000) / 1000))];
  assert.deepStrictEqual(xs, [v.x - 10, v.x, v.x + 10], "three holes, left to right, nearest next");
  const at = x => p.cuts.filter(c => Math.abs(c.to.x - x) < 1e-6).map(c => c.to.z); assert.deepStrictEqual(at(v.x - 10), [-.5, -1, -1.5, -1.9], "pecks by the bit's depth per pass, through the board");
  assert.ok(/G0 Z1\r\n/.test(v.peck), "comes up clear of the board between pecks");
  assert.strictEqual(holes(v.one).cuts.length, 3, "one plunge per hole without pecking");
  assert.ok(holes(v.spot).cuts.every(c => Math.abs(c.to.z - -.6) < 1e-9), "spot dimples with a V-bit");
  assert.ok(v.notes.some(t => /holes drawn smaller than the bit/.test(t)), "a 1 mm hole with a 1.6 mm bit is said: " + v.notes);
});

test("tiles: a board too big for the machine is cut in parts, each zeroed on a cross the one before engraves", async () => {
  const v = await app.run(`${SETUP} cv.board = { l: 280, w: 300, t: 6 }; cv.workX = 300; cv.workY = 180; cv.ramp = 0;
    add({ type: 'rect', w: 240, h: 260, x: 140, y: 150 }, { kind: 'outside', depth: 1, through: false, tabs: 0, bit: 'flat-1-8' });
    add({ type: 'circle', w: 10, h: 10, x: 140, y: 150 }, { kind: 'drill', depth: 1, bit: 'flat-1-8', peck: false });
    const before = cvChecks(cv, cvBitOf, true).map(c => c.text), whole = cvCarveMap(cv, cvBitOf, 1);
    cv.tile = true; const tiles = cvTiles(cv), job = cvJob(cv, cvBitOf, 'T').map(f => ({ name: f.name, text: f.text, tile: f.tile })), after = cvChecks(cv, cvBitOf, true).map(c => c.text);
    await openCarve(); P.carve = cv; cvSel = null; carveRender(); const shown = document.querySelectorAll('#cvTileMarks path').length; closeCarve();
    return { before, tiles: tiles.map(t => [t.x0, t.y0, t.x1, t.y1, t.markedBy]), job, after, shown };`);
  assert.ok(v.before.some(t => /further from the zero point.*Tiles in Machine/.test(t)), "too big without tiles");
  assert.deepStrictEqual(v.tiles, [[0, 0, 280, 150, null], [0, 150, 280, 300, 0]], "two tiles front to back, the second zeroed on a cross from the first");
  assert.deepStrictEqual(v.job.map(f => f.name), ["Tile 1 of 2 - 1 of 1 - 1-8 in flat end mill.nc", "Tile 2 of 2 - 1 of 1 - 1-8 in flat end mill.nc"]);
  assert.ok(!v.after.some(t => /travel/.test(t)), "fits once tiled");
  const g = v.job.map(f => readGcode(f.text)); g.forEach(x => assert.deepStrictEqual(x.problems, []));
  const R = 3.175 / 2;
  g.forEach(x => x.cuts.forEach(c => { assert.ok(c.to.y >= -1e-6 - 2 && c.to.y <= 150 + 2 + 1e-6, "in reach of its own zero, give or take a cross's arm: " + c.to.y); }));
  // the cross for tile 2 is engraved by tile 1 at its corner, and is where tile 2's zero is
  const cross = g[0].cuts.filter(c => c.to.z === -.2 && c.from.z === -.2); assert.strictEqual(cross.length, 2);
  assert.ok(cross.some(c => c.from.x === -2 && c.to.x === 2 && c.to.y === 150) && cross.some(c => c.from.y === 148 && c.to.y === 152 && c.to.x === 0));
  assert.match(v.job[1].text, /\(X0 Y0 = the cross at\)\r\n\(0, 150 mm on the board. Z0 = top.\)/);
  // put back on the board, the two tiles cut the outline once, with no gap where they meet
  const left = (x, y0, y1) => [...g[0].cuts.map(c => ({ ...c, oy: 0 })), ...g[1].cuts.map(c => ({ ...c, oy: 150 }))].some(c => Math.abs(c.to.x - x) < .02 && c.from.z === -1 && c.to.z === -1 && Math.min(c.from.y, c.to.y) + c.oy <= y0 && Math.max(c.from.y, c.to.y) + c.oy >= y1);
  assert.ok(left(20 - R, 21, 149) && left(20 - R, 151, 279), "the left side, in both tiles");
  assert.ok([...g[0].cuts, ...g[1].cuts].filter(c => c.to.z === -1 && c.from.z !== -1 && c.from.x === c.to.x).length >= 1, "the hole is drilled once");
  const drills = [...g[0].cuts.map(c => [c, 0]), ...g[1].cuts.map(c => [c, 150])].filter(([c]) => c.from.x === c.to.x && c.from.y === c.to.y && c.to.z === -1 && Math.abs(c.to.x - 140) < .01);
  assert.strictEqual(drills.length, 1, "on the line between tiles, the hole belongs to one of them");
  assert.strictEqual(v.shown, 1, "the cross shows on the board");
});

test("the cut plays back in 3D: part way shows part cut with the bit where it is, the end matches the finished board", async () => {
  const v = await app.run(`${SETUP} cv.board.t = 18; await openCarve(); P.carve = cv; cvSel = null;
    add({ type: 'rect', w: 60, h: 40, x: 80 }, { kind: 'pocket', depth: 3 }); add({ type: 'circle', w: 30, h: 30, x: 200 }, { kind: 'vcarve', bit: 'v-90', depth: 2 });
    carveRender(); cv3dShow(true); await new Promise(r => setTimeout(r, 300)); cv3dBake();
    const P3 = CV3D.play, cut = () => P3.map.H.reduce((n, h) => n + (h < -.01 ? 1 : 0), 0), full = cut(), whole = cvCarveMap(cv, cvBitOf);
    let same = whole.H.length === P3.map.H.length; for (let i = 0; same && i < whole.H.length; i++) if (Math.abs(whole.H[i] - P3.map.H[i]) > 1e-6) same = false;
    const bar = !document.getElementById('cvPlay').hidden, parts = P3.parts.map(p => p.bit.id);
    cvPlaySeek(P3.total / 3); const third = cut(), tool = !!CV3D.tool, toolAt = CV3D.tool && CV3D.tool.position.z, text = document.getElementById('cvPlayText').textContent;
    cvPlaySeek(0); const none = cut(), noTool = !CV3D.tool;
    cvPlayNextPart(); const atPart = P3.t, partStart = P3.parts[1].t;
    document.getElementById('cvPlayBtn').click(); await new Promise(r => setTimeout(r, 400)); const moved = P3.t > atPart, label = document.getElementById('cvPlayBtn').title;
    document.getElementById('cvPlayBtn').click(); const stopped = !cvPlayFrame;
    cvPlaySeek(P3.total); const again = cut();
    cv3dShow(false); closeCarve(); return { full, same, bar, parts, third, tool, toolAt, text, none, noTool, atPart, partStart, moved, label, stopped, again };`);
  assert.ok(v.bar, "the play bar shows"); assert.ok(v.same, "the finished playback is the board as carved");
  assert.deepStrictEqual(v.parts, ["flat-1-8", "v-90"], "a toolpath per bit and item, in cutting order");
  assert.ok(v.third > 0 && v.third < v.full, "a third of the way, part is cut: " + v.third + " of " + v.full);
  assert.ok(v.tool && v.toolAt <= 0, "the bit is drawn at the cut"); assert.match(v.text, /of \d+ min {2}· {2}File 1, 1\/8" flat end mill: pocket Rectangle/);
  assert.strictEqual(v.none, 0, "at the start, nothing is cut"); assert.ok(v.noTool);
  assert.strictEqual(v.atPart, v.partStart, "next jumps to the next toolpath");
  assert.ok(v.moved, "playing moves on"); assert.strictEqual(v.label, "Pause (Space)"); assert.ok(v.stopped);
  assert.strictEqual(v.again, v.full);
  assert.deepStrictEqual(app.errors, []);
});

test("single-line fonts are engraved once along each stroke, are offered first, and switch the job to engraving", async () => {
  const v = await app.run(`${SETUP} await openCarve(); P.carve = cv; cvSel = null;
    const names = cvLineFontNames(), font = 'Hershey Sans 1-stroke'; await cvFontLoad(font);
    const it = add({ type: 'text', text: 'HI', font, size: 10, spacing: 0, leading: 1, align: 'center' }, { kind: 'line', bit: 'v-30', depth: .3 });
    const s = cvLocal(it), job = cvJob(cv, cvBitOf, 'T')[0].text;
    it.op = { kind: 'pocket', bit: 'flat-1-8', depth: 1 }; const refused = cvChecks(cv, cvBitOf, true).filter(c => c.bad).map(c => c.text);
    cvSel = it.id; carveRender(); await new Promise(r => setTimeout(r, 300));
    const sel = document.getElementById('cvFont'), group = sel.querySelector('optgroup') && sel.querySelector('optgroup').label, first = sel.options[0].value;
    sel.value = 'EMS Readability'; sel.dispatchEvent(new Event('change', { bubbles: true })); await new Promise(r => setTimeout(r, 300));
    const after = { font: it.font, kind: it.op.kind, bit: cvBitOf(it.op.bit).type, drawn: !!document.querySelector('.cvitem path').getAttribute('d') };
    closeCarve(); return { names, regions: s.regions.length, lines: s.lines.length, h: s.h, w: s.w, job, refused, group, first, after };`);
  assert.strictEqual(v.names.length, 11); assert.ok(v.names.includes("Hershey Sans 1-stroke") && v.names.includes("EMS Readability"));
  assert.strictEqual(v.regions, 0, "no outlines, only strokes"); assert.strictEqual(v.lines, 4, "H has three strokes and I one");
  assert.ok(Math.abs(v.h - 10) < .01, "the letter height is the capital height: " + v.h);
  const g = readGcode(v.job); assert.deepStrictEqual(g.problems, []);
  const deep = g.cuts.filter(c => c.to.z < 0); assert.ok(deep.every(c => Math.abs(c.to.z - -.3) < 1e-9), "engraved at one depth");
  assert.strictEqual(g.cuts.filter(c => c.from.x === c.to.x && c.from.y === c.to.y && c.to.z < c.from.z).length, 4, "once down per stroke");
  assert.ok(v.refused.some(t => /single-line font, so it can only be engraved/.test(t)));
  assert.strictEqual(v.group, "Single-line, for engraving"); assert.strictEqual(v.first, "Hershey Sans 1-stroke");
  assert.deepStrictEqual(v.after, { font: "EMS Readability", kind: "line", bit: "v", drawn: true }, "picking one switches to engraving with a V-bit");
  assert.deepStrictEqual(app.errors, []);
});

test("a V-carve's level bottom is cleared smooth by a flat bit first, and comes out the shape the V-bit's angle makes", async () => {
  const v = await app.run(`${SETUP}
    const it = add({ type: 'rect', w: 40, h: 10, rot: 30 }, { kind: 'vcarve', bit: 'v-90', depth: 2, clear: 'flat-1-8' });
    const measure = () => {
      const m = cvCarveMap(cv, cvBitOf, .2), a = -30 * Math.PI / 180; let wall = 0, bottom = 0;
      for (let j = 0; j < m.ny; j++) for (let i = 0; i < m.nx; i++) {
        const dx = i * m.cell - 150, dy = j * m.cell - 100, u = dx * Math.cos(a) - dy * Math.sin(a), w = dx * Math.sin(a) + dy * Math.cos(a), d = Math.min(20 - Math.abs(u), 5 - Math.abs(w));
        if (d < .3) continue; const e = Math.abs(m.H[i + j * m.nx] - -Math.min(2, Math.max(0, d - .05)));
        if (d > 2.3) bottom = Math.max(bottom, e); else wall = Math.max(wall, e);
      }
      return { wall, bottom };
    };
    const job = cvJob(cv, cvBitOf, 'T').map(f => ({ bit: f.bit.id, text: f.text })), checks = cvChecks(cv, cvBitOf, true), smooth = measure();
    it.op.clear = null; const ridged = measure(); it.op.clear = 'v-60'; const wrong = cvChecks(cv, cvBitOf, true).filter(c => c.bad).map(c => c.text);
    return { job, checks, smooth, ridged, wrong };`);
  assert.deepStrictEqual(v.job.map(f => f.bit), ["flat-1-8", "v-90"], "the flat bit clears first, in its own file");
  v.job.forEach(f => assert.deepStrictEqual(readGcode(f.text).problems, []));
  assert.match(v.job[0].text, /\(Clear the V-carve bottom: rect\)/);
  const flat = readGcode(v.job[0].text).cuts.map(c => c.to.z); assert.ok(Math.abs(Math.min(...flat) - -2) < 1e-9, "the flat bit goes only to the deepest cut");
  assert.deepStrictEqual(v.checks.filter(c => c.bad), []);
  assert.ok(v.smooth.bottom < .06, "a smooth bottom: " + v.smooth.bottom);
  assert.ok(v.ridged.bottom > .12, "ridges without the flat bit: " + v.ridged.bottom);
  assert.ok(v.smooth.wall < .2, "walls at the V's angle: " + v.smooth.wall);
  assert.ok(v.wrong.some(t => /clearing bit must be a flat bit/.test(t)));
});

test("each bit gets its own file, engraving comes first, and cutting free comes last", async () => {
  const v = await app.run(`${SETUP}
    add({ type: 'rect', w: 100, h: 60 }, { kind: 'outside', through: true, bit: 'flat-1-4' });
    add({ type: 'rect', w: 20, h: 20 }, { kind: 'pocket', bit: 'flat-1-8' });
    add({ type: 'circle', w: 30, h: 30, x: 60 }, { kind: 'line', bit: 'v-60', depth: 1 });
    add({ type: 'rect', w: 8, h: 8, x: 60 }, { kind: 'pocket', bit: 'flat-1-4' });
    return cvJob(cv, cvBitOf, 'Test').map(f => ({ name: f.name, bit: f.bit.id, text: f.text }));`);
  assert.strictEqual(v.length, 3);
  assert.strictEqual(v[v.length - 1].bit, "flat-1-4", "the cut-out's bit is last and carries its pocket too");
  assert.match(v[0].name, /^1 of 3 - /);
  v.forEach(f => { assert.ok(!/M6|T\d/.test(f.text), "no tool change words GRBL refuses"); assert.deepStrictEqual(readGcode(f.text).problems, []); });
  const last = v[2].text; assert.ok(last.indexOf("Pocket") < last.indexOf("Cut out"), "pocket before the cut-out on the same bit");
});

test("problems are reported: wrong bit, too deep, too narrow, past the edge", async () => {
  const v = await app.run(`${SETUP}
    const a = add({ type: 'rect', w: 50, h: 50 }, { kind: 'vcarve', bit: 'flat-1-8' });
    const one = cvChecks(cv, cvBitOf, true).filter(c => c.bad).map(c => c.text);
    a.op = { kind: 'pocket', bit: 'flat-1-8', depth: 40 }; const two = cvChecks(cv, cvBitOf, true).filter(c => c.bad).map(c => c.text);
    a.op = { kind: 'pocket', bit: 'flat-1-4', depth: 3 }; a.w = 3; const three = cvChecks(cv, cvBitOf, true).filter(c => c.bad).map(c => c.text);
    a.w = 50; a.x = 5; const four = cvChecks(cv, cvBitOf, true).map(c => c.text);
    return { one, two, three, four, none: cvChecks(CV_DEFAULT(), cvBitOf, false).filter(c => c.bad).length };`);
  assert.match(v.one[0], /V-bit/); assert.match(v.two[0], /deeper than the board/); assert.match(v.three[0], /too narrow/);
  assert.ok(v.four.some(t => /past the edge/.test(t))); assert.strictEqual(v.none, 2);
});

test("an SVG is read correctly: curves, arcs, transforms, white knock-outs, and nothing runs", async () => {
  const v = await app.run(`
    const svg = \`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100mm"><script>window.__ran = 1</script><image href="x" onerror="window.__ran = 2"/><rect width="100" height="100" fill="#fff"/><g transform="translate(10 10)"><path d="M0 0H40V40H0Z"/><circle cx="60" cy="20" r="10" fill="red"/></g><path d="M10 60a10 10 0 1 0 20 0a10 10 0 1 0-20 0z"/><rect x="60" y="60" width="30" height="30"/><rect x="70" y="70" width="10" height="10" fill="white"/><text>skip</text></svg>\`;
    const a = cvParseSvg(svg), area = a.regions.reduce((n, p) => n + cvArea(p), 0), comp = cvParseSvg('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0a5 5 0 01 10 0l0 10-10 0z"/></svg>');
    let bad = ''; try { cvParseSvg('<svg><path d="M0 0'); } catch (e) { bad = e.message; }
    return { w: a.w, h: a.h, mmW: a.mmW, area, text: a.textLeft, ran: window.__ran || 0, comp: [comp.w, comp.h], bad };`);
  assert.ok(Math.abs(v.w - 80) < .05, "width " + v.w); assert.ok(Math.abs(v.h - 80) < .05, "height " + v.h);
  assert.ok(Math.abs(v.mmW - 80) < .05, "real size from the file");
  const want = 1600 + Math.PI * 100 + Math.PI * 100 + 900 - 100;
  assert.ok(Math.abs(v.area - want) < 3, `area ${v.area} wanted ${want}`);
  assert.strictEqual(v.text, 1); assert.strictEqual(v.ran, 0, "nothing in the file runs");
  assert.ok(Math.abs(v.comp[0] - 10) < .01 && Math.abs(v.comp[1] - 15) < .05, "arc flags written without spaces " + v.comp);
  assert.ok(v.bad.length > 0);
});

test("text becomes real outlines at the size asked for, with holes in letters kept", async () => {
  const v = await app.run(`${SETUP}
    await cvFontLoad('Arial');
    const it = add({ type: 'text', text: 'HO', font: 'Arial', size: 30, spacing: 0, leading: 1, align: 'center' }, { kind: 'pocket', bit: 'flat-1-16', depth: 2 });
    const s = cvLocal(it), g = cvJob(cv, cvBitOf, 'Test');
    return { pieces: cvIslands(s.regions).length, holes: s.regions.filter(p => cvArea(p) < 0).length, h: s.h, w: s.w, text: g[0].text };`);
  assert.strictEqual(v.pieces, 2); assert.strictEqual(v.holes, 1, "the O keeps its middle");
  assert.ok(v.h > 30 && v.h < 32.5, "capital height " + v.h); assert.ok(v.w > 35);
  assert.deepStrictEqual(readGcode(v.text).problems, []);
});

test("the workspace: opening, keys only touching carve items, undo, and bits", async () => {
  const v = await app.run(`
    loadProject(TEMPLATES[2].make()); document.querySelectorAll('dialog[open]').forEach(d => d.close());
    const panels = P.items.length; cvBits.forEach(b => { b.have = b.id === 'flat-1-8'; }); await cvBitsSave();
    sel = []; cvShowPaths = true; await openCarve();
    const rect = cvAddRect(); const had = P.carve.items.length;
    sel = [P.items[0].id];
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }));
    const afterDel = { carve: P.carve.items.length, items: P.items.length };
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }));
    const afterUndo = P.carve.items.length;
    const options = [...document.querySelectorAll('#cvSide select')].length;
    cvSel = P.carve.items[0].id; carveRender();
    const bits = [...document.querySelectorAll('.pickBit b')].map(o => o.textContent);
    await new Promise(r => setTimeout(r, 120));
    const cuts = document.querySelectorAll('#cvCuts path').length, btn = document.getElementById('cvExport').disabled; cvShowPaths = false;
    closeCarve();
    return { panels, had, afterDel, afterUndo, bits, cuts, btn, kept: P.items.length };`);
  assert.strictEqual(v.had, 1);
  assert.strictEqual(v.afterDel.carve, 0, "Delete removes the carve item"); assert.strictEqual(v.afterDel.items, v.panels, "and never the furniture");
  assert.strictEqual(v.afterUndo, 1);
  assert.deepStrictEqual(v.bits, ['1/8" flat end mill']);
  assert.strictEqual(v.cuts, 1); assert.strictEqual(v.btn, false); assert.strictEqual(v.kept, v.panels);
  assert.deepStrictEqual(app.errors, []);
});

test("carving and its SVG art come back after saving and opening the file", async () => {
  const v = await app.run(`${SETUP}
    await cvAddSvgText('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>');
    const key = P.carve.items[0].art, bytes = await atelierBytes();
    delete TEXTURES[key]; cvArtCache.clear(); cvShapeCache.clear(); P.carve = null;
    await openBytes(bytes.buffer ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) : bytes, 'x.atlr');
    document.querySelectorAll('dialog[open]').forEach(d => d.close());
    const it = P.carve && P.carve.items[0];
    return { has: !!TEXTURES[key], same: it && it.art === key, w: it ? cvLocal(it).w : 0 };`);
  assert.ok(v.has && v.same); assert.ok(v.w > 10);
  assert.deepStrictEqual(app.errors, []);
});

test("real mouse and file: an SVG is picked, dragged, and saved with the app's own controls", async () => {
  const path = require("path"), fs = require("fs"), os = require("os"), dir = fs.mkdtempSync(path.join(os.tmpdir(), "atelier-svg-")), file = path.join(dir, "star.svg");
  fs.writeFileSync(file, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M10 10H90V90H10Z"/></svg>');
  await app.run(`loadProject(TEMPLATES[0].make()); document.querySelectorAll('dialog[open]').forEach(d => d.close()); cvBits.forEach(b => { b.have = true; }); P.carve = null; await openCarve(); document.querySelectorAll('dialog[open]').forEach(d => d.close());`);
  await app.setFile("cvSvgIn", file);
  for (let i = 0; i < 30 && !(await app.run("return P.carve.items.length")); i++) await new Promise(r => setTimeout(r, 100));
  const a = await app.run(`const it = P.carve.items[0], r = document.querySelector('.cvitem').getBoundingClientRect(); return { x: it.x, y: it.y, cx: r.x + r.width / 2, cy: r.y + r.height / 2, k: cvView.k };`);
  const mouse = (type, x, y, buttons) => app.send("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons, clickCount: 1 });
  await mouse("mousePressed", a.cx, a.cy, 1); await mouse("mouseMoved", a.cx + 60, a.cy - 40, 1); await mouse("mouseMoved", a.cx + 120, a.cy - 80, 1); await mouse("mouseReleased", a.cx + 120, a.cy - 80, 0);
  const b = await app.run(`const it = P.carve.items[0]; return { x: it.x, y: it.y, sel: cvSel === it.id, undo: undoS.length, jobs: cvJob(P.carve, cvBitOf, 'T').length, disabled: document.getElementById('cvExport').disabled };`);
  assert.ok(Math.abs(b.x - (a.x + 120 * a.k)) < a.k * 2, "moved right with the mouse"); assert.ok(Math.abs(b.y - (a.y + 80 * a.k)) < a.k * 2, "up on screen is further from the front");
  assert.ok(b.sel); assert.strictEqual(b.jobs, 1); assert.strictEqual(b.disabled, false);
  await app.run("closeCarve();"); fs.rmSync(dir, { recursive: true, force: true });
  assert.deepStrictEqual(app.errors, []);
});

test("the starting popup: offers carving, starts a carving project, and gets out of the way of an opened project", async () => {
  const v = await app.run(`
    document.getElementById('bNew').click();
    const shown = document.getElementById('newDlg').open, cards = document.querySelectorAll('#cat .card').length, blankInGrid = [...document.querySelectorAll('#cat .card b')].some(b => b.textContent === 'Blank');
    cvBits.forEach(b => { b.have = true; });
    document.getElementById('startCarve').click(); await new Promise(r => setTimeout(r, 150));
    const carving = { popup: document.getElementById('newDlg').open, open: cvOpen(), name: P.name, items: P.carve.items.length };
    closeCarve();
    document.getElementById('bNew').click();
    await openBytes((await atelierBytes()).buffer);   // what a double-clicked file does
    const closedByOpening = !document.getElementById('newDlg').open;
    return { shown, cards, blankInGrid, carving, closedByOpening, chosen: projectChosen, total: TEMPLATES.length };`);
  assert.ok(v.shown); assert.strictEqual(v.cards, v.total - 1); assert.strictEqual(v.blankInGrid, false);
  assert.deepStrictEqual(v.carving, { popup: false, open: true, name: "My carving", items: 0 });
  assert.ok(v.closedByOpening, "opening a project closes the popup"); assert.ok(v.chosen);
  assert.deepStrictEqual(app.errors, []);
});

test("a file opened at launch isn't covered by the starting popup", async () => {
  const fs = require("fs"), os = require("os"), path = require("path"), dir = fs.mkdtempSync(path.join(os.tmpdir(), "atelier-start-")), file = path.join(dir, "mine.atlr");
  const bytes = await app.run("const b = await atelierBytes(); return Array.from(b);");
  fs.writeFileSync(file, Buffer.from(bytes));
  const one = await openApp({ file, keepDialogs: true });
  try { const s = await one.run("return { popup: document.getElementById('newDlg').open, chosen: projectChosen };"); assert.deepStrictEqual(s, { popup: false, chosen: true }); }
  finally { await one.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test("bits: each is drawn from its own numbers, can be ticked, and a job only offers bits that suit it", async () => {
  const v = await app.run(`
    loadProject(TEMPLATES[0].make()); cvBits = ${TEST_BITS}; await openCarve();
    const dlgOpen = cvEl('bitsDlg').open, tiles = document.querySelectorAll('.bitTile').length, arts = document.querySelectorAll('.bitTile svg.bitArt').length;
    const owned0 = cvOwned().length;
    const tick = document.querySelector('[data-bithave="v-60"]'); tick.click();
    document.querySelector('[data-bithave="flat-1-8"]').click();
    const owned1 = cvOwned().map(b => b.id), selAfter = document.querySelector('.bitTile.sel span').textContent, tickStays = document.querySelector('[data-bithave="flat-1-8"]').checked;
    document.querySelector('[data-bitpick="v-60"]').click();
    const big = document.getElementById('bitBig').textContent, stillHave = cvOwned().length, angleBox = document.querySelector('#bitForm [data-key="angle"]');
    angleBox.value = '30'; angleBox.dispatchEvent(new Event('change', { bubbles: true }));
    const bigAfter = document.getElementById('bitBig').textContent; cvBits.find(b => b.id === 'v-60').angle = 60;
    const narrow = cvBitArt({ type: 'flat', name: 'a', d: 3.175 }), wide = cvBitArt({ type: 'flat', name: 'a', d: 6.35 }), w = s => +/M[\\d.]+ \\d+H[\\d.]+V126H([\\d.]+)/.exec(s)[1], x = s => +/M0 112H([\\d.]+)/.exec(s)[1];
    cvEl('bitsDlg').close();
    const it = cvAddRect(); cvSel = it.id; carveRender();
    const offer = kind => { it.op = cvOpFor(P.carve, kind); carveRender(); return [...document.querySelectorAll('.pickBit b')].map(o => o.textContent); };
    const res = { line: offer('line'), pocket: offer('pocket'), v: offer('vcarve'), out: offer('outside') };
    const on = document.querySelector('.pickBit.on b').textContent;
    cvBits.forEach(b => { if (b.type === 'v') b.have = false; }); it.op = cvOpFor(P.carve, 'vcarve'); carveRender();
    const none = document.querySelector('.pickNone p').textContent;
    closeCarve();
    return { dlgOpen, tiles, arts, owned0, owned1, selAfter, tickStays, big, stillHave, bigAfter, widths: [(60 - x(narrow)) * 2, (60 - x(wide)) * 2], res, on, none };`);
  assert.ok(v.dlgOpen, "opens by itself when no bits are ticked"); assert.strictEqual(v.tiles, 6); assert.strictEqual(v.arts, 6); assert.strictEqual(v.owned0, 0);
  assert.deepStrictEqual(v.owned1.sort(), ["flat-1-8", "v-60"]); assert.ok(v.tickStays);
  assert.match(v.big, /60° point/); assert.strictEqual(v.stillHave, 2, "looking at a bit doesn't untick it"); assert.match(v.bigAfter, /30° point/);
  assert.ok(Math.abs(v.widths[1] / v.widths[0] - 2) < .01, "a 1/4 inch bit is drawn twice as wide as a 1/8 inch one: " + v.widths);
  assert.strictEqual(v.res.line.length, 2); assert.deepStrictEqual(v.res.pocket, ['1/8" flat end mill']); assert.deepStrictEqual(v.res.v, ["60° V-bit"]); assert.deepStrictEqual(v.res.out, ['1/8" flat end mill']);
  assert.strictEqual(v.on, '1/8" flat end mill'); assert.match(v.none, /needs a V-bit/);
  assert.deepStrictEqual(app.errors, []);
});

test("the bits owned: all listed and ticked, the everyday wood bit is the default, and speeds suit the machine", async () => {
  const v = await app.run(`
    loadProject(TEMPLATES[0].make()); document.querySelectorAll('dialog[open]').forEach(d => d.close());
    cvBits = JSON.parse(JSON.stringify(CV_BITS_START)); P.carve = null; await openCarve(); const autoOpened = cvEl('bitsDlg').open; if (autoOpened) cvEl('bitsDlg').close();
    const it = cvAddRect(), pick = {}; ['pocket', 'outside', 'inside', 'line', 'vcarve'].forEach(k => { pick[k] = cvOpFor(P.carve, k).bit; });
    it.op = cvOpFor(P.carve, 'pocket'); const job = cvJob(P.carve, cvBitOf, 'T')[0].text;
    const b = P.carve.board, fits = b.l <= 300 && b.w <= 180;
    it.op = cvOpFor(P.carve, 'outside'); b.t = 18; it.op.through = false; it.op.depth = 13; const deep = cvChecks(P.carve, cvBitOf, true).map(c => c.text); b.t = 3;
    it.op.depth = 1; it.x = 280; b.l = 400; const far = cvChecks(P.carve, cvBitOf, true).map(c => c.text); b.l = 203.2;
    cvOpenBits(); const tiles = [...document.querySelectorAll('.bitGroup')].map(g => g.querySelectorAll('.bitTile').length); cvEl('bitsDlg').close(); closeCarve();
    return { n: cvBits.length, owned: cvOwned().length, autoOpened, pick, job, fits, deep, far, tiles, fast: cvBits.filter(x => x.feed > 1500 || x.rpm > 1000).length };`);
  assert.strictEqual(v.n, 13); assert.strictEqual(v.owned, 13); assert.strictEqual(v.autoOpened, false); assert.deepStrictEqual(v.tiles, [2, 1, 10]);
  assert.deepStrictEqual(v.pick, { pocket: "flat-2f", outside: "flat-2f", inside: "flat-2f", line: "v-30", vcarve: "v-30" });
  assert.match(v.job, /M3 S1000/); assert.match(v.job, /F400/); assert.ok(!/F[5-9]\d\d|F\d{4}/.test(v.job), "no feed over 400"); assert.deepStrictEqual(readGcode(v.job).problems, []);
  assert.ok(v.fits, "the starting board fits the machine"); assert.strictEqual(v.fast, 0);
  assert.ok(v.deep.some(t => /deeper than .* can cut/.test(t))); assert.ok(v.far.some(t => /further .* than your machine/.test(t)));
  assert.deepStrictEqual(app.errors, []);
});

test("corn bits fold away in the picker, and stay open when one is in use", async () => {
  const v = await app.run(`
    loadProject(TEMPLATES[0].make()); document.querySelectorAll('dialog[open]').forEach(d => d.close());
    cvBits = JSON.parse(JSON.stringify(CV_BITS_START)); P.carve = null; await openCarve();
    const it = cvAddRect(); it.op = cvOpFor(P.carve, 'pocket'); cvSel = it.id; carveRender();
    const closed = !document.querySelector('.pickMore').open, usual = document.querySelectorAll('#cvSide [role=radiogroup] > .pickBit').length, depthBox = !!document.querySelector('[data-cf="op.depth"]');
    const radio = document.querySelector('.pickMore input[value="corn-1"]'); radio.click();
    const chosen = it.op && P.carve.items[0].op.bit, open = document.querySelector('.pickMore').open;
    closeCarve(); return { closed, usual, depthBox, chosen, open };`);
  assert.deepStrictEqual(v, { closed: true, usual: 2, depthBox: true, chosen: "corn-1", open: true });
  assert.deepStrictEqual(app.errors, []);
});

test("Carve is part of the main window: menus and status stay, it's a mode, and design commands go back to the design", async () => {
  const v = await app.run(`
    loadProject(TEMPLATES[2].make()); document.querySelectorAll('dialog[open]').forEach(d => d.close());
    cvBits = JSON.parse(JSON.stringify(CV_BITS_START)); document.getElementById('modeCarve').click(); await new Promise(r => setTimeout(r, 100));
    const seen = id => { const e = document.getElementById(id), r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest('#' + id) !== null; };
    const on = { menus: seen('menus'), toolbar: seen('bSave'), foot: seen('foot'), stage: seen('cvStage'), panel: seen('cvPanel'), design3d: seen('view3d'), layout: getComputedStyle(document.getElementById('lay')).display, mode: document.getElementById('modeCarve').getAttribute('aria-selected') };
    const it = cvAddRect(); const footText = document.getElementById('fCarve').textContent;
    runDo('undo'); const undone = P.carve.items.length; runDo('redo'); const redone = P.carve.items.length;
    cvSel = P.carve.items[0].id; carveRender(); runDo('dup'); const dup = P.carve.items.length; runDo('del'); const del = P.carve.items.length;
    const panels = P.items.length; const toSave = P.carveMode;
    runDo('big:3d'); const back = !cvOpen() && P.carveMode === false; if (typeof setBig === 'function') setBig('3d');
    document.getElementById('modeCarve').click(); await new Promise(r => setTimeout(r, 50));
    const bytes = await atelierBytes(); closeCarve(); await openBytes(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)); await new Promise(r => setTimeout(r, 50));
    const reopened = cvOpen(); loadProject(TEMPLATES[0].make()); await new Promise(r => setTimeout(r, 50)); const newOneDesign = !cvOpen();
    return { on, footText, undone, redone, dup, del, panels, kept: P.items.length, toSave, back, reopened, newOneDesign };`);
  assert.deepStrictEqual(v.on, { menus: true, toolbar: true, foot: true, stage: true, panel: true, design3d: false, layout: "none", mode: "true" });
  assert.match(v.footText, /board/); assert.strictEqual(v.undone, 0); assert.strictEqual(v.redone, 1); assert.strictEqual(v.dup, 2); assert.strictEqual(v.del, 1);
  assert.strictEqual(v.toSave, true); assert.ok(v.back, "a design command goes back to Design"); assert.ok(v.reopened, "a carving reopens in Carve"); assert.ok(v.newOneDesign, "a new project starts in Design");
  assert.deepStrictEqual(app.errors, []);
});

test("new projects have no walls or floor, stay that way after reopening, and old projects keep theirs", async () => {
  const v = await app.run(`
    const rooms = p => p.items.filter(isRoomPart).length;
    const made = TEMPLATES.map(t => rooms(t.make()));
    const blank = TEMPLATES[0].make(); const kept = rooms(ensureFloor(JSON.parse(JSON.stringify(blank))));
    const old = { name: 'old', items: [], groups: [], nextId: 1 }; const upgraded = rooms(ensureFloor(old));
    loadProject(TEMPLATES[0].make()); document.querySelectorAll('dialog[open]').forEach(d => d.close()); await new Promise(r => setTimeout(r, 50));
    return { made, kept, upgraded, items: P.items.length, groups: P.groups.length, empty: !document.getElementById('empty').hidden, gallery: GALLERY_ICONS.wall && GALLERY_ICONS.floor ? 1 : 0 };`);
  assert.ok(v.made.every(n => n === 0), "every starting piece: " + v.made); assert.strictEqual(v.kept, 0); assert.strictEqual(v.upgraded, 1);
  assert.strictEqual(v.items, 0); assert.strictEqual(v.groups, 0); assert.ok(v.empty); assert.strictEqual(v.gallery, 1);
  assert.deepStrictEqual(app.errors, []);
});

test("the job is picked from drawings, and a new item starts with the job last chosen for its kind", async () => {
  const v = await app.run(`
    loadProject(TEMPLATES[0].make()); document.querySelectorAll('dialog[open]').forEach(d => d.close()); localStorage.removeItem(CV_JOBS_STORE); cvJobsChosen = {};
    cvBits = JSON.parse(JSON.stringify(CV_BITS_START)); P.carve = null; await openCarve();
    const first = await cvAddText({ font: 'Arial' }), startKind = first.op.kind, startBit = first.op.bit;
    const tiles = [...document.querySelectorAll('.jobBtn')].map(l => l.textContent.trim()), arts = document.querySelectorAll('.jobBtn svg').length;
    document.querySelector('.jobBtn input[value="vcarve"]').click();
    const chosen = P.carve.items[0].op.kind, bitNow = P.carve.items[0].op.bit, what = document.querySelector('.jobWhat').textContent;
    const second = await cvAddText({ font: 'Arial' }), secondKind = second.op.kind, rect = cvAddRect(), stored = JSON.parse(localStorage.getItem(CV_JOBS_STORE));
    cvSel = second.id; carveRender(); document.querySelector('.jobBtn input[value="off"]').click(); const third = await cvAddText({ font: 'Arial' });
    closeCarve(); localStorage.removeItem(CV_JOBS_STORE); cvJobsChosen = {};
    return { startKind, startBit, tiles, arts, chosen, bitNow, what, secondKind, rectKind: rect.op.kind, stored, thirdKind: third.op.kind };`);
  assert.strictEqual(v.startKind, "line"); assert.strictEqual(v.startBit, "v-30");
  assert.deepStrictEqual(v.tiles, ["Engrave", "Pocket", "V-carve", "Drill", "Cut around", "Cut inside", "Don't cut"]); assert.strictEqual(v.arts, 7);
  assert.strictEqual(v.chosen, "vcarve"); assert.strictEqual(v.bitNow, "v-30"); assert.match(v.what, /V-bit/);
  assert.strictEqual(v.secondKind, "vcarve", "text remembers"); assert.strictEqual(v.rectKind, "line", "shapes have their own memory"); assert.strictEqual(v.thirdKind, "vcarve", "Don't cut isn't remembered");
  assert.deepStrictEqual(app.errors, []);
});

const SETUP3D = `
  loadProject(TEMPLATES[0].make()); document.querySelectorAll('dialog[open]').forEach(d => d.close());
  cvBits = ${TEST_BITS}; cvBits.forEach(b => { b.have = true; });
  P.carve = CV_DEFAULT(); P.carve.board = { l: 200, w: 100, t: 18 }; P.carve.tabH = 2; const cv = P.carve;
  const add = (f, op) => { const it = { id: cv.nextId++, x: 100, y: 50, rot: 0, ...f, op: { kind: 'pocket', bit: 'flat-1-8', depth: 3, through: false, tabs: 4, ...op } }; cv.items.push(it); return it; };
  const at = (m, x, y) => m.H[Math.round(x / m.cell) + Math.round(y / m.cell) * m.nx];`;

test("the carved surface matches what each bit really cuts", async () => {
  const v = await app.run(`${SETUP3D}
    add({ type: 'rect', w: 60, h: 40 }, { depth: 3 });
    const pocket = cvCarveMap(cv, cvBitOf, .25), p = { mid: at(pocket, 100, 50), near: at(pocket, 71, 50), outside: at(pocket, 68, 50), far: at(pocket, 10, 10) };
    cv.items.length = 0; add({ type: 'rect', w: 40, h: 40 }, { kind: 'vcarve', bit: 'v-90', depth: 2 });
    const vee = cvCarveMap(cv, cvBitOf, .1), q = { wall: at(vee, 80.1, 50), one: at(vee, 81, 50), two: at(vee, 82, 50), floor: at(vee, 100, 50), outside: at(vee, 79, 50) };
    cv.items.length = 0; add({ type: 'rect', w: 60, h: 40 }, { kind: 'outside', bit: 'flat-1-8', through: true, tabs: 4 });
    const cut = cvCarveMap(cv, cvBitOf, .25); let through = 0, tabs = 0;
    for (let x = 60; x < 140; x += .25) for (let y = 20; y < 80; y += .25) { const h = at(cut, x, y); if (h <= -18 + .001) through++; else if (Math.abs(h + 16) < .01) tabs++; }
    const r = { middle: at(cut, 100, 50), through, tabs };
    cv.items.length = 0; add({ type: 'rect', w: 60, h: 40 }, { kind: 'off' }); const off = cvCarveMap(cv, cvBitOf, .5), none = off.H.every(h => h === 0);
    return { p, q, r, none };`);
  assert.ok(Math.abs(v.p.mid + 3) < .001 && Math.abs(v.p.near + 3) < .001, "pocket floor at depth"); assert.strictEqual(v.p.outside, 0, "nothing past the wall"); assert.strictEqual(v.p.far, 0);
  assert.strictEqual(v.q.outside, 0, "the V stops at the outline");
  assert.ok(v.q.wall > -.25, "shallow at the wall: " + v.q.wall); assert.ok(Math.abs(v.q.one + 1) < .25, "a 90 degree bit goes 1 deep at 1 in: " + v.q.one); assert.ok(Math.abs(v.q.two + 2) < .25, v.q.two); assert.ok(v.q.floor < -1.65 && v.q.floor >= -2.001, "near the deepest cut, with only small ridges: " + v.q.floor);
  assert.strictEqual(v.r.middle, 0, "the piece itself isn't touched"); assert.ok(v.r.through > 1000, "cut right through"); assert.ok(v.r.tabs > 100, "tabs left standing: " + v.r.tabs);
  assert.deepStrictEqual(app.errors, []);
});

test("the 3D view shows the board, follows changes, and closes with Carve", async () => {
  const v = await app.run(`${SETUP3D}
    add({ type: 'rect', w: 80, h: 50 }, { depth: 3 }); await openCarve(); document.querySelectorAll('dialog[open]').forEach(d => d.close());
    document.getElementById('cv3dBtn').click(); await new Promise(r => setTimeout(r, 300));
    const shot = () => { const c = document.querySelector('#cv3d canvas'), small = document.createElement('canvas'); small.width = 60; small.height = 40; const g = small.getContext('2d'); g.drawImage(c, 0, 0, 60, 40); return Array.from(g.getImageData(0, 0, 60, 40).data); };
    const before = shot(), colours = new Set(); for (let i = 0; i < before.length; i += 4) colours.add(before[i] + ',' + before[i + 1] + ',' + before[i + 2]);
    const programs = CV3D.renderer.info.programs.map(p => p.diagnostics ? p.diagnostics.runnable : true); const pressed = document.getElementById('cv3dBtn').getAttribute('aria-pressed'), shown = !document.getElementById('cv3d').hidden;
    const key = CV3D.key; P.carve.items[0].op.depth = 5; cvEdit(() => {}); await new Promise(r => setTimeout(r, 300)); const rebaked = CV3D.key !== key;
    const it = P.carve.items[0]; cvEdit(() => { it.w = 120; }); await new Promise(r => setTimeout(r, 300)); const after = shot(); let differs = 0; for (let i = 0; i < after.length; i++) if (after[i] !== before[i]) differs++;
    closeCarve(); const closed = !CV3D.on && document.getElementById('cv3d').hidden;
    await openCarve(); document.querySelectorAll('dialog[open]').forEach(d => d.close()); const offAgain = !CV3D.on; closeCarve();
    return { colours: colours.size, pressed, shown, rebaked, differs, closed, offAgain, programs };`);
  assert.ok(v.programs.length && v.programs.every(Boolean), "the 3D view's shader built"); assert.ok(v.colours > 5, "it drew something: " + v.colours); assert.strictEqual(v.pressed, "true"); assert.ok(v.shown); assert.ok(v.rebaked); assert.ok(v.differs > 50, "the picture changed: " + v.differs); assert.ok(v.closed); assert.ok(v.offAgain);
  assert.deepStrictEqual(app.errors, []);
});

test("board type: choosing one offers its thicknesses, sets the through-cut depth and colours both views", async () => {
  const v = await app.run(`
    loadProject(newProject('Woods')); document.querySelectorAll('dialog[open]').forEach(d => d.close());
    cvBits = JSON.parse(JSON.stringify(CV_BITS_START)); P.carve = null; await openCarve();
    const pick = (k, val) => { const el = document.querySelector('[data-cf="' + k + '"]'); el.value = val; el.dispatchEvent(new Event('change', { bubbles: true })); };
    const types = [...document.querySelectorAll('[data-cf="b.wood"] option')].map(o => o.textContent), start = { wood: P.carve.board.wood, t: P.carve.board.t };
    const boardFill = () => document.querySelector('#cvGrain rect').getAttribute('fill');
    const bassFill = boardFill(); pick('b.wood', 'ply'); const ply = { t: P.carve.board.t, sizes: [...document.querySelectorAll('[data-cf="b.tsel"] option')].map(o => o.textContent), fill: boardFill() };
    pick('b.tsel', '18'); const set18 = P.carve.board.t;
    const it = cvAddRect(); it.op = cvOpFor(P.carve, 'outside'); carveRender();
    const deepest = cvOpDepth(P.carve, it.op), z = Math.min(...cvItemPaths(P.carve, it, cvBitOf(it.op.bit)).chains.flat().map(q => q[2]));
    cvSel = null; carveRender(); pick('b.tsel', 'other'); const box = !!document.querySelector('[data-cf="b.t"]'); pick('b.t', '20mm'); const typed = P.carve.board.t;
    pick('b.wood', 'mdf'); const keptTyped = P.carve.board.t, stillOther = document.querySelector('[data-cf="b.tsel"]').value;
    undo(); const undone = P.carve.board.wood; closeCarve();
    return { types, start, bassFill, ply, set18, deepest, z, box, typed, keptTyped, stillOther, undone };`);
  assert.deepStrictEqual(v.types, ["Basswood", "Plywood", "MDF", "Hardboard", "Eco board"]); assert.deepStrictEqual(v.start, { wood: "bass", t: 3 });
  assert.notStrictEqual(v.ply.fill, v.bassFill); assert.strictEqual(v.ply.t, 3 < 6 ? 6 : 6, "nearest size plywood comes in"); assert.ok(v.ply.sizes.includes("18 mm") && v.ply.sizes.includes("Other size"));
  assert.strictEqual(v.set18, 18); assert.ok(Math.abs(v.deepest - 18.3) < .001); assert.ok(Math.abs(v.z + 18.3) < .001, "cuts through the chosen thickness");
  assert.ok(v.box); assert.strictEqual(v.typed, 20); assert.strictEqual(v.keptTyped, 20, "a typed size stays when the wood changes"); assert.strictEqual(v.stillOther, "other"); assert.strictEqual(v.undone, "ply");
  assert.deepStrictEqual(app.errors, []);
});

test("each wood has its own speeds: they reach the G-code, can be changed, and are remembered", async () => {
  const v = await app.run(`
    localStorage.removeItem(CV_RATES_STORE); cvWoodRates = {};
    loadProject(newProject('Woods')); document.querySelectorAll('dialog[open]').forEach(d => d.close());
    cvBits = JSON.parse(JSON.stringify(CV_BITS_START)); P.carve = null; await openCarve(); P.carve.ramp = 0;   // straight plunges, so each level shows as one
    const pick = (k, val) => { const el = document.querySelector('[data-cf="' + k + '"]'); el.value = val; el.dispatchEvent(new Event('change', { bubbles: true })); };
    const it = cvAddRect(); it.w = 40; it.h = 30; it.op = cvOpFor(P.carve, 'pocket'); it.op.depth = 2; cvSel = null; carveRender();
    const job = () => { const t = cvJob(P.carve, cvBitOf, 'T')[0].text, z = new Set(), feeds = new Set(); t.split('\\r\\n').forEach(l => { let m = /^G1 Z(-[\\d.]+)/.exec(l); if (m) z.add(+m[1]); m = / F(\\d+)/.exec(l); if (m) feeds.add(+m[1]); }); return { levels: z.size, feeds: [...feeds].sort((a, b) => a - b), wood: /Wood: (\\w+)/.exec(t)?.[1] }; };
    const bass = job(); pick('b.wood', 'ply'); const ply = job(), plyPct = document.querySelector('[data-cf="b.feedPct"]').value;
    pick('b.feedPct', '50'); pick('b.stepPct', '50'); const slow = job(); pick('b.feedPct', '999'); const refused = P.carve.board.feedPct;
    pick('b.wood', 'mdf'); const mdf = job(), mdfPct = P.carve.board.feedPct; pick('b.wood', 'ply'); const backTo = P.carve.board.feedPct;
    cvSel = P.carve.items[0].id; carveRender(); const shown = [...document.querySelectorAll('#cvSide .note')].map(n => n.textContent).find(t => /mm per pass/.test(t));
    const bitUntouched = cvBitOf('flat-2f').feed; closeCarve(); localStorage.removeItem(CV_RATES_STORE); cvWoodRates = {};
    return { bass, ply, plyPct, slow, refused, mdf, mdfPct, backTo, shown, bitUntouched };`);
  assert.deepStrictEqual(v.bass, { levels: 4, feeds: [100, 400], wood: "Basswood" });
  assert.deepStrictEqual(v.ply.feeds, [75, 300]); assert.strictEqual(v.ply.wood, "Plywood"); assert.strictEqual(v.ply.levels, 6, "0.375 mm passes, the wood's rate applied once"); assert.strictEqual(v.plyPct, "75");
  assert.deepStrictEqual(v.slow.feeds, [50, 200]); assert.strictEqual(v.refused, 50, "a silly number is refused");
  assert.deepStrictEqual(v.mdf.feeds, [100, 400]); assert.strictEqual(v.mdfPct, 100); assert.strictEqual(v.backTo, 50, "plywood's change is remembered");
  assert.match(v.shown, /On plywood: 200 mm\/min, 0.25 mm per pass/); assert.strictEqual(v.bitUntouched, 400, "the bit's own numbers stay");
  assert.deepStrictEqual(app.errors, []);
});

test("a curved through-cut has a smooth edge in the surface, with no steps", async () => {
  const v = await app.run(`
    loadProject(newProject('Round')); document.querySelectorAll('dialog[open]').forEach(d => d.close()); cvBits = ${TEST_BITS}; cvBits.forEach(b => { b.have = true; });
    P.carve = CV_DEFAULT(); P.carve.board = { l: 100, w: 100, t: 3 }; const cv = P.carve;
    cv.items.push({ id: cv.nextId++, type: 'circle', w: 60, h: 60, x: 50, y: 50, rot: 0, op: { kind: 'outside', bit: 'flat-1-8', through: true, depth: 3, tabs: 0 } });
    const m = cvCarveMap(cv, cvBitOf, .2), at = (x, y) => { const fx = x / m.cell, fy = y / m.cell, i = Math.floor(fx), j = Math.floor(fy), a = fx - i, b = fy - j, h = (p, q) => m.H[p + q * m.nx]; return (h(i, j) * (1 - a) + h(i + 1, j) * a) * (1 - b) + (h(i, j + 1) * (1 - a) + h(i + 1, j + 1) * a) * b; };
    // walk out along many directions and find where the surface crosses half depth: it should be one clean circle
    const radii = []; for (let d = 0; d < 720; d++) { const r0 = d / 720 * Math.PI * 2, c = Math.cos(r0), s = Math.sin(r0); let r = 30; while (r < 38 && at(50 + c * r, 50 + s * r) < -1.5) r += .005; radii.push(r); }
    const mean = radii.reduce((a, b) => a + b) / radii.length; return { mean, spread: Math.max(...radii) - Math.min(...radii), want: 30 + 3.175 };`);
  assert.ok(Math.abs(v.mean - v.want) < .1, "edge where the bit's edge is: " + v.mean);
  assert.ok(v.spread < .08, "edge wanders by only " + v.spread + " mm, on a grid of 0.2 mm");
  assert.deepStrictEqual(app.errors, []);
});

test("a curved through-cut looks smooth in the 3D picture, not just in the numbers", async () => {
  const v = await app.run(`
    loadProject(newProject('Round')); document.querySelectorAll('dialog[open]').forEach(d => d.close()); cvBits = JSON.parse(JSON.stringify(CV_BITS_START));
    P.carve = CV_DEFAULT(); P.carve.board = { wood: 'bass', l: 100, w: 100, t: 3 }; const cv = P.carve;
    cv.items.push({ id: cv.nextId++, type: 'circle', w: 60, h: 60, x: 50, y: 50, rot: 0, op: { kind: 'outside', bit: 'flat-2f', through: true, depth: 3, tabs: 0 } });
    await openCarve(); document.querySelectorAll('dialog[open]').forEach(d => d.close()); cv3dShow(true); await new Promise(r => setTimeout(r, 300));
    CV3D.camera.position.set(50, 50.01, 200); CV3D.controls.target.set(50, 50, 0); CV3D.controls.update(); cv3dDraw();
    const c = document.querySelector('#cv3d canvas'), g = document.createElement('canvas'); g.width = c.width; g.height = c.height; const x = g.getContext('2d'); x.drawImage(c, 0, 0); const d = x.getImageData(0, 0, g.width, g.height).data;
    const bg = [d[0], d[1], d[2]], isBg = (i, j) => { const o = (Math.round(j) * g.width + Math.round(i)) * 4; return Math.abs(d[o] - bg[0]) + Math.abs(d[o + 1] - bg[1]) + Math.abs(d[o + 2] - bg[2]) < 12; };
    // from directly above the slot is background: walk out from the middle in every direction to the slot's edges
    const cx = g.width / 2, cy = g.height / 2, inner = [], outer = [];
    for (let k = 0; k < 720; k++) { const a = k / 720 * Math.PI * 2, u = Math.cos(a), w = Math.sin(a); let r = 2; while (r < g.height * .49 && !isBg(cx + u * r, cy + w * r)) r += .5; inner.push(r); while (r < g.height * .49 && isBg(cx + u * r, cy + w * r)) r += .5; outer.push(r); }
    const rough = l => { let most = 0; for (let k = 0; k < l.length; k++) { const near = [-3, -2, -1, 1, 2, 3].map(n => l[(k + n + l.length) % l.length]); most = Math.max(most, Math.abs(l[k] - near.reduce((p, q) => p + q) / near.length)); } return most; };
    const out = { inner: rough(inner), outer: rough(outer), found: inner[0] > 5 && outer[0] > inner[0], size: g.height }; cv3dShow(false); closeCarve(); return out;`);
  assert.ok(v.found, "the slot is there");
  assert.ok(v.inner < 3 && v.outer < 3, "teeth along the edge, in pixels: inner " + v.inner + ", outer " + v.outer + ", in a picture " + v.size + " high");
  assert.deepStrictEqual(app.errors, []);
});

test("flat bits slope into the wood instead of plunging, and the slope cuts nothing extra", async () => {
  const v = await app.run(`${SETUP}
    add({ type: 'rect', w: 60, h: 40, x: 80 }, { kind: 'pocket', depth: 3 });
    add({ type: 'rect', w: 100, h: 60, x: 200 }, { kind: 'outside', through: true, tabs: 4, bit: 'flat-1-4' });
    const sloped = cvJob(cv, cvBitOf, 'T').map(f => f.text), a = cvCarveMap(cv, cvBitOf, 1);
    cv.ramp = 0; const straight = cvJob(cv, cvBitOf, 'T').map(f => f.text), b = cvCarveMap(cv, cvBitOf, 1);
    let diff = 0; for (let i = 0; i < a.H.length; i++) diff = Math.max(diff, Math.abs(a.H[i] - b.H[i]));
    return { sloped, straight, diff, angle: CV_RAMP };`);
  const tan = Math.tan(v.angle * Math.PI / 180) + 1e-3;
  const plunges = texts => texts.map(readGcode).flatMap(g => { assert.deepStrictEqual(g.problems, []); return g.cuts.filter(c => c.from.x === c.to.x && c.from.y === c.to.y && c.to.z < c.from.z); });
  // straight down only into air or onto a floor already cut, never onto the last level
  const down = plunges(v.sloped); assert.ok(down.length > 0);
  assert.deepStrictEqual(down.filter(c => c.to.z < -2.001), [], "no plunge into uncut wood");
  assert.ok(plunges(v.straight).some(c => c.to.z === -3), "with the slope off, it plunges as before");
  v.sloped.map(readGcode).forEach(g => g.cuts.forEach(c => { const h = Math.hypot(c.to.x - c.from.x, c.to.y - c.from.y), dz = c.from.z - c.to.z; if (h > 1e-6 && dz > 0) assert.ok(dz / h <= tan, "too steep: " + dz + " over " + h); }));
  assert.ok(v.diff < 1e-4, "the board comes out the same, tabs and all: " + v.diff);
});

test("a finishing pass leaves a skin, then takes it off in one pass at full depth, with the tabs in the same places", async () => {
  const v = await app.run(`${SETUP}
    add({ type: 'rect', w: 100, h: 60 }, { kind: 'outside', through: true, tabs: 4, bit: 'flat-1-4', finish: .5 });
    add({ type: 'rect', w: 40, h: 30, x: 60, y: 40 }, { kind: 'pocket', depth: 3, finish: .4 });
    cv.ramp = 0; const job = cvJob(cv, cvBitOf, 'T').map(f => f.text);
    const kinds = Object.keys(CV_JOB_SHORT).filter(k => k !== 'off').map(k => [k, cvOpFor(cv, k).finish]);
    return { job, kinds };`);
  const g = readGcode(v.job[v.job.length - 1]); assert.deepStrictEqual(g.problems, []);
  const R = 6.35 / 2, all = g.cuts.filter(c => c.to.x >= 90 && c.to.x <= 210 && c.to.y >= 60 && c.to.y <= 140);
  const deep = all.filter(c => c.from.z === -18.3 && c.to.z === -18.3), xs = deep.map(c => c.to.x);
  assert.ok(xs.some(x => Math.abs(x - (100 - R)) < .02) && xs.some(x => Math.abs(x - (200 + R)) < .02), "the last pass is on the line");
  const rx = all.filter(c => c.to.z === c.from.z && c.to.z < -1).map(c => c.to.x);
  assert.ok(Math.abs(Math.min(...rx) - (100 - R - .5)) < .02 && Math.abs(Math.max(...rx) - (200 + R + .5)) < .02, "the rough passes stay a skin away: " + Math.min(...rx));
  // on the line itself, it only runs at full depth and over the tabs
  const levels = new Set(all.filter(c => c.from.z === c.to.z && Math.abs(c.to.x - (100 - R)) < .02 && Math.abs(c.from.x - (100 - R)) < .02).map(c => c.to.z));
  assert.deepStrictEqual([...levels].sort((a, b) => a - b), [-18.3, -16]);
  // each lift over a tab in the last pass has a rough lift beside it
  const lifts = all.filter(c => c.from.x === c.to.x && c.from.y === c.to.y && c.to.z === -16 && c.from.z < -16);
  const onLine = c => Math.abs(c.to.x - (100 - R)) < .02 || Math.abs(c.to.x - (200 + R)) < .02 || Math.abs(c.to.y - (70 - R)) < .02 || Math.abs(c.to.y - (130 + R)) < .02;
  const last = lifts.filter(c => c.from.z === -18.3 && onLine(c)), roughLifts = lifts.filter(c => !onLine(c));
  assert.strictEqual(last.length, 4, "four tabs on the finished edge");
  last.forEach(c => assert.ok(roughLifts.some(o => Math.hypot(o.to.x - c.to.x, o.to.y - c.to.y) < .6), "a rough tab lines up"));
  // the pocket's walls are reached only by its last pass
  const p = readGcode(v.job[0]), pr = 3.175 / 2, wall = p.cuts.filter(c => c.to.z === c.from.z && c.to.x <= 85);
  assert.ok(Math.abs(Math.min(...wall.map(c => c.to.x)) - (40 + pr)) < .02, "pocket wall reached");
  assert.deepStrictEqual([...new Set(wall.filter(c => Math.abs(c.to.x - (40 + pr)) < .02 && Math.abs(c.from.x - (40 + pr)) < .02).map(c => c.to.z))], [-3], "only at full depth");
  assert.deepStrictEqual(v.kinds, [["line", 0], ["pocket", 0], ["vcarve", 0], ["drill", 0], ["outside", .2], ["inside", .2]], "cut-outs get one by default");
});

test("the zero point can be any corner, edge middle or the middle, and the G-code, checks and board follow it", async () => {
  const v = await app.run(`${SETUP} await openCarve(); P.carve = cv; cvSel = null;
    add({ type: 'rect', w: 60, h: 40 }, { kind: 'pocket', depth: 1 }); cv.ramp = 0; carveRender();
    const mark = () => { const c = document.querySelector('#cvZeroMark circle'); return [c.getAttribute('cx'), c.getAttribute('cy')]; };
    const corner = cvJob(cv, cvBitOf, 'T')[0].text, mark0 = mark();
    const radio = document.querySelector('[data-cf="zero"][value="0.5,0.5"]'); radio.checked = true; radio.dispatchEvent(new Event('change', { bubbles: true }));
    const middle = cvJob(cv, cvBitOf, 'T')[0].text, mark1 = mark();
    const note = [...document.querySelectorAll('#cvSide .note')].map(n => n.textContent).find(t => /gSender/.test(t));
    const farMiddle = cvChecks(cv, cvBitOf, true).map(c => c.text); cv.workX = 50; const tooWide = cvChecks(cv, cvBitOf, true).map(c => c.text); cv.workX = 300;
    cv.zero = [1, 0]; const right = cvJob(cv, cvBitOf, 'T')[0].text; carveRender(); const shown = document.querySelector('[data-cf="zero"]:checked').value;
    closeCarve(); return { corner, middle, mark0, mark1, note, farMiddle, tooWide, right, shown };`);
  const xs = t => readGcode(t).cuts.map(c => c.to.x), ys = t => readGcode(t).cuts.map(c => c.to.y), R = 3.175 / 2;
  assert.deepStrictEqual(readGcode(v.middle).problems, []);
  assert.ok(Math.abs(Math.min(...xs(v.corner)) - (120 + R)) < .02, "from the corner as before");
  assert.ok(Math.abs(Math.min(...xs(v.middle)) - (-30 + R)) < .02 && Math.abs(Math.max(...xs(v.middle)) - (30 - R)) < .02, "centred on the middle");
  assert.ok(Math.abs(Math.min(...ys(v.middle)) - (-20 + R)) < .02, "and in Y");
  assert.ok(Math.abs(Math.max(...xs(v.right)) - (-120 - R)) < .02, "from the front right corner, it's all to the left");
  assert.match(v.middle, /\(X0 Y0 = middle of board/); assert.match(v.corner, /\(X0 Y0 = front left of board/);
  assert.deepStrictEqual(v.mark0, ["0", "200"]); assert.deepStrictEqual(v.mark1, ["150", "100"], "the marker moves");
  assert.match(v.note, /move the bit to its middle, just touching the top/);
  assert.ok(!v.farMiddle.some(t => /further from the zero|well left|bigger than/.test(t)), "a middle zero isn't a travel problem");
  assert.ok(v.tooWide.some(t => /bigger than your machine can travel/.test(t)));
  assert.strictEqual(v.shown, "1,0"); assert.deepStrictEqual(app.errors, []);
});

test("an air test is the same job lifted clear of the board, saved from its own button", async () => {
  const v = await app.run(`${SETUP} await openCarve(); P.carve = cv; cvSel = null;
    add({ type: 'rect', w: 60, h: 40 }, { kind: 'pocket', depth: 3 }); add({ type: 'rect', w: 100, h: 60 }, { kind: 'outside', through: true, bit: 'flat-1-4' }); carveRender();
    await new Promise(r => setTimeout(r, 150));
    const real = cvJob(cv, cvBitOf, 'T').map(f => f.text), air = cvJob(cv, cvBitOf, 'T', 5).map(f => ({ name: f.name, text: f.text }));
    const saved = [], keep = downloadBlob; downloadBlob = name => saved.push(name);
    const btn = document.getElementById('cvAir'), icon = !!btn.querySelector('svg'), tip = btn.title, on = !btn.disabled;
    btn.click(); await new Promise(r => setTimeout(r, 300)); downloadBlob = keep;
    cv.items[0].op.depth = 40; carveRender(); await new Promise(r => setTimeout(r, 150)); const off = btn.disabled;
    closeCarve(); return { real, air, saved, icon, tip, on, off, name: P.name };`);
  assert.strictEqual(v.air.length, v.real.length);
  v.air.forEach((f, i) => {
    assert.match(f.name, / - AIR TEST\.nc$/); assert.match(f.text, /\(AIR TEST: everything is 23\.3 mm higher,\)/); assert.match(f.text, /lowest point is 5 mm above the board/);
    const g = readGcode(f.text), r = readGcode(v.real[i]); assert.deepStrictEqual(g.problems, []);
    assert.strictEqual(g.cuts.length, r.cuts.length);
    g.cuts.forEach((c, k) => { assert.strictEqual(c.to.x, r.cuts[k].to.x); assert.ok(Math.abs(c.to.z - (r.cuts[k].to.z + 23.3)) < 1e-9); });
    assert.ok(Math.min(...g.cuts.map(c => c.to.z)) >= 5 - 1e-9, "at least 5 above the board, even for a through-cut");
  });
  assert.ok(Math.abs(Math.min(...readGcode(v.air[v.air.length - 1].text).cuts.map(c => c.to.z)) - 5) < 1e-9, "the deepest cut comes to 5 above the board");
  assert.deepStrictEqual(v.saved, [v.name + " carve AIR TEST.zip"]);
  assert.ok(v.icon, "icon only"); assert.match(v.tip, /air test/i); assert.ok(v.on, "on for a good job"); assert.ok(v.off, "off when the job has a problem");
  assert.deepStrictEqual(app.errors, []);
});

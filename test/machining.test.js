"use strict";
const { test, before, after } = require("node:test");
const assert = require("node:assert");
const { openApp } = require("./harness");

let app;
before(async () => { app = await openApp(); });
after(async () => { if (app) await app.close(); });

// a world point for any hole, for comparing the two sides of a joint
const WORLD = `const worldOf_ = (it, o) => { const v = V3(o.x, o.y, o.z).applyQuaternion(Q(it)); return [v.x + it.pos[0], v.y + it.pos[1], v.z + it.pos[2]]; };`;

for (const style of ["confirmat", "dowel", "cam"]) {
  test(`${style} joints: holes on both panels line up and stay on the panels`, async () => {
    const v = await app.run(`${WORLD}
      loadProject(TEMPLATES[2].make()); edit(() => { P.joint = '${style}'; });
      const bad = [], { ops, fixings } = machining(); let joints = 0;
      ops.forEach((list, id) => { const it = byId(id); list.forEach(o => {
        if (o.k !== 'hole') return;
        if (Math.abs(o.x) > it.l / 2 + .01 || Math.abs(o.z) > it.w / 2 + .01 || Math.abs(o.y) > it.t / 2 + .01) bad.push('off panel ' + id);
        if (o.to && !o.why.includes('housing')) { joints++; const other = (ops.get(o.to) || []).filter(q => q.to === id), w = worldOf_(it, o); if (!other.some(q => Math.hypot(...worldOf_(byId(o.to), q).map((c, i) => c - w[i])) < .01) && style !== 'pocket' && !(style === 'cam' && false)) bad.push(o.why + ' on ' + id + ' has no partner on ' + o.to); }
      }); });
      return { bad, joints, fixings, hw: hardwareLines().find(l => l[0] === JOINTS[P.joint])?.[1] };`);
    assert.deepStrictEqual(v.bad, []);
    assert.ok(v.fixings > 0);
    assert.strictEqual(v.hw, v.fixings, "the shopping list count matches the holes");
  });
}

test("edge holes go straight into the panel's edge, and face holes into its face", async () => {
  const bad = await app.run(`
    loadProject(TEMPLATES[2].make()); edit(() => { P.joint = 'confirmat'; });
    const bad = []; machining().ops.forEach((list, id) => { const it = byId(id); list.forEach(o => {
      if (o.why !== 'Confirmat') return;
      if (o.d === mach('confFace') && !isFace(o.face)) bad.push('through hole not on a face: ' + id);
      if (o.d === mach('confEdge') && isFace(o.face)) bad.push('edge hole on a face: ' + id);
      if (o.face === 'c' && Math.abs(o.x + it.l / 2) > .01) bad.push('c edge ' + id);
      if (o.face === 'd' && Math.abs(o.x - it.l / 2) > .01) bad.push('d edge ' + id);
      if (o.face === 'a' && Math.abs(o.z + it.w / 2) > .01) bad.push('a edge ' + id);
      if (o.face === 'b' && Math.abs(o.z - it.w / 2) > .01) bad.push('b edge ' + id);
    }); });
    return bad;`);
  assert.deepStrictEqual(bad, []);
});

test("doors get hinge cups near the hinge edge, and plate screws in the panel they hang from", async () => {
  const v = await app.run(`
    loadProject(TEMPLATES[3].make());
    const doors = panelsOnly().filter(p => roleOf(p) === 'door'), out = [];
    doors.forEach(d => { const cups = opsOf(d).filter(o => o.why === 'Hinge cup'), dist = cups.map(o => Math.min(d.l / 2 - Math.abs(o.x), d.w / 2 - Math.abs(o.z))); out.push({ n: cups.length, want: d.hinges ?? defaultHinges(d), inset: dist, plates: [...machining().ops.entries()].filter(([, l]) => l.some(o => o.why === 'Hinge plate' && o.to === d.id)).map(([id]) => id), own: d.id }); });
    return { out, handleSides: doors.map(d => d.pos[0]), issues: machChecks() };`);
  assert.strictEqual(v.out.length, 2);
  v.out.forEach((d) => {
    assert.strictEqual(d.n, d.want);
    d.inset.forEach((i) => assert.ok(Math.abs(i - 22.5) < 0.01, "cup inset " + i));
    assert.strictEqual(d.plates.length, 1, "hangs from one panel");
    assert.notStrictEqual(d.plates[0], d.own);
  });
});

test("adjustable shelves get pin columns; slides get screws", async () => {
  const v = await app.run(`
    loadProject(TEMPLATES[2].make());
    const shelf = panelsOnly().find(p => p.name === 'Shelf');
    edit(() => { shelf.adjustable = true; });
    const pins = []; machining().ops.forEach((l, id) => l.forEach(o => { if (o.why === 'Shelf pin' && o.to === shelf.id) pins.push(id); }));
    const hosts = [...new Set(pins)].length, count = pins.length;
    loadProject(TEMPLATES[4].make());
    const screws = []; machining().ops.forEach((l, id) => l.forEach(o => { if (o.why === 'Slide screw') screws.push([id, o.to]); }));
    const fronts = panelsOnly().filter(p => roleOf(p) === 'drawer').length;
    return { hosts, count, rows: mach('pinRows'), screws: screws.length, fronts, perFront: new Set(screws.map(s => s[1])).size, notes: machining().notes };`);
  assert.strictEqual(v.hosts, 2, "columns on both sides");
  assert.strictEqual(v.count, 2 * 2 * v.rows);
  assert.strictEqual(v.perFront, v.fronts);
  assert.deepStrictEqual(v.notes, []);
});

test("holes follow a resized design", async () => {
  const v = await app.run(`
    loadProject(TEMPLATES[2].make());
    sel = P.items.filter(i => !isRoomPart(i)).map(i => i.id); edit(fxMakeResizable);
    const count = () => [...machining().ops.values()].flat().length, g = groupOf(selected()[0]), a = count();
    edit(() => { const p = g.params.find(p => p.name === 'Width'); p.e = (parseFloat(p.e) + 700) + 'mm'; });
    return { a, b: count() };`);
  assert.ok(v.b > v.a, `${v.b} > ${v.a}: a wider piece needs more fixings`);
});

test("a hole and groove added by hand stay put, and clashes are reported", async () => {
  const v = await app.run(`
    loadProject(TEMPLATES[0].make());
    edit(() => { addFromGallery('board:ply:18'); });
    const it = byId(sel[0]);
    edit(() => { it.ops = [{ k: 'hole', x: 100, z: 50, d: 20, depth: 10, face: 'top' }, { k: 'hole', x: 105, z: 50, d: 20, depth: 10, face: 'top' }, { k: 'groove', axis: 'l', x: 0, z: 20, width: 8, depth: 6, face: 'top' }]; });
    const ops = opsOf(it);
    return { x: ops[0].x + it.l / 2, z: ops[0].z + it.w / 2, groove: [ops[2].x0, ops[2].x1, it.l / 2], clash: checks().some(t => /run into each other/.test(t)) };`);
  assert.ok(Math.abs(v.x - 100) < .01 && Math.abs(v.z - 50) < .01);
  assert.ok(Math.abs(v.groove[0] + v.groove[2]) < .01 && Math.abs(v.groove[1] - v.groove[2]) < .01);
  assert.ok(v.clash);
});

test("saw width is a setting that changes the cutting plan", async () => {
  const v = await app.run(`
    loadProject(TEMPLATES[2].make());
    const gap = () => { const rows = cutRows(), [t, m] = stocks(rows)[0], ps = packSheets(rows, t, m).sheets[0].strips[0].parts; return ps.length > 1 ? ps[1].x - ps[0].x - ps[0].l : null; };
    const a = gap(); edit(() => { (P.mach = P.mach || {}).kerf = 10; }); const b = gap();
    return { a, b };`);
  if (v.a !== null) { assert.strictEqual(Math.round(v.a), 4); assert.strictEqual(Math.round(v.b), 10); }
});

// the G-code is read back by a small interpreter: everything must stay on the sheet, at safe depths
function readGcode(text) {
  const out = { x: [], y: [], minZ: 0, maxZ: -Infinity, tools: [], cuts: 0, feeds: new Set(), rapidsLow: 0 };
  let x = 0, y = 0, z = 0, cuttingNow = false;
  text.split(/\r?\n/).forEach((raw) => {
    const line = raw.replace(/\(.*?\)/g, "").trim(); if (!line) return;
    const w = {}; line.replace(/([A-Z])(-?[\d.]+)/g, (m, a, b) => { w[a] = +b; return m; });
    if (w.T != null) out.tools.push(w.T);
    if (w.F != null) out.feeds.add(w.F);
    if (w.G === 0 || w.G === 1 || w.G === 2 || w.G === 3) {
      const nx = w.X ?? x, ny = w.Y ?? y, nz = w.Z ?? z;
      if (w.G === 0 && nz <= 0 && z <= 0 && (nx !== x || ny !== y)) out.rapidsLow++;
      if (nz < 0 || w.G === 1) { out.x.push(nx); out.y.push(ny); }
      if (w.G === 2 && w.I != null) { out.x.push(nx + 2 * w.I); out.y.push(ny); }
      x = nx; y = ny; z = nz; out.minZ = Math.min(out.minZ, z); out.maxZ = Math.max(out.maxZ, z);
      if (w.G !== 0 && z < 0) out.cuts++;
    }
  });
  return out;
}

test("CNC: every sheet's G-code stays on the sheet, never rapids through the board, and cuts just deep enough", async () => {
  const v = await app.run(`
    loadProject(TEMPLATES[3].make());
    const job = cncJob(), sheets = stocks(cutRows()).map(([t, m]) => ({ t, ...stockOf(m) }));
    return { files: job.files.map(f => ({ name: f.name, text: f.text })), skipped: job.skipped, overs: job.overs, thick: sheets.map(s => s.t), sl: sheets[0].sl, sw: sheets[0].sw, cutter: cnc('cutter'), skin: cnc('skin') };`);
  const nc = v.files.filter((f) => f.name.endsWith(".nc"));
  assert.ok(nc.length > 0);
  assert.strictEqual(v.files.filter((f) => f.name.endsWith(".dxf")).length, nc.length);
  assert.deepStrictEqual(v.skipped, []);
  nc.forEach((f) => {
    const g = readGcode(f.text), R = v.cutter / 2;
    assert.strictEqual(g.rapidsLow, 0, f.name + " rapid move inside the board");
    assert.ok(g.cuts > 0, f.name + " cuts something");
    assert.ok(Math.min(...g.x) >= -R && Math.max(...g.x) <= v.sl + R, `${f.name} x ${Math.min(...g.x)}..${Math.max(...g.x)}`);
    assert.ok(Math.min(...g.y) >= -R && Math.max(...g.y) <= v.sw + R, `${f.name} y ${Math.min(...g.y)}..${Math.max(...g.y)}`);
    assert.ok(g.minZ >= -(Math.max(...v.thick) + 0.51), `${f.name} too deep: ${g.minZ}`);
    assert.ok(g.maxZ > 0, "lifts clear");
    assert.ok(g.tools.length >= 1);
    assert.ok(/M30\s*$/.test(f.text.trim()), "ends cleanly");
    ["G21", "G90"].forEach((c) => assert.ok(f.text.includes(c), c));
  });
});

test("CNC: parts on the sheet are far enough apart for the cutter", async () => {
  const v = await app.run(`
    loadProject(TEMPLATES[3].make());
    const rows = cutRows(), gap = cnc('cutter') + 2, bad = [];
    stocks(rows).forEach(([t, m]) => packSheets(rows, t, m, { gap, margin: cnc('margin') }).sheets.forEach(sh => { const ps = sh.strips.flatMap(s => s.parts); ps.forEach((a, i) => ps.slice(i + 1).forEach(b => { const dx = Math.max(a.x - b.x - b.l, b.x - a.x - a.l), dy = Math.max(a.y - b.y - b.w, b.y - a.y - a.w); if (Math.max(dx, dy) < cnc('cutter')) bad.push(a.id + ',' + b.id); })); }));
    return bad;`);
  assert.deepStrictEqual(v, []);
});

test("CNC: the part stays the right way round: a hole in one corner ends up where it should", async () => {
  const v = await app.run(`
    loadProject(TEMPLATES[0].make());
    edit(() => { addFromGallery('board:ply:18'); });
    const it = byId(sel[0]); edit(() => { it.l = 800; it.w = 400; it.ops = [{ k: 'hole', x: 50, z: 30, d: 8, depth: 10, face: 'top' }]; });
    const res = [];
    for (const q of [{ l: 800, w: 400, x: 0, y: 0 }, { l: 400, w: 800, x: 0, y: 0 }]) {
      const lay = partLayout(it, q, 0, 0), h = lay.map([opsOf(it)[0].x, opsOf(it)[0].z]), a = lay.map([-it.l / 2, -it.w / 2]), bx = lay.map([it.l / 2, -it.w / 2]), by = lay.map([-it.l / 2, it.w / 2]);
      const cross = (bx[0] - a[0]) * (by[1] - a[1]) - (bx[1] - a[1]) * (by[0] - a[0]);
      res.push({ up: lay.up, fromCorner: Math.hypot(h[0] - a[0], h[1] - a[1]), cross, onSheet: [h[0] >= 0, h[1] >= 0, h[0] <= q.l, h[1] <= q.w] });
    }
    return res;`);
  v.forEach((r) => {
    assert.ok(Math.abs(r.fromCorner - Math.hypot(50, 30)) < 0.01);
    assert.ok(r.up);
    assert.ok(r.cross < 0, "looking at the +Y face: x then z turns clockwise");
    assert.ok(r.onSheet.every(Boolean));
  });
});

test("DXF names each job by its layer", async () => {
  const v = await app.run(`
    loadProject(TEMPLATES[3].make());
    const d = dxfText(), layers = [...d.matchAll(/\\r\\n8\\r\\n([A-Z0-9_]+)/g)].map(m => m[1]);
    return [...new Set(layers)];`);
  assert.ok(v.some((l) => /^CUT_/.test(l)));
  assert.ok(v.some((l) => /DRILL_D35/.test(l)), "hinge cups: " + v.join(" "));
  assert.ok(v.some((l) => /^EDGE_/.test(l)), "edge holes: " + v.join(" "));
});

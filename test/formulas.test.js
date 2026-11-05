"use strict";
const { test, before, after } = require("node:test");
const assert = require("node:assert");
const { openApp } = require("./harness");

let app;
before(async () => { app = await openApp(); });
after(async () => { if (app) await app.close(); });
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.01, `${msg || ""} ${a} vs ${b}`);

test("formulas: plain numbers follow the unit, multipliers stay multipliers", async () => {
  const v = await app.run(`
    loadProject(TEMPLATES[0].make());
    const look = { name: n => ({ width: { v: 1000, d: true }, count: { v: 3, d: false } })[n.toLowerCase()], ref: () => 0 }, ev = (e, u = 'in') => fxLenOf(fxEval(e, u, look), u);
    return [ev('Width - 2'), ev('2 * Width'), ev('Width / 2'), ev('Width / Count'), ev('(Width - 1") / 2'), ev('Width - 18mm', 'in'), ev("5' 3 1/2\\""), ev('3/4"'), ev('12'), ev('12', 'mm'), ev('round(Width/3, 1")'), ev('max(Width, 2000mm)'), ev('Width - 2', 'mm')];`);
  const want = [1000 - 50.8, 2000, 500, 1000 / 3, (1000 - 25.4) / 2, 982, 1612.9, 19.05, 304.8, 12, 330.2, 2000, 998];
  v.forEach((x, i) => near(x, want[i], "case " + i));
});

test("formulas: mistakes are reported, not guessed", async () => {
  const v = await app.run(`
    const bad = []; for (const e of ['Nope + 1', 'Width *', '(Width', 'Width * Width', '1 / 0', 'alert(1)', 'Width; 2', '']) { const look = { name: n => { if (n.toLowerCase() === 'width') return { v: 1, d: true }; throw new Error('no ' + n); }, ref: () => 0 }; try { fxEval(e, 'mm', look); bad.push(e + ' passed'); } catch (err) {} }
    return bad;`);
  assert.deepStrictEqual(v, []);
});

test("parameters drive sizes, and a value changed by hand stops following", async () => {
  const v = await app.run(`
    loadProject(TEMPLATES[0].make());
    edit(() => { addFromGallery('board:ply:18'); });
    const it = byId(sel[0]); const out = {};
    edit(() => { P.params = [{ name: 'Span', e: '1000mm', u: 'mm' }]; it.fx = { l: { e: 'Span - 100mm', u: 'mm' } }; });
    out.a = it.l;
    edit(() => { P.params[0].e = '2000mm'; }); out.b = it.l;
    undo(); out.undone = byId(it.id).l;
    redo(); const it2 = byId(it.id); out.redone = it2.l;
    edit(() => { it2.l = 555; }); out.manual = it2.l; out.fxGone = !it2.fx || !it2.fx.l;
    edit(() => { P.params[0].e = '3000mm'; }); out.stays = it2.l;
    return out;`);
  near(v.a, 900); near(v.b, 1900); near(v.undone, 900); near(v.redone, 1900); near(v.manual, 555); assert.ok(v.fxGone); near(v.stays, 555);
});

test("parameters can depend on each other, and circles are caught", async () => {
  const v = await app.run(`
    loadProject(TEMPLATES[0].make());
    edit(() => { addFromGallery('board:ply:18'); });
    const it = byId(sel[0]);
    edit(() => { P.params = [{ name: 'A', e: '500mm', u: 'mm' }, { name: 'B', e: 'A * 2', u: 'mm' }]; it.fx = { w: { e: 'B', u: 'mm' } }; });
    const w = it.w;
    edit(() => { P.params[0].e = 'B'; });
    const issues = [...fxIssues.values()];
    return { w, circle: issues.some(t => /itself/.test(t)), inChecks: checks().some(t => /itself/.test(t)) };`);
  near(v.w, 1000); assert.ok(v.circle); assert.ok(v.inChecks);
});

// every starting piece: resize it and check nothing opens up or runs into anything
for (const [name, idx] of [["Bookshelf", 2], ["Cupboard", 3], ["Chest of drawers", 4], ["Desk", 5], ["TV unit", 7], ["Table", 6]]) {
  test(`Make resizable keeps ${name} together when it changes size`, async () => {
    const v = await app.run(`
      loadProject(TEMPLATES[${idx}].make());
      const parts = P.items.filter(i => !isRoomPart(i));
      const touching = () => { const out = []; const list = panelsOnly(); for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) { const a = bounds(list[i]), b = bounds(list[j]); for (let k = 0; k < 3; k++) { if (Math.abs(a.max[k] - b.min[k]) > .6 && Math.abs(b.max[k] - a.min[k]) > .6) continue; if ([0, 1, 2].filter(x => x !== k).every(x => Math.min(a.max[x], b.max[x]) - Math.max(a.min[x], b.min[x]) > 2)) out.push(list[i].id + '-' + list[j].id + ':' + k); } } return out; };
      const overlaps = () => checks().filter(t => /overlap/.test(t));
      sel = parts.map(i => i.id);
      const flat = l => l.flatMap(i => [i.id, i.l, i.t, i.w, ...i.pos]), before = flat(parts), touch0 = touching(), lap0 = overlaps(), u0 = unionBounds(parts);
      edit(fxMakeResizable);
      const after = flat(P.items.filter(i => !isRoomPart(i))), most = Math.max(...after.map((n, i) => Math.abs(n - before[i])));
      const g = groupOf(byId(parts[0].id));
      const setP = (n, mm) => { g.params.find(p => p.name === n).e = mm + 'mm'; };
      const results = [];
      for (const [dw, dh, dd] of [[300, 0, 0], [0, 250, 0], [0, 0, 120], [240, 180, 90], [-100, -60, -40]]) {
        edit(() => { setP('Width', u0.max[0] - u0.min[0] + dw); setP('Height', u0.max[1] - u0.min[1] + dh); setP('Depth', u0.max[2] - u0.min[2] + dd); });
        const list = P.items.filter(i => !isRoomPart(i)), panels = list.filter(i => i.kind === 'panel'), u = unionBounds(panels);
        const t = touching();
        results.push({ dw, dh, dd, size: [u.max[0] - u.min[0], u.max[1] - u.min[1], u.max[2] - u.min[2]], lost: touch0.filter(x => !t.includes(x)), laps: overlaps().filter(x => !lap0.includes(x)), issues: [...fxIssues.values()] });
      }
      return { same: most < .01, most, results, u0: [u0.max[0] - u0.min[0], u0.max[1] - u0.min[1], u0.max[2] - u0.min[2]], hasFx: panelsOnly().filter(i => i.fx).length, touch0: touch0.length };`);
    assert.ok(v.same, "making it resizable moved something by " + v.most);
    assert.ok(v.hasFx > 0);
    for (const r of v.results) {
      assert.deepStrictEqual(r.issues, [], "formula problems");
      assert.deepStrictEqual(r.laps, [], `new overlaps at ${r.dw},${r.dh},${r.dd}`);
      assert.deepStrictEqual(r.lost, [], `joints opened at ${r.dw},${r.dh},${r.dd}`);
    }
  });
}

test("a resized design's cut list follows", async () => {
  const v = await app.run(`
    loadProject(TEMPLATES[2].make());
    sel = P.items.filter(i => !isRoomPart(i)).map(i => i.id); edit(fxMakeResizable);
    const g = groupOf(selected()[0]), top = () => cutRows().find(r => r.part === 'Top').len, a = top();
    edit(() => { const p = g.params.find(p => p.name === 'Width'); p.e = (parseFloat(p.e) + 200) + 'mm'; });
    return [a, top()];`);
  near(v[1] - v[0], 200);
});

test("moving a whole resizable layer keeps it resizable", async () => {
  const v = await app.run(`
    loadProject(TEMPLATES[2].make());
    const list = P.items.filter(i => !isRoomPart(i)); sel = list.map(i => i.id); edit(fxMakeResizable);
    const was = unionBounds(selected()).min[0];
    edit(() => { movable().forEach(i => { i.pos[0] += 500; }); });
    const moved = unionBounds(selected()).min[0], stillFx = selected().filter(i => i.fx && i.fx.x).length;
    const g = groupOf(selected()[0]); edit(() => { const p = g.params.find(p => p.name === 'Width'); p.e = (parseFloat(p.e) + 100) + 'mm'; });
    const u = unionBounds(selected());
    return { d: moved - was, stillFx, n: list.length, minAfter: u.min[0] - moved };`);
  near(v.d, 500); assert.strictEqual(v.stillFx, v.n); near(v.minAfter, 0);
});

test("moving one part alone frees only that part", async () => {
  const v = await app.run(`
    loadProject(TEMPLATES[2].make());
    const list = P.items.filter(i => !isRoomPart(i)); sel = list.map(i => i.id); edit(fxMakeResizable);
    const one = list[1], at = one.pos[0]; edit(() => { one.pos[0] += 77; });
    return { d: one.pos[0] - at, gone: !one.fx.x, others: list.filter(i => i !== one && i.fx && i.fx.x).length, n: list.length };`);
  near(v.d, 77); assert.ok(v.gone); assert.strictEqual(v.others, v.n - 1);
});

test("copies of a resizable layer have their own size", async () => {
  const v = await app.run(`
    loadProject(TEMPLATES[2].make());
    const list = P.items.filter(i => !isRoomPart(i)); sel = list.map(i => i.id); edit(fxMakeResizable);
    const g = groupOf(selected()[0]), w0 = unionBounds(list).max[0] - unionBounds(list).min[0];
    edit(duplicateSel);
    const copies = selected(), g2 = groupOf(copies[0]), distinct = g2.id !== g.id;
    edit(() => { const p = g2.params.find(p => p.name === 'Width'); p.e = (parseFloat(p.e) + 300) + 'mm'; });
    const size = l => { const u = unionBounds(l); return u.max[0] - u.min[0]; }, orig = P.items.filter(i => i.group === g.id);
    return { distinct, w0, orig: size(orig), copy: size(copies), apart: unionBounds(copies).min[0] >= unionBounds(orig).max[0] };`);
  assert.ok(v.distinct); near(v.orig, v.w0); near(v.copy, v.w0 + 300); assert.ok(v.apart);
});

test("a resizable design saved to the library stays resizable when placed", async () => {
  const v = await app.run(`
    loadProject(TEMPLATES[2].make());
    const list = P.items.filter(i => !isRoomPart(i)); sel = list.map(i => i.id); edit(fxMakeResizable);
    libAdd('Resizable shelf'); const e = LIB.items.at(-1), w0 = e.size[0];
    loadProject(TEMPLATES[0].make());
    edit(() => addFromGallery('lib:' + e.id, { x: 1500, y: 0, z: 500 }));
    const a = selected(); const g = groupOf(a[0]);
    edit(() => addFromGallery('lib:' + e.id, { x: 3500, y: 0, z: 500 }));
    const b = selected(), g2 = groupOf(b[0]);
    const u0 = unionBounds(a), centre = (u0.min[0] + u0.max[0]) / 2;
    edit(() => { const p = g.params.find(p => p.name === 'Width'); p.e = (parseFloat(p.e) + 400) + 'mm'; });
    const s = l => { const u = unionBounds(l); return u.max[0] - u.min[0]; };
    LIB.items = LIB.items.filter(x => x !== e); libSave();
    return { hasLayer: !!e.layer, centre, sa: s(a), sb: s(b), w0, two: g.id !== g2.id };`);
  assert.ok(v.hasLayer); near(v.centre, 1500); near(v.sa, v.w0 + 400); near(v.sb, v.w0); assert.ok(v.two);
});

test("formula boxes: typing =expr keeps it, a plain number replaces it", async () => {
  const v = await app.run(`
    loadProject(TEMPLATES[0].make()); P.unit = 'mm';
    edit(() => { addFromGallery('board:ply:18'); });
    const it = byId(sel[0]); edit(() => { P.params = [{ name: 'Span', e: '1000mm', u: 'mm' }]; });
    setTab('props'); render();
    const box = () => document.querySelector('[data-f="sl"]');
    const type = t => { const b = box(); b.focus(); b.value = t; b.dispatchEvent(new Event('change')); };
    type('=Span - 50'); const a = [it.l, !!it.fx.l];
    const shows = box().value, el = box(); el.dispatchEvent(new Event('focus')); const editing = el.value; el.dispatchEvent(new Event('blur')); const after = el.value;
    type('800-36'); const b = [it.l, !!(it.fx && it.fx.l)];
    return { a, shows, editing, after, b };`);
  near(v.a[0], 950); assert.ok(v.a[1]); assert.strictEqual(v.shows, "950"); assert.strictEqual(v.editing, "=Span - 50"); assert.strictEqual(v.after, "950");
  near(v.b[0], 764); assert.ok(!v.b[1]);
});

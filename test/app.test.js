"use strict";
const { test, before, after } = require("node:test");
const assert = require("node:assert");
const { openApp } = require("./harness");

let app;
before(async () => { app = await openApp(); });
after(async () => { if (app) await app.close(); });

test("starts with no script errors", async () => {
  assert.deepStrictEqual(app.errors, []);
  assert.ok(await app.run("return P.items.length > 0"));
});

test("every starting piece builds, draws and gives a cut list", async () => {
  const out = await app.run(`
    const res = [];
    for (const t of TEMPLATES) { loadProject(t.make()); render(); draw3D(); res.push([t.name, P.items.length, cutRows().length]); }
    return res;`);
  assert.strictEqual(out.length, 9);
  out.filter((r) => r[0] !== "Blank").forEach((r) => assert.ok(r[2] > 0, r[0] + " has no cut list"));
  assert.deepStrictEqual(app.errors, []);
});

test("sizes parse in every unit", async () => {
  const v = await app.run(`
    loadProject(TEMPLATES[0].make()); P.unit = 'mm';
    return [parseLen('120cm'), parseLen("5' 3 1/2\\""), parseLen('6"'), parseLen('2 m'), parseLen('18')];`);
  assert.deepStrictEqual(v.map((n) => Math.round(n * 10) / 10), [1200, 1612.9, 152.4, 2000, 18]);
});

test("edits can be undone and redone", async () => {
  const v = await app.run(`
    loadProject(TEMPLATES[2].make());
    const it = panelsOnly()[0], was = it.l;
    edit(() => { byId(it.id).l = was + 100; }); const a = byId(it.id).l;
    undo(); const b = byId(it.id).l; redo(); const c = byId(it.id).l;
    return [a - was, b - was, c - was];`);
  assert.deepStrictEqual(v, [100, 0, 100]);
});

test("the cutting plan places every part without overlap, on the sheet", async () => {
  const bad = await app.run(`
    loadProject(TEMPLATES[3].make());
    const rows = cutRows(), bad = [];
    stocks(rows).forEach(([t, m]) => {
      const { sl, sw } = stockOf(m), { sheets } = packSheets(rows, t, m);
      sheets.forEach(sh => { const ps = sh.strips.flatMap(s => s.parts);
        ps.forEach((a, i) => { if (a.x < 0 || a.y < 0 || a.x + a.l > sl + .01 || a.y + a.w > sw + .01) bad.push('off sheet ' + a.id);
          ps.slice(i + 1).forEach(b => { if (a.x < b.x + b.l - .01 && b.x < a.x + a.l - .01 && a.y < b.y + b.w - .01 && b.y < a.y + a.w - .01) bad.push(a.id + ' overlaps ' + b.id); }); }); });
    });
    return bad;`);
  assert.deepStrictEqual(bad, []);
});

test("a project survives saving to .atlr and opening again", async () => {
  const v = await app.run(`
    loadProject(TEMPLATES[3].make()); const name = P.name, n = P.items.length, json = JSON.stringify(P.items);
    const bytes = await atelierBytes();
    loadProject(TEMPLATES[0].make());
    await openBytes(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    return [P.name === name, P.items.length === n, JSON.stringify(P.items) === json];`);
  assert.deepStrictEqual(v, [true, true, true]);
});

test("exports produce files", async () => {
  const v = await app.run(`
    loadProject(TEMPLATES[2].make());
    const d = dxfText();
    return [d.includes('SECTION') && d.trim().endsWith('EOF'), stlBytes().byteLength > 84];`);
  assert.deepStrictEqual(v, [true, true]);
});

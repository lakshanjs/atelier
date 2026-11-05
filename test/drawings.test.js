"use strict";
const { test, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const { openApp } = require("./harness");

let app;
before(async () => { app = await openApp(); });
after(async () => { if (app) await app.close(); });

const OUT = process.env.ATELIER_TEST_OUT;   // set to keep the PDFs and screenshots for looking at

// reads a PDF's page sizes without any library: Chromium writes /MediaBox in plain text
function pdfPages(buf) {
  const t = Buffer.from(buf).toString("latin1");
  return [...t.matchAll(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/g)].map((m) => [+m[1], +m[2]]);
}
const PT = 72 / 25.4;

for (const paper of ["A3", "A4"]) {
  for (const [name, idx] of [["Bookshelf", 2], ["Cupboard", 3], ["Chest of drawers", 4], ["Corner rack", 1]]) {
    test(`${paper} drawings of ${name}: complete, readable, nothing off the page`, async () => {
      const v = await app.run(`
        loadProject(TEMPLATES[${idx}].make()); edit(() => { (P.drawing = P.drawing || {}).paper = '${paper}'; });
        const pages = buildDrawings(), parser = new DOMParser(), out = [];
        document.getElementById('drawBody').innerHTML = pages.map(p => p.svg).join('');
        document.getElementById('draw').classList.add('open');
        await document.fonts.ready;
        const ids = new Set();
        for (const p of document.querySelectorAll('#drawBody svg.dpage')) {
          const vb = p.viewBox.baseVal, m = p.getScreenCTM().inverse(), off = [];
          p.querySelectorAll('text, rect, line, circle, polygon, path').forEach(el => {
            if (el.closest('defs') || el.closest('pattern')) return;
            const r = el.getBoundingClientRect(); if (!r.width && !r.height) return;
            const a = new DOMPoint(r.left, r.top).matrixTransform(m), b = new DOMPoint(r.right, r.bottom).matrixTransform(m);
            if (a.x < -.5 || a.y < -.5 || b.x > vb.width + .5 || b.y > vb.height + .5) off.push(el.tagName + ':' + (el.textContent || '').slice(0, 30));
          });
          out.push({ w: vb.width, h: vb.height, off: off.slice(0, 6), nan: /NaN|undefined|Infinity/.test(p.outerHTML.replace(/href="[^"]*"/g, '')), parseOk: !parser.parseFromString(p.outerHTML, 'image/svg+xml').querySelector('parsererror'), texts: p.querySelectorAll('text').length });
          p.querySelectorAll('text').forEach(t => { const m2 = /^(?:No\\.|Nos\\.) ([\\d, ]+):/.exec(t.textContent); if (m2) m2[1].split(',').forEach(n => ids.add(+n)); });
        }
        document.getElementById('draw').classList.remove('open');
        return { titles: pages.map(p => p.title), pages: out, drawn: [...ids].sort((a, b) => a - b), panels: drawParts().map(p => p.id).sort((a, b) => a - b) };`);
      const [W, H] = paper === "A3" ? [420, 297] : [297, 210];
      assert.deepStrictEqual(v.titles.slice(0, 3), ["General arrangement", "Sections", "Exploded view and parts"]);
      assert.ok(v.titles.length >= 4);
      v.pages.forEach((p, i) => {
        assert.deepStrictEqual([p.w, p.h], [W, H]);
        assert.ok(p.parseOk, "sheet " + (i + 1) + " is valid SVG");
        assert.ok(!p.nan, "sheet " + (i + 1) + " has a bad number");
        assert.deepStrictEqual(p.off, [], "sheet " + (i + 1) + " runs off the page");
      });
      assert.deepStrictEqual(v.drawn, v.panels, "every panel has a part drawing");
    });
  }

  test(`${paper} PDF has one correct-sized page per sheet`, async () => {
    const v = await app.run(`
      loadProject(TEMPLATES[3].make()); edit(() => { (P.drawing = P.drawing || {}).paper = '${paper}'; });
      openDrawings(); await document.fonts.ready; await new Promise(r => setTimeout(r, 200));
      const n = document.querySelectorAll('#drawBody svg.dpage').length, bytes = await window.atelierWin.printPdf();
      closeDrawings();
      return { n, data: Array.from(new Uint8Array(bytes)) };`);
    const pages = pdfPages(v.data), [W, H] = paper === "A3" ? [420, 297] : [297, 210];
    assert.strictEqual(pages.length, v.n);
    pages.forEach((p) => { assert.ok(Math.abs(p[0] - W * PT) < 2 && Math.abs(p[1] - H * PT) < 2, `page is ${p}`); });
    if (OUT) fs.writeFileSync(`${OUT}/cupboard-${paper}.pdf`, Buffer.from(v.data));
  });
}

test("the paper choice is kept with the project and the cut list still prints normally", async () => {
  const v = await app.run(`
    loadProject(TEMPLATES[2].make()); (P.drawing = P.drawing || {}).paper = 'A4';
    const bytes = await atelierBytes(); loadProject(TEMPLATES[0].make());
    await openBytes(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    const kept = paperOf();
    openDrawings(); const during = !!document.getElementById('drawPageStyle'), box = document.getElementById('dr_paper').value; closeDrawings();
    return { kept, during, box, after: !!document.getElementById('drawPageStyle') };`);
  assert.strictEqual(v.kept, "A4");
  assert.strictEqual(v.box, "A4");
  assert.ok(v.during);
  assert.ok(!v.after, "the size rule is gone once the drawings close");
});

test("drawings follow a resized design", async () => {
  const v = await app.run(`
    loadProject(TEMPLATES[2].make());
    sel = P.items.filter(i => !isRoomPart(i)).map(i => i.id); edit(fxMakeResizable);
    const g = groupOf(selected()[0]), has = t => buildDrawings().some(p => p.svg.includes('>' + t + '<'));
    const before = fmt(unionBounds(panelsOnly()).max[0] - unionBounds(panelsOnly()).min[0]);
    edit(() => { const p = g.params.find(p => p.name === 'Width'); p.e = (parseFloat(p.e) + 254) + 'mm'; });
    const after = fmt(unionBounds(panelsOnly()).max[0] - unionBounds(panelsOnly()).min[0]);
    return { before, after, oldThere: has(esc(before)), newThere: has(esc(after)) };`);
  assert.notStrictEqual(v.before, v.after);
  assert.ok(v.newThere, "new width " + v.after);
  assert.ok(!v.oldThere, "old width gone");
});

"use strict";
const { test, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { openApp, sleep } = require("./harness");

let app;
before(async () => { app = await openApp(); });
after(async () => { if (app) await app.close(); });

test("a chosen hinge sets the holes in the door and the panel it hangs from", async () => {
  const v = await app.run(`
    loadProject(TEMPLATES[3].make());
    HW = HW.filter(e => e.id !== 'test-hinge');
    HW.push({ ...HW_START[0], id: 'test-hinge', name: 'Test hinge', cupD: 26, cupDepth: 11, cupInset: 20, cupScrewD: 2.5, plateD: 4, plateFrom: 50, platePitch: 40, ends: 80 });
    const door = panelsOnly().find(p => roleOf(p) === 'door');
    const before = opsOf(door).filter(o => o.why === 'Hinge cup')[0].d;
    edit(() => { door.hingeType = 'test-hinge'; });
    const cups = opsOf(door).filter(o => o.why === 'Hinge cup'), screws = opsOf(door).filter(o => o.why === 'Hinge cup screw');
    let plates = []; machining().ops.forEach(l => l.forEach(o => { if (o.why === 'Hinge plate' && o.to === door.id) plates.push(o); }));
    const edge = cups.map(o => Math.min(door.l / 2 - Math.abs(o.x), door.w / 2 - Math.abs(o.z)));
    const fromEnd = Math.min(...cups.map(o => Math.max(door.l / 2 - Math.abs(o.x), door.w / 2 - Math.abs(o.z))));
    const lines = hardwareLines().map(l => [l[0], l[1]]);
    return { before, d: cups[0].d, depth: cups[0].depth, edge, screws: screws.length, cupCount: cups.length, plateD: plates[0].d, plates: plates.length, lines, fromEnd };`);
  assert.strictEqual(v.before, 35);
  assert.strictEqual(v.d, 26);
  assert.strictEqual(v.depth, 11);
  v.edge.forEach((e) => assert.ok(Math.abs(e - 20) < .01));
  assert.strictEqual(v.screws, v.cupCount * 2);
  assert.strictEqual(v.plateD, 4);
  assert.strictEqual(v.plates, v.cupCount * 2);
  assert.ok(Math.abs(v.fromEnd - 80) < .01, "first hinge " + v.fromEnd);
  assert.ok(v.lines.some((l) => l[0] === "Test hinge" && l[1] === v.cupCount), JSON.stringify(v.lines));
  assert.ok(v.lines.some((l) => l[0] === "Hinge, 35 mm cup"), "the other door keeps the default");
});

test("slides: picks the longest length that fits, drills both the cabinet and the box", async () => {
  const v = await app.run(`
    loadProject(TEMPLATES[4].make());
    const front = panelsOnly().find(p => roleOf(p) === 'drawer'), box = drawerBoxSides(front), len = Math.max(box[0].l, box[0].w), sold = hwFor(front, 'slide').lengths;
    const L = slideLength(front), cab = [], onBox = [];
    machining().ops.forEach((l, id) => l.forEach(o => { if (o.why === 'Slide screw' && o.to === front.id) (box.some(b => b.id === id) ? onBox : cab).push([id, o.face]); }));
    const lines = hardwareLines().map(l => l[0]);
    return { len, L, sold, boxes: box.length, cab: cab.length, onBox: onBox.length, boxSides: new Set(onBox.map(o => o[0])).size, cabSides: new Set(cab.map(o => o[0])).size, lines, notes: machining().notes };`);
  assert.strictEqual(v.boxes, 2);
  assert.strictEqual(v.L, v.sold.filter((s) => s <= v.len + .5).pop());
  assert.strictEqual(v.cabSides, 2);
  assert.strictEqual(v.boxSides, 2);
  assert.ok(v.cab > 0 && v.onBox > 0);
  assert.ok(v.lines.some((l) => l.startsWith("Side-mount slide, ")), v.lines.join("; "));
  assert.deepStrictEqual(v.notes, [], "the starting pieces' boxes fit the slide's gap");
});

test("the wrong gap for a slide is reported", async () => {
  const v = await app.run(`
    loadProject(TEMPLATES[4].make());
    const front = panelsOnly().find(p => roleOf(p) === 'drawer');
    const id = 'wide-slide'; HW = HW.filter(e => e.id !== id); HW.push({ ...HW_START[2], id, name: 'Wide slide', clearance: 25 });
    edit(() => { front.slideType = id; });
    return checks().filter(t => /leaves/.test(t));`);
  assert.ok(v.length > 0);
  assert.match(v[0], /needs/);
});

test("catalogue prices reach the shopping list and total; a project's own price wins", async () => {
  const v = await app.run(`
    loadProject(TEMPLATES[3].make());
    HW.find(e => e.id === 'hinge-35').price = 150;
    persist();
    const n = hardwareLines().find(l => l[0] === 'Hinge, 35 mm cup')[1], a = hwCost(), total = totalCost();
    edit(() => { P.hwPrices = { 'Hinge, 35 mm cup': 200 }; });
    const b = hwCost();
    renderPack(); const inPlan = document.getElementById('packBody').textContent.includes('Hinge, 35 mm cup');
    HW.find(e => e.id === 'hinge-35').price = 0;
    return { n, a, b, total, inPlan };`);
  assert.strictEqual(v.a, v.n * 150);
  assert.strictEqual(v.b, v.n * 200);
  assert.ok(v.total >= v.a);
  assert.ok(v.inPlan);
});

test("the catalogue window edits, adds, copies and deletes", async () => {
  const v = await app.run(`
    loadProject(TEMPLATES[3].make());
    const start = HW.length;
    openCatalogue();
    document.querySelector('[data-hwadd="hinge"]').click();
    const added = HW.at(-1), box = k => document.querySelector('[data-hw="' + added.id + '"][data-key="' + k + '"]');
    const set = (k, t) => { const b = box(k); b.value = t; b.dispatchEvent(new Event('change', { bubbles: true })); };
    set('cupD', '40'); set('name', 'Big hinge'); set('cupDepth', 'nonsense');
    const afterBad = added.cupDepth;
    document.querySelector('[data-hwcopy="' + added.id + '"]').click();
    const copied = HW.at(-1).name, count = HW.length;
    document.querySelector('[data-hwdel="' + HW.at(-1).id + '"]').click();
    document.querySelector('[data-hwdel="' + added.id + '"]').click();
    const sl = HW.find(e => e.id === 'slide-side'); openCatalogue();
    const listBox = document.querySelector('[data-hw="slide-side"][data-key="holes"]'), was = listBox.value; listBox.value = '100, 37, 200'; listBox.dispatchEvent(new Event('change', { bubbles: true })); const list = sl.holes.slice();
    listBox.value = was; listBox.dispatchEvent(new Event('change', { bubbles: true }));
    document.getElementById('hwDlg').close();
    return { start, cupD: added.cupD, name: added.name, afterBad, copied, count, end: HW.length, list };`);
  assert.strictEqual(v.cupD, 40);
  assert.strictEqual(v.name, "Big hinge");
  assert.strictEqual(v.afterBad, 12.5, "bad typing is refused");
  assert.strictEqual(v.copied, "Big hinge copy");
  assert.strictEqual(v.count, v.start + 2);
  assert.strictEqual(v.end, v.start);
  assert.deepStrictEqual(v.list, [37, 100, 200]);
});

test("the last hinge can't be deleted", async () => {
  const v = await app.run(`
    const keep = HW; HW = HW.filter(e => e.kind !== 'hinge').concat(HW.find(e => e.kind === 'hinge'));
    openCatalogue(); document.querySelector('[data-hwdel="' + hwOfKind('hinge')[0].id + '"]').click();
    const left = hwOfKind('hinge').length; document.getElementById('hwDlg').close(); HW = keep; return left;`);
  assert.strictEqual(v, 1);
});

test("the catalogue stays between runs, and a project brings its hardware to another computer", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atelier-hw-")), one = await openApp({ userData: dir });
  const bytes = await one.run(`
    HW.push({ ...HW_START[0], id: 'kept', name: 'Kept hinge', cupD: 30 }); hwSave();
    loadProject(TEMPLATES[3].make());
    const door = panelsOnly().find(p => roleOf(p) === 'door'); edit(() => { door.hingeType = 'kept'; });
    await new Promise(r => setTimeout(r, 300));
    const b = await atelierBytes(); return Array.from(b);`);
  await one.reload(); await sleep(300);
  assert.ok(await one.run(`return HW.some(e => e.id === 'kept')`), "kept after a restart");
  await one.close();

  const other = await openApp();
  const v = await other.run(`
    const had = HW.some(e => e.id === 'kept'), b = new Uint8Array(${JSON.stringify(bytes)});
    await openBytes(b.buffer);
    const door = panelsOnly().find(p => p.hingeType === 'kept');
    return { had, cup: opsOf(door).find(o => o.why === 'Hinge cup').d, inCatalogue: HW.some(e => e.id === 'kept') };`);
  assert.strictEqual(v.had, false);
  assert.strictEqual(v.cup, 30);
  assert.ok(v.inCatalogue);
  await other.close();
});

test("a deleted entry a project still uses keeps working from the project's copy", async () => {
  const v = await app.run(`
    HW = HW.filter(e => e.id !== 'gone'); HW.push({ ...HW_START[0], id: 'gone', name: 'Gone hinge', cupD: 28 });
    loadProject(TEMPLATES[3].make()); const door = panelsOnly().find(p => roleOf(p) === 'door');
    edit(() => { door.hingeType = 'gone'; });
    HW = HW.filter(e => e.id !== 'gone'); persist();
    return opsOf(door).find(o => o.why === 'Hinge cup').d;`);
  assert.strictEqual(v, 28);
});

test("Properties offers the choices", async () => {
  const v = await app.run(`
    loadProject(TEMPLATES[4].make()); setTab('props');
    const front = panelsOnly().find(p => roleOf(p) === 'drawer'); sel = [front.id]; openSec.fit = true; render();
    const s = document.querySelector('#hwSlide'), opts = [...s.options].map(o => o.textContent);
    s.value = 'slide-side-soft'; s.dispatchEvent(new Event('change'));
    const chosen = byId(front.id).slideType, line = hardwareLines().some(l => l[0].startsWith('Soft-close side-mount slide'));
    sel = []; render();
    return { opts, chosen, line, project: !!document.querySelector('#hwDefHinge') && !!document.querySelector('#hwDefSlide'), btn: !!document.querySelector('[data-hwcat]') };`);
  assert.ok(v.opts.length >= 3);
  assert.strictEqual(v.chosen, "slide-side-soft");
  assert.ok(v.line);
  assert.ok(v.project && v.btn);
});

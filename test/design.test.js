"use strict";
const { test, before, after } = require("node:test");
const assert = require("node:assert");
const { openApp } = require("./harness");

let app;
before(async () => { app = await openApp(); });
after(async () => { if (app) await app.close(); });

// three layers of two panels each, side by side
const SETUP = `
  loadProject(newDesign(TEMPLATES[0].make)); document.querySelectorAll('dialog[open]').forEach(d => d.close()); P.items = P.items.filter(i => isRoomPart(i));
  const mk = (name, x, y = 0) => { const it = panelBox(name, [x, x + 300, y, y + 18, 0, 200]); it.id = nextId(); P.items.push(it); return it; };
  const layer = (name, list) => { const g = { id: nextId(), name, hidden: false, open: true }; P.groups.push(g); list.forEach(i => { i.group = g.id; }); return g; };
  const a1 = mk('A1', 0), a2 = mk('A2', 400), b1 = mk('B1', 800), b2 = mk('B2', 1200), c1 = mk('C1', 1600), c2 = mk('C2', 2000);
  const ga = layer('Carcass', [a1, a2]), gb = layer('Shelves', [b1, b2]), gc = layer('Doors', [c1, c2]);
  persist(); render(); setTab('groups'); if (lay.max) setBig(lay.max);`;

test("layers: found by name, and picked several at once with Ctrl and Shift", async () => {
  const v = await app.run(`${SETUP}
    const names = () => [...document.querySelectorAll('#groups [data-gsel]')].map(b => b.textContent);
    const find = document.getElementById('gFind'); find.focus(); find.value = 'shel'; find.dispatchEvent(new Event('input', { bubbles: true }));
    const found = names(), stillTyping = document.activeElement && document.activeElement.id === 'gFind';
    find.value = 'zzz'; find.dispatchEvent(new Event('input', { bubbles: true })); const none = /No layer has that/.test(document.getElementById('groups').textContent);
    find.value = ''; find.dispatchEvent(new Event('input', { bubbles: true })); const all = names().length;
    const click = (key, o = {}) => document.querySelector('#groups [data-gsel="' + key + '"]').dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1, ...o }));
    click(ga.id); const one = sel.slice().sort();
    click(gc.id, { ctrlKey: true }); const two = sel.slice().sort();
    click(gc.id, { ctrlKey: true }); const back = sel.slice().sort();
    click(ga.id); click(gc.id, { shiftKey: true }); const range = sel.length;
    return { found, stillTyping, none, all, one, two, back, range, ids: [a1, a2, c1, c2].map(i => i.id).sort() };`);
  assert.deepStrictEqual(v.found, ["Shelves"]); assert.ok(v.stillTyping, "the search box keeps the typing"); assert.ok(v.none); assert.ok(v.all >= 3);
  assert.deepStrictEqual(v.two, v.ids.slice().sort(), "Ctrl adds a layer"); assert.deepStrictEqual(v.back, v.one, "Ctrl again takes it away");
  assert.strictEqual(v.range, 6, "Shift picks every layer between");
});

test("several picked: a size typed sets them all, and boxes where they differ say so", async () => {
  const v = await app.run(`${SETUP}
    a2.w = 250; sel = [a1.id, a2.id, b1.id]; setTab('props'); render();
    const box = k => document.querySelector('#side [data-f="ms' + k + '"]'), before = { l: box('l').value, w: box('w').value, wph: box('w').placeholder };
    box('w').value = '10'; box('w').dispatchEvent(new Event('change', { bubbles: true }));
    return { before, after: [a1.w, a2.w, b1.w].map(x => Math.round(x * 100) / 100), wNow: box('w').value };`);
  assert.strictEqual(v.before.wph, "Mixed", "the widths differ"); assert.ok(v.before.l, "the lengths are the same, so it shows");
  assert.ok(v.after.every(x => x === v.after[0]), "every one got the width: " + v.after); assert.ok(v.wNow, "and it isn't mixed any more");
});

test("the flat views: a clear floor, guides that show, what's picked showing through, and panel numbers for a warning", async () => {
  const v = await app.run(`${SETUP}
    const svg = n => document.getElementById(VIEWS[n].el).innerHTML;
    drawFlats(); const floor = { front: /Floor<\\/text>/.test(svg('front')), side: /Floor<\\/text>/.test(svg('side')), top: /Floor<\\/text>/.test(svg('top')) };
    guides = [{ axis: 0, at: 100 }]; drawFlats(); const guide = /stroke-dasharray="7 4"/.test(svg('front')); guides = [];
    b2.pos = b1.pos.slice(); persist(); render();
    const w = checks().find(t => /overlap/.test(t)); document.getElementById('warnPop').innerHTML = '<button>' + w + '</button>'; document.querySelector('#warnPop button').click();
    drawFlats(); placeDimLabels();
    const picked = sel.slice().sort(), through = (svg('front').match(/stroke="#e5a900" stroke-width="2"/g) || []).length;
    const numbers = [b1.id, b2.id].every(id => svg('front').includes('>' + id + '<')), labels = [...document.querySelectorAll('#pane3d .dimtag')].map(s => s.textContent);
    sel = [a1.id]; drawFlats(); const gone = !svg('front').includes('>' + b1.id + '<');
    return { floor, guide, picked, want: [b1.id, b2.id].sort(), through, numbers, labels, gone };`);
  assert.deepStrictEqual(v.floor, { front: true, side: true, top: false });
  assert.ok(v.guide, "a guide is a dashed line");
  assert.deepStrictEqual(v.picked, v.want, "both panels the warning names are picked"); assert.strictEqual(v.through, 2, "each shows through");
  assert.ok(v.numbers, "with their numbers on them"); assert.ok(v.labels.length >= 2, "in 3D too: " + v.labels);
  assert.ok(v.gone, "the numbers go when something else is picked");
});

test("moving: Shift keeps to one axis, and the checks count again while it moves", async () => {
  const v = await app.run(`${SETUP}
    setBig('front'); await new Promise(r => setTimeout(r, 100)); fitView('front'); drawFlats();
    const el = document.getElementById('vfront'), r = el.getBoundingClientRect(), t = vt.front, at = p => [r.left + t.ox + p[0] * t.k, r.top + t.oy - p[1] * t.k];
    const [x, y] = at([a1.pos[0], a1.pos[1]]), ev = (type, dx, dy, shift) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x + dx, clientY: y + dy, button: 0, buttons: type === 'pointerup' ? 0 : 1, shiftKey: !!shift, pointerId: 1 }));
    const start = a1.pos.slice(); sel = [a1.id]; render();
    ev('pointerdown', 0, 0); ev('pointermove', 60, 20, true); ev('pointermove', 90, 25, true); const mid = a1.pos.slice(); ev('pointerup', 90, 25, true);
    const moved = [Math.round(mid[0] - start[0]), Math.round(mid[1] - start[1])];
    const before = lastWarn.length; a1.pos = b1.pos.slice(); fd = { type: 'move', moved: true, vn: 'front' }; dirty = true; warnAt = 0; await new Promise(r => setTimeout(r, 250)); const during = lastWarn.some(t => t.includes(b1.id) && /overlap/.test(t)) ? lastWarn.length : -1, early = before; fd = null;
    setBig('front'); return { moved, before, during, axis: axisOnScreen(V3(0, 0, 0), [0, -50]) };`);
  assert.ok(v.moved[0] > 0 && v.moved[1] === 0, "it moved along X only: " + v.moved);
  assert.ok(v.during > 0, `the new overlap is counted while it's still being dragged: ${v.before} then ${v.during}`);
  assert.strictEqual(v.axis, 1, "a drag up the screen in 3D follows the vertical");
});

test("every view saves as a picture of what it shows", async () => {
  const v = await app.run(`${SETUP}
    const got = []; const keep = downloadBlob; downloadBlob = (name, data, type) => { got.push({ name, type, size: data.size }); };
    drawFlats(); document.querySelector('.pane[data-v="side"] [data-shot]').click(); await new Promise(r => setTimeout(r, 600));
    downloadBlob = keep; return { got, buttons: document.querySelectorAll('.vbar [data-shot], #bShot3d').length };`);
  assert.strictEqual(v.got.length, 1); assert.match(v.got[0].name, /Side view\.png$/); assert.strictEqual(v.got[0].type, "image/png"); assert.ok(v.got[0].size > 1000);
  assert.strictEqual(v.buttons, 4, "one in each of the four views");
});

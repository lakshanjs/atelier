"use strict";
const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert");
const { openApp, sleep } = require("./harness");

let app;
before(async () => {
  app = await openApp();
  await app.send("Emulation.setDeviceMetricsOverride", { width: 1500, height: 950, deviceScaleFactor: 1, mobile: false });
});
after(async () => { if (app) await app.close(); });
beforeEach(async () => {
  await app.run(`keyOverrides = {}; keyCapture = null; keysSave(); document.querySelectorAll('dialog[open]').forEach(d => d.close()); document.activeElement && document.activeElement.blur(); loadProject(TEMPLATES[2].make()); setTool('select'); sel = [panelsOnly()[0].id]; render();`);
  await sleep(40);
});
// real key presses
const CODES = { Enter: 13, Escape: 27, Delete: 46, Backspace: 8, ArrowDown: 40, ArrowUp: 38, F1: 112, F9: 120 };
async function press(k, mods = {}) {
  const bit = (mods.alt ? 1 : 0) | (mods.ctrl ? 2 : 0) | (mods.shift ? 8 : 0), named = CODES[k], letter = !named && /^[a-z]$/i.test(k);
  const base = { key: k, code: letter ? "Key" + k.toUpperCase() : named ? k : undefined, windowsVirtualKeyCode: named || k.toUpperCase().charCodeAt(0), modifiers: bit };
  await app.send("Input.dispatchKeyEvent", { type: "keyDown", ...base, ...(!named && !mods.ctrl ? { text: k } : {}) });
  await app.send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
  await sleep(30);
}
const type = async (s) => { for (const c of s) await press(c); };

test("every usual shortcut still does what it did", async () => {
  const P_ = (b) => app.run(b);
  await press("z", { ctrl: true });
  await P_(`edit(() => { panelsOnly()[0].name = 'One'; });`);
  await press("z", { ctrl: true }); assert.notStrictEqual(await P_(`return panelsOnly()[0].name`), "One", "Ctrl+Z undoes");
  await press("y", { ctrl: true }); assert.strictEqual(await P_(`return panelsOnly()[0].name`), "One", "Ctrl+Y redoes");
  await press("z", { ctrl: true }); await press("z", { ctrl: true, shift: true }); assert.strictEqual(await P_(`return panelsOnly()[0].name`), "One", "Ctrl+Shift+Z redoes");
  await press("a", { ctrl: true }); assert.ok((await P_(`return sel.length`)) > 3, "Ctrl+A selects all");
  await P_(`sel = [panelsOnly()[0].id]; render();`);
  let n = await P_(`return P.items.length`); await press("d", { ctrl: true }); assert.strictEqual(await P_(`return P.items.length`), n + 1, "Ctrl+D duplicates");
  await press("c", { ctrl: true }); await press("v", { ctrl: true }); assert.strictEqual(await P_(`return P.items.length`), n + 2, "copy and paste");
  await press("Delete"); assert.strictEqual(await P_(`return P.items.length`), n + 1, "Delete");
  await P_(`sel = [panelsOnly()[0].id]; render();`);
  await press("Backspace"); assert.strictEqual(await P_(`return P.items.length`), n, "Backspace");
  for (const [k, t] of [["e", "rotate"], ["s", "scale"], ["m", "measure"], ["v", "select"]]) { await press(k); assert.strictEqual(await P_(`return tool`), t, k); }
  const was = await P_(`return P.snap`); await press("g"); assert.strictEqual(await P_(`return P.snap`), !was, "G toggles snap");
  await P_(`sel = [panelsOnly()[0].id]; render();`);
  const q0 = await P_(`return JSON.stringify(selected()[0].q)`); await press("r"); assert.notStrictEqual(await P_(`return JSON.stringify(selected()[0].q)`), q0, "R spins");
  await press("F1"); assert.ok(await P_(`return document.getElementById('helpDlg').open`), "F1 is help");
});

test("keys don't act while typing in a box or with a window open", async () => {
  const v = await app.run(`setTab('props'); render(); const b = document.querySelector('.iname'); b.focus(); return document.activeElement === b;`);
  assert.ok(v);
  const n = await app.run(`return P.items.length`), t = await app.run(`return tool`);
  await press("e"); await press("Delete");
  assert.strictEqual(await app.run(`return tool`), t, "typing E doesn't change tool");
  assert.strictEqual(await app.run(`return P.items.length`), n, "Delete in a box doesn't delete the panel");
  await app.run(`document.activeElement.blur(); openHistory();`);
  await press("Delete"); assert.strictEqual(await app.run(`return P.items.length`), n);
});

test("Ctrl+K finds a command by name, runs it, and remembers it", async () => {
  await press("k", { ctrl: true });
  assert.ok(await app.run(`return document.getElementById('cmdDlg').open && document.activeElement.id === 'cmdQ'`));
  await type("dupl");
  const top = await app.run(`return document.querySelector('#cmdList .on span').textContent`);
  assert.strictEqual(top, "Duplicate");
  const n = await app.run(`return P.items.length`);
  await press("Enter"); await sleep(50);
  assert.ok(!(await app.run(`return document.getElementById('cmdDlg').open`)));
  assert.strictEqual(await app.run(`return P.items.length`), n + 1);
  await press("k", { ctrl: true });
  assert.strictEqual(await app.run(`return document.querySelector('#cmdList .on span').textContent`), "Duplicate", "the last one used comes first");
  await press("Escape"); assert.ok(!(await app.run(`return document.getElementById('cmdDlg').open`)));
});

test("the command list has everything, with sensible search", async () => {
  const v = await app.run(`
    const all = commandList(), menu = [...document.querySelectorAll('#menus .mlist [data-do]')].filter(b => !b.hidden).map(b => b.dataset.do).filter(a => a !== 'tbsep' && !a.startsWith('recent:')), ids = all.map(c => c.id);
    const find = q => all.map(c => ({ c, s: cmdScore(c, q) })).filter(x => x.s > 0).sort((a, b) => b.s - a.s).map(x => x.c.name)[0];
    return { missing: menu.filter(a => !ids.includes(a)), unrunnable: all.filter(c => typeof c.run !== 'function').map(c => c.id), names: all.filter(c => !c.name).map(c => c.id), noKbdInName: all.filter(c => /Ctrl\\+/.test(c.name)).map(c => c.name), tools: ids.filter(i => i.startsWith('tool.')).length,
      save: find('save'), photo: find('photoreal'), letters: find('wkdrw'), words: find('hardware cat'), nothing: find('zzzzqq') };`);
  assert.deepStrictEqual(v.missing, []); assert.deepStrictEqual(v.unrunnable, []); assert.deepStrictEqual(v.names, []); assert.deepStrictEqual(v.noKbdInName, []);
  assert.strictEqual(v.tools, 4);
  assert.match(v.save, /^Save/);
  assert.strictEqual(v.photo, "Photoreal picture");
  assert.strictEqual(v.letters, "Workshop drawings");
  assert.strictEqual(v.words, "Hardware catalogue");
  assert.strictEqual(v.nothing, undefined);
});

test("a shortcut can be changed, and it moves off whatever had it", async () => {
  await app.run(`openKeys(); document.querySelector('[data-keyset="dup"]').click();`);
  assert.match(await app.run(`return document.querySelector('[data-keyset="dup"]').textContent`), /Press a key/);
  await press("j");
  assert.strictEqual(await app.run(`return keyLabel('dup')`), "J");
  await app.run(`document.getElementById('keysClose').click();`);
  const n = await app.run(`return P.items.length`);
  await press("d", { ctrl: true }); assert.strictEqual(await app.run(`return P.items.length`), n, "the old key does nothing now");
  await press("j"); assert.strictEqual(await app.run(`return P.items.length`), n + 1, "the new key works");
  assert.match(await app.run(`return document.querySelector('[data-do="dup"] kbd').textContent`), /^J$/, "the menu shows it");

  await app.run(`openKeys(); document.querySelector('[data-keyset="snap"]').click();`);
  await press("r");
  const v = await app.run(`return { snap: keyLabel('snap'), spin: keyLabel('spin'), note: document.getElementById('keysNote').textContent }`);
  assert.strictEqual(v.snap, "R"); assert.strictEqual(v.spin, ""); assert.match(v.note, /Spin 90/);
  await app.run(`document.querySelector('[data-keyback="spin"]').click(); document.getElementById('keysClose').click();`);
});

test("changes last after a restart; Esc cancels; fixed keys are refused; reset works", async () => {
  await app.run(`openKeys(); document.querySelector('[data-keyset="save"]').click();`);
  await press("Escape");
  assert.strictEqual(await app.run(`return keyLabel('save') + '|' + document.getElementById('keysDlg').open + '|' + keyCapture`), "Ctrl+S|true|null", "Esc only cancels the change");
  await app.run(`document.querySelector('[data-keyset="save"]').click();`);
  await press("ArrowDown");
  assert.match(await app.run(`return document.getElementById('keysNote').textContent`), /kept for/);
  await press("F9");
  assert.strictEqual(await app.run(`return keyLabel('save')`), "F9");
  await app.run(`document.getElementById('keysClose').click();`);
  await app.reload(); await sleep(600);
  await app.run(`document.querySelectorAll('dialog[open]').forEach(d => d.close());`);
  assert.strictEqual(await app.run(`return keyLabel('save')`), "F9");
  assert.match(await app.run(`return document.getElementById('bSave').title`), /F9/);
  await app.run(`openKeys(); document.querySelector('[data-keyclear="fit"]').click(); document.getElementById('keysReset').click(); document.getElementById('keysClose').click();`);
  assert.strictEqual(await app.run(`return keyLabel('save') + keyLabel('fit')`), "Ctrl+SF");
});

test("typing a number after a drag still beats the shortcuts", async () => {
  const v = await app.run(`
    const it = panelsOnly()[0], base = [{ id: it.id, pos: it.pos.slice() }]; pushUndo(); it.pos[0] += 10;
    precRemember({ type: 'move', moved: true, base, vn: 'front' }); persist(); return true;`);
  assert.ok(v);
  const p0 = await app.run(`return tool`);
  await type("5"); await press("m");   // "5m" is five metres, not the Measure tool
  assert.strictEqual(await app.run(`return tool`), p0);
  await press("Enter");
  assert.ok(Math.abs((await app.run(`return panelsOnly()[0].pos[0]`)) - (await app.run(`return JSON.parse(undoS.at(-1)).items.find(i => i.id === panelsOnly()[0].id).pos[0]`)) - 5000) < .01);
});

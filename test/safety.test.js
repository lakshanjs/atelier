"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { openApp, sleep } = require("./harness");

const tmpData = () => fs.mkdtempSync(path.join(os.tmpdir(), "atelier-safety-"));

test("a crash brings the work back and says so", async () => {
  const data = tmpData();
  let app = await openApp({ userData: data });
  await app.run(`loadProject(TEMPLATES[2].make()); edit(() => { P.name = 'Crash test'; });`);
  await sleep(1200);   // lets the database copy be written
  app.proc.kill("SIGKILL"); await sleep(900);
  app = await openApp({ userData: data });
  await sleep(600);
  const v = await app.run(`return { name: P.name, toast: document.getElementById('toast').textContent }`);
  assert.strictEqual(v.name, "Crash test");
  assert.match(v.toast, /didn't close properly/);
  await app.close();
});

test("a normal reload doesn't claim a crash", async () => {
  const app = await openApp({ userData: tmpData() });
  await app.run(`loadProject(TEMPLATES[2].make());`);
  await app.reload(); await sleep(500);
  const v = await app.run(`return document.getElementById('toast').textContent`);
  assert.doesNotMatch(v, /didn't close properly/);
  await app.close();
});

test("work too big for quick storage still comes back from the database", async () => {
  const data = tmpData();
  const app = await openApp({ userData: data });
  const v = await app.run(`
    loadProject(TEMPLATES[2].make()); edit(() => { P.name = 'Big one'; });
    const real = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, val) { if (k === AUTOSAVE_KEY) throw new DOMException('full', 'QuotaExceededError'); return real.call(this, k, val); };
    edit(() => { P.name = 'Big one, changed'; });
    Storage.prototype.setItem = real;
    await new Promise(r => setTimeout(r, 1200));
    return { quick: localStorage.getItem(AUTOSAVE_KEY) };`);
  assert.strictEqual(v.quick, null);
  await app.reload(); await sleep(500);
  assert.strictEqual(await app.run(`return P.name`), "Big one, changed");
  await app.close();
});

test("versions: keep, go back, undo, and old ones are pruned but named ones stay", async () => {
  const app = await openApp({ userData: tmpData() });
  const v = await app.run(`
    loadProject(TEMPLATES[2].make());
    edit(() => { P.name = 'v1'; }); await snapTake('First', true);
    edit(() => { P.name = 'v2'; }); await snapTake('Second');
    const list = await snapList(), first = list.find(r => r.label === 'First');
    await snapRestore(first.t); const backTo = P.name;
    undo(); const undone = P.name;
    openHistory(); await new Promise(r => setTimeout(r, 100)); const rows = document.querySelectorAll('#histList .histrow').length; document.getElementById('histDlg').close();
    for (let i = 0; i < 45; i++) { edit(() => { P.name = 'x' + i; }); await snapTake('Automatic'); }
    const after = await snapList();
    return { backTo, undone, rows: rows >= 2, autos: after.filter(r => !r.keep).length, named: after.some(r => r.label === 'First'), firstStill: !!(await kvGet('snap:' + first.t)) };`);
  assert.strictEqual(v.backTo, "v1");
  assert.strictEqual(v.undone, "v2");
  assert.ok(v.rows);
  assert.strictEqual(v.autos, 40);
  assert.ok(v.named && v.firstStill);
  await app.close();
});

test("a script error is logged to a file and doesn't stop the app", async () => {
  const data = tmpData();
  const app = await openApp({ userData: data });
  await app.run(`setTimeout(() => { throw new Error('deliberate test error'); }); await new Promise(r => setTimeout(r, 300));`);
  await sleep(300);
  const log = fs.readFileSync(path.join(data, "errors.log"), "utf8");
  assert.match(log, /deliberate test error/);
  assert.ok(await app.run(`render(); return true`));
  await app.close();
});

// What happened to Corner rack - rounded: the file last opened was remembered and tied to whatever project was open,
// here an empty carving, and Save wrote the carving over the design. Files now only take the project they hold.
test("Save never writes one project over a file that holds another; the same project saves in place", async () => {
  const app = await openApp();
  try {
    const v = await app.run(`
      document.querySelectorAll('dialog[open]').forEach(d => d.close());
      const fake = (name, bytes) => { const f = { name, bytes, wrote: 0, getFile: async () => new File([f.bytes], name), requestPermission: async () => 'granted', isSameEntry: async o => o === f,
        createWritable: async () => ({ write: async b => { f.bytes = b; f.wrote++; }, close: async () => {} }) }; return f; };
      let picked = 0; const other = fake('Picked.atlr', new Uint8Array()); window.showSaveFilePicker = async () => { picked++; return other; };
      const projOf = async f => { const m = JSON.parse(await readZipText(await (await f.getFile()).arrayBuffer(), 'project.json')); return m.project; };
      // the design, saved to its file
      loadProject(newDesign(TEMPLATES[1].make)); P.name = 'Corner rack - rounded'; const design = fake('Corner rack - rounded.atlr', new Uint8Array()); fileHandle = design; await saveProject();
      const out = { designSaved: design.wrote === 1 && picked === 0, designUid: !!(await projOf(design)).uid, panels: (await projOf(design)).items.length };
      // an empty carving starts, and the old file gets tied to it, as the restart did
      loadProject(newCarving()); fileHandle = design; await saveProject();
      out.notOver = design.wrote === 1 && (await projOf(design)).name === 'Corner rack - rounded' && (await projOf(design)).items.length === out.panels;
      out.askedWhere = picked === 1 && (await projOf(other)).kind === 'carve';
      // the carving's own file saves in place from now on
      const before = picked; await saveProject(); out.inPlace = picked === before && other.wrote === 2;
      // a file from before ids, holding the same project by name, saves in place too
      const legacy = fake('Old.atlr', await (async () => { const keep = P.uid; delete P.uid; const b = await atelierBytes(); P.uid = keep; return b; })());
      fileHandle = legacy; const p2 = picked; await saveProject(); out.legacy = legacy.wrote === 1 && picked === p2;
      return out;`);
    assert.ok(v.designSaved && v.designUid && v.panels > 0, JSON.stringify(v));
    assert.ok(v.notOver, "the design file is left as it was");
    assert.ok(v.askedWhere, "Save asks where to put the carving instead");
    assert.ok(v.inPlace, "then saves the carving where it was put");
    assert.ok(v.legacy, "an older file holding the same project by name is saved over as before");
  } finally { await app.close(); }
});

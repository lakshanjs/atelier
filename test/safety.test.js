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

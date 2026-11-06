"use strict";
// Starts the real app with its own empty data folder and drives it over the Chrome DevTools Protocol.
// Never touches the user's Atelier, library or autosave.
const { spawn, execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const ELECTRON = path.join(ROOT, "node_modules", "electron", "dist", "electron.exe");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Test windows always open on virtual desktop 1, not on whichever desktop is in front, so they don't pop up where you're
// working. Windows only lets an app move its own windows, so the test copy loads a tiny helper (vdesk/) that does it.
// ATELIER_TEST_DESKTOP picks another desktop by number, or "off" leaves windows where Windows puts them. If the helper
// can't be built or there's no such desktop, windows open as usual.
const VDESK = path.join(__dirname, "vdesk");
let home;
function homeDesktop() {
  if (home !== undefined) return home;
  home = null;
  const want = process.env.ATELIER_TEST_DESKTOP || "1";
  if (process.platform !== "win32" || !/^\d+$/.test(want)) return home;
  const ps = (file, args = []) => execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(VDESK, file), ...args], { encoding: "utf8", timeout: 120000, windowsHide: true }).trim();
  try {
    if (!fs.existsSync(path.join(VDESK, "vdesk.node"))) ps("build.ps1");
    const id = ps("desktop.ps1", ["-Number", want]);
    if (/^\{[0-9a-f-]{36}\}$/i.test(id) && fs.existsSync(path.join(VDESK, "vdesk.node"))) home = id;
  } catch (e) { home = null; }
  return home;
}

function launcher(dir, port, userData) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "atelier-test", main: "main.js" }));
  const desk = homeDesktop();
  fs.writeFileSync(path.join(dir, "main.js"), `
const { app } = require('electron');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.setPath('userData', ${JSON.stringify(userData.replace(/\\/g, "/"))});
${process.env.ATELIER_TEST_SHOW === "on" ? "" : `// off the screen and never in front, so you can carry on working while tests run. Not minimized: Windows stops a
// minimized window drawing, and some tests watch it draw. ATELIER_TEST_SHOW=on shows them as usual.
{ const { BrowserWindow } = require('electron'), P = BrowserWindow.prototype;
  P.show = function () { if (!this.isVisible()) { this.setPosition(-30000, -30000); this.showInactive(); } };
  P.maximize = function () {}; P.focus = function () {}; P.moveTop = function () {}; }`}
${desk ? `try {
  const vd = require(${JSON.stringify(path.join(VDESK, "vdesk.node").replace(/\\/g, "/"))});
  app.on('browser-window-created', (e, w) => { try { const hr = vd.move(w.getNativeWindowHandle(), ${JSON.stringify(desk)}); if (hr) console.error('test desktop: 0x' + (hr >>> 0).toString(16)); } catch (err) {} });
} catch (err) { console.error('test desktop:', err && err.message); }` : ""}
require(${JSON.stringify(path.join(ROOT, "main.js").replace(/\\/g, "/"))});
`);
}

async function openApp({ port = 9400 + Math.floor(Math.random() * 400), userData, file, keepDialogs } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "atelier-test-"));
  const data = userData || path.join(tmp, "data");
  launcher(path.join(tmp, "launcher"), port, data);
  const args = [path.join(tmp, "launcher"), `--remote-debugging-port=${port}`];
  if (file) args.push(file);
  const proc = spawn(ELECTRON, args, { stdio: "ignore", windowsHide: true });

  let page = null;
  for (let i = 0; i < 80 && !page; i++) {
    await sleep(250);
    try { page = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((p) => p.type === "page"); } catch (e) {}
  }
  if (!page) { proc.kill(); throw new Error("the app did not start"); }

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = no; });
  let id = 0; const wait = {}, errors = [];
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && wait[d.id]) { wait[d.id](d); delete wait[d.id]; }
    if (d.method === "Runtime.exceptionThrown") errors.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text);
  };
  const send = (method, params = {}) => new Promise((r, no) => { const i = ++id, t = setTimeout(() => { delete wait[i]; no(new Error(`no answer from the app after 30s: ${method} ${String(params.expression || "").slice(0, 120)}`)); }, 30000); wait[i] = (d) => { clearTimeout(t); r(d); }; ws.send(JSON.stringify({ id: i, method, params })); });
  await send("Runtime.enable"); await send("Page.enable"); await send("DOM.enable");

  const app = {
    errors, send, proc, data,
    // runs JS in the page and returns its value. `await` works, because it's wrapped in an async function.
    async run(body) {
      const r = await send("Runtime.evaluate", { expression: `(async () => { ${body} })()`, awaitPromise: true, returnByValue: true });
      if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || JSON.stringify(r.result.exceptionDetails).slice(0, 600));
      return r.result.result.value;
    },
    async ready() {
      for (let i = 0; i < 80; i++) {
        const ok = await send("Runtime.evaluate", { expression: "document.readyState === 'complete' && typeof P !== 'undefined' && typeof render === 'function'", returnByValue: true });
        if (ok.result.result.value) { await sleep(150); return; }
        await sleep(100);
      }
      throw new Error("the page never finished starting: " + errors.join(" | "));
    },
    async setFile(inputId, file) {
      const doc = await send("DOM.getDocument"), n = await send("DOM.querySelector", { nodeId: doc.result.root.nodeId, selector: "#" + inputId });
      return send("DOM.setFileInputFiles", { nodeId: n.result.nodeId, files: [file] });
    },
    async reload() { await send("Page.reload"); await sleep(300); await app.ready(); },
    async screenshot(out) { await send("Emulation.setDeviceMetricsOverride", { width: 1500, height: 950, deviceScaleFactor: 1, mobile: false }); const r = await send("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(out, Buffer.from(r.result.data, "base64")); },
    async close() {
      try { ws.close(); } catch (e) {}
      proc.kill();
      await sleep(400);
      if (!userData) { try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (e) {} }
    },
  };
  await app.ready();
  await sleep(500);   // the starting-piece window opens just after start-up
  if (!keepDialogs) await app.run("const d = document.querySelector('dialog[open]'); if (d) d.close();");
  return app;
}

module.exports = { openApp, sleep, ROOT };

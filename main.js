"use strict";
// Desktop shell for Atelier. The app itself is index.html; this only gives it a window,
// an installer identity and updates from the GitHub releases of lakshanjs/atelier (see scripts/release.js).
const { app, BrowserWindow, ipcMain, Menu, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const { pathToFileURL } = require("url");

// Problems in the page go in errors.log next to the app's data, cut down when it gets long.
ipcMain.on("log:error", (e, text) => {
  try {
    const f = path.join(app.getPath("userData"), "errors.log");
    if (fs.existsSync(f) && fs.statSync(f).size > 1000000) fs.writeFileSync(f, fs.readFileSync(f, "utf8").slice(-500000));
    fs.appendFileSync(f, `${new Date().toISOString()} v${app.getVersion()} ${String(text).slice(0, 4000)}\n`);
  } catch (err) { console.error(err); }
});

// A note on disk while the app runs. If it's still there at the next start, the last run didn't end properly.
// (The page's own storage can't tell: it's written lazily, so a hard stop can lose it.)
let lastRunCrashed = false;
const lockFile = () => path.join(app.getPath("userData"), "running.lock");
function sessionBegin() {
  try { lastRunCrashed = fs.existsSync(lockFile()); fs.writeFileSync(lockFile(), String(process.pid)); } catch (err) { console.error(err); }
}
ipcMain.on("session:crashed", (e) => { e.returnValue = lastRunCrashed; lastRunCrashed = false; });

// Drawings become a PDF in a hidden window of their own. Printing can stall now and then, and a stall here
// must never freeze the window the user is designing in, so it gets a time limit and one more try.
const PDF_LIMIT = 15000;
async function pdfOnce(svg, wMm, hMm) {
  const fontUrl = (w) => pathToFileURL(path.join(__dirname, "lib", "fonts", `barlow-${w}.woff2`)).href;
  const faces = [400, 500, 600].map((w) => `@font-face { font-family: Barlow; font-weight: ${w}; src: url("${fontUrl(w)}") format("woff2"); }`).join("");
  const html = `<!doctype html><meta charset="utf-8"><style>${faces} @page { size: ${wMm}mm ${hMm}mm; margin: 0; } html, body { margin: 0; padding: 0; background: #fff; } svg { display: block; width: ${wMm}mm; height: ${hMm}mm; break-after: page; break-inside: avoid; } svg:last-child { break-after: auto; }</style>${svg}`;
  const file = path.join(app.getPath("temp"), `atelier-print-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.html`);
  fs.writeFileSync(file, html);
  const printer = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  printer.webContents.on("will-navigate", (e) => e.preventDefault());
  let timer = null;
  try {
    const job = (async () => {
      await printer.loadFile(file);
      await printer.webContents.executeJavaScript("document.fonts.ready.then(() => 1)");
      return printer.webContents.printToPDF({ preferCSSPageSize: true, printBackground: true, margins: { marginType: "none" } });
    })();
    job.catch(() => {});
    return await Promise.race([job, new Promise((ok, no) => { timer = setTimeout(() => no(new Error("the PDF took too long")), PDF_LIMIT); })]);
  } finally {
    clearTimeout(timer);
    if (!printer.isDestroyed()) printer.destroy();
    try { fs.unlinkSync(file); } catch (err) {}
  }
}
ipcMain.handle("print:pdf", async (e, { svg, wMm, hMm }) => {
  try { return await pdfOnce(svg, wMm, hMm); } catch (err) { console.error("pdf, trying again:", err.message); return pdfOnce(svg, wMm, hMm); }
});

const fileIn = (argv) => argv.slice(1).find((a) => /\.atlr$/i.test(a) && fs.existsSync(a));
function sendFile(file) {
  if (!win || !file) return;
  try { win.webContents.send("file:open", { name: path.basename(file), bytes: fs.readFileSync(file) }); } catch (e) { console.error(e); }
}

const BAR_HEIGHT = 33;   // #titlebar is 34 tall: this stops one short, so its bottom border runs under the window buttons
ipcMain.on("win:bar", (e, { color, symbolColor }) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  if (w) w.setTitleBarOverlay({ color, symbolColor, height: BAR_HEIGHT });
});

// Laptops have two graphics chips, and Chromium picks the slow power-saving one unless told otherwise.
app.commandLine.appendSwitch("force_high_performance_gpu");

let autoUpdater = null;
try { ({ autoUpdater } = require("electron-updater")); } catch (e) { console.error("electron-updater unavailable:", e && e.message); }

let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1500,
    height: 950,
    minWidth: 1000,
    minHeight: 640,
    show: false,
    title: "Atelier",
    icon: path.join(__dirname, "lib", "icon.ico"),
    // No Windows title bar: the app's own top bar takes its place, with the real window buttons on it.
    titleBarStyle: "hidden",
    titleBarOverlay: { color: "#eef1f0", symbolColor: "#20262a", height: BAR_HEIGHT },
    // no slowing down in the background: a render or PDF should carry on while you use something else
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
  });
  win.loadFile(path.join(__dirname, "index.html"));
  win.webContents.once("did-finish-load", () => sendFile(fileIn(process.argv)));
  win.once("ready-to-show", () => { win.maximize(); win.show(); });
  // Anything that tries to leave the app opens in the default browser instead.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith("file:")) { e.preventDefault(); shell.openExternal(url); }
  });
  // If the page itself dies, come straight back: autosave has the work.
  win.webContents.on("render-process-gone", (e, details) => {
    console.error("page stopped:", details.reason);
    lastRunCrashed = true;
    if (win && details.reason !== "clean-exit") win.loadFile(path.join(__dirname, "index.html"));
  });
  win.on("closed", () => { win = null; });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", (e, argv) => {
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); sendFile(fileIn(argv)); }
  });
  app.whenReady().then(() => {
    if (process.platform === "win32") app.setAppUserModelId("com.lakshan.atelier");
    sessionBegin();
    Menu.setApplicationMenu(null);   // the app draws its own menu bar
    createWindow();
    if (autoUpdater && app.isPackaged) {
      autoUpdater.autoDownload = true;
      autoUpdater.autoInstallOnAppQuit = true;
      autoUpdater.on("error", (err) => console.error("update:", err && err.message));
      // soon after it starts, then every 6 hours for a copy left open; a new version installs when the app is closed
      const check = () => autoUpdater.checkForUpdates().catch(() => {});
      setTimeout(check, 4000); setInterval(check, 6 * 60 * 60 * 1000);
    }
  });
  app.on("window-all-closed", () => app.quit());
  app.on("will-quit", () => { try { fs.unlinkSync(lockFile()); } catch (err) {} });
}

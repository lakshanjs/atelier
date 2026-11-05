"use strict";
// Desktop shell for Atelier. The app itself is index.html; this only gives it a window,
// an installer identity and updates from the local web root (see scripts/publish-local.js).
const { app, BrowserWindow, ipcMain, Menu, shell } = require("electron");
const path = require("path");
const fs = require("fs");

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

// Saves whatever the page's print styles lay out. The page sets the paper size with @page.
ipcMain.handle("print:pdf", (e) => e.sender.printToPDF({ preferCSSPageSize: true, printBackground: true, margins: { marginType: "none" } }));

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
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true },
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
      setTimeout(() => { autoUpdater.checkForUpdates().catch(() => {}); }, 4000);
    }
  });
  app.on("window-all-closed", () => app.quit());
  app.on("will-quit", () => { try { fs.unlinkSync(lockFile()); } catch (err) {} });
}

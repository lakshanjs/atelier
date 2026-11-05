"use strict";
// Lets the page keep the Windows minimize, maximize and close buttons in its own colours.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("atelierWin", {
  crashedLastTime: () => ipcRenderer.sendSync("session:crashed"),
  printPdf: (job) => ipcRenderer.invoke("print:pdf", job),
  logError: (text) => ipcRenderer.send("log:error", text),
  setBar: (color, symbolColor) => ipcRenderer.send("win:bar", { color, symbolColor }),
  onOpenFile: (cb) => ipcRenderer.on("file:open", (e, f) => cb(f.name, f.bytes)),
});

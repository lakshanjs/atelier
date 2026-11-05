"use strict";
// Lets the page keep the Windows minimize, maximize and close buttons in its own colours.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("atelierWin", {
  setBar: (color, symbolColor) => ipcRenderer.send("win:bar", { color, symbolColor }),
  onOpenFile: (cb) => ipcRenderer.on("file:open", (e, f) => cb(f.name, f.bytes)),
});

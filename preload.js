"use strict";
// Lets the page keep the Windows minimize, maximize and close buttons in its own colours, and reach the CNC machine.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("atelierWin", {
  crashedLastTime: () => ipcRenderer.sendSync("session:crashed"),
  printPdf: (job) => ipcRenderer.invoke("print:pdf", job),
  logError: (text) => ipcRenderer.send("log:error", text),
  setBar: (color, symbolColor) => ipcRenderer.send("win:bar", { color, symbolColor }),
  onOpenFile: (cb) => ipcRenderer.on("file:open", (e, f) => cb(f.name, f.bytes)),
  onUpdateReady: (cb) => ipcRenderer.on("update:ready", (e, version) => cb(version)),
  updateWaiting: () => ipcRenderer.sendSync("update:waiting"),
  restartToUpdate: () => ipcRenderer.send("update:restart"),
  checkUpdates: () => ipcRenderer.invoke("update:check"),
  appInfo: () => ipcRenderer.invoke("app:info"),
  // the CNC machine: which USB port to pick, and GRBL over Wi-Fi (telnet)
  serialWant: (name) => ipcRenderer.send("serial:want", name),
  serialList: () => ipcRenderer.invoke("serial:list"),
  tcpOpen: (host, port) => ipcRenderer.invoke("tcp:open", { host, port }),
  tcpWrite: (id, text) => ipcRenderer.send("tcp:write", { id, text }),
  tcpClose: (id) => ipcRenderer.send("tcp:close", id),
  onTcp: (onData, onClosed) => { ipcRenderer.on("tcp:data", (e, m) => onData(m.id, m.text)); ipcRenderer.on("tcp:closed", (e, m) => onClosed(m.id)); },
});

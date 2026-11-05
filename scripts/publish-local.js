// Copies the built update files (latest.yml + installer + blockmap) into the local WAMP web
// root so the installed app can update itself from http://localhost/atelier-updates/
"use strict";
const fs = require("fs");
const path = require("path");

const dist = path.join(__dirname, "..", "dist");
const dest = "D:/wamp/www/atelier-updates";

fs.mkdirSync(dest, { recursive: true });
let n = 0;
for (const f of fs.readdirSync(dist)) {
  if (/uninstall|builder-debug/i.test(f)) continue;
  if (/\.(exe|yml|blockmap)$/i.test(f)) {
    fs.copyFileSync(path.join(dist, f), path.join(dest, f));
    console.log("  published " + f);
    n++;
  }
}
console.log(`Published ${n} file(s) to ${dest}`);

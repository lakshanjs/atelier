// Builds the installer and publishes it as a GitHub release of lakshanjs/atelier, which installed copies check
// for updates. Raise "version" in package.json first: a release whose version is already published is refused.
// The upload uses the GitHub CLI's own login (gh auth login), so no token is kept in a file or in the app.
// The files also go to the old local update folder if it's there, for copies still pointing at it.
"use strict";
const { execFileSync, spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const { version, build } = require(path.join(root, "package.json"));
const { owner, repo } = build.publish;

let token;
try { token = execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim(); } catch (e) { token = ""; }
if (!token) { console.error("Not logged in to GitHub. Run: gh auth login"); process.exit(1); }

let taken = false;
try { execFileSync("gh", ["release", "view", `v${version}`, "--repo", `${owner}/${repo}`], { stdio: "ignore" }); taken = true; } catch (e) { taken = false; }
if (taken) { console.error(`Version ${version} is already released. Raise "version" in package.json first.`); process.exit(1); }

console.log(`Building Atelier ${version} and publishing it to github.com/${owner}/${repo} ...`);
const cli = require.resolve("electron-builder/cli.js", { paths: [root] });
const r = spawnSync(process.execPath, [cli, "--publish", "always"], { cwd: root, stdio: "inherit", env: { ...process.env, GH_TOKEN: token } });
if (r.status !== 0) process.exit(r.status || 1);

if (fs.existsSync("D:/wamp/www")) require("./publish-local.js");
console.log(`Released: https://github.com/${owner}/${repo}/releases/tag/v${version}`);

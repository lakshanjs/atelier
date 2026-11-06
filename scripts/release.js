// Builds the installer and publishes it as a GitHub release of lakshanjs/atelier, which installed copies check for
// updates. Raise "version" in package.json and push first: a version that's already fully released is refused, and so is
// a commit that isn't on GitHub yet (the release's tag points at it).
// The build publishes nothing itself. The release is made with the GitHub CLI, using its own login (gh auth login), so
// no token is kept in a file or in the app. A release left half-uploaded is finished, not made again.
// The files also go to the old local update folder if it's there, for copies still pointing at it.
"use strict";
const { execFileSync, spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.join(__dirname, "..");
const { version, build } = require(path.join(root, "package.json"));
const { owner, repo } = build.publish, slug = `${owner}/${repo}`, tag = `v${version}`;
const git = (...a) => execFileSync("git", a, { cwd: root, encoding: "utf8" }).trim();
const gh = (...a) => execFileSync("gh", a, { cwd: root, encoding: "utf8" }).trim();
const fail = msg => { console.error(msg); process.exit(1); };

try { gh("auth", "status"); } catch (e) { fail("Not logged in to GitHub. Run: gh auth login"); }
const head = git("rev-parse", "HEAD");
if (!git("branch", "-r", "--contains", head)) fail("This commit isn't on GitHub yet. Push it first: git push");

let existing = null;
try { existing = JSON.parse(gh("release", "view", tag, "--repo", slug, "--json", "assets")); } catch (e) { existing = null; }
if (existing && existing.assets.some(a => a.name === "latest.yml")) fail(`Version ${version} is already released. Raise "version" in package.json first.`);

console.log(`Building Atelier ${version} ...`);
const cli = require.resolve("electron-builder/cli.js", { paths: [root] });
const r = spawnSync(process.execPath, [cli, "--publish", "never"], { cwd: root, stdio: "inherit" });
if (r.status !== 0) process.exit(r.status || 1);

// latest.yml names the installer as the updater will ask for it; the files are uploaded under those names
const dist = path.join(root, "dist"), yml = fs.readFileSync(path.join(dist, "latest.yml"), "utf8");
if (!new RegExp(`^version: ${version.replace(/\./g, "\\.")}\\s*$`, "m").test(yml)) fail(`dist/latest.yml isn't for ${version}. The build may have failed.`);
const url = (/^path: (.+)$/m.exec(yml) || [])[1], exe = fs.readdirSync(dist).find(f => f.endsWith(".exe") && !/uninstall/i.test(f) && f.replace(/ /g, "-") === url);
if (!url || !exe || !fs.existsSync(path.join(dist, exe + ".blockmap"))) fail(`Couldn't find the installer for ${url} in dist.`);
const up = fs.mkdtempSync(path.join(os.tmpdir(), "atelier-release-")), files = [[exe, url], [exe + ".blockmap", url + ".blockmap"], ["latest.yml", "latest.yml"]].map(([from, to]) => { fs.copyFileSync(path.join(dist, from), path.join(up, to)); return path.join(up, to); });

let notes = ""; try { const prev = git("describe", "--tags", "--abbrev=0", `${head}^`); notes = git("log", "--format=- %s", `${prev}..${head}`); } catch (e) { notes = git("log", "-10", "--format=- %s", head); }
try {
  if (existing) { console.log(`Finishing release ${tag} ...`); gh("release", "upload", tag, ...files, "--repo", slug, "--clobber"); }
  else { console.log(`Publishing release ${tag} ...`); gh("release", "create", tag, ...files, "--repo", slug, "--target", head, "--title", `Atelier ${version}`, "--notes", notes || `Atelier ${version}`); }
} finally { fs.rmSync(up, { recursive: true, force: true }); }

if (fs.existsSync("D:/wamp/www")) require("./publish-local.js");
console.log(`Released: https://github.com/${slug}/releases/tag/${tag}`);

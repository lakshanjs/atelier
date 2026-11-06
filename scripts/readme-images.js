// Makes the pictures in the README (docs/*.png and docs/carving.gif) from the app itself, opened the way the tests open
// it: off the screen, on virtual desktop 1, never in front. Needs ffmpeg on the PATH for the animation.
// Run: node scripts/readme-images.js
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { openApp } = require("../test/harness");

const root = path.join(__dirname, ".."), docs = path.join(root, "docs"), tmp = fs.mkdtempSync(path.join(os.tmpdir(), "atelier-readme-"));
fs.mkdirSync(docs, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));

// a sample sign: carved lettering, a star, an engraved border, cut out with rounded corners
const SIGN = `
  loadProject(newProject('Workshop sign')); document.querySelectorAll('dialog[open]').forEach(d => d.close());
  cvBits = JSON.parse(JSON.stringify(CV_BITS_START)); P.carve = null; await openCarve(); document.querySelectorAll('dialog[open]').forEach(d => d.close());
  const cv = P.carve; cv.board = { wood: 'bass', l: 203.2, w: 152.4, t: 6, ...cvRatesFor('bass') };
  const t = await cvAddText({ text: 'Workshop', font: 'Georgia', size: 22, y: 95 }); t.op = cvOpFor(cv, 'vcarve'); t.op.bit = 'v-30'; t.op.depth = 1.5;
  const s = cvAddPolygon('star'); s.w = s.h = 30; s.x = cv.board.l / 2; s.y = 50; s.op = cvOpFor(cv, 'vcarve'); s.op.bit = 'v-30'; s.op.depth = 1.5;
  const f = await cvAddText({ text: 'est. 2026', font: 'Hershey Script 1-stroke', size: 7, y: 72 }); f.op = cvOpFor(cv, 'line'); f.op.bit = 'v-30'; f.op.depth = .3;
  const border = cvAddRect(); border.w = 180; border.h = 130; border.corner = 10; border.op = cvOpFor(cv, 'line'); border.op.bit = 'v-30'; border.op.depth = .4;
  const out = cvAddRect(); out.w = 194; out.h = 144; out.corner = 14; out.op = cvOpFor(cv, 'outside');
  cvView = null; cvPickOnly(null); carveRender(); await new Promise(r => setTimeout(r, 500));`;

(async () => {
  const app = await openApp();
  const shot = async name => { await sleep(300); await app.run("const t = document.getElementById('toast'); if (t) t.hidden = true;"); await app.screenshot(path.join(docs, name)); console.log("  docs/" + name); };
  try {
    // 1. Design: a cupboard from the templates, in 3D, with one panel picked
    await app.run(`loadProject(TEMPLATES.find(t => t.name === 'Cupboard').make()); document.querySelectorAll('dialog[open]').forEach(d => d.close());
      if (typeof DO !== 'undefined' && DO.fit) DO.fit(); const side = P.items.find(i => i.kind === 'panel' && /Side/.test(i.name)) || P.items.find(i => i.kind === 'panel');
      if (side && typeof selectOnly === 'function') selectOnly(side.id); else if (side && typeof sel !== 'undefined') { sel = [side.id]; } render(); await new Promise(r => setTimeout(r, 800));`);
    await shot("design.png");

    // 2. Carve: the sign on the board, with the bit paths shown
    await app.run(SIGN + ` cvShowPaths = true; carveRender(); await new Promise(r => setTimeout(r, 600));`);
    await shot("carve.png");

    // 3. Carve: the sign as it will come out, in 3D
    await app.run(`cvShowPaths = false; cv3dShow(true); await new Promise(r => setTimeout(r, 1500)); cv3dBake(); await new Promise(r => setTimeout(r, 800));`);
    await shot("carve-3d.png");

    // 4. The animation: the cut played back, frame by frame
    const frames = 48;
    for (let i = 0; i <= frames; i++) {
      await app.run(`cvPlaySeek(CV3D.play.total * ${i / frames}); await new Promise(r => setTimeout(r, 60));`);
      await app.screenshot(path.join(tmp, `f${String(i).padStart(3, "0")}.png`));
    }
    for (let i = 1; i <= 12; i++) fs.copyFileSync(path.join(tmp, `f${String(frames).padStart(3, "0")}.png`), path.join(tmp, `f${String(frames + i).padStart(3, "0")}.png`));   // rest on the finished board
    // the 3D view without the side panel, a little smaller, in a palette made for these frames
    const crop = "crop=1170:780:40:80,scale=780:-1:flags=lanczos";
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", "12", "-i", path.join(tmp, "f%03d.png"), "-vf", `${crop},palettegen=stats_mode=diff`, path.join(tmp, "palette.png")]);
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", "12", "-i", path.join(tmp, "f%03d.png"), "-i", path.join(tmp, "palette.png"), "-lavfi", `${crop}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`, "-loop", "0", path.join(docs, "carving.gif")]);
    console.log("  docs/carving.gif");

    // 5. Cut in Carve: a panel from the design, ready to cut, holes and all
    await app.run(`cv3dShow(false); closeCarve(); loadProject(newProject('Shelf')); document.querySelectorAll('dialog[open]').forEach(d => d.close());
      const it = panelBox('Shelf', [0, 200, 0, 6, 0, 150]); it.mat = 'bass'; it.id = nextId(); P.items.push(it);
      it.ops = [[30, 37], [170, 37], [30, 113], [170, 113]].map(([x, z]) => ({ k: 'hole', x, z, d: 3.175, depth: 3, face: 'top' })).concat([{ k: 'hole', x: 100, z: 75, d: 12, depth: 6, face: 'top' }, { k: 'groove', axis: 'l', x: 100, z: 135, width: 6, depth: 2, face: 'top' }, { k: 'hole', x: 0, z: 75, d: 5, depth: 20, face: 'c' }]);
      const sh = shapeOf(it); sh.c[0] = { k: 'round', a: 20, b: 20 }; sh.c[2] = { k: 'round', a: 20, b: 20 }; machInvalidate();
      cvBits = JSON.parse(JSON.stringify(CV_BITS_START)); cvFromPanel(it); await new Promise(r => setTimeout(r, 700)); document.getElementById('toast').hidden = true;`);
    await shot("cut-in-carve.png");
  } finally { await app.close(); fs.rmSync(tmp, { recursive: true, force: true }); }
})().catch(e => { console.error(e); process.exit(1); });

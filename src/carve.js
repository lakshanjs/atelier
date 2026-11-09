// ---------- carving: the workspace ----------
// One board at a time, kept in P.carve. Text and shapes are stored as settings, and SVG art as a key to its bytes in TEXTURES,
// so the project stays small. The bits you own belong to the app, like the hardware catalogue, and a project keeps a copy of those it uses.
const cvCorn = (d, feed, plunge, step) => ({ id: 'corn-' + String(d).replace('.', '-'), type: 'flat', family: 'corn', name: 'Corn ' + d + ' mm', d, angle: 0, tip: 0, reach: 0, feed, plunge, rpm: 1000, step, over: 40, have: true });
// The speeds are the cautious ones from the machine's notes (a TTC 3018 PRO), not measured results. S1000 is full speed on it. All have a 3.175 mm shank.
const CV_BITS_START = [
  { id: 'flat-2f', type: 'flat', name: '3.175 mm flat, 2 flutes', d: 3.175, angle: 0, tip: 0, reach: 12, feed: 400, plunge: 100, rpm: 1000, step: .5, over: 40, have: true },
  { id: 'flat-1f', type: 'flat', name: '3.175 mm flat, 1 flute', d: 3.175, angle: 0, tip: 0, reach: 12, feed: 400, plunge: 100, rpm: 1000, step: .5, over: 40, have: true },
  { id: 'v-30', type: 'v', name: '30° V-bit', d: 3.175, angle: 30, tip: .1, reach: 0, feed: 300, plunge: 100, rpm: 1000, step: .3, over: 30, have: true },
  ...[.8, 1, 1.2, 1.4].map(d => cvCorn(d, 150, 50, .2)), ...[1.6, 1.8, 2, 2.2, 2.5].map(d => cvCorn(d, 200, 50, .3)), cvCorn(3.175, 300, 100, .5),
];
// what's shown, kept per user (carveview.js reads and keeps it)
const cvViewOpts = { wire: false, uncut: true, material: true, waste: true, rulers: true };
let cvBits = JSON.parse(JSON.stringify(CV_BITS_START)), cvSel = null, cvShowPaths = false, cvView = null, cvOpenBit = null, cvCornOpen = false;
// Thicknesses are the ones the design side already knows, so both sides agree.
const CV_WOODS = {
  bass: { name: BOARDS.bass.name, thick: BOARDS.bass.thick, feedPct: 100, stepPct: 100, why: 'Soft, and cuts cleanly.', rgb: [232, 208, 160], grain: .6, ink: '#5a3d22', edge: '#a98a5a' },
  ply: { name: BOARDS.ply.name, thick: BOARDS.ply.thick, feedPct: 75, stepPct: 75, why: 'Its glue layers are hard on bits, so go slower.', rgb: [222, 186, 138], grain: 1, ink: '#5a3d22', edge: '#8a6a42' },
  mdf: { name: BOARDS.mdf.name, thick: BOARDS.mdf.thick, feedPct: 100, stepPct: 100, why: 'Even and easy to cut, but very dusty.', rgb: [178, 142, 102], grain: 0, ink: '#3e2a17', edge: '#6e5236' },
  hard: { name: 'Hardboard', thick: [[2.5, '2.5 mm'], [3.2, '1/8"'], [6, '6 mm']], feedPct: 100, stepPct: 100, why: 'Dense but thin. Your notes use the normal speeds for it.', rgb: [128, 94, 64], grain: .12, ink: '#2c1c0f', edge: '#4d3622' },
  eco: { name: BOARDS.eco.name, thick: BOARDS.eco.thick, feedPct: 75, stepPct: 75, why: 'Its hard surface is tough on bits, so go slower.', rgb: [232, 226, 214], grain: .2, ink: '#6a5a44', edge: '#9c9180' },
};
const cvWood = board => CV_WOODS[board.wood] || CV_WOODS.bass;
// changes you make to a wood's speeds are remembered for next time, and each project keeps its own copy in its board
const CV_RATES_STORE = 'atelier-carve-woods';
let cvWoodRates = {}; try { cvWoodRates = JSON.parse(localStorage.getItem(CV_RATES_STORE)) || {}; } catch (e) {}
const cvRatesFor = key => ({ feedPct: CV_WOODS[key].feedPct, stepPct: CV_WOODS[key].stepPct, ...(cvWoodRates[key] || {}) });
function cvRatesKeep(key, field, v) { (cvWoodRates[key] = cvWoodRates[key] || {})[field] = v; try { localStorage.setItem(CV_RATES_STORE, JSON.stringify(cvWoodRates)); } catch (e) {} }
const cvHex = rgb => '#' + rgb.map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
const CV_DEFAULT = () => ({ board: { wood: 'bass', l: 203.2, w: 152.4, t: 3 }, items: [], safeZ: 6.35, tabW: 6.35, tabH: 1, workX: 300, workY: 180, maxRate: 1500, ramp: CV_RAMP, airZ: CV_AIR, zero: [0, 0], nextId: 1, ...(typeof machDefaults === 'function' ? machDefaults() : {}) });   // My machine's travel, speed and safe height, when set
const cvNow = () => { if (!P.carve) P.carve = CV_DEFAULT(); return P.carve; };
const cvBitOf = id => cvBits.find(b => b.id === id) || (P && P.carve && P.carve.bitsUsed && P.carve.bitsUsed[id]) || null;
const cvOwned = () => cvBits.filter(b => b.have);
const cvIsInch = () => ['in', 'ft', 'yd'].includes(unitKey());
const cvLen = mm => (cvIsInch() ? `${Math.round(mm / 25.4 * 1000) / 1000}"` : `${Math.round(mm * 100) / 100} mm`);   // decimals here: a depth rounded to 1/8" would mislead
const cvNum = mm => String(cvIsInch() ? Math.round(mm / 25.4 * 1000) / 1000 : Math.round(mm * 100) / 100);
const cvParse = s => { const t = String(s).trim(); return /^-?[\d.\s\/-]+$/.test(t) ? parseLen(`${t}${cvIsInch() ? 'in' : 'mm'}`) : parseLen(t); };
const cvItem = () => (P.carve ? P.carve.items.find(i => i.id === cvSel) : null) || null;
const cvEl = id => document.getElementById(id);

// ---------- smart values ----------
// A size, position or depth can follow a formula of the project's parameters, the same ones the design uses, like =Width/2.
// Change a parameter and everything following it changes too. A value changed by hand, or dragged, stops following its formula.
const CV_FX = { 'i.x': 'x', 'i.y': 'y', 'i.w': 'w', 'i.h': 'h', 'i.size': 'size', 'op.depth': 'depth', 'i.scaleW': 'w' };
// a copy is moved, so it doesn't keep following where the original's formulas put it
const cvClone = it => { const c = JSON.parse(JSON.stringify(it)); if (c.fx) { ['x', 'y'].forEach(k => { delete c.fx[k]; if (c.fxv) delete c.fxv[k]; }); if (!Object.keys(c.fx).length) { delete c.fx; delete c.fxv; } } return c; };
const cvFxGet = (it, k) => (k === 'depth' ? it.op && it.op.depth : it[k]);
const cvFxSet = (it, k, v) => { if (k === 'depth') it.op.depth = v; else it[k] = v; };
const cvFxOk = (it, key) => !!CV_FX[key] && (key !== 'i.scaleW' || it.type === 'svg' || it.type === 'relief');
let cvFxIssues = new Map();
function cvFxSolve() {   // returns the items whose formulas stopped because they were changed by hand
  cvFxIssues = new Map(); const dropped = []; if (typeof P === 'undefined' || !P || !P.carve) return dropped;
  P.carve.items.forEach(it => {
    if (!it.fx) return; it.fxv = it.fxv || {};
    Object.keys(it.fx).forEach(k => {
      const was = it.fxv[k];
      if (was != null && Math.abs(cvFxGet(it, k) - was) > .001) { delete it.fx[k]; delete it.fxv[k]; dropped.push(it); return; }
      try {
        let v = fxLenOf(fxEval(it.fx[k].e, it.fx[k].u, fxLook(null)), it.fx[k].u);
        if (k !== 'x' && k !== 'y' && !(v > 0)) { cvFxIssues.set(it.id + '.' + k, `It would be ${cvLen(v)}, so it's kept at ${cvLen(.1)}.`); v = .1; }
        cvFxSet(it, k, v); it.fxv[k] = v;
      } catch (e) { cvFxIssues.set(it.id + '.' + k, `=${it.fx[k].e}: ${e.message}.`); }
    });
    if (!Object.keys(it.fx).length) { delete it.fx; delete it.fxv; }
  });
  return dropped;
}
// a box that can hold a formula shows its value, and the formula while it's being typed in
const cvFxF = (it, key, label, val) => { const f = cvFxOk(it, key) && it.fx && it.fx[CV_FX[key]]; return cvF(key, label, val, f ? `class="hasfx" data-fxtext="=${esc(f.e)}" title="=${esc(f.e)}"` : ''); };
function cvParamsHtml() {
  const list = P.params || [], rows = list.map((p, i) => {
    let shown = '?'; try { const r = fxParamValue(p, null); shown = r.d ? cvNum(r.v) : String(r2(r.v)); } catch (e) {}
    const isF = !/^-?[\d.]+mm$/.test(p.e), bad = fxIssues.get(`p:0.${p.name}`);
    return `<div class="prm"><input type="text" data-cf="pn.${i}" value="${esc(p.name)}" aria-label="Name"><input type="text" data-cf="pv.${i}" ${isF ? `class="hasfx" data-fxtext="=${esc(p.e)}" title="=${esc(p.e)}"` : ''} value="${esc(shown)}" aria-label="${esc(p.name)} value"><button class="ic" data-cact="pdel" data-i="${i}" title="Delete ${esc(p.name)}" aria-label="Delete ${esc(p.name)}">${ic('x')}</button></div>${bad ? `<p class="fxbad">${esc(bad)}</p>` : ''}`;
  }).join('');
  return cvSec('smart', 'Smart values', (rows || '<p class="note">Name a size here, then type it into any size, position or depth, like =Width/2. The design uses the same ones.</p>') + '<div class="rowb"><button class="btn line" data-cact="padd">' + ic('plus') + 'Add</button></div>');
}

async function cvBitsStart() {
  let saved = null; try { saved = await kvGet('bits'); } catch (e) {}
  if (Array.isArray(saved) && saved.length) cvBits = saved;
  cvBitsAdopt();
}
const cvBitsSave = () => kvSet('bits', cvBits).catch(e => toast(`Couldn't save your bits: ${e && e.message}.`, true));
function cvBitsAdopt() { const used = P && P.carve && P.carve.bitsUsed; if (!used) return; let any = false; Object.values(used).forEach(b => { if (b && b.id && !cvBits.some(x => x.id === b.id)) { cvBits.push(JSON.parse(JSON.stringify(b))); any = true; } }); if (any) cvBitsSave(); }
function cvBitsSync() { const cv = P.carve; if (!cv) return; const used = {}; cv.items.forEach(i => { [i.op && cvBitOf(i.op.bit), cvClearBit(i, cvBitOf)].forEach(b => { if (b) used[b.id] = JSON.parse(JSON.stringify(b)); }); }); cv.bitsUsed = used; }
function cvEdit(fn) { edit(() => { fn(); cvBitsSync(); }); }   // edit() redraws everything, Carve included
const cvEveryday = list => list.slice().sort((a, b) => Math.abs(a.d - 3.175) - Math.abs(b.d - 3.175) || (a.family === 'corn') - (b.family === 'corn'));
function cvBestBit(kind) {
  const fit = cvOwned().filter(b => cvBitFits(kind, b));
  if (kind === 'line') return (fit.find(b => b.type === 'v') || cvEveryday(fit)[0] || {}).id || null;
  if (kind === 'vcarve') return (fit[0] || {}).id || null;
  if (kind === 'relief') return (cvEveryday(fit.filter(b => b.type === 'ball'))[0] || cvEveryday(fit.filter(b => b.type === 'flat'))[0] || fit[0] || {}).id || null;
  return (cvEveryday(fit)[0] || {}).id || null;
}
const CV_FINISH = .2;   // the skin a cut-out leaves for its last clean pass
// A V-carve starts with its level bottom cleared by whichever flat bit fits it best, for a smooth one.
const cvOpFor = (cv, kind) => ({ kind, bit: cvBestBit(kind), depth: kind === 'line' ? .3 : kind === 'relief' ? Math.min(6, cv.board.t / 2) : 1, through: kind === 'outside' || kind === 'inside', peck: true, tabs: 4, finish: kind === 'outside' || kind === 'inside' ? CV_FINISH : 0, clear: kind === 'vcarve' ? 'auto' : null });
const CV_JOBS_STORE = 'atelier-carve-jobs';
let cvJobsChosen = {}; try { cvJobsChosen = JSON.parse(localStorage.getItem(CV_JOBS_STORE)) || {}; } catch (e) {}
const cvStartKind = type => (type === 'relief' ? 'relief' : cvJobsChosen[type] || (type === 'svg' ? 'pocket' : 'line'));   // the job last chosen for this kind of thing
function cvRememberJob(type, kind) { if (kind === 'off') return; cvJobsChosen[type] = kind; try { localStorage.setItem(CV_JOBS_STORE, JSON.stringify(cvJobsChosen)); } catch (e) {} }

// ---------- adding things ----------
function cvAdd(fields) {
  const cv = cvNow(), it = { id: cv.nextId++, x: cv.board.l / 2, y: cv.board.w / 2, rot: 0, ...fields, op: cvOpFor(cv, cvStartKind(fields.type)) };
  cvEdit(() => { cv.items.push(it); }); cvSel = it.id; carveRender(); return it;
}
async function cvAddText(fields = {}) {
  const cv = cvNow(), font = fields.font || 'Arial', it = cvAdd({ type: 'text', text: 'Your text', font, size: Math.max(6, Math.min(cv.board.w / 5, 38)), spacing: 0, leading: 1, align: 'center', ...fields });
  await cvFontLoad(font); carveRender(); return it;
}
const cvAddRect = () => { const b = cvNow().board; return cvAdd({ type: 'rect', w: b.l * .5, h: b.w * .5 }); };
const cvAddCircle = () => { const b = cvNow().board, d = Math.min(b.l, b.w) * .5; return cvAdd({ type: 'circle', w: d, h: d }); };
async function cvAddSvgText(text) {
  const bytes = new TextEncoder().encode(text), key = `art:${crc32(bytes).toString(36)}-${bytes.length}`;
  const art = cvParseSvg(text);   // refuses anything unreadable before it's kept
  if (!TEXTURES[key]) { TEXTURES[key] = { bytes, avg: '#000000' }; kvSet('tex:' + key, TEXTURES[key]).catch(() => {}); }
  cvArtCache.set(key, art);
  const b = cvNow().board, fit = Math.min(b.l * .7 / art.w, b.w * .7 / art.h), real = art.mmW && art.mmW <= b.l && art.mmW * art.h / art.w <= b.w ? art.mmW : 0;
  const it = cvAdd({ type: 'svg', art: key, w: real || art.w * fit });
  if (art.textLeft) toast(`${art.textLeft} text ${art.textLeft === 1 ? 'piece was' : 'pieces were'} left out of the SVG. Convert text to paths in your drawing program, or add it here.`, true);
  return it;
}

// ---------- the board on screen ----------
const cvPathD = polys => polys.map(p => `M${p.map(q => `${r2(q[0])} ${r2(q[1])}`).join('L')}Z`).join('');
const cvOpenD = lines => lines.map(l => `M${l.pts.map(q => `${r2(q[0])} ${r2(q[1])}`).join('L')}${l.closed ? 'Z' : ''}`).join('');
const cvMatrix = it => { const r = -(it.rot || 0); return `translate(${r2(it.x)} ${r2(P.carve.board.w - it.y)}) rotate(${r}) scale(${it.mx ? -1 : 1} ${it.my ? 1 : -1})`; };
const CV_INK = { relief: 'none', drill: 'none', line: 'none', pocket: '#5a3d22', vcarve: '#5a3d22', outside: 'none', inside: 'none', off: 'none' };
// a relief shows as its height map, lighter where it's higher, lit from the back left
const cvReliefPics = new Map();
function cvReliefPic(it) {
  const map = cvReliefMap(it.art, it.up), key = it.art + '|' + (it.up || 'z'); if (!map) return '';
  if (cvReliefPics.has(key)) return cvReliefPics.get(key);
  const k = Math.min(1, 300 / Math.max(map.nx, map.ny)), W = Math.max(2, Math.round(map.nx * k)), H = Math.max(2, Math.round(map.ny * k)), c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d'), img = x.createImageData(W, H), at = (i, j) => map.H[Math.min(map.nx - 1, Math.round(i / k)) + Math.min(map.ny - 1, Math.round(j / k)) * map.nx];
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const h = at(i, j), lit = Math.max(.55, Math.min(1.25, 1 + ((at(Math.max(0, i - 1), j) - at(Math.min(W - 1, i + 1), j)) + (at(i, Math.min(H - 1, j + 1)) - at(i, Math.max(0, j - 1)))) * 6)), v = (60 + 175 * h) * lit, o = (i + j * W) * 4;
    img.data[o] = Math.min(255, v * 1.04); img.data[o + 1] = Math.min(255, v * .9); img.data[o + 2] = Math.min(255, v * .72); img.data[o + 3] = 255;
  }
  x.putImageData(img, 0, 0); const url = c.toDataURL('image/png'); cvReliefPics.set(key, url); return url;
}
function cvItemSvg(it) {
  if (cvNeverCut(it)) return cvSpecialSvg(it);
  if (it.type === 'relief') { const s = cvLocal(it), w = Math.max(s.w, 4), h = Math.max(s.h, 4), pic = cvReliefPic(it), ink = cvWood(P.carve.board).ink; return `<g class="cvitem" data-it="${it.id}" transform="${cvMatrix(it)}"><rect x="${-w / 2}" y="${-h / 2}" width="${w}" height="${h}" fill="${ink}" fill-opacity=".25"/>${pic && !cvViewOpts.wire ? `<image href="${pic}" x="${-w / 2}" y="${-h / 2}" width="${w}" height="${h}" preserveAspectRatio="none" opacity="${it.op && it.op.kind === 'off' ? .45 : .92}"/>` : ''}<rect x="${-w / 2}" y="${-h / 2}" width="${w}" height="${h}" fill="none" stroke="${ink}" stroke-width=".5"/></g>`; }
  const s = cvLocal(it), kind = it.op ? it.op.kind : 'off', w = Math.max(s.w, 4), h = Math.max(s.h, 4), hit = `<rect x="${(s.ox || 0) - w / 2}" y="${(s.oy || 0) - h / 2}" width="${w}" height="${h}" fill="transparent"/>`;
  const line = kind === 'line' || kind === 'off' || !s.regions.length, d = line && (it.type === 'svg' || !s.regions.length) ? cvOpenD(s.lines) : cvPathD(s.regions);
  const wire = cvViewOpts.wire;
  return `<g class="cvitem" data-it="${it.id}" transform="${cvMatrix(it)}">${hit}<path d="${d}" fill="${wire || CV_INK[kind] === 'none' ? 'none' : cvWood(P.carve.board).ink}" fill-rule="nonzero" stroke="${kind === 'off' ? '#8a7a64' : cvWood(P.carve.board).ink}" stroke-width="${!wire && (kind === 'pocket' || kind === 'vcarve') ? 0 : .5}" ${kind === 'outside' || kind === 'inside' ? 'stroke-dasharray="2 1.5"' : ''} vector-effect="none"/></g>`;
}
function cvHandles(it, px) {
  const s = cvLocal(it), w = Math.max(s.w, 4) / 2 + 3 * px, h = Math.max(s.h, 4) / 2 + 3 * px, H = 5 * px, up = h + 22 * px, stroke = 1.5 * px;
  const corner = (x, y, k) => `<rect class="cvh" data-h="${k}" x="${x - H}" y="${y - H}" width="${H * 2}" height="${H * 2}" fill="#fff" stroke="#e5a900" stroke-width="${stroke}"/>`;
  return `<g transform="${cvMatrix(it)}"><g transform="translate(${s.ox || 0} ${s.oy || 0})"><rect x="${-w}" y="${-h}" width="${w * 2}" height="${h * 2}" fill="none" stroke="#ffc928" stroke-width="${stroke}" pointer-events="none"/><line x1="0" y1="${h}" x2="0" y2="${up}" stroke="#ffc928" stroke-width="${stroke}" pointer-events="none"/>${corner(-w, -h, 'a')}${corner(w, -h, 'b')}${corner(w, h, 'c')}${corner(-w, h, 'd')}<circle class="cvh" data-h="r" cx="0" cy="${up}" r="${H}" fill="#fff" stroke="#e5a900" stroke-width="${stroke}"/></g></g>`;
}
function cvPathsSvg(cv) {
  if (!cvShowPaths) return ''; let s = '';
  cv.items.forEach(it => {
    if (!it.op || it.op.kind === 'off') return; const main = cvBitOf(it.op.bit); if (!main || !cvBitFits(it.op.kind, main)) return;
    [cvClearBit(it, cvBitOf), main].forEach(bit => {
      if (!bit) return; const { chains } = cvItemPaths(cv, it, bit); if (!chains.length) return;
      const d = chains.map(c => `M${c.map(q => `${r2(q[0])} ${r2(cv.board.w - q[1])}`).join('L')}`).join('');
      s += `<path d="${d}" fill="none" stroke="#0f7d8c" stroke-opacity="${bit.type === 'v' ? .55 : .3}" stroke-width="${bit.type === 'v' ? .25 : bit.d}" stroke-linejoin="round" stroke-linecap="round" pointer-events="none"/>`;
    });
  });
  return s;
}
// tiles show as dashed lines with their number, and each later tile's cross where it's zeroed
function cvTilesSvg(cv, px) {
  if (!cv.tile) return ''; const tiles = cvTiles(cv); if (tiles.length < 2) return '';
  const W = cv.board.w, ink = '#20262a', mark = CV_MARK;
  return '<g pointer-events="none" id="cvTileMarks">' + tiles.map(t => (t.x0 > 0 ? `<line x1="${t.x0}" y1="${W - t.y0}" x2="${t.x0}" y2="${W - t.y1}" stroke="${ink}" stroke-opacity=".55" stroke-width="${px}" stroke-dasharray="${6 * px} ${4 * px}"/>` : '') + (t.y0 > 0 ? `<line x1="${t.x0}" y1="${W - t.y0}" x2="${t.x1}" y2="${W - t.y0}" stroke="${ink}" stroke-opacity=".55" stroke-width="${px}" stroke-dasharray="${6 * px} ${4 * px}"/>` : '')
    + (t.n ? `<path d="M${t.x0 - mark} ${W - t.y0}H${t.x0 + mark}M${t.x0} ${W - t.y0 - mark}V${W - t.y0 + mark}" stroke="#c0392b" stroke-width="${1.5 * px}"/>` : '')
    + `<text x="${(t.x0 + t.x1) / 2}" y="${W - (t.y0 + t.y1) / 2}" text-anchor="middle" font-size="${28 * px}" fill="${ink}" fill-opacity=".18" font-family="Barlow,sans-serif" font-weight="600">${t.n + 1}</text>`).join('') + '</g>';
}
function cvFit() {
  const svg = cvEl('cvStage'), b = cvNow().board, W = svg.clientWidth || 800, H = svg.clientHeight || 600, pad = Math.max(b.l, b.w) * .12, k = Math.max((b.l + pad * 2) / W, (b.w + pad * 2) / H);
  cvView = { x: b.l / 2 - W * k / 2, y: b.w / 2 - H * k / 2, k };
}
// Ruler marks between lo and hi (board mm), counted from origin (the zero), in the units shown: labels at least minPx
// apart, with smaller marks between when there's room.
function cvRulerTicks(lo, hi, origin, mmPerPx, minPx = 56) {
  const inch = cvIsInch(), u = inch ? 25.4 : 1, steps = inch ? [1 / 16, 1 / 8, 1 / 4, 1 / 2, 1, 2, 4, 6, 12, 24, 48] : [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000];
  const s = steps.find(v => v * u / mmPerPx >= minPx) || steps[steps.length - 1], major = s * u;
  let sub = inch ? 4 : { 1: 10, 2: 4, 5: 5 }[String(s)[0]] || 5;
  while (sub > 1 && major / sub / mmPerPx < 6) sub = sub === 10 ? 5 : sub === 4 ? 2 : 1;
  const minor = major / sub, n0 = Math.ceil((lo - origin) / minor - 1e-9), n1 = Math.floor((hi - origin) / minor + 1e-9), out = [];
  if (!(n1 >= n0) || n1 - n0 > 5000) return out;
  for (let n = n0; n <= n1; n++) { const isMajor = n % sub === 0; out.push({ at: origin + n * minor, major: isMajor, half: !isMajor && sub % 2 === 0 && n % (sub / 2) === 0, label: isMajor ? cvRulerNum(n * minor / u) : '' }); }
  return out;
}
const cvRulerNum = v => { const r = Math.round(v * 1000) / 1000; return String(Object.is(r, -0) ? 0 : r).replace('-', '−'); };
// Rulers along the top and left of the flat board, measured from the zero, as the machine counts
function cvRulersSvg(px, W, H, zx, zy, b) {
  const x0 = cvView.x, y0 = cvView.y, x1 = x0 + W * px, y1 = y0 + H * px, s = 20 * px, txt = (x, y, t, rot) => `<text x="${x}" y="${y}" font-size="${10 * px}"${rot ? ` transform="rotate(-90 ${x} ${y})"` : ''}>${t}</text>`;
  let d = '', labels = '';
  cvRulerTicks(x0 + s, x1, zx, px).forEach(t => { const len = t.major ? s * .5 : t.half ? s * .32 : s * .2; d += `M${t.at} ${y0 + s}v${-len}`; if (t.label) labels += txt(t.at + 3 * px, y0 + 10 * px, t.label); });
  cvRulerTicks(b.w - y1, b.w - y0 - s, zy, px).forEach(t => { const len = t.major ? s * .5 : t.half ? s * .32 : s * .2, sy = b.w - t.at; d += `M${x0 + s} ${sy}h${-len}`; if (t.label) labels += txt(x0 + 10 * px, sy - 3 * px, t.label, true); });
  return `<g pointer-events="none" class="cvRuler" font-family="Barlow,sans-serif" fill="var(--soft)"><rect x="${x0}" y="${y0}" width="${W * px}" height="${s}" fill="var(--panel)"/><rect x="${x0}" y="${y0}" width="${s}" height="${H * px}" fill="var(--panel)"/>`
    + `<path d="${d}" stroke="var(--soft)" stroke-width="${px}" fill="none"/>${labels}<path d="M${x0} ${y0 + s}H${x1}M${x0 + s} ${y0}V${y1}" stroke="var(--line)" stroke-width="${px}"/>`
    + `<rect x="${x0}" y="${y0}" width="${s}" height="${s}" fill="var(--panel)"/><text x="${x0 + s / 2}" y="${y0 + s / 2 + 3.5 * px}" text-anchor="middle" font-size="${9 * px}">${cvIsInch() ? 'in' : 'mm'}</text></g>`;
}
let cvPathsTimer = 0;
function cvStageRender() {
  const svg = cvEl('cvStage'), cv = cvNow(), b = cv.board; if (!cvView) cvFit();
  const W = svg.clientWidth || 800, H = svg.clientHeight || 600, px = cvView.k; svg.setAttribute('viewBox', `${cvView.x} ${cvView.y} ${W * px} ${H * px}`);
  const unit = cvIsInch() ? 25.4 : 10; let grid = ''; if (unit / px > 12) { for (let x = unit; x < b.l - .01; x += unit) grid += `M${r2(x)} 0V${b.w}`; for (let y = unit; y < b.w - .01; y += unit) grid += `M0 ${r2(b.w - y)}H${b.l}`; }
  const it = cvItem(), mark = 14 * px, [zx, zy] = cvZeroAt(cv), zsy = b.w - zy, zLeft = zx < b.l / 2 + .01, zFront = zy < b.w / 2 + .01;
  const wood = cvWood(b), base = cvHex(wood.rgb), gr = cvHex(wood.rgb.map(v => v * .72)), g1 = (.42 * wood.grain).toFixed(3), g2 = (.22 * wood.grain).toFixed(3);
  svg.innerHTML = `<defs><pattern id="cvGrain" width="240" height="46" patternUnits="userSpaceOnUse"><rect width="240" height="46" fill="${base}"/><path d="M0 7C60 3 110 12 240 7M0 19C80 24 150 14 240 19M0 31C50 28 170 37 240 31M0 41C90 38 140 45 240 41" fill="none" stroke="${gr}" stroke-opacity="${g1}" stroke-width=".55"/><path d="M0 13C70 16 160 9 240 13M0 25C60 22 180 29 240 25" fill="none" stroke="${gr}" stroke-opacity="${g2}" stroke-width="1.3"/></pattern></defs><rect class="cvboard" x="0" y="0" width="${b.l}" height="${b.w}" fill="url(#cvGrain)"/><path d="${grid}" stroke="#7a5a35" stroke-opacity=".12" stroke-width="${px}" fill="none" pointer-events="none"/>`
    + cvTilesSvg(cv, px) + cv.items.map(cvItemSvg).join('') + (typeof cvGcodeSvg === 'function' ? cvGcodeSvg(px) : '') + `<g id="cvCuts" pointer-events="none"></g>`
    + `<g pointer-events="none" id="cvZeroMark"><line x1="${zx}" y1="${zsy}" x2="${zx + mark * 2}" y2="${zsy}" stroke="#c0392b" stroke-width="${2 * px}"/><line x1="${zx}" y1="${zsy}" x2="${zx}" y2="${zsy - mark * 2}" stroke="#1e8449" stroke-width="${2 * px}"/><circle cx="${zx}" cy="${zsy}" r="${4 * px}" fill="#20262a"/><text x="${zx + (zLeft ? -6 : 6) * px}" y="${zsy + (zFront ? 14 : -8) * px}" font-size="${11 * px}" text-anchor="${zLeft ? 'end' : 'start'}" fill="var(--soft)" font-family="Barlow,sans-serif">Zero</text></g><g pointer-events="none">`
    + `<text x="${b.l / 2}" y="${-8 * px}" text-anchor="middle" font-size="${12 * px}" fill="var(--soft)" font-family="Barlow,sans-serif">${esc(cvLen(b.l))}</text><text x="${b.l + 8 * px}" y="${b.w / 2}" font-size="${12 * px}" fill="var(--soft)" font-family="Barlow,sans-serif">${esc(cvLen(b.w))}</text></g>`
    + cvPickedSvg(px) + (typeof machPickSvg === 'function' ? machPickSvg(px) : '') + '<g id="cvPen" pointer-events="none"></g>' + (cvViewOpts.rulers ? cvRulersSvg(px, W, H, zx, zy, b) : '');
  clearTimeout(cvPathsTimer); cvPathsTimer = setTimeout(cvCutsRender, cvDrag ? 300 : 30);   // bit paths can take a moment, so the board draws first
  if (CV3D.on && typeof cv3dOverlay === 'function') cv3dOverlay();
}
function cvCutsRender() { const g = cvEl('cvCuts'); if (!g || cvDrag || !cvOpen()) return; g.innerHTML = cvPathsSvg(cvNow()) + cvUncutSvg(cvNow()); cvChecksRender(); }
const cvOpen = () => cvEl('carve').classList.contains('open');

// ---------- seeing it carved ----------
// A shader follows each pixel's ray down to the carved surface. It only draws when the view changes, so it costs nothing when still.
const CV3D = { on: false, renderer: null, scene: null, camera: null, controls: null, mesh: null, key: '', timer: 0 };
const CV3D_FRAG = `
  precision highp float; precision highp sampler2D;
  uniform sampler2D uH; uniform vec2 uGrid; uniform float uCell, uT, uGrain; uniform vec2 uBoard; uniform vec3 uCol;
  varying vec3 vP;
  // the surface between grid points is a smooth blend, so walls come out as smooth curves with no triangles to show
  float H(vec2 xy) {
    vec2 f = clamp(xy / uCell, vec2(0.0), uGrid - 1.001), w = fract(f); ivec2 a = ivec2(floor(f));
    float p = texelFetch(uH, a, 0).r, q = texelFetch(uH, a + ivec2(1, 0), 0).r, r = texelFetch(uH, a + ivec2(0, 1), 0).r, s = texelFetch(uH, a + ivec2(1, 1), 0).r;
    return mix(mix(p, q, w.x), mix(r, s, w.x), w.y);
  }
  float grainAt(vec2 q) { float ring = sin(q.y * .55 + 2.4 * sin(q.x * .012 + q.y * .05) + sin(q.x * .05 - q.y * .02) * .6), fine = sin(q.y * 3.1 + q.x * .03 + 1.5 * sin(q.x * .021)) * .5; return 1.0 + (ring * .035 + fine * .03) * uGrain; }
  vec3 shade(vec3 p) {
    float e = uCell * 1.2; vec3 n = normalize(vec3(H(p.xy - vec2(e, 0.0)) - H(p.xy + vec2(e, 0.0)), H(p.xy - vec2(0.0, e)) - H(p.xy + vec2(0.0, e)), 2.0 * e));
    float lit = max(0.0, dot(n, normalize(vec3(-.45, .55, .7)))) / .7, inCut = smoothstep(0.0, .03, -p.z), cut = mix(1.0, max(.72, .92 + p.z * .05), inCut);
    return uCol * min(1.12, .32 + lit * .72) * grainAt(p.xy) * cut;
  }
  void main() {
    vec3 rd = normalize(vP - cameraPosition), p = vP;
    if (p.z < -.001 && p.z < H(p.xy) - .001) {   // came in through the board's edge or underside
      float side = p.z < -uT + .001 ? .5 : abs(p.x) < .001 ? .68 : abs(p.x - uBoard.x) < .001 ? .75 : abs(p.y) < .001 ? .82 : .62;
      gl_FragColor = vec4(uCol * side, 1.0); return;
    }
    float st = min(uCell * .5 / max(length(rd.xy), .001), uT / 48.0 / max(abs(rd.z), .01));
    bool hit = p.z <= H(p.xy) + .0005; vec3 prev = p;
    for (int i = 0; i < 512 && !hit; i++) {
      prev = p; p += rd * st;
      if (p.x < 0.0 || p.y < 0.0 || p.x > uBoard.x || p.y > uBoard.y || p.z < -uT || p.z > .001) discard;   // straight through a hole
      hit = p.z <= H(p.xy);
    }
    if (!hit) discard;
    for (int i = 0; i < 7; i++) { vec3 m = (prev + p) * .5; if (m.z <= H(m.xy)) p = m; else prev = m; }
    gl_FragColor = vec4(shade(p), 1.0);
  }
`;
function cv3dMesh(map) {
  const { H, nx, ny, cell, l, w, t } = map, wood = cvWood(cvNow().board), tex = new THREE.DataTexture(H, nx, ny, THREE.RedFormat, THREE.FloatType);
  tex.internalFormat = 'R32F'; tex.minFilter = tex.magFilter = THREE.NearestFilter; tex.generateMipmaps = false; tex.needsUpdate = true;
  const mat = new THREE.ShaderMaterial({ toneMapped: false, uniforms: { uH: { value: tex }, uGrid: { value: new THREE.Vector2(nx, ny) }, uCell: { value: cell }, uT: { value: t }, uGrain: { value: wood.grain }, uBoard: { value: new THREE.Vector2((nx - 1) * cell, (ny - 1) * cell) }, uCol: { value: new THREE.Vector3(...wood.rgb.map(v => v / 255)) } }, vertexShader: 'varying vec3 vP; void main() { vec4 q = modelMatrix * vec4(position, 1.0); vP = q.xyz; gl_Position = projectionMatrix * viewMatrix * q; }', fragmentShader: CV3D_FRAG });
  const bx = (nx - 1) * cell, by = (ny - 1) * cell, box = new THREE.Mesh(new THREE.BoxGeometry(bx, by, t), mat); box.position.set(bx / 2, by / 2, -t / 2); box.frustumCulled = false;
  return box;
}
function cv3dDispose() { if (!CV3D.mesh) return; CV3D.scene.remove(CV3D.mesh); CV3D.mesh.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) { if (o.material.uniforms) o.material.uniforms.uH.value.dispose(); o.material.dispose(); } }); CV3D.mesh = null; }
const cv3dDraw = () => { if (CV3D.on && CV3D.renderer) { CV3D.renderer.render(CV3D.scene, CV3D.camera); if (typeof cv3dOverlay === 'function') cv3dOverlay(); } };
function cv3dSize() {
  const box = cvEl('cv3d'), W = box.clientWidth, H = box.clientHeight; if (!W || !H || !CV3D.renderer) return;
  CV3D.renderer.setSize(W, H); CV3D.camera.aspect = W / H; CV3D.camera.updateProjectionMatrix(); cv3dDraw();
}
function cv3dAim() {
  const { l, w } = cvNow().board, aspect = CV3D.camera.aspect, span = Math.max(l, w * aspect, l * 1.5 / aspect) * 1.25;   // a narrow view, side by side, stands further back
  CV3D.controls.target.set(l / 2, w / 2, 0); CV3D.camera.position.set(l / 2, w / 2 - span * .62, span * .95); CV3D.camera.near = span / 200; CV3D.camera.far = span * 20; CV3D.camera.updateProjectionMatrix(); CV3D.controls.update(); cv3dDraw();
}
function cv3dSetup() {
  if (CV3D.renderer) return;
  const r = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' }); r.setPixelRatio(Math.max(2, window.devicePixelRatio || 1));   // drawn at double size, so edges are soft
  cvEl('cv3d').insertBefore(r.domElement, cvEl('cv3dNote'));
  const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(35, 1, 1, 10000); cam.up.set(0, 0, 1);
  const ctl = new THREE.OrbitControls(cam, r.domElement); ctl.maxPolarAngle = Math.PI * .92; ctl.addEventListener('change', cv3dDraw);
  r.domElement.addEventListener('contextmenu', e => e.preventDefault());
  Object.assign(CV3D, { renderer: r, scene, camera: cam, controls: ctl });
  if (typeof cv3dWire === 'function') cv3dWire(r.domElement);
}
function cv3dBake() {
  if (!CV3D.on) return;
  if (CV3D.gcode) { cvGcodeBake(); return; }   // a G-code file being looked at
  const cv = cvNow(), key = JSON.stringify([cv.board, cv.items, cv.tabW, cv.tabH, cvRampOf(cv), cvBits, Object.keys(cvFontsLoadedKey())]); if (key === CV3D.key && CV3D.mesh) return;
  cvPlayStop();
  const S = cvCarveSteps(cv, cvBitOf), map = cvCarveGrid(cv); S.steps.forEach(s => cvStamp(map, s.a, s.b, s.bit));
  const fresh = cv3dMesh(map); cv3dDispose(); CV3D.mesh = fresh; CV3D.scene.add(fresh); CV3D.key = key;
  CV3D.play = { ...S, map, t: S.total, upto: S.steps.length };   // shown finished, ready to play from the start
  cvPlayShow(); cv3dExtras(); cv3dDraw();
}

// ---------- playing the cut ----------
// The surface starts flat and each move is cut into it as the time passes, at a multiple of the machine's own speed.
// Going back starts again from flat. The bit is drawn where it is, to its own size.
let cvPlayFrame = 0, cvPlayLast = 0;
function cvPlaySeek(t) {
  const P3 = CV3D.play; if (!P3) return; t = Math.max(0, Math.min(P3.total, t));
  if (t < P3.t) { P3.map.H.fill(0); P3.upto = 0; }
  while (P3.upto < P3.steps.length && P3.steps[P3.upto].t <= t + 1e-9) { const s = P3.steps[P3.upto++]; cvStamp(P3.map, s.a, s.b, s.bit); }
  P3.t = t; if (CV3D.mesh) CV3D.mesh.material.uniforms.uH.value.needsUpdate = true;
  cvPlayShow(); cv3dDraw();
}
function cvPlayTool() {   // the bit, standing where it is now
  const P3 = CV3D.play, s = P3 && P3.upto > 0 && P3.upto < P3.steps.length ? P3.steps[P3.upto - 1] : null;
  if (CV3D.tool && (!s || CV3D.tool.userData.bit !== s.bit)) { CV3D.scene.remove(CV3D.tool); CV3D.tool.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); CV3D.tool = null; }
  if (!s) return;
  if (!CV3D.tool) {
    const b = s.bit, R = b.d / 2, mat = new THREE.MeshBasicMaterial({ color: 0x8d979b, transparent: true, opacity: .8, depthTest: false }), g = new THREE.Group(), shank = 25;
    if (b.type === 'v') { const tan = Math.tan(Math.max(5, b.angle) / 2 * Math.PI / 180), h = Math.max(.2, (R - (b.tip || 0) / 2) / tan), cone = new THREE.Mesh(new THREE.CylinderGeometry(R, Math.max(.01, (b.tip || 0) / 2), h, 24), mat); cone.rotation.x = Math.PI / 2; cone.position.z = h / 2; g.add(cone); const top = new THREE.Mesh(new THREE.CylinderGeometry(R, R, shank, 24), mat.clone()); top.rotation.x = Math.PI / 2; top.position.z = h + shank / 2; g.add(top); }
    else if (b.type === 'ball') { const body = new THREE.Mesh(new THREE.CylinderGeometry(R, R, shank, 24), mat); body.rotation.x = Math.PI / 2; body.position.z = R + shank / 2; g.add(body); const end = new THREE.Mesh(new THREE.SphereGeometry(R, 24, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), mat.clone()); end.rotation.x = -Math.PI / 2; end.position.z = R; g.add(end); }
    else { const body = new THREE.Mesh(new THREE.CylinderGeometry(R, R, shank, 24), mat); body.rotation.x = Math.PI / 2; body.position.z = shank / 2; g.add(body); }
    g.userData.bit = b; g.renderOrder = 5; CV3D.tool = g; CV3D.scene.add(g);
  }
  CV3D.tool.position.set(s.b[0], s.b[1], s.b[2]);
}
function cvPlayShow() {
  const P3 = CV3D.play, bar = cvEl('cvPlay'); if (!bar) return; bar.hidden = !P3 || !P3.steps.length; if (!P3 || !P3.steps.length) return;
  cvEl('cvPlayAt').value = Math.round(P3.t / Math.max(P3.total, 1e-9) * 1000);
  const playing = !!cvPlayFrame, btn = cvEl('cvPlayBtn'); btn.innerHTML = ic(playing ? 'pause' : 'play'); btn.title = playing ? 'Pause (Space)' : 'Play the cut (Space)'; btn.setAttribute('aria-label', playing ? 'Pause' : 'Play the cut');
  const part = P3.parts.filter(p => p.t <= P3.t + 1e-9).pop() || P3.parts[0];
  const now = P3.upto > 0 ? P3.steps[P3.upto - 1] : null;
  cvEl('cvPlayText').textContent = `${Math.round(P3.t)} of ${Math.max(1, Math.round(P3.total))} min` + (part && part.gcode ? `  ·  ${part.bit.name}, line ${now ? now.line : part.line}` : part ? `  ·  File ${part.file + 1}, ${part.bit.name}: ${(part.clearing ? cvSecondWhat(part.it) : CV_JOB_SHORT[part.it.op.kind]).toLowerCase()} ${cvItemName(part.it)}` : '');
  cvPlayTool();
}
function cvPlayTick(now) {
  const P3 = CV3D.play; if (!P3 || !CV3D.on) { cvPlayFrame = 0; return; }
  const dt = Math.min(100, now - (cvPlayLast || now)); cvPlayLast = now;
  cvPlaySeek(P3.t + dt / 60000 * (+cvEl('cvPlaySpeed').value || 30));
  if (P3.t >= P3.total) { cvPlayStop(); return; }
  cvPlayFrame = requestAnimationFrame(cvPlayTick);
}
function cvPlayStart() { const P3 = CV3D.play; if (!P3 || !P3.steps.length || cvPlayFrame) return; if (P3.t >= P3.total) cvPlaySeek(0); cvPlayLast = 0; cvPlayFrame = requestAnimationFrame(cvPlayTick); cvPlayShow(); }
function cvPlayStop() { if (cvPlayFrame) cancelAnimationFrame(cvPlayFrame); cvPlayFrame = 0; if (CV3D.play) cvPlayShow(); }
function cvPlayNextPart() { const P3 = CV3D.play; if (!P3) return; cvPlayStop(); const next = P3.parts.find(p => p.t > P3.t + 1e-6); cvPlaySeek(next ? next.t : P3.total); }
const cvFontsLoadedKey = () => Object.fromEntries([...cvFonts.parsed.entries()].filter(e => e[1]).map(e => [e[0], 1]));
function cv3dSchedule() { if (!CV3D.on) return; clearTimeout(CV3D.timer); CV3D.timer = setTimeout(cv3dBake, cvLayout === 'split' ? 300 : 120); }   // side by side, it waits for a pause in the changes
function cv3dShow(on) {
  if (!on) cvPlayStop();
  if (typeof cvLayoutShow === 'function') cvLayoutShow(on ? (cvLayout === 'board' ? '3d' : cvLayout) : 'board');
  CV3D.on = on; cvEl('cv3d').hidden = !on; cvEl('cv3dBtn').classList.toggle('on', on); cvEl('cv3dBtn').setAttribute('aria-pressed', on); document.body.classList.toggle('carve3d', on);
  if (on) { cvEl('cv3d').style.background = isDark() ? '#272e31' : '#e4e9e7'; cv3dSetup(); CV3D.scene.background = new THREE.Color(isDark() ? 0x272e31 : 0xe4e9e7); cv3dSize(); cv3dAim(); cv3dBake(); cv3dExtras(); }
  cvView = null; if (cvOpen()) cvStageRender();   // the board has a different space now
}

// ---------- the side panel ----------
const cvF = (key, label, val, extra = '') => `<label class="field">${label}<input type="text" data-cf="${key}" value="${esc(val)}" ${extra}></label>`;
const cvClosedSecs = new Set(['machine', 'smart', 'tools']);   // folded until opened, for this session
const cvMoreOpen = new Set();
let cvPickOpenFor = null;   // the item whose full list of bits is showing
const cvMoreHtml = (key, body) => '<details class="cvmore" data-cmore="' + key + '"' + (cvMoreOpen.has(key) ? ' open' : '') + '><summary>More settings</summary>' + body + '</details>';
// ---------- the depth gauge ----------
// A slice through the board, to scale from top to bottom: the bit standing in the groove it cuts, the depth marked in tape
// yellow, and how much wood is left under it. The slider under it sets the depth; the box above takes an exact one.
function cvGaugeSvg(cv, bit, depth) {
  const W = 260, top = 24, H = 44, t = cv.board.t, k = H / t, d = Math.max(0, Math.min(depth, t)), y = top + d * k, F = n => Math.round(n * 100) / 100, cx = 46;
  const wood = cvWood(cv.board), base = cvHex(wood.rgb), grainC = cvHex(wood.rgb.map(v => v * .72)), steel = '#c3c9cb', dark = '#3f484c';
  const R = bit ? bit.d / 2 : 1.6, half = Math.max(6, Math.min(34, R * k)), v = bit && bit.type === 'v', ball = bit && bit.type === 'ball';
  let groove, tool;
  if (v) { const tan = Math.tan(Math.max(5, bit.angle) / 2 * Math.PI / 180), hw = Math.max(3, Math.min(34, d * k * tan)); groove = `M${F(cx - hw)} ${top}L${cx} ${F(y)}L${F(cx + hw)} ${top}Z`; const sh = Math.max(hw, 6); tool = `<path d="M${F(cx - sh)} 0V${F(y - sh / tan)}L${cx} ${F(y)}L${F(cx + sh)} ${F(y - sh / tan)}V0Z" fill="${steel}" stroke="${dark}" stroke-linejoin="round"/>`; }
  else if (ball) { const c = y - half; groove = c >= top ? `M${F(cx - half)} ${top}V${F(c)}A${F(half)} ${F(half)} 0 0 0 ${F(cx + half)} ${F(c)}V${top}Z` : (() => { const hw = Math.sqrt(Math.max(0, half * half - (top - c) ** 2)); return `M${F(cx - hw)} ${top}A${F(half)} ${F(half)} 0 0 0 ${F(cx + hw)} ${top}Z`; })(); tool = `<path d="M${F(cx - half)} 0V${F(c)}A${F(half)} ${F(half)} 0 0 0 ${F(cx + half)} ${F(c)}V0Z" fill="${steel}" stroke="${dark}"/>`; }
  else { groove = `M${F(cx - half)} ${top}V${F(y)}H${F(cx + half)}V${top}Z`; tool = `<rect x="${F(cx - half)}" y="0" width="${F(half * 2)}" height="${F(y)}" fill="${steel}" stroke="${dark}"/>`; }
  const grain = [.3, .55, .8].map((f, i) => `<path d="M0 ${F(top + H * f)}C${W * .3} ${F(top + H * f - 2 + i)} ${W * .6} ${F(top + H * f + 2 - i)} ${W} ${F(top + H * f)}" fill="none" stroke="${grainC}" stroke-opacity=".45" stroke-width=".8"/>`).join('');
  // the slot the bit has cut so far, seen along its way, with the depth marked along its floor
  const tx = 150, slot = d > 1e-6 ? `<rect x="${cx}" y="${top}" width="${tx - cx}" height="${F(d * k)}" fill="var(--panel)"/>` : '', through = d >= t - 1e-6;
  const label = through ? 'Right through' : cvLen(d) + ' deep', left = t - d, tw = label.length * 6 + 12, tagY = Math.max(top + 8, Math.min(top + H - 8, y));
  return `<svg viewBox="0 0 ${W} ${top + H + 2}" role="img" aria-label="${esc(label)}, in a board ${esc(cvLen(t))} thick"><rect x="0" y="${top}" width="${W}" height="${H}" fill="${base}"/>${grain}<path d="${groove}" fill="var(--panel)"/>${slot}<rect x=".5" y="${top}" width="${W - 1}" height="${H}" fill="none" stroke="${wood.edge}"/>${tool}`
    + (d > 1e-6 ? `<line x1="${F(cx + half)}" y1="${F(y - 1)}" x2="${tx}" y2="${F(y - 1)}" stroke="#ffc928" stroke-width="2"/>` : '')
    + `<rect x="${tx + 4}" y="${F(tagY - 8)}" width="${tw}" height="16" rx="2" fill="#ffc928" stroke="#20262a" stroke-width=".7"/><text x="${tx + 4 + tw / 2}" y="${F(tagY + 3.5)}" text-anchor="middle" font-family="Barlow,sans-serif" font-size="11" font-weight="600" fill="#20262a">${esc(label)}</text>`
    + (left > 1e-6 && (top + H) - (tagY + 8) > 11 ? `<text x="${W - 6}" y="${top + H - 4}" text-anchor="end" font-family="Barlow,sans-serif" font-size="10.5" fill="#20262a" fill-opacity=".75">${esc(cvLen(left))} left under it</text>` : '') + '</svg>';
}
const cvGaugeHtml = (cv, bit, depth) => { const t = cv.board.t, step = cvIsInch() ? 25.4 / 64 : .1; return '<div class="gauge"><div class="gsvg">' + cvGaugeSvg(cv, bit, depth) + '</div><input type="range" data-cf="op.depthR" min="' + step + '" max="' + t + '" step="' + step + '" value="' + Math.min(t, depth) + '" aria-label="Depth, from the top of the board to its bottom"></div>'; };
const cvSec = (key, title, body) => '<details class="sec" data-csec="' + key + '"' + (cvClosedSecs.has(key) ? '' : ' open') + '><summary>' + title + '</summary>' + body + '</details>';
// what each job does, shown on a letter
const CV_JOB_SHORT = { relief: '3D relief', line: 'Engrave', pocket: 'Pocket', vcarve: 'V-carve', drill: 'Drill', outside: 'Cut around', inside: 'Cut inside', off: "Don't cut" };
const CV_JOB_WHAT = { relief: 'Carves the model as a relief: its top at the board\'s surface, its lowest point at the depth. The bit steps down in passes, then runs over the surface once more to smooth it.', drill: 'Drills straight down at the middle of each shape, the size of the bit. A V-bit makes spot dimples for a corn bit to follow.', line: 'Cuts a thin line along the outline, or once along each stroke of a single-line font. Quick, and good for lettering.', pocket: 'Clears the whole shape to one depth, with a flat bottom.', vcarve: 'Sharp, chiselled edges with a V-bit. Slow with a narrow bit.', outside: 'Cuts the piece free from the board, with tabs to hold it.', inside: 'Cuts a hole the shape of the outline.', off: 'Stays on the board as a guide, and is not cut.' };
function cvJobArt(kind) {
  const A = 'M20 36 30 8h4l10 28h-6l-2.5-8h-7L26 36ZM30 23h4l-2-8Z', ink = '#3b2814';
  const art = { line: '<path d="' + A + '" fill="none" stroke="' + ink + '" stroke-width="1"/>', pocket: '<path d="' + A + '" fill="#5a3d22" fill-rule="evenodd"/>',
    vcarve: '<path d="' + A + '" fill="#5a3d22" fill-rule="evenodd"/><path d="M23 35 32 10 41 35M27.5 28h9" fill="none" stroke="#c9a875" stroke-width=".7"/>',
    outside: '<path d="' + A + '" fill="#cbb088" fill-rule="evenodd"/><path d="M15 39 27 5h10l12 34Z" fill="none" stroke="' + ink + '" stroke-width="1" stroke-dasharray="2.5 1.5"/>',
    drill: '<path d="' + A + '" fill="none" stroke="#9c8a6f" stroke-width=".8"/>' + [[24, 33], [32, 11], [40, 33], [32, 25]].map(p => '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="2.6" fill="#3b2814"/>').join(''),
    inside: '<path d="' + A + '" fill="#f6efe2" fill-rule="evenodd" stroke="' + ink + '" stroke-width="1" stroke-dasharray="2.5 1.5"/>',
    relief: '<path d="M12 36C18 30 21 14 32 12S46 28 52 36Z" fill="#5a3d22"/><path d="M20 30C24 24 27 17 32 16S41 23 44 30" fill="none" stroke="#c9a875" stroke-width=".8"/><path d="M26 33C29 28 30 24 32 23S37 27 38 33" fill="none" stroke="#c9a875" stroke-width=".6"/>', off: '<path d="' + A + '" fill="none" stroke="#9c8a6f" stroke-width=".8"/>' }[kind];
  return '<svg viewBox="0 0 64 44" aria-hidden="true"><rect width="64" height="44" fill="#dcc29a"/>' + art + '</svg>';
}
function cvPanelHtml() {
  const cv = cvNow(), it = cvItem(); let h = '';
  if (cvTool) return cvToolPanelHtml();
  if (cvPicked().length > 1) return cvMultiPanelHtml();
  if (!it) {
    const wood = cvWood(cv.board), preset = wood.thick.find(q => Math.abs(q[0] - cv.board.t) < .01), custom = cv.board.customT || !preset;
    h += cvSec('board', 'Wood and size', '<label class="field">Board type<select data-cf="b.wood" class="wide">' + Object.entries(CV_WOODS).map(([k, w]) => '<option value="' + k + '" ' + (w === wood ? 'selected' : '') + '>' + esc(w.name) + '</option>').join('') + '</select></label><label class="field">Thickness<select data-cf="b.tsel" class="wide">' + wood.thick.map(q => '<option value="' + q[0] + '" ' + (!custom && q === preset ? 'selected' : '') + '>' + esc(q[1]) + '</option>').join('') + '<option value="other" ' + (custom ? 'selected' : '') + '>Other size</option></select></label>' + (custom ? cvF('b.t', 'Exact thickness', cvNum(cv.board.t)) : '') + cvF('b.l', 'Length, along X', cvNum(cv.board.l)) + cvF('b.w', 'Width, along Y', cvNum(cv.board.w)) + cvMoreHtml('board', '<p class="cvSub">Speed for ' + esc(wood.name.toLowerCase()) + '</p><p class="note">' + esc(wood.why) + ' These change every bit\'s own numbers.</p><label class="field">Cutting speed, %<input type="text" data-cf="b.feedPct" value="' + cvPct(cv.board, 'feedPct') + '"></label><label class="field">Depth per pass, %<input type="text" data-cf="b.stepPct" value="' + cvPct(cv.board, 'stepPct') + '"></label>'));
    const mine = cvOwned(), mainBits = mine.filter(b => b.family !== 'corn'), moreBits = mine.length - mainBits.length;
    h += cvSec('bits', 'Your bits', (mine.length ? '<div class="bitStrip">' + mainBits.map(b => '<span title="' + esc(b.name) + '">' + cvBitArt(b) + '</span>').join('') + '</div>' + (moreBits ? '<p class="note">And ' + moreBits + ' corn end ' + (moreBits === 1 ? 'mill' : 'mills') + '.</p>' : '') : '<p class="note">None ticked yet. Tick the bits you own so they can be used.</p>') + '<div class="rowb"><button class="btn line" data-cact="bits">' + (mine.length ? 'Change your bits' : 'Choose your bits') + '</button></div>');
    h += cvParamsHtml();
    h += cvSec('items', 'On this board', (cv.items.length ? '<div class="cvlist">' + cv.items.map(i => '<button data-cpick="' + i.id + '">' + ic(cvTypeIcon(i.type)) + '<span>' + esc(cvItemName(i)) + '</span></button>').join('') + '</div>' : (CV3D.gcode ? '<p class="note">Showing <b>' + esc(CV3D.gcode.name) + '</b>, a G-code file, as it cuts. It isn\'t one of the shapes here: Send to machine runs it as it is, and Close puts it away.</p>' : '<p class="note">Nothing yet. Add text, an SVG or a shape from the left.</p>')) + (cv.items.length ? '<div class="rowb"><button class="btn line" data-cact="b-svg" title="Saves the shapes on the board as an SVG drawing, in mm">' + ic('download') + 'SVG</button><button class="btn line" data-cact="b-dxf" title="Saves the shapes on the board as a DXF drawing, in mm">' + ic('download') + 'DXF</button></div>' : ''));
    const zero = cvZeroOf(cv), zeroName = cvZeroName(cv);
    h += cvSec('setup', 'Zero point', '<div class="zeroGrid" role="radiogroup" aria-label="Where X0 Y0 is on the board">' + CV_ZEROS.map(([x, y, name]) => '<label class="zeroBtn' + (x === zero[0] && y === zero[1] ? ' on' : '') + '" title="Zero at the ' + cvZeroPlace(name) + '"><input type="radio" name="cvZero" data-cf="zero" value="' + x + ',' + y + '" aria-label="' + name + '" ' + (x === zero[0] && y === zero[1] ? 'checked' : '') + '><i></i></label>').join('') + '</div>'
      + (cv.tile && cvTiles(cv).length > 1
        ? '<p class="note">Cut in ' + cvTiles(cv).length + ' tiles, each zeroed at its own front left corner: the board\'s corner for tile 1, then the small cross an earlier tile engraves. Slide the board so the next tile is in reach, clamp it, and zero X, Y and Z on its cross. After changing a bit, zero only Z again. Try each file as an air test first.</p>'
        : '<p class="note">In gSender: clamp the board, move the bit to its ' + esc(cvZeroPlace(zeroName)) + ', just touching the top, and zero X, Y and Z there. After changing a bit, zero only Z again, then open the next file. Try each file as an air test first.</p>'));
    h += cvSec('machine', 'Machine', '<label class="check" title="For a board bigger than the machine can reach: it is cut in tiles one after another, sliding the board along between them"><input type="checkbox" data-cf="tile" ' + (cv.tile ? 'checked' : '') + '>Cut in tiles if the board is too big to reach</label><label class="check" title="Curves go out as true arcs (G2 and G3), which GRBL cuts smoothly, instead of many short lines"><input type="checkbox" data-cf="arcs" ' + (cv.arcs !== false ? 'checked' : '') + '>Write curves as arcs</label>' + cvF('clampH', 'Clamps stand this high', cvNum(cvClampH(cv))) + cvF('safeZ', 'Safe height above the board', cvNum(cv.safeZ)) + cvF('airZ', 'Air test height above the board', cvNum(cvAirOf(cv))) + '<label class="field">Slope into the cut, degrees<input type="text" data-cf="ramp" value="' + cvRampOf(cv) + '" title="Flat bits slope down into the wood instead of drilling straight in. 0 goes straight down."></label>' + cvF('tabW', 'Tab length', cvNum(cv.tabW)) + cvF('tabH', 'Tab height', cvNum(cv.tabH)) + cvF('workX', 'Machine travel, X', cvNum(cv.workX ?? 300)) + cvF('workY', 'Machine travel, Y', cvNum(cv.workY ?? 180)) + '<label class="field">Top speed, mm/min<input type="text" data-cf="maxRate" value="' + (cv.maxRate ?? 1500) + '"></label>');
    return h;
  }
  if (it.type === 'text') h += cvSec('text', 'Text', '<textarea data-cf="i.text" rows="2" aria-label="Text">' + esc(it.text) + '</textarea><label class="field">Font<select data-cf="i.font" id="cvFont"><option>' + esc(it.font) + '</option></select></label><label class="field">Line up<select data-cf="i.align">' + [['left', 'Left'], ['center', 'Centre'], ['right', 'Right']].map(([v, l]) => '<option value="' + v + '" ' + ((it.align || 'center') === v ? 'selected' : '') + '>' + l + '</option>').join('') + '</select></label>' + cvMoreHtml('text', '<label class="field">Warp<select data-cf="i.warp" title="Warps the letters inside an envelope, keeping them upright">' + CV_WARPS.map(([v, l]) => '<option value="' + v + '" ' + ((it.warp || '') === v ? 'selected' : '') + '>' + l + '</option>').join('') + '</select></label>' + (it.warp ? '<label class="field">How much, %<input type="text" data-cf="i.warpAmt" value="' + (it.warpAmt ?? 30) + '" title="A part of the text\'s height. Less than 0 turns a bulge into a pinch, and the others the other way."></label>' : '') + cvF('i.arc', 'Bend round a circle, radius', cvNum(it.arc || 0), 'title="0 keeps it straight. A positive radius curves it over the top of a circle, a negative one under it."')));
  if (cvNeverCut(it)) return h + cvSpecialPanelHtml(it);
  if (it.type === 'relief') h += cvSec('model', '3D model', '<label class="field">Up in the file is<select data-cf="i.up" class="wide" title="Which of the model\'s own directions points up out of the board">' + [['z', 'Z, the usual'], ['y', 'Y'], ['x', 'X']].map(([v, l]) => '<option value="' + v + '" ' + ((it.up || 'z') === v ? 'selected' : '') + '>' + l + '</option>').join('') + '</select></label>' + (cvReliefMap(it.art, it.up) ? '' : '<p class="note pickAsk">This model can\'t be read this way up. Try another.</p>'));
  const op = it.op, bit = cvBitOf(op.bit), list = cvOwned().filter(b => cvBitFits(op.kind, b)), showCurrent = bit && !list.includes(bit);
  let cut = '<div class="jobGrid" role="radiogroup" aria-label="How to cut it">' + CV_KINDS.filter(([v]) => (it.type === 'relief' ? v === 'relief' || v === 'off' : v !== 'relief')).map(([v]) => '<label class="jobBtn' + (op.kind === v ? ' on' : '') + '" title="' + esc(CV_JOB_WHAT[v]) + '"><input type="radio" name="cvJob" data-cf="op.kind" value="' + v + '" ' + (op.kind === v ? 'checked' : '') + '>' + cvJobArt(v) + esc(CV_JOB_SHORT[v]) + '</label>').join('') + '</div><p class="note jobWhat">' + esc(CV_JOB_WHAT[op.kind]) + '</p>';
  if (op.kind !== 'off') {
    let more = '';   // what a first carving can leave as it is
    if (op.kind === 'outside' || op.kind === 'inside' || op.kind === 'drill') {
      cut += '<label class="check"><input type="checkbox" data-cf="op.through" ' + (op.through ? 'checked' : '') + '>All the way through</label>';
      if (!op.through) cut += cvFxF(it, 'op.depth', 'Depth', cvNum(op.depth)) + cvGaugeHtml(cv, bit, op.depth);
      if (op.kind === 'drill') more += '<label class="check" title="Comes up clear of the board after each depth per pass, to let the chips out"><input type="checkbox" data-cf="op.peck" ' + (op.peck !== false ? 'checked' : '') + '>Peck, to clear chips</label>';
      else cut += '<label class="field">Tabs on each piece<input type="text" data-cf="op.tabs" value="' + (op.tabs ?? 4) + '" title="Small bridges left uncut, so the piece stays put until the end. Cut them with a knife after."></label>';
    } else {
      cut += cvFxF(it, 'op.depth', op.kind === 'vcarve' ? 'Deepest cut' : op.kind === 'relief' ? 'Depth of the relief' : 'Depth', cvNum(op.depth)) + cvGaugeHtml(cv, bit, op.depth);
      if (op.kind === 'pocket') more += '<label class="field">Clear it<select data-cf="op.fill" class="wide" title="Rings follow the shape. Back and forth runs straight lines across it, then once round the edge, which is often quicker for big plain areas.">' + [['', 'Rings round the shape'], ['x', 'Lines along X'], ['y', 'Lines along Y']].map(([v, l]) => '<option value="' + v + '" ' + ((op.fill || '') === v ? 'selected' : '') + '>' + l + '</option>').join('') + '</select></label>';
      if (op.kind === 'pocket' || op.kind === 'relief') {
        const pocket = op.kind === 'pocket', mine = cvOwned().filter(b => (pocket ? b.type === 'flat' && bit && b.d < bit.d - 1e-6 : b !== bit)), cur = op.detail && op.detail !== 'auto' && cvBitOf(op.detail), list = cur && !mine.includes(cur) ? mine.concat([cur]) : mine, sec = cvClearBit(it, cvBitOf);
        more += '<label class="field">' + (pocket ? 'Corners and detail' : 'Finishing bit') + '<select data-cf="op.detail" class="wide" title="' + (pocket ? 'A narrower flat bit goes after this one, into the corners and narrow parts it can\'t reach, in its own file.' : 'Another bit can smooth the surface after this one has roughed it out, in its own file. A smaller bit, or a V-bit, follows fine detail better.') + '"><option value="" ' + (!op.detail ? 'selected' : '') + '>' + (pocket ? 'Only this bit' : 'This bit does both') + '</option>' + (pocket ? '<option value="auto" ' + (op.detail === 'auto' ? 'selected' : '') + '>' + (op.detail === 'auto' && sec ? 'Best: ' + esc(sec.name) : 'Best narrower bit') + '</option>' : '') + list.map(b => '<option value="' + esc(b.id) + '" ' + (op.detail === b.id ? 'selected' : '') + '>' + esc(b.name) + '</option>').join('') + '</select></label>';
        if (op.kind === 'relief') {
          const fin = sec || bit; more += '<label class="field">Finishing step across, %<input type="text" data-cf="op.over" value="' + (op.over || CV_RELIEF_FINISH) + '" title="How far apart the finishing lines are, as a part of the finishing bit\'s width. Smaller is smoother and slower."></label>';
          if (bit) cut += '<p class="note">The ' + esc(bit.name) + ' steps down ' + esc(cvLen(cvRated(cv, bit).step)) + ' at a time' + (sec ? ', leaving ' + esc(cvLen(CV_RELIEF_LEAVE)) + ' for the ' + esc(sec.name) + ' to finish' : ', then finishes the surface') + (fin ? ' with lines ' + esc(cvLen(fin.d * (op.over || CV_RELIEF_FINISH) / 100)) + ' apart.' : '.') + (fin && fin.type === 'flat' ? ' A flat bit leaves small steps on slopes.' : '') + '</p>';
        }
      }
      if (op.kind === 'vcarve') {
        const flats = cvOwned().filter(b => b.type === 'flat'), cur = op.clear && cvBitOf(op.clear), list = cur && !flats.includes(cur) ? flats.concat([cur]) : flats, clear = cvClearBit(it, cvBitOf);
        more += '<label class="field">Level bottom<select data-cf="op.clear" class="wide" title="Where a stroke is wider than the deepest cut allows, its bottom is level. A flat bit clears it smooth, in its own file before the V-bit."><option value="auto" ' + (op.clear === 'auto' ? 'selected' : '') + '>Best flat bit that fits' + (op.clear === 'auto' && clear ? ': ' + esc(clear.name) : '') + '</option><option value="" ' + (!op.clear ? 'selected' : '') + '>V-bit, with small ridges</option>' + list.map(b => '<option value="' + esc(b.id) + '" ' + (op.clear === b.id ? 'selected' : '') + '>' + esc(b.name) + '</option>').join('') + '</select></label>';
        if (bit && bit.type === 'v') more += '<p class="note">The V-bit runs along the middle of each stroke. Strokes wider than ' + esc(cvLen(2 * cvVshape(bit, op.depth).cap)) + ' get a level bottom at this depth' + (clear ? ', cleared by the ' + esc(clear.name) + ' first.' : ', with small ridges from the V shape.') + '</p>';
      }
      if (op.kind === 'line' && bit && bit.type === 'v') cut += '<p class="note">The line will be ' + esc(cvLen(2 * (op.depth * Math.tan(bit.angle / 2 * Math.PI / 180) + (bit.tip || 0) / 2))) + ' wide.</p>';
    }
    if (['pocket', 'outside', 'inside'].includes(op.kind)) more += '<label class="check" title="Climb: the bit turns into the wood the way it travels. It often leaves cleaner edges in wood, but pulls harder on a light machine. Off cuts the usual, conventional way."><input type="checkbox" data-cf="op.climb" ' + (op.climb ? 'checked' : '') + '>Climb cut</label>' + cvF('op.finish', 'Finishing skin', cvNum(op.finish || 0), 'title="The other passes stay this far off the edge, and a last pass at full depth takes it off, for clean, true walls. 0 turns it off."');
    const need = op.kind === 'vcarve' ? 'V-bit' : op.kind === 'line' || op.kind === 'relief' ? 'bit' : 'flat bit', choices = list.concat(showCurrent ? [bit] : []);
    const row = b => '<label class="pickBit' + (op.bit === b.id ? ' on' : '') + '"><input type="radio" name="cvBit" data-cf="op.bit" value="' + esc(b.id) + '" ' + (op.bit === b.id ? 'checked' : '') + '>' + cvBitArt(b) + '<span><b>' + esc(b.name) + '</b><small>' + esc(cvBitLine(b)) + '</small></span></label>';
    if (bit && choices.includes(bit) && cvPickOpenFor !== it.id) {   // the bit chosen for it, and a way to change it
      cut += '<div class="pickHead"><b>Bit</b><button class="pickEdit" data-cact="pickopen">Change</button></div><div class="pickList" role="radiogroup" aria-label="Bit for this job">' + row(bit) + '</div>';
    } else {
      cut += '<div class="pickHead"><b>Bit</b><button class="pickEdit" data-cact="bits">Your bits</button></div>';
      const usual = choices.filter(b => b.family !== 'corn'), corn = choices.filter(b => b.family === 'corn'), cornOpen = cvCornOpen || (bit && bit.family === 'corn');
      cut += choices.length ? '<div class="pickList" role="radiogroup" aria-label="Bit for this job">' + usual.map(row).join('') + (corn.length ? '<details class="pickMore"' + (cornOpen ? ' open' : '') + '><summary>Corn end mills (' + corn.length + ')</summary><div class="pickList">' + corn.map(row).join('') + '</div></details>' : '') + '</div>'
        : '<div class="pickNone"><p>This job needs a ' + need + ', and none is ticked in your bits.</p><button class="btn line" data-cact="bits">Choose your bits</button></div>';
      if (choices.length && !bit) cut += '<p class="note pickAsk">Choose a bit above.</p>';
    }
    if (bit) { const on = cvRated(cv, bit); cut += '<p class="note">On ' + esc(cvWood(cv.board).name.toLowerCase()) + ': ' + Math.round(on.feed) + ' mm/min, ' + (Math.round(on.step * 100) / 100) + ' mm per pass.</p>'; }
    if (more) cut += cvMoreHtml('cut', more);
  }
  h += cvSec('cut', 'How to cut it', cut);
  const fieldSize = it.type === 'text' ? cvFxF(it, 'i.size', 'Letter height', cvNum(it.size)) + cvF('i.spacing', 'Letter spacing', cvNum(it.spacing || 0)) : it.type === 'svg' || it.type === 'path' || it.type === 'trace' || it.type === 'relief' ? cvFxF(it, 'i.scaleW', 'Width', cvNum(cvLocal(it).w)) + cvF('i.scaleH', 'Height', cvNum(cvLocal(it).h)) : cvFxF(it, 'i.w', 'Width', cvNum(it.w)) + cvFxF(it, 'i.h', 'Height', cvNum(it.h));
  h += cvSec('place', 'Size and position', fieldSize + cvFxF(it, 'i.x', 'Middle from left', cvNum(it.x)) + cvFxF(it, 'i.y', 'Middle from front', cvNum(it.y)) + '<label class="field">Turn, degrees<input type="text" data-cf="i.rot" value="' + (it.rot || 0) + '"></label><div class="rowb cvicons"><button class="btn line" data-cact="midx" title="Centre across the board" aria-label="Centre across the board">' + ic('align-center-vertical') + '</button><button class="btn line" data-cact="midy" title="Centre along the board" aria-label="Centre along the board">' + ic('align-center-horizontal') + '</button><button class="btn line" data-cact="dup" title="Duplicate (Ctrl+D)" aria-label="Duplicate">' + ic('copy') + '</button><button class="btn line" data-cact="del" title="Delete (Del)" aria-label="Delete">' + ic('trash-2') + '</button></div>');
  const fxBad = [...cvFxIssues.entries()].filter(([q]) => q.startsWith(it.id + '.')).map(([, v]) => v);
  if (fxBad.length) h = h.replace('<details class="sec" data-csec="place"', '<p class="fxbad">' + fxBad.map(esc).join('<br>') + '</p><details class="sec" data-csec="place"');
  h += cvShapeSecHtml(it);
  return h;
}
const cvZeroPlace = name => (name === 'middle' ? 'middle' : name.endsWith('middle') ? `middle of the ${name.split(' ')[0]} edge` : `${name} corner`);
const cvItemName = i => (i.type === 'text' ? String(i.text).split('\n')[0] || 'Text' : i.type === 'svg' ? 'Artwork' : i.type === 'relief' ? '3D model' : { rect: 'Rectangle', circle: 'Ellipse', polygon: 'Polygon', star: 'Star', trace: 'Traced picture', clamp: 'Clamp zone', dim: 'Dimension', path: i.paths && i.paths.every(l => l.closed) ? 'Shape' : 'Line' }[i.type] || 'Shape');
function cvPanelRender() {
  const box = cvEl('cvSide'), active = document.activeElement, focusKey = active && active.dataset ? active.dataset.cf : null, at = active && active.selectionStart;
  const openItem = cvItem(), many = cvPicked().length; cvEl('cvHead').innerHTML = cvTool ? '<span>' + esc(cvToolTitle()) + '</span><button class="ic" data-cdone="1" title="Stop drawing (Esc)" aria-label="Stop drawing">' + ic('x') + '</button>' : openItem ? '<span>' + esc(many > 1 ? many + ' items' : cvItemName(openItem)) + '</span><button class="ic" data-cdone="1" title="Back to the board (Esc)" aria-label="Back to the board">' + ic('x') + '</button>' : '<span>Board</span>';
  box.innerHTML = cvPanelHtml();
  if (focusKey) { const again = box.querySelector(focusKey === 'op.bit' || focusKey === 'op.kind' ? 'input[data-cf="' + focusKey + '"]:checked' : `[data-cf="${focusKey}"]`); if (again) { again.focus(); try { if (at != null) again.setSelectionRange(at, at); } catch (e) {} } }
  const it = cvItem(), sel = cvEl('cvFont');
  if (it && it.type === 'text' && sel) cvFontList().then(list => {
    if (!sel.isConnected) return; const lineNames = cvLineFontNames(), names = [...list.keys()].sort((a, b) => a.localeCompare(b)); if (!names.includes(it.font) && !lineNames.includes(it.font)) names.unshift(it.font);
    const opt = n => `<option ${n === it.font ? 'selected' : ''}>${esc(n)}</option>`;
    sel.innerHTML = (lineNames.length ? `<optgroup label="Single-line, for engraving">${lineNames.map(opt).join('')}</optgroup><optgroup label="Outline fonts">` : '') + names.map(opt).join('') + (lineNames.length ? '</optgroup>' : '');
  });
}
function cvChecksRender() {
  const cv = cvNow(), box = cvEl('cvChecks'), gcodeOnly = !!CV3D.gcode && !cv.items.length;
  // a G-code file open on an empty board: nothing is wrong, there's just nothing of its own to save
  const list = gcodeOnly ? [{ info: true, text: `${CV3D.gcode.name} is open to look at and to send to the machine. Save G-code is for shapes you put on the board.` }] : cvChecks(cv, cvBitOf, cvOwned().length > 0), plan = cvPlan(cv, cvBitOf), bad = list.filter(c => c.bad);
  let mins = 0, nfiles = 0; if (!bad.length) { try { cvJob(cv, cvBitOf, P.name).forEach(f => { mins += f.minutes; nfiles++; }); } catch (e) {} }
  const tiles = cv.tile ? cvTiles(cv).length : 1;
  const b = cv.board; cvEl('fCarve').innerHTML = '<b>' + esc(cvLen(b.l)) + '</b> x <b>' + esc(cvLen(b.w)) + '</b> x <b>' + esc(cvLen(b.t)) + '</b> board' + (!bad.length && plan.length ? '<span style="margin-left:22px">' + (tiles > 1 ? '<b>' + tiles + '</b> tiles, <b>' + nfiles + '</b> files: ' : '<b>' + plan.length + '</b> ' + (plan.length === 1 ? 'file' : 'files') + ': ') + plan.map(f => esc(cvBitOf(f.bit).name)).join(', then ') + '</span><span style="margin-left:22px">about <b>' + Math.max(1, Math.ceil(mins)) + ' min</b> of cutting</span>' : '');
  box.innerHTML = list.map(c => `<div class="cvmsg${c.bad ? ' bad' : c.info ? ' info' : ''}" ${c.id ? `data-cpick="${c.id}"` : ''}>${c.info ? '' : ic('triangle-alert')}<span>${esc(c.text)}</span></div>`).join('');
  cvEl('cvExport').disabled = cvEl('cvAir').disabled = !!bad.length || gcodeOnly;
  const airTip = `Save an air test: the same job ${cvLen(cvAirOf(cv))} above the board, cutting nothing`; cvEl('cvAir').title = airTip; cvEl('cvAir').setAttribute('aria-label', airTip);
}
function cv3dTheme() {   // the 3D view's background follows light and dark
  if (!CV3D.renderer) return; const dark = isDark(), want = dark ? 0x272e31 : 0xe4e9e7; if (CV3D.scene.background && CV3D.scene.background.getHex() === want) return;
  CV3D.scene.background = new THREE.Color(want); cvEl('cv3d').style.background = dark ? '#272e31' : '#e4e9e7'; cv3dDraw();
}
function carveRender() { if (!cvOpen()) return; cv3dTheme(); cv3dSchedule(); cvStageRender(); cvPanelRender(); if (typeof cvRailMarks === 'function') cvRailMarks(); cvEl('cvPaths').classList.toggle('on', cvShowPaths); }

// ---------- changing values ----------
const CV_INPUT_NUM = { 'b.l': v => v > 0, 'b.w': v => v > 0, 'b.t': v => v > 0, safeZ: v => v > 0, tabW: v => v > 0, tabH: v => v >= 0, workX: v => v > 0, workY: v => v > 0, 'i.size': v => v > 0, 'i.spacing': () => true, 'i.w': v => v > 0, 'i.h': v => v > 0, 'i.x': () => true, 'i.y': () => true, 'i.scaleW': v => v > 0, 'i.arc': () => true, 'i.scaleH': v => v > 0, 'op.depth': v => v > 0, 'op.finish': v => v >= 0 && v <= 3, airZ: v => v > 0, clampH: v => v > 0, 'i.off': () => true };
function cvFieldChange(el) {
  if (cvToolField(el)) return;
  const k = el.dataset.cf, cv = cvNow(), it = cvItem();
  if (/^p[nv]\.\d+$/.test(k)) {   // a smart value's name or size
    const p = (P.params || [])[+k.slice(3)]; if (!p) return;
    if (k[1] === 'v') { const before = { e: p.e, u: p.u }; edit(() => { const err = fxSetParam(p, el.value, null); if (err) { p.e = before.e; p.u = before.u; toast(`Can't use that: ${err}.`, true); } }); return; }
    const nm = el.value.trim();
    if (!FX_NAME.test(nm)) { toast('A name starts with a letter and has only letters, numbers and _.', true); carveRender(); return; }
    if (nm.toLowerCase() !== p.name.toLowerCase() && fxFindParam(nm, null)) { toast(`There is already one called ${nm}.`, true); carveRender(); return; }
    edit(() => { fxRenameEverywhere(p.name, nm, null); p.name = nm; }); return;
  }
  if (it && cvFxOk(it, k)) {   // a formula is kept; a sum is worked out once
    const t = String(el.value).trim(), fk = CV_FX[k];
    if (t[0] === '=' || t[0] === '#' || /[+*()]/.test(t) || /[a-z_]{2,}/i.test(t.replace(/\b(mm|cm|in|inch|inches|ft|feet|foot|yd)\b/gi, ''))) {
      const r = fxFromBox(t, null);
      if (r.error) { toast(`Can't use that: ${r.error}.`, true); carveRender(); return; }
      if (r.formula) { cvEdit(() => { it.fx = it.fx || {}; it.fx[fk] = r.formula; if (it.fxv) delete it.fxv[fk]; }); return; }
      el.value = cvNum(r.value);
    }
  }
  if (CV_INPUT_NUM[k]) {
    const v = cvParse(el.value); if (!isFinite(v) || !CV_INPUT_NUM[k](v)) { toast("That size won't work."); carveRender(); return; }
    cvEdit(() => {
      if (it && cvFxOk(it, k) && it.fx) { delete it.fx[CV_FX[k]]; if (it.fxv) delete it.fxv[CV_FX[k]]; }   // a plain number replaces its formula
      if (k.startsWith('b.')) { cv.board[k[2]] = v; cvView = null; } else if (['safeZ', 'airZ', 'tabW', 'tabH', 'workX', 'workY', 'clampH'].includes(k)) cv[k] = v;
      else if (k === 'i.scaleW') { if (it.type === 'path') cvScalePath(it, v / Math.max(cvLocal(it).w, 1e-6)); else if (it.type === 'trace') it.w = it.w * v / Math.max(cvLocal(it).w, 1e-6); else it.w = v; }
      else if (k === 'i.scaleH') { if (it.type === 'path') cvScalePath(it, v / Math.max(cvLocal(it).h, 1e-6)); else it.w = it.w * v / Math.max(cvLocal(it).h, 1e-6); }
      else if (k.startsWith('i.')) it[k.slice(2)] = v; else if (k === 'op.finish') it.op.finish = v; else it.op.depth = v;
    });
    return;
  }
  if (k === 'b.wood') {   // the nearest thickness this board comes in, unless an exact size was typed
    const next = el.value; cvEdit(() => { const b = cv.board; b.wood = next; Object.assign(b, cvRatesFor(next)); if (!b.customT) { const list = CV_WOODS[next].thick; b.t = list.reduce((m, q) => (Math.abs(q[0] - b.t) < Math.abs(m - b.t) ? q[0] : m), list[0][0]); } }); return;
  }
  if (k === 'b.tsel') { const v = el.value; cvEdit(() => { const b = cv.board; if (v === 'other') b.customT = true; else { delete b.customT; b.t = +v; } }); return; }
  if (k === 'b.feedPct' || k === 'b.stepPct') { const v = parseFloat(el.value), f = k.slice(2); if (v >= 10 && v <= 200) { cvRatesKeep(cv.board.wood || 'bass', f, v); cvEdit(() => { cv.board[f] = v; }); } else { toast('Type a percentage from 10 to 200.', true); carveRender(); } return; }
  if (k === 'zero') { const z = el.value.split(',').map(Number); if (CV_ZEROS.some(q => q[0] === z[0] && q[1] === z[1])) cvEdit(() => { cv.zero = z; }); return; }
  if (k === 'ramp') { const v = parseFloat(el.value); if (v >= 0 && v <= 45) cvEdit(() => { cv.ramp = v; }); else { toast('Type an angle from 0 to 45 degrees.', true); carveRender(); } return; }
  if (k === 'maxRate') { const v = parseFloat(el.value); if (v > 0) cvEdit(() => { cv.maxRate = v; }); else carveRender(); return; }
  if (k === 'i.rot') { const v = parseFloat(el.value); if (isFinite(v)) cvEdit(() => { it.rot = ((v % 360) + 360) % 360; }); else carveRender(); return; }
  if (k === 'i.text') { cvEdit(() => { it.text = el.value; }); return; }
  if (k === 'i.align') { cvEdit(() => { it.align = el.value; }); return; }
  if (k === 'i.warp') { cvEdit(() => { if (el.value) it.warp = el.value; else delete it.warp; }); return; }
  if (k === 'i.warpAmt') { const v = parseFloat(el.value); if (v >= -90 && v <= 200) cvEdit(() => { it.warpAmt = v; }); else { toast('Type a percentage from -90 to 200.', true); carveRender(); } return; }
  if (k === 'i.font') {   // a single-line font can only be engraved, so it switches to that
    const name = el.value; cvFontLoad(name).then(f => { if (!f) toast(`${name} can't be read. Try another font.`, true); cvEdit(() => { it.font = name; if (f && f.line && it.op && !['line', 'off'].includes(it.op.kind)) { const next = cvOpFor(cv, 'line'); next.depth = Math.min(it.op.depth || .3, .5); it.op = next; } }); }); return;
  }
  if (k === 'op.kind') { const kind = el.value; cvRememberJob(it.type, kind); cvEdit(() => { const old = it.op, next = cvOpFor(cv, kind); if (kind !== 'off' && cvBitFits(kind, cvBitOf(old.bit))) next.bit = old.bit; next.tabs = old.tabs ?? 4; it.op = next; }); return; }
  if (k === 'op.bit') { cvPickOpenFor = null; cvEdit(() => { it.op.bit = el.value || null; }); return; }
  if (k === 'op.depthR') { const v = +el.value; if (v > 0) cvEdit(() => { it.op.depth = v; if (it.fx) { delete it.fx.depth; if (it.fxv) delete it.fxv.depth; } }); return; }
  if (k === 'op.clear') { cvEdit(() => { it.op.clear = el.value || null; }); return; }
  if (k === 'op.detail') { cvEdit(() => { it.op.detail = el.value || null; }); return; }
  if (k === 'op.fill') { cvEdit(() => { if (el.value) it.op.fill = el.value; else delete it.op.fill; }); return; }
  if (k === 'op.over') { const v = parseFloat(el.value); if (v >= 3 && v <= 50) cvEdit(() => { it.op.over = v; }); else { toast('Type a percentage from 3 to 50.', true); carveRender(); } return; }
  if (k === 'i.up') { cvEdit(() => { it.up = el.value; }); return; }
  if (k === 'tile') { cvEdit(() => { cv.tile = el.checked; }); return; }
  if (k === 'arcs') { cvEdit(() => { cv.arcs = el.checked; }); return; }
  if (k === 'op.climb') { cvEdit(() => { it.op.climb = el.checked; }); return; }
  if (k === 'op.peck') { cvEdit(() => { it.op.peck = el.checked; }); return; }
  if (k === 'op.through') { cvEdit(() => { it.op.through = el.checked; if (!el.checked) it.op.depth = cv.board.t; }); return; }
  if (k === 'op.tabs') { const v = parseInt(el.value, 10); if (v >= 0 && v <= 40) cvEdit(() => { it.op.tabs = v; }); else carveRender(); }
}
// ---------- what's picked ----------
// One item is picked for the panel (cvSel). Shift-click, or dragging a box over the board, picks more (cvMore), and then
// the panel's tools act on them all together.
let cvMore = new Set();
function cvPicked() {
  if (!P.carve || cvSel === null) { cvMore.clear(); return []; }
  const ids = new Set([cvSel, ...cvMore]), list = P.carve.items.filter(i => ids.has(i.id));
  if (!list.some(i => i.id === cvSel)) { cvSel = list.length ? list[0].id : null; }
  return list;
}
function cvPickOnly(id) { cvSel = id; cvMore.clear(); const it = id !== null && P.carve ? P.carve.items.find(i => i.id === id) : null; if (it && it.gid) P.carve.items.forEach(o => { if (o !== it && o.gid === it.gid) cvMore.add(o.id); }); }
function cvPickList(list) { const all = [...new Set(list.flatMap(i => (i.gid ? P.carve.items.filter(o => o.gid === i.gid) : [i])))]; cvSel = all.length ? all[0].id : null; cvMore = new Set(all.slice(1).map(i => i.id)); }
function cvRemove() { const list = cvPicked(); if (!list.length) return; cvEdit(() => { P.carve.items = P.carve.items.filter(i => !list.includes(i)); }); cvPickOnly(null); carveRender(); }
function cvCopy() {
  const list = cvPicked(); if (!list.length) return; const cv = P.carve, gids = {}, made = list.map(it => { const c = cvClone(it); c.id = cv.nextId++; c.x += 10; c.y -= 10; if (c.gid) c.gid = gids[c.gid] || (gids[c.gid] = (cv.nextGid = (cv.nextGid || 0) + 1)); return c; });
  cvEdit(() => { cv.items.push(...made); }); cvPickList(made); carveRender();
}
// where an item sits on the board, as a box
function cvWorldBox(it) { const s = cvLocal(it), place = cvPlaceFn(it), pts = s.regions.concat(s.lines.map(l => l.pts)).map(p => p.map(place)); if (!pts.length) { const w = Math.max(s.w, 4) / 2, h = Math.max(s.h, 4) / 2; return { x0: it.x - w, y0: it.y - h, x1: it.x + w, y1: it.y + h }; } return cvBox(pts); }

// ---------- the mouse ----------
let cvDrag = null, cvTool = null;
const cvPoint = e => { const svg = cvEl('cvStage'), r = svg.getBoundingClientRect(), k = cvView.k; return [cvView.x + (e.clientX - r.left) * k, P.carve.board.w - (cvView.y + (e.clientY - r.top) * k)]; };
// grabbing a handle: the corners scale, the round one turns. The board and the 3D view both start a drag this way.
function cvHandleDrag(handle, it, p) { const s = cvLocal(it); return { handle, it, start: p, size: it.size, spacing: it.spacing, w: it.w, h: it.h, paths: it.paths && JSON.parse(JSON.stringify(it.paths)), rot: it.rot || 0, a0: Math.atan2(p[1] - it.y, p[0] - it.x), r0: Math.hypot(p[0] - it.x, p[1] - it.y) || 1, lw: s.w, lh: s.h, moved: false }; }
// clicking an item: Shift adds it or takes it away; otherwise it's picked, and a drag moves everything picked
function cvItemDown(e, id, p) {
  if (e.shiftKey) {
    const grp = cvGroupOf(P.carve.items.find(i => i.id === id)), now = cvPicked();
    if (now.some(i => i.id === id)) cvPickList(now.filter(i => !grp.includes(i))); else cvPickList(now.concat(grp));
    carveRender(); return false;
  }
  if (!cvPicked().some(i => i.id === id)) { cvPickOnly(id); carveRender(); }
  const list = cvPicked(), lead = list.find(i => i.id === id);
  cvDrag = { move: true, list: list.map(it => ({ it, ox: it.x, oy: it.y })), lead: { it: lead, ox: lead.x, oy: lead.y }, start: p, moved: false, sx: e.clientX, sy: e.clientY };
  return true;
}
function cvStageDown(e) {
  const svg = cvEl('cvStage');
  if (e.button === 1 || e.button === 2) { cvDrag = { pan: true, x: e.clientX, y: e.clientY, vx: cvView.x, vy: cvView.y }; svg.setPointerCapture(e.pointerId); return; }
  if (typeof machPickAt === 'function' && e.button === 0 && machPickAt(cvPoint(e))) return;   // My machine is waiting for a point of the cut
  if (cvTool) { cvToolDown(e, cvPoint(e)); return; }
  if (cvNodeDown(e, cvPoint(e))) return;
  const h = e.target.closest && e.target.closest('.cvh'), g = e.target.closest && e.target.closest('.cvitem'), p = cvPoint(e);
  document.activeElement && document.activeElement.blur && document.activeElement !== document.body && document.activeElement.blur();
  if (h && cvItem() && !cvMore.size) { cvDrag = cvHandleDrag(h.dataset.h, cvItem(), p); svg.setPointerCapture(e.pointerId); return; }
  if (g) { if (cvItemDown(e, +g.dataset.it, p)) svg.setPointerCapture(e.pointerId); return; }
  cvDrag = { box: true, start: p, now: p, add: e.shiftKey, sx: e.clientX, sy: e.clientY };   // on empty board: a box picks everything it touches
  svg.setPointerCapture(e.pointerId);
}
function cvStageMove(e) {
  if (cvTool && !cvDrag) { cvToolMove(e, cvPoint(e)); return; }
  if (!cvDrag) return;
  if (cvDrag.onMove) { cvDrag.onMove(e, cvPoint(e)); return; }
  if (cvDrag.pan) { cvView.x = cvDrag.vx - (e.clientX - cvDrag.x) * cvView.k; cvView.y = cvDrag.vy - (e.clientY - cvDrag.y) * cvView.k; cvStageRender(); return; }
  const p = cvPoint(e), b = P.carve.board;
  if (cvDrag.box) {
    cvDrag.now = p; let r = cvEl('cvBoxSel'); if (!r) { cvEl('cvStage').insertAdjacentHTML('beforeend', '<rect id="cvBoxSel" fill="rgba(32,38,42,.06)" stroke="#20262a" stroke-dasharray="4 3" pointer-events="none"/>'); r = cvEl('cvBoxSel'); }
    const x0 = Math.min(p[0], cvDrag.start[0]), x1 = Math.max(p[0], cvDrag.start[0]), y0 = Math.min(p[1], cvDrag.start[1]), y1 = Math.max(p[1], cvDrag.start[1]);
    r.setAttribute('x', x0); r.setAttribute('y', b.w - y1); r.setAttribute('width', x1 - x0); r.setAttribute('height', y1 - y0); r.setAttribute('stroke-width', cvView.k); return;
  }
  if (cvDragTo(e, p, cvView.k)) cvStageRender();
}
// moves, scales or turns what's being dragged to board point p; k is millimetres per screen pixel there. False until it moves.
function cvDragTo(e, p, k) {
  const it = cvDrag.it, b = P.carve.board;
  if (cvDrag.move && !cvDrag.moved && Math.hypot(e.clientX - cvDrag.sx, e.clientY - cvDrag.sy) < 3) return false;
  if (!cvDrag.moved) { pushUndo(); cvDrag.moved = true; }
  if (cvDrag.move) {
    let dx = p[0] - cvDrag.start[0], dy = p[1] - cvDrag.start[1]; const near = 7 * k, L = cvDrag.lead;
    if (!e.altKey) { if (Math.abs(L.ox + dx - b.l / 2) < near) dx = b.l / 2 - L.ox; if (Math.abs(L.oy + dy - b.w / 2) < near) dy = b.w / 2 - L.oy; }   // the board's middle pulls gently. Alt turns it off.
    cvDrag.list.forEach(m => { m.it.x = m.ox + dx; m.it.y = m.oy + dy; });
  } else if (cvDrag.handle === 'r') {
    let a = cvDrag.rot + (Math.atan2(p[1] - it.y, p[0] - it.x) - cvDrag.a0) * 180 / Math.PI; if (e.shiftKey) a = Math.round(a / 15) * 15; it.rot = Math.round((((a % 360) + 360) % 360) * 10) / 10;
  } else {
    const f = Math.max(.02, Math.hypot(p[0] - it.x, p[1] - it.y) / cvDrag.r0);
    if (it.type === 'text') { it.size = Math.max(1, cvDrag.size * f); it.spacing = (cvDrag.spacing || 0) * f; } else if (it.type === 'svg' || it.type === 'trace') it.w = Math.max(1, cvDrag.w * f);
    else if (it.type === 'path') it.paths = cvDrag.paths.map(l => cvMapLine(l, q => [q[0] * f, q[1] * f], h => h.map(v => v * f)));
    else if (e.shiftKey) { it.w = Math.max(1, cvDrag.w * f); it.h = Math.max(1, cvDrag.h * f); }
    else { const r = -(it.rot || 0) * Math.PI / 180, dx = p[0] - it.x, dy = p[1] - it.y, lx = dx * Math.cos(r) - dy * Math.sin(r), ly = dx * Math.sin(r) + dy * Math.cos(r); it.w = Math.max(1, Math.abs(lx) * 2); it.h = Math.max(1, Math.abs(ly) * 2); }
  }
  return true;
}
function cvStageUp() {
  const d = cvDrag; cvDrag = null; if (!d) return;
  if (d.onUp) { d.onUp(); return; }
  if (d.box) {
    const r = cvEl('cvBoxSel'); if (r) r.remove();
    if (Math.hypot(d.now[0] - d.start[0], d.now[1] - d.start[1]) / cvView.k < 3) { if (!d.add && cvSel !== null) { cvPickOnly(null); carveRender(); } return; }
    const x0 = Math.min(d.now[0], d.start[0]), x1 = Math.max(d.now[0], d.start[0]), y0 = Math.min(d.now[1], d.start[1]), y1 = Math.max(d.now[1], d.start[1]);
    const hit = P.carve.items.filter(i => { const b = cvWorldBox(i); return b.x1 >= x0 && b.x0 <= x1 && b.y1 >= y0 && b.y0 <= y1; });
    cvPickList(d.add ? cvPicked().concat(hit.filter(i => !cvPicked().includes(i))) : hit); carveRender(); return;
  }
  if (d.moved) { persist(); carveRender(); } else if (!d.pan) cvCutsRender();
}
function cvWheel(e) {
  e.preventDefault(); if (!cvView) return; const svg = cvEl('cvStage'), r = svg.getBoundingClientRect(), mx = cvView.x + (e.clientX - r.left) * cvView.k, my = cvView.y + (e.clientY - r.top) * cvView.k, f = Math.exp(e.deltaY * .0012), k = Math.max(.01, Math.min(30, cvView.k * f));
  cvView = { x: mx - (e.clientX - r.left) * k, y: my - (e.clientY - r.top) * k, k }; cvStageRender();
}

// ---------- drawing a bit ----------
// Drawn from the bit's own numbers, standing in a slice of wood with the groove it cuts, so bits can be told apart at a glance.
// All bits share one scale where they fit, so a 1/4" really looks twice as wide as a 1/8".
function cvBitArt(b, big) {
  const W = big ? 250 : 120, H = 150, cx = big ? 78 : 60, top = 112, a = Math.max(5, b.angle || 60) / 2 * Math.PI / 180, room = big ? 130 : 104, F = n => Math.round(n * 100) / 100;
  let k = Math.min(5, room / Math.max(b.d, .1)); if (b.type === 'v') k = Math.min(k, 90 * Math.tan(a) / (b.d / 2));
  const r = b.d / 2 * k, shank = Math.max(r, 3.175 / 2 * k); let s = '', tool = '', dims = '';
  const woodFill = '#dcc29a', edge = '#8a6a42', steel = '#c3c9cb', dark = '#3f484c', flute = '#7f8a8e';
  const grain = [122, 133, 143].map((y, i) => '<path d="M0 ' + y + 'C' + W * .3 + ' ' + (y - 3 + i * 2) + ' ' + W * .6 + ' ' + (y + 3 - i) + ' ' + W + ' ' + y + '" fill="none" stroke="#b8935f" stroke-opacity=".5" stroke-width=".7"/>').join('');
  let notch, groove;
  if (b.type === 'v') {
    const tip = Math.max(.25, (b.tip || 0) / 2 * k), tipY = 130, h = (r - tip) / Math.tan(a), open = Math.min(r, tip + (tipY - top) * Math.tan(a));
    notch = 'M0 ' + top + 'H' + F(cx - open) + 'L' + F(cx - tip) + ' ' + tipY + 'H' + F(cx + tip) + 'L' + F(cx + open) + ' ' + top + 'H' + W + 'V' + H + 'H0Z'; groove = 'M' + F(cx - open) + ' ' + top + 'L' + F(cx - tip) + ' ' + tipY + 'H' + F(cx + tip) + 'L' + F(cx + open) + ' ' + top + 'Z';
    const shoulder = tipY - h;
    tool = '<path d="M' + F(cx - r) + ' 0V' + F(shoulder) + 'L' + F(cx - tip) + ' ' + tipY + 'H' + F(cx + tip) + 'L' + F(cx + r) + ' ' + F(shoulder) + 'V0Z" fill="' + steel + '" stroke="' + dark + '" stroke-width="1" stroke-linejoin="round"/><path d="M' + F(cx) + ' ' + F(shoulder) + 'L' + F(cx + tip) + ' ' + tipY + 'L' + F(cx + r) + ' ' + F(shoulder) + 'Z" fill="' + flute + '" fill-opacity=".55"/>';
    if (big) {
      const lx = cx + r + 14, ly = Math.max(26, shoulder + 16), arm = 18, ax = cx + Math.sin(a) * arm, ay = tipY - Math.cos(a) * arm, bx = cx - Math.sin(a) * arm;
      dims = '<path d="M' + F(bx) + ' ' + F(ay) + 'A' + arm + ' ' + arm + ' 0 0 1 ' + F(ax) + ' ' + F(ay) + '" fill="none" stroke="#20262a" stroke-width="1"/><line x1="' + F(ax) + '" y1="' + F(ay) + '" x2="' + F(lx) + '" y2="' + F(ly) + '" stroke="#20262a" stroke-width=".8"/>' + cvBitTag(lx, ly, Math.round(b.angle) + '° point');
      dims += '<line x1="' + F(cx + r) + '" y1="16" x2="' + F(lx) + '" y2="16" stroke="#20262a" stroke-width=".8"/>' + cvBitTag(lx, 16, cvLen(b.d) + ' wide at most');
    }
  } else {
    const end = 126, flutesFrom = Math.max(46, end - Math.max(50, r * 2.4)), ball = b.type === 'ball', c = end - r;   // c: the middle of a ball end
    if (!ball) { notch = 'M0 ' + top + 'H' + F(cx - r) + 'V' + end + 'H' + F(cx + r) + 'V' + top + 'H' + W + 'V' + H + 'H0Z'; groove = 'M' + F(cx - r) + ' ' + top + 'V' + end + 'H' + F(cx + r) + 'V' + top + 'Z'; }
    else if (c >= top) { const arc = 'A' + F(r) + ' ' + F(r) + ' 0 0 0 ' + F(cx + r) + ' ' + F(c); notch = 'M0 ' + top + 'H' + F(cx - r) + 'V' + F(c) + arc + 'V' + top + 'H' + W + 'V' + H + 'H0Z'; groove = 'M' + F(cx - r) + ' ' + top + 'V' + F(c) + arc + 'V' + top + 'Z'; }
    else { const hw = Math.sqrt(Math.max(0, r * r - (top - c) ** 2)), arc = 'A' + F(r) + ' ' + F(r) + ' 0 0 0 ' + F(cx + hw) + ' ' + top; notch = 'M0 ' + top + 'H' + F(cx - hw) + arc + 'H' + W + 'V' + H + 'H0Z'; groove = 'M' + F(cx - hw) + ' ' + top + arc + 'Z'; }
    const fluteEnd = ball ? Math.max(flutesFrom, c) : end;
    let lines = ''; const pitch = Math.max(7, Math.min(13, r)), rise = Math.min(r * 2 * .55, 12); for (let y = flutesFrom; y + rise <= fluteEnd; y += pitch) { lines += '<path d="M' + F(cx - r) + ' ' + F(y + rise) + 'L' + F(cx + r) + ' ' + F(y) + '"/>'; if (b.family === 'corn') lines += '<path d="M' + F(cx - r) + ' ' + F(y) + 'L' + F(cx + r) + ' ' + F(y + rise) + '"/>'; }
    tool = '<rect x="' + F(cx - shank) + '" y="0" width="' + F(shank * 2) + '" height="' + F(flutesFrom + 1) + '" fill="' + steel + '" stroke="' + dark + '" stroke-width="1"/>' + (ball ? '<path d="M' + F(cx - r) + ' ' + F(flutesFrom) + 'V' + F(fluteEnd) + 'A' + F(r) + ' ' + F(r) + ' 0 0 0 ' + F(cx + r) + ' ' + F(fluteEnd) + 'V' + F(flutesFrom) + 'Z" fill="#aab2b5" stroke="' + dark + '" stroke-width="1"/>' : '<rect x="' + F(cx - r) + '" y="' + F(flutesFrom) + '" width="' + F(r * 2) + '" height="' + F(end - flutesFrom) + '" fill="#aab2b5" stroke="' + dark + '" stroke-width="1"/>') + '<g fill="none" stroke="' + dark + '" stroke-width="1.1" stroke-opacity=".75">' + lines + '</g>';
    if (big) { const lx = cx + r + 14, ly = 80; dims = '<line x1="' + F(cx + r) + '" y1="' + ly + '" x2="' + F(lx) + '" y2="' + ly + '" stroke="#20262a" stroke-width=".8"/>' + cvBitTag(lx, ly, cvLen(b.d) + ' wide'); }
  }
  // wood, then its grain, then the groove painted over the grain, then the wood's outline
  s = '<rect y="' + top + '" width="' + W + '" height="' + (H - top) + '" fill="' + woodFill + '"/>' + grain + '<path d="' + groove + '" fill="var(--bit-bg)"/><path d="' + notch + '" fill="none" stroke="' + edge + '" stroke-width="1"/>';
  return '<svg class="bitArt" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(b.name) + '">' + s + tool + dims + '</svg>';
}
function cvBitTag(x, y, text) { const w = String(text).length * 5.5 + 10; return '<rect x="' + x + '" y="' + (y - 8) + '" width="' + w + '" height="16" rx="2" fill="#ffc928" stroke="#20262a" stroke-width=".7"/><text x="' + (x + w / 2) + '" y="' + (y + 3.5) + '" text-anchor="middle" font-family="Barlow,sans-serif" font-size="10.5" font-weight="600" fill="#20262a">' + esc(text) + '</text>'; }
const cvBitLine = b => (b.type === 'v' ? Math.round(b.angle) + '° point, up to ' + cvLen(b.d) + ' wide' : b.type === 'ball' ? 'Round end, ' + cvLen(b.d) + ' wide' : 'Cuts ' + cvLen(b.d) + ' wide');
// what a new bit starts from, for a kind none of the starting bits are
const CV_BIT_BALL = { id: 'ball-3', type: 'ball', name: '3.175 mm ball nose', d: 3.175, angle: 0, tip: 0, reach: 12, feed: 400, plunge: 100, rpm: 1000, step: .5, over: 15, have: true };

// ---------- your bits ----------
const CV_BIT_GROUPS = [['flat', 'Flat bits', 'Clear areas and cut pieces out of wood.'], ['v', 'V-bits', 'Carve sharp letters and engrave fine lines.'], ['ball', 'Ball-nose bits', 'A round end, for smooth 3D reliefs and rounded grooves.'], ['corn', 'Corn end mills', 'Thin and brittle. For tiny detail and PCB work, so go slowly.']];
const cvBitFamily = b => b.family || b.type;
const CV_BIT_FIELDS = [['d', 'Width', 'len'], ['angle', 'Point angle, degrees', 'n', 'v'], ['tip', 'Tip width', 'len', 'v'], ['reach', 'Cutting length, 0 if unknown', 'len', 'flat'], ['step', 'Depth per pass', 'len', '', 's'], ['feed', 'Cutting speed, mm/min', 'n', '', 's'], ['plunge', 'Plunge speed, mm/min', 'n', '', 's'], ['rpm', 'Spindle speed, S value', 'n', '', 's'], ['over', 'Step across, % of width', 'n', '', 's']];
const cvBitOpenOne = () => cvBits.find(b => b.id === cvOpenBit) || cvOwned()[0] || cvBits[0] || null;
function cvRackRender() {
  const on = cvBitOpenOne();
  cvEl('bitRack').innerHTML = CV_BIT_GROUPS.map(([type, title, why]) => '<section class="bitGroup ' + type + '"><h3>' + title + '</h3><p class="note">' + why + '</p><div class="bitRow">' + cvBits.filter(b => cvBitFamily(b) === type).map(b => '<div class="bitTile' + (b.have ? ' have' : '') + (on === b ? ' sel' : '') + '"><button class="bitPick" data-bitpick="' + esc(b.id) + '" aria-pressed="' + (on === b) + '" title="See its sizes and speeds">' + cvBitArt(b) + '<span>' + esc(b.name) + '</span></button><label class="bitOwn"><input type="checkbox" data-bithave="' + esc(b.id) + '" ' + (b.have ? 'checked' : '') + ' aria-label="I have ' + esc(b.name) + '">' + (type === 'corn' ? 'Have' : 'I have this') + '</label></div>').join('') + '<button class="bitAdd" data-bitadd="' + type + '" title="Add another" aria-label="Add another ' + esc(title) + '">' + ic('plus') + '</button></div></section>').join('');
}
function cvBigRender() { const b = cvBitOpenOne(); cvEl('bitBig').innerHTML = b ? cvBitArt(b, true) : ''; }
function cvFormRender() {
  const b = cvBitOpenOne(), box = cvEl('bitForm'); if (!b) { box.innerHTML = '<p class="note">Add a bit to set its sizes.</p>'; return; }
  const field = ([k, label, kind]) => '<label>' + label + (kind === 'len' ? (cvIsInch() ? ', inches' : ', mm') : '') + '<input data-bit="' + esc(b.id) + '" data-key="' + k + '" data-type="' + kind + '" value="' + esc(kind === 'len' ? cvNum(b[k] || 0) : b[k] ?? 0) + '"></label>';
  const fields = CV_BIT_FIELDS.filter(f => !f[3] || b.type === f[3] || (f[3] === 'flat' && b.type === 'ball'));
  box.innerHTML = '<div class="bitTitle"><input class="bitName" data-bit="' + esc(b.id) + '" data-key="name" value="' + esc(b.name) + '" aria-label="Name of this bit"><select data-bit="' + esc(b.id) + '" data-key="type" aria-label="Kind of bit"><option value="flat" ' + (b.type === 'flat' ? 'selected' : '') + '>Flat bit</option><option value="v" ' + (b.type === 'v' ? 'selected' : '') + '>V-bit</option><option value="ball" ' + (b.type === 'ball' ? 'selected' : '') + '>Ball nose</option></select><button class="ic" data-bitcopy="' + esc(b.id) + '" title="Make a copy" aria-label="Copy ' + esc(b.name) + '">' + ic('copy') + '</button><button class="ic" data-bitdel="' + esc(b.id) + '" title="Delete this bit" aria-label="Delete ' + esc(b.name) + '">' + ic('trash-2') + '</button></div>'
    + '<div class="hwform">' + fields.filter(f => !f[4]).map(field).join('') + '</div><h3>How fast it cuts</h3><p class="note">Cautious starting points from your machine notes, untested on this bit and wood. S1000 is full speed on your machine.</p><div class="hwform">' + fields.filter(f => f[4]).map(field).join('') + '</div>';
}
function cvBitsRender() { cvRackRender(); cvBigRender(); cvFormRender(); const n = cvOwned().length; cvEl('bitsCount').textContent = n === 1 ? 'You have 1 bit' : 'You have ' + n + ' bits'; }
function cvOpenBits(focusId) { if (typeof focusId === 'string') cvOpenBit = focusId; cvBitsRender(); cvEl('bitsDlg').showModal(); cvEl('bitsDlg').focus(); }
function cvBitsChanged() { cvBitsSave(); if (P.carve) { cvBitsSync(); persist(); } carveRender(); }
const bitListEl = cvEl('bitList');
bitListEl.addEventListener('keydown', e => e.stopPropagation());
bitListEl.addEventListener('click', e => {
  const pick = e.target.closest('[data-bitpick]'), add = e.target.closest('[data-bitadd]'), del = e.target.closest('[data-bitdel]'), copy = e.target.closest('[data-bitcopy]');
  if (pick) { cvOpenBit = pick.dataset.bitpick; cvBitsRender(); const again = cvEl('bitRack').querySelector('[data-bitpick="' + CSS.escape(cvOpenBit) + '"]'); if (again) again.focus(); return; }
  if (!add && !del && !copy) return;
  e.preventDefault();
  if (add) { const type = add.dataset.bitadd, base = CV_BITS_START.find(x => cvBitFamily(x) === type) || (type === 'ball' ? CV_BIT_BALL : CV_BITS_START[0]), id = 'bit-' + Date.now().toString(36); cvBits.push({ ...JSON.parse(JSON.stringify(base)), id, name: type === 'v' ? 'New V-bit' : type === 'corn' ? 'New corn bit' : type === 'ball' ? 'New ball nose' : 'New flat bit', have: true }); cvOpenBit = id; }
  if (copy) { const b = cvBits.find(x => x.id === copy.dataset.bitcopy), id = 'bit-' + Date.now().toString(36); cvBits.push({ ...JSON.parse(JSON.stringify(b)), id, name: b.name + ' copy' }); cvOpenBit = id; }
  if (del) { cvBits = cvBits.filter(x => x.id !== del.dataset.bitdel); cvOpenBit = null; }
  cvBitsRender(); cvBitsChanged();
});
bitListEl.addEventListener('change', e => {
  const have = e.target.closest('[data-bithave]');
  if (have) {
    const b = cvBits.find(x => x.id === have.dataset.bithave); if (!b) return; b.have = have.checked;
    if (b.have && P.carve) P.carve.items.forEach(i => { if (i.op && i.op.kind !== 'off' && !i.op.bit) i.op.bit = cvBestBit(i.op.kind); });   // anything waiting for a bit gets one
    cvOpenBit = b.id; cvBitsChanged(); cvBitsRender();
    const again = cvEl('bitRack').querySelector('[data-bithave="' + CSS.escape(b.id) + '"]'); if (again) again.focus();
    return;
  }
  const inp = e.target.closest('[data-bit]'); if (!inp) return;
  const b = cvBits.find(x => x.id === inp.dataset.bit), k = inp.dataset.key; if (!b) return;
  if (k === 'name') { const v = inp.value.trim(); if (!v) { inp.value = b.name; toast('It needs a name.', true); return; } b.name = v; }
  else if (k === 'type') { b.type = inp.value; if (b.type === 'v' && !b.angle) { b.angle = 60; b.tip = .1; } cvFormRender(); }
  else { const v = inp.dataset.type === 'len' ? cvParse(inp.value) : parseFloat(inp.value.replace(/,/g, '')); if (!(v >= 0) || (k !== 'tip' && k !== 'reach' && v === 0)) { toast('Type a number above zero.', true); inp.value = inp.dataset.type === 'len' ? cvNum(b[k]) : b[k]; return; } b[k] = v; }
  cvRackRender(); cvBigRender();   // the form stays, so Tab carries on to the next box
  cvBitsChanged();
});

// ---------- saving the G-code ----------
// air: the same job lifted clear of the board, to watch it run before cutting
async function cvExport(air) {
  const cv = cvNow(), bad = cvChecks(cv, cvBitOf, cvOwned().length > 0).filter(c => c.bad); if (bad.length) { toast(bad[0].text, true); return; }
  const lift = air ? cvAirOf(cv) : 0, job = cvJob(cv, cvBitOf, P.name, lift), tag = air ? ' AIR TEST' : ''; if (!job.length) { toast('Nothing is set to be cut.', true); return; }
  if (job.length === 1) downloadBlob(`${P.name} carve${tag}.nc`, job[0].text, 'text/plain');
  else { const enc = new TextEncoder(), bytes = await zipBytes(job.map(f => ({ name: f.name, data: enc.encode(f.text) }))); downloadBlob(`${P.name} carve${tag}.zip`, bytes, 'application/zip'); }
  if (air) toast(`Air test made: it runs ${cvLen(lift)} above the board and cuts nothing. Zero on the board top as usual.`);
  else toast(job.length === 1 ? 'G-code made. Run the air test first.' : `${job.length} G-code files made, one per bit. Run them in numbered order, after an air test.`);
}

// ---------- opening, keys ----------
// A carving shows only the menu commands that make sense for it.
function cvMenusShow(on) {
  document.querySelectorAll('#menus .menu').forEach(m => {
    let any = false;
    m.querySelectorAll('.mlist [data-do]').forEach(b => { const a = b.dataset.do, ok = a === 'carvecopy' ? !on && !!(P && P.carve && P.carve.items.length) : !on || CV_ANYWHERE.has(a) || a.startsWith('recent:'); b.hidden = !ok; if (ok) any = true; });
    m.querySelectorAll('.mlist > hr').forEach(h => { h.hidden = on; }); m.hidden = !any;
  });
}
function cvModeShow(on) { cvMenusShow(on); document.body.classList.toggle('carving', on); cvEl('carve').classList.toggle('open', on); cvEl('modeDesign').setAttribute('aria-selected', !on); cvEl('modeCarve').setAttribute('aria-selected', on); cvEl('fCarve').textContent = ''; }
async function openCarve() {
  const cv = cvNow();
  cvModeShow(true); P.carveMode = true; autosave(); cvView = null; cvSel = null; cvNodeEdit = null; cvTool = null;
  carveRender();
  await Promise.all([...new Set(cv.items.filter(i => i.type === 'text').map(i => i.font))].map(cvFontLoad));
  await ensureModels(); carveRender();
  if (cvLayout !== 'board' && cvOpen()) cv3dShow(true); else cvLayoutShow('board');
  if (!cvOwned().length) cvOpenBits();
}
function closeCarve() { CV3D.gcode = null; if (CV3D.on) cv3dShow(false); cvModeShow(false); cvSel = null; cvNodeEdit = null; cvTool = null; if (P.carveMode) { P.carveMode = false; autosave(); } dirty = true; }
// A project is a design or a carving, chosen when it's started. Older projects open the way they were left.
const cvKind = p => p.kind || (p.carveMode && p.carve ? 'carve' : 'design');
function cvSyncMode() { if (cvKind(P) === 'carve') { if (!cvOpen()) openCarve(); else { cvView = null; cvSel = null; carveRender(); } } else if (cvOpen()) closeCarve(); }
// menu commands in a carving: these act on the board, these work anywhere, and the rest belong to designs, so they're left out
const CV_ANYWHERE = new Set(['undo', 'redo', 'save', 'saveas', 'new', 'open', 'machine', 'palette', 'keys', 'help', 'history', 'theme', 'tbsep', 'tbreset']);
function cvRoute(a) {
  if (a === 'del') { cvRemove(); return true; }
  if (a === 'dup') { cvCopy(); return true; }
  if (a === 'fit') { if (CV3D.on) cv3dAim(); else { cvView = null; cvStageRender(); } return true; }
  return !CV_ANYWHERE.has(a) && !a.startsWith('recent:');   // a design's command does nothing here
}
window.addEventListener('keydown', e => {
  if (!cvOpen() || document.querySelector('dialog[open]')) return;
  const a = document.activeElement, typing = a && /INPUT|SELECT|TEXTAREA/.test(a.tagName) && a.type !== 'checkbox', mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
  if (mod && k === 's') { e.preventDefault(); DO.save(); return; }
  if (typing) { if (e.key === 'Enter' && a.tagName === 'INPUT') a.blur(); return; }
  if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); if (!cvItem()) cvSel = null; carveRender(); return; }
  if (mod && k === 'y') { e.preventDefault(); redo(); if (!cvItem()) cvSel = null; carveRender(); return; }
  if (mod && k === 'd') { e.preventDefault(); cvCopy(); return; }
  if (mod && (k === 'c' || k === 'x')) { e.preventDefault(); cvCopyPicked(k === 'x'); return; }
  if (mod && k === 'v') { e.preventDefault(); cvPaste(); return; }
  if (mod && k === 'g') { e.preventDefault(); const list = cvPicked(); if (e.shiftKey) cvUngroup(list); else if (list.length > 1) cvGroup(list); return; }
  if (mod && k === 'a') { e.preventDefault(); cvPickList(P.carve.items.slice()); carveRender(); return; }
  if (mod) return;
  if (k === 'escape') { if (cvTool) { cvToolCancel(); return; } if (cvNodesStop()) return; if (cvSel !== null) { cvPickOnly(null); carveRender(); } return; }
  if (k === 'p' && !cvTool) { cvToolStart('pen'); return; }
  if (k === 'enter' && cvTool) { e.preventDefault(); cvToolFinish(false); return; }
  if (k === 'delete' || k === 'backspace') { e.preventDefault(); if (!cvNodeDelete()) cvRemove(); return; }
  if (k === 'f') { if (CV3D.on) cv3dAim(); else { cvView = null; cvStageRender(); } return; }
  if (k === ' ' && CV3D.on) { e.preventDefault(); if (cvPlayFrame) cvPlayStop(); else cvPlayStart(); return; }
  const it = cvItem(), step = e.shiftKey ? 10 : 1, nudge = { arrowleft: [-step, 0], arrowright: [step, 0], arrowup: [0, step], arrowdown: [0, -step] }[k];
  if (it && nudge) { e.preventDefault(); const list = cvPicked(); cvEdit(() => { list.forEach(i => { i.x += nudge[0]; i.y += nudge[1]; }); }); }
}, true);

const cvSide = cvEl('cvSide');
cvSide.addEventListener('input', e => {   // the depth gauge follows the slider as it moves; the depth is kept when it's let go
  const r = e.target; if (r.dataset.cf !== 'op.depthR') return; const it = cvItem(), g = r.closest('.gauge'); if (!it || !g) return;
  g.querySelector('.gsvg').innerHTML = cvGaugeSvg(cvNow(), cvBitOf(it.op.bit), +r.value); const box = cvSide.querySelector('[data-cf="op.depth"]'); if (box) box.value = cvNum(+r.value);
});
cvSide.addEventListener('toggle', e => { const d = e.target; if (d.dataset && d.dataset.cmore) { if (d.open) cvMoreOpen.add(d.dataset.cmore); else cvMoreOpen.delete(d.dataset.cmore); return; } if (d.classList && d.classList.contains('pickMore')) cvCornOpen = d.open; else if (d.dataset && d.dataset.csec) { if (d.open) cvClosedSecs.delete(d.dataset.csec); else cvClosedSecs.add(d.dataset.csec); } }, true);
cvEl('cvHead').addEventListener('click', e => { if (e.target.closest('[data-cdone]')) { if (cvTool) cvToolCancel(); else { cvPickOnly(null); carveRender(); } } });
cvSide.addEventListener('change', e => { if (e.target.dataset.cf) cvFieldChange(e.target); });
cvSide.addEventListener('focusin', e => { const t = e.target; if (t.dataset && t.dataset.fxtext && t.value !== t.dataset.fxtext) { t.dataset.plain = t.value; t.value = t.dataset.fxtext; } });
cvSide.addEventListener('focusout', e => { const t = e.target; if (t.dataset && t.dataset.fxtext && t.value === t.dataset.fxtext && t.dataset.plain != null) t.value = t.dataset.plain; });
cvSide.addEventListener('click', e => {
  const pick = e.target.closest('[data-cpick]'); if (pick) { cvSel = +pick.dataset.cpick; carveRender(); return; }
  const act = e.target.closest('[data-cact]'); if (!act) return; const it = cvItem(), b = P.carve.board, a = act.dataset.cact;
  if (a === 'padd') { edit(() => fxAddParam(null)); return; }
  if (a === 'pdel') { const i = +act.dataset.i; edit(() => { (P.params || []).splice(i, 1); }); return; }
  if (cvToolAction(a, act)) return;
  if (a === 'pickopen') { cvPickOpenFor = it ? it.id : null; cvPanelRender(); return; }
  if (a === 'bits') { cvOpenBits(it && it.op && it.op.bit ? it.op.bit : undefined); return; } if (a === 'del') cvRemove(); if (a === 'dup') cvCopy();
  if (a === 'midx') cvEdit(() => { it.x = b.l / 2; }); if (a === 'midy') cvEdit(() => { it.y = b.w / 2; });
});
cvEl('cvChecks').addEventListener('click', e => { const pick = e.target.closest('[data-cpick]'); if (pick) { cvSel = +pick.dataset.cpick; carveRender(); } });
cvEl('modeDesign').onclick = () => { if (cvOpen()) closeCarve(); };
cvEl('modeCarve').onclick = () => { if (!cvOpen()) openCarve(); };
cvEl('bitsClose').onclick = () => cvEl('bitsDlg').close();
cvEl('cvBits').onclick = () => cvOpenBits();
cvEl('cvMach').onclick = () => machOpen();
cvEl('cvExport').onclick = () => cvExport(false);
cvEl('cvAir').onclick = () => cvExport(true);
cvEl('cvPaths').onclick = () => { cvShowPaths = !cvShowPaths; carveRender(); cv3dExtras(); };
cvEl('cvFitBtn').onclick = () => { if (CV3D.on) cv3dAim(); else { cvView = null; cvStageRender(); } };
cvEl('cv3dBtn').onclick = () => cvLayoutSet(CV3D.on ? 'board' : cvLayout === 'board' ? '3d' : cvLayout);
cvEl('cvPlayBtn').onclick = () => (cvPlayFrame ? cvPlayStop() : cvPlayStart());
cvEl('cvPlayBack').onclick = () => { cvPlayStop(); cvPlaySeek(0); };
cvEl('cvPlayNext').onclick = cvPlayNextPart;
cvEl('cvPlayAt').oninput = e => { cvPlayStop(); const P3 = CV3D.play; if (P3) cvPlaySeek(P3.total * e.target.value / 1000); };
cvEl('cvPlay').addEventListener('keydown', e => { if (e.key === ' ') e.stopPropagation(); });
cvEl('cvAddText').onclick = () => cvAddText();
cvEl('cvAddRect').onclick = cvAddRect;
cvEl('cvAddCircle').onclick = cvAddCircle;
cvEl('cvAddPolygon').onclick = () => cvAddPolygon('polygon');
cvEl('cvAddStar').onclick = () => cvAddPolygon('star');
cvEl('cvAddPen').onclick = () => cvToolStart('pen');
cvEl('cvTrim').onclick = () => cvToolStart('trim');
cvEl('cvAddArc').onclick = () => cvToolStart('arc');
cvEl('cvExtend').onclick = () => cvToolStart('extend');
cvEl('cvDim').onclick = () => cvToolStart('dim');
cvEl('cvAddClamp').onclick = () => cvAddClamp();
cvEl('cvStage').addEventListener('dblclick', e => { if (cvTool) { e.preventDefault(); cvToolFinish(false); } else if (cvNodeItem()) { e.preventDefault(); cvNodeAdd(cvPoint(e)); } });
cvEl('cvAddSvg').onclick = () => cvEl('cvSvgIn').click();
cvEl('cvSvgIn').onchange = async e => { const files = [...e.target.files]; e.target.value = ''; await cvImportFiles(files); };
// files dropped on the board or the 3D view come in the same way
cvEl('cvStageWrap').addEventListener('dragover', e => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
cvEl('cvStageWrap').addEventListener('drop', e => { if (!e.dataTransfer || !e.dataTransfer.files.length) return; e.preventDefault(); cvImportFiles([...e.dataTransfer.files]); });
const cvStage = cvEl('cvStage');
cvStage.addEventListener('pointerdown', cvStageDown);
cvStage.addEventListener('pointermove', cvStageMove);
cvStage.addEventListener('pointerup', cvStageUp);
cvStage.addEventListener('pointercancel', cvStageUp);
cvStage.addEventListener('wheel', cvWheel, { passive: false });
cvStage.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); });
new ResizeObserver(() => { if (cvOpen() && cvView) cvStageRender(); if (CV3D.on) cv3dSize(); }).observe(cvEl('cvStageWrap'));
[['cv3dBtn', 'box'], ['cvAddText', 'type'], ['cvAddSvg', 'image'], ['cvAddRect', 'square'], ['cvAddCircle', 'circle'], ['cvBits', 'drill'], ['cvMach', 'plug'], ['bitsMark', 'drill'], ['cvPaths', 'eye'], ['cvFitBtn', 'scan'], ['cvExport', 'download'], ['cvAir', 'wind'], ['cvPlayBtn', 'play'], ['cvPlayBack', 'skip-back'], ['cvPlayNext', 'skip-forward']].forEach(([id, name]) => addIcon(cvEl(id), name));
cvBitsStart();

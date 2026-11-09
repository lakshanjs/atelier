// ---------- looking at a G-code file ----------
// A .nc file can't become shapes again: it's only where the bit goes. So it's opened to be looked at in Carve's 3D view,
// on the board as it is, from X0 Y0 at the board's zero point: the cut it makes, played back like a carving, its size,
// depth and time, and anything GRBL 1.1 would refuse. The bit isn't in the file, so it's guessed from its comments and can
// be changed. Closing it goes back to the carving.

// what GRBL 1.1 accepts; anything else is reported with its line
const GC_OK_G = new Set(['0', '1', '2', '3', '4', '10', '17', '18', '19', '20', '21', '28', '28.1', '30', '30.1', '38.2', '38.3', '38.4', '38.5', '40', '43.1', '49', '53', '54', '55', '56', '57', '58', '59', '61', '80', '90', '91', '91.1', '92', '92.1', '93', '94']);
const GC_OK_M = new Set(['0', '1', '2', '30', '3', '4', '5', '7', '8', '9', '56']);
const GC_SEG = .5;   // arcs are followed in steps this long, in mm

// Reads a file into straight moves in millimetres, from X0 Y0 Z0. Each move knows its line, whether it's a rapid, and the
// time it ends, in minutes, at the file's own feeds (rapids at maxRate).
function cvGcodeParse(text, maxRate = 1500) {
  const moves = [], problems = [], comments = [];
  let pos = [0, 0, 0], motion = '0', abs = true, k = 1, f = 0, t = 0, plane = '17', lines = 0, other = 0, seenMove = false;
  const say = (n, s) => { if (problems.length < 40) problems.push({ line: n, text: s }); else other++; };
  const go = (b, rapid, n) => {
    const a = pos, d = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]); pos = b; if (d < 1e-9) return;
    const rate = rapid ? maxRate : f > 0 ? Math.min(f, maxRate * 4) : maxRate; t += d / rate;
    moves.push({ a, b, rapid, line: n, t });
  };
  text.split(/\r?\n/).forEach((raw, i) => {
    const n = i + 1; let s = raw;
    s = s.replace(/\(([^)]*)\)/g, (m, c) => { comments.push(c); return ' '; }); const semi = s.indexOf(';'); if (semi >= 0) { comments.push(s.slice(semi + 1)); s = s.slice(0, semi); }
    s = s.trim().toUpperCase(); if (!s || s === '%') return; lines++;
    const words = [...s.matchAll(/([A-Z])\s*([-+]?(?:\d+\.?\d*|\.\d+))/g)].map(m => [m[1], m[2]]);
    if (!words.length) { say(n, `can't read "${raw.trim().slice(0, 30)}"`); return; }
    const val = {}; let dwell = false, home = false;
    words.forEach(([c, v]) => {
      if (c === 'G') {
        const g = String(parseFloat(v)); if (!GC_OK_G.has(g)) { say(n, `G${g} isn't something GRBL does`); return; }
        if (['0', '1', '2', '3', '38.2', '38.3', '38.4', '38.5', '80'].includes(g)) motion = g;
        else if (g === '20') k = 25.4; else if (g === '21') k = 1; else if (g === '90') abs = true; else if (g === '91') abs = false;
        else if (g === '17' || g === '18' || g === '19') plane = g; else if (g === '4') dwell = true; else if (g === '28' || g === '30') home = true;
        else if (g === '53') say(n, 'G53 moves in machine coordinates; shown as if from X0 Y0');
        else if (g === '93') say(n, 'G93 inverse time feed: the time shown is a guess');
        return;
      }
      if (c === 'M') { const m = String(parseFloat(v)); if (m === '6') say(n, 'M6 tool change: GRBL refuses it (error 20). Split the file per bit instead'); else if (!GC_OK_M.has(m)) say(n, `M${m} isn't something GRBL does`); return; }
      if (c === 'F') { f = parseFloat(v) * k; return; }
      val[c] = parseFloat(v);
    });
    if (dwell) { if (val.P > 0) t += val.P / 60; return; }
    if (home) { if ('X' in val || 'Y' in val || 'Z' in val) say(n, 'G28/G30 goes to a stored position; shown going straight to X0 Y0 above the board'); return; }
    if (!['X', 'Y', 'Z'].some(c => c in val)) return;
    const to = [0, 1, 2].map(j => { const c = 'XYZ'[j]; return c in val ? (abs ? val[c] * k : pos[j] + val[c] * k) : pos[j]; });
    if (motion === '0' || motion === '1') { if (motion === '1' && !(f > 0)) say(n, 'a cut with no feed rate set (GRBL error 22)'); go(to, motion === '0', n); seenMove = true; return; }
    if (motion === '2' || motion === '3') {
      if (plane !== '17') { say(n, 'an arc on the XZ or YZ plane: shown straight'); go(to, false, n); return; }
      const a = pos, cw = motion === '2'; let cx, cy;
      if ('R' in val) {
        const r = val.R * k, dx = to[0] - a[0], dy = to[1] - a[1], d = Math.hypot(dx, dy); if (d < 1e-9 || Math.abs(r) * 2 < d - 1e-6) { say(n, 'an arc whose radius is too small for its ends (GRBL error 33)'); go(to, false, n); return; }
        const h = Math.sqrt(Math.max(0, r * r - d * d / 4)) * ((cw ? 1 : -1) * (r < 0 ? -1 : 1)), mx = (a[0] + to[0]) / 2, my = (a[1] + to[1]) / 2;
        cx = mx - h * dy / d; cy = my + h * dx / d;
      } else { cx = a[0] + (val.I || 0) * k; cy = a[1] + (val.J || 0) * k; }
      const r0 = Math.hypot(a[0] - cx, a[1] - cy), r1 = Math.hypot(to[0] - cx, to[1] - cy);
      if (Math.abs(r0 - r1) > .005 && Math.abs(r0 - r1) > r0 * .001) say(n, `an arc whose ends aren't the same distance from its centre (${(Math.abs(r0 - r1)).toFixed(3)} mm out; GRBL error 33)`);
      let a0 = Math.atan2(a[1] - cy, a[0] - cx), a1 = Math.atan2(to[1] - cy, to[0] - cx), sweep = a1 - a0;
      if (cw) { if (sweep >= -1e-9) sweep -= Math.PI * 2; } else if (sweep <= 1e-9) sweep += Math.PI * 2;
      const steps = Math.max(1, Math.min(720, Math.ceil(Math.abs(sweep) * Math.max(r0, r1) / GC_SEG)));
      if (!(f > 0)) say(n, 'an arc with no feed rate set (GRBL error 22)');
      for (let j = 1; j <= steps; j++) { const u = j / steps, ang = a0 + sweep * u, r = r0 + (r1 - r0) * u; go(j === steps ? to : [cx + Math.cos(ang) * r, cy + Math.sin(ang) * r, a[2] + (to[2] - a[2]) * u], false, n); }
      seenMove = true; return;
    }
    if (motion.startsWith('38')) { say(n, 'a probing move: shown as a straight move'); go(to, false, n); }
  });
  if (other) problems.push({ line: 0, text: `and ${other} more` });
  if (!seenMove) problems.push({ line: 0, text: 'no moves found' });
  // where it cuts, and how deep
  const cut = moves.filter(m => !m.rapid), pts = cut.flatMap(m => [m.a, m.b]), box = pts.length ? pts.reduce((b, q) => ({ x0: Math.min(b.x0, q[0]), x1: Math.max(b.x1, q[0]), y0: Math.min(b.y0, q[1]), y1: Math.max(b.y1, q[1]), z0: Math.min(b.z0, q[2]) }), { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity, z0: 0 }) : null;
  // a rapid that ends in the wood, or goes sideways below the top, is a crash; lifting straight out of a cut is not
  moves.forEach(m => { if (!m.rapid) return; const low = Math.min(m.a[2], m.b[2]), across = Math.hypot(m.b[0] - m.a[0], m.b[1] - m.a[1]) > 1e-6; if (m.b[2] < -.01 || (across && low < -.01)) say(m.line, `a rapid move ${(-low).toFixed(2)} mm into the wood`); });
  return { moves, problems, comments, box, total: t, lines, inch: k !== 1 };
}

// the bit named in its comments, as this app writes it ("Bit: name, 3.175 mm"), or any size given with "bit", "tool" or "mill"
function cvGcodeGuessBit(G) {
  const owned = cvBits.filter(b => b.have), pool = owned.length ? owned : cvBits;
  for (const c of G.comments) { const m = /bit:\s*([^,]+),/i.exec(c); if (m) { const b = pool.find(x => x.name.trim().toLowerCase() === m[1].trim().toLowerCase()); if (b) return b.id; } }
  for (const c of G.comments) {
    if (!/bit|tool|mill|cutter|dia/i.test(c)) continue; const m = /(\d+(?:\.\d+)?)\s*(mm|")?/.exec(c.replace(/^.*?(bit|tool|mill|cutter|dia)/i, '')); if (!m) continue;
    const d = parseFloat(m[1]) * (m[2] === '"' ? 25.4 : 1), v = /v[- ]?bit|\bv\b|vee|engrav/i.test(c);
    const best = pool.filter(b => !v || b.type === 'v').sort((a, b) => Math.abs(a.d - d) - Math.abs(b.d - d))[0]; if (best) return best.id;
  }
  return (pool.find(b => b.type === 'flat') || pool[0] || {}).id;
}

let cvGcodeN = 0;
async function cvGcodeOpen(f) { return cvGcodeOpenText(await f.text(), f.name); }
async function cvGcodeOpenText(text, name) {
  const G = cvGcodeParse(text, (P && P.carve && P.carve.maxRate) || 1500);
  if (!G.moves.length) throw new Error('there are no moves in it');
  if (!cvOpen()) {   // from a design, a new carving is made for it, with a board that fits it
    if (!P.carve || P.kind !== 'carve') loadProject({ ...newProject(name.replace(/\.[^.]+$/, '')), kind: 'carve', carve: CV_DEFAULT() });
    if (!cvOpen()) await openCarve();
    if (!P.carve.items.length) cvGcodeFitBoard(G, false);
  }
  CV3D.gcode = { id: ++cvGcodeN, name, G, text, bit: cvGcodeGuessBit(G) };
  if (!CV3D.on) cvLayoutSet(cvLayout === 'board' ? '3d' : cvLayout); else { CV3D.key = ''; cv3dBake(); }
  cvGcodeBar(); cv3dAim(); cv3dDraw(); carveRender();
}
// The open file on the flat board, from the board's zero: cutting moves solid, moves through the air dashed and faint.
// Built once per file and zero; only the line widths follow the zoom.
function cvGcodeSvg(px) {
  const g = CV3D.gcode; if (!g || !P || !P.carve) return '';
  const [zx, zy] = cvZeroAt(P.carve), W = P.carve.board.w, key = [g.id, zx, zy, W].join(':');
  if (g.svgKey !== key) {
    const f = v => +v.toFixed(3), pt = q => `${f(q[0] + zx)} ${f(W - (q[1] + zy))}`, out = { cut: '', air: '' }, end = { cut: null, air: null };
    g.G.moves.forEach(m => {
      if (!m.a || (Math.abs(m.a[0] - m.b[0]) < 1e-6 && Math.abs(m.a[1] - m.b[1]) < 1e-6)) return;   // straight up or down: nothing to see from above
      const k = m.rapid || (m.a[2] >= 0 && m.b[2] >= 0) ? 'air' : 'cut', a = pt(m.a), b = pt(m.b);
      out[k] += (end[k] === a ? '' : `M${a}`) + `L${b}`; end[k] = b;
    });
    g.svgKey = key; g.svgCut = out.cut; g.svgAir = out.air;
  }
  return `<g pointer-events="none" id="cvGcode2d"><path d="${g.svgAir}" fill="none" stroke="#3d4a50" stroke-opacity=".4" stroke-width="${px}" stroke-dasharray="${3 * px} ${3 * px}"/><path d="${g.svgCut}" fill="none" stroke="#4a2410" stroke-width="${1.6 * px}" stroke-linejoin="round" stroke-linecap="round"/></g>`;
}
function cvGcodeClose() { CV3D.gcode = null; CV3D.key = ''; const bar = cvEl('cvGcodeBar'); if (bar) bar.hidden = true; cv3dBake(); carveRender(); }
// sizes the board to the job with a 10 mm margin, as deep as its deepest cut, and puts the zero where the job's X0 Y0 lands
function cvGcodeFitBoard(G, undoable = true) {
  const cv = P.carve, b = G.box; if (!b) return; const m = 10, l = Math.ceil(b.x1 - b.x0 + m * 2), w = Math.ceil(b.y1 - b.y0 + m * 2), t = Math.max(cv.board.t, Math.ceil(-b.z0 * 10) / 10);
  const doIt = () => { cv.board.l = l; cv.board.w = w; cv.board.t = t; cv.zero = [(m - b.x0) / l, (m - b.y0) / w]; };
  if (undoable) cvEdit(doIt); else { doIt(); persist(); }
  cvView = null; CV3D.key = ''; cv3dBake(); cvGcodeBar(); cv3dAim(); carveRender();
}
// the moves on the board, played and cut like a carving
function cvGcodeBake() {
  const g = CV3D.gcode, cv = cvNow(), bit = cvBitOf(g.bit) || cvBits[0], key = `gcode:${g.id}:${g.bit}:${JSON.stringify([cv.board, cv.zero])}`; if (key === CV3D.key && CV3D.mesh) return;
  cvPlayStop();
  const [zx, zy] = cvZeroAt(cv), at = q => [q[0] + zx, q[1] + zy, q[2]], steps = [], parts = []; let was = true;
  g.G.moves.forEach(m => { if (!m.rapid && was) parts.push({ from: steps.length, t: steps.length ? steps[steps.length - 1].t : 0, bit, gcode: true, line: m.line }); was = m.rapid; steps.push({ a: at(m.a), b: at(m.b), bit, t: m.t, rapid: m.rapid, line: m.line }); });
  const map = cvCarveGrid(cv); steps.forEach(s => { if (!s.rapid) cvStamp(map, s.a, s.b, bit); });
  const fresh = cv3dMesh(map); cv3dDispose(); CV3D.mesh = fresh; CV3D.scene.add(fresh); CV3D.key = key;
  CV3D.play = { steps, parts, total: g.G.total, map, t: g.G.total, upto: steps.length };
  cvPlayShow(); cv3dExtras(); cv3dDraw();
}
// what it is, the bit, and what's wrong with it
function cvGcodeBar() {
  const g = CV3D.gcode; let bar = cvEl('cvGcodeBar'); if (!g) { if (bar) bar.hidden = true; return; }
  if (!bar) { cvEl('cv3d').insertAdjacentHTML('beforeend', '<div id="cvGcodeBar" role="region" aria-label="G-code file"></div>'); bar = cvEl('cvGcodeBar'); bar.addEventListener('click', cvGcodeBarClick); bar.addEventListener('change', e => { if (e.target.id === 'cvGcBit') { CV3D.gcode.bit = e.target.value; cv3dBake(); } }); bar.addEventListener('keydown', e => e.stopPropagation()); }
  const G = g.G, cv = cvNow(), b = G.box, L = v => cvLen(v), [zx, zy] = cvZeroAt(cv), warn = G.problems.map(p => (p.line ? `Line ${p.line}: ` : '') + p.text);
  if (b) {
    const R = (cvBitOf(g.bit) || { d: 0 }).d / 2;
    if (b.x0 + zx < -R - .01 || b.y0 + zy < -R - .01 || b.x1 + zx > cv.board.l + R + .01 || b.y1 + zy > cv.board.w + R + .01) warn.unshift('It goes past the edge of the board, from where the board\'s zero is. Fit the board to it, or move the zero.');
    if (b.x1 - b.x0 > (cv.workX ?? 300) || b.y1 - b.y0 > (cv.workY ?? 180)) warn.unshift(`It's bigger than the machine can reach (${L(cv.workX ?? 300)} x ${L(cv.workY ?? 180)}).`);
    if (-b.z0 > cv.board.t + .01) warn.unshift(`It cuts ${L(-b.z0 - cv.board.t)} below the board, into the wasteboard.`);
  }
  const bits = cvBits.filter(x => x.have || x.id === g.bit), opts = (bits.length ? bits : cvBits).map(x => `<option value="${esc(x.id)}" ${x.id === g.bit ? 'selected' : ''}>${esc(x.name)}</option>`).join('');
  const size = b ? `${L(b.x1 - b.x0)} x ${L(b.y1 - b.y0)}, ${L(-b.z0)} deep` : 'no cuts';
  bar.hidden = false;
  bar.innerHTML = `<div class="gcrow">${ic('file-output')}<b title="${esc(g.name)}">${esc(g.name)}</b><span>${size}, about ${Math.max(1, Math.round(G.total))} min, ${G.lines} lines${G.inch ? ', in inches' : ''}</span>`
    + `<label>Bit <select id="cvGcBit" title="The file doesn't say which bit; this one is drawn">${opts}</select></label>`
    + `<button class="btn line" data-gc="fit" title="Make the board this job's size, with the zero where it starts">Fit the board to it</button><button class="btn line" data-gc="send" title="Run this file on the machine">${ic('plug')}Send to machine</button><button class="btn line" data-gc="close" title="Back to the carving">${ic('x')}Close</button></div>`
    + (warn.length ? `<ul class="gcwarn">${warn.map(w => `<li>${esc(w)}</li>`).join('')}</ul>` : '<p class="gcok">Nothing in it that GRBL would refuse.</p>');
}
function cvGcodeBarClick(e) { const b = e.target.closest('[data-gc]'); if (!b) return; if (b.dataset.gc === 'close') cvGcodeClose(); else if (b.dataset.gc === 'fit') cvGcodeFitBoard(CV3D.gcode.G); else if (b.dataset.gc === 'send') machOpen('view'); }

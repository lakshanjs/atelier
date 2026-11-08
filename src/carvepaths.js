// ---------- carving: from shapes to G-code ----------
// Text, SVG art and simple shapes on one board become bit paths, and those become G-code for GRBL (sent by gSender).
// Everything here is in mm, on the board: X along its length from the left, Y along its width from the front, Z0 on top.
// GRBL has no tool changer and refuses M6, so every bit gets its own file. Curves go out as short straight lines.
const CV_K = 1000;   // Clipper works in whole numbers: this makes them microns
const cvIn = polys => polys.filter(p => p.length > 2).map(p => p.map(q => ({ X: Math.round(q[0] * CV_K), Y: Math.round(q[1] * CV_K) })));
const cvOut = paths => paths.map(p => p.map(q => [q.X / CV_K, q.Y / CV_K]));
function cvClip(type, a, b, even) {
  const c = new ClipperLib.Clipper(), fill = even ? ClipperLib.PolyFillType.pftEvenOdd : ClipperLib.PolyFillType.pftNonZero, out = new ClipperLib.Paths();
  c.AddPaths(cvIn(a), ClipperLib.PolyType.ptSubject, true);
  if (b && b.length) c.AddPaths(cvIn(b), ClipperLib.PolyType.ptClip, true);
  c.Execute(type, out, fill, fill);
  return cvOut(out);
}
const cvUnion = (a, even) => cvClip(ClipperLib.ClipType.ctUnion, a, null, even);
const cvMinus = (a, b) => cvClip(ClipperLib.ClipType.ctDifference, a, b);
function cvOffset(polys, by, sharp) {
  const o = new ClipperLib.ClipperOffset(4, 15), out = new ClipperLib.Paths();
  o.AddPaths(cvIn(polys), sharp ? ClipperLib.JoinType.jtMiter : ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
  o.Execute(out, by * CV_K);
  return cvOut(ClipperLib.Clipper.CleanPolygons(out, 8)).filter(p => p.length > 2);
}
function cvIslands(polys) {   // each separate solid piece with its own holes, so one letter is finished before the next
  const c = new ClipperLib.Clipper(), t = new ClipperLib.PolyTree(), fill = ClipperLib.PolyFillType.pftNonZero;
  c.AddPaths(cvIn(polys), ClipperLib.PolyType.ptSubject, true);
  c.Execute(ClipperLib.ClipType.ctUnion, t, fill, fill);
  return ClipperLib.JS.PolyTreeToExPolygons(t).map(e => cvOut([e.outer, ...(e.holes || [])]));
}
const cvArea = p => { let a = 0; for (let i = 0, n = p.length; i < n; i++) { const q = p[(i + 1) % n]; a += p[i][0] * q[1] - q[0] * p[i][1]; } return a / 2; };
const cvInside = (polys, q) => { const at = { X: Math.round(q[0] * CV_K), Y: Math.round(q[1] * CV_K) }; let n = 0; cvIn(polys).forEach(p => { if (ClipperLib.Clipper.PointInPolygon(at, p)) n++; }); return n % 2 === 1; };
const cvBox = polys => { let a = 1e12, b = 1e12, c = -1e12, d = -1e12; polys.forEach(p => p.forEach(q => { if (q[0] < a) a = q[0]; if (q[1] < b) b = q[1]; if (q[0] > c) c = q[0]; if (q[1] > d) d = q[1]; })); return a > c ? { x0: 0, y0: 0, x1: 0, y1: 0 } : { x0: a, y0: b, x1: c, y1: d }; };

// ---------- curves ----------
function cvCubic(out, p0, p1, p2, p3, tol) {
  const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) + Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) + Math.hypot(p3[0] - p2[0], p3[1] - p2[1]), n = Math.max(2, Math.min(64, Math.ceil(Math.sqrt(len / (tol * 8)))));
  for (let i = 1; i <= n; i++) { const t = i / n, u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t; out.push([a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]]); }
}
const cvQuad = (out, p0, c, p, tol) => cvCubic(out, p0, [p0[0] + (c[0] - p0[0]) * 2 / 3, p0[1] + (c[1] - p0[1]) * 2 / 3], [p[0] + (c[0] - p[0]) * 2 / 3, p[1] + (c[1] - p[1]) * 2 / 3], p, tol);
function cvArc(out, a, rx, ry, turn, big, sweep, b, tol) {   // an SVG arc, from its two ends
  rx = Math.abs(rx); ry = Math.abs(ry);
  if (!rx || !ry || (a[0] === b[0] && a[1] === b[1])) { out.push(b); return; }
  const f = turn * Math.PI / 180, cs = Math.cos(f), sn = Math.sin(f), dx = (a[0] - b[0]) / 2, dy = (a[1] - b[1]) / 2, x1 = cs * dx + sn * dy, y1 = -sn * dx + cs * dy, l = x1 * x1 / (rx * rx) + y1 * y1 / (ry * ry);
  if (l > 1) { rx *= Math.sqrt(l); ry *= Math.sqrt(l); }
  const num = Math.max(0, rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1), k = (big === sweep ? -1 : 1) * Math.sqrt(num / (rx * rx * y1 * y1 + ry * ry * x1 * x1)), cx1 = k * rx * y1 / ry, cy1 = -k * ry * x1 / rx;
  const cx = cs * cx1 - sn * cy1 + (a[0] + b[0]) / 2, cy = sn * cx1 + cs * cy1 + (a[1] + b[1]) / 2, t0 = Math.atan2((y1 - cy1) / ry, (x1 - cx1) / rx);
  let d = Math.atan2((-y1 - cy1) / ry, (-x1 - cx1) / rx) - t0;
  if (sweep && d < 0) d += Math.PI * 2; if (!sweep && d > 0) d -= Math.PI * 2;
  const r = Math.max(rx, ry), step = 2 * Math.acos(Math.max(0, 1 - Math.min(tol / r, .5))), n = Math.max(2, Math.min(180, Math.ceil(Math.abs(d) / step)));
  for (let i = 1; i <= n; i++) { const t = t0 + d * i / n, x = rx * Math.cos(t), y = ry * Math.sin(t); out.push(i === n ? b : [cs * x - sn * y + cx, sn * x + cs * y + cy]); }
}

// ---------- reading an SVG ----------
// It's only ever read as data: nothing from the file goes into the page, so anything hiding in it can't run.
function cvPathData(d, tol) {   // returns [{ pts, closed }]
  const subs = []; let i = 0, cur = null, at = [0, 0], start = [0, 0], cmd = '', lastC = null, lastQ = null;
  const skip = () => { while (i < d.length && /[\s,]/.test(d[i])) i++; };
  const num = () => { skip(); const m = /^[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/.exec(d.slice(i, i + 40)); if (!m) return null; i += m[0].length; return parseFloat(m[0]); };
  const flag = () => { skip(); const c = d[i]; if (c !== '0' && c !== '1') return null; i++; return c === '1' ? 1 : 0; };
  const nums = n => { const a = []; for (let k = 0; k < n; k++) { const v = num(); if (v === null) return null; a.push(v); } return a; };
  const begin = () => { if (!cur) { cur = { pts: [at.slice()], closed: false }; subs.push(cur); } };
  while (true) {
    skip(); if (i >= d.length) break;
    if (/[a-zA-Z]/.test(d[i])) cmd = d[i++]; else if (!cmd || /[zZ]/.test(cmd)) break;
    const c = cmd.toLowerCase(), rel = cmd !== cmd.toUpperCase(), ox = rel ? at[0] : 0, oy = rel ? at[1] : 0;
    if (c === 'z') { if (cur) { cur.closed = true; cur = null; } at = start.slice(); cmd = ''; lastC = lastQ = null; continue; }
    if (c === 'm') { const a = nums(2); if (!a) break; at = [ox + a[0], oy + a[1]]; start = at.slice(); cur = null; begin(); cmd = rel ? 'l' : 'L'; lastC = lastQ = null; continue; }
    begin();
    if (c === 'l') { const a = nums(2); if (!a) break; at = [ox + a[0], oy + a[1]]; cur.pts.push(at); lastC = lastQ = null; }
    else if (c === 'h') { const a = nums(1); if (!a) break; at = [ox + a[0], at[1]]; cur.pts.push(at); lastC = lastQ = null; }
    else if (c === 'v') { const a = nums(1); if (!a) break; at = [at[0], oy + a[0]]; cur.pts.push(at); lastC = lastQ = null; }
    else if (c === 'c' || c === 's') {
      let p1, a;
      if (c === 'c') { a = nums(6); if (!a) break; p1 = [ox + a[0], oy + a[1]]; a = a.slice(2); }
      else { a = nums(4); if (!a) break; p1 = lastC ? [2 * at[0] - lastC[0], 2 * at[1] - lastC[1]] : at; }
      const p2 = [ox + a[0], oy + a[1]], p = [ox + a[2], oy + a[3]]; cvCubic(cur.pts, at, p1, p2, p, tol); at = p; lastC = p2; lastQ = null;
    } else if (c === 'q' || c === 't') {
      let q, a;
      if (c === 'q') { a = nums(4); if (!a) break; q = [ox + a[0], oy + a[1]]; a = a.slice(2); }
      else { a = nums(2); if (!a) break; q = lastQ ? [2 * at[0] - lastQ[0], 2 * at[1] - lastQ[1]] : at; }
      const p = [ox + a[0], oy + a[1]]; cvQuad(cur.pts, at, q, p, tol); at = p; lastQ = q; lastC = null;
    } else if (c === 'a') {
      const r = nums(3); if (!r) break; const big = flag(), sw = flag(); if (big === null || sw === null) break; const e = nums(2); if (!e) break;
      const p = [ox + e[0], oy + e[1]]; cvArc(cur.pts, at, r[0], r[1], r[2], big, sw, p, tol); at = p; lastC = lastQ = null;
    } else break;   // not a path command: keep what's been read so far
  }
  return subs.filter(s => s.pts.length > 1);
}
const cvMul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
function cvTransform(s) {
  let m = [1, 0, 0, 1, 0, 0]; if (!s) return m;
  for (const t of s.matchAll(/(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g)) {
    const a = t[2].split(/[\s,]+/).filter(Boolean).map(Number), r = (a[0] || 0) * Math.PI / 180;
    if (t[1] === 'matrix' && a.length === 6) m = cvMul(m, a);
    if (t[1] === 'translate') m = cvMul(m, [1, 0, 0, 1, a[0] || 0, a[1] || 0]);
    if (t[1] === 'scale') m = cvMul(m, [a[0] ?? 1, 0, 0, a[1] ?? a[0] ?? 1, 0, 0]);
    if (t[1] === 'rotate') { const c = Math.cos(r), n = Math.sin(r), rot = [c, n, -n, c, 0, 0]; m = a.length === 3 ? cvMul(cvMul(cvMul(m, [1, 0, 0, 1, a[1], a[2]]), rot), [1, 0, 0, 1, -a[1], -a[2]]) : cvMul(m, rot); }
    if (t[1] === 'skewX') m = cvMul(m, [1, 0, Math.tan(r), 1, 0, 0]);
    if (t[1] === 'skewY') m = cvMul(m, [1, Math.tan(r), 0, 1, 0, 0]);
  }
  return m;
}
const CV_SKIP = /^(defs|clipPath|mask|symbol|marker|pattern|linearGradient|radialGradient|title|desc|metadata|style|script|image|foreignObject|filter)$/i;
const cvStyle = (el, k) => { const s = el.getAttribute && el.getAttribute('style'), m = s && new RegExp(`(?:^|;)\\s*${k}\\s*:\\s*([^;]+)`, 'i').exec(s); return m ? m[1].trim() : el.getAttribute ? el.getAttribute(k) : null; };
const cvIsWhite = c => /^(white|#fff|#ffffff|rgb\(\s*255\s*,\s*255\s*,\s*255\s*\))$/i.test(String(c).trim());
function cvShapeSubs(el, tol) {
  const n = k => parseFloat(el.getAttribute(k)) || 0, t = el.localName;
  if (t === 'path') return cvPathData(el.getAttribute('d') || '', tol);
  if (t === 'line') return [{ pts: [[n('x1'), n('y1')], [n('x2'), n('y2')]], closed: false }];
  if (t === 'polyline' || t === 'polygon') { const a = (el.getAttribute('points') || '').split(/[\s,]+/).filter(Boolean).map(Number), pts = []; for (let i = 0; i + 1 < a.length; i += 2) pts.push([a[i], a[i + 1]]); return pts.length > 1 ? [{ pts, closed: t === 'polygon' }] : []; }
  if (t === 'rect') {
    const x = n('x'), y = n('y'), w = n('width'), h = n('height'); if (!(w > 0 && h > 0)) return [];
    let rx = el.hasAttribute('rx') ? n('rx') : n('ry'), ry = el.hasAttribute('ry') ? n('ry') : rx; rx = Math.min(rx, w / 2); ry = Math.min(ry, h / 2);
    if (!(rx > 0 && ry > 0)) return [{ pts: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], closed: true }];
    const pts = [[x + rx, y], [x + w - rx, y]]; cvArc(pts, [x + w - rx, y], rx, ry, 0, 0, 1, [x + w, y + ry], tol); pts.push([x + w, y + h - ry]); cvArc(pts, [x + w, y + h - ry], rx, ry, 0, 0, 1, [x + w - rx, y + h], tol); pts.push([x + rx, y + h]); cvArc(pts, [x + rx, y + h], rx, ry, 0, 0, 1, [x, y + h - ry], tol); pts.push([x, y + ry]); cvArc(pts, [x, y + ry], rx, ry, 0, 0, 1, [x + rx, y], tol);
    return [{ pts, closed: true }];
  }
  if (t === 'circle' || t === 'ellipse') {
    const cx = n('cx'), cy = n('cy'), rx = t === 'circle' ? n('r') : n('rx'), ry = t === 'circle' ? n('r') : n('ry'); if (!(rx > 0 && ry > 0)) return [];
    const pts = [[cx + rx, cy]]; cvArc(pts, [cx + rx, cy], rx, ry, 0, 0, 1, [cx - rx, cy], tol); cvArc(pts, [cx - rx, cy], rx, ry, 0, 0, 1, [cx + rx, cy], tol); pts.pop();
    return [{ pts, closed: true }];
  }
  return [];
}
function cvWalkSvg(root, tol) {
  const paint = [], left = { text: 0 }; let count = 0;
  const walk = (el, m, fill, rule, stroke, depth) => {
    if (depth > 40) return;
    const t = el.localName; if (CV_SKIP.test(t)) return;
    if (cvStyle(el, 'display') === 'none' || cvStyle(el, 'visibility') === 'hidden') return;
    if (t === 'text') { left.text++; return; }
    const mine = cvMul(m, cvTransform(el.getAttribute('transform'))), f = cvStyle(el, 'fill') ?? fill, r = cvStyle(el, 'fill-rule') ?? rule, s = cvStyle(el, 'stroke') ?? stroke;
    if (t === 'use') {
      const id = (el.getAttribute('href') || el.getAttribute('xlink:href') || '').replace(/^#/, ''), to = id && [...root.querySelectorAll('[id]')].find(x => x.getAttribute('id') === id);
      if (to && !to.contains(el)) { const moved = cvMul(mine, [1, 0, 0, 1, parseFloat(el.getAttribute('x')) || 0, parseFloat(el.getAttribute('y')) || 0]); if (to.localName === 'symbol') [...to.children].forEach(c => walk(c, moved, f, r, s, depth + 1)); else walk(to, moved, f, r, s, depth + 1); }
      return;
    }
    if (t === 'g' || t === 'svg' || t === 'a' || t === 'switch') { [...el.children].forEach(c => walk(c, mine, f, r, s, depth + 1)); return; }
    const subs = cvShapeSubs(el, tol); if (!subs.length) return;
    subs.forEach(q => { q.pts = q.pts.map(p => [mine[0] * p[0] + mine[2] * p[1] + mine[4], mine[1] * p[0] + mine[3] * p[1] + mine[5]]); count += q.pts.length; });
    paint.push({ subs, fill: f, rule: r, stroke: s });
  };
  walk(root, [1, 0, 0, 1, 0, 0], '#000', 'nonzero', 'none', 0);
  return { paint, count, left };
}
function cvParseSvg(text) {   // art in its own units: { regions, lines, w, h, mmW, mmH, textLeft }
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml'), root = doc.documentElement;
  if (!root || root.localName !== 'svg' || doc.querySelector('parsererror')) throw new Error("that isn't a readable SVG file");
  const seen = q => !cvIsWhite(q.fill) || (q.stroke && q.stroke !== 'none' && !cvIsWhite(q.stroke));   // a white background isn't part of the art's size
  const rough = cvWalkSvg(root, 1e6), box = cvBox(rough.paint.filter(seen).flatMap(q => q.subs.map(s => s.pts))), size = Math.max(box.x1 - box.x0, box.y1 - box.y0);
  if (!(size > 0)) throw new Error('nothing drawable was found in it. Text in an SVG must be converted to paths first');
  const { paint, count, left } = cvWalkSvg(root, size * .0003);
  if (count > 400000) throw new Error('it has too much detail to cut. Simplify it first');
  const fit = size > 2000 ? 2000 / size : 1, far = (q, s) => [(q[0] - (box.x0 + box.x1) / 2) * fit, ((box.y0 + box.y1) / 2 - q[1]) * fit];   // centred, with Y turned up the right way
  let regions = []; const lines = [];
  paint.forEach(({ subs, fill, rule, stroke }) => {
    const none = String(fill).trim() === 'none', white = cvIsWhite(fill), hasStroke = stroke && stroke !== 'none' && !cvIsWhite(stroke);
    const pts = subs.map(s => ({ pts: s.pts.map(q => far(q)), closed: s.closed || (Math.hypot(s.pts[0][0] - s.pts[s.pts.length - 1][0], s.pts[0][1] - s.pts[s.pts.length - 1][1]) < size * 1e-5) }));
    if (!white || hasStroke) pts.forEach(s => lines.push(s));
    const shape = cvUnion(pts.map(s => s.pts), rule === 'evenodd');
    regions = white && !none ? cvMinus(regions, shape) : (none && !pts.some(s => s.closed) ? regions : cvUnion(regions.concat(shape)));   // painted in order: white knocks out what's under it
  });
  const unit = s => { const m = /^\s*([\d.]+)\s*(mm|cm|in)\s*$/.exec(s || ''); return m ? +m[1] * { mm: 1, cm: 10, in: 25.4 }[m[2]] : 0; }, vb = (root.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number), mmW = unit(root.getAttribute('width'));
  const real = mmW && vb.length === 4 && vb[2] > 0 ? mmW / vb[2] : 0;
  return { regions, lines, w: (box.x1 - box.x0) * fit, h: (box.y1 - box.y0) * fit, mmW: real ? (box.x1 - box.x0) * real : 0, textLeft: left.text };
}

// ---------- fonts ----------
const cvFonts = { list: null, parsed: new Map(), asked: new Set() };
async function cvFontList() {
  if (cvFonts.list) return cvFonts.list;
  try { const all = await window.queryLocalFonts(); cvFonts.list = new Map(all.map(f => [f.fullName, f])); } catch (e) { cvFonts.list = new Map(); }
  return cvFonts.list;
}
// Single-line fonts come with the app (lib/linefonts.js). Each stroke is a line for the bit to run along once, not an outline.
const cvLineFontNames = () => (typeof window !== 'undefined' && window.CV_LINE_FONTS ? Object.keys(window.CV_LINE_FONTS) : []);
const cvIsLineFont = name => cvLineFontNames().includes(name);
function cvLineFont(name) {
  const src = window.CV_LINE_FONTS[name], glyphs = new Map();
  const font = { line: true, name, upm: src.upm, adv: src.adv, glyph(ch) {
    if (glyphs.has(ch)) return glyphs.get(ch);
    const g = src.glyphs[ch], out = g ? { adv: g[0], subs: g[1] ? cvPathData(g[1], 1) : [] } : { adv: src.adv, subs: [] }; glyphs.set(ch, out); return out;
  } };
  const H = font.glyph('H'); let top = 0; H.subs.forEach(s => s.pts.forEach(q => { if (q[1] > top) top = q[1]; })); font.cap = top > 0 ? top : src.upm * .5;
  return font;
}
async function cvFontLoad(name) {
  if (cvFonts.parsed.has(name)) return cvFonts.parsed.get(name);
  if (cvIsLineFont(name)) { const f = cvLineFont(name); cvFonts.parsed.set(name, f); return f; }
  const list = await cvFontList(), f = list.get(name); let font = null;
  if (f) { try { font = opentype.parse(await (await f.blob()).arrayBuffer()); } catch (e) { font = null; } }   // font collections and odd formats can't be read
  cvFonts.parsed.set(name, font); return font;
}
const cvFontOf = name => cvFonts.parsed.get(name) || null;
function cvCapHeight(font) {
  const c = font.tables.os2 && font.tables.os2.sCapHeight; if (c > 0) return c;
  const b = font.charToGlyph('H').getBoundingBox(); return b.y2 > 0 ? b.y2 : font.unitsPerEm * .7;
}
function cvTextPolys(font, it) {   // Size is the height of a capital letter
  const size = font.unitsPerEm / cvCapHeight(font) * it.size, k = size / font.unitsPerEm, gap = it.spacing || 0, lineGap = it.size * 1.5 * (it.leading || 1), polys = [], lines = String(it.text || '').split(/\r?\n/);
  const glyphs = lines.map(s => font.stringToGlyphs(s)), widths = glyphs.map(g => g.reduce((w, q, i) => w + q.advanceWidth * k + gap + (g[i + 1] ? font.getKerningValue(q, g[i + 1]) * k : 0), 0) - (g.length ? gap : 0));
  const widest = Math.max(0, ...widths);
  glyphs.forEach((g, n) => {
    let x = it.align === 'left' ? -widest / 2 : it.align === 'right' ? widest / 2 - widths[n] : -widths[n] / 2; const y = (lines.length - 1) / 2 * lineGap - n * lineGap;
    g.forEach((q, i) => {
      let cur = null, at = null;
      q.getPath(x, 0, size).commands.forEach(c => {
        const p = c.type !== 'Z' ? [c.x, y - c.y] : null;
        if (c.type === 'M') { cur = [p]; polys.push(cur); at = p; }
        else if (c.type === 'L') { cur.push(p); at = p; }
        else if (c.type === 'Q') { cvQuad(cur, at, [c.x1, y - c.y1], p, .02); at = p; }
        else if (c.type === 'C') { cvCubic(cur, at, [c.x1, y - c.y1], [c.x2, y - c.y2], p, .02); at = p; }
      });
      x += q.advanceWidth * k + gap + (g[i + 1] ? font.getKerningValue(q, g[i + 1]) * k : 0);
    });
  });
  return polys;
}
function cvLineText(font, it) {   // the same layout as an outline font, but each stroke stays an open line
  const k = it.size / font.cap, gap = it.spacing || 0, lineGap = it.size * 1.5 * (it.leading || 1), out = [], rows = String(it.text || '').split(/\r?\n/);
  const glyphs = rows.map(s => [...s].map(ch => font.glyph(ch))), widths = glyphs.map(g => g.reduce((w, q) => w + q.adv * k + gap, 0) - (g.length ? gap : 0)), widest = Math.max(0, ...widths);
  glyphs.forEach((g, n) => {
    let x = it.align === 'left' ? -widest / 2 : it.align === 'right' ? widest / 2 - widths[n] : -widths[n] / 2; const y = (rows.length - 1) / 2 * lineGap - n * lineGap;
    g.forEach(q => { q.subs.forEach(s => out.push({ pts: s.pts.map(p => [x + p[0] * k, y + p[1] * k]), closed: s.closed })); x += q.adv * k + gap; });
  });
  return out;
}

// ---------- an item's shape ----------
// Its own coordinates are centred on it. "Where it sits" is applied afterwards, so moving one costs nothing.
const cvShapeCache = new Map(), cvArtCache = new Map();
const cvArtText = key => { const t = TEXTURES[key]; return t ? new TextDecoder().decode(t.bytes) : null; };
function cvArt(key) {
  if (cvArtCache.has(key)) return cvArtCache.get(key);
  const text = cvArtText(key); if (text === null) return null;
  let art = null; try { art = cvParseSvg(text); } catch (e) { art = null; }
  cvArtCache.set(key, art); return art;
}
const cvShapeKey = it => JSON.stringify([it.type, it.w, it.h, it.art, it.text, it.font, it.size, it.spacing, it.leading, it.align, !!cvFontOf(it.font), !!(it.art && TEXTURES[it.art]), it.sides, it.points, it.inner, it.corner, it.smooth, it.arc, it.threshold, it.invert, it.detail, it.len, it.off, it.type === 'trace' && typeof cvImgCache !== 'undefined' && cvImgCache.has(it.art), it.type === 'path' ? it.paths : 0, it.up, it.warp, it.warpAmt]);
function cvEllipse(w, h) { const pts = [], n = 180; for (let i = 0; i < n; i++) { const t = i / n * Math.PI * 2; pts.push([Math.cos(t) * w / 2, Math.sin(t) * h / 2]); } return pts; }
// a regular polygon or a star, point up, stretched to fill w by h
function cvPolygon(w, h, n, inner) {
  const k = inner ? 2 * n : n, raw = []; for (let i = 0; i < k; i++) { const t = Math.PI / 2 + i / k * Math.PI * 2, r = inner && i % 2 ? inner : 1; raw.push([Math.cos(t) * r, Math.sin(t) * r]); }
  const b = cvBox([raw]), sx = w / Math.max(1e-9, b.x1 - b.x0), sy = h / Math.max(1e-9, b.y1 - b.y0); return raw.map(q => [q[0] * sx, q[1] * sy]);
}
// A drawn line through its points. Smooth makes a curve that passes through every point.
function cvSmoothLine(pts, closed) {
  if (pts.length < 3) return pts; const out = [], n = pts.length, at = i => pts[closed ? (i + n) % n : Math.max(0, Math.min(n - 1, i))];
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2), steps = Math.max(4, Math.min(40, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / .5)));
    for (let s = 0; s < steps; s++) { const t = s / steps, t2 = t * t, t3 = t2 * t; out.push([0, 1].map(k => .5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3))); }
  }
  if (!closed) out.push(pts[n - 1]);
  return out;
}
// Bends text round a circle of radius R whose top is the baseline's middle, so it reads along an arc. A negative R bends it
// the other way, under the circle. Long straight edges get extra points first, so they curve too.
function cvBend(pts, R, closed) {
  const out = [], n = pts.length, warp = q => { const t = q[0] / R, r = R + q[1]; return [r * Math.sin(t), r * Math.cos(t) - R]; };
  for (let i = 0; i < n; i++) { const a = pts[i]; if (!closed && i === n - 1) { out.push(warp(a)); break; } const b = pts[(i + 1) % n], m = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / .5)); for (let k = 0; k < m; k++) out.push(warp([a[0] + (b[0] - a[0]) * k / m, a[1] + (b[1] - a[1]) * k / m])); }
  return out;
}
// Warps text inside an envelope, its letters staying upright. Bulge makes the middle taller (or, less than 0, pinched); Arch lifts
// the middle like a bridge; Wave runs it up and down once; Rise makes it grow from left to right. The amount is a part of its height.
function cvDensify(pts, closed, step) {
  const out = [], n = pts.length;
  for (let i = 0; i < n; i++) { const a = pts[i]; if (!closed && i === n - 1) { out.push(a); break; } const b = pts[(i + 1) % n], m = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step)); for (let k = 0; k < m; k++) out.push([a[0] + (b[0] - a[0]) * k / m, a[1] + (b[1] - a[1]) * k / m]); }
  return out;
}
const CV_WARPS = [['', 'None'], ['bulge', 'Bulge'], ['arch', 'Arch'], ['wave', 'Wave'], ['rise', 'Rise']];
function cvWarpFn(it) {   // given every outline, a function that warps each one
  const a = Math.max(-.9, Math.min(2, (it.warpAmt ?? 30) / 100)), style = it.warp; if (!style || !a) return null;
  return all => {
    const b = cvBox(all), half = Math.max(1e-6, (b.x1 - b.x0) / 2), mid = (b.x0 + b.x1) / 2, H = b.y1 - b.y0, cy = (b.y0 + b.y1) / 2;
    const f = q => {
      const u = Math.max(-1, Math.min(1, (q[0] - mid) / half)), y = q[1] - cy;
      if (style === 'bulge') return [q[0], cy + y * (1 + a * (1 - u * u))];
      if (style === 'arch') return [q[0], q[1] + a * H * (1 - u * u)];
      if (style === 'wave') return [q[0], q[1] + a * H * .5 * Math.sin(Math.PI * u)];
      if (style === 'rise') return [q[0], cy + y * Math.max(.05, 1 + a * u)];
      return q;
    };
    return (pts, closed) => cvDensify(pts, closed, Math.max(.05, H / 60)).map(f);
  };
}
// A drawn line whose points have handles: c[i] is [in x, in y, out x, out y] from point i, or null for a sharp corner.
// Each stretch between two points is a cubic curve through its handles, or straight if neither has one.
function cvBezLine(l) {
  const p = l.pts, c = l.c || [], n = p.length, out = [p[0].slice()];
  for (let i = 0; i < (l.closed ? n : n - 1); i++) {
    const j = (i + 1) % n, a = p[i], b = p[j], ho = c[i] ? [c[i][2], c[i][3]] : [0, 0], hi = c[j] ? [c[j][0], c[j][1]] : [0, 0];
    if (!ho[0] && !ho[1] && !hi[0] && !hi[1]) out.push(b.slice()); else cvCubic(out, a, [a[0] + ho[0], a[1] + ho[1]], [b[0] + hi[0], b[1] + hi[1]], b, .01);
  }
  if (l.closed) out.pop();
  return out;
}
// rounds the corners of a closed shape by r, for rectangles and polygons
const cvRound = (p, r) => (r > 0 ? (cvOffset(cvOffset([p], -r), r)[0] || p) : p);
function cvLocal(it) {
  const key = cvShapeKey(it); let s = cvShapeCache.get(key); if (s) return s;
  let regions = [], lines = [];
  if (it.type === 'rect') { const p = cvRound([[-it.w / 2, -it.h / 2], [it.w / 2, -it.h / 2], [it.w / 2, it.h / 2], [-it.w / 2, it.h / 2]], Math.min(it.corner || 0, it.w / 2 - .01, it.h / 2 - .01)); regions = [p]; lines = [{ pts: p, closed: true }]; }
  else if (it.type === 'polygon' || it.type === 'star') { const p = cvRound(cvPolygon(it.w, it.h, Math.max(3, Math.min(64, Math.round(it.type === 'star' ? it.points || 5 : it.sides || 6))), it.type === 'star' ? Math.max(.05, Math.min(.95, it.inner || .5)) : 0), it.corner || 0); regions = [p]; lines = [{ pts: p, closed: true }]; }
  else if (it.type === 'path') {
    lines = (it.paths || []).filter(l => l.pts.length > 1).map(l => ({ closed: l.closed, pts: l.c ? cvBezLine(l) : it.smooth ? cvSmoothLine(l.pts, l.closed) : l.pts })); const shut = lines.filter(l => l.closed && l.pts.length > 2); regions = shut.length ? cvUnion(shut.map(l => l.pts), true) : [];
    if (it.corner > 0 && regions.length) { const r = cvOffset(cvOffset(regions, -it.corner), it.corner); if (r.length) { regions = r; lines = lines.filter(l => !l.closed).concat(r.map(p => ({ pts: p, closed: true }))); } }   // rounding a shape's corners
  }
  else if (it.type === 'trace') { regions = cvTraceRegions(it); lines = regions.map(p => ({ pts: p, closed: true })); }
  else if (it.type === 'relief') { const m = cvReliefMap(it.art, it.up); if (m) { const [w, h] = cvReliefSize(it, m), p = [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]]; regions = [p]; lines = [{ pts: p, closed: true }]; } }
  else if (it.type === 'clamp') { const p = [[-it.w / 2, -it.h / 2], [it.w / 2, -it.h / 2], [it.w / 2, it.h / 2], [-it.w / 2, it.h / 2]]; regions = [p]; lines = [{ pts: p, closed: true }]; }
  else if (it.type === 'dim') { const L = it.len / 2, o = it.off || 0; lines = [{ pts: [[-L, 0], [-L, o], [L, o], [L, 0]], closed: false }]; }
  else if (it.type === 'circle') { const p = cvEllipse(it.w, it.h); regions = [p]; lines = [{ pts: p, closed: true }]; }
  else if (it.type === 'text') { const font = cvFontOf(it.font), R = Math.abs(it.arc) >= 1 ? it.arc : 0, wp = cvWarpFn(it); if (font && font.line) { lines = cvLineText(font, it); if (wp) { const f = wp(lines.map(l => l.pts)); lines = lines.map(l => ({ closed: l.closed, pts: f(l.pts, l.closed) })); } if (R) lines = lines.map(l => ({ closed: l.closed, pts: cvBend(l.pts, R, l.closed) })); } else if (font) { let polys = cvTextPolys(font, it); if (wp) { const f = wp(polys); polys = polys.map(p => f(p, true)); } if (R) polys = polys.map(p => cvBend(p, R, true)); regions = cvUnion(polys); lines = regions.map(p => ({ pts: p, closed: true })); } }
  else if (it.type === 'svg') { const a = cvArt(it.art); if (a) { const k = it.w / a.w; regions = a.regions.map(p => p.map(q => [q[0] * k, q[1] * k])); lines = a.lines.map(l => ({ closed: l.closed, pts: l.pts.map(q => [q[0] * k, q[1] * k]) })); } }
  // Measured art and text are centred exactly on their middle. A path keeps its own points where they are, so editing one
  // doesn't move the rest: ox, oy say where its middle is.
  const b = cvBox(regions.concat(lines.map(l => l.pts))), keep = it.type === 'path', cx = keep ? 0 : (b.x0 + b.x1) / 2, cy = keep ? 0 : (b.y0 + b.y1) / 2;
  if (cx || cy) { regions = regions.map(p => p.map(q => [q[0] - cx, q[1] - cy])); lines = lines.map(l => ({ closed: l.closed, pts: l.pts.map(q => [q[0] - cx, q[1] - cy]) })); }
  s = { regions, lines, w: b.x1 - b.x0, h: b.y1 - b.y0, ox: keep ? (b.x0 + b.x1) / 2 : 0, oy: keep ? (b.y0 + b.y1) / 2 : 0 };
  if (cvShapeCache.size > 300) cvShapeCache.clear();
  cvShapeCache.set(key, s); return s;
}
// mirrored first (mx, my), then turned, then moved to where it sits
const cvPlaceFn = it => { const r = (it.rot || 0) * Math.PI / 180, c = Math.cos(r), s = Math.sin(r), fx = it.mx ? -1 : 1, fy = it.my ? -1 : 1; return q => { const x = q[0] * fx, y = q[1] * fy; return [x * c - y * s + it.x, x * s + y * c + it.y]; }; };

// ---------- bit paths ----------
// A chain is one stretch of cutting, as [x, y, z] points: the bit comes down at its start and lifts at its end.
const cvPasses = (depth, step) => { const z = []; for (let d = step; d < depth - .001; d += step) z.push(d); z.push(depth); return z; };
const cvClosed = (ring, z) => ring.concat([ring[0]]).map(q => [q[0], q[1], z]);
function cvRotateTo(ring, near) { if (!near) return ring; let best = 0, d = 1e18; ring.forEach((q, i) => { const v = (q[0] - near[0]) ** 2 + (q[1] - near[1]) ** 2; if (v < d) { d = v; best = i; } }); return best ? ring.slice(best).concat(ring.slice(0, best)) : ring; }
function cvLinePaths(lines, depth, step) {
  const chains = [];
  lines.forEach(l => {
    const chain = [];
    cvPasses(depth, step).forEach((d, i) => {
      if (l.closed) l.pts.concat([l.pts[0]]).forEach(q => chain.push([q[0], q[1], -d]));
      else (i % 2 ? l.pts.slice().reverse() : l.pts).forEach(q => chain.push([q[0], q[1], -d]));
    });
    chains.push(chain);
  });
  return chains;
}
// ---------- easing into the wood ----------
// A flat bit isn't made to drill. Wherever a path goes straight down into wood, it slopes in instead: forward along the path
// it's about to cut and back again, as many times as it needs, so it ends where it would have plunged and cuts nothing extra.
// It never goes below the path it's following, so it can't nick a tab. top is where the wood starts above the chain's first point.
const CV_RAMP = 10;   // degrees below level
function cvRamp(chain, top, angle) {
  if (!(angle > 0) || chain.length < 2) return chain;
  const tan = Math.tan(Math.min(45, angle) * Math.PI / 180), out = [], pts = top > chain[0][2] + 1e-6 ? [[chain[0][0], chain[0][1], top], ...chain] : chain;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[i + 1]; out.push(a); if (!b) break;
    const drop = a[2] - b[2]; if (!(drop > .01) || Math.abs(a[0] - b[0]) > 5e-4 || Math.abs(a[1] - b[1]) > 5e-4) continue;
    const want = drop / tan / 2, ahead = [b]; let len = 0;
    for (let k = i + 2; k < pts.length && len < want - 1e-9; k++) {
      const q = ahead[ahead.length - 1], p = pts[k], d = Math.hypot(p[0] - q[0], p[1] - q[1]);
      if (len + d > want) { const t = (want - len) / d; ahead.push([q[0] + (p[0] - q[0]) * t, q[1] + (p[1] - q[1]) * t, q[2] + (p[2] - q[2]) * t]); len = want; break; }
      ahead.push(p); len += d;
    }
    if (len < .05) continue;   // nowhere to go, so it goes straight down as before
    const trips = Math.ceil(want / len - 1e-9), route = [];
    for (let t = 0; t < trips; t++) { for (let k = 1; k < ahead.length; k++) route.push(ahead[k]); for (let k = ahead.length - 2; k >= 0; k--) route.push(ahead[k]); }
    const total = trips * 2 * len; let gone = 0, at = b;
    route.forEach((p, k) => { gone += Math.hypot(p[0] - at[0], p[1] - at[1]); at = p; const z = k === route.length - 1 ? b[2] : Math.max(p[2], a[2] - drop * Math.min(1, gone / total)); out.push([p[0], p[1], z]); });
  }
  return out;
}

// ---------- back and forth ----------
// Lines straight across the area, evenly spaced no more than `over` apart. Each zigzag carries on to the next line wherever the
// two overlap and the way across stays inside, so the bit stays down. along 'y' runs the lines front to back instead.
function cvRasterLines(area, over, along) {
  const sw = along === 'y' ? q => [q[1], q[0]] : q => q, polys = area.map(p => p.map(sw)), b = cvBox(polys), n = Math.max(1, Math.ceil((b.y1 - b.y0) / over - 1e-9)), rows = [];
  for (let k = 0; k < n; k++) {
    const y = b.y0 + (k + .5) * (b.y1 - b.y0) / n, xs = [];
    polys.forEach(p => p.forEach((a, i) => { const c = p[(i + 1) % p.length]; if ((a[1] <= y) !== (c[1] <= y)) xs.push(a[0] + (y - a[1]) * (c[0] - a[0]) / (c[1] - a[1])); }));
    xs.sort((p, q) => p - q); const ivs = []; for (let i = 0; i + 1 < xs.length; i += 2) if (xs[i + 1] - xs[i] > 1e-4) ivs.push({ x0: xs[i], x1: xs[i + 1], used: false });
    rows.push({ y, ivs });
  }
  const safe = (a, b) => [.25, .5, .75].every(t => cvInside(polys, [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])), out = [];
  for (;;) {
    let r = rows.findIndex(row => row.ivs.some(v => !v.used)); if (r < 0) break;
    let iv = rows[r].ivs.find(v => !v.used), dir = 1; const chain = [];
    while (iv) {
      iv.used = true; const y = rows[r].y, end = dir > 0 ? [iv.x1, y] : [iv.x0, y]; chain.push(dir > 0 ? [iv.x0, y] : [iv.x1, y], end);
      const next = rows[r + 1]; let to = null;
      if (next) to = next.ivs.find(v => !v.used && v.x0 < iv.x1 && v.x1 > iv.x0 && safe(end, [dir > 0 ? v.x1 : v.x0, next.y])) || null;
      if (!to) break; r++; dir = -dir; iv = to;
    }
    out.push(chain.map(sw));
  }
  return out;
}

function cvPocketPaths(regions, depth, bit, notes, finish, climb, fill) {
  const turn = r => (climb ? r.slice() : r.slice().reverse());   // this way round is a conventional cut, with the spindle turning clockwise
  const R = bit.d / 2, over = Math.max(.05, bit.d * Math.min(50, Math.max(5, bit.over)) / 100), chains = []; let missed = false, nothing = true;
  cvIslands(regions).forEach(island => {
    const gens = [], wall = cvOffset(island, -R);
    if (wall.length) nothing = false; else { missed = true; return; }
    const opened = cvOffset(wall, R), left = cvMinus(island, opened); if (left.length && cvOffset(left, -R * .25).length) missed = true;
    let cur = finish > 0 ? cvOffset(island, -R - finish) : wall;
    if (fill === 'x' || fill === 'y') {   // lines across at each depth, then once round the edge to take off the scallops they leave
      const area = cur, lines = area.length ? cvRasterLines(area, over, fill) : []; let before = 0, end = null;
      cvPasses(depth, bit.step).forEach(d => {
        lines.forEach(l => { const c = l.map(q => [q[0], q[1], -d]); c.top = -before; chains.push(c); end = l[l.length - 1]; });
        area.forEach(r0 => { const c = cvClosed(cvRotateTo(turn(r0), end), -d); c.top = -before; chains.push(c); });
        before = d;
      });
      if (finish > 0) wall.forEach(r => chains.push(cvClosed(turn(r), -depth)));
      return;
    }
    while (cur.length && gens.length < 3000) { gens.push(cur); cur = cvOffset(cur, -over); }
    let before = 0;
    cvPasses(depth, bit.step).forEach(d => {
      let chain = null, end = null;   // inside first, then out to the wall. It stays down between rings when the hop is short and stays in the pocket.
      for (let g = gens.length - 1; g >= 0; g--) gens[g].forEach(ring0 => {
        const ring = cvRotateTo(turn(ring0), end), a = ring[0];
        const hop = chain && Math.hypot(a[0] - end[0], a[1] - end[1]) < over * 1.6, safe = hop && [.25, .5, .75].every(t => cvInside(gens[g], [end[0] + (a[0] - end[0]) * t, end[1] + (a[1] - end[1]) * t]));
        const pts = cvClosed(ring, -d);
        if (safe) chain.push(...pts); else { chain = pts; chain.top = -before; chains.push(chain); }
        end = a;
      });
      before = d;
    });
    if (finish > 0) wall.forEach(r => chains.push(cvClosed(turn(r), -depth)));   // the skin left on the walls, in one pass at full depth
  });
  if (nothing) notes.push({ bad: true, text: 'is too narrow for this bit: nothing would be cut' });
  else if (missed) notes.push({ text: 'has details too small for this bit, and they will be left uncut' });
  return chains;
}
// ---------- V-carving ----------
// The V-bit runs along the middle of each stroke. For each point along the outline, the widest circle that fits inside the shape
// and touches it there has its centre where the tip goes, deep enough that the V's sides just reach the outline. Wide strokes go
// deep and points rise to nothing, so walls are true and corners sharp. Past the deepest cut the bottom is level: a flat bit clears
// it if one is chosen, and the V-bit cleans the corners that bit can't reach. Without one, the V-bit clears it all, leaving small ridges.
const cvVshape = (bit, maxDepth) => { const tan = Math.tan(Math.max(5, bit.angle / 2) * Math.PI / 180), tip = (bit.tip || 0) / 2; return { tan, tip, cap: maxDepth * tan + tip }; };
function cvTouch(px, py, nx, ny, ax, ay, bx, by) {   // the size of the first circle, growing from p along n, that touches segment ab
  let best = Infinity;
  const end = (qx, qy) => { const dx = qx - px, dy = qy - py, d2 = dx * dx + dy * dy, den = 2 * (nx * dx + ny * dy); if (den > 1e-12 && d2 > 1e-10) { const r = d2 / den; if (r < best) best = r; } };
  end(ax, ay); end(bx, by);
  const ex = bx - ax, ey = by - ay, L2 = ex * ex + ey * ey; if (L2 < 1e-18) return best;
  const L = Math.sqrt(L2), mx = -ey / L, my = ex / L, h = mx * (px - ax) + my * (py - ay), mn = mx * nx + my * ny;
  const side = r => { if (r > 1e-6 && r < best) { const t = ((px + nx * r - ax) * ex + (py + ny * r - ay) * ey) / L2; if (t >= 0 && t <= 1) best = r; } };
  if (1 - mn > 1e-12) side(h / (1 - mn)); if (1 + mn > 1e-12) side(-h / (1 + mn));
  return best;
}
function cvSegIndex(rings, cell) {   // the outline's segments, filed by grid square, so only nearby ones are tried
  const segs = [], grid = new Map();
  rings.forEach(r => r.forEach((a, k) => { const b = r[(k + 1) % r.length]; segs.push([a[0], a[1], b[0], b[1]]); }));
  segs.forEach((s, n) => {
    for (let i = Math.floor(Math.min(s[0], s[2]) / cell); i <= Math.floor(Math.max(s[0], s[2]) / cell); i++) for (let j = Math.floor(Math.min(s[1], s[3]) / cell); j <= Math.floor(Math.max(s[1], s[3]) / cell); j++) {
      const k = i + ',' + j; let l = grid.get(k); if (!l) grid.set(k, l = []); l.push(n);
    }
  });
  return { segs, grid, cell, seen: new Int32Array(segs.length), stamp: 0 };
}
function cvWidest(ix, px, py, nx, ny, cap) {   // the widest circle touching the outline at p, up to cap
  const cx = px + nx * cap, cy = py + ny * cap, c = ix.cell, st = ++ix.stamp; let best = cap;
  for (let i = Math.floor((cx - cap) / c); i <= Math.floor((cx + cap) / c); i++) for (let j = Math.floor((cy - cap) / c); j <= Math.floor((cy + cap) / c); j++) {
    const l = ix.grid.get(i + ',' + j); if (!l) continue;
    for (const n of l) { if (ix.seen[n] === st) continue; ix.seen[n] = st; const s = ix.segs[n], r = cvTouch(px, py, nx, ny, s[0], s[1], s[2], s[3]); if (r < best) best = r; }
  }
  return best;
}
function cvNearest(ix, x, y, cap) {   // how far a point is from the outline, up to cap
  const c = ix.cell, st = ++ix.stamp; let best = cap;
  for (let i = Math.floor((x - cap) / c); i <= Math.floor((x + cap) / c); i++) for (let j = Math.floor((y - cap) / c); j <= Math.floor((y + cap) / c); j++) {
    const l = ix.grid.get(i + ',' + j); if (!l) continue;
    for (const n of l) {
      if (ix.seen[n] === st) continue; ix.seen[n] = st; const s = ix.segs[n], dx = s[2] - s[0], dy = s[3] - s[1], l2 = dx * dx + dy * dy, t = l2 ? Math.max(0, Math.min(1, ((x - s[0]) * dx + (y - s[1]) * dy) / l2)) : 0, d = Math.hypot(x - s[0] - dx * t, y - s[1] - dy * t);
      if (d < best) best = d;
    }
  }
  return best;
}
// One island's centre line, as closed loops of [x, y, depth]. Where the centre jumps, it goes straight across, never deeper than
// the V allows at each point on the way, which can't cut past the finished shape.
function cvCentreLine(island, v, maxDepth, fine) {
  const rings = island.map(r0 => {   // turned so the wood being carved is on the left
    let r = r0;
    for (let k = 0; k < r.length; k++) {
      const a = r[k], b = r[(k + 1) % r.length], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy); if (l < 1e-6) continue;
      const e = Math.min(1e-3, l * .01); if (!cvInside(island, [(a[0] + b[0]) / 2 - dy / l * e, (a[1] + b[1]) / 2 + dx / l * e])) r = r.slice().reverse(); break;
    }
    return r.filter((q, k) => { const p = r[(k + r.length - 1) % r.length]; return Math.hypot(q[0] - p[0], q[1] - p[1]) > 1e-6; });
  }).filter(r => r.length > 2);
  const ix = cvSegIndex(rings, Math.max(v.cap, fine * 4)), runs = [], jump = fine * 3, fan = Math.min(.26, fine / Math.max(v.cap, fine));
  rings.forEach(r => {
    const out = [], n = r.length, dir = k => { const a = r[k], b = r[(k + 1) % n], l = Math.hypot(b[0] - a[0], b[1] - a[1]); return [(b[0] - a[0]) / l, (b[1] - a[1]) / l, l]; };
    const put = (px, py, nx, ny, corner) => {
      const rad = corner ? 0 : cvWidest(ix, px, py, nx, ny, v.cap), depth = rad >= v.cap - 1e-9 ? maxDepth : Math.max(0, (rad - v.tip) / v.tan);
      out.push([px + nx * rad, py + ny * rad, depth]);
    };
    for (let k = 0; k < n; k++) {
      const [ux, uy, l] = dir(k), [px, py] = dir((k + n - 1) % n), a = r[k], turn = px * uy - py * ux, nx = -uy, ny = ux;
      if (turn < -1e-9) {   // an outward corner: the circles swing round it
        const pnx = -py, pny = px, from = Math.atan2(pny, pnx); let sweep = Math.atan2(ny, nx) - from; while (sweep > 0) sweep -= Math.PI * 2; while (sweep < -Math.PI * 2) sweep += Math.PI * 2;
        const m = Math.max(1, Math.ceil(-sweep / fan)); for (let i = 0; i <= m; i++) { const t = from + sweep * i / m; put(a[0], a[1], Math.cos(t), Math.sin(t)); }
      } else put(a[0], a[1], nx, ny, turn > 1e-9);   // an inward corner is where the V comes up to nothing
      const m = Math.max(1, Math.ceil(l / fine)); for (let i = 1; i < m; i++) put(a[0] + ux * l * i / m, a[1] + uy * l * i / m, nx, ny);
    }
    out.push(out[0]);
    const run = [out[0]];
    for (let i = 1; i < out.length; i++) {
      const p = out[i - 1], q = out[i], d = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (d > jump) { const m = Math.ceil(d / fine); for (let k = 1; k < m; k++) { const t = k / m, x = p[0] + (q[0] - p[0]) * t, y = p[1] + (q[1] - p[1]) * t, r = cvNearest(ix, x, y, v.cap), most = r >= v.cap - 1e-9 ? maxDepth : Math.max(0, (r - v.tip) / v.tan); run.push([x, y, Math.min(most, p[2] + (q[2] - p[2]) * t)]); } }
      run.push(q);
    }
    runs.push(run);
  });
  return runs.filter(r => r.length > 1);
}
// rings filling an area at one depth, from the outside in. Safe for the V-bit anywhere deeper inside than the cap.
function cvFillRings(area, step) { const out = []; let o = step / 2, cur = cvOffset(area, -o); while (cur.length && out.length < 4000) { out.push(...cur); o += step; cur = cvOffset(area, -o); } return out; }
function cvVcarvePaths(regions, maxDepth, bit, notes, clear) {
  const v = cvVshape(bit, maxDepth), fine = Math.max(.03, Math.min(.25, bit.fine || .1)), chains = [], ridge = Math.max(fine, v.cap * Math.min(.5, Math.max(.05, bit.over / 100)));
  let capped = false;
  cvIslands(regions).forEach(island => {
    const runs = cvCentreLine(island, v, maxDepth, fine), inner = cvOffset(island, -v.cap);
    // what the V-bit levels itself: everything past the cap, or only the corners the flat bit can't get into
    const flat = inner.length && clear ? cvMinus(inner, cvOffset(cvOffset(inner, -clear.d / 2), clear.d / 2)) : inner, smooth = Math.max(.05, Math.min(ridge, 2 * (v.tip + .05 * v.tan))), rings = flat.length ? cvFillRings(flat, clear ? smooth : ridge) : [];   // corners left by a flat bit get rings close enough to leave no more than 0.05 mm
    if (inner.length && !clear) capped = true;
    let before = 0;
    cvPasses(maxDepth, bit.step).forEach(level => {
      const at = q => [q[0], q[1], -Math.min(q[2], level)];
      runs.forEach(f => {   // only the stretches that go deeper than the last level, with a point either side. Across a short gap it stays down, which is quicker than lifting.
        const need = f.map(q => q[2] > before + 1e-6), gap = (a, b) => Math.hypot(f[b][0] - f[a][0], f[b][1] - f[a][1]);
        for (let k = 0; k < f.length;) {
          if (need[k]) { k++; continue; }
          let j = k, len = 0; while (j < f.length && !need[j]) { if (j > k) len += gap(j - 1, j); j++; }
          if (k > 0 && j < f.length && len + gap(k - 1, k) + gap(j - 1, j) < CV_HOP) for (let m = k; m < j; m++) need[m] = true;
          k = j;
        }
        let run = null;
        for (let k = 0; k < f.length; k++) {
          if (need[k]) { if (!run) { run = k ? [at(f[k - 1])] : []; } run.push(at(f[k])); }
          else if (run) { run.push(at(f[k])); chains.push(run); run = null; }
        }
        if (run && run.length > 1) chains.push(run);
      });
      // it stays down between rings when the way across stays in the level bottom, where the V can go anywhere at full depth
      let end = null, chain = null; rings.forEach(r0 => {
        const r = cvRotateTo(r0, end), a = r[0], pts = cvClosed(r, -level), near = chain && Math.hypot(a[0] - end[0], a[1] - end[1]) < 4 * ridge && [.2, .4, .6, .8].every(t => cvInside(inner, [end[0] + (a[0] - end[0]) * t, end[1] + (a[1] - end[1]) * t]));
        if (near) chain.push(...pts); else { chain = pts; chains.push(chain); }
        end = a;
      });
      before = level;
    });
  });
  if (!chains.length) notes.push({ bad: true, text: 'is too small to carve with this bit' });
  if (capped) notes.push({ info: true, text: 'is wider than the deepest cut allows, so its bottom is level, with small ridges. Choose a flat bit to clear it for a smooth bottom' });
  return chains;
}
// ---------- drilling ----------
// Straight down at the middle of each separate shape. GRBL has no drilling cycle, so pecking is written out: down one step,
// up clear of the board to let the chips out, and down again to the next. Holes are drilled nearest first.
function cvDrillSpots(regions) {
  return cvIslands(regions).map(island => {
    const p = island[0]; let a = 0, cx = 0, cy = 0;
    for (let i = 0, n = p.length; i < n; i++) { const q = p[i], r = p[(i + 1) % n], c = q[0] * r[1] - r[0] * q[1]; a += c; cx += (q[0] + r[0]) * c; cy += (q[1] + r[1]) * c; }
    const area = Math.abs(cvIslandArea(island)), b = cvBox([p]);
    return { at: Math.abs(a) > 1e-9 ? [cx / (3 * a), cy / (3 * a)] : [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2], d: 2 * Math.sqrt(area / Math.PI) };
  });
}
const cvIslandArea = island => island.reduce((s, q) => s + cvArea(q), 0);
function cvDrillPaths(regions, depth, bit, peck, notes) {
  const spots = cvDrillSpots(regions), chains = []; if (!spots.length) { notes.push({ bad: true, text: 'has no closed shapes to drill' }); return chains; }
  const order = [], left = spots.slice(); let at = [0, 0];
  while (left.length) { let k = 0, d = 1e18; left.forEach((s, i) => { const v = Math.hypot(s.at[0] - at[0], s.at[1] - at[1]); if (v < d) { d = v; k = i; } }); const s = left.splice(k, 1)[0]; order.push(s); at = s.at; }
  const levels = peck ? cvPasses(depth, bit.step) : [depth];
  order.forEach(s => levels.forEach(z => chains.push([[s.at[0], s.at[1], -z]])));
  const big = spots.filter(s => s.d > bit.d + .05).length, small = spots.filter(s => s.d < bit.d - .05).length;
  if (big) notes.push({ info: true, text: `has ${big === spots.length ? '' : 'some '}holes drawn wider than the bit, so they come out ${cvLenNote(bit.d)}. Use Cut inside for their full size` });
  if (small) notes.push({ info: true, text: `has ${small === spots.length ? '' : 'some '}holes drawn smaller than the bit, so they come out ${cvLenNote(bit.d)}` });
  return chains;
}
const cvLenNote = mm => (typeof cvLen === 'function' ? cvLen(mm) : `${Math.round(mm * 100) / 100} mm`);
// The flat bit's share of a V-carve: the level bottom past the cap, pocketed right up to where the V's walls start.
function cvVclearPaths(regions, maxDepth, vbit, flat, notes) {
  const inner = cvIslands(regions).flatMap(island => cvOffset(island, -cvVshape(vbit, maxDepth).cap));
  if (!inner.length) return [];
  const own = [], chains = cvPocketPaths(inner, maxDepth, flat, own, 0);
  if (!chains.length) notes.push({ info: true, text: `has no level bottom wide enough for ${flat.name}, so the V-bit does it all` });
  return chains;
}
// what the first bit leaves, without the hairlines that rounding leaves along every wall
const cvRest = (island, opened) => cvOffset(cvOffset(cvMinus(island, opened), -.01), .01);
// A pocket's narrower second bit: only what the first couldn't reach, its corners and narrow parts. That's grown by the small bit's
// width, still inside the shape, so the two overlap and no thin wall is left standing between them.
function cvDetailPaths(regions, depth, main, small, notes, climb) {
  const R = main.d / 2, r = small.d / 2, chains = []; let missed = false;
  cvIslands(regions).forEach(island => {
    const opened = cvOffset(cvOffset(island, -R), R), rest = cvRest(island, opened); if (!rest.length) return;
    const zone = cvClip(ClipperLib.ClipType.ctIntersection, cvOffset(rest, small.d), island); if (!zone.length) return;
    chains.push(...cvPocketPaths(zone, depth, small, [], 0, climb));
    const left = cvMinus(island, cvUnion(opened.concat(cvOffset(cvOffset(zone, -r), r))));   // what neither bit gets to
    if (left.length && cvOffset(left, -r * .25).length) missed = true;
  });
  if (!chains.length) notes.push({ info: true, text: `has no corners the ${small.name} can reach that the ${main.name} missed` });
  else if (missed) notes.push({ text: `has details too small even for the ${small.name}, and they will be left uncut` });
  return chains;
}
const cvRingLen = ring => { const pts = ring.concat([ring[0]]), L = []; let len = 0; for (let i = 1; i < pts.length; i++) { len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); L.push(len); } return { pts, L, len }; };
function cvAlong(ring, q) {   // the nearest point on a ring: how far along it, and how far away
  const { pts, L } = cvRingLen(ring); let best = { d: 1e18, m: 0 };
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy, t = l2 ? Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / l2)) : 0, d = Math.hypot(q[0] - a[0] - dx * t, q[1] - a[1] - dy * t);
    if (d < best.d) best = { d, m: (i > 1 ? L[i - 2] : 0) + Math.sqrt(l2) * t };
  }
  return best;
}
// Where the tabs go: spread along each finished edge, each moved within its share of the edge to the straightest stretch,
// so none lands on a point or a tight curve, where snapping it off would break the shape. The rough passes put theirs at the same places.
function cvTabSpots(rings, tabs, width) {
  const spots = []; let fewer = false;
  rings.forEach(ring => {
    const { pts, L, len } = cvRingLen(ring), n = Math.min(tabs, Math.floor(len / (width * 2))); if (n < tabs) fewer = true;
    if (!n) return;
    const at = m => { m = ((m % len) + len) % len; const k = Math.max(0, L.findIndex(v => v >= m)), s0 = k ? L[k - 1] : 0, a = pts[k], b = pts[k + 1] || pts[0], t = L[k] > s0 ? (m - s0) / (L[k] - s0) : 0; return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; };
    // how much the edge turns at each corner, and where along it that corner is
    const bends = []; for (let k = 0; k < pts.length - 1; k++) {
      const p = pts[(k - 1 + pts.length - 1) % (pts.length - 1)], q = pts[k], r = pts[k + 1], a1 = Math.atan2(q[1] - p[1], q[0] - p[0]), a2 = Math.atan2(r[1] - q[1], r[0] - q[0]);
      let d = Math.abs(a2 - a1); if (d > Math.PI) d = 2 * Math.PI - d; if (d > 1e-9) bends.push([k ? L[k - 1] : 0, d]);
    }
    const reach = width / 2 + 1, bendNear = m => bends.reduce((s, [p, d]) => { let g = Math.abs(p - m); g = Math.min(g, len - g); return g <= reach ? s + d : s; }, 0);
    for (let i = 0; i < n; i++) {
      const m0 = len * (i + .5) / n, room = len / n * .35, step = Math.max(.25, room / 40); let best = m0, cost = Infinity;
      for (let m = m0 - room; m <= m0 + room + 1e-9; m += step) { const c = bendNear(m) + Math.abs(m - m0) / len * .2; if (c < cost - 1e-9) { cost = c; best = m; } }
      spots.push(at(best));
    }
  });
  return { spots, fewer };
}
function cvRingWithTabs(ring, spots, width) {   // a closed ring as segments, each marked if it's over a tab
  const { pts, L, len } = cvRingLen(ring), cuts = [], zones = [];
  spots.forEach(q => {
    const m = cvAlong(ring, q).m, z0 = m - width / 2, z1 = m + width / 2;
    if (z0 < 0) zones.push([z0 + len, len], [0, z1]); else if (z1 > len) zones.push([z0, len], [0, z1 - len]); else zones.push([z0, z1]);
  });
  zones.forEach(z => cuts.push(z[0], z[1]));
  const segs = []; let s0 = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], s1 = L[i - 1], here = [s0, ...cuts.filter(c => c > s0 + 1e-9 && c < s1 - 1e-9), s1];
    for (let k = 1; k < here.length; k++) {
      const p = s1 > s0 ? (here[k - 1] - s0) / (s1 - s0) : 0, q = s1 > s0 ? (here[k] - s0) / (s1 - s0) : 1, mid = (here[k - 1] + here[k]) / 2;
      segs.push({ a: [a[0] + (b[0] - a[0]) * p, a[1] + (b[1] - a[1]) * p], b: [a[0] + (b[0] - a[0]) * q, a[1] + (b[1] - a[1]) * q], tab: zones.some(z => mid > z[0] && mid < z[1]) });
    }
    s0 = s1;
  }
  return { segs };
}
// Each ring cut at these levels. A tab belongs to the ring it's nearest, if that's within reach.
function cvContourPaths(rings, levels, bit, spots, tabW, tabZ, reach) {
  const chains = [], mine = rings.map(() => []);
  spots.forEach(q => { let best = -1, d = reach; rings.forEach((r, i) => { const a = cvAlong(r, q).d; if (a <= d) { d = a; best = i; } }); if (best >= 0) mine[best].push(q); });
  rings.forEach((ring, ri) => {
    const chain = [], { segs } = cvRingWithTabs(ring, mine[ri], tabW + bit.d);
    levels.forEach(d => {
      const z = -d; let cur = null;
      if (!segs.length) return;
      chain.push([segs[0].a[0], segs[0].a[1], z]); cur = z;
      segs.forEach(s => { const want = s.tab ? Math.max(z, tabZ) : z; if (want !== cur) { chain.push([s.a[0], s.a[1], want]); cur = want; } chain.push([s.b[0], s.b[1], want]); });
      if (cur !== z) chain.push([segs[0].a[0], segs[0].a[1], z]);
    });
    chains.push(chain);
  });
  return chains;
}

// ---------- 3D reliefs ----------
// An STL model seen from above becomes a height map: for a grid of points, how high its top surface is. Its highest point is
// the board's top and its lowest is the relief's depth below it. Parts of the grid with no model count as the lowest, so the
// model stands in a pocket the size of its footprint, and nothing outside that is cut.
// The bit follows the surface lowered by its own shape: at each point, as low as it can go before any part of its end touches
// the model, so it never cuts into it. A flat bit leaves small steps on slopes; a ball nose or a V-bit follows them more closely.
function cvStlTris(bytes) {   // every corner of every triangle, as x, y, z
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length >= 84) {
    const n = dv.getUint32(80, true);
    if (n > 0 && 84 + n * 50 === bytes.length) { const out = new Float32Array(n * 9); for (let i = 0; i < n; i++) for (let k = 0; k < 9; k++) out[i * 9 + k] = dv.getFloat32(84 + i * 50 + 12 + k * 4, true); return out; }
  }
  const text = new TextDecoder().decode(bytes); if (!/^\s*solid/i.test(text) || !/facet/i.test(text)) throw new Error("that isn't a readable STL file");
  const v = []; for (const m of text.matchAll(/vertex\s+([-+\d.eE]+)\s+([-+\d.eE]+)\s+([-+\d.eE]+)/g)) v.push(+m[1], +m[2], +m[3]);
  if (!v.length || v.length % 9 || v.some(q => !isFinite(q))) throw new Error("that isn't a readable STL file");
  return Float32Array.from(v);
}
const CV_RELIEF_CELLS = 500;   // grid points along the model's longer side
// up: which of the file's axes points up out of the board. Turned so it isn't mirrored.
function cvHeightMap(tri, up) {
  const n = tri.length / 9; if (!n) throw new Error('it has no triangles'); if (n > 4e6) throw new Error('it has too many triangles. Simplify it first');
  const q = new Float32Array(tri.length); let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < tri.length; i += 3) {
    const x = tri[i], y = tri[i + 1], z = tri[i + 2], u = up === 'y' ? [x, -z, y] : up === 'x' ? [y, z, x] : [x, y, z];
    q[i] = u[0]; q[i + 1] = u[1]; q[i + 2] = u[2];
    if (u[0] < x0) x0 = u[0]; if (u[0] > x1) x1 = u[0]; if (u[1] < y0) y0 = u[1]; if (u[1] > y1) y1 = u[1]; if (u[2] < z0) z0 = u[2]; if (u[2] > z1) z1 = u[2];
  }
  const W = x1 - x0, L = y1 - y0, D = z1 - z0; if (!(W > 0 && L > 0)) throw new Error('it has no top to carve. Try another way up');
  const step = Math.max(W, L) / CV_RELIEF_CELLS, nx = Math.max(2, Math.round(W / step) + 1), ny = Math.max(2, Math.round(L / step) + 1), sx = (nx - 1) / W, sy = (ny - 1) / L, Z = new Float32Array(nx * ny).fill(-Infinity);
  for (let t = 0; t < q.length; t += 9) {
    const ax = (q[t] - x0) * sx, ay = (q[t + 1] - y0) * sy, az = q[t + 2], bx = (q[t + 3] - x0) * sx, by = (q[t + 4] - y0) * sy, bz = q[t + 5], cx = (q[t + 6] - x0) * sx, cy = (q[t + 7] - y0) * sy, cz = q[t + 8];
    const den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy); if (Math.abs(den) < 1e-12) continue;   // seen edge on: its neighbours give the height
    const i0 = Math.max(0, Math.ceil(Math.min(ax, bx, cx) - 1e-9)), i1 = Math.min(nx - 1, Math.floor(Math.max(ax, bx, cx) + 1e-9)), j0 = Math.max(0, Math.ceil(Math.min(ay, by, cy) - 1e-9)), j1 = Math.min(ny - 1, Math.floor(Math.max(ay, by, cy) + 1e-9));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const l1 = ((by - cy) * (i - cx) + (cx - bx) * (j - cy)) / den, l2 = ((cy - ay) * (i - cx) + (ax - cx) * (j - cy)) / den, l3 = 1 - l1 - l2;
      if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
      const z = l1 * az + l2 * bz + l3 * cz, k = i + j * nx; if (z > Z[k]) Z[k] = z;
    }
  }
  const H = new Float32Array(nx * ny); for (let k = 0; k < H.length; k++) H[k] = Z[k] === -Infinity ? 0 : D > 0 ? (Z[k] - z0) / D : 1;   // 1 is the top, 0 the lowest
  return { nx, ny, w: W, h: L, H, tris: n };
}
const cvReliefCache = new Map();
function cvReliefMap(art, up) {
  const key = art + '|' + (up || 'z'); if (cvReliefCache.has(key)) return cvReliefCache.get(key);
  const t = typeof TEXTURES !== 'undefined' && TEXTURES[art]; if (!t) return null;
  let map = null; try { map = cvHeightMap(cvStlTris(t.bytes), up); } catch (e) { map = null; }
  if (cvReliefCache.size > 8) cvReliefCache.delete(cvReliefCache.keys().next().value);
  cvReliefCache.set(key, map); return map;
}
const cvReliefSize = (it, map) => [it.w, it.w * map.h / map.w];
// The surface as the bit's tip can follow it, on a grid over the item, centred on it. Outside the model is the board's top.
function cvReliefGrid(it, map, depth, bit) {
  const [w, h] = cvReliefSize(it, map), R = bit.d / 2, v = bit.type === 'v', ball = bit.type === 'ball', tan = v ? Math.tan(Math.max(5, bit.angle) / 2 * Math.PI / 180) : 0, tip = v ? (bit.tip || 0) / 2 : 0;
  const cell = Math.max(w / (map.nx - 1), R / 8, Math.sqrt(w * h / 4e5), .05), nx = Math.ceil(w / cell) + 1, ny = Math.ceil(h / cell) + 1, cx = w / (nx - 1), cy = h / (ny - 1);
  const S = new Float32Array(nx * ny), mx = (map.nx - 1) / w, my = (map.ny - 1) / h;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const gx = Math.min(map.nx - 1.000001, i * cx * mx), gy = Math.min(map.ny - 1.000001, j * cy * my), a = Math.floor(gx), b = Math.floor(gy), fx = gx - a, fy = gy - b, k = a + b * map.nx, H = map.H;
    S[i + j * nx] = -(1 - ((H[k] * (1 - fx) + H[k + 1] * fx) * (1 - fy) + (H[k + map.nx] * (1 - fx) + H[k + map.nx + 1] * fx) * fy)) * depth;
  }
  // Each grid point is worked out for the bit grown by a cell's width, so wherever it stands between them, all four are safe,
  // and so is any blend of them.
  const m = Math.hypot(cx, cy), offs = [], ri = Math.ceil((R + m) / cx), rj = Math.ceil((R + m) / cy);
  for (let dj = -rj; dj <= rj; dj++) for (let di = -ri; di <= ri; di++) { const d = Math.hypot(di * cx, dj * cy); if (d <= R + m + 1e-9) offs.push(di, dj, v ? Math.max(0, d - m - tip) / tan : ball ? R - Math.sqrt(Math.max(0, R * R - Math.max(0, d - m) ** 2)) : 0); }   // how far above its lowest point the bit's end is, this far out
  const C = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    let best = -Infinity;
    for (let o = 0; o < offs.length; o += 3) { const ii = i + offs[o], jj = j + offs[o + 1], s = ii < 0 || jj < 0 || ii >= nx || jj >= ny ? 0 : S[ii + jj * nx], z = s - offs[o + 2]; if (z > best) best = z; }
    C[i + j * nx] = Math.min(0, best);
  }
  const at = (x, y) => { const gx = Math.max(0, Math.min(nx - 1.000001, (x + w / 2) / cx)), gy = Math.max(0, Math.min(ny - 1.000001, (y + h / 2) / cy)), a = Math.floor(gx), b = Math.floor(gy), fx = gx - a, fy = gy - b, k = a + b * nx; return (C[k] * (1 - fx) + C[k + 1] * fx) * (1 - fy) + (C[k + nx] * (1 - fx) + C[k + nx + 1] * fx) * fy; };
  return { at, w, h, cx, cy };
}
function cvThin(c, tol) {   // drops points the line already passes within tol of, checking every point it skips
  if (c.length < 3) return c; const out = [c[0]]; let from = 0;
  for (let k = 1; k < c.length - 1; k++) {
    const a = c[from], n = c[k + 1], dx = n[0] - a[0], dy = n[1] - a[1], dz = n[2] - a[2], L2 = dx * dx + dy * dy + dz * dz; let ok = L2 > 1e-12 && k + 1 - from < 64;
    for (let m = from + 1; ok && m <= k; m++) { const b = c[m], t = Math.max(0, Math.min(1, ((b[0] - a[0]) * dx + (b[1] - a[1]) * dy + (b[2] - a[2]) * dz) / L2)); if (Math.hypot(a[0] + dx * t - b[0], a[1] + dy * t - b[1], a[2] + dz * t - b[2]) > tol) ok = false; }
    if (!ok) { out.push(c[k]); from = k; }
  }
  out.push(c[c.length - 1]); return out;
}
// part: 'rough' steps down to the surface, leaving a little for the finishing bit; 'finish' runs once over the surface at a
// fine step across; 'both' does one then the other with the same bit.
const CV_RELIEF_LEAVE = .3, CV_RELIEF_FINISH = 15;
function cvReliefPaths(it, depth, bit, notes, part, op, place) {
  const map = cvReliefMap(it.art, it.up); if (!map) { notes.push({ bad: true, text: "couldn't be read as a 3D model" }); return []; }
  const g = cvReliefGrid(it, map, depth, bit), chains = [], { w, h } = g;
  const zigzag = step => {   // rows from front to back, every one joined to the next along the edge
    const n = Math.max(1, Math.ceil(h / step - 1e-9)), pts = [], xs = Math.max(1, Math.ceil(w / g.cx)), ys = Math.max(1, Math.ceil(h / n / g.cy));
    for (let k = 0; k <= n; k++) {
      const y = -h / 2 + h * k / n, fwd = k % 2 === 0;
      if (k) for (let s = 1; s < ys; s++) pts.push([fwd ? -w / 2 : w / 2, y - h / n * (1 - s / ys)]);
      for (let s = 0; s <= xs; s++) pts.push([(fwd ? -1 : 1) * (w / 2 - w * s / xs), y]);
    }
    return pts;
  };
  const cut = (pts, z, need, top) => {   // the stretches that need cutting, with a point either side; short gaps between stay down
    const f = pts.map(q => [q[0], q[1], z(q[0], q[1])]), m = f.map(need), gap = (a, b) => Math.hypot(f[b][0] - f[a][0], f[b][1] - f[a][1]);
    for (let k = 0; k < f.length;) { if (m[k]) { k++; continue; } let j = k, len = 0; while (j < f.length && !m[j]) { if (j > k) len += gap(j - 1, j); j++; } if (k > 0 && j < f.length && len + gap(k - 1, k) + gap(j - 1, j) < CV_HOP) for (let q = k; q < j; q++) m[q] = true; k = j; }
    let run = null; const done = r => { if (r.length < 2) return; const c = cvThin(r, .003).map(q => { const p = place(q); return [p[0], p[1], q[2]]; }); c.top = top(c); chains.push(c); };
    for (let k = 0; k < f.length; k++) { if (m[k]) { if (!run) run = k ? [f[k - 1]] : []; run.push(f[k]); } else if (run) { run.push(f[k]); done(run); run = null; } }
    if (run) done(run);
  };
  if (part !== 'finish') {
    const leave = part === 'rough' ? CV_RELIEF_LEAVE : .2, rows = zigzag(Math.max(.05, bit.d * Math.min(50, Math.max(5, bit.over)) / 100)); let before = 0;
    cvPasses(depth, bit.step).forEach(L => { const b = before; cut(rows, (x, y) => Math.max(-L, Math.min(0, g.at(x, y) + leave)), q => q[2] < -b - 1e-4, () => -b); before = L; });
  }
  if (part !== 'rough') cut(zigzag(Math.max(.05, bit.d * Math.min(50, Math.max(3, op.over || CV_RELIEF_FINISH)) / 100)), g.at, q => q[2] < -1e-3, c => c[0][2]);
  if (!chains.length) notes.push({ bad: true, text: 'has nothing deep enough to carve. Give it more depth' });
  return chains;
}

// ---------- bits ----------
// A wood's speeds are a percentage of each bit's own. Boards from before this had no wood, so they count as 100%.
const cvPct = (board, k) => board[k] ?? (typeof CV_WOODS !== 'undefined' && board.wood && CV_WOODS[board.wood] ? cvRatesFor(board.wood)[k] : 100);
function cvRated(cv, bit) { const feed = cvPct(cv.board, 'feedPct') / 100, step = cvPct(cv.board, 'stepPct') / 100; return feed === 1 && step === 1 ? bit : { ...bit, feed: bit.feed * feed, plunge: bit.plunge * feed, step: Math.max(.05, bit.step * step) }; }
const CV_KINDS = [['line', 'Engrave along the lines'], ['pocket', 'Pocket: clear the area'], ['vcarve', 'V-carve'], ['drill', 'Drill holes'], ['outside', 'Cut out, around outside'], ['inside', 'Cut out, inside shape'], ['relief', 'Carve a 3D relief'], ['off', "Don't cut this"]];
const cvBitFits = (kind, bit) => !!bit && (kind === 'line' || kind === 'drill' || kind === 'relief' || (kind === 'vcarve' ? bit.type === 'v' : bit.type === 'flat'));   // any bit drills: a V-bit makes the spot dimples a corn bit needs
// A job can have a second bit, in its own file. A V-carve's is a flat bit that clears its level bottom, before the V-bit.
// A pocket's is a narrower flat bit that comes after, into the corners and details the first couldn't reach. A relief's
// finishes the surface after the first has roughed it out.
// 'auto' picks the widest flat bit you have that fits most of the level bottom: wide strokes get a big bit, thin lettering a corn bit.
const cvClearBit = (it, bitOf) => {
  const op = it.op; if (!op) return null;
  if (op.kind === 'vcarve') { if (!op.clear) return null; const b = op.clear === 'auto' ? cvAutoClear(it, bitOf) : bitOf(op.clear); return b && b.type === 'flat' ? b : null; }
  if ((op.kind === 'pocket' || op.kind === 'relief') && op.detail) {
    const main = bitOf(op.bit), b = op.detail === 'auto' && op.kind === 'pocket' ? cvAutoDetail(it, bitOf) : bitOf(op.detail); if (!b || !main || b.id === main.id) return null;
    return op.kind === 'relief' ? (cvBitFits('relief', b) ? b : null) : (b.type === 'flat' && b.d < main.d - 1e-6 ? b : null);
  }
  return null;
};
const cvSecondWhat = it => ({ vcarve: 'Clear the V-carve bottom', pocket: 'Clean out the corners', relief: 'Finish the relief' }[it.op && it.op.kind] || 'Second bit');
// the widest narrower flat bit that gets into most of what the pocket's bit leaves, or else the narrowest. A sharp corner can
// never be reached right into, so most is enough.
function cvAutoDetail(it, bitOf) {
  const main = bitOf(it.op.bit); if (!main || main.type !== 'flat' || typeof cvOwned !== 'function') return null;
  const flats = cvOwned().filter(b => b.type === 'flat' && b.d > 0 && b.d < main.d - 1e-6).sort((a, b) => b.d - a.d), key = JSON.stringify(['detail', cvShapeKey(it), main.d, flats.map(b => b.id + b.d)]);
  if (cvAutoCache.has(key)) { const id = cvAutoCache.get(key); return id ? bitOf(id) : null; }
  const area = p => Math.abs(p.reduce((s, q) => s + cvArea(q), 0)), regions = cvLocal(it).regions, R = main.d / 2;
  const islands = cvIslands(regions), rest = islands.map(island => cvRest(island, cvOffset(cvOffset(island, -R), R))), whole = rest.reduce((s, r) => s + area(r), 0);
  let pick = null;   // how much of what's left the narrower bit reaches, working in the whole shape
  if (whole > .05) { for (const b of flats) { const got = islands.reduce((s, island, i) => s + area(cvClip(ClipperLib.ClipType.ctIntersection, rest[i], cvOffset(cvOffset(island, -b.d / 2), b.d / 2))), 0) / whole; if (got >= .75) { pick = b; break; } } if (!pick) pick = flats[flats.length - 1] || null; }
  if (cvAutoCache.size > 200) cvAutoCache.clear();
  cvAutoCache.set(key, pick ? pick.id : null); return pick;
}
const cvAutoCache = new Map();
function cvAutoClear(it, bitOf) {
  const vbit = bitOf(it.op.bit); if (!vbit || vbit.type !== 'v' || !(it.op.depth > 0) || typeof cvOwned !== 'function') return null;
  const flats = cvOwned().filter(b => b.type === 'flat' && b.d > 0).sort((a, b) => b.d - a.d), key = JSON.stringify([cvShapeKey(it), it.op.depth, vbit.angle, vbit.tip, flats.map(b => b.id + b.d)]);
  if (cvAutoCache.has(key)) { const id = cvAutoCache.get(key); return id ? bitOf(id) : null; }
  const inner = cvIslands(cvLocal(it).regions).flatMap(island => cvOffset(island, -cvVshape(vbit, it.op.depth).cap)), area = p => Math.abs(p.reduce((s, q) => s + cvArea(q), 0)), whole = area(inner);
  let pick = null;
  if (whole > 1e-6) { let best = 0; for (const b of flats) { const got = area(cvOffset(cvOffset(inner, -b.d / 2), b.d / 2)) / whole; if (got >= .7) { pick = b; break; } if (got > best + .05) { best = got; pick = b; } } }
  if (cvAutoCache.size > 200) cvAutoCache.clear();
  cvAutoCache.set(key, pick ? pick.id : null); return pick;
}
const cvIsClearing = (it, bit, bitOf) => { const c = cvClearBit(it, bitOf); return !!(c && bit && c.id === bit.id); };
const cvJobFits = (it, bit, bitOf) => cvBitFits(it.op.kind, bit) || cvIsClearing(it, bit, bitOf);
const cvThrough = 0.3;   // how far a through cut goes past the board's underside, into the spoilboard
const cvOpDepth = (cv, op) => (op.through ? cv.board.t + cvThrough : op.depth);
const cvFinishOf = op => (['pocket', 'outside', 'inside'].includes(op.kind) && op.finish > 0 ? op.finish : 0);   // the skin left for a last clean pass
const cvRampOf = cv => cv.ramp ?? CV_RAMP;
// Where X0 Y0 is, as parts of the board's length and width: [0, 0] is the front left corner, [.5, .5] the middle.
const CV_ZEROS = [[0, 1, 'back left'], [.5, 1, 'back middle'], [1, 1, 'back right'], [0, .5, 'left middle'], [.5, .5, 'middle'], [1, .5, 'right middle'], [0, 0, 'front left'], [.5, 0, 'front middle'], [1, 0, 'front right']];
const cvZeroOf = cv => (Array.isArray(cv.zero) ? cv.zero : [0, 0]);
const cvZeroName = cv => { const z = cvZeroOf(cv), m = CV_ZEROS.find(q => q[0] === z[0] && q[1] === z[1]); return m ? m[2] : 'front left'; };
const cvZeroAt = cv => { const z = cvZeroOf(cv); return [z[0] * cv.board.l, z[1] * cv.board.w]; };
const CV_AIR = 5;   // how far above the board an air test runs
const cvAirOf = cv => (cv.airZ > 0 ? cv.airZ : CV_AIR);

// returns { chains, notes } for this bit's share of the item. Answers are kept, a few per item, until something about it changes.
function cvItemPaths(cv, it, bit, bitOf = typeof cvBitOf === 'function' ? cvBitOf : () => null) {
  const clearing = cvIsClearing(it, bit, bitOf), main = it.op && it.op.bit ? bitOf(it.op.bit) : null, vbit = it.op && it.op.kind === 'vcarve' ? main : null, second = cvClearBit(it, bitOf), clear = vbit ? second : null;
  bit = bit && cvRated(cv, bit);
  const op = it.op, key = JSON.stringify([cvShapeKey(it), it.x, it.y, it.rot, it.mx, it.my, op, bit, cv.board.t, cv.tabW, cv.tabH, cvRampOf(cv), clearing, main && [main.d, main.type, main.angle, main.tip], second && [second.id, second.d, second.type, second.angle, second.tip]]);
  if (!it._c) Object.defineProperty(it, '_c', { value: new Map(), writable: true, enumerable: false });
  if (it._c.has(key)) return it._c.get(key);
  const notes = [], local = cvLocal(it), place = cvPlaceFn(it), regions = local.regions.map(p => p.map(place)), lines = local.lines.map(l => ({ closed: l.closed, pts: l.pts.map(place) })), depth = cvOpDepth(cv, op);
  let chains = [];
  if (!regions.length && !lines.length) notes.push({ bad: true, text: it.type === 'text' ? "has no letters to cut. Check its text and font" : 'has nothing to cut' });
  else if (bit && depth > 0) {
    if (op.kind === 'relief') chains = cvReliefPaths(it, depth, bit, notes, clearing ? 'finish' : second ? 'rough' : 'both', op, place);
    else if (!regions.length && ['pocket', 'vcarve', 'outside', 'inside', 'drill'].includes(op.kind)) notes.push({ bad: true, text: 'has no closed shape for this job' });
    else if (clearing && op.kind === 'pocket') chains = main ? cvDetailPaths(regions, depth, main, bit, notes, !!op.climb) : [];
    else if (clearing) chains = vbit ? cvVclearPaths(regions, depth, vbit, bit, notes) : [];
    else if (op.kind === 'line') chains = cvLinePaths(lines, depth, bit.step);
    else if (op.kind === 'pocket') {
      chains = cvPocketPaths(regions, depth, bit, notes, cvFinishOf(op), !!op.climb, op.fill);
      if (second) notes.forEach((n, i) => { if (/left uncut/.test(n.text)) notes[i] = { info: true, text: `has corners too tight for the ${bit.name}, so the ${second.name} cuts them after` }; });
    }
    else if (op.kind === 'vcarve') chains = cvVcarvePaths(regions, depth, bit, notes, clear);
    else if (op.kind === 'drill') chains = cvDrillPaths(regions, depth, bit, op.peck !== false, notes);
    else {
      const R = bit.d / 2, out = op.kind === 'outside' ? 1 : -1, fin = cvFinishOf(op), base = cvUnion(regions), holesBefore = base.filter(p => cvArea(p) < 0).length, off = cvOffset(base, out * R);
      if (op.kind === 'outside' && off.filter(p => cvArea(p) < 0).length < holesBefore) notes.push({ text: 'has inner holes too small for this bit, and they will be left uncut' });
      if (!off.length) notes.push({ bad: true, text: 'is too narrow for this bit: nothing would be cut' });
      // this way round is a conventional cut, with the spindle turning clockwise. Inner pieces first, so nothing's come loose before it's cut.
      const rings = list => ((op.kind === 'outside') !== !!op.climb ? list : list.map(p => p.slice().reverse())).sort((a, b) => Math.abs(cvArea(a)) - Math.abs(cvArea(b)));
      const edge = rings(off), rough = fin > 0 ? rings(cvOffset(base, out * (R + fin))) : edge, tabs = op.tabs ?? 4, tabZ = -Math.min(depth, cv.board.t) + cv.tabH;
      let useTabs = tabs > 0 && cv.tabH > 0;
      if (useTabs && tabZ >= 0) { notes.push({ text: 'has tabs taller than the cut, so they were left out' }); useTabs = false; }
      const { spots, fewer } = useTabs ? cvTabSpots(edge, tabs, cv.tabW + bit.d) : { spots: [], fewer: false };
      if (fewer) notes.push({ text: 'is too small for all its tabs, so it has fewer. Check it will stay held' });
      chains = cvContourPaths(rough, cvPasses(depth, bit.step), bit, spots, cv.tabW, tabZ, fin + .5);
      if (fin > 0) chains = chains.concat(cvContourPaths(edge, [depth], bit, spots, cv.tabW, tabZ, .5));   // then the skin, in one pass at full depth
    }
    if (bit.type !== 'v') chains = chains.map(c => cvRamp(c, c.top ?? 0, cvRampOf(cv)));
    // a shallow V-bit line is a few tenths wide: a Z0 set a hair high, or a board not quite flat, and it barely marks
    if (op.kind === 'line' && bit.type === 'v' && depth < .4 && chains.length) notes.push({ info: true, text: `is only ${cvLenNote(depth)} deep, so a Z0 set a little high can leave it faint. In wood, 0.5 to 1 mm reads well` });
  }
  const answer = { chains, notes }; if (it._c.size >= 4) it._c.delete(it._c.keys().next().value);
  it._c.set(key, answer); return answer;
}

// ---------- the job ----------
const CV_ENGRAVE_KINDS = ['line', 'drill', 'pocket', 'relief', 'vcarve'], CV_CUT_ORDER = { line: 0, drill: .5, pocket: 1, relief: 1.5, vcarve: 2, inside: 3, outside: 4 };
// Files in cutting order. Everything that's engraved comes before anything is cut free, and bit changes are kept to a minimum.
// A V-carve with a clearing bit is in two files: the flat bit's, which comes first where it can, then the V-bit's.
function cvPlan(cv, bitOf) {
  const jobs = []; cv.items.forEach(it => { if (!it.op || it.op.kind === 'off' || !bitOf(it.op.bit)) return; const c = cvClearBit(it, bitOf), v = it.op.kind === 'vcarve'; if (c && v) jobs.push({ it, bit: c.id, clear: true }); jobs.push({ it, bit: it.op.bit }); if (c && !v) jobs.push({ it, bit: c.id, after: true }); });
  const first = jobs.filter(j => CV_ENGRAVE_KINDS.includes(j.it.op.kind)), second = jobs.filter(j => !CV_ENGRAVE_KINDS.includes(j.it.op.kind));
  const bitsIn = l => [...new Set(l.map(j => j.bit))], a = bitsIn(first), b = bitsIn(second), clears = id => first.some(j => j.bit === id && j.clear), late = id => first.every(j => j.bit !== id || j.after);
  a.sort((x, y) => clears(y) - clears(x) || late(x) - late(y));   // a bit only used after another comes after it
  const shared = a.find(x => b.includes(x));
  if (shared) { a.splice(a.indexOf(shared), 1); a.push(shared); b.splice(b.indexOf(shared), 1); b.unshift(shared); }
  const files = a.map(id => ({ bit: id, items: first.filter(j => j.bit === id).map(j => j.it) }));
  b.forEach(id => { const list = second.filter(j => j.bit === id).map(j => j.it), last = files[files.length - 1]; if (last && last.bit === id) last.items.push(...list); else files.push({ bit: id, items: list }); });
  files.forEach(f => { f.items = f.items.map((it, n) => [it, n]).sort((p, q) => CV_CUT_ORDER[p[0].op.kind] - CV_CUT_ORDER[q[0].op.kind] || p[1] - q[1]).map(p => p[0]); });
  return files;
}
// ---------- arcs ----------
// GRBL cuts true arcs (G2 clockwise, G3 anticlockwise), so a curve can go out as one line instead of hundreds. A stretch counts
// as an arc only when every point is on the circle and every short line between them stays within 0.005 mm of it, so a
// polygon whose corners happen to sit on a circle is never rounded off.
const CV_ARC_TOL = .005;
function cvArcFit(ch, s, j) {
  const A = ch[s], B = ch[(s + j) >> 1], C = ch[j], d = 2 * (A[0] * (B[1] - C[1]) + B[0] * (C[1] - A[1]) + C[0] * (A[1] - B[1])); if (Math.abs(d) < 1e-9) return null;
  const a2 = A[0] * A[0] + A[1] * A[1], b2 = B[0] * B[0] + B[1] * B[1], c2 = C[0] * C[0] + C[1] * C[1], u = [(a2 * (B[1] - C[1]) + b2 * (C[1] - A[1]) + c2 * (A[1] - B[1])) / d, (a2 * (C[0] - B[0]) + b2 * (A[0] - C[0]) + c2 * (B[0] - A[0])) / d], R = Math.hypot(A[0] - u[0], A[1] - u[1]);
  if (!(R > .05 && R < 2000)) return null;
  const most = 2 * Math.sqrt(2 * R * CV_ARC_TOL); let sweep = 0, side = 0;
  for (let k = s + 1; k <= j; k++) {
    const p = ch[k - 1], q = ch[k], L = Math.hypot(q[0] - p[0], q[1] - p[1]); if (L > most || L < 1e-6) return null;
    if (Math.abs(Math.hypot(q[0] - u[0], q[1] - u[1]) - R) > CV_ARC_TOL) return null;
    const cr = (p[0] - u[0]) * (q[1] - u[1]) - (p[1] - u[1]) * (q[0] - u[0]), sd = Math.sign(cr); if (!sd || (side && sd !== side)) return null; side = sd;
    sweep += Math.asin(Math.min(1, L / (2 * R))) * 2;
  }
  return sweep < Math.PI * 1.75 ? { c: u, cw: side < 0, len: R * sweep } : null;
}
function cvArcFrom(ch, s) {   // the longest arc starting at point s, through four points or more, at one depth
  if (s + 3 >= ch.length) return null; const z = ch[s][2]; let best = null;
  for (let j = s + 3; j < ch.length && j - s <= 400; j++) { if (Math.abs(ch[j][2] - z) > 1e-9) break; const f = cvArcFit(ch, s, j); if (!f) break; best = { ...f, j }; }
  return best && best.j >= s + 3 ? best : null;
}
// ---------- clamps ----------
// Clamp zones are where the clamps hold the board. No cut may go into one, the safe height must clear them, and a short hop
// that would pass over one goes up to the safe height instead.
const cvClamps = cv => cv.items.filter(i => i.type === 'clamp');
const cvClampRegions = (cv, R) => cvClamps(cv).map(c => { const s = cvLocal(c), place = cvPlaceFn(c); return cvOffset(s.regions.map(p => p.map(place)), R + .5); }).filter(r => r.length);
function cvCrossesClamp(cv, a, b, bit) {
  const zones = cvClampRegions(cv, bit ? bit.d / 2 : 0); if (!zones.length) return false;
  const n = Math.max(2, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]))); for (let k = 0; k <= n; k++) { const q = [a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]; if (zones.some(z => cvInside(z, q))) return true; }
  return false;
}
const CV_HOP = 5;   // mm: moves shorter than this between cuts stay just above the board
const cvCommentText = s => String(s).replace(/[^A-Za-z0-9 .,:=+\/-]/g, '').slice(0, 62);
// ---------- tiles ----------
// A board bigger than the machine can reach is cut in tiles, one after another, sliding the board along between them.
// Each tile is zeroed at its own front left corner: the board's corner for the first, and for the others a small cross that an
// earlier tile engraves there. Every cut belongs to the tile its centre line is in.
const CV_MARK = 2, CV_MARK_DEPTH = .2;   // the cross's arms and depth, in mm
function cvTiles(cv) {
  const { l, w } = cv.board;
  if (!cv.tile) return [{ n: 0, x0: 0, y0: 0, x1: l, y1: w }];
  const room = v => Math.max(20, (v || 0) - 10), nx = Math.max(1, Math.ceil(l / room(cv.workX ?? 300) - 1e-9)), ny = Math.max(1, Math.ceil(w / room(cv.workY ?? 180) - 1e-9)), out = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) out.push({ n: out.length, i, j, x0: l * i / nx, x1: l * (i + 1) / nx, y0: w * j / ny, y1: w * (j + 1) / ny, last: [i === nx - 1, j === ny - 1] });
  // each tile's corner is engraved by the first tile that can reach it
  out.forEach(t => { if (!t.n) return; const by = out.find(o => o.n < t.n && t.x0 >= o.x0 - 1e-9 && t.x0 <= o.x1 + 1e-9 && t.y0 >= o.y0 - 1e-9 && t.y0 <= o.y1 + 1e-9); t.markedBy = by ? by.n : 0; });
  return out;
}
const cvInTile = (t, x, y) => x >= t.x0 - 1e-9 && y >= t.y0 - 1e-9 && (t.last && t.last[0] ? x <= t.x1 + 1e-9 : x < t.x1 - 1e-9) && (t.last && t.last[1] ? y <= t.y1 + 1e-9 : y < t.y1 - 1e-9);
function cvClipChain(chain, t) {   // the parts of a chain inside a tile, each its own chain
  if (chain.length === 1) return cvInTile(t, chain[0][0], chain[0][1]) ? [chain] : [];
  const out = []; let cur = null;
  for (let k = 1; k < chain.length; k++) {
    const a = chain[k - 1], b = chain[k], dx = b[0] - a[0], dy = b[1] - a[1]; let t0 = 0, t1 = 1, ok = true;
    [[-dx, a[0] - t.x0], [dx, t.x1 - a[0]], [-dy, a[1] - t.y0], [dy, t.y1 - a[1]]].forEach(([p, q]) => { if (!ok) return; if (Math.abs(p) < 1e-12) { if (q < -1e-9) ok = false; return; } const r = q / p; if (p < 0) { if (r > t1) ok = false; else if (r > t0) t0 = r; } else { if (r < t0) ok = false; else if (r < t1) t1 = r; } });
    if (!ok || t1 - t0 < 1e-9 && (dx || dy)) { cur = null; continue; }
    const at = s => [a[0] + dx * s, a[1] + dy * s, a[2] + (b[2] - a[2]) * s], p = at(t0), q = at(t1);
    if (cur && t0 < 1e-9) cur.push(q); else { cur = [p, q]; out.push(cur); }
    if (t1 < 1 - 1e-9) cur = null;
  }
  return out;
}
const cvMarkChains = (x, y) => [[[x - CV_MARK, y, -CV_MARK_DEPTH], [x + CV_MARK, y, -CV_MARK_DEPTH]], [[x, y - CV_MARK, -CV_MARK_DEPTH], [x, y + CV_MARK, -CV_MARK_DEPTH]]];
const cvTileName = (cv, t) => (t.n ? `the cross at ${Math.round(t.x0 * 10) / 10}, ${Math.round(t.y0 * 10) / 10} mm on the board` : 'front left corner of the board');

// The spindle comes up to speed in four steps rather than all at once: a gentler pull on the power supply, which on a
// small machine also feeds the controller. About 5 seconds, the same as the single wait it replaces plus two.
const cvSpinUp = rpm => { const s = Math.round(rpm); return [`M3 S${Math.round(s / 4)}`, 'G4 P1', `M3 S${Math.round(s / 2)}`, 'G4 P1', `M3 S${Math.round(s * 3 / 4)}`, 'G4 P1', `M3 S${s}`, 'G4 P2']; };
// opts: air lifts the whole job this much, so it can be watched without cutting, and clear is how high its lowest point is, for the note.
// tile limits it to one tile, zeroed at that tile's corner, and marks are crosses to engrave first, for later tiles.
function cvGcode(cv, file, bit, n, of, title, opts = {}) {
  const raw = bit; bit = cvRated(cv, bit);   // the paths are given the bit as it is: they apply the wood's rates themselves
  const tile = opts.tile, lift = opts.air > 0 ? opts.air : 0, [ox, oy] = tile && cv.tile ? [tile.x0, tile.y0] : cvZeroAt(cv), r = v => { const t = (Math.round(v * 1000) / 1000).toString(); return t === '-0' ? '0' : t; };
  const out = [], say = s => out.push(`(${cvCommentText(s)})`); let minutes = 0, length = 0, where = null, cuts = 0;
  // where[] and the chains are on the board. Only the words written out are moved to the zero point and lifted.
  const X = v => r(v - ox), Y = v => r(v - oy), Z = v => r(v + lift), safe = cv.safeZ, near = Math.min(safe, 1), arcs = cv.arcs !== false;
  say(`${title}, ${tile && cv.tile ? `tile ${tile.n + 1} of ${opts.tiles}, ` : ''}file ${n} of ${of}`); if (lift) { say(`AIR TEST: everything is ${r(lift)} mm higher,`); say(`so its lowest point is ${r(opts.clear ?? cvAirOf(cv))} mm above the board.`); say('It cuts nothing. Set Z0 on the board top as usual.'); }
  say(`Bit: ${bit.name}, ${r(bit.d)} mm`); if (cv.board.wood && CV_WOODS[cv.board.wood]) say(`Wood: ${CV_WOODS[cv.board.wood].name}`);
  say(`Board ${r(cv.board.l)} x ${r(cv.board.w)} x ${r(cv.board.t)} mm`);
  if (tile && cv.tile) { say(`X0 Y0 = ${tile.n ? 'the cross at' : 'front left corner of the board.'}`); if (tile.n) say(`${r(tile.x0)}, ${r(tile.y0)} mm on the board. Z0 = top.`); else say('Z0 = top of board.'); }
  else say(`X0 Y0 = ${cvZeroName(cv)} of board. Z0 = top of board.`);
  out.push('G21 G90 G17 G94', `G0 Z${Z(safe)}`, ...cvSpinUp(bit.rpm));
  const feedTo = (x, y, z, rate) => { const d = where ? Math.hypot(x - where[0], y - where[1], z - where[2]) : 0; minutes += d / rate; length += d; };
  let lastF = null; const F = r => { if (r === lastF) return ''; lastF = r; return ` F${Math.round(r)}`; };
  const run = chain => {
    if (!chain.length) return; cuts++;
    // a short hop to the next start only lifts clear of the board; a longer one goes up to the safe height first
    const p0 = chain[0], hop = where && Math.hypot(p0[0] - where[0], p0[1] - where[1]) < CV_HOP && !cvCrossesClamp(cv, where, p0, raw);
    if (where) { out.push(`G0 Z${Z(hop ? near : safe)}`); minutes += hop ? .005 : .02; }
    out.push(`G0 X${X(p0[0])} Y${Y(p0[1])}`); if (!hop) out.push(`G0 Z${Z(near)}`); where = [p0[0], p0[1], near];
    out.push(`G1 Z${Z(p0[2])}${F(bit.plunge)}`); feedTo(p0[0], p0[1], p0[2], bit.plunge); where = p0;
    let line = null;
    for (let i = 1; i < chain.length; i++) {
      const arc = arcs && Math.hypot(chain[i - 1][0] - where[0], chain[i - 1][1] - where[1]) < 1e-6 && Math.abs(chain[i - 1][2] - where[2]) < 1e-9 ? cvArcFrom(chain, i - 1) : null;
      if (arc) {   // a stretch along one circle at one depth goes out as one arc
        const e = chain[arc.j]; line = `${arc.cw ? 'G2' : 'G3'} X${X(e[0])} Y${Y(e[1])} I${r(arc.c[0] - where[0])} J${r(arc.c[1] - where[1])}${F(bit.feed)}`; out.push(line);
        minutes += arc.len / bit.feed; length += arc.len; where = e; i = arc.j; continue;
      }
      const q = chain[i], flat = Math.abs(q[0] - where[0]) < 5e-4 && Math.abs(q[1] - where[1]) < 5e-4;
      if (flat && Math.abs(q[2] - where[2]) < 5e-4) continue;
      const down = flat && q[2] < where[2], rate = down ? bit.plunge : bit.feed, words = flat ? `Z${Z(q[2])}` : `X${X(q[0])} Y${Y(q[1])}${q[2] !== where[2] ? ` Z${Z(q[2])}` : ''}`;
      line = `G1 ${words}${F(rate)}`; if (line !== out[out.length - 1]) out.push(line);
      feedTo(q[0], q[1], q[2], rate); where = q;
    }
  };
  (opts.marks || []).forEach(m => { say(`Cross to zero tile ${m.n + 1} on`); cvMarkChains(m.x0, m.y0).forEach(run); });
  file.items.forEach(it => {
    let chains = cvItemPaths(cv, it, raw).chains;
    if (tile && cv.tile) { chains = chains.flatMap(c => cvClipChain(c, tile)); if (raw.type !== 'v') chains = chains.map(c => cvRamp(c, 0, cvRampOf(cv))); }   // a cut that starts at a tile's edge slopes in from the top
    if (!chains.length) return;
    say(`${cvIsClearing(it, raw, cvBitOf) ? cvSecondWhat(it) : CV_KINDS.find(k => k[0] === it.op.kind)[1]}: ${it.type === 'text' ? String(it.text).split('\n')[0] : it.type}`);
    chains.forEach(run);
  });
  out.push(`G0 Z${Z(safe)}`, 'M5', 'G0 X0 Y0', 'M30', '');
  return { text: out.join('\r\n'), minutes, length, cuts };
}
const cvFileSafe = s => String(s).replace(/"/g, ' in').replace(/\//g, '-').replace(/[^\w .-]+/g, ' ').replace(/\s+/g, ' ').trim();
// air: how far above the board the lowest point of an air test stays. Every file is lifted the same, by the deepest cut in the job plus this.
// With tiles, each tile has its own numbered files, and its first file engraves the crosses later tiles are zeroed on.
function cvJob(cv, bitOf, name, air) {
  const plan = cvPlan(cv, bitOf), tiles = cvTiles(cv); let lift = 0;
  if (air > 0) { let low = 0; plan.forEach(f => f.items.forEach(it => cvItemPaths(cv, it, bitOf(f.bit), bitOf).chains.forEach(c => c.forEach(q => { if (q[2] < low) low = q[2]; })))); lift = air - low; }
  const out = [];
  tiles.forEach(tile => {
    const marks = tiles.filter(t => t.n && t.markedBy === tile.n), made = [];
    plan.forEach(file => {
      const bit = bitOf(file.bit), g = cvGcode(cv, file, bit, 0, 0, name, { air: lift, clear: air, tile: cv.tile ? tile : null, tiles: tiles.length, marks: made.length ? [] : marks });
      if (g.cuts) made.push({ file, bit, g, marks: made.length ? [] : marks });
    });
    if (!made.length && marks.length && plan.length) { const file = { bit: plan[0].bit, items: [] }, bit = bitOf(file.bit); made.push({ file, bit, g: cvGcode(cv, file, bit, 0, 0, name, { air: lift, clear: air, tile, tiles: tiles.length, marks }), marks }); }
    made.forEach((m, i) => {   // written again with their numbers, now the count is known
      const g = cvGcode(cv, m.file, m.bit, i + 1, made.length, name, { air: lift, clear: air, tile: cv.tile ? tile : null, tiles: tiles.length, marks: m.marks }), pre = cv.tile ? `Tile ${tile.n + 1} of ${tiles.length} - ` : '';
      out.push({ name: `${pre}${i + 1} of ${made.length} - ${cvFileSafe(m.bit.name)}${air ? ' - AIR TEST' : ''}.nc`, bit: m.bit, text: g.text, minutes: g.minutes, items: m.file.items.map(x => x.id), tile: tile.n });
    });
  });
  return out;
}
const cvClampH = cv => (cv.clampH > 0 ? cv.clampH : 15);
// ---------- checking shapes ----------
// Like VCarve's vector validator: what's likely to cut differently from how it looks. These are warnings, not stops.
function cvShapeProblems(cv, it) {
  const out = [], s = cvLocal(it), kind = it.op && it.op.kind, open = s.lines.filter(l => !l.closed).length;
  if (open && ['pocket', 'vcarve', 'outside', 'inside', 'drill'].includes(kind)) out.push(`has ${open} open ${open === 1 ? 'line' : 'lines'}, which this job leaves out. Close ${open === 1 ? 'it' : 'them'} with Edit its points, or engrave instead`);
  if (['path', 'svg', 'trace'].includes(it.type)) {
    const crossed = s.lines.filter(l => l.closed && l.pts.length > 3).some(l => { const p = cvIn([l.pts])[0], parts = ClipperLib.Clipper.SimplifyPolygon(p, ClipperLib.PolyFillType.pftNonZero); return parts.length > 1 || (parts.length === 1 && Math.abs(Math.abs(ClipperLib.Clipper.Area(parts[0])) - Math.abs(ClipperLib.Clipper.Area(p))) > Math.abs(ClipperLib.Clipper.Area(p)) * .001 + 1e4); });
    if (crossed) out.push('has an outline that crosses itself, so part of it may not cut as drawn');
  }
  const key = JSON.stringify([cvShapeKey(it), Math.round(it.x * 100), Math.round(it.y * 100), it.rot || 0, !!it.mx, !!it.my]);
  if (cv.items.some(o => o !== it && o.op && o.op.kind !== 'off' && JSON.stringify([cvShapeKey(o), Math.round(o.x * 100), Math.round(o.y * 100), o.rot || 0, !!o.mx, !!o.my]) === key)) out.push('is exactly on top of a copy of itself, so it would be cut twice');
  return out;
}
// what's wrong with the job, or worth knowing. bad stops the export.
function cvChecks(cv, bitOf, have) {
  const out = [], label = it => (it.type === 'text' ? `"${String(it.text).split('\n')[0].slice(0, 24)}"` : { svg: 'The artwork', rect: 'The rectangle', circle: 'The circle' }[it.type] || 'The ' + (typeof cvItemName === 'function' ? cvItemName(it) : 'shape').toLowerCase());
  if (!cv.items.length) out.push({ bad: true, text: 'Add text, artwork or a shape first.' });
  if (!have) out.push({ bad: true, text: 'Tick the bits you have in Bits.' });
  if (!(cv.board.l > 0 && cv.board.w > 0 && cv.board.t > 0)) out.push({ bad: true, text: 'The board needs a length, width and thickness.' });
  if (!(cv.safeZ > 0)) out.push({ bad: true, text: 'Safe height must be above the board.' });
  const clamps = cvClamps(cv); if (clamps.length && !(cv.safeZ > cvClampH(cv))) out.push({ bad: true, text: `Safe height must be above your clamps, which stand ${cvLenNote(cvClampH(cv))} high. Raise it in Machine.` });
  let any = false;
  cv.items.forEach(it => {
    const op = it.op; if (!op || op.kind === 'off') return; any = true;
    const bit = bitOf(op.bit), who = label(it), depth = cvOpDepth(cv, op);
    if (!bit) { out.push({ bad: true, id: it.id, text: `${who} needs a bit.` }); return; }
    if (!cvBitFits(op.kind, bit)) { out.push({ bad: true, id: it.id, text: `${who}: ${bit.name} can't do this job. ${op.kind === 'vcarve' ? 'V-carving needs a V-bit.' : 'This needs a flat bit.'}` }); return; }
    if (!(bit.d > 0 && bit.feed > 0 && bit.plunge > 0 && bit.step > 0 && bit.rpm > 0)) { out.push({ bad: true, id: it.id, text: `${bit.name} has a size or speed missing. Check it in Bits.` }); return; }
    if (!(depth > 0)) { out.push({ bad: true, id: it.id, text: `${who} needs a depth.` }); return; }
    if (depth > cv.board.t + cvThrough + .001) { out.push({ bad: true, id: it.id, text: `${who} would cut deeper than the board. Reduce its depth.` }); return; }
    if (it.type === 'text' && !cvFontOf(it.font)) out.push({ bad: true, id: it.id, text: `${who}: the font ${it.font} isn't available or can't be read.` });
    if (it.type === 'text' && cvIsLineFont(it.font) && op.kind !== 'line') { out.push({ bad: true, id: it.id, text: `${who}: ${it.font} is a single-line font, so it can only be engraved along its lines.` }); return; }
    if (it.type === 'svg' && !cvArt(it.art)) out.push({ bad: true, id: it.id, text: `${who} couldn't be read.` });
    cvShapeProblems(cv, it).forEach(t => out.push({ id: it.id, text: `${who} ${t}.` }));
    const { chains, notes } = cvItemPaths(cv, it, bit, bitOf);
    if (clamps.length) { const zones = cvClampRegions(cv, bit.type === 'v' ? 0 : bit.d / 2); if (chains.some(c => c.some(q => q[2] < 0 && zones.some(z => cvInside(z, q))))) out.push({ bad: true, id: it.id, text: `${who} runs into a clamp zone. Move it, or the clamp.` }); }
    const want2 = op.kind === 'vcarve' ? op.clear : op.kind === 'pocket' || op.kind === 'relief' ? op.detail : null;
    if (want2) {
      const c = cvClearBit(it, bitOf), need = { vcarve: 'its clearing bit must be a flat bit you have', pocket: `its corners bit must be a flat bit you have, narrower than the ${bit.name}`, relief: 'its finishing bit must be another bit you have' }[op.kind];
      if (!c && want2 === 'auto') { /* nothing fits, so the first bit does it all */ } else if (!c) out.push({ bad: true, id: it.id, text: `${who}: ${need}.` });
      else if (!(c.d > 0 && c.feed > 0 && c.plunge > 0 && c.step > 0 && c.rpm > 0)) out.push({ bad: true, id: it.id, text: `${c.name} has a size or speed missing. Check it in Bits.` });
      else cvItemPaths(cv, it, c, bitOf).notes.forEach(n => out.push({ bad: !!n.bad, info: !n.bad, id: it.id, text: `${who} ${n.text}.` }));
    }
    notes.forEach(n => out.push({ bad: !!n.bad, info: !!n.info, id: it.id, text: `${who} ${n.text}.` }));
    if (bit.reach > 0 && depth > bit.reach) out.push({ id: it.id, text: `${who} is deeper than ${bit.name} can cut.` });
    if (cv.maxRate > 0 && (bit.feed > cv.maxRate || bit.plunge > cv.maxRate)) out.push({ id: it.id, text: `${bit.name} is set faster than your machine's top speed.` });
    // From a front left zero the machine's room is all forward and right. From anywhere else, only the overall size can be checked.
    const R = bit.type === 'v' ? 0 : bit.d / 2, corner = cvZeroOf(cv)[0] === 0 && cvZeroOf(cv)[1] === 0 && !cv.tile, box = cvBox(chains); let off = false, over = false, far = false;
    chains.forEach(c => c.forEach(q => { if (q[0] < R - .01 || q[1] < R - .01 || q[0] > cv.board.l - R + .01 || q[1] > cv.board.w - R + .01) off = true; if (corner && !cv.tile && (q[0] < -5 - R || q[1] < -5 - R)) over = true; if (corner && (q[0] + R > (cv.workX ?? 300) || q[1] + R > (cv.workY ?? 180))) far = true; }));
    const wide = !corner && !cv.tile && chains.length && (box.x1 - box.x0 + 2 * R > (cv.workX ?? 300) || box.y1 - box.y0 + 2 * R > (cv.workY ?? 180));
    if (off) out.push({ id: it.id, text: `${who} goes past the edge of the board. Check for clamps.` });
    if (far) out.push({ id: it.id, text: `${who} is further from the zero point than your machine can travel. Tiles in Machine can split it.` });
    if (wide) out.push({ id: it.id, text: `${who} is bigger than your machine can travel. Tiles in Machine can split it.` });
    if (over) out.push({ id: it.id, text: `${who} goes well left of or in front of the zero point. Your machine may not have room.` });
  });
  if (cv.items.length && !any) out.push({ bad: true, text: 'Nothing is set to be cut.' });
  return out;
}

// ---------- the board as it will come out ----------
// Runs each bit along the same paths the G-code uses and keeps the lowest point it reached, for a grid of points over the board.
// H[i + j * nx] is the surface there, 0 at the top and below -thickness where it's cut right through. It isn't capped at -thickness, so the edge of a hole falls on the smooth slope of the wall, not along the grid.
// The job as a list of moves in cutting order, each with the time it ends, so it can be played back. Each toolpath (an item's
// share for one bit) starts a new part, for stepping through them.
function cvCarveSteps(cv, bitOf) {
  const steps = [], parts = []; let t = 0, end = null;
  cvPlan(cv, bitOf).forEach((file, fi) => {
    const bit = bitOf(file.bit); if (!bit) return; const rated = cvRated(cv, bit);
    file.items.forEach(it => {
      if (!cvJobFits(it, bit, bitOf)) return;
      const chains = cvItemPaths(cv, it, bit, bitOf).chains; if (!chains.length) return;
      parts.push({ from: steps.length, t, file: fi, bit, it, clearing: cvIsClearing(it, bit, bitOf) });
      chains.forEach(chain => {   // timed as the G-code is: up and across, down from just above the board, then the cut
        const p0 = chain[0]; if (end && end.bit === bit) t += Math.hypot(p0[0] - end.p[0], p0[1] - end.p[1]) < CV_HOP ? .005 : .02;
        t += Math.max(0, Math.min(cv.safeZ, 1) - p0[2]) / rated.plunge;
        for (let n = 0; n < chain.length; n++) {
          const a = chain[n], b = chain[Math.min(n + 1, chain.length - 1)], flat = Math.abs(a[0] - b[0]) < 5e-4 && Math.abs(a[1] - b[1]) < 5e-4;
          t += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / (flat && b[2] < a[2] ? rated.plunge : rated.feed); steps.push({ a, b, bit, t });
        }
        end = { p: chain[chain.length - 1], bit };
      });
    });
  });
  return { steps, parts, total: t };
}
function cvCarveGrid(cv, wantCell) { const { l, w, t } = cv.board, cell = wantCell || Math.max(.2, Math.sqrt(l * w / 8e5)), nx = Math.max(2, Math.ceil(l / cell) + 1), ny = Math.max(2, Math.ceil(w / cell) + 1); return { H: new Float32Array(nx * ny), nx, ny, cell, l, w, t }; }
// Cuts one move into the surface: the bit's shape swept from a to b, keeping the lowest point at each spot.
function cvStamp(map, a, b, bit) {
  const { H, nx, ny, cell } = map, low = Math.min(a[2], b[2]); if (low >= 0) return;
  const v = bit.type === 'v', ball = bit.type === 'ball', tan = v ? Math.tan(Math.max(5, bit.angle) / 2 * Math.PI / 180) : 0, tip = v ? (bit.tip || 0) / 2 : 0, R = bit.d / 2, soft = cell * .5, edge = cell * .75;   // soft: a groove thinner than the grid still shows. edge: the bit's rim fades across the grid, so a curved wall stays a smooth curve
  const reach = (v ? Math.min(R, tip + -low * tan) + soft : R) + edge, x0 = Math.max(0, Math.floor((Math.min(a[0], b[0]) - reach) / cell)), x1 = Math.min(nx - 1, Math.ceil((Math.max(a[0], b[0]) + reach) / cell)), y0 = Math.max(0, Math.floor((Math.min(a[1], b[1]) - reach) / cell)), y1 = Math.min(ny - 1, Math.ceil((Math.max(a[1], b[1]) + reach) / cell));
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], len = dx * dx + dy * dy;
  for (let j = y0; j <= y1; j++) for (let i = x0; i <= x1; i++) {
    const px = i * cell, py = j * cell, s = len ? Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / len)) : 0, ex = px - a[0] - dx * s, ey = py - a[1] - dy * s, dist = Math.sqrt(ex * ex + ey * ey); if (dist > reach) continue;
    const z = a[2] + dz * s, cover = Math.min(1, (R + edge - dist) / (2 * edge)), here = (v ? z + Math.max(0, dist - tip - soft) / tan : ball ? z + R - Math.sqrt(Math.max(0, R * R - Math.max(0, dist - soft) ** 2)) : z) * cover, k = i + j * nx;
    if (here < H[k]) H[k] = here;
  }
}
function cvCarveMap(cv, bitOf, wantCell) {
  const map = cvCarveGrid(cv, wantCell);
  cvCarveSteps(cv, bitOf).steps.forEach(s => cvStamp(map, s.a, s.b, s.bit));
  return map;
}

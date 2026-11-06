// ---------- precision ----------
// Type while dragging (or straight after) for an exact result. X, Y or Z during a move holds it to that direction.
// Guides are lines you place, in P.cguides as { axis, at }, that things snap to. Snapping shows what it caught.

// ---------- typing an exact value ----------
let precBuffer = '', precAxis = null, precLast = null, snapHits = [];
const precLive = () => { if (typeof d3 !== 'undefined' && d3 && d3.moved && ['plane', 'axis', 'turn', 'spin', 'stretch', 'scale'].includes(d3.type)) return d3; if (typeof fd !== 'undefined' && fd && fd.moved && (fd.type === 'move' || fd.type === 'size')) return fd; return null; };
const precTarget = () => precLive() || (precLast && precLast.undo === undoS.length && precLast.P === P ? precLast.t : null);
const precIsTurn = t => t.type === 'turn' || t.type === 'spin';
const precIsSize = t => t.type === 'stretch' || t.type === 'size';
function precMoveAxis(t) {   // the direction a typed distance goes: the one held, the one dragged along, or the one moved furthest
  if (precAxis != null) return precAxis;
  if (t.type === 'axis') return t.axis;
  const dv = precDelta(t); let best = 0; [0, 1, 2].forEach(a => { if (Math.abs(dv[a]) > Math.abs(dv[best])) best = a; });
  return best;
}
function precDelta(t) { const b = t.base[0], it = b && byId(b.id); return it ? it.pos.map((v, i) => v - b.pos[i]) : [0, 0, 0]; }
function precPrompt(t) {
  const shown = precBuffer + '_';
  if (precIsTurn(t)) return `Turn: ${shown}°`;
  if (precIsSize(t)) return `Size: ${shown}`;
  if (t.type === 'scale') return `Scale: ${shown}%`;
  return `Move along ${AXN[precMoveAxis(t)]}: ${shown}`;
}
function precApplyTo(t, text) {   // returns false if the text can't be used
  if (precIsTurn(t) || t.type === 'scale') {
    const v = parseFloat(text); if (!isFinite(v)) return false;
    if (t.type === 'scale') { if (v <= 0) return false; applyScale(t, v / 100); return true; }
    const signed = v * (t.lastAng < 0 ? -1 : 1), r = new THREE.Quaternion().setFromAxisAngle(t.axisV, signed * Math.PI / 180);
    t.base.forEach(b => { const it = byId(b.id), pp = V3(...b.pos).sub(t.c).applyQuaternion(r).add(t.c); it.pos = [pp.x, pp.y, pp.z]; setQ(it, r.clone().multiply(new THREE.Quaternion(...b.q))); });
    return true;
  }
  const v = parseLen(text); if (!isFinite(v)) return false;
  if (t.type === 'stretch') { if (v < 1) return false; t.anchor[t.axis] = t.fixed; applyScale(t, v / t.ext, t.axis); return true; }
  if (t.type === 'size') { if (v < 1) return false; const it = byId(t.id); it[t.key] = v; it.pos[t.axis] = t.side > 0 ? t.fixed + v / 2 : t.fixed - v / 2; return true; }
  const a = precMoveAxis(t), sign = precDelta(t)[a] < 0 ? -1 : 1;
  t.base.forEach(b => { const it = byId(b.id); it.pos = b.pos.slice(); it.pos[a] += sign * v; });
  return true;
}
function precFinish(text) {
  const t = precTarget(); if (!t) return;
  const ok = precApplyTo(t, text);
  if (!ok) { toast(`"${text}" can't be used here.`, true); return; }
  const live = precLive();
  if (live) { if (live === (typeof d3 !== 'undefined' ? d3 : null)) { d3 = null; controls.enabled = true; } else fd = null; }
  guides = []; snapHits = []; precAxis = null; precLast = null; readout('');
  persist(); render();
}
function precCancelDrag(t) {   // Esc while dragging puts everything back
  P = JSON.parse(undoS.pop()); sel = sel.filter(byId);
  if (t === (typeof d3 !== 'undefined' ? d3 : null)) { d3 = null; controls.enabled = true; } else fd = null;
  guides = []; snapHits = []; precAxis = null; precBuffer = ''; readout(''); render();
}
const precRemember = t => { precAxis = null; snapHits = []; precLast = (t.type === 'plane' || t.type === 'axis' || t.type === 'move' || t.type === 'size' || t.type === 'stretch' || t.type === 'turn' || t.type === 'spin' || t.type === 'scale') && t.moved ? { t, undo: undoS.length, P } : null; };
window.addEventListener('keydown', e => {
  const a = document.activeElement;
  if (a && /INPUT|SELECT|TEXTAREA/.test(a.tagName)) return;
  if (document.querySelector('dialog[open]') || document.getElementById('pack').classList.contains('open') || document.getElementById('draw').classList.contains('open') || document.getElementById('carve').classList.contains('open')) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const live = precLive(), target = precTarget(), stop = () => { e.preventDefault(); e.stopPropagation(); };
  if (precBuffer) {
    if (e.key === 'Enter') { stop(); const text = precBuffer; precBuffer = ''; precFinish(text); return; }
    if (e.key === 'Escape') { stop(); precBuffer = ''; readout(''); return; }
    if (e.key === 'Backspace') { stop(); precBuffer = precBuffer.slice(0, -1); if (target) readout(precBuffer ? precPrompt(target) : ''); return; }
    if (e.key.length === 1) { stop(); if (precBuffer.length < 24) precBuffer += e.key; if (target) readout(precPrompt(target)); }
    return;
  }
  if (live && e.key === 'Escape') { stop(); precCancelDrag(live); return; }
  if (live && !precIsTurn(live) && !precIsSize(live) && live.type !== 'scale' && live.type !== 'axis' && /^[xyz]$/i.test(e.key)) { stop(); const n = 'xyz'.indexOf(e.key.toLowerCase()); precAxis = precAxis === n ? null : n; readout(precAxis == null ? 'Free' : `Held to ${AXN[precAxis]}`); return; }
  if (target && /^[0-9.]$/.test(e.key)) { stop(); precBuffer = e.key; readout(precPrompt(target)); }
}, true);

// ---------- moving and turning by typed amounts ----------
let precTurnBy = 90;
function moveByHtml() {
  const cell = (label, a) => { handlers['mb' + a] = s => { const v = parseLen(s); if (!isFinite(v) || !movable().length) { renderSide(); return; } edit(() => { movable().forEach(i => { i.pos[a] += v; }); }); }; return `<label>${label}<input type="text" data-f="mb${a}" value="" placeholder="0" aria-label="Move ${label} by"></label>`; };
  return sec('moveby', 'Move by', `<div class="tri">${cell('Across', 0)}${cell('Up', 1)}${cell('Deep', 2)}</div>`);
}
const ANGLE_STEPS = [1, 5, 10, 15, 30, 45, 90];
const angleStep = () => P.angleStep || 15;
const snapAngle = (ang, e) => { const s = e.shiftKey ? 90 : angleStep(); return Math.round(ang / s) * s; };
function angleToolsHtml(it) {
  return `<label class="field">Turn buttons by, degrees<input type="text" id="precTurn" value="${precTurnBy}"></label><label class="field">Snap angle every<select id="precStep">${ANGLE_STEPS.map(s => `<option value="${s}" ${s === angleStep() ? 'selected' : ''}>${s}°</option>`).join('')}</select></label>${it ? `<label class="check"><input type="checkbox" id="precLock" ${it.lockAngle ? 'checked' : ''}>Lock this angle</label>` : ''}`;
}
function precBindPanel(it) {
  const q = id => side.querySelector('#' + id), turn = q('precTurn');
  if (turn) { turn.onkeydown = e => e.stopPropagation(); turn.onchange = () => { const v = parseFloat(turn.value); if (isFinite(v) && v !== 0) precTurnBy = v; else turn.value = precTurnBy; }; }
  if (q('precStep')) q('precStep').onchange = e => edit(() => { P.angleStep = +e.target.value; });
  if (q('precLock') && it) q('precLock').onchange = e => edit(() => { if (e.target.checked) it.lockAngle = true; else delete it.lockAngle; });
  if (it && it.lockAngle) side.querySelectorAll('[data-ang],[data-angt],[data-rot]').forEach(el => { el.disabled = true; });
  guidesBind();
}
const turnable = () => movable().filter(i => !i.lockAngle);

// ---------- guides ----------
const cguides = () => P.cguides || (P.cguides = []);
const AX_WORDS = ['Across', 'Up', 'Deep'];
const guidesOn = () => !P.hideGuides;
const guideTargets = axis => (guidesOn() ? (P.cguides || []).filter(g => g.axis === axis) : []);
function guidesHtml() {
  const rows = (P.cguides || []).map((g, i) => { handlers['gd' + i] = num(v => edit(() => { g.at = v; })); return `<div class="gdrow"><select data-gdax="${i}" aria-label="Direction">${AX_WORDS.map((w, a) => `<option value="${a}" ${a === g.axis ? 'selected' : ''}>${w}</option>`).join('')}</select><input type="text" data-f="gd${i}" data-len="1" value="${esc(bare(g.at))}" aria-label="Guide position"><button class="ic" data-gddel="${i}" title="Delete guide" aria-label="Delete guide">${ic('x')}</button></div>`; }).join('');
  return sec('guides', `Guides${(P.cguides || []).length ? `: ${P.cguides.length}` : ''}`, `${rows || '<p class="note" style="margin:0 0 6px">Drag from a ruler in a flat view to place a guide, then drag it to move it. Things snap to guides.</p>'}<label class="check"><input type="checkbox" id="gdShow" ${guidesOn() ? 'checked' : ''}>Show guides and snap to them</label><div class="rowb" style="margin-top:6px"><button class="btn line" id="gdAdd">Add</button><button class="btn line" id="gdClear" ${(P.cguides || []).length ? '' : 'disabled'}>Clear all</button></div>`);
}
function guidesBind() {
  const q = id => side.querySelector('#' + id);
  side.querySelectorAll('[data-gdax]').forEach(s => { s.onchange = () => edit(() => { cguides()[+s.dataset.gdax].axis = +s.value; }); });
  side.querySelectorAll('[data-gddel]').forEach(b => { b.onclick = () => edit(() => { cguides().splice(+b.dataset.gddel, 1); }); });
  if (q('gdShow')) q('gdShow').onchange = e => edit(() => { P.hideGuides = !e.target.checked; });
  if (q('gdAdd')) { addIcon(q('gdAdd'), 'plus'); q('gdAdd').onclick = () => edit(() => { cguides().push({ axis: 0, at: 0 }); }); }
  if (q('gdClear')) q('gdClear').onclick = () => edit(() => { P.cguides = []; });
}
const GUIDE_COLOUR = () => (isDark() ? '#4fc3d9' : '#1b8aa5');
function guidesSvg(vn, t, W, H) {
  if (!guidesOn()) return '';
  const V = VIEWS[vn]; let s = '';
  (P.cguides || []).forEach(g => {
    if (g.axis !== V.u && g.axis !== V.v) return;
    const p = [0, 0, 0]; p[g.axis] = g.at; const q = toS(vn, t, p);
    s += g.axis === V.u ? `<line x1="${q[0]}" x2="${q[0]}" y1="0" y2="${H}" stroke="${GUIDE_COLOUR()}" stroke-dasharray="5 3"/>` : `<line x1="0" x2="${W}" y1="${q[1]}" y2="${q[1]}" stroke="${GUIDE_COLOUR()}" stroke-dasharray="5 3"/>`;
  });
  return s;
}
function guideAt(vn, x, y) {   // the guide under the pointer in a flat view
  if (!guidesOn()) return -1;
  const V = VIEWS[vn], t = vt[vn];
  return (P.cguides || []).findIndex(g => {
    if (g.axis !== V.u && g.axis !== V.v) return false;
    const p = [0, 0, 0]; p[g.axis] = g.at; const q = toS(vn, t, p);
    return g.axis === V.u ? Math.abs(q[0] - x) < 4 : Math.abs(q[1] - y) < 4;
  });
}
const RULER = 15;
function guidesDraw3D(grp) {   // each guide is a dashed frame round the design, on its plane
  if (!guidesOn() || !(P.cguides || []).length) return;
  const vis = shown(), ext = vis.length ? unionBounds(vis) : { min: [0, 0, 0], max: [1500, 1000, 800] }, mat = new THREE.LineDashedMaterial({ color: new THREE.Color(GUIDE_COLOUR()), dashSize: 40, gapSize: 25 });
  P.cguides.forEach(g => {
    const [a, b] = [0, 1, 2].filter(x => x !== g.axis), lo = ext.min, hi = ext.max, pad = 150;
    const pts = [[lo[a] - pad, lo[b] - pad], [hi[a] + pad, lo[b] - pad], [hi[a] + pad, hi[b] + pad], [lo[a] - pad, hi[b] + pad], [lo[a] - pad, lo[b] - pad]].map(([u, v]) => { const p = [0, 0, 0]; p[g.axis] = g.at; p[a] = u; p[b] = v; return V3(...p); });
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat); line.computeLineDistances(); grp.add(line);
  });
}

// ---------- seeing what snapped ----------
const snapNote = () => { const seen = new Set(), names = []; snapHits.forEach(h => { const n = h.guide ? 'guide' : h.id && byId(h.id) ? byId(h.id).name : null; if (n && !seen.has(n)) { seen.add(n); names.push(n); } }); return names.length ? `  snapped to ${names.join(', ')}` : ''; };
function snapHighlightSvg(vn, t) {   // the thing it caught gets an outline
  return snapHits.filter(h => h.id && byId(h.id)).map(h => { const pts = hull(corners(byId(h.id)).map(c => toS(vn, t, c))); return `<polygon points="${polyStr(pts)}" fill="none" stroke="${GUIDE_COLOUR()}" stroke-width="2"/>`; }).join('');
}
function snapHighlight3D(grp) {
  snapHits.filter(h => h.id && byId(h.id)).forEach(h => { const it = byId(h.id), box = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(it.l + 3, it.t + 3, it.w + 3)), new THREE.LineBasicMaterial({ color: new THREE.Color(GUIDE_COLOUR()), depthTest: false })); box.position.set(...it.pos); box.quaternion.copy(Q(it)); box.renderOrder = 8; grp.add(box); });
}

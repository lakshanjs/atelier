// ---------- editable designs ----------
// A layer (or the whole project) can have named parameters, and any size or position can be a formula using them.
// Change a parameter and everything that depends on it follows, including the cut list and drilling.
//
//   P.params, group.params   [{ name, e, u }]   e is the expression, u the unit a plain number in it means
//   item.fx                  { l, t, w, x, y, z: { e, u } }   x, y, z are "from left", "from floor", "from back"
//   item.fxv                 what the last solve gave. Anything different was changed by hand, so that formula stops.
const FX_SIZE = ['l', 't', 'w'], FX_POS = ['x', 'y', 'z'], FX_FUNCS = { min: Math.min, max: Math.max, abs: Math.abs };
const FX_NAME = /^[A-Za-z][A-Za-z0-9_]*$/;
let fxIssues = new Map();   // "itemId.field" or "p:layer.name" -> what's wrong, shown in Properties and the checks

const FX_LITERAL = /^(?:\d+(?:\.\d+)?\s*(?:'|ft\b|feet\b|foot\b)(?:\s*\d[\d.\/\s]*")?|(?:\d+[\s-]+)?\d+\/\d+\s*(?:"|in\b|inch\b|inches\b|mm\b|cm\b|m\b|yd\b)|(?:\d+\.?\d*|\.\d+)\s*(?:"|inches\b|inch\b|in\b|mm\b|cm\b|m\b|yd\b))/i;
function fxTokens(src) {
  const out = []; let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    const rest = src.slice(i), lit = FX_LITERAL.exec(rest);
    if (lit) { out.push({ k: 'len', v: fxLiteral(lit[0]) }); i += lit[0].length; continue; }
    const num = /^(?:\d+\.?\d*|\.\d+)/.exec(rest);
    if (num) { out.push({ k: 'num', v: +num[0] }); i += num[0].length; continue; }
    const ref = /^#(\d+)\.([a-z]+[01]?)/i.exec(rest);
    if (ref) { out.push({ k: 'ref', id: +ref[1], f: ref[2].toLowerCase() }); i += ref[0].length; continue; }
    const name = /^[A-Za-z][A-Za-z0-9_]*/.exec(rest);
    if (name) { out.push({ k: 'name', v: name[0] }); i += name[0].length; continue; }
    if ('+-*/(),'.includes(c)) { out.push({ k: c }); i++; continue; }
    throw new Error(`"${c}" isn't something a formula can use`);
  }
  return out;
}
function fxLiteral(t) {   // a length written with its unit, which doesn't depend on the project's current unit
  const v = parseLen(t);
  if (!isFinite(v)) throw new Error(`"${t}" isn't a length`);
  return v;
}
// Values carry whether they're a length. A plain number added to a length takes the formula's unit, so "Width - 2" means 2 inches
// in an inch project while "2 * Thick" stays a multiplier. A plain number left at the very end is a length too.
function fxEval(expr, unit, look) {
  const tk = fxTokens(expr), mm = (UNITS[unit] || UNITS.mm).mm; let i = 0;
  const peek = () => tk[i] && tk[i].k, take = k => { if (peek() !== k) throw new Error(k === ')' ? 'a bracket is missing' : 'the formula is incomplete'); return tk[i++]; };
  const asLen = a => (a.d ? a.v : a.v * mm);
  const add = (a, b, s) => { if (a.d === b.d) return { v: a.v + s * b.v, d: a.d }; return { v: asLen(a) + s * asLen(b), d: true }; };
  const atom = () => {
    const t = tk[i]; if (!t) throw new Error('the formula is incomplete');
    i++;
    if (t.k === 'num') return { v: t.v, d: false };
    if (t.k === 'len') return { v: t.v, d: true };
    if (t.k === 'ref') return { v: look.ref(t.id, t.f), d: true };
    if (t.k === '(') { const a = sum(); take(')'); return a; }
    if (t.k === '-') { const a = atom(); return { v: -a.v, d: a.d }; }
    if (t.k === '+') return atom();
    if (t.k === 'name') {
      const low = t.v.toLowerCase();
      if (peek() === '(') {
        i++; const args = []; if (peek() !== ')') { args.push(sum()); while (peek() === ',') { i++; args.push(sum()); } } take(')');
        if (!args.length) throw new Error(`${t.v} needs something in its brackets`);
        if (low === 'round' || low === 'floor' || low === 'ceil') {
          const fn = Math[low], a = args[0], step = args[1];
          if (!step) return { v: fn(a.v), d: a.d };
          const s = a.d ? asLen(step) : step.v; if (!s) throw new Error(`${t.v} can't step by zero`);
          return { v: fn(a.v / s) * s, d: a.d };
        }
        const f = FX_FUNCS[low]; if (!f) throw new Error(`there is no function called ${t.v}`);
        const anyLen = args.some(a => a.d); return { v: f(...args.map(a => (anyLen ? asLen(a) : a.v))), d: anyLen };
      }
      return look.name(t.v);
    }
    throw new Error('the formula has something out of place');
  };
  const product = () => {
    let a = atom();
    while (peek() === '*' || peek() === '/') {
      const op = tk[i++].k, b = atom();
      if (op === '*') { if (a.d && b.d) throw new Error("two lengths can't be multiplied"); a = { v: a.v * b.v, d: a.d || b.d }; }
      else { if (!b.v) throw new Error('it divides by zero'); if (!a.d && b.d) throw new Error("a plain number can't be divided by a length"); a = { v: a.v / b.v, d: a.d && !b.d }; }
    }
    return a;
  };
  const sum = () => { let a = product(); while (peek() === '+' || peek() === '-') { const s = tk[i++].k === '+' ? 1 : -1; a = add(a, product(), s); } return a; };
  const r = sum(); if (i < tk.length) throw new Error('the formula has something out of place');
  if (!isFinite(r.v)) throw new Error("it doesn't give a number");
  return r;
}
const fxLenOf = (r, unit) => (r.d ? r.v : r.v * (UNITS[unit] || UNITS.mm).mm);
const fxHasAny = () => (P.params && P.params.length) || P.items.some(i => i.fx) || P.groups.some(g => g.params && g.params.length);
const fxLayer = id => P.groups.find(g => g.id === id);
function fxFindParam(name, groupId) {
  const low = name.toLowerCase(), g = groupId && fxLayer(groupId);
  return (g && g.params && g.params.find(p => p.name.toLowerCase() === low)) || (P.params || []).find(p => p.name.toLowerCase() === low) || null;
}
function fxLook(groupId, stack = []) {
  return {
    name(n) {
      const p = fxFindParam(n, groupId); if (!p) throw new Error(`there is no parameter called ${n}`);
      if (stack.includes(p)) throw new Error(`${n} depends on itself`);
      return fxEval(p.e, p.u, fxLook(fxParamHome(p, groupId), [...stack, p]));
    },
    ref(id, f) {
      const it = byId(id); if (!it) throw new Error(`there is no item ${id}`);
      if (f === 'l' || f === 't' || f === 'w') return it[f];
      const b = bounds(it), m = /^([xyz])([01]?)$/.exec(f); if (!m) throw new Error(`#${id}.${f} isn't a size or position`);
      const a = 'xyz'.indexOf(m[1]); return m[2] === '1' ? b.max[a] : b.min[a];
    },
  };
}
const fxParamHome = (p, groupId) => { const g = groupId && fxLayer(groupId); return g && g.params && g.params.includes(p) ? groupId : null; };
const fxParamValue = (p, groupId) => fxEval(p.e, p.u, fxLook(groupId, [p]));

// ---------- what changed by hand stops following its formula ----------
function fxSync() {
  const dropped = [], moved = new Map();
  P.items.forEach(it => {
    if (!it.fx || !it.fxv) return;
    if (it.fxv.q && it.q.some((v, i) => Math.abs(v - it.fxv.q[i]) > 1e-6) && FX_POS.some(k => it.fx[k])) { FX_POS.forEach(k => { delete it.fx[k]; }); dropped.push(it); }
    FX_SIZE.forEach(k => { if (it.fx[k] && it.fxv[k] != null && Math.abs(it[k] - it.fxv[k]) > .01) { delete it.fx[k]; dropped.push(it); } });
    const b = bounds(it);
    FX_POS.forEach((k, a) => {
      if (!it.fx[k] || it.fxv[k] == null) return;
      const d = b.min[a] - it.fxv[k]; if (Math.abs(d) <= .01) return;
      const key = (it.group || 0) + ':' + a, e = moved.get(key) || { it: [], d: [] }; e.it.push(it); e.d.push(d); moved.set(key, e);
    });
  });
  moved.forEach((e, key) => {   // a whole layer moved together: its Left, Floor or Back moves with it, and its formulas keep working
    const [gid, a] = key.split(':').map(Number), k = FX_POS[a], g = fxLayer(gid), origin = g && g.params && g.params.find(p => p.name.toLowerCase() === ['left', 'floor', 'back'][a]);
    const all = P.items.filter(i => i.fx && i.fx[k] && (i.group || 0) === gid);
    const same = origin && e.it.length === all.length && e.d.every(d => Math.abs(d - e.d[0]) < .01) && all.every(i => new RegExp(`\\b${origin.name}\\b`, 'i').test(i.fx[k].e));
    if (same) { let was; try { was = fxLenOf(fxParamValue(origin, gid), origin.u); } catch (err) { return; } origin.e = `${r2p(was + e.d[0])}mm`; origin.u = 'mm'; return; }
    e.it.forEach(it => { delete it.fx[k]; dropped.push(it); });
  });
  P.items.forEach(it => { if (it.fx && !Object.keys(it.fx).length) { delete it.fx; delete it.fxv; } });
  return dropped;
}
const r2p = v => Math.round(v * 10000) / 10000;

// ---------- working everything out ----------
function fxSolve() {
  fxIssues = new Map();
  const list = P.items.filter(i => i.fx);
  let moving = true, pass = 0;
  for (; moving && pass < 12; pass++) {
    moving = false;
    list.forEach(it => {
      const look = fxLook(it.group);
      FX_SIZE.forEach(k => {
        const f = it.fx[k]; if (!f) return;
        try {
          let v = fxLenOf(fxEval(f.e, f.u, look), f.u);
          if (v < 1) { fxIssues.set(`${it.id}.${k}`, `${it.name} ${it.id} would be ${fmt(v)}, so it's kept at the smallest size.`); v = 1; }
          if (Math.abs(v - it[k]) > 1e-6) { it[k] = v; moving = true; }
        } catch (e) { fxIssues.set(`${it.id}.${k}`, `${it.name} ${it.id}: ${e.message}.`); }
      });
      FX_POS.forEach((k, a) => {
        const f = it.fx[k]; if (!f) return;
        try {
          const v = fxLenOf(fxEval(f.e, f.u, look), f.u), d = v - bounds(it).min[a];
          if (Math.abs(d) > 1e-6) { it.pos[a] += d; moving = true; }
        } catch (e) { fxIssues.set(`${it.id}.${k}`, `${it.name} ${it.id}: ${e.message}.`); }
      });
    });
  }
  if (moving) list.forEach(it => fxIssues.set(`${it.id}.loop`, `${it.name} ${it.id}: its formulas depend on each other in a circle.`));
  list.forEach(it => {
    const b = bounds(it), v = { q: it.q.slice() };
    FX_SIZE.forEach(k => { if (it.fx[k]) v[k] = it[k]; });
    FX_POS.forEach((k, a) => { if (it.fx[k]) v[k] = b.min[a]; });
    it.fxv = v;
  });
  const params = (arr, gid) => (arr || []).forEach(p => { try { fxParamValue(p, gid); } catch (e) { fxIssues.set(`p:${gid || 0}.${p.name}`, `${p.name}: ${e.message}.`); } });
  params(P.params, null); P.groups.forEach(g => params(g.params, g.id));
}
let fxWarned = 0;
function fxUpdate() {
  if (!fxHasAny()) { fxIssues = new Map(); return; }
  const dropped = fxSync(); fxSolve();
  if (dropped.length && Date.now() - fxWarned > 3000 && typeof toast === 'function') { fxWarned = Date.now(); const names = [...new Set(dropped)]; toast(names.length === 1 ? `${names[0].name} was changed by hand, so that value no longer follows its formula.` : `${names.length} items were changed by hand, so those values no longer follow their formulas.`); }
}

// ---------- typing formulas ----------
function fxCheck(text, groupId) {   // returns an error message, or null when the formula can be used
  try { fxEval(text, unitKey(), fxLook(groupId)); return null; } catch (e) { return e.message; }
}
function fxFromBox(s, groupId) {   // what a box's text means: { formula } or { value }, or { error }
  const t = String(s).trim();
  if (t[0] === '=') { const e = t.slice(1).trim(); if (!e) return { error: 'the formula is empty' }; const bad = fxCheck(e, groupId); return bad ? { error: bad } : { formula: { e, u: unitKey() } }; }
  const v = parseLen(t); if (isFinite(v)) return { value: v };
  if (fxCheck(t, groupId)) return { error: `"${t}" isn't a size` };
  return { value: fxLenOf(fxEval(t, unitKey(), fxLook(groupId)), unitKey()) };   // sums like 800-36 work out once, with no formula kept
}
// a size or position box for an item: a formula stays, a plain value replaces any formula
function fxField(it, key, set, min = -Infinity) {
  return s => {
    const r = fxFromBox(s, it.group);
    if (r.error) { toast(`Can't use that: ${r.error}.`, true); renderSide(); return; }
    if (r.formula) { edit(() => { it.fx = it.fx || {}; it.fx[key] = r.formula; if (it.fxv) delete it.fxv[key]; }); return; }
    if (!(r.value >= min)) { renderSide(); return; }
    edit(() => { if (it.fx) { delete it.fx[key]; if (it.fxv) delete it.fxv[key]; if (!Object.keys(it.fx).length) delete it.fx; } set(r.value); });
  };
}
const fxText = (it, key) => (it.fx && it.fx[key] ? '=' + it.fx[key].e : '');

// ---------- parameters ----------
const fxParams = gid => { if (gid) { const g = fxLayer(gid); return g ? (g.params = g.params || []) : []; } return (P.params = P.params || []); };
function fxSetParam(p, s, gid) {
  const r = fxFromBox(s, gid);
  if (r.error) return r.error;
  if (r.formula) { p.e = r.formula.e; p.u = r.formula.u; if (fxParamHasLoop(p, gid)) return `${p.name} depends on itself`; return null; }
  p.e = `${r2p(r.value)}mm`; p.u = 'mm'; return null;
}
const fxParamHasLoop = (p, gid) => { try { fxParamValue(p, gid); return false; } catch (e) { return /depends on itself/.test(e.message); } };
function fxRenameEverywhere(oldName, newName, gid) {
  const re = new RegExp(`\\b${oldName}\\b(?!\\s*\\()`, 'gi'), swap = o => { if (o) o.e = o.e.replace(re, newName); };
  P.items.forEach(it => { if (it.fx && (!gid || it.group === gid)) Object.values(it.fx).forEach(swap); });
  (gid ? fxParams(gid) : [...fxParams(null), ...P.groups.flatMap(g => g.params || [])]).forEach(swap);
}
function fxAddParam(gid) {
  const list = fxParams(gid); let n = list.length + 1, name = `Size${n}`;
  while (fxFindParam(name, gid)) name = `Size${++n}`;
  list.push({ name, e: `${P.grid * 10}mm`, u: 'mm' });
}
function paramsHtml(gid, title) {
  const list = (gid ? (fxLayer(gid) || {}).params : P.params) || [], key = gid || 0;
  const rows = list.map((p, i) => {
    let shown = ''; try { const r = fxParamValue(p, gid); shown = r.d ? bare(r.v) : String(r2(r.v)); } catch (e) { shown = '?'; }
    const isFormula = !/^-?[\d.]+mm$/.test(p.e), bad = fxIssues.get(`p:${key}.${p.name}`);
    handlers[`prv_${key}_${i}`] = s => {
      const before = { e: p.e, u: p.u };
      edit(() => { const err = fxSetParam(p, s, gid); if (err) { p.e = before.e; p.u = before.u; toast(`Can't use that: ${err}.`, true); } });
    };
    handlers[`prn_${key}_${i}`] = s => {
      const nm = s.trim();
      if (!FX_NAME.test(nm)) { toast('A parameter name starts with a letter and has only letters, numbers and _.', true); renderSide(); return; }
      if (nm.toLowerCase() !== p.name.toLowerCase() && fxFindParam(nm, gid)) { toast(`There is already a parameter called ${nm}.`, true); renderSide(); return; }
      edit(() => { fxRenameEverywhere(p.name, nm, gid); p.name = nm; });
    };
    return `<div class="prm"><input type="text" data-f="prn_${key}_${i}" value="${esc(p.name)}" aria-label="Parameter name"><input type="text" class="${isFormula ? 'hasfx' : ''}" data-f="prv_${key}_${i}" ${isFormula ? `data-fxtext="=${esc(p.e)}" title="=${esc(p.e)}"` : ''} data-len="1" value="${esc(shown)}" aria-label="${esc(p.name)} value"><button class="ic" data-prdel="${key},${i}" title="Delete ${esc(p.name)}" aria-label="Delete ${esc(p.name)}">${ic('x')}</button></div>${bad ? `<p class="fxbad">${esc(bad)}</p>` : ''}`;
  }).join('');
  return sec('params', title, `${rows || '<p class="note" style="margin:0 0 6px">Name a size here, then type it into any box, like =Width-36.</p>'}<div class="rowb" style="margin-top:6px"><button class="btn line" data-pradd="${key}">Add</button></div>`);
}
const fxItemIssues = it => [...fxIssues.entries()].filter(([k]) => k.startsWith(it.id + '.')).map(([, v]) => v);
function fxBindPanel() {
  side.querySelectorAll('[data-pradd]').forEach(b => { addIcon(b, 'plus'); b.onclick = () => edit(() => fxAddParam(+b.dataset.pradd || null)); });
  side.querySelectorAll('[data-prdel]').forEach(b => b.onclick = () => { const [k, i] = b.dataset.prdel.split(',').map(Number); edit(() => { fxParams(k || null).splice(i, 1); }); });
  const go = side.querySelector('#fxMake'); if (go) { addIcon(go, 'sliders-horizontal'); go.onclick = () => edit(fxMakeResizable); }
}

// ---------- making a selection resizable ----------
// Works out how each part should follow Width, Height and Depth from how the parts touch each other,
// with nothing specific to any kind of furniture.
function fxLocalKey(it, a) {   // which of the item's own sizes runs along world axis a
  const m = new THREE.Matrix4().makeRotationFromQuaternion(Q(it)).elements, c = [[m[0], m[1], m[2]], [m[4], m[5], m[6]], [m[8], m[9], m[10]]];
  const i = c.findIndex(v => Math.abs(Math.abs(v[a]) - 1) < 1e-4); return i < 0 ? null : FX_SIZE[i];
}
function fxMakeResizable() {
  const list = selected().filter(i => !isRoomPart(i) && !i.locked); if (!list.length) return false;
  const u = unionBounds(list), ids = new Set(list.map(i => i.id));
  let gid = list[0].group; const onlyThis = gid && list.every(i => i.group === gid) && P.items.every(i => i.group !== gid || ids.has(i.id));
  if (!onlyThis) { const g = { id: nextId(), name: `Resizable ${P.groups.filter(x => /^Resizable/.test(x.name)).length + 1}`, hidden: false, open: false }; const home = levelOfGroup(groupOf(list[0])); if (home) g.level = home.id; P.groups.push(g); gid = g.id; list.forEach(i => { i.group = gid; }); }
  const g = fxLayer(gid), AX = [['Width', 'Left', 'x'], ['Height', 'Floor', 'y'], ['Depth', 'Back', 'z']];
  g.params = g.params || [];
  const setP = (name, mm) => { const p = g.params.find(q => q.name.toLowerCase() === name.toLowerCase()); if (p) { p.e = `${r2p(mm)}mm`; p.u = 'mm'; } else g.params.push({ name, e: `${r2p(mm)}mm`, u: 'mm' }); };
  AX.forEach(([size, origin], a) => { setP(size, u.max[a] - u.min[a]); setP(origin, u.min[a]); });
  const boxes = new Map(list.map(i => [i.id, bounds(i)]));
  const fx = new Map(list.map(i => [i.id, {}]));
  AX.forEach(([Size, Origin, key], a) => {
    const S0 = u.max[a] - u.min[a]; if (S0 < 1) return;
    const NEAR = Math.min(100, S0 * .2), TOUCH = 10, others = [0, 1, 2].filter(x => x !== a);
    const rel = v => v - u.min[a], isRigid = i => i.kind !== 'panel' || fxLocalKey(i, a) === 't' || fxLocalKey(i, a) === null;
    // parts that keep their size this way sit near an end, or at the same fraction of the way across
    const rigid = list.filter(isRigid).map(it => {
      const b = boxes.get(it.id), m0 = rel(b.min[a]), m1 = rel(b.max[a]), size = m1 - m0;
      if (m0 <= NEAR) return { it, b, m0, m1, f: 0, c: m0 };
      if (S0 - m1 <= NEAR) return { it, b, m0, m1, f: 1, c: m0 - S0 };
      return { it, b, m0, m1, f: (m0 + m1) / 2 / S0, c: -size / 2 };
    });
    const emit = (it, f0, c0, f1, c1) => {
      const term = (f, c) => { const w = f === 0 ? '' : f === 1 ? `${Size}` : `${Size}*${Math.round(f * 1e10) / 1e10}`, cc = Math.round(c * 1e6) / 1e6; return [w, cc ? `${cc < 0 ? '-' : '+'} ${Math.abs(cc)}mm` : ''].filter(Boolean).join(' '); };
      const start = term(f0, c0); fx.get(it.id)[key] = { e: `${Origin}${start ? (start[0] === '-' || start[0] === '+' ? ' ' : ' + ') + start : ''}`, u: 'mm' };
      if (f1 == null) return;
      const k = fxLocalKey(it, a), span = term(f1 - f0, c1 - c0);
      if (k && Math.abs(f1 - f0) > 1e-9) fx.get(it.id)[k] = { e: span.replace(/^\+ /, ''), u: 'mm' };
    };
    rigid.forEach(r => emit(r.it, r.f, r.c));
    // parts that stretch this way follow whatever they touch at each end
    list.filter(i => !isRigid(i)).forEach(it => {
      const b = boxes.get(it.id);
      const anchor = v => {
        const e = rel(v); let best = null;
        rigid.forEach(r => {
          if (r.it === it || !others.every(o => Math.min(b.max[o], r.b.max[o]) - Math.max(b.min[o], r.b.min[o]) > -TOUCH)) return;
          [[r.m0, r.c], [r.m1, r.c + (r.m1 - r.m0)]].forEach(([face, cf]) => { const gap = Math.abs(face - e); if (gap <= TOUCH && (!best || gap < best.gap)) best = { gap, f: r.f, c: cf + (e - face) }; });
        });
        if (best) return best;
        if (e <= NEAR) return { f: 0, c: e };
        if (S0 - e <= NEAR) return { f: 1, c: e - S0 };
        return { f: e / S0, c: 0 };
      };
      const lo = anchor(b.min[a]), hi = anchor(b.max[a]);
      emit(it, lo.f, lo.c, hi.f, hi.c);
    });
  });
  list.forEach(it => { it.fx = fx.get(it.id); delete it.fxv; });
  toast('Made resizable. Change Width, Height or Depth in Properties.');
  return true;
}

// ---------- copies keep working ----------
// A whole resizable layer copied gets its own layer and parameters, so each copy can have its own size. Anything less stays in its layer.
function fxDetachCopies(pairs) {   // [[original, copy]]
  const byGroup = new Map();
  pairs.forEach(pr => { const gid = pr[0].group; if (gid) { const l = byGroup.get(gid) || []; l.push(pr); byGroup.set(gid, l); } });
  byGroup.forEach((prs, gid) => {
    const g = fxLayer(gid); if (!g || !g.params || !g.params.length) return;
    const ids = new Set(prs.map(pr => pr[0].id)); if (!P.items.every(i => i.group !== gid || i === prs.find(pr => pr[1] === i)?.[1] || ids.has(i.id))) return;
    const ng = { ...JSON.parse(JSON.stringify(g)), id: nextId(), name: `${g.name} copy` }; P.groups.push(ng);
    const map = new Map(prs.map(pr => [pr[0].id, pr[1].id])), d = prs[0][1].pos.map((v, a) => v - prs[0][0].pos[a]);
    ['left', 'floor', 'back'].forEach((n, a) => { const p = ng.params.find(q => q.name.toLowerCase() === n); if (p) { try { p.e = `${r2p(fxLenOf(fxParamValue(p, ng.id), p.u) + d[a])}mm`; p.u = 'mm'; } catch (e) {} } });
    prs.forEach(pr => { const c = pr[1]; c.group = ng.id; delete c.fxv; if (c.fx) Object.values(c.fx).forEach(f => { f.e = f.e.replace(/#(\d+)/g, (m, n) => (map.has(+n) ? '#' + map.get(+n) : m)); }); });
  });
}

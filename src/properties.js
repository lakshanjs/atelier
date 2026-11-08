// ---------- properties ----------
const side = document.getElementById('side');
let handlers = {}, pendingFocus = null; const openSec = { params: true, size: true, pos: true, board: true, edge: true, angle: false, shape: false, fit: false, copies: false };
const field = (label, val, id, type) => `<label class="field">${label}<input type="text" data-f="${id}" value="${esc(val)}"></label>`;
const lenF = (label, mm, id) => `<label class="field">${label}<input type="text" data-f="${id}" data-len="1" value="${esc(bare(mm))}"></label>`;
const triF = cells => `<div class="tri">${cells.map(([n, mm, id, fx]) => `<label>${n}<input type="text" class="${fx ? 'hasfx' : ''}" data-f="${id}" data-len="1" ${fx ? `data-fxtext="${esc(fx)}" title="${esc(fx)}"` : ''} value="${mm == null ? '' : esc(bare(mm))}"${mm == null ? ' placeholder="Mixed" title="They differ. Type a size to give them all the same."' : ''}></label>`).join('')}</div>`;   // null: the selected ones differ
const sec = (key, title, body) => `<details class="sec" data-sec="${key}" ${openSec[key] ? 'open' : ''}><summary>${title}</summary>${body}</details>`;
function bindFields() {
  side.querySelectorAll('details[data-sec]').forEach(d => d.addEventListener('toggle', () => { openSec[d.dataset.sec] = d.open; }));
  side.querySelectorAll('[data-f]').forEach(inp => {
    const commit = () => { if (inp.value === inp.defaultValue) return false; inp.defaultValue = inp.value; const f = handlers[inp.dataset.f]; if (f) f(inp.value); return true; };   // runs once per edit, however it's confirmed
    inp.addEventListener('change', commit);
    inp.addEventListener('focus', () => { if (inp.dataset.fxtext && inp.value !== inp.dataset.fxtext) { inp.dataset.plain = inp.value; inp.value = inp.defaultValue = inp.dataset.fxtext; } inp.select(); });   // focus also fires on coming back to the window
    inp.addEventListener('blur', () => { if (inp.dataset.fxtext && inp.value === inp.dataset.fxtext) inp.value = inp.defaultValue = inp.dataset.plain; });
    inp.addEventListener('keydown', e => {
      e.stopPropagation();
      const all = () => [...side.querySelectorAll('[data-f]')], at = all().indexOf(inp);
      if (e.key === 'Enter') { e.preventDefault(); pendingFocus = inp.dataset.f; commit(); pendingFocus = null; inp.select(); }
      if (e.key === 'Escape') { inp.value = inp.defaultValue; inp.select(); }   // cancels the typing and stays in the box
      if (e.key === 'Tab') { e.preventDefault(); const next = at + (e.shiftKey ? -1 : 1); pendingFocus = next; commit(); if (pendingFocus != null) { pendingFocus = null; const el = all()[next]; if (el) el.focus(); } }
      if (inp.dataset.len && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault(); const v = parseLen(inp.value); if (!isFinite(v)) return;
        inp.value = bare(v + (e.key === 'ArrowUp' ? 1 : -1) * P.grid * (e.shiftKey ? 10 : 1)); pendingFocus = inp.dataset.f; commit(); pendingFocus = null;
      }
    });
  });
}
const num = (fn, min = -Infinity) => s => { const v = parseLen(s); if (!isFinite(v) || v < min) { renderSide(); return; } fn(v); };
function eulerOf(it) { const e = new THREE.Euler().setFromQuaternion(Q(it), 'YXZ'); return [e.x, e.y, e.z].map(a => Math.round(a * 180 / Math.PI * 10) / 10 + 0); }
function setEuler(it, deg) { const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(deg[0] * Math.PI / 180, deg[1] * Math.PI / 180, deg[2] * Math.PI / 180, 'YXZ')); setQ(it, q); }
function bandOptions(v) { return [['none', 'None'], ['one', 'One long edge'], ['two', 'Both long edges'], ['all', 'All four edges']].map(([k, n]) => `<option value="${k}" ${v === k ? 'selected' : ''}>${n}</option>`).join(''); }
function swatches(cur_) { return `<div class="swatches">${Object.entries(MAT).map(([k, m]) => `<button class="sw" title="${m.name}" aria-label="${m.name}" aria-pressed="${cur_ === k}" data-c="${k}" style="background:${m.f}"></button>`).join('')}</div>`; }
const turnButtons = () => `<div class="rowb"><button class="btn line" data-rot="1" title="Spin (R turns it 90°)">Spin</button><button class="btn line" data-rot="0" title="Tip forward">Tip</button><button class="btn line" data-rot="2" title="Roll">Roll</button></div>`;
const actions = () => `<div class="acts"><button class="btn line" id="dup" title="Duplicate (Ctrl+D)">Duplicate</button><button class="btn line" id="drop" title="Move down until it rests on something">Set down</button><button class="btn bad" id="del" title="Delete (Del)">Delete</button></div>`;
const repeatHtml = () => sec('copies', 'Make copies', `<label class="field">How many<input type="text" id="repN" value="${rep.n}"></label><label class="field">Direction<select id="repAxis">${[[0, 'Across'], [1, 'Up'], [2, 'Deep']].map(([v, n]) => `<option value="${v}" ${rep.axis === v ? 'selected' : ''}>${n}</option>`).join('')}</select></label>${lenF('Distance between', rep.step, 'repStep')}<div class="rowb"><button class="btn line" id="repGo">Make copies</button></div>`);
function renderSide() {
  const list = selected(), keep = side.scrollTop; handlers = {};
  let h = '';
  if (tool === 'measure') {
    h += `<h2>Measure</h2>` + dimListHtml();
  } else if (list.length === 1) {
    const it = list[0], isP = it.kind === 'panel', b = bounds(it), eu = eulerOf(it);
    h += `<div class="ihead"><input class="iname" data-f="name" value="${esc(it.name)}" aria-label="Name">${isP ? `<span title="This number is on the cut list">no. ${it.id}</span>` : ''}</div>`;
    handlers.name = v => edit(() => { it.name = v.trim() || it.name; });
    h += `<div class="irow"><select id="itGroup" aria-label="Layer"><option value="">No layer</option>${P.groups.map(g => `<option value="${g.id}" ${it.group === g.id ? 'selected' : ''}>${esc(layerLabel(g))}</option>`).join('')}</select><button class="ic" id="itEye" title="${it.hidden ? 'Show' : 'Hide'}" aria-label="${it.hidden ? 'Show' : 'Hide'}">${ic(it.hidden ? 'eye-off' : 'eye')}</button><button class="ic" id="itLock" title="${it.locked ? 'Unlock' : 'Lock'}" aria-label="${it.locked ? 'Unlock' : 'Lock'}">${ic(it.locked ? 'lock' : 'lock-open')}</button></div>`;
    if (it.locked) h += `<p class="lock-note">Can't move, turn, resize or be deleted. Clicks pass through it, so select it from Layers.</p>`;
    if (isP) {
      const thick = (() => { const opts = BOARDS[it.mat].thick, known = opts.some(o => Math.abs(o[0] - it.t) < .01); return (known ? '' : `<option value="${it.t}" selected>${esc(bare(it.t))}${unitMark()}</option>`) + opts.map(([v, n]) => `<option value="${v}" ${Math.abs(v - it.t) < .01 ? 'selected' : ''}>${n}</option>`).join(''); })();
      h += sec('board', 'Board', `<label class="field">Type<select id="itMat">${Object.entries(BOARDS).map(([k, m]) => `<option value="${k}" ${it.mat === k ? 'selected' : ''}>${m.name}</option>`).join('')}</select></label><label class="field">Thickness<select id="itThick">${thick}</select></label><label class="field">Grain<select id="grain">${[['any', "Doesn't matter"], ['length', 'Along the length'], ['width', 'Across the width']].map(([v, n]) => `<option value="${v}" ${(it.grain || 'any') === v ? 'selected' : ''}>${n}</option>`).join('')}</select></label>${swatches(panelColor(it))}`);
    }
    h += sec('size', 'Size', triF((isP ? [['Length', 'l'], ['Width', 'w'], ['Thick', 't']] : [['Width', 'l'], ['Height', 't'], ['Depth', 'w']]).map(([n, k]) => { handlers['s' + k] = fxField(it, k, v => setSize(it, k, v), 1); return [n, it[k], 's' + k, fxText(it, k)]; })));
    h += sec('pos', 'Position', triF([['From left', 0], ['From floor', 1], ['From back', 2]].map(([n, a]) => { handlers['p' + a] = fxField(it, FX_POS[a], v => { it.pos[a] += v - bounds(it).min[a]; }); return [n, b.min[a], 'p' + a, fxText(it, FX_POS[a])]; })));
    fxItemIssues(it).forEach(t => { h += `<p class="fxbad">${esc(t)}</p>`; });
    if (it.group && (groupOf(it) || {}).params) h += paramsHtml(it.group, `Parameters: ${esc(groupOf(it).name)}`);
    h += moveByHtml();
    h += sec('angle', 'Angle', turnButtons() + angleToolsHtml(it) + [['Spin', 1], ['Tip', 0], ['Roll', 2]].map(([n, a]) => `<div class="angle"><span>${n}</span><input type="range" min="-180" max="180" step="1" value="${eu[a]}" data-ang="${a}" aria-label="${n}"><input type="text" value="${eu[a]}" data-angt="${a}" aria-label="${n} in degrees"></div>`).join(''));
    if (isP) {
      h += sec('edge', `Edge banding: ${esc(bandLabel(it))}`, `${panelPreview(it, !it.locked)}<p class="note" style="margin:2px 0 0">Click an edge to band it. ${bare(bandLen(it))}${unitMark()} in total.</p>`);
      const sp = shapeOf(it);
      let sb = '';
      sp.c.forEach((c, i) => {
        sb += `<div class="cornr"><label class="field">Corner ${i + 1}<select data-ck="${i}">${CORNER_KINDS.map(([v, n]) => `<option value="${v}" ${c.k === v ? 'selected' : ''}>${n}</option>`).join('')}</select></label>`;
        if (c.k === 'round') { sb += lenF('Radius', c.a, `c${i}a`); handlers[`c${i}a`] = num(v => edit(() => { c.a = v; }), 1); }
        if (c.k === 'chamfer' || c.k === 'notch') { sb += lenF('Along width', c.a, `c${i}a`) + lenF('Along length', c.b, `c${i}b`); handlers[`c${i}a`] = num(v => edit(() => { c.a = v; }), 1); handlers[`c${i}b`] = num(v => edit(() => { c.b = v; }), 1); }
        sb += `</div>`;
      });
      sp.holes.forEach((o, i) => {
        sb += `<div class="cornr"><div class="ghead2"><b>${o.k === 'circle' ? 'Round hole' : 'Cut-out'} ${i + 1}</b><button class="ic" data-hdel="${i}" aria-label="Delete this cut-out" title="Delete">${ic('x')}</button></div>`;
        sb += lenF('From left', o.x + it.l / 2, `hx${i}`) + lenF('From back edge', o.z + it.w / 2, `hz${i}`) + lenF(o.k === 'circle' ? 'Diameter' : 'Size along length', o.w, `hw${i}`);
        handlers[`hx${i}`] = num(v => edit(() => { o.x = v - it.l / 2; })); handlers[`hz${i}`] = num(v => edit(() => { o.z = v - it.w / 2; })); handlers[`hw${i}`] = num(v => edit(() => { o.w = v; }), 1);
        if (o.k !== 'circle') { sb += lenF('Size along width', o.h, `hh${i}`); handlers[`hh${i}`] = num(v => edit(() => { o.h = v; }), 1); }
        sb += `</div>`;
      });
      sb += `<div class="rowb" style="margin-top:6px"><button class="btn line" data-hadd="rect">Add cut-out</button><button class="btn line" data-hadd="circle">Add round hole</button></div>`;
      h += sec('shape', `Shape${hasShape(it) ? ': shaped' : ''}`, sb);
      const role = roleOf(it);
      let fb = `<label class="field">This panel is<select id="role">${[['panel', 'A plain panel'], ['shelf', 'A shelf'], ['door', 'A door'], ['drawer', 'A drawer front']].map(([v, n]) => `<option value="${v}" ${role === v ? 'selected' : ''}>${n}</option>`).join('')}</select></label>`;
      if (role === 'door') fb += `<label class="field">Hinges<input type="text" id="hingeN" value="${it.hinges ?? defaultHinges(it)}"></label><label class="field">Hinge type<select id="hwHinge">${hwOptions('hinge', it.hingeType, true)}</select></label><label class="field">Hangs from<select id="hingeSide">${[['', 'Work it out'], ['low', 'Left or bottom'], ['high', 'Right or top']].map(([v, n]) => `<option value="${v}" ${(it.hingeSide || '') === v ? 'selected' : ''}>${n}</option>`).join('')}</select></label>`;
      if (role === 'drawer') { fb += `<label class="field">Slide type<select id="hwSlide">${hwOptions('slide', it.slideType, true)}</select></label>` + lenF('Slide length', slideLength(it), 'slideL'); handlers.slideL = num(v => edit(() => { it.slide = v; }), 50); }
      if (role === 'shelf') fb += `<label class="check"><input type="checkbox" id="adjust" ${it.adjustable ? 'checked' : ''}>Adjustable, on 4 shelf pins</label>`;
      if (role === 'door' || role === 'drawer') fb += hwEditBtn();
      h += sec('fit', 'Fittings', fb);
      h += machSectionHtml(it);
    }
    h += repeatHtml() + actions();
  } else if (list.length > 1) {
    const panels = list.filter(i => i.kind === 'panel' && !i.locked), u = unionBounds(list), allLocked = list.every(i => i.locked);
    h += `<h2>${list.length} selected</h2>`;
    if (list.length > 1) {
      const ab = (a, m, n, icon) => `<button class="ic big" data-al="${a},${m}" title="${n}" aria-label="${n}">${ic(icon)}</button>`;
      h += `<h3>Line up</h3><div class="iconrow">${ab(0, 'min', 'Left edges', 'align-start-vertical')}${ab(0, 'mid', 'Centres, left to right', 'align-center-vertical')}${ab(0, 'max', 'Right edges', 'align-end-vertical')}${ab(1, 'max', 'Tops', 'align-start-horizontal')}${ab(1, 'mid', 'Middles', 'align-center-horizontal')}${ab(1, 'min', 'Bottoms', 'align-end-horizontal')}</div>`;
      h += `<div class="rowb"><button class="btn line" data-al="2,min">Backs</button><button class="btn line" data-al="2,max">Fronts</button></div>`;
      h += `<h3>Space evenly</h3><div class="rowb"><button class="btn line" data-sp="0" ${list.length < 3 ? 'disabled' : ''}>Across</button><button class="btn line" data-sp="1" ${list.length < 3 ? 'disabled' : ''}>Up</button><button class="btn line" data-sp="2" ${list.length < 3 ? 'disabled' : ''}>Deep</button></div>`;
    }
    h += `<p class="note">${bare(u.max[0] - u.min[0])} wide, ${bare(u.max[1] - u.min[1])} high, ${bare(u.max[2] - u.min[2])} deep</p>`;
    { const free = list.filter(i => !i.locked), names = free.every(i => i.kind === 'panel') ? [['Length', 'l'], ['Width', 'w'], ['Thick', 't']] : free.every(i => i.kind !== 'panel') ? [['Width', 'l'], ['Height', 't'], ['Depth', 'w']] : [['Length', 'l'], ['Width', 'w'], ['Thick', 't']];
      if (free.length) h += sec('size', 'Size', triF(names.map(([n, k]) => { const same = free.every(i => Math.abs(i[k] - free[0][k]) < .01); handlers['ms' + k] = num(v => edit(() => { free.forEach(i => setSize(i, k, v)); }), 1); return [n, same ? free[0][k] : null, 'ms' + k]; })) + (free.length < list.length ? '<p class="note">Locked ones keep their size.</p>' : '')); }
    h += sec('pos', 'Position', triF([['From left', 0], ['From floor', 1], ['From back', 2]].map(([n, a]) => { handlers['p' + a] = num(v => edit(() => { const mv = movable(); if (!mv.length) return; const d = v - unionBounds(mv).min[a]; mv.forEach(i => { i.pos[a] += d; }); })); return [n, u.min[a], 'p' + a]; })));
    h += moveByHtml();
    h += sec('angle', 'Angle', turnButtons() + angleToolsHtml(null));
    if (panels.length) {
      const same = panels.every(p => Math.abs(p.t - panels[0].t) < .01);
      h += sec('board', 'Board', `<label class="field">Type<select id="multiMat"><option value="">Mixed</option>${Object.entries(BOARDS).map(([k, m]) => `<option value="${k}" ${panels.every(p => p.mat === k) ? 'selected' : ''}>${m.name}</option>`).join('')}</select></label>` + lenF('Thickness', same ? panels[0].t : 0, 'thk'));
      handlers.thk = num(v => edit(() => { panels.forEach(p => { p.t = v; }); }), 1);
    }
    h += `<div class="rowb" style="margin-top:8px"><button class="btn line" id="grp" title="Make a layer (Ctrl+G)">Make a layer</button>${list.some(i => i.group) ? '<button class="btn line" id="ungrp" title="Take out of layer (Ctrl+Shift+G)">Take out</button>' : ''}<button class="ic" id="eyeAll" title="Hide all" aria-label="Hide all">${ic('eye')}</button><button class="ic" id="lockAll" title="${allLocked ? 'Unlock all' : 'Lock all'}" aria-label="${allLocked ? 'Unlock all' : 'Lock all'}">${ic(allLocked ? 'lock' : 'lock-open')}</button></div>`;
    if (list.some(i => i.locked)) h += `<p class="note">Locked items in this selection stay where they are.</p>`;
    { const gs = [...new Set(list.map(i => i.group))], g = gs.length === 1 && gs[0] ? groupOf(list[0]) : null; if (g && g.params && g.params.length) h += paramsHtml(g.id, `Parameters: ${esc(g.name)}`); else h += `<div class="rowb" style="margin-top:8px"><button class="btn line" id="fxMake" title="Adds Width, Height and Depth, and works out how each part follows them">Make resizable</button></div>`; }
    h += repeatHtml() + actions();
  } else {
    h += `<p class="note" style="margin-top:0">Click something to change it. These settings are for the whole project.</p>`;
    h += dimListHtml();
    const used = [...new Set(panelsOnly().map(p => p.mat))];
    let bb = `<label class="field">Currency<input type="text" id="curr" value="${esc(P.currency || 'Rs')}"></label>`;
    if (!used.length) bb += `<p class="note">Add a board and its sheet size and price appear here.</p>`;
    used.forEach(m => {
      const st = stockOf(m);
      bb += `<div class="cornr"><b>${BOARDS[m].name}</b>` + lenF('Sheet length', st.sl, `sl_${m}`) + lenF('Sheet width', st.sw, `sw_${m}`);
      handlers[`sl_${m}`] = num(v => edit(() => { st.sl = v; }), 1); handlers[`sw_${m}`] = num(v => edit(() => { st.sw = v; }), 1);
      [...new Set(panelsOnly().filter(p => p.mat === m).map(p => r2(p.t)))].sort((a, c) => c - a).forEach(th => {
        const key = `pr_${m}_${th}`;
        bb += `<label class="field">${esc(bare(th))}${unitMark()} sheet price<input type="text" data-f="${key}" value="${priceOf(m, th) || ''}" placeholder="Not set"></label>`;
        handlers[key] = v => { const n = parseFloat(String(v).replace(/,/g, '')); edit(() => { P.prices = P.prices || {}; if (n > 0) P.prices[m + '|' + th] = n; else delete P.prices[m + '|' + th]; }); };
      });
      bb += `</div>`;
    });
    bb += `<label class="field">Banding, per metre<input type="text" data-f="bandP" value="${P.bandPrice || ''}" placeholder="Not set"></label>`;
    handlers.bandP = v => { const n = parseFloat(String(v).replace(/,/g, '')); edit(() => { P.bandPrice = n > 0 ? n : 0; }); };
    h += guidesHtml();
    h += paramsHtml(null, 'Project parameters');
    P.groups.filter(g => g.params && g.params.length).forEach(g => { h += paramsHtml(g.id, `Parameters: ${esc(g.name)}`); });
    h += sec('board', 'Boards and prices', bb);
    let fb = `<label class="field">Panels join with<select id="jointSel">${Object.entries(JOINTS).map(([k, n]) => `<option value="${k}" ${(P.joint || 'confirmat') === k ? 'selected' : ''}>${n}</option>`).join('')}</select></label>`;
    fb += `<label class="field">Hinges<select id="hwDefHinge">${hwOptions('hinge', hwDefault('hinge').id)}</select></label><label class="field">Drawer slides<select id="hwDefSlide">${hwOptions('slide', hwDefault('slide').id)}</select></label>${hwEditBtn()}`;
    hardwareLines().forEach(([label, n], i) => {
      fb += `<label class="field">${esc(label)} (${n}), each<input type="text" data-f="hw${i}" value="${hwPrice(label) || ''}" placeholder="Not set"></label>`;
      handlers[`hw${i}`] = v => { const c = parseFloat(String(v).replace(/,/g, '')); edit(() => { P.hwPrices = P.hwPrices || {}; if (c > 0) P.hwPrices[label] = c; else delete P.hwPrices[label]; }); };
    });
    h += sec('fit', 'Fittings', fb);
    h += machSettingsHtml() + cncSettingsHtml();
  }
  if (tool !== 'measure' && list.length) h += dimListHtml(true);
  side.innerHTML = h; side.scrollTop = keep;
  bindFields(); fxBindPanel(); hwBindPanel(); precBindPanel(list.length === 1 ? list[0] : null);
  if (pendingFocus != null) {   // editing redraws this panel: stay in the same box, or go on to the next one
    const all = [...side.querySelectorAll('[data-f]')], el = typeof pendingFocus === 'number' ? all[pendingFocus] : side.querySelector(`[data-f="${pendingFocus}"]`);
    pendingFocus = null; if (el) { el.focus(); el.select(); }
  }
  const q = id => side.querySelector('#' + id);
  side.querySelectorAll('[data-rot]').forEach(b => b.onclick = () => { const a = +b.dataset.rot; edit(() => rotateSel(AXES[a][0], precTurnBy)); });
  side.querySelectorAll('[data-c]').forEach(b => b.onclick = () => edit(() => { const k = b.dataset.c; selected().filter(i => i.kind === 'panel').forEach(p => { p.color = k; }); }));
  side.querySelectorAll('[data-al]').forEach(b => b.onclick = () => { const [a, m] = b.dataset.al.split(','); edit(() => alignSel(+a, m)); });
  side.querySelectorAll('[data-sp]').forEach(b => b.onclick = () => edit(() => spreadSel(+b.dataset.sp)));
  side.querySelectorAll('[data-dimeye]').forEach(b => b.onclick = () => edit(() => { const d = dimsOf()[+b.dataset.dimeye]; if (d.hidden) delete d.hidden; else d.hidden = true; }));
  side.querySelectorAll('[data-dimdel]').forEach(b => b.onclick = () => edit(() => { dimsOf().splice(+b.dataset.dimdel, 1); }));
  side.querySelectorAll('[data-dimlen]').forEach(b => { b.onkeydown = e => e.stopPropagation(); b.onchange = () => {
    const d = dimsOf()[+b.dataset.dimlen], v = parseLen(b.value); if (!d || !(v > 0)) { render(); return; }
    const a = ptWorld(d.a), e = dimEnd(a, ptWorld(d.b), d.axis), len = dist3(a, e); if (len < .01) { render(); return; }
    const mv = dimMover(d);
    if (mv && mv.both) { toast('Both ends are on the selection, so moving it can\'t change this length.', true); render(); return; }
    if (mv) {
      if (byId(mv.id).locked) { toast(`${byId(mv.id).name} is locked. Unlock it to move it.`, true); render(); return; }
      const k = (v - len) * (mv.end === 'b' ? 1 : -1), delta = a.map((c, i) => (e[i] - c) / len * k);
      edit(() => { movable().forEach(it => { it.pos = it.pos.map((c, i) => c + delta[i]); }); });   // the whole selection moves together and the dimension stays attached
      return;
    }
    edit(() => { d.b = { w: a.map((c, i) => c + (e[i] - c) / len * v) }; });   // the far end stops following its panel: the length is now what was typed
  }; });
  side.querySelectorAll('[data-dimaxis]').forEach(b => { b.onkeydown = e => e.stopPropagation(); b.onchange = () => {
    const d = dimsOf()[+b.dataset.dimaxis]; if (!d) return;
    if (b.value === '') { edit(() => { delete d.axis; }); return; }
    const k = +b.value; if (Math.abs(ptWorld(d.a)[k] - ptWorld(d.b)[k]) < .5) { toast(`These two points are level along ${AXN[k]}, so there is nothing to measure that way.`, true); render(); return; }
    edit(() => { d.axis = k; });
  }; });
  if (q('curr')) { q('curr').onkeydown = e => e.stopPropagation(); q('curr').onchange = e => edit(() => { P.currency = e.target.value.trim().slice(0, 6) || 'Rs'; }); }
  if (q('cncClimb')) q('cncClimb').onchange = e => edit(() => { (P.cncTool = P.cncTool || {}).climb = e.target.checked; });
  if (q('jointSel')) q('jointSel').onchange = e => edit(() => { P.joint = e.target.value; });
  if (q('dimAll')) q('dimAll').onclick = () => edit(() => { P.dims = []; });
  if (q('dimVis')) q('dimVis').onclick = () => { P.hideDims = !P.hideDims; persist(); render(); };
  if (q('repAxis')) q('repAxis').onchange = e => { rep.axis = +e.target.value; };
  if (q('repN')) { q('repN').onchange = e => { const v = Math.round(parseFloat(e.target.value)); if (v >= 1 && v <= 100) rep.n = v; else e.target.value = rep.n; }; q('repN').onkeydown = e => e.stopPropagation(); }
  if (q('repGo')) q('repGo').onclick = () => edit(repeatSel);
  handlers.repStep = num(v => { rep.step = v; });
  addIcon(q('repGo'), 'repeat');
  if (q('multiMat')) q('multiMat').onchange = e => { const m = e.target.value; if (m) edit(() => selected().filter(i => i.kind === 'panel').forEach(p => setBoard(p, m))); };
  if (list.length === 1) {
    const it = list[0];
    if (q('itGroup')) q('itGroup').onchange = e => edit(() => { const v = +e.target.value; if (v) it.group = v; else delete it.group; });
    if (q('itLock')) q('itLock').onclick = () => edit(() => { if (it.locked) delete it.locked; else it.locked = true; });
    if (q('itEye')) q('itEye').onclick = () => edit(() => { if (it.hidden) delete it.hidden; else it.hidden = true; sel = sel.filter(i => !isHidden(byId(i))); });
    if (q('itMat')) q('itMat').onchange = e => edit(() => setBoard(it, e.target.value));
    if (q('itThick')) q('itThick').onchange = e => edit(() => { it.t = +e.target.value; lastBoard = { mat: it.mat, t: it.t }; });
    side.querySelectorAll('[data-ang]').forEach(r => {
      let started = false;
      r.addEventListener('input', () => {
        if (!started) { pushUndo(); started = true; }
        const a = +r.dataset.ang, e = eulerOf(it); e[a] = +r.value; setEuler(it, e);
        side.querySelector(`[data-angt="${a}"]`).value = r.value; renderStatus(); dirty = true;
      });
      r.addEventListener('change', () => { started = false; persist(); render(); });
    });
    side.querySelectorAll('[data-angt]').forEach(i => {
      i.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') i.blur(); });
      i.addEventListener('change', () => { const v = parseFloat(i.value); if (!isFinite(v)) { renderSide(); return; } const a = +i.dataset.angt; edit(() => { const e = eulerOf(it); e[a] = v; setEuler(it, e); }); });
    });
    side.querySelectorAll('[data-edge]').forEach(l => l.onclick = () => edit(() => { const e = edgesOf(it); e[l.dataset.edge] = !e[l.dataset.edge]; }));
    if (q('grain')) q('grain').onchange = e => edit(() => { it.grain = e.target.value; });
    side.querySelectorAll('[data-ck]').forEach(c => c.onchange = () => edit(() => { const k = shapeOf(it).c[+c.dataset.ck]; k.k = c.value; }));
    side.querySelectorAll('[data-hadd]').forEach(b => b.onclick = () => edit(() => { shapeOf(it).holes.push({ k: b.dataset.hadd, x: 0, z: 0, w: Math.min(100, it.l / 3), h: Math.min(60, it.w / 3) }); }));
    side.querySelectorAll('[data-hdel]').forEach(b => b.onclick = () => edit(() => { shapeOf(it).holes.splice(+b.dataset.hdel, 1); }));
    if (q('role')) q('role').onchange = e => edit(() => { it.role = e.target.value; });
    if (q('hingeN')) { q('hingeN').onkeydown = e => e.stopPropagation(); q('hingeN').onchange = e => { const v = parseInt(e.target.value, 10); if (v >= 0 && v <= 12) edit(() => { it.hinges = v; }); else renderSide(); }; }
    if (q('hingeSide')) q('hingeSide').onchange = e => edit(() => { if (e.target.value) it.hingeSide = e.target.value; else delete it.hingeSide; });
    if (it.kind === 'panel') machBind(it);
    if (q('adjust')) q('adjust').onchange = e => edit(() => { it.adjustable = e.target.checked; });
  }
  if (q('dup')) q('dup').onclick = () => edit(duplicateSel);
  if (q('drop')) q('drop').onclick = () => edit(dropDown);
  if (q('del')) q('del').onclick = () => edit(removeSel);
  if (q('grp')) q('grp').onclick = groupSelection;
  if (q('ungrp')) q('ungrp').onclick = ungroupSelection;
  if (q('lockAll')) q('lockAll').onclick = () => edit(() => { const on = !selected().every(i => i.locked); selected().forEach(i => { if (on) i.locked = true; else delete i.locked; }); });
  if (q('eyeAll')) q('eyeAll').onclick = () => edit(() => { selected().forEach(i => { i.hidden = true; }); sel = []; });
  if (list.length === 1 && list[0].locked) side.querySelectorAll('[data-f^="s"],[data-f^="p"],[data-ang],[data-angt],[data-rot],#drop,#del,#itMat,#itThick,#grain,[data-ck],[data-hadd],[data-hdel],#role,#hingeN,#adjust,[data-f^="c"],[data-f^="h"]').forEach(el => { el.disabled = true; });
  [['dup', 'copy'], ['drop', 'arrow-down-to-line'], ['del', 'trash-2'], ['grp', 'group'], ['ungrp', 'ungroup']].forEach(([id, n]) => addIcon(q(id), n));
  side.querySelectorAll('[data-rot]').forEach(b => addIcon(b, 'rotate-cw'));
  renderGroups();
}
// a different board type keeps the thickness when that type comes in it, otherwise takes its first thickness
function setBoard(p, mat) {
  p.mat = mat; delete p.color;
  if (!BOARDS[mat].thick.some(o => Math.abs(o[0] - p.t) < .01)) p.t = BOARDS[mat].thick[0][0];
  lastBoard = { mat, t: p.t };
}

// ---------- groups ----------
const EYE = ic('eye'), EYEOFF = ic('eye-off'), CROSS = ic('x'), LOCK = ic('lock'), UNLOCK = ic('lock-open');
const ARROW = open => ic(open ? 'chevron-down' : 'chevron-right');
let renaming = null;
let renamingLevel = null;
let layerFind = '', layerLast = null;   // what the layers are filtered by, and the layer clicked last, for Shift
const layerMatch = name => !layerFind || String(name).toLowerCase().includes(layerFind.toLowerCase());
function renderGroups() {
  const box = document.getElementById('groups'), s = new Set(sel), keep = box.scrollTop, finding = document.activeElement && document.activeElement.id === 'gFind', at = finding ? document.activeElement.selectionStart : 0;
  const itemRow = it => `<div class="grow-row sub ${s.has(it.id) ? 'on' : ''} ${it.hidden ? 'is-hidden' : ''}"><button class="ic" data-ieye="${it.id}" aria-label="${it.hidden ? 'Show' : 'Hide'} ${esc(it.name)}">${it.hidden ? EYEOFF : EYE}</button><button class="nm" data-isel="${it.id}">${esc(it.name)}${it.kind === 'panel' ? ' ' + it.id : ''}</button><button class="ic ${it.locked ? 'on' : ''}" data-ilock="${it.id}" aria-label="${it.locked ? 'Unlock' : 'Lock'} ${esc(it.name)}" title="${it.locked ? 'Unlock' : 'Lock'}">${it.locked ? LOCK : UNLOCK}</button></div>`;
  const row = (g, list) => {
    const hidden = g ? g.hidden : P.looseHidden, open = g ? g.open : P.looseOpen, key = g ? g.id : 0, on = list.length && list.every(i => s.has(i.id)), allLocked = list.length && list.every(i => i.locked);
    const name = renaming === key ? `<input data-gname="${key}" value="${esc(g.name)}" aria-label="Layer name">` : `<button class="nm" data-gsel="${key}" title="Click to select all. Double-click to rename.">${g ? esc(g.name) : 'No layer'}</button>`;
    return `<div class="grow-row ${on ? 'on' : ''} ${hidden ? 'is-hidden' : ''}"><button class="ic" data-gopen="${key}" aria-label="${open ? 'Collapse' : 'Expand'}">${ARROW(open)}</button><button class="ic" data-geye="${key}" aria-label="${hidden ? 'Show' : 'Hide'} layer">${hidden ? EYEOFF : EYE}</button>${name}<span class="ct">${list.length}</span><button class="ic ${allLocked ? 'on' : ''}" data-glock="${key}" aria-label="${allLocked ? 'Unlock' : 'Lock'} all" title="${allLocked ? 'Unlock all' : 'Lock all'}">${allLocked ? LOCK : UNLOCK}</button>${g && (P.levels || []).length ? `<select class="lvlmove" data-gmove="${key}" title="Move to a level" aria-label="Move ${esc(g.name)} to a level"><option value="">No level</option>${P.levels.map(l => `<option value="${l.id}" ${g.level === l.id ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select>` : ''}${g ? `<button class="ic" data-gdel="${key}" aria-label="Remove layer, keep its items" title="Remove layer, keep its items">${CROSS}</button>` : ''}</div>` + (open ? list.map(itemRow).join('') : '');
  };
  const loose = P.items.filter(i => !i.group || !groupOf(i));
  const shownGroups = gs => gs.filter(g => layerMatch(g.name)), anyShown = layerFind && !P.groups.some(g => layerMatch(g.name)) && !(P.levels || []).some(l => layerMatch(l.name));
  box.innerHTML = `<div class="ghead"><h2>Layers</h2><span class="gbtns"><button class="btn line" id="lNew" title="Add an empty level">New level</button><button class="btn line" id="gNew" ${sel.length ? '' : 'disabled'} title="Make a layer from what's selected">New layer</button></span></div><label class="gfind">${ic('search')}<input id="gFind" type="search" placeholder="Find a layer" value="${esc(layerFind)}" aria-label="Find a layer by name"></label>${anyShown ? '<p class="note" style="margin:6px 2px">No layer has that in its name.</p>' : ''}`
    + (P.levels || []).filter(l => layerMatch(l.name) || shownGroups(P.groups.filter(g => g.level === l.id)).length).map(l => {
      const gs = layerMatch(l.name) ? P.groups.filter(g => g.level === l.id) : shownGroups(P.groups.filter(g => g.level === l.id)), ids = new Set(gs.map(g => g.id)), list = P.items.filter(i => ids.has(i.group)), locked = list.length && list.every(i => i.locked), only = P.levels.every(x => x === l ? !x.hidden : x.hidden);
      const name = renamingLevel === l.id ? `<input data-lname="${l.id}" value="${esc(l.name)}" aria-label="Level name">` : `<button class="nm" data-lsel="${l.id}" title="Click to select all. Double-click to rename.">${esc(l.name)}</button>`;
      return `<div class="grow-row lvl ${l.hidden ? 'is-hidden' : ''}"><button class="ic" data-lopen="${l.id}" aria-label="${l.open ? 'Collapse' : 'Expand'}">${ARROW(l.open)}</button><button class="ic" data-leye="${l.id}" aria-label="${l.hidden ? 'Show' : 'Hide'} level">${l.hidden ? EYEOFF : EYE}</button>${name}<span class="ct">${list.length}</span><button class="only ${only ? 'on' : ''}" data-lonly="${l.id}" title="${only ? 'Show all levels' : 'Show only this level'}">${only ? 'All' : 'Only'}</button><button class="ic ${locked ? 'on' : ''}" data-llock="${l.id}" aria-label="${locked ? 'Unlock' : 'Lock'} level" title="${locked ? 'Unlock level' : 'Lock level'}">${locked ? LOCK : UNLOCK}</button><button class="ic" data-ldel="${l.id}" aria-label="Remove level, keep its layers" title="Remove level, keep its layers">${CROSS}</button></div>` + (l.open ? `<div class="lvl-kids">${gs.map(g => row(g, P.items.filter(i => i.group === g.id))).join('')}</div>` : '');
    }).join('')
    + shownGroups(P.groups.filter(g => !levelOfGroup(g))).map(g => row(g, P.items.filter(i => i.group === g.id))).join('') + (loose.length && !layerFind ? row(null, loose) : '');
  box.scrollTop = keep;
  const find = box.querySelector('#gFind'); find.oninput = () => { layerFind = find.value; renderGroups(); }; find.onkeydown = e => { e.stopPropagation(); if (e.key === 'Escape') { layerFind = ''; renderGroups(); } };
  if (finding) { find.focus(); try { find.setSelectionRange(at, at); } catch (e) {} }
  addIcon(box.querySelector('#gNew'), 'folder-plus'); addIcon(box.querySelector('#lNew'), 'folder-plus');
  const linp = box.querySelector('[data-lname]');
  if (linp) { linp.focus(); linp.select(); const done = () => { const l = P.levels.find(x => x.id === renamingLevel); renamingLevel = null; if (l && linp.value.trim() && linp.value.trim() !== l.name) edit(() => { l.name = linp.value.trim(); }); else renderGroups(); }; linp.onblur = done; linp.onkeydown = e => { e.stopPropagation(); if (e.key === 'Enter') linp.blur(); if (e.key === 'Escape') { linp.value = ''; linp.blur(); } }; }
  const inp = box.querySelector('[data-gname]');
  if (inp) { inp.focus(); inp.select(); const done = () => { const g = P.groups.find(x => x.id === renaming); renaming = null; if (g && inp.value.trim() && inp.value.trim() !== g.name) edit(() => { g.name = inp.value.trim(); }); else renderGroups(); }; inp.onblur = done; inp.onkeydown = e => { e.stopPropagation(); if (e.key === 'Enter') inp.blur(); if (e.key === 'Escape') { inp.value = ''; inp.blur(); } }; }
}
const box = () => document.getElementById('groups');
document.getElementById('groups').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return; const d = b.dataset;
  if (b.id === 'gNew') { groupSelection(); return; }
  const L = k => (P.levels || []).find(l => l.id === +k), inLevel = k => { const ids = new Set(P.groups.filter(g => g.level === +k).map(g => g.id)); return P.items.filter(i => ids.has(i.group)); }, dropHidden = () => { sel = sel.filter(i => !isHidden(byId(i))); };
  if (b.id === 'lNew') { edit(() => { P.levels = P.levels || []; let n = P.levels.length; const taken = new Set(P.levels.map(l => l.name)); while (taken.has(`Level ${n}`)) n++; P.levels.push({ id: nextId(), name: `Level ${n}`, hidden: false, open: true }); }); return; }
  if (d.ldel != null) { edit(() => { P.groups.forEach(g => { if (g.level === +d.ldel) delete g.level; }); P.levels = P.levels.filter(l => l.id !== +d.ldel); dropHidden(); }); return; }
  if (d.lopen != null) { const l = L(d.lopen); l.open = !l.open; persist(); renderGroups(); return; }
  if (d.leye != null) { edit(() => { const l = L(d.leye); l.hidden = !l.hidden; dropHidden(); }); return; }
  if (d.lonly != null) { edit(() => { const l = L(d.lonly), only = P.levels.every(x => x === l ? !x.hidden : x.hidden); P.levels.forEach(x => { x.hidden = only ? false : x !== l; }); dropHidden(); }); return; }
  if (d.llock != null) { edit(() => { const list = inLevel(d.llock), lock = !list.every(i => i.locked); list.forEach(i => { if (i.type === 'floor') return; if (lock) i.locked = true; else delete i.locked; }); }); return; }
  if (d.lsel != null && e.detail >= 2) { renamingLevel = +d.lsel; renderGroups(); return; }
  if (d.lsel != null) { sel = inLevel(d.lsel).filter(i => !isHidden(i) && !i.locked).map(i => i.id); render(); return; }
  const G = k => P.groups.find(g => g.id === +k);
  const members = k => +k ? P.items.filter(i => i.group === +k) : P.items.filter(i => !i.group || !groupOf(i));
  if (d.gopen != null) { if (+d.gopen) { const g = G(d.gopen); g.open = !g.open; } else P.looseOpen = !P.looseOpen; persist(); renderGroups(); return; }
  if (d.geye != null) { edit(() => { if (+d.geye) { const g = G(d.geye); g.hidden = !g.hidden; } else P.looseHidden = !P.looseHidden; sel = sel.filter(i => !isHidden(byId(i))); }); return; }
  if (d.glock != null) { edit(() => { const l = members(d.glock), lock = !l.every(i => i.locked); l.forEach(i => { if (lock) i.locked = true; else delete i.locked; }); }); return; }
  if (d.ilock != null) { edit(() => { const it = byId(+d.ilock); if (it.locked) delete it.locked; else it.locked = true; }); return; }
  if (d.gdel != null) { edit(() => { members(d.gdel).forEach(i => { delete i.group; }); P.groups = P.groups.filter(g => g.id !== +d.gdel); }); return; }
  if (d.gsel != null && e.detail >= 2 && +d.gsel) { renaming = +d.gsel; renderGroups(); return; }   // the row redraws between clicks, so a double-click is read here
  if (d.gsel != null) {   // Ctrl adds a layer to what's picked, or takes it away; Shift picks every layer from the one clicked last
    const keys = [...box().querySelectorAll('[data-gsel]')].map(x => +x.dataset.gsel), ids = k => members(k).filter(i => !isHidden(i)).map(i => i.id);
    if (e.shiftKey && layerLast != null && keys.includes(layerLast)) { const [a, c] = [keys.indexOf(layerLast), keys.indexOf(+d.gsel)].sort((x, y) => x - y); sel = [...new Set([...(e.ctrlKey || e.metaKey ? sel : []), ...keys.slice(a, c + 1).flatMap(ids)])]; }
    else if (e.ctrlKey || e.metaKey) { const mine = ids(+d.gsel), all = mine.every(i => sel.includes(i)); sel = all ? sel.filter(i => !mine.includes(i)) : [...new Set([...sel, ...mine])]; layerLast = +d.gsel; }
    else { sel = ids(+d.gsel); layerLast = +d.gsel; }
    render(); return;
  }
  if (d.ieye != null) { edit(() => { const it = byId(+d.ieye); it.hidden = !it.hidden; sel = sel.filter(i => !isHidden(byId(i))); }); return; }
  if (d.isel != null) { const it = byId(+d.isel); if (!isHidden(it)) { setTab('props'); sel = e.ctrlKey || e.metaKey ? (sel.includes(it.id) ? sel.filter(i => i !== it.id) : [...sel, it.id]) : e.shiftKey ? [...new Set([...sel, it.id])] : [it.id]; render(); } }
});
document.getElementById('groups').addEventListener('change', e => {
  const m = e.target.closest('[data-gmove]'); if (!m) return;
  edit(() => { const g = P.groups.find(x => x.id === +m.dataset.gmove), l = (P.levels || []).find(x => x.id === +m.value); if (l) { g.level = l.id; l.open = true; } else delete g.level; sel = sel.filter(i => !isHidden(byId(i))); });
});
document.getElementById('groups').addEventListener('dblclick', e => { const b = e.target.closest('[data-gsel]'); if (b && +b.dataset.gsel) { renaming = +b.dataset.gsel; renderGroups(); } });
// right-click on a level, a layer or a part in Layers
document.getElementById('groups').addEventListener('contextmenu', e => {
  const r = e.target.closest('.grow-row'); if (!r) return; e.preventDefault();
  const q = s => r.querySelector(s), row = ctxRow;
  const lv = q('[data-lsel],[data-lname]'), gr = q('[data-gsel],[data-gname]'), itb = q('[data-isel]');
  let h = '';
  if (lv) {
    const id = +(lv.dataset.lsel || lv.dataset.lname), l = (P.levels || []).find(x => x.id === id); if (!l) return;
    const only = P.levels.every(x => x === l ? !x.hidden : x.hidden), ids = new Set(P.groups.filter(g => g.level === id).map(g => g.id)), list = P.items.filter(i => ids.has(i.group)), locked = list.length && list.every(i => i.locked);
    h = row(`lay:lsel:${id}`, 'Select all', 'square-mouse-pointer') + row(`lren:${id}`, 'Rename', 'pencil') + '<hr>'
      + row(`lay:leye:${id}`, l.hidden ? 'Show' : 'Hide', l.hidden ? 'eye' : 'eye-off') + row(`lay:lonly:${id}`, only ? 'Show all levels' : 'Show only this level', 'eye') + row(`lay:llock:${id}`, locked ? 'Unlock' : 'Lock', locked ? 'lock-open' : 'lock')
      + '<hr>' + row(`lay:ldel:${id}`, 'Remove level, keep its layers', 'x');
  } else if (gr) {
    const key = +(gr.dataset.gsel ?? gr.dataset.gname), g = P.groups.find(x => x.id === key);
    if (key && !g) return;
    const members = key ? P.items.filter(i => i.group === key) : P.items.filter(i => !i.group || !groupOf(i)), hidden = g ? g.hidden : P.looseHidden, locked = members.length && members.every(i => i.locked);
    const canMove = key && sel.some(id => byId(id) && byId(id).group !== key);
    h = row(`lay:gsel:${key}`, 'Select all', 'square-mouse-pointer') + (canMove ? row(`mv:${key}`, sel.length === 1 ? 'Move the selected part here' : `Move the ${sel.length} selected here`, 'folder-input') : '') + (key ? row(`ren:${key}`, 'Rename', 'pencil') : '') + '<hr>'
      + row(`lay:geye:${key}`, hidden ? 'Show' : 'Hide', hidden ? 'eye' : 'eye-off') + row(`lay:glock:${key}`, locked ? 'Unlock all' : 'Lock all', locked ? 'lock-open' : 'lock')
      + (key ? '<hr>' + row(`lay:gdel:${key}`, 'Remove layer, keep its parts', 'ungroup') : '');
  } else if (itb) {
    const id = +itb.dataset.isel, it = byId(id); if (!it) return;
    if (!sel.includes(id)) { if (isHidden(it)) return; sel = [id]; render(); }
    const list = selected(), anyLocked = list.some(i => i.locked), gs = new Set(list.map(i => i.group || 0));
    const others = P.groups.filter(g => !(gs.size === 1 && gs.has(g.id)));
    h = (list.some(i => i.group) ? row('ungroup', 'Take out of layer', 'ungroup', keyLabel('ungroup')) : '') + row('group', 'Make a layer', 'group', keyLabel('group'))
      + (others.length ? `<div class="ctxh">Move to layer</div><div class="ctxlist">${others.map(g => row(`mv:${g.id}`, layerLabel(g), 'folder-input')).join('')}</div>` : '')
      + '<hr>' + row('hide', 'Hide', 'eye-off') + row('lock', anyLocked ? 'Unlock' : 'Lock', anyLocked ? 'lock-open' : 'lock') + '<hr>' + row('del', 'Delete', 'trash-2', keyLabel('del'));
  }
  if (h) placeCtx(e.clientX, e.clientY, h);
});
// runs a Layers menu choice through the same button a click would use
function layerCtxRun(a) {
  const [kind, x, y] = a.split(':');
  if (kind === 'ren') { renaming = +x; setTab('groups'); renderGroups(); return; }
  if (kind === 'lren') { renamingLevel = +x; setTab('groups'); renderGroups(); return; }
  const b = document.querySelector(`#groups [data-${x}="${y}"]`); if (b) b.click();
}

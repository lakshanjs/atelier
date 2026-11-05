// ---------- hardware catalogue ----------
// The hinges and slides you buy, with their sizes, drilling and prices. It's kept with the app so every project can use it,
// and each project also keeps a copy of what it uses, so a file still opens correctly on another computer.
// The starting entries are generic values to check against the real hardware. They aren't any maker's specification.
const HW_START = [
  { id: 'hinge-35', kind: 'hinge', name: 'Hinge, 35 mm cup', price: 0, cupD: 35, cupDepth: 12.5, cupInset: 22.5, cupScrewD: 0, cupScrewPitch: 45, cupScrewOffset: 9.5, ends: 100, plateD: 3, plateDepth: 12, plateFrom: 37, platePitch: 32 },
  { id: 'hinge-35-soft', kind: 'hinge', name: 'Soft-close hinge, 35 mm cup', price: 0, cupD: 35, cupDepth: 12.5, cupInset: 22.5, cupScrewD: 0, cupScrewPitch: 45, cupScrewOffset: 9.5, ends: 100, plateD: 3, plateDepth: 12, plateFrom: 37, platePitch: 32 },
  { id: 'slide-side', kind: 'slide', name: 'Side-mount slide', price: 0, clearance: 12.7, screwD: 3, screwDepth: 10, lengths: [250, 300, 350, 400, 450, 500, 550], holes: [37, 165, 261, 357, 453], boxHoles: [37, 133, 229], },
  { id: 'slide-side-soft', kind: 'slide', name: 'Soft-close side-mount slide', price: 0, clearance: 12.7, screwD: 3, screwDepth: 10, lengths: [250, 300, 350, 400, 450, 500, 550], holes: [37, 165, 261, 357, 453], boxHoles: [37, 133, 229] },
];
const HW_FIELDS = {
  hinge: [['price', 'Price each', 'n'], ['cupD', 'Cup diameter'], ['cupDepth', 'Cup depth'], ['cupInset', 'Cup centre from the door edge'], ['cupScrewD', 'Cup screw hole, 0 for none'], ['cupScrewPitch', 'Cup screw spacing'], ['cupScrewOffset', 'Cup screws from the cup centre'], ['ends', 'First hinge from the door end'], ['plateD', 'Plate screw hole'], ['plateDepth', 'Plate screw depth'], ['plateFrom', 'Plate from the cabinet front'], ['platePitch', 'Plate screw spacing']],
  slide: [['price', 'Price per pair', 'n'], ['lengths', 'Lengths sold', 'list'], ['clearance', 'Gap each side of the drawer box'], ['screwD', 'Screw hole'], ['screwDepth', 'Screw depth'], ['holes', 'Cabinet screws, from the front', 'list'], ['boxHoles', 'Drawer box screws, from its front', 'list']],
};
let HW = JSON.parse(JSON.stringify(HW_START));
const hwById = id => HW.find(e => e.id === id) || (P && P.hwUsed && P.hwUsed[id]) || null;
const hwOfKind = kind => HW.filter(e => e.kind === kind);
function hwDefault(kind) { const id = P.hwDefault && P.hwDefault[kind]; return hwById(id) || hwOfKind(kind)[0] || HW_START.find(e => e.kind === kind); }
const hwFor = (it, kind) => hwById(kind === 'hinge' ? it.hingeType : it.slideType) || hwDefault(kind);
async function hwStart() {
  let saved = null; try { saved = await kvGet('hardware'); } catch (e) {}
  if (Array.isArray(saved) && saved.length) HW = saved;
  hwAdopt(); machInvalidate(); if (P) render();
}
const hwSave = () => kvSet('hardware', HW).catch(e => toast(`Couldn't save the catalogue: ${e && e.message}.`, true));
function hwAdopt() {   // anything an opened project uses that this computer's catalogue hasn't got joins it
  if (!P || !P.hwUsed) return; let any = false;
  Object.values(P.hwUsed).forEach(e => { if (e && e.id && e.kind && !HW.some(x => x.id === e.id)) { HW.push(JSON.parse(JSON.stringify(e))); any = true; } });
  if (any) hwSave();
}
function hwSync() {   // keeps the project's own copy up to date
  const used = {}, put = e => { if (e) used[e.id] = JSON.parse(JSON.stringify(e)); };
  panelsOnly().forEach(p => { const role = roleOf(p); if (role === 'door') put(hwFor(p, 'hinge')); if (role === 'drawer') put(hwFor(p, 'slide')); });
  if (Object.keys(used).length) P.hwUsed = used; else delete P.hwUsed;
}
// a drawer's slide: the longest length sold that fits its box
function drawerBoxSides(front) {
  const b = bounds(front), normal = [0, 1, 2].find(a => fxLocalKey(front, a) === 't'), others = [0, 1, 2].filter(a => a !== normal);
  return panelsOnly().filter(p => p !== front && /drawer box side/i.test(p.name) && isStraight(p) && (() => { const q = bounds(p); return others.every(a => q.min[a] >= b.min[a] - 1 && q.max[a] <= b.max[a] + 1); })());
}
function slideLength(it) {
  if (it.slide) return it.slide;
  const box = isStraight(it) ? drawerBoxSides(it)[0] : null, room = box ? Math.max(box.l, box.w) : 400, sizes = (hwFor(it, 'slide').lengths || []).slice().sort((a, b) => a - b);
  if (!sizes.length) return Math.round(room);
  return sizes.filter(s => s <= room + .5).pop() ?? (box ? Math.round(room) : sizes[0]);
}
const hwCatalogPrice = label => { const e = [...HW, ...Object.values(P.hwUsed || {})].find(x => (x.kind === 'hinge' ? x.name === label : label.startsWith(x.name + ', '))); return e ? e.price || 0 : 0; };
function hwLines() {   // what goes on the shopping list
  const out = [], ps = panelsOnly(), hinges = new Map(), slides = new Map();
  ps.filter(p => roleOf(p) === 'door').forEach(d => { const e = hwFor(d, 'hinge'), r = hinges.get(e.name) || { n: 0, doors: 0 }; r.n += d.hinges ?? defaultHinges(d); r.doors++; hinges.set(e.name, r); });
  hinges.forEach((r, name) => { if (r.n) out.push([name, r.n, `for ${r.doors} ${r.doors === 1 ? 'door' : 'doors'}`]); });
  ps.filter(p => roleOf(p) === 'drawer').forEach(d => { const label = `${hwFor(d, 'slide').name}, ${fmt(slideLength(d))}`; slides.set(label, (slides.get(label) || 0) + 1); });
  slides.forEach((n, label) => out.push([label, n, n === 1 ? 'pair' : 'pairs']));
  return out;
}
// ---------- choosing ----------
const hwOptions = (kind, cur, inherit) => `${inherit ? `<option value="">Project's choice: ${esc(hwDefault(kind).name)}</option>` : ''}${[...hwOfKind(kind), ...(cur && !HW.some(e => e.id === cur) && hwById(cur) ? [hwById(cur)] : [])].map(e => `<option value="${esc(e.id)}" ${e.id === cur ? 'selected' : ''}>${esc(e.name)}</option>`).join('')}`;
const hwEditBtn = () => `<div class="rowb" style="margin-top:4px"><button class="btn line" data-hwcat="1">Hardware catalogue</button></div>`;
function hwBindPanel() {
  side.querySelectorAll('[data-hwcat]').forEach(b => { addIcon(b, 'package'); b.onclick = openCatalogue; });
  const pick = (id, fn) => { const el = side.querySelector('#' + id); if (el) el.onchange = () => edit(() => fn(el.value)); };
  pick('hwDefHinge', v => { (P.hwDefault = P.hwDefault || {}).hinge = v; });
  pick('hwDefSlide', v => { (P.hwDefault = P.hwDefault || {}).slide = v; });
  const one = selected()[0];
  if (one) {
    pick('hwHinge', v => { if (v) one.hingeType = v; else delete one.hingeType; });
    pick('hwSlide', v => { if (v) one.slideType = v; else delete one.slideType; });
  }
}
// ---------- the catalogue window ----------
const hwListText = v => (v || []).join(', ');
function renderCatalogue() {
  const body = kind => hwOfKind(kind).map(e => `<details class="hwrow" data-hwopen="${esc(e.id)}"${hwOpenRow === e.id ? ' open' : ''}><summary><span class="hwname">${esc(e.name)}</span><button class="ic" data-hwcopy="${esc(e.id)}" title="Make a copy" aria-label="Copy ${esc(e.name)}">${ic('copy')}</button><button class="ic" data-hwdel="${esc(e.id)}" title="Delete" aria-label="Delete ${esc(e.name)}">${ic('x')}</button></summary><div class="hwform"><label>Name<input data-hw="${esc(e.id)}" data-key="name" value="${esc(e.name)}"></label>${HW_FIELDS[kind].map(([k, label, type]) => `<label>${label}${type ? '' : ', mm'}${type === 'list' ? ', mm' : ''}<input data-hw="${esc(e.id)}" data-key="${k}" data-type="${type || 'mm'}" value="${esc(type === 'list' ? hwListText(e[k]) : e[k] ?? 0)}"></label>`).join('')}</div></details>`).join('');
  document.getElementById('hwList').innerHTML = `<h3>Hinges</h3>${body('hinge')}<div class="rowb"><button class="btn line" data-hwadd="hinge">Add a hinge</button></div><h3>Drawer slides</h3>${body('slide')}<div class="rowb"><button class="btn line" data-hwadd="slide">Add a slide</button></div>`;
  document.querySelectorAll('#hwList [data-hwadd]').forEach(b => addIcon(b, 'plus'));
}
let hwOpenRow = null;
function openCatalogue() { renderCatalogue(); document.getElementById('hwDlg').showModal(); }
function hwChanged() { hwSave(); persist(); render(); }
document.getElementById('hwClose').onclick = () => document.getElementById('hwDlg').close();
const hwListEl = document.getElementById('hwList');
hwListEl.addEventListener('keydown', e => e.stopPropagation());
hwListEl.addEventListener('toggle', e => { if (e.target.open) hwOpenRow = e.target.dataset.hwopen; }, true);
hwListEl.addEventListener('click', e => {
  const add = e.target.closest('[data-hwadd]'), del = e.target.closest('[data-hwdel]'), copy = e.target.closest('[data-hwcopy]');
  if (!add && !del && !copy) return;
  e.preventDefault();
  if (add) { const kind = add.dataset.hwadd, id = `${kind}-${Date.now().toString(36)}`, base = hwOfKind(kind)[0] || HW_START.find(x => x.kind === kind); HW.push({ ...JSON.parse(JSON.stringify(base)), id, name: `New ${kind}`, price: 0 }); hwOpenRow = id; }
  if (copy) { const from = HW.find(x => x.id === copy.dataset.hwcopy), id = `${from.kind}-${Date.now().toString(36)}`; HW.push({ ...JSON.parse(JSON.stringify(from)), id, name: `${from.name} copy` }); hwOpenRow = id; }
  if (del) {
    const it = HW.find(x => x.id === del.dataset.hwdel);
    if (hwOfKind(it.kind).length < 2) { toast(`Keep at least one ${it.kind}.`, true); return; }
    HW = HW.filter(x => x !== it); if (P.hwDefault && P.hwDefault[it.kind] === it.id) delete P.hwDefault[it.kind];
  }
  renderCatalogue(); hwChanged();
});
hwListEl.addEventListener('change', e => {
  const inp = e.target.closest('[data-hw]'); if (!inp) return;
  const it = HW.find(x => x.id === inp.dataset.hw), k = inp.dataset.key, type = inp.dataset.type; if (!it) return;
  const back = why => { toast(why, true); inp.value = type === 'list' ? hwListText(it[k]) : it[k]; };
  if (k === 'name') { const v = inp.value.trim(); if (!v) { back('It needs a name.'); return; } it.name = v; inp.closest('details').querySelector('.hwname').textContent = v; }
  else if (type === 'list') { const v = inp.value.split(/[\s,;]+/).filter(Boolean).map(Number); if (v.some(n => !(n > 0))) { back('Type sizes in mm, separated by commas.'); return; } it[k] = v.sort((a, b) => a - b); inp.value = hwListText(it[k]); }
  else { const v = parseFloat(inp.value.replace(/,/g, '')); if (!(v >= 0)) { back('Type a number.'); return; } it[k] = v; }
  hwChanged();
});

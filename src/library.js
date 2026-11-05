// ---------- gallery ----------
// your own saved pieces, kept in the app's database so they're there in every project. An entry only points at its
// 3D models, which stay under model:* and tex:* like everything else.
let LIB = { folders: [], items: [] }, libSeq = 0, libBusy = false, libAsk = null, libFilling = false;
const libId = () => Date.now().toString(36) + (libSeq++).toString(36);
const libSave = () => kvSet('library', LIB).catch(e => toast(`Couldn't save the library: ${e && e.message}.`, true));
async function libStart() {
  let v = null; try { v = await kvGet('library'); } catch (e) {}
  const fresh = !v;
  if (fresh) { let old = []; try { old = JSON.parse(localStorage.getItem('furniture-library')) || []; } catch (e) {} v = { folders: [], items: old }; }   // from before the library moved here
  v.items.forEach(e => { if (!e.id) e.id = libId(); });
  LIB = v; if (fresh && LIB.items.length) libSave();
  renderGallery(); libFillThumbs();
}
function libAdd(name) {
  const list = selected().filter(i => !isRoomPart(i)); if (!list.length) return false;
  const u = unionBounds(list), cx = (u.min[0] + u.max[0]) / 2, cz = (u.min[2] + u.max[2]) / 2;
  const items = list.map(i => { const c = JSON.parse(JSON.stringify(i)); edgesOf(i); c.edges = c.edges || i.edges; delete c.band; c.pos = [i.pos[0] - cx, i.pos[1] - u.min[1], i.pos[2] - cz]; return c; });
  LIB.items.push({ id: libId(), name, items, size: [u.max[0] - u.min[0], u.max[1] - u.min[1], u.max[2] - u.min[2]] });
  libSave(); return true;
}
const libFrom = e => (e.items.some(i => i.model || i.type === 'imported') ? 'imported' : 'mine');
const libSig = e => e.name + JSON.stringify(e.items.map(({ id, group, ...rest }) => rest));   // the same piece imported twice is only kept once
function libFolder(name) { let f = LIB.folders.find(x => x.name === name); if (!f) { f = { id: libId(), name, open: false }; LIB.folders.push(f); } return f; }

// ---------- library thumbnails ----------
// Drawn once by a small renderer of their own and kept with the entry, so a long list needs no 3D to show.
const THUMB_OK = /^data:image\/(webp|png);base64,[A-Za-z0-9+/=]+$/;
let thumbGL = null;
async function thumbTexture(key) {
  const t = TEXTURES[key] || await kvGet('tex:' + key); if (!t) return null;
  const url = URL.createObjectURL(new Blob([t.bytes])), img = new Image(); img.src = url;
  try { await img.decode(); } catch (e) { return null; } finally { URL.revokeObjectURL(url); }
  const map = new THREE.Texture(img); map.wrapS = map.wrapT = THREE.RepeatWrapping; map.needsUpdate = true;
  return { map, cutout: t.bytes[0] === 0x89 };
}
async function libMakeThumb(entry) {
  if (!entry.items.length) return null;
  if (!thumbGL) { thumbGL = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true }); thumbGL.setSize(168, 120, false); thumbGL.setClearColor(0, 0); }
  const sc = new THREE.Scene(), geos = [], mats = [], maps = {};
  sc.add(new THREE.HemisphereLight(0xffffff, 0x8a9296, .85)); const key = new THREE.DirectionalLight(0xffffff, .5); key.position.set(1, 2, 1.5); sc.add(key);
  const add = (geo, mat, pos, quat, scale) => { const m = new THREE.Mesh(geo, mat); geos.push(geo); mats.push(mat); m.position.copy(pos); if (quat) m.quaternion.copy(quat); if (scale) m.scale.copy(scale); m.frustumCulled = false; sc.add(m); };
  const flat = (hex, o = 1) => { const m = new THREE.MeshStandardMaterial({ color: hex, roughness: .8, side: THREE.DoubleSide }); if (o < 1) { m.transparent = true; m.opacity = o; m.depthWrite = false; } return m; };
  for (const it of entry.items) {
    const q = Q(it), pos = V3(...it.pos), model = it.model && (MODELS[it.model] || await kvGet('model:' + it.model));
    if (model) {
      for (const part of model.parts) {
        const own = (it.mats && it.mats[part.name]) || null, wanted = (it.matTex && it.matTex[part.name]) || it.ptex || (own || it.tint ? null : part.map);
        if (wanted && !(wanted in maps)) maps[wanted] = await thumbTexture(wanted);
        const tx = wanted && part.u ? maps[wanted] : null, mat = flat(tx ? 0xffffff : own || it.tint || part.c, part.o);
        if (tx) { mat.map = tx.map; if (tx.cutout) mat.alphaTest = .4; }
        const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(part.p, 3, true)); g.setAttribute('normal', new THREE.BufferAttribute(part.n, 3, true)); g.setIndex(new THREE.BufferAttribute(part.i, 1)); if (part.u) g.setAttribute('uv', new THREE.BufferAttribute(part.u, 2));
        add(g, mat, pos, q, V3((it.mirror ? -1 : 1) * it.l / 2, it.t / 2, it.w / 2));
      }
    } else if (it.kind === 'panel') {
      add(new THREE.BoxGeometry(it.l, it.t, it.w), flat(MAT[panelColor(it)].c), pos, q);
      const lines = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(it.l, it.t, it.w)), new THREE.LineBasicMaterial({ color: 0x20262a, transparent: true, opacity: .45 })); lines.position.copy(pos); lines.quaternion.copy(q); geos.push(lines.geometry); mats.push(lines.material); sc.add(lines);
    } else {
      const base = V3(-it.l / 2, -it.t / 2, -it.w / 2);
      shapes(it.type, it.l, it.t, it.w, it.id || 1, it.cuts).forEach(p => {
        if (p.ball) add(new THREE.SphereGeometry(p.r, 14, 12), flat(p.c), base.clone().add(V3(p.ball[0], p.ball[2], p.ball[1])).applyQuaternion(q).add(pos));
        else { const [a0, a1, u0, u1, z0, z1] = p.a; add(new THREE.BoxGeometry(Math.max(a1 - a0, .1), Math.max(z1 - z0, .1), Math.max(u1 - u0, .1)), flat(p.c), base.clone().add(V3((a0 + a1) / 2, (z0 + z1) / 2, (u0 + u1) / 2)).applyQuaternion(q).add(pos), q); }
      });
    }
  }
  const u = unionBounds(entry.items), mid = V3((u.min[0] + u.max[0]) / 2, (u.min[1] + u.max[1]) / 2, (u.min[2] + u.max[2]) / 2), r = Math.max(1, Math.hypot(u.max[0] - u.min[0], u.max[1] - u.min[1], u.max[2] - u.min[2]) / 2), dist = r / Math.sin(11 * Math.PI / 180);
  const cam = new THREE.PerspectiveCamera(22, 168 / 120, Math.max(1, dist - r * 2), dist + r * 2); cam.position.copy(mid).add(V3(.55, .5, 1).normalize().multiplyScalar(dist)); cam.lookAt(mid);
  thumbGL.render(sc, cam);
  const out = thumbGL.domElement.toDataURL('image/webp', .85);
  geos.forEach(g => g.dispose()); mats.forEach(m => m.dispose()); Object.values(maps).forEach(t => { if (t) t.map.dispose(); });
  return out;
}
function libThumb(e) {
  if (e.thumb && THUMB_OK.test(e.thumb)) return `<img class="libthumb" src="${e.thumb}" alt="" draggable="false">`;
  const ps = e.items.filter(i => i.kind === 'panel'); if (!ps.length) return ic('box');
  const u = unionBounds(ps), k = Math.min(52 / Math.max(u.max[0] - u.min[0], 1), 30 / Math.max(u.max[1] - u.min[1], 1)), ox = 28 - (u.min[0] + u.max[0]) / 2 * k, oy = 32 + u.min[1] * k;
  return `<svg class="libthumb" viewBox="0 0 56 34" aria-hidden="true">${ps.slice().sort((a, b) => a.pos[2] - b.pos[2]).map(i => { const b = bounds(i); return `<rect x="${ox + b.min[0] * k}" y="${oy - b.max[1] * k}" width="${Math.max(.6, (b.max[0] - b.min[0]) * k)}" height="${Math.max(.6, (b.max[1] - b.min[1]) * k)}" fill="#dfe3e1" stroke="#20262a" stroke-width=".5"/>`; }).join('')}</svg>`;
}
async function libFillThumbs() {   // entries saved from a design, or from before thumbnails, get theirs here
  if (libFilling) return; libFilling = true; let any = false; const failed = new Set();
  for (;;) {
    const e = LIB.items.find(x => !x.thumb && !failed.has(x)); if (!e) break;
    await new Promise(r => setTimeout(r));
    try { e.thumb = await libMakeThumb(e); } catch (err) { console.error(e.name, err); }
    if (!e.thumb) { failed.add(e); continue; }
    any = true;
    const b = [...document.querySelectorAll('#gal [data-add]')].find(x => x.dataset.add === 'lib:' + e.id); if (b && b.firstElementChild) b.firstElementChild.outerHTML = libThumb(e);
  }
  libFilling = false; if (any) libSave();
}

// ---------- the My items list ----------
function libHtml() {
  const card = e => `<div class="libwrap" data-from="${libFrom(e)}"><button class="obj" data-add="lib:${esc(e.id)}" title="Click to add, or drag it into a view or onto a folder">${libThumb(e)}<span>${esc(e.name)}</span></button><button class="ic" data-libdel="${esc(e.id)}" aria-label="Remove ${esc(e.name)}" title="Remove">${ic('x')}</button></div>`;
  const known = new Set(LIB.folders.map(f => f.id)), loose = LIB.items.filter(e => !known.has(e.folder));
  const tools = `<span class="libtools"><button class="ic" id="libNewF" title="New folder" aria-label="New folder">${ic('folder-plus')}</button><button class="ic" id="libImp" title="Import to library: an OBJ model in a zip, a Sweet Home 3D home or furniture library, or a saved Atelier library" aria-label="Import to library">${ic('file-box')}</button><button class="ic" id="libExp" title="Export library to a file" aria-label="Export library">${ic('file-output')}</button></span>`;
  let h = `<h3 class="libhead" data-libdrop="" style="margin-top:0"><span>My items</span>${tools}</h3><div class="libsave"><input id="libName" placeholder="Name for what's selected" aria-label="Name for the saved item"><button class="btn line" id="libAdd">${ic('bookmark-plus')}Save</button></div><p class="note" id="libMsg" style="margin:2px 0 6px">${LIB.items.length ? '' : 'Select something and save it here to reuse it in any project.'}</p>`;
  if (loose.length) h += `<div class="gal">${loose.map(card).join('')}</div>`;
  LIB.folders.forEach(f => {
    const list = LIB.items.filter(e => e.folder === f.id);
    h += `<h3 class="libfold" data-libdrop="${esc(f.id)}" data-libfold="${esc(f.id)}">${ic(f.open ? 'chevron-down' : 'chevron-right')}<span class="libfname" title="Double-click to rename">${esc(f.name)}</span><span class="libn" data-n="${list.length}"></span><button class="ic" data-libfask="${esc(f.id)}" aria-label="Delete folder ${esc(f.name)}" title="Delete folder">${ic('trash-2')}</button></h3>`;
    if (libAsk === f.id) h += `<div class="libask"><span>Delete "${esc(f.name)}" and its ${list.length} ${list.length === 1 ? 'item' : 'items'}?</span><button class="btn line" data-libfdel="${esc(f.id)}">Delete all</button><button class="btn line" data-libfkeep="${esc(f.id)}">Keep items</button><button class="btn line" data-libfno="1">Cancel</button></div>`;
    h += `<div class="gal${f.open ? '' : ' shut'}">${list.map(card).join('')}</div>`;
  });
  return h;
}
function libRename(id) {
  const row = [...document.querySelectorAll('#gal [data-libfold]')].find(x => x.dataset.libfold === id), f = LIB.folders.find(x => x.id === id); if (!row || !f) return;
  const span = row.querySelector('.libfname'), box = document.createElement('input'); box.value = f.name; box.setAttribute('aria-label', 'Folder name'); span.replaceWith(box); box.focus(); box.select();
  let done = false;
  const finish = keep => { if (done) return; done = true; const v = box.value.trim(); if (keep && v) { f.name = v; libSave(); } renderGallery(); };
  box.addEventListener('blur', () => finish(true));
  box.addEventListener('keydown', e => { if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); });
}
function libDeleteFolder(id, keepItems) {
  if (keepItems) LIB.items.forEach(e => { if (e.folder === id) delete e.folder; }); else LIB.items = LIB.items.filter(e => e.folder !== id);
  LIB.folders = LIB.folders.filter(f => f.id !== id); libAsk = null; libSave(); renderGallery();
}
function libClick(e) {   // true when the click was on one of the library's own controls
  const t = e.target, on = sel => t.closest(sel);
  let b;
  if ((b = on('[data-show]'))) { galFrom = b.dataset.show; document.querySelectorAll('#galFrom [data-show]').forEach(x => x.setAttribute('aria-pressed', x === b)); filterGallery(); return true; }
  if ((b = on('[data-libdel]'))) { LIB.items = LIB.items.filter(x => x.id !== b.dataset.libdel); libSave(); renderGallery(); return true; }
  if (on('#libNewF')) { const f = { id: libId(), name: 'New folder', open: true }; LIB.folders.push(f); libSave(); renderGallery(); libRename(f.id); return true; }
  if (on('#libImp')) { document.getElementById('libIn').click(); return true; }
  if (on('#libExp')) { libExport(); return true; }
  if ((b = on('[data-libfask]'))) { const id = b.dataset.libfask; if (LIB.items.some(x => x.folder === id)) { libAsk = id; renderGallery(); } else libDeleteFolder(id, true); return true; }
  if ((b = on('[data-libfdel]'))) { libDeleteFolder(b.dataset.libfdel, false); return true; }
  if ((b = on('[data-libfkeep]'))) { libDeleteFolder(b.dataset.libfkeep, true); return true; }
  if (on('[data-libfno]')) { libAsk = null; renderGallery(); return true; }
  if (on('.libfold input')) return true;
  if ((b = on('[data-libfold]'))) {   // opens in place, because rebuilding the list here would lose a double-click
    const f = LIB.folders.find(x => x.id === b.dataset.libfold); if (!f) return true;
    f.open = !f.open; libSave();
    b.querySelector('svg').outerHTML = ic(f.open ? 'chevron-down' : 'chevron-right');
    let g = b.nextElementSibling; while (g && !g.classList.contains('gal')) g = g.nextElementSibling;
    if (g) g.classList.toggle('shut', !f.open);
    return true;
  }
  return false;
}
function libDragOver(e) {
  const under = document.elementFromPoint(e.clientX, e.clientY), d = under && under.closest('[data-libdrop]');
  document.querySelectorAll('.libover').forEach(x => { if (x !== d) x.classList.remove('libover'); });
  if (d) d.classList.add('libover');
}
function libDropOnFolder(e, id) {
  document.querySelectorAll('.libover').forEach(x => x.classList.remove('libover'));
  const under = document.elementFromPoint(e.clientX, e.clientY), d = under && under.closest('[data-libdrop]'), item = LIB.items.find(x => x.id === id); if (!d || !item) return false;
  if (d.dataset.libdrop) item.folder = d.dataset.libdrop; else delete item.folder;
  libSave(); renderGallery(); return true;
}

// ---------- importing to the library ----------
// Reads a Java .properties file: what a Sweet Home 3D furniture library uses to list its pieces.
function parseProperties(text) {
  const out = {}, lines = text.split(/\r\n|\r|\n/), unesc = s => s.replace(/\\(u[0-9a-fA-F]{4}|[\s\S])/g, (m, c) => (c[0] === 'u' && c.length === 5 ? String.fromCharCode(parseInt(c.slice(1), 16)) : ({ t: '\t', n: '\n', r: '\r', f: '\f' }[c] || c)));
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].replace(/^\s+/, ''); if (!line || line[0] === '#' || line[0] === '!') continue;
    while (/(^|[^\\])(\\\\)*\\$/.test(line) && i + 1 < lines.length) line = line.slice(0, -1) + lines[++i].replace(/^\s+/, '');
    const m = line.match(/^((?:\\[\s\S]|[^\\=:\s])*)\s*[=:]?\s*([\s\S]*)$/); if (m) out[unesc(m[1])] = unesc(m[2]);
  }
  return out;
}
const textOf = bytes => { try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch (e) { return new TextDecoder('latin1').decode(bytes); } };
const libBaseName = name => name.replace(/(\.sh3d|\.sh3f|\.zip)+$/i, '');
const libRot = v => { const r = (v || '').trim().split(/\s+/).map(Number); return r.length === 9 && r.every(n => !isNaN(n)) ? r : null; };
function libHomePieces(xml, fileName, buf, tag) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml'), folder = libBaseName(fileName), cm = (f, k) => Math.max((parseFloat(f.getAttribute(k)) || 0) * 10, 1);
  return [...doc.querySelectorAll('pieceOfFurniture, doorOrWindow')].filter(f => f.getAttribute('model')).map(f => ({
    name: f.getAttribute('name') || 'Object', folder, path: f.getAttribute('model'), rotText: f.getAttribute('modelRotation'), win: f.nodeName === 'doorOrWindow' && /window/i.test(f.getAttribute('name') || ''),
    l: cm(f, 'width'), t: cm(f, 'height'), w: cm(f, 'depth'), y: 0,
    info: async () => { for (const el of f.querySelectorAll('texture')) await keepTexture(buf, tag, el.getAttribute('image')); return sh3dPieceInfo(f, tag); },
  }));
}
// A plain model doesn't say what unit it was made in, so this picks the one that gives furniture a likely size. It can be scaled once placed.
function libGuessMm(raw) {
  const d = Math.max(...raw) || 1, units = [10, 1, 1000, 304.8, 25.4], fits = units.find(u => d * u >= 300 && d * u <= 4000);
  return fits || units.slice().sort((a, b) => Math.abs(Math.log(d * a / 1000)) - Math.abs(Math.log(d * b / 1000)))[0];
}
const libNiceName = n => { const t = n.replace(/\.obj$/i, '').replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim(); return t ? t[0].toUpperCase() + t.slice(1) : 'Object'; };
async function libLoosePieces(buf, fileName) {
  const objs = [...zipIndex(buf).keys()].filter(n => /\.obj$/i.test(n) && !/^__MACOSX\//.test(n)), out = [];
  for (const path of objs) {
    const raw = parseObj(textOf(await readZipBytes(buf, path)), null).raw, k = libGuessMm(raw);
    if (!raw.every(isFinite)) continue;
    out.push({ name: libNiceName(path.split('/').pop()), folder: objs.length > 1 ? libBaseName(fileName) : null, path, rotText: null, win: false, l: Math.max(raw[0] * k, 1), t: Math.max(raw[1] * k, 1), w: Math.max(raw[2] * k, 1), y: 0 });
  }
  return out;
}
function libCatalogPieces(text, fileName) {
  const p = parseProperties(text), fallback = p.name || libBaseName(fileName), out = [], cm = (k, d) => { const v = parseFloat(p[k]); return isNaN(v) ? d : v * 10; };
  Object.keys(p).forEach(k => {
    const m = k.match(/^model#(\d+)$/); if (!m) return;
    const n = m[1], name = p['name#' + n] || 'Object';
    out.push({ n: +n, name, folder: p['category#' + n] || fallback, path: p[k].replace(/^\//, ''), rotText: p['modelRotation#' + n] || null, win: p['doorOrWindow#' + n] === 'true' && /window/i.test(name), l: Math.max(cm('width#' + n, 1000), 1), t: Math.max(cm('height#' + n, 1000), 1), w: Math.max(cm('depth#' + n, 1000), 1), y: cm('elevation#' + n, 0) });
  });
  return out.sort((a, b) => a.n - b.n);
}
async function libTakePieces(buf, tag, pieces) {
  const keepM = new Set(Object.keys(MODELS)), keepT = new Set(Object.keys(TEXTURES)), seen = new Set(LIB.items.map(libSig)), folders = new Set();
  let added = 0, dup = 0, bad = 0, done = 0;
  for (const p of pieces) {
    toast(`Importing to library: ${++done} of ${pieces.length}`);
    await new Promise(r => setTimeout(r));
    try {
      const key = sh3dModelKey({ getAttribute: a => (a === 'model' ? p.path : a === 'modelRotation' ? p.rotText : null) }, tag), info = p.info ? await p.info() : {};
      const entry = { id: libId(), name: p.name, size: [p.l, p.t, p.w], items: [{ kind: 'object', type: 'imported', name: p.name, l: p.l, t: p.t, w: p.w, pos: [0, p.y + p.t / 2, 0], q: IDQ.slice(), model: key, ...info }] }, sig = libSig(entry);
      if (seen.has(sig)) { dup++; continue; }
      if (!MODELS[key] && !await kvGet('model:' + key)) {
        let m = null; try { m = await buildModel(buf, p.path, libRot(p.rotText), p.win, tag); } catch (e) { console.error(p.path, e); }
        if (!m || !m.parts.length) { bad++; continue; }
        await kvSet('model:' + key, m); MODELS[key] = m;
      }
      try { entry.thumb = await libMakeThumb(entry); } catch (e) { console.error(p.name, e); }
      if (p.folder) { const f = libFolder(p.folder); entry.folder = f.id; folders.add(f); }
      LIB.items.push(entry); seen.add(sig); added++;
    } finally {   // a big library would otherwise fill the memory: the database keeps them from here
      Object.keys(MODELS).forEach(k => { if (!keepM.has(k)) { delete MODELS[k]; delete modelGeos[k]; } });
      Object.keys(TEXTURES).forEach(k => { if (!keepT.has(k)) delete TEXTURES[k]; });
    }
  }
  if (folders.size === 1) [...folders][0].open = true;
  return { added, dup, bad };
}
async function libTakePack(buf) {
  const raw = await readZipText(buf, 'library.json'), m = raw && JSON.parse(raw);
  if (!m || m.format !== 'atelier-library') throw new Error('it is not an Atelier library');
  if (m.version > 1) throw new Error('it was saved by a newer version of Atelier');
  for (let t = 0; t < m.textures.length; t++) {
    const e = m.textures[t]; if (TEXTURES[e.key] || await kvGet('tex:' + e.key)) continue;
    const b = await readZipBytes(buf, `textures/${t}`); if (b) await kvSet('tex:' + e.key, { bytes: b.slice(), avg: e.avg });
  }
  for (let n = 0; n < m.models.length; n++) {
    toast(`Importing to library: model ${n + 1} of ${m.models.length}`);
    await new Promise(r => setTimeout(r));
    const e = m.models[n]; if (MODELS[e.key] || await kvGet('model:' + e.key)) continue;
    const b = await readZipBytes(buf, `models/${n}`); if (!b) continue;
    const bytes = b.slice(); let at = 0;
    const next = (len, T) => { if (!len) return null; const a = new T(bytes.slice(at, at + len).buffer); at += len; return a; };
    await kvSet('model:' + e.key, { parts: e.parts.map(q => ({ name: q.name, c: q.c, o: q.o, map: q.map, p: next(q.len[0], Int16Array), n: next(q.len[1], Int8Array), i: next(q.len[2], Uint32Array), u: next(q.len[3], Float32Array) })) });
  }
  const seen = new Set(LIB.items.map(libSig)), names = new Map((m.folders || []).map(f => [f.id, f.name])); let added = 0, dup = 0;
  (m.folders || []).forEach(f => libFolder(String(f.name)));   // empty ones come too
  for (const e of m.items || []) {
    if (!e || !Array.isArray(e.items) || typeof e.name !== 'string') continue;
    const sig = libSig(e); if (seen.has(sig)) { dup++; continue; }
    seen.add(sig);
    const item = { ...e, id: libId() }; delete item.folder;
    if (names.has(e.folder)) item.folder = libFolder(String(names.get(e.folder))).id;
    if (item.thumb && !THUMB_OK.test(item.thumb)) delete item.thumb;
    LIB.items.push(item); added++;
  }
  return { added, dup, bad: 0 };
}
async function libImport(file) {
  if (libBusy) { toast('The library is still busy with the last file.', true); return; }
  libBusy = true;
  try {
    const buf = await file.arrayBuffer(), tag = file.name.replace(/\W+/g, '-') + '-' + buf.byteLength;
    if (new Uint8Array(buf, 0, 2).join() !== '80,75') throw new Error('it is not a library or Sweet Home 3D file');
    let res;
    if (zipIndex(buf).has('library.json')) res = await libTakePack(buf);
    else if (zipIndex(buf).has('PluginFurnitureCatalog.properties')) res = await libTakePieces(buf, tag, libCatalogPieces(textOf(await readZipBytes(buf, 'PluginFurnitureCatalog.properties')), file.name));
    else if (zipIndex(buf).has('Home.xml')) res = await libTakePieces(buf, tag, libHomePieces(await readZipText(buf, 'Home.xml'), file.name, buf, tag));
    else { const pieces = await libLoosePieces(buf, file.name); if (!pieces.length) throw new Error('it has no OBJ model, furniture list or Home.xml in it'); res = await libTakePieces(buf, tag, pieces); }
    await libSave(); setTab('gallery'); renderGallery(); libFillThumbs();
    const extra = [res.dup ? `${res.dup} already there` : '', res.bad ? `${res.bad} couldn't be read` : ''].filter(Boolean).join(', ');
    toast(`Added ${res.added} ${res.added === 1 ? 'item' : 'items'} to My items${extra ? ` (${extra})` : ''}.`, !res.added && !res.dup);
  } catch (err) { await libSave(); renderGallery(); toast(`Couldn't import ${file.name}: ${err.message}.`, true); }
  libBusy = false;
}
async function libExport() {
  if (!LIB.items.length) { toast('The library is empty.', true); return; }
  if (libBusy) { toast('The library is still busy with the last file.', true); return; }
  // ask where first: the picker only opens straight after a click
  let handle = null;
  if (window.showSaveFilePicker) { try { handle = await showSaveFilePicker({ suggestedName: 'Atelier library.atlib', types: [{ description: 'Atelier library', accept: { 'application/x-atelier-library': ['.atlib'] } }] }); } catch (e) { if (e.name === 'AbortError') return; toast(`Couldn't save: ${e.message}.`, true); return; } }
  libBusy = true;
  try {
    const bytes = await libPackBytes();
    if (handle) { const w = await handle.createWritable(); await w.write(bytes); await w.close(); } else downloadBlob('Atelier library.atlib', bytes, 'application/x-atelier-library');
    toast(`Exported ${LIB.items.length} ${LIB.items.length === 1 ? 'item' : 'items'}.`);
  } catch (e) { toast(`Couldn't export the library: ${e.message}.`, true); }
  libBusy = false;
}
// An .atlib file is a zip like .atlr, but each model is one file: a big library would pass the zip's limit of 65,535 files otherwise.
async function libPackBytes() {
  const entries = [], models = [], textures = [], texKeys = new Set(), addTex = k => { if (k) texKeys.add(k); };
  const keys = new Set(); LIB.items.forEach(e => e.items.forEach(i => { if (i.model) keys.add(i.model); addTex(i.tex && i.tex.key); [i.sideL, i.sideR, i.sideT].forEach(q => addTex(q && q.tex && q.tex.key)); addTex(i.ptex); Object.values(i.matTex || {}).forEach(addTex); }));
  let n = 0;
  for (const key of keys) {
    toast(`Exporting library: model ${++n} of ${keys.size}`);
    await new Promise(r => setTimeout(r));
    const m = MODELS[key] || await kvGet('model:' + key); if (!m) continue;
    const arrays = [], parts = m.parts.map(q => { const list = [q.p, q.n, q.i, q.u]; list.forEach(a => { if (a) arrays.push(bytesOf(a)); }); addTex(q.map); return { name: q.name, c: q.c, o: q.o, map: q.map, len: list.map(a => (a ? a.byteLength : 0)) }; });
    entries.push({ name: `models/${models.length}`, data: new Uint8Array(await new Blob(arrays).arrayBuffer()) }); models.push({ key, parts });
  }
  for (const key of texKeys) { const t = TEXTURES[key] || await kvGet('tex:' + key); if (t) { entries.push({ name: `textures/${textures.length}`, data: t.bytes }); textures.push({ key, avg: t.avg }); } }
  entries.unshift({ name: 'library.json', data: new TextEncoder().encode(JSON.stringify({ format: 'atelier-library', version: 1, folders: LIB.folders, items: LIB.items, models, textures })) });
  return zipBytes(entries);
}
let galQuery = '', galFrom = 'all';
const GAL_FROM = [['all', 'layout-grid', 'Show everything'], ['stock', 'package', 'Show stock items only'], ['imported', 'file-box', 'Show imported items only'], ['mine', 'bookmark-plus', 'Show items I saved only']];
const galFromHtml = () => `<div id="galFrom" role="group" aria-label="Show">${GAL_FROM.map(([k, icon, tip]) => `<button class="ic" data-show="${k}" title="${tip}" aria-label="${tip}" aria-pressed="${galFrom === k}">${ic(icon)}</button>`).join('')}</div>`;
function filterGallery() {   // keeps a heading when it matches, or when something under it does
  const q = galQuery.trim().toLowerCase(), kids = [...document.getElementById('gal').children];
  let head = null, group = [];
  const flush = () => { if (!head) return; const hm = head.textContent.toLowerCase().includes(q); let any = false; group.forEach(el => { const objs = el.matches('.gal,.boardchips') ? [...el.children] : []; objs.forEach(o => { const show = (galFrom === 'all' || (o.dataset.from || 'stock') === galFrom) && (!q || hm || o.textContent.toLowerCase().includes(q)); o.hidden = !show; if (show) any = true; o.style.display = show ? '' : 'none'; }); if (el.matches('.gal,.boardchips')) el.style.display = objs.some(o => o.style.display !== 'none') ? '' : 'none'; else el.style.display = q || (galFrom !== 'all' && !el.matches('.libask') && !(galFrom === 'mine' && el.matches('.libsave,#libMsg'))) ? 'none' : ''; if (q && el.matches('.gal.shut') && el.style.display !== 'none') el.style.display = 'grid'; }); head.style.display = (!q && galFrom === 'all') || any || (!q && galFrom !== 'stock' && head.matches('.libhead')) ? '' : 'none'; };
  kids.forEach(el => { if (el.id === 'galFind' || el.id === 'galNone' || el.id === 'galFrom') return; if (el.tagName === 'H3') { flush(); head = el; group = []; } else if (head) group.push(el); else el.style.display = q ? 'none' : ''; });
  flush();
  const none = document.getElementById('galNone'), anyShown = [...document.querySelectorAll('#gal .obj')].some(o => { for (let n = o; n && n.id !== 'gal'; n = n.parentElement) if (n.style.display === 'none') return false; return true; });
  none.style.display = (q || galFrom !== 'all') && !anyShown ? '' : 'none'; none.textContent = q ? `Nothing matches "${galQuery.trim()}".` : galFrom === 'imported' ? 'Nothing imported yet.' : 'Nothing saved yet.';
}
function renderGallery() {
  const mine = libHtml();
  const card = (key, name) => `<button class="obj" data-add="${key}" title="Click to add, or drag it into a view">${ic(GALLERY_ICONS[key] || 'box')}<span>${name}</span></button>`;
  const chips = Object.entries(BOARDS).map(([m, b]) => `<h3>${b.name}</h3><div class="boardchips">${b.thick.map(([t, n]) => `<button class="obj chip" data-add="board:${m}:${t}" title="Add a flat ${b.name} panel. Click to add, or drag it into a view"><i style="background:${MAT[b.color].f}"></i>${n}</button>`).join('')}</div>`).join('');
  document.getElementById('gal').innerHTML = `<div id="galFind">${ic('search')}<input id="galQ" placeholder="Find a board or object" aria-label="Find in the gallery" value="${esc(galQuery)}"></div>${galFromHtml()}<p class="note" id="galNone" style="display:none"></p>${mine}<p class="note" style="margin:8px 0 0">Click to add, or drag into a view.</p>${chips}<h3>Parts, using the last board</h3><div class="gal">${PANELS.map(([k, n]) => card(k, n)).join('')}</div>`
    + CATALOG.map(([g, list]) => `<h3>${g}</h3><div class="gal">${list.map(([k, n]) => card(k, n)).join('')}</div>`).join('');
  filterGallery();
}
let gd = null, chip = null;
const galEl = document.getElementById('gal');
galEl.addEventListener('click', e => {
  if (libClick(e)) return;
  if (e.target.closest('#libAdd')) {
    const box = document.getElementById('libName'), name = box.value.trim() || (selected()[0] ? selected()[0].name : '');
    const msg = document.getElementById('libMsg');
    if (!selected().some(i => !isRoomPart(i))) { msg.textContent = 'Select something first, then save it.'; return; }
    libAdd(name); renderGallery(); libFillThumbs();
  }
});
galEl.addEventListener('dblclick', e => { const n = e.target.closest('.libfname'); if (n) libRename(n.closest('[data-libfold]').dataset.libfold); });
galEl.addEventListener('input', e => { if (e.target.id === 'galQ') { galQuery = e.target.value; filterGallery(); } });
galEl.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter' && e.target.id === 'libName') document.getElementById('libAdd').click(); });
galEl.addEventListener('pointerdown', e => {
  if (e.target.closest('[data-libdel],.libtools,.libask')) return;
  const c = e.target.closest('[data-add]'); if (!c || e.button !== 0) return;
  const art = c.querySelector('svg,img'); e.preventDefault(); gd = { key: c.dataset.add, down: [e.clientX, e.clientY], moved: false, html: art ? art.outerHTML : `<span style="padding:2px 6px;display:block">${esc(c.textContent)}</span>` };
});
window.addEventListener('pointermove', e => {
  if (!gd) return;
  if (!gd.moved && Math.hypot(e.clientX - gd.down[0], e.clientY - gd.down[1]) > 4) { gd.moved = true; chip = document.createElement('div'); chip.id = 'dragChip'; chip.innerHTML = gd.html; document.body.appendChild(chip); }
  if (chip) chip.style.transform = `translate(${e.clientX + 8}px, ${e.clientY + 8}px)`;
  if (gd.moved && gd.key.startsWith('lib:')) libDragOver(e);
});
window.addEventListener('pointerup', e => {
  if (!gd) return;
  const g = gd; gd = null; if (chip) { chip.remove(); chip = null; }
  if (!g.moved) { edit(() => addFromGallery(g.key)); return; }
  if (g.key.startsWith('lib:') && libDropOnFolder(e, g.key.slice(4))) return;
  const at = dropPoint(e); if (at) edit(() => addFromGallery(g.key, at));
});
function dropPoint(e) {
  const under = document.elementFromPoint(e.clientX, e.clientY), pane = under && under.closest('.pane'); if (!pane) return null;
  if (pane.dataset.v === '3d') {
    const ray = rayAt(e), hit = ray.intersectObjects(pickable).find(h => keptHit(h) && !byId(h.object.userData.id).locked), p = V3();
    if (hit) return { x: hit.point.x, y: hit.point.y, z: hit.point.z };
    if (ray.ray.intersectPlane(new THREE.Plane(V3(0, 1, 0), 0), p)) return { x: p.x, y: 0, z: p.z };
    return null;
  }
  const vn = pane.dataset.v, V = VIEWS[vn], r = document.getElementById(V.el).getBoundingClientRect(), w = worldOf(vn, e.clientX - r.left, e.clientY - r.top);
  const real = realItems(), c = real.length ? unionBounds(real) : { min: [0, 0, 0], max: [1400, 0, 400] };
  const pt = { x: (c.min[0] + c.max[0]) / 2, y: 0, z: (c.min[2] + c.max[2]) / 2 };
  const set = (axis, v) => { if (axis === 0) pt.x = v; if (axis === 1) pt.y = Math.max(0, v); if (axis === 2) pt.z = v; };
  set(V.u, w.u); set(V.v, w.v);
  return pt;
}

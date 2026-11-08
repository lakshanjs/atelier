// ---------- My machine ----------
// Drives a GRBL 1.1 machine directly, like Candle or Easel: over a USB cable (Web Serial, the port picked by name in
// main.js), over Wi-Fi (telnet, opened in main.js), or a simulated machine to practise on. The panel connects, jogs, sets
// zero, runs the spindle, sends a job with GRBL's character-counting so its 127-byte buffer never overflows, and follows
// it in Carve's 3D view. The emergency stop resets GRBL at once. The machine's own settings ($$) are never changed.
// The profile (travel, top speed and so on) belongs to the app; new carvings take their limits from it.

const MACH_STORE = 'atelier-machine', MACH_LIST = 'atelier-machines', MACH_RX = 127;
// fromMachine: on connecting, the working area, top speed and spindle full speed are read from the machine's own settings
// ($130 $131 $132, $110 $111, $30) and kept. Off, the numbers typed here stay.
const MACH_PROFILE = { name: 'TTC 3018 PRO', link: 'usb', port: 'COM8', baud: 115200, host: '192.168.1.99', tcpPort: 23, workX: 300, workY: 180, maxRate: 1500, sMax: 1000, safeZ: 6.35, jogFeed: 1000, send: '', fromMachine: true };
// Starting points for another machine. Its own settings replace the sizes when it connects.
const MACH_KINDS = [['3018', '3018 desktop, 300 x 180 mm', { workX: 300, workY: 180, maxRate: 1500 }], ['3040', '3040, 400 x 300 mm', { workX: 400, workY: 300, maxRate: 2000 }], ['4040', '4040, 400 x 400 mm', { workX: 400, workY: 400, maxRate: 2500 }], ['6040', '6040, 600 x 400 mm', { workX: 600, workY: 400, maxRate: 3000 }], ['custom', 'Another GRBL machine', { workX: 300, workY: 300, maxRate: 1000 }]];
// How lines are sent. Fast fills GRBL's 127-byte buffer (character counting), as Candle does. One line at a time waits for
// each ok first. An ESP32 board (MKS DLC32) restarted itself mid-job three times when Candle streamed to it over Wi-Fi, and ran
// a 35-minute job cleanly one line at a time, so that's the default over Wi-Fi. Not proven the cause, but it's what worked.
const machOneByOne = () => (machProfile.send || (M.kind === 'wifi' ? 'safe' : 'fast')) === 'safe';
// Every machine set up here, and the one in use. The first time, the single profile kept before becomes the first machine.
let machMachines = null;
try { machMachines = JSON.parse(localStorage.getItem(MACH_LIST)); } catch (e) {}
if (!machMachines || !Array.isArray(machMachines.list) || !machMachines.list.length) { let old = {}; try { old = JSON.parse(localStorage.getItem(MACH_STORE)) || {}; } catch (e) {} machMachines = { cur: 'm1', list: [{ ...old, id: 'm1' }] }; }
machMachines.list = machMachines.list.map(m => ({ ...MACH_PROFILE, ...m }));
let machProfile = machMachines.list.find(m => m.id === machMachines.cur) || machMachines.list[0];
const machSaveProfile = () => { try { machMachines.cur = machProfile.id; localStorage.setItem(MACH_LIST, JSON.stringify(machMachines)); } catch (e) {} };
function machUse(id) { const m = machMachines.list.find(x => x.id === id); if (!m || M.link) return; machProfile = m; machSaveProfile(); machRender(); }
function machAdd(kind) {
  const k = MACH_KINDS.find(x => x[0] === kind) || MACH_KINDS[MACH_KINDS.length - 1], base = k[0] === 'custom' ? 'My machine' : k[0];
  let name = base, n = 2; while (machMachines.list.some(m => m.name === name)) name = base + ' ' + n++;
  const m = { ...MACH_PROFILE, ...k[2], id: 'm' + Date.now().toString(36), name, port: machProfile.port, host: '', link: 'usb' };
  machMachines.list.push(m); machProfile = m; machSaveProfile(); machRender(); return m;
}
function machRemove() {
  if (M.link || machMachines.list.length < 2) return; machMachines.list = machMachines.list.filter(m => m !== machProfile);
  machProfile = machMachines.list[0]; machSaveProfile(); machRender();
}
// What the machine says about itself, read quietly after connecting: its working area and speeds replace the profile's.
function machFromSettings() {
  const st = M.settings || {}, p = machProfile, got = {}; if (p.fromMachine === false) return;
  if (st[130] > 0) got.workX = st[130]; if (st[131] > 0) got.workY = st[131]; if (st[132] > 0) got.workZ = st[132];
  if (st[110] > 0 && st[111] > 0) got.maxRate = Math.min(st[110], st[111]); if (st[30] > 0) got.sMax = st[30];
  if (!Object.keys(got).length) return;
  const changed = Object.keys(got).some(k => +p[k] !== +got[k]); Object.assign(p, got); p.readAt = Date.now(); machSaveProfile();
  if (changed) { const r = v => Math.round(v * 10) / 10; machLog(`From the machine's own settings: working area ${r(p.workX)} x ${r(p.workY)} mm${got.workZ ? `, ${r(got.workZ)} mm of Z travel` : ''}, top speed ${r(p.maxRate)} mm/min, spindle full speed S${r(p.sMax)}.`); toast(`Working area set from the machine: ${r(p.workX)} x ${r(p.workY)} mm.`); }
  // the open carving checks its job against the machine it's going to
  if (typeof P !== 'undefined' && P && P.carve && P.kind === 'carve' && typeof cvEdit === 'function') {
    const d = machDefaults(), cv = P.carve; if (cv.workX !== d.workX || cv.workY !== d.workY || cv.maxRate !== d.maxRate) { cvEdit(() => Object.assign(cv, { workX: d.workX, workY: d.workY, maxRate: d.maxRate })); if (typeof carveRender === 'function') carveRender(); }
  }
  machRender();
}
function machDefaults() { const p = machProfile; return { workX: p.workX, workY: p.workY, maxRate: p.maxRate, safeZ: p.safeZ }; }

// what GRBL's numbered errors and alarms mean, in plain words
const MACH_ERRORS = { 1: 'a word without a letter', 2: 'a number missing or wrong', 3: 'a $ command GRBL doesn\'t know', 5: 'homing is turned off', 9: 'locked by an alarm: Unlock first', 11: 'the line is too long', 15: 'a jog past the machine\'s limits', 16: 'a jog command it can\'t read', 20: 'a command GRBL doesn\'t do (M6 is one)', 22: 'no feed rate set', 24: 'two commands that need the same axis on one line', 33: 'an arc whose ends don\'t fit its centre', 36: 'a word GRBL doesn\'t use here' };
const MACH_ALARMS = { 1: 'a limit switch was hit: position is lost', 2: 'the move would go past the machine\'s travel', 3: 'reset while moving: position may be lost', 4: 'the probe was already touching', 5: 'the probe never touched', 6: 'homing was reset', 9: 'homing found no switch', 10: 'e-stop' };

// ---------- links ----------
async function machUsb(p, onText, onClose) {
  if (!navigator.serial) throw new Error("this copy of the app can't use USB ports");
  if (window.atelierWin && atelierWin.serialWant) atelierWin.serialWant(p.port);
  let port; try { port = await navigator.serial.requestPort(); } catch (e) { throw new Error(`${p.port} isn't there. Plug the machine in and switch it on, or pick another port`); }
  try { await port.open({ baudRate: +p.baud || 115200 }); } catch (e) { throw new Error(`${p.port} won't open. Candle or gSender may have it: close them first`); }
  const writer = port.writable.getWriter(), reader = port.readable.getReader(), dec = new TextDecoder('latin1'); let alive = true;
  (async () => { try { while (alive) { const { value, done } = await reader.read(); if (done) break; onText(dec.decode(value)); } } catch (e) {} if (alive) { alive = false; onClose(); } })();
  return {
    label: p.port, write: s => writer.write(Uint8Array.from(s, c => c.charCodeAt(0) & 255)).catch(() => {}),
    close: async () => { alive = false; try { await reader.cancel(); } catch (e) {} try { reader.releaseLock(); writer.releaseLock(); await port.close(); } catch (e) {} },
  };
}
const machTcp = new Map(); let machTcpWired = false;
async function machWifi(p, onText, onClose) {
  const W = window.atelierWin; if (!W || !W.tcpOpen) throw new Error("this copy of the app can't reach the network");
  if (!machTcpWired) { machTcpWired = true; W.onTcp((id, t) => { const h = machTcp.get(id); if (h) h.data(t); }, id => { const h = machTcp.get(id); machTcp.delete(id); if (h) h.closed(); }); }
  let id; try { id = await W.tcpOpen(p.host, +p.tcpPort || 23); } catch (e) { throw new Error(`no answer from ${p.host}. Check the machine is on and on the same Wi-Fi`); }
  machTcp.set(id, { data: t => onText(t.replace(/\xff[\xfb-\xfe][\s\S]|\xff[\xf0-\xfa]/g, '')), closed: onClose });   // telnet's own bytes are dropped
  return { label: `${p.host}:${p.tcpPort}`, write: s => W.tcpWrite(id, s), close: async () => { machTcp.delete(id); W.tcpClose(id); } };
}

// A simulated GRBL 1.1h: buffers and acknowledges like the real one, moves at the feed (times `speed`), holds, resets,
// jogs, checks, and goes into alarm when reset while moving. For practising, and for the tests.
function machSim(onText, speed = 1) {
  const S = { m: [0, 0, 0], p: [0, 0, 0], wco: [0, 0, 0], plan: [], wait: [], hold: false, alarm: false, check: false, abs: true, k: 1, f: 0, rel: false, spindle: 0, ov: [100, 100, 100], line: '', jog: false, alive: true, speed };
  const say = t => setTimeout(() => S.alive && onText(t + '\r\n'));
  const fmt = v => v.map(x => x.toFixed(3)).join(',');
  const moving = () => S.plan.length > 0;
  const state = () => S.alarm ? 'Alarm' : S.check ? 'Check' : S.hold ? 'Hold:0' : moving() ? (S.plan[0].jog ? 'Jog' : 'Run') : 'Idle';
  const reset = () => { if (moving() && !S.hold) S.alarm = true; S.plan = []; S.p = S.m.slice(); S.wait = []; S.hold = false; S.spindle = 0; S.check = false; S.abs = true; S.k = 1; S.line = ''; say("Grbl 1.1h ['$' for help]"); if (S.alarm) say('[MSG:Reset to continue]'); };
  const admit = () => { while (S.wait.length && S.plan.length < 15) { const w = S.wait.shift(); if (w.move) S.plan.push(w.move); say('ok'); } };
  const words = l => [...l.matchAll(/([A-Z])\s*([-+]?(?:\d+\.?\d*|\.\d+))/g)].map(m => [m[1], parseFloat(m[2])]);
  function line(raw) {
    const l = raw.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim().toUpperCase(); if (!l) { say('ok'); return; }
    if (l === '$X') { S.alarm = false; say('[MSG:Caution: Unlocked]'); say('ok'); return; }
    if (l === '$$') { ['$0=10', '$30=1000', '$32=0', '$100=400.000', '$101=400.000', '$102=400.000', '$110=1500.000', '$111=1500.000', '$112=600.000', '$130=300.000', '$131=180.000', '$132=45.000'].forEach(say); say('ok'); return; }
    if (l === '$I') { say('[VER:1.1h.20250722:]'); say('[OPT:VZL,15,128]'); say('ok'); return; }
    if (l === '$C') { S.check = !S.check; say(`[MSG:${S.check ? 'Enabled' : 'Disabled'}]`); say('ok'); if (!S.check) reset(); return; }
    if (l.startsWith('$J=')) {
      if (S.alarm) { say('error:9'); return; }
      const w = words(l.slice(3)), rel = /G91/.test(l), to = S.p.slice(); let f = 0; w.forEach(([c, v]) => { const i = 'XYZ'.indexOf(c); if (i >= 0) to[i] = rel ? S.p[i] + v : v + S.wco[i]; if (c === 'F') f = v; });
      if (!(f > 0)) { say('error:16'); return; } S.plan.push({ to, f, jog: true }); S.p = to.slice(); say('ok'); return;
    }
    if (l[0] === '$') { say('error:3'); return; }
    if (S.alarm) { say('error:9'); return; }
    let motion = null, move = null, dwell = 0; const w = words(l), axes = {};
    for (const [c, v] of w) {
      if (c === 'G') { if ([0, 1, 2, 3].includes(v)) motion = v; else if (v === 90) S.abs = true; else if (v === 91) S.abs = false; else if (v === 20) S.k = 25.4; else if (v === 21) S.k = 1; else if (v === 4) dwell = 1; else if (v === 10) motion = 'G10'; else if (![17, 94, 54, 40, 49, 80, 53].includes(v)) { say('error:20'); return; } }
      else if (c === 'M') { if (v === 3 || v === 4) S.spindle = S.spindle || 1000; else if (v === 5 || v === 30 || v === 2) S.spindle = 0; else if (![7, 8, 9].includes(v)) { say('error:20'); return; } }
      else if (c === 'S') S.spindle = v; else if (c === 'F') S.f = v * S.k; else axes[c] = v;
    }
    if (motion === 'G10') { const at = axes.P === 1 || axes.P === undefined; if (/L20/.test(l) && at) ['X', 'Y', 'Z'].forEach((c, i) => { if (c in axes) S.wco[i] = S.p[i] - axes[c] * S.k; }); say('ok'); return; }
    if (motion === null && ['X', 'Y', 'Z'].some(c => c in axes)) motion = S.lastMotion ?? null;
    if (motion !== null) S.lastMotion = motion;
    if (motion !== null && !dwell && ['X', 'Y', 'Z'].some(c => c in axes)) {
      if (motion !== 0 && !(S.f > 0)) { say('error:22'); return; }
      const to = S.p.slice(); ['X', 'Y', 'Z'].forEach((c, i) => { if (c in axes) to[i] = S.abs ? axes[c] * S.k + S.wco[i] : S.p[i] + axes[c] * S.k; });
      move = { to, f: motion === 0 ? 1500 : S.f }; if (!S.check) S.p = to.slice();
    }
    if (S.check) { say('ok'); return; }
    S.wait.push({ move }); admit();
  }
  const tick = setInterval(() => {
    if (!S.alive) return; const dt = .02 * S.speed;
    let budget = dt; while (budget > 0 && S.plan.length && !S.hold) {
      const p = S.plan[0], d = Math.hypot(p.to[0] - S.m[0], p.to[1] - S.m[1], p.to[2] - S.m[2]), rate = p.f / 60 * (p.jog ? 1 : (p.f >= 1500 ? S.ov[1] : S.ov[0]) / 100), step = rate * budget;
      if (step >= d) { S.m = p.to.slice(); S.plan.shift(); budget -= d / Math.max(rate, 1e-9); admit(); } else { S.m = S.m.map((v, i) => v + (p.to[i] - v) * step / d); budget = 0; }
    }
  }, 20);
  return {
    label: 'Practice machine', sim: S,
    write(s) {
      for (const ch of s) {
        const c = ch.charCodeAt(0);
        if (ch === '?') { const st = state(); say(`<${st}|MPos:${fmt(S.m)}|FS:${S.plan.length && !S.hold ? Math.round(S.plan[0].f) : 0},${S.spindle}|WCO:${fmt(S.wco)}|Ov:${S.ov.join(',')}>`); }
        else if (ch === '!') { if (moving()) S.hold = true; }
        else if (ch === '~') S.hold = false;
        else if (c === 0x18) reset();
        else if (c === 0x85) { if (S.plan.length && S.plan[0].jog) { S.plan = S.plan.filter(p => !p.jog); S.p = S.m.slice(); } }
        else if (c >= 0x90 && c <= 0x9b) { const o = S.ov; if (c === 0x90) o[0] = 100; if (c === 0x91) o[0] = Math.min(200, o[0] + 10); if (c === 0x92) o[0] = Math.max(10, o[0] - 10); if (c === 0x95) o[1] = 100; if (c === 0x96) o[1] = 50; if (c === 0x97) o[1] = 25; if (c === 0x99) o[2] = 100; if (c === 0x9a) o[2] = Math.min(200, o[2] + 10); if (c === 0x9b) o[2] = Math.max(10, o[2] - 10); }
        else if (ch === '\n') { const l = S.line; S.line = ''; line(l); }
        else if (ch !== '\r') S.line += ch;
      }
    },
    close: async () => { S.alive = false; clearInterval(tick); },
    start() { say("Grbl 1.1h ['$' for help]"); },
    // the board restarting by itself, as a power dip or a crash does: it counts from zero wherever the head is, keeps its work offsets (G54)
    reboot() { S.plan = []; S.wait = []; S.hold = false; S.alarm = false; S.check = false; S.spindle = 0; S.abs = true; S.k = 1; S.line = ''; S.m = [0, 0, 0]; S.p = [0, 0, 0]; say("Grbl 1.1h ['$' for help]"); },
  };
}

// ---------- talking GRBL ----------
const M = { link: null, kind: '', st: { state: 'Off', w: [0, 0, 0], m: [0, 0, 0], wco: [0, 0, 0], f: 0, s: 0, ov: [100, 100, 100] }, buf: '', sent: [], queue: [], job: null, log: [], poll: 0, spindle: false, connecting: false };
const machOn = () => !!M.link;
const machBusy = () => /^(Run|Jog|Hold|Check)/.test(M.st.state) || !!(M.job && !M.job.done);
function machLog(t, kind = '') { M.log.push({ t, kind }); if (M.log.length > 400) M.log.splice(0, M.log.length - 400); machConsole(); }
function machWrite(s) { if (M.link) M.link.write(s); }
function machRealtime(c) { machWrite(c); }
// a command line, sent when there's room in GRBL's buffer; `job` lines carry their index in the job
function machSend(line, job = null, quiet = false) { M.queue.push({ line, job, quiet }); machPump(); }
function machPump() {
  if (!M.link) return; let used = M.sent.reduce((n, x) => n + x.len, 0);
  while (M.queue.length) { const q = M.queue[0], len = q.line.length + 1; if (M.sent.length && (used + len > MACH_RX || machOneByOne())) break; M.queue.shift(); M.sent.push({ ...q, len }); used += len; machWrite(q.line + '\n'); if (q.job === null && !q.quiet) machLog(q.line, 'out'); }
  if (M.job && !M.job.done && !M.job.paused && M.queue.length === 0) machJobFeed();
}
function machText(t) {
  M.buf += t; let i;
  while ((i = M.buf.indexOf('\n')) >= 0) { const l = M.buf.slice(0, i).replace(/\r$/, ''); M.buf = M.buf.slice(i + 1); if (l.trim()) machLine(l.trim()); }
}
function machLine(l) {
  if (l[0] === '<') { machStatus(l); return; }
  if (l === 'ok' || l.startsWith('error:')) {
    const done = M.sent.shift(), err = l.startsWith('error:') ? +l.slice(6) : 0;
    if (err) { const why = MACH_ERRORS[err] || `error ${err}`; machLog(`${done ? done.line + ': ' : ''}${why} (error:${err})`, 'bad'); if (done && done.job !== null && M.job) machJobError(done, err, why); }
    if (done && done.job !== null && M.job) { M.job.acked = Math.max(M.job.acked, done.job + 1); machJobProgress(); }
    if (done && done.quiet) { M.quiet = false; if (!err) machFromSettings(); }
    machPump(); return;
  }
  const sv = /^\$(\d+)=(-?[\d.]+)/.exec(l); if (sv) { (M.settings = M.settings || {})[+sv[1]] = +sv[2]; if (M.quiet) return; }
  if (l.startsWith('ALARM:')) { const n = +l.slice(6); machLog(`Alarm: ${MACH_ALARMS[n] || 'alarm ' + n}. Check the machine, then Unlock.`, 'bad'); if (M.job && !M.job.done) machJobEnd(`Stopped by an alarm: ${MACH_ALARMS[n] || n}`); machRender(); return; }
  if (/^Grbl /.test(l)) {
    const j = M.job; M.sent = []; M.queue = [];
    if (j && !j.done && !j.check) {   // nobody asked for this reset: the board restarted by itself, mid-cut
      M.restart = machRestartInfo(j); M.from = M.restart.from; machShow('find');
      machJobEnd('Stopped: the machine restarted by itself. It has lost its position, so X0 Y0 and Z0 no longer match the board. Use Find zero again before carrying on.'); if (!machEl.open) machOpen();
    } else if (j && !j.done) machJobEnd('Stopped: the machine was reset');
    machLog(l); machRender(); return;
  }
  machLog(l);
}
function machStatus(l) {
  const parts = l.slice(1, -1).split('|'), st = M.st; st.state = parts[0];
  parts.slice(1).forEach(p => { const [k, v] = p.split(':'), n = (v || '').split(',').map(Number);
    if (k === 'MPos') { st.m = n; st.w = n.map((x, i) => x - st.wco[i]); } else if (k === 'WPos') { st.w = n; st.m = n.map((x, i) => x + st.wco[i]); } else if (k === 'WCO') { st.wco = n; st.w = st.m.map((x, i) => x - n[i]); } else if (k === 'FS') { st.f = n[0]; st.s = n[1] || 0; } else if (k === 'F') st.f = n[0]; else if (k === 'Ov') st.ov = n; else if (k === 'Bf') st.bf = n; });
  if (!M.asked && M.link && !/^(Run|Hold|Jog|Door)/.test(st.state)) { M.asked = true; M.settings = {}; M.quiet = true; machSend('$$', null, true); }   // what it says about itself
  if (M.restart && !M.restart.m0) M.restart.m0 = st.m.slice();   // where the machine counts from since it restarted
  machWatchStarve();
  if (M.job && !M.job.done && M.job.sentAll && !M.sent.some(x => x.job !== null) && st.state === 'Idle') machJobEnd(null);
  machFollowTool(); machRenderLive();
}
async function machConnect() {
  if (M.link || M.connecting) return; const p = machProfile; M.connecting = true; machRender();
  M.earlyClose = false; M.asked = false; M.quiet = false;
  const onClose = () => {
    if (!M.link) { if (M.connecting) M.earlyClose = true; return; } const quick = Date.now() - M.linkAt < 4000; M.link = null; clearInterval(M.poll); M.st.state = 'Off';
    if (M.job && !M.job.done) machJobEnd('The connection was lost while running. Switch the machine off if it is still moving.');
    // a board that takes one connection at a time lets a second one in, then drops it
    if (quick && M.kind === 'wifi') { machLog('The machine closed the connection straight away. Candle, gSender or its web page may be connected to it: it talks to one program at a time. Close the other one, then connect again.', 'bad'); toast('The machine dropped the connection. Is Candle or gSender connected to it?', true); }
    else machLog('Disconnected', 'bad');
    machRender();
  };
  try {
    M.link = p.link === 'sim' ? machSim(machText, M.simSpeed || 1) : p.link === 'wifi' ? await machWifi(p, machText, onClose) : await machUsb(p, machText, onClose);
    M.kind = p.link; M.linkAt = Date.now(); M.sent = []; M.queue = []; M.buf = ''; M.st.state = 'Connecting'; machLog(`Connected to ${M.link.label}`);
    if (M.earlyClose) { M.earlyClose = false; onClose(); M.connecting = false; machRender(); return; }   // dropped before we'd even finished connecting
    if (M.link.start) M.link.start();
    clearInterval(M.poll); M.poll = setInterval(() => machWrite('?'), 200);
    const link = M.link;
    setTimeout(() => { if (M.link && M.st.state === 'Connecting') { machWrite('\r\n'); machSend('$I'); } }, 2500);   // no greeting yet (some boards say nothing over Wi-Fi): ask
    setTimeout(() => { if (M.link === link && M.st.state === 'Connecting') machLog('No answer from the machine. If Candle, gSender or its web page is connected to it, close that: it talks to one program at a time.', 'bad'); }, 5000);
  } catch (e) { M.link = null; machLog(`Couldn't connect: ${e.message}.`, 'bad'); toast(`Couldn't connect: ${e.message}.`, true); }
  M.connecting = false; machRender();
}
async function machDisconnect() { if (!M.link) return; if (machBusy() && !confirm('The machine is busy. Disconnect anyway? It will carry on with what it has already been sent.')) return; const l = M.link; M.link = null; clearInterval(M.poll); M.st.state = 'Off'; M.sent = []; M.queue = []; if (M.job && !M.job.done) machJobEnd('Disconnected'); await l.close(); machLog('Disconnected'); machRender(); }

// ---------- stopping ----------
// Emergency stop: a reset, at once. GRBL stops moving and turns the spindle off; it may lose its position (alarm 3).
function machEstop() {
  if (!M.link) { toast('Not connected. Switch the machine off at its power switch.', true); return; }
  machRealtime('\x18'); M.queue = []; M.sent = []; M.spindle = false;
  if (M.job && !M.job.done) machJobEnd('Emergency stop'); machLog('EMERGENCY STOP: reset sent. Check the machine, then Unlock and set zero again.', 'bad');
  toast('Emergency stop sent. Check the machine before unlocking.', true); machRender();
}
// a gentler stop for a job: hold first so position is kept, then reset
function machStop() {
  if (!M.link) return; const link = M.link; machRealtime('!'); M.queue = [];
  // only ever resets the connection it was asked on: a reset reaching a later connection would stop a new job
  const t0 = Date.now(), wait = setInterval(() => { if (M.link !== link) { clearInterval(wait); return; } if (M.st.state === 'Hold:0' || M.st.state === 'Idle' || Date.now() - t0 > 2000) { clearInterval(wait); link.write('\x18'); M.sent = []; } }, 50);
  if (M.job && !M.job.done) machJobEnd('Stopped'); machRender();
}

// ---------- the job ----------
// Comments and blank lines aren't sent; each sent line keeps its line number in the file, to follow it in 3D.
function machJobLines(text) { const out = []; text.split(/\r?\n/).forEach((raw, i) => { const l = raw.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').replace(/\s+/g, ' ').trim(); if (l && l !== '%') out.push({ l, n: i + 1 }); }); return out; }
// The height of the bit after each line, from the Z words, or NaN where it can't be known (relative moves).
function machJobZ(lines) {
  let z = NaN, abs = true, k = 1;
  return lines.map(({ l }) => {
    const u = l.toUpperCase(); if (/G20(?!\d)/.test(u)) k = 25.4; if (/G21(?!\d)/.test(u)) k = 1; if (/G91(?!\.)/.test(u)) abs = false; if (/G90(?!\.)/.test(u)) abs = true;
    const m = u.match(/Z\s*([-+]?(?:\d+\.?\d*|\.\d+))/); if (m && !/G10|G28|G30|G53|G92/.test(u)) z = abs ? +m[1] * k : z + +m[1] * k;
    return abs ? z : NaN;
  });
}
// Starting part-way: what the file has set up by line `from` (its line number), and the moves that set it up again safely:
// up to the safe height, the spindle up to speed, over the point where that line starts, then down to its height.
function machResumeLines(text, from) {
  const all = machJobLines(text), before = all.filter(L => L.n < from), rest = all.filter(L => L.n >= from);
  if (!rest.length) throw new Error(`the file ends before line ${from}`);
  let x = 0, y = 0, z = NaN, f = 0, plunge = 0, s = 0, on = false, motion = 'G0', inch = false, rel = false;
  before.forEach(({ l }) => {
    const u = l.toUpperCase(), w = {}; [...u.matchAll(/([A-Z])\s*([-+]?(?:\d+\.?\d*|\.\d+))/g)].forEach(m => { if (m[1] === 'G') { const g = parseFloat(m[2]); if (g <= 3) motion = 'G' + g; if (g === 20) inch = true; if (g === 21) inch = false; if (g === 91) rel = true; if (g === 90) rel = false; } else w[m[1]] = +m[2]; });
    if (/G10|G28|G30|G53|G92|G4(?!\d)/.test(u)) return;
    if ('F' in w) f = w.F; if ('S' in w) s = w.S; if (/M0?[34](?!\d)/.test(u)) on = true; if (/M0?5(?!\d)|M30|M0?2(?!\d)/.test(u)) on = false;
    if ('Z' in w && !('X' in w) && !('Y' in w) && motion === 'G1' && 'F' in w) plunge = w.F;
    if ('X' in w) x = w.X; if ('Y' in w) y = w.Y; if ('Z' in w) z = w.Z;
  });
  if (rel) throw new Error('the file moves by relative amounts (G91) before that line, so it can only start from the top');
  const safe = +machProfile.safeZ || 5, n = from, sz = inch ? safe / 25.4 : safe, up = Math.max(sz, isNaN(z) ? sz : z), r = v => +v.toFixed(4);
  const pre = [`${inch ? 'G20' : 'G21'} G90 G17 G94`, `G0 Z${r(up)}`];
  if (on && s > 0) pre.push(`M3 S${Math.round(s / 4)}`, 'G4 P1', `M3 S${Math.round(s / 2)}`, 'G4 P1', `M3 S${Math.round(s * 3 / 4)}`, 'G4 P1', `M3 S${s}`, 'G4 P2');
  pre.push(`G0 X${r(x)} Y${r(y)}`);
  if (!isNaN(z) && z < up) { const near = inch ? 1 / 25.4 : 1; if (z < near) { pre.push(`G0 Z${r(Math.max(z, near))}`); pre.push(`G1 Z${r(z)} F${Math.round(plunge || Math.min(f || 100, 100))}`); } else pre.push(`G0 Z${r(z)}`); }
  if (f > 0) pre.push(`G1 F${f}`);
  // the first line carries on the file's motion (G0 to G3) if it doesn't say its own
  const first = rest[0], hasG = /G0*[0-3](?![\d.])/i.test(first.l), hasXYZ = /[XYZ]/i.test(first.l);
  const lines = pre.map(l => ({ l, n })).concat([{ l: hasXYZ && !hasG ? `${motion} ${first.l}` : first.l, n: first.n }], rest.slice(1));
  return { lines, at: { x, y, z, f, s, on } };
}
function machJobStart(src, check, from = 1) {
  let lines;
  if (from > 1 && !check) { try { lines = machResumeLines(src.text, from).lines; } catch (e) { toast(`Can't start from line ${from}: ${e.message}.`, true); return; } }
  else lines = machJobLines(src.text);
  if (!lines.length) { toast('That file has nothing to send.', true); return; }
  if (!check) { M.restart = null; M.from = 1; } M.paper = null;   // a later Start begins at the top again unless told otherwise; a Check keeps what's known about a restart
  M.job = { name: src.name, lines, z: machJobZ(lines), next: 0, acked: 0, started: Date.now(), check: !!check, errors: [], paused: false, done: false, sentAll: false, total: src.minutes || 0, from: from > 1 ? from : 0, starve: [0, 0] };
  if (!check && typeof cvOpen === 'function' && cvOpen() && (!CV3D.gcode || CV3D.gcode.text !== src.text)) cvGcodeOpenText(src.text, src.name).catch(() => {});   // follow it in 3D
  if (check) machSend('$C');
  machLog(`${check ? 'Checking' : 'Running'} ${src.name}: ${lines.length} lines${M.job.from ? `, from line ${from}` : ''}`); machPump(); machRender();
}
// What's known when the board restarts mid-job. GRBL has said ok to `acked` lines, and up to 16 of those may still have
// been waiting in its planner, so the bit was somewhere in that stretch. If the depth is the same all through it, that's the
// depth the bit was at, and Z0 can be found from it. `from` is the start of the cut it was on: the last time the bit was above the board.
function machRestartInfo(j) {
  // the last 17 moves it said ok to (lines without X, Y or Z take no room in the planner), and the line before the oldest,
  // since the oldest may have been under way, starting from that line's height
  const last = j.acked; let lo = last, moves = 0; while (lo > 0 && moves < 17) { lo--; if (/[XYZ]/i.test(j.lines[lo].l)) moves++; } lo = Math.max(0, lo - 1);
  const span = j.z.slice(lo, Math.max(lo + 1, last));
  const depth = last > 0 && span.every(v => Number.isFinite(v) && Math.abs(v - span[0]) < 1e-6) && span[0] < 0 ? span[0] : null;
  let i = lo - 1; while (i >= 0 && !(j.z[i] >= 0)) i--;
  const from = j.lines[Math.min(j.lines.length - 1, i + 1)].n, at = j.lines[Math.max(0, last - 1)].n;
  return { name: j.name, depth, from: Math.max(1, from), at, m0: null };
}
// One line at a time keeps the planner fed only if each ok comes back quickly. If its queue keeps running empty while
// cutting, the bit is stopping between lines, which leaves marks: say so once.
function machWatchStarve() {
  const j = M.job, bf = M.st.bf; if (!j || j.done || j.check || !bf || !machOneByOne() || M.st.state !== 'Run') return;
  j.starve[0]++; if (bf[0] >= 13) j.starve[1]++;
  if (j.starve[0] >= 50) { if (j.starve[1] / j.starve[0] > .6 && !j.starveSaid) { j.starveSaid = true; machLog('The machine keeps running out of moves: sending one line at a time is too slow here, so the bit pauses between lines. Fast sending in Machine profile avoids it, if this machine copes with it.', 'bad'); } j.starve = [0, 0]; }
}

// ---------- finding zero again ----------
// After a restart, X0 Y0 and Z0 point at the wrong place. A point of the cut whose place is known, like a sharp corner of an
// engraving or the end of a groove, gives it back: pick it on the board, put the bit on it, and say that's where it is.
let machPickOn = false; const machCutPts = { text: null, pts: [] };
function machCutPoints(text) {   // the ends of every cutting move, below the board top, in the file's own coordinates
  if (machCutPts.text === text) return machCutPts.pts;
  const pts = []; try { cvGcodeParse(text).moves.forEach(m => { if (!m.rapid && m.b[2] < 0) pts.push([m.b[0], m.b[1]]); }); } catch (e) {}
  machCutPts.text = text; machCutPts.pts = pts; return pts;
}
// a click on Carve's board, while picking: snaps to the nearest end of a cut within 15 pixels
function machPickAt(p) {
  if (!machPickOn || !P.carve) return false; machPickOn = false; document.body.classList.remove('mach-picking');
  const [zx, zy] = cvZeroAt(P.carve), src = machSources().find(s => s.key === machSrcKey); let best = null, bd = 15 * (cvView ? cvView.k : 1);
  if (src) machCutPoints(src.text).forEach(q => { const d = Math.hypot(q[0] + zx - p[0], q[1] + zy - p[1]); if (d < bd) { bd = d; best = q; } });
  M.find = best ? { x: best[0], y: best[1], snapped: true } : { x: p[0] - zx, y: p[1] - zy, snapped: false };
  machShow('find'); machOpen(); if (cvOpen()) cvStageRender(); return true;   // the popup was closed to pick: back it comes
}
function machPickSvg(px) {   // the picked point, drawn on the board
  if (!M.find || !P.carve) return ''; const [zx, zy] = cvZeroAt(P.carve), x = M.find.x + zx, y = P.carve.board.w - (M.find.y + zy), r = 7 * px;
  return `<g pointer-events="none" id="machPick"><circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="#c0392b" stroke-width="${1.5 * px}"/><path d="M${x - r * 1.8} ${y}H${x - r * .4}M${x + r * .4} ${y}H${x + r * 1.8}M${x} ${y - r * 1.8}V${y - r * .4}M${x} ${y + r * .4}V${y + r * 1.8}" stroke="#c0392b" stroke-width="${1.5 * px}"/></g>`;
}
// The paper test: down to 0.2 mm, then 0.1 mm, over plain wood. Each answer moves Z0 by half the step and goes back to the same height.
function machPaper(a) {
  const P2 = M.paper; if (!M.link) return;
  if (a === 'paper') { M.paper = { at: .2 }; machSend('G90'); if (M.st.w[2] < 1) machSend('G0 Z1'); machSend('G1 Z0.2 F100'); machRender(); return; }
  if (!P2) return; const d = P2.at > .15 ? .1 : .05;
  if (a === 'paperNext') { P2.at = .1; machSend('G1 Z0.1 F50'); }
  else if (a === 'paperLow') { machSend(`G10 L20 P1 Z${+(P2.at - d).toFixed(3)}`); machSend(`G1 Z${P2.at} F50`); P2.moved = (P2.moved || 0) + d; machLog(`Z0 raised by ${d} mm`); }   // pinched: the board top is higher than Z0 said
  else if (a === 'paperHigh') { machSend(`G10 L20 P1 Z${+(P2.at + d).toFixed(3)}`); machSend(`G1 Z${P2.at} F50`); P2.moved = (P2.moved || 0) - d; machLog(`Z0 lowered by ${d} mm`); }
  else if (a === 'paperEnd' || a === 'paperOk') { M.paper = null; machSend('G91 G0 Z' + (+machProfile.safeZ || 5)); machSend('G90'); if (a === 'paperOk') toast('Z0 checked.'); }
  machRender();
}
function machJobFeed() {
  const j = M.job; if (!j || j.done || j.paused) return; let used = M.sent.reduce((n, x) => n + x.len, 0);
  while (j.next < j.lines.length) { const L = j.lines[j.next], len = L.l.length + 1; if (M.sent.length && (used + len > MACH_RX || machOneByOne())) break; M.sent.push({ line: L.l, job: j.next, len }); used += len; machWrite(L.l + '\n'); j.next++; }
  if (j.next >= j.lines.length && !j.sentAll) { j.sentAll = true; if (j.check) machSend('$C'); }
  if (j.check && j.sentAll && !M.sent.length) machJobEnd(null);
}
function machJobError(done, err, why) {
  const j = M.job, L = j.lines[done.job]; j.errors.push(`Line ${L.n}: ${L.l} - ${why}`);
  if (j.check) return;
  machRealtime('!'); j.paused = true; j.problem = `Line ${L.n} (${L.l}) was refused: ${why}. The machine is held. Resume skips that line; Stop ends the job.`; machRender();
}
function machJobEnd(why) {
  const j = M.job; if (!j || j.done) return; j.done = true; j.why = why; j.ended = Date.now();
  if (j.check) { const msg = j.errors.length ? `Check found ${j.errors.length} problem${j.errors.length > 1 ? 's' : ''}.` : 'Check passed: GRBL accepts every line.'; machLog(msg, j.errors.length ? 'bad' : ''); toast(msg, !!j.errors.length); }
  else if (!why) { machLog(`${j.name} done in ${Math.round((j.ended - j.started) / 60000)} min.`); toast(`${j.name} is done.`); }
  else machLog(`${j.name}: ${why}`, 'bad');
  machRender();
}
function machPause() { if (!M.job || M.job.done) { machRealtime('!'); return; } M.job.paused = true; machRealtime('!'); machRender(); }
function machResume() { machRealtime('~'); if (M.job && !M.job.done) { M.job.paused = false; M.job.problem = null; machPump(); } machRender(); }
let machFollowAt = 0;
function machJobProgress() {
  const j = M.job; if (!j || j.check || typeof CV3D === 'undefined' || !CV3D.gcode || !CV3D.play || Date.now() - machFollowAt < 200) return; machFollowAt = Date.now();
  const n = j.acked > 0 ? j.lines[j.acked - 1].n : 0, steps = CV3D.play.steps; let t = 0;
  for (let i = 0; i < steps.length && steps[i].line <= n; i++) t = steps[i].t;   // the planner runs a little ahead of the bit
  cvPlaySeek(t);
}
function machFollowTool() {   // the bit is drawn where the machine says it is
  if (!M.job || M.job.done || M.job.check || typeof CV3D === 'undefined' || !CV3D.gcode || !CV3D.tool || !P.carve) return;
  const [zx, zy] = cvZeroAt(P.carve); CV3D.tool.position.set(M.st.w[0] + zx, M.st.w[1] + zy, M.st.w[2]); cv3dDraw();
}
// what can be sent: the file being looked at, and each file of the open carving
function machSources() {
  const out = [];
  if (typeof CV3D !== 'undefined' && CV3D.gcode && CV3D.gcode.text) out.push({ key: 'view', name: CV3D.gcode.name, text: CV3D.gcode.text, bit: (cvBitOf(CV3D.gcode.bit) || {}).name, minutes: CV3D.gcode.G.total });
  if (P && P.carve && P.carve.items && P.carve.items.length && P.kind === 'carve') { try { cvJob(P.carve, cvBitOf, P.name).forEach((f, i, all) => out.push({ key: 'job' + i, name: `${P.name}, file ${i + 1} of ${all.length}`, text: f.text, bit: (typeof f.bit === 'object' ? f.bit : cvBitOf(f.bit) || { name: String(f.bit) }).name, minutes: f.minutes })); } catch (e) {} }
  return out;
}

// ---------- the popup ----------
// Built like Your bits: a header with the rail's icon, the machine itself on the left (where it is, zero, jog), and what
// to do with it on the right, in tabs. It's modal, so it carries its own STOP; the floating one shows when it's closed.
const machEl = document.createElement('dialog'); machEl.id = 'mach'; machEl.className = 'wsDlg'; machEl.tabIndex = -1; machEl.setAttribute('aria-label', 'My machine'); document.body.appendChild(machEl);
const estop = document.createElement('button'); estop.id = 'machStop'; estop.hidden = true; estop.title = 'Emergency stop (Pause key): resets GRBL at once. Your power switch is the real one.'; estop.innerHTML = `${ic('octagon-x')}<span>STOP</span>`; document.body.appendChild(estop);
estop.onclick = machEstop;
let machJogStep = 1, machSrcKey = '', machOpenSecs = new Set(['job']), machTab = 'job';
const machShow = k => { machOpenSecs.add(k); machTab = k; };
function machOpen(what) { if (what === 'view') machSrcKey = 'view'; else if (what === 'job') machSrcKey = 'job0'; if (what === 'view' || what === 'job') machTab = 'job'; if (!machEl.open) machEl.showModal(); machRender(); machEl.focus(); }
machEl.addEventListener('close', () => { machRender(); });
const mf = v => (Math.round(v * 1000) / 1000).toFixed(3);
const mBtn = (act, label, icon, extra = '') => `<button class="btn line" data-m="${act}" ${extra}>${icon ? ic(icon) : ''}${label}</button>`;
const MACH_TABS = [['job', 'Job'], ['run', 'Spindle and speed'], ['find', 'Find zero'], ['console', 'Console'], ['profile', 'Machines']];
const machStateOf = () => (M.connecting ? 'Connecting' : M.link ? M.st.state.split(':')[0] : 'Off');
function machRailMark() { const b = document.getElementById('cvMach'); if (b) b.dataset.st = machStateOf(); }
function machLinkNote(p) { return p.link === 'sim' ? 'Practice machine: nothing real moves' : p.link === 'wifi' ? `${p.name}, over Wi-Fi at ${p.host}` : `${p.name}, over USB on ${p.port}`; }
function machRender() {
  estop.hidden = !M.link || machEl.open; machRailMark();
  if (!machEl.open) return;
  const p = machProfile, on = !!M.link, j = M.job, idle = on && /^(Idle|Check)/.test(M.st.state) && !(j && !j.done), alarm = /^Alarm/.test(M.st.state), srcs = machSources();
  if (!srcs.some(s => s.key === machSrcKey)) machSrcKey = srcs.length ? srcs[0].key : '';
  const dis = c => (c ? '' : 'disabled');
  // header
  let h = `<header class="wsHead"><span class="wsMark">${ic('plug')}</span><div class="wsTitle"><h2>My machine</h2><p>${esc(machLinkNote(p))}</p></div>`
    + `<span class="mstate" data-st="${esc(machStateOf())}">${M.connecting ? 'Connecting…' : on ? esc(M.st.state) : 'Not connected'}</span>`
    + (on ? `<button class="mstop" data-m="estop" title="Emergency stop (Pause key): resets GRBL at once. Your power switch is the real one.">${ic('octagon-x')}STOP</button>` : '')
    + `<button class="btn main" data-m="close" title="The machine stays connected">Done</button></header>`;
  // left: the machine
  let L = `<div class="mrow mwhich"><select data-m-use ${dis(!on)} aria-label="Which machine" title="${on ? 'Disconnect to change machine' : 'Which machine'}">${machMachines.list.map(m => `<option value="${esc(m.id)}" ${m === p ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select><button class="ic" data-m="machines" title="Add or change machines" aria-label="Add or change machines">${ic('plus')}</button></div>`
    + `<div class="mrow mconn"><select data-mp="link" ${dis(!on)} aria-label="How it's connected"><option value="usb" ${p.link === 'usb' ? 'selected' : ''}>USB cable</option><option value="wifi" ${p.link === 'wifi' ? 'selected' : ''}>Wi-Fi</option><option value="sim" ${p.link === 'sim' ? 'selected' : ''}>Practice, no machine</option></select>`
    + (p.link === 'usb' ? `<select data-mp="port" ${dis(!on)} aria-label="Port" class="mport">${[...new Set([p.port, ...(M.ports || []).map(x => x.name)])].map(n => `<option ${n === p.port ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select><button class="ic" data-m="ports" ${dis(!on)} title="Look for ports again" aria-label="Look for ports">${ic('refresh-cw')}</button>` : p.link === 'wifi' ? `<input data-mp="host" value="${esc(p.host)}" ${dis(!on)} aria-label="Address" class="mhost"><input data-mp="tcpPort" value="${esc(p.tcpPort)}" ${dis(!on)} aria-label="Port" class="mport">` : '')
    + (on ? mBtn('disconnect', 'Disconnect') : `<button class="btn main" data-m="connect" ${M.connecting ? 'disabled' : ''}>Connect</button>`) + '</div>';
  if (alarm) L += `<p class="mwarn">${ic('triangle-alert')}Locked by an alarm. Check the machine is clear, then ${mBtn('unlock', 'Unlock')}</p>`;
  L += `<div class="mdro" role="group" aria-label="Where the bit is, from X0 Y0 Z0">${['X', 'Y', 'Z'].map((a, i) => `<div class="mdrow"><span class="mdax">${a}</span><b data-mw="${i}">${mf(M.st.w[i])}</b><button class="btn line" data-m="zero${a}" ${dis(idle)} title="Make this ${a}0">Zero</button></div>`).join('')}<p class="mnote" data-mm>Machine: ${M.st.m.map(mf).join(', ')}</p></div>`;
  L += `<div class="mrow">${mBtn('zeroXY', 'Zero X and Y', 'crosshair', dis(idle) + ' title="Here becomes X0 Y0"')}${mBtn('zeroZ', 'Zero Z', 'arrow-down-to-line', dis(idle) + ' title="Touch the board top first (paper test), then Z0"')}${mBtn('paper', 'Paper test', 'ruler', dis(idle && !M.paper) + ' title="Checks Z0: over plain wood, the bit goes down to 0.2 mm, then 0.1 mm, for a sheet of paper under it"')}</div>`
    + `<div class="mrow">${mBtn('home', 'Go to X0 Y0', 'house', dis(idle) + ' title="Lifts by the safe height first, then goes to X0 Y0"')}${mBtn('raise', 'Lift the bit', 'chevron-up', dis(idle) + ` title="Up ${p.safeZ} mm"`)}</div>`;
  if (M.paper) L += `<div class="mpaper">` + (M.paper.at > .15
    ? `<p>Slide a sheet of paper under the bit. At 0.2 mm it should pass with a small gap.</p><div class="mrow">${mBtn('paperNext', 'Small gap: on to 0.1 mm', '', dis(idle))}${mBtn('paperLow', 'Pinched', '', dis(idle) + ' title="Z0 is too low: raise it 0.1 mm"')}${mBtn('paperHigh', 'Big gap', '', dis(idle) + ' title="Z0 is too high: lower it 0.1 mm"')}${mBtn('paperEnd', 'Stop', '', dis(on))}</div>`
    : `<p>At 0.1 mm the paper should just drag as it slides.</p><div class="mrow">${mBtn('paperOk', 'It drags: Z0 is right', '', dis(idle))}${mBtn('paperHigh', 'Slides freely', '', dis(idle) + ' title="Z0 is a little high: lower it 0.05 mm"')}${mBtn('paperLow', 'Pinched', '', dis(idle) + ' title="Z0 is a little low: raise it 0.05 mm"')}${mBtn('paperEnd', 'Stop', '', dis(on))}</div>`) + '</div>';
  const jb = (axis, dir, icon, label) => `<button class="btn line mj" data-jog="${axis}${dir}" ${dis(idle || M.st.state === 'Jog')} title="${label}" aria-label="${label}">${ic(icon)}<small>${axis}${dir > 0 ? '+' : '−'}</small></button>`;
  L += `<h3 class="mh">Jog</h3><div class="mjog"><span></span>${jb('Y', 1, 'chevron-up', 'Away from you (Y+)')}<span></span><span></span>${jb('Z', 1, 'chevron-up', 'Up (Z+)')}${jb('X', -1, 'chevron-left', 'Left (X−)')}<span class="mjc">${ic('crosshair')}</span>${jb('X', 1, 'chevron-right', 'Right (X+)')}<span></span><span></span><span></span>${jb('Y', -1, 'chevron-down', 'Towards you (Y−)')}<span></span><span></span>${jb('Z', -1, 'chevron-down', 'Down (Z−)')}</div>`
    + `<div class="mrow"><div class="mseg" role="radiogroup" aria-label="Jog step">${[.1, 1, 10, 0].map(s => `<button data-step="${s}" aria-checked="${machJogStep === s}" role="radio">${s ? s + ' mm' : 'Hold'}</button>`).join('')}</div><label class="mf">at<input data-mp="jogFeed" value="${p.jogFeed}" aria-label="Jog speed">mm/min</label></div>`
    + `<p class="mnote">Arrow keys move X and Y, Page Up and Page Down move Z. With Hold, it moves while held.</p>`;
  // right: what to do with it
  const T = {}, ov = M.st.ov;
  T.run = `<div class="mrow">${mBtn('spindle', M.spindle ? 'Spindle off' : 'Spindle on', 'drill', dis(idle))}<input type="range" min="10" max="100" step="5" value="${M.spinPct || 100}" data-mp="spinPct" aria-label="Spindle speed"><span class="mnote">${M.spinPct || 100}%</span></div>`
    + `<p class="mnote">While it cuts, these change the speeds without stopping.</p>`
    + `<div class="movr"><span>Feed</span>${mBtn('ov:\x92', '−10')}<b>${ov[0]}%</b>${mBtn('ov:\x91', '+10')}${mBtn('ov:\x90', '100%')}</div>`
    + `<div class="movr"><span>Rapids</span>${mBtn('ov:\x97', '25%')}${mBtn('ov:\x96', '50%')}${mBtn('ov:\x95', '100%')}<b>${ov[1]}%</b></div>`
    + `<div class="movr"><span>Spindle</span>${mBtn('ov:\x9b', '−10')}<b>${ov[2]}%</b>${mBtn('ov:\x9a', '+10')}${mBtn('ov:\x99', '100%')}</div>`;
  const rs = M.restart, canPick = !!(P && P.carve && P.kind === 'carve' && typeof cvOpen === 'function' && cvOpen());
  T.find = (rs ? `<p class="mwarn">${ic('triangle-alert')}It restarted while cutting ${esc(rs.name)}, around line ${rs.at}. Its position was lost.</p>` : '')
    + `<p class="mnote">Pick a point of the cut whose place you know, like a sharp corner of an engraving or the end of a groove. It snaps to the nearest end of a cut.</p>`
    + `<div class="mrow">${mBtn('pick', machPickOn ? 'Click the board…' : 'Pick on the board', 'crosshair', dis(canPick) + (canPick ? '' : ' title="Open the carving to pick on it"'))}<label class="mf">X<input data-mf="x" value="${M.find ? mf(M.find.x) : ''}" aria-label="X of the point"></label><label class="mf">Y<input data-mf="y" value="${M.find ? mf(M.find.y) : ''}" aria-label="Y of the point"></label></div>`
    + `<p class="mnote">Spindle off. Jog until the bit sits right on that point, with its tip just in the groove. Then:</p>`
    + `<div class="mrow">${mBtn('findXY', M.find ? `The bit is at X ${mf(M.find.x)}, Y ${mf(M.find.y)}` : 'The bit is on the point', 'crosshair', dis(idle && M.find) + ' title="Sets X0 Y0 back where they were (G10 L20 P1)"')}</div>`
    + (rs && rs.depth !== null && rs.m0 ? `<p class="mnote">It restarted during a pass ${esc(cvLenNote(-rs.depth))} deep. If this bit hasn't been taken out since, Z0 can be worked out from that, wherever the bit is now.</p><div class="mrow">${mBtn('findZ', 'Set Z0 from the cut', 'arrow-down-to-line', dis(idle))}</div>` : `<p class="mnote">Then set Z0 on the board top as usual, and check it with the paper test.</p>`);
  let jh = srcs.length ? `<label class="field">What to send<select data-m-src ${dis(!(j && !j.done))}>${srcs.map(s => `<option value="${s.key}" ${s.key === machSrcKey ? 'selected' : ''}>${esc(s.name)}${s.bit ? ', ' + esc(s.bit) : ''}</option>`).join('')}</select></label>` : '<p class="mnote">Open a carving, or a G-code file, to send it.</p>';
  if (j && !j.done) {
    const pct = Math.round(j.acked / j.lines.length * 100), mins = (Date.now() - j.started) / 60000;
    jh += `<div class="mprog"><div style="width:${pct}%"></div></div><p class="mnote" data-mprog>${j.check ? 'Checking' : 'Running'} ${esc(j.name)}: line ${j.acked} of ${j.lines.length} (${pct}%), ${Math.round(mins)} min${j.total ? ` of about ${Math.round(j.total)}` : ''}</p>`;
    if (j.problem) jh += `<p class="mwarn">${esc(j.problem)}</p>`;
    jh += `<div class="mrow">${j.paused || /^Hold/.test(M.st.state) ? mBtn('resume', 'Resume', 'play') : mBtn('pause', 'Pause', 'pause')}${mBtn('stop', 'Stop the job', 'square')}</div>`;
  } else {
    if (j && j.done) jh += `<p class="${j.why || (j.check && j.errors.length) ? 'mwarn' : 'mdone'}">${esc(j.name)}: ${esc(j.why || (j.check ? (j.errors.length ? j.errors.slice(0, 5).join('; ') : 'GRBL accepts every line.') : 'done.'))}</p>`;
    if (rs && M.from > 1) jh += `<p class="mnote">It was on line ${rs.at}. Starting from line ${M.from} cuts that part again from its beginning: the passes already made are gone over again without taking off any wood.</p>`;
    jh += `<div class="mrow">${mBtn('check', 'Check', 'square-check', dis(idle && srcs.length) + ' title="Runs it through GRBL without moving ($C), to find lines it would refuse"')}<label class="mf" title="Starts part-way: lifts, starts the spindle, goes over where that line starts and down to its height">from line<input data-m-from value="${M.from > 1 ? M.from : 1}" aria-label="Start from line"></label><span class="grow"></span><button class="btn main" data-m="start" ${dis(idle && srcs.length)}>${ic('play')}Start</button></div>`;
  }
  T.job = jh;
  T.console = `<div class="mlog" data-mlog></div><div class="mrow"><input data-m-cmd placeholder="A GRBL command, then Enter" ${dis(on)} aria-label="GRBL command">${mBtn('cmd:$$', 'Settings', '', dis(idle))}${mBtn('unlock', 'Unlock', 'lock-open', dis(on))}${mBtn('reset', 'Reset', 'rotate-ccw', dis(on))}</div>`;
  const r1 = v => Math.round(v * 10) / 10;
  T.profile = `<h3 class="mh first">${esc(p.name)}</h3><p class="mnote">New carvings take their working area, top speed and safe height from here. The machine's own settings ($$) are only read, never changed.</p>`
    + `<label class="check mfrom"><input type="checkbox" data-mp="fromMachine" ${p.fromMachine !== false ? 'checked' : ''}>Take the working area and speeds from the machine when it connects</label>`
    + (p.fromMachine !== false ? `<p class="mnote">${p.readAt ? `Last read from it: ${r1(p.workX)} x ${r1(p.workY)} mm${p.workZ ? `, ${r1(p.workZ)} mm of Z` : ''}, up to ${r1(p.maxRate)} mm/min. Its travel settings ($130, $131) are what it reports, so check them once against a ruler.` : 'Not read yet: it happens the next time it connects.'}</p>` : '') + `<div class="mform">`
    + [['name', 'Name'], ['workX', 'Travel X, mm'], ['workY', 'Travel Y, mm'], ['maxRate', 'Top speed, mm/min'], ['sMax', 'Spindle full speed (S)'], ['safeZ', 'Safe height, mm'], ['baud', 'USB speed (baud)']].map(([k, n]) => `<label class="field">${n}<input data-mp="${k}" value="${esc(p[k])}"></label>`).join('')
    + `<label class="field wide">Sending<select data-mp="send">${[['', 'Automatic: one line at a time over Wi-Fi'], ['safe', 'One line at a time'], ['fast', 'Fill GRBL\'s buffer (faster)']].map(([v, n]) => `<option value="${v}" ${(p.send || '') === v ? 'selected' : ''}>${n}</option>`).join('')}</select></label></div>`
    + `<div class="mrow">${P && P.carve && P.kind === 'carve' ? mBtn('applyCarve', 'Use for this carving too') : ''}<span class="grow"></span>${machMachines.list.length > 1 ? mBtn('remove', 'Remove this machine', 'trash-2', dis(!on)) : ''}</div>`
    + `<h3 class="mh">Add a machine</h3><p class="mnote">Any machine running GRBL 1.1, over USB or Wi-Fi. Pick the nearest size; connecting reads its real working area.</p><div class="mrow"><select data-m-kind aria-label="Kind of machine">${MACH_KINDS.map(([k, n]) => `<option value="${k}">${esc(n)}</option>`).join('')}</select>${mBtn('add', 'Add', 'plus', dis(!on) + (on ? ' title="Disconnect first"' : ''))}</div>`;
  const tabs = `<div class="wsTabs" role="tablist" aria-label="What to do">${MACH_TABS.map(([k, n]) => `<button role="tab" data-tab="${k}" aria-selected="${machTab === k}"${k === 'find' && rs ? ' class="alert"' : ''}>${n}</button>`).join('')}</div>`
    + MACH_TABS.map(([k]) => `<section role="tabpanel" data-ms="${k}"${machTab === k ? '' : ' hidden'}>${T[k]}</section>`).join('');
  machEl.innerHTML = h + `<div class="wsBody"><div class="wsMain mpend">${L}</div><div class="wsSide">${tabs}</div></div>`; machConsole();
}
function machRenderLive() {   // the numbers that change all the time, without rebuilding the panel
  machRailMark(); if (!machEl.open) return; const st = machEl.querySelector('.mstate'); if (st && st.textContent !== M.st.state && !M.connecting) { machRender(); return; }
  machEl.querySelectorAll('[data-mw]').forEach(b => { b.textContent = mf(M.st.w[+b.dataset.mw]); }); const mm = machEl.querySelector('[data-mm]'); if (mm) mm.textContent = `Machine: ${M.st.m.map(mf).join(', ')}`;
  const j = M.job, pr = machEl.querySelector('[data-mprog]'); if (j && !j.done && pr) { const pct = Math.round(j.acked / j.lines.length * 100); pr.textContent = `${j.check ? 'Checking' : 'Running'} ${j.name}: line ${j.acked} of ${j.lines.length} (${pct}%), ${Math.round((Date.now() - j.started) / 60000)} min${j.total ? ` of about ${Math.round(j.total)}` : ''}`; const bar = machEl.querySelector('.mprog div'); if (bar) bar.style.width = pct + '%'; }
}
function machConsole() { const el = machEl.querySelector('[data-mlog]'); if (!el) return; el.innerHTML = M.log.slice(-150).map(x => `<div class="${x.kind}">${esc(x.t)}</div>`).join(''); el.scrollTop = el.scrollHeight; }
// the checklist before cutting, as Easel asks it
const machDeepest = text => { let z = 0; for (const m of text.matchAll(/^[^(;]*?Z\s*([-+]?(?:\d+\.?\d*|\.\d+))/gim)) z = Math.min(z, +m[1]); return z; };
function machConfirmStart(src, from = 1) {
  const dlg = document.getElementById('machDlg') || (() => { const d = document.createElement('dialog'); d.id = 'machDlg'; document.body.appendChild(d); return d; })();
  const zero = P.carve ? cvZeroName(P.carve) : 'where the file expects', deep = -machDeepest(src.text), t = P.carve && P.carve.board ? P.carve.board.t : 0;
  const items = [`The board is held down firmly, and clamps are clear of the cut.`, `The bit is in: <b>${esc(src.bit || 'the one the file is for')}</b>.`, `X0 Y0 is set at the <b>${esc(zero)}</b> of the board.`, `Z0 is set on the top of the board, after this bit went in.`];
  // a through cut goes a little below the board: into a spoilboard, or into the machine's bed, which snaps a small bit
  if (t > 0 && deep >= t - 1e-6) items.push(`There's a spoilboard under the board: this file cuts ${esc(cvLenNote(deep))} deep, right through it.`);
  items.push(`Eyes and ears are protected, and the dust extraction is on.`, `You can reach the machine's power switch.`);
  dlg.innerHTML = `<h2>Ready to cut?</h2><p class="note">${esc(src.name)}${src.minutes ? `, about ${Math.round(src.minutes)} min` : ''}${from > 1 ? `, <b>from line ${from}</b>` : ''}. The spindle starts when the file says so.</p>${items.map((t, i) => `<label class="check"><input type="checkbox" data-ok="${i}">${t}</label>`).join('')}<div class="rowb" style="margin-top:12px"><button class="btn line" data-d="no">Not yet</button><button class="btn main" data-d="go" disabled>${ic('play')}Start cutting</button></div>`;
  dlg.onchange = () => { dlg.querySelector('[data-d="go"]').disabled = ![...dlg.querySelectorAll('[data-ok]')].every(c => c.checked); };
  dlg.onclick = e => { const b = e.target.closest('[data-d]'); if (!b) return; dlg.close(); if (b.dataset.d === 'go') machJobStart(src, false, from); };
  dlg.showModal();
}
// ---------- jogging ----------
function machJog(axis, dir, held) {
  if (!M.link) return; const p = machProfile, f = Math.max(10, +p.jogFeed || 1000);
  const dist = held || !machJogStep ? (axis === 'Z' ? 50 : axis === 'X' ? p.workX : p.workY) : machJogStep;
  machSend(`$J=G21 G91 ${axis}${(dir * dist).toFixed(3)} F${f}`);
}
const machJogCancel = () => machRealtime('\x85');
machEl.addEventListener('pointerdown', e => { const b = e.target.closest('[data-jog]'); if (!b || b.disabled || machJogStep) return; e.preventDefault(); try { b.setPointerCapture(e.pointerId); } catch (err) {} machJog(b.dataset.jog[0], b.dataset.jog.slice(1) === '-1' ? -1 : 1, true); const end = () => { machJogCancel(); b.removeEventListener('pointerup', end); b.removeEventListener('pointercancel', end); }; b.addEventListener('pointerup', end); b.addEventListener('pointercancel', end); });
const MACH_KEYS = { ArrowLeft: ['X', -1], ArrowRight: ['X', 1], ArrowUp: ['Y', 1], ArrowDown: ['Y', -1], PageUp: ['Z', 1], PageDown: ['Z', -1] };
machEl.addEventListener('keydown', e => {
  const t = e.target; if (/INPUT|SELECT|TEXTAREA/.test(t.tagName)) { e.stopPropagation(); if (t.dataset.mCmd !== undefined && e.key === 'Enter' && t.value.trim()) { const c = t.value.trim(); t.value = ''; if (c === '?' || c === '!' || c === '~') machRealtime(c); else machSend(c); } return; }
  const k = MACH_KEYS[e.key]; if (!k) return; e.preventDefault(); e.stopPropagation();
  if (e.repeat || !M.link || !/^(Idle|Jog)/.test(M.st.state) || (M.job && !M.job.done)) return; machJog(k[0], k[1], !machJogStep);
});
machEl.addEventListener('keyup', e => { if (MACH_KEYS[e.key] && !machJogStep) machJogCancel(); });
window.addEventListener('keydown', e => { if (e.key === 'Escape' && machPickOn) { e.preventDefault(); e.stopPropagation(); machPickOn = false; document.body.classList.remove('mach-picking'); machOpen(); } }, true);   // picking a point: Esc goes back to the popup
window.addEventListener('keydown', e => { if (e.key === 'Pause' && M.link) { e.preventDefault(); e.stopPropagation(); machEstop(); } }, true);   // the stop key works everywhere
// ---------- the panel's buttons ----------
machEl.addEventListener('click', async e => {
  const st = e.target.closest('[data-step]'); if (st) { machJogStep = +st.dataset.step; machRender(); return; }
  const jg = e.target.closest('[data-jog]'); if (jg) { if (!jg.disabled && machJogStep) machJog(jg.dataset.jog[0], jg.dataset.jog.slice(1) === '-1' ? -1 : 1, false); return; }
  const tb = e.target.closest('[data-tab]'); if (tb) { machShow(tb.dataset.tab); machRender(); const again = machEl.querySelector('[data-tab="' + machTab + '"]'); if (again) again.focus(); return; }
  const b = e.target.closest('[data-m]'); if (!b || b.disabled) return; const a = b.dataset.m, p = machProfile;
  if (a === 'close') { machEl.close(); machRender(); return; }
  if (a === 'estop') { machEstop(); return; }
  if (a === 'machines') { machShow('profile'); machRender(); return; }
  if (a === 'add') { const k = machEl.querySelector('[data-m-kind]'); const m = machAdd(k ? k.value : 'custom'); machShow('profile'); machRender(); toast(`Added ${m.name}. Set how it connects, then Connect.`); const n = machEl.querySelector('[data-mp="name"]'); if (n) { n.focus(); n.select(); } return; }
  if (a === 'remove') { const n = machProfile.name; if (confirm(`Remove ${n}?`)) { machRemove(); toast(`Removed ${n}.`); } return; }
  if (a === 'connect') { machConnect(); return; }
  if (a === 'disconnect') { machDisconnect(); return; }
  if (a === 'ports') { if (window.atelierWin && atelierWin.serialWant && navigator.serial) { atelierWin.serialWant('?'); try { await navigator.serial.requestPort(); } catch (err) {} M.ports = await atelierWin.serialList(); machRender(); if (!M.ports.length) toast('No USB ports found. Is the machine plugged in and on?', true); } return; }
  if (a === 'unlock') { machSend('$X'); return; }
  if (a === 'reset') { machRealtime('\x18'); M.queue = []; M.sent = []; if (M.job && !M.job.done) machJobEnd('Stopped: the machine was reset'); machRender(); return; }   // ended here, so its greeting isn't taken for a restart by itself
  if (a.startsWith('cmd:')) { machSend(a.slice(4)); machShow('console'); machRender(); return; }
  if (a.startsWith('ov:')) { machRealtime(a.slice(3)); return; }
  if (a === 'zeroX' || a === 'zeroY' || a === 'zeroZ') { machSend(`G10 L20 P1 ${a.slice(4)}0`); return; }
  if (a === 'zeroXY') { machSend('G10 L20 P1 X0 Y0'); return; }
  if (a === 'raise') { machSend('G91 G0 Z' + (+p.safeZ || 5)); machSend('G90'); return; }
  if (a === 'home') { machSend('G91 G0 Z' + (+p.safeZ || 5)); machSend('G90 G0 X0 Y0'); return; }
  if (a === 'spindle') { M.spindle = !M.spindle; machSend(M.spindle ? `M3 S${Math.round((+p.sMax || 1000) * (M.spinPct || 100) / 100)}` : 'M5'); machRender(); return; }
  if (a === 'pause') { machPause(); return; }
  if (a === 'resume') { machResume(); return; }
  if (a === 'stop') { machStop(); return; }
  if (a === 'start' || a === 'check') { const src = machSources().find(s => s.key === machSrcKey); if (!src) return; if (a === 'check') machJobStart(src, true); else machConfirmStart(src, M.from > 1 ? M.from : 1); return; }
  if (a === 'pick') { machPickOn = !machPickOn; document.body.classList.toggle('mach-picking', machPickOn); if (machPickOn) { machEl.close(); machRender(); toast('Click a point of the cut on the board. Esc goes back.'); } else machRender(); return; }
  if (a === 'findXY' && M.find) { machSend(`G10 L20 P1 X${+M.find.x.toFixed(3)} Y${+M.find.y.toFixed(3)}`); machLog(`This point is now X ${mf(M.find.x)}, Y ${mf(M.find.y)}`); return; }
  if (a === 'findZ' && M.restart && M.restart.m0 && M.restart.depth !== null) {
    const z = M.restart.depth + (M.st.m[2] - M.restart.m0[2]); machSend(`G10 L20 P1 Z${+z.toFixed(3)}`);
    machLog(`Z0 set from the cut: the bit is ${mf(z)} from the board top now`); toast('Z0 set from the cut. Check it with the paper test.'); return;
  }
  if (a.startsWith('paper')) { machPaper(a); return; }
  if (a === 'applyCarve' && P.carve) { cvEdit(() => Object.assign(P.carve, machDefaults())); carveRender(); toast('This carving now uses the machine profile.'); }
});
machEl.addEventListener('change', e => {
  const el = e.target;
  if (el.dataset.mSrc !== undefined) { machSrcKey = el.value; return; }
  if (el.dataset.mUse !== undefined) { machUse(el.value); return; }
  if (el.dataset.mKind !== undefined) return;
  if (el.dataset.mp === 'fromMachine') { machProfile.fromMachine = el.checked; machSaveProfile(); machRender(); return; }
  if (el.dataset.mFrom !== undefined) { const n = Math.floor(+el.value); M.from = n > 1 ? n : 1; machRender(); return; }
  if (el.dataset.mf) {   // typed: only the button changes, so Tab still goes on to the other box
    const v = parseFloat(el.value); if (Number.isFinite(v)) { M.find = { ...(M.find || { x: 0, y: 0 }), [el.dataset.mf]: v, snapped: false }; if (typeof cvStageRender === 'function' && P.carve && cvOpen()) cvStageRender(); }
    const b = machEl.querySelector('[data-m="findXY"]'); if (b && M.find) { b.lastChild.textContent = `The bit is at X ${mf(M.find.x)}, Y ${mf(M.find.y)}`; b.disabled = !(M.link && /^(Idle|Check)/.test(M.st.state) && !(M.job && !M.job.done)); }
    return;
  }
  const k = el.dataset.mp; if (!k) return;
  if (k === 'send') { machProfile.send = el.value; machSaveProfile(); machRender(); return; }
  if (k === 'spinPct') { M.spinPct = +el.value; if (M.spindle && M.link) machSend(`M3 S${Math.round((+machProfile.sMax || 1000) * M.spinPct / 100)}`); machRender(); return; }
  const num = ['workX', 'workY', 'maxRate', 'sMax', 'safeZ', 'jogFeed', 'tcpPort', 'baud'].includes(k), v = num ? parseFloat(el.value) : el.value.trim();
  if (num && !(v > 0)) { machRender(); return; } if (!num && !v) { machRender(); return; }
  machProfile[k] = v; machSaveProfile(); machRender();
});
setInterval(() => { if (M.job && !M.job.done) machRenderLive(); }, 1000);
// a held jog stops if the window or the panel loses focus, since the key or button can't be let go then
const machJogSafe = () => { if (M.link && M.st.state === 'Jog' && !machJogStep) machJogCancel(); };
window.addEventListener('blur', machJogSafe);
machEl.addEventListener('focusout', e => { if (!machEl.contains(e.relatedTarget)) machJogSafe(); });

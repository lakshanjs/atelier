// ---------- My machine ----------
// Drives a GRBL 1.1 machine directly, like Candle or Easel: over a USB cable (Web Serial, the port picked by name in
// main.js), over Wi-Fi (telnet, opened in main.js), or a simulated machine to practise on. The panel connects, jogs, sets
// zero, runs the spindle, sends a job with GRBL's character-counting so its 127-byte buffer never overflows, and follows
// it in Carve's 3D view. The emergency stop resets GRBL at once. The machine's own settings ($$) are never changed.
// The profile (travel, top speed and so on) belongs to the app; new carvings take their limits from it.

const MACH_STORE = 'atelier-machine', MACH_RX = 127;
const MACH_PROFILE = { name: 'TTC 3018 PRO', link: 'usb', port: 'COM8', baud: 115200, host: '192.168.1.99', tcpPort: 23, workX: 300, workY: 180, maxRate: 1500, sMax: 1000, safeZ: 6.35, jogFeed: 1000 };
let machProfile = { ...MACH_PROFILE }; try { Object.assign(machProfile, JSON.parse(localStorage.getItem(MACH_STORE)) || {}); } catch (e) {}
const machSaveProfile = () => { try { localStorage.setItem(MACH_STORE, JSON.stringify(machProfile)); } catch (e) {} };
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
function machSend(line, job = null) { M.queue.push({ line, job }); machPump(); }
function machPump() {
  if (!M.link) return; let used = M.sent.reduce((n, x) => n + x.len, 0);
  while (M.queue.length) { const q = M.queue[0], len = q.line.length + 1; if (used + len > MACH_RX && M.sent.length) break; M.queue.shift(); M.sent.push({ ...q, len }); used += len; machWrite(q.line + '\n'); if (q.job === null) machLog(q.line, 'out'); }
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
    machPump(); return;
  }
  if (l.startsWith('ALARM:')) { const n = +l.slice(6); machLog(`Alarm: ${MACH_ALARMS[n] || 'alarm ' + n}. Check the machine, then Unlock.`, 'bad'); if (M.job && !M.job.done) machJobEnd(`Stopped by an alarm: ${MACH_ALARMS[n] || n}`); machRender(); return; }
  if (/^Grbl /.test(l)) { M.sent = []; M.queue = []; if (M.job && !M.job.done) machJobEnd('Stopped: the machine was reset'); machLog(l); machRender(); return; }
  machLog(l);
}
function machStatus(l) {
  const parts = l.slice(1, -1).split('|'), st = M.st; st.state = parts[0];
  parts.slice(1).forEach(p => { const [k, v] = p.split(':'), n = (v || '').split(',').map(Number);
    if (k === 'MPos') { st.m = n; st.w = n.map((x, i) => x - st.wco[i]); } else if (k === 'WPos') { st.w = n; st.m = n.map((x, i) => x + st.wco[i]); } else if (k === 'WCO') { st.wco = n; st.w = st.m.map((x, i) => x - n[i]); } else if (k === 'FS') { st.f = n[0]; st.s = n[1] || 0; } else if (k === 'F') st.f = n[0]; else if (k === 'Ov') st.ov = n; });
  if (M.job && !M.job.done && M.job.sentAll && !M.sent.some(x => x.job !== null) && st.state === 'Idle') machJobEnd(null);
  machFollowTool(); machRenderLive();
}
async function machConnect() {
  if (M.link || M.connecting) return; const p = machProfile; M.connecting = true; machRender();
  const onClose = () => { if (!M.link) return; M.link = null; clearInterval(M.poll); M.st.state = 'Off'; if (M.job && !M.job.done) machJobEnd('The connection was lost while running. Switch the machine off if it is still moving.'); machLog('Disconnected', 'bad'); machRender(); };
  try {
    M.link = p.link === 'sim' ? machSim(machText, M.simSpeed || 1) : p.link === 'wifi' ? await machWifi(p, machText, onClose) : await machUsb(p, machText, onClose);
    M.kind = p.link; M.sent = []; M.queue = []; M.buf = ''; M.st.state = 'Connecting'; machLog(`Connected to ${M.link.label}`);
    if (M.link.start) M.link.start();
    clearInterval(M.poll); M.poll = setInterval(() => machWrite('?'), 200);
    setTimeout(() => { if (M.link && M.st.state === 'Connecting') { machWrite('\r\n'); machSend('$I'); } }, 2500);   // no greeting yet (some boards say nothing over Wi-Fi): ask
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
function machJobStart(src, check) {
  const lines = machJobLines(src.text); if (!lines.length) { toast('That file has nothing to send.', true); return; }
  M.job = { name: src.name, lines, next: 0, acked: 0, started: Date.now(), check: !!check, errors: [], paused: false, done: false, sentAll: false, total: src.minutes || 0 };
  if (!check && typeof cvOpen === 'function' && cvOpen() && (!CV3D.gcode || CV3D.gcode.text !== src.text)) cvGcodeOpenText(src.text, src.name).catch(() => {});   // follow it in 3D
  if (check) machSend('$C');
  machLog(`${check ? 'Checking' : 'Running'} ${src.name}: ${lines.length} lines`); machPump(); machRender();
}
function machJobFeed() {
  const j = M.job; if (!j || j.done || j.paused) return; let used = M.sent.reduce((n, x) => n + x.len, 0);
  while (j.next < j.lines.length) { const L = j.lines[j.next], len = L.l.length + 1; if (used + len > MACH_RX && M.sent.length) break; M.sent.push({ line: L.l, job: j.next, len }); used += len; machWrite(L.l + '\n'); j.next++; }
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

// ---------- the panel ----------
const machEl = document.createElement('div'); machEl.id = 'mach'; machEl.hidden = true; machEl.tabIndex = -1; machEl.setAttribute('role', 'dialog'); machEl.setAttribute('aria-label', 'My machine'); document.body.appendChild(machEl);
const estop = document.createElement('button'); estop.id = 'machStop'; estop.hidden = true; estop.title = 'Emergency stop (Pause key): resets GRBL at once. Your power switch is the real one.'; estop.innerHTML = `${ic('octagon-x')}<span>STOP</span>`; document.body.appendChild(estop);
estop.onclick = machEstop;
let machJogStep = 1, machSrcKey = '', machOpenSecs = new Set(['pos', 'jog', 'job']);
function machOpen(what) { machEl.hidden = false; document.body.classList.add('mach-open'); if (what === 'view') machSrcKey = 'view'; else if (what === 'job') machSrcKey = 'job0'; machRender(); machEl.focus(); }
const mf = v => (Math.round(v * 1000) / 1000).toFixed(3);
const mBtn = (act, label, icon, extra = '') => `<button class="btn line" data-m="${act}" ${extra}>${icon ? ic(icon) : ''}${label}</button>`;
const mSec = (key, title, body) => `<details class="msec" data-ms="${key}" ${machOpenSecs.has(key) ? 'open' : ''}><summary>${title}</summary>${body}</details>`;
function machRender() {
  estop.hidden = !M.link;
  if (machEl.hidden) return;
  const p = machProfile, on = !!M.link, busy = machBusy(), j = M.job, idle = on && /^(Idle|Check)/.test(M.st.state) && !(j && !j.done), alarm = /^Alarm/.test(M.st.state), srcs = machSources();
  if (!srcs.some(s => s.key === machSrcKey)) machSrcKey = srcs.length ? srcs[0].key : '';
  const dis = c => (c ? '' : 'disabled');
  let h = `<div class="mhead">${ic('plug')}<b>${esc(p.name)}</b><span class="mstate" data-st="${esc(M.st.state.split(':')[0])}">${M.connecting ? 'Connecting…' : on ? esc(M.st.state) : 'Not connected'}</span><button class="ic" data-m="close" title="Close (the machine stays connected)" aria-label="Close">${ic('x')}</button></div>`;
  // connection
  h += `<div class="mrow"><select data-mp="link" ${dis(!on)} aria-label="How it's connected"><option value="usb" ${p.link === 'usb' ? 'selected' : ''}>USB cable</option><option value="wifi" ${p.link === 'wifi' ? 'selected' : ''}>Wi-Fi</option><option value="sim" ${p.link === 'sim' ? 'selected' : ''}>Practice, no machine</option></select>`
    + (p.link === 'usb' ? `<select data-mp="port" ${dis(!on)} aria-label="Port">${[...new Set([p.port, ...(M.ports || []).map(x => x.name)])].map(n => `<option ${n === p.port ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select><button class="ic" data-m="ports" ${dis(!on)} title="Look for ports again" aria-label="Look for ports">${ic('refresh-cw')}</button>` : p.link === 'wifi' ? `<input data-mp="host" value="${esc(p.host)}" ${dis(!on)} aria-label="Address" class="mhost"><input data-mp="tcpPort" value="${esc(p.tcpPort)}" ${dis(!on)} aria-label="Port" class="mport">` : '')
    + (on ? mBtn('disconnect', 'Disconnect') : `<button class="btn main" data-m="connect" ${M.connecting ? 'disabled' : ''}>Connect</button>`) + '</div>';
  if (alarm) h += `<p class="mwarn">${ic('triangle-alert')}The machine is locked by an alarm. Check it's clear, then ${mBtn('unlock', 'Unlock')}</p>`;
  // where it is
  h += mSec('pos', 'Position', `<div class="mpos">${['X', 'Y', 'Z'].map((a, i) => `<div><small>${a}</small><b data-mw="${i}">${mf(M.st.w[i])}</b><button class="btn line" data-m="zero${a}" ${dis(idle)} title="Make this X0">0</button></div>`).join('')}</div>`
    + `<div class="mrow">${mBtn('zeroXY', 'Zero X and Y', 'crosshair', dis(idle) + ' title="Here becomes X0 Y0"')}${mBtn('zeroZ', 'Zero Z', 'arrow-down-to-line', dis(idle) + ' title="Touch the board top first (paper test), then Z0"')}</div>`
    + `<div class="mrow">${mBtn('home', 'Go to X0 Y0', 'house', dis(idle) + ' title="Lifts by the safe height first, then goes to X0 Y0"')}${mBtn('raise', 'Lift the bit', 'chevron-up', dis(idle) + ` title="Up ${p.safeZ} mm"`)}</div>`
    + `<p class="mnote" data-mm>Machine: ${M.st.m.map(mf).join(', ')}</p>`);
  // jog
  const jb = (axis, dir, icon, label) => `<button class="btn line mj" data-jog="${axis}${dir}" ${dis(idle || M.st.state === 'Jog')} title="${label}" aria-label="${label}">${ic(icon)}<small>${axis}${dir > 0 ? '+' : '−'}</small></button>`;
  h += mSec('jog', 'Jog', `<div class="mjog"><span></span>${jb('Y', 1, 'chevron-up', 'Away from you (Y+)')}<span></span><span></span>${jb('Z', 1, 'chevron-up', 'Up (Z+)')}${jb('X', -1, 'chevron-left', 'Left (X−)')}<span class="mjc">${ic('crosshair')}</span>${jb('X', 1, 'chevron-right', 'Right (X+)')}<span></span><span></span><span></span>${jb('Y', -1, 'chevron-down', 'Towards you (Y−)')}<span></span><span></span>${jb('Z', -1, 'chevron-down', 'Down (Z−)')}</div>`
    + `<div class="mrow"><div class="mseg" role="radiogroup" aria-label="Jog step">${[.1, 1, 10, 0].map(s => `<button data-step="${s}" aria-checked="${machJogStep === s}" role="radio">${s ? s + ' mm' : 'Hold'}</button>`).join('')}</div><label class="mf">at<input data-mp="jogFeed" value="${p.jogFeed}" aria-label="Jog speed">mm/min</label></div>`
    + `<p class="mnote">Click this panel, then arrow keys move X and Y, Page Up and Page Down move Z. With Hold, it moves while held.</p>`);
  // spindle and overrides
  const ov = M.st.ov;
  h += mSec('run', 'Spindle and speed', `<div class="mrow">${mBtn('spindle', M.spindle ? 'Spindle off' : 'Spindle on', 'drill', dis(idle))}<input type="range" min="10" max="100" step="5" value="${M.spinPct || 100}" data-mp="spinPct" aria-label="Spindle speed"><span class="mnote">${M.spinPct || 100}%</span></div>`
    + `<div class="movr"><span>Feed</span>${mBtn('ov:\x92', '−10')}<b>${ov[0]}%</b>${mBtn('ov:\x91', '+10')}${mBtn('ov:\x90', '100%')}</div>`
    + `<div class="movr"><span>Rapids</span>${mBtn('ov:\x97', '25%')}${mBtn('ov:\x96', '50%')}${mBtn('ov:\x95', '100%')}<b>${ov[1]}%</b></div>`
    + `<div class="movr"><span>Spindle</span>${mBtn('ov:\x9b', '−10')}<b>${ov[2]}%</b>${mBtn('ov:\x9a', '+10')}${mBtn('ov:\x99', '100%')}</div>`);
  // the job
  let jh = srcs.length ? `<select data-m-src aria-label="What to send" ${dis(!(j && !j.done))}>${srcs.map(s => `<option value="${s.key}" ${s.key === machSrcKey ? 'selected' : ''}>${esc(s.name)}${s.bit ? ' · ' + esc(s.bit) : ''}</option>`).join('')}</select>` : '<p class="mnote">Open a carving, or a G-code file, to send it.</p>';
  if (j && !j.done) {
    const pct = Math.round(j.acked / j.lines.length * 100), mins = (Date.now() - j.started) / 60000;
    jh += `<div class="mprog"><div style="width:${pct}%"></div></div><p class="mnote" data-mprog>${j.check ? 'Checking' : 'Running'} ${esc(j.name)}: line ${j.acked} of ${j.lines.length} (${pct}%), ${Math.round(mins)} min${j.total ? ` of about ${Math.round(j.total)}` : ''}</p>`;
    if (j.problem) jh += `<p class="mwarn">${esc(j.problem)}</p>`;
    jh += `<div class="mrow">${j.paused || /^Hold/.test(M.st.state) ? mBtn('resume', 'Resume', 'play') : mBtn('pause', 'Pause', 'pause')}${mBtn('stop', 'Stop the job', 'square')}</div>`;
  } else {
    if (j && j.done) jh += `<p class="${j.why || (j.check && j.errors.length) ? 'mwarn' : 'mnote'}">${esc(j.name)}: ${esc(j.why || (j.check ? (j.errors.length ? j.errors.slice(0, 5).join('; ') : 'GRBL accepts every line.') : 'done.'))}</p>`;
    jh += `<div class="mrow">${mBtn('check', 'Check', 'square-check', dis(idle && srcs.length) + ' title="Runs it through GRBL without moving ($C), to find lines it would refuse"')}<button class="btn main" data-m="start" ${dis(idle && srcs.length)}>${ic('play')}Start</button></div>`;
  }
  h += mSec('job', 'Job', jh);
  // console and settings
  h += mSec('console', 'Console', `<div class="mlog" data-mlog></div><div class="mrow"><input data-m-cmd placeholder="A GRBL command, then Enter" ${dis(on)} aria-label="GRBL command">${mBtn('cmd:$$', 'Settings', '', dis(idle))}${mBtn('unlock', 'Unlock', 'lock-open', dis(on))}${mBtn('reset', 'Reset', 'rotate-ccw', dis(on))}</div>`);
  h += mSec('profile', 'Machine profile', `<p class="mnote">New carvings take their travel, top speed and safe height from here. Settings in the machine ($$) are never changed.</p>`
    + [['name', 'Name'], ['workX', 'Travel X, mm'], ['workY', 'Travel Y, mm'], ['maxRate', 'Top speed, mm/min'], ['sMax', 'Spindle full speed (S)'], ['safeZ', 'Safe height, mm'], ['baud', 'USB speed (baud)']].map(([k, n]) => `<label class="field">${n}<input data-mp="${k}" value="${esc(p[k])}"></label>`).join('')
    + (P && P.carve && P.kind === 'carve' ? `<div class="mrow">${mBtn('applyCarve', 'Use for this carving too')}</div>` : ''));
  machEl.innerHTML = h; machConsole();
}
function machRenderLive() {   // the numbers that change all the time, without rebuilding the panel
  if (machEl.hidden) return; const st = machEl.querySelector('.mstate'); if (st && st.textContent !== M.st.state && !M.connecting) { machRender(); return; }
  machEl.querySelectorAll('[data-mw]').forEach(b => { b.textContent = mf(M.st.w[+b.dataset.mw]); }); const mm = machEl.querySelector('[data-mm]'); if (mm) mm.textContent = `Machine: ${M.st.m.map(mf).join(', ')}`;
  const j = M.job, pr = machEl.querySelector('[data-mprog]'); if (j && !j.done && pr) { const pct = Math.round(j.acked / j.lines.length * 100); pr.textContent = `${j.check ? 'Checking' : 'Running'} ${j.name}: line ${j.acked} of ${j.lines.length} (${pct}%), ${Math.round((Date.now() - j.started) / 60000)} min${j.total ? ` of about ${Math.round(j.total)}` : ''}`; const bar = machEl.querySelector('.mprog div'); if (bar) bar.style.width = pct + '%'; }
}
function machConsole() { const el = machEl.querySelector('[data-mlog]'); if (!el) return; el.innerHTML = M.log.slice(-150).map(x => `<div class="${x.kind}">${esc(x.t)}</div>`).join(''); el.scrollTop = el.scrollHeight; }
// the checklist before cutting, as Easel asks it
function machConfirmStart(src) {
  const dlg = document.getElementById('machDlg') || (() => { const d = document.createElement('dialog'); d.id = 'machDlg'; document.body.appendChild(d); return d; })();
  const zero = P.carve ? cvZeroName(P.carve) : 'where the file expects';
  const items = [`The board is held down firmly, and clamps are clear of the cut.`, `The bit is in: <b>${esc(src.bit || 'the one the file is for')}</b>.`, `X0 Y0 is set at the <b>${esc(zero)}</b> of the board.`, `Z0 is set on the top of the board, after this bit went in.`, `Eyes and ears are protected, and the dust extraction is on.`, `You can reach the machine's power switch.`];
  dlg.innerHTML = `<h2>Ready to cut?</h2><p class="note">${esc(src.name)}${src.minutes ? `, about ${Math.round(src.minutes)} min` : ''}. The spindle starts when the file says so.</p>${items.map((t, i) => `<label class="check"><input type="checkbox" data-ok="${i}">${t}</label>`).join('')}<div class="rowb" style="margin-top:12px"><button class="btn line" data-d="no">Not yet</button><button class="btn main" data-d="go" disabled>${ic('play')}Start cutting</button></div>`;
  dlg.onchange = () => { dlg.querySelector('[data-d="go"]').disabled = ![...dlg.querySelectorAll('[data-ok]')].every(c => c.checked); };
  dlg.onclick = e => { const b = e.target.closest('[data-d]'); if (!b) return; dlg.close(); if (b.dataset.d === 'go') machJobStart(src, false); };
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
window.addEventListener('keydown', e => { if (e.key === 'Pause' && M.link) { e.preventDefault(); e.stopPropagation(); machEstop(); } }, true);   // the stop key works everywhere
// ---------- the panel's buttons ----------
machEl.addEventListener('click', async e => {
  const st = e.target.closest('[data-step]'); if (st) { machJogStep = +st.dataset.step; machRender(); return; }
  const jg = e.target.closest('[data-jog]'); if (jg) { if (!jg.disabled && machJogStep) machJog(jg.dataset.jog[0], jg.dataset.jog.slice(1) === '-1' ? -1 : 1, false); return; }
  const b = e.target.closest('[data-m]'); if (!b || b.disabled) return; const a = b.dataset.m, p = machProfile;
  if (a === 'close') { machEl.hidden = true; document.body.classList.remove('mach-open'); machRender(); return; }
  if (a === 'connect') { machConnect(); return; }
  if (a === 'disconnect') { machDisconnect(); return; }
  if (a === 'ports') { if (window.atelierWin && atelierWin.serialWant && navigator.serial) { atelierWin.serialWant('?'); try { await navigator.serial.requestPort(); } catch (err) {} M.ports = await atelierWin.serialList(); machRender(); if (!M.ports.length) toast('No USB ports found. Is the machine plugged in and on?', true); } return; }
  if (a === 'unlock') { machSend('$X'); return; }
  if (a === 'reset') { machRealtime('\x18'); M.queue = []; M.sent = []; return; }
  if (a.startsWith('cmd:')) { machSend(a.slice(4)); machOpenSecs.add('console'); machRender(); return; }
  if (a.startsWith('ov:')) { machRealtime(a.slice(3)); return; }
  if (a === 'zeroX' || a === 'zeroY' || a === 'zeroZ') { machSend(`G10 L20 P1 ${a.slice(4)}0`); return; }
  if (a === 'zeroXY') { machSend('G10 L20 P1 X0 Y0'); return; }
  if (a === 'raise') { machSend('G91 G0 Z' + (+p.safeZ || 5)); machSend('G90'); return; }
  if (a === 'home') { machSend('G91 G0 Z' + (+p.safeZ || 5)); machSend('G90 G0 X0 Y0'); return; }
  if (a === 'spindle') { M.spindle = !M.spindle; machSend(M.spindle ? `M3 S${Math.round((+p.sMax || 1000) * (M.spinPct || 100) / 100)}` : 'M5'); machRender(); return; }
  if (a === 'pause') { machPause(); return; }
  if (a === 'resume') { machResume(); return; }
  if (a === 'stop') { machStop(); return; }
  if (a === 'start' || a === 'check') { const src = machSources().find(s => s.key === machSrcKey); if (!src) return; if (a === 'check') machJobStart(src, true); else machConfirmStart(src); return; }
  if (a === 'applyCarve' && P.carve) { cvEdit(() => Object.assign(P.carve, machDefaults())); carveRender(); toast('This carving now uses the machine profile.'); }
});
machEl.addEventListener('change', e => {
  const el = e.target;
  if (el.dataset.mSrc !== undefined) { machSrcKey = el.value; return; }
  const k = el.dataset.mp; if (!k) return;
  if (k === 'spinPct') { M.spinPct = +el.value; if (M.spindle && M.link) machSend(`M3 S${Math.round((+machProfile.sMax || 1000) * M.spinPct / 100)}`); machRender(); return; }
  const num = ['workX', 'workY', 'maxRate', 'sMax', 'safeZ', 'jogFeed', 'tcpPort', 'baud'].includes(k), v = num ? parseFloat(el.value) : el.value.trim();
  if (num && !(v > 0)) { machRender(); return; } if (!num && !v) { machRender(); return; }
  machProfile[k] = v; machSaveProfile(); machRender();
});
machEl.addEventListener('toggle', e => { const d = e.target.closest('[data-ms]'); if (d) { if (d.open) machOpenSecs.add(d.dataset.ms); else machOpenSecs.delete(d.dataset.ms); if (d.open && d.dataset.ms === 'console') machConsole(); } }, true);
setInterval(() => { if (M.job && !M.job.done) machRenderLive(); }, 1000);
// a held jog stops if the window or the panel loses focus, since the key or button can't be let go then
const machJogSafe = () => { if (M.link && M.st.state === 'Jog' && !machJogStep) machJogCancel(); };
window.addEventListener('blur', machJogSafe);
machEl.addEventListener('focusout', e => { if (!machEl.contains(e.relatedTarget)) machJogSafe(); });

"use strict";
const { test, before, after } = require("node:test");
const assert = require("node:assert");
const net = require("net");
const { openApp } = require("./harness");

let app;
before(async () => { app = await openApp(); });
after(async () => { if (app) await app.close(); });

// connects to the practice machine, running 40 times faster than real
const SETUP = `
  document.querySelectorAll('dialog[open]').forEach(d => d.close());
  if (M.link) { M.job = null; await M.link.close(); M.link = null; clearInterval(M.poll); }
  machProfile.link = 'sim'; M.simSpeed = 40; M.log = []; M.job = null; machOpen(); await machConnect();
  const until = async (f, ms = 8000) => { const t0 = Date.now(); while (!f()) { if (Date.now() - t0 > ms) throw new Error('timed out: ' + f + ' state ' + M.st.state + ' log: ' + M.log.slice(-12).map(x => x.t).join(' | ') + ' resets: ' + ((M.link && M.link.sim && M.link.sim.resets) || []).map(x => x.split(String.fromCharCode(10)).slice(1, 6).join(' < ')).join(' ### ')); await new Promise(r => setTimeout(r, 30)); } };
  await until(() => M.st.state === 'Idle');
  let most = 0; const w0 = M.link.write; M.link.write = s => { w0(s); most = Math.max(most, M.sent.reduce((n, x) => n + x.len, 0)); };
  const click = sel => { const b = document.querySelector('#mach ' + sel); if (!b) throw new Error('no ' + sel); b.click(); };
  const SQUARE = ['(a 10 mm square, 1 mm deep)', 'G21 G90', 'G0 Z5', 'M3 S1000', 'G0 X0 Y0', 'G1 Z-1 F300', 'G1 X10 F600', 'G1 Y10', 'G1 X0', 'G1 Y0', 'G0 Z5', 'M5'];`;

test("the practice machine: connect, jog, zero, and a job runs to the end without overfilling GRBL's buffer", async () => {
  const v = await app.run(`${SETUP}
    const out = { state: M.st.state, stop: !document.getElementById('machStop').hidden };
    click('[data-step="10"]'); click('[data-jog="X1"]'); await until(() => Math.abs(M.st.w[0] - 10) < .01 && M.st.state === 'Idle'); out.jogged = M.st.w[0];
    click('[data-m="zeroXY"]'); click('[data-m="zeroZ"]'); await until(() => Math.abs(M.st.w[0]) < .01); out.zero = M.st.w.slice(); out.mx = M.st.m[0];
    const many = SQUARE.concat(Array.from({ length: 120 }, (_, i) => 'G1 X' + (i % 10) + ' Y' + (i % 7) + ' F3000'), ['G0 Z5']);
    machJobStart({ name: 'Square', text: many.join('\\n') }, false); await until(() => M.job.done, 20000);
    out.done = !M.job.why; out.acked = M.job.acked; out.lines = M.job.lines.length; out.most = most; out.end = M.st.w.map(x => Math.round(x * 100) / 100);
    return out;`);
  assert.strictEqual(v.state, "Idle"); assert.ok(v.stop, "the emergency stop shows once connected");
  assert.ok(Math.abs(v.jogged - 10) < .01, "jogged 10 mm right");
  assert.deepStrictEqual(v.zero.map(x => Math.round(x * 1000)), [0, 0, 0], "zeroed here"); assert.ok(Math.abs(v.mx - 10) < .01, "the machine itself is still 10 mm over");
  assert.ok(v.done && v.acked === v.lines, JSON.stringify(v));
  assert.ok(v.most <= 127, "never more than 127 bytes waiting in GRBL: " + v.most);
  assert.deepStrictEqual(v.end, [9, 0, 5], "ends where the file ends");
});

test("a refused line holds the job and says which; Check finds problems without moving", async () => {
  const v = await app.run(`${SETUP}
    machJobStart({ name: 'Bad', text: SQUARE.slice(0, 6).concat(['M6 T2'], SQUARE.slice(6)).join('\\n') }, false);
    await until(() => M.job.paused); const out = { problem: M.job.problem }; await until(() => /^Hold/.test(M.st.state) || M.st.state === 'Idle');
    click('[data-m="stop"]'); await until(() => M.job.done); out.why = M.job.why; await until(() => M.st.state === 'Idle'); out.after = M.st.state;
    const before = M.st.m.slice(); machJobStart({ name: 'Check', text: SQUARE.concat(['G99 X1']).join('\\n') }, true); await until(() => M.job.done);
    out.check = M.job.errors; out.still = M.st.m.every((x, i) => Math.abs(x - before[i]) < 1e-6); await until(() => M.st.state === 'Idle'); out.idle = M.st.state;
    return out;`);
  assert.match(v.problem, /Line 7 \(M6 T2\) was refused: a command GRBL doesn't do/);
  assert.strictEqual(v.why, "Stopped"); assert.strictEqual(v.after, "Idle", "a gentle stop keeps it out of alarm");
  assert.strictEqual(v.check.length, 1); assert.match(v.check[0], /Line 13: G99 X1/);
  assert.ok(v.still, "Check doesn't move the machine"); assert.strictEqual(v.idle, "Idle", "and leaves check mode afterwards");
});

test("emergency stop: the button and the Pause key reset GRBL at once, mid-job; Unlock brings it back", async () => {
  const v = await app.run(`${SETUP}
    M.link.sim.speed = 1; const slow = SQUARE.map(l => l.replace('F600', 'F60')).join('\\n');
    machJobStart({ name: 'Slow', text: slow }, false); await until(() => M.st.state === 'Run' && M.st.w[2] < 0);
    document.getElementById('machStop').click(); const out = { why: M.job.why }; await until(() => M.st.state === 'Alarm'); out.state = M.st.state; out.spindle = M.link.sim.spindle;
    const at = M.st.m.slice(); await new Promise(r => setTimeout(r, 300)); out.still = M.st.m.every((x, i) => x === at[i]);
    click('[data-m="unlock"]'); await until(() => M.st.state === 'Idle'); out.unlocked = M.st.state;
    machJobStart({ name: 'Slow', text: slow }, false); await until(() => M.st.state === 'Run');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Pause', bubbles: true })); await until(() => M.job.done); out.key = M.job.why;
    click('[data-m="unlock"]'); await until(() => M.st.state === 'Idle'); M.link.sim.speed = 40;
    return out;`);
  assert.strictEqual(v.why, "Emergency stop"); assert.strictEqual(v.state, "Alarm", "reset while moving: GRBL says position may be lost");
  assert.strictEqual(v.spindle, 0, "spindle off"); assert.ok(v.still, "nothing moves after the stop");
  assert.strictEqual(v.unlocked, "Idle"); assert.strictEqual(v.key, "Emergency stop");
});

test("held jog moves while held and stops on letting go; overrides and the spindle are sent", async () => {
  const v = await app.run(`${SETUP}
    click('[data-step="0"]'); const b = document.querySelector('#mach [data-jog="Y1"]'), r = b.getBoundingClientRect(), y0 = M.st.w[1];
    const pe = (t, type) => t.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 7, clientX: r.left + 5, clientY: r.top + 5, button: 0 }));
    pe(b, 'pointerdown'); await until(() => M.st.state === 'Jog'); await new Promise(r => setTimeout(r, 250)); pe(b, 'pointerup');
    await until(() => M.st.state === 'Idle'); const out = { moved: M.st.w[1] - y0 };
    const y1 = M.st.w[1]; await new Promise(r => setTimeout(r, 200)); out.stopped = M.st.w[1] === y1;
    click('[data-m="ov:\\x91"]'); click('[data-m="ov:\\x91"]'); click('[data-m="ov:\\x96"]'); await until(() => M.st.ov[0] === 120 && M.st.ov[1] === 50); out.ov = M.st.ov.slice(); click('[data-m="ov:\\x90"]'); click('[data-m="ov:\\x95"]');
    click('[data-m="spindle"]'); await until(() => M.link.sim.spindle > 0); out.spin = M.link.sim.spindle; click('[data-m="spindle"]'); await until(() => M.link.sim.spindle === 0);
    click('[data-step="1"]'); return out;`);
  assert.ok(v.moved > 5, "moved while held: " + v.moved); assert.ok(v.stopped, "and stopped on release");
  assert.deepStrictEqual(v.ov, [120, 50, 100]); assert.strictEqual(v.spin, 1000);
});

test("Start asks Easel's questions first, and only goes once every box is ticked", async () => {
  const v = await app.run(`${SETUP}
    P.kind = 'carve'; P.carve = CV_DEFAULT(); P.carve.items = [{ id: 1, type: 'rect', w: 20, h: 20, x: 100, y: 70, rot: 0, op: { kind: 'pocket', bit: cvBits.find(b => b.type === 'flat').id, depth: .5, through: false, tabs: 0 } }]; P.carve.nextId = 2;
    machRender(); const src = document.querySelector('#mach [data-m-src]'); const out = { sources: [...src.options].map(o => o.textContent) };
    click('[data-m="start"]'); const dlg = document.getElementById('machDlg'), go = dlg.querySelector('[data-d="go"]'); out.open = dlg.open; out.locked = go.disabled;
    const boxes = [...dlg.querySelectorAll('[data-ok]')]; boxes.slice(0, -1).forEach(c => { c.checked = true; }); dlg.dispatchEvent(new Event('change')); out.stillLocked = go.disabled;
    boxes[boxes.length - 1].checked = true; dlg.dispatchEvent(new Event('change')); out.unlocked = !go.disabled; dlg.querySelector('[data-d="no"]').click(); out.closed = !dlg.open && !M.job;
    return out;`);
  assert.ok(v.sources.length >= 1 && /file 1 of 1 · .*flat/.test(v.sources[0]) && !/object/.test(v.sources[0]), "named with its bit: " + JSON.stringify(v.sources));
  assert.ok(v.open && v.locked && v.stillLocked && v.unlocked && v.closed, JSON.stringify(v));
});

test("the profile sets new carvings' limits", async () => {
  const v = await app.run(`
    const keep = { ...machProfile }; machProfile.workX = 410; machProfile.maxRate = 2000; const c = CV_DEFAULT(); Object.assign(machProfile, keep);
    return { x: c.workX, r: c.maxRate, y: c.workY };`);
  assert.deepStrictEqual(v, { x: 410, r: 2000, y: 180 });
});

test("Wi-Fi: talks GRBL over telnet to the address given", async () => {
  const got = [];
  const server = net.createServer(sock => {
    sock.write("\xff\xfb\x01Grbl 1.1h ['$' for help]\r\n", "latin1");
    let buf = "";
    sock.on("data", d => {
      for (const ch of d.toString("latin1")) {
        if (ch === "?") sock.write("<Idle|MPos:1.000,2.000,3.000|FS:0,0|WCO:0.000,0.000,0.000>\r\n");
        else if (ch === "\n") { got.push(buf.trim()); buf = ""; sock.write("ok\r\n"); }
        else buf += ch;
      }
    });
  });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  try {
    const v = await app.run(`
      if (M.link) { await M.link.close(); M.link = null; clearInterval(M.poll); }
      Object.assign(machProfile, { link: 'wifi', host: '127.0.0.1', tcpPort: ${port} }); machOpen(); await machConnect();
      const t0 = Date.now(); while (M.st.state !== 'Idle' && Date.now() - t0 < 5000) await new Promise(r => setTimeout(r, 30));
      machSend('G10 L20 P1 X0 Y0'); await new Promise(r => setTimeout(r, 400));
      const out = { state: M.st.state, z: M.st.w[2], log: M.log.map(x => x.t).join(' | ') }; await machDisconnect(); machProfile.link = 'usb'; machProfile.host = '192.168.1.99'; machProfile.tcpPort = 23; machSaveProfile();
      return out;`);
    assert.strictEqual(v.state, "Idle"); assert.strictEqual(v.z, 3);
    assert.ok(got.includes("G10 L20 P1 X0 Y0"), "the server got the line: " + JSON.stringify(got));
    assert.ok(/Grbl 1\.1h/.test(v.log) && !/\xff/.test(v.log), "the greeting arrives, telnet's own bytes dropped: " + v.log);
  } finally { server.close(); }
});

test("sending: one line at a time waits for each ok; fast fills GRBL's buffer; Wi-Fi defaults to one at a time", async () => {
  const v = await app.run(`${SETUP}
    let mostLines = 0; const w1 = M.link.write; M.link.write = s => { w1(s); mostLines = Math.max(mostLines, M.sent.length); };
    const many = SQUARE.concat(Array.from({ length: 60 }, (_, i) => 'G1 X' + (i % 10) + ' Y' + (i % 7) + ' F3000'), ['G0 Z5']).join('\\n');
    const out = {}; const keep = machProfile.send;
    machProfile.send = 'safe'; machJobStart({ name: 'Safe', text: many }, false); await until(() => M.job.done, 20000); out.safe = mostLines; out.safeDone = !M.job.why && M.job.acked === M.job.lines.length;
    mostLines = 0; machProfile.send = 'fast'; machJobStart({ name: 'Fast', text: many }, false); await until(() => M.job.done, 20000); out.fast = mostLines;
    machProfile.send = ''; M.kind = 'wifi'; out.wifi = machOneByOne(); M.kind = 'usb'; out.usb = machOneByOne(); M.kind = 'sim'; machProfile.send = keep;
    return out;`);
  assert.strictEqual(v.safe, 1, "never more than one line waiting"); assert.ok(v.safeDone);
  assert.ok(v.fast > 1, "fast keeps several lines waiting: " + v.fast);
  assert.strictEqual(v.wifi, true); assert.strictEqual(v.usb, false);
});

test("a restart mid-job: says the position is lost, finds zero again from a point and from the cut's depth, and starts that cut again", async () => {
  const v = await app.run(`${SETUP}
    M.link.sim.speed = 3; machProfile.send = 'fast';
    click('[data-step="10"]'); click('[data-jog="X1"]'); await until(() => M.st.state === 'Idle' && Math.abs(M.st.w[0] - 10) < .01);
    click('[data-m="zeroXY"]'); click('[data-m="zeroZ"]'); await until(() => Math.abs(M.st.w[0]) < .01 && Math.abs(M.st.w[2]) < .01);
    const lines = ['G21 G90', 'G0 Z5', 'M3 S1000', 'G0 X0 Y0', 'G1 Z-1 F300'].concat(Array.from({ length: 80 }, (_, i) => 'G1 X' + (i % 2 ? 20 : 0) + ' Y' + (i * .5) + ' F1200'), ['G0 Z5', 'M5']), text = lines.join('\\n');
    machJobStart({ name: 'Zigzag', text }, false); await until(() => M.job.acked > 40 && M.st.state === 'Run');
    const sim = M.link.sim, truth = sim.m.map((m, i) => m - sim.wco[i]); M.link.reboot();
    await until(() => M.job.done && M.restart && M.restart.m0 && M.st.state === 'Idle');
    const out = { why: M.job.why, depth: M.restart.depth, from: M.restart.from, uiFrom: M.from, lost: Math.hypot(M.st.w[0] - truth[0], M.st.w[1] - truth[1]), open: machOpenSecs.has('find') };
    // Z from the cut: the bit goes up 2 mm, and Z0 is worked out from the depth it restarted at
    machSend('$J=G21 G91 Z2 F600'); await until(() => M.st.state === 'Idle' && Math.abs(M.st.m[2] - 2) < .01);
    machRender(); click('[data-m="findZ"]'); await until(() => Math.abs(M.st.w[2] - 1) < .01); out.z = M.st.w[2];
    // X and Y from a known point: here, where the bit really is
    const fx = document.querySelector('#mach [data-mf="x"]'), fy = document.querySelector('#mach [data-mf="y"]');
    fx.value = truth[0].toFixed(3); fx.dispatchEvent(new Event('change', { bubbles: true })); fy.value = truth[1].toFixed(3); fy.dispatchEvent(new Event('change', { bubbles: true }));
    click('[data-m="findXY"]'); await until(() => Math.hypot(M.st.w[0] - truth[0], M.st.w[1] - truth[1]) < .01); out.xy = true;
    // starting again from the cut it was on
    out.resume = machResumeLines(text, M.from).lines.map(L => L.l);
    M.link.sim.speed = 40; machJobStart({ name: 'Zigzag', text }, false, M.from); await until(() => M.job.done, 20000); out.again = !M.job.why && M.job.acked === M.job.lines.length; out.end = M.st.w.map(x => Math.round(x * 100) / 100);
    out.fromAfter = M.from; machProfile.send = ''; M.link.sim.speed = 40;
    return out;`);
  assert.match(v.why, /restarted by itself.*lost its position/); assert.ok(v.open, "Find zero again opens");
  assert.ok(v.lost > 1, "the work position really is off after the restart: " + v.lost);
  assert.strictEqual(v.depth, -1); assert.strictEqual(v.from, 5, "the cut it was on starts at line 5, where the bit goes down"); assert.strictEqual(v.uiFrom, 5);
  assert.ok(Math.abs(v.z - 1) < .01, "2 mm above a 1 mm deep pass: 1 mm above the board top");
  assert.ok(v.xy);
  assert.deepStrictEqual(v.resume.slice(0, 12), ['G21 G90 G17 G94', 'G0 Z6.35', 'M3 S250', 'G4 P1', 'M3 S500', 'G4 P1', 'M3 S750', 'G4 P1', 'M3 S1000', 'G4 P2', 'G0 X0 Y0', 'G0 Z5']);
  assert.strictEqual(v.resume[12], 'G1 Z-1 F300');
  assert.ok(v.again, "the rest of the job runs"); assert.deepStrictEqual(v.end, [20, 39.5, 5]);
  assert.strictEqual(v.fromAfter, 1, "the next Start begins at the top again");
});

test("starting part-way picks up the file's motion, feed and height, and refuses a file of relative moves", async () => {
  const v = await app.run(`
    const t = ['G21 G90', 'G0 Z5', 'M3 S800', 'G0 X10 Y10', 'G1 Z-2 F100', 'G2 X20 Y10 I5 J0 F500', 'X30 Y10 I5 J0', 'G0 Z5', 'M5'].join('\\n');
    const a = machResumeLines(t, 7).lines.map(L => L.l), out = { a };
    try { machResumeLines('G91\\nG1 X1 F100\\nG1 X1', 3); out.rel = 'no error'; } catch (e) { out.rel = e.message; }
    try { machResumeLines(t, 50); out.past = 'no error'; } catch (e) { out.past = e.message; }
    return out;`);
  const i = v.a.indexOf('G0 X20 Y10'); assert.deepStrictEqual(v.a.slice(i, i + 5), ['G0 X20 Y10', 'G0 Z1', 'G1 Z-2 F100', 'G1 F500', 'G2 X30 Y10 I5 J0'], JSON.stringify(v.a));
  assert.ok(v.a.includes('M3 S800'));
  assert.match(v.rel, /relative/); assert.match(v.past, /ends before line 50/);
});

test("the paper test lowers to 0.2 then 0.1 mm, and each answer moves Z0 by half a step", async () => {
  const v = await app.run(`${SETUP}
    click('[data-m="zeroZ"]'); await until(() => Math.abs(M.st.w[2]) < .01); const m0 = M.st.m[2], out = {};
    const settle = async (w) => { await new Promise(r => setTimeout(r, 500)); await until(() => M.st.state === 'Idle' && Math.abs(M.st.w[2] - w) < .002); return +(M.st.m[2] - m0).toFixed(3); };
    click('[data-m="paper"]'); out.a = await settle(.2);
    click('[data-m="paperHigh"]'); out.b = await settle(.2);
    click('[data-m="paperNext"]'); out.c = await settle(.1);
    click('[data-m="paperLow"]'); out.d = await settle(.1);
    click('[data-m="paperOk"]'); await until(() => M.st.state === 'Idle' && M.st.w[2] > 5); out.done = !M.paper;
    return out;`);
  assert.deepStrictEqual([v.a, v.b, v.c, v.d], [.2, .1, 0, .05], "a big gap lowers Z0 0.1 mm, pinched at 0.1 raises it 0.05 mm"); assert.ok(v.done);
});

test("a through cut asks about a spoilboard before starting, and a point of the cut can be picked on the board", async () => {
  const v = await app.run(`${SETUP}
    P.kind = 'carve'; P.carve = CV_DEFAULT(); P.carve.items = [{ id: 1, type: 'rect', w: 40, h: 20, x: 100, y: 70, rot: 0, op: { kind: 'outside', bit: cvBits.find(b => b.type === 'flat').id, depth: 1, through: true, tabs: 0 } }]; P.carve.nextId = 2;
    machRender(); click('[data-m="start"]'); const dlg = document.getElementById('machDlg'), out = { asks: [...dlg.querySelectorAll('label.check')].some(l => /spoilboard/.test(l.textContent)) }; dlg.querySelector('[data-d="no"]').click();
    P.carve.items[0].op.through = false; machRender(); click('[data-m="start"]'); out.notAsked = ![...dlg.querySelectorAll('label.check')].some(l => /spoilboard/.test(l.textContent)); dlg.querySelector('[data-d="no"]').click();
    // the front left corner of the cut-out's path, picked by clicking a little way off it
    const src = machSources()[0], pts = machCutPoints(src.text), [zx, zy] = cvZeroAt(P.carve), c = pts.reduce((a, p) => (p[0] + p[1] < a[0] + a[1] ? p : a));
    const click2 = [c[0] + zx + .6, c[1] + zy - .4]; out.corner = pts.reduce((a, p) => (Math.hypot(p[0] + zx - click2[0], p[1] + zy - click2[1]) < Math.hypot(a[0] + zx - click2[0], a[1] + zy - click2[1]) ? p : a));
    machPickOn = true; out.took = machPickAt(click2); out.find = M.find; M.find = null;
    return out;`);
  assert.ok(v.asks, "asks about a spoilboard"); assert.ok(v.notAsked, "but not for a cut that stays in the board");
  assert.ok(v.took && v.find.snapped); assert.deepStrictEqual([v.find.x, v.find.y], v.corner, "snapped to the nearest end of a cut");
});

test("Wi-Fi: a board that drops the connection at once says another program may have it", async () => {
  const server = net.createServer(sock => sock.destroy());
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  try {
    const v = await app.run(`
      if (M.link) { await M.link.close(); M.link = null; clearInterval(M.poll); }
      M.log = []; Object.assign(machProfile, { link: 'wifi', host: '127.0.0.1', tcpPort: ${port} }); machOpen(); await machConnect();
      const t0 = Date.now(); while ((M.link || M.connecting) && Date.now() - t0 < 5000) await new Promise(r => setTimeout(r, 30));
      const out = { log: M.log.map(x => x.t).join(' | '), on: !!M.link }; Object.assign(machProfile, { link: 'usb', host: '192.168.1.99', tcpPort: 23 }); machSaveProfile();
      return out;`);
    assert.ok(!v.on); assert.match(v.log, /one program at a time/);
  } finally { server.close(); }
});

test("the console's Reset during a job stops it as a reset, not as the machine restarting by itself; a Check keeps what's known about a restart", async () => {
  const v = await app.run(`${SETUP}
    const lines = ['G21 G90', 'G0 Z5', 'G0 X0 Y0', 'G1 Z-1 F300'].concat(Array.from({ length: 60 }, (_, i) => 'G1 X' + (i % 2 ? 20 : 0) + ' Y' + (i * .5) + ' F1200'), ['G0 Z5']), text = lines.join(String.fromCharCode(10));
    M.restart = null; M.from = 1; machJobStart({ name: 'Zigzag', text }, false); await until(() => M.job.acked > 20 && M.st.state === 'Run');
    machRender(); click('[data-m="reset"]'); await until(() => M.st.state !== 'Run' && M.log.some(x => /^Grbl /.test(x.t)));
    const out = { why: M.job.why, restart: !!M.restart };
    M.restart = { name: 'X', depth: -1, from: 4, at: 30, m0: [0, 0, 0] }; M.from = 4;
    if (/^Alarm/.test(M.st.state)) machSend('$X'); await until(() => M.st.state === 'Idle');
    machJobStart({ name: 'Zigzag', text }, true); await until(() => M.job.done, 20000); out.kept = !!M.restart && M.from === 4;
    M.restart = null; M.from = 1; return out;`);
  assert.match(v.why, /was reset/); assert.ok(!v.restart, "no Find zero again for a reset that was asked for");
  assert.ok(v.kept, "Check doesn't clear the restart or the from line");
});

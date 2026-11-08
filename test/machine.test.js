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

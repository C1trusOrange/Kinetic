/**
 * Self-test of the desktop shell's multiplayer plumbing. Development only: main.js loads it when the app is NOT
 * packaged and KINETIC_SELFTEST=1, and desktop/package.js leaves this file out of the build.
 *
 *     cd fps && set KINETIC_SELFTEST=1 && npx electron .        (PowerShell: $env:KINETIC_SELFTEST='1'; npx electron .)
 *
 * It opens a hidden window on the game's own origin (kinetic://game) and, from that page, through the same
 * window.kineticDesktop API the game uses: starts the built-in server on every interface, opens a WebSocket
 * to it and fetches /api/lan and /api/rooms against 127.0.0.1 and this PC's LAN addresses (that is where Chromium's
 * mixed-content rules for a "secure" custom scheme would block ws:// and http://), provokes the port-in-use error,
 * and stops the server. Results go to stdout (and to the file in KINETIC_SELFTEST_OUT when set); exit code 0 = all ok.
 *
 * Binding 0.0.0.0 makes Windows Firewall ask once whether to allow Electron on the network; the test itself works
 * without an answer (a PC reaches its own addresses without going through the firewall).
 */
const fs = require('node:fs');
const net = require('node:net');

/** Runs in the page. Takes a plain object, returns plain data. */
const PAGE_SCRIPT = `(async (blockedPort) => {
  const out = { errors: [] };
  const api = window.kineticDesktop;
  out.api = api ? { isDesktop: api.isDesktop, version: api.version, keys: Object.keys(api).sort() } : null;
  out.origin = location.origin;
  out.secureContext = window.isSecureContext;
  if (!api) return out;
  out.status0 = await api.serverStatus();
  const started = await api.startServer({ port: 0 });
  out.started = started;
  const again = await api.startServer({ port: 12345 });
  out.idempotent = again.port === started.port && again.running === true;
  out.statusRunning = await api.serverStatus();

  const hostOnce = (ip, port) => new Promise(resolve => {
    const r = { opened: false };
    let ws;
    const timer = setTimeout(() => { try { ws.close(); } catch (e) {} resolve({ ...r, error: 'timeout' }); }, 6000);
    try { ws = new WebSocket('ws://' + ip + ':' + port + '/ws'); } catch (e) { clearTimeout(timer); resolve({ ...r, error: String(e) }); return; }
    ws.onopen = () => { r.opened = true; ws.send(JSON.stringify({ t: 'host', v: 1, name: 'selftest', max: 2, public: true, id: 1 })); };
    ws.onmessage = ev => { clearTimeout(timer); const m = JSON.parse(ev.data); r.reply = m.t; r.code = m.code; r.id = m.id; ws.close(1000); resolve(r); };
    ws.onerror = () => { r.sawError = true; };
    ws.onclose = ev => { clearTimeout(timer); resolve({ ...r, closed: ev.code }); };
  });

  out.hosts = {};
  for (const ip of ['127.0.0.1', ...started.ips]) {
    const base = 'http://' + ip + ':' + started.port;
    const r = {};
    for (const name of ['lan', 'rooms']) {
      try {
        const res = await fetch(base + '/api/' + name, { cache: 'no-store' });
        const j = await res.json();
        r[name] = { status: res.status, app: j.app, rooms: j.rooms ? j.rooms.length : undefined, port: j.port };
      } catch (e) { r[name] = { error: String(e) }; }
    }
    r.ws = await hostOnce(ip, started.port);
    out.hosts[ip] = r;
  }
  // the rooms the WebSockets opened are gone again once those sockets closed
  try { out.roomsAfter = (await (await fetch('http://127.0.0.1:' + started.port + '/api/rooms')).json()).rooms.length; } catch (e) { out.roomsAfter = String(e); }

  // the game's own client (src/net/WsRelayTransport.js) against the in-app server, in the real Chromium: a room,
  // both directions of the data plane, an automatic rejoin after a dropped connection, a kick, a closed room
  const tr = {};
  try {
    const { WsRelayTransport } = await import('/src/net/WsRelayTransport.js');
    const url = 'ws://127.0.0.1:' + started.port + '/ws';
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const until = async (fn, ms = 5000) => { const t0 = performance.now(); while (!fn()) { if (performance.now() - t0 > ms) return false; await sleep(20); } return true; };
    const host = new WsRelayTransport({ url });
    const client = new WsRelayTransport({ url });
    const log = { hostIn: [], clientIn: [], joins: [], leaves: [], clientClose: null };
    host.onMessage = (from, u8) => log.hostIn.push([from, u8[1], u8.length]);
    host.onPeerJoin = i => log.joins.push([i.peer, i.rejoin]);
    host.onPeerLeave = i => log.leaves.push([i.peer, i.reserved]);
    client.onMessage = (from, u8) => log.clientIn.push([from, u8[1], u8.length]);
    client.onClose = i => { log.clientClose = i.reason; };
    const hosted = await host.host({ name: 'selftest', max: 4, public: true });
    const joined = await client.join(hosted.code, 'Friend', '');
    tr.peer = joined.peer;
    host.sendTo(joined.peer, new Uint8Array([0, 0x10, 1, 2, 3]));
    host.broadcast(new Uint8Array([0, 0x81, 9, 9]));
    client.sendToHost(new Uint8Array([0, 0x01, 7]));
    tr.delivered = await until(() => log.hostIn.length === 1 && log.clientIn.length === 2);
    tr.hostIn = log.hostIn;
    tr.clientIn = log.clientIn;
    client.debugDrop();
    tr.rejoined = await until(() => client.state === 'in-room' && client.stats.reconnects === 1, 8000);
    tr.peerAfterRejoin = client.peerId;
    tr.joins = log.joins.slice();
    tr.leaves = log.leaves.slice();
    await host.kick(joined.peer, 'selftest');
    tr.kicked = await until(() => log.clientClose === 'kicked');
    await host.leave();
    host.close();
    client.close();
  } catch (e) { tr.error = String((e && e.message) || e); }
  out.transport = tr;

  await api.stopServer();
  out.statusStopped = await api.serverStatus();

  try { await api.startServer({ port: blockedPort }); out.inUse = { rejected: false }; }
  catch (e) { out.inUse = { rejected: true, code: e.code, message: e.message, isError: e instanceof Error }; }
  out.statusAfterFailure = await api.serverStatus();
  try { await api.startServer({ port: 70000 }); out.badPort = { rejected: false }; }
  catch (e) { out.badPort = { rejected: true, code: e.code, message: e.message }; }
  await api.stopServer();
  return out;
})`;

function line(ok, label, detail = '') {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? '  ' + detail : ''}`);
  return ok;
}

/**
 * @param {import('electron').BrowserWindow} win a hidden window that is loading a page on kinetic://game
 * @returns {Promise<number>} the process exit code
 */
async function run(win) {
  const consoleLines = [];
  win.webContents.on('console-message', event => consoleLines.push(event.message));
  await new Promise(resolve => win.webContents.once('did-finish-load', resolve));

  // a program that already holds a port: starting the server there must fail with a message the UI can show
  const blocker = net.createServer();
  await new Promise(resolve => blocker.listen(0, '0.0.0.0', resolve));
  const blockedPort = blocker.address().port;
  let out;
  try {
    out = await win.webContents.executeJavaScript(`${PAGE_SCRIPT}(${JSON.stringify(blockedPort)})`, true);
  } finally {
    blocker.close();
  }

  console.log('KINETIC selftest');
  let failed = 0;
  const check = (ok, label, detail) => {
    if (!line(ok, label, detail)) failed++;
  };
  check(out.origin === 'kinetic://game', 'page origin', `${out.origin} (secure context: ${out.secureContext})`);
  check(!!out.api && out.api.isDesktop === true && /^\d+\.\d+\.\d+/.test(out.api.version), 'preload api',
    out.api ? `version ${out.api.version}, ${out.api.keys.join(',')}` : 'window.kineticDesktop is missing');
  if (!out.api) {
    console.log(`console: ${consoleLines.join(' | ')}`);
    return 1;
  }
  check(out.status0.running === false, 'status before start', JSON.stringify(out.status0));
  check(out.started.running === true && out.started.port > 0 && out.started.urls.length === out.started.ips.length, 'start server',
    `port ${out.started.port}, ips ${out.started.ips.join(', ') || '(none)'}`);
  check(out.idempotent === true, 'second start returns the running server');
  check(out.statusRunning.running === true && out.statusRunning.port === out.started.port, 'status while running');
  for (const [ip, r] of Object.entries(out.hosts)) {
    check(r.lan && r.lan.status === 200 && r.lan.app === 'kinetic' && r.lan.port === out.started.port, `fetch http://${ip}/api/lan`, JSON.stringify(r.lan));
    check(r.rooms && r.rooms.status === 200, `fetch http://${ip}/api/rooms`, JSON.stringify(r.rooms));
    check(r.ws && r.ws.opened === true && r.ws.reply === 'hosted' && /^[BCDFGHJKLMNPQRSTVWXZ]{4}$/.test(r.ws.code || ''),
      `WebSocket ws://${ip}/ws -> host`, JSON.stringify(r.ws));
  }
  check(out.roomsAfter === 0, 'rooms of the closed sockets are gone', String(out.roomsAfter));
  const tr = out.transport;
  check(!tr.error && tr.delivered === true && JSON.stringify(tr.hostIn) === '[[1,1,3]]' && JSON.stringify(tr.clientIn) === '[[0,16,5],[0,129,4]]',
    'WsRelayTransport: host and client exchange packets', tr.error || JSON.stringify([tr.hostIn, tr.clientIn]));
  check(tr.rejoined === true && tr.peerAfterRejoin === tr.peer && JSON.stringify(tr.joins) === `[[${tr.peer},false],[${tr.peer},true]]` &&
    JSON.stringify(tr.leaves) === `[[${tr.peer},true]]`, 'WsRelayTransport: dropped client rejoins with its token and peer id', JSON.stringify([tr.joins, tr.leaves]));
  check(tr.kicked === true, 'WsRelayTransport: a kick reaches the client as "kicked"');
  check(out.statusStopped.running === false, 'stop server', JSON.stringify(out.statusStopped));
  // contextBridge carries only an Error's message and stack (not `code`): the message is the contract (the UI matches /in use/i)
  check(out.inUse.rejected === true && /^Port \d+ is already in use/.test(out.inUse.message) && out.inUse.isError === true,
    'port in use is a clear error', JSON.stringify(out.inUse));
  check(out.statusAfterFailure.running === false, 'a failed start leaves nothing running');
  check(out.badPort.rejected === true && /invalid port/i.test(out.badPort.message), 'invalid port is rejected', JSON.stringify(out.badPort));
  const noisy = consoleLines.filter(l => /mixed content|blocked|refused to|CORS|Private Network/i.test(l));
  if (noisy.length) console.log(`  page console: ${noisy.join(' | ')}`);
  console.log(failed ? `selftest FAILED (${failed})` : 'selftest passed');
  if (process.env.KINETIC_SELFTEST_OUT) {
    fs.writeFileSync(process.env.KINETIC_SELFTEST_OUT, JSON.stringify({ failed, out, consoleLines }, null, 2));
  }
  return failed ? 1 : 0;
}

module.exports = { run };

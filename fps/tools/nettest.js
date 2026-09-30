// Browser transport test (run by `python tools/run_mp.py --nettest`): one host page and N client pages
// exchange packets through the LAN relay with src/net/WsRelayTransport.js, plus one page for edge cases.
//
//   host:   tools/nettest.html?role=host&room=CODE&clients=3&dur=8&hz=30
//   client: tools/nettest.html?role=client&room=CODE&i=1[&drop=1][&locktest=1][&kick=1]
//   edge:   tools/nettest.html?role=edge   (own private rooms: close() while connecting, a drop during a
//           rejoin, refused joins, role checks; see runEdge)
//
// Checks: room listing + meta, host-assigned peer ids, client -> host routing (the relay stamps the sender
// id), unicast only reaches its target, reliable streams arrive complete and in order, a dropped client
// rejoins with the same id (drop=1), a locked room refuses joins (locktest=1), kick closes with 4001
// (kick=1), the host leaving closes everyone else with 4000, both close handshakes clean. Measures the
// game round trip client -> relay -> host page -> relay -> client (PING/PONG at 20 Hz) and the snapshot
// one-way latency. Results: window.__NETTEST__ (the host aggregates every client's samples). Every
// failed check is a console.error, which makes the harness exit 1.
import { WsRelayTransport } from '../src/net/WsRelayTransport.js';
import { PKT, BinaryWriter, BinaryReader, encodeJsonPacket, decodeJsonPacket, isValidCode } from '../src/net/protocol.js';

const q = new URLSearchParams(location.search);
const ROLE = q.get('role') || 'client';
const ROOM = (q.get('room') || '').toUpperCase();
const CLIENTS = +(q.get('clients') || 3);
const DUR = +(q.get('dur') || 8);
const HZ = +(q.get('hz') || 30);
const INPUT_HZ = 60;
const PING_HZ = 20;
const UNI_MS = 250;
const SNAPSHOT_BYTES = 430;          // measured size of a 16-entity game snapshot (mp-network investigation)

const R = window.__NETTEST__ = { role: ROLE, ready: false, done: false, failures: [], secure: window.isSecureContext, origin: location.origin };
const logEl = document.getElementById('log');
const log = (...a) => { logEl.textContent += '\n' + a.join(' '); };
const fail = msg => {
  R.failures.push(msg);
  console.error('nettest: ' + msg);
};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const absNow = () => performance.timeOrigin + performance.now();

async function until(fn, ms, what) {
  const t0 = performance.now();
  while (!fn()) {
    if (performance.now() - t0 > ms) throw new Error('timed out waiting for ' + what);
    await sleep(10);
  }
}

function summary(values) {
  if (!values.length) return { n: 0 };
  const a = Float64Array.from(values).sort();
  const pick = f => +a[Math.min(a.length - 1, Math.floor(f * a.length))].toFixed(3);
  let sum = 0;
  for (const v of a) sum += v;
  return { n: a.length, mean: +(sum / a.length).toFixed(3), p50: pick(0.5), p95: pick(0.95), p99: pick(0.99), max: +a[a.length - 1].toFixed(3) };
}

// ------------------------------------------------------------------------------------------ host

async function runHost() {
  const t = new WsRelayTransport();
  const peers = new Map();           // peer id -> state
  const events = [];
  const w = new BinaryWriter(1024);
  const rd = new BinaryReader();
  const pad = new Uint8Array(SNAPSHOT_BYTES - 14);
  let pongs = 0;

  t.onPeerJoin = info => {
    events.push({ ev: 'join', peer: info.peer, rejoin: info.rejoin });
    if (!peers.has(info.peer)) peers.set(info.peer, { name: info.name, ready: false, inputs: 0, lastSeq: -1, uni: 0, report: null });
  };
  t.onPeerLeave = info => {
    events.push({ ev: 'leave', peer: info.peer, reason: info.reason, reserved: info.reserved });
    if (info.reason === 'kicked') R.kicked = info.peer;
  };
  t.onMessage = (from, u8) => {
    const type = u8[1];
    if (type === PKT.PING) {           // echo the body back: the client measures the full game round trip
      w.begin(PKT.PONG);
      for (let i = 2; i < u8.length; i++) w.u8(u8[i]);
      if (t.sendTo(from, w.finish())) pongs++;
      return;
    }
    const p = peers.get(from);
    if (!p) {
      fail(`packet type ${type} from unknown peer ${from}`);
      return;
    }
    if (type === PKT.INPUT) {
      rd.reset(u8);
      const claimed = rd.u8();
      const seq = rd.u32();
      if (claimed !== from) fail(`input routed as peer ${from} but written by peer ${claimed}`);
      if (p.lastSeq >= 0 && seq !== p.lastSeq + 1) fail(`peer ${from}: input ${seq} after ${p.lastSeq}`);
      p.lastSeq = seq;
      p.inputs++;
    } else if (type === PKT.JSON) {
      const m = decodeJsonPacket(u8);
      if (m.k === 'ready') p.ready = true;
      else if (m.k === 'report') p.report = m;
    } else {
      fail(`unexpected packet type ${type} from peer ${from}`);
    }
  };
  t.onClose = info => { R.hostClose = info; };

  const hosted = await t.host({ name: 'nettest', max: CLIENTS + 1, code: ROOM || undefined });
  if (!isValidCode(hosted.code) || (ROOM && hosted.code !== ROOM)) fail(`bad room code ${hosted.code}`);
  await t.meta({ map: 'nettest', clients: CLIENTS });
  R.code = hosted.code;
  R.ready = true;
  log('hosting', hosted.code);

  await until(() => [...peers.values()].filter(p => p.ready).length === CLIENTS, 60000, 'every client ready');
  await t.lock(true);
  t.broadcast(encodeJsonPacket({ k: 'start', dur: DUR }));
  log('running', DUR, 's');

  let tick = 0;
  let rounds = 0;
  const t0 = performance.now();
  let nextSnap = t0;
  let nextUni = t0;
  await new Promise(resolve => {
    const timer = setInterval(() => {
      const now = performance.now();
      if (now - t0 >= DUR * 1000) {
        clearInterval(timer);
        resolve();
        return;
      }
      if (now >= nextSnap) {
        nextSnap += 1000 / HZ;
        if (nextSnap < now) nextSnap = now + 1000 / HZ;
        w.begin(PKT.SNAPSHOT).u32(tick++).f64(absNow()).raw(pad);
        t.broadcast(w.finish());
      }
      if (now >= nextUni) {
        nextUni += UNI_MS;
        rounds++;
        for (const [peer, p] of peers) {
          if (t.sendTo(peer, encodeJsonPacket({ k: 'uni', to: peer, n: p.uni }))) p.uni++;
        }
        t.broadcast(encodeJsonPacket({ k: 'tick', n: rounds }));
      }
    }, 1);
  });
  const uni = {};
  for (const [peer, p] of peers) uni[peer] = p.uni;
  t.broadcast(encodeJsonPacket({ k: 'end', uni, ticks: rounds, snaps: tick }));
  await until(() => [...peers.values()].every(p => p.report), 15000, 'client reports');

  const allRtt = [];
  const allOneWay = [];
  R.clients = [];
  for (const [peer, p] of peers) {
    const rep = p.report;
    allRtt.push(...rep.rtt);
    allOneWay.push(...rep.oneWay);
    if (p.inputs !== rep.inputs || p.inputs < DUR * INPUT_HZ * 0.5) fail(`peer ${peer}: host got ${p.inputs} inputs, client sent ${rep.inputs}`);
    R.clients.push({ peer, name: p.name, secure: rep.secure, rtt: summary(rep.rtt), oneWay: summary(rep.oneWay),
      inputs: p.inputs, snaps: rep.snaps, missed: rep.missed, uni: uni[peer], rejoined: rep.rejoined });
    if (rep.rejoined) {
      const mine = events.filter(e => e.peer === peer);
      const left = mine.findIndex(e => e.ev === 'leave' && e.reserved);
      const back = mine.findIndex(e => e.ev === 'join' && e.rejoin);
      if (left < 0 || back < left) fail(`peer ${peer} rejoined but the host saw ${JSON.stringify(mine)}`);
    }
  }
  R.rtt = summary(allRtt);
  R.oneWay = summary(allOneWay);
  R.snapshots = { sent: tick, hz: HZ, bytes: SNAPSHOT_BYTES };
  R.pongs = pongs;
  R.events = events;
  log('rtt', JSON.stringify(R.rtt));

  const kick = [...peers].find(([, p]) => p.report.expectKick);
  if (kick) {
    await t.kick(kick[0], 'nettest kick');
    await until(() => R.kicked === kick[0], 5000, 'kick');
  }
  await t.leave();                   // closes the room: the other clients get room-closed + 4000
  t.close();
  await until(() => t.state === 'closed', 5000, 'host close');
  R.done = true;
  log('done');
}

// ------------------------------------------------------------------------------------------ client

async function runClient() {
  const index = +(q.get('i') || 1);
  const t = new WsRelayTransport();
  const w = new BinaryWriter(64);
  const pw = new BinaryWriter(64);
  const rd = new BinaryReader();
  const rtt = [];
  const oneWay = [];
  const statuses = [];
  let snaps = 0;
  let lastTick = -1;
  let missed = 0;
  let uni = 0;
  let ticks = 0;
  let started = false;
  let ended = null;
  let inputSeq = 0;
  let pingSeq = 0;
  let closeInfo = null;

  t.onStatus = s => statuses.push(s);
  t.onClose = info => { closeInfo = info; };
  t.onMessage = (from, u8) => {
    if (from !== 0) fail(`client received a packet from peer ${from}`);
    const type = u8[1];
    if (type === PKT.SNAPSHOT) {
      rd.reset(u8);
      const tk = rd.u32();
      const sentAt = rd.f64();
      if (lastTick >= 0 && tk <= lastTick) fail(`snapshot ${tk} arrived after ${lastTick}`);
      if (lastTick >= 0) missed += tk - lastTick - 1;
      lastTick = tk;
      snaps++;
      if (started && !ended) oneWay.push(absNow() - sentAt);
    } else if (type === PKT.PONG) {
      rd.reset(u8);
      rd.u32();
      rtt.push(performance.now() - rd.f64());
    } else if (type === PKT.JSON) {
      const m = decodeJsonPacket(u8);
      if (m.k === 'uni') {
        if (m.to !== t.peerId) fail(`unicast for peer ${m.to} delivered to peer ${t.peerId}`);
        else if (m.n !== uni) fail(`unicast #${m.n} arrived, expected #${uni}`);
        uni++;
      } else if (m.k === 'tick') {
        ticks++;
      } else if (m.k === 'start') {
        started = true;
      } else if (m.k === 'end') {
        ended = m;
      }
    } else {
      fail(`unexpected packet type ${type}`);
    }
  };

  await t.connect();
  const rooms = await t.list();
  const listed = rooms.find(r => r.code === ROOM);
  if (!listed) fail(`room ${ROOM} is not listed: ${JSON.stringify(rooms)}`);
  else if (!listed.meta || listed.meta.map !== 'nettest') fail(`room meta missing: ${JSON.stringify(listed)}`);
  const joined = await t.join(ROOM, `client ${index}`);
  R.peer = joined.peer;
  log('joined', ROOM, 'as peer', joined.peer);

  if (q.has('drop')) {
    await sleep(200);
    t.debugDrop();                   // lose the connection: the transport must rejoin by itself, same peer id
    await until(() => t.state === 'in-room' && statuses.includes('reconnecting'), 15000, 'automatic rejoin');
    if (t.peerId !== joined.peer) fail(`rejoined as peer ${t.peerId}, was ${joined.peer}`);
    R.rejoined = true;
    R.reconnects = t.stats.reconnects;
    log('rejoined as peer', t.peerId);
  }
  t.sendToHost(encodeJsonPacket({ k: 'ready' }));
  await until(() => started, 60000, 'start');

  if (q.has('locktest')) {           // the host locked the room before starting: new joins are refused
    const late = new WsRelayTransport({ reconnect: false });
    try {
      await late.join(ROOM, 'late', '');   // '' = no token (this tab's saved token would take over our slot)
      fail('a join into a locked room succeeded');
    } catch (err) {
      R.lockedJoin = err.reason;
      if (err.reason !== 'room-locked') fail(`join into a locked room failed with ${err.reason}`);
    }
    late.close();
  }

  const t0 = performance.now();
  let nextIn = t0;
  let nextPing = t0;
  await new Promise(resolve => {
    const timer = setInterval(() => {
      if (ended) {
        clearInterval(timer);
        resolve();
        return;
      }
      const now = performance.now();
      if (now >= nextIn) {
        nextIn += 1000 / INPUT_HZ;
        if (nextIn < now) nextIn = now + 1000 / INPUT_HZ;
        w.begin(PKT.INPUT).u8(t.peerId).u32(inputSeq++).u16(0).i16(0);
        t.sendToHost(w.finish());
      }
      if (now >= nextPing) {
        nextPing += 1000 / PING_HZ;
        if (nextPing < now) nextPing = now + 1000 / PING_HZ;
        pw.begin(PKT.PING).u32(pingSeq++).f64(performance.now());
        t.sendToHost(pw.finish());
      }
    }, 1);
  });

  if (uni !== ended.uni[t.peerId]) fail(`received ${uni} unicasts, host sent ${ended.uni[t.peerId]}`);
  if (ticks !== ended.ticks) fail(`received ${ticks} broadcasts, host sent ${ended.ticks}`);
  if (snaps < ended.snaps * 0.9) fail(`received ${snaps} of ${ended.snaps} snapshots`);
  Object.assign(R, { rtt: summary(rtt), oneWay: summary(oneWay), snaps, snapsSent: ended.snaps, missed, uni, ticks, inputs: inputSeq, statuses });
  t.sendToHost(encodeJsonPacket({
    k: 'report', rtt: rtt.map(v => +v.toFixed(3)), oneWay: oneWay.map(v => +v.toFixed(3)), snaps, missed,
    inputs: inputSeq, rejoined: !!R.rejoined, expectKick: q.has('kick'), secure: window.isSecureContext,
  }));

  await until(() => closeInfo, 30000, 'the end of the room');
  R.close = closeInfo;
  const want = q.has('kick') ? 4001 : 4000;
  if (closeInfo.code !== want) fail(`closed with ${closeInfo.code} (${closeInfo.reason}), expected ${want}`);
  if (!closeInfo.wasClean) fail(`close ${closeInfo.code} was not a clean close handshake`);
  if (t.state !== 'closed' || t.role !== 'none') fail(`state after close: ${t.state} / ${t.role}`);
  R.done = true;
  log('done', JSON.stringify(closeInfo));
}

// ------------------------------------------------------------------------------------------ edge cases

/** Settles like `p`, or rejects with 'hung' after `ms` (a transport promise must never stay pending). */
function settleWithin(p, ms) {
  let timer = 0;
  const hung = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error('promise never settled'), { reason: 'hung' })), ms);
  });
  return Promise.race([p, hung]).finally(() => clearTimeout(timer));
}

async function expectReject(p, reason, what) {
  try {
    await settleWithin(p, 5000);
  } catch (err) {
    if (err.reason !== reason) fail(`${what}: rejected with ${err.reason || err.message}, expected ${reason}`);
    return err.reason;
  }
  fail(`${what}: resolved, expected a rejection (${reason})`);
  return 'resolved';
}

async function runEdge() {
  const E = R.edge = {};
  const closes = [];

  // 1) close() while the socket is still connecting: host() must reject (not hang) and the transport stays usable
  const a = new WsRelayTransport();
  a.onClose = info => closes.push(info);
  const pending = a.host({ name: 'edge', public: false });
  if (a.state !== 'connecting') fail(`state right after host(): ${a.state}`);
  a.close();
  E.closeWhileConnecting = await expectReject(pending, 'closed', 'host() then close() while connecting');
  if (a.state !== 'closed' || closes.length !== 1) fail(`after close(): state ${a.state}, onClose x${closes.length}`);
  try {
    const again = await settleWithin(a.host({ name: 'edge', public: false }), 5000);
    E.reusedAfterClose = isValidCode(again.code);
    await a.leave();
  } catch (err) {
    fail(`host() after close() while connecting: ${err.reason || err.message}`);
  }
  a.close();

  // 2) a refused join leaves the transport outside a room and able to try again; role checks
  const h = new WsRelayTransport();
  const hosted = await h.host({ name: 'edge-host', public: false });
  const c = new WsRelayTransport();
  E.badCode = await expectReject(c.join('ZZZZ' === hosted.code ? 'ZZZX' : 'ZZZZ', 'edge', ''), 'no-such-room', 'join a missing room');
  if (c.role !== 'none' || c.state !== 'open') fail(`after a refused join: ${c.role} / ${c.state}`);
  const pkt = encodeJsonPacket({ k: 'x' });
  if (c.sendToHost(pkt) || c.broadcast(pkt) || h.sendToHost(pkt) || c.sendTo(1, pkt)) fail('a send outside the role or room was accepted');
  const joined = await c.join(hosted.code, 'edge', '');
  if (c.sendTo(1, pkt) || c.broadcast(pkt) || h.sendTo(0, pkt) || h.sendTo(255, pkt)) fail('a client-only / host-only send was misrouted');
  E.clientKick = await expectReject(Promise.resolve().then(() => c.kick(0)), 'not-host', 'client kick');
  E.doubleJoin = await expectReject(c.join(hosted.code, 'edge', ''), 'already-in-room', 'second join');

  // 300 KB each way: Chrome splits a large send into several frames, which the relay must reassemble
  const counters = async () => (await (await fetch('/api/stats', { cache: 'no-store' })).json()).counters;
  const before = await counters();
  const big = new Uint8Array(300000);
  for (let i = 2; i < big.length; i++) big[i] = (i * 7) & 0xff;
  big[1] = PKT.EVENT;
  let atHost = null;
  let atClient = null;
  h.onMessage = (from, u8) => { if (u8[1] === PKT.EVENT) atHost = { from, u8: u8.slice() }; };
  c.onMessage = (from, u8) => { if (u8[1] === PKT.EVENT) atClient = u8.slice(); };
  if (!c.sendToHost(big)) fail('sendToHost(300 KB) was refused');
  await until(() => atHost, 5000, 'a 300 KB packet at the host');
  if (!h.sendTo(joined.peer, big)) fail('sendTo(300 KB) was refused');
  await until(() => atClient, 5000, 'a 300 KB packet at the client');
  const after = await counters();
  const intact = u8 => u8.length === big.length && u8[0] === joined.peer && u8.every((v, i) => i === 0 || v === big[i]);
  if (atHost.from !== joined.peer || !intact(atHost.u8)) fail('the 300 KB packet arrived damaged at the host');
  if (!intact(atClient)) fail('the 300 KB packet arrived damaged at the client');
  E.bigFragments = after.fragments - before.fragments;
  if (!(E.bigFragments >= 1)) fail(`the 300 KB send came as a single frame (fragments +${E.bigFragments}): reassembly untested`);

  // 3) a drop while the rejoin socket is still connecting must not start a second, parallel retry
  const open = c._openSocket.bind(c);
  let opens = 0;
  c._openSocket = () => {
    const p = open();
    if (++opens === 1) c.debugDrop();              // the first rejoin attempt dies while connecting
    return p;
  };
  const statuses = [];
  c.onStatus = s => statuses.push(s);
  c.debugDrop();
  await until(() => c.state === 'in-room', 10000, 'rejoin after a drop during the rejoin');
  await sleep(1500);                               // a stray second retry would open more sockets by now
  E.rejoinOpens = opens;
  E.rejoinPeer = c.peerId;
  E.reconnects = c.stats.reconnects;
  if (opens !== 2) fail(`the rejoin opened ${opens} sockets, expected 2 (one dropped while connecting, one good)`);
  if (c.peerId !== joined.peer || c.stats.reconnects !== 1) fail(`rejoined as peer ${c.peerId} (${c.stats.reconnects} reconnects), was ${joined.peer}`);
  if (statuses.join() !== 'reconnecting,in-room') fail(`status sequence ${statuses.join()}`);

  // 4) leave() while reconnecting ends the session without hanging, and no retry follows
  c.debugDrop();
  await settleWithin(c.leave(), 3000);
  await sleep(800);                                // past the first retry delay
  if (c.state !== 'closed' || c.role !== 'none' || c.ws) fail(`after leave() while reconnecting: ${c.state} / ${c.role} / ws ${!!c.ws}`);
  E.leaveWhileReconnecting = c.state;

  await h.leave();
  h.close();
  await until(() => h.state === 'closed', 5000, 'edge host close');
  R.done = true;
  log('edge done', JSON.stringify(E));
}

(ROLE === 'host' ? runHost() : ROLE === 'edge' ? runEdge() : runClient()).catch(err => {
  fail(err && err.stack ? err.stack : String(err));
  R.done = true;
});

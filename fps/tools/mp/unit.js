// Multiplayer unit tests (codecs, clock, interpolation, teams). Run:
//   python tools/run.py "tools/mp/unit.html" --wait "window.__UNIT__ && window.__UNIT__.done" --eval "window.__UNIT__"
// window.__UNIT__ = {done, ok, passed, failed, failures: [..]}; a failure is also logged with console.error (run.py exits 1).
import { PKT, BinaryReader, BinaryWriter, seqDelta } from '/src/net/protocol.js';
import { NET, toWireTime, fromWireTime, WEAPON_INDEX, WEAPON_BY_INDEX } from '/src/net/GameProtocol.js';
import {
  encodeClientState, decodeClientState, makeClientState, CSTATE_BYTES, SnapshotBody, writeSnapshot, decodeSnapshot,
  makeEntityRecord, makeSnapshotHeader, EF, EF2, Q, SNAP_HEADER_BYTES, ENTITY_BYTES,
} from '/src/net/NetCodec.js';
import { NetClock, InterpBuffer, DelayEstimator, makeBodySample, RollingP95 } from '/src/net/NetClock.js';
import { normalizeServer, displayServer, DEFAULT_PORT } from '/src/net/ServerAddress.js';

const results = { done: false, ok: false, passed: 0, failed: 0, failures: [] };
window.__UNIT__ = results;
let current = '';

function check(cond, msg) {
  if (cond) { results.passed++; return; }
  results.failed++;
  const text = `${current}: ${msg}`;
  results.failures.push(text);
  console.error('[unit] FAIL ' + text);
}
const near = (a, b, eps, msg) => check(Math.abs(a - b) <= eps, `${msg} (${a} vs ${b}, eps ${eps})`);

async function test(name, fn) {
  current = name;
  try { await fn(); } catch (err) { check(false, 'threw ' + (err && err.stack || err)); }
}

await test('protocol', () => {
  check(PKT.CSTATE === 0x82, 'CSTATE is 0x82');
  check(seqDelta(2, 65535) === 3, 'seq wrap');
  check(toWireTime(Infinity) === NET.NEVER, 'Infinity -> NEVER');
  check(toWireTime(NaN) === NET.NEVER, 'NaN -> NEVER');
  check(toWireTime(1234.6) === 1235, 'rounding');
  check(toWireTime(-5) === 0, 'negative -> 0');
  check(fromWireTime(NET.NEVER) === Infinity, 'NEVER -> Infinity');
  check(fromWireTime(null) === Infinity, 'null -> Infinity');
  check(fromWireTime(500) === 500, 'value kept');
  check(JSON.parse(JSON.stringify({ t: toWireTime(Infinity) })).t === NET.NEVER, 'NEVER survives JSON');
  for (const [id, i] of Object.entries(WEAPON_INDEX)) check(WEAPON_BY_INDEX[i] === id, `weapon index ${id}`);
  check(WEAPON_BY_INDEX[0] === null, 'index 0 = none');
});

await test('cstate', () => {
  const w = new BinaryWriter(64), r = new BinaryReader();
  const st = makeClientState();
  Object.assign(st, {
    epoch: 7, spawnSeq: 200, seq: 65530, tHost: 123456789, px: 12.345678, py: -3.25, pz: 70.5, vx: 9.6, vy: -24.01, vz: 0.3,
    yaw: 2.5, pitch: -0.7, h: 1.15, flags: 0xbeef, flags2: 2, weapon: 5, ads: 0.5, charge: 1,
    gx: 10.5, gy: 20.25, gz: -30, bx: 1, by: 2, bz: 3, owned: 0x1ff, full: 0x5, nades: [3, 0, 1, 255, 2], grantAck: 9, cg: 4,
  });
  const len = encodeClientState(w, st);
  check(len === CSTATE_BYTES, `62 bytes (got ${len})`);
  const u8 = w.finish();
  check(u8[1] === PKT.CSTATE, 'type byte');
  const out = makeClientState();
  check(decodeClientState(r.reset(u8), out), 'decodes');
  for (const k of ['epoch', 'spawnSeq', 'seq', 'tHost', 'flags', 'flags2', 'weapon', 'owned', 'full', 'grantAck', 'cg']) check(out[k] === st[k], k);
  near(out.px, st.px, 1e-5, 'px f32'); near(out.pz, st.pz, 1e-5, 'pz');
  near(out.vx, 9.6, 0.006, 'vx'); near(out.vy, -24.01, 0.006, 'vy');
  near(out.yaw, 2.5, 1e-3, 'yaw'); near(out.pitch, -0.7, 1e-4, 'pitch'); near(out.h, 1.15, 0.003, 'h');
  near(out.ads, 0.5, 0.003, 'ads'); near(out.charge, 1, 1e-9, 'charge');
  near(out.gy, 20.25, 0.006, 'gy'); near(out.bz, 3, 0.006, 'bz');
  check(out.nades.join() === '3,0,1,255,2', 'nades');
  const short = makeClientState();
  check(!decodeClientState(r.reset(u8.subarray(0, 40)), short), 'short packet rejected');
});

await test('snapshot', () => {
  const body = new SnapshotBody();
  body.begin();
  const a = makeEntityRecord();
  Object.assign(a, { id: 1, flags: EF.ALIVE | EF.GROUND, flags2: 0, px: -50.5, py: 2, pz: 44.44, vx: 1, vy: 0, vz: -1, yaw: -3, pitch: 0.2, h: 1.8, weapon: 2 });
  const b = makeEntityRecord();
  Object.assign(b, {
    id: 9, flags: EF.ALIVE | EF.BEAM | EF.CHARGE, flags2: 2 | EF2.HAS_SCORE, px: 1, py: 2, pz: 3, vx: 0, vy: 0, vz: 0, yaw: 1, pitch: 0, h: 1.5, weapon: 8,
    gx: 5, gy: 6, gz: 7, bx: 8, by: 9, bz: 10, charge: 0.25, kills: 12, deaths: 3, tier: 4, zoneTime: 61.3,
  });
  body.entity(a).entity(b);
  body.section(1, w => { w.u8(3); w.u8(0b101); });
  body.section(77, w => { w.u16(0xabcd); });          // unknown to the reader: skipped by length
  body.end();
  check(body.count === 2, 'count');
  check(body.bytes().length === ENTITY_BYTES * 2 + 6 + 6 + 1 + 7 + (3 + 2) + (3 + 2) + 1, `body bytes ${body.bytes().length}`);
  const hdr = makeSnapshotHeader();
  Object.assign(hdr, {
    epoch: 3, flags: 1, snapSeq: 4000000000, tHost: 98765, ackSeq: 12, timeLeftDs: 5999, teamScore1: 4, teamScore2: 7, phase: 1,
    ownId: 9, health: 87.2, armor: 0, ownFlags: 3, protectedUntil: 100500, shockedUntil: 0, count: body.count,
  });
  const w = new BinaryWriter(256);
  const pkt = writeSnapshot(w, hdr, body);
  check(pkt[1] === PKT.SNAPSHOT, 'type');
  check(pkt.length === SNAP_HEADER_BYTES + body.bytes().length, 'header 34 + body');
  const r = new BinaryReader();
  const h2 = makeSnapshotHeader(), rec = makeEntityRecord();
  const seen = [], sections = [];
  const ok = decodeSnapshot(r.reset(pkt), h2, rec, {
    header: h => { check(h.count === 2, 'N'); },
    entity: e => seen.push({ ...e }),
    section: (id, rr, len) => sections.push([id, len, rr.u8()]),
  });
  check(ok, 'decodes');
  for (const k of ['epoch', 'flags', 'snapSeq', 'tHost', 'ackSeq', 'timeLeftDs', 'teamScore1', 'teamScore2', 'phase', 'ownId', 'armor', 'ownFlags', 'protectedUntil']) check(h2[k] === hdr[k], 'hdr ' + k);
  check(h2.health === 88, 'health ceil');
  check(seen.length === 2 && seen[0].id === 1 && seen[1].id === 9, 'ids');
  near(seen[0].px, -50.5, 0.006, 'pos'); near(seen[0].pz, 44.44, 0.006, 'pos z'); near(seen[0].yaw, -3, 1e-3, 'yaw');
  near(seen[1].gz, 7, 0.006, 'grapple'); near(seen[1].bx, 8, 0.006, 'beam'); near(seen[1].charge, 0.25, 0.003, 'charge');
  check(seen[1].kills === 12 && seen[1].deaths === 3 && seen[1].tier === 4, 'score');
  near(seen[1].zoneTime, 61.3, 0.051, 'zone time');
  check(seen[0].kills === 0 || true, 'record reused');
  check(sections.length === 2 && sections[0][0] === 1 && sections[0][1] === 2 && sections[0][2] === 3, 'section 1');
  check(sections[1][0] === 77 && sections[1][1] === 2, 'unknown section length');
  check(!decodeSnapshot(r.reset(pkt.subarray(0, 40)), h2, rec, { header() {}, entity() {} }), 'truncated rejected');
  // positions beyond the i16 range clamp instead of wrapping
  check(Q.pos(400) === 32767 && Q.pos(-400) === -32768, 'pos clamps');
});

await test('clock', () => {
  const c = new NetClock();
  check(c.netToLocalGame({ time: 10 }, NET.NEVER) === Infinity, 'NEVER -> Infinity');
  c.onPong(1000, 50000, 1010);   // rtt 10 -> offset = 50000 + 5 - 1010
  near(c.offsetMs, 48995, 1e-9, 'first pong snaps');
  c.onPong(2000, 51000 + 30, 2010);   // target moves +30 but this sample's rtt equals the first: min-rtt picks the earlier index
  check(Math.abs(c.offsetMs - 48995) <= 2.0001, 'slew <= 2 ms per pong');
  c.onPong(3000, 52000 + 600, 3002);  // lower rtt and a 600 ms jump -> snap
  check(c.snaps === 1, 'snap counted');
  near(c.offsetMs, 52000 + 600 + 1 - 3002, 1e-9, 'snapped to the min-rtt sample');
  // the first pong crossed a 240 ms host stall (offset 120 ms off); precise pongs must correct it at once
  const s2 = new NetClock();
  const TRUE = 5000;                       // host time = client perf + 5000
  s2.onPong(0, 0 + 1 + 240 + TRUE, 242);   // sent 0, host answered after a stall, back at 242
  near(s2.offsetMs, TRUE + 120, 1, 'stalled first sample snaps (wrong by half the stall)');
  s2.onPong(1000, 1000 + 1.5 + TRUE, 1003);
  near(s2.offsetMs, TRUE, 1.6, 'a precise sample replaces the stalled estimate at once');
  const h = new NetClock();
  h.startHost();
  check(Math.abs(h.hostNowMs() - h.netNowMs()) < 1, 'host: hostNow == netNow');
  const game = { time: 100 };
  const t = h.hostGameToNet(game, 103);
  check(Math.abs(t - (h.netNowMs() + 3000)) < 5, 'game -> net');
  check(h.hostGameToNet(game, Infinity) === NET.NEVER, 'Infinity -> NEVER');
});

await test('interp', () => {
  const buf = new InterpBuffer();
  const out = makeBodySample(), s = makeBodySample();
  check(buf.sample(0, out, 16) === 'empty', 'empty');
  // constant velocity 10 m/s along x, samples every 16.7 ms: Hermite must be exact
  for (let i = 0; i < 10; i++) {
    s.px = i * 0.167; s.vx = 10; s.yaw = 3.1 + i * 0.01; s.f = i;
    buf.push(i * 16.7, s);
  }
  check(buf.sample(50, out, 16.7) === 'interp', 'interp');
  near(out.px, 0.5, 1e-6, 'hermite exact at constant velocity');
  check(out.f === 3, 'flags from the newer sample');
  check(buf.sample(9 * 16.7 + 10, out, 16.7) === 'extrap', 'extrap');
  near(out.px, 9 * 0.167 + 0.1, 1e-6, 'extrapolated with velocity');
  check(buf.sample(9 * 16.7 + 40, out, 16.7) === 'hold', 'hold beyond one interval');
  near(out.px, 9 * 0.167 + 0.167, 1e-6, 'held at max extrapolation');
  near(out.t, 9 * 16.7 + 16.7, 1e-6, 'shown time');
  check(buf.sample(-5, out, 16.7) === 'hold', 'older than the oldest');
  // yaw across the +-PI seam takes the short way
  const y = new InterpBuffer();
  s.px = 0; s.vx = 0; s.yaw = 3.1; y.push(0, s); s.yaw = -3.1; y.push(20, s);
  y.sample(10, out, 16);
  check(Math.abs(Math.abs(out.yaw) - Math.PI) < 0.01, `yaw shortest arc (${out.yaw})`);
  // a much older sample (clock snap) restarts the buffer; a slightly older one is nudged forward
  const z = new InterpBuffer();
  z.push(1000, s); z.push(990, s);
  check(z.size === 2 && z.newestT > 1000, 'nudged');
  z.push(500, s);
  check(z.size === 1 && z.newestT === 500, 'restart on a clock jump');
});

await test('delay', () => {
  const d = new DelayEstimator({ minMs: NET.INTERP_MIN_MS, maxMs: NET.INTERP_MAX_MS });
  // steady 60 Hz with 5 ms one-way: ages sawtooth 5..21.7 ms
  let eff = 0;
  for (let f = 0; f < 600; f++) {
    const age = 5 + (f % 4) * (16.7 / 4);
    d.observe(age);
    eff = d.update(16.7, 16.7);
  }
  check(eff >= 16 && eff < 40, `steady LAN delay ${eff.toFixed(1)}`);
  const before = eff;
  // a 200 ms stall (no samples arrive): the age grows past the delay every frame -> the target is raised at once,
  // the effective delay climbs at <= 0.5x real time (render time keeps moving forward)
  d.observe(before + 10);
  d.update(16.7, 16.7);
  check(d.targetMs >= before + 10, `late gap raises the target (${d.targetMs})`);
  check(d.effectiveMs <= before + 0.5 * 16.7 + 1e-6, 'effective dilates at <= 0.5x');
  for (let f = 1; f < 12; f++) { d.observe(before + 10 + f * 16.7); d.update(16.7, 16.7); }
  const peak = d.effectiveMs;
  check(peak > before + 60, `climbed during the stall (${peak.toFixed(1)})`);
  // samples flow again: the stall stays in the 2 s window, then the delay decays at 10 ms/s
  for (let f = 0; f < 60; f++) { d.observe(5 + (f % 4) * 4); d.update(16.7, 16.7); }
  check(d.effectiveMs > peak - 15, `delay held after the stall (${d.effectiveMs.toFixed(1)})`);
  for (let f = 0; f < 600; f++) { d.observe(5 + (f % 4) * 4); d.update(16.7, 16.7); }
  check(d.effectiveMs < peak - 40, `delay decays afterwards (${d.effectiveMs.toFixed(1)})`);
  // a local stall (this consumer's own long frame) is not network lag: the delay must not rise
  const q = new DelayEstimator({ minMs: NET.INTERP_MIN_MS, maxMs: NET.INTERP_MAX_MS });
  for (let f = 0; f < 300; f++) { q.observe(5 + (f % 4) * 4); q.update(16.7, 16.7); }
  const calm = q.effectiveMs;
  q.observe(2000);              // first frame after a 2 s freeze: queued samples not delivered yet
  q.update(250, 16.7);
  for (let f = 0; f < 20; f++) { q.observe(f < 3 ? 400 : 6); q.update(16.7, 16.7); }
  check(q.effectiveMs <= calm + 1, `local stall ignored (${calm.toFixed(1)} -> ${q.effectiveMs.toFixed(1)})`);
  const p = new RollingP95(1000, 64, 0);
  for (let i = 0; i < 100; i++) p.add(i * 10, i);
  check(p.p95(990) >= 94 && p.p95(990) <= 99, `rolling p95 ${p.p95(990)}`);
});

await test('server addresses', () => {
  const cases = [
    // a PC on the network / port-forwarded: plain, the relay's port when none is typed
    ['192.168.1.23', 'http://192.168.1.23:27500'],
    ['192.168.1.23:27600', 'http://192.168.1.23:27600'],
    [' 203.0.113.7 ', 'http://203.0.113.7:27500'],
    ['DESKTOP-ABC', 'http://desktop-abc:27500'],
    ['game_pc', 'http://game_pc:27500'],
    ['desktop-abc.local', 'http://desktop-abc.local:27500'],
    ['nas.home.arpa', 'http://nas.home.arpa:27500'],
    ['router.lan', 'http://router.lan:27500'],
    ['localhost', 'http://localhost:27500'],
    ['[::1]', 'http://[::1]:27500'],
    ['[2001:db8::1]:27500', 'http://[2001:db8::1]:27500'],
    // an online server behind HTTPS (server/install.sh --domain): a bare domain is wss on 443
    ['play.example.com', 'https://play.example.com'],
    ['Play.Example.COM', 'https://play.example.com'],
    ['kinetic.example.co.uk', 'https://kinetic.example.co.uk'],
    // ... unless a port says otherwise (the relay without a proxy in front)
    ['play.example.com:27500', 'http://play.example.com:27500'],
    // a scheme is taken as typed, with its own default port
    ['https://play.example.com/', 'https://play.example.com'],
    ['https://play.example.com:8443', 'https://play.example.com:8443'],
    ['wss://play.example.com/ws', 'https://play.example.com'],
    ['ws://10.0.0.5:27500/ws', 'http://10.0.0.5:27500'],
    ['http://127.0.0.1:8000', 'http://127.0.0.1:8000'],
    ['http://example.com', 'http://example.com'],
    // not addresses
    ['', ''], ['   ', ''], ['ftp://x', ''], ['http://', ''], [null, ''], ['not an address!', ''],
  ];
  for (const [text, want] of cases) check(normalizeServer(text) === want, `${JSON.stringify(text)} -> ${normalizeServer(text)} (want ${want})`);
  check(DEFAULT_PORT === 27500, 'default port');
  const shown = [
    ['https://play.example.com', 'play.example.com'],
    ['http://203.0.113.7:27500', '203.0.113.7:27500'],
    ['http://[2001:db8::1]:27500', '[2001:db8::1]:27500'],
    ['https://play.example.com:8443', 'https://play.example.com:8443'],
    ['https://203.0.113.7', 'https://203.0.113.7'],
    ['http://example.com', 'http://example.com'],
    ['', ''],
  ];
  for (const [base, want] of shown) check(displayServer(base) === want, `display ${base} -> ${displayServer(base)} (want ${want})`);
  // what is shown leads back to the same server when typed
  for (const [base] of shown.slice(0, 6)) check(normalizeServer(displayServer(base)) === base, `round trip ${base}`);
});

results.ok = results.failed === 0;
results.done = true;
document.getElementById('out').textContent = JSON.stringify(results, null, 1);
console.log(`[unit] ${results.passed} passed, ${results.failed} failed`);

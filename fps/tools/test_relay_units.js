'use strict';
/**
 * Unit tests for the pure helpers of desktop/relay.js and for its lifecycle (listen / close). The wire contract is
 * tested black-box by tools/test_relay_node.py, which also runs this file:
 *
 *     node --test tools/test_relay_units.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const crypto = require('node:crypto');
const { isUtf8 } = require('node:buffer');
const relay = require('../desktop/relay.js');

test('rankIpv4s keeps usable LAN addresses, private ones first', () => {
  assert.deepEqual(
    relay.rankIpv4s(['127.0.0.1', '100.101.1.2', '172.20.5.157', '169.254.3.4', '0.0.0.0', 'junk', '192.168.1.5',
      '172.20.5.157', '224.0.0.1']),
    ['172.20.5.157', '192.168.1.5', '100.101.1.2']);
  assert.deepEqual(relay.rankIpv4s(['8.8.4.4', '10.1.2.3', '172.32.0.1', '172.16.0.9', '172.15.255.255']),
    ['10.1.2.3', '172.16.0.9', '8.8.4.4', '172.32.0.1', '172.15.255.255']);
  assert.deepEqual(relay.rankIpv4s(['255.255.255.255', '240.0.0.1', '01.2.3.4', '1.2.3', '1.2.3.4.5', '', null, 5]), []);
});

test('interfaceIpv4s skips virtual adapters and loopback, keeps real ones in order', () => {
  const nic = (address, internal = false, family = 'IPv4') => [{ address, family, internal }];
  const ifaces = {
    'vEthernet (WSL (Hyper-V firewall))': nic('172.17.96.1'),
    'vEthernet (Default Switch)': nic('172.27.64.1'),
    'VirtualBox Host-Only Network': nic('192.168.56.1'),
    'VMware Network Adapter VMnet8': nic('192.168.209.1'),
    docker0: nic('172.18.0.1'),
    veth1234: nic('172.19.0.1'),
    'Loopback Pseudo-Interface 1': nic('127.0.0.1', true),
    'Wi-Fi': [...nic('192.168.1.20'), ...nic('fe80::1', false, 'IPv6')],
    'Ethernet 2': nic('10.0.0.5'),
  };
  assert.deepEqual(relay.interfaceIpv4s(ifaces), ['192.168.1.20', '10.0.0.5']);
  // a VM whose only adapters look virtual still offers them
  assert.deepEqual(relay.interfaceIpv4s({ 'VMware Network Adapter VMnet1': nic('192.168.5.9'), lo: nic('127.0.0.1', true) }), ['192.168.5.9']);
  assert.deepEqual(relay.interfaceIpv4s({}), []);
  assert.deepEqual(relay.interfaceIpv4s({ eth0: [{ address: '10.1.1.1', family: 4, internal: false }] }), ['10.1.1.1']);   // old Node: numeric family
  // the default-route address (probe result) goes first, whatever the adapter is called; link-local and duplicates go
  assert.deepEqual(relay.rankIpv4s(['192.168.1.20', '172.17.96.1', '192.168.1.20', '169.254.9.9']), ['192.168.1.20', '172.17.96.1']);
});

test('lanIpv4s lists addresses of this PC: routable first, never loopback or link-local', () => {
  const ips = relay.lanIpv4s();
  assert.ok(Array.isArray(ips));
  for (const ip of ips) assert.doesNotMatch(ip, /^(127\.|169\.254\.|0\.)/);
  assert.equal(new Set(ips).size, ips.length);
});

test('isLoopbackHost', () => {
  for (const h of ['127.0.0.1', '127.1.2.3', 'localhost', 'LOCALHOST', '::1', '::ffff:127.0.0.1']) assert.equal(relay.isLoopbackHost(h), true, h);
  for (const h of ['0.0.0.0', '192.168.1.1', '', '::', 'example.com', '128.0.0.1']) assert.equal(relay.isLoopbackHost(h), false, h);
});

test('ipKey: IPv4 as is, IPv6 by /64', () => {
  assert.equal(relay.ipKey('192.168.1.7'), '192.168.1.7');
  assert.equal(relay.ipKey('::ffff:1.2.3.4'), '1.2.3.4');
  assert.equal(relay.ipKey('fe80::1%eth0'), relay.ipKey('fe80::2'));
  assert.equal(relay.ipKey('2001:db8:1:2:aaaa:bbbb:cccc:dddd'), relay.ipKey('2001:db8:1:2::1'));
  assert.notEqual(relay.ipKey('2001:db8:1:2::1'), relay.ipKey('2001:db8:1:3::1'));
  assert.equal(relay.ipKey('::1'), '0:0:0:0::/64');
  assert.equal(relay.ipKey(undefined), '?');
});

test('room codes', () => {
  assert.equal(relay.CODE_ALPHABET, 'BCDFGHJKLMNPQRSTVWXZ');
  assert.equal(relay.normalizeCode(' b c-d f '), 'BCDF');
  assert.equal(relay.normalizeCode(1234), '');
  assert.equal(relay.normalizeCode(null), '');
  assert.equal(relay.validCode('BCDF'), true);
  assert.equal(relay.validCode('ABCD'), false);   // vowels never appear
  assert.equal(relay.validCode('BCD'), false);
  assert.equal(relay.validCode('BCDFG'), false);
  const taken = new Set();
  for (let i = 0; i < 2000; i++) {
    const code = relay.newCode(taken);
    assert.match(code, /^[BCDFGHJKLMNPQRSTVWXZ]{4}$/);
    assert.equal(taken.has(code), false);
    taken.add(code);
  }
});

test('cleanText', () => {
  assert.equal(relay.cleanText('  Sam\x00\x07  the\n great  ', 'P', 24), 'Sam the great');
  assert.equal(relay.cleanText('B'.repeat(40), 'P', 24), 'B'.repeat(24));
  assert.equal(relay.cleanText(5, 'P', 24), 'P');
  assert.equal(relay.cleanText('   \t\n ', 'P', 24), 'P');
  assert.equal(relay.cleanText('a\ud83db', 'P', 24), 'a b');            // a lone surrogate is not printable
  assert.equal(relay.cleanText('\u{1F600}'.repeat(40), 'P', 24), '\u{1F600}'.repeat(24));   // cut by characters, not units
  assert.equal(relay.cleanText('a b c', 'P', 24), 'a b c');    // non-ASCII spaces collapse
  assert.equal(relay.cleanText('x'.repeat(1 << 20), 'P', 32).length, 32);
});

test('parseControl follows the browser JSON.parse minus numbers that overflow and absurd nesting', () => {
  assert.deepEqual(relay.parseControl('{"t":"host","max":1e308,"id":"x"}'), { t: 'host', max: 1e308, id: 'x' });
  for (const bad of ['', 'not json', '{"t":', '{"max":1e999}', '{"max":-1e999}', '{"meta":{"x":[1,2,1e400]}}', '{"a":NaN}',
    '{"a":Infinity}', '[1,]', "{'t':'x'}", '﻿{}']) {
    assert.throws(() => relay.parseControl(bad), SyntaxError, bad);
  }
  const nest = n => '['.repeat(n) + ']'.repeat(n);
  assert.doesNotThrow(() => relay.parseControl(nest(64)));
  assert.throws(() => relay.parseControl(nest(65)), /nested/);
  assert.throws(() => relay.parseControl(nest(50000)), /nested/);
  assert.doesNotThrow(() => relay.parseControl('{"s":"' + '[{'.repeat(500) + '"}'));     // brackets inside strings do not count
  assert.deepEqual(relay.parseControl('{"__proto__":{"polluted":1}}').__proto__, { polluted: 1 });   // an own key, not the prototype
  assert.equal({}.polluted, undefined);
});

test('metaOk', () => {
  assert.equal(relay.metaOk({ map: 'foundry', mode: 'ffa' }), true);
  assert.equal(relay.metaOk({}), true);
  for (const bad of [null, undefined, 'x', 5, [], [1]]) assert.equal(relay.metaOk(bad), false);
  assert.equal(relay.metaOk({ x: 'y'.repeat(5000) }), false);
  assert.equal(relay.metaOk({ x: 'y'.repeat(4000) }), true);
  assert.equal(relay.metaOk({ x: 'é'.repeat(700) }), false);   // non-ASCII counts as a \uXXXX escape, like the Python relay
  assert.equal(relay.metaOk({ x: 'é'.repeat(600) }), true);
});

test('encodeClose never cuts a character in half and keeps the frame within 125 bytes', () => {
  const frame = relay.encodeClose(1001, '€'.repeat(200));           // 3 bytes per character
  assert.equal(frame[0], 0x88);
  assert.ok(frame[1] <= 125);
  assert.equal(frame.length, 2 + frame[1]);
  assert.equal(frame.readUInt16BE(2), 1001);
  const reason = frame.subarray(4);
  assert.ok(isUtf8(reason));
  assert.equal(reason.length % 3, 0);
  assert.deepEqual([...relay.encodeClose(4001, 'be nice')], [0x88, 9, 0x0f, 0xa1, ...Buffer.from('be nice')]);
});

test('parseArgs', () => {
  assert.deepEqual(relay.parseArgs([]), { port: 27500, host: '0.0.0.0', quiet: false, testHooks: false, hostKeyFile: '', options: {} });
  const o = relay.parseArgs(['--trust-proxy', '--no-room-list', '--no-lan-info', '--allow-host', 'play.example.com',
    '--allow-host=b.example', '--host-key-file', '/etc/kinetic-relay/host-key']);
  assert.equal(o.hostKeyFile, '/etc/kinetic-relay/host-key');
  assert.deepEqual(o.options, { trustProxy: 1, listRooms: 0, lanInfo: 0, allowedHosts: ['play.example.com', 'b.example'] });
  // the key never comes from the command line (any user of the machine can read it there); the switches take no value
  for (const bad of [['--host-key', 'x'], ['--host-key=x'], ['--trust-proxy=1'], ['--list-rooms', '0'], ['--lan-info', '0'],
    ['--allowed-hosts', 'x'], ['--host-key-file']]) {
    assert.ok(relay.parseArgs(bad).error, bad.join(' '));
  }
  const a = relay.parseArgs(['--loopback', '--port', '0', '--idle-timeout', '2', '--max-conns-per-ip=3', '--quiet',
    '--allow-origin', 'https://a.example', '--allow-origin=https://b.example', '--join-rate', '0']);
  assert.equal(a.host, '127.0.0.1');
  assert.equal(a.port, 0);
  assert.equal(a.quiet, true);
  assert.deepEqual(a.options, { idleTimeout: 2, maxConnsPerIp: 3, joinRate: 0,
    allowedOrigins: ['kinetic://game', 'https://a.example', 'https://b.example'] });
  assert.equal(relay.parseArgs(['--help']).help, true);
  for (const bad of [['--port', '70000'], ['--port', 'x'], ['--nope', '1'], ['--idle-timeout'], ['--idle-timeout', '-1'], ['stray'],
    ['--allowed-origins', 'x']]) {
    assert.ok(relay.parseArgs(bad).error, bad.join(' '));
  }
});

test('createRelay validates its options', () => {
  assert.throws(() => relay.createRelay({ nonsense: 1 }), /unknown relay option\(s\): nonsense/);
  assert.throws(() => relay.createRelay({ idleTimeout: -1 }), TypeError);
  assert.throws(() => relay.createRelay({ maxRooms: 'many' }), TypeError);
  assert.throws(() => relay.createRelay({ allowedOrigins: 'kinetic://game' }), TypeError);
  assert.doesNotThrow(() => relay.createRelay({ idle_timeout: 1, maxConns: 2, max_room_peers: 10, log: () => {} }));
  const api = relay.createRelay();
  assert.deepEqual(Object.keys(api).sort(), ['close', 'lanInfo', 'listen', 'rooms', 'stats']);
  assert.equal(relay.createRelay({ testHooks: true }).armFault instanceof Function, true);
  assert.equal(relay.DEFAULTS.maxMessage, 1 << 20);
  assert.equal(relay.DEFAULTS.maxBacklog, 2 << 20);
  assert.equal(relay.DEFAULTS.maxConnsPerIp, 8);
  assert.equal(relay.DEFAULTS.handshakeTimeout, 5);
  // an online server's options: off by default (the desktop app's built-in server behaves as before)
  assert.deepEqual([relay.DEFAULTS.hostKey, relay.DEFAULTS.trustProxy, relay.DEFAULTS.listRooms, relay.DEFAULTS.lanInfo],
    ['', 0, 1, 1]);
  assert.throws(() => relay.createRelay({ hostKey: 42 }), TypeError);
  assert.throws(() => relay.createRelay({ hostKey: 'k'.repeat(257) }), TypeError);
  assert.throws(() => relay.createRelay({ allowedHosts: 'a.example' }), TypeError);
  assert.doesNotThrow(() => relay.createRelay({ hostKey: 'secret', trustProxy: 1, listRooms: 0, lanInfo: 0, allowedHosts: ['a.example'] }));
});

test('forwardedFor takes the address the proxy appended', () => {
  const f = relay.forwardedFor;
  assert.equal(f('203.0.113.9'), '203.0.113.9');
  assert.equal(f('198.51.100.1, 203.0.113.9'), '203.0.113.9');        // the client may prepend anything it likes
  assert.equal(f(' 1.2.3.4 ,  203.0.113.9 '), '203.0.113.9');
  assert.equal(f(['198.51.100.1', '203.0.113.9']), '203.0.113.9');    // repeated headers
  assert.equal(f('2001:db8::1'), '2001:db8::1');
  assert.equal(f('[2001:db8::1]:443'), '2001:db8::1');
  assert.equal(f('::ffff:10.0.0.2'), '10.0.0.2');
  assert.equal(f('10.0.0.3:5555'), '10.0.0.3');
  for (const bad of [undefined, '', 'unknown', '203.0.113.9, nope', '999.1.1.1', 'x'.repeat(5000), 42]) assert.equal(f(bad), null, String(bad).slice(0, 20));
});

test('readHostKey: the file wins over the environment, whitespace is trimmed', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  assert.equal(relay.readHostKey('', {}), '');
  assert.equal(relay.readHostKey('', { KINETIC_HOST_KEY: '  env-key \n' }), 'env-key');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kinetic-key-'));
  try {
    const file = path.join(dir, 'host-key');
    fs.writeFileSync(file, 'file-key\r\nsecond line ignored\n');
    assert.equal(relay.readHostKey(file, { KINETIC_HOST_KEY: 'env-key' }), 'file-key');
    fs.writeFileSync(file, '\n');
    assert.throws(() => relay.readHostKey(file, {}), /empty/);
    fs.writeFileSync(file, 'k'.repeat(300));
    assert.throws(() => relay.readHostKey(file, {}), /longer/);
    assert.throws(() => relay.readHostKey(path.join(dir, 'missing'), {}), /cannot read/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------------------- lifecycle

/** A minimal WebSocket client: handshake, masked text frames out, parsed (unmasked) frames in. */
function wsClient(port, headers = '') {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1');
    const key = crypto.randomBytes(16).toString('base64');
    const frames = [];
    const waiters = [];
    let buf = Buffer.alloc(0);
    let upgraded = false;
    let closed = false;
    const pump = () => {
      while (waiters.length && (frames.length || closed)) waiters.shift()(frames.shift() || null);
    };
    const client = {
      socket,
      send(text) {
        const body = Buffer.from(text);
        const mask = crypto.randomBytes(4);
        const masked = Buffer.from(body.map((b, i) => b ^ mask[i & 3]));
        socket.write(Buffer.concat([Buffer.from([0x81, 0x80 | body.length]), mask, masked]));
      },
      next() {
        return new Promise(res => {
          waiters.push(res);
          pump();
        });
      },
      get closed() { return closed; },
    };
    socket.on('error', err => reject(err));          // after the promise settled this is ignored
    socket.on('close', () => {
      closed = true;
      reject(new Error('closed before the upgrade'));
      pump();
    });
    socket.on('data', chunk => {
      buf = Buffer.concat([buf, chunk]);
      if (!upgraded) {
        const end = buf.indexOf('\r\n\r\n');
        if (end < 0) return;
        if (!buf.subarray(0, 12).toString().startsWith('HTTP/1.1 101')) return reject(new Error(buf.subarray(0, 40).toString()));
        buf = buf.subarray(end + 4);
        upgraded = true;
        resolve(client);
      }
      while (buf.length >= 2) {
        let n = buf[1] & 0x7f;
        let hl = 2;
        if (n === 126) { n = buf.readUInt16BE(2); hl = 4; }
        if (buf.length < hl + n) break;
        frames.push({ op: buf[0] & 0x0f, payload: buf.subarray(hl, hl + n) });
        buf = buf.subarray(hl + n);
      }
      pump();
    });
    socket.write(`GET /ws HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n` +
      `Sec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n${headers}\r\n`);
  });
}

test('listen / lanInfo / rooms / close', async () => {
  const events = [];
  const r = relay.createRelay({ log: t => events.push(t), maxConnsPerIp: 0 });
  assert.deepEqual(r.rooms(), []);
  assert.equal(r.lanInfo().port, 0);
  const bound = await r.listen({ host: '127.0.0.1', port: 0 });
  assert.equal(bound.host, '127.0.0.1');
  assert.ok(bound.port > 0);
  await assert.rejects(r.listen({ host: '127.0.0.1', port: 0 }), /already listening/);
  const info = r.lanInfo();
  assert.deepEqual([info.app, info.relay, info.port, info.lan, info.bind], ['kinetic', 1, bound.port, false, '127.0.0.1']);
  assert.deepEqual(info.urls, info.ips.map(ip => `http://${ip}:${bound.port}`));
  for (const ip of info.ips) assert.doesNotMatch(ip, /^(127\.|169\.254\.)/);

  const host = await wsClient(bound.port, 'Origin: kinetic://game\r\n');
  host.send(JSON.stringify({ t: 'host', name: 'Unit', public: true, meta: { map: 'x' } }));
  const hosted = JSON.parse((await host.next()).payload);
  assert.equal(hosted.t, 'hosted');
  assert.deepEqual(r.rooms().map(x => [x.code, x.name, x.players, x.meta]), [[hosted.code, 'Unit', 1, { map: 'x' }]]);
  const guest = await wsClient(bound.port);
  guest.send(JSON.stringify({ t: 'join', code: hosted.code, name: 'G' }));
  assert.equal(JSON.parse((await guest.next()).payload).t, 'joined');
  assert.equal(JSON.parse((await host.next()).payload).t, 'peer-join');
  const st = r.stats();
  assert.equal(st.counters.rooms_opened, 1);
  assert.equal(st.conns.length, 2);
  assert.ok(events.some(e => e.includes(`room ${hosted.code} opened`)));

  const t0 = Date.now();
  const closing = r.close();
  assert.equal(r.close(), closing, 'close() is idempotent');
  for (const c of [host, guest]) {
    const f = await c.next();
    assert.equal(f.op, 0x8);
    assert.equal(f.payload.readUInt16BE(0), 1001);
    assert.equal(f.payload.subarray(2).toString(), 'server stopping');
  }
  await closing;
  assert.ok(Date.now() - t0 < 2500, 'close() resolves promptly');
  assert.equal(host.socket.destroyed || host.closed, true);
  await assert.rejects(wsClient(bound.port), /ECONNREFUSED|reset/i);   // nobody listens any more
});

test('listen reports a port in use with code EADDRINUSE', async () => {
  const a = relay.createRelay();
  const { port } = await a.listen({ host: '127.0.0.1', port: 0 });
  const b = relay.createRelay();
  await assert.rejects(b.listen({ host: '127.0.0.1', port }), err => err.code === 'EADDRINUSE');
  assert.match(relay.listenErrorText({ code: 'EADDRINUSE' }, port), /already in use/);
  assert.match(relay.listenErrorText({ code: 'EACCES' }, port), /excludedportrange/);
  await a.close();
  await b.close();
});

test('an internal error closes only that connection with 1011', async () => {
  const errors = [];
  const r = relay.createRelay({ testHooks: true, errorLog: t => errors.push(t), maxConnsPerIp: 0 });
  const { port } = await r.listen({ host: '127.0.0.1', port: 0 });
  const a = await wsClient(port);
  const b = await wsClient(port);
  r.armFault('ping');
  a.send('{"t":"ping","c":1}');
  const f = await a.next();
  assert.equal(f.op, 0x8);
  assert.equal(f.payload.readUInt16BE(0), 1011);
  assert.equal(f.payload.subarray(2).toString(), 'relay error');         // no stack trace, no internals
  b.send('{"t":"ping","c":2}');
  assert.equal(JSON.parse((await b.next()).payload).c, 2);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /injected fault/);
  assert.equal(r.stats().counters.internal_errors, 1);
  await r.close();
});

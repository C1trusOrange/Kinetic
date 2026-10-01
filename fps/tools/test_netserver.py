#!/usr/bin/env python3
"""Unit tests for the KINETIC LAN relay (tools/netserver.py) and its server (tools/serve.py).

Stdlib unittest, loopback only (every server binds 127.0.0.1; nothing ever binds 0.0.0.0):

    python tools/test_netserver.py            # all tests (~30 s)
    python tools/test_netserver.py -v -k Room # a subset
"""
import base64
import contextlib
import hashlib
import io
import json
import os
import socket
import struct
import subprocess
import sys
import threading
import time
import unittest
import urllib.error
import urllib.request

TOOLS = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, TOOLS)
import netserver  # noqa: E402
import serve  # noqa: E402

GUID = b'258EAFA5-E914-47DA-95CA-C5AB0DC85B11'


class Closed(Exception):
    """The server sent a close frame."""

    def __init__(self, code, reason):
        super().__init__(f'closed {code} {reason!r}')
        self.code = code
        self.reason = reason


def raw_handshake(port, *, origin=None, version='13', key=None, http='HTTP/1.1', upgrade='websocket',
                  extra=(), send_after=b'', timeout=5.0, rcvbuf=None):
    """Open a socket and send an upgrade request. Returns (status, headers, sock, leftover bytes)."""
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    if rcvbuf:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, rcvbuf)
    sock.settimeout(timeout)
    sock.connect(('127.0.0.1', port))
    sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
    key = key if key is not None else base64.b64encode(os.urandom(16)).decode()
    lines = [f'GET /ws {http}', f'Host: 127.0.0.1:{port}']
    if upgrade:
        lines += [f'Upgrade: {upgrade}', 'Connection: keep-alive, Upgrade']
    lines += [f'Sec-WebSocket-Key: {key}', f'Sec-WebSocket-Version: {version}']
    if origin is not None:
        lines.append(f'Origin: {origin}')
    lines += list(extra)
    sock.sendall(('\r\n'.join(lines) + '\r\n\r\n').encode() + send_after)
    buf = b''
    while b'\r\n\r\n' not in buf:
        chunk = sock.recv(4096)
        if not chunk:
            break
        buf += chunk
    head, _, rest = buf.partition(b'\r\n\r\n')
    status_line, *hdr_lines = head.decode('latin-1').split('\r\n')
    status = int(status_line.split()[1]) if status_line else 0
    headers = {}
    for line in hdr_lines:
        k, _, v = line.partition(':')
        headers[k.strip().lower()] = v.strip()
    headers['__status_line__'] = status_line
    headers['__key__'] = key
    return status, headers, sock, rest


class WS:
    """Minimal RFC 6455 client for tests: masked frames, fragmentation, auto-pong, close handshake."""

    def __init__(self, port, **kw):
        status, headers, sock, rest = raw_handshake(port, **kw)
        if status != 101:
            sock.close()
            raise AssertionError(f'handshake failed: {status}')
        self.status = status
        self.headers = headers
        self.sock = sock
        self.buf = bytearray(rest)
        self.close_sent = False
        self.auto_echo = True

    # ---- sending
    def send_frame(self, op, payload=b'', fin=True, mask=True, rsv=0, length=None):
        n = len(payload) if length is None else length
        b0 = (0x80 if fin else 0) | rsv | op
        m = 0x80 if mask else 0
        if n < 126:
            hdr = bytes((b0, m | n))
        elif n < 65536:
            hdr = bytes((b0, m | 126)) + struct.pack('!H', n)
        else:
            hdr = bytes((b0, m | 127)) + struct.pack('!Q', n)
        if mask:
            key = os.urandom(4)
            body = key + netserver.unmask(bytes(payload), key)     # XOR masking is symmetric
        else:
            body = bytes(payload)
        self.sock.sendall(hdr + body)

    def send_json(self, obj):
        self.send_frame(0x1, json.dumps(obj).encode())

    def send_bin(self, data):
        self.send_frame(0x2, bytes(data))

    def send_close(self, code=1000, reason=b''):
        self.send_frame(0x8, struct.pack('!H', code) + reason)
        self.close_sent = True

    # ---- receiving
    def _read(self, n):
        while len(self.buf) < n:
            chunk = self.sock.recv(max(65536, n - len(self.buf)))
            if not chunk:
                raise EOFError('connection closed by the server')
            self.buf += chunk
        out = bytes(self.buf[:n])
        del self.buf[:n]
        return out

    def recv_frame(self):
        b0, b1 = self._read(2)
        if b1 & 0x80:
            raise AssertionError('server frames must not be masked')
        n = b1 & 0x7F
        if n == 126:
            n = struct.unpack('!H', self._read(2))[0]
        elif n == 127:
            n = struct.unpack('!Q', self._read(8))[0]
        return bool(b0 & 0x80), b0 & 0x0F, self._read(n)

    def recv(self, timeout=5.0):
        """Next data message (op, payload); answers pings; raises Closed on a close frame (echoing it)."""
        self.sock.settimeout(timeout)
        parts, mop = [], None
        while True:
            fin, op, payload = self.recv_frame()
            if op == 0x9:
                self.send_frame(0xA, payload)
                continue
            if op == 0xA:
                continue
            if op == 0x8:
                code = struct.unpack('!H', payload[:2])[0] if len(payload) >= 2 else None
                if self.auto_echo and not self.close_sent:
                    self.send_frame(0x8, payload[:2])
                    self.close_sent = True
                raise Closed(code, payload[2:].decode('utf-8'))
            if op == 0x0:
                parts.append(payload)
            else:
                mop, parts = op, [payload]
            if fin:
                return mop, b''.join(parts)

    def json(self, timeout=5.0):
        op, payload = self.recv(timeout)
        if op != 0x1:
            raise AssertionError(f'expected a text message, got opcode {op}: {payload[:40]!r}')
        return json.loads(payload)

    def expect(self, t, timeout=5.0):
        m = self.json(timeout)
        if m.get('t') != t:
            raise AssertionError(f'expected {t!r}, got {m!r}')
        return m

    def recv_bin(self, timeout=5.0):
        op, payload = self.recv(timeout)
        if op != 0x2:
            raise AssertionError(f'expected a binary message, got opcode {op}: {payload[:60]!r}')
        return payload

    def barrier(self, timeout=5.0):
        """Round-trip a control ping; returns the messages that arrived before the pong (in order)."""
        nonce = os.urandom(6).hex()
        self.send_json({'t': 'ping', 'c': nonce})
        before = []
        while True:
            op, payload = self.recv(timeout)
            if op == 0x1:
                m = json.loads(payload)
                if m.get('t') == 'pong' and m.get('c') == nonce:
                    return before
                before.append(m)
            else:
                before.append(payload)

    def expect_close(self, timeout=5.0):
        """Read until the server's close frame; returns (code, reason). Everything before it must be data."""
        try:
            while True:
                self.recv(timeout)
        except Closed as c:
            return c.code, c.reason

    def expect_eof(self, timeout=3.0):
        """After the close handshake the server must close TCP; returns seconds waited."""
        t0 = time.monotonic()
        self.sock.settimeout(timeout)
        try:
            while self.sock.recv(65536):
                pass
        except (ConnectionResetError, ConnectionAbortedError):
            pass
        return time.monotonic() - t0

    def close(self):
        try:
            self.sock.close()
        except OSError:
            pass


class Reader(threading.Thread):
    """Background reader: collects binary messages (and JSON) until the connection ends."""

    def __init__(self, ws):
        super().__init__(daemon=True)
        self.ws = ws
        self.bins = []
        self.texts = []
        self.end = None
        self.start()

    def run(self):
        try:
            while True:
                op, payload = self.ws.recv(timeout=30)
                (self.bins if op == 0x2 else self.texts).append(payload)
        except Closed as c:
            self.end = ('closed', c.code)
        except (EOFError, OSError) as e:
            self.end = ('eof', str(e))


_OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))   # loopback only, never via a proxy


def http_get(port, path, timeout=5.0, method='GET'):
    """(status, body bytes) of a GET (or HEAD) on the test server."""
    req = urllib.request.Request(f'http://127.0.0.1:{port}{path}', method=method)
    try:
        with _OPENER.open(req, timeout=timeout) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        with e:
            return e.code, e.read()


def wait_until(fn, timeout=5.0, step=0.01):
    t_end = time.monotonic() + timeout
    while time.monotonic() < t_end:
        v = fn()
        if v:
            return v
        time.sleep(step)
    return fn()


class RelayCase(unittest.TestCase):
    """One in-process server (127.0.0.1, random port) per test class."""
    relay_options = {}
    restrict = False
    server_kw = {}

    @classmethod
    def setUpClass(cls):
        cls.srv, cls.port = serve.serve_in_background(0, relay_options=cls.relay_options, lan=cls.restrict,
                                                      bind='127.0.0.1', **cls.server_kw)
        assert cls.srv.server_address[0] == '127.0.0.1'
        cls.relay = cls.srv.relay

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()
        cls.srv.server_close()

    def setUp(self):
        self.clients = []
        self.errors0 = self.relay.counters['internal_errors']

    def tearDown(self):
        for c in self.clients:
            c.close()
        self.assertEqual(self.relay.counters['internal_errors'], self.errors0, 'relay internal error (see stderr)')

    def ws(self, **kw):
        c = WS(self.port, **kw)
        self.clients.append(c)
        return c

    def host(self, **opts):
        h = self.ws()
        h.send_json({'t': 'host', **opts})
        m = h.expect('hosted')
        return h, m['code']

    def join(self, code, name='P', host=None, **opts):
        c = self.ws(rcvbuf=opts.pop('rcvbuf', None))
        c.send_json({'t': 'join', 'code': code, 'name': name, **opts})
        m = c.expect('joined')
        if host is not None:
            pj = host.expect('peer-join')
            self.assertEqual(pj['peer'], m['peer'])
        return c, m


# ------------------------------------------------------------------------------------------------ handshake

class HandshakeTests(RelayCase):
    def test_accept_key_and_no_extensions(self):
        status, h, sock, _ = raw_handshake(self.port, extra=['Sec-WebSocket-Extensions: permessage-deflate; client_max_window_bits'])
        sock.close()
        self.assertEqual(status, 101)
        self.assertTrue(h['__status_line__'].startswith('HTTP/1.1 101'))
        want = base64.b64encode(hashlib.sha1(h['__key__'].encode() + GUID).digest()).decode()
        self.assertEqual(h['sec-websocket-accept'], want)
        self.assertEqual(h['upgrade'].lower(), 'websocket')
        self.assertNotIn('sec-websocket-extensions', h)

    def test_origin_must_match_host(self):
        for origin, code in ((f'http://127.0.0.1:{self.port}', 101), ('http://evil.example', 403),
                             (f'http://127.0.0.1:{self.port + 1}', 403), ('null', 403)):
            status, _, sock, _ = raw_handshake(self.port, origin=origin)
            sock.close()
            self.assertEqual(status, code, origin)
        status, _, sock, _ = raw_handshake(self.port)       # no Origin (tools, tests): allowed
        sock.close()
        self.assertEqual(status, 101)

    def test_bad_requests(self):
        status, h, sock, _ = raw_handshake(self.port, version='8')
        sock.close()
        self.assertEqual(status, 426)
        self.assertEqual(h.get('sec-websocket-version'), '13')
        for kw in ({'key': 'short'}, {'key': ''}, {'http': 'HTTP/1.0'}, {'upgrade': None}, {'upgrade': 'h2c'}):
            status, _, sock, _ = raw_handshake(self.port, **kw)
            sock.close()
            self.assertEqual(status, 400, kw)

    def test_frame_sent_with_the_handshake(self):
        # a client that does not wait for the 101: the bytes buffered by the HTTP parser must reach the relay
        payload = json.dumps({'t': 'ping', 'c': 'early'}).encode()
        key = os.urandom(4)
        frame = bytes((0x81, 0x80 | len(payload))) + key + netserver.unmask(payload, key)
        status, _, sock, rest = raw_handshake(self.port, send_after=frame)
        ws = WS.__new__(WS)
        ws.sock, ws.buf, ws.close_sent, ws.auto_echo = sock, bytearray(rest), False, True
        self.clients.append(ws)
        self.assertEqual(status, 101)
        self.assertEqual(ws.expect('pong')['c'], 'early')

    def early_ws(self, send_after):
        status, _, sock, rest = raw_handshake(self.port, send_after=send_after)
        ws = WS.__new__(WS)
        ws.sock, ws.buf, ws.close_sent, ws.auto_echo = sock, bytearray(rest), False, True
        self.clients.append(ws)
        self.assertEqual(status, 101)
        return ws

    def test_more_than_64_kib_sent_with_the_handshake(self):
        # the request handler's reader buffers up to io.DEFAULT_BUFFER_SIZE (128 KiB on 3.14): all of it must be handed
        # to the relay (a 64 KiB read lost the rest, and the connection then hung)
        for _ in range(4):
            text = 'x' * 100000
            payload = json.dumps({'t': 'ping', 'c': text}).encode()
            key = os.urandom(4)
            frame = bytes((0x81, 0x80 | 127)) + struct.pack('!Q', len(payload)) + key + netserver.unmask(payload, key)
            self.assertEqual(self.early_ws(frame).expect('pong')['c'], text)

    def test_error_in_a_frame_sent_with_the_handshake_closes_only_that_connection(self):
        errors = []

        def broken(c, m, rid):
            raise RuntimeError('handler bug')
        self.relay.error_log, self.relay._handlers['ping'] = errors.append, broken
        try:
            payload = json.dumps({'t': 'ping', 'c': 1}).encode()
            key = os.urandom(4)
            ws = self.early_ws(bytes((0x81, 0x80 | len(payload))) + key + netserver.unmask(payload, key))
            self.assertEqual(ws.expect_close()[0], 1011)           # not left hanging without a reply
        finally:
            self.relay.error_log, self.relay._handlers['ping'] = None, self.relay._ctl_ping
        self.errors0 += 1
        self.assertEqual(len(errors), 1)
        other = self.ws()
        other.send_json({'t': 'ping', 'c': 2})
        self.assertEqual(other.expect('pong')['c'], 2)


# ------------------------------------------------------------------------------------------------ framing

class FramingTests(RelayCase):
    def assert_closed_with(self, ws, code):
        got, _ = ws.expect_close()
        self.assertEqual(got, code)
        self.assertLess(ws.expect_eof(), 2.0)

    def test_text_roundtrip_and_request_id(self):
        ws = self.ws()
        ws.send_json({'t': 'ping', 'c': 123, 'id': 7})
        m = ws.expect('pong')
        self.assertEqual((m['c'], m['id']), (123, 7))
        self.assertIsInstance(m['s'], (int, float))

    def test_masked_payload_sizes_both_directions(self):
        h, code = self.host()
        a, ja = self.join(code, host=h)
        for n in (2, 3, 125, 126, 127, 1000, 65535, 65536, 70001, 300000, netserver.DEFAULTS['max_message']):
            body = bytes([0, 0x10]) + os.urandom(n - 2)
            a.send_bin(body)
            got = h.recv_bin()
            self.assertEqual(len(got), n)
            self.assertEqual(got[0], ja['peer'])
            self.assertEqual(got[1:], body[1:])
            out = bytes([ja['peer'], 0x11]) + os.urandom(n - 2)
            h.send_bin(out)
            self.assertEqual(a.recv_bin(), out)

    def test_fragmented_messages_with_interleaved_ping(self):
        h, code = self.host()
        a, ja = self.join(code, host=h)
        fragments0 = self.relay.counters['fragments']
        text = json.dumps({'t': 'ping', 'c': 'frag' * 50}).encode()
        a.send_frame(0x1, text[:10], fin=False)
        a.send_frame(0x9, b'hello')                              # control frames may interleave
        a.send_frame(0x0, text[10:100], fin=False)
        a.send_frame(0x0, text[100:], fin=True)
        fin, op, payload = a.recv_frame()
        self.assertEqual((op, payload), (0xA, b'hello'))
        self.assertEqual(a.expect('pong')['c'], 'frag' * 50)
        data = bytes([0, 0x12]) + os.urandom(5000)
        a.send_frame(0x2, data[:1], fin=False)
        a.send_frame(0x0, data[1:4000], fin=False)
        a.send_frame(0x0, data[4000:], fin=True)
        got = h.recv_bin()
        self.assertEqual(got[1:], data[1:])
        self.assertEqual(self.relay.counters['fragments'] - fragments0, 4)   # continuation frames, both messages

    def test_protocol_errors_close_1002(self):
        cases = [
            lambda ws: ws.send_frame(0x1, b'{}', mask=False),                       # unmasked client frame
            lambda ws: ws.send_frame(0x1, b'{}', rsv=0x40),                          # RSV1 without an extension
            lambda ws: ws.send_frame(0x3, b'x'),                                     # reserved opcode
            lambda ws: ws.send_frame(0x0, b'x'),                                     # continuation without a start
            lambda ws: (ws.send_frame(0x2, b'ab', fin=False), ws.send_frame(0x1, b'{}')),  # new message mid-fragment
            lambda ws: ws.send_frame(0x9, b'x' * 126),                               # control frame > 125 bytes
            lambda ws: ws.send_frame(0x9, b'x', fin=False),                          # fragmented control frame
            lambda ws: ws.send_frame(0x8, b'\x03'),                                  # 1-byte close payload
            lambda ws: ws.send_frame(0x8, struct.pack('!H', 1005)),                  # close code that must not be sent
        ]
        for i, send in enumerate(cases):
            ws = self.ws()
            send(ws)
            self.assertEqual(ws.expect_close()[0], 1002, f'case {i}')
            self.assertLess(ws.expect_eof(), 2.0)

    def test_invalid_utf8_closes_1007(self):
        ws = self.ws()
        ws.send_frame(0x1, b'{"t": "\xff\xfe"}')
        self.assert_closed_with(ws, 1007)

    def test_message_too_big_closes_1009(self):
        limit = netserver.DEFAULTS['max_message']
        ws = self.ws()
        ws.send_frame(0x2, b'', length=limit + 1)                # only the header: rejected before any payload
        self.assert_closed_with(ws, 1009)
        ws = self.ws()
        ws.send_frame(0x2, b'\x00' * (limit // 2), fin=False)
        ws.send_frame(0x0, b'\x00' * (limit // 2 + 10), fin=True)
        self.assert_closed_with(ws, 1009)

    def test_bad_json_is_an_error_reply_not_a_close(self):
        ws = self.ws()
        ws.send_frame(0x1, b'not json')
        self.assertEqual(ws.expect('error')['reason'], 'bad-message')
        ws.send_json([1, 2, 3])
        self.assertEqual(ws.expect('error')['reason'], 'bad-message')
        ws.send_json({'t': 'dance', 'id': 'x1'})
        m = ws.expect('error')
        self.assertEqual((m['reason'], m['re'], m['id']), ('bad-message', 'dance', 'x1'))
        ws.barrier()

    def test_numbers_a_browser_cannot_read_and_deep_nesting_are_bad_messages(self):
        h = self.ws()
        for raw in (b'{"t":"host","max":1e999}', b'{"t":"host","max":Infinity}', b'{"t":"host","meta":{"x":NaN}}',
                    b'{"t":"ping","c":' + b'[' * 50000 + b']' * 50000 + b'}'):
            h.send_frame(0x1, raw)
            self.assertEqual(h.expect('error')['reason'], 'bad-message', raw[:40])
        h.send_json({'t': 'host', 'max': 1e308})                  # finite: clamped as before
        self.assertEqual(h.expect('hosted')['max'], netserver.DEFAULTS['max_room_peers'])
        for raw in (b'{"t":"kick","peer":1e999}', b'{"t":"signal","to":-1e999,"data":1}', b'{"t":"meta","meta":{"x":1e999}}'):
            h.send_frame(0x1, raw)
            self.assertEqual(h.expect('error')['reason'], 'bad-message', raw)
        status, body = http_get(self.port, '/api/rooms')
        json.loads(body, parse_constant=lambda s: self.fail(f'{s} in /api/rooms'))

    def test_lone_surrogate_round_trips(self):
        # what a browser sends for {meta: {host: name.slice(0, 4)}} when the cut splits an emoji: every reply that
        # carries it (joined, rooms, signal) must still encode, or nobody can join that room
        h = self.ws()
        h.send_frame(0x1, b'{"t":"host","v":1,"meta":{"host":"Sam\\ud83d"}}')
        code = h.expect('hosted')['code']
        a = self.ws()
        a.send_json({'t': 'join', 'v': 1, 'code': code, 'name': 'A'})
        self.assertEqual(a.expect('joined')['room']['meta'], {'host': 'Sam\ud83d'})
        self.assertEqual(h.expect('peer-join')['name'], 'A')
        lister = self.ws()
        lister.send_json({'t': 'list'})
        self.assertIn({'host': 'Sam\ud83d'}, [r['meta'] for r in lister.expect('rooms')['rooms']])
        a.send_frame(0x1, b'{"t":"signal","to":0,"data":"\\udc00x"}')
        self.assertEqual(h.expect('signal')['data'], '\udc00x')

    def test_client_initiated_close_is_echoed_then_tcp_closed(self):
        ws = self.ws()
        ws.send_close(1000, b'bye')
        fin, op, payload = ws.recv_frame()
        self.assertEqual(op, 0x8)
        self.assertEqual(struct.unpack('!H', payload[:2])[0], 1000)
        self.assertLess(ws.expect_eof(), 1.0)

    def test_client_ping_gets_pong(self):
        ws = self.ws()
        ws.send_frame(0x9, b'abc')
        self.assertEqual(ws.recv_frame()[1:], (0xA, b'abc'))


# ------------------------------------------------------------------------------------------------ rooms

class RoomTests(RelayCase):
    def test_codes(self):
        codes = set()
        hosts = []
        for _ in range(60):
            h, code = self.host()
            hosts.append(h)
            self.assertEqual(len(code), 4)
            self.assertTrue(all(ch in netserver.CODE_ALPHABET for ch in code), code)
            codes.add(code)
        self.assertEqual(len(codes), 60)
        self.assertEqual(set(netserver.CODE_ALPHABET), set('BCDFGHJKLMNPQRSTVWXZ'))
        taken = set()
        for _ in range(2000):
            taken.add(netserver.new_code(taken))
        self.assertEqual(len(taken), 2000)
        self.assertEqual(netserver.normalize_code(' b c-d f '), 'BCDF')
        self.assertTrue(netserver.valid_code('BCDF'))
        self.assertFalse(netserver.valid_code('ABCD'))     # vowels never appear
        self.assertFalse(netserver.valid_code('BCD'))

    def test_requested_code(self):
        want = netserver.new_code(self.relay.rooms)
        h, code = self.host(code=want.lower())
        self.assertEqual(code, want)
        ws = self.ws()
        ws.send_json({'t': 'host', 'code': want})
        self.assertEqual(ws.expect('error')['reason'], 'code-taken')
        ws.send_json({'t': 'host', 'code': 'ABCD'})
        self.assertEqual(ws.expect('error')['reason'], 'bad-code')
        a, ja = self.join(' ' + want[:2].lower() + '-' + want[2:] + ' ', host=h)   # typed sloppily
        self.assertEqual(ja['code'], want)

    def test_join_flow_ids_names_and_full_room(self):
        h, code = self.host(name='Caleb\'s game', max=3)
        ws = self.ws()
        ws.send_json({'t': 'join', 'code': 'ZZZZ' if code != 'ZZZZ' else 'ZZZX', 'name': 'x'})
        self.assertEqual(ws.expect('error')['reason'], 'no-such-room')
        a, ja = self.join(code, name='  Sam\x00\x07  the\n great  ', host=None)
        pj = h.expect('peer-join')
        self.assertEqual((ja['peer'], pj['peer'], pj['name'], pj['rejoin']), (1, 1, 'Sam the great', False))
        self.assertEqual(pj['addr'], '127.0.0.1')
        self.assertEqual(ja['room']['name'], 'Caleb\'s game')
        self.assertEqual(ja['room']['players'], 2)
        self.assertTrue(ja['token'] and len(ja['token']) >= 16)
        b, jb = self.join(code, name='B' * 40, host=h)
        self.assertEqual(jb['peer'], 2)
        c = self.ws()
        c.send_json({'t': 'join', 'code': code, 'name': 'C'})
        self.assertEqual(c.expect('error')['reason'], 'room-full')
        a.send_json({'t': 'join', 'code': code, 'name': 'again'})
        self.assertEqual(a.expect('error')['reason'], 'already-in-room')
        h.send_json({'t': 'host'})
        self.assertEqual(h.expect('error')['reason'], 'already-in-room')
        a.send_json({'t': 'leave', 'id': 3})
        left = a.expect('left')
        self.assertEqual((left['code'], left['id']), (code, 3))
        pl = h.expect('peer-leave')
        self.assertEqual((pl['peer'], pl['reason'], pl['reserved']), (1, 'left', False))
        c.send_json({'t': 'join', 'code': code, 'name': 'C'})
        self.assertEqual(c.expect('joined')['peer'], 1)           # lowest free id
        self.assertEqual(h.expect('peer-join')['name'], 'C')
        a.send_json({'t': 'join', 'code': code, 'name': 'A', 'token': ja['token']})
        self.assertEqual(a.expect('error')['reason'], 'room-full')  # the left slot's token is gone
        self.assertEqual(len(jb['room']['name']), len('Caleb\'s game'))
        self.assertEqual(h.barrier(), [])

    def test_version_mismatch(self):
        h, code = self.host(v=3)
        ws = self.ws()
        ws.send_json({'t': 'join', 'code': code, 'name': 'old', 'v': 2})
        m = ws.expect('error')
        self.assertEqual((m['reason'], m['v']), ('version-mismatch', 3))
        ws.send_json({'t': 'join', 'code': code, 'name': 'none'})
        self.assertEqual(ws.expect('error')['reason'], 'version-mismatch')
        self.join(code, v=3, host=h)

    def test_kick(self):
        h, code = self.host()
        a, ja = self.join(code, host=h)
        b, jb = self.join(code, host=h)
        a.send_json({'t': 'kick', 'peer': jb['peer'], 'id': 1})
        m = a.expect('error')
        self.assertEqual((m['reason'], m['re'], m['id']), ('not-host', 'kick', 1))
        h.send_json({'t': 'kick', 'peer': 77, 'id': 2})
        self.assertEqual(h.expect('error')['reason'], 'no-such-peer')
        h.send_json({'t': 'kick', 'peer': ja['peer'], 'reason': 'be nice', 'id': 3})
        pl = h.expect('peer-leave')
        self.assertEqual((pl['peer'], pl['reason'], pl['reserved']), (ja['peer'], 'kicked', False))
        self.assertEqual(h.expect('ok')['re'], 'kick')
        code_, reason = a.expect_close()
        self.assertEqual((code_, reason), (4001, 'be nice'))
        self.assertLess(a.expect_eof(), 1.0)                     # echo received -> server closes TCP at once
        again = self.ws()
        again.send_json({'t': 'join', 'code': code, 'name': 'A', 'token': ja['token']})
        j2 = again.expect('joined')                              # a kicked token is void: fresh slot
        self.assertFalse(j2['rejoin'])
        self.assertNotEqual(j2['token'], ja['token'])

    def test_kick_without_echo_times_out(self):
        h, code = self.host()
        a, ja = self.join(code, host=h)
        a.auto_echo = False
        h.send_json({'t': 'kick', 'peer': ja['peer']})
        self.assertEqual(a.expect_close()[0], 4001)
        waited = a.expect_eof(timeout=5)
        self.assertGreater(waited, 0.5)
        self.assertLess(waited, netserver.DEFAULTS['close_timeout'] + 1.5)

    def test_lock_meta_list(self):
        h, code = self.host(name='Lobby', public=True)
        hidden, hcode = self.host(public=False)
        h.send_json({'t': 'meta', 'meta': {'map': 'foundry', 'mode': 'ffa'}, 'id': 1})
        self.assertEqual(h.expect('ok')['re'], 'meta')
        h.send_json({'t': 'meta', 'meta': 'nope', 'id': 2})
        self.assertEqual(h.expect('error')['reason'], 'bad-message')
        h.send_json({'t': 'meta', 'meta': {'x': 'y' * 5000}})
        self.assertEqual(h.expect('error')['reason'], 'bad-message')
        a, ja = self.join(code, host=h)
        a.send_json({'t': 'meta', 'meta': {}})
        self.assertEqual(a.expect('error')['reason'], 'not-host')
        lister = self.ws()
        lister.send_json({'t': 'list', 'id': 'L'})
        rooms = {r['code']: r for r in lister.expect('rooms')['rooms']}
        self.assertIn(code, rooms)
        self.assertNotIn(hcode, rooms)
        self.assertEqual(rooms[code]['meta'], {'map': 'foundry', 'mode': 'ffa'})
        self.assertEqual((rooms[code]['players'], rooms[code]['name']), (2, 'Lobby'))
        status, body = http_get(self.port, '/api/rooms')
        self.assertEqual(status, 200)
        self.assertIn(code, [r['code'] for r in json.loads(body)['rooms']])
        h.send_json({'t': 'lock', 'locked': True, 'id': 5})
        self.assertEqual(h.expect('ok'), {'t': 'ok', 're': 'lock', 'locked': True, 'id': 5})
        ws = self.ws()
        ws.send_json({'t': 'join', 'code': code, 'name': 'late'})
        self.assertEqual(ws.expect('error')['reason'], 'room-locked')
        lister.send_json({'t': 'list'})
        self.assertNotIn(code, [r['code'] for r in lister.expect('rooms')['rooms']])
        a.close()                                                # drops without leaving: slot reserved
        self.assertEqual(h.expect('peer-leave')['reserved'], True)
        back = self.ws()
        back.send_json({'t': 'join', 'code': code, 'name': 'A', 'token': ja['token']})
        self.assertTrue(back.expect('joined')['rejoin'])          # a token gets back into a locked room
        self.assertTrue(h.expect('peer-join')['rejoin'])
        h.send_json({'t': 'lock', 'locked': False, 'id': 6})
        h.expect('ok')
        self.join(code, host=h)

    def test_host_leaving_closes_room(self):
        h, code = self.host()
        a, _ = self.join(code, host=h)
        b, _ = self.join(code, host=h)
        h.close()                                                # abrupt: no close frame
        for c in (a, b):
            m = c.expect('room-closed')
            self.assertEqual((m['code'], m['reason']), (code, 'host-left'))
            self.assertEqual(c.expect_close(), (4000, 'host left'))
            self.assertLess(c.expect_eof(), 1.0)
        self.assertTrue(wait_until(lambda: code not in self.relay.rooms))
        ws = self.ws()
        ws.send_json({'t': 'join', 'code': code, 'name': 'x'})
        self.assertEqual(ws.expect('error')['reason'], 'no-such-room')

    def test_host_leave_message_keeps_socket(self):
        h, code = self.host()
        a, _ = self.join(code, host=h)
        h.send_json({'t': 'leave'})
        self.assertEqual(h.expect('left')['code'], code)
        self.assertEqual(a.expect('room-closed')['reason'], 'host-left')
        self.assertEqual(a.expect_close()[0], 4000)
        h.send_json({'t': 'host'})
        self.assertNotEqual(h.expect('hosted')['code'], None)    # the same connection can host again

    def test_signal(self):
        h, code = self.host()
        a, ja = self.join(code, host=h)
        a.send_json({'t': 'signal', 'to': 0, 'data': {'sdp': 'x'}})
        m = h.expect('signal')
        self.assertEqual((m['from'], m['data']), (ja['peer'], {'sdp': 'x'}))
        h.send_json({'t': 'signal', 'to': ja['peer'], 'data': [1], 'id': 4})
        self.assertEqual(h.expect('ok')['re'], 'signal')
        self.assertEqual(a.expect('signal')['from'], 0)
        h.send_json({'t': 'signal', 'to': 99, 'data': 1})
        self.assertEqual(h.expect('error')['reason'], 'no-such-peer')

    def test_server_full(self):
        relay = self.relay
        old = relay.max_rooms
        relay.max_rooms = 0
        try:
            ws = self.ws()
            ws.send_json({'t': 'host'})
            self.assertEqual(ws.expect('error')['reason'], 'server-full')
        finally:
            relay.max_rooms = old


# ------------------------------------------------------------------------------------------------ routing

class RoutingTests(RelayCase):
    def test_client_to_host_rewrites_sender(self):
        h, code = self.host()
        a, ja = self.join(code, host=h)
        b, jb = self.join(code, host=h)
        a.send_bin(b'\x4d\x01hello')                             # byte0 = 77: must be replaced by the sender id
        b.send_bin(b'\xff\x01world')                             # a client cannot broadcast
        self.assertEqual(h.recv_bin(), bytes([ja['peer']]) + b'\x01hello')
        self.assertEqual(h.recv_bin(), bytes([jb['peer']]) + b'\x01world')
        self.assertEqual(a.barrier(), [])
        self.assertEqual(b.barrier(), [])

    def test_host_unicast_and_broadcast(self):
        h, code = self.host()
        a, ja = self.join(code, host=h)
        b, jb = self.join(code, host=h)
        h.send_bin(bytes([jb['peer'], 0x10]) + b'only-b')
        h.send_bin(bytes([255, 0x10]) + b'everyone')
        dropped0 = self.relay.counters['packets_dropped']
        h.send_bin(bytes([99, 0x10]) + b'nobody')                # unknown peer: dropped silently
        h.send_bin(b'\x01')                                      # too short: dropped
        self.assertEqual(a.recv_bin(), bytes([255, 0x10]) + b'everyone')
        self.assertEqual(b.recv_bin(), bytes([jb['peer'], 0x10]) + b'only-b')
        self.assertEqual(b.recv_bin(), bytes([255, 0x10]) + b'everyone')
        self.assertEqual(h.barrier(), [])                        # the host never receives its own packets
        self.assertEqual(a.barrier(), [])
        self.assertEqual(self.relay.counters['packets_dropped'] - dropped0, 2)

    def test_binary_outside_a_room_is_dropped(self):
        ws = self.ws()
        ws.send_bin(b'\x00\x01abc')
        self.assertEqual(ws.barrier(), [])


# ------------------------------------------------------------------------------------------------ backpressure

def is_blocked(relay, code, peer):
    """The relay reports this peer's socket as backed up (output queued, kernel buffer full)."""
    return any(c['room'] == code and c['peer'] == peer and c['blocked'] for c in relay.stats()['conns'])


def fill_until_blocked(relay, host, code, peer, limit, chunk=60000, typ=0x10):
    """Send reliable filler from the host to `peer` until the relay reports that peer's socket as backed up."""
    sent = 0
    seq = 0

    def blocked():
        return is_blocked(relay, code, peer)
    while sent < limit:
        body = bytes([peer, typ]) + struct.pack('!I', seq) + bytes([seq & 0xFF]) * chunk
        host.send_bin(body)
        sent += len(body)
        seq += 1
        if seq % 4 == 0 and wait_until(blocked, timeout=0.05, step=0.01):
            return seq
    raise AssertionError(f'receiver never backed up after {sent} bytes')


class ConflationTests(RelayCase):
    relay_options = {'max_backlog': 64 << 20, 'stall_timeout': 60, 'idle_timeout': 60}

    def test_latest_wins_snapshots_for_a_backed_up_client(self):
        h, code = self.host()
        slow, js = self.join(code, name='slow', host=h, rcvbuf=4096)
        fast, jf = self.join(code, name='fast', host=h)
        reader = Reader(fast)
        fillers = fill_until_blocked(self.relay, h, code, js['peer'], 48 << 20)
        conflated0 = self.relay.counters['conflated']
        n_snap = 300
        for i in range(n_snap):
            h.send_bin(bytes([255, 0x81]) + struct.pack('!I', i) + b's' * 100)
        h.send_bin(bytes([js['peer'], 0x11]) + b'end-marker')    # reliable, queued after the snapshots
        h.barrier()                                              # the relay has routed everything above
        self.assertGreaterEqual(self.relay.counters['conflated'] - conflated0, n_snap - 10)
        # the slow client now reads: every reliable frame intact and in order, only the newest snapshots
        got_fill, snaps, marker = 0, [], False
        while True:
            p = slow.recv_bin(timeout=10)
            if p[1] == 0x10:
                self.assertEqual(struct.unpack_from('!I', p, 2)[0], got_fill)
                self.assertEqual(p[6:], bytes([got_fill & 0xFF]) * (len(p) - 6))
                got_fill += 1
            elif p[1] == 0x81:
                snaps.append(struct.unpack_from('!I', p, 2)[0])
                if snaps[-1] == n_snap - 1:
                    break
            elif p[1] == 0x11:
                marker = True
        self.assertEqual(got_fill, fillers)
        self.assertTrue(marker, 'reliable packet sent after the snapshots was lost')
        self.assertLessEqual(len(snaps), 10, snaps)
        self.assertEqual(snaps, sorted(snaps))
        wait_until(lambda: len([b for b in reader.bins if b[1] == 0x81]) >= n_snap, timeout=10)
        self.assertEqual([struct.unpack_from('!I', b, 2)[0] for b in reader.bins if b[1] == 0x81], list(range(n_snap)))

    def test_latest_wins_is_per_sender_toward_the_host(self):
        h = WS(self.port, rcvbuf=4096)
        self.clients.append(h)
        h.send_json({'t': 'host'})
        code = h.expect('hosted')['code']
        a, ja = self.join(code, name='a')
        b, jb = self.join(code, name='b')
        self.assertEqual(h.expect('peer-join')['peer'], ja['peer'])
        self.assertEqual(h.expect('peer-join')['peer'], jb['peer'])
        chunk = b'f' * 60000
        blocked = False
        for i in range(800):                                    # clients flood the (non-reading) host
            a.send_bin(bytes([0, 0x10]) + chunk)
            if i % 4 == 3 and wait_until(lambda: is_blocked(self.relay, code, 0), 0.05):
                blocked = True
                break
        self.assertTrue(blocked)
        for i in range(100):
            a.send_bin(bytes([0, 0x82]) + struct.pack('!I', i))
            b.send_bin(bytes([0, 0x82]) + struct.pack('!I', 1000 + i))
        a.barrier()
        b.barrier()
        last = {}
        while set(last.values()) != {99, 1099}:
            p = h.recv_bin(timeout=10)
            if p[1] == 0x82:
                last[p[0]] = struct.unpack_from('!I', p, 2)[0]
        self.assertEqual(last, {ja['peer']: 99, jb['peer']: 1099})


class SlowConsumerTests(RelayCase):
    relay_options = {'max_backlog': 512 << 10, 'close_timeout': 10, 'stall_timeout': 60, 'idle_timeout': 60}

    def test_backlog_limit_closes_1013_with_intact_frames(self):
        h, code = self.host()
        slow, js = self.join(code, name='slow', host=h, rcvbuf=4096)
        fast, jf = self.join(code, name='fast', host=h)
        reader = Reader(fast)
        sent = 0
        for i in range(2000):
            h.send_bin(bytes([js['peer'], 0x10]) + struct.pack('!I', i) + bytes([i & 0xFF]) * 50000)
            h.send_bin(bytes([255, 0x81]) + struct.pack('!I', i))
            sent = i + 1
            if i % 4 == 3 and self.relay.counters['slow_consumers']:
                break
        pl = h.expect('peer-leave')
        self.assertEqual((pl['peer'], pl['reason'], pl['reserved']), (js['peer'], 'slow', True))
        seq = 0
        try:
            while True:
                p = slow.recv_bin(timeout=10)
                if p[1] == 0x10:
                    self.assertEqual(struct.unpack_from('!I', p, 2)[0], seq)
                    self.assertEqual(p[6:], bytes([seq & 0xFF]) * 50000)
                    seq += 1
        except Closed as c:
            self.assertEqual(c.code, 1013)
        self.assertGreater(seq, 0)
        self.assertLess(seq, sent)
        self.assertLess(slow.expect_eof(), 2.0)
        h.barrier()
        wait_until(lambda: len(reader.bins) >= sent, timeout=10)
        self.assertEqual(len(reader.bins), sent)                  # the healthy client missed nothing


class IdleTests(RelayCase):
    relay_options = {'ping_interval': 0.2, 'idle_timeout': 1.0, 'close_timeout': 0.5}

    def test_idle_client_is_closed_responsive_one_is_not(self):
        h, code = self.host()
        live = Reader(h)                                         # answers pings in the background
        a, ja = self.join(code, name='idle')
        t0 = time.monotonic()
        wait_until(lambda: any(b'peer-leave' in t for t in live.texts), timeout=5)
        elapsed = time.monotonic() - t0
        leave = [json.loads(t) for t in live.texts if b'peer-leave' in t][0]
        self.assertEqual((leave['reason'], leave['reserved']), ('timeout', True))
        self.assertGreater(elapsed, 0.8)
        self.assertLess(elapsed, 2.5)
        self.assertEqual(a.expect_close()[0], 1001)
        self.assertIsNone(live.end)                              # the host (answering pings) is still connected


class StallTests(RelayCase):
    relay_options = {'stall_timeout': 1.0, 'close_timeout': 0.5}

    def test_stalled_client_is_dropped(self):
        relay = self.relay
        h, code = self.host()
        live = Reader(h)
        a, ja = self.join(code, rcvbuf=4096)
        wait_until(lambda: any(b'peer-join' in t for t in live.texts))
        stalled0 = relay.counters['stalled']
        fill_until_blocked(relay, h, code, ja['peer'], 48 << 20)
        t0 = time.monotonic()
        self.assertTrue(wait_until(lambda: relay.counters['stalled'] > stalled0, timeout=5))
        self.assertGreater(time.monotonic() - t0, 0.5)
        self.assertTrue(wait_until(lambda: any(b'"stalled"' in t for t in live.texts), timeout=2))
        leave = [json.loads(t) for t in live.texts if b'peer-leave' in t][-1]
        self.assertEqual((leave['reason'], leave['reserved']), ('stalled', True))
        self.assertEqual(relay.counters['idle_timeouts'], 0)


class ConnLimitTests(RelayCase):
    relay_options = {'max_conns': 4}

    def test_connection_cap_refuses_with_503_and_keeps_serving(self):
        """Past max_conns the upgrade is refused (Windows select() takes 512 sockets; one more stopped every room)."""
        h, code = self.host()
        a, ja = self.join(code, host=h)
        extra = [self.ws(), self.ws()]
        limit0 = self.relay.counters['conn_limit']
        status, _, sock, _ = raw_handshake(self.port)
        sock.close()
        self.assertEqual(status, 503)
        self.assertEqual(self.relay.counters['conn_limit'] - limit0, 1)
        a.send_bin(b'\x00\x01still routed')                      # the room is unaffected
        self.assertEqual(h.recv_bin(), bytes([ja['peer']]) + b'\x01still routed')
        extra.pop().close()
        self.assertTrue(wait_until(lambda: len(self.relay.conns) < 4))
        again = self.ws()                                        # a slot is free again
        again.send_json({'t': 'ping', 'c': 3})
        self.assertEqual(again.expect('pong')['c'], 3)


class ReserveTests(RelayCase):
    relay_options = {'reserve_timeout': 1.0, 'close_timeout': 0.5}

    def test_token_rejoin_takeover_and_expiry(self):
        h, code = self.host()
        live = Reader(h)
        a, ja = self.join(code, name='A')
        a.close()                                                # network drop: no close frame
        self.assertTrue(wait_until(lambda: any(b'peer-leave' in t for t in live.texts)))
        a2 = self.ws()
        a2.send_json({'t': 'join', 'code': code, 'name': 'A', 'token': ja['token']})
        j2 = a2.expect('joined')
        self.assertEqual((j2['peer'], j2['rejoin'], j2['token']), (ja['peer'], True, ja['token']))
        # same token on another connection while a2 is still connected: a2 is replaced
        a3 = self.ws()
        a3.send_json({'t': 'join', 'code': code, 'name': 'A', 'token': ja['token']})
        self.assertEqual(a3.expect('joined')['peer'], ja['peer'])
        self.assertEqual(a2.expect_close(), (4002, 'replaced'))
        wait_until(lambda: len(live.texts) >= 5)
        msgs = [json.loads(t) for t in live.texts]
        seq = [(m['t'], m.get('reason'), m.get('rejoin')) for m in msgs if m['t'] in ('peer-join', 'peer-leave')]
        self.assertEqual(seq, [('peer-join', None, False), ('peer-leave', 'disconnected', None), ('peer-join', None, True),
                               ('peer-leave', 'replaced', None), ('peer-join', None, True)])
        # a clean close (tab closed / reloaded) also reserves the slot; after reserve_timeout it expires
        a3.send_close(1001)
        self.assertLess(a3.expect_eof(), 1.0)
        self.assertTrue(wait_until(lambda: any(b'"expired"' in t for t in live.texts), timeout=4))
        leaves = [json.loads(t) for t in live.texts if b'peer-leave' in t]
        self.assertEqual([(m['reason'], m['reserved']) for m in leaves[-2:]], [('closed', True), ('expired', False)])
        a4 = self.ws()
        a4.send_json({'t': 'join', 'code': code, 'name': 'A', 'token': ja['token']})
        j4 = a4.expect('joined')
        self.assertFalse(j4['rejoin'])
        self.assertNotEqual(j4['token'], ja['token'])

    def test_automatic_rejoin_only_reclaims_its_own_slot(self):
        """rejoin:true (WsRelayTransport's automatic reconnect) never comes back as a new player: kicked while the
        connection was down, or the slot expired -> slot-lost (it used to get a fresh slot, undoing the kick)."""
        h, code = self.host()
        a, ja = self.join(code, name='A', host=h)
        a.close()                                                # network drop: the slot is reserved
        self.assertTrue(h.expect('peer-leave')['reserved'])
        a2 = self.ws()
        a2.send_json({'t': 'join', 'code': code, 'name': 'A', 'token': ja['token'], 'rejoin': True})
        self.assertEqual((a2.expect('joined')['peer'], h.expect('peer-join')['rejoin']), (ja['peer'], True))
        a2.close()
        self.assertTrue(h.expect('peer-leave')['reserved'])
        h.send_json({'t': 'kick', 'peer': ja['peer'], 'id': 1})  # the host removes the player while it is away
        self.assertEqual(h.expect('peer-leave')['reason'], 'kicked')
        self.assertEqual(h.expect('ok')['re'], 'kick')
        a3 = self.ws()
        a3.send_json({'t': 'join', 'code': code, 'name': 'A', 'token': ja['token'], 'rejoin': True, 'id': 2})
        m = a3.expect('error')
        self.assertEqual((m['reason'], m['re'], m['id']), ('slot-lost', 'join', 2))
        self.assertEqual(h.barrier(), [])                        # the host never saw it come back
        b, jb = self.join(code, name='B', host=h)
        b.close()
        self.assertTrue(h.expect('peer-leave')['reserved'])
        self.assertEqual(h.expect('peer-leave', timeout=4)['reason'], 'expired')
        b2 = self.ws()
        b2.send_json({'t': 'join', 'code': code, 'name': 'B', 'token': jb['token'], 'rejoin': True})
        self.assertEqual(b2.expect('error')['reason'], 'slot-lost')
        a3.send_json({'t': 'join', 'code': code, 'name': 'A', 'token': ja['token']})   # a deliberate join still works
        self.assertFalse(a3.expect('joined')['rejoin'])
        self.assertFalse(h.expect('peer-join')['rejoin'])


# ------------------------------------------------------------------------------------------------ HTTP / server

class ApiTests(RelayCase):
    def test_api_lan_rooms_stats(self):
        status, body = http_get(self.port, '/api/lan')
        self.assertEqual(status, 200)
        info = json.loads(body)
        self.assertEqual((info['app'], info['relay'], info['port'], info['lan'], info['bind']),
                         ('kinetic', netserver.RELAY_VERSION, self.port, False, '127.0.0.1'))
        self.assertEqual(info['urls'], [f'http://{ip}:{self.port}' for ip in info['ips']])
        for ip in info['ips']:
            self.assertFalse(ip.startswith('127.') or ip.startswith('169.254.'), ip)
        status, body = http_get(self.port, '/api/rooms')
        self.assertEqual(status, 200)
        self.assertIsInstance(json.loads(body)['rooms'], list)
        status, body = http_get(self.port, '/api/stats')
        self.assertIn('counters', json.loads(body))
        self.assertEqual(http_get(self.port, '/api/nope')[0], 404)
        self.assertEqual(http_get(self.port, '/index.html')[0], 200)
        self.assertEqual(http_get(self.port, '/tools/serve.py')[0], 200)   # loopback: full access
        self.assertEqual(http_get(self.port, '/api/lan', method='HEAD'), (200, b''))
        self.assertEqual(http_get(self.port, '/ws', method='HEAD')[0], 405)   # the upgrade is GET only

    def test_rank_ipv4s(self):
        self.assertEqual(netserver.rank_ipv4s(['127.0.0.1', '100.101.1.2', '172.20.5.157', '169.254.3.4', '0.0.0.0',
                                               'junk', '192.168.1.5', '172.20.5.157', '224.0.0.1']),
                         ['172.20.5.157', '192.168.1.5', '100.101.1.2'])

    def test_lan_banner(self):
        lines = serve.lan_banner(8000, ['172.20.5.157', '10.0.0.2'], 'PC')
        self.assertIn('  You: http://localhost:8000  Friends: http://172.20.5.157:8000', lines)
        self.assertTrue(any('http://10.0.0.2:8000' in s for s in lines))
        self.assertTrue(any('http://PC:8000' in s for s in lines))
        self.assertTrue(any('Firewall' in s for s in lines))
        self.assertTrue(any('no network address' in s for s in serve.lan_banner(8000, [], 'PC')))


class LanPolicyTests(RelayCase):
    restrict = True

    def setUp(self):
        super().setUp()
        self.srv.is_trusted = lambda ip: False                   # pretend every client is another machine

    def tearDown(self):
        del self.srv.is_trusted
        super().tearDown()

    def test_remote_clients_only_get_the_game(self):
        for path in ('/', '/?join=BCDF', '/index.html', '/style.css', '/src/main.js', '/src/net/protocol.js',
                     '/vendor/three/build/three.module.js', '/api/lan', '/api/rooms'):
            self.assertEqual(http_get(self.port, path)[0], 200, path)
        self.assertEqual(http_get(self.port, '/src/main.js', method='HEAD')[0], 200)
        for path in ('/src/', '/src', '/vendor/', '/tools/', '/tools/serve.py', '/ARCHITECTURE.md', '/play.bat',
                     '/src/../tools/serve.py', '/src/%2e%2e/tools/serve.py', '/%2e%2e/%2e%2e/Windows/win.ini',
                     '/src/..%5c..%5ctools%5cserve.py', '/src%5c..%5ctools%5cserve.py', '/tools/out/', '/nope.js',
                     '/api/stats', '/tools/nettest.html'):
            self.assertEqual(http_get(self.port, path)[0], 404, path)
        self.assertEqual(http_get(self.port, '/tools/serve.py', method='HEAD')[0], 404)
        ws = self.ws()                                           # the relay stays reachable
        ws.send_json({'t': 'ping', 'c': 1})
        ws.expect('pong')

    def test_loopback_keeps_full_access(self):
        del self.srv.is_trusted
        try:
            self.assertEqual(http_get(self.port, '/tools/serve.py')[0], 200)
            self.assertEqual(http_get(self.port, '/src/')[0], 200)
            self.assertEqual(http_get(self.port, '/api/stats')[0], 200)   # lists private rooms: this PC only
        finally:
            self.srv.is_trusted = lambda ip: False

    def test_public_path_allowed(self):
        root = serve.ROOT
        j = os.path.join
        self.assertFalse(serve.public_path_allowed(root, root))  # '/' is allowed by URL, never as a listing
        self.assertTrue(serve.public_path_allowed(j(root, 'index.html'), root))
        self.assertTrue(serve.public_path_allowed(j(root, 'style.css'), root))
        self.assertTrue(serve.public_path_allowed(j(root, 'src', 'main.js'), root))
        self.assertFalse(serve.public_path_allowed(j(root, 'src'), root))
        self.assertFalse(serve.public_path_allowed(j(root, 'tools', 'serve.py'), root))
        self.assertFalse(serve.public_path_allowed(j(root, '..', 'README.md'), root))
        self.assertFalse(serve.public_path_allowed(j(root, 'src', '..', 'play.bat'), root))


class ConsoleLogTests(unittest.TestCase):
    def test_blocked_console_never_stalls_the_relay(self):
        """A Windows console with selected text (QuickEdit) blocks writes: room events must not stall routing."""
        release = threading.Event()

        class BlockedConsole(io.StringIO):
            def write(self, s):
                release.wait(30)
                return super().write(s)
        console = BlockedConsole()
        srv, port = serve.serve_in_background(0, log=netserver.ConsoleLog(console))
        clients = []
        try:
            h = WS(port)
            clients.append(h)
            h.send_json({'t': 'host', 'name': 'blocked console'})
            code = h.expect('hosted')['code']                    # logged: 'room ... opened'
            for i in range(3):
                c = WS(port)
                clients.append(c)
                c.send_json({'t': 'join', 'code': code, 'name': f'P{i}'})
                peer = c.expect('joined')['peer']                # logged: '... joined as peer ...'
                self.assertEqual(h.expect('peer-join')['peer'], peer)
                c.send_bin(bytes([0, 0x01]) + b'input')
                self.assertEqual(h.recv_bin(), bytes([peer, 0x01]) + b'input')
                h.send_bin(bytes([peer, 0x10]) + b'reply')
                self.assertEqual(c.recv_bin(timeout=2), bytes([peer, 0x10]) + b'reply')
            self.assertEqual(console.getvalue(), '')             # nothing could be written yet
            release.set()
            self.assertTrue(wait_until(lambda: console.getvalue().count('joined as peer') == 3, timeout=5),
                            console.getvalue())
        finally:
            release.set()
            for c in clients:
                c.close()
            srv.shutdown()
            srv.server_close()


class ServerTests(unittest.TestCase):
    def run_serve(self, *args, timeout=20, env=None):
        env = dict(env or os.environ, PYTHONDONTWRITEBYTECODE='1')
        return subprocess.run([sys.executable, os.path.join(TOOLS, 'serve.py'), *args], capture_output=True, text=True,
                              timeout=timeout, env=env, stdin=subprocess.DEVNULL)

    def test_exclusive_bind(self):
        srv, port = serve.serve_in_background(0)
        try:
            with self.assertRaises(OSError):
                serve.make_server(port)
        finally:
            srv.shutdown()
            srv.server_close()

    def test_second_instance_reports_already_running(self):
        srv, port = serve.serve_in_background(0)
        try:
            # a system proxy must not hide the running server from the loopback probe
            env = {k: v for k, v in os.environ.items() if k.lower() not in ('no_proxy', 'http_proxy', 'all_proxy')}
            env['HTTP_PROXY'] = 'http://127.0.0.1:9'
            r = self.run_serve(str(port), env=env)
            self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
            self.assertIn('KINETIC is already running', r.stdout)
            r = self.run_serve(str(port), '--lan', '--bind', '127.0.0.1')
            self.assertEqual(r.returncode, 1, r.stdout + r.stderr)
            self.assertIn('only for this PC', r.stdout)
        finally:
            srv.shutdown()
            srv.server_close()

    def test_foreign_program_on_the_port(self):
        s = socket.socket()
        s.bind(('127.0.0.1', 0))
        s.listen(1)
        port = s.getsockname()[1]
        try:
            r = self.run_serve(str(port), timeout=30)
            self.assertEqual(r.returncode, 1, r.stdout + r.stderr)
            self.assertIn('Another program is using that port', r.stdout)
        finally:
            s.close()

    def test_reserved_port_message(self):
        """WinError 10013 (a Hyper-V / WSL reserved port range) must not be blamed on 'another program'."""
        def forbidden(*a, **kw):
            raise PermissionError(13, 'An attempt was made to access a socket in a way forbidden by its access permissions')
        for name, fake in (('make_server', forbidden), ('probe_running', lambda port: None)):
            real = getattr(serve, name)
            setattr(serve, name, fake)
            self.addCleanup(setattr, serve, name, real)
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.assertEqual(serve.main(['8000', '--quiet']), 1)
        text = out.getvalue()
        self.assertIn('excludedportrange', text)
        self.assertNotIn('Another program is using that port', text)
        self.assertIn('python tools\\serve.py 8001', text)

    def stub_browser(self, on_open=None):
        """Replace webbrowser.open (never open a real browser in tests); returns the list of opened URLs."""
        opened = []
        real = serve.webbrowser.open

        def fake(url, *a, **kw):
            if on_open:
                on_open(url)                                     # before `opened` changes: tests poll `opened`
            opened.append(url)
            return True
        serve.webbrowser.open = fake
        self.addCleanup(setattr, serve.webbrowser, 'open', real)
        return opened

    def test_open_only_after_the_port_listens(self):
        servers = []
        listening = []
        real_make = serve.make_server

        def capture(*a, **kw):
            srv = real_make(*a, **kw)
            servers.append(srv)
            return srv

        def probe(url):                                          # the port must accept connections already
            with socket.create_connection(('127.0.0.1', servers[0].server_address[1]), timeout=2):
                listening.append(True)
        opened = self.stub_browser(probe)
        serve.make_server = capture
        self.addCleanup(setattr, serve, 'make_server', real_make)
        result = []
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            t = threading.Thread(target=lambda: result.append(serve.main(['0', '--open', '#host', '--quiet'])), daemon=True)
            t.start()
            self.assertTrue(wait_until(lambda: opened, timeout=10))
            port = servers[0].server_address[1]
            self.assertEqual(opened, [f'http://localhost:{port}/#host'])
            self.assertEqual(listening, [True])
            self.assertEqual(servers[0].server_address[0], '127.0.0.1')
            self.assertEqual(http_get(port, '/api/lan')[0], 200)
            servers[0].shutdown()
            t.join(10)
        self.assertEqual(result, [0])
        self.assertIn(f'KINETIC running at http://localhost:{port}/', out.getvalue())

    def test_open_when_already_running(self):
        srv, port = serve.serve_in_background(0)
        try:
            opened = self.stub_browser()
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                self.assertEqual(serve.main([str(port), '--open']), 0)
                self.assertEqual(opened, [f'http://localhost:{port}/'])
                self.assertEqual(serve.main([str(port)]), 0)      # without --open: the message only
            self.assertEqual(len(opened), 1)
            self.assertIn('KINETIC is already running', out.getvalue())
        finally:
            srv.shutdown()
            srv.server_close()

    def stub(self, obj, name, value):
        real = getattr(obj, name)
        setattr(obj, name, value)
        self.addCleanup(setattr, obj, name, real)

    def test_lan_mode_asks_for_all_interfaces(self):
        """--lan binds 0.0.0.0 and restricts other machines. Checked with the server class stubbed: tests never
        bind a non-loopback address (that would pop the Windows Firewall prompt)."""
        seen = []

        class NoBind:
            def __init__(self, address, handler, restrict_remote=False):
                seen.append((address, restrict_remote))
                self.server_address = address
        self.stub(serve, 'ExclusiveServer', NoBind)
        for kw, want in (({'lan': True}, (('0.0.0.0', 8000), True)), ({}, (('127.0.0.1', 8000), False)),
                         ({'lan': True, 'bind': '127.0.0.1'}, (('127.0.0.1', 8000), True)),
                         ({'bind': '0.0.0.0'}, (('0.0.0.0', 8000), True)),            # any LAN bind: game files only
                         ({'bind': '192.168.1.20'}, (('192.168.1.20', 8000), True)),
                         ({'bind': 'localhost'}, (('localhost', 8000), False))):
            srv = serve.make_server(8000, **kw)
            srv.relay.stop()
            self.assertEqual(seen.pop(), want, kw)

    def test_lan_main_banner_and_open(self):
        """The --lan start as host-lan.bat runs it: Friends address printed, this PC's browser on localhost."""
        made = []

        class FakeServer:
            server_address = ('0.0.0.0', 8000)

            def serve_forever(self):
                pass                                             # return at once

            def server_close(self):
                made.append('closed')

        def fake_make(port, **kw):
            made.append((port, kw['bind'], kw['lan']))
            return FakeServer()
        self.stub(serve, 'make_server', fake_make)
        self.stub(serve, 'probe_running', lambda port: None)     # nothing on the port yet
        self.stub(serve, '_network_profile_warning', lambda: None)
        self.stub(netserver, 'lan_ipv4s', lambda: ['192.168.1.20', '10.0.0.7'])
        opened = self.stub_browser()
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.assertEqual(serve.main(['8000', '--lan', '--open', '--quiet']), 0)
        text = out.getvalue()
        self.assertEqual(made, [(8000, '0.0.0.0', True), 'closed'])
        self.assertIn('You: http://localhost:8000  Friends: http://192.168.1.20:8000', text)
        self.assertIn('http://10.0.0.7:8000', text)
        self.assertIn('Firewall', text)
        self.assertNotIn('bound to', text)
        self.assertEqual(opened, ['http://localhost:8000/'])
        made.clear()
        out = io.StringIO()
        with contextlib.redirect_stdout(out):                     # --bind <all interfaces> without --lan = LAN mode
            self.assertEqual(serve.main(['8000', '--bind', '0.0.0.0', '--quiet']), 0)
        self.assertEqual(made, [(8000, '0.0.0.0', True), 'closed'])
        self.assertIn('Friends: http://192.168.1.20:8000', out.getvalue())

    def test_lan_start_next_to_a_running_server_never_binds(self):
        """host-lan.bat while KINETIC already answers on the port: decided by asking the port, before any bind
        (a wildcard bind might succeed next to 127.0.0.1:PORT and split this PC's browser from the friends)."""
        def must_not_bind(*a, **kw):
            raise AssertionError('--lan tried to bind although KINETIC already runs on the port')
        srv, port = serve.serve_in_background(0)                  # single player (play.bat): 127.0.0.1 only
        try:
            self.stub(serve, 'make_server', must_not_bind)
            opened = self.stub_browser()
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                self.assertEqual(serve.main([str(port), '--lan', '--open', '--quiet']), 1)
            self.assertIn('only for this PC', out.getvalue())
            self.assertEqual(opened, [])
            self.stub(serve, 'probe_running', lambda p: {'app': 'kinetic', 'lan': True})   # a LAN host runs already
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                self.assertEqual(serve.main([str(port), '--lan', '--open', '--quiet']), 0)
            self.assertIn('KINETIC is already running', out.getvalue())
            self.assertEqual(opened, [f'http://localhost:{port}/'])
        finally:
            srv.shutdown()
            srv.server_close()

    def test_lan_banner_and_restricted_serving(self):
        env = dict(os.environ, PYTHONDONTWRITEBYTECODE='1')
        proc = subprocess.Popen([sys.executable, '-u', os.path.join(TOOLS, 'serve.py'), '0', '--lan', '--bind', '127.0.0.1',
                                 '--quiet'], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, env=env,
                                stdin=subprocess.DEVNULL)
        lines = []
        reader = threading.Thread(target=lambda: lines.extend(proc.stdout), daemon=True)
        reader.start()
        try:
            self.assertTrue(wait_until(lambda: any('bound to 127.0.0.1 only' in s for s in lines), timeout=15), lines)
            text = ''.join(lines)
            self.assertIn('You: http://localhost:', text)
            self.assertIn('Friends:', text)
            port = int(text.split('KINETIC LAN server on port ')[1].split()[0])
            self.assertEqual(http_get(port, '/api/lan')[0], 200)
        finally:
            proc.kill()
            proc.wait(10)
            reader.join(5)
            proc.stdout.close()


if __name__ == '__main__':
    unittest.main()

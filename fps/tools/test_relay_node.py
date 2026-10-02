#!/usr/bin/env python3
"""Black-box tests for the Node relay (desktop/relay.js), run against `node desktop/relay.js --loopback ...`.

Stdlib unittest, loopback only (every relay binds 127.0.0.1; nothing here ever binds 0.0.0.0):

    python tools/test_relay_node.py            # all tests (~1 min)
    python tools/test_relay_node.py -v -k Room # a subset

The wire-contract tests are the ones of tools/test_netserver.py itself: each class is re-run against the Node relay
by mixing NodeMixin into the original test class (so the Python and the Node relay are held to the same cases and any
case added there runs here too). A relay is one subprocess per test class, started with the hardening limits that get
in the way of the old cases switched off (the new classes below switch them on, one at a time).

What the Python test cases reach into that a subprocess cannot offer, and how it is handled:
  * relay.counters / relay.rooms / relay.conns / relay.stats(): answered through the relay's `--test-hooks` stdin
    command `stats` (RelayView).
  * handler monkey-patching (HandshakeTests.test_error_in_a_frame_...): replaced by the hook command `fault <type>`.
  * relay.max_rooms = 0 (RoomTests.test_server_full): a relay started with --max-rooms (ServerFullTests).
  * /api/stats and the static files of tools/serve.py: the Node relay has neither (404), see ApiTests.
  * netserver.new_code / normalize_code / rank_ipv4s helpers and serve.py's banner, LanPolicyTests, ConsoleLogTests,
    ServerTests: they test Python code, not the wire. The Node helpers are covered by tools/test_relay_units.js,
    which JsUnitTests runs.
"""
import base64
import http.client
import json
import os
import re
import random
import select
import shutil
import signal
import socket
import struct
import subprocess
import sys
import threading
import time
import unittest

sys.dont_write_bytecode = True      # importing the Python relay's modules must not litter tools/__pycache__
TOOLS = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(TOOLS)
sys.path.insert(0, TOOLS)
import netserver  # noqa: E402
import test_netserver as T  # noqa: E402

RELAY_JS = os.path.join(ROOT, 'desktop', 'relay.js')
NODE = shutil.which('node')
READY_RE = re.compile(r'ready on (\S+) port (\d+)')


class RelayProc:
    """`node desktop/relay.js --loopback --port 0 --test-hooks ...` with its output collected by reader threads."""

    def __init__(self, *flags, quiet=True, env=None):
        cmd = [NODE, RELAY_JS, '--loopback', '--port', '0', *(['--quiet'] if quiet else []), '--test-hooks', *flags]
        environ = {k: v for k, v in os.environ.items() if k != 'KINETIC_HOST_KEY'}
        environ.update(env or {})
        self.proc = subprocess.Popen(cmd, cwd=ROOT, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                     text=True, encoding='utf-8', errors='replace', bufsize=1, env=environ,
                                     creationflags=getattr(subprocess, 'CREATE_NEW_PROCESS_GROUP', 0))
        self.out, self.err, self._stats = [], [], []
        self.port = None
        self._cond = threading.Condition()
        self._threads = [threading.Thread(target=self._pump, args=(self.proc.stdout, self.out), daemon=True),
                         threading.Thread(target=self._pump, args=(self.proc.stderr, self.err), daemon=True)]
        for t in self._threads:
            t.start()
        with self._cond:
            ok = self._cond.wait_for(lambda: self.port is not None or self.proc.poll() is not None, 20)
        if self.port is None:
            self.stop()
            raise AssertionError(f'relay did not start (exit {self.proc.returncode}, ok={ok}):\n'
                                 + ''.join(self.out) + ''.join(self.err))

    def _pump(self, stream, sink):
        for line in stream:
            with self._cond:
                if line.startswith('@stats '):
                    self._stats.append(json.loads(line[7:]))
                else:
                    sink.append(line)
                    m = READY_RE.search(line)
                    if m and self.port is None:
                        self.port = int(m.group(2))
                self._cond.notify_all()

    def command(self, text):
        self.proc.stdin.write(text + '\n')
        self.proc.stdin.flush()

    def stats(self, timeout=15.0):
        """The relay's stats() object (counters, rooms, per-connection queue state), asked over stdin."""
        with self._cond:
            n = len(self._stats)
        self.command('stats')
        with self._cond:
            if not self._cond.wait_for(lambda: len(self._stats) > n, timeout):
                raise AssertionError('the relay did not answer "stats"')
            return self._stats[n]

    def fault(self, t):
        """The next control message of type `t` makes its handler throw (checked: the command has been processed)."""
        self.command(f'fault {t}')
        self.stats()

    def interrupt(self):
        """Shut the relay down the way Ctrl+Break / SIGTERM does (False when this environment cannot send it)."""
        try:
            self.proc.send_signal(signal.CTRL_BREAK_EVENT if os.name == 'nt' else signal.SIGTERM)
            return True
        except (OSError, ValueError):
            return False

    def stop(self):
        try:
            self.proc.terminate()
            self.proc.wait(10)
        except (OSError, subprocess.SubprocessError):
            self.proc.kill()
        for stream in (self.proc.stdin, self.proc.stdout, self.proc.stderr):
            try:
                stream.close()
            except (OSError, ValueError):
                pass
        for t in self._threads:
            t.join(2)


class RelayView:
    """The part of netserver.Relay the ported cases look at, answered by the relay process."""

    def __init__(self, proc):
        self.proc = proc

    def stats(self):
        return self.proc.stats()

    @property
    def counters(self):
        return self.proc.stats()['counters']

    @property
    def rooms(self):
        return {r['code']: r for r in self.proc.stats()['rooms']}

    @property
    def conns(self):
        return self.proc.stats()['conns']


class NodeMixin:
    """Put first in the bases of a test_netserver.RelayCase subclass: its relay is the Node one."""
    # the old cases open dozens of connections and requests from 127.0.0.1: the per-IP hardening is off for them
    base_flags = ('--max-conns-per-ip', '0', '--join-rate', '0', '--control-rate', '0')
    extra_flags = ()
    relay_env = {}

    @classmethod
    def flags(cls):
        out = list(cls.base_flags)
        for key, value in (getattr(cls, 'relay_options', None) or {}).items():     # netserver option names
            out += ['--' + key.replace('_', '-'), str(value)]
        return out + list(cls.extra_flags)

    @classmethod
    def setUpClass(cls):
        if NODE is None:
            raise unittest.SkipTest('node is not on PATH')
        cls.proc = RelayProc(*cls.flags(), env=cls.relay_env)
        cls.port = cls.proc.port
        cls.relay = RelayView(cls.proc)

    @classmethod
    def tearDownClass(cls):
        cls.proc.stop()


def http_request(port, path, method='GET', headers=None, timeout=5.0):
    """(status, lower-cased headers, body) of a request without any proxy."""
    conn = http.client.HTTPConnection('127.0.0.1', port, timeout=timeout)
    try:
        conn.request(method, path, headers=headers or {})
        r = conn.getresponse()
        return r.status, {k.lower(): v for k, v in r.getheaders()}, r.read()
    finally:
        conn.close()


# ------------------------------------------------------------------------------------------------ the old cases, on Node

class HandshakeTests(NodeMixin, T.HandshakeTests):
    def test_error_in_a_frame_sent_with_the_handshake_closes_only_that_connection(self):
        self.proc.fault('ping')
        payload = json.dumps({'t': 'ping', 'c': 1}).encode()
        key = os.urandom(4)
        ws = self.early_ws(bytes((0x81, 0x80 | len(payload))) + key + netserver.unmask(payload, key))
        self.assertEqual(ws.expect_close()[0], 1011)               # not left hanging without a reply
        self.errors0 += 1
        self.assertTrue(T.wait_until(lambda: any('internal error' in line for line in self.proc.err)))
        other = self.ws()
        other.send_json({'t': 'ping', 'c': 2})
        self.assertEqual(other.expect('pong')['c'], 2)


class FramingTests(NodeMixin, T.FramingTests):
    pass


class RoomTests(NodeMixin, T.RoomTests):
    def test_codes(self):
        """60 rooms get 60 distinct 4-letter codes from the consonant alphabet (helpers: test_relay_units.js)."""
        codes = set()
        for _ in range(60):
            h, code = self.host()
            self.assertEqual(len(code), 4)
            self.assertTrue(all(ch in 'BCDFGHJKLMNPQRSTVWXZ' for ch in code), code)
            codes.add(code)
        self.assertEqual(len(codes), 60)

    @unittest.skip('sets relay.max_rooms in-process: ServerFullTests starts a relay with --max-rooms instead')
    def test_server_full(self):
        pass


class ServerFullTests(NodeMixin, T.RelayCase):
    relay_options = {'max_rooms': 2}

    def test_server_full(self):
        a, _ = self.host()
        b, _ = self.host()
        ws = self.ws()
        ws.send_json({'t': 'host', 'id': 5})
        m = ws.expect('error')
        self.assertEqual((m['reason'], m['re'], m['id']), ('server-full', 'host', 5))
        a.close()                                                  # a room closes with its host: room for a new one
        self.assertTrue(T.wait_until(lambda: len(self.relay.rooms) < 2))
        ws.send_json({'t': 'host'})
        ws.expect('hosted')


class RoutingTests(NodeMixin, T.RoutingTests):
    def test_client_to_host_rewrites_sender(self):
        """The original case, except that a's packet is confirmed routed before b sends: two TCP connections have no
        mutual order (the original sent both back to back and expected them in that order; it can flake on any relay)."""
        h, code = self.host()
        a, ja = self.join(code, host=h)
        b, jb = self.join(code, host=h)
        a.send_bin(b'\x4d\x01hello')                             # byte0 = 77: must be replaced by the sender id
        self.assertEqual(a.barrier(), [])
        b.send_bin(b'\xff\x01world')                             # a client cannot broadcast
        self.assertEqual(h.recv_bin(), bytes([ja['peer']]) + b'\x01hello')
        self.assertEqual(h.recv_bin(), bytes([jb['peer']]) + b'\x01world')
        self.assertEqual(b.barrier(), [])


class ConflationTests(NodeMixin, T.ConflationTests):
    pass


class SlowConsumerTests(NodeMixin, T.SlowConsumerTests):
    pass


class IdleTests(NodeMixin, T.IdleTests):
    pass


class StallTests(NodeMixin, T.StallTests):
    pass


class ConnLimitTests(NodeMixin, T.ConnLimitTests):
    pass


class ReserveTests(NodeMixin, T.ReserveTests):
    pass


class ApiTests(NodeMixin, T.ApiTests):
    def test_api_lan_rooms_stats(self):
        status, body = T.http_get(self.port, '/api/lan')
        self.assertEqual(status, 200)
        info = json.loads(body)
        self.assertEqual((info['app'], info['relay'], info['port'], info['lan'], info['bind']),
                         ('kinetic', netserver.RELAY_VERSION, self.port, False, '127.0.0.1'))
        self.assertEqual(info['urls'], [f'http://{ip}:{self.port}' for ip in info['ips']])
        self.assertEqual(info['hostUrl'], f"http://{info['hostname']}:{self.port}")
        for ip in info['ips']:
            self.assertFalse(ip.startswith('127.') or ip.startswith('169.254.'), ip)
        status, body = T.http_get(self.port, '/api/rooms')
        self.assertEqual(status, 200)
        data = json.loads(body)
        self.assertEqual(data['relay'], netserver.RELAY_VERSION)
        self.assertIsInstance(data['rooms'], list)
        h, code = self.host(name='Listed', public=True, meta={'map': 'x'})
        hidden, hcode = self.host(public=False)
        rooms = {r['code']: r for r in json.loads(T.http_get(self.port, '/api/rooms')[1])['rooms']}
        self.assertEqual(rooms[code], {'code': code, 'name': 'Listed', 'players': 1, 'max': 8, 'locked': False,
                                       'meta': {'map': 'x'}, 'v': None})
        self.assertNotIn(hcode, rooms)
        # the relay serves no files and keeps no stats page: the attack surface is /ws and two JSON documents
        for path in ('/api/stats', '/api/nope', '/index.html', '/', '/tools/serve.py', '/src/main.js', '/api/lan/x'):
            self.assertEqual(T.http_get(self.port, path)[0], 404, path)
        self.assertEqual(T.http_get(self.port, '/api/lan', method='HEAD'), (200, b''))
        self.assertEqual(T.http_get(self.port, '/ws', method='HEAD')[0], 405)    # the upgrade is GET only
        self.assertEqual(T.http_get(self.port, '/api/lan?x=1')[0], 200)           # a query string does not matter
        self.assertEqual(http_request(self.port, '/api/lan', 'POST')[0], 405)
        self.assertEqual(http_request(self.port, '/api/lan', 'DELETE')[0], 405)
        self.assertEqual(http_request(self.port, '/ws')[0], 400)                  # /ws without an upgrade

    @unittest.skip('rank_ipv4s is a Python helper; the Node one is covered by test_relay_units.js')
    def test_rank_ipv4s(self):
        pass

    @unittest.skip("serve.py's console banner")
    def test_lan_banner(self):
        pass


# ------------------------------------------------------------------------------------------------ new behaviour

def drain(ws, quiet=0.4, limit=5000):
    """Every message until nothing arrives for `quiet` s: JSON as dicts, binary as bytes, ('closed', code) at a close."""
    out = []
    while len(out) < limit:
        try:
            op, payload = ws.recv(timeout=quiet)
        except socket.timeout:
            break
        except T.Closed as c:
            out.append(('closed', c.code))
            break
        except (EOFError, OSError):
            out.append(('eof',))
            break
        out.append(json.loads(payload) if op == 0x1 else payload)
    return out


class OriginPolicyTests(NodeMixin, T.RelayCase):
    """Browsers always send Origin on a WebSocket upgrade: the desktop page and same-origin pages pass, others get 403."""

    def status(self, origin):
        status, _, sock, _ = T.raw_handshake(self.port, origin=origin)
        sock.close()
        return status

    def test_desktop_app_origin_is_accepted(self):
        self.assertEqual(self.status('kinetic://game'), 101)
        ws = self.ws(origin='kinetic://game')
        ws.send_json({'t': 'ping', 'c': 1})
        self.assertEqual(ws.expect('pong')['c'], 1)

    def test_missing_origin_is_accepted(self):
        status, _, sock, _ = T.raw_handshake(self.port)          # tools and tests send none
        sock.close()
        self.assertEqual(status, 101)

    def test_same_origin_pages_are_accepted(self):
        for origin in (f'http://127.0.0.1:{self.port}', f'HTTP://127.0.0.1:{self.port}', f'https://127.0.0.1:{self.port}'):
            self.assertEqual(self.status(origin), 101, origin)

    def test_same_origin_page_under_a_domain_name_is_refused(self):
        """This relay serves no pages: a 'same-origin' page that reaches it by a domain name rebound that name to this
        PC (DNS rebinding). The Python relay, which serves its own pages, would accept it."""
        def handshake(host, origin):
            sock = socket.create_connection(('127.0.0.1', self.port))
            sock.settimeout(5)
            key = base64.b64encode(os.urandom(16)).decode()
            lines = [f'GET /ws HTTP/1.1', f'Host: {host}', 'Upgrade: websocket', 'Connection: Upgrade',
                     f'Sec-WebSocket-Key: {key}', 'Sec-WebSocket-Version: 13', f'Origin: {origin}']
            sock.sendall(('\r\n'.join(lines) + '\r\n\r\n').encode())
            status = int(sock.recv(200).split()[1])
            sock.close()
            return status
        port = self.port
        self.assertEqual(handshake(f'evil.example:{port}', f'http://evil.example:{port}'), 403)
        self.assertEqual(handshake('evil.example', 'https://evil.example'), 403)
        self.assertEqual(handshake(f'127.0.0.1:{port}', f'http://127.0.0.1:{port}'), 101)
        self.assertEqual(handshake(f'localhost:{port}', f'http://localhost:{port}'), 101)
        self.assertEqual(handshake(f'[::1]:{port}', f'http://[::1]:{port}'), 101)
        self.assertEqual(handshake(f'{socket.gethostname()}:{port}', f'http://{socket.gethostname()}:{port}'), 101)
        self.assertEqual(handshake(f'friend.duckdns.org:{port}', 'kinetic://game'), 101)    # the game may use any name

    def test_every_other_origin_gets_403(self):
        before = self.relay.counters['bad_origin']
        connections0 = self.relay.counters['connections']
        refused = ['http://evil.example', 'https://evil.example', 'http://evil.example:80', f'http://localhost:{self.port}',
                   'http://127.0.0.1', f'http://127.0.0.1:{self.port + 1}', 'null', '', 'kinetic://other',
                   'kinetic://game.evil.example', 'kinetic://game:1234', 'file://', 'chrome-extension://abcdef',
                   f'http://user@127.0.0.1:{self.port}', f'ftp://127.0.0.1:{self.port}']     # the Python relay accepts the ftp one
        for origin in refused:
            self.assertEqual(self.status(origin), 403, origin)
        self.assertEqual(self.relay.counters['bad_origin'] - before, len(refused))
        self.assertEqual(self.relay.counters['connections'], connections0)                    # none became a connection


class ExtraOriginTests(NodeMixin, T.RelayCase):
    """--allow-origin adds pages (say the web version on localhost:8000) next to kinetic://game; nothing else changes."""
    extra_flags = ('--allow-origin', 'https://web.example', '--allow-origin', 'http://localhost:8000')

    def test_configured_origins_are_accepted_and_may_read_the_api(self):
        for origin in ('kinetic://game', 'https://web.example', 'http://localhost:8000'):
            status, _, sock, _ = T.raw_handshake(self.port, origin=origin)
            sock.close()
            self.assertEqual(status, 101, origin)
            status, h, _ = http_request(self.port, '/api/rooms', headers={'Origin': origin})
            self.assertEqual((status, h['access-control-allow-origin']), (200, origin))
        for origin in ('https://evil.example', 'http://web.example', 'https://web.example:8443', 'http://localhost:8001'):
            status, _, sock, _ = T.raw_handshake(self.port, origin=origin)
            sock.close()
            self.assertEqual(status, 403, origin)
            status, h, _ = http_request(self.port, '/api/rooms', headers={'Origin': origin})
            self.assertEqual(status, 200)
            self.assertNotIn('access-control-allow-origin', h, origin)


class CorsTests(NodeMixin, T.RelayCase):
    """/api/* may be read by a page only when it is the desktop app's page."""

    def test_only_the_desktop_origin_may_read_the_api(self):
        for path in ('/api/lan', '/api/rooms'):
            status, h, _ = http_request(self.port, path, headers={'Origin': 'kinetic://game'})
            self.assertEqual(status, 200)
            self.assertEqual(h['access-control-allow-origin'], 'kinetic://game')
            self.assertIn('origin', h['vary'].lower())
            for origin in ('http://evil.example', 'null', 'kinetic://other', f'http://127.0.0.1:{self.port}', '*'):
                status, h, _ = http_request(self.port, path, headers={'Origin': origin})
                self.assertEqual(status, 200, origin)                    # the request is served, the browser may not read it
                self.assertNotIn('access-control-allow-origin', h, origin)
            status, h, _ = http_request(self.port, path)                  # no Origin: same-origin or a tool
            self.assertEqual(status, 200)
            self.assertNotIn('access-control-allow-origin', h)
            status, h, body = http_request(self.port, path, 'HEAD', headers={'Origin': 'kinetic://game'})
            self.assertEqual((status, body, h['access-control-allow-origin']), (200, b'', 'kinetic://game'))

    def test_dns_rebinding_pages_are_refused(self):
        """A page whose own domain name points at this PC is same-origin for the browser, so CORS does not stop it
        (and it sends no Origin on a GET). Its requests give it away: the Host is its domain, not an address."""
        for path in ('/api/lan', '/api/rooms'):
            for host in ('evil.example', f'evil.example:{self.port}', '127.0.0.1.evil.example', 'localhost.evil.example',
                         f'{socket.gethostname()}.evil.example', 'kinetic', ''):
                status, h, body = http_request(self.port, path, headers={'Host': host})
                self.assertEqual(status, 403, (path, host))
                self.assertEqual(json.loads(body), {'error': 'forbidden'})
                self.assertNotIn('access-control-allow-origin', h)
                self.assertEqual(http_request(self.port, path, headers={'Host': host, 'Origin': 'http://evil.example'})[0], 403)
            for host in ('127.0.0.1', f'127.0.0.1:{self.port}', '192.168.1.20:27500', '[::1]:27500', '[fe80::1]', 'localhost',
                         f'LOCALHOST:{self.port}', socket.gethostname(), f'{socket.gethostname()}.local:{self.port}'):
                self.assertEqual(http_request(self.port, path, headers={'Host': host})[0], 200, (path, host))
            # the game reaches a friend by whatever name its player typed (a DDNS name, say): its Origin vouches for it
            status, h, _ = http_request(self.port, path, headers={'Host': 'friend.duckdns.org:27500', 'Origin': 'kinetic://game'})
            self.assertEqual((status, h['access-control-allow-origin']), (200, 'kinetic://game'))
        # the WebSocket handshake has its own rule (Origin); a plain name there is how players join by DDNS
        status, _, sock, _ = T.raw_handshake(self.port, extra=['X-Probe: 1'])
        sock.close()
        self.assertEqual(status, 101)

    def test_preflight_is_answered_for_the_desktop_origin_only(self):
        ask = {'Origin': 'kinetic://game', 'Access-Control-Request-Method': 'GET',
               'Access-Control-Request-Headers': 'cache-control', 'Access-Control-Request-Private-Network': 'true'}
        status, h, body = http_request(self.port, '/api/lan', 'OPTIONS', headers=ask)
        self.assertEqual((status, body), (204, b''))
        self.assertEqual(h['access-control-allow-origin'], 'kinetic://game')
        self.assertIn('GET', h['access-control-allow-methods'])
        self.assertEqual(h['access-control-allow-headers'], 'cache-control')
        self.assertEqual(h['access-control-allow-private-network'], 'true')
        self.assertNotIn('*', h['access-control-allow-origin'])
        status, h, _ = http_request(self.port, '/api/rooms', 'OPTIONS', headers={**ask, 'Origin': 'http://evil.example'})
        self.assertEqual(status, 204)
        for name in h:
            self.assertFalse(name.startswith('access-control-allow'), name)
        self.assertEqual(http_request(self.port, '/nope', 'OPTIONS', headers=ask)[0], 404)


class IpLimitTests(NodeMixin, T.RelayCase):
    extra_flags = ('--max-conns-per-ip', '3')

    def test_connections_per_ip_are_capped_with_429(self):
        socks = [self.ws() for _ in range(3)]
        limit0 = self.relay.counters['ip_limit']
        status, _, sock, _ = T.raw_handshake(self.port)
        sock.close()
        self.assertEqual(status, 429)
        self.assertEqual(T.http_get(self.port, '/api/lan')[0], 429)  # plain requests count as connections too
        self.assertEqual(self.relay.counters['ip_limit'] - limit0, 2)
        socks[0].send_json({'t': 'ping', 'c': 7})                    # the connections that exist are unaffected
        self.assertEqual(socks[0].expect('pong')['c'], 7)
        socks.pop().close()                                          # a closed one frees its place
        for _ in range(100):
            status, _, sock, _ = T.raw_handshake(self.port)
            sock.close()
            if status == 101:
                break
            time.sleep(0.05)
        self.assertEqual(status, 101)

    def test_idle_tcp_connections_count_until_they_time_out(self):
        idle = [socket.create_connection(('127.0.0.1', self.port)) for _ in range(3)]
        try:
            self.assertEqual(T.http_get(self.port, '/api/rooms')[0], 429)
        finally:
            idle.pop().close()
        status = 0
        for _ in range(100):
            try:
                status = T.http_get(self.port, '/api/rooms')[0]
            except OSError:
                status = 0
            if status == 200:
                break
            time.sleep(0.05)
        self.assertEqual(status, 200)
        for s in idle:
            s.close()


class JoinRateTests(NodeMixin, T.RelayCase):
    extra_flags = ('--join-rate', '4', '--join-window', '60')

    def test_host_and_join_requests_are_rate_limited_per_ip(self):
        h, code = self.host()                                        # token 1 of 4
        a, ja = self.join(code, host=h)                              # 2
        a.close()
        self.assertTrue(h.expect('peer-leave')['reserved'])
        back = self.ws()                                             # a valid reconnect token is not a guess: free
        back.send_json({'t': 'join', 'code': code, 'name': 'A', 'token': ja['token'], 'rejoin': True})
        self.assertTrue(back.expect('joined')['rejoin'])
        h.expect('peer-join')
        wrong = self.ws()
        for _ in range(2):                                           # 3 and 4: wrong codes are what a brute-forcer sends
            wrong.send_json({'t': 'join', 'code': 'ZZZZ' if code != 'ZZZZ' else 'ZZZX', 'name': 'x'})
            self.assertEqual(wrong.expect('error')['reason'], 'no-such-room')
        limited0 = self.relay.counters['rate_limited']
        wrong.send_json({'t': 'join', 'code': code, 'name': 'x', 'id': 9})    # even the right code is refused now
        m = wrong.expect('error')
        self.assertEqual((m['reason'], m['re'], m['id']), ('rate-limited', 'join', 9))
        other = self.ws()                                            # the limit belongs to the address, not the connection
        other.send_json({'t': 'host', 'id': 10})
        m = other.expect('error')
        self.assertEqual((m['reason'], m['re'], m['id']), ('rate-limited', 'host', 10))
        self.assertEqual(self.relay.counters['rate_limited'] - limited0, 2)
        back.close()                                                 # reconnecting with the token still works
        self.assertTrue(h.expect('peer-leave')['reserved'])
        again = self.ws()
        again.send_json({'t': 'join', 'code': code, 'name': 'A', 'token': ja['token'], 'rejoin': True})
        self.assertEqual(again.expect('joined')['peer'], ja['peer'])
        wrong.send_json({'t': 'list'})                               # other requests are not charged
        self.assertIn(code, [r['code'] for r in wrong.expect('rooms')['rooms']])
        wrong.send_json({'t': 'ping', 'c': 1})
        wrong.expect('pong')


class HandshakeLimitTests(NodeMixin, T.RelayCase):
    extra_flags = ('--handshake-timeout', '0.6', '--max-header-bytes', '2048')

    def test_silent_connection_is_dropped(self):
        before = self.relay.counters['handshake_timeouts']
        s = socket.create_connection(('127.0.0.1', self.port))
        s.settimeout(5)
        t0 = time.monotonic()
        try:
            data = s.recv(100)
        except OSError:
            data = b''
        elapsed = time.monotonic() - t0
        s.close()
        self.assertEqual(data, b'')
        self.assertGreater(elapsed, 0.4)
        self.assertLess(elapsed, 2.5)
        self.assertGreaterEqual(self.relay.counters['handshake_timeouts'] - before, 1)

    def test_dripping_a_request_does_not_extend_the_deadline(self):
        s = socket.create_connection(('127.0.0.1', self.port))
        t0 = time.monotonic()
        closed = None
        try:
            s.sendall(b'GET /ws HTTP/1.1\r\nHost: 127.0.0.1\r\n')
            while time.monotonic() - t0 < 4:
                time.sleep(0.1)
                try:
                    s.sendall(b'X-Drip: 1\r\n')                      # a header line every 100 ms, never the blank line
                except OSError:
                    closed = time.monotonic() - t0
                    break
                if select.select([s], [], [], 0)[0]:
                    try:
                        if not s.recv(100):
                            closed = time.monotonic() - t0
                            break
                    except OSError:
                        closed = time.monotonic() - t0
                        break
        finally:
            s.close()
        self.assertIsNotNone(closed, 'the connection was never dropped')
        self.assertGreater(closed, 0.4)
        self.assertLess(closed, 2.5)

    def test_completed_handshake_is_not_dropped_by_the_deadline(self):
        ws = self.ws()
        time.sleep(1.2)                                              # twice the handshake deadline
        ws.send_json({'t': 'ping', 'c': 1})
        self.assertEqual(ws.expect('pong')['c'], 1)
        self.assertEqual(T.http_get(self.port, '/api/lan')[0], 200)  # and a finished plain request needs no timer either

    def test_oversized_request_head_gets_431(self):
        s = socket.create_connection(('127.0.0.1', self.port))
        s.settimeout(5)
        try:
            s.sendall(b'GET /api/lan HTTP/1.1\r\nHost: x\r\nX-Pad: ' + b'a' * 4000 + b'\r\n\r\n')
            head = b''
            try:
                while b'\r\n' not in head:
                    chunk = s.recv(200)
                    if not chunk:
                        break
                    head += chunk
            except OSError:
                pass
        finally:
            s.close()
        self.assertTrue(head.startswith(b'HTTP/1.1 431'), head[:40])
        self.assertNotIn(b'at ', head)                               # no internals in the reply


class ControlRateTests(NodeMixin, T.RelayCase):
    extra_flags = ('--control-rate', '5', '--control-burst', '10')

    def test_control_flood_is_dropped_and_the_connection_recovers(self):
        ws = self.ws()
        dropped0 = self.relay.counters['control_dropped']
        for i in range(60):
            ws.send_json({'t': 'ping', 'c': i})
        msgs = drain(ws, quiet=0.5)
        pongs = [m for m in msgs if isinstance(m, dict) and m['t'] == 'pong']
        notices = [m for m in msgs if isinstance(m, dict) and m.get('reason') == 'rate-limited']
        self.assertGreaterEqual(len(pongs), 10)                      # the burst
        self.assertLess(len(pongs), 25)
        self.assertEqual([m['c'] for m in pongs], sorted(m['c'] for m in pongs))
        self.assertGreaterEqual(len(notices), 1)
        self.assertLessEqual(len(notices), 2)                        # told once per second, not once per message
        self.assertEqual(self.relay.counters['control_dropped'] - dropped0, 60 - len(pongs))
        time.sleep(1.3)                                              # the bucket refills
        ws.send_json({'t': 'ping', 'c': 'later'})
        self.assertEqual(ws.expect('pong')['c'], 'later')

    def test_flood_that_never_lets_up_is_closed_1008(self):
        ws = self.ws()
        for i in range(400):
            ws.send_json({'t': 'ping', 'c': i})
        msgs = drain(ws, quiet=1.0)
        self.assertEqual(msgs[-1], ('closed', 1008), msgs[-3:])

    def test_binary_packets_are_not_control_messages(self):
        h, code = self.host()
        a, ja = self.join(code, host=h)
        for i in range(200):                                         # the data plane has no per-message limit
            a.send_bin(bytes([0, 0x10]) + struct.pack('!I', i))
        for i in range(200):
            self.assertEqual(h.recv_bin()[2:], struct.pack('!I', i))


class RobustnessTests(NodeMixin, T.RelayCase):
    """Malformed input never takes the relay down and never leaks internals."""
    KNOWN_REASONS = {'no-such-room', 'room-full', 'room-locked', 'already-in-room', 'not-in-room', 'not-host',
                     'no-such-peer', 'version-mismatch', 'bad-code', 'code-taken', 'server-full', 'slot-lost',
                     'bad-message', 'rate-limited'}

    def assert_alive(self):
        h, code = self.host()
        a, ja = self.join(code, host=h)
        a.send_bin(b'\x00\x10alive')
        self.assertEqual(h.recv_bin(), bytes([ja['peer']]) + b'\x10alive')
        self.assertEqual(self.relay.counters['internal_errors'], self.errors0)

    def test_garbage_bytes_after_the_handshake(self):
        rnd = random.Random(20261001)
        replies = b''
        for i in range(120):
            ws = self.ws()
            kind = i % 6
            if kind == 0:
                ws.sock.sendall(rnd.randbytes(rnd.randint(1, 400)))
            elif kind == 1:                                          # masked binary frame with a huge declared length
                ws.sock.sendall(bytes((0x82, 0xFF)) + rnd.randbytes(8) + rnd.randbytes(4))
            elif kind == 2:                                          # random bytes as a masked text frame
                ws.send_frame(0x1, rnd.randbytes(rnd.randint(0, 300)))
            elif kind == 3:                                          # a frame cut off in the middle, then a hard reset
                ws.sock.sendall(bytes((0x81, 0x85, 1, 2, 3, 4, 9)))
                ws.sock.setsockopt(socket.SOL_SOCKET, socket.SO_LINGER, struct.pack('ii', 1, 0))
            elif kind == 4:                                          # every opcode and flag combination
                ws.sock.sendall(bytes((rnd.randint(0, 255), 0x80 | rnd.randint(0, 20))) + rnd.randbytes(4 + 20))
            else:
                ws.send_frame(rnd.choice((0x1, 0x2, 0x8, 0x9, 0xA)), rnd.randbytes(rnd.randint(0, 130)), fin=rnd.random() < 0.5)
            ws.sock.settimeout(0.05)
            try:
                replies += ws.sock.recv(4096)
            except OSError:
                pass
            ws.close()
        self.assert_alive()
        for needle in (b'Error', b'.js', b'node_modules', b'stack', b'    at '):
            self.assertNotIn(needle, replies)

    def test_connection_churn_leaves_nothing_behind(self):
        """Hundreds of connections that host, join, are reset or closed cleanly: every room, slot and socket goes away."""
        rnd = random.Random(99)
        for i in range(150):
            h = T.WS(self.port)
            h.send_json({'t': 'host', 'name': f'H{i}'})
            code = h.expect('hosted')['code']
            guests = []
            for _ in range(rnd.randint(0, 3)):
                g = T.WS(self.port)
                g.send_json({'t': 'join', 'code': code, 'name': 'G'})
                g.expect('joined')
                guests.append(g)
            for ws in [h, *guests]:
                how = rnd.choice(('close', 'reset', 'leave', 'clean'))
                if how == 'reset':
                    ws.sock.setsockopt(socket.SOL_SOCKET, socket.SO_LINGER, struct.pack('ii', 1, 0))
                elif how == 'leave':
                    ws.send_json({'t': 'leave'})
                elif how == 'clean':
                    ws.send_close(1000)
                ws.close()

        def settled():
            st = self.relay.stats()
            c = st['counters']
            return (not st['rooms'] and not st['conns'] and st['sockets'] <= 1 and c['connections'] == c['connections_closed']
                    and c['rooms_opened'] == c['rooms_closed'])
        self.assertTrue(T.wait_until(settled, timeout=10), self.relay.stats())
        self.assertEqual(self.relay.counters['internal_errors'], self.errors0)
        self.assert_alive()

    def test_garbage_http_requests(self):
        for raw in (
                b'\x16\x03\x01\x02\x00\x01\x00\x01\xfc\x03\x03' + os.urandom(64),       # a TLS ClientHello
                b'GET / HTTP/9.9\r\n\r\n', b'GET\r\n\r\n', b'\r\n\r\n\r\n', b'GET /ws HTTP/1.1\r\n\r\n',
                b'GET /' + b'a' * 30000 + b' HTTP/1.1\r\nHost: x\r\n\r\n',
                b'GET /api/lan HTTP/1.1\r\nHost: x\r\n' + b''.join(b'H%d: 1\r\n' % i for i in range(300)) + b'\r\n',
                b'POST /api/lan HTTP/1.1\r\nHost: x\r\nContent-Length: 99999999\r\n\r\nabc',
                b'GET /ws HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n'
                b'Sec-WebSocket-Key: ' + b'A' * 300 + b'\r\nSec-WebSocket-Version: 13\r\n\r\n',
                b'GET http://evil.example/api/lan HTTP/1.1\r\nHost: x\r\n\r\n', b'CONNECT evil.example:443 HTTP/1.1\r\n\r\n'):
            s = socket.create_connection(('127.0.0.1', self.port))
            s.settimeout(2)
            try:
                s.sendall(raw)
                got = s.recv(2048)
            except OSError:
                got = b''
            s.close()
            for needle in (b'Error:', b'.js', b'node_modules', b'    at '):
                self.assertNotIn(needle, got, raw[:40])
        self.assert_alive()

    def test_wrongly_typed_fields_never_crash(self):
        values = [None, True, False, 0, -1, 1, 1.5, 255, 10 ** 30, 'x', '', 'BCDF', ' b-c d f ', 'A' * 5000, [], [1], {}, {'a': 1}]
        fields = ['code', 'name', 'token', 'rejoin', 'v', 'max', 'public', 'meta', 'peer', 'reason', 'locked', 'to', 'data',
                  'id', 'c']
        types = ['host', 'join', 'list', 'ping', 'kick', 'lock', 'meta', 'signal', 'nonsense']
        h, code = self.host(v=1)
        a, ja = self.join(code, host=h, v=1)
        alive = {id(h): h, id(a): a}

        def check(ws):
            for m in drain(ws, quiet=0.05):
                if isinstance(m, tuple):                             # kicked (4001) or the room closed (4000): fine
                    if m[0] == 'closed':
                        self.assertIn(m[1], (4000, 4001, 4002), m)
                    alive.pop(id(ws), None)
                elif isinstance(m, dict) and m.get('t') == 'error':
                    self.assertIn(m['reason'], self.KNOWN_REASONS, m)

        sent = 0
        for t in types:
            for field in fields:
                for value in values:
                    msg = {'t': t, field: value}
                    if t in ('join', 'kick', 'signal') and field not in ('code', 'peer', 'to'):
                        msg.update({'code': code, 'peer': ja['peer'], 'to': ja['peer']})
                    for ws in list(alive.values()):
                        try:
                            ws.send_json(msg)
                        except OSError:
                            alive.pop(id(ws), None)
                        sent += 1
                if sent > 150:                                       # read what came back so the sockets never fill
                    sent = 0
                    for ws in (h, a):
                        check(ws)
        for ws in (h, a):
            check(ws)
        self.assertEqual(self.relay.counters['internal_errors'], self.errors0)
        other = self.ws()
        other.send_json({'t': 'ping', 'c': 'fine'})
        self.assertEqual(other.expect('pong')['c'], 'fine')


class FramingStressTests(NodeMixin, T.RelayCase):
    """Frames of every size back to back, cut at arbitrary points by the network: none may be lost, merged or reordered."""

    @staticmethod
    def masked(op, payload, fin=True):
        key = os.urandom(4)
        n = len(payload)
        b0 = (0x80 if fin else 0) | op
        if n < 126:
            head = bytes((b0, 0x80 | n))
        elif n < 65536:
            head = bytes((b0, 0x80 | 126)) + struct.pack('!H', n)
        else:
            head = bytes((b0, 0x80 | 127)) + struct.pack('!Q', n)
        return head + key + netserver.unmask(payload, key)

    def test_back_to_back_frames_of_every_size(self):
        h, code = self.host()
        a, ja = self.join(code, host=h)
        rnd = random.Random(7)
        packets = [bytes([0, 0x10]) + rnd.randbytes(rnd.choice((0, 1, 2, 3, 15, 123, 124, 125, 998, 3998, 19998, 69998)))
                   for _ in range(500)]
        reader = T.Reader(h)
        a.sock.sendall(b''.join(self.masked(0x2, p) for p in packets))      # one big write: the kernel decides the cuts
        T.wait_until(lambda: len(reader.bins) >= len(packets), timeout=30)
        self.assertEqual(len(reader.bins), len(packets))
        for got, want in zip(reader.bins, packets):
            self.assertEqual(got, bytes([ja['peer']]) + want[1:])

    def test_frames_dripped_a_few_bytes_at_a_time(self):
        h, code = self.host()
        a, ja = self.join(code, host=h)
        rnd = random.Random(8)
        packets = [bytes([0, 0x11]) + rnd.randbytes(rnd.choice((0, 5, 120, 300))) for _ in range(12)]
        text = json.dumps({'t': 'ping', 'c': 'drip'}).encode()
        blob = b''.join(self.masked(0x2, p) for p in packets) + self.masked(0x1, text) + self.masked(0x2, packets[0])
        a.sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        for i in range(0, len(blob), 3):
            a.sock.sendall(blob[i:i + 3])
            if i % 30 == 0:
                time.sleep(0.001)
        got = [h.recv_bin() for _ in range(len(packets) + 1)]
        self.assertEqual(got, [bytes([ja['peer']]) + p[1:] for p in packets + [packets[0]]])
        self.assertEqual(a.expect('pong')['c'], 'drip')

    def test_large_fragmented_message_with_binary_and_text_mixed(self):
        h, code = self.host()
        a, ja = self.join(code, host=h)
        body = bytes([0, 0x12]) + os.urandom(300000)
        pieces = [body[i:i + 40000] for i in range(0, len(body), 40000)]
        wire = bytearray()
        for i, piece in enumerate(pieces):
            wire += self.masked(0x2 if i == 0 else 0x0, piece, fin=i == len(pieces) - 1)
            if i == 2:
                wire += self.masked(0x9, b'mid')                              # a ping between the fragments
        a.sock.sendall(bytes(wire))
        self.assertEqual(h.recv_bin(), bytes([ja['peer']]) + body[1:])
        self.assertEqual(a.recv_frame()[1:], (0xA, b'mid'))


# ------------------------------------------------------------------------------------------------ online server

def handshake_status(port, **kw):
    status, _, sock, _ = T.raw_handshake(port, **kw)
    sock.close()
    return status


class HostKeyTests(NodeMixin, T.RelayCase):
    """--host-key-file: only a host request with the key opens a room; joining needs the room code only."""
    KEY = 'Kq7-test-host-key-9Zr'

    @classmethod
    def setUpClass(cls):
        import tempfile
        cls._dir = tempfile.mkdtemp(prefix='kinetic-relay-key-')
        cls.key_file = os.path.join(cls._dir, 'host-key')
        with open(cls.key_file, 'w', encoding='utf-8') as f:
            f.write(cls.KEY + '\n')
        cls.extra_flags = ('--host-key-file', cls.key_file)
        cls.relay_env = {'KINETIC_HOST_KEY': 'from-env'}
        super().setUpClass()

    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        shutil.rmtree(cls._dir, ignore_errors=True)

    def test_hosting_needs_the_key_and_joining_does_not(self):
        rejected0 = self.relay.counters['host_key_rejected']
        h = self.ws()
        h.send_json({'t': 'host', 'name': 'NoKey', 'id': 1})
        m = h.expect('error')
        self.assertEqual((m['reason'], m['re'], m['id']), ('host-key', 'host', 1))
        for wrong in ('nope', self.KEY + 'x', self.KEY[:-1], '', 42, None, ['x'], {'k': 1}, 'k' * 300):
            h.send_json({'t': 'host', 'key': wrong, 'id': 2})
            m = h.expect('error')
            self.assertEqual((m['reason'], m['id']), ('host-key', 2), repr(wrong)[:30])
        self.assertEqual(self.relay.counters['host_key_rejected'] - rejected0, 10)
        self.assertEqual(self.relay.rooms, {})                       # nothing was opened
        h.send_json({'t': 'host', 'key': '  ' + self.KEY + ' ', 'name': 'Keyed', 'id': 3})   # pasted with spaces
        hosted = h.expect('hosted')
        self.assertEqual(hosted['id'], 3)
        code = hosted['code']
        c, j = self.join(code, name='Friend', host=h)                 # no key needed to join
        self.assertEqual(j['code'], code)
        c.send_bin(bytes([0, 0x82, 1, 2]))
        self.assertEqual(h.recv_bin()[0], j['peer'])                 # and the room routes as usual

    def test_the_env_key_is_ignored_when_a_file_is_given(self):
        h = self.ws()
        h.send_json({'t': 'host', 'key': 'from-env'})
        self.assertEqual(h.expect('error')['reason'], 'host-key')


class HostKeyEnvTests(NodeMixin, T.RelayCase):
    relay_env = {'KINETIC_HOST_KEY': 'env-secret'}

    def test_key_from_the_environment(self):
        h = self.ws()
        h.send_json({'t': 'host'})
        self.assertEqual(h.expect('error')['reason'], 'host-key')
        h.send_json({'t': 'host', 'key': 'env-secret'})
        h.expect('hosted')


class HostKeyRateTests(NodeMixin, T.RelayCase):
    """A wrong key costs a host/join token: the key cannot be brute-forced."""
    relay_env = {'KINETIC_HOST_KEY': 'right'}
    extra_flags = ('--join-rate', '3', '--join-window', '60')

    def test_guesses_are_rate_limited(self):
        h = self.ws()
        for _ in range(3):
            h.send_json({'t': 'host', 'key': 'guess'})
            self.assertEqual(h.expect('error')['reason'], 'host-key')
        h.send_json({'t': 'host', 'key': 'right'})                  # even the right key waits now
        self.assertEqual(h.expect('error')['reason'], 'rate-limited')


class NoKeyTests(NodeMixin, T.RelayCase):
    """Without a host key (the desktop app's own server) a key in the request changes nothing."""

    def test_hosting_is_open(self):
        h = self.ws()
        h.send_json({'t': 'host', 'key': 'anything'})
        h.expect('hosted')


class ProxyTests(NodeMixin, T.RelayCase):
    """--trust-proxy: a connection from this machine is the player named in X-Forwarded-For (Caddy on the server)."""
    extra_flags = ('--trust-proxy', '--max-conns-per-ip', '2', '--join-rate', '3', '--join-window', '60')

    @staticmethod
    def fwd(ip):
        return [f'X-Forwarded-For: {ip}']

    def test_per_ip_cap_counts_forwarded_addresses(self):
        a = [self.ws(extra=self.fwd('203.0.113.5')) for _ in range(2)]
        limit0 = self.relay.counters['ip_limit']
        self.assertEqual(handshake_status(self.port, extra=self.fwd('203.0.113.5')), 429)
        self.assertEqual(handshake_status(self.port, extra=self.fwd('198.51.100.1, 203.0.113.5')), 429)   # spoofed prefix
        self.assertEqual(self.relay.counters['ip_limit'] - limit0, 2)
        b = [self.ws(extra=self.fwd('203.0.113.6')) for _ in range(2)]       # another player behind the same proxy
        self.assertEqual(handshake_status(self.port, extra=self.fwd('203.0.113.6')), 429)
        self.assertEqual(len(b), 2)
        a.pop().close()                                                    # a closed one frees its place
        status = 0
        for _ in range(100):
            status = handshake_status(self.port, extra=self.fwd('203.0.113.5'))
            if status == 101:
                break
            time.sleep(0.05)
        self.assertEqual(status, 101)

    def test_the_host_sees_the_forwarded_address(self):
        h = self.ws(extra=self.fwd('203.0.113.20'))
        h.send_json({'t': 'host'})
        code = h.expect('hosted')['code']
        c = self.ws(extra=self.fwd('198.51.100.7, [2001:db8::42]:51000'))
        c.send_json({'t': 'join', 'code': code, 'name': 'Far'})
        c.expect('joined')
        self.assertEqual(h.expect('peer-join')['addr'], '2001:db8::42')

    def test_join_rate_is_per_forwarded_address(self):
        h = self.ws(extra=self.fwd('203.0.113.30'))
        h.send_json({'t': 'host'})
        code = h.expect('hosted')['code']
        wrong = 'ZZZZ' if code != 'ZZZZ' else 'ZZZX'
        g = self.ws(extra=self.fwd('203.0.113.31'))
        for _ in range(3):
            g.send_json({'t': 'join', 'code': wrong, 'name': 'x'})
            self.assertEqual(g.expect('error')['reason'], 'no-such-room')
        g.send_json({'t': 'join', 'code': code, 'name': 'x'})
        self.assertEqual(g.expect('error')['reason'], 'rate-limited')
        other = self.ws(extra=self.fwd('203.0.113.32'))                   # someone else is not affected
        other.send_json({'t': 'join', 'code': code, 'name': 'y'})
        other.expect('joined')

    def test_without_a_forwarded_address_the_socket_address_counts(self):
        # a tool on the server itself (no proxy in between) is 127.0.0.1 and not capped as the proxy is
        socks = [self.ws() for _ in range(3)]
        self.assertEqual(len(socks), 3)


class NoProxyTests(NodeMixin, T.RelayCase):
    """Without --trust-proxy a forged X-Forwarded-For is ignored."""
    extra_flags = ('--max-conns-per-ip', '2')

    def test_forwarded_header_is_ignored(self):
        h = self.ws(extra=['X-Forwarded-For: 203.0.113.50'])
        h.send_json({'t': 'host'})
        code = h.expect('hosted')['code']
        c = self.ws(extra=['X-Forwarded-For: 203.0.113.51'])
        c.send_json({'t': 'join', 'code': code, 'name': 'x'})
        c.expect('joined')
        self.assertEqual(h.expect('peer-join')['addr'], '127.0.0.1')
        self.assertEqual(handshake_status(self.port, extra=['X-Forwarded-For: 203.0.113.52']), 429)   # same TCP address


class OnlineListTests(NodeMixin, T.RelayCase):
    """--no-room-list / --no-lan-info / --allow-host: what a server on the internet hands out."""
    extra_flags = ('--no-room-list', '--no-lan-info', '--allow-host', 'play.example.com')

    def test_rooms_are_not_listed_but_can_be_joined(self):
        h, code = self.host(name='Hidden', public=True)
        status, body = T.http_get(self.port, '/api/rooms')
        self.assertEqual(status, 200)
        data = json.loads(body)
        self.assertEqual((data['rooms'], data['listed']), ([], False))
        c = self.ws()
        c.send_json({'t': 'list'})
        m = c.expect('rooms')
        self.assertEqual((m['rooms'], m['listed']), ([], False))
        c.send_json({'t': 'join', 'code': code, 'name': 'ByCode'})
        c.expect('joined')
        h.expect('peer-join')

    def test_no_lan_info(self):
        self.assertEqual(T.http_get(self.port, '/api/lan')[0], 404)

    def test_the_servers_domain_may_read_the_api(self):
        status, _, body = http_request(self.port, '/api/rooms', headers={'Host': 'play.example.com'})
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)['listed'], False)
        self.assertEqual(http_request(self.port, '/api/rooms', headers={'Host': 'evil.example'})[0], 403)


class ListedTests(NodeMixin, T.RelayCase):
    def test_listed_flag(self):
        self.host(name='Open', public=True)
        data = json.loads(T.http_get(self.port, '/api/rooms')[1])
        self.assertEqual(data['listed'], True)
        self.assertEqual(len(data['rooms']), 1)


class ShutdownTests(unittest.TestCase):
    def check_shutdown(self, trigger):
        if NODE is None:
            self.skipTest('node is not on PATH')
        proc = RelayProc(*NodeMixin.base_flags)
        clients = []
        try:
            h = T.WS(proc.port)
            clients.append(h)
            h.send_json({'t': 'host'})
            code = h.expect('hosted')['code']
            a = T.WS(proc.port)
            clients.append(a)
            a.send_json({'t': 'join', 'code': code, 'name': 'A'})
            a.expect('joined')
            h.expect('peer-join')
            trigger(proc)
            try:
                first = h.expect_close(timeout=3)
            except OSError:
                if proc.proc.poll() is None:
                    self.skipTest('the break signal was not delivered (no console?)')
                raise
            self.assertEqual(first, (1001, 'server stopping'))
            self.assertEqual(a.expect_close()[0], 1001)
            self.assertEqual(proc.proc.wait(10), 0)
        finally:
            for c in clients:
                c.close()
            proc.stop()

    def test_shutdown_closes_every_connection_with_1001_and_exits_cleanly(self):
        self.check_shutdown(lambda proc: proc.command('shutdown'))       # the same stop() the signal handlers call

    def test_break_signal_does_the_same(self):
        """Ctrl+Break / SIGTERM; skipped where the environment has no console to deliver it."""
        def send(proc):
            if not proc.interrupt():
                self.skipTest('this environment cannot send Ctrl+Break / SIGTERM to a child')
        self.check_shutdown(send)


class LoggingTests(unittest.TestCase):
    def test_room_events_reach_the_console_from_the_logger_thread(self):
        if NODE is None:
            self.skipTest('node is not on PATH')
        proc = RelayProc(*NodeMixin.base_flags, quiet=False)
        clients = []
        try:
            h = T.WS(proc.port)
            clients.append(h)
            h.send_json({'t': 'host', 'name': 'Logged'})
            code = h.expect('hosted')['code']
            a = T.WS(proc.port)
            clients.append(a)
            a.send_json({'t': 'join', 'code': code, 'name': 'Joiner'})
            a.expect('joined')
            a.close()
            h.close()
            for text in (f'room {code} opened by 127.0.0.1 (Logged, max 8)', f'room {code}: Joiner joined as peer 1 from 127.0.0.1',
                         f'room {code}: Joiner (peer 1) left: disconnected - slot reserved', f'room {code} closed (host-left)'):
                self.assertTrue(T.wait_until(lambda: any(text in line for line in proc.out), timeout=5), (text, proc.out))
            self.assertTrue(all(re.match(r'\[\d\d:\d\d:\d\d\] ', line) for line in proc.out if 'room ' in line))
        finally:
            for c in clients:
                c.close()
            proc.stop()


class JsUnitTests(unittest.TestCase):
    def test_node_unit_tests(self):
        """Pure helpers of relay.js (address ranking, code and text handling, JSON rules, option parsing)."""
        if NODE is None:
            self.skipTest('node is not on PATH')
        r = subprocess.run([NODE, '--test', os.path.join(TOOLS, 'test_relay_units.js')], capture_output=True, text=True,
                           encoding='utf-8', errors='replace', cwd=ROOT, timeout=120)
        self.assertEqual(r.returncode, 0, r.stdout[-6000:] + r.stderr[-2000:])


if __name__ == '__main__':
    unittest.main()

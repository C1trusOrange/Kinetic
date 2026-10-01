#!/usr/bin/env python3
"""KINETIC multiplayer relay: an RFC 6455 WebSocket hub with room codes (Python stdlib only).

tools/serve.py mounts it on the same port as the static game files:

    GET /ws          WebSocket upgrade (the page's Origin must match the Host header, else 403; 503 while
                     max_conns (500) WebSockets are open)
    GET /api/lan     {app, relay, hostname, port, lan, bind, ips, urls, hostUrl}  LAN addresses for invites
    GET /api/rooms   {rooms: [{code, name, players, max, locked, meta, v}]}       open public rooms
    GET /api/stats   relay counters, every room and queue state (no names, no tokens); this PC only

Threads: the HTTP handler thread validates the upgrade request and sends the 101 response, then
hands the socket to the relay's ONE selectors-loop thread (Relay.adopt). That thread owns every
WebSocket from then on: frame parsing, room logic, routing and non-blocking writes, with no locks
on the send path (measured: 10-14 % of one core for 8 clients at 30 Hz x 1.5 KB snapshots; relay
residence p50 ~135 us).

Wire contract (browser side: src/net/protocol.js, src/net/WsRelayTransport.js)
  Text frames = JSON control plane between a peer and the relay. Requests may carry an `id`,
  which is echoed in the reply.
    peer -> relay: {t:'host', v, name, max, public, code?, meta?}   create a room, become peer 0
                   {t:'join', v, code, name, token?, rejoin?}       join (token = reclaim your slot; rejoin:true =
                                                                    only reclaim it, else error slot-lost)
                   {t:'leave'}  {t:'list'}  {t:'ping', c}
                   {t:'kick', peer, reason?}  {t:'lock', locked}  {t:'meta', meta}      (host only)
                   {t:'signal', to, data}                           opaque, for a later WebRTC transport
    relay -> peer: {t:'hosted', code, peer:0, max}  {t:'joined', code, peer, token, rejoin, room}
                   {t:'peer-join', peer, name, addr, rejoin}        (host only)
                   {t:'peer-leave', peer, reason, reserved}         (host only; reserved = slot kept for a rejoin)
                   {t:'room-closed', code, reason}  {t:'left', code}  {t:'rooms', rooms}
                   {t:'pong', c, s}  {t:'signal', from, data}  {t:'ok', re}
                   {t:'error', reason, re}  reason: no-such-room | room-full | room-locked | already-in-room |
                       not-in-room | not-host | no-such-peer | version-mismatch | bad-code | code-taken |
                       server-full | slot-lost | bad-message
  Binary frames = data plane, routed blindly by a 2-byte header:
    byte0 = routing. A client's packet goes to the host with byte0 rewritten to the sender's peer id
            (1..254). The host addresses one client (1..254) or all clients (255); forwarded unchanged.
    byte1 = packet type. Types >= 0x80 are latest-wins: while a receiver's socket is backed up, an
            unsent packet of the same (sender, type) is replaced by the newer one (snapshots never
            queue up). While backed up, queued reliable packets go out first and the newest latest-wins
            packets follow once the socket drains, so a reliable packet can overtake an older
            latest-wins one (never the reverse). Otherwise everything arrives in send order.
  Close codes: 1000 normal, 1001 idle timeout / server stopping, 1002 protocol error, 1007 invalid
  UTF-8, 1009 message > 1 MiB, 1011 relay error, 1013 slow consumer (> 2 MiB queued),
  4000 room closed (host left), 4001 kicked, 4002 replaced by a rejoin with the same token.

Rooms: 4-letter codes from BCDFGHJKLMNPQRSTVWXZ (20 consonants: no words, no I/O vs 1/0 mix-ups,
160,000 codes) drawn with `secrets`; the host is peer 0, clients get the lowest free id 1..254.
Joining returns a reconnect token (secrets.token_urlsafe); a peer that drops without {t:'leave'}
keeps its slot for `reserve_timeout` seconds and a join with its token reclaims the same id
(even in a locked room). The room closes when the host leaves or disconnects.
"""
import base64
import binascii
import collections
import hashlib
import ipaddress
import itertools
import json
import math
import queue
import secrets
import selectors
import socket
import struct
import sys
import threading
import time
import traceback
from urllib.parse import urlsplit

RELAY_VERSION = 1
WS_PATH = '/ws'
WS_GUID = b'258EAFA5-E914-47DA-95CA-C5AB0DC85B11'

CODE_ALPHABET = 'BCDFGHJKLMNPQRSTVWXZ'
CODE_LEN = 4
HOST_PEER = 0
BROADCAST = 255
MAX_CLIENT_PEER = 254
LATEST_WINS_MIN_TYPE = 0x80

CLOSE_NORMAL = 1000
CLOSE_GOING_AWAY = 1001
CLOSE_PROTOCOL_ERROR = 1002
CLOSE_INVALID_DATA = 1007
CLOSE_TOO_BIG = 1009
CLOSE_INTERNAL_ERROR = 1011
CLOSE_TRY_AGAIN_LATER = 1013
CLOSE_ROOM_CLOSED = 4000
CLOSE_KICKED = 4001
CLOSE_REPLACED = 4002

OP_CONT, OP_TEXT, OP_BIN, OP_CLOSE, OP_PING, OP_PONG = 0x0, 0x1, 0x2, 0x8, 0x9, 0xA

DEFAULTS = {
    'ping_interval': 5.0,      # s between server pings (browsers answer them automatically)
    'idle_timeout': 15.0,      # s without any received byte -> close 1001
    'stall_timeout': 15.0,     # s with queued output and no send progress -> drop (frozen tab, dead Wi-Fi)
    'close_timeout': 1.0,      # s to wait for the peer's close echo
    'reserve_timeout': 60.0,   # s a dropped client's slot stays reserved for its token
    'max_message': 1 << 20,    # bytes per (reassembled) message -> close 1009
    'max_backlog': 2 << 20,    # bytes queued for one receiver -> close 1013
    'max_rooms': 256,
    'max_room_peers': 255,     # host + 254 clients
    # open WebSockets -> 503. On Windows the loop's select() takes at most 512 sockets; one more and it raises on every
    # iteration, so every room stops (even after the extra sockets close). A page that leaks sockets could get there.
    'max_conns': 500,
}

# peer-leave reasons that keep the slot reserved for a rejoin with the token
RESERVED_REASONS = frozenset(('closed', 'disconnected', 'timeout', 'stalled', 'slow', 'protocol', 'error', 'replaced'))
COUNTERS = ('connections', 'connections_closed', 'handshake_rejected', 'bad_origin', 'rooms_opened', 'rooms_closed',
            'joins', 'rejoins', 'messages_in', 'fragments', 'control_in', 'packets_routed', 'packets_dropped',
            'frames_out', 'bytes_in', 'bytes_out', 'conflated', 'slow_consumers', 'stalled', 'idle_timeouts',
            'protocol_errors', 'internal_errors', 'kicks', 'expired', 'conn_limit')

_PING_FRAME = bytes((0x80 | OP_PING, 0))
_SEND_BATCH = 256 * 1024
_TIMER_STEP = 0.05


class ProtocolError(Exception):
    """A peer violated RFC 6455 or a relay limit; the connection is closed with `code`."""

    def __init__(self, code, reason):
        super().__init__(reason)
        self.code = code
        self.reason = reason


def encode_frame(op, payload=b''):
    """One unmasked server->client frame (FIN set)."""
    n = len(payload)
    if n < 126:
        head = bytes((0x80 | op, n))
    elif n < 65536:
        head = struct.pack('!BBH', 0x80 | op, 126, n)
    else:
        head = struct.pack('!BBQ', 0x80 | op, 127, n)
    return head + payload


def _frame_header(op, n):
    if n < 126:
        return bytes((0x80 | op, n))
    if n < 65536:
        return struct.pack('!BBH', 0x80 | op, 126, n)
    return struct.pack('!BBQ', 0x80 | op, 127, n)


def encode_close(code=CLOSE_NORMAL, reason=''):
    """Close frame payload: status code + UTF-8 reason (control frames carry <= 125 bytes)."""
    raw = reason.encode('utf-8')[:123]
    while raw:
        try:
            raw.decode('utf-8')
            break
        except UnicodeDecodeError:
            raw = raw[:-1]            # never cut a multi-byte character in half
    return encode_frame(OP_CLOSE, struct.pack('!H', code) + raw)


def unmask(data, mask):
    """XOR-unmask a client payload (RFC 6455 5.3). Big-int XOR runs in C (~1 us per KB)."""
    n = len(data)
    if not n:
        return b''
    key = int.from_bytes((mask * ((n >> 2) + 1))[:n], 'little')
    return (int.from_bytes(data, 'little') ^ key).to_bytes(n, 'little')


def valid_close_code(code):
    """Close codes a peer may send (RFC 6455 7.4)."""
    return code in (1000, 1001, 1002, 1003, 1007, 1008, 1009, 1010, 1011, 1012, 1013, 1014) or 3000 <= code <= 4999


def normalize_code(value):
    """Room code as typed by a player: case-insensitive, spaces / dashes ignored."""
    if not isinstance(value, str):
        return ''
    return ''.join(ch for ch in value.upper() if ch.isalnum())


def valid_code(code):
    return len(code) == CODE_LEN and all(ch in CODE_ALPHABET for ch in code)


def new_code(taken=()):
    """A fresh random room code not in `taken`."""
    for _ in range(10000):
        code = ''.join(secrets.choice(CODE_ALPHABET) for _ in range(CODE_LEN))
        if code not in taken:
            return code
    raise RuntimeError('room code space exhausted')


def clean_text(value, fallback, limit):
    """Printable, whitespace-collapsed, length-limited text (player / room names, reasons)."""
    if not isinstance(value, str):
        return fallback
    s = ' '.join(''.join(ch if ch.isprintable() else ' ' for ch in value).split())
    return s[:limit] or fallback


def _request_id(msg):
    rid = msg.get('id')
    if isinstance(rid, bool) or not isinstance(rid, (int, str)):
        return None
    if isinstance(rid, str) and len(rid) > 64:
        return None
    return rid


def _json_frame(obj):
    # ensure_ascii: strings from peers may hold a lone UTF-16 surrogate (a browser's JSON.stringify escapes one, e.g. a
    # name cut in the middle of an emoji); as an escape it round-trips, as raw text it cannot be encoded to UTF-8
    return encode_frame(OP_TEXT, json.dumps(obj, separators=(',', ':')).encode('ascii'))


def _reject_json_constant(name):
    raise ValueError(f'{name} is not JSON')


def _finite_float(text):
    value = float(text)
    if not math.isfinite(value):                     # 1e999: would turn into inf, which int() and browsers reject
        raise ValueError('number out of range')
    return value


def parse_control(text):
    """A control message as the browser's JSON.parse would read it: NaN / Infinity / out-of-range numbers are refused
    (a host's meta must never make /api/rooms unreadable for everyone). Raises ValueError for anything malformed."""
    try:
        return json.loads(text, parse_constant=_reject_json_constant, parse_float=_finite_float)
    except RecursionError:                           # absurdly deep nesting
        raise ValueError('nested too deeply') from None


class ConsoleLog:
    """Callable that prints lines from its own thread, so the relay loop never waits for the console.

    A Windows console in QuickEdit mode blocks every write while the user has text selected (say, to copy
    the Friends address). A relay loop printing a join message then stalls, and so does every match on it."""

    def __init__(self, stream=None, prefix_time=False):
        self._stream = stream
        self._prefix_time = prefix_time
        self._q = queue.SimpleQueue()
        threading.Thread(target=self._run, name='kinetic-console', daemon=True).start()

    def __call__(self, text):
        if self._prefix_time:
            text = time.strftime('[%H:%M:%S] ') + text
        self._q.put(text)

    def _run(self):
        while True:
            text = self._q.get()
            try:
                print(text, file=self._stream or sys.stdout, flush=True)
            except (OSError, ValueError):
                pass                                     # console gone (window closed): nothing to report to


# ------------------------------------------------------------------------------------------------ LAN info

def rank_ipv4s(candidates):
    """Usable LAN IPv4 addresses in discovery order, private (RFC 1918) ones first; drops loopback,
    link-local (169.254/16, i.e. no DHCP lease), unspecified, multicast and malformed entries."""
    private, other = [], []
    for ip in candidates:
        try:
            a = ipaddress.IPv4Address(ip)
        except (ipaddress.AddressValueError, ValueError):
            continue
        if a.is_loopback or a.is_link_local or a.is_unspecified or a.is_multicast or a.is_reserved:
            continue
        s = str(a)
        if s in private or s in other:
            continue
        (private if a.is_private else other).append(s)
    return private + other


def lan_ipv4s():
    """Best-effort LAN IPv4 list, the default-route interface first. No packet is sent: connect() on
    a UDP socket only selects a route."""
    found = []
    for probe in ('8.8.8.8', '192.168.255.255', '10.255.255.255', '172.31.255.255'):
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            s.connect((probe, 9))
            found.append(s.getsockname()[0])
        except OSError:
            pass
        finally:
            s.close()
    try:
        found += socket.gethostbyname_ex(socket.gethostname())[2]
    except OSError:
        pass
    return rank_ipv4s(found)


def is_loopback(host):
    try:
        return ipaddress.ip_address(host.split('%', 1)[0]).is_loopback
    except ValueError:
        return host == 'localhost'


_lan_cache = {'t': -1e9, 'ips': []}


def lan_info(bind_host, port):
    """Payload of GET /api/lan (the address list is cached for 10 s)."""
    now = time.monotonic()
    if now - _lan_cache['t'] > 10.0:
        _lan_cache['ips'] = lan_ipv4s()
        _lan_cache['t'] = now
    ips = list(_lan_cache['ips'])
    hostname = socket.gethostname()
    return {
        'app': 'kinetic', 'relay': RELAY_VERSION, 'hostname': hostname, 'port': port,
        'lan': not is_loopback(bind_host), 'bind': bind_host, 'ips': ips,
        'urls': [f'http://{ip}:{port}' for ip in ips], 'hostUrl': f'http://{hostname}:{port}',
    }


def _http_json(h, obj, status=200):
    body = json.dumps(obj).encode('utf-8')
    h.send_response(status)
    h.send_header('Content-Type', 'application/json; charset=utf-8')
    h.send_header('Content-Length', str(len(body)))
    h.end_headers()
    if h.command != 'HEAD':
        h.wfile.write(body)


def _http_reject(h, status, extra=None):
    h.send_response(status)
    for k, v in (extra or {}).items():
        h.send_header(k, v)
    h.send_header('Content-Length', '0')
    h.send_header('Connection', 'close')
    h.end_headers()
    h.close_connection = True


def _header_tokens(value):
    return {t.strip().lower() for t in (value or '').split(',') if t.strip()}


# ------------------------------------------------------------------------------------------------ rooms

class _Slot:
    __slots__ = ('peer', 'token', 'name', 'conn', 'addr', 'expires')

    def __init__(self, peer, token, name, conn, addr):
        self.peer = peer
        self.token = token
        self.name = name
        self.conn = conn
        self.addr = addr
        self.expires = None


class _Room:
    __slots__ = ('code', 'name', 'host', 'max_peers', 'public', 'locked', 'meta', 'v', 'slots', 'tokens', 'created')

    def __init__(self, code, name, host, max_peers, public, v):
        self.code = code
        self.name = name
        self.host = host
        self.max_peers = max_peers
        self.public = public
        self.locked = False
        self.meta = {}
        self.v = v
        self.slots = {}               # client peer id -> _Slot (connected or reserved)
        self.tokens = {}              # reconnect token -> _Slot
        self.created = time.time()

    def info(self):
        connected = sum(1 for s in self.slots.values() if s.conn is not None)
        return {'code': self.code, 'name': self.name, 'players': 1 + connected, 'max': self.max_peers,
                'locked': self.locked, 'meta': self.meta, 'v': self.v}


class _Conn:
    __slots__ = ('sock', 'addr', 'inbuf', 'q', 'q_bytes', 'head_off', 'latest', 'latest_bytes', 'blocked',
                 'want_write', 'close_sent', 'close_recv', 'close_deadline', 'finish', 'dead', 'last_rx',
                 'last_progress', 'next_ping', 'room', 'peer', 'name', 'frag_op', 'frag', 'frag_len')

    def __init__(self, sock, addr, now, ping_interval):
        self.sock = sock
        self.addr = addr
        self.inbuf = bytearray()
        self.q = collections.deque()  # encoded frames, oldest first
        self.q_bytes = 0
        self.head_off = 0             # bytes of q[0] already written
        self.latest = {}              # latest-wins slots: (sender << 8 | type) -> frame
        self.latest_bytes = 0
        self.blocked = False          # the last flush could not write everything
        self.want_write = False
        self.close_sent = False
        self.close_recv = False
        self.close_deadline = 0.0
        self.finish = False           # drop once the queue is flushed
        self.dead = False
        self.last_rx = now
        self.last_progress = now
        self.next_ping = now + ping_interval
        self.room = None
        self.peer = -1
        self.name = ''
        self.frag_op = 0
        self.frag = []
        self.frag_len = 0


# ------------------------------------------------------------------------------------------------ relay

class Relay:
    """WebSocket hub + room registry. All connection state lives on one loop thread.

    `log(text)` receives room events (None = silent) and `error_log(text)` internal errors (default:
    stderr). Both are called on the loop thread, so they must not block: wrap console output in ConsoleLog.
    Options (seconds / bytes / counts): see DEFAULTS."""

    def __init__(self, log=None, error_log=None, **config):
        for k, v in DEFAULTS.items():
            setattr(self, k, config.pop(k, v))
        if config:
            raise TypeError('unknown relay option(s): ' + ', '.join(sorted(config)))
        self.log = log                               # callable(str) for room events, or None
        self.error_log = error_log                   # callable(str) for internal errors, or None = stderr
        self.lock = threading.Lock()                 # guards rooms/slots structure + conns for other threads
        self.rooms = {}
        self.conns = set()
        self.counters = dict.fromkeys(COUNTERS, 0)   # fixed keys: safe to copy from other threads
        self._pending = collections.deque()
        self._dirty = set()
        self._sel = selectors.DefaultSelector()
        self._wake_r, self._wake_w = socket.socketpair()
        self._wake_r.setblocking(False)
        self._wake_w.setblocking(False)
        self._sel.register(self._wake_r, selectors.EVENT_READ, None)
        self._stopping = False
        self._next_timers = 0.0
        self._handlers = {
            'host': self._ctl_host, 'join': self._ctl_join, 'leave': self._ctl_leave, 'list': self._ctl_list,
            'ping': self._ctl_ping, 'kick': self._ctl_kick, 'lock': self._ctl_lock, 'meta': self._ctl_meta,
            'signal': self._ctl_signal,
        }
        self._thread = threading.Thread(target=self._run, name='kinetic-relay', daemon=True)
        self._thread.start()

    # ---------------------------------------------------------------- public (any thread)

    def handle_http(self, h, path, trusted=True):
        """Serve /ws (GET) and /api/* (GET, HEAD) for tools/serve.py's request handler `h`. `trusted` = the
        request comes from this PC (or the server only listens on loopback): /api/stats lists private rooms."""
        if path == WS_PATH:
            if h.command != 'GET':
                return _http_reject(h, 405, {'Allow': 'GET'})
            return self._upgrade(h)
        if path == '/api/lan':
            host, port = h.server.server_address[:2]
            return _http_json(h, lan_info(host, port))
        if path == '/api/rooms':
            return _http_json(h, {'relay': RELAY_VERSION, 'rooms': self.public_rooms()})
        if path == '/api/stats' and trusted:
            return _http_json(h, self.stats())
        return _http_json(h, {'error': 'not-found'}, 404)

    def adopt(self, sock, addr, initial=b''):
        """Take over an upgraded socket (called from the HTTP thread after the 101 was sent)."""
        if self._stopping:
            try:
                sock.close()
            except OSError:
                pass
            return
        self._pending.append((sock, addr, initial))
        self._wake()

    def public_rooms(self):
        with self.lock:
            return [r.info() for r in self.rooms.values() if r.public and not r.locked]

    def stats(self):
        """Counters, rooms and per-connection queue state (safe from any thread; no names or tokens)."""
        with self.lock:
            rooms = [r.info() for r in self.rooms.values()]
            conns = []
            for c in self.conns:
                room = c.room
                conns.append({'peer': c.peer, 'room': room.code if room is not None else None, 'queued': c.q_bytes,
                              'latest': len(c.latest), 'blocked': c.blocked})
        return {'relay': RELAY_VERSION, 'counters': dict(self.counters), 'rooms': rooms, 'conns': conns,
                'cpu': time.process_time()}

    def stop(self):
        """Close every connection (1001) and end the loop thread. Idempotent."""
        if self._stopping:
            return
        self._stopping = True
        self._wake()
        if threading.current_thread() is not self._thread:
            self._thread.join(3.0)

    # ---------------------------------------------------------------- handshake (HTTP thread)

    def _count(self, key):
        with self.lock:
            self.counters[key] += 1

    def _upgrade(self, h):
        hd = h.headers
        if h.request_version != 'HTTP/1.1':
            self._count('handshake_rejected')
            return _http_reject(h, 400)
        if 'websocket' not in _header_tokens(hd.get('Upgrade')) or 'upgrade' not in _header_tokens(hd.get('Connection')):
            self._count('handshake_rejected')
            return _http_reject(h, 400)
        if (hd.get('Sec-WebSocket-Version') or '').strip() != '13':
            self._count('handshake_rejected')
            return _http_reject(h, 426, {'Sec-WebSocket-Version': '13'})
        key = (hd.get('Sec-WebSocket-Key') or '').strip()
        try:
            key_ok = len(base64.b64decode(key, validate=True)) == 16
        except (binascii.Error, ValueError):
            key_ok = False
        host = (hd.get('Host') or '').strip().lower()
        if not key_ok or not host:
            self._count('handshake_rejected')
            return _http_reject(h, 400)
        origin = hd.get('Origin')
        if origin is not None and urlsplit(origin.strip()).netloc.lower() != host:
            # cross-site WebSocket hijacking guard: only pages served by this server may connect
            self._count('bad_origin')
            return _http_reject(h, 403)
        handed = getattr(h.server, 'handed_off', None)
        if handed is None or self._stopping:
            # the server would close the socket after this request (it is not a tools/serve.py server)
            return _http_reject(h, 503)
        if len(self.conns) + len(self._pending) >= self.max_conns:
            self._count('conn_limit')
            return _http_reject(h, 503)
        accept = base64.b64encode(hashlib.sha1(key.encode('ascii') + WS_GUID).digest()).decode('ascii')
        h.protocol_version = 'HTTP/1.1'              # the 101 must be an HTTP/1.1 status line
        h.send_response(101, 'Switching Protocols')
        h.send_header('Upgrade', 'websocket')
        h.send_header('Connection', 'Upgrade')
        h.send_header('Sec-WebSocket-Accept', accept)
        # no Sec-WebSocket-Extensions: permessage-deflate is declined, so RSV bits must stay 0
        h.end_headers()
        h.wfile.flush()
        h.close_connection = True
        sock = h.connection
        try:
            sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)   # no Nagle + delayed-ACK stalls
        except OSError:
            pass
        sock.setblocking(False)
        try:
            # frames the HTTP parser already buffered: read1() without a size returns ALL of them (the reader holds up
            # to io.DEFAULT_BUFFER_SIZE, 128 KiB on Python 3.14; whatever stayed behind would be lost with it)
            initial = h.rfile.read1() or b''
        except (OSError, ValueError):
            initial = b''
        handed.add(sock)                             # the server must not close it after the request
        self.adopt(sock, h.client_address, initial)

    # ---------------------------------------------------------------- loop thread

    def _wake(self):
        try:
            self._wake_w.send(b'\0')
        except OSError:
            pass

    def _run(self):
        while not self._stopping:
            try:
                events = self._sel.select(_TIMER_STEP if self.conns else None)
                for key, mask in events:
                    c = key.data
                    if c is None:
                        self._on_wake()
                        continue
                    if c.dead:
                        continue
                    try:
                        if mask & selectors.EVENT_READ:
                            self._on_readable(c)
                        if mask & selectors.EVENT_WRITE and not c.dead:
                            self._dirty.add(c)
                    except Exception:  # noqa: BLE001 - one broken connection must not kill the relay
                        self._internal_error(c)
                now = time.monotonic()
                if now >= self._next_timers:
                    self._next_timers = now + _TIMER_STEP
                    self._timers(now)
                self._flush_dirty()
            except Exception:  # noqa: BLE001
                self.counters['internal_errors'] += 1
                self._report_error('[relay] internal error in the loop:\n' + traceback.format_exc())
                time.sleep(0.01)
        self._shutdown_all()

    def _report_error(self, text):
        sink = self.error_log
        if sink is not None:
            try:
                sink(text.rstrip())
                return
            except Exception:  # noqa: BLE001 - fall back to stderr below
                pass
        print(text.rstrip(), file=sys.stderr, flush=True)

    def _internal_error(self, c):
        self.counters['internal_errors'] += 1
        self._report_error('[relay] internal error (connection dropped):\n' + traceback.format_exc())
        try:
            self._close(c, CLOSE_INTERNAL_ERROR, 'relay error', 'error')
        except Exception:  # noqa: BLE001
            self._drop(c, 'error')

    def _on_wake(self):
        try:
            while self._wake_r.recv(4096):
                pass
        except (BlockingIOError, InterruptedError):
            pass
        except OSError:
            pass
        now = time.monotonic()
        while self._pending:
            sock, addr, initial = self._pending.popleft()
            if len(self.conns) >= self.max_conns:        # safety net behind the check in _upgrade (concurrent handshakes)
                self._count('conn_limit')
                try:
                    sock.close()
                except OSError:
                    pass
                continue
            c = _Conn(sock, addr, now, self.ping_interval)
            try:
                self._sel.register(sock, selectors.EVENT_READ, c)
            except (OSError, ValueError):
                try:
                    sock.close()
                except OSError:
                    pass
                continue
            with self.lock:
                self.conns.add(c)
                self.counters['connections'] += 1
            if initial:
                try:
                    self._on_data(c, initial)
                except Exception:  # noqa: BLE001 - like a readable event in _run: drop this connection, not the rest
                    self._internal_error(c)

    def _shutdown_all(self):
        while self._pending:
            try:
                self._pending.popleft()[0].close()
            except OSError:
                pass
        for c in list(self.conns):
            if c.dead:
                continue
            try:
                if not c.close_sent:
                    c.sock.send(encode_close(CLOSE_GOING_AWAY, 'server stopping'))
            except OSError:
                pass
            self._drop(c, 'disconnected')
        for s in (self._wake_r, self._wake_w):
            try:
                s.close()
            except OSError:
                pass
        try:
            self._sel.close()
        except OSError:
            pass

    def _on_readable(self, c):
        try:
            chunk = c.sock.recv(262144)
        except (BlockingIOError, InterruptedError):
            return
        except OSError:
            self._drop(c, 'disconnected')
            return
        if not chunk:
            self._drop(c, 'disconnected')
            return
        self._on_data(c, chunk)

    def _on_data(self, c, chunk):
        c.last_rx = time.monotonic()
        self.counters['bytes_in'] += len(chunk)
        if c.close_recv:
            return                                   # nothing may follow the peer's close frame
        c.inbuf += chunk
        try:
            self._parse(c)
        except ProtocolError as e:
            self.counters['protocol_errors'] += 1
            c.inbuf.clear()
            self._close(c, e.code, e.reason, 'protocol')

    def _parse(self, c):
        buf = c.inbuf
        size = len(buf)
        pos = 0
        max_message = self.max_message
        while size - pos >= 2 and not c.dead and not c.close_recv:
            b0 = buf[pos]
            b1 = buf[pos + 1]
            if b0 & 0x70:
                raise ProtocolError(CLOSE_PROTOCOL_ERROR, 'reserved bits set')
            if not b1 & 0x80:
                raise ProtocolError(CLOSE_PROTOCOL_ERROR, 'client frames must be masked')
            op = b0 & 0x0F
            n = b1 & 0x7F
            hl = 2
            if n == 126:
                if size - pos < 4:
                    break
                n = (buf[pos + 2] << 8) | buf[pos + 3]
                hl = 4
            elif n == 127:
                if size - pos < 10:
                    break
                n = int.from_bytes(buf[pos + 2:pos + 10], 'big')
                hl = 10
                if n >> 63:
                    raise ProtocolError(CLOSE_PROTOCOL_ERROR, 'bad frame length')
            if op >= 0x8:
                if n > 125 or not b0 & 0x80:
                    raise ProtocolError(CLOSE_PROTOCOL_ERROR, 'bad control frame')
            elif n > max_message or c.frag_len + n > max_message:
                raise ProtocolError(CLOSE_TOO_BIG, 'message too big')
            end = pos + hl + 4 + n
            if size < end:
                break
            start = pos + hl + 4
            payload = unmask(buf[start:end], bytes(buf[pos + hl:start])) if n else b''
            pos = end
            self._frame(c, b0 & 0x80, op, payload)
        if pos:
            del buf[:pos]

    def _frame(self, c, fin, op, payload):
        if op == OP_PING:                            # browsers never ping; tools may
            if not c.close_sent:
                self._send(c, encode_frame(OP_PONG, payload))
            return
        if op == OP_PONG:
            return
        if op == OP_CLOSE:
            self._on_close_frame(c, payload)
            return
        if c.close_sent:
            return                                   # closing: data frames are discarded
        if op == OP_CONT:
            if not c.frag_op:
                raise ProtocolError(CLOSE_PROTOCOL_ERROR, 'unexpected continuation frame')
            self.counters['fragments'] += 1          # continuation frames (browsers split large messages)
            c.frag.append(payload)
            c.frag_len += len(payload)
            if not fin:
                return
            op = c.frag_op
            payload = b''.join(c.frag)
            c.frag_op = 0
            c.frag = []
            c.frag_len = 0
        elif op == OP_TEXT or op == OP_BIN:
            if c.frag_op:
                raise ProtocolError(CLOSE_PROTOCOL_ERROR, 'expected a continuation frame')
            if not fin:
                c.frag_op = op
                c.frag = [payload]
                c.frag_len = len(payload)
                return
        else:
            raise ProtocolError(CLOSE_PROTOCOL_ERROR, f'unknown opcode {op}')
        self.counters['messages_in'] += 1
        if op == OP_BIN:
            self._on_binary(c, payload)
        else:
            self._on_text(c, payload)

    def _on_close_frame(self, c, payload):
        if len(payload) == 1:
            raise ProtocolError(CLOSE_PROTOCOL_ERROR, 'bad close frame')
        code = None
        if len(payload) >= 2:
            code = struct.unpack_from('!H', payload)[0]
            if not valid_close_code(code):
                raise ProtocolError(CLOSE_PROTOCOL_ERROR, 'bad close code')
            try:
                bytes(payload[2:]).decode('utf-8')
            except UnicodeDecodeError:
                raise ProtocolError(CLOSE_INVALID_DATA, 'invalid close reason') from None
        c.close_recv = True
        if c.close_sent:                             # our close was echoed: handshake complete
            c.finish = True
            self._dirty.add(c)
            return
        self._detach(c, 'closed')                    # peer closed without {t:'leave'}: keep its slot
        self._queue_close(c, encode_frame(OP_CLOSE, struct.pack('!H', code)) if code is not None else encode_frame(OP_CLOSE))
        c.finish = True

    # ---------------------------------------------------------------- sending

    def _send(self, c, frame, key=None):
        """Queue one encoded frame; key != None makes it latest-wins for that key."""
        if c.dead or c.close_sent:
            return False
        if key is not None and c.blocked:
            old = c.latest.get(key)
            if old is not None:
                self.counters['conflated'] += 1
                c.latest_bytes -= len(old)
            c.latest[key] = frame
            c.latest_bytes += len(frame)
            if c.q_bytes + c.latest_bytes > self.max_backlog:
                self._slow_consumer(c)
                return False
            return True
        if not c.q:
            c.last_progress = time.monotonic()
        c.q.append(frame)
        c.q_bytes += len(frame)
        if c.q_bytes + c.latest_bytes > self.max_backlog:
            self._slow_consumer(c)
            return False
        if not c.blocked:
            self._dirty.add(c)                       # flushed once per loop iteration (batches fan-out)
        return True

    def _send_json(self, c, obj):
        return self._send(c, _json_frame(obj))

    def _reply(self, c, obj, rid):
        if rid is not None:
            obj['id'] = rid
        return self._send(c, _json_frame(obj))

    def _error(self, c, reason, re=None, rid=None, **extra):
        obj = {'t': 'error', 'reason': reason, 're': re}
        obj.update(extra)
        return self._reply(c, obj, rid)

    def _slow_consumer(self, c):
        self.counters['slow_consumers'] += 1
        self._discard_unsent(c)
        self._close(c, CLOSE_TRY_AGAIN_LATER, 'slow consumer', 'slow')

    def _discard_unsent(self, c):
        """Drop queued frames that have not started to go out (a partly written frame must finish)."""
        if c.q and c.head_off:
            head = c.q[0]
            c.q.clear()
            c.q.append(head)
            c.q_bytes = len(head)
        else:
            c.q.clear()
            c.q_bytes = 0
            c.head_off = 0
        c.latest.clear()
        c.latest_bytes = 0

    def _queue_close(self, c, frame):
        if c.close_sent or c.dead:
            return
        if not c.q:
            c.last_progress = time.monotonic()
        c.q.append(frame)
        c.q_bytes += len(frame)
        c.close_sent = True
        c.close_deadline = time.monotonic() + self.close_timeout
        c.frag = []
        c.frag_op = 0
        c.frag_len = 0
        self._dirty.add(c)

    def _close(self, c, code, reason='', why=None):
        """Server-initiated close: detach from the room now, then the close handshake."""
        if c.dead or c.close_sent:
            return
        if why is not None:
            self._detach(c, why)
        self._queue_close(c, encode_close(code, reason))

    def _flush_dirty(self):
        while self._dirty:
            batch = self._dirty
            self._dirty = set()
            for c in batch:
                if not c.dead:
                    try:
                        self._flush(c)
                    except Exception:  # noqa: BLE001
                        self._internal_error(c)

    def _flush(self, c):
        q = c.q
        sock = c.sock
        while True:
            if not q:
                if not c.latest or c.close_sent:
                    break
                q.extend(c.latest.values())          # the socket drained: release the latest-wins slots
                c.q_bytes += c.latest_bytes
                c.latest.clear()
                c.latest_bytes = 0
            if len(q) == 1 and not c.head_off:
                data = q[0]
            else:
                parts = [memoryview(q[0])[c.head_off:]]
                size = len(parts[0])
                for fr in itertools.islice(q, 1, None):
                    if size + len(fr) > _SEND_BATCH:
                        break
                    parts.append(fr)
                    size += len(fr)
                data = b''.join(parts)
            try:
                sent = sock.send(data)
            except (BlockingIOError, InterruptedError):
                sent = 0
            except OSError:
                self._drop(c, 'disconnected')
                return
            if sent:
                c.last_progress = time.monotonic()
                self.counters['bytes_out'] += sent
                n = sent
                while n:
                    head = q[0]
                    rem = len(head) - c.head_off
                    if n >= rem:
                        n -= rem
                        q.popleft()
                        c.q_bytes -= len(head)
                        c.head_off = 0
                        self.counters['frames_out'] += 1
                    else:
                        c.head_off += n
                        n = 0
            if sent < len(data):
                break                                # kernel buffer full: resume on EVENT_WRITE
        c.blocked = bool(q)
        want = c.blocked
        if want != c.want_write:
            c.want_write = want
            try:
                self._sel.modify(sock, selectors.EVENT_READ | (selectors.EVENT_WRITE if want else 0), c)
            except (KeyError, ValueError, OSError):
                pass
        if c.finish and not q:
            self._drop(c, None)

    def _drop(self, c, why):
        """Tear the connection down now (after the close handshake, on EOF / errors / timeouts)."""
        if c.dead:
            return
        c.dead = True
        if c.room is not None:
            self._detach(c, why or 'disconnected')
        try:
            self._sel.unregister(c.sock)
        except (KeyError, ValueError, OSError):
            pass
        try:
            c.sock.close()
        except OSError:
            pass
        self._dirty.discard(c)
        c.q.clear()
        c.latest.clear()
        with self.lock:
            self.conns.discard(c)
            self.counters['connections_closed'] += 1

    def _timers(self, now):
        for c in list(self.conns):
            if c.dead:
                continue
            if c.close_sent:
                if now >= c.close_deadline:
                    self._drop(c, None)              # no close echo in time
                continue
            if c.blocked and now - c.last_progress > self.stall_timeout:
                self.counters['stalled'] += 1
                self._drop(c, 'stalled')
                continue
            if now - c.last_rx > self.idle_timeout:
                self.counters['idle_timeouts'] += 1
                self._close(c, CLOSE_GOING_AWAY, 'idle timeout', 'timeout')
                continue
            if now >= c.next_ping:
                c.next_ping = now + self.ping_interval
                self._send(c, _PING_FRAME)
        for room in list(self.rooms.values()):
            for slot in list(room.slots.values()):
                if slot.conn is None and slot.expires is not None and now >= slot.expires:
                    self.counters['expired'] += 1
                    self._remove_slot(room, slot)
                    if room.host is not None and not room.host.dead:
                        self._send_json(room.host, {'t': 'peer-leave', 'peer': slot.peer, 'reason': 'expired', 'reserved': False})
                    self._log(f'room {room.code}: slot {slot.peer} ({slot.name}) expired')

    # ---------------------------------------------------------------- rooms (loop thread)

    def _log(self, text):
        if self.log:
            try:
                self.log(text)
            except Exception:  # noqa: BLE001
                pass

    def _remove_slot(self, room, slot):
        with self.lock:
            if room.slots.get(slot.peer) is slot:
                del room.slots[slot.peer]
            room.tokens.pop(slot.token, None)

    def _detach(self, c, why):
        """Take `c` out of its room. The host leaving closes the room."""
        room = c.room
        if room is None:
            return
        c.room = None
        if c.peer == HOST_PEER:
            self._close_room(room, 'host-left')
            return
        slot = room.slots.get(c.peer)
        if slot is None or slot.conn is not c:
            return
        slot.conn = None
        reserved = why in RESERVED_REASONS
        if reserved:
            slot.expires = time.monotonic() + self.reserve_timeout
        else:
            self._remove_slot(room, slot)
        self._send_json(room.host, {'t': 'peer-leave', 'peer': c.peer, 'reason': why, 'reserved': reserved})
        self._log(f'room {room.code}: {slot.name} (peer {c.peer}) left: {why}' + (' - slot reserved' if reserved else ''))

    def _close_room(self, room, reason):
        with self.lock:
            if self.rooms.get(room.code) is room:
                del self.rooms[room.code]
            self.counters['rooms_closed'] += 1
        room.host = None
        for slot in list(room.slots.values()):
            conn = slot.conn
            slot.conn = None
            if conn is not None and not conn.dead:
                conn.room = None
                self._send_json(conn, {'t': 'room-closed', 'code': room.code, 'reason': reason})
                self._close(conn, CLOSE_ROOM_CLOSED, reason.replace('-', ' '))
        with self.lock:
            room.slots.clear()
            room.tokens.clear()
        self._log(f'room {room.code} closed ({reason})')

    def _on_text(self, c, payload):
        try:
            text = payload.decode('utf-8')
        except UnicodeDecodeError:
            raise ProtocolError(CLOSE_INVALID_DATA, 'invalid utf-8') from None
        self.counters['control_in'] += 1
        try:
            msg = parse_control(text)
        except ValueError:
            self._error(c, 'bad-message')
            return
        if not isinstance(msg, dict):
            self._error(c, 'bad-message')
            return
        t = msg.get('t')
        handler = self._handlers.get(t) if isinstance(t, str) else None
        if handler is None:
            self._error(c, 'bad-message', t if isinstance(t, str) else None, _request_id(msg))
            return
        handler(c, msg, _request_id(msg))

    def _ctl_host(self, c, m, rid):
        if c.room is not None:
            return self._error(c, 'already-in-room', 'host', rid)
        name = clean_text(m.get('name'), 'KINETIC', 32)
        try:
            max_peers = int(m.get('max', 8))
        except (TypeError, ValueError):
            max_peers = 8
        max_peers = max(2, min(self.max_room_peers, max_peers))
        v = m.get('v') if isinstance(m.get('v'), (int, str)) and not isinstance(m.get('v'), bool) else None
        meta = m.get('meta')
        if meta is not None and not self._meta_ok(meta):
            return self._error(c, 'bad-message', 'host', rid)
        want = m.get('code')
        with self.lock:
            if len(self.rooms) >= self.max_rooms:
                err = 'server-full'
            elif want is not None and not valid_code(normalize_code(want)):
                err = 'bad-code'
            elif want is not None and normalize_code(want) in self.rooms:
                err = 'code-taken'
            else:
                err = None
                code = normalize_code(want) if want is not None else new_code(self.rooms)
                room = _Room(code, name, c, max_peers, m.get('public', True) is not False, v)
                if meta is not None:
                    room.meta = meta
                self.rooms[code] = room
                self.counters['rooms_opened'] += 1
        if err:
            return self._error(c, err, 'host', rid)
        c.room = room
        c.peer = HOST_PEER
        c.name = name
        self._reply(c, {'t': 'hosted', 'code': code, 'peer': HOST_PEER, 'max': max_peers}, rid)
        self._log(f'room {code} opened by {c.addr[0]} ({name}, max {max_peers})')

    def _ctl_join(self, c, m, rid):
        if c.room is not None:
            return self._error(c, 'already-in-room', 'join', rid)
        code = normalize_code(m.get('code'))
        room = self.rooms.get(code)
        if room is None:
            return self._error(c, 'no-such-room', 'join', rid)
        v = m.get('v')
        if room.v is not None and v != room.v:
            return self._error(c, 'version-mismatch', 'join', rid, v=room.v)
        name = clean_text(m.get('name'), 'Player', 24)
        token = m.get('token')
        slot = room.tokens.get(token) if isinstance(token, str) and token else None
        if slot is not None:
            old = slot.conn
            if old is not None and old is not c:
                # the same player on a new connection (reload / network change): the old one is replaced
                old.room = None
                slot.conn = None
                self._send_json(room.host, {'t': 'peer-leave', 'peer': slot.peer, 'reason': 'replaced', 'reserved': True})
                self._close(old, CLOSE_REPLACED, 'replaced')
            slot.conn = c
            slot.expires = None
            slot.name = name
            slot.addr = c.addr[0]
            rejoin = True
            self.counters['rejoins'] += 1
        elif m.get('rejoin') is True:
            # an automatic reconnect may only reclaim its own slot: it is gone (kicked while away, or expired),
            # so this player must not come back as a new one behind the host's back
            return self._error(c, 'slot-lost', 'join', rid)
        else:
            if room.locked:
                return self._error(c, 'room-locked', 'join', rid)
            if 1 + len(room.slots) >= room.max_peers:
                return self._error(c, 'room-full', 'join', rid)
            peer = next((i for i in range(1, MAX_CLIENT_PEER + 1) if i not in room.slots), None)
            if peer is None:
                return self._error(c, 'room-full', 'join', rid)
            slot = _Slot(peer, secrets.token_urlsafe(18), name, c, c.addr[0])
            with self.lock:
                room.slots[peer] = slot
                room.tokens[slot.token] = slot
            rejoin = False
            self.counters['joins'] += 1
        c.room = room
        c.peer = slot.peer
        c.name = name
        self._reply(c, {'t': 'joined', 'code': room.code, 'peer': slot.peer, 'token': slot.token, 'rejoin': rejoin,
                        'room': room.info()}, rid)
        self._send_json(room.host, {'t': 'peer-join', 'peer': slot.peer, 'name': name, 'addr': c.addr[0], 'rejoin': rejoin})
        self._log(f'room {room.code}: {name} {"rejoined" if rejoin else "joined"} as peer {slot.peer} from {c.addr[0]}')

    def _ctl_leave(self, c, m, rid):
        room = c.room
        code = room.code if room is not None else None
        self._detach(c, 'left')
        self._reply(c, {'t': 'left', 'code': code}, rid)

    def _ctl_list(self, c, m, rid):
        self._reply(c, {'t': 'rooms', 'rooms': self.public_rooms()}, rid)

    def _ctl_ping(self, c, m, rid):
        self._reply(c, {'t': 'pong', 'c': m.get('c'), 's': round(time.time() * 1000.0, 3)}, rid)

    def _host_room(self, c, re, rid):
        if c.room is None:
            self._error(c, 'not-in-room', re, rid)
            return None
        if c.peer != HOST_PEER:
            self._error(c, 'not-host', re, rid)
            return None
        return c.room

    def _ctl_kick(self, c, m, rid):
        room = self._host_room(c, 'kick', rid)
        if room is None:
            return
        try:
            peer = int(m.get('peer'))
        except (TypeError, ValueError):
            peer = -1
        slot = room.slots.get(peer)
        if slot is None:
            return self._error(c, 'no-such-peer', 'kick', rid)
        self.counters['kicks'] += 1
        target = slot.conn
        slot.conn = None
        self._remove_slot(room, slot)
        self._send_json(c, {'t': 'peer-leave', 'peer': peer, 'reason': 'kicked', 'reserved': False})
        if target is not None and not target.dead:
            target.room = None
            self._close(target, CLOSE_KICKED, clean_text(m.get('reason'), 'kicked', 60))
        self._log(f'room {room.code}: {slot.name} (peer {peer}) was kicked')
        if rid is not None:
            self._reply(c, {'t': 'ok', 're': 'kick'}, rid)

    def _ctl_lock(self, c, m, rid):
        room = self._host_room(c, 'lock', rid)
        if room is None:
            return
        with self.lock:
            room.locked = m.get('locked', True) is not False
        if rid is not None:
            self._reply(c, {'t': 'ok', 're': 'lock', 'locked': room.locked}, rid)

    def _meta_ok(self, meta):
        if not isinstance(meta, dict):
            return False
        try:
            return len(json.dumps(meta)) <= 4096
        except (TypeError, ValueError, RecursionError):
            return False

    def _ctl_meta(self, c, m, rid):
        room = self._host_room(c, 'meta', rid)
        if room is None:
            return
        meta = m.get('meta')
        if not self._meta_ok(meta):
            return self._error(c, 'bad-message', 'meta', rid)
        with self.lock:
            room.meta = meta
        if rid is not None:
            self._reply(c, {'t': 'ok', 're': 'meta'}, rid)

    def _ctl_signal(self, c, m, rid):
        room = c.room
        if room is None:
            return self._error(c, 'not-in-room', 'signal', rid)
        try:
            to = int(m.get('to'))
        except (TypeError, ValueError):
            to = -1
        if to == HOST_PEER:
            dst = room.host
        else:
            slot = room.slots.get(to)
            dst = slot.conn if slot is not None else None
        if dst is None or dst is c:
            return self._error(c, 'no-such-peer', 'signal', rid)
        self._send_json(dst, {'t': 'signal', 'from': c.peer, 'data': m.get('data')})
        if rid is not None:
            self._reply(c, {'t': 'ok', 're': 'signal'}, rid)

    def _on_binary(self, c, payload):
        room = c.room
        n = len(payload)
        if room is None or n < 2:
            self.counters['packets_dropped'] += 1
            return
        typ = payload[1]
        if c.peer == HOST_PEER:
            dst = payload[0]
            frame = _frame_header(OP_BIN, n) + payload
            key = typ if typ >= LATEST_WINS_MIN_TYPE else None
            if dst == BROADCAST:
                sent = 0
                for slot in list(room.slots.values()):   # a send may close a slow consumer
                    if slot.conn is not None:
                        self._send(slot.conn, frame, key)
                        sent += 1
                self.counters['packets_routed'] += sent
                return
            slot = room.slots.get(dst)
            if slot is None or slot.conn is None:
                self.counters['packets_dropped'] += 1
                return
            self._send(slot.conn, frame, key)
            self.counters['packets_routed'] += 1
            return
        host = room.host
        if host is None or host.dead:
            self.counters['packets_dropped'] += 1
            return
        head = _frame_header(OP_BIN, n)
        frame = bytearray(head)
        frame += payload
        frame[len(head)] = c.peer                    # byte0 = sender id, whatever the client wrote
        self._send(host, frame, (c.peer << 8) | typ if typ >= LATEST_WINS_MIN_TYPE else None)
        self.counters['packets_routed'] += 1

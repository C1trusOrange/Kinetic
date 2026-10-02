'use strict';
/**
 * KINETIC multiplayer relay for Node (a port of tools/netserver.py): an RFC 6455 WebSocket hub with room codes.
 *
 * The desktop app runs it inside the Electron main process when a player hosts (a listen server, like a Minecraft
 * server: it listens on a TCP port on every interface and friends connect by IP:port + room code). It also runs
 * headless as a dedicated server: `node desktop/relay.js --port 27500`. No npm dependencies; Node >= 20.
 *
 * Wire contract: identical to tools/netserver.py (read its docstring; the browser side is src/net/protocol.js and
 * src/net/WsRelayTransport.js). In short: JSON text frames are the control plane (host / join / leave / list / ping /
 * kick / lock / meta / signal and their replies), binary frames are the data plane, routed blindly by byte 0 (a
 * client's packet goes to the host with byte 0 rewritten to the sender's peer id; the host addresses one client or
 * 255 = all) with latest-wins conflation of packet types >= 0x80 while a receiver is backed up. Close codes: 1000
 * normal, 1001 idle timeout / server stopping, 1002 protocol error, 1007 invalid UTF-8, 1009 message too big, 1011
 * relay error, 1013 slow consumer, 1008 policy (control flood), 4000 room closed, 4001 kicked, 4002 replaced.
 *
 * HTTP on the same port (it serves no game files: the desktop app has them locally):
 *   GET /ws          WebSocket upgrade
 *   GET /api/rooms   {relay, rooms: [{code, name, players, max, locked, meta, v}]}   open public rooms
 *   GET /api/lan     {app, relay, hostname, port, lan, bind, ips, urls, hostUrl}      addresses to hand to friends
 *   anything else    404
 *
 * Who may connect (browsers always send an Origin header on WebSocket upgrades, so a web page cannot talk to the
 * relay from someone's LAN browser without it being checked): `kinetic://game` (the desktop app's page), an
 * http(s) origin whose host matches the Host header (same-origin, as in the Python relay; here only when the Host is
 * an address, localhost or this PC's name, because a page that reaches this relay under its own domain name is a DNS
 * rebinding attack), and no Origin at all (non-browser clients, tests). Everything else gets 403. /api/* answers CORS
 * only for `kinetic://game` and refuses pages that arrive under a foreign domain name. `--allow-origin` adds more.
 *
 * Hardening for a port that may face the internet (every limit is an option; 0 turns it off): connections per remote
 * IP (IPv6: per /64), a deadline for the HTTP handshake, a request-header size limit, a rate limit on host / join
 * requests per IP (a valid reconnect token is not charged), a control-message rate per connection, and the Python
 * relay's own bounds (max_conns, max_rooms, max_message, max_backlog). Replies never carry stack traces or internals;
 * an internal error closes only the connection it happened on (1011) and is logged. The wire is plain ws://: nothing
 * is encrypted, and room codes / reconnect tokens are only as private as the network between the players.
 *
 * As an online server (server/install.sh runs it as a systemd service on a VPS): a host key (KINETIC_HOST_KEY or
 * --host-key-file; only a `host` request carrying it as `key` opens a room, else error 'host-key'; joining needs just
 * the code), unlisted rooms (--no-room-list), no /api/lan (--no-lan-info), and optionally Caddy in front for HTTPS:
 * --trust-proxy makes a connection from this machine the player in its right-most X-Forwarded-For entry (per-IP
 * limits, logs), --allow-host lets /api/* answer requests addressed to the server's domain.
 *
 *   const relay = createRelay({ log: console.log });
 *   const { host, port } = await relay.listen({ host: '0.0.0.0', port: 27500 });
 *   relay.lanInfo(); relay.rooms(); relay.stats();
 *   await relay.close();
 */
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const dgram = require('node:dgram');
const crypto = require('node:crypto');
const { isUtf8 } = require('node:buffer');

const RELAY_VERSION = 1;
const WS_PATH = '/ws';
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const DEFAULT_PORT = 27500;
/** Origin of the desktop app's page (main.js registers the `kinetic` scheme as a standard origin). */
const APP_ORIGIN = 'kinetic://game';

const CODE_ALPHABET = 'BCDFGHJKLMNPQRSTVWXZ';
const CODE_LEN = 4;
const HOST_PEER = 0;
const BROADCAST = 255;
const MAX_CLIENT_PEER = 254;
const LATEST_WINS_MIN_TYPE = 0x80;

const CLOSE_NORMAL = 1000;
const CLOSE_GOING_AWAY = 1001;
const CLOSE_PROTOCOL_ERROR = 1002;
const CLOSE_INVALID_DATA = 1007;
const CLOSE_POLICY = 1008;
const CLOSE_TOO_BIG = 1009;
const CLOSE_INTERNAL_ERROR = 1011;
const CLOSE_TRY_AGAIN_LATER = 1013;
const CLOSE_ROOM_CLOSED = 4000;
const CLOSE_KICKED = 4001;
const CLOSE_REPLACED = 4002;

const OP_CONT = 0x0;
const OP_TEXT = 0x1;
const OP_BIN = 0x2;
const OP_CLOSE = 0x8;
const OP_PING = 0x9;
const OP_PONG = 0xa;

/** Seconds / bytes / counts. The first block is netserver.DEFAULTS; the rest is the internet hardening. */
const DEFAULTS = Object.freeze({
  pingInterval: 5,        // s between server pings (browsers answer them automatically)
  idleTimeout: 15,        // s without any received byte -> close 1001
  stallTimeout: 15,       // s with queued output and no send progress -> drop (frozen tab, dead Wi-Fi)
  closeTimeout: 1,        // s to wait for the peer's close echo
  reserveTimeout: 60,     // s a dropped client's slot stays reserved for its token
  maxMessage: 1 << 20,    // bytes per (reassembled) message -> close 1009
  maxBacklog: 2 << 20,    // bytes queued for one receiver -> close 1013
  maxRooms: 256,
  maxRoomPeers: 255,      // host + 254 clients
  maxConns: 500,          // open WebSockets -> 503 (the Python relay's select() limit; kept as a memory bound)
  // beyond netserver.py:
  maxConnsPerIp: 8,       // open TCP connections per remote IP (IPv6: per /64); excess ones get 429
  handshakeTimeout: 5,    // s for a new connection to deliver its HTTP request head, else it is dropped
  maxHeaderBytes: 16384,  // request head size limit -> 431
  joinRate: 20,           // host + join requests per joinWindow per remote IP -> error 'rate-limited'
  joinWindow: 60,         // s
  controlRate: 50,        // control messages (text frames, pings) per second per connection; excess ones are dropped
  controlBurst: 100,      // ... with this much burst allowance
  allowedOrigins: Object.freeze([APP_ORIGIN]),
  // an online server (server/install.sh) also sets these:
  hostKey: '',            // non-empty: only a host request carrying this key opens a room (joining needs just the code)
  trustProxy: 0,          // 1: a connection from this machine (a reverse proxy) is the client named in X-Forwarded-For
  listRooms: 1,           // 0: /api/rooms and `list` answer an empty list (rooms are found by their code only)
  lanInfo: 1,             // 0: /api/lan answers 404 (a server on the internet has no LAN addresses to hand out)
  allowedHosts: Object.freeze([]),   // Host names besides addresses / localhost / this PC that /api/* answers (its domain)
});

/** peer-leave reasons that keep the slot reserved for a rejoin with the token. */
const RESERVED_REASONS = new Set(['closed', 'disconnected', 'timeout', 'stalled', 'slow', 'protocol', 'error', 'replaced']);
const COUNTERS = ['connections', 'connections_closed', 'handshake_rejected', 'bad_origin', 'rooms_opened', 'rooms_closed',
  'joins', 'rejoins', 'messages_in', 'fragments', 'control_in', 'packets_routed', 'packets_dropped', 'frames_out',
  'bytes_in', 'bytes_out', 'conflated', 'slow_consumers', 'stalled', 'idle_timeouts', 'protocol_errors',
  'internal_errors', 'kicks', 'expired', 'conn_limit', 'ip_limit', 'handshake_timeouts', 'rate_limited',
  'control_dropped', 'host_key_rejected'];

const PING_FRAME = Buffer.from([0x80 | OP_PING, 0]);
/** Most bytes handed to the socket per write: small enough that a slow reader still completes writes (= progress). */
const WRITE_CHUNK = 32 * 1024;
const TIMER_STEP_MS = 50;
const MAX_JSON_DEPTH = 64;
const META_LIMIT = 4096;
const MAX_HOST_KEY = 256;

/** A peer violated RFC 6455 or a relay limit; the connection is closed with `code`. */
class ProtocolError {
  constructor(code, reason) {
    this.code = code;
    this.reason = reason;
  }
}

const noop = () => {};

/** Option keys may be written snake_case (netserver.py) or camelCase. */
function camel(key) {
  return key.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
}

/** Merge user options over DEFAULTS; unknown keys throw (like netserver.Relay). */
function resolveOptions(options) {
  const out = { ...DEFAULTS };
  const unknown = [];
  for (const [k, v] of Object.entries(options || {})) {
    if (k === 'log' || k === 'errorLog' || k === 'testHooks') continue;
    const key = camel(k);
    if (!Object.prototype.hasOwnProperty.call(DEFAULTS, key)) {
      unknown.push(k);
      continue;
    }
    if (v === undefined) continue;
    if (key === 'allowedOrigins' || key === 'allowedHosts') {
      if (!Array.isArray(v)) throw new TypeError(`${key} must be an array`);
      out[key] = v.map(s => String(s).trim().toLowerCase()).filter(Boolean);
    } else if (key === 'hostKey') {
      if (v !== null && typeof v !== 'string') throw new TypeError('hostKey must be a string');
      out[key] = (v || '').trim();
      if (out[key].length > MAX_HOST_KEY) throw new TypeError(`hostKey is longer than ${MAX_HOST_KEY} characters`);
    } else {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0) throw new TypeError(`relay option ${k} must be a number >= 0`);
      out[key] = n;
    }
  }
  if (unknown.length) throw new TypeError('unknown relay option(s): ' + unknown.sort().join(', '));
  return out;
}

// ------------------------------------------------------------------------------------------------ frames

/** Bytes of the header of an unmasked server -> client frame carrying `n` payload bytes. */
function frameHeaderLength(n) {
  return n < 126 ? 2 : n < 65536 ? 4 : 10;
}

/** Write the FIN + opcode + length header into `buf` at 0; returns its length. */
function writeFrameHeader(buf, op, n) {
  buf[0] = 0x80 | op;
  if (n < 126) {
    buf[1] = n;
    return 2;
  }
  if (n < 65536) {
    buf[1] = 126;
    buf[2] = n >> 8;
    buf[3] = n & 0xff;
    return 4;
  }
  buf[1] = 127;
  buf.writeUInt32BE(Math.floor(n / 4294967296), 2);
  buf.writeUInt32BE(n >>> 0, 6);
  return 10;
}

/** One unmasked server -> client frame (FIN set). */
function encodeFrame(op, payload) {
  const n = payload.length;
  const hl = frameHeaderLength(n);
  const out = Buffer.allocUnsafe(hl + n);
  writeFrameHeader(out, op, n);
  payload.copy(out, hl);
  return out;
}

/** Close frame: status code + UTF-8 reason (control frames carry <= 125 bytes; never cut a character in half). */
function encodeClose(code = CLOSE_NORMAL, reason = '') {
  const raw = Buffer.from(String(reason), 'utf8');
  let n = Math.min(raw.length, 123);
  if (n < raw.length) while (n > 0 && (raw[n] & 0xc0) === 0x80) n--;
  const out = Buffer.allocUnsafe(4 + n);
  out[0] = 0x80 | OP_CLOSE;
  out[1] = 2 + n;
  out[2] = code >> 8;
  out[3] = code & 0xff;
  raw.copy(out, 4, 0, n);
  return out;
}

/** Text frame carrying `obj` as JSON (JSON.stringify escapes lone surrogates, so the UTF-8 is always valid). */
function jsonFrame(obj) {
  const text = JSON.stringify(obj);
  const n = Buffer.byteLength(text);
  const hl = frameHeaderLength(n);
  const out = Buffer.allocUnsafe(hl + n);
  writeFrameHeader(out, OP_TEXT, n);
  out.write(text, hl, n, 'utf8');
  return out;
}

/** XOR-unmask src[s .. s+n) into dst[d ..] (RFC 6455 5.3); dst may be src for in-place use. */
function unmaskInto(dst, d, src, s, n, k0, k1, k2, k3) {
  let i = 0;
  for (const end = n - 3; i < end; i += 4) {
    dst[d + i] = src[s + i] ^ k0;
    dst[d + i + 1] = src[s + i + 1] ^ k1;
    dst[d + i + 2] = src[s + i + 2] ^ k2;
    dst[d + i + 3] = src[s + i + 3] ^ k3;
  }
  if (i < n) dst[d + i] = src[s + i] ^ k0;
  if (i + 1 < n) dst[d + i + 1] = src[s + i + 1] ^ k1;
  if (i + 2 < n) dst[d + i + 2] = src[s + i + 2] ^ k2;
}

/** Close codes a peer may send (RFC 6455 7.4). */
function validCloseCode(code) {
  return (code >= 1000 && code <= 1014 && code !== 1004 && code !== 1005 && code !== 1006) || (code >= 3000 && code <= 4999);
}

// ------------------------------------------------------------------------------------------------ text and JSON

/** Room code as typed by a player: case-insensitive, spaces / dashes ignored. */
function normalizeCode(value) {
  if (typeof value !== 'string') return '';
  return value.toUpperCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

function validCode(code) {
  if (code.length !== CODE_LEN) return false;
  for (let i = 0; i < CODE_LEN; i++) if (!CODE_ALPHABET.includes(code[i])) return false;
  return true;
}

/** A fresh random room code that `taken` (a Map or Set) does not have. */
function newCode(taken) {
  for (let tries = 0; tries < 10000; tries++) {
    let code = '';
    for (let i = 0; i < CODE_LEN; i++) code += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
    if (!taken.has(code)) return code;
  }
  throw new Error('room code space exhausted');
}

/** Reconnect token (24 URL-safe characters, 144 bits). */
function newToken() {
  return crypto.randomBytes(18).toString('base64url');
}

/** The first `limit` code points of `s` (never splits a surrogate pair). */
function sliceCodePoints(s, limit) {
  if (s.length <= limit) return s;
  let i = 0;
  for (let count = 0; i < s.length && count < limit; count++) i += s.codePointAt(i) > 0xffff ? 2 : 1;
  return s.slice(0, i);
}

/** Printable, whitespace-collapsed, length-limited text (player / room names, reasons). */
function cleanText(value, fallback, limit) {
  if (typeof value !== 'string') return fallback;
  const s = sliceCodePoints(value.replace(/[\p{C}\p{Z}]+/gu, ' ').trim(), limit);
  return s || fallback;
}

/** int(value) the way netserver.py reads peer ids and sizes: numbers truncate, digit strings parse, the rest fails. */
function toInt(value, fallback) {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.trunc(value) : fallback;
  if (typeof value === 'string' && /^\s*[+-]?\d+\s*$/.test(value)) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }
  return fallback;
}

/** The request id to echo: an integer or a string of at most 64 characters. */
function requestId(msg) {
  const id = msg.id;
  if (typeof id === 'number') return Number.isInteger(id) ? id : null;
  if (typeof id === 'string') return id.length <= 64 ? id : null;
  return null;
}

/** False when `text` nests arrays / objects deeper than `limit` (counted outside strings; JSON.parse checks the rest). */
function jsonDepthOk(text, limit) {
  let depth = 0;
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (inString) {
      if (c === 92) i++;
      else if (c === 34) inString = false;
    } else if (c === 34) inString = true;
    else if (c === 123 || c === 91) {
      if (++depth > limit) return false;
    } else if (c === 125 || c === 93) depth--;
  }
  return true;
}

function allFinite(v) {
  if (typeof v === 'number') return Number.isFinite(v);
  if (v === null || typeof v !== 'object') return true;
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) if (!allFinite(v[i])) return false;
    return true;
  }
  for (const k in v) if (!allFinite(v[k])) return false;
  return true;
}

/**
 * A control message as the browser's JSON.parse would read it, minus what would poison later replies: numbers
 * that overflow to Infinity (1e999: a host's meta must never make /api/rooms unreadable for everyone) and
 * absurd nesting. NaN / Infinity literals are not JSON, so JSON.parse already refuses them. Throws SyntaxError.
 */
function parseControl(text) {
  if (!jsonDepthOk(text, MAX_JSON_DEPTH)) throw new SyntaxError('nested too deeply');
  const value = JSON.parse(text);
  if (!allFinite(value)) throw new SyntaxError('number out of range');
  return value;
}

/** A host's room meta: a plain object of at most META_LIMIT bytes of JSON (non-ASCII counted as \uXXXX escapes). */
function metaOk(meta) {
  if (meta === null || typeof meta !== 'object' || Array.isArray(meta)) return false;
  let text;
  try {
    text = JSON.stringify(meta);
  } catch {
    return false;
  }
  let n = text.length;
  if (n > META_LIMIT) return false;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) > 0x7f) n += 5;
  return n <= META_LIMIT;
}

// ------------------------------------------------------------------------------------------------ network info

const IPV4_RE = /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;
/** Adapters nobody can reach from outside: Hyper-V / WSL switches, VirtualBox, VMware, containers, tunnels. */
const VIRTUAL_NIC_RE = /vethernet|\bwsl\b|hyper-?v|virtualbox|\bvbox|vmware|vmnet|docker|^(?:veth|virbr|br-|utun|awdl|llw|lo)/i;
const ROUTE_PROBES = ['8.8.8.8', '192.168.255.255', '10.255.255.255', '172.31.255.255'];
const LAN_CACHE_MS = 10000;

function ipv4Parts(ip) {
  return typeof ip === 'string' && IPV4_RE.test(ip) ? ip.split('.').map(Number) : null;
}

/**
 * Usable LAN IPv4 addresses in discovery order, private (RFC 1918) ones first; drops loopback, link-local
 * (169.254/16, i.e. no DHCP lease), unspecified, multicast, reserved and malformed entries and duplicates.
 * @param {string[]} candidates
 * @returns {string[]}
 */
function rankIpv4s(candidates) {
  const priv = [];
  const other = [];
  for (const ip of candidates) {
    const p = ipv4Parts(ip);
    if (!p) continue;
    const [a, b] = p;
    if (a === 0 || a === 127 || a >= 224 || (a === 169 && b === 254)) continue;
    if (priv.includes(ip) || other.includes(ip)) continue;
    const isPrivate = a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
    (isPrivate ? priv : other).push(ip);
  }
  return priv.concat(other);
}

/** True for loopback addresses and 'localhost' (a relay bound there is reachable from this PC only). */
function isLoopbackHost(host) {
  const h = String(host || '').split('%')[0].toLowerCase();
  if (h === 'localhost' || h === '::1') return true;
  const p = ipv4Parts(h.startsWith('::ffff:') ? h.slice(7) : h);
  return !!p && p[0] === 127;
}

/** Strip a zone id and the IPv4-mapped prefix: what peers see as a player's address. */
function cleanAddress(addr) {
  let a = String(addr || '');
  const pct = a.indexOf('%');
  if (pct >= 0) a = a.slice(0, pct);
  if (a.slice(0, 7).toLowerCase() === '::ffff:' && ipv4Parts(a.slice(7))) a = a.slice(7);
  return a || '?';
}

/**
 * The client address a reverse proxy on this machine (Caddy) reports: the right-most X-Forwarded-For entry, the one
 * the proxy itself appended (anything left of it came from the client and proves nothing). null if it is no address.
 * @param {string|string[]|undefined} header
 * @returns {string|null}
 */
function forwardedFor(header) {
  const raw = Array.isArray(header) ? header.join(',') : header;
  if (typeof raw !== 'string' || raw.length > 4096) return null;
  let a = raw.slice(raw.lastIndexOf(',') + 1).trim();
  const bracketed = /^\[([^\]]+)\](?::\d{1,5})?$/.exec(a);
  if (bracketed) a = bracketed[1];
  else {
    const v4port = /^(\d{1,3}(?:\.\d{1,3}){3}):\d{1,5}$/.exec(a);
    if (v4port) a = v4port[1];
  }
  return net.isIP(a.split('%')[0]) ? cleanAddress(a) : null;
}

/** The key per-IP limits count by: the address itself, or the /64 for IPv6 (one subscriber owns a whole /64). */
function ipKey(addr) {
  const a = cleanAddress(addr);
  if (!net.isIPv6(a)) return a;
  const i = a.indexOf('::');
  const left = (i >= 0 ? a.slice(0, i) : a).split(':').filter(Boolean);
  const right = i >= 0 ? a.slice(i + 2).split(':').filter(Boolean) : [];
  const hextets = i >= 0 ? left.concat(new Array(Math.max(0, 8 - left.length - right.length)).fill('0'), right) : left;
  return hextets.slice(0, 4).map(h => parseInt(h, 16).toString(16)).join(':') + '::/64';
}

/** The local address the OS would use to reach `target`. connect() on a UDP socket only selects a route: no packet is sent. */
function probeRoute(target) {
  return new Promise(resolve => {
    let sock = null;
    let timer = null;
    const finish = ip => {
      if (!timer) return;
      clearTimeout(timer);
      timer = null;
      try { sock.close(); } catch { /* already closed */ }
      resolve(ip);
    };
    timer = setTimeout(() => finish(''), 1000);
    if (timer.unref) timer.unref();
    try {
      sock = dgram.createSocket('udp4');
      sock.once('error', () => finish(''));
      sock.connect(9, target, () => {
        let ip = '';
        try { ip = sock.address().address; } catch { /* unconnected */ }
        finish(ip);
      });
    } catch {
      finish('');
    }
  });
}

/**
 * Non-loopback IPv4 addresses of the network interfaces, skipping adapters whose names mark them as virtual.
 * @param {object} [ifaces] os.networkInterfaces() (a parameter for the tests)
 */
function interfaceIpv4s(ifaces) {
  if (ifaces === undefined) {
    try {
      ifaces = os.networkInterfaces();
    } catch {
      return [];
    }
  }
  const real = [];
  const virtual = [];
  for (const [name, addrs] of Object.entries(ifaces)) {
    for (const a of addrs || []) {
      if ((a.family === 'IPv4' || a.family === 4) && !a.internal) (VIRTUAL_NIC_RE.test(name) ? virtual : real).push(a.address);
    }
  }
  return real.length ? real : virtual;   // a VM whose only adapter looks virtual still has an address to offer
}

const lanCache = { routeAt: -Infinity, route: [], pending: null, at: -Infinity, ips: [] };

/** Look the default routes up again in the background (the next lanIpv4s() sees the result). */
function refreshRoutes() {
  if (lanCache.pending) return lanCache.pending;
  lanCache.pending = Promise.all(ROUTE_PROBES.map(probeRoute)).then(found => {
    lanCache.route = found.filter(Boolean);
    lanCache.routeAt = Date.now();
    lanCache.at = -Infinity;
    lanCache.pending = null;
    return lanCache.route;
  });
  return lanCache.pending;
}

/**
 * Best-effort LAN IPv4 list for invites, the default-route address first (it is the one friends on the same
 * network can reach), cached for 10 s. Synchronous; the first call may miss the route lookup until it finishes.
 * @returns {string[]}
 */
function lanIpv4s() {
  const now = Date.now();
  if (now - lanCache.routeAt > LAN_CACHE_MS) refreshRoutes();
  if (now - lanCache.at > LAN_CACHE_MS) {
    lanCache.ips = rankIpv4s(lanCache.route.concat(interfaceIpv4s()));
    lanCache.at = now;
  }
  return lanCache.ips.slice();
}

// ------------------------------------------------------------------------------------------------ limits

/** Token bucket per key: `limit` requests of burst, refilled evenly over `windowSec` seconds. */
class RateLimiter {
  constructor(limit, windowSec) {
    this.limit = limit;
    this.perMs = windowSec > 0 ? limit / (windowSec * 1000) : limit;
    this.buckets = new Map();
  }

  /** Spend one token of `key`'s bucket; false when it is empty. */
  take(key, now) {
    if (!this.limit) return true;
    let b = this.buckets.get(key);
    if (b === undefined) {
      b = { tokens: this.limit, t: now };
      this.buckets.set(key, b);
    } else {
      b.tokens = Math.min(this.limit, b.tokens + (now - b.t) * this.perMs);
      b.t = now;
    }
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }

  /** Forget keys whose bucket is full again (bounds the map to the keys active within one window). */
  prune(now) {
    for (const [key, b] of this.buckets) if (b.tokens + (now - b.t) * this.perMs >= this.limit) this.buckets.delete(key);
  }
}

// ------------------------------------------------------------------------------------------------ rooms

class Slot {
  constructor(peer, token, name, conn, addr) {
    this.peer = peer;
    this.token = token;
    this.name = name;
    this.conn = conn;          // null while the player is away (slot reserved for the token)
    this.addr = addr;
    this.expires = null;       // performance.now() deadline of a reserved slot
  }
}

class Room {
  constructor(code, name, host, maxPeers, isPublic, v) {
    this.code = code;
    this.name = name;
    this.host = host;
    this.maxPeers = maxPeers;
    this.public = isPublic;
    this.locked = false;
    this.meta = {};
    this.v = v;
    this.slots = new Map();    // client peer id -> Slot (connected or reserved)
    this.tokens = new Map();   // reconnect token -> Slot
  }

  info() {
    let connected = 0;
    for (const s of this.slots.values()) if (s.conn !== null) connected++;
    return { code: this.code, name: this.name, players: 1 + connected, max: this.maxPeers, locked: this.locked, meta: this.meta, v: this.v };
  }
}

/** One upgraded WebSocket: input reassembly state, the output queue and what the relay knows about its player. */
class Conn {
  constructor(socket, addr, ip, now, opts) {
    this.socket = socket;
    this.addr = addr;          // what the host sees as the player's address
    this.ip = ip;              // per-IP limit key
    // input: bytes of an incomplete frame, and the message being reassembled from fragments
    this.stash = null;
    this.stashLen = 0;
    this.need = 0;             // size of the incomplete frame at the start of the stash, once its header is known
    this.fragOp = 0;
    this.frag = [];
    this.fragLen = 0;
    // output: encoded frames oldest first (q[qHead..]), the part of q[qHead] already handed to the socket, and the
    // latest-wins frames held back while the socket is backed up
    this.q = [];
    this.qHead = 0;
    this.qBytes = 0;
    this.headOff = 0;
    this.latest = new Map();   // (sender << 8 | type) -> frame
    this.latestBytes = 0;
    this.busy = false;         // socket.write() said stop: wait for 'drain'
    this.inflight = 0;         // writes the socket has not completed yet
    this.closeSent = false;
    this.closeRecv = false;
    this.closeDeadline = 0;
    this.finish = false;       // drop once the queue is flushed
    this.dead = false;
    this.lastRx = now;
    this.lastProgress = now;
    this.nextPing = now + opts.pingMs;
    this.ctlTokens = opts.controlBurst;
    this.ctlAt = now;
    this.ctlDrops = 0;         // control messages dropped since the bucket last had room
    this.ctlNotified = -Infinity;
    this.room = null;
    this.peer = -1;
    this.name = '';
    this.onWritten = null;
  }
}

// ------------------------------------------------------------------------------------------------ relay

const kState = Symbol('kinetic.socket');
const STATUS_TEXT = {
  400: 'Bad Request', 403: 'Forbidden', 404: 'Not Found', 405: 'Method Not Allowed', 426: 'Upgrade Required',
  429: 'Too Many Requests', 431: 'Request Header Fields Too Large', 503: 'Service Unavailable',
};

function headerTokens(value) {
  const out = new Set();
  if (typeof value === 'string') for (const t of value.split(',')) if (t.trim()) out.add(t.trim().toLowerCase());
  return out;
}

/** Remove the scheme's default port from an authority so `host:80` and `host` compare equal. */
function stripDefaultPort(authority, scheme) {
  const suffix = scheme === 'https' ? ':443' : ':80';
  return authority.endsWith(suffix) ? authority.slice(0, -suffix.length) : authority;
}

/** The host name of a Host header: no port, no brackets around an IPv6 literal, lower case. */
function hostOnly(header) {
  const h = String(header || '').trim().toLowerCase();
  if (h.startsWith('[')) {
    const end = h.indexOf(']');
    return end > 0 ? h.slice(1, end) : '';
  }
  const colon = h.indexOf(':');
  return colon >= 0 ? h.slice(0, colon) : h;
}

/** Something already listens on this port of the loopback address (a wildcard bind could still succeed next to it on Windows). */
function loopbackTaken(port) {
  return new Promise(resolve => {
    const sock = net.connect({ host: '127.0.0.1', port });
    const done = taken => {
      sock.destroy();
      resolve(taken);
    };
    // a live listener accepts within a millisecond; Windows takes ~2 s to refuse a connection, so do not wait for that
    sock.setTimeout(300, () => done(false));
    sock.once('connect', () => done(true));
    sock.once('error', () => done(false));
  });
}

/**
 * WebSocket hub + room registry. Everything runs on Node's event loop (one thread), so connection and room state
 * needs no locks. Options: see DEFAULTS. `log(text)` receives room events, `errorLog(text)` internal errors.
 */
class Relay {
  constructor(options = {}) {
    const o = resolveOptions(options);
    this.log = typeof options.log === 'function' ? options.log : null;
    this.errorLog = typeof options.errorLog === 'function' ? options.errorLog : text => console.error(text);
    this.pingMs = o.pingInterval * 1000;
    this.idleMs = o.idleTimeout * 1000;
    this.stallMs = o.stallTimeout * 1000;
    this.closeMs = o.closeTimeout * 1000;
    this.reserveMs = o.reserveTimeout * 1000;
    this.handshakeMs = o.handshakeTimeout * 1000;
    this.maxMessage = o.maxMessage;
    this.maxBacklog = o.maxBacklog;
    this.maxRooms = o.maxRooms;
    this.maxRoomPeers = o.maxRoomPeers;
    this.maxConns = o.maxConns;
    this.maxConnsPerIp = o.maxConnsPerIp;
    this.maxHeaderBytes = o.maxHeaderBytes;
    this.controlRate = o.controlRate;
    this.controlBurst = Math.max(1, o.controlBurst);
    this.allowedOrigins = new Set(o.allowedOrigins);
    this.allowedHosts = new Set(o.allowedHosts);
    this.joinLimiter = new RateLimiter(o.joinRate, o.joinWindow);
    // compared as SHA-256 digests with timingSafeEqual: equal lengths, and the time taken says nothing about the key
    this.hostKeyHash = o.hostKey ? crypto.createHash('sha256').update(o.hostKey, 'utf8').digest() : null;
    this.trustProxy = !!o.trustProxy;
    this.listRooms = !!o.listRooms;
    this.lanInfoOn = !!o.lanInfo;
    this.proxyConns = new Map();     // forwarded ip key -> open WebSockets that came through the proxy

    this.rooms = new Map();          // code -> Room
    this.conns = new Set();          // upgraded WebSockets
    this.sockets = new Set();        // every accepted TCP socket (handshake phase, plain HTTP and WebSockets)
    this.ipConns = new Map();        // ip key -> open sockets
    this.counters = Object.fromEntries(COUNTERS.map(k => [k, 0]));
    this.dirty = new Set();          // connections with queued output: flushed once per event, which batches fan-out
    this.spare = new Set();          // swapped with `dirty` while flushing (no allocation per event)
    this.server = null;
    this.bound = null;               // {host, port} once listening
    this.timer = null;
    this.stopping = false;
    this.closing = null;
    this.onDrained = null;
    this.startedAt = Date.now();
    this.nextExpiryScan = 0;
    this.nextPrune = 0;
    this.faults = options.testHooks ? new Set() : null;   // control types whose next handler throws (tests only)
    this.handlers = new Map([
      ['host', this.ctlHost], ['join', this.ctlJoin], ['leave', this.ctlLeave], ['list', this.ctlList],
      ['ping', this.ctlPing], ['kick', this.ctlKick], ['lock', this.ctlLock], ['meta', this.ctlMeta],
      ['signal', this.ctlSignal],
    ]);
  }

  // ---------------------------------------------------------------- public

  /**
   * Start listening. Resolves with the bound address; rejects with the net error (`code` EADDRINUSE / EACCES ...).
   * @param {{host?: string, port?: number}} [where] default 0.0.0.0:27500 (port 0 picks a free one)
   * @returns {Promise<{host: string, port: number}>}
   */
  async listen({ host = '0.0.0.0', port = DEFAULT_PORT } = {}) {
    if (this.server || this.closing) throw new Error('relay is already listening');
    if (port && !isLoopbackHost(host) && await loopbackTaken(port)) {
      // Windows lets a wildcard bind succeed next to a listener on 127.0.0.1:port; this PC's own game would then reach
      // that program while friends reach us. Refuse like a normal port clash.
      throw Object.assign(new Error(`listen EADDRINUSE: address already in use 127.0.0.1:${port}`), { code: 'EADDRINUSE', port });
    }
    const server = http.createServer({ maxHeaderSize: this.maxHeaderBytes || undefined }, (req, res) => this.guardRequest(req, res));
    server.maxHeadersCount = 100;
    server.maxConnections = this.maxConns * 2 + 64;   // last resort for sockets that never upgrade (the per-IP cap comes first)
    server.on('upgrade', (req, socket, head) => this.guardUpgrade(req, socket, head));
    server.on('clientError', (err, socket) => this.onClientError(err, socket));
    const httpOnConnection = server.listeners('connection').slice();
    server.removeAllListeners('connection');
    // every accepted socket passes the per-IP limit and the handshake deadline before the HTTP parser sees it
    server.on('connection', socket => this.onConnection(socket, () => { for (const fn of httpOnConnection) fn.call(server, socket); }));
    await new Promise((resolve, reject) => {
      const failed = err => reject(err);
      server.once('error', failed);
      server.listen({ host, port, backlog: 511 }, () => {
        server.off('error', failed);
        resolve();
      });
    });
    server.on('error', err => this.reportError(`[relay] server error: ${err && err.message}`));   // e.g. EMFILE while accepting
    this.server = server;
    const addr = server.address();
    this.bound = { host: addr.address, port: addr.port };
    // the first /api/lan of a relay that friends can reach already knows the default route
    if (!isLoopbackHost(host) && Date.now() - lanCache.routeAt > LAN_CACHE_MS) await refreshRoutes();
    return { ...this.bound };
  }

  /**
   * Stop accepting, close every connection (1001) and resolve once the sockets are gone (at most ~2 s). Idempotent.
   * @returns {Promise<void>}
   */
  close() {
    if (this.closing) return this.closing;
    this.stopping = true;
    this.closing = new Promise(resolve => {
      let timer = null;
      let serverDone = !this.server;
      const check = () => {
        if (!serverDone || this.sockets.size) return;
        clearTimeout(timer);
        this.onDrained = null;
        resolve();
      };
      this.onDrained = check;
      timer = setTimeout(() => {
        for (const s of this.sockets) s.destroy();
        serverDone = true;
        this.sockets.clear();
        check();
      }, 2000);
      timer.unref();
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
      if (this.server) this.server.close(() => { serverDone = true; check(); });
      for (const c of Array.from(this.conns)) {
        try {
          // best effort, straight to the socket: not between the halves of a frame that is partly written
          if (!c.closeSent && !c.dead && c.headOff === 0) c.socket.write(encodeClose(CLOSE_GOING_AWAY, 'server stopping'));
        } catch { /* the socket is gone already */ }
        c.room = null;                    // the whole relay is going away: nobody needs a peer-leave
        this.drop(c, null, true);
      }
      this.rooms.clear();
      for (const s of Array.from(this.sockets)) if (!s[kState] || !s[kState].ws) s.destroy();   // plain HTTP: no grace
      check();
    });
    return this.closing;
  }

  /** Open public rooms (what GET /api/rooms and the `list` request return); none when the list is off (listRooms 0). */
  publicRooms() {
    const out = [];
    if (!this.listRooms) return out;
    for (const r of this.rooms.values()) if (r.public && !r.locked) out.push(r.info());
    return out;
  }

  /** Payload of GET /api/lan. */
  lanInfo() {
    const bind = this.bound ? this.bound.host : '';
    const port = this.bound ? this.bound.port : 0;
    const ips = lanIpv4s();
    const hostname = os.hostname();
    return {
      app: 'kinetic', relay: RELAY_VERSION, hostname, port, lan: !!bind && !isLoopbackHost(bind), bind, ips,
      urls: ips.map(ip => `http://${ip}:${port}`), hostUrl: `http://${hostname}:${port}`,
    };
  }

  /** Counters, rooms and per-connection queue state (no names, tokens or addresses). */
  stats() {
    const rooms = [];
    for (const r of this.rooms.values()) rooms.push(r.info());
    const conns = [];
    for (const c of this.conns) {
      conns.push({ peer: c.peer, room: c.room ? c.room.code : null, queued: c.qBytes, latest: c.latest.size, blocked: c.busy || c.qHead < c.q.length });
    }
    const cpu = process.cpuUsage();
    return {
      relay: RELAY_VERSION, counters: { ...this.counters }, rooms, conns, sockets: this.sockets.size,
      uptime: (Date.now() - this.startedAt) / 1000, cpu: (cpu.user + cpu.system) / 1e6,
    };
  }

  /** Test hook (createRelay({testHooks: true})): the next control message of type `t` makes its handler throw. */
  armFault(t) {
    if (this.faults) this.faults.add(String(t));
  }

  // ---------------------------------------------------------------- logging

  logEvent(text) {
    if (!this.log) return;
    try {
      this.log(text);
    } catch { /* a broken logger must not break routing */ }
  }

  reportError(text) {
    try {
      this.errorLog(String(text).replace(/\s+$/, ''));
    } catch { /* ditto */ }
  }

  internalError(c, err) {
    this.counters.internal_errors++;
    this.reportError(`[relay] internal error (connection dropped):\n${err && err.stack ? err.stack : err}`);
    if (!c) return;
    c.stashLen = 0;               // the frame that failed may be half unmasked: never parse the stash again
    try {
      this.closeConn(c, CLOSE_INTERNAL_ERROR, 'relay error', 'error');
    } catch {
      this.drop(c, 'error');
    }
  }

  // ---------------------------------------------------------------- sockets and the HTTP handshake

  onConnection(socket, passToHttp) {
    socket.on('error', noop);   // a reset is an ordinary event here; the 'close' handler cleans up
    const key = ipKey(socket.remoteAddress);
    const open = this.ipConns.get(key) || 0;
    // through the reverse proxy every player arrives from this machine: the per-IP cap waits for X-Forwarded-For (onUpgrade)
    const proxied = this.trustProxy && isLoopbackHost(cleanAddress(socket.remoteAddress));
    if (this.stopping) {
      this.rejectSocket(socket, 503);
      return;
    }
    if (this.maxConnsPerIp && !proxied && open >= this.maxConnsPerIp) {
      this.counters.ip_limit++;
      this.rejectSocket(socket, 429);
      return;
    }
    this.ipConns.set(key, open + 1);
    this.sockets.add(socket);
    const st = { ip: key, timer: null, ws: false, proxied };
    socket[kState] = st;
    socket.once('close', () => {
      clearTimeout(st.timer);
      this.sockets.delete(socket);
      const left = (this.ipConns.get(key) || 1) - 1;
      if (left > 0) this.ipConns.set(key, left);
      else this.ipConns.delete(key);
      if (this.onDrained) this.onDrained();
    });
    try {
      socket.setNoDelay(true);   // no Nagle + delayed-ACK stalls
    } catch { /* already closed */ }
    if (this.handshakeMs) {
      st.timer = setTimeout(() => {
        this.counters.handshake_timeouts++;
        socket.destroy();
      }, this.handshakeMs);
    }
    passToHttp();
  }

  /** The HTTP request head is complete (or the connection is being refused): the handshake deadline is over. */
  endHandshake(socket) {
    const st = socket[kState];
    if (st && st.timer) {
      clearTimeout(st.timer);
      st.timer = null;
    }
  }

  /** Answer with a bodiless error response and close; the socket is destroyed after a moment if the peer lingers. */
  rejectSocket(socket, status, extraHeaders = '') {
    this.endHandshake(socket);
    socket.on('error', noop);
    try {
      socket.end(`HTTP/1.1 ${status} ${STATUS_TEXT[status] || 'Error'}\r\n${extraHeaders}Content-Length: 0\r\nConnection: close\r\n\r\n`);
      socket.resume();   // discard what the peer still sends so closing does not turn into a reset that eats the response
    } catch {
      socket.destroy();
      return;
    }
    const t = setTimeout(() => socket.destroy(), 1000);
    t.unref();
    socket.once('close', () => clearTimeout(t));
  }

  onClientError(err, socket) {
    if (!socket.writable || socket.destroyed) {
      socket.destroy();
      return;
    }
    this.counters.handshake_rejected++;
    this.rejectSocket(socket, err && err.code === 'HPE_HEADER_OVERFLOW' ? 431 : 400);
  }

  guardUpgrade(req, socket, head) {
    socket.on('error', noop);   // the http server dropped its own listener when it handed the socket over
    try {
      this.onUpgrade(req, socket, head);
    } catch (err) {
      this.counters.internal_errors++;
      this.reportError(`[relay] internal error in the handshake:\n${err && err.stack ? err.stack : err}`);
      this.rejectSocket(socket, 503);
    }
  }

  guardRequest(req, res) {
    try {
      this.onRequest(req, res);
    } catch (err) {
      this.counters.internal_errors++;
      this.reportError(`[relay] internal error in a request:\n${err && err.stack ? err.stack : err}`);
      try {
        if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json', Connection: 'close' });
        res.end('{"error":"internal"}');
      } catch {
        req.socket.destroy();
      }
    }
  }

  /** True if a WebSocket upgrade from `origin` to a server addressed as `host` is allowed. */
  originAllowed(origin, host) {
    if (origin === undefined) return true;   // not a browser (tools, tests): there is no page to hijack
    const o = String(origin).trim().toLowerCase();
    if (this.allowedOrigins.has(o)) return true;
    const m = /^(https?):\/\/([^/?#@\s]+)$/.exec(o);
    if (!m || typeof host !== 'string' || !host.trim()) return false;
    // same-origin (the Python relay serves the game page itself). This relay serves no pages, so a page that
    // reaches it as "same-origin" under a domain name is one that rebound that name to this address: refuse it
    return stripDefaultPort(m[2], m[1]) === stripDefaultPort(host.trim().toLowerCase(), m[1]) && this.hostIsPlain(host);
  }

  /**
   * True if a Host header names an address, localhost, this PC or a configured name (an online server's own domain):
   * what a person or tool uses (a rebinding page uses its own domain).
   */
  hostIsPlain(header) {
    const host = hostOnly(header);
    if (net.isIP(host) || host === 'localhost' || this.allowedHosts.has(host)) return true;
    const own = os.hostname().toLowerCase();
    return host === own || host === `${own}.local`;
  }

  onUpgrade(req, socket, head) {
    this.endHandshake(socket);
    const reject = (status, extra, counter) => {
      if (counter) this.counters[counter]++;
      this.rejectSocket(socket, status, extra);
    };
    const path = this.pathOf(req);
    if (path !== WS_PATH) return reject(404);
    if (req.method !== 'GET') return reject(405, 'Allow: GET\r\n');
    const h = req.headers;
    if (req.httpVersion !== '1.1') return reject(400, '', 'handshake_rejected');
    if (!headerTokens(h.upgrade).has('websocket') || !headerTokens(h.connection).has('upgrade')) return reject(400, '', 'handshake_rejected');
    if ((h['sec-websocket-version'] || '').trim() !== '13') return reject(426, 'Sec-WebSocket-Version: 13\r\n', 'handshake_rejected');
    const key = (h['sec-websocket-key'] || '').trim();
    const host = (h.host || '').trim();
    if (!/^[A-Za-z0-9+/]{22}==$/.test(key) || !host) return reject(400, '', 'handshake_rejected');
    // cross-site WebSocket hijacking guard: only the desktop app's page and pages served by this very address may connect
    if (!this.originAllowed(h.origin, host)) return reject(403, '', 'bad_origin');
    if (this.stopping) return reject(503);
    if (this.conns.size >= this.maxConns) return reject(503, '', 'conn_limit');
    const st = socket[kState];
    let addr = cleanAddress(socket.remoteAddress);
    let ip = st ? st.ip : ipKey(socket.remoteAddress);
    const fwd = st && st.proxied ? forwardedFor(h['x-forwarded-for']) : null;
    if (fwd !== null) {
      // the player behind the proxy: limits, logs and the host's peer-join see its own address
      addr = fwd;
      ip = ipKey(fwd);
      const open = this.proxyConns.get(ip) || 0;
      if (this.maxConnsPerIp && open >= this.maxConnsPerIp) return reject(429, '', 'ip_limit');
      this.proxyConns.set(ip, open + 1);
      socket.once('close', () => {
        const left = (this.proxyConns.get(ip) || 1) - 1;
        if (left > 0) this.proxyConns.set(ip, left);
        else this.proxyConns.delete(ip);
      });
    }
    const accept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
    // no Sec-WebSocket-Extensions: permessage-deflate is declined, so RSV bits must stay 0
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    this.adopt(socket, head, addr, ip);
  }

  /**
   * Take over an upgraded socket; `head` holds the bytes the HTTP parser had already buffered (a client may not wait
   * for the 101). `addr` / `ip`: the player's address and per-IP limit key.
   */
  adopt(socket, head, addr, ip) {
    const st = socket[kState];
    if (st) st.ws = true;
    const now = performance.now();
    const c = new Conn(socket, addr, ip, now, { pingMs: this.pingMs, controlBurst: this.controlBurst });
    c.onWritten = () => {
      c.inflight--;
      c.lastProgress = performance.now();
    };
    this.conns.add(c);
    this.counters.connections++;
    socket.on('data', chunk => this.onSocketData(c, chunk));
    socket.on('drain', () => this.onSocketDrain(c));
    socket.on('end', () => this.onSocketGone(c));
    socket.on('close', () => this.onSocketGone(c));
    this.ensureTimer();
    socket.resume();
    if (head && head.length) this.onSocketData(c, head);
  }

  onSocketGone(c) {
    if (c.dead) return;
    try {
      this.drop(c, 'disconnected');
    } catch (err) {
      this.internalError(null, err);
    }
    this.flushDirty();
  }

  onSocketDrain(c) {
    if (c.dead) return;
    c.busy = false;
    c.lastProgress = performance.now();
    try {
      this.flush(c);
    } catch (err) {
      this.internalError(c, err);
    }
    this.flushDirty();
  }

  onSocketData(c, chunk) {
    if (c.dead) return;
    try {
      this.onData(c, chunk);
    } catch (err) {
      this.internalError(c, err);
    }
    this.flushDirty();
  }

  // ---------------------------------------------------------------- HTTP API

  /** The request path without query or fragment, or '' for forms the relay never serves (absolute URIs, `*`). */
  pathOf(req) {
    const url = req.url || '';
    if (url.charCodeAt(0) !== 47) return '';
    const end = url.search(/[?#]/);
    return end < 0 ? url : url.slice(0, end);
  }

  /** CORS: only the desktop app's origin may read /api/* from a page (the caller sets the headers on `headers`). */
  corsHeaders(req, headers) {
    headers.Vary = 'Origin';
    const origin = req.headers.origin;
    if (typeof origin === 'string') {
      const o = origin.trim().toLowerCase();
      if (this.allowedOrigins.has(o)) headers['Access-Control-Allow-Origin'] = o;
    }
  }

  /**
   * DNS-rebinding guard for /api/*: a web page whose own domain name was pointed at this PC counts as same-origin for
   * the browser (no CORS check, no Origin header on a GET) and could read the room list and LAN addresses. Its
   * requests carry its domain in Host, so unless the Origin is an allowed one (the game, whatever name its player
   * typed) the Host must be an IP address, localhost or this PC's own name: what a person or tool would use.
   */
  apiForbidden(req) {
    const origin = req.headers.origin;
    if (typeof origin === 'string' && this.allowedOrigins.has(origin.trim().toLowerCase())) return false;
    return !this.hostIsPlain(req.headers.host);
  }

  sendJson(req, res, status, obj, extra) {
    const body = Buffer.from(JSON.stringify(obj));
    const headers = {
      'Content-Type': 'application/json; charset=utf-8', 'Content-Length': body.length, 'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff', Connection: 'close', ...extra,
    };
    this.corsHeaders(req, headers);
    res.writeHead(status, headers);
    res.end(req.method === 'HEAD' ? undefined : body);
  }

  onRequest(req, res) {
    this.endHandshake(req.socket);
    req.resume();   // bodies are never read
    const path = this.pathOf(req);
    const method = req.method;
    if (path === WS_PATH) {
      // a plain request to /ws is not a valid WebSocket handshake (valid ones arrive as 'upgrade')
      if (method === 'GET') {
        this.counters.handshake_rejected++;
        return this.sendJson(req, res, 400, { error: 'bad-request' });
      }
      return this.sendJson(req, res, 405, { error: 'method-not-allowed' }, { Allow: 'GET' });
    }
    if (path !== '/api/rooms' && (path !== '/api/lan' || !this.lanInfoOn)) return this.sendJson(req, res, 404, { error: 'not-found' });
    if (method === 'OPTIONS') return this.sendPreflight(req, res);
    if (method !== 'GET' && method !== 'HEAD') {
      return this.sendJson(req, res, 405, { error: 'method-not-allowed' }, { Allow: 'GET, HEAD, OPTIONS' });
    }
    if (this.apiForbidden(req)) return this.sendJson(req, res, 403, { error: 'forbidden' });
    if (path === '/api/lan') return this.sendJson(req, res, 200, this.lanInfo());
    return this.sendJson(req, res, 200, { relay: RELAY_VERSION, rooms: this.publicRooms(), listed: this.listRooms });
  }

  /** CORS preflight: answered for the desktop app's origin only (no CORS headers = the browser refuses the request). */
  sendPreflight(req, res) {
    const headers = { Allow: 'GET, HEAD, OPTIONS', 'Content-Length': 0, 'Cache-Control': 'no-store', Connection: 'close' };
    this.corsHeaders(req, headers);
    if (headers['Access-Control-Allow-Origin']) {
      headers['Access-Control-Allow-Methods'] = 'GET, HEAD, OPTIONS';
      headers['Access-Control-Max-Age'] = '600';
      const asked = req.headers['access-control-request-headers'];
      if (typeof asked === 'string' && /^[\w\-, ]{1,200}$/.test(asked)) headers['Access-Control-Allow-Headers'] = asked;
      // Chromium's Private Network Access: a page asking to reach a LAN address wants this acknowledged
      if (req.headers['access-control-request-private-network'] === 'true') headers['Access-Control-Allow-Private-Network'] = 'true';
    }
    res.writeHead(204, headers);
    res.end();
  }

  // ---------------------------------------------------------------- input (RFC 6455 framing)

  onData(c, chunk) {
    c.lastRx = performance.now();
    this.counters.bytes_in += chunk.length;
    if (c.closeRecv) return;                       // nothing may follow the peer's close frame
    let buf = chunk;
    let end = chunk.length;
    if (c.stashLen > 0) {
      // the previous chunk ended inside a frame: continue in the stash (sized for the whole frame once its header is known)
      const want = c.stashLen + chunk.length;
      if (want > c.stash.length) {
        let cap = Math.max(c.need, c.stash.length * 2);
        if (cap > this.maxMessage + 64) cap = this.maxMessage + 64;
        const bigger = Buffer.allocUnsafe(Math.max(cap, want));
        c.stash.copy(bigger, 0, 0, c.stashLen);
        c.stash = bigger;
      }
      chunk.copy(c.stash, c.stashLen);
      c.stashLen = want;
      buf = c.stash;
      end = want;
    }
    let used;
    try {
      used = this.parse(c, buf, 0, end);
    } catch (err) {
      if (!(err instanceof ProtocolError)) throw err;
      this.counters.protocol_errors++;
      c.stashLen = 0;
      this.closeConn(c, err.code, err.reason, 'protocol');
      return;
    }
    if (c.dead) return;                              // a handler dropped the connection: nothing to keep
    if (used >= end) {
      c.stashLen = 0;
      if (c.stash !== null && c.stash.length > 65536) c.stash = null;   // do not keep a megabyte per idle connection
      return;
    }
    const rest = end - used;
    if (buf === c.stash) {
      c.stash.copy(c.stash, 0, used, end);
    } else {
      let cap = Math.max(rest, c.need);
      if (cap > this.maxMessage + 64) cap = this.maxMessage + 64;
      if (c.stash === null || c.stash.length < cap) c.stash = Buffer.allocUnsafe(Math.max(cap, rest, 256));
      chunk.copy(c.stash, 0, used, end);
    }
    c.stashLen = rest;
  }

  /** Handle every complete frame in buf[pos, end); returns the offset of the first byte not consumed. */
  parse(c, buf, pos, end) {
    c.need = 0;
    const maxMessage = this.maxMessage;
    while (end - pos >= 2 && !c.dead && !c.closeRecv) {
      const b0 = buf[pos];
      const b1 = buf[pos + 1];
      if (b0 & 0x70) throw new ProtocolError(CLOSE_PROTOCOL_ERROR, 'reserved bits set');
      if (!(b1 & 0x80)) throw new ProtocolError(CLOSE_PROTOCOL_ERROR, 'client frames must be masked');
      const op = b0 & 0x0f;
      let n = b1 & 0x7f;
      let hl = 2;
      if (n === 126) {
        if (end - pos < 4) break;
        n = (buf[pos + 2] << 8) | buf[pos + 3];
        hl = 4;
      } else if (n === 127) {
        if (end - pos < 10) break;
        const hi = buf.readUInt32BE(pos + 2);
        if (hi >= 0x80000000) throw new ProtocolError(CLOSE_PROTOCOL_ERROR, 'bad frame length');
        n = hi * 4294967296 + buf.readUInt32BE(pos + 6);
        hl = 10;
      }
      if (op >= 0x8) {
        if (n > 125 || !(b0 & 0x80)) throw new ProtocolError(CLOSE_PROTOCOL_ERROR, 'bad control frame');
      } else if (n > maxMessage || c.fragLen + n > maxMessage) {
        throw new ProtocolError(CLOSE_TOO_BIG, 'message too big');   // judged from the header: the payload is never buffered
      }
      const total = hl + 4 + n;
      if (end - pos < total) {
        c.need = total;
        break;
      }
      const k = pos + hl;
      const start = k + 4;
      const k0 = buf[k];
      const k1 = buf[k + 1];
      const k2 = buf[k + 2];
      const k3 = buf[k + 3];
      const fin = (b0 & 0x80) !== 0;
      pos += total;
      if (op === OP_BIN && fin && c.fragOp === 0 && !c.closeSent) {
        // the hot path: a whole binary packet is unmasked straight into the outgoing frame
        this.counters.messages_in++;
        this.routeBinary(c, buf, start, n, k0, k1, k2, k3);
      } else {
        if (n) unmaskInto(buf, start, buf, start, n, k0, k1, k2, k3);   // in place: the buffer is ours
        this.frame(c, fin, op, buf.subarray(start, start + n));
      }
    }
    return pos;
  }

  frame(c, fin, op, payload) {
    if (op === OP_PING) {                          // browsers never ping; tools may
      if (this.controlAllowed(c) && !c.closeSent) this.send(c, encodeFrame(OP_PONG, payload));
      return;
    }
    if (op === OP_PONG) return;
    if (op === OP_CLOSE) {
      this.onCloseFrame(c, payload);
      return;
    }
    if (c.closeSent) return;                       // closing: data frames are discarded
    if (op === OP_CONT) {
      if (!c.fragOp) throw new ProtocolError(CLOSE_PROTOCOL_ERROR, 'unexpected continuation frame');
      this.counters.fragments++;                   // continuation frames (browsers split large messages)
      c.frag.push(Buffer.from(payload));           // copied: the input buffer is reused
      c.fragLen += payload.length;
      if (!fin) return;
      op = c.fragOp;
      payload = c.frag.length === 1 ? c.frag[0] : Buffer.concat(c.frag, c.fragLen);
      c.fragOp = 0;
      c.frag = [];
      c.fragLen = 0;
    } else if (op === OP_TEXT || op === OP_BIN) {
      if (c.fragOp) throw new ProtocolError(CLOSE_PROTOCOL_ERROR, 'expected a continuation frame');
      if (!fin) {
        c.fragOp = op;
        c.frag = [Buffer.from(payload)];
        c.fragLen = payload.length;
        return;
      }
    } else {
      throw new ProtocolError(CLOSE_PROTOCOL_ERROR, `unknown opcode ${op}`);
    }
    this.counters.messages_in++;
    if (op === OP_BIN) this.routeBinary(c, payload, 0, payload.length, 0, 0, 0, 0);
    else this.onText(c, payload);
  }

  onCloseFrame(c, payload) {
    if (payload.length === 1) throw new ProtocolError(CLOSE_PROTOCOL_ERROR, 'bad close frame');
    let code = -1;
    if (payload.length >= 2) {
      code = (payload[0] << 8) | payload[1];
      if (!validCloseCode(code)) throw new ProtocolError(CLOSE_PROTOCOL_ERROR, 'bad close code');
      if (payload.length > 2 && !isUtf8(payload.subarray(2))) throw new ProtocolError(CLOSE_INVALID_DATA, 'invalid close reason');
    }
    c.closeRecv = true;
    if (c.closeSent) {                             // our close was echoed: handshake complete
      c.finish = true;
      this.dirty.add(c);
      return;
    }
    this.detach(c, 'closed');                      // peer closed without {t:'leave'}: keep its slot
    this.queueClose(c, code >= 0 ? encodeFrame(OP_CLOSE, Buffer.from([code >> 8, code & 0xff])) : encodeFrame(OP_CLOSE, Buffer.alloc(0)));
    c.finish = true;
  }

  /** Per-connection token bucket for control messages (text frames, pings): false = drop this one. */
  controlAllowed(c) {
    const rate = this.controlRate;
    if (!rate) return true;
    const now = performance.now();
    c.ctlTokens = Math.min(this.controlBurst, c.ctlTokens + (now - c.ctlAt) * rate / 1000);
    c.ctlAt = now;
    if (c.ctlTokens >= 1) {
      c.ctlTokens -= 1;
      if (c.ctlTokens >= this.controlBurst / 2) c.ctlDrops = 0;
      return true;
    }
    this.counters.control_dropped++;
    if (++c.ctlDrops > this.controlBurst * 10) {
      this.closeConn(c, CLOSE_POLICY, 'too many requests', 'protocol');   // a flood that never lets up
    } else if (now - c.ctlNotified > 1000) {
      c.ctlNotified = now;
      this.send(c, jsonFrame({ t: 'error', reason: 'rate-limited', re: null }));
    }
    return false;
  }

  // ---------------------------------------------------------------- sending

  /** Queue one encoded frame; key >= 0 makes it latest-wins for that key while the socket is backed up. */
  send(c, frame, key = -1) {
    if (c.dead || c.closeSent) return false;
    if (key >= 0 && c.busy) {
      const old = c.latest.get(key);
      if (old !== undefined) {
        this.counters.conflated++;
        c.latestBytes -= old.length;
      }
      c.latest.set(key, frame);
      c.latestBytes += frame.length;
      if (c.qBytes + c.latestBytes > this.maxBacklog) {
        this.slowConsumer(c);
        return false;
      }
      return true;
    }
    if (c.qHead >= c.q.length && c.inflight === 0) c.lastProgress = performance.now();
    c.q.push(frame);
    c.qBytes += frame.length;
    if (c.qBytes + c.latestBytes > this.maxBacklog) {
      this.slowConsumer(c);
      return false;
    }
    if (!c.busy) this.dirty.add(c);                // flushed once per event (batches fan-out)
    return true;
  }

  sendControl(c, obj) {
    return this.send(c, jsonFrame(obj));
  }

  reply(c, obj, rid) {
    if (rid !== null && rid !== undefined) obj.id = rid;
    return this.send(c, jsonFrame(obj));
  }

  error(c, reason, re = null, rid = null, extra = null) {
    const obj = { t: 'error', reason, re };
    if (extra !== null) Object.assign(obj, extra);
    return this.reply(c, obj, rid);
  }

  slowConsumer(c) {
    this.counters.slow_consumers++;
    this.discardUnsent(c);
    this.closeConn(c, CLOSE_TRY_AGAIN_LATER, 'slow consumer', 'slow');
  }

  /** Drop queued frames that have not started to go out (a partly written frame must finish). */
  discardUnsent(c) {
    if (c.qHead < c.q.length && c.headOff > 0) {
      const head = c.q[c.qHead];
      c.q = [head];
      c.qHead = 0;
      c.qBytes = head.length;
    } else {
      c.q = [];
      c.qHead = 0;
      c.qBytes = 0;
      c.headOff = 0;
    }
    c.latest.clear();
    c.latestBytes = 0;
  }

  queueClose(c, frame) {
    if (c.closeSent || c.dead) return;
    if (c.qHead >= c.q.length && c.inflight === 0) c.lastProgress = performance.now();
    c.q.push(frame);
    c.qBytes += frame.length;
    c.closeSent = true;
    c.closeDeadline = performance.now() + this.closeMs;
    c.fragOp = 0;
    c.frag = [];
    c.fragLen = 0;
    this.dirty.add(c);
  }

  /** Server-initiated close: detach from the room now, then the close handshake. */
  closeConn(c, code, reason = '', why = null) {
    if (c.dead || c.closeSent) return;
    if (why !== null) this.detach(c, why);
    this.queueClose(c, encodeClose(code, reason));
  }

  flushDirty() {
    while (this.dirty.size) {
      const batch = this.dirty;
      this.dirty = this.spare;
      this.spare = batch;
      for (const c of batch) {
        if (c.dead) continue;
        try {
          this.flush(c);
        } catch (err) {
          this.internalError(c, err);
        }
      }
      batch.clear();
    }
  }

  /**
   * Hand queued frames to the socket until it pushes back (write() returned false: wait for 'drain'). While it is
   * backed up, latest-wins frames wait in c.latest; once the queue is empty they are released, so a reliable
   * frame can overtake an older latest-wins one, never the reverse.
   */
  flush(c) {
    if (c.dead) return;
    const sock = c.socket;
    while (!c.busy) {
      const q = c.q;
      if (c.qHead >= q.length) {
        if (c.qHead > 0) {
          q.length = 0;
          c.qHead = 0;
        }
        if (c.latest.size === 0 || c.closeSent) break;
        for (const f of c.latest.values()) q.push(f);   // the socket drained: release the latest-wins slots
        c.qBytes += c.latestBytes;
        c.latest.clear();
        c.latestBytes = 0;
      }
      if (sock.destroyed || !sock.writable) break;      // 'close' follows and drops the connection
      const i = c.qHead;
      const first = q[i];
      const avail = first.length - c.headOff;
      let used = avail < WRITE_CHUNK ? avail : WRITE_CHUNK;
      let j = i + 1;
      if (avail < WRITE_CHUNK) {                        // coalesce small frames into one write
        while (j < q.length && used + q[j].length <= WRITE_CHUNK) used += q[j++].length;
      }
      let data;
      if (j === i + 1) {                                // one frame, or a piece of one: no copy
        data = c.headOff === 0 && used === first.length ? first : first.subarray(c.headOff, c.headOff + used);
      } else {
        data = Buffer.allocUnsafe(used);
        let off = first.copy(data, 0, c.headOff);
        for (let k = i + 1; k < j; k++) off += q[k].copy(data, off);
      }
      this.advance(c, used);
      if (c.inflight === 0) c.lastProgress = performance.now();
      c.inflight++;
      this.counters.bytes_out += used;
      if (!sock.write(data, c.onWritten)) c.busy = true;
    }
    if (c.finish && c.qHead >= c.q.length && !c.dead) this.drop(c, null, true);
  }

  /** Account for `used` bytes taken off the front of the queue. */
  advance(c, used) {
    const q = c.q;
    let n = used;
    while (n > 0) {
      const head = q[c.qHead];
      const rem = head.length - c.headOff;
      if (n >= rem) {
        n -= rem;
        c.qBytes -= head.length;
        q[c.qHead++] = null;
        c.headOff = 0;
        this.counters.frames_out++;
      } else {
        c.headOff += n;
        n = 0;
      }
    }
    if (c.qHead >= q.length) {
      q.length = 0;
      c.qHead = 0;
    } else if (c.qHead >= 1024 && c.qHead * 2 >= q.length) {
      q.splice(0, c.qHead);                              // a long-lived backlog must not keep its consumed slots
      c.qHead = 0;
    }
  }

  /** Tear the connection down now (after the close handshake, on EOF / errors / timeouts). `graceful`: flush, then FIN. */
  drop(c, why, graceful = false) {
    if (c.dead) return;
    c.dead = true;
    if (c.room !== null) this.detach(c, why || 'disconnected');
    this.dirty.delete(c);
    c.q = [];
    c.qHead = 0;
    c.qBytes = 0;
    c.latest.clear();
    c.latestBytes = 0;
    c.frag = [];
    c.stash = null;
    c.stashLen = 0;
    this.conns.delete(c);
    this.counters.connections_closed++;
    const sock = c.socket;
    if (graceful && !sock.destroyed) {
      try {
        sock.end();
      } catch { /* already closed */ }
      const t = setTimeout(() => sock.destroy(), Math.max(this.closeMs, 200));   // a peer that never closes its side
      t.unref();
      sock.once('close', () => clearTimeout(t));
    } else {
      sock.destroy();
    }
  }

  // ---------------------------------------------------------------- timers

  ensureTimer() {
    if (this.timer || this.stopping) return;
    this.timer = setInterval(() => this.tick(), TIMER_STEP_MS);
  }

  tick() {
    const now = performance.now();
    for (const c of this.conns) {
      if (c.dead) continue;
      try {
        if (c.closeSent) {
          if (now >= c.closeDeadline) this.drop(c, null);   // no close echo in time
          continue;
        }
        if (c.busy && now - c.lastProgress > this.stallMs) {
          this.counters.stalled++;
          this.drop(c, 'stalled');
          continue;
        }
        if (now - c.lastRx > this.idleMs) {
          this.counters.idle_timeouts++;
          this.closeConn(c, CLOSE_GOING_AWAY, 'idle timeout', 'timeout');
          continue;
        }
        if (now >= c.nextPing) {
          c.nextPing = now + this.pingMs;
          this.send(c, PING_FRAME);
        }
      } catch (err) {
        this.internalError(c, err);
      }
    }
    try {
      if (now >= this.nextExpiryScan) {
        this.nextExpiryScan = now + 250;
        this.expireSlots(now);
      }
      if (now >= this.nextPrune) {
        this.nextPrune = now + 5000;
        this.joinLimiter.prune(now);
      }
    } catch (err) {
      this.internalError(null, err);
    }
    if (this.conns.size === 0 && this.timer) {              // nothing to watch: no wake-ups while idle
      clearInterval(this.timer);
      this.timer = null;
    }
    this.flushDirty();
  }

  expireSlots(now) {
    for (const room of this.rooms.values()) {
      for (const slot of room.slots.values()) {
        if (slot.conn !== null || slot.expires === null || now < slot.expires) continue;
        this.counters.expired++;
        this.removeSlot(room, slot);
        if (room.host !== null && !room.host.dead) {
          this.sendControl(room.host, { t: 'peer-leave', peer: slot.peer, reason: 'expired', reserved: false });
        }
        this.logEvent(`room ${room.code}: slot ${slot.peer} (${slot.name}) expired`);
      }
    }
  }

  // ---------------------------------------------------------------- rooms

  removeSlot(room, slot) {
    if (room.slots.get(slot.peer) === slot) room.slots.delete(slot.peer);
    room.tokens.delete(slot.token);
  }

  /** Take `c` out of its room. The host leaving closes the room. */
  detach(c, why) {
    const room = c.room;
    if (room === null) return;
    c.room = null;
    if (c.peer === HOST_PEER) {
      this.closeRoom(room, 'host-left');
      return;
    }
    const slot = room.slots.get(c.peer);
    if (slot === undefined || slot.conn !== c) return;
    slot.conn = null;
    const reserved = RESERVED_REASONS.has(why);
    if (reserved) slot.expires = performance.now() + this.reserveMs;
    else this.removeSlot(room, slot);
    if (room.host !== null) this.sendControl(room.host, { t: 'peer-leave', peer: c.peer, reason: why, reserved });
    this.logEvent(`room ${room.code}: ${slot.name} (peer ${c.peer}) left: ${why}${reserved ? ' - slot reserved' : ''}`);
  }

  closeRoom(room, reason) {
    if (this.rooms.get(room.code) === room) this.rooms.delete(room.code);
    this.counters.rooms_closed++;
    room.host = null;
    for (const slot of Array.from(room.slots.values())) {
      const conn = slot.conn;
      slot.conn = null;
      if (conn !== null && !conn.dead) {
        conn.room = null;
        this.sendControl(conn, { t: 'room-closed', code: room.code, reason });
        this.closeConn(conn, CLOSE_ROOM_CLOSED, reason.replace(/-/g, ' '));
      }
    }
    room.slots.clear();
    room.tokens.clear();
    this.logEvent(`room ${room.code} closed (${reason})`);
  }

  // ---------------------------------------------------------------- control plane

  onText(c, payload) {
    if (!this.controlAllowed(c)) return;
    if (!isUtf8(payload)) throw new ProtocolError(CLOSE_INVALID_DATA, 'invalid utf-8');
    this.counters.control_in++;
    let msg;
    try {
      msg = parseControl(payload.toString('utf8'));
    } catch {
      this.error(c, 'bad-message');
      return;
    }
    if (msg === null || typeof msg !== 'object' || Array.isArray(msg)) {
      this.error(c, 'bad-message');
      return;
    }
    const t = msg.t;
    const handler = typeof t === 'string' ? this.handlers.get(t) : undefined;
    if (handler === undefined) {
      this.error(c, 'bad-message', typeof t === 'string' ? t : null, requestId(msg));
      return;
    }
    if (this.faults !== null && this.faults.delete(t)) throw new Error(`injected fault in '${t}'`);
    handler.call(this, c, msg, requestId(msg));
  }

  /** True if `given` is the host key (or none is configured). */
  hostKeyOk(given) {
    if (this.hostKeyHash === null) return true;
    if (typeof given !== 'string' || !given || given.length > MAX_HOST_KEY) return false;
    return crypto.timingSafeEqual(crypto.createHash('sha256').update(given.trim(), 'utf8').digest(), this.hostKeyHash);
  }

  ctlHost(c, m, rid) {
    if (c.room !== null) return this.error(c, 'already-in-room', 'host', rid);
    if (!this.joinLimiter.take(c.ip, performance.now())) {
      this.counters.rate_limited++;
      return this.error(c, 'rate-limited', 'host', rid);
    }
    // a guess costs a rate-limit token (above), so the key cannot be brute-forced
    if (!this.hostKeyOk(m.key)) {
      this.counters.host_key_rejected++;
      this.logEvent(`host request from ${c.addr} refused: ${m.key ? 'wrong' : 'no'} host key`);
      return this.error(c, 'host-key', 'host', rid);
    }
    const name = cleanText(m.name, 'KINETIC', 32);
    const maxPeers = Math.max(2, Math.min(this.maxRoomPeers, toInt(m.max, 8)));
    const v = typeof m.v === 'string' || (typeof m.v === 'number' && Number.isInteger(m.v)) ? m.v : null;
    const meta = m.meta === undefined || m.meta === null ? null : m.meta;
    if (meta !== null && !metaOk(meta)) return this.error(c, 'bad-message', 'host', rid);
    const want = m.code !== undefined && m.code !== null ? normalizeCode(m.code) : null;
    if (this.rooms.size >= this.maxRooms) return this.error(c, 'server-full', 'host', rid);
    if (want !== null && !validCode(want)) return this.error(c, 'bad-code', 'host', rid);
    if (want !== null && this.rooms.has(want)) return this.error(c, 'code-taken', 'host', rid);
    const code = want !== null ? want : newCode(this.rooms);
    const room = new Room(code, name, c, maxPeers, m.public !== false, v);
    if (meta !== null) room.meta = meta;
    this.rooms.set(code, room);
    this.counters.rooms_opened++;
    c.room = room;
    c.peer = HOST_PEER;
    c.name = name;
    this.reply(c, { t: 'hosted', code, peer: HOST_PEER, max: maxPeers }, rid);
    this.logEvent(`room ${code} opened by ${c.addr} (${name}, max ${maxPeers})`);
  }

  ctlJoin(c, m, rid) {
    if (c.room !== null) return this.error(c, 'already-in-room', 'join', rid);
    const code = normalizeCode(m.code);
    const room = this.rooms.get(code);
    const token = m.token;
    let slot = room !== undefined && typeof token === 'string' && token ? room.tokens.get(token) : undefined;
    // a valid reconnect token is not a guess (144 random bits), so rejoining is not charged; every other attempt is
    if (slot === undefined && !this.joinLimiter.take(c.ip, performance.now())) {
      this.counters.rate_limited++;
      return this.error(c, 'rate-limited', 'join', rid);
    }
    if (room === undefined) return this.error(c, 'no-such-room', 'join', rid);
    if (room.v !== null && m.v !== room.v) return this.error(c, 'version-mismatch', 'join', rid, { v: room.v });
    const name = cleanText(m.name, 'Player', 24);
    let rejoin;
    if (slot !== undefined) {
      const old = slot.conn;
      if (old !== null && old !== c) {
        // the same player on a new connection (reload / network change): the old one is replaced
        old.room = null;
        slot.conn = null;
        if (room.host !== null) this.sendControl(room.host, { t: 'peer-leave', peer: slot.peer, reason: 'replaced', reserved: true });
        this.closeConn(old, CLOSE_REPLACED, 'replaced');
      }
      slot.conn = c;
      slot.expires = null;
      slot.name = name;
      slot.addr = c.addr;
      rejoin = true;
      this.counters.rejoins++;
    } else if (m.rejoin === true) {
      // an automatic reconnect may only reclaim its own slot: it is gone (kicked while away, or expired), so this
      // player must not come back as a new one behind the host's back
      return this.error(c, 'slot-lost', 'join', rid);
    } else {
      if (room.locked) return this.error(c, 'room-locked', 'join', rid);
      if (1 + room.slots.size >= room.maxPeers) return this.error(c, 'room-full', 'join', rid);
      let peer = 0;
      for (let i = 1; i <= MAX_CLIENT_PEER; i++) {
        if (!room.slots.has(i)) {
          peer = i;
          break;
        }
      }
      if (peer === 0) return this.error(c, 'room-full', 'join', rid);
      slot = new Slot(peer, newToken(), name, c, c.addr);
      room.slots.set(peer, slot);
      room.tokens.set(slot.token, slot);
      rejoin = false;
      this.counters.joins++;
    }
    c.room = room;
    c.peer = slot.peer;
    c.name = name;
    this.reply(c, { t: 'joined', code: room.code, peer: slot.peer, token: slot.token, rejoin, room: room.info() }, rid);
    if (room.host !== null) this.sendControl(room.host, { t: 'peer-join', peer: slot.peer, name, addr: c.addr, rejoin });
    this.logEvent(`room ${room.code}: ${name} ${rejoin ? 'rejoined' : 'joined'} as peer ${slot.peer} from ${c.addr}`);
  }

  ctlLeave(c, m, rid) {
    const room = c.room;
    const code = room !== null ? room.code : null;
    this.detach(c, 'left');
    this.reply(c, { t: 'left', code }, rid);
  }

  ctlList(c, m, rid) {
    this.reply(c, { t: 'rooms', rooms: this.publicRooms(), listed: this.listRooms }, rid);
  }

  ctlPing(c, m, rid) {
    this.reply(c, { t: 'pong', c: m.c === undefined ? null : m.c, s: Math.round((performance.timeOrigin + performance.now()) * 1000) / 1000 }, rid);
  }

  /** The caller's room if it is the host of one; otherwise replies with the error and returns null. */
  hostRoom(c, re, rid) {
    if (c.room === null) {
      this.error(c, 'not-in-room', re, rid);
      return null;
    }
    if (c.peer !== HOST_PEER) {
      this.error(c, 'not-host', re, rid);
      return null;
    }
    return c.room;
  }

  ctlKick(c, m, rid) {
    const room = this.hostRoom(c, 'kick', rid);
    if (room === null) return;
    const peer = toInt(m.peer, -1);
    const slot = room.slots.get(peer);
    if (slot === undefined) return this.error(c, 'no-such-peer', 'kick', rid);
    this.counters.kicks++;
    const target = slot.conn;
    slot.conn = null;
    this.removeSlot(room, slot);
    this.sendControl(c, { t: 'peer-leave', peer, reason: 'kicked', reserved: false });
    if (target !== null && !target.dead) {
      target.room = null;
      this.closeConn(target, CLOSE_KICKED, cleanText(m.reason, 'kicked', 60));
    }
    this.logEvent(`room ${room.code}: ${slot.name} (peer ${peer}) was kicked`);
    if (rid !== null) this.reply(c, { t: 'ok', re: 'kick' }, rid);
  }

  ctlLock(c, m, rid) {
    const room = this.hostRoom(c, 'lock', rid);
    if (room === null) return;
    room.locked = m.locked !== false;
    if (rid !== null) this.reply(c, { t: 'ok', re: 'lock', locked: room.locked }, rid);
  }

  ctlMeta(c, m, rid) {
    const room = this.hostRoom(c, 'meta', rid);
    if (room === null) return;
    if (!metaOk(m.meta)) return this.error(c, 'bad-message', 'meta', rid);
    room.meta = m.meta;
    if (rid !== null) this.reply(c, { t: 'ok', re: 'meta' }, rid);
  }

  ctlSignal(c, m, rid) {
    const room = c.room;
    if (room === null) return this.error(c, 'not-in-room', 'signal', rid);
    const to = toInt(m.to, -1);
    let dst = null;
    if (to === HOST_PEER) {
      dst = room.host;
    } else {
      const slot = room.slots.get(to);
      if (slot !== undefined) dst = slot.conn;
    }
    if (dst === null || dst === c) return this.error(c, 'no-such-peer', 'signal', rid);
    this.sendControl(dst, { t: 'signal', from: c.peer, data: m.data === undefined ? null : m.data });
    if (rid !== null) this.reply(c, { t: 'ok', re: 'signal' }, rid);
  }

  // ---------------------------------------------------------------- data plane

  /** A frame for the output queue: the 2-byte header + the packet unmasked from src[s, s+n); senderId >= 0 rewrites byte 0. */
  binaryFrame(src, s, n, k0, k1, k2, k3, senderId) {
    const hl = frameHeaderLength(n);
    const out = Buffer.allocUnsafe(hl + n);
    writeFrameHeader(out, OP_BIN, n);
    unmaskInto(out, hl, src, s, n, k0, k1, k2, k3);
    if (senderId >= 0) out[hl] = senderId;                // byte0 = sender id, whatever the client wrote
    return out;
  }

  /**
   * Route one binary message (src[s, s+n), still masked with k0..k3, or plain with a zero key). A client's packet
   * goes to the host; the host's goes to the peer in byte 0, or to every client for 255. Routing is blind: only
   * the type byte decides latest-wins handling.
   */
  routeBinary(c, src, s, n, k0, k1, k2, k3) {
    const room = c.room;
    if (room === null || n < 2) {
      this.counters.packets_dropped++;
      return;
    }
    const typ = src[s + 1] ^ k1;
    if (c.peer === HOST_PEER) {
      const dst = src[s] ^ k0;
      const key = typ >= LATEST_WINS_MIN_TYPE ? typ : -1;
      if (dst === BROADCAST) {
        let any = false;
        for (const slot of room.slots.values()) {
          if (slot.conn !== null) {
            any = true;
            break;
          }
        }
        if (!any) return;
        const frame = this.binaryFrame(src, s, n, k0, k1, k2, k3, -1);   // one frame shared by every receiver
        let sent = 0;
        for (const slot of room.slots.values()) {            // a send may close a slow consumer: Map iteration copes
          const conn = slot.conn;
          if (conn !== null) {
            this.send(conn, frame, key);
            sent++;
          }
        }
        this.counters.packets_routed += sent;
        return;
      }
      const slot = room.slots.get(dst);
      if (slot === undefined || slot.conn === null) {
        this.counters.packets_dropped++;
        return;
      }
      this.send(slot.conn, this.binaryFrame(src, s, n, k0, k1, k2, k3, -1), key);
      this.counters.packets_routed++;
      return;
    }
    const host = room.host;
    if (host === null || host.dead) {
      this.counters.packets_dropped++;
      return;
    }
    this.send(host, this.binaryFrame(src, s, n, k0, k1, k2, k3, c.peer), typ >= LATEST_WINS_MIN_TYPE ? (c.peer << 8) | typ : -1);
    this.counters.packets_routed++;
  }
}

// ------------------------------------------------------------------------------------------------ public API

/**
 * Create a relay (it does not listen until `listen()` is called).
 * @param {object} [options] netserver.py's DEFAULTS keys (camelCase or snake_case), the hardening limits (see
 *   DEFAULTS), `log(text)` for room events and `errorLog(text)` for internal errors (default: console.error)
 * @returns {{listen: function, close: function, stats: function, lanInfo: function, rooms: function}}
 *   listen({host = '0.0.0.0', port = 27500}) -> Promise<{host, port}>; close() -> Promise<void>; stats() -> counters,
 *   rooms and queue state; lanInfo() -> the /api/lan payload; rooms() -> the open public rooms
 */
function createRelay(options = {}) {
  const relay = new Relay(options);
  const api = {
    listen: where => relay.listen(where),
    close: () => relay.close(),
    stats: () => relay.stats(),
    lanInfo: () => relay.lanInfo(),
    rooms: () => relay.publicRooms(),
  };
  if (options.testHooks) api.armFault = t => relay.armFault(t);
  return api;
}

// ------------------------------------------------------------------------------------------------ command line

const USAGE = `KINETIC relay (headless dedicated server)

  node desktop/relay.js [--port 27500] [--host 0.0.0.0] [--loopback] [--quiet] [options]

  --port N             TCP port (default ${DEFAULT_PORT}; 0 picks a free one)
  --host ADDR          address to listen on (default 0.0.0.0: every interface, so friends on the LAN can connect)
  --loopback           listen on 127.0.0.1 only (no firewall prompt, nobody else can connect)
  --quiet              do not print room / player events
  --allow-origin O     also accept browser pages from origin O (repeatable; default: kinetic://game)

  online server (server/install.sh sets these up):
  --host-key-file F    only players who give the key in file F may host (or set KINETIC_HOST_KEY); joining needs no key
  --trust-proxy        connections from this machine come from a reverse proxy (Caddy): the player is the right-most
                       X-Forwarded-For address (per-IP limits, logs)
  --allow-host NAME    /api/* also answers requests addressed to NAME, the server's domain (repeatable)
  --no-room-list       do not list rooms (/api/rooms and 'list' answer an empty list): players join by room code
  --no-lan-info        /api/lan answers 404

  options in seconds: --ping-interval ${DEFAULTS.pingInterval}  --idle-timeout ${DEFAULTS.idleTimeout}  --stall-timeout ${DEFAULTS.stallTimeout}  --close-timeout ${DEFAULTS.closeTimeout}  --reserve-timeout ${DEFAULTS.reserveTimeout}
                      --handshake-timeout ${DEFAULTS.handshakeTimeout}  --join-window ${DEFAULTS.joinWindow}
  options in bytes:   --max-message ${DEFAULTS.maxMessage}  --max-backlog ${DEFAULTS.maxBacklog}  --max-header-bytes ${DEFAULTS.maxHeaderBytes}
  options in counts:  --max-rooms ${DEFAULTS.maxRooms}  --max-room-peers ${DEFAULTS.maxRoomPeers}  --max-conns ${DEFAULTS.maxConns}  --max-conns-per-ip ${DEFAULTS.maxConnsPerIp}
                      --join-rate ${DEFAULTS.joinRate} (host/join requests per window and IP)  --control-rate ${DEFAULTS.controlRate}  --control-burst ${DEFAULTS.controlBurst}
  0 switches a hardening limit off.  --test-hooks reads the stdin commands "stats", "fault <type>" and "shutdown" (for tests; EOF on stdin stops the relay).
`;

/** DEFAULTS keys that are not plain numbers on the command line (they have flags of their own). */
const SPECIAL_KEYS = new Set(['allowedOrigins', 'allowedHosts', 'hostKey', 'trustProxy', 'listRooms', 'lanInfo']);
const VALUE_FLAGS = new Set(['port', 'host', 'allow-origin', 'allow-host', 'host-key-file']);

/**
 * Parse argv (without node and the script); returns {port, host, quiet, testHooks, hostKeyFile, options} or {help} /
 * {error}. The host key itself is read by main() (from the file, or KINETIC_HOST_KEY): never from the command line,
 * where every user of the machine could read it.
 */
function parseArgs(argv) {
  const out = { port: DEFAULT_PORT, host: '0.0.0.0', quiet: false, testHooks: false, hostKeyFile: '', options: {} };
  const origins = [];
  const hosts = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') return { help: true };
    if (arg === '--loopback') out.host = '127.0.0.1';
    else if (arg === '--quiet') out.quiet = true;
    else if (arg === '--test-hooks') out.testHooks = true;
    else if (arg === '--trust-proxy') out.options.trustProxy = 1;
    else if (arg === '--no-room-list') out.options.listRooms = 0;
    else if (arg === '--no-lan-info') out.options.lanInfo = 0;
    else if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      const name = eq < 0 ? arg.slice(2) : arg.slice(2, eq);
      const key = camel(name.replace(/-/g, '_'));
      const isOption = Object.prototype.hasOwnProperty.call(DEFAULTS, key) && !SPECIAL_KEYS.has(key);
      if (!VALUE_FLAGS.has(name) && !isOption) return { error: `unknown option ${arg}` };
      let value;
      if (eq >= 0) value = arg.slice(eq + 1);
      else if (i + 1 < argv.length) value = argv[++i];
      else return { error: `${arg} needs a value` };
      if (name === 'port') {
        out.port = Number(value);
        if (!Number.isInteger(out.port) || out.port < 0 || out.port > 65535) return { error: `bad port: ${value}` };
      } else if (name === 'host') out.host = value;
      else if (name === 'allow-origin') origins.push(value);
      else if (name === 'allow-host') hosts.push(value);
      else if (name === 'host-key-file') out.hostKeyFile = value;
      else {
        const n = Number(value);
        if (!Number.isFinite(n) || n < 0) return { error: `${arg} needs a number >= 0` };
        out.options[key] = n;
      }
    } else return { error: `unexpected argument ${arg}` };
  }
  if (origins.length) out.options.allowedOrigins = DEFAULTS.allowedOrigins.concat(origins);
  if (hosts.length) out.options.allowedHosts = hosts;
  return out;
}

/**
 * The host key: the first line of `file` (when given), else the environment's KINETIC_HOST_KEY; '' for none.
 * Throws a message for the operator if the file cannot be read or the key is unusable.
 */
function readHostKey(file, env = process.env) {
  let key = '';
  if (file) {
    let text;
    try {
      text = require('node:fs').readFileSync(file, 'utf8');
    } catch (err) {
      throw new Error(`cannot read the host key file ${file}: ${err && err.code ? err.code : err}`);
    }
    key = text.split(/\r?\n/)[0].trim();
    if (!key) throw new Error(`the host key file ${file} is empty`);
  } else {
    key = String(env.KINETIC_HOST_KEY || '').trim();
  }
  if (key.length > MAX_HOST_KEY) throw new Error(`the host key is longer than ${MAX_HOST_KEY} characters`);
  return key;
}

function stamp() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `[${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}] `;
}

/**
 * A logger whose console writes happen on a worker thread. A Windows console in QuickEdit mode blocks every write
 * while the user has text selected (to copy the address, say); a relay that waits for the console would stall every
 * match on it. fs.writeSync in the worker blocks only the worker. Falls back to console when threads are missing.
 * @param {1|2} fd 1 = stdout, 2 = stderr
 * @returns {function(string): void}
 */
function threadedLogger(fd) {
  try {
    const { Worker } = require('node:worker_threads');
    const worker = new Worker(
      "const { parentPort, workerData } = require('node:worker_threads'); const fs = require('node:fs');" +
      "parentPort.on('message', text => { try { fs.writeSync(workerData, text + '\\n'); } catch { /* console gone */ } });",
      { eval: true, workerData: fd });
    worker.on('error', () => {});
    worker.unref();
    return text => worker.postMessage(stamp() + text);
  } catch {
    return text => (fd === 2 ? console.error : console.log)(stamp() + text);
  }
}

/** The message a player can act on when listen() fails. */
function listenErrorText(err, port) {
  if (err && err.code === 'EADDRINUSE') return `Port ${port} is already in use. Close the other program, or use another port.`;
  if (err && err.code === 'EACCES') {
    return `Windows does not allow port ${port} right now: another program holds it, or it lies in a range Windows reserves ` +
      '(Hyper-V, WSL, Docker; list them: netsh interface ipv4 show excludedportrange protocol=tcp).';
  }
  return `Could not listen on port ${port}: ${err && err.message}`;
}

async function main(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(USAGE);
    return 0;
  }
  if (args.error) {
    console.error(`${args.error}\n\n${USAGE}`);
    return 2;
  }
  let hostKey;
  try {
    hostKey = readHostKey(args.hostKeyFile);
  } catch (err) {
    console.error(err.message);
    return 2;
  }
  const relay = createRelay({
    ...args.options,
    hostKey,
    testHooks: args.testHooks,
    log: args.quiet ? null : threadedLogger(1),
    errorLog: threadedLogger(2),
  });
  let bound;
  try {
    bound = await relay.listen({ host: args.host, port: args.port });
  } catch (err) {
    console.error(listenErrorText(err, args.port));
    return 1;
  }
  const info = relay.lanInfo();
  const proxy = !!args.options.trustProxy;
  console.log(`KINETIC relay ${RELAY_VERSION} on port ${bound.port}  (Ctrl+C to stop)`);
  if (info.lan) {
    if (info.ips.length) {
      console.log(`  Friends: ${info.urls.join('   ')}   (address:port and the room code go into the game's Join screen)`);
      console.log(`  or by PC name: ${info.hostUrl}   (works on many home networks)`);
    } else {
      console.log('  No network address found - is this PC on Wi-Fi or Ethernet?');
    }
    console.log(`  Over the internet: TCP port ${bound.port} must reach this machine (at home: forward it on your router).`);
    if (process.platform === 'win32') {
      console.log('  Windows Firewall may ask once whether to allow it: tick "Private networks" and click "Allow access".');
    }
  } else if (proxy) {
    console.log(`  Listening on ${bound.host} only: players arrive through the reverse proxy on this machine.`);
  } else {
    console.log(`  Listening on ${bound.host} only: other machines cannot connect.`);
  }
  if (hostKey) console.log('  Hosting needs the host key; players join with just the room code.');
  if (args.options.listRooms === 0) console.log('  Rooms are not listed: players join by room code.');
  console.log(`KINETIC relay ready on ${bound.host} port ${bound.port}`);

  for (const stream of [process.stdout, process.stderr]) stream.on('error', noop);   // a closed pipe (EPIPE) is not a reason to die
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    relay.close().then(() => process.exit(0), () => process.exit(1));
  };
  if (args.testHooks) {
    // tests drive the process over stdin: no network surface, and only when the operator asked for it. The parent
    // closing its end (it died, or is done) stops the relay, so a crashed test run leaves no process behind.
    const rl = require('node:readline').createInterface({ input: process.stdin });
    rl.on('line', line => {
      const [cmd, arg] = line.trim().split(/\s+/);
      if (cmd === 'stats') console.log('@stats ' + JSON.stringify(relay.stats()));
      else if (cmd === 'fault' && arg) relay.armFault(arg);
      else if (cmd === 'shutdown') stop();
    });
    rl.on('close', stop);
  }
  // a stray exception must not take every room down with it; each handler is guarded already, this is the last net
  process.on('uncaughtException', err => console.error(stamp() + `[relay] uncaught: ${err && err.stack ? err.stack : err}`));
  process.on('unhandledRejection', err => console.error(stamp() + `[relay] unhandled rejection: ${err && err.stack ? err.stack : err}`));
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGBREAK']) process.on(sig, stop);
  return null;   // keep running: the listening socket holds the process open
}

module.exports = {
  createRelay, DEFAULTS, DEFAULT_PORT, RELAY_VERSION, APP_ORIGIN, CODE_ALPHABET,
  // helpers, exported for the unit tests
  rankIpv4s, lanIpv4s, interfaceIpv4s, isLoopbackHost, ipKey, normalizeCode, validCode, newCode, cleanText, parseControl, metaOk,
  encodeClose, parseArgs, listenErrorText, forwardedFor, readHostKey,
};

if (require.main === module) {
  main(process.argv.slice(2)).then(code => {
    if (code !== null) process.exitCode = code;
  }, err => {
    console.error(err && err.stack ? err.stack : err);
    process.exitCode = 1;
  });
}

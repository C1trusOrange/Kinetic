import { Transport } from './Transport.js';
import { PROTOCOL_VERSION, RELAY_PATH, HOST_PEER, BROADCAST, MAX_PEER, LATEST_WINS, CLOSE, normalizeCode } from './protocol.js';

const TOKEN_PREFIX = 'kinetic.net.token.';
const RETRY_DELAYS_MS = [250, 500, 1000, 2000, 3000];
const REQUEST_TIMEOUT_MS = 15000;
const KEEPALIVE_MS = 5000;   // nothing received for this long -> app-level ping (browsers cannot send WS pings)
const DEAD_MS = 10000;       // that ping unanswered for this long -> the connection is dead
// join errors after which retrying cannot help ('slot-lost': kicked while away, or the reserved slot expired)
const FATAL_REJOIN = new Set(['no-such-room', 'room-full', 'room-locked', 'version-mismatch', 'slot-lost']);

function netError(reason, extra) {
  const err = new Error(`relay: ${reason}`);
  err.reason = reason;
  return extra ? Object.assign(err, extra) : err;
}

// Reconnect tokens live in sessionStorage: per tab, survive a reload, gone when the tab closes.
function loadToken(code) {
  try { return sessionStorage.getItem(TOKEN_PREFIX + code) || ''; } catch { return ''; }
}
function saveToken(code, token) {
  try { sessionStorage.setItem(TOKEN_PREFIX + code, token); } catch { /* storage unavailable */ }
}
function clearToken(code) {
  try { sessionStorage.removeItem(TOKEN_PREFIX + code); } catch { /* storage unavailable */ }
}

/** Detach a socket from the transport and close it (a still-connecting one right after it opens). */
function silence(ws) {
  ws.onmessage = ws.onclose = ws.onerror = null;
  if (ws.readyState === WebSocket.CONNECTING) ws.onopen = () => ws.close();
  else {
    ws.onopen = null;
    if (ws.readyState === WebSocket.OPEN) ws.close();
  }
}

function closeReason(code) {
  switch (code) {
    case CLOSE.ROOM_CLOSED: return 'room-closed';
    case CLOSE.KICKED: return 'kicked';
    case CLOSE.REPLACED: return 'replaced';
    case CLOSE.SLOW: return 'slow';
    case CLOSE.GOING_AWAY: return 'going-away';
    case CLOSE.PROTOCOL: case CLOSE.INVALID_DATA: case CLOSE.TOO_BIG: case CLOSE.INTERNAL: return 'protocol';
    default: return 'closed';
  }
}

/**
 * Transport over the LAN relay's WebSocket (tools/netserver.py, served by tools/serve.py on the host PC,
 * same address that served the page, so it also works through an https tunnel as wss://).
 *
 * Clients whose connection drops (Wi-Fi hiccup, relay restart, page reload) rejoin automatically with
 * their reconnect token and get the same peer id back: state goes 'reconnecting' -> 'in-room' and the
 * host sees onPeerLeave({reserved: true}) then onPeerJoin({rejoin: true}). Works from insecure http://
 * LAN origins (no crypto.randomUUID / subtle / clipboard).
 */
export class WsRelayTransport extends Transport {
  /**
   * @param {object} [opts]
   * @param {string} [opts.url] relay URL (default `${ws|wss}://${location.host}/ws`)
   * @param {number} [opts.version=PROTOCOL_VERSION] sent with host/join; joins with another version are refused
   * @param {boolean} [opts.reconnect=true] clients: rejoin automatically after an unexpected disconnect
   * @param {number} [opts.reconnectWindow=30] seconds to keep trying before onClose('reconnect-failed')
   * @param {number} [opts.maxBuffered=262144] latest-wins packets are dropped (not queued) while more than
   *   this many bytes wait in the socket, so a congested link never delivers stale snapshots / inputs late
   */
  constructor(opts = {}) {
    super();
    this.url = opts.url || WsRelayTransport.defaultUrl();
    this.version = opts.version ?? PROTOCOL_VERSION;
    this.reconnect = opts.reconnect !== false;
    this.reconnectWindow = opts.reconnectWindow ?? 30;
    this.maxBuffered = opts.maxBuffered ?? 262144;
    /** Name used for (re)joins. */
    this.name = '';
    /** Reconnect token of the current slot (clients). */
    this.token = '';
    /** The current WebSocket (null while disconnected). */
    this.ws = null;
    /** performance.now() of the last message from the relay. */
    this.lastRecvAt = 0;
    this.stats = { packetsIn: 0, packetsOut: 0, bytesIn: 0, bytesOut: 0, dropped: 0, reconnects: 0 };
    this._nextId = 1;
    this._pending = new Map();   // request id -> {resolve, reject, timer}
    this._connecting = null;
    this._opening = null;        // {ws, reject} while a socket is still connecting
    this._closing = false;       // close() was called: never reconnect
    this._retry = null;          // {until, attempt, timer} while reconnecting
    this._keepalive = 0;
    this._pingSentAt = 0;
    this._roomClosedReason = '';
    this._entering = false;      // host() / join() in flight
  }

  /** ws:// or wss:// URL of the relay on the server that served this page. */
  static defaultUrl() {
    return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${RELAY_PATH}`;
  }

  /** True while the WebSocket is open. */
  get connected() {
    return !!this.ws && this.ws.readyState === WebSocket.OPEN;
  }

  connect() {
    if (this.connected) return Promise.resolve();
    if (this._connecting) return this._connecting;
    if (this._retry) return Promise.reject(netError('reconnecting'));
    this._closing = false;
    this._setState('connecting');
    this._connecting = this._openSocket().then(() => {
      this._connecting = null;
      this._setState('open');
    }, err => {
      this._connecting = null;
      this._setState('closed');
      throw err;
    });
    return this._connecting;
  }

  async host(opts = {}) {
    this._beginEnter();
    try {
      await this.connect();
      const msg = { t: 'host', v: this.version, name: opts.name ?? 'KINETIC', max: opts.max ?? 8, public: opts.public !== false };
      if (opts.code) msg.code = normalizeCode(opts.code);
      if (opts.meta) msg.meta = opts.meta;
      const reply = await this._request(msg);
      this.role = 'host';
      this.peerId = HOST_PEER;
      this.code = reply.code;
      this.token = '';
      this._setState('in-room');
      return { code: reply.code, peer: HOST_PEER, max: reply.max };
    } finally {
      this._entering = false;
    }
  }

  async join(code, name = 'Player', token) {
    this._beginEnter();
    try {
      const room = normalizeCode(code);
      await this.connect();
      const tok = token === undefined ? loadToken(room) : token;
      const msg = { t: 'join', v: this.version, code: room, name };
      if (tok) msg.token = tok;
      const reply = await this._request(msg);
      this.role = 'client';
      this.peerId = reply.peer;
      this.code = reply.code;
      this.name = name;
      this.token = reply.token;
      saveToken(reply.code, reply.token);
      this._setState('in-room', { rejoin: reply.rejoin });
      return reply;
    } finally {
      this._entering = false;
    }
  }

  async leave() {
    if (this.role === 'none') return;
    if (this.role === 'client') clearToken(this.code);
    this._cancelRetry();
    this._resetRoom();
    if (!this.connected) {
      this._dropSocket();                           // e.g. a reconnect attempt still in progress
      this._setState('closed');
      return;
    }
    this._setState('open');
    await this._request({ t: 'leave' }).catch(() => {});
  }

  async kick(peer, reason) {
    this._requireHost();
    await this._request(reason ? { t: 'kick', peer, reason } : { t: 'kick', peer });
  }

  async lock(locked = true) {
    this._requireHost();
    await this._request({ t: 'lock', locked: !!locked });
  }

  async meta(obj) {
    this._requireHost();
    await this._request({ t: 'meta', meta: obj });
  }

  async list() {
    await this.connect();
    return (await this._request({ t: 'list' })).rooms;
  }

  /** Round trip to the relay (not through the host) in ms. */
  async ping() {
    const t0 = performance.now();
    await this._request({ t: 'ping', c: t0 });
    return performance.now() - t0;
  }

  sendToHost(u8) {
    if (this.role !== 'client') return false;
    u8[0] = HOST_PEER;
    return this._sendBinary(u8);
  }

  sendTo(peer, u8) {
    if (this.role !== 'host' || !(peer >= 1 && peer <= MAX_PEER)) return false;
    u8[0] = peer;
    return this._sendBinary(u8);
  }

  broadcast(u8) {
    if (this.role !== 'host') return false;
    u8[0] = BROADCAST;
    return this._sendBinary(u8);
  }

  sendControl(obj) {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify(obj));
    return true;
  }

  close(code = CLOSE.NORMAL, reason = '') {
    if (this.state === 'closed' || this.state === 'idle') return;
    this._closing = true;
    this._cancelRetry();
    // WebSocket.close() only accepts 1000 or 3000-4999 (anything else throws) and a reason <= 123 bytes
    if (code !== CLOSE.NORMAL && !(code >= 3000 && code <= 4999)) code = CLOSE.NORMAL;
    reason = String(reason).slice(0, 40);
    const ws = this.ws;
    if (ws && ws.readyState === WebSocket.OPEN) {
      if (this.role !== 'none') {
        if (this.role === 'client') clearToken(this.code);
        ws.send('{"t":"leave"}');                  // a deliberate quit frees the slot (no rejoin)
      }
      ws.close(code, reason);                       // onclose -> onClose(...)
      return;
    }
    this._dropSocket();
    this._finish({ code, reason: 'closed', text: reason, wasClean: true, room: this.code });
  }

  /** Test hook: lose the connection as if the network failed (clients then rejoin by themselves). */
  debugDrop() {
    if (this.ws) this._abandon(this.ws, 'simulated drop');
  }

  // ------------------------------------------------------------------------------------ internals

  _requireHost() {
    if (this.role !== 'host' || !this.connected) throw netError('not-host');
  }

  /** host()/join() are exclusive: a second call while one is in flight (double click) is refused. */
  _beginEnter() {
    if (this.role !== 'none' || this._entering) throw netError('already-in-room');
    this._entering = true;
  }

  _sendBinary(u8) {
    if (u8.length < 2) throw new RangeError('a packet needs its 2-byte [route, type] header');
    const ws = this.ws;
    if (this.state !== 'in-room' || !ws || ws.readyState !== WebSocket.OPEN ||
        (u8[1] >= LATEST_WINS && ws.bufferedAmount > this.maxBuffered)) {
      this.stats.dropped++;
      return false;
    }
    ws.send(u8);
    this.stats.packetsOut++;
    this.stats.bytesOut += u8.length;
    return true;
  }

  _openSocket() {
    return new Promise((resolve, reject) => {
      let ws;
      try {
        ws = new WebSocket(this.url);
      } catch (err) {
        reject(err);
        return;
      }
      ws.binaryType = 'arraybuffer';
      this.ws = ws;
      this._opening = { ws, reject };                // _dropSocket / _abandon settle it if they discard ws
      let opened = false;
      ws.onopen = () => {
        opened = true;
        if (this._opening && this._opening.ws === ws) this._opening = null;
        this.lastRecvAt = performance.now();
        this._pingSentAt = 0;
        this._startKeepalive();
        resolve();
      };
      ws.onmessage = ev => {
        if (ws === this.ws) this._onMessage(ev);
      };
      ws.onerror = () => { /* the close event follows with the details */ };
      ws.onclose = ev => {
        if (opened) {
          this._onSocketClose(ws, ev);
          return;
        }
        if (this._opening && this._opening.ws === ws) this._opening = null;
        if (ws === this.ws) this.ws = null;
        reject(netError('connect-failed', { code: ev.code }));
      };
    });
  }

  _onMessage(ev) {
    this.lastRecvAt = performance.now();
    const data = ev.data;
    if (typeof data === 'string') {
      let msg;
      try {
        msg = JSON.parse(data);
      } catch (err) {
        console.error('[net] malformed control message from the relay:', err);
        return;
      }
      if (msg && typeof msg === 'object') this._onControl(msg);
      return;
    }
    const u8 = new Uint8Array(data);
    if (u8.length < 2 || this.state !== 'in-room') return;
    this.stats.packetsIn++;
    this.stats.bytesIn += u8.length;
    this._emit('onMessage', this.role === 'host' ? u8[0] : HOST_PEER, u8);
  }

  _onControl(msg) {
    const t = msg.t;
    if (t === 'peer-join') this._emit('onPeerJoin', msg);
    else if (t === 'peer-leave') this._emit('onPeerLeave', msg);
    else if (t === 'room-closed') this._roomClosedReason = msg.reason || 'room-closed';
    let consumed = false;
    if (msg.id != null) {
      const p = this._pending.get(msg.id);
      if (p) {
        this._pending.delete(msg.id);
        clearTimeout(p.timer);
        consumed = true;
        if (t === 'error') p.reject(netError(msg.reason, { re: msg.re, reply: msg }));
        else p.resolve(msg);
      }
    }
    if (t === 'error' && !consumed) this._emit('onError', { reason: msg.reason, re: msg.re });
    this._emit('onControl', msg);
  }

  _request(msg) {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return Promise.reject(netError('not-connected'));
    const id = this._nextId++;
    msg.id = id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this._pending.delete(id)) reject(netError('timeout'));
      }, REQUEST_TIMEOUT_MS);
      this._pending.set(id, { resolve, reject, timer });
      ws.send(JSON.stringify(msg));
    });
  }

  _failPending(err) {
    for (const p of this._pending.values()) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    this._pending.clear();
  }

  _onSocketClose(ws, ev) {
    if (ws !== this.ws) return;
    this.ws = null;
    this._stopKeepalive();
    this._failPending(netError('closed', { code: ev.code }));
    const code = ev.code;
    const info = { code, reason: closeReason(code), text: ev.reason || '', wasClean: !!ev.wasClean, room: this.code };
    if (this._roomClosedReason) info.roomReason = this._roomClosedReason;
    if (info.reason === 'protocol') console.error(`[net] the relay closed the connection: ${code} ${ev.reason}`);
    else if (code === CLOSE.SLOW) console.warn('[net] this connection fell too far behind; the relay closed it (1013)');
    const final = this._closing || this.role !== 'client' || !this.reconnect ||
      code === CLOSE.ROOM_CLOSED || code === CLOSE.KICKED || code === CLOSE.REPLACED;
    if (final) {
      if (this.role === 'client' && (code === CLOSE.ROOM_CLOSED || code === CLOSE.KICKED)) clearToken(this.code);
      this._finish(info);
      return;
    }
    if (!this._retry) this._retry = { until: performance.now() + this.reconnectWindow * 1000, attempt: 0, timer: 0 };
    this._setState('reconnecting', info);
    this._retryLater(info);
  }

  _retryLater(info) {
    const r = this._retry;
    if (!r || this._closing || r.timer) return;     // r.timer: an attempt is already scheduled
    if (performance.now() >= r.until) {
      this._finish({ ...info, reason: 'reconnect-failed' });
      return;
    }
    const delay = RETRY_DELAYS_MS[Math.min(r.attempt, RETRY_DELAYS_MS.length - 1)];
    r.attempt++;
    r.timer = setTimeout(() => {
      r.timer = 0;
      this._rejoin(r, info);
    }, delay);
  }

  async _rejoin(r, info) {
    if (this._retry !== r || this._closing) return;
    try {
      await this._openSocket();
    } catch (err) {
      // relay unreachable: try again. 'closed' = the socket was discarded on purpose (leave / close / a drop
      // while connecting), and whoever discarded it already decided what happens next.
      if (this._retry === r && err.reason !== 'closed') this._retryLater(info);
      return;
    }
    if (this._retry !== r || this._closing) return;
    let reply;
    try {
      // rejoin: only our own slot (never a new player with another peer id behind the host's back)
      reply = await this._request({ t: 'join', v: this.version, code: this.code, name: this.name, token: this.token, rejoin: true });
    } catch (err) {
      if (this._retry !== r || this._closing || err.reason === 'closed') return;   // closed: onclose retries
      if (FATAL_REJOIN.has(err.reason)) {
        clearToken(this.code);
        this._dropSocket();
        this._finish({ ...info, reason: err.reason });
      } else {
        this._dropSocket();
        this._retryLater(info);
      }
      return;
    }
    if (this._retry !== r) return;
    this._retry = null;
    this.stats.reconnects++;
    this.peerId = reply.peer;
    this.token = reply.token;
    saveToken(reply.code, reply.token);
    this._setState('in-room', { rejoin: reply.rejoin });
  }

  _cancelRetry() {
    if (this._retry && this._retry.timer) clearTimeout(this._retry.timer);
    this._retry = null;
  }

  /** Forget the socket and close it without the normal close handling. */
  _dropSocket() {
    const ws = this.ws;
    if (!ws) return;
    this.ws = null;
    this._stopKeepalive();
    silence(ws);
    this._settleOpening(ws);
    this._failPending(netError('closed'));
  }

  /** Treat the current socket as lost (dead link / test hook): close it and run the unexpected-close path. */
  _abandon(ws, why) {
    silence(ws);
    this._settleOpening(ws);
    this._onSocketClose(ws, { code: 1006, reason: why, wasClean: false });
  }

  /** A still-connecting socket is being discarded: its connect() / rejoin must fail, not wait forever. */
  _settleOpening(ws) {
    const opening = this._opening;
    if (!opening || opening.ws !== ws) return;
    this._opening = null;
    opening.reject(netError('closed'));
  }

  _finish(info) {
    this._cancelRetry();
    this._resetRoom();
    this._setState('closed', info);
    this._emit('onClose', info);
  }

  _resetRoom() {
    this.role = 'none';
    this.peerId = -1;
    this.code = '';
    this.token = '';
    this._roomClosedReason = '';
  }

  _startKeepalive() {
    this._stopKeepalive();
    this._keepalive = setInterval(() => this._checkAlive(), 1000);
  }

  _stopKeepalive() {
    if (this._keepalive) clearInterval(this._keepalive);
    this._keepalive = 0;
  }

  _checkAlive() {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const now = performance.now();
    if (this._pingSentAt > this.lastRecvAt) {       // our keepalive ping is still unanswered
      if (now - this._pingSentAt > DEAD_MS) {
        console.warn(`[net] no answer from the relay for ${Math.round((now - this.lastRecvAt) / 1000)} s: connection lost`);
        this._abandon(ws, 'timeout');
      }
      return;
    }
    if (now - this.lastRecvAt > KEEPALIVE_MS) {
      this._pingSentAt = now;
      this.sendControl({ t: 'ping' });
    }
  }
}

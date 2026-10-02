/**
 * game.net: one multiplayer session (or none). Owns the role ('offline' | 'host' | 'client'), the session phase, the
 * relay transport (the ONLY code that talks to WsRelayTransport), the inbox of received packets (drained once per
 * frame, in arrival order), the per-frame JSON batches, the net clock, and the role objects NetHost / NetClient.
 *
 * Offline (no room) every frame hook is a no-op and nothing here is installed: single player runs exactly as before.
 * Design: docs/multiplayer/MULTIPLAYER_CONTRACT.md (sections 2.1.2, 5, 7).
 *
 * Events on game.events: net:status {status, ping, reconnectUntilMs}, net:lobby {room}, net:error {code, message},
 * net:closed {reason}, net:sys {kind, name, color}, net:phase {phase}, net:countdown {left}.
 */
import * as THREE from 'three';
import { WsRelayTransport } from './WsRelayTransport.js';
import { RELAY_PATH, BinaryWriter, encodeJsonPacket, decodeJsonPacket, normalizeCode, isValidCode } from './protocol.js';
import { PKT, NET, PROTOCOL_VERSION, LOBBY_KINDS } from './GameProtocol.js';
import { NetClock } from './NetClock.js';
import { NetHost } from './NetHost.js';
import { NetClient } from './NetClient.js';
import { HostTicker } from './HostTicker.js';
import { FxMirror } from './FxMirror.js';
import { NetEm } from './NetEm.js';
import { sanitizeName } from './Teams.js';
import { setHiddenTick } from '../core/utils.js';
import * as NetArsenal from './NetArsenal.js';
import * as NetModes from './NetModes.js';
import { BotModel } from '../ai/BotModel.js';
import { createWeaponModel } from '../weapons/WeaponModels.js';
import { WEAPON_ORDER } from '../weapons/WeaponDefs.js';
import { DEFAULT_PORT, normalizeServer } from './ServerAddress.js';

export { DEFAULT_PORT, normalizeServer };

const SID_KEY = 'kinetic.mp.sid';
const REJOIN_KEY = 'kinetic.mp.rejoin';
const WELCOME_TIMEOUT_MS = 15000;
const CLOSED_FOR_GOOD = new Set(['kicked', 'replaced', 'host-left', 'left', 'build', 'reconnect-failed']);

const _warned = new Set();
function warnOnce(key, ...args) {
  if (_warned.has(key)) return;
  _warned.add(key);
  console.warn(...args);
}

function sessionGet(key) {
  try { return sessionStorage.getItem(key); } catch { return null; }
}
function sessionSet(key, value) {
  try { sessionStorage.setItem(key, value); } catch { /* storage unavailable */ }
}
function sessionDel(key) {
  try { sessionStorage.removeItem(key); } catch { /* storage unavailable */ }
}

/** 16 hex chars (crypto.getRandomValues works on insecure LAN origins; randomUUID does not). */
function randomHex(bytes = 8) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return Array.from(a, b => b.toString(16).padStart(2, '0')).join('');
}

/** The http(s) origin that served this page ('' in the desktop app, whose page is kinetic://game). */
export function pageServer() {
  if (typeof location === 'undefined') return '';
  return location.protocol === 'http:' || location.protocol === 'https:' ? location.origin : '';
}

function wsUrl(server) {
  return server.replace(/^http/i, 'ws') + RELAY_PATH;
}

function netError(code, message) {
  const err = new Error(message || code);
  err.code = code;
  return err;
}

export class NetSession {
  /** @param {object} game constructed at the end of the Game constructor; offline, no network, no DOM */
  constructor(game) {
    this.game = game;
    /** 'offline' | 'host' | 'client' */
    this.role = 'offline';
    /** 'offline' | 'connecting' | 'lobby' | 'loading' | 'playing' | 'ended' */
    this.phase = 'offline';
    /** 'ok' | 'interrupted' | 'reconnecting' | 'closed' */
    this.status = 'ok';
    this.reconnectUntilMs = 0;
    /** u8 match counter (0 in the first lobby): every start / rematch bumps it. */
    this.epoch = 0;
    /** Bumped whenever a session ends: async work started before it aborts when this changed. */
    this.sessionGen = 0;
    /** This page's build id ('' when unknown); a host and a client with different non-empty builds cannot play. */
    this.build = '';
    /** Base URL of the server of the current (or last) session. */
    this.server = '';
    /** Lobby model: {code, urls, hostName, cfg, players, phase, locked, lan, epoch}. */
    this.room = null;
    /** {peer, sid, entityId, cg} */
    this.me = { peer: -1, sid: '', entityId: 0, cg: 0 };
    /** Smoothed round trip to the host in ms (client). */
    this.ping = 0;
    this.clock = new NetClock();
    /** @type {NetHost|null} */
    this.host = null;
    /** @type {NetClient|null} */
    this.client = null;
    /** Presentation mirroring (mp-core-B); null in this build. */
    this.fx = null;
    /** @type {NetEm|null} test-only network impairment */
    this.netem = null;
    this.transport = null;
    this.ticker = null;
    /** ?join= / #join= code waiting for the hub. */
    this.pendingJoin = null;
    /** The camera pose of this frame (avatar animation LOD). */
    this.camPos = new THREE.Vector3();
    this.camFwd = new THREE.Vector3(0, 0, -1);
    this.ending = false;
    this.stats = this._freshStats();
    this.inbox = [];
    this._handlers = new Map();
    this._sections = new Map();
    this._bcast = [];
    this._uni = new Map();
    this._toHost = [];
    this._pingW = new BinaryWriter(64);
    this._frozenUntil = 0;
    this._welcome = null;
    this._lastPacketMs = 0;
    this._countLeft = -1;
    this._sid = '';
    this._cleanups = [];
  }

  /** Run fn when the session ends (plugins undo their wrappers / visuals). */
  onEnd(fn) {
    this._cleanups.push(fn);
  }

  // ------------------------------------------------------------------ read-only state

  /** Simulation mutation allowed (offline and on the host). */
  get authority() { return this.role !== 'client'; }
  get isHost() { return this.role === 'host'; }
  get isClient() { return this.role === 'client'; }
  get online() { return this.role !== 'offline'; }

  /** This tab's session id (survives reloads of the tab, not other tabs). */
  get sid() {
    if (!this._sid) {
      this._sid = sessionGet(SID_KEY) || '';
      if (!/^[0-9a-f]{16}$/.test(this._sid)) {
        this._sid = randomHex(8);
        sessionSet(SID_KEY, this._sid);
      }
    }
    return this._sid;
  }

  /** The server this page came from, '' in the desktop app. */
  get pageServer() { return pageServer(); }

  /** True in the desktop app (desktop/preload.js). */
  get desktop() {
    return typeof window !== 'undefined' && !!(window.kineticDesktop && window.kineticDesktop.isDesktop);
  }

  // ------------------------------------------------------------------ setup

  /** Deep link, build id, test impairment. Called once by Game.boot. */
  init() {
    const p = this.game.params;
    let code = p.get('join');
    if (!code && typeof location !== 'undefined') {
      const m = /(?:^#|&)join=([^&]+)/i.exec(location.hash || '');
      if (m) code = decodeURIComponent(m[1]);
    }
    code = normalizeCode(code);
    if (isValidCode(code)) this.pendingJoin = code;
    const raw = sessionGet(REJOIN_KEY);
    if (raw) {
      try { this.rejoin = JSON.parse(raw); } catch { this.rejoin = null; }
    }
    if (p.get('netem')) {
      this.netem = new NetEm(p.get('netem'), parseInt(p.get('seed') || '1', 10) || 1);
      console.warn(`[net] network impairment active: ${this.netem.spec}`);
    }
    if (p.get('buildOverride')) this.build = p.get('buildOverride');
    else if (this.desktop && window.kineticDesktop.version) this.build = 'desktop-' + window.kineticDesktop.version;
  }

  /**
   * The build id of this page's game files (asked of the page's server only when a session starts: single player
   * never touches the network). '' when unknown.
   */
  async _ensureBuild() {
    if (this.build || this._buildAsked || !pageServer()) return;
    this._buildAsked = true;
    try {
      const r = await fetch('/api/build', { cache: 'no-store' });
      const j = r.ok ? await r.json() : null;
      if (j && typeof j.build === 'string' && !this.build) this.build = j.build;
    } catch { /* unknown build: no check */ }
  }

  // ------------------------------------------------------------------ actions (UI)

  /**
   * Open public rooms on a server (no socket needed). `listed` is false for a server that keeps its rooms unlisted
   * (an online server: rooms are found by their code).
   * @param {string} [server] base URL (default: the page's server)
   * @returns {Promise<{rooms: object[], listed: boolean}>} rooms: [{code, name, players, max, locked, meta, v}]
   */
  async listRooms(server) {
    const base = server ? normalizeServer(server) : pageServer();
    if (!base) return { rooms: [], listed: true };
    const r = await fetch(base + '/api/rooms', { cache: 'no-store' });
    if (!r.ok) throw netError('cannot-connect', `HTTP ${r.status}`);
    const j = await r.json();
    return { rooms: Array.isArray(j && j.rooms) ? j.rooms : [], listed: !(j && j.listed === false) };
  }

  /**
   * Create a room and become its host. `online`: the server is an online one (server/install.sh), not this PC or the
   * page's server: it has no LAN addresses to hand out, and `hostKey` is what lets this player open rooms there.
   * Rejects with err.code 'host-key' when the server wants another key.
   * @param {object} cfg match config (Menu setup: mapId, mode, botCount, difficulty, scoreLimit, timeLimit, arsenal, pool)
   * @param {{name?: string, public?: boolean, maxPlayers?: number, code?: string|null, server?: string,
   *   hostKey?: string, online?: boolean}} [opts]
   * @returns {Promise<string>} the room code
   */
  async hostRoom(cfg, { name, public: pub = true, maxPlayers = 8, code = null, server, hostKey = '', online = false } = {}) {
    if (this.transport) throw netError('busy', 'already in a session');
    const base = server ? normalizeServer(server) : pageServer();
    if (!base) throw netError('no-server', 'no server to host on');
    const s = this.game.settings;
    const hostName = sanitizeName(name ?? s.get('playerName'));
    const max = Math.max(2, Math.min(NET.MAX_HUMANS, maxPlayers | 0));
    const gen = ++this.sessionGen;
    this.server = base;
    this._setPhase('connecting');
    const t = this._bindTransport(wsUrl(base));
    await this._ensureBuild();
    if (gen !== this.sessionGen) throw netError('cancelled');
    const meta = this._meta(cfg, hostName, 1, max);
    const key = String(hostKey || '').trim() || undefined;
    let reply;
    try {
      try {
        reply = await t.host({ name: hostName, max, public: pub, code: code || undefined, meta, key });
      } catch (err) {
        if (code && err.reason === 'code-taken') reply = await t.host({ name: hostName, max, public: pub, meta, key });
        else throw err;
      }
    } catch (err) {
      if (gen === this.sessionGen) this._end('failed', true);
      throw netError(err.reason === 'connect-failed' ? 'cannot-connect' : err.reason || 'cannot-connect', err.message);
    }
    if (gen !== this.sessionGen) throw netError('cancelled');
    this.role = 'host';
    this.clock.startHost();
    this.me = { peer: 0, sid: this.sid, entityId: 0, cg: 0 };
    this.host = new NetHost(this);
    this.room = {
      code: reply.code, urls: [], hostName, cfg: { ...cfg }, players: [], phase: 'lobby', locked: false, lan: null,
      epoch: this.epoch, public: pub, max, server: base, online: !!online,
    };
    this.host.hostName = hostName;
    if (!this.game.autotest) s.set('mpLastCode', reply.code);
    this._goOnline();
    this._setPhase('lobby');
    this.host.broadcastLobby();
    if (online) return reply.code;
    fetch(base + '/api/lan', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then(lan => {
        if (!lan || !this.room || gen !== this.sessionGen) return;
        this.room.lan = lan;
        this.room.urls = Array.isArray(lan.urls) ? lan.urls : [];
        this.host.broadcastLobby();
      })
      .catch(() => {});
    return reply.code;
  }

  /**
   * Join a room. Resolves once the host answered (welcome).
   * Rejects with err.code: 'no-such-room' | 'room-full' | 'room-locked' | 'version-mismatch' | 'build' | 'kicked' |
   * 'cannot-connect' | 'bad-code' | 'timeout' | 'no-server' | 'busy'.
   * @param {string} code @param {{name?: string, server?: string}} [opts]
   */
  async joinRoom(code, { name, server } = {}) {
    if (this.transport) throw netError('busy', 'already in a session');
    const room = normalizeCode(code);
    if (!isValidCode(room)) throw netError('bad-code', 'not a room code');
    const base = server ? normalizeServer(server) : pageServer();
    if (!base) throw netError('no-server', 'no server address');
    const myName = sanitizeName(name ?? this.game.settings.get('playerName'));
    const gen = ++this.sessionGen;
    this.server = base;
    this._setPhase('connecting');
    const t = this._bindTransport(wsUrl(base));
    await this._ensureBuild();
    if (gen !== this.sessionGen) throw netError('cancelled');
    let reply;
    try {
      reply = await t.join(room, myName);
    } catch (err) {
      if (gen === this.sessionGen) this._end('failed', true);
      const c = err.reason === 'connect-failed' || err.reason === 'closed' ? 'cannot-connect' : err.reason || 'cannot-connect';
      throw netError(c, err.message);
    }
    if (gen !== this.sessionGen) throw netError('cancelled');
    this.role = 'client';
    this.me = { peer: reply.peer, sid: this.sid, entityId: 0, cg: 0 };
    this.client = new NetClient(this);
    this.room = { code: reply.code, urls: [], hostName: '', cfg: null, players: [], phase: 'lobby', locked: false, lan: null, server: base };
    sessionSet(REJOIN_KEY, JSON.stringify({ code: reply.code, sid: this.sid, at: Date.now(), build: this.build, server: base }));
    this._goOnline();
    this._myName = myName;
    const welcome = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this._welcome && this._welcome.timer === timer) {
          this._welcome = null;
          reject(netError('timeout', 'the host did not answer'));
          this._end('failed', true);
        }
      }, WELCOME_TIMEOUT_MS);
      this._welcome = { resolve, reject, timer };
    });
    this._sendHello(false);
    return welcome;
  }

  _sendHello(rejoin) {
    this.send({
      k: 'hello', v: PROTOCOL_VERSION, build: this.build, name: this._myName || sanitizeName(this.game.settings.get('playerName')),
      sid: this.sid, rejoin: !!rejoin, pick: this.game.player.loadoutPick ?? this.game.settings.get('playerLoadout'),
    });
    this._flush();
  }

  /** Client: the host's welcome arrived (NetClient). */
  _onWelcome(msg) {
    const w = this._welcome;
    if (msg.err) {
      if (w) {
        clearTimeout(w.timer);
        this._welcome = null;
        w.reject(netError(msg.err, `refused: ${msg.err}`));
      }
      this._end(msg.err === 'build' ? 'build' : msg.err === 'kicked' ? 'kicked' : 'failed', true);
      return;
    }
    if (w) {
      clearTimeout(w.timer);
      this._welcome = null;
      w.resolve(this.room ? this.room.code : '');
    }
  }

  /** Leave the session (client: 'bye'; host: the room closes for everyone). */
  leave(reason = 'left') {
    if (!this.transport) return;
    const t = this.transport;
    if (this.isClient) {
      this.send({ k: 'bye' });
      this._flush();
      sessionDel(REJOIN_KEY);
    }
    if (this.netem) this.netem.poll(Infinity);   // the bye must leave before the socket closes
    this._end(reason);
    try { t.close(1000, reason); } catch { /* already closed */ }
  }

  /** Lobby: ready toggle (client). */
  setReady(on) {
    if (!this._need('client', 'setReady')) return;
    this.send({ k: 'ready', on: !!on });
  }

  /** Lobby: team preference 1 (Blue) / 2 (Red) (both roles; the host's own is local). */
  setTeam(team) {
    if (this.isClient) this.send({ k: 'team', team: team | 0 });
    else if (this.isHost) this.host.setHostTeam(team | 0);
  }

  /** Host: change the match rules shown in the lobby. */
  setConfig(cfg) {
    if (!this._need('host', 'setConfig')) return;
    this.room.cfg = { ...cfg };
    this.host.broadcastLobby();
  }

  /** Client: the loadout pick changed (lobby / match menu): the host resolves spawns of this player with it. */
  setPick(pick) {
    if (this.isClient) this.send({ k: 'pick', pk: pick });
  }

  /** Host: remove a player. */
  kick(peer) {
    if (!this._need('host', 'kick')) return;
    this.host.kick(peer | 0);
  }

  /** Host: refuse new players (rejoins still work). */
  lock(on) {
    if (!this._need('host', 'lock')) return;
    this.room.locked = !!on;
    this.transport.lock(!!on).catch(err => warnOnce('lock', '[net] lock failed', err && err.reason));
    this.host.broadcastLobby();
  }

  /** Host: start the match (call synchronously inside a click handler: pointer lock). */
  start() {
    if (!this._need('host', 'start')) return;
    this.host.start();
  }

  /** Host, while loading: begin without the players still loading (they join when they finish). */
  forceBegin() {
    if (!this._need('host', 'forceBegin')) return;
    this.host.forceBegin();
  }

  /** Host: the same rules again (new epoch, fast map reset). */
  rematch() {
    if (!this._need('host', 'rematch')) return;
    this.host.start();
  }

  /** Host: everyone back to the lobby. */
  toLobby() {
    if (!this._need('host', 'toLobby')) return;
    this.host.toLobby();
  }

  /** Host: end the running match now (results for everyone). */
  endMatchForAll() {
    if (!this._need('host', 'endMatchForAll')) return;
    if (this.game.match && !this.game.match.over) this.game.endMatch('host');
  }

  /** Host: close the room. */
  endRoom() {
    if (!this._need('host', 'endRoom')) return;
    this.leave('left');
  }

  /** Test hook: lose the connection as if the network failed (the transport rejoins by itself). */
  debugDropConnection() {
    if (this.transport) this.transport.debugDrop();
  }

  /** Test hook: stop draining the inbox and stop sending game packets for `ms` (a frozen tab / half-open link). */
  debugFreeze(ms) {
    this._frozenUntil = performance.now() + Math.max(0, ms);
  }

  _need(role, what) {
    if (this.role === role) return true;
    warnOnce('role:' + what, `[net] ${what}() needs role '${role}' (now '${this.role}')`);
    return false;
  }

  // ------------------------------------------------------------------ messaging API

  /**
   * Listen for a JSON message kind. handler(msg, fromPeer, batchEpoch) - host: fromPeer 1..254; client: 0.
   * @returns {() => void} unsubscribe
   */
  on(kind, handler) {
    let list = this._handlers.get(kind);
    if (!list) this._handlers.set(kind, list = []);
    list.push(handler);
    return () => {
      const i = list.indexOf(handler);
      if (i >= 0) list.splice(i, 1);
    };
  }

  /**
   * Queue a JSON message into this frame's batch. to: 'host' (client) | 'all' (host) | a peer id (host).
   * Batches go out at the end of the frame: every peer's unicast batch first, then the broadcast batch.
   */
  send(msg, to = 'host') {
    if (!this.transport) return false;
    if (this.isClient) {
      this._toHost.push(msg);
      return true;
    }
    if (this.isHost) {
      if (to === 'all') this._bcast.push(msg);
      else if (typeof to === 'number' && to >= 1 && to <= 254) {
        let b = this._uni.get(to);
        if (!b) this._uni.set(to, b = []);
        b.push(msg);
      } else return false;
      return true;
    }
    return false;
  }

  /** Send a binary packet now (no batching): to 'host' | 'all' | peer id. */
  sendNow(u8, to = 'host') {
    if (!this.transport) return false;
    if (this._frozenUntil > performance.now()) return false;
    const t = this.transport;
    const fn = to === 'all' ? b => t.broadcast(b) : to === 'host' ? b => t.sendToHost(b) : b => t.sendTo(to, b);
    if (this.netem) {
      this.netem.outbound(fn, u8);
      return true;
    }
    return fn(u8);
  }

  /**
   * Register a snapshot TLV section (ids 1..15 per the contract: 1 pickups, 2 projectiles, 3 KOTH).
   * @param {number} id @param {{encode?: (w, ctx) => void, decode?: (r, ctx, len) => void}} codec
   */
  registerSection(id, codec) {
    this._sections.set(id, codec);
  }

  _flush() {
    if (!this.transport || this._frozenUntil > performance.now()) return;
    if (this.isHost) {
      for (const [peer, list] of this._uni) {
        if (!list.length) continue;
        this._sendJson(list, peer);
        list.length = 0;
      }
      if (this._bcast.length) {
        this._sendJson(this._bcast, 'all');
        this._bcast.length = 0;
      }
    } else if (this._toHost.length) {
      this._sendJson(this._toHost, 'host');
      this._toHost.length = 0;
    }
  }

  _sendJson(list, to) {
    const u8 = encodeJsonPacket({ e: this.epoch, m: list });
    this.stats.json.out += list.length;
    this.stats.json.bytesOut += u8.length;
    this.sendNow(u8, to);
  }

  // ------------------------------------------------------------------ transport

  _bindTransport(url) {
    const t = new WsRelayTransport({ url, version: PROTOCOL_VERSION, reconnect: true, reconnectWindow: NET.RECONNECT_GRACE_S });
    t.onMessage = (from, u8) => this._onPacket(from, u8);
    t.onPeerJoin = info => this.inbox.push({ kind: 'peer-join', info });
    t.onPeerLeave = info => this.inbox.push({ kind: 'peer-leave', info });
    t.onStatus = (state, info) => this.inbox.push({ kind: 'status', state, info });
    t.onClose = info => this.inbox.push({ kind: 'close', info });
    t.onError = err => warnOnce('relay:' + (err && err.reason), '[net] relay error:', err && err.reason);
    this.transport = t;
    return t;
  }

  _onPacket(from, u8) {
    if (this.netem) this.netem.inbound(from, u8, (f, d, at) => this._receive(f, d, at));
    else this._receive(from, u8, performance.now());
  }

  /** A packet arrived (after any test impairment): pings are answered at once, everything else waits for the frame. */
  _receive(from, u8, recvMs) {
    if (u8.length < 2) return;
    this._lastPacketMs = recvMs;
    if (u8[1] === PKT.PING && this.isHost) {
      if (this._frozenUntil > performance.now()) return;
      this.host.onPing(from, u8);
      return;
    }
    this.inbox.push({ kind: 'bin', from, u8, recvMs });
  }

  _dispatch(ev) {
    switch (ev.kind) {
      case 'bin': {
        const type = ev.u8[1];
        if (type === PKT.JSON) this._onJson(ev.from, ev.u8);
        else if (type === PKT.SNAPSHOT) { if (this.client) this.client.onSnapshot(ev.u8, ev.recvMs); }
        else if (type === PKT.CSTATE) { if (this.host) this.host.onState(ev.from, ev.u8, ev.recvMs); }
        else if (type === PKT.PONG) { if (this.client) this.client.onPong(ev.u8, ev.recvMs); }
        break;
      }
      case 'peer-join': if (this.host) this.host.onPeerJoin(ev.info); break;
      case 'peer-leave': if (this.host) this.host.onPeerLeave(ev.info); break;
      case 'status': this._onTransportStatus(ev.state, ev.info); break;
      case 'close': this._onTransportClose(ev.info); break;
      default: break;
    }
  }

  _onJson(from, u8) {
    let batch;
    try {
      batch = decodeJsonPacket(u8);
    } catch {
      warnOnce('badjson:' + from, `[net] malformed JSON packet from peer ${from}`);
      return;
    }
    if (!batch || !Array.isArray(batch.m)) return;
    const e = batch.e | 0;
    for (const msg of batch.m) {
      if (!msg || typeof msg.k !== 'string') continue;
      this.stats.json.in++;
      if (!LOBBY_KINDS.has(msg.k)) {
        if (this.isHost) {
          if (e !== this.epoch) continue;
        } else if (this.isClient) {
          if (e !== this.epoch) continue;
          if (msg.k !== 'begin' && this.client.inMatchEpoch !== this.epoch) continue;
        }
      }
      const list = this._handlers.get(msg.k);
      if (!list || !list.length) {
        warnOnce('kind:' + msg.k, `[net] no handler for message '${msg.k}'`);
        continue;
      }
      for (const fn of list) {
        try {
          fn(msg, from, e);
        } catch (err) {
          console.error(`[net] '${msg.k}' handler threw:`, err);
        }
      }
      if (!this.transport) return;   // the session ended inside a handler
    }
  }

  _onTransportStatus(state, info) {
    if (state === 'reconnecting') {
      this.status = 'reconnecting';
      this.reconnectUntilMs = performance.now() + NET.RECONNECT_GRACE_S * 1000;
      this.game.input.enabled = false;
      this._emitStatus();
    } else if (state === 'in-room' && this.status === 'reconnecting') {
      this.status = 'ok';
      this.reconnectUntilMs = 0;
      if (this.game.state === 'playing' && !this.game._matchMenu) this.game.input.enabled = true;
      this._emitStatus();
      if (this.isClient && info && info.rejoin) this._sendHello(true);
    }
  }

  _onTransportClose(info) {
    const r = info && info.reason;
    const reason = r === 'room-closed' || (info && info.roomReason) ? 'host-left'
      : r === 'kicked' ? 'kicked' : r === 'replaced' ? 'replaced' : r === 'reconnect-failed' || r === 'slot-lost' ? 'reconnect-failed'
      : r === 'closed' && this.ending ? 'left' : 'failed';
    this._end(reason);
  }

  _emitStatus() {
    this.game.events.emit('net:status', { status: this.status, ping: this.ping, reconnectUntilMs: this.reconnectUntilMs });
  }

  _setPhase(phase) {
    if (this.phase === phase) return;
    this.phase = phase;
    if (this.room) this.room.phase = phase === 'connecting' ? 'lobby' : phase;
    this.game.events.emit('net:phase', { phase });
    this._publishTest();
  }

  _publishTest() {
    if (!this.game.autotest || typeof window === 'undefined') return;
    window.__NET__ = { role: this.role, phase: this.phase, code: this.room ? this.room.code : '', epoch: this.epoch, entityId: this.me.entityId };
  }

  /** Installed on host / join: Worker tick, hidden-tab loading yields, plugins, online-only hooks. */
  _goOnline() {
    const game = this.game;
    this.ticker = new HostTicker(game);
    this.ticker.start(NET.HOST_TICK_MS);
    setHiddenTick(() => this.ticker.nextTick());
    // online the Javelin kill hit-stop is presentation only: game.timeScale never changes
    game.hitStop = () => { if (game.player && game.player.rig && game.player.rig.punchFov) game.player.rig.punchFov(-3); };
    this.stats = this._freshStats();
    this.fx = new FxMirror(game);
    try {
      this.fx.install();
    } catch (err) {
      console.error('[net] presentation mirroring unavailable', err);
      this.fx = null;
    }
    if (this.isHost) this.host.install();
    else this.client.install();
    this.on('fx', (m, from) => this._onFx(m, from));
    try { NetArsenal.install(this); } catch (err) { console.error('[net] NetArsenal.install failed', err); }
    try { NetModes.install(this); } catch (err) { console.error('[net] NetModes.install failed', err); }
    this._publishTest();
  }

  /**
   * The session is over: leave the match (while host / client still exist, so their entities are disposed), then
   * tear everything down. `quiet` = a failed attempt to create / join (no hub message).
   */
  _end(reason, quiet = false) {
    if (this.ending) return;
    this.ending = true;
    const game = this.game;
    this.sessionGen++;
    try {
      if (!quiet || game.match) game.netSessionEnded(reason, quiet);
    } catch (err) {
      console.error('[net] leaving the match failed', err);
    }
    if (this.ticker) this.ticker.stop();
    this.ticker = null;
    setHiddenTick(null);
    if (this.fx) this.fx.uninstall();
    this.fx = null;
    for (const fn of this._cleanups.splice(0)) {
      try { fn(); } catch (err) { console.error('[net] session cleanup failed', err); }
    }
    delete game.hitStop;
    if (this.netem) this.netem.clear();
    if (this.host) this.host.dispose();
    if (this.client) this.client.dispose();
    const t = this.transport;
    if (t) {
      t.onMessage = t.onPeerJoin = t.onPeerLeave = t.onStatus = t.onClose = t.onError = null;
      if (t.state !== 'closed' && t.state !== 'idle') {
        try { t.close(1000, reason); } catch { /* closing anyway */ }
      }
    }
    if (this._welcome) {
      clearTimeout(this._welcome.timer);
      this._welcome.reject(netError(reason === 'build' || reason === 'kicked' ? reason : 'cannot-connect', reason));
      this._welcome = null;
    }
    if (CLOSED_FOR_GOOD.has(reason)) sessionDel(REJOIN_KEY);
    this.transport = null;
    this.host = null;
    this.client = null;
    this.role = 'offline';
    this.status = 'ok';
    this.reconnectUntilMs = 0;
    this.room = null;
    this.me = { peer: -1, sid: this.sid, entityId: 0, cg: 0 };
    this.epoch = 0;
    this.ping = 0;
    this.inbox.length = 0;
    this._bcast.length = 0;
    this._uni.clear();
    this._toHost.length = 0;
    this._handlers.clear();
    this._sections.clear();
    this._countLeft = -1;
    this._frozenUntil = 0;
    this.clock.reset();
    this._setPhase('offline');
    this.ending = false;
    if (!quiet) game.events.emit('net:closed', { reason });
    this._publishTest();
  }

  // ------------------------------------------------------------------ per-frame hooks (Game)

  /** Drain the inbox in arrival order and dispatch; host: load barrier. */
  beginFrame(raw) {
    if (!this.transport) return;
    const now = performance.now();
    if (this.netem) this.netem.poll(now);
    if (this._frozenUntil > now) return;
    if (raw > 0.1 && this.client) this.client.onLocalStall();
    if (this.inbox.length) {
      const list = this.inbox;
      this.inbox = [];
      for (let i = 0; i < list.length; i++) {
        this._dispatch(list[i]);
        if (!this.transport) return;
      }
    }
    if (this.host) this.host.beginFrame(raw);
    else if (this.client) this.client.beginFrame(raw);
  }

  /** Host: snapshots and lobby / ping broadcasts; client: state packet, pings; both: the countdown, JSON flush. */
  endFrame(raw) {
    if (!this.transport) return;
    /** Host net time at which this frame's state left (snapshots / CSTATE are stamped with it); tests stamp tracks with it. */
    this.frameHostMs = this.clock.hostNowMs();
    if (this.netem) this.netem.poll();
    this._updateCountdown();
    if (this._frozenUntil > performance.now()) return;
    this._sendFx();
    if (this.host) this.host.endFrame(raw);
    else if (this.client) this.client.endFrame(raw);
    this._flush();
  }

  /** Remote entities: host RemotePlayer smoothing, client NetAvatar interpolation (+ their avatars). */
  updateRemotes(dt) {
    if (!this.online) return;
    const cam = this.game.camera;
    this.camPos.copy(cam.position);
    cam.getWorldDirection(this.camFwd);
    if (this.host) this.host.updateRemotes(dt);
    else if (this.client) this.client.updateRemotes(dt);
    if (this.fx) this.fx.drain();
  }

  /** Host: capture window around the simulation (bots, combat, projectiles, world, modes). */
  simBegin() {
    if (this.fx && this.isHost) this.fx.open('sim', 0);
  }

  simEnd() {
    if (this.fx && this.isHost) this.fx.close();
  }

  /** Capture window around this machine's own weapons (its shots' tracers, impacts, sounds). */
  fxBegin() {
    if (this.fx && this.online && this.game.match) this.fx.open('weapons', this.game.player.id);
  }

  fxEnd() {
    if (this.fx) this.fx.close();
  }

  /**
   * A presentation batch from another machine. Host: from a client (replayed on that player's smoothed timeline,
   * relayed to everyone else); client: from the host (its simulation, the host player or a relayed client).
   */
  _onFx(m, from) {
    const fx = this.fx;
    if (!fx || !Array.isArray(m.r) || !this.game.match) return;
    if (this.isHost) {
      const rp = this.host.remoteOf(from);
      if (!rp) return;
      const clock = this.clock;
      fx.schedule(m, rp.id, () => clock.hostNowMs() - rp.delay.effectiveMs);
      this.send({ k: 'fx', o: rp.id, t: m.t | 0, r: m.r }, 'all');
    } else if (this.client) {
      const o = m.o | 0;
      if (o && o === this.game.player.id) return;   // my own shots, relayed back
      const c = this.client;
      fx.schedule(m, o, () => c.lastRenderMs);
    }
  }

  /** This frame's captured batches into the messages. */
  _sendFx() {
    const batches = this.fx && this.fx.take();
    if (!batches) return;
    for (const b of batches) {
      if (this.isHost) this.send({ k: 'fx', o: b.o, t: b.t, r: b.r }, 'all');
      else if (this.client && this.client.inMatchEpoch === this.epoch) this.send({ k: 'fx', t: b.t, r: b.r });
    }
  }

  /** Game._clearMatch: dispose remote entities before the entity list is cleared. */
  onClearMatch() {
    if (this.host) this.host.clearMatch();
    if (this.client) this.client.clearMatch();
  }

  /** Game's canvas click: a late joiner deploys. */
  onCanvasClick() {
    if (this.client && this.client.awaitingDeploy) this.client.sendDeploy();
  }

  /**
   * Game.warmup: objects whose shaders must compile while an online match loads. The fighters are created only when
   * the match begins (after the load), so warm one robot (with its gibs) and every weapon model instead.
   * @returns {{world: THREE.Object3D[]}|null}
   */
  prewarmObjects() {
    if (!this.online) return null;
    const world = [];
    try {
      const m = new BotModel({ color: 0x9fe8ff, team: 0 });
      world.push(m.root, ...m.prewarmMeshes(true));
    } catch (err) {
      console.warn('[net] robot prewarm failed', err);
    }
    for (const id of WEAPON_ORDER) {
      try { world.push(createWeaponModel(id, { view: false, batched: true }).root); } catch { /* placeholder later */ }
    }
    return { world };
  }

  /** Countdown on both roles: 3, 2, 1 announcements, then FIGHT at liveAt (host net time). */
  _updateCountdown() {
    const m = this.game.match;
    if (!m || !m.online || m.phase !== 'countdown' || this.game.state !== 'playing') return;
    const now = this.clock.hostNowMs();
    const left = Math.ceil((m.liveAtNet - now) / 1000);
    if (left > 0) {
      if (left !== this._countLeft) {
        this._countLeft = left;
        this.game.events.emit('net:countdown', { left });
        this.game.hud.announce(String(left), 'GET READY', 'info', 900);
      }
      return;
    }
    m.phase = 'live';
    this._countLeft = -1;
    this.game.events.emit('net:countdown', { left: 0 });
    this.game.hud.announce('FIGHT', String(m.mapName || '').toUpperCase(), 'info', 1400);
    if (this.isHost) this.send({ k: 'phase', ph: 'live', at: Math.round(now) }, 'all');
  }

  _meta(cfg, hostName, players, max) {
    return {
      host: hostName, map: cfg && cfg.mapId, mode: cfg && cfg.mode, players, max, phase: this.phase,
      lateJoin: false, build: this.build,
    };
  }

  // ------------------------------------------------------------------ stats (report.net)

  _freshStats() {
    return {
      json: { in: 0, out: 0, bytesOut: 0 },
      snaps: { in: 0, out: 0, bytesOut: 0, dropped: 0, stale: 0 },
      states: { in: 0, out: 0, dropped: 0 },
      events: { in: {}, out: {} },
      custom: {},
    };
  }

  /** Report for AutoTest (report.net). */
  report() {
    const g = this.game;
    const out = {
      role: this.role, peer: this.me.peer, entityId: this.me.entityId, code: this.room ? this.room.code : '', epoch: this.epoch,
      build: this.build, phase: this.phase, simHz: +(g.simHz || 0).toFixed(1), hostFps: +(g.fps || 0).toFixed(1),
      json: { ...this.stats.json }, events: this.stats.events, custom: this.stats.custom,
      rtt: { smoothed: +this.clock.rttMs.toFixed(1), p95: +this.clock.rttP95Ms.toFixed(1) },
      offsetJitterMs: +this.clock.offsetJitterMs.toFixed(2),
      transport: this.transport ? { ...this.transport.stats } : null,
      fx: this.fx ? { ...this.fx.stats } : null,
    };
    if (this.host) Object.assign(out, this.host.report());
    if (this.client) Object.assign(out, this.client.report());
    return out;
  }
}

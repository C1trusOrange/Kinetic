/**
 * Host side of a session: the lobby (peers, ready flags, teams), the load barrier, building the match (ids, teams,
 * RemotePlayers, spawns, per-peer 'begin'), CSTATE intake, snapshots, the end-of-match message and ping broadcasts.
 * The host's own tab runs the complete game exactly as single player does, plus one RemotePlayer per joined human.
 */
import * as THREE from 'three';
import { NET, PKT, PROTOCOL_VERSION, WEAPON_INDEX, CLAIM_WEAPONS, toWireTime, wirePos, wireDir, num, readVec } from './GameProtocol.js';
import { installHost as installEvents, PICKUP_SECTION } from './NetEvents.js';
import { WEAPONS, MELEE, GRENADE_TYPES } from '../weapons/WeaponDefs.js';
import { BinaryWriter, BinaryReader } from './protocol.js';
import {
  SnapshotBody, writeSnapshot, makeEntityRecord, makeSnapshotHeader, decodeClientState, makeClientState,
  EF, EF2, OWN, SF, PHASE_CODE, TIME_NONE,
} from './NetCodec.js';
import { RemotePlayer } from './RemotePlayer.js';
import { RollingP95, makeBodySample } from './NetClock.js';
import { planMatch, planLateJoin, sanitizeName, dedupeName, HUMAN_COLORS } from './Teams.js';
import { getMap, MAPS } from '../world/maps/index.js';
import { isTeamMode, TEAM_COLORS, TEAM_BLUE, TEAM_RED, PLAYER_COLOR, DIFFICULTIES, MODES } from '../core/constants.js';
import { freezePool } from '../weapons/Loadout.js';
import { clamp } from '../core/utils.js';

const GRAPPLE_CODE = { idle: 0, flying: 1, attached: 2, retract: 3 };
const HISTORY = 64;   // snapshot-rate samples per entity (~1 s at 60 Hz): what clients were shown, for claim checks
const _hp = new THREE.Vector3();
const _hd = new THREE.Vector3();
const _hk = new THREE.Vector3();
const _eye = new THREE.Vector3();
const _warned = new Set();
function warnOnce(key, ...args) {
  if (_warned.has(key)) return;
  _warned.add(key);
  console.warn(...args);
}
const r3 = v => Math.round(v * 1000) / 1000;
const r1 = v => Math.round(v * 10) / 10;

/** A velocity for the wire (1 cm/s). */
function wireDir3(v) {
  return [Math.round(v.x * 100) / 100, Math.round(v.y * 100) / 100, Math.round(v.z * 100) / 100];
}

function makePeer(peer, name, addr) {
  return {
    peer, sid: '', name, addr: addr || '', color: -1, team: 0, pref: 0, ready: false, loaded: false, progress: 0, vis: 'visible',
    ping: 0, jitterP95: 0, lagP95: 0, fps: 0, connected: true, inMatch: false, helloed: false, entity: null, pick: null,
    snapHz: NET.SNAP_HZ, snapAcc: 0, lowJitterSince: 0, cg: 0, lag: new RollingP95(2000, 256, 250), lastAck: 0,
  };
}

/** Parse a '#rrggbb' / number colour, -1 if invalid. */
function colorOf(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v & 0xffffff;
  if (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)) return parseInt(v.slice(1), 16);
  return -1;
}

export class NetHost {
  /** @param {import('./NetSession.js').NetSession} net */
  constructor(net) {
    this.net = net;
    this.game = net.game;
    /** @type {Map<number, object>} peer id -> lobby / connection record */
    this.peers = new Map();
    /** @type {Map<number, RemotePlayer>} peer id -> the human's entity in the current match */
    this.remotes = new Map();
    /** Session ids removed by the host this room (their hello is refused). */
    this.kickedSids = new Set();
    this.hostName = 'Host';
    this.hostTeamPref = 0;
    /** The frozen config of the running / loading match. */
    this.matchCfg = null;
    this.hostLoaded = false;
    /**
     * Connection policies (mp-modes replaces them): a dropped human is removed like a leave; no rebinding of rejoins;
     * late joins unchanged; nothing happens on leave.
     */
    this.policy = {
      onDrop: (rp, info, rec) => this.removePeer(rec.peer, 'drop'),
      onRejoin: () => false,
      onLateJoin: (peer, plan) => plan,
      onLeave: () => {},
    };
    this._begun = false;
    this._forced = false;
    this._loadStart = 0;
    this._expected = new Set();
    this._building = false;
    this._lobbyDirty = false;
    this._lobbySentAt = -1e9;
    this._pingsAt = 0;
    this._endPending = false;
    this._snapSeq = 0;
    this._bodySeq = 0;
    this._body = new SnapshotBody();
    this._w = new BinaryWriter(2048);
    this._pongW = new BinaryWriter(64);
    this._rec = makeEntityRecord();
    this._rs = makeBodySample();
    this._hdr = makeSnapshotHeader();
    this._st = makeClientState();
    this._r = new BinaryReader();
    this._lastScore = new Map();
    this._extBegin = [];
    this._off = [];
    /** entity -> {t: Float64Array, x, y, z, h, vx, vy, vz: Float32Array, i, n}: snapshot-time positions (claims) */
    this.history = new Map();
    this._hs = { x: 0, y: 0, z: 0, h: 1.8, vx: 0, vy: 0, vz: 0 };
    /** Set while a validated claim is applied (NetEvents adds its id to the 'dmg' echo). */
    this._claimCtx = null;
    this._fireQueue = [];
    this.stats = {
      statesIn: 0, statesBad: 0, snapsOut: 0, snapBytes: 0, snapMax: 0,
      claims: { in: 0, applied: 0, rejected: {} }, fires: 0, grants: 0, impulses: 0,
    };
  }

  // ------------------------------------------------------------------ setup

  install() {
    const net = this.net;
    net.on('hello', (m, p) => this.onHello(m, p));
    net.on('bye', (m, p) => this.removePeer(p, 'leave'));
    net.on('ready', (m, p) => {
      const r = this.peers.get(p);
      if (r && r.helloed) { r.ready = !!m.on; this.broadcastLobby(); }
    });
    net.on('team', (m, p) => this._onTeam(m, p));
    net.on('pick', (m, p) => {
      const r = this.peers.get(p);
      if (!r || !m.pk || typeof m.pk !== 'object') return;
      r.pick = m.pk;
      if (r.entity) r.entity.loadoutPick = m.pk;
    });
    net.on('prog', (m, p) => {
      const r = this.peers.get(p);
      if (!r) return;
      r.progress = clamp(Number(m.p) || 0, 0, 1);
      r.vis = m.vis === 'hidden' ? 'hidden' : 'visible';
      this.broadcastLobby();
    });
    net.on('loaded', (m, p) => {
      const r = this.peers.get(p);
      if (!r || !r.helloed) return;
      r.loaded = true;
      r.progress = 1;
      this.broadcastLobby();
      // after the match began (late joiner, straggler): attach behind the deploy gate
      if (this._begun && !r.inMatch && this.game.match && !this.game.match.over) this.attachLate(r);
    });
    net.on('deploy', (m, p) => this.onDeploy(p));
    net.on('nq', (m, p) => this._onQuality(m, p));
    net.on('cl', (m, p) => this.onClaim(m, p));
    net.on('fire', (m, p) => this.onClientFire(m, p));
    net.on('fall', (m, p) => this.onFall(m, p));
    const game = this.game, ev = game.events;
    this._off.push(ev.on('match:end', () => { this._endPending = true; }));
    this._off.push(ev.on('spawn', e => { if (e && e.entity) e.entity.teleportHold = NET.TELEPORT_HOLD; }));
    // the host player's shots: the others show its muzzle flash (RemotePlayer shots are relayed in onClientFire)
    this._off.push(ev.on('weapon:fire', e => {
      if (!e || e.shooter !== game.player || !game.match || !e.origin || !e.direction) return;
      net.send({ k: 'fire', e: game.player.id, w: e.weapon, o: wirePos(e.origin), d: wireDir(e.direction), t: Math.round(net.clock.hostNowMs()) }, 'all');
    }));
    this._off.push(installEvents(net));
    net.registerSection(1, PICKUP_SECTION);
  }

  dispose() {
    for (const off of this._off) off();
    this._off.length = 0;
    this.clearMatch();
    this.peers.clear();
  }

  /**
   * Extension hook (mp-modes): fn(peer record, begin message) adds fields to every 'begin'.
   * @param {(rec: object, msg: object) => void} fn
   */
  onBuildBegin(fn) {
    this._extBegin.push(fn);
  }

  /** The RemotePlayer of a peer, or null. */
  remoteOf(peer) {
    return this.remotes.get(peer) || null;
  }

  // ------------------------------------------------------------------ peers

  onPeerJoin(info) {
    const peer = info.peer | 0;
    let r = this.peers.get(peer);
    if (!r) {
      r = makePeer(peer, sanitizeName(info.name), info.addr);
      this.peers.set(peer, r);
    } else {
      r.connected = true;
      r.addr = info.addr || r.addr;
    }
    r.helloed = false;   // a hello (with the session id) follows on the data plane
  }

  onPeerLeave(info) {
    const r = this.peers.get(info.peer | 0);
    if (!r) return;
    if (info.reserved && r.helloed) {
      r.connected = false;
      if (r.entity) {
        r.entity.connected = false;
        r.entity.netHold = true;
      }
      try { this.policy.onDrop(r.entity, info, r); } catch (err) { console.error('[net] policy.onDrop failed', err); }
      return;
    }
    this.removePeer(r.peer, 'leave');
  }

  /** Answer a client's PING at once (PONG = the PING body + the host net time). */
  onPing(from, u8) {
    const r = this.peers.get(from);
    if (u8.length < 16) return;
    if (r) {
      r.ping = u8[14] | (u8[15] << 8);
      if (r.entity) r.entity.ping = r.ping;
    }
    const w = this._pongW;
    w.begin(PKT.PONG);
    w.raw(u8.subarray(2, 16));
    w.f64(this.net.clock.hostNowMs());
    this.net.sendNow(w.finish(), from);
  }

  onHello(msg, peer) {
    const net = this.net;
    let r = this.peers.get(peer);
    if (!r) {
      r = makePeer(peer, 'Player', '');
      this.peers.set(peer, r);
    }
    const sid = typeof msg.sid === 'string' ? msg.sid.slice(0, 32) : '';
    const refuse = err => {
      net.send({ k: 'welcome', peer, sid, you: 0, cg: 0, phase: net.phase, epoch: net.epoch, err }, peer);
      net._flush();
      this.peers.delete(peer);
      if (net.transport) net.transport.kick(peer, err).catch(() => {});
    };
    if (msg.v !== PROTOCOL_VERSION) { refuse('version'); return; }
    if (sid && this.kickedSids.has(sid)) { refuse('kicked'); return; }
    if (msg.build && net.build && msg.build !== net.build) { refuse('build'); return; }
    const taken = [this.hostName];
    for (const o of this.peers.values()) if (o !== r && o.helloed) taken.push(o.name);
    r.name = dedupeName(sanitizeName(msg.name), taken);
    r.sid = sid;
    r.pick = msg.pick && typeof msg.pick === 'object' ? msg.pick : null;
    r.color = colorOf(msg.color);
    r.connected = true;
    r.helloed = true;
    r.ready = false;
    r.loaded = false;
    r.inMatch = false;
    r.cg = (r.cg + 1) & 255 || 1;
    net.send({
      k: 'welcome', peer, sid, you: 0, cg: r.cg, phase: net.phase, epoch: net.epoch, room: this.lobbyRoom(), build: net.build,
      name: r.name,
    }, peer);
    this._sys('join', r);
    this.broadcastLobby();
    // a match is loading or running: this player loads it now and joins when done (late join)
    if ((net.phase === 'loading' || net.phase === 'playing') && this.matchCfg && this.matchCfg.lateJoin !== false) {
      if (net.phase === 'loading' && !this._begun) this._expected.add(peer);
      net.send({ k: 'load', e: net.epoch, cfg: this.matchCfg }, peer);
    }
  }

  /** Remove a peer and its entity (leave, drop with the core policy, kick). */
  removePeer(peer, why = 'leave') {
    const net = this.net;
    const r = this.peers.get(peer);
    if (!r) return;
    this.peers.delete(peer);
    this._expected.delete(peer);
    net._uni.delete(peer);
    const rp = this.remotes.get(peer);
    if (rp) {
      try { this.policy.onLeave(rp); } catch (err) { console.error('[net] policy.onLeave failed', err); }
      this.remotes.delete(peer);
      this.game.removeEntity(rp);
      rp.dispose();
      net.send({ k: 'ros', rem: [{ id: rp.id, name: rp.name, color: rp.color.getHex(), team: rp.team, kind: 'human' }] }, 'all');
    }
    if (r.helloed) this._sys(why === 'drop' ? 'drop' : why === 'kick' ? 'kick' : 'leave', r);
    this.broadcastLobby();
  }

  /** Remove a player for good (their session id is refused for the rest of this room). */
  kick(peer) {
    const r = this.peers.get(peer);
    if (!r) return;
    if (r.sid) this.kickedSids.add(r.sid);
    if (this.net.transport) this.net.transport.kick(peer, 'kicked').catch(() => {});
    this.removePeer(peer, 'kick');
  }

  _sys(kind, r) {
    const color = r.entity ? r.entity.color.getHex() : r.color >= 0 ? r.color : 0x9fe8ff;
    const msg = { k: 'sys', kind, name: r.name, color };
    this.net.send(msg, 'all');
    this.game.events.emit('net:sys', { kind, name: r.name, color });
  }

  _onTeam(m, peer) {
    const r = this.peers.get(peer);
    const team = m.team | 0;
    if (!r || (team !== TEAM_BLUE && team !== TEAM_RED)) return;
    if (this.game.settings.get('mpTeams') !== 'pick') return;
    const count = { [TEAM_BLUE]: 0, [TEAM_RED]: 0 };
    count[this.hostTeamPref === TEAM_RED ? TEAM_RED : TEAM_BLUE]++;
    for (const o of this.peers.values()) if (o !== r && o.helloed) count[o.pref === TEAM_RED ? TEAM_RED : TEAM_BLUE]++;
    const other = team === TEAM_BLUE ? TEAM_RED : TEAM_BLUE;
    if (count[team] + 1 - count[other] > 1) return;
    r.pref = team;
    this.broadcastLobby();
  }

  /** The host's own team preference (team modes with picking). */
  setHostTeam(team) {
    this.hostTeamPref = team === TEAM_RED ? TEAM_RED : team === TEAM_BLUE ? TEAM_BLUE : 0;
    this.broadcastLobby();
  }

  _onQuality(m, peer) {
    const r = this.peers.get(peer);
    if (!r) return;
    r.jitterP95 = Math.max(0, Number(m.j) || 0);
    r.lagP95 = Math.max(0, Number(m.l) || 0);
    r.fps = Math.max(0, Number(m.fps) || 0);
    // snapshot rate per client: 30 Hz while its arrival jitter is high, back to the match rate after 10 quiet seconds
    const want = this.matchCfg ? this.matchCfg.snapHz : NET.SNAP_HZ;
    const now = performance.now();
    // two reports in a row (2 s): one spike (a GC pause, a window being minimized) must not halve the rate for 10 s
    r.highJitter = r.jitterP95 > NET.JITTER_FALLBACK_MS ? (r.highJitter | 0) + 1 : 0;
    if (r.highJitter >= 2) {
      r.snapHz = Math.min(want, NET.SNAP_HZ_FALLBACK);
      r.lowJitterSince = 0;
    } else if (r.snapHz < want) {
      if (r.jitterP95 < NET.JITTER_RECOVER_MS) {
        if (!r.lowJitterSince) r.lowJitterSince = now;
        else if (now - r.lowJitterSince > NET.JITTER_RECOVER_S * 1000) r.snapHz = want;
      } else r.lowJitterSince = 0;
    }
  }

  // ------------------------------------------------------------------ lobby

  /** The lobby rows: the host first, then every greeted client in peer order. */
  lobbyRows() {
    const s = this.game.settings;
    const rows = [{
      peer: 0, name: this.hostName, color: colorOf(s.get('playerColor')) >= 0 ? colorOf(s.get('playerColor')) : PLAYER_COLOR,
      team: this.hostTeamPref, ready: true, loaded: this.hostLoaded, progress: this.hostLoaded ? 1 : 0, vis: 'visible', ping: 0,
      host: true, connected: true,
    }];
    const list = [...this.peers.values()].filter(r => r.helloed).sort((a, b) => a.peer - b.peer);
    for (const r of list) {
      rows.push({
        peer: r.peer, name: r.name, color: r.entity ? r.entity.color.getHex() : r.color >= 0 ? r.color : HUMAN_COLORS[rows.length % HUMAN_COLORS.length],
        team: r.entity ? r.entity.team : r.pref, ready: r.ready, loaded: r.loaded, progress: +r.progress.toFixed(2), vis: r.vis,
        ping: r.ping, host: false, connected: r.connected,
      });
    }
    return rows;
  }

  /** The room as sent in 'lobby' / 'welcome'. */
  lobbyRoom() {
    const net = this.net, room = net.room;
    return {
      code: room.code, phase: net.phase, hostName: this.hostName, cfg: room.cfg, players: this.lobbyRows(), epoch: net.epoch,
      locked: room.locked, urls: room.urls, max: room.max, lan: room.lan ? { ips: room.lan.ips, port: room.lan.port } : null,
    };
  }

  /** Schedule a 'lobby' broadcast (sent at most every 100 ms) and refresh the room-list info. */
  broadcastLobby() {
    this._lobbyDirty = true;
  }

  _flushLobby(force = false) {
    if (!this._lobbyDirty && !force) return;
    const now = performance.now();
    if (!force && now - this._lobbySentAt < NET.LOBBY_DEBOUNCE_MS) return;
    this._lobbyDirty = false;
    this._lobbySentAt = now;
    const net = this.net;
    const room = this.lobbyRoom();
    net.room.players = room.players;
    net.room.phase = net.phase;
    net.send({ k: 'lobby', room }, 'all');
    this.game.events.emit('net:lobby', { room: net.room });
    if (net.transport && net.transport.inRoom) {
      const cfg = room.cfg || {};
      net.transport.meta({
        host: this.hostName, map: cfg.mapId, mode: cfg.mode, players: room.players.length, max: room.max, phase: net.phase,
        lateJoin: false, build: net.build,
      }).catch(() => {});
    }
  }

  // ------------------------------------------------------------------ match flow

  _freezeConfig(cfg) {
    const s = this.game.settings;
    const def = getMap(cfg && cfg.mapId) || MAPS[0];
    return {
      mapId: def.id,
      mode: MODES.includes(cfg && cfg.mode) ? cfg.mode : 'ffa',
      botCount: clamp(Math.round(Number(cfg && cfg.botCount) || 0), 0, 15),
      difficulty: DIFFICULTIES.includes(cfg && cfg.difficulty) ? cfg.difficulty : 'normal',
      scoreLimit: Math.max(0, Math.round(Number(cfg && cfg.scoreLimit) || 0)),
      timeLimit: Math.max(0, Number(cfg && cfg.timeLimit) || 0),
      arsenal: cfg && cfg.arsenal ? JSON.parse(JSON.stringify(cfg.arsenal)) : s.get('botArsenal'),
      pool: freezePool((cfg && cfg.pool) ?? s.get('loadoutPool')),
      snapHz: s.get('mpSnapHz') === 30 ? 30 : 60,
      lateJoin: s.get('mpLateJoin') !== false,
      botFill: s.get('mpBotFill') !== false,
      teams: s.get('mpTeams') === 'pick' ? 'pick' : 'auto',
    };
  }

  /** START / REMATCH: new epoch, everyone loads the map. Called inside the click (the host requests pointer lock). */
  start() {
    const net = this.net, game = this.game;
    if (net.phase === 'loading' || net.phase === 'connecting') {
      warnOnce('start-phase', `[net] start() ignored while ${net.phase}`);
      return;
    }
    net._flush();
    net.epoch = (net.epoch + 1) & 255;
    const cfg = this._freezeConfig(net.room.cfg);
    this.matchCfg = cfg;
    this._expected.clear();
    for (const r of this.peers.values()) {
      r.loaded = false;
      r.progress = 0;
      r.inMatch = false;
      r.entity = null;
      r.snapHz = cfg.snapHz;
      if (r.helloed && r.connected) this._expected.add(r.peer);
    }
    this.hostLoaded = false;
    this._begun = false;
    this._forced = false;
    this._endPending = false;
    this._loadStart = performance.now();
    net._setPhase('loading');
    net.send({ k: 'load', e: net.epoch, cfg }, 'all');
    this.broadcastLobby();
    net._flush();
    const epoch = net.epoch, gen = net.sessionGen;
    game.netLoadMatch(cfg).then(ok => {
      if (ok && epoch === net.epoch && gen === net.sessionGen) {
        this.hostLoaded = true;
        this.broadcastLobby();
      }
    }, err => console.error('[net] host load failed', err));
  }

  forceBegin() {
    if (this.net.phase === 'loading' && !this._begun) this._forced = true;
  }

  /** Everyone back to the lobby. */
  toLobby() {
    const net = this.net;
    for (const r of this.peers.values()) {
      r.ready = false;
      r.loaded = false;
      r.inMatch = false;
      r.entity = null;
    }
    this.hostLoaded = false;
    this._begun = false;
    net._setPhase('lobby');
    this._flushLobby(true);
    this.game.netReturnToLobby();
  }

  /** Host frame start: deploy deadlines, the load barrier. */
  beginFrame() {
    const net = this.net;
    if (this._begun && this.remotes.size) {
      const now = net.clock.hostNowMs();
      for (const rp of this.remotes.values()) if (rp.awaitingDeploy && now >= rp.deployDeadline) this.onDeploy(rp.peer);
    }
    if (net.phase !== 'loading' || this._begun || !this.hostLoaded) return;
    let waiting = 0;
    for (const p of this._expected) {
      const r = this.peers.get(p);
      if (r && r.connected && !r.loaded) waiting++;
    }
    if (waiting === 0 || this._forced || performance.now() - this._loadStart > NET.LOAD_TIMEOUT_S * 1000) this.beginMatch();
  }

  /** Build the match: ids, teams, entities, spawns; a 'begin' per loaded client; then the countdown. */
  beginMatch() {
    const net = this.net, game = this.game, s = game.settings;
    const cfg = this.matchCfg;
    this._begun = true;
    this._building = true;
    const loaded = [...this.peers.values()].filter(r => r.helloed && r.connected && r.loaded).sort((a, b) => a.peer - b.peer);
    const hostColor = colorOf(s.get('playerColor'));
    const used = new Set();
    const pickColor = (want, i) => {
      let c = want >= 0 && !used.has(want) ? want : -1;
      for (let k = 0; c < 0 && k < HUMAN_COLORS.length; k++) {
        const h = HUMAN_COLORS[(i + k) % HUMAN_COLORS.length];
        if (!used.has(h)) c = h;
      }
      if (c < 0) c = HUMAN_COLORS[i % HUMAN_COLORS.length];
      used.add(c);
      return c;
    };
    const humans = [{ peer: 0, name: this.hostName, pref: this.hostTeamPref, color: pickColor(hostColor >= 0 ? hostColor : PLAYER_COLOR, 0) }];
    loaded.forEach((r, i) => humans.push({ peer: r.peer, name: r.name, pref: r.pref, color: pickColor(r.color, i + 1) }));
    const botCount = Math.min(cfg.botCount, NET.MAX_FIGHTERS - humans.length);
    const plan = planMatch({ mode: cfg.mode, humans, botCount });
    const team = isTeamMode(cfg.mode);
    const def = getMap(cfg.mapId) || MAPS[0];
    const now = net.clock.hostNowMs();

    game._nextEntityId = 1;
    game.match = {
      ...cfg,
      botCount,
      mapName: def.name,
      timeLeft: cfg.timeLimit > 0 ? cfg.timeLimit * 60 : Infinity,
      teamScores: { 1: 0, 2: 0 },
      over: false, reason: null, winner: null, winnerId: 0, winnerTeam: 0, playerWon: false, results: null, draw: false,
      startTime: game.time,
      phase: 'countdown',
      liveAtNet: now + NET.COUNTDOWN_S * 1000,
      liveAt: game.time + NET.COUNTDOWN_S,
      online: true,
      epoch: net.epoch,
      departed: [],
    };
    const pl = game.player;
    pl.reset();
    pl.name = this.hostName;
    pl.netHost = true;
    pl.netPeer = 0;
    pl.ping = 0;
    if (!game.spectate) game.addEntity(pl);
    const hp = plan.humans[0];
    pl.team = team ? hp.team : pl.id;
    pl.color.set(team ? TEAM_COLORS[hp.team] : hp.color);
    loaded.forEach((r, i) => {
      const h = plan.humans[i + 1];
      const rp = new RemotePlayer(game, { peer: r.peer, sid: r.sid, name: r.name, team: h.team, color: team ? TEAM_COLORS[h.team] : h.color, cg: r.cg, pick: r.pick });
      game.addEntity(rp);
      if (!team) rp.team = rp.id;
      rp.ping = r.ping;
      this.remotes.set(r.peer, rp);
      r.entity = rp;
      r.inMatch = true;
      r.snapAcc = 1;   // first snapshot right away
    });
    game.bots.spawnBots(botCount, cfg.difficulty, cfg.mode, { teams: plan.botTeams, reservedNames: humans.map(h => h.name) });
    game.weapons.onMatchStart();
    for (const e of game.entities) {
      e.kills = 0;
      e.deaths = 0;
      e.streak = 0;
      e.tier = 0;
      e.zoneTime = 0;
    }
    game.modes.onMatchStart(game.match);
    for (const e of game.entities) game.respawnEntity(e);
    net.me.entityId = pl.id;
    for (const r of loaded) net.send(this.buildBegin(r), r.peer);
    this._building = false;
    net.send({ k: 'phase', ph: 'countdown', at: Math.round(game.match.liveAtNet) }, 'all');
    this._lastScore.clear();
    game.netBeginMatch(null);
    net._setPhase('playing');
    this.broadcastLobby();
  }

  /** A roster row of an entity. */
  rosterRow(e) {
    const game = this.game;
    return {
      id: e.id, name: e.name, team: e.team, color: e.color.getHex(), kind: e.isBot ? 'bot' : 'human',
      peer: e === game.player ? 0 : e.isRemote ? e.peer : -1, host: e === game.player,
    };
  }

  /** Full-state catch-up message for one client (the match start, later also late joiners). */
  buildBegin(r) {
    const net = this.net, game = this.game, m = game.match, clock = net.clock;
    const rp = r.entity;
    const net0 = t => toWireTime(clock.hostGameToNet(game, t));
    const msg = {
      k: 'begin', e: net.epoch, you: rp ? rp.id : 0, grantSeq: rp ? rp.grantSeq : 0, cfg: this.matchCfg,
      roster: game.entities.map(e => this.rosterRow(e)),
      match: {
        mapName: m.mapName, timeLeft: Number.isFinite(m.timeLeft) ? r1(m.timeLeft) : NET.NEVER, startT: net0(m.startTime),
        teamScores: { 1: m.teamScores[1] || 0, 2: m.teamScores[2] || 0 }, phase: m.phase, liveAt: Math.round(m.liveAtNet),
        ladder: m.ladder || null, botCount: m.botCount, scoreLimit: m.scoreLimit,
      },
      ents: game.entities.map(e => ({
        id: e.id, alive: !!e.alive, hold: !!e.netHold, pos: wirePos(e.authPos), yaw: r3(e.yaw),
        kills: e.kills | 0, deaths: e.deaths | 0, streak: e.streak | 0, tier: e.tier | 0, zoneTime: r1(e.zoneTime || 0),
        ra: e.respawnAt >= 0 ? net0(e.respawnAt) : NET.NEVER,
      })),
      pickups: ((game.world.pickups && game.world.pickups.list) || []).map(p => ({
        id: p.id, available: !!p.available, nr: p.available ? NET.NEVER : net0(p.nextRespawn),
      })),
      smokes: [],
      spawn: rp && rp.alive ? {
        p: wirePos(rp.position), y: r3(rp.yaw), ss: rp.spawnSeq, pu: net0(rp.spawnProtectedUntil),
        lo: game.modes.isEscalation ? game.modes.loadoutFor(rp) : undefined,
      } : null,
      deploy: false,
      at: Math.round(clock.hostNowMs()),
    };
    for (const fn of this._extBegin) {
      try { fn(r, msg); } catch (err) { console.error('[net] onBuildBegin extension failed', err); }
    }
    return msg;
  }

  /**
   * A human who finished loading after the match began (joined late, or loaded too slowly): a RemotePlayer that is
   * not in play yet (no damage, not a target, no spawn) until the player deploys (click) or 10 s pass; then it spawns
   * with 3 s of protection. Never spawns here: the client first builds the match from 'begin'.
   */
  attachLate(r) {
    const net = this.net, game = this.game, m = game.match, cfg = this.matchCfg;
    if (!m || r.inMatch) return;
    const humans = game.entities.filter(e => e.isHuman).length;
    if (humans >= NET.MAX_HUMANS || game.entities.length >= NET.MAX_FIGHTERS) {
      warnOnce('full:' + r.peer, `[net] ${r.name} cannot join the running match (full); waits for the next one`);
      return;
    }
    let plan = planLateJoin({ mode: cfg.mode, entities: game.entities, pref: r.pref, index: humans });
    try { plan = this.policy.onLateJoin(r.peer, plan) || plan; } catch (err) { console.error('[net] policy.onLateJoin failed', err); }
    const team = isTeamMode(cfg.mode);
    const used = new Set(game.entities.filter(e => e.isHuman).map(e => e.color.getHex()));
    let color = team ? TEAM_COLORS[plan.team] : r.color >= 0 && !used.has(r.color) ? r.color : plan.color;
    if (!team && used.has(color)) color = HUMAN_COLORS.find(c => !used.has(c)) ?? color;
    const rp = new RemotePlayer(game, { peer: r.peer, sid: r.sid, name: r.name, team: plan.team, color, cg: r.cg, pick: r.pick });
    game.addEntity(rp);
    if (!team) rp.team = rp.id;
    rp.kills = rp.deaths = rp.streak = rp.tier = 0;
    rp.zoneTime = 0;
    rp.alive = false;
    rp.netHold = true;
    rp.awaitingDeploy = true;
    rp.deployDeadline = net.clock.hostNowMs() + NET.DEPLOY_TIMEOUT_S * 1000;
    rp.spawnProtectS = NET.LATE_SPAWN_PROTECT_S;
    rp.ping = r.ping;
    this.remotes.set(r.peer, rp);
    r.entity = rp;
    r.inMatch = true;
    r.snapAcc = 1;
    const begin = this.buildBegin(r);
    begin.deploy = true;
    begin.spawn = null;
    net.send(begin, r.peer);
    const row = this.rosterRow(rp);
    net.send({ k: 'ros', add: [{ ...row, alive: false, hold: true, kills: 0, deaths: 0, streak: 0, tier: 0, zoneTime: 0 }] }, 'all');
    this.broadcastLobby();
  }

  /** A late joiner deployed (clicked in, or the deploy deadline passed): it spawns now. */
  onDeploy(peer) {
    const rp = this.remotes.get(peer);
    if (!rp || !rp.awaitingDeploy || !this.game.match || this.game.match.over) return;
    rp.awaitingDeploy = false;
    rp.netHold = !rp.connected;
    if (!rp.netHold) this.game.respawnEntity(rp);
  }

  /** Dispose the RemotePlayers of the finished match (Game._clearMatch). */
  clearMatch() {
    this.history.clear();
    this._fireQueue.length = 0;
    for (const rp of this.remotes.values()) {
      this.game.removeEntity(rp);
      rp.dispose();
    }
    this.remotes.clear();
    for (const r of this.peers.values()) {
      r.entity = null;
      r.inMatch = false;
    }
  }

  // ------------------------------------------------------------------ runtime

  /** A CSTATE packet from a client. */
  onState(peer, u8, recvMs) {
    const rp = this.remotes.get(peer);
    const r = this.peers.get(peer);
    if (!rp || !r) return;
    const st = this._st;
    if (!decodeClientState(this._r.reset(u8), st)) {
      this.stats.statesBad++;
      warnOnce('cstate:' + peer, `[net] malformed state packet from ${r.name}`);
      return;
    }
    this.stats.statesIn++;
    const arrival = recvMs - this.net.clock.t0;
    r.lag.add(recvMs, arrival - st.tHost);
    rp.onState(st, arrival);
    r.lastAck = rp.lastStateSeq < 0 ? 0 : rp.lastStateSeq;
  }

  updateRemotes(dt) {
    this._drainFire();
    for (const rp of this.remotes.values()) {
      try {
        rp.update(dt);
      } catch (err) {
        warnOnce('rp-update', '[net] RemotePlayer update failed', err);
      }
    }
  }

  /** Host frame end: lobby broadcast, ping table, snapshots, the end-of-match message (last in the broadcast batch). */
  endFrame(raw) {
    const net = this.net, game = this.game;
    this._flushLobby();
    const now = performance.now();
    if (now - this._pingsAt > 1000 / NET.PINGS_BROADCAST_HZ && game.match) {
      this._pingsAt = now;
      const p = [];
      for (const rp of this.remotes.values()) p.push([rp.id, rp.ping | 0]);
      if (p.length) net.send({ k: 'pings', p }, 'all');
    }
    if (game.match) this._sendForces();
    if (game.match && (game.state === 'playing' || game.state === 'ended')) this._snapshots(raw);
    if (this._endPending) {
      this._endPending = false;
      this._sendEnd();
    }
  }

  _sendEnd() {
    const net = this.net, game = this.game, m = game.match;
    if (!m) return;
    const strip = r => {
      const { isLocal, isPlayer, ...rest } = r;   // per-client fields are recomputed by each client
      return rest;
    };
    net.send({
      k: 'end', reason: m.reason, winnerId: m.winnerId | 0, winnerTeam: m.winnerTeam | 0,
      teamScores: { 1: m.teamScores[1] || 0, 2: m.teamScores[2] || 0 },
      results: (m.results || []).map(strip), departed: (m.departed || []).map(strip),
      at: Math.round(net.clock.hostNowMs()),
    }, 'all');
    net._setPhase('ended');
    this.broadcastLobby();
  }

  _snapshots(raw) {
    const due = this._due || (this._due = []);
    due.length = 0;
    for (const r of this.peers.values()) {
      if (!r.inMatch || !r.connected || !r.entity) continue;
      r.snapAcc += raw;
      const iv = 1 / r.snapHz;
      if (r.snapAcc + 0.002 < iv) continue;
      r.snapAcc = Math.min(Math.max(0, r.snapAcc - iv), iv);
      due.push(r);
    }
    if (!due.length) return;
    const net = this.net, game = this.game, m = game.match;
    const tHost = net.clock.hostNowMs();
    const body = this._body.begin();
    const keyframe = this._bodySeq % NET.SCORE_KEYFRAME < 2;   // two in a row: a 30 Hz client sees one of them
    this._bodySeq++;
    for (const e of game.entities) this._entityRecord(e, body, keyframe, tHost);
    const ctx = { game, net, tHost, keyframe };
    for (const [id, codec] of net._sections) {
      if (codec.encode) body.section(id, w => codec.encode(w, ctx));
    }
    body.end();
    const hdr = this._hdr;
    hdr.epoch = net.epoch;
    hdr.snapSeq = ++this._snapSeq >>> 0;
    hdr.tHost = tHost;
    hdr.timeLeftDs = Number.isFinite(m.timeLeft) ? Math.max(0, Math.min(0xfffe, Math.round(m.timeLeft * 10))) : TIME_NONE;
    hdr.teamScore1 = m.teamScores[1] || 0;
    hdr.teamScore2 = m.teamScores[2] || 0;
    hdr.phase = m.over ? PHASE_CODE.over : m.phase === 'countdown' ? PHASE_CODE.countdown : PHASE_CODE.live;
    hdr.count = body.count;
    const clock = net.clock;
    for (const r of due) {
      const rp = r.entity;
      hdr.flags = (keyframe ? SF.KEYFRAME : 0) | (r.snapHz < this.matchCfg.snapHz ? SF.FALLBACK : 0);
      hdr.ackSeq = r.lastAck & 0xffff;
      hdr.ownId = rp.id;
      hdr.health = rp.health;
      hdr.armor = rp.armor;
      hdr.ownFlags = (rp.alive ? OWN.ALIVE : 0) | (rp.isProtected() ? OWN.PROTECTED : 0) | (rp.isShocked() ? OWN.SHOCKED : 0)
        | (rp.netHold ? OWN.HELD : 0);
      hdr.protectedUntil = rp.isProtected() ? clock.hostGameToNet(game, rp.spawnProtectedUntil) : 0;
      hdr.shockedUntil = rp.isShocked() ? clock.hostGameToNet(game, rp.shockedUntil) : 0;
      const pkt = writeSnapshot(this._w, hdr, body);
      if (net.sendNow(pkt, r.peer)) {
        this.stats.snapsOut++;
        this.stats.snapBytes += pkt.length;
        if (pkt.length > this.stats.snapMax) this.stats.snapMax = pkt.length;
      }
    }
    for (const e of game.entities) if (e.teleportHold > 0) e.teleportHold--;
  }

  _entityRecord(e, body, keyframe, tHost) {
    const game = this.game;
    const rec = this._rec;
    let f = e.alive ? EF.ALIVE : 0, f2 = 0;
    const p = e.authPos;
    rec.id = e.id;
    rec.px = p.x; rec.py = p.y; rec.pz = p.z;
    rec.vx = e.velocity.x; rec.vy = e.velocity.y; rec.vz = e.velocity.z;
    rec.yaw = e.yaw;
    rec.pitch = e.pitch;
    rec.h = e.height;
    rec.charge = 0;
    rec.gx = rec.gy = rec.gz = 0;
    rec.bx = rec.by = rec.bz = 0;
    if (e === game.player) {
      const w = game.weapons, g = e.grapple;
      if (e.onGround) f |= EF.GROUND;
      if (e.isCrouching) f |= EF.CROUCH;
      if (e.isSliding) f |= EF.SLIDE;
      if (e.isWallRunning) f |= EF.WALLRUN;
      if (e.isMantling) f |= EF.MANTLE;
      if (e.isSprinting) f |= EF.SPRINT;
      if (game.time - w.lastFireTime < 0.15) f |= EF.FIRING;
      if (w.reloading) f |= EF.RELOAD;
      if (w.beamActive === true) {
        f |= EF.BEAM;
        if (w.beamEnd) { rec.bx = w.beamEnd.x; rec.by = w.beamEnd.y; rec.bz = w.beamEnd.z; }
      }
      if (w.charging) { f |= EF.CHARGE; rec.charge = w.chargeAmount; }
      if (w.adsAmount > 0.5) f |= EF.AIM;
      const gs = GRAPPLE_CODE[g.state] | 0;
      f2 |= gs;
      if (gs === 1) { rec.gx = g.target.x; rec.gy = g.target.y; rec.gz = g.target.z; }
      else if (gs === 2) { rec.gx = g.anchor.x; rec.gy = g.anchor.y; rec.gz = g.anchor.z; }
      rec.weapon = WEAPON_INDEX[w.currentId] | 0;
    } else if (e.isRemote) {
      // the client's reports, not the host's smoothed view (other clients interpolate them themselves: no double
      // delay), evaluated at this snapshot's own time: the newest report is a few ms older than the snapshot, so it is
      // carried forward with its velocity (at most one report interval) instead of being stamped as if it were new
      const raw = e.raw;
      rec.yaw = raw.yaw;
      rec.pitch = raw.pitch;
      rec.h = raw.h;
      const rs = this._rs;
      if (e.alive && e.buf.size && e.buf.sample(tHost, rs, 1000 / NET.STATE_HZ) !== 'empty') {
        rec.px = rs.px; rec.py = rs.py; rec.pz = rs.pz;
        rec.vx = rs.vx; rec.vy = rs.vy; rec.vz = rs.vz;
        rec.yaw = rs.yaw;
        rec.pitch = rs.pitch;
        rec.h = rs.h;
      }
      f |= raw.flags & 0x0ffe;   // CSTATE bits 1..11 = snapshot bits 1..11
      f2 |= raw.flags2 & EF2.GRAPPLE_MASK;
      if (f2 & EF2.GRAPPLE_MASK) { rec.gx = raw.grapple.x; rec.gy = raw.grapple.y; rec.gz = raw.grapple.z; }
      if (f & EF.BEAM) { rec.bx = raw.beam.x; rec.by = raw.beam.y; rec.bz = raw.beam.z; }
      if (f & EF.CHARGE) rec.charge = raw.charge;
      if (e.lagging) f |= EF.LAGGING;
      if (!e.connected) f2 |= EF2.DISCONNECTED;
      rec.weapon = raw.weapon || WEAPON_INDEX[e.weaponId] | 0;
    } else if (e.isBot) {
      if (e.onGround) f |= EF.GROUND;
      if (e.crouch > 0.5) f |= EF.CROUCH;
      if (game.time < e._firingUntil) f |= EF.FIRING;
      if (e.reloading) f |= EF.RELOAD;
      if (e.brain && e.brain.faceAim) f |= EF.AIM;
      if (game.time - (e._beamLastT ?? -10) < 0.1 && e.beamEnd) {
        f |= EF.BEAM;
        rec.bx = e.beamEnd.x; rec.by = e.beamEnd.y; rec.bz = e.beamEnd.z;
      }
      if (e.charging) { f |= EF.CHARGE; rec.charge = e.chargeFrac || 0; }
      rec.weapon = WEAPON_INDEX[e.weaponId] | 0;
    } else {
      rec.weapon = 0;
    }
    if (e.isShocked()) f |= EF.SHOCKED;
    if (e.isProtected()) f |= EF.PROTECTED;
    if (e.teleportHold > 0) f |= EF.TELEPORT;
    if (e.netHold) f2 |= EF2.HELD;
    // scores: on keyframes and for two bodies after a change
    const k = e.kills | 0, d = e.deaths | 0, t = e.tier | 0, z = Math.round((e.zoneTime || 0) * 10);
    let last = this._lastScore.get(e);
    if (!last) { last = { k: -1, d: -1, t: -1, z: -1, until: 0 }; this._lastScore.set(e, last); }
    if (last.k !== k || last.d !== d || last.t !== t || last.z !== z) {
      last.k = k; last.d = d; last.t = t; last.z = z;
      last.until = this._bodySeq + 1;
    }
    if (keyframe || this._bodySeq <= last.until) {
      f2 |= EF2.HAS_SCORE;
      rec.kills = k; rec.deaths = d; rec.tier = t; rec.zoneTime = z / 10;
    }
    rec.flags = f;
    rec.flags2 = f2;
    body.entity(rec);
    this._record(e, rec, tHost);
  }

  _record(e, rec, tHost) {
    let h = this.history.get(e);
    if (!h) {
      h = {
        t: new Float64Array(HISTORY), x: new Float32Array(HISTORY), y: new Float32Array(HISTORY), z: new Float32Array(HISTORY),
        h: new Float32Array(HISTORY), vx: new Float32Array(HISTORY), vy: new Float32Array(HISTORY), vz: new Float32Array(HISTORY), i: 0, n: 0,
      };
      this.history.set(e, h);
    }
    const i = h.i;
    h.t[i] = tHost; h.x[i] = rec.px; h.y[i] = rec.py; h.z[i] = rec.pz; h.h[i] = rec.h;
    h.vx[i] = rec.vx; h.vy[i] = rec.vy; h.vz[i] = rec.vz;
    h.i = (i + 1) % HISTORY;
    if (h.n < HISTORY) h.n++;
  }

  /**
   * Where `entity` was in the snapshots at host time tMs (linear between the two bracketing snapshots; clamped to the
   * recorded range) into `out` {x, y, z, h, vx, vy, vz}. @returns {boolean} false when nothing is recorded
   */
  sampleHistory(entity, tMs, out) {
    const h = this.history.get(entity);
    if (!h || !h.n) return false;
    let newer = -1;
    for (let k = 0; k < h.n; k++) {
      const j = (h.i - 1 - k + HISTORY) % HISTORY;
      if (h.t[j] <= tMs) {
        const a = j, b = newer < 0 ? j : newer;
        const span = h.t[b] - h.t[a];
        const s = span > 0 ? Math.min(1, (tMs - h.t[a]) / span) : 0;
        out.x = h.x[a] + (h.x[b] - h.x[a]) * s;
        out.y = h.y[a] + (h.y[b] - h.y[a]) * s;
        out.z = h.z[a] + (h.z[b] - h.z[a]) * s;
        out.h = h.h[a] + (h.h[b] - h.h[a]) * s;
        out.vx = h.vx[b]; out.vy = h.vy[b]; out.vz = h.vz[b];
        return true;
      }
      newer = j;
    }
    const j = newer;   // older than everything recorded: the oldest sample
    out.x = h.x[j]; out.y = h.y[j]; out.z = h.z[j]; out.h = h.h[j];
    out.vx = h.vx[j]; out.vy = h.vy[j]; out.vz = h.vz[j];
    return true;
  }

  // ------------------------------------------------------------------ combat from clients

  _reject(peer, ci, why) {
    const st = this.stats.claims;
    st.rejected[why] = (st.rejected[why] || 0) + 1;
    this.net.send({ k: 'clr', ci: ci & 0xffff, why }, peer);
    const r = this.peers.get(peer);
    warnOnce(`claim:${peer}:${why}`, `[net] claim from ${r ? r.name : peer} rejected (${why})`);
  }

  /**
   * A client's damage claim (favor the shooter): its own hitscan / melee / beam hit on what it was shown. Validated
   * against the target's snapshot history at the time the shooter saw it, then applied with the RemotePlayer as the
   * attacker (the 'dmg' echo carries the claim id).
   */
  onClaim(m, peer) {
    const net = this.net, game = this.game, mt = game.match;
    const rp = this.remotes.get(peer);
    const r = this.peers.get(peer);
    const ci = m.ci | 0;
    this.stats.claims.in++;
    if (!rp || !r || !mt || mt.over || mt.phase === 'countdown') { this._reject(peer, ci, 'state'); return; }
    const now = net.clock.hostNowMs();
    const ft = num(m.ft, now), st = num(m.st, now);
    if (ft < now - NET.CLAIM_LATE_MS) { this._reject(peer, ci, 'late'); return; }
    if (!rp.alive && !(ft <= rp.deathNetMs + NET.CLAIM_TRADE_MS)) { this._reject(peer, ci, 'dead'); return; }
    const target = game.getEntityById(m.t | 0);
    if (!target || !target.alive || target === rp || target.netHold || target.team === rp.team) { this._reject(peer, ci, 'target'); return; }
    const w = String(m.w);
    const def = WEAPONS[w];
    if (!CLAIM_WEAPONS.has(w) || (w !== 'melee' && !def)) { this._reject(peer, ci, 'weapon'); return; }
    if (w !== 'melee' && w !== rp.weaponId && now - rp.weaponChangedAtMs > 500) { this._reject(peer, ci, 'weapon'); return; }
    const head = !!m.h;
    let cap;
    if (w === 'melee') cap = MELEE.damage;
    else if (w === 'arc') cap = def.damage * 3;
    else cap = def.damage * (head ? def.headshotMult || 1 : 1) * (def.speedBonus ? 1 + def.speedBonus.damage : 1);
    const n = num(m.n);
    if (!(n > 0) || n > cap * 1.02 + 0.01) { this._reject(peer, ci, 'amount'); return; }
    // rate: a token bucket per weapon (a burst stuck behind a Wi-Fi stall still fits)
    const b = r.buckets || (r.buckets = {});
    let bk = b[w];
    const refill = w === 'melee' ? 2 : (def.fireRate || 1) * (def.pellets || 1) * (w === 'arc' ? 1 + (def.beam ? def.beam.chainMax : 0) : 1)
      * (def.pierce ? def.pierce.entities : 1) * 1.3 + 2;
    if (!bk) bk = b[w] = { tokens: refill, at: now };
    bk.tokens = Math.min(refill, bk.tokens + (now - bk.at) / 1000 * refill);
    bk.at = now;
    if (bk.tokens < 1) { this._reject(peer, ci, 'rate'); return; }
    bk.tokens -= 1;
    // position: the hit point inside the target's (inflated) hitbox as the shooter's snapshots showed it
    const point = readVec(m.p, _hp) ? _hp : null;
    if (point) {
      const hs = this._hs;
      const seen = Math.min(now, Math.max(now - NET.CLAIM_REWIND_MAX_MS, st));
      if (this.sampleHistory(target, seen, hs)) {
        const I = 1 / Math.max(1, r.snapHz);
        const vh = Math.hypot(hs.vx, hs.vz), vy = Math.abs(hs.vy);
        const dh = Math.hypot(point.x - hs.x, point.z - hs.z);
        const lo = hs.y - 0.4 - vy * I, hi = hs.y + hs.h + 0.4 + vy * I;
        if (dh > 0.6 + NET.CLAIM_POS_TOL_M + vh * I || point.y < lo || point.y > hi) { this._reject(peer, ci, 'position'); return; }
      }
      // range from the shooter's reported eye
      const range = w === 'arc' ? def.range + def.beam.chainRadius + 1 : w === 'melee' ? 4 : (def.range || 250) + 3;
      _eye.set(rp.netPos.x, rp.netPos.y + rp.raw.h - 0.14, rp.netPos.z);
      if (_eye.distanceTo(point) > range) { this._reject(peer, ci, 'range'); return; }
    }
    let kb = null;
    if (m.kb !== undefined) {
      if (w !== 'melee' || !readVec(m.kb, _hk) || _hk.length() > 6) { this._reject(peer, ci, 'kb'); return; }
      kb = _hk.clone();
    }
    const dir = readVec(m.d, _hd) ? _hd.clone() : null;
    this._claimCtx = { rp, ci };
    try {
      game.combat.applyDamage(target, {
        amount: n, attacker: rp, weapon: w, headshot: head, point: point ? point.clone() : null, direction: dir, knockback: kb,
      });
      this.stats.claims.applied++;
    } finally {
      this._claimCtx = null;
    }
  }

  /** A client's own shot: muzzle flash on its avatar (at its smoothed time), bots hear it, everyone else sees it. */
  onClientFire(m, peer) {
    const net = this.net, game = this.game;
    const rp = this.remotes.get(peer);
    if (!rp || !rp.alive || !game.match) return;
    const w = String(m.w);
    if (!WEAPONS[w]) return;
    const o = new THREE.Vector3(), d = new THREE.Vector3();
    if (!readVec(m.o, o) || !readVec(m.d, d)) return;
    this.stats.fires++;
    const t = num(m.t, net.clock.hostNowMs());
    this._fireQueue.push({ t, rp, w, d });
    game.events.emit('weapon:fire', { shooter: rp, weapon: w, origin: o, direction: d });
    net.send({ k: 'fire', e: rp.id, w, o: m.o, d: m.d, t: Math.round(t) }, 'all');
  }

  /** A client's fall backstop: it is below the kill plane and nothing killed it yet. */
  onFall(m, peer) {
    const game = this.game, rp = this.remotes.get(peer);
    if (!rp || !rp.alive || !game.match || game.match.over) return;
    const recent = rp.lastAttacker && game.time - rp.lastDamageTime < 6 ? rp.lastAttacker : null;
    game.combat.kill(rp, { attacker: recent, weapon: 'fall' });
  }

  /**
   * Give something to a remote human (pickups, Escalation): decided with the inventory mirror, applied by its client.
   * @param {RemotePlayer} rp @param {{kind: 'weapon'|'ammo'|'nades'|'escw', w?: string, f?: number, n?: number, ty?: string}} g
   * @returns {boolean} true if it was granted (the pickup is consumed)
   */
  grant(rp, g) {
    const inv = rp.inv;
    switch (g.kind) {
      case 'weapon': {
        const def = WEAPONS[g.w];
        if (!def) return false;
        if (inv.owned.has(g.w) && (!Number.isFinite(def.reserveMax) || inv.full.has(g.w))) return false;
        inv.owned.add(g.w);
        inv.full.delete(g.w);
        break;
      }
      case 'ammo': {
        const ids = g.w ? [g.w] : [...inv.owned];
        if (!ids.some(id => WEAPONS[id] && Number.isFinite(WEAPONS[id].reserveMax) && inv.owned.has(id) && !inv.full.has(id))) return false;
        break;
      }
      case 'nades': {
        const def = GRENADE_TYPES[g.ty || 'frag'];
        if (!def) return false;
        const ty = g.ty || 'frag';
        if ((inv.nades[ty] | 0) >= def.maxCarry) return false;
        inv.nades[ty] = Math.min(def.maxCarry, (inv.nades[ty] | 0) + Math.max(1, g.n | 0));
        break;
      }
      case 'escw':
        if (!WEAPONS[g.w]) return false;
        inv.owned = new Set(['pistol', g.w]);
        inv.full.clear();
        break;
      default:
        return false;
    }
    rp.grantSeq = (rp.grantSeq + 1) & 255;
    this.net.send({ k: 'grant', s: rp.grantSeq, ...g }, rp.peer);
    this.stats.grants++;
    return true;
  }

  /** Knockback / launches computed here for remote humans go to their clients (they simulate their own bodies). */
  _sendForces() {
    const net = this.net;
    for (const rp of this.remotes.values()) {
      const live = rp.alive && rp.connected && !rp.netHold;
      if (live && rp._pendingLaunch) net.send({ k: 'lnch', v: wireDir3(rp._pendingLaunch) }, rp.peer);
      if (live && rp._pendingImpulse.lengthSq() > 1e-8) {
        net.send({ k: 'imp', v: wireDir3(rp._pendingImpulse), src: rp._impSrc.slice(0, 8) }, rp.peer);
        this.stats.impulses++;
      }
      rp._pendingLaunch = null;
      rp._pendingImpulse.set(0, 0, 0);
      rp._impSrc.length = 0;
    }
  }

  /** Host frame: muzzle flashes of client shots once the smoothed avatar reaches the shot's time. */
  _drainFire() {
    const q = this._fireQueue;
    if (!q.length) return;
    const now = this.net.clock.hostNowMs();
    let k = 0;
    for (; k < q.length; k++) {
      const f = q[k];
      if (f.t > now - f.rp.delay.effectiveMs && now - f.t < NET.INTERP_MAX_MS) break;
      if (f.rp.alive) f.rp.onFire(f.w, null, f.d);
    }
    if (k) q.splice(0, k);
  }

  /** report.net (host). */
  report() {
    const peers = [];
    for (const r of this.peers.values()) {
      peers.push({
        peer: r.peer, name: r.name, ping: r.ping, jitterP95: r.jitterP95, lagP95: r.lagP95, fps: r.fps, snapHz: r.snapHz,
        stateLagP95: +r.lag.p95(performance.now()).toFixed(1), inMatch: r.inMatch, entityId: r.entity ? r.entity.id : 0,
        smoothDelayMs: r.entity ? +r.entity.delay.effectiveMs.toFixed(1) : 0,
      });
    }
    return { host: { ...this.stats, peers } };
  }
}

/**
 * Client side of a session: welcome / lobby / load / begin / roster / phase / end messages, one NetAvatar per other
 * fighter, snapshot decoding with interpolation on the "entity timeline" (host time minus a measured delay), the own
 * block (health, armor, protection, shock - host-authoritative), CSTATE packets with the local player's body state,
 * clock pings and the client's link-quality report.
 *
 * The local player is simulated here exactly as in single player (client-authoritative movement); everything else it
 * sees comes from the host.
 */
import * as THREE from 'three';
import { NET, PKT, WEAPON_INDEX, NADE_ORDER, CLAIM_WEAPONS, fromWireTime, readVec, wirePos, wireDir, num } from './GameProtocol.js';
import { installClient as installEvents, PICKUP_SECTION } from './NetEvents.js';
import { BinaryWriter, BinaryReader } from './protocol.js';
import {
  decodeSnapshot, makeEntityRecord, makeSnapshotHeader, encodeClientState, makeClientState, CF, OWN, SF, TIME_NONE,
} from './NetCodec.js';
import { NetAvatar } from './NetAvatar.js';
import { DelayEstimator, RollingP95 } from './NetClock.js';
import { WEAPONS, WEAPON_ORDER } from '../weapons/WeaponDefs.js';

const GRAPPLE_CODE = { idle: 0, flying: 1, attached: 2, retract: 3 };
const _v = new THREE.Vector3();
const _warned = new Set();
function warnOnce(key, ...args) {
  if (_warned.has(key)) return;
  _warned.add(key);
  console.warn(...args);
}

export class NetClient {
  /** @param {import('./NetSession.js').NetSession} net */
  constructor(net) {
    this.net = net;
    this.game = net.game;
    /** @type {Map<number, NetAvatar>} entity id -> proxy of another machine's fighter */
    this.avatars = new Map();
    /** Epoch for which netBeginMatch completed; -1 outside a match (in-match messages are dropped until then). */
    this.inMatchEpoch = -1;
    /** Between a deploy-gated 'begin' and the own spawn (mp-core-B). */
    this.awaitingDeploy = false;
    /** id -> {id, name, color, team, isBot, isHuman, alive: false, departed: true} of entities that left. */
    this.departed = new Map();
    this.delay = new DelayEstimator({ minMs: NET.INTERP_MIN_MS, maxMs: NET.INTERP_MAX_MS });
    /** The interpolation delay in use (ms). */
    this.interpDelayMs = 0;
    /** Render time (host net ms) of the last updateRemotes. */
    this.lastRenderMs = 0;
    /** Snapshot rate the host currently uses for this client. */
    this.snapHz = NET.SNAP_HZ;
    /** Packages hook these (mp-arsenal): Gale blast on a client, projectile / grenade actions. */
    this.hooks = { blast: () => ({ hits: 0, reflected: 0 }) };
    const noAct = name => () => warnOnce('act:' + name, `[net] client action '${name}' is not available yet (local only)`);
    this.act = { rocket: noAct('rocket'), nade: noAct('nade'), cook: noAct('cook') };
    // own state guards (host net ms of the last event that set each group)
    this.ownLifeAt = 0;
    this.ownHpAt = 0;
    this.scoreAt = 0;
    this.phaseAt = 0;
    this.spawnProtNet = 0;
    this.shockNet = 0;
    this.respawnAtNet = NET.NEVER;
    /** spawn.ss of the own spawn last applied (echoed in CSTATE). */
    this.stateSpawnSeq = 0;
    this.grantAck = 0;
    // CSTATE
    this._w = new BinaryWriter(96);
    this._st = makeClientState();
    this._seq = 0;
    this._stateAcc = 1;
    this._teleportHold = 0;
    // snapshots
    this._r = new BinaryReader();
    this._hdr = makeSnapshotHeader();
    this._rec = makeEntityRecord();
    this._newestSnapT = -Infinity;
    this._lastSnapSeq = -1;
    this._lag = new RollingP95(3000, 256, 250);
    this._muteLagUntil = 0;
    this._snapsIn = 0;
    this._snapsInAt = 0;
    this._snapsInWindow = 0;
    this.snapHzEff = 0;
    this._aliveDivergeSince = 0;
    this._clockSnaps = 0;
    this._delaySum = 0;
    this._delayN = 0;
    this._delayMax = 0;
    // pings / link report
    this._pingW = new BinaryWriter(32);
    this._pingSeq = 0;
    this._pingAt = 0;
    this._pingStart = performance.now();
    this._nqAt = 0;
    this._pingR = new BinaryReader();
    const self = this;
    this._sink = {
      header: h => self._onHeader(h),
      entity: rec => self._onEntity(rec),
      section: (id, r, len) => self._onSection(id, r, len),
    };
    this._snapT = 0;
    this._ownId = 0;
    this._ctx = { game: this.game, net, tHost: 0 };
    // claims (favor the shooter)
    this._claimSeq = 0;
    /** claim ids shown as predicted hit markers (the 'dmg' echo then only adds the number) */
    this.predicted = new Set();
    this._predictedOrder = [];
    this.claimStats = { sent: 0, applied: 0, rejected: {}, ghost: 0 };
    // replayed presentation on the entity timeline (other humans' shots)
    this._sched = [];
    this._belowSince = 0;
    this._fallSent = false;
    /** grant kind -> fn(msg) applying it to the local arsenal */
    this._grants = new Map();
    this._off = [];
    /** fn(dt, renderMs) after the proxies moved each frame (plugins: replicated projectiles) */
    this.frameHooks = [];
    this._clearHooks = [];
  }

  /** Run fn whenever the match's replicated state is cleared (a new match, back to the lobby). */
  onClear(fn) {
    this._clearHooks.push(fn);
  }

  install() {
    const net = this.net;
    net.on('welcome', m => this.onWelcome(m));
    net.on('lobby', m => this.onLobby(m));
    net.on('load', m => this.onLoad(m));
    net.on('begin', m => this.onBegin(m));
    net.on('ros', m => this.onRoster(m));
    net.on('phase', m => this.onPhase(m));
    net.on('end', m => this.onEnd(m));
    net.on('sys', m => this.game.events.emit('net:sys', { kind: String(m.kind || ''), name: String(m.name || ''), color: m.color | 0 }));
    net.on('pings', m => this.onPings(m));
    installEvents(net);
    net.registerSection(1, PICKUP_SECTION);
    net.on('clr', m => this._onClaimRejected(m));
    net.on('fire', m => this._onRemoteFire(m));
    net.on('imp', m => this._onImpulse(m));
    net.on('lnch', m => this._onLaunch(m));
    net.on('grant', m => this._onGrant(m));
    const game = this.game, w = game.weapons;
    this.onGrant('weapon', m => w.giveWeapon(String(m.w)));
    this.onGrant('ammo', m => w.addAmmo(m.w ? String(m.w) : null, num(m.f, 0.5)));
    this.onGrant('nades', m => w.addGrenades(Math.max(1, m.n | 0), String(m.ty || 'frag')));
    this.onGrant('escw', m => w.setEscalationWeapon(String(m.w)));
    // own shots: the host shows the muzzle flash on this player's avatar and bots hear them
    this._off.push(game.events.on('weapon:fire', e => {
      if (!e || e.shooter !== game.player || this.inMatchEpoch !== net.epoch || !e.origin || !e.direction) return;
      net.send({ k: 'fire', w: e.weapon, o: wirePos(e.origin), d: wireDir(e.direction), t: Math.round(net.clock.hostNowMs()) });
    }));
    this._off.push(game.events.on('damage', e => {
      if (e && e.ci !== undefined && e.attacker === game.player && this.predicted.has(e.ci)) this.claimStats.applied++;
    }));
  }

  dispose() {
    for (const off of this._off) off();
    this._off.length = 0;
    this.clearMatch();
  }

  /** Register a grant kind (host -> owner inventory changes). @param {string} kind @param {(msg) => boolean} fn */
  onGrant(kind, fn) {
    this._grants.set(kind, fn);
  }

  _onGrant(m) {
    const fn = this._grants.get(m.kind);
    if (!fn) warnOnce('grant:' + m.kind, `[net] unknown grant '${m.kind}'`);
    else {
      try { fn(m); } catch (err) { console.error('[net] grant failed', err); }
    }
    this.grantAck = m.s & 255;
  }

  _onImpulse(m) {
    const p = this.game.player;
    if (!p.alive || !readVec(m.v, _v)) return;
    p.applyImpulse(_v.clone());
    if (this.game.autotest) (this.net.stats.custom.imp || (this.net.stats.custom.imp = [])).push([Math.round(this.net.clock.hostNowMs()), m.v, m.src]);
  }

  _onLaunch(m) {
    const p = this.game.player;
    if (!p.alive || !readVec(m.v, _v)) return;
    p.launch(_v.clone());
  }

  _onClaimRejected(m) {
    const why = String(m.why || '?');
    this.claimStats.rejected[why] = (this.claimStats.rejected[why] || 0) + 1;
    if (this.predicted.has(m.ci)) this.claimStats.ghost++;   // the marker was shown for a hit the host did not count
  }

  /** Another human's shot: its muzzle flash when the entity timeline reaches the shot. */
  _onRemoteFire(m) {
    const id = m.e | 0;
    if (id === this.game.player.id) return;
    const a = this.avatars.get(id);
    if (!a) return;
    const d = new THREE.Vector3(), o = new THREE.Vector3();
    if (!readVec(m.d, d) || !readVec(m.o, o)) return;
    const w = String(m.w);
    this._schedule(num(m.t), () => {
      if (!a.alive) return;
      a.onFire(w, o, d);
      this.game.events.emit('weapon:fire', { shooter: a, weapon: w, origin: o, direction: d });
    });
  }

  /** Run fn once the entity timeline reaches host time t (at once if it is already far behind). */
  _schedule(t, fn) {
    const q = this._sched;
    let i = q.length;
    while (i > 0 && q[i - 1].t > t) i--;
    q.splice(i, 0, { t, fn });
  }

  _drainSchedule(renderMs) {
    const q = this._sched;
    if (!q.length) return;
    const late = this.net.clock.hostNowMs() - NET.INTERP_MAX_MS;
    let k = 0;
    for (; k < q.length; k++) {
      if (q[k].t > renderMs && q[k].t > late) break;
      try { q[k].fn(); } catch (err) { console.error('[net] scheduled replay failed', err); }
    }
    if (k) q.splice(0, k);
  }

  // ------------------------------------------------------------------ session messages

  onWelcome(msg) {
    const net = this.net, game = this.game;
    if (msg.err) {
      net._onWelcome(msg);
      return;
    }
    net.me.cg = msg.cg & 255;
    net.me.sid = msg.sid || net.me.sid;
    if (msg.name) net._myName = msg.name;
    net.epoch = msg.epoch & 255;
    if (msg.room) net.room = { ...msg.room, server: net.server };
    if (msg.build) net.hostBuild = msg.build;
    // a welcome while this page still plays a match the host no longer has it in (a reconnect after the host dropped
    // us): back to the lobby until the next match
    if (this.inMatchEpoch >= 0 && !msg.you) game.netReturnToLobby();
    net._setPhase('lobby');
    net._onWelcome(msg);
    game.events.emit('net:lobby', { room: net.room });
  }

  onLobby(msg) {
    const net = this.net, game = this.game;
    if (!msg.room || typeof msg.room !== 'object') return;
    net.room = { ...msg.room, server: net.server };
    if (msg.room.phase === 'lobby' && net.phase !== 'lobby' && net.phase !== 'connecting') {
      game.netReturnToLobby();
      net._setPhase('lobby');
    }
    game.events.emit('net:lobby', { room: net.room });
  }

  onLoad(msg) {
    const net = this.net, game = this.game;
    if (!msg.cfg || typeof msg.cfg !== 'object') return;
    net.epoch = msg.e & 255;
    this.inMatchEpoch = -1;
    this.cfg = msg.cfg;
    this.snapHz = msg.cfg.snapHz === 30 ? 30 : NET.SNAP_HZ;
    net._setPhase('loading');
    const epoch = net.epoch, gen = net.sessionGen;
    game.netLoadMatch(msg.cfg).then(ok => {
      if (ok && epoch === net.epoch && gen === net.sessionGen) {
        net.send({ k: 'loaded' });
        net._flush();
      }
    }, err => console.error('[net] loading the match failed', err));
  }

  onBegin(msg) {
    const net = this.net;
    if ((msg.e & 255) !== net.epoch) return;
    if (!Array.isArray(msg.roster) || !msg.match) return;
    this.game.netBeginMatch(msg);
    net._setPhase('playing');
  }

  onRoster(msg) {
    const game = this.game;
    const me = this.net.me;
    if (Array.isArray(msg.add)) {
      for (const row of msg.add) {
        if (!row || typeof row.id !== 'number' || row.id === me.entityId || row.peer === me.peer && row.kind === 'human') continue;
        if (this.avatars.has(row.id)) continue;
        this.addAvatar(row, row);
      }
    }
    if (Array.isArray(msg.rem)) {
      for (const row of msg.rem) {
        if (!row || row.id === me.entityId) continue;
        const a = this.avatars.get(row.id);
        if (!a) continue;
        this.avatars.delete(row.id);
        game.removeEntity(a);
        a.dispose();
        this.departed.set(row.id, {
          id: row.id, name: a.name, color: a.color.clone(), team: a.team, isBot: a.isBot, isHuman: a.isHuman, alive: false, departed: true,
        });
      }
    }
  }

  onPhase(msg) {
    const m = this.game.match;
    const at = Number(msg.at) || 0;
    this.phaseAt = Math.max(this.phaseAt, at);
    if (!m) return;
    if (msg.ph === 'countdown') m.liveAtNet = at;
    else if (msg.ph === 'live' && m.phase === 'countdown') m.liveAtNet = Math.min(m.liveAtNet, this.net.clock.hostNowMs());
  }

  onEnd(msg) {
    this.game.netApplyMatchEnd(msg);
    this.net._setPhase('ended');
  }

  onPings(msg) {
    if (!Array.isArray(msg.p)) return;
    for (const pair of msg.p) {
      if (!Array.isArray(pair)) continue;
      const e = this.game.getEntityById(pair[0] | 0);
      if (e) e.ping = pair[1] | 0;
    }
  }

  /**
   * Combat.applyDamage on a client. mp-core-B turns the local player's own hits into claims for the host; until then
   * nothing is applied or sent.
   * @returns {number} 0
   */
  claimDamage(target, info) {
    const game = this.game, net = this.net, m = game.match, p = game.player;
    if (!info || info.attacker !== p || !target || target === p || !target.isProxy || !target.alive) return 0;
    if (!m || m.over || m.phase !== 'live' || !p.alive || target.netHold) return 0;
    if (target.team === p.team || target.isProtected()) return 0;
    if (!CLAIM_WEAPONS.has(info.weapon)) {
      // rockets, grenades, explosions, splats are decided by the host (a predicted copy must never claim)
      warnOnce('claimw:' + info.weapon, `[net] '${info.weapon}' damage is decided by the host`);
      return 0;
    }
    const ci = this._claimSeq = (this._claimSeq + 1) & 0xffff;
    const msg = {
      k: 'cl', ci, t: target.id, n: Math.round((info.amount || 0) * 100) / 100, w: info.weapon,
      st: Math.round(target.shownT || this.lastRenderMs), ft: Math.round(net.clock.hostNowMs()),
    };
    if (info.headshot) msg.h = 1;
    if (info.point) msg.p = wirePos(info.point);
    if (info.direction) msg.d = wireDir(info.direction);
    if (info.knockback) msg.kb = [Math.round(info.knockback.x * 100) / 100, Math.round(info.knockback.y * 100) / 100, Math.round(info.knockback.z * 100) / 100];
    net.send(msg);
    this.claimStats.sent++;
    this.predicted.add(ci);
    this._predictedOrder.push(ci);
    if (this._predictedOrder.length > 256) this.predicted.delete(this._predictedOrder.shift());
    // the marker and its sound in the frame of the shot; the number comes with the host's echo
    game.events.emit('hit:predicted', { target, weapon: info.weapon, headshot: !!info.headshot, ci });
    return 0;
  }

  /** Resolve an optional entity id: live entity, else the departed record, else null. */
  refOf(id) {
    if (!id) return null;
    return this.game.getEntityById(id) || this.departed.get(id) || null;
  }

  // ------------------------------------------------------------------ match setup (Game.netBeginMatch)

  /** Create the proxy of a roster row (never for the local player's own id). */
  addAvatar(row, ent) {
    const game = this.game;
    if (!row || row.id === this.net.me.entityId) return null;
    const a = new NetAvatar(game, row);
    game.addEntity(a, row.id);
    this.avatars.set(row.id, a);
    if (ent) {
      a.kills = ent.kills | 0;
      a.deaths = ent.deaths | 0;
      a.streak = ent.streak | 0;
      a.tier = ent.tier | 0;
      a.zoneTime = ent.zoneTime || 0;
      a.netHold = !!ent.hold;
      if (ent.alive && readVec(ent.pos, _v)) a.spawn(_v, Number(ent.yaw) || 0);
      else {
        a.alive = false;
        a.avatar.setVisible(false);
      }
    }
    return a;
  }

  /** Dispose every proxy (Game._clearMatch / a new begin). */
  clearMatch() {
    this._sched.length = 0;
    for (const fn of this._clearHooks) {
      try { fn(); } catch (err) { console.error('[net] clear hook failed', err); }
    }
    for (const a of this.avatars.values()) {
      this.game.removeEntity(a);
      a.dispose();
    }
    this.avatars.clear();
    this.departed.clear();
    this._newestSnapT = -Infinity;
    this._lastSnapSeq = -1;
    this.delay.reset();
    this.awaitingDeploy = false;
  }

  /**
   * Deploy gate (late join): the match is shown from above until this player clicks in (or the host's deadline
   * passes); then the host spawns it. Sends 'deploy' once.
   */
  sendDeploy() {
    if (!this.awaitingDeploy || this._deploySent || this.inMatchEpoch !== this.net.epoch) return;
    this._deploySent = true;
    this.net.send({ k: 'deploy' });
  }

  /** Reset the per-match counters (Game.netBeginMatch, before the entities are built). */
  resetMatchState(b) {
    this.ownLifeAt = this.ownHpAt = this.scoreAt = this.phaseAt = Number(b.at) || 0;
    this.spawnProtNet = 0;
    this.shockNet = 0;
    this.respawnAtNet = NET.NEVER;
    this.grantAck = b.grantSeq & 255;
    this._seq = 0;
    this._stateAcc = 1;
    this._teleportHold = NET.TELEPORT_HOLD;
    this._delaySum = this._delayN = this._delayMax = 0;
    this.lastRenderMs = 0;
    this._deploySent = false;
  }

  /** The own spawn of a 'begin' / 'spawn' message: position, protection, loadout (resolved locally from the pool). */
  applyLocalSpawn(sp, at) {
    const game = this.game, p = game.player;
    if (!sp || !readVec(sp.p, _v)) return false;
    p.spawn(_v.clone(), Number(sp.y) || 0);
    this.spawnProtNet = fromWireTime(sp.pu);
    this.ownLifeAt = this.ownHpAt = Math.max(this.ownLifeAt, Number(at) || 0);
    this.respawnAtNet = NET.NEVER;
    this.stateSpawnSeq = sp.ss & 255;
    this._teleportHold = NET.TELEPORT_HOLD;
    this.awaitingDeploy = false;
    // R12: the host sends a loadout only in Escalation; otherwise the local pick is resolved against the host's pool
    game.weapons.onPlayerSpawn(sp.lo && typeof sp.lo === 'object' ? sp.lo : null);
    this.refreshTimes();
    game.events.emit('spawn', { entity: p });
    return true;
  }

  // ------------------------------------------------------------------ per frame

  /**
   * This page itself stalled (a long frame): packets that queued meanwhile arrive late because of us, not the network,
   * so they must not count as lag / jitter (that would halve the snapshot rate for 10 s).
   */
  onLocalStall() {
    this._muteLagUntil = performance.now() + 300;
  }

  beginFrame() {
    const net = this.net;
    const now = performance.now();
    if (net.status !== 'reconnecting') {
      const silent = net._lastPacketMs > 0 && now - net._lastPacketMs > NET.INTERRUPTED_MS;
      const st = silent ? 'interrupted' : 'ok';
      if (st !== net.status) {
        net.status = st;
        net._emitStatus();
      }
    }
  }

  /** Re-convert the own host deadlines (net ms) to local game time (before the player updates). */
  refreshTimes() {
    const game = this.game, net = this.net, p = game.player, clock = net.clock;
    if (this.inMatchEpoch !== net.epoch || !game.match) return;
    const sp = this.spawnProtNet;
    p.spawnProtectedUntil = sp > 0 && Number.isFinite(sp) ? clock.netToLocalGame(game, sp) : 0;
    const sh = this.shockNet;
    p.shockedUntil = sh > 0 ? clock.netToLocalGame(game, sh) : 0;
    p.respawnAt = this.respawnAtNet >= 0 ? clock.netToLocalGame(game, this.respawnAtNet) : -1;
    const m = game.match;
    if (m.liveAtNet) m.liveAt = clock.netToLocalGame(game, m.liveAtNet);
  }

  /** Client match clock between snapshots (the countdown -> live switch is NetSession._updateCountdown). */
  updateMatchClock(dt) {
    const m = this.game.match;
    if (!m || m.over || m.phase === 'countdown') return;
    if (Number.isFinite(m.timeLeft)) m.timeLeft = Math.max(0, m.timeLeft - dt);
  }

  /** Interpolate every proxy at render time and update their avatars. */
  updateRemotes(dt) {
    const net = this.net, clock = net.clock;
    if (this.inMatchEpoch !== net.epoch) return;
    const now = clock.hostNowMs();
    const interval = 1000 / this.snapHz;
    if (this._newestSnapT > -Infinity) this.delay.observe(now - this._newestSnapT);
    const eff = this.delay.update(dt * 1000, interval);
    let render = now - eff;
    if (render < this.lastRenderMs && this._clockSnaps === clock.snaps) render = this.lastRenderMs;   // never backwards
    this._clockSnaps = clock.snaps;
    this.lastRenderMs = render;
    this.interpDelayMs = eff;
    this._delaySum += eff;
    this._delayN++;
    if (eff > this._delayMax) this._delayMax = eff;
    for (const a of this.avatars.values()) {
      if (a.alive) a.interpolate(render, interval);
      a.update(dt);
    }
    this._drainSchedule(render);
    this._fallBackstop();
    for (const fn of this.frameHooks) {
      try { fn(dt, render); } catch (err) { warnOnce('hook', '[net] client frame hook failed', err); }
    }
  }

  /** Below the kill plane for a while and still alive (the host normally kills us first): tell the host once. */
  _fallBackstop() {
    const game = this.game, p = game.player;
    const killY = game.world.killY ?? -50;
    if (!p.alive || p.position.y >= killY) {
      this._belowSince = 0;
      this._fallSent = false;
      return;
    }
    const now = performance.now();
    if (!this._belowSince) this._belowSince = now;
    if (!this._fallSent && now - this._belowSince > NET.FALL_BACKSTOP_S * 1000) {
      this._fallSent = true;
      this.net.send({ k: 'fall' });
    }
  }

  /** Render time (host net ms) of the entity timeline. */
  renderTimeMs() {
    return this.lastRenderMs;
  }

  endFrame(raw) {
    const net = this.net, now = performance.now();
    // clock pings: 4 Hz for the first 3 s of the session, then 1 Hz
    const pingHz = now - this._pingStart < NET.PING_FAST_S * 1000 ? NET.PING_FAST_HZ : NET.PING_HZ;
    if (now - this._pingAt >= 1000 / pingHz) {
      this._pingAt = now;
      const w = this._pingW;
      w.begin(PKT.PING).u32(this._pingSeq++ >>> 0).f64(now).u16(Math.min(0xffff, Math.round(net.clock.rttMs)));
      net.sendNow(w.finish(), 'host');
    }
    if (now - this._nqAt >= 1000 / NET.NQ_HZ && this.inMatchEpoch === net.epoch) {
      this._nqAt = now;
      net.send({
        k: 'nq', j: Math.round(this._lag.spread(now)), l: Math.round(this._lag.p95(now)), fps: Math.round(this.game.fps || 0),
      });
    }
    this.sendState(raw);
  }

  /** CSTATE at 60 Hz (10 Hz while dead) once in the match. */
  sendState(raw) {
    const net = this.net, game = this.game;
    if (this.inMatchEpoch !== net.epoch || !game.match) return;
    const p = game.player;
    const hz = p.alive ? NET.STATE_HZ : NET.DEAD_STATE_HZ;
    this._stateAcc += raw;
    if (this._stateAcc + 0.002 < 1 / hz) return;
    this._stateAcc = Math.min(Math.max(0, this._stateAcc - 1 / hz), 1 / hz);
    const st = this._st, w = game.weapons, g = p.grapple;
    st.epoch = net.epoch;
    st.spawnSeq = this.stateSpawnSeq;
    st.seq = this._seq = (this._seq + 1) & 0xffff;
    st.tHost = net.clock.hostNowMs();
    st.px = p.position.x; st.py = p.position.y; st.pz = p.position.z;
    st.vx = p.velocity.x; st.vy = p.velocity.y; st.vz = p.velocity.z;
    st.yaw = p.yaw;
    st.pitch = p.pitch;
    st.h = p.height;
    let f = 0;
    if (this._teleportHold > 0) { f |= CF.TELEPORT; this._teleportHold--; }
    if (p.onGround) f |= CF.GROUND;
    if (p.isCrouching) f |= CF.CROUCH;
    if (p.isSliding) f |= CF.SLIDE;
    if (p.isWallRunning) f |= CF.WALLRUN;
    if (p.isMantling) f |= CF.MANTLE;
    if (p.isSprinting) f |= CF.SPRINT;
    if (game.time - w.lastFireTime < 0.15) f |= CF.FIRING;
    if (w.reloading) f |= CF.RELOAD;
    if (w.beamActive === true) f |= CF.BEAM;
    if (w.charging) f |= CF.CHARGE;
    if (w.adsAmount > 0.5) f |= CF.AIM;
    if (w.switching) f |= CF.SWITCH;
    if (w.throwing) f |= CF.THROW;
    if (w.meleeing) f |= CF.MELEE;
    if (p.wallRunSide > 0) f |= CF.WALL_RIGHT;
    st.flags = f;
    const gs = GRAPPLE_CODE[g.state] | 0;
    st.flags2 = gs;
    st.weapon = WEAPON_INDEX[w.currentId] | 0;
    st.ads = w.adsAmount;
    st.charge = w.chargeAmount || 0;
    if (gs === 1) { st.gx = g.target.x; st.gy = g.target.y; st.gz = g.target.z; }
    else if (gs === 2) { st.gx = g.anchor.x; st.gy = g.anchor.y; st.gz = g.anchor.z; }
    else st.gx = st.gy = st.gz = 0;
    const be = w.beamEnd;
    if ((f & CF.BEAM) && be) { st.bx = be.x; st.by = be.y; st.bz = be.z; } else st.bx = st.by = st.bz = 0;
    let owned = 0, full = 0;
    for (let i = 0; i < WEAPON_ORDER.length; i++) {
      const id = WEAPON_ORDER[i], inv = w.inv[id];
      if (!inv || !inv.owned) continue;
      owned |= 1 << i;
      const def = WEAPONS[id];
      if (!Number.isFinite(def.reserveMax) || inv.reserve >= def.reserveMax) full |= 1 << i;
    }
    st.owned = owned;
    st.full = full;
    for (let i = 0; i < NADE_ORDER.length; i++) st.nades[i] = w.nades[NADE_ORDER[i]] | 0;
    st.grantAck = this.grantAck;
    st.cg = net.me.cg;
    encodeClientState(this._w, st);
    if (net.sendNow(this._w.finish(), 'host')) net.stats.states.out++;
    else net.stats.states.dropped++;
  }

  // ------------------------------------------------------------------ packets

  onPong(u8, recvMs) {
    const r = this._pingR.reset(u8);
    r.u32();
    const c = r.f64();
    r.u16();
    const h = r.f64();
    if (r.overflow) return;
    this.net.clock.onPong(c, h, recvMs);
    this.net.ping = this.net.clock.rttMs;
    const p = this.game.player;
    if (p) p.ping = Math.round(this.net.ping);
  }

  onSnapshot(u8, recvMs) {
    const net = this.net;
    if (this.inMatchEpoch !== net.epoch || !this.game.match) return;
    this._recvMs = recvMs;
    if (!decodeSnapshot(this._r.reset(u8), this._hdr, this._rec, this._sink)) {
      warnOnce('snap', '[net] malformed snapshot');
      net.stats.snaps.dropped++;
    }
  }

  _onHeader(h) {
    const net = this.net, game = this.game, m = game.match, clock = net.clock, p = game.player;
    if (h.epoch !== net.epoch) return false;
    if (this._lastSnapSeq >= 0) {
      const d = (h.snapSeq - this._lastSnapSeq) >>> 0;
      if (d === 0 || d > 0x7fffffff) { net.stats.snaps.stale++; return false; }   // older than one already applied
    }
    this._lastSnapSeq = h.snapSeq;
    net.stats.snaps.in++;
    this._snapT = h.tHost;
    this._ownId = h.ownId;
    this._ctx.tHost = h.tHost;
    // link quality: one-way lag (host time at arrival - build time); its spread is the jitter (the host's own frame
    // timing does not count: every snapshot is stamped when it is built)
    const arrivalHost = this._recvMs + clock.offsetMs;
    if (this._recvMs >= this._muteLagUntil) this._lag.add(this._recvMs, arrivalHost - h.tHost);
    if (h.tHost > this._newestSnapT) this._newestSnapT = h.tHost;
    this.snapHz = h.flags & SF.FALLBACK ? NET.SNAP_HZ_FALLBACK : (this.cfg && this.cfg.snapHz === 30 ? 30 : NET.SNAP_HZ);
    // effective snapshot rate (report)
    const now = this._recvMs;
    if (!this._snapsInAt) this._snapsInAt = now;
    this._snapsInWindow++;
    if (now - this._snapsInAt >= 1000) {
      this.snapHzEff = this._snapsInWindow * 1000 / (now - this._snapsInAt);
      this._snapsInAt = now;
      this._snapsInWindow = 0;
    }
    // own block (host-authoritative; each group only if newer than the last event that set it)
    if (h.tHost > this.ownHpAt) {
      p.health = h.health;
      p.armor = h.armor;
    }
    if (h.tHost > this.ownLifeAt) this.spawnProtNet = h.protectedUntil > 0 ? h.protectedUntil : 0;
    this.shockNet = h.shockedUntil;
    const aliveBit = (h.ownFlags & OWN.ALIVE) !== 0;
    // held (soft drop while this page was silent, deploy gate): the host's "not alive" is not a death
    if (aliveBit !== p.alive && h.ownId && !(h.ownFlags & OWN.HELD)) {
      if (!this._aliveDivergeSince) this._aliveDivergeSince = now;
      else if (now - this._aliveDivergeSince > 1000) warnOnce('alive', `[net] own life differs from the host's for > 1 s (local ${p.alive})`);
    } else this._aliveDivergeSince = 0;
    if (m) {
      if (h.tHost > this.scoreAt) {
        m.teamScores[1] = h.teamScore1;
        m.teamScores[2] = h.teamScore2;
      }
      m.timeLeft = h.timeLeftDs === TIME_NONE ? Infinity : Math.max(0, h.timeLeftDs / 10 - (clock.hostNowMs() - h.tHost) / 1000);
    }
    return true;
  }

  _onEntity(rec) {
    if (rec.id === this._ownId || rec.id === this.net.me.entityId) return;
    const a = this.avatars.get(rec.id);
    if (a) a.applySnapshot(rec, this._snapT);
  }

  _onSection(id, r, len) {
    const codec = this.net._sections.get(id);
    if (codec && codec.decode) codec.decode(r, this._ctx, len);
  }

  /** report.net (client). */
  report() {
    const now = performance.now();
    return {
      client: {
        snapsIn: this.net.stats.snaps.in, stale: this.net.stats.snaps.stale, snapHzEff: +this.snapHzEff.toFixed(1), snapHz: this.snapHz,
        lagP95: +this._lag.p95(now).toFixed(1), jitter: +this._lag.spread(now).toFixed(1),
        interpDelayMs: {
          avg: +(this._delaySum / Math.max(1, this._delayN)).toFixed(1), max: +this._delayMax.toFixed(1), final: +this.interpDelayMs.toFixed(1),
        },
        statesOut: this.net.stats.states.out, avatars: this.avatars.size, inMatchEpoch: this.inMatchEpoch,
        claims: { ...this.claimStats }, grantAck: this.grantAck,
      },
    };
  }
}

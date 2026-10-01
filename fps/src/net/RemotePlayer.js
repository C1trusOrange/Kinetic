/**
 * Host only: a joined human. Its client simulates the movement (client-authoritative, contract decision 2) and
 * streams CSTATE packets; the host applies them after light sanity checks and owns everything else (health, armor,
 * life, score, spawns, pickups). Rendering and host-local hit tests (host player, bots) use a smoothed `position` a few
 * ms behind the reports; the match rules, snapshots and claim checks use `netPos` (= authPos), the latest report.
 */
import * as THREE from 'three';
import { Entity } from '../core/Entity.js';
import { NET, WEAPON_BY_INDEX, NADE_ORDER } from './GameProtocol.js';
import { CF } from './NetCodec.js';
import { InterpBuffer, DelayEstimator, makeBodySample } from './NetClock.js';
import { seqDelta } from './protocol.js';
import { Avatar } from './Avatar.js';
import { WEAPON_ORDER } from '../weapons/WeaponDefs.js';

const _sample = makeBodySample();
const _out = makeBodySample();
const _warned = new Set();
function warnOnce(key, ...args) {
  if (_warned.has(key)) return;
  _warned.add(key);
  console.warn(...args);
}

export class RemotePlayer extends Entity {
  /**
   * @param {object} game
   * @param {{peer: number, sid: string, name: string, team: number, color: number, cg?: number, pick?: object}} o
   */
  constructor(game, { peer, sid, name, team, color, cg = 0, pick = null }) {
    super(game);
    this.isHuman = true;
    this.isRemote = true;
    this.simLocal = false;
    this.netPeer = peer;
    this.peer = peer;
    this.sid = sid;
    this.cg = cg & 255;
    this.name = name;
    this.team = team;
    this.color.set(color);
    /** The client's loadout pick (wave-1 Loadout.resolveFor reads entity.loadoutPick). */
    this.loadoutPick = pick;
    /** Latest reported position (rules, snapshots); `position` is the smoothed one. */
    this.netPos = new THREE.Vector3();
    this.authPos = this.netPos;
    this.lagging = false;
    this.softDropped = false;
    this.awaitingDeploy = false;
    this.teleportHold = 0;
    // replicated presentation state
    this.netFlags = 0;
    this.netFlags2 = 0;
    this.weaponId = 'rifle';
    this.weaponChangedAtMs = 0;
    this.adsAmount = 0;
    this.charge = 0;
    this.grapplePoint = new THREE.Vector3();
    this.beamEnd = new THREE.Vector3();
    /** The latest report as received (snapshots carry it raw: other clients interpolate it themselves). */
    this.raw = { yaw: 0, pitch: 0, h: 1.8, flags: 0, flags2: 0, weapon: 0, charge: 0, grapple: new THREE.Vector3(), beam: new THREE.Vector3() };
    this.isCrouching = false;
    this.isSliding = false;
    this.isWallRunning = false;
    this.isMantling = false;
    this.isSprinting = false;
    /** Inventory mirror (pickup predicates): owned weapon ids, weapons with a full reserve, grenade counts. */
    this.inv = { owned: new Set(), full: new Set(), nades: { frag: 0, vortex: 0, static: 0, kinetic: 0, smoke: 0 } };
    this.mirrorResync = true;
    this.spawnSeq = 0;
    this.grantSeq = 0;
    this.grantAck = 0;
    this.lastStateSeq = -1;
    this.lastStateNetMs = 0;
    this.deathNetMs = 0;
    /** Host net ms of the report the smoothed position shows (tests). */
    this.shownT = 0;
    this.spawnProtectS = 0;
    this.buf = new InterpBuffer();
    this.delay = new DelayEstimator({ minMs: NET.HOST_SMOOTH_MIN_MS, maxMs: NET.HOST_SMOOTH_MAX_MS });
    this._prevT = -1;
    this._prevRawT = 0;
    this._ahead = 0;
    this._prevPos = new THREE.Vector3();
    this._prevVel = new THREE.Vector3();
    this._pendingImpulse = new THREE.Vector3();
    this._pendingLaunch = null;
    this._impSrc = [];
    this._muted = 0;
    this.avatar = new Avatar(game, { color: this.color.clone(), team, entity: this });
  }

  /** The BotModel (hit flash, outlines). */
  get model() {
    return this.avatar.model;
  }

  /** Grenade counts mirrored from the client (GrenadeTypes.inventoryOf reads entity.nades). */
  get nades() {
    return this.inv.nades;
  }

  /**
   * A decoded CSTATE from this human's client.
   * @param {object} st NetCodec makeClientState-shaped
   * @param {number} arrivalNetMs host net time at arrival
   */
  onState(st, arrivalNetMs) {
    const net = this.game.net;
    if (st.epoch !== net.epoch || st.cg !== this.cg) return;
    if (this.lastStateSeq >= 0 && seqDelta(st.seq, this.lastStateSeq) <= 0) return;
    this.lastStateSeq = st.seq;
    this.lastStateNetMs = arrivalNetMs;
    if (this.softDropped) {
      this.softDropped = false;
      this.alive = true;
      this.buf.clear();
      this.teleportHold = NET.TELEPORT_HOLD;
      this.avatar.setVisible(true);
    }
    this.netHold = this.awaitingDeploy || !this.connected;
    // inventory mirror: only once the client has applied every grant sent so far (or after a resync)
    if (this.mirrorResync || st.grantAck === this.grantSeq) {
      this._copyMirror(st);
      this.mirrorResync = false;
    }
    this.grantAck = st.grantAck;
    if (st.spawnSeq !== this.spawnSeq || !this.alive) return;   // a packet from before our latest spawn / while dead

    const h = Math.min(1.85, Math.max(1.1, st.h));
    // the client stamps each state with its estimate of host time; when that estimate runs a little ahead of ours a
    // state would land in the future: shift the whole stream back by a slowly decaying "ahead" offset (keeps the
    // client's own spacing - clamping each state to its arrival would bunch states that arrive together)
    const ahead = st.tHost - arrivalNetMs;
    this._ahead = Math.max(ahead, this._ahead * 0.995);
    const tHost = Math.min(arrivalNetMs + 5, Math.max(arrivalNetMs - 500, st.tHost - Math.max(0, this._ahead)));
    let teleport = (st.flags & CF.TELEPORT) !== 0;
    if (!teleport && this._prevT >= 0) {
      // implied speed from the client's own send times (not arrival times, which bunch on any network)
      const dtMs = Math.max(4, st.tHost - this._prevRawT);
      const dist = Math.hypot(st.px - this._prevPos.x, st.py - this._prevPos.y, st.pz - this._prevPos.z);
      const implied = dist / (dtMs / 1000);
      const vmax = Math.max(Math.hypot(st.vx, st.vy, st.vz), this._prevVel.length());
      // + a fixed 0.75 m: step-ups, mantles and collision pushes move a body without matching velocity
      const allowed = (NET.IMPLIED_SPEED_K * vmax + NET.IMPLIED_SPEED_ADD) * dtMs / 1000 + 0.75;
      if (dist > allowed || implied > NET.IMPLIED_SPEED_CAP) {
        warnOnce('speed:' + this.peer, `[net] ${this.name}: implausible movement (${implied.toFixed(0)} m/s), treated as a teleport`);
        teleport = true;
      }
    }
    this._prevT = tHost;
    this._prevRawT = st.tHost;
    this._prevPos.set(st.px, st.py, st.pz);
    this._prevVel.set(st.vx, st.vy, st.vz);

    const s = _sample;
    s.px = st.px; s.py = st.py; s.pz = st.pz;
    s.vx = st.vx; s.vy = st.vy; s.vz = st.vz;
    s.yaw = st.yaw; s.pitch = st.pitch; s.h = h;
    s.f = st.flags; s.f2 = st.flags2; s.w = st.weapon;
    s.gx = st.gx; s.gy = st.gy; s.gz = st.gz;
    s.bx = st.bx; s.by = st.by; s.bz = st.bz;
    s.c = st.charge;
    if (teleport) this.teleportHold = NET.TELEPORT_HOLD;   // other clients snap too (snapshot teleport bit)
    if (teleport || !this.buf.size) {
      this.buf.reset(tHost, s);
      this.position.set(st.px, st.py, st.pz);
      this.avatar.place(this.position, st.yaw);
    } else {
      this.buf.push(tHost, s);
    }
    this.netPos.set(st.px, st.py, st.pz);
    this.velocity.set(st.vx, st.vy, st.vz);
    const raw = this.raw;
    raw.yaw = st.yaw; raw.pitch = st.pitch; raw.h = h; raw.flags = st.flags; raw.flags2 = st.flags2; raw.weapon = st.weapon;
    raw.charge = st.charge;
    raw.grapple.set(st.gx, st.gy, st.gz);
    raw.beam.set(st.bx, st.by, st.bz);
    this.adsAmount = st.ads;
    this.charge = st.charge;
    this.onGround = (st.flags & CF.GROUND) !== 0;
    const wid = WEAPON_BY_INDEX[st.weapon];
    if (wid && wid !== this.weaponId) {
      this.weaponId = wid;
      this.weaponChangedAtMs = arrivalNetMs;
    }
  }

  _copyMirror(st) {
    const inv = this.inv;
    inv.owned.clear();
    inv.full.clear();
    for (let i = 0; i < WEAPON_ORDER.length; i++) {
      if (st.owned & (1 << i)) inv.owned.add(WEAPON_ORDER[i]);
      if (st.full & (1 << i)) inv.full.add(WEAPON_ORDER[i]);
    }
    for (let i = 0; i < NADE_ORDER.length; i++) inv.nades[NADE_ORDER[i]] = st.nades[i] | 0;
  }

  /** Per frame (NetSession.updateRemotes): smoothing, lag / soft-drop bookkeeping, avatar. */
  update(dt) {
    const net = this.game.net;
    const now = net.clock.hostNowMs();
    const since = now - this.lastStateNetMs;
    this.lagging = this.lastStateNetMs > 0 && since > NET.LAGGING_MS;
    if (this.lastStateNetMs > 0 && since > NET.SOFT_DROP_MS && !this.softDropped) {
      if (this.alive) {
        // a silent client (frozen tab, half-open Wi-Fi): out of play until it reports again (no death, no event)
        this.softDropped = true;
        this.alive = false;
        this.avatar.setVisible(false);
        if (net.host) net.host._everSoftDropped = true;
        warnOnce('drop:' + this.peer + ':' + this.cg, `[net] ${this.name}: no state for ${Math.round(since)} ms, held out of play`);
      }
      this.netHold = true;
    }
    if (this.alive && this.buf.size) {
      this.delay.observe(now - this.buf.newestT);
      const eff = this.delay.update(dt * 1000, 1000 / NET.STATE_HZ);
      if (this.buf.sample(now - eff, _out, 1000 / NET.STATE_HZ) !== 'empty') {
        this.shownT = _out.t;
        this.position.set(_out.px, _out.py, _out.pz);
        this.yaw = _out.yaw;
        this.pitch = _out.pitch;
        this.height = _out.h;
        this.eyeHeight = _out.h - 0.14;
        this.netFlags = _out.f;
        this.netFlags2 = _out.f2;
        this.grapplePoint.set(_out.gx, _out.gy, _out.gz);
        this.beamEnd.set(_out.bx, _out.by, _out.bz);
        const f = _out.f;
        this.isCrouching = (f & CF.CROUCH) !== 0;
        this.isSliding = (f & CF.SLIDE) !== 0;
        this.isWallRunning = (f & CF.WALLRUN) !== 0;
        this.isMantling = (f & CF.MANTLE) !== 0;
        this.isSprinting = (f & CF.SPRINT) !== 0;
        const wid = WEAPON_BY_INDEX[_out.w];
        if (wid) this.avatar.setWeapon(wid);
      }
    }
    this.avatar.update(dt, this);
  }

  // ---------------------------------------------------------------- forces (forwarded to the owning client)

  /** Knockback: queued for the client (NetHost.sendForces), the reported velocity is never touched here. */
  applyImpulse(v, info) {
    if (this._muted) return;
    this._pendingImpulse.add(v);
    this._impSrc.push([info && info.weapon ? info.weapon : null, info && info.seq != null ? info.seq : null]);
  }

  /** Launch (never from jump pads: the client runs its own). */
  launch(v) {
    this._pendingLaunch = v.clone();
    this.lastLaunchTime = this.game.time;
  }

  muteForces() { this._muted++; }
  unmuteForces() { this._muted = Math.max(0, this._muted - 1); }

  // ---------------------------------------------------------------- lifecycle

  spawn(position, yaw = 0) {
    super.spawn(position, yaw);
    if (this.spawnProtectS > 0) {
      this.spawnProtectedUntil = this.game.time + this.spawnProtectS;
      this.spawnProtectS = 0;
    }
    this.spawnSeq = (this.spawnSeq + 1) & 255;
    this.netPos.copy(position);
    this.height = 1.8;
    this.eyeHeight = 1.66;
    this.netFlags = 0;
    this.netFlags2 = 0;
    this.softDropped = false;
    this._prevT = -1;
    this.buf.clear();
    this.teleportHold = NET.TELEPORT_HOLD;
    this.avatar.place(position, yaw);
    this.avatar.setWeapon(this.weaponId);
    this.avatar.setVisible(true);
  }

  onDeath(info) {
    this.deathNetMs = this.game.net ? this.game.net.clock.hostNowMs() : 0;
    this.avatar.die(this, info);
  }

  /** A shot by this human (host view: muzzle flash + firing pose). */
  onFire(weaponId, origin, dir) {
    this.avatar.fireFx(this, weaponId, dir);
  }

  // ---------------------------------------------------------------- inventory hooks (pickups / modes)
  // Granting things to a remote human is mp-core-B (net.host.grant); until then nothing is consumed for them.

  giveWeapon(id) { return this._grant('weapon', { w: id }); }
  addAmmo(id = null, f = 0.5) { return this._grant('ammo', { w: id, f }); }
  addGrenades(n, type = 'frag') { return this._grant('nades', { n, ty: type }); }
  setEscalationWeapon(id) { this._grant('escw', { w: id }); }

  _grant(kind, g) {
    const host = this.game.net && this.game.net.host;
    if (!host || typeof host.grant !== 'function') return false;
    try {
      return !!host.grant(this, { kind, ...g });
    } catch (err) {
      console.error('[net] grant failed', err);
      return false;
    }
  }

  dispose() {
    this.avatar.dispose();
  }
}

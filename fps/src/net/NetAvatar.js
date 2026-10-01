/**
 * Client only: the stand-in for another machine's fighter (the host's player, the other humans, every bot). Its
 * state comes from snapshots and is shown on the "entity timeline" - interpolated a measured delay behind the host
 * (NetClient.renderTimeMs) - so the local shooter hits what it sees (Entity hitboxes follow the shown position).
 * Never has Bot internals (stats, brain, inv): shared event listeners must only use Entity fields.
 */
import * as THREE from 'three';
import { Entity } from '../core/Entity.js';
import { EF, EF2 } from './NetCodec.js';
import { WEAPON_BY_INDEX } from './GameProtocol.js';
import { InterpBuffer, makeBodySample } from './NetClock.js';
import { Avatar } from './Avatar.js';

const _s = makeBodySample();
const _out = makeBodySample();

export class NetAvatar extends Entity {
  /**
   * @param {object} game
   * @param {{id: number, name: string, team: number, color: number, kind: 'human'|'bot', peer: number, host: boolean}} row roster row
   */
  constructor(game, row) {
    super(game);
    this.isProxy = true;
    this.simLocal = false;
    this.isBot = row.kind === 'bot';
    this.isHuman = row.kind === 'human';
    this.netPeer = row.peer;
    this.netHost = !!row.host;
    this.name = row.name;
    this.team = row.team;
    this.color.set(row.color);
    this.netFlags = 0;
    this.netFlags2 = 0;
    this.weaponId = null;
    this.charge = 0;
    this.lagging = false;
    this.grapplePoint = new THREE.Vector3();
    this.beamEnd = new THREE.Vector3();
    this.buf = new InterpBuffer();
    /** Net ms of the last life (death / spawn), health and score events: older snapshot fields never override them. */
    this.lifeAt = 0;
    this.hpAt = 0;
    this.scoreAt = 0;
    /** Sample time shown by the last interpolate() (claims: what the shooter saw). */
    this.shownT = 0;
    this._tp = false;
    this.avatar = new Avatar(game, { color: this.color.clone(), team: row.team, entity: this });
  }

  /** The BotModel (hit flash, outlines). */
  get model() {
    return this.avatar.model;
  }

  /**
   * One snapshot record of this entity (NetCodec makeEntityRecord-shaped) at host time tHostMs.
   * @param {object} rec @param {number} tHostMs
   */
  applySnapshot(rec, tHostMs) {
    const s = _s;
    s.px = rec.px; s.py = rec.py; s.pz = rec.pz;
    s.vx = rec.vx; s.vy = rec.vy; s.vz = rec.vz;
    s.yaw = rec.yaw; s.pitch = rec.pitch; s.h = rec.h;
    s.f = rec.flags; s.f2 = rec.flags2; s.w = rec.weapon;
    s.gx = rec.gx; s.gy = rec.gy; s.gz = rec.gz;
    s.bx = rec.bx; s.by = rec.by; s.bz = rec.bz;
    s.c = rec.charge;
    const alive = (rec.flags & EF.ALIVE) !== 0;
    if (tHostMs > this.lifeAt && alive !== this.alive) {
      // a silent change (soft drop / restore, a late joiner's first look): no gibs, no events
      this.alive = alive;
      this.avatar.setVisible(alive);
      if (alive) {
        this.buf.reset(tHostMs, s);
        this.position.set(rec.px, rec.py, rec.pz);
        this.avatar.place(this.position, rec.yaw);
      }
    }
    // the teleport bit is repeated for a few snapshots (one may be lost): snap on its first one only
    const tp = (rec.flags & EF.TELEPORT) !== 0;
    if ((tp && !this._tp) || !this.buf.size) {
      this.buf.reset(tHostMs, s);
      this.position.set(rec.px, rec.py, rec.pz);
      this.avatar.place(this.position, rec.yaw);
    } else {
      this.buf.push(tHostMs, s);
    }
    this._tp = tp;
    if ((rec.flags2 & EF2.HAS_SCORE) && tHostMs > this.scoreAt) {
      this.kills = rec.kills;
      this.deaths = rec.deaths;
      this.tier = rec.tier;
      this.zoneTime = rec.zoneTime;
    }
    this.connected = (rec.flags2 & EF2.DISCONNECTED) === 0;
    this.netHold = (rec.flags2 & EF2.HELD) !== 0;
    this.lagging = (rec.flags & EF.LAGGING) !== 0;
  }

  /**
   * Move to the state at render time renderMs (host net ms). Extrapolates at most one snapshot interval, then holds.
   * @param {number} renderMs @param {number} intervalMs
   */
  interpolate(renderMs, intervalMs) {
    if (this.buf.sample(renderMs, _out, intervalMs) === 'empty') return;
    this.position.set(_out.px, _out.py, _out.pz);
    this.velocity.set(_out.vx, _out.vy, _out.vz);
    this.yaw = _out.yaw;
    this.pitch = _out.pitch;
    this.height = _out.h;
    this.eyeHeight = _out.h - 0.14;
    this.netFlags = _out.f;
    this.netFlags2 = _out.f2;
    this.onGround = (_out.f & EF.GROUND) !== 0;
    this.grapplePoint.set(_out.gx, _out.gy, _out.gz);
    this.beamEnd.set(_out.bx, _out.by, _out.bz);
    this.charge = _out.c;
    this.shownT = _out.t;
    // shocked: GrenadeSystem draws the zaps from shockedUntil
    if (_out.f & EF.SHOCKED) this.shockedUntil = this.game.time + 0.2;
    if (_out.f & EF.PROTECTED) this.spawnProtectedUntil = this.game.time + 0.2;
    else if (this.spawnProtectedUntil > this.game.time) this.spawnProtectedUntil = 0;
    const wid = WEAPON_BY_INDEX[_out.w];
    if (wid !== this.weaponId) {
      this.weaponId = wid;
      this.avatar.setWeapon(wid);
    }
  }

  spawn(position, yaw = 0) {
    super.spawn(position, yaw);
    const t = this.game.net ? this.game.net.clock.hostNowMs() : 0;
    _s.px = position.x; _s.py = position.y; _s.pz = position.z;
    _s.vx = _s.vy = _s.vz = 0; _s.yaw = yaw; _s.pitch = 0; _s.h = 1.8;
    _s.f = EF.ALIVE; _s.f2 = 0; _s.w = 0; _s.c = 0;
    this.buf.reset(t, _s);
    this.avatar.place(position, yaw);
    this.avatar.setVisible(true);
  }

  onDeath(info) {
    this.avatar.die(this, info);
  }

  /** Humans' shots: muzzle flash + firing pose (bots' flashes arrive mirrored). */
  onFire(weaponId, origin, dir) {
    if (this.isHuman) this.avatar.fireFx(this, weaponId, dir);
  }

  update(dt) {
    this.avatar.update(dt, this);
  }

  dispose() {
    this.avatar.dispose();
  }
}

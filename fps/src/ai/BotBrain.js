import * as THREE from 'three';
import { clamp, damp, wrapAngle, yawFromDirection, randRange, chance, saturate, DEG } from '../core/utils.js';
import { GRAVITY } from '../core/constants.js';
import { WEAPONS, GRENADE, GRENADE_TYPES } from '../weapons/WeaponDefs.js';
import { MOVE, botWeaponDef, gauss, asPos, WEAPON_POWER, WEAPON_PICKUP_VALUE, padDesire } from './BotConfig.js';
import { BotNav, probeMove, ledgeAhead } from './BotNav.js';

const SIGHT_RANGE = 80;
const MAX_THROW = 16;    // farthest grenade throw (m)
const TURN_GAIN = 22;    // proportional gain of the aim controller (1/s)
const TURN_SMOOTH = 30;  // turn-velocity smoothing rate (1/s)
const PROXIMITY_SENSE = 4.5;

const _eye = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _c = new THREE.Vector3();
const _h = new THREE.Vector3();
const _tp = new THREE.Vector3();
const _dv = new THREE.Vector3();
const _av = new THREE.Vector3();
const _th = new THREE.Vector3();
const _to = new THREE.Vector3();
const _tv = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _sp = new THREE.Vector3();
const _dn = new THREE.Vector3(0, -1, 0);
/** Bot perception opts: live smoke volumes block sight. */
const SMOKE_OPTS = { smoke: true };

/** What a bot remembers about one enemy. */
class Memory {
  constructor(ent) {
    this.ent = ent;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.visible = false;
    this.lastSeen = -999;
    this.lastHeard = -999;
    this.hurtAt = -999;
    this.lostAt = -999;
    this.seenSince = -999;
    this.reactScale = 1;
    this.known = false;
  }
}

/**
 * Decision making for one bot: perception (vision cone, line of sight, hearing, memory), target
 * selection, the roam / engage / chase / retreat / collect state machine, combat movement, human-like aim
 * (reaction delay, turn-rate limited smoothing, tracking lag, shrinking error, recoil), grenades,
 * grenade avoidance and stuck recovery.
 *
 * The brain writes `intent` (movement, jump, crouch, fire, reload, weapon) and steers `bot.yaw/pitch`.
 * Bot executes the intent (physics, weapons).
 */
export class BotBrain {
  /**
   * @param {object} bot the owning Bot
   * @param {object} cfg difficulty preset (see BotConfig)
   */
  constructor(bot, cfg) {
    this.bot = bot;
    this.game = bot.game;
    this.cfg = cfg;
    /** Per-bot personality so bots do not all behave identically. */
    this.pers = {
      aggr: randRange(0.85, 1.15),
      err: randRange(0.85, 1.2),
      range: randRange(0.85, 1.15),
      health: randRange(-5, 6),
    };
    /** One of 'roam' | 'engage' | 'chase' | 'retreat' | 'collect'. */
    this.state = 'roam';
    this.intent = { moveX: 0, moveZ: 0, speed: 0, jump: false, crouch: false, fire: false, reload: false, weapon: null };
    this.nav = new BotNav(bot);
    /** @type {Map<object, Memory>} */
    this.mem = new Map();
    /** Currently selected enemy entity / its memory record. */
    this.target = null;
    this.targetRec = null;
    /** True while the bot should face its aim direction (fighting). */
    this.faceAim = false;

    this.err = new THREE.Vector2();
    this.errTarget = new THREE.Vector2();
    this.aimPt = new THREE.Vector3();
    this.dodgeFrom = new THREE.Vector3();
    this.glance = new THREE.Vector3();
    this.unstickDir = new THREE.Vector2();
    this._losNext = {};
    this._guard = { at: -9, x: 0, z: 0, kind: 0, a: 0, s: 0, cap: 0 };
    this._pc = { wall: false, step: false, ledge: false, wallDist: 0, drop: 0, x: 0, z: 0, at: -9 };
    this._ignored = new Map();
    this._collect = null;
    this._lineOk = true;
    this._lineAt = -9;
    this.reset();
  }

  /** Reset all transient state (called on spawn). */
  reset() {
    const t = this.game.time;
    this.mem.clear();
    this.target = null;
    this.targetRec = null;
    this.state = 'roam';
    this.stateSince = t;
    this.nav.clear();
    this.faceAim = false;
    this.perceiveAt = t + randRange(0.05, 0.3);
    this.thinkAt = t + randRange(0.1, 0.35);
    this.yawVel = 0;
    this.pitchVel = 0;
    this.err.set(0, 0);
    this.errTarget.set(0, 0);
    this.errAt = 0;
    this.trackTime = 0;
    this.tracking = false;
    this.aimPt.set(this.bot.position.x, this.bot.position.y + 1.2, this.bot.position.z);
    this.burstLeft = 0;
    this.burstPauseUntil = 0;
    this.settle = 0;
    this.strafeDir = Math.random() < 0.5 ? -1 : 1;
    this.strafeFlipAt = t + 1;
    this.flipCooldown = 0;
    this.dodgeUntil = 0;
    this.unstickUntil = 0;
    this.forceJumpUntil = 0;
    this.stuckCheckAt = t + 1;
    this.stuckCount = 0;
    this.stuckStage = 0;
    this.blockedT = 0;
    this.blockedJumpAt = 0;
    this._sx0 = this.bot.position.x;
    this._sz0 = this.bot.position.z;
    this.roamFailures = 0;
    this.reloadCover = null;
    this.reloadCoverUntil = 0;
    this._coverRolled = false;
    this._guard.at = -9;
    this.nextGrenadeAt = t + randRange(5, 10);
    this.nextSpecialAt = t + randRange(4, 9);
    this.grenadeTryAt = 0;
    this.retreatUntil = 0;
    this.retreatBanUntil = 0;
    this.retreatKind = 'flee';
    this.coverHoldUntil = 0;
    this.searchUntil = 0;
    this.searching = false;
    this.waitUntil = 0;
    this.scanPhase = Math.random() * 6.28;
    this.crouchUntil = 0;
    this.crouchCheckAt = 0;
    this.weaponCheckAt = t + 1;
    this.holdFireUntil = 0;
    this.pickupCheckAt = 0;
    this.standUntil = 0;
    this.standCheckAt = 0;
    this.pendingGrenadeUntil = 0;
    this.glanceUntil = 0;
    this._arrT = 0;
    this._collect = null;
    this._ignored.clear();
    for (const k in this._losNext) this._losNext[k] = 0;
    this._lineAt = -9;
    this._pc.at = -9;
    const it = this.intent;
    it.moveX = it.moveZ = it.speed = 0;
    it.jump = it.crouch = it.fire = it.reload = false;
    it.weapon = null;
  }

  // ------------------------------------------------------------------ external events

  /** Called by the manager when this bot took damage. */
  onDamaged(attacker) {
    const bot = this.bot;
    if (!attacker || attacker === bot || !attacker.alive || attacker.team === bot.team) return;
    const t = this.game.time;
    const rec = this._rec(attacker);
    if (!rec.visible) {
      this._noisy(rec.pos, attacker.position, 2.5);
      rec.vel.set(0, 0, 0);
    }
    rec.hurtAt = t;
    rec.known = true;
    // being shot at makes us react faster to that enemy
    rec.reactScale = Math.min(rec.reactScale, 0.6);
    // dodge jitter
    if (chance(0.4)) this.strafeFlipAt = 0;
  }

  /**
   * Called by the manager for gunfire / explosions near this bot.
   * @param {THREE.Vector3} pos sound origin
   * @param {object} source entity that caused it
   * @param {number} loudness range multiplier (1 = rifle)
   */
  onSound(pos, source, loudness) {
    const bot = this.bot;
    if (!source || source === bot || !source.alive || source.team === bot.team) return;
    const d = bot.position.distanceTo(pos);
    if (d > this.cfg.hearRange * loudness) return;
    const rec = this._rec(source);
    if (rec.visible) return;
    this._noisy(rec.pos, pos, 1 + d * 0.06);
    rec.vel.set(0, 0, 0);
    rec.lastHeard = this.game.time;
    rec.known = true;
    rec.reactScale = Math.min(rec.reactScale, 0.7);
  }

  /** Called by Bot after every shot fired. */
  onShot() {
    const wd = botWeaponDef(this.bot.weaponId);
    this.burstLeft--;
    if (this.burstLeft <= 0) {
      this.burstPauseUntil = this.game.time + wd.burstPause * this.cfg.pauseScale * randRange(0.7, 1.4);
    }
  }

  /** Aim kick from weapon recoil (radians). */
  kick(pitch, yaw) {
    this.bot.pitch += pitch;
    this.bot.yaw += yaw;
    this.pitchVel *= 0.3;
    this.yawVel *= 0.3;
  }

  /** Called by Bot when it died. */
  onDeath() {
    this.nav.clear();
    this.intent.fire = false;
    this.intent.moveX = this.intent.moveZ = this.intent.speed = 0;
  }

  // ------------------------------------------------------------------ main update

  /** @param {number} dt seconds */
  update(dt) {
    const t = this.game.time;
    const it = this.intent;
    it.jump = false;
    it.fire = false;
    it.reload = false;

    if (t >= this.perceiveAt) {
      this.perceive(t);
      // scan faster while a fight is on, lazier while roaming
      const fight = this.targetRec && (this.targetRec.visible || t - this.targetRec.lastSeen < 2);
      this.perceiveAt = t + (fight ? 0.1 : 0.17) + Math.random() * 0.06;
    }
    if (t >= this.thinkAt) {
      this.think(t);
      this.thinkAt = t + 0.1 + Math.random() * 0.06;
    }
    this.updateStuck(t);
    this.updateMovement(dt, t);
    this.updateBlocked(dt, t);
    this.updateAim(dt, t);
    this.updateFire(dt, t);
  }

  // ------------------------------------------------------------------ perception

  _rec(ent) {
    let rec = this.mem.get(ent);
    if (!rec) {
      rec = new Memory(ent);
      this.mem.set(ent, rec);
    }
    return rec;
  }

  _noisy(out, src, sigma) {
    out.set(src.x + gauss() * sigma, src.y, src.z + gauss() * sigma);
  }

  /** Vision cone + line of sight against every enemy; updates memory. */
  perceive(t) {
    const g = this.game;
    const bot = this.bot;
    const eye = bot.getEyePosition(_eye);
    const fwd = bot.getAimDirection(_fwd);
    const cosHalf = Math.cos(this.cfg.fov * DEG * 0.5);
    const ents = g.entities;
    for (let i = 0; i < ents.length; i++) {
      const e = ents[i];
      if (e === bot || !e.alive || e.team === bot.team) continue;
      const rec = this.mem.get(e);
      const dx = e.position.x - eye.x;
      const dy = e.position.y + e.height * 0.6 - eye.y;
      const dz = e.position.z - eye.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      let vis = false;
      if (d2 < SIGHT_RANGE * SIGHT_RANGE) {
        const d = Math.sqrt(d2) || 1e-3;
        const dot = (dx * fwd.x + dy * fwd.y + dz * fwd.z) / d;
        if (d < PROXIMITY_SENSE || dot > cosHalf) {
          // enemies we cannot currently see are re-tested only every ~0.26 s (they cannot pop into view faster
          // than the reaction time anyway); visible ones every scan
          if ((rec && rec.visible) || t >= (this._losNext[e.id] || 0)) {
            e.getChestPosition(_c);
            vis = g.combat.canSee(eye, _c, SMOKE_OPTS);
            if (!vis && d < 50) {
              // peeking over cover: the head may show while the chest is hidden
              e.getEyePosition(_h);
              vis = g.combat.canSee(eye, _h, SMOKE_OPTS);
            }
            if (!vis) this._losNext[e.id] = t + 0.26;
          }
        }
      }
      if (vis) {
        const r = rec || this._rec(e);
        if (!r.visible) {
          if (t - r.lostAt > 0.35 || !r.known) {
            r.seenSince = t;
            // quick re-acquire of an enemy we were aware of a moment ago
            r.reactScale = t - Math.max(r.lastSeen, r.lastHeard, r.hurtAt) < 2.5 ? Math.min(r.reactScale, 0.45) : 1;
          }
          r.visible = true;
        }
        r.lastSeen = t;
        r.pos.copy(e.position);
        r.vel.copy(e.velocity);
        r.known = true;
      } else if (rec && rec.visible) {
        rec.visible = false;
        rec.lostAt = t;
        rec.pos.copy(e.position); // last known position
      }
    }
  }

  reactionFor(rec) {
    return this.cfg.reaction * rec.reactScale * this.pers.err;
  }

  // ------------------------------------------------------------------ thinking

  think(t) {
    this.selectTarget(t);
    this.checkGrenades(t);
    this.chooseState(t);
    this.chooseWeapon(t);
    this.considerGrenade(t);
    this.considerSpecial(t);
    this.considerReload(t);
    this.considerReloadCover(t);
  }

  /** Reloading in the open in front of an enemy is dangerous: sometimes duck behind nearby cover to do it. */
  considerReloadCover(t) {
    const bot = this.bot;
    if (!bot.reloading) {
      this._coverRolled = false;
      return;
    }
    if (this._coverRolled || bot._reloadT > 0.5) return;
    this._coverRolled = true;
    const rec = this.targetRec;
    if (!rec || !rec.visible || !chance(this.cfg.coverUse * 0.7)) return;
    const cover = this.findCover(rec.ent.position, 10);
    if (!cover) return;
    this.reloadCover = cover;
    this.reloadCoverUntil = t + Math.max(1.2, bot._reloadDur) + 0.3;
  }

  selectTarget(t) {
    const bot = this.bot;
    const cfg = this.cfg;
    let best = null;
    let bestScore = -Infinity;
    let curScore = -Infinity;
    for (const rec of this.mem.values()) {
      const e = rec.ent;
      if (!e.alive) {
        this.mem.delete(e);
        continue;
      }
      const age = t - Math.max(rec.lastSeen, rec.lastHeard, rec.hurtAt);
      if (!rec.visible && age > cfg.memory) {
        if (rec !== this.targetRec) this.mem.delete(e);
        else rec.known = false;
        continue;
      }
      const p = rec.visible ? e.position : rec.pos;
      const d = Math.hypot(p.x - bot.position.x, p.y - bot.position.y, p.z - bot.position.z);
      let s = 100 - d * 0.85;
      if (rec.visible) s += 45;
      else s -= age * 9 + 20;
      if (t - rec.hurtAt < 4) s += 22;
      if (e.health < 40) s += 10;
      if (e.isProtected()) s -= 70;
      s += this.game.modes.targetBias(bot, e);   // Escalation: hunt the leader
      if (rec === this.targetRec) curScore = s;
      if (s > bestScore) {
        bestScore = s;
        best = rec;
      }
    }
    if (best !== this.targetRec) {
      if (!this.targetRec || curScore === -Infinity || bestScore > curScore + 20) {
        this.targetRec = best;
        this.target = best ? best.ent : null;
        this.trackTime = 0;
        this.tracking = false;
        this.settle = 0;
        this.burstLeft = 0;
      }
    }
    if (this.targetRec && (!this.targetRec.ent.alive || !this.targetRec.known)) {
      this.targetRec = null;
      this.target = null;
      this.tracking = false;
    }
  }

  /** Flee live grenades. */
  checkGrenades(t) {
    const list = this.game.projectiles && this.game.projectiles.grenades;
    if (!list || list.length === 0) return;
    const bot = this.bot;
    const danger = GRENADE.radius + 1.0;
    let best = null;
    let bestD = danger;
    bot.getChestPosition(_c);
    for (let i = 0; i < list.length; i++) {
      const gr = list[i];
      if (!gr || !gr.position) continue;
      if (gr.owner && gr.owner !== bot && gr.owner.team === bot.team) continue;
      const gType = gr.type || 'frag';
      if (gType !== 'frag' && !(gr.danger > 0)) continue;              // smoke is harmless
      if (gr.fuse !== undefined && gr.fuse > 3.2 && gType !== 'vortex') continue;
      const d = gr.position.distanceTo(_c);
      if (d >= bestD || (gType !== 'frag' && d >= gr.danger)) continue;
      _h.copy(gr.position);
      _h.y += 0.1;
      if (!this.game.combat.canSee(_h, _c)) continue; // blast is blocked by geometry
      best = gr;
      bestD = d;
    }
    if (best) {
      this.dodgeFrom.copy(best.position);
      this.dodgeUntil = t + 0.5;
    }
  }

  chooseState(t) {
    const bot = this.bot;
    const rec = this.targetRec;
    const engaged = !!rec && (rec.visible || t - rec.lastSeen < 0.6);
    const lowHp = bot.health < this.cfg.retreatHealth + this.pers.health - this.game.modes.retreatShift(bot);
    let next = this.state;

    if (engaged) {
      if (lowHp && t > this.retreatBanUntil && (this.state === 'retreat' || this.canRetreat())) next = 'retreat';
      else next = 'engage';
    } else if (this.state === 'retreat' && t < this.retreatUntil && bot.health < bot.maxHealth * 0.6) {
      next = 'retreat';
    } else if (lowHp && t > this.retreatBanUntil && this.knowsHealth()) {
      next = 'retreat';
    } else if (rec && !this.game.modes.suppressChase(bot)) {
      next = 'chase';
    } else if (this.wantPickup(t)) {
      next = 'collect';
    } else {
      next = this.state === 'collect' || this.state === 'chase' || this.state === 'retreat' || this.state === 'engage' ? 'roam' : this.state;
    }
    if (next !== this.state) this.enterState(next, t);
    else this.refreshState(t);
  }

  enterState(next, t) {
    const prev = this.state;
    this.state = next;
    this.stateSince = t;
    this.searching = false;
    this._arrT = 0;
    this.nav.clear();
    if (next !== 'chase') this.searchUntil = 0;
    switch (next) {
      case 'engage':
        this.strafeFlipAt = t + randRange(this.cfg.flip[0], this.cfg.flip[1]) * 0.6;
        break;
      case 'chase':
        if (this.targetRec) this.nav.setGoal(this.targetRec.pos, 1.6, 2.0);
        break;
      case 'retreat':
        this.pickRetreatGoal(t);
        break;
      case 'collect':
        if (this._collect) this.nav.setGoal(this._collect.position, 0.9, 0.5);
        break;
      case 'roam':
        this.nav.clear();
        this.waitUntil = prev === 'roam' ? t : t + randRange(0.1, 0.5);
        this.pickRoamGoal();
        break;
      default:
        break;
    }
  }

  /** Per-think upkeep of the current state's goals. */
  refreshState(t) {
    const rec = this.targetRec;
    switch (this.state) {
      case 'chase':
        if (rec && !this.searching) this.nav.setGoal(rec.pos, 1.6, 2.0);
        break;
      case 'collect': {
        const p = this._collect;
        if (!p || !p.available || (this._ignored.get(p) || 0) > t) {
          this._collect = null;
          if (!this.wantPickup(t)) this.enterState('roam', t);
          else this.nav.setGoal(this._collect.position, 0.9, 0.5);
        } else {
          this.nav.setGoal(p.position, 0.9, 0.5);
          if (this.nav.unreachable && this.nav.mode !== 'idle' && this.bot.onGround) {
            // no route gets us there (isolated tower top, ...): stop trying for a long while
            this._ignored.set(p, t + 90);
            this._collect = null;
            this.enterState('roam', t);
          } else if (this.nav.arrived) {
            // standing on a pickup that will not be consumed (e.g. already full): stop wanting it
            if (!this._arrT) this._arrT = t;
            else if (t - this._arrT > 1.2) this._ignored.set(p, t + 20);
          } else {
            this._arrT = 0;
          }
        }
        break;
      }
      case 'retreat':
        if (t >= this.retreatUntil || this.bot.health >= this.bot.maxHealth * 0.6) {
          this.retreatBanUntil = t + 5;
          this.enterState(this.targetRec ? 'engage' : 'roam', t);
        } else if (this.retreatKind === 'health' && this._collect && !this._collect.available) {
          this.pickRetreatGoal(t);
        }
        break;
      case 'roam':
        if (this.game.modes.roamHook(this.bot, this, t)) break;   // King of the Hill: head for the zone
        if (this.nav.hasGoal && this.nav.arrived && t >= this.waitUntil) {
          this.waitUntil = t + randRange(0.3, 1.4);
          this.pickRoamGoal();
        } else if (!this.nav.hasGoal && t >= this.waitUntil) {
          this.pickRoamGoal();
        }
        break;
      default:
        break;
    }
  }

  // ------------------------------------------------------------------ goals

  pickRoamGoal() {
    const g = this.game;
    const bot = this.bot;
    const nav = g.world.nav;
    const r = Math.random();
    let goal = null;
    const objective = g.modes.objectiveGoal(bot, this);   // King of the Hill: go to / hold the live zone
    if (objective) {
      this.roamFailures = 0;
      this.nav.setGoal(objective, 1.4, 0.5);
      return;
    }
    // head toward the action: an approximate area around an enemy
    if (r < 0.4 * this.cfg.aggression * this.pers.aggr) {
      const list = g.entities;
      let pick = null;
      let n = 0;
      for (let i = 0; i < list.length; i++) {
        const e = list[i];
        if (e === bot || !e.alive || e.team === bot.team) continue;
        if (Math.random() < 1 / ++n) pick = e;
      }
      if (pick) {
        goal = nav && nav.randomPointNear ? asPos(nav, nav.randomPointNear(pick.position, 11)) : null;
        if (!goal) goal = pick.position;
      }
    }
    if (!goal && r > 0.85 && (bot.weaponId === 'sniper' || bot.weaponId === 'rail')) {
      const s = g.bots.spots.snipe;
      if (s.length) goal = s[(Math.random() * s.length) | 0].pos;
    }
    let fallback = null;
    for (let tries = 0; !goal && tries < 6; tries++) {
      let p = null;
      if (nav && nav.randomNode) p = asPos(nav, nav.randomNode());
      if (!p) p = this._fallbackPoint();
      if (!p) continue;
      // only goals we can actually walk to (one-way drops / pads can cut areas off)
      if (nav && nav.isConnected && !nav.isConnected(bot.position, p)) continue;
      if (p.distanceToSquared(bot.position) > 64) goal = p;
      else fallback = p;
    }
    if (!goal) goal = fallback;
    if (goal) {
      this.roamFailures = 0;
      this.nav.setGoal(goal, 1.4, 0.5);
    } else if (nav && nav.nodes && nav.nodes.length > 0 && ++this.roamFailures >= 3) {
      // nothing reachable from here: trapped (dropped into a pocket / launched somewhere isolated)
      this.roamFailures = 0;
      this.rescue();
    }
  }

  /** Point of interest when the nav graph gives nothing: spawn points and pickups. */
  _fallbackPoint() {
    const w = this.game.world;
    const sp = w.spawnPoints;
    const pk = w.pickups && w.pickups.list;
    const nS = sp ? sp.length : 0;
    const nP = pk ? pk.length : 0;
    const n = nS + nP;
    if (n === 0) return null;
    const i = (Math.random() * n) | 0;
    return i < nS ? sp[i].position : pk[i - nS].position;
  }

  pickupValue(p) {
    const bot = this.bot;
    switch (p.type) {
      case 'health': {
        const need = 1 - bot.health / bot.maxHealth;
        return need > 0.12 ? 0.3 + need * 1.7 : 0;
      }
      case 'armor':
        return bot.armor < 60 ? 0.3 + (1 - bot.armor / 100) * 0.35 : 0;
      case 'ammo': {
        const def = WEAPONS[bot.weaponId];
        if (!def || !Number.isFinite(def.reserveMax)) return 0;
        const frac = bot.reserve / def.reserveMax;
        return frac < 0.55 ? 0.35 + (0.55 - frac) * 1.4 : 0;
      }
      case 'grenades':
        return bot.grenades < 2 ? 0.4 : 0;
      case 'weapon': {
        const id = p.weapon;
        const def = WEAPONS[id];
        if (!def) return 0;
        // "Bot arsenal": a weapon switched off is never sought out (Bot.giveWeapon also refuses it), a rare one is less tempting
        const desire = padDesire(bot.arsenal, id);
        if (desire <= 0) return 0;
        if (!bot.inv[id]) return (WEAPON_PICKUP_VALUE[id] ?? 0.5) * desire;
        if (!Number.isFinite(def.reserveMax)) return 0;
        return bot.inv[id].reserve < def.reserveMax * 0.5 ? 0.3 * desire : 0;
      }
      default:
        return 0;
    }
  }

  /** Choose the best worthwhile pickup nearby. Sets this._collect. */
  wantPickup(t) {
    const list = this.game.world.pickups && this.game.world.pickups.list;
    if (!list || list.length === 0) return false;
    if (t < this.pickupCheckAt && !this._collect) return false;
    const bot = this.bot;
    let best = null;
    let bestV = 0.26;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (!p.available || (this._ignored.get(p) || 0) > t) continue;
      const d = p.position.distanceTo(bot.position);
      if (d > 60) continue;
      let v = this.pickupValue(p);
      if (v <= 0) continue;
      v *= this.game.modes.pickupFactor(bot, p);   // King of the Hill: the zone matters more than far pickups
      v /= 1 + d / 24;
      if (p === this._collect) v *= 1.25;
      if (v > bestV) {
        bestV = v;
        best = p;
      }
    }
    this._collect = best;
    if (!best) this.pickupCheckAt = t + 0.8;
    return !!best;
  }

  /** Nearest available health pickup that we have not given up on (unreachable), or null. */
  nearestHealth(t) {
    const list = this.game.world.pickups && this.game.world.pickups.list;
    if (!list) return null;
    const pos = this.bot.position;
    let best = null;
    let bd = 70 * 70;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (p.type !== 'health' || !p.available || (this._ignored.get(p) || 0) > t) continue;
      const d = p.position.distanceToSquared(pos);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  }

  knowsHealth() {
    return !!this.nearestHealth(this.game.time);
  }

  canRetreat() {
    if (this.knowsHealth()) return true;
    return this.cfg.coverUse > 0.3 && this.game.bots.spots.cover.length > 0;
  }

  pickRetreatGoal(t) {
    const g = this.game;
    const bot = this.bot;
    const rec = this.targetRec;
    this.retreatUntil = t + 9;
    this.coverHoldUntil = 0;
    const hp = this.nearestHealth(t);
    if (hp) {
      this.retreatKind = 'health';
      this._collect = hp;
      this.nav.setGoal(hp.position, 0.9, 0.5);
      return;
    }
    if (rec) {
      const cover = this.findCover(rec.visible ? rec.ent.position : rec.pos);
      if (cover) {
        this.retreatKind = 'cover';
        this.nav.setGoal(cover, 1.0, 0.5);
        return;
      }
    }
    // flee: a far node away from the threat
    this.retreatKind = 'flee';
    const nav = g.world.nav;
    let best = null;
    let bestScore = -1;
    for (let i = 0; i < 6; i++) {
      let p = nav && nav.randomNode ? asPos(nav, nav.randomNode()) : null;
      if (!p) p = this._fallbackPoint();
      if (!p) continue;
      let s = p.distanceTo(bot.position) * 0.5;
      if (rec) s += p.distanceTo(rec.pos);
      if (s > bestScore) {
        bestScore = s;
        best = p;
      }
    }
    if (best) this.nav.setGoal(best, 1.5, 0.5);
  }

  /** Nearby cover spot that hides us from `threat` (or null). */
  findCover(threat, maxDist = 26) {
    const spots = this.game.bots.spots.cover;
    const n = spots.length;
    if (n === 0) return null;
    const bot = this.bot;
    const combat = this.game.combat;
    _th.set(threat.x, threat.y + 1.5, threat.z);
    let best = null;
    let bestD = 1e9;
    const start = (Math.random() * n) | 0;
    let checked = 0;
    for (let k = 0; k < n && checked < 14; k++) {
      const s = spots[(start + k) % n];
      const d = s.pos.distanceTo(bot.position);
      if (d > maxDist || d < 1.5 || d >= bestD) continue;
      if (s.pos.distanceTo(threat) < 4) continue;
      checked++;
      _h.set(s.pos.x, s.pos.y + 1.5, s.pos.z);
      if (combat.canSee(_h, _th)) continue;
      best = s.pos;
      bestD = d;
    }
    return best;
  }

  // ------------------------------------------------------------------ weapons

  chooseWeapon(t) {
    const bot = this.bot;
    if (t < this.weaponCheckAt || bot.owned.length < 2 || bot.reloading && bot.ammo > 0) return;
    this.weaponCheckAt = t + 1.0;
    const rec = this.targetRec;
    let d = 20;
    if (rec) {
      const p = rec.visible ? rec.ent.position : rec.pos;
      d = p.distanceTo(bot.position);
    }
    let bestId = bot.weaponId;
    let bestScore = -Infinity;
    let curScore = -Infinity;
    for (let i = 0; i < bot.owned.length; i++) {
      const id = bot.owned[i];
      const inv = bot.inv[id];
      const def = WEAPONS[id];
      if (!inv || !def || inv.mag + inv.reserve <= 0) continue;
      const wd = botWeaponDef(id);
      let fit = 1 - clamp(Math.abs(d - wd.preferredRange) / Math.max(wd.maxRange, 12), 0, 1);
      if (d < wd.minRange) fit -= 0.9;
      if (d > wd.maxRange) fit -= 0.6;
      let s = fit * 0.7 + (WEAPON_POWER[id] ?? 0.5) * 0.45 + this.game.modes.weaponBias(bot, id);
      if (inv.mag <= 0) s -= 0.4;
      if (id === bot.weaponId) {
        s += 0.15;
        curScore = s;
      }
      if (s > bestScore) {
        bestScore = s;
        bestId = id;
      }
    }
    if (bestId !== bot.weaponId && (bestScore > curScore + 0.18 || curScore === -Infinity)) {
      this.intent.weapon = bestId;
      this.burstLeft = 0;
      this.settle = 0;
    }
  }

  considerReload(t) {
    const bot = this.bot;
    if (bot.reloading) return;
    const def = WEAPONS[bot.weaponId];
    if (!def) return;
    const rec = this.targetRec;
    const engaged = rec && (rec.visible || t - rec.lastSeen < 1.5);
    if (bot.ammo <= 0) this.intent.reload = true;
    else if (!engaged && bot.ammo < def.magSize * 0.55) this.intent.reload = true;
    // an empty weapon with a fight going on: swap to a loaded one when it is faster than reloading
    if (engaged && bot.ammo <= 0) {
      for (let i = 0; i < bot.owned.length; i++) {
        const id = bot.owned[i];
        if (id !== bot.weaponId && bot.inv[id].mag > 0) {
          this.intent.weapon = id;
          this.intent.reload = false;
          break;
        }
      }
    }
  }

  // ------------------------------------------------------------------ grenades

  considerGrenade(t) {
    const bot = this.bot;
    const cfg = this.cfg;
    if (bot.grenades <= 0 || t < this.nextGrenadeAt || t < this.grenadeTryAt || !bot.onGround || t < this.dodgeUntil || bot.isShocked()) return;
    const rec = this.targetRec;
    if (!rec) return;
    const p = rec.visible ? rec.ent.position : rec.pos;
    const d = Math.hypot(p.x - bot.position.x, p.z - bot.position.z);
    // a throw carries ~16 m (GRENADE.throwSpeed 19 m/s at GRAVITY 24) and must stay clear of our own blast
    if (d < GRENADE.radius + 1.8 || d > MAX_THROW) return;
    const age = t - rec.lastSeen;
    let ok = t < this.pendingGrenadeUntil;
    if (!ok) {
      if (!rec.visible && age > 0.4 && age < 5) {
        ok = chance(cfg.grenadeRate); // flush a target that ducked behind cover
      } else if (rec.visible && d > 9) {
        const v = rec.ent.velocity;
        const slow = Math.hypot(v.x, v.z) < 2.5;
        const pressed = bot.reloading || bot.ammo <= 2 || bot.health < 45;
        if (slow || pressed) ok = chance(cfg.grenadeRate * 0.55);
      }
      this.grenadeTryAt = t + 0.9;
      if (!ok) return;
      this.pendingGrenadeUntil = t + 1.1;
    }
    const pos = rec.visible ? rec.ent.position : rec.pos;
    // turn toward the throw first
    const want = yawFromDirection(pos.x - bot.position.x, pos.z - bot.position.z);
    if (Math.abs(wrapAngle(want - bot.yaw)) > 0.45) {
      this.glance.copy(pos);
      this.glanceUntil = t + 0.6;
      return;
    }
    this.pendingGrenadeUntil = 0;
    this.grenadeTryAt = t + 0.9;
    if (this.throwGrenadeAt(pos)) {
      this.nextGrenadeAt = t + cfg.grenadeCooldown * randRange(0.8, 1.5);
      this.holdFireUntil = t + 0.45;
    }
  }

  /**
   * Special grenades (Vortex / Static / Kinetic / Smoke) with simple situational heuristics:
   * smoke covers a retreat, static hits a cluster or a pressed target, vortex flushes a hiding or clustered target,
   * kinetic shoves a target that stands near an unsupported edge (or a cluster) away from the bot.
   */
  considerSpecial(t) {
    const bot = this.bot;
    const cfg = this.cfg;
    if (t < this.nextSpecialAt || !bot.onGround || t < this.dodgeUntil || bot.isShocked() || t < this.pendingGrenadeUntil) return;
    const inv = bot.nades;
    if (!inv || inv.vortex + inv.static + inv.kinetic + inv.smoke <= 0) return;
    const rec = this.targetRec;
    if (!rec) return;
    const hp = bot.health;
    const bp = bot.position;
    const cooldown = () => t + cfg.grenadeCooldown * randRange(0.6, 1.2);

    // smoke: cut the line of sight while retreating from a visible enemy
    if (inv.smoke > 0 && rec.visible && (this.state === 'retreat' || hp < 45)) {
      const p = rec.ent.position;
      const dx = p.x - bp.x, dz = p.z - bp.z;
      const d = Math.hypot(dx, dz);
      if (d > 8 && d < 30 && chance(Math.min(0.9, cfg.grenadeRate * 1.6))) {
        _sp.set(bp.x + (dx / d) * 5, bp.y, bp.z + (dz / d) * 5);
        this.grenadeTryAt = t + 0.9;
        if (this.throwGrenadeAt(_sp, 'smoke')) { this.nextSpecialAt = cooldown(); return; }
      }
    }

    const known = rec.visible ? rec.ent.position : rec.pos;
    const dx = known.x - bp.x, dz = known.z - bp.z;
    const d = Math.hypot(dx, dz);
    if (d < 5 || d > MAX_THROW) { this.nextSpecialAt = t + 0.6; return; }
    const ux = dx / d, uz = dz / d;
    let near = 0;
    const ents = this.game.entities;
    for (let i = 0; i < ents.length; i++) {
      const e = ents[i];
      if (!e.alive || e.team === bot.team || e === rec.ent) continue;
      if (Math.hypot(e.position.x - known.x, e.position.z - known.z) < 7) near++;
    }
    const age = t - rec.lastSeen;
    const hiding = !rec.visible && age > 0.4 && age < 5;
    const pressed = bot.reloading || bot.ammo <= 2 || hp < 45;
    const engaged = rec.visible && this.state === 'engage';
    let type = null;
    let ledge = false;
    if (inv.static > 0 && d < 12 && (near >= 1 || pressed || engaged)
      && chance(cfg.grenadeRate * (near >= 1 ? 1.2 : pressed ? 0.7 : 0.4))) {
      type = 'static';
    } else if (inv.vortex > 0 && d > 6 && (hiding || near >= 1) && chance(cfg.grenadeRate * 0.9)) {
      type = 'vortex';
    } else if (inv.kinetic > 0 && d > 4.5 && d < 14 && rec.visible) {
      // an unsupported edge just behind the target (seen from the bot) turns the push into a fall / wall slam
      _sp.set(known.x + ux * 3.2, known.y + 1, known.z + uz * 3.2);
      ledge = !this.game.world.raycast(_sp, _dn, 3.4);
      if ((ledge || near >= 1 || engaged) && chance(cfg.grenadeRate * (ledge ? 1.5 : near >= 1 ? 0.7 : 0.3))) type = 'kinetic';
    }
    this.grenadeTryAt = t + 0.9;
    if (!type) { this.nextSpecialAt = t + 0.9; return; }
    // turn toward the throw first
    const want = yawFromDirection(dx, dz);
    if (Math.abs(wrapAngle(want - bot.yaw)) > 0.45) {
      this.glance.copy(known);
      this.glanceUntil = t + 0.6;
      this.nextSpecialAt = t + 0.3;
      return;
    }
    // kinetic lands short of the target so the shove points away from the bot
    if (type === 'kinetic') _sp.set(known.x - ux * 1.5, known.y, known.z - uz * 1.5);
    else _sp.copy(known);
    if (this.throwGrenadeAt(_sp, type)) {
      this.nextSpecialAt = cooldown();
      this.holdFireUntil = t + 0.45;
    } else {
      this.nextSpecialAt = t + 0.9;
    }
  }

  /**
   * Solve a ballistic throw at `pos` and validate the arc against world geometry.
   * @param {THREE.Vector3} pos
   * @param {string} [type='frag'] grenade type (throw speed / fuse come from GRENADE_TYPES)
   */
  throwGrenadeAt(pos, type = 'frag') {
    const bot = this.bot;
    const g = GRAVITY;
    const GT = GRENADE_TYPES[type] || GRENADE;
    const v = GT.throwSpeed;
    const eye = bot.getEyePosition(_eye);
    const dx = pos.x - eye.x, dz = pos.z - eye.z;
    const x = Math.hypot(dx, dz);
    const dy = pos.y + 0.25 - eye.y;
    if (x < 2) return false;
    const v2 = v * v;
    const disc = v2 * v2 - g * (g * x * x + 2 * dy * v2);
    if (disc < 0) return false;
    const sq = Math.sqrt(disc);
    const ux = dx / x, uz = dz / x;
    const world = this.game.world;
    for (let pass = 0; pass < 2; pass++) {
      const ang = Math.atan2(pass === 0 ? v2 - sq : v2 + sq, g * x);
      const vh = v * Math.cos(ang);
      const vy = v * Math.sin(ang);
      _tv.set(ux * vh, vy, uz * vh);
      const T = x / Math.max(0.5, vh);
      // origin matches Bot.throwGrenade (eye + 0.45 along the velocity)
      _to.copy(_tv).normalize().multiplyScalar(0.45).add(eye);
      let clear = true;
      _tmp.copy(_to);
      const steps = Math.max(4, Math.ceil(T / 0.08));
      for (let i = 1; i <= steps; i++) {
        const tt = (T * i) / steps;
        _av.set(_to.x + _tv.x * tt, _to.y + _tv.y * tt - 0.5 * g * tt * tt, _to.z + _tv.z * tt);
        _dv.subVectors(_av, _tmp);
        const len = _dv.length();
        if (len > 1e-4) {
          _dv.multiplyScalar(1 / len);
          if (world.raycast(_tmp, _dv, len)) {
            clear = false;
            break;
          }
        }
        _tmp.copy(_av);
      }
      if (!clear) continue;
      // cooked to arrive: the grenade detonates about when it reaches the target (slack = how sloppy the timing is)
      const fuse = GT.cookable === false ? GT.fuse : clamp(T + this.cfg.grenadeSlack * randRange(0.6, 1.4), 0.7, GT.fuse);
      return bot.throwGrenade(_tv, fuse, type);
    }
    return false;
  }

  // ------------------------------------------------------------------ stuck recovery

  updateStuck(t) {
    if (t < this.stuckCheckAt) return;
    this.stuckCheckAt = t + 0.5;
    const bot = this.bot;
    const it = this.intent;
    const moved = Math.hypot(bot.position.x - this._sx0, bot.position.z - this._sz0);
    this._sx0 = bot.position.x;
    this._sz0 = bot.position.z;
    const wantSpeed = it.speed * Math.hypot(it.moveX, it.moveZ);
    if (wantSpeed > 2.0 && moved < 0.4 && t > this.unstickUntil + 0.3) {
      this.stuckCount++;
      if (this.stuckCount >= 2) {
        this.stuckCount = 0;
        this.recoverStuck(t);
      }
    } else if (moved > 0.9) {
      this.stuckCount = 0;
      this.stuckStage = Math.max(0, this.stuckStage - 1);
    } else if (wantSpeed <= 2.0) {
      this.stuckCount = 0;
    }
  }

  /**
   * Fast reaction to walking into an obstacle: railings, crates and curbs are <= 1.1 m, so a hop clears them.
   * (The slower stuck recovery escalates from here when that is not enough.)
   */
  updateBlocked(dt, t) {
    const bot = this.bot;
    const it = this.intent;
    if (it.speed > 2 && bot.onGround && bot.speed < 1.2 && !it.jump) {
      this.blockedT += dt;
      if (this.blockedT > 0.3 && t >= this.blockedJumpAt) {
        it.jump = true;
        this.blockedJumpAt = t + 0.8;
      }
    } else {
      this.blockedT = 0;
    }
  }

  /** Called by Bot.teleportTo. */
  onTeleport() {
    this.nav.clear();
    this.stuckStage = 0;
    this.stuckCount = 0;
    this._sx0 = this.bot.position.x;
    this._sz0 = this.bot.position.z;
    this.unstickUntil = 0;
    this.forceJumpUntil = 0;
    this.dodgeUntil = 0;
    this.stuckCheckAt = this.game.time + 1;
    this.thinkAt = this.game.time;
  }

  /**
   * Last resort when every recovery failed (trapped in a pit / on an isolated ledge): relocate to a spawn
   * point with no enemy nearby or in sight. Waits while any enemy could see the bot.
   */
  rescue() {
    const g = this.game;
    const bot = this.bot;
    const spawns = g.world.spawnPoints;
    if (!spawns || spawns.length === 0) return false;
    const eye = bot.getChestPosition(_c);
    for (let i = 0; i < g.entities.length; i++) {
      const e = g.entities[i];
      if (e === bot || !e.alive || e.team === bot.team) continue;
      if (e.position.distanceToSquared(bot.position) < 45 * 45 && g.combat.canSee(e.getEyePosition(_h), eye)) return false;
    }
    let best = null;
    let bestScore = -1;
    for (let k = 0; k < spawns.length; k++) {
      const sp = spawns[(Math.random() * spawns.length) | 0];
      let minD = 60;
      for (let i = 0; i < g.entities.length; i++) {
        const e = g.entities[i];
        if (e === bot || !e.alive) continue;
        minD = Math.min(minD, e.position.distanceTo(sp.position));
      }
      if (minD > bestScore) {
        bestScore = minD;
        best = sp;
      }
    }
    if (!best) return false;
    bot.teleportTo(best.position, best.yaw);
    return true;
  }

  recoverStuck(t) {
    const it = this.intent;
    this.stuckStage++;
    // a path that starts behind a wall (bot wedged in a pocket) cannot be walked: give up on it sooner
    if (this.stuckStage >= (this.nav.startBlocked ? 4 : 9) && this.rescue()) return;
    const n = this.stuckStage % 4;
    const mx = it.moveX, mz = it.moveZ;
    if (n === 1) {
      this.forceJumpUntil = t + 0.4;
    } else if (n === 2) {
      const s = Math.random() < 0.5 ? 1 : -1;
      this.unstickDir.set(-mz * s, mx * s);
      this.unstickUntil = t + randRange(0.5, 0.9);
    } else if (n === 3) {
      this.nav.invalidate();
      if (this.state === 'roam') this.pickRoamGoal();
      this.strafeDir = -this.strafeDir;
      this.strafeFlipAt = t + 1;
    } else {
      this.unstickDir.set(-mx, -mz);
      this.unstickUntil = t + randRange(0.6, 1.0);
      if (this.state === 'roam' || this.state === 'collect') {
        if (this._collect) this._ignored.set(this._collect, t + 15);
        this.pickRoamGoal();
      }
    }
  }

  // ------------------------------------------------------------------ movement

  /** Cached movement probe (walls / steps / ledges) along a unit direction. */
  probeDir(mx, mz, dist, t) {
    const pc = this._pc;
    if (t - pc.at < 0.07 && pc.x * mx + pc.z * mz > 0.96) return pc;
    probeMove(this.game.world.collision, this.bot.position, mx, mz, dist, pc);
    pc.x = mx;
    pc.z = mz;
    pc.at = t;
    return pc;
  }

  updateMovement(dt, t) {
    this.computeMovement(dt, t);
    this.applyLedgeGuard(t);
  }

  /**
   * Last line of defence against walking off ledges, evaluated at most every ~90 ms (or when the intended direction
   * changes) and re-applied from the cached decision in between:
   *  - kind 1: the way ahead has no ground -> turn by `a` toward a direction that does
   *  - kind 2: an unsupported edge runs alongside -> bend away from it (`s` = lateral weight, negative = left edge)
   *  - kind 3: nothing safe -> stop
   *  - `cap` limits speed on a narrow bridge
   * Skipped while a nav drop link is being followed (walking off the ledge is intended) and in the air.
   */
  applyLedgeGuard(t) {
    const it = this.intent;
    const bot = this.bot;
    const g = this._guard;
    if (it.speed < 0.5 || (it.moveX === 0 && it.moveZ === 0) || !bot.onGround) {
      g.at = -9;
      return;
    }
    if (this.nav.allowsDrop()) {
      g.at = -9;
      return;
    }
    const l = Math.hypot(it.moveX, it.moveZ);
    const mx = it.moveX / l, mz = it.moveZ / l;
    if (!(t - g.at < 0.09 && g.x * mx + g.z * mz > 0.985)) {
      this.evaluateLedgeGuard(g, mx, mz, t);
    }
    switch (g.kind) {
      case 1: {
        const c = Math.cos(g.a), sn = Math.sin(g.a);
        it.moveX = mx * c - mz * sn;
        it.moveZ = mx * sn + mz * c;
        break;
      }
      case 2: {
        const nx = mx + -mz * g.s, nz = mz + mx * g.s;
        const n = Math.hypot(nx, nz) || 1;
        it.moveX = nx / n;
        it.moveZ = nz / n;
        break;
      }
      case 3:
        it.moveX = 0;
        it.moveZ = 0;
        it.speed = 0;
        break;
      default:
        break;
    }
    if (g.cap > 0) it.speed = Math.min(it.speed, g.cap);
  }

  /** Probe the ground around the intended direction and store the decision in `g` (see applyLedgeGuard). */
  evaluateLedgeGuard(g, mx, mz, t) {
    const bot = this.bot;
    const it = this.intent;
    const col = this.game.world.collision;
    const pos = bot.position;
    g.at = t;
    g.x = mx;
    g.z = mz;
    g.kind = 0;
    g.a = 0;
    g.s = 0;
    g.cap = 0;
    const la = 0.9 + Math.max(bot.speed, it.speed * 0.6) * 0.16;
    if (ledgeAhead(col, pos, mx, mz, la)) {
      const angles = [0.75, -0.75, 1.4, -1.4];
      g.kind = 3;
      for (let i = 0; i < angles.length; i++) {
        const a = angles[i] * this.strafeDir;
        const c = Math.cos(a), sn = Math.sin(a);
        if (!ledgeAhead(col, pos, mx * c - mz * sn, mx * sn + mz * c, la)) {
          g.kind = 1;
          g.a = a;
          return;
        }
      }
      this.strafeFlipAt = 0;
      return;
    }
    // Side clearance: paths and strafing often run along the rim of ramps, catwalks and platforms; a capsule
    // hanging over the edge slides off. Probe ground at both sides (lateral + diagonal-forward).
    const lx = -mz, lz = mx; // left of the move direction
    const K = 0.7071;
    const left = ledgeAhead(col, pos, lx, lz, 0.62) || ledgeAhead(col, pos, (mx + lx) * K, (mz + lz) * K, 0.95);
    const right = ledgeAhead(col, pos, -lx, -lz, 0.62) || ledgeAhead(col, pos, (mx - lx) * K, (mz - lz) * K, 0.95);
    if (left === right) {
      if (left) g.cap = MOVE.run * 0.7; // narrow bridge: keep the line, slow down
      return;
    }
    g.kind = 2;
    g.s = left ? -0.9 : 0.9;
  }

  computeMovement(dt, t) {
    const bot = this.bot;
    const it = this.intent;
    const cfg = this.cfg;
    it.moveX = 0;
    it.moveZ = 0;
    it.speed = 0;
    if (t >= this.crouchUntil) it.crouch = false;

    if (t < this.dodgeUntil) {
      this.moveDodge(t);
      if (t < this.forceJumpUntil && bot.onGround) it.jump = true;
      return;
    }

    if (t < this.unstickUntil) {
      it.moveX = this.unstickDir.x;
      it.moveZ = this.unstickDir.y;
      const l = Math.hypot(it.moveX, it.moveZ) || 1;
      it.moveX /= l;
      it.moveZ /= l;
      it.speed = MOVE.run * cfg.speedScale;
      return;
    }

    switch (this.state) {
      case 'engage':
        this.moveEngage(dt, t);
        break;
      case 'retreat':
        this.moveRetreat(dt, t);
        break;
      case 'chase':
        this.moveChase(dt, t);
        break;
      case 'collect':
        this.moveNav(dt, MOVE.sprint * cfg.speedScale);
        break;
      default:
        this.moveRoam(dt, t);
        break;
    }
    if (t < this.forceJumpUntil && bot.onGround) it.jump = true;
  }

  moveNav(dt, speed) {
    const nav = this.nav;
    const it = this.intent;
    nav.update(dt);
    if (nav.arrived) return;
    it.moveX = nav.dirX;
    it.moveZ = nav.dirZ;
    it.speed = speed;
    if (nav.jump) it.jump = true;
  }

  moveRoam(dt, t) {
    const nav = this.nav;
    if (t < this.waitUntil) {
      nav.update(dt);
      return;
    }
    this.moveNav(dt, MOVE.run * this.cfg.speedScale);
  }

  moveChase(dt, t) {
    const nav = this.nav;
    const rec = this.targetRec;
    if (!rec) return;
    if (this.searching) {
      if (t >= this.searchUntil) {
        // give up: forget it
        rec.lastSeen = rec.lastHeard = rec.hurtAt = -999;
        rec.known = false;
        this.targetRec = null;
        this.target = null;
        this.searching = false;
        this.enterState('roam', t);
      }
      return; // stand and scan
    }
    nav.update(dt);
    if (nav.arrived) {
      this.searching = true;
      this.searchUntil = t + randRange(2.0, 3.4);
      return;
    }
    const it = this.intent;
    it.moveX = nav.dirX;
    it.moveZ = nav.dirZ;
    it.speed = MOVE.run * this.cfg.speedScale * 1.05;
    if (nav.jump) it.jump = true;
  }

  moveRetreat(dt, t) {
    const it = this.intent;
    const nav = this.nav;
    nav.update(dt);
    if (this.retreatKind === 'health' && nav.unreachable && nav.mode !== 'idle' && this.bot.onGround && this._collect) {
      this._ignored.set(this._collect, t + 90);
      this.pickRetreatGoal(t);
      return;
    }
    if (nav.arrived) {
      if (this.retreatKind === 'cover') {
        if (this.coverHoldUntil === 0) this.coverHoldUntil = t + randRange(1.5, 3.5);
        if (t >= this.coverHoldUntil) {
          this.retreatBanUntil = t + 2;
          this.retreatUntil = 0;
        }
        it.crouch = true;
        this.crouchUntil = t + 0.3;
      } else if (this.retreatKind === 'flee' && t - this.stateSince > 1) {
        this.pickRetreatGoal(t);
      }
      return;
    }
    it.moveX = nav.dirX;
    it.moveZ = nav.dirZ;
    it.speed = MOVE.sprint * this.cfg.speedScale;
    if (nav.jump) it.jump = true;
  }

  moveDodge(t) {
    const bot = this.bot;
    const it = this.intent;
    let ax = bot.position.x - this.dodgeFrom.x;
    let az = bot.position.z - this.dodgeFrom.z;
    let l = Math.hypot(ax, az);
    if (l < 0.3) {
      ax = Math.cos(bot.yaw);
      az = -Math.sin(bot.yaw);
      l = 1;
    }
    ax /= l;
    az /= l;
    // try straight away, then diagonals; take the first direction that is not a wall / ledge
    const angles = [0, 0.7, -0.7, 1.4, -1.4];
    const first = this.strafeDir;
    let bx = ax, bz = az, found = false;
    for (let i = 0; i < angles.length && !found; i++) {
      const a = angles[i] * (i % 2 === 1 ? first : -first);
      const c = Math.cos(a), s = Math.sin(a);
      const cx = ax * c - az * s, cz = ax * s + az * c;
      const p = this.probeDir(cx, cz, 2.2, t);
      if (!p.wall && !p.ledge) {
        bx = cx;
        bz = cz;
        found = true;
      }
    }
    it.moveX = bx;
    it.moveZ = bz;
    it.speed = MOVE.sprint * 1.05 * this.cfg.speedScale;
    if (!found && bot.onGround) it.jump = true;
  }

  moveEngage(dt, t) {
    const bot = this.bot;
    const it = this.intent;
    const cfg = this.cfg;
    const rec = this.targetRec;
    if (!rec) return;
    if (this.reloadCover && t < this.reloadCoverUntil && bot.reloading) {
      // duck behind cover while the magazine goes in (still facing the enemy: backpedal / side-step animation)
      this.nav.setGoal(this.reloadCover, 0.8, 1);
      this.nav.update(dt);
      if (this.nav.arrived) {
        it.crouch = true;
        this.crouchUntil = t + 0.3;
      } else {
        it.moveX = this.nav.dirX;
        it.moveZ = this.nav.dirZ;
        it.speed = MOVE.sprint * cfg.speedScale;
        if (this.nav.jump) it.jump = true;
      }
      return;
    }
    this.reloadCover = null;
    const tp = rec.visible ? rec.ent.position : rec.pos;
    const dx = tp.x - bot.position.x;
    const dz = tp.z - bot.position.z;
    const dy = tp.y - bot.position.y;
    const d = Math.max(0.01, Math.hypot(dx, dz));
    const tx = dx / d, tz = dz / d;
    const id = bot.weaponId;
    const wd = botWeaponDef(id);
    const pr = wd.preferredRange * this.pers.range;

    const adv = this.game.modes.advanceGoal(bot, this, d);   // King of the Hill: keep moving on the zone while shooting
    if (adv) {
      this.nav.setGoal(adv, 1.4, 1.5);
      this.nav.update(dt);
      if (this.nav.unreachable && this.nav.mode !== 'idle') {
        this._objBan = t + 8;
      } else if (!this.nav.arrived) {
        it.moveX = this.nav.dirX;
        it.moveZ = this.nav.dirZ;
        it.speed = MOVE.run * cfg.speedScale;
        if (this.nav.jump) it.jump = true;
        return;
      }
    }

    if (t >= this.strafeFlipAt) {
      if (chance(0.78)) this.strafeDir = -this.strafeDir;
      this.strafeFlipAt = t + randRange(cfg.flip[0], cfg.flip[1]);
    }

    let strafeAmt = cfg.strafe;
    let radial = 0;
    if (id === 'shotgun') {
      radial = d > pr + 1.5 ? 1 : d < 2.5 ? -0.5 : 0.15;
    } else if (id === 'arc') {
      // Tempest: hold the beam on the target from close-mid range, strafing hard (the beam never misses inside range)
      radial = d > pr + 2 ? 0.8 : d < 4 ? -0.4 : 0.1;
      strafeAmt = Math.max(strafeAmt, 1.0);
    } else if (id === 'gale') {
      // Gale: close in to shove range, then hover around 5 m
      radial = d > pr + 1 ? 1 : d < 2 ? -0.3 : 0.25;
    } else if (d < wd.minRange + 1.5) {
      radial = -1;
    } else if (d > wd.maxRange * 0.85) {
      radial = 1;
    } else if (d > pr + 8) {
      radial = 0.55 + 0.25 * this.pers.aggr;
    } else if (d > pr + 3) {
      radial = 0.25 + 0.2 * cfg.aggression;
    } else if (d < pr - 5) {
      radial = -0.55;
    } else if (cfg.aggression > 0.8) {
      radial = 0.1;
    }
    let standing = false;
    if ((id === 'sniper' || id === 'rail') && d > wd.minRange + 6 && d < wd.maxRange * 0.85) {
      strafeAmt *= 0.2;
      radial = 0;
      if (this.settle > 0.15) this.standUntil = Math.max(this.standUntil, t + 0.4);
      if (t >= this.standCheckAt) {
        this.standCheckAt = t + 0.7;
        if (chance(0.5)) this.standUntil = t + randRange(0.8, 2.0);
      }
      standing = t < this.standUntil;
    }
    if (bot.charging) standing = true;       // Javelin: hold still while the charge builds
    if (!rec.visible) radial = Math.max(radial, 0.6);
    const hold = this.game.modes.holdPosition(bot, d, tp);   // King of the Hill: holders do not leave the zone for far enemies
    if (hold) radial = 0;

    // long approaches / other levels go through the nav graph
    const usePath = !hold && (!rec.visible || (radial > 0.5 && (Math.abs(dy) > 1.8 || d > wd.maxRange * 0.7)));
    let mx, mz;
    const rx = -tz, rz = tx;
    const sd = this.strafeDir * strafeAmt;
    if (usePath) {
      this.nav.setGoal(tp, Math.max(2.5, pr * 0.5), 3);
      this.nav.update(dt);
      mx = this.nav.dirX;
      mz = this.nav.dirZ;
      if (rec.visible && (mx !== 0 || mz !== 0) && !this.nav.allowsDrop()) {
        mx += rx * sd * 0.5;
        mz += rz * sd * 0.5;
      }
      if (this.nav.jump) it.jump = true;
    } else {
      mx = tx * radial + rx * sd;
      mz = tz * radial + rz * sd;
    }
    let len = Math.hypot(mx, mz);
    if (len > 0.05 && !standing) {
      mx /= len;
      mz /= len;
      let p = this.probeDir(mx, mz, 1.5, t);
      if ((p.wall && p.wallDist < 1.1) || (p.ledge && !usePath)) {
        if (t >= this.flipCooldown) {
          this.strafeDir = -this.strafeDir;
          this.flipCooldown = t + 0.45;
          this.strafeFlipAt = t + randRange(cfg.flip[0], cfg.flip[1]);
        }
        // retry with the flipped strafe, then with the radial part only
        mx = tx * radial - rx * sd;
        mz = tz * radial - rz * sd;
        len = Math.hypot(mx, mz);
        if (len > 0.05) {
          mx /= len; mz /= len;
          p = this.probeDir(mx, mz, 1.5, t);
          if ((p.wall && p.wallDist < 1.1) || (p.ledge && !usePath)) {
            mx = tx * radial;
            mz = tz * radial;
            len = Math.hypot(mx, mz);
            if (len > 0.05) {
              mx /= len; mz /= len;
              p = this.probeDir(mx, mz, 1.5, t);
              if ((p.wall && p.wallDist < 1.1) || p.ledge) len = 0;
            }
          }
        }
      }
      if (len > 0.05 && p.step && bot.onGround) it.jump = true;
    }
    if (len > 0.05 && !standing) {
      it.moveX = mx;
      it.moveZ = mz;
      const fast = radial > 0.5 || usePath;
      it.speed = fast ? MOVE.run * cfg.speedScale : MOVE.strafe * (0.45 + 0.55 * cfg.strafe) * cfg.speedScale;
    }

    // crouch / jump variety
    if (t >= this.crouchCheckAt) {
      this.crouchCheckAt = t + 0.5;
      if (!it.crouch && d > 12 && radial < 0.4 && id !== 'shotgun' && id !== 'arc' && id !== 'gale' && chance(cfg.crouchiness * 2.2)) {
        it.crouch = true;
        this.crouchUntil = t + randRange(0.7, 1.6);
      }
    }
    if (standing) {
      it.crouch = true;
      this.crouchUntil = t + 0.3;
    }
    if (it.crouch && t >= this.crouchUntil) it.crouch = false;
    if (bot.onGround && !it.crouch && d > 5 && !standing && chance(cfg.jumpiness * dt)) it.jump = true;
  }

  // ------------------------------------------------------------------ aiming

  /** Total aim-tracking latency (s): point filter + turn controller + velocity smoothing. */
  aimLag(rec) {
    return 1 / (this.cfg.trackRate * (rec.visible ? 1 : 2.5)) + 1 / TURN_GAIN + 1 / TURN_SMOOTH;
  }

  /**
   * True (unlagged) point to hit on the target, including projectile lead.
   * @returns {THREE.Vector3} out
   */
  computeAimPoint(rec, out) {
    const bot = this.bot;
    const e = rec.ent;
    const cfg = this.cfg;
    const def = WEAPONS[bot.weaponId];
    const p = rec.visible ? e.position : rec.pos;
    const v = rec.visible ? e.velocity : rec.vel;
    const h = e.height;
    const rocket = !!def && def.kind === 'projectile' && !!def.projectile;
    const y = rocket && e.onGround ? p.y + 0.12 : p.y + h * cfg.aimHeight;
    out.set(p.x, y, p.z);
    // "smooth pursuit": a skilled player anticipates the lag of their own aim, so lead by a fraction of it
    const pursuit = cfg.leadSkill * 0.9 * this.aimLag(rec);
    let lead = pursuit;
    if (rocket) {
      const eye = bot.getEyePosition(_eye);
      const speed = def.projectile.speed;
      const dist = Math.hypot(p.x - eye.x, p.y - eye.y, p.z - eye.z);
      // iterate the intercept time
      let tt = dist / speed;
      for (let i = 0; i < 2; i++) {
        const lx = p.x + v.x * tt * cfg.leadSkill, lz = p.z + v.z * tt * cfg.leadSkill;
        tt = Math.hypot(lx - eye.x, p.y - eye.y, lz - eye.z) / speed;
      }
      lead += tt * cfg.leadSkill;
      if (!e.onGround) out.y += (v.y * tt - 0.5 * GRAVITY * tt * tt) * cfg.leadSkill * 0.5;
    } else if (!e.onGround) {
      out.y += clamp(v.y * pursuit * 0.6, -0.5, 0.5);
    }
    out.x += v.x * lead;
    out.z += v.z * lead;
    return out;
  }

  updateAim(dt, t) {
    const bot = this.bot;
    const cfg = this.cfg;
    const it = this.intent;
    const rec = this.targetRec;
    const eye = bot.getEyePosition(_eye);
    const live = !!rec && (rec.visible || t - rec.lastSeen < 0.3);
    let aiming = live && t - rec.seenSince >= this.reactionFor(rec) * 0.35;
    if (aiming && this.state === 'retreat' && this.retreatKind !== 'cover') {
      // running for a health pack: only keep the enemy in the sights while it is close; otherwise turn and run
      const p = rec.visible ? rec.ent.position : rec.pos;
      if (Math.hypot(p.x - bot.position.x, p.z - bot.position.z) > 12) aiming = false;
    }
    let desYaw = bot.yaw;
    let desPitch = 0;
    let maxTurn = 3.4;
    this.faceAim = false;

    if (aiming) {
      this.faceAim = true;
      const e = rec.ent;
      this.computeAimPoint(rec, _tp);
      if (!this.tracking) {
        this.aimPt.copy(_tp);
        this.tracking = true;
        this.trackTime = 0;
      } else {
        this.aimPt.lerp(_tp, damp(cfg.trackRate * (rec.visible ? 1 : 2.5), dt));
      }
      if (rec.visible) this.trackTime = Math.min(3, this.trackTime + dt);

      // error model: grows with movement, shrinks while tracking
      if (t >= this.errAt) {
        const v = e.velocity;
        const dxz = Math.hypot(this.aimPt.x - eye.x, this.aimPt.z - eye.z) || 1;
        const lateral = Math.abs(v.x * (this.aimPt.z - eye.z) - v.z * (this.aimPt.x - eye.x)) / dxz;
        const speedFrac = Math.min(1, bot.speed / MOVE.run);
        const scale = 1 + 0.35 * speedFrac + 0.95 * Math.min(1, lateral / 5) + (bot.onGround ? 0 : 0.4) + (bot.crouch > 0.5 ? -0.15 : 0);
        const shrink = 1 - cfg.errorShrink * saturate(this.trackTime / 2.2);
        const sigma = cfg.aimError * this.pers.err * scale * shrink * (bot.shockedUntil > t ? 3 : 1);   // shocked: aim error x3
        this.errTarget.set(gauss() * sigma, gauss() * sigma * 0.7);
        this.errAt = t + randRange(0.22, 0.4);
      }
      const k = damp(7, dt);
      this.err.x += (this.errTarget.x - this.err.x) * k;
      this.err.y += (this.errTarget.y - this.err.y) * k;

      _dv.subVectors(this.aimPt, eye);
      const hl = Math.hypot(_dv.x, _dv.z);
      desYaw = yawFromDirection(_dv.x, _dv.z) + this.err.x;
      desPitch = Math.atan2(_dv.y, Math.max(0.001, hl)) + this.err.y;
      maxTurn = cfg.turnSpeed * (rec.visible ? 1 : 0.7);
    } else if (live) {
      // target seen but still "reacting": keep looking roughly where we were
      this.tracking = false;
    } else {
      this.tracking = false;
      if (rec && t - rec.lastSeen < 1.2 && this.state === 'engage') {
        // just lost sight: keep the crosshair on the last known position
        _dv.set(rec.pos.x - eye.x, rec.pos.y + 1.1 - eye.y, rec.pos.z - eye.z);
        desYaw = yawFromDirection(_dv.x, _dv.z);
        desPitch = Math.atan2(_dv.y, Math.max(0.001, Math.hypot(_dv.x, _dv.z)));
        maxTurn = cfg.turnSpeed * 0.6;
        this.faceAim = true;
      } else if (t < this.glanceUntil) {
        _dv.set(this.glance.x - eye.x, this.glance.y + 1.0 - eye.y, this.glance.z - eye.z);
        desYaw = yawFromDirection(_dv.x, _dv.z);
        desPitch = Math.atan2(_dv.y, Math.max(0.001, Math.hypot(_dv.x, _dv.z))) * 0.5;
        maxTurn = cfg.turnSpeed * 0.8;
      } else if (this.state === 'chase' && this.searching) {
        desYaw = bot.yaw + Math.sin(t * 1.7 + this.scanPhase) * 0.9;
        maxTurn = 2.6;
      } else if (it.speed > 0.5 && (it.moveX !== 0 || it.moveZ !== 0)) {
        const sweep = Math.sin(t * 0.8 + this.scanPhase) * (this.state === 'roam' ? 0.35 : 0.15);
        desYaw = yawFromDirection(it.moveX, it.moveZ) + sweep;
        desPitch = Math.sin(t * 0.6 + this.scanPhase * 2) * 0.05;
        maxTurn = 4.2;
      } else {
        // idle: slow look-around
        desYaw = bot.yaw + Math.sin(t * 1.1 + this.scanPhase) * 0.6;
        maxTurn = 1.6;
      }
    }

    // turn-rate limited, smoothed controller (no jitter)
    const dYaw = wrapAngle(desYaw - bot.yaw);
    const dPitch = desPitch - bot.pitch;
    const wantYawVel = clamp(dYaw * TURN_GAIN, -maxTurn, maxTurn);
    const wantPitchVel = clamp(dPitch * TURN_GAIN, -maxTurn * 0.8, maxTurn * 0.8);
    const s = damp(TURN_SMOOTH, dt);
    this.yawVel += (wantYawVel - this.yawVel) * s;
    this.pitchVel += (wantPitchVel - this.pitchVel) * s;
    let stepYaw = this.yawVel * dt;
    if (Math.abs(stepYaw) > Math.abs(dYaw) && stepYaw * dYaw > 0) stepYaw = dYaw;
    let stepPitch = this.pitchVel * dt;
    if (Math.abs(stepPitch) > Math.abs(dPitch) && stepPitch * dPitch > 0) stepPitch = dPitch;
    bot.yaw = wrapAngle(bot.yaw + stepYaw);
    bot.pitch = clamp(bot.pitch + stepPitch, -1.35, 1.35);
  }

  // ------------------------------------------------------------------ firing

  updateFire(dt, t) {
    const bot = this.bot;
    const it = this.intent;
    const rec = this.targetRec;
    it.fire = false;
    if (bot.weaponId === 'gale' && this.considerReflect(t)) { it.fire = true; return; }
    if (!rec || !rec.visible || !rec.ent.alive || t < this.holdFireUntil) {
      this.burstLeft = 0;
      this.settle = 0;
      return;
    }
    if (bot.reloading && !(WEAPONS[bot.weaponId].reloadMode === 'shell' && bot.ammo > 0)) return;
    if (bot.ammo <= 0 || bot.equipping) return;
    const e = rec.ent;
    if (t - rec.seenSince < this.reactionFor(rec)) return;
    if (e.isProtected() && e.spawnProtectedUntil - t > 0.25) return;
    const def = WEAPONS[bot.weaponId];
    const wd = botWeaponDef(bot.weaponId);

    const eye = bot.getEyePosition(_eye);
    e.getChestPosition(_c);
    _dv.subVectors(_c, eye);
    const d = _dv.length();
    if (d < 0.1 || d > Math.min(def.range, wd.maxRange * 1.1)) return;
    if (d < wd.minRange * 0.75) return;
    _dv.multiplyScalar(1 / d);
    const aim = bot.getAimDirection(_fwd);
    const ang = Math.acos(clamp(_dv.dot(aim), -1, 1));
    let tol = (Math.atan(0.5 / d) + 0.014) * this.cfg.fireTol;
    if (def.pellets > 1) tol *= 2.2;
    if (def.kind === 'projectile') tol = Math.max(tol, 0.06) * 1.5;
    if (bot.charging) tol *= 2.5;           // a Javelin charge in progress is not dropped for a little aim wobble
    if (def.kind === 'beam') tol = Math.max(tol, 0.045) * 1.4;              // a continuous beam: keep it on through small wobbles
    if (def.kind === 'blast') tol = def.blast.halfAngle * 0.6;              // a wide cone: no need for pinpoint aim
    if (ang > tol) {
      this.settle = Math.max(0, this.settle - dt);
      return;
    }
    // sniper: let the reticle settle
    if (bot.weaponId === 'sniper' || bot.weaponId === 'rail') {
      this.settle += dt * (bot.speed < 1.5 ? 1 : 0.35);
      if (this.settle < wd.aimTime * (0.8 + this.cfg.reaction) && !bot.charging) return;
    } else {
      this.settle = Math.min(this.settle + dt, 2);
    }
    if (!this.fireLineClear(eye, _c, d, def, t)) return;
    if (this.burstLeft <= 0) {
      if (t < this.burstPauseUntil) return;
      this.burstLeft = Math.max(1, Math.round(wd.burst * this.cfg.burstScale * randRange(0.6, 1.4)));
    }
    it.fire = true;
  }

  /**
   * Gale: an incoming enemy rocket / grenade close by and roughly in front is blasted back (skill-gated stretch behaviour;
   * the bot has to be holding the Gale already, there is no time to switch).
   * @returns {boolean} true when the bot should fire now
   */
  considerReflect(t) {
    const bot = this.bot;
    if (bot.reloading || bot.ammo <= 0 || bot.equipping || t < (this._reflectAt || 0)) return false;
    const pj = this.game.projectiles;
    if (!pj) return false;
    const eye = bot.getEyePosition(_eye);
    const aim = bot.getAimDirection(_fwd);
    const skill = this.cfg.leadSkill * 0.6;
    const test = (p, owner, vel) => {
      if (!owner || owner === bot || owner.team === bot.team) return false;
      _tmp.subVectors(p, eye);
      const d = _tmp.length();
      if (d > 7.5 || d < 0.8) return false;
      _tmp.multiplyScalar(1 / d);
      if (_tmp.dot(aim) < 0.82) return false;                                  // not in front of us
      _av.copy(vel).normalize();
      return _av.dot(_tmp) < -0.7;                                              // and coming our way
    };
    let hit = false;
    for (const r of pj.rockets || []) if (r.active && test(r.position, r.owner, r.direction)) { hit = true; break; }
    if (!hit) for (const g of pj.grenades || []) if (g.active && g.velocity.lengthSq() > 4 && test(g.position, g.owner, g.velocity)) { hit = true; break; }
    if (!hit) return false;
    this._reflectAt = t + 0.35;
    return chance(skill);
  }

  /** Fresh line-of-fire test (keeps bots from shooting through walls / teammates / into their own splash). */
  fireLineClear(eye, target, dist, def, t) {
    if (t - this._lineAt < 0.06) return this._lineOk;
    this._lineAt = t;
    const game = this.game;
    const bot = this.bot;
    _av.subVectors(target, eye).normalize();
    let ok = !game.world.raycast(eye, _av, Math.max(0, dist - 0.3));
    if (ok) {
      // teammates standing in the line of fire soak the bullets
      const ents = game.entities;
      for (let i = 0; i < ents.length; i++) {
        const e = ents[i];
        if (e === bot || !e.alive || e.team !== bot.team) continue;
        e.getChestPosition(_tmp);
        _tmp.sub(eye);
        const along = _tmp.dot(_av);
        if (along < 1 || along > dist - 0.5) continue;
        if (_tmp.addScaledVector(_av, -along).lengthSq() < 0.36) {
          ok = false;
          break;
        }
      }
    }
    if (ok && def.kind === 'projectile') {
      // never launch a rocket that would detonate on top of us
      if (game.world.raycast(eye, _av, 4.5)) ok = false;
    }
    this._lineOk = ok;
    return ok;
  }
}

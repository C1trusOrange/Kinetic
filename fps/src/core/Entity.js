import * as THREE from 'three';
import { HUMANOID, SPAWN_PROTECTION } from './constants.js';
import { directionFromYawPitch } from './utils.js';

/**
 * Base class for everything that can be damaged, scores and respawns: the Player and every Bot.
 *
 * Position is the FEET position (bottom of the collision capsule), in meters, Y up.
 * yaw/pitch follow the convention in utils.js (yaw 0 looks down -Z, pitch > 0 looks up).
 */
export class Entity {
  constructor(game) {
    this.game = game;
    /** Assigned by game.addEntity(). */
    this.id = 0;
    this.name = 'Entity';
    /** In FFA team === id. In TDM 1 (blue) or 2 (red). */
    this.team = 0;
    /** Legacy alias of isLocal (true only for the Player instance). New code uses isLocal / isHuman / isBot. */
    this.isPlayer = false;
    this.isBot = false;
    /** The player of this machine (the Player instance). */
    this.isLocal = false;
    /** A human fighter: the local player, a RemotePlayer (host) or a human NetAvatar (client). */
    this.isHuman = false;
    /** Host only: a joined human (net/RemotePlayer.js). */
    this.isRemote = false;
    /** Client only: the stand-in for another machine's entity (net/NetAvatar.js). */
    this.isProxy = false;
    /** This machine integrates the entity's movement (false for RemotePlayer / NetAvatar). */
    this.simLocal = true;
    /** Relay peer id of the controlling human (0 = the host), -1 for bots and offline. */
    this.netPeer = -1;
    /** The host's own player (online). */
    this.netHost = false;
    /** Round trip to the host in ms (online humans). */
    this.ping = 0;
    /** False while a joined human's connection is lost (online). */
    this.connected = true;
    /** Online: held by a connection or deploy gate (no respawn, not targetable). */
    this.netHold = false;
    /** Accent color (scoreboard, kill feed, bot paint). */
    this.color = new THREE.Color(0xffffff);

    this.alive = false;
    this.maxHealth = 100;
    this.health = 100;
    this.maxArmor = 100;
    this.armor = 0;
    /** Debug / test flag: ignores all damage. */
    this.god = false;

    this.position = new THREE.Vector3();
    /**
     * Position the match rules use (pickups, kill plane, zones). The same object as `position` (never reassigned)
     * except on a RemotePlayer, where it is the last position its client reported.
     */
    this.authPos = this.position;
    this.velocity = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.radius = HUMANOID.radius;
    this.height = HUMANOID.height;             // current capsule height (changes when crouching)
    this.eyeHeight = HUMANOID.height - HUMANOID.eyeFromTop;
    this.onGround = false;

    // scoring
    this.kills = 0;
    this.deaths = 0;
    this.streak = 0;
    /** Escalation: index into the weapon ladder. King of the Hill: seconds spent alive inside the live zone. */
    this.tier = 0;
    this.zoneTime = 0;

    // bookkeeping (game.time based)
    this.respawnAt = -1;
    this.spawnProtectedUntil = 0;
    this.lastAttacker = null;
    this.lastDamageTime = -999;
    this.lastLaunchTime = -999;
    /** game.time until which the entity is shocked (Static grenade): slowed, worse aim, cannot fire. */
    this.shockedUntil = 0;

    this._hitboxes = [
      { type: 'sphere', part: 'head', center: new THREE.Vector3(), radius: 0.24 },
      { type: 'capsule', part: 'body', start: new THREE.Vector3(), end: new THREE.Vector3(), radius: 0.38 },
      { type: 'capsule', part: 'legs', start: new THREE.Vector3(), end: new THREE.Vector3(), radius: 0.3 },
    ];
  }

  /** World-space eye position. */
  getEyePosition(target = new THREE.Vector3()) {
    return target.set(this.position.x, this.position.y + this.eyeHeight, this.position.z);
  }

  /** World-space chest position (explosion / AI aim reference). */
  getChestPosition(target = new THREE.Vector3()) {
    return target.set(this.position.x, this.position.y + this.height * 0.62, this.position.z);
  }

  /** Unit aim direction from yaw/pitch. */
  getAimDirection(target = new THREE.Vector3()) {
    return directionFromYawPitch(this.yaw, this.pitch, target);
  }

  /**
   * Hitboxes in world space, recomputed on each call (reused objects - do not keep references).
   * Types: {type:'sphere', center, radius, part} | {type:'capsule', start, end, radius, part}.
   * Parts: 'head' (headshot multiplier), 'body', 'legs' (x0.8 damage).
   */
  getHitboxes() {
    const p = this.position, h = this.height;
    const [head, body, legs] = this._hitboxes;
    head.center.set(p.x, p.y + h - 0.22, p.z);
    body.start.set(p.x, p.y + h * 0.5, p.z);
    body.end.set(p.x, p.y + h - 0.55, p.z);
    legs.start.set(p.x, p.y + 0.3, p.z);
    legs.end.set(p.x, p.y + h * 0.5 - 0.05, p.z);
    return this._hitboxes;
  }

  /**
   * Apply damage (armor absorbs 60% until depleted). Returns health+armor actually removed.
   * Called only by Combat.applyDamage - do not call directly (Combat emits events and deaths).
   * @param {{amount:number, attacker:Entity|null, weapon:string}} info
   */
  takeDamage(info) {
    let amount = Math.max(0, info.amount);
    const absorbed = Math.min(this.armor, amount * 0.6);
    this.armor -= absorbed;
    const healthLoss = Math.min(this.health, amount - absorbed);
    this.health -= healthLoss;
    if (info.attacker && info.attacker !== this) this.lastAttacker = info.attacker;
    this.lastDamageTime = this.game.time;
    return absorbed + healthLoss;
  }

  /** Returns true if any health was restored (pickups are only consumed on true). */
  heal(amount) {
    if (!this.alive || this.health >= this.maxHealth) return false;
    this.health = Math.min(this.maxHealth, this.health + amount);
    return true;
  }

  addArmor(amount) {
    if (!this.alive || this.armor >= this.maxArmor) return false;
    this.armor = Math.min(this.maxArmor, this.armor + amount);
    return true;
  }

  /** Add velocity (explosion knockback etc). */
  applyImpulse(v) {
    this.velocity.add(v);
  }

  /** Replace velocity (jump pads). Subclasses should also suppress ground snapping briefly. */
  launch(v) {
    this.velocity.copy(v);
    this.onGround = false;
    this.lastLaunchTime = this.game.time;
  }

  // Inventory hooks used by pickups - overridden by Player / Bot. Return true if consumed.
  giveWeapon(/* weaponId */) { return false; }
  addAmmo(/* weaponId | null, fraction */) { return false; }
  addGrenades(/* count, type = 'frag' */) { return false; }

  /** Shock (stun) for `seconds` - stacks by extending, never shortens. */
  shock(seconds) {
    this.shockedUntil = Math.max(this.shockedUntil, this.game.time + seconds);
  }

  /** True while shocked by a Static grenade. */
  isShocked() {
    return this.game.time < this.shockedUntil;
  }

  /** True while spawn protection is active. */
  isProtected() {
    return this.game.time < this.spawnProtectedUntil;
  }

  /** End spawn protection now (this entity attacked: fired, threw a grenade or dealt damage). */
  breakSpawnProtection() {
    this.spawnProtectedUntil = 0;
  }

  /** (Re)spawn at a feet position facing yaw. Subclasses call super.spawn() first. */
  spawn(position, yaw = 0) {
    this.position.copy(position);
    this.velocity.set(0, 0, 0);
    this.yaw = yaw;
    this.pitch = 0;
    this.health = this.maxHealth;
    this.armor = 0;
    this.alive = true;
    this.onGround = false;
    this.respawnAt = -1;
    this.lastAttacker = null;
    this._shove = null;       // Gale shove tags (special/gale.js): a fresh life starts unshoved
    this._shovedBy = null;
    this.shockedUntil = 0;
    this.spawnProtectedUntil = this.game.time + SPAWN_PROTECTION;
  }

  /** Called by Combat.kill() after alive=false. Visuals/state only (scoring is done by Game). */
  onDeath(/* info */) {}

  /** Per-frame update (bots). The player is updated explicitly by Game. */
  update(/* dt */) {}
}

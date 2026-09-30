/**
 * Weapon definitions for KINETIC (shared by the player's WeaponSystem, bots, HUD and pickups).
 *
 * Field reference (see ARCHITECTURE.md 6.5):
 *   spread {hip, ads, moving, air, perShot, max, recovery}
 *       half-angle cone in radians. hip = standing still, moving = at full walk speed, air = airborne,
 *       ads = fully aimed. perShot is added to the "bloom" after each shot (capped so the total never
 *       exceeds `max`) and bloom decays by `recovery` radians per second.
 *   recoil {pitch, yaw, adsScale}  radians of aim kick per shot (yaw is randomised +-), adsScale multiplies it while aiming.
 *   falloff {start, end, min}      damage multiplier falls linearly from 1 to `min` between start..end meters.
 *   bot {minRange, maxRange, preferredRange, burst, burstPause, aimTime}  hints for the AI.
 *
 * Extra (optional) tuning fields used by the player's viewmodel: `flash`, `view` {kick, eject, shake}, plus timing fields
 * `cycleDelay` / `cycleTime` (pump & bolt), `reloadStart` / `shellTime` / `reloadEnd` (shell reloads),
 * `reloadEmptyExtra` (extra seconds when the magazine is empty), `scoped` (full scope overlay).
 * Special mechanics: `speedBonus {from, to, damage, spread, rate, tracerHot}` (Slipstream: horizontal speed scales damage,
 * spread and fire rate, see weapons/special/smg.js) and `charge {time, minFrac, minDamage, auto, holdLimit, fovSqueeze}` +
 * `pierce {entities, entityFalloff, wall}` (Javelin: hold to charge, release for a piercing beam, see weapons/special/rail.js).
 */

import { WEAPON_IDS } from '../core/constants.js';

/** Weapon ids in ascending slot order (single source of truth: constants.WEAPON_IDS). Key = `weapon${WEAPONS[id].slot}`. */
export const WEAPON_ORDER = WEAPON_IDS.slice();

export const WEAPONS = {
  pistol: {
    id: 'pistol',
    name: 'P-9 Viper',
    slot: 1,
    kind: 'hitscan',
    auto: false,
    damage: 30,
    headshotMult: 2,
    pellets: 1,
    fireRate: 5.2,
    magSize: 12,
    reserveMax: Infinity,
    reserveStart: Infinity,
    reloadTime: 1.3,
    reloadEmptyExtra: 0.2,
    reloadMode: 'mag',
    spread: { hip: 0.0085, ads: 0.0012, moving: 0.016, air: 0.03, perShot: 0.0075, max: 0.05, recovery: 0.075 },
    recoil: { pitch: 0.017, yaw: 0.004, adsScale: 0.7 },
    falloff: { start: 22, end: 65, min: 0.6 },
    range: 250,
    adsZoom: 0.84,
    adsSensitivity: 0.85,
    adsTime: 0.12,
    equipTime: 0.26,
    tracerColor: 0xffe9a8,
    sound: 'pistol_fire',
    projectile: null,
    bot: { minRange: 0, maxRange: 48, preferredRange: 20, burst: 2, burstPause: 0.32, aimTime: 0.28 },
    flash: { size: 0.17, light: 2.6, color: 0xffc27a, time: 0.05 },
    view: { kick: 1.0, eject: 'brass', shake: 0.03 },
  },

  rifle: {
    id: 'rifle',
    name: 'AR-7 Pulse',
    slot: 2,
    kind: 'hitscan',
    auto: true,
    damage: 16,
    headshotMult: 2,
    pellets: 1,
    fireRate: 11,
    magSize: 32,
    reserveMax: 224,
    reserveStart: 96,
    reloadTime: 1.9,
    reloadEmptyExtra: 0.3,
    reloadMode: 'mag',
    spread: { hip: 0.0125, ads: 0.0022, moving: 0.022, air: 0.038, perShot: 0.0034, max: 0.055, recovery: 0.02 },
    recoil: { pitch: 0.0095, yaw: 0.0034, adsScale: 0.62 },
    falloff: { start: 20, end: 60, min: 0.55 },
    range: 250,
    adsZoom: 0.78,
    adsSensitivity: 0.78,
    adsTime: 0.16,
    equipTime: 0.34,
    tracerColor: 0x8feaff,
    sound: 'rifle_fire',
    projectile: null,
    bot: { minRange: 0, maxRange: 60, preferredRange: 24, burst: 6, burstPause: 0.4, aimTime: 0.32 },
    flash: { size: 0.22, light: 3.0, color: 0x9fe8ff, time: 0.045 },
    view: { kick: 0.8, eject: 'brass', shake: 0.05 },
  },

  shotgun: {
    id: 'shotgun',
    name: 'Breacher 12',
    slot: 3,
    kind: 'hitscan',
    auto: false,
    damage: 11,
    headshotMult: 1.5,
    pellets: 9,
    fireRate: 1.15,
    magSize: 6,
    reserveMax: 36,
    reserveStart: 18,
    reloadTime: 3.4,
    reloadMode: 'shell',
    reloadStart: 0.42,
    shellTime: 0.46,
    reloadEnd: 0.34,
    cycleDelay: 0.16,
    cycleTime: 0.5,
    spread: { hip: 0.055, ads: 0.038, moving: 0.065, air: 0.085, perShot: 0.0, max: 0.09, recovery: 0.2 },
    recoil: { pitch: 0.07, yaw: 0.012, adsScale: 0.75 },
    falloff: { start: 5, end: 22, min: 0.12 },
    range: 60,
    adsZoom: 0.9,
    adsSensitivity: 0.9,
    adsTime: 0.18,
    equipTime: 0.42,
    tracerColor: 0xffc890,
    sound: 'shotgun_fire',
    projectile: null,
    bot: { minRange: 0, maxRange: 17, preferredRange: 6, burst: 1, burstPause: 0.45, aimTime: 0.36 },
    flash: { size: 0.36, light: 4.2, color: 0xffb060, time: 0.06 },
    view: { kick: 1.5, eject: 'shell', shake: 0.24 },
  },

  sniper: {
    id: 'sniper',
    name: 'Longbow',
    slot: 4,
    kind: 'hitscan',
    auto: false,
    damage: 100,
    headshotMult: 2.5,
    pellets: 1,
    fireRate: 0.95,
    magSize: 5,
    reserveMax: 25,
    reserveStart: 10,
    reloadTime: 2.8,
    reloadEmptyExtra: 0.0,
    reloadMode: 'mag',
    cycleDelay: 0.32,
    cycleTime: 0.58,
    scoped: true,
    spread: { hip: 0.045, ads: 0.0002, moving: 0.07, air: 0.11, perShot: 0.02, max: 0.12, recovery: 0.12 },
    recoil: { pitch: 0.055, yaw: 0.008, adsScale: 0.5 },
    falloff: null,
    range: 600,
    adsZoom: 0.27,
    adsSensitivity: 0.3,
    adsTime: 0.24,
    equipTime: 0.5,
    tracerColor: 0xb8f0ff,
    sound: 'sniper_fire',
    projectile: null,
    bot: { minRange: 20, maxRange: 130, preferredRange: 55, burst: 1, burstPause: 0.9, aimTime: 0.65 },
    flash: { size: 0.3, light: 3.8, color: 0xb8e8ff, time: 0.06 },
    view: { kick: 1.6, eject: 'brass', shake: 0.3 },
  },

  rocket: {
    id: 'rocket',
    name: 'Hammer',
    slot: 5,
    kind: 'projectile',
    auto: false,
    damage: 105,
    headshotMult: 1,
    pellets: 1,
    fireRate: 1.1,
    magSize: 4,
    reserveMax: 16,
    reserveStart: 8,
    reloadTime: 2.9,
    reloadEmptyExtra: 0.0,
    reloadMode: 'mag',
    spread: { hip: 0.004, ads: 0.0015, moving: 0.008, air: 0.012, perShot: 0.0, max: 0.02, recovery: 0.1 },
    recoil: { pitch: 0.05, yaw: 0.008, adsScale: 0.7 },
    falloff: null,
    range: 300,
    adsZoom: 0.88,
    adsSensitivity: 0.85,
    adsTime: 0.2,
    equipTime: 0.5,
    tracerColor: 0xffb060,
    sound: 'rocket_fire',
    projectile: { speed: 42, splashRadius: 4.8, splashDamage: 95, knockback: 15, selfScale: 0.35 },
    bot: { minRange: 6, maxRange: 65, preferredRange: 22, burst: 1, burstPause: 0.55, aimTime: 0.42 },
    flash: { size: 0.46, light: 5.0, color: 0xff9a4a, time: 0.07 },
    view: { kick: 1.9, eject: null, shake: 0.38 },
  },

  smg: {
    id: 'smg',
    name: 'VX-3 Slipstream',
    slot: 6,
    kind: 'hitscan',
    auto: true,
    damage: 10,
    headshotMult: 1.75,
    pellets: 1,
    fireRate: 16,
    magSize: 36,
    reserveMax: 216,
    reserveStart: 108,
    reloadTime: 1.5,
    reloadEmptyExtra: 0.25,
    reloadMode: 'mag',
    spread: { hip: 0.014, ads: 0.006, moving: 0.016, air: 0.016, perShot: 0.0026, max: 0.05, recovery: 0.03 },
    recoil: { pitch: 0.0045, yaw: 0.003, adsScale: 0.85 },
    falloff: { start: 11, end: 34, min: 0.5 },
    range: 120,
    adsZoom: 0.92,
    adsSensitivity: 0.92,
    adsTime: 0.1,
    equipTime: 0.22,
    tracerColor: 0xffcf3a,
    sound: 'smg_fire',
    projectile: null,
    // momentum: b = clamp((speed - from) / (to - from), 0, 1); damage x(1 + damage*b), spread x(1 - spread*b), rate x(1 + rate*b)
    speedBonus: { from: 7, to: 12, damage: 0.4, spread: 0.55, rate: 0.15, tracerHot: 0xffffff },
    bot: { minRange: 0, maxRange: 32, preferredRange: 14, burst: 9, burstPause: 0.28, aimTime: 0.26 },
    flash: { size: 0.18, light: 2.8, color: 0xffc060, time: 0.04 },
    view: { kick: 0.55, eject: 'brass', shake: 0.03 },
  },

  rail: {
    id: 'rail',
    name: 'Javelin',
    slot: 8,
    kind: 'hitscan',
    auto: false,
    damage: 130,                // at full charge
    headshotMult: 1.6,
    pellets: 1,
    fireRate: 0.8,              // post-shot cooldown 1.25 s
    magSize: 4,
    reserveMax: 16,
    reserveStart: 8,
    reloadTime: 2.7,
    reloadEmptyExtra: 0.2,
    reloadMode: 'mag',
    // hold fire to charge (`time` s to 100%), release to shoot; below `minFrac` the release cancels (no ammo spent).
    // dmg = minDamage + (damage - minDamage) * power^1.2; `auto` = fires by itself at 100%; `holdLimit` seconds max hold at 100%
    charge: { time: 0.7, minFrac: 0.4, minDamage: 34, auto: true, holdLimit: 1.2, fovSqueeze: 0.06 },
    // the beam continues through up to `entities` targets (each x entityFalloff) and `wall` metres of thin cover (full charge only)
    pierce: { entities: 3, entityFalloff: 0.8, wall: 0.9 },
    spread: { hip: 0.012, ads: 0.0005, moving: 0.03, air: 0.05, perShot: 0.03, max: 0.06, recovery: 0.15 },
    recoil: { pitch: 0.085, yaw: 0.01, adsScale: 0.6 },
    falloff: null,
    range: 400,
    adsZoom: 0.6,
    adsSensitivity: 0.55,
    adsTime: 0.2,
    equipTime: 0.55,
    tracerColor: 0xc8f4ff,
    sound: 'rail_fire',
    chargeSound: 'rail_charge',
    projectile: null,
    bot: { minRange: 10, maxRange: 120, preferredRange: 42, burst: 1, burstPause: 0.9, aimTime: 0.55, charge: 0.95 },
    flash: { size: 0.55, light: 6.0, color: 0xbfeaff, time: 0.09 },
    view: { kick: 2.0, eject: null, shake: 0.5 },
  },

  // ---- Tempest: continuous chain-lightning beam (kind 'beam': one tick per 1/fireRate while the trigger is held)
  arc: {
    id: 'arc',
    name: 'Tempest',
    slot: 7,
    kind: 'beam',
    auto: true,
    damage: 4.4,
    headshotMult: 1,
    pellets: 1,
    fireRate: 24,
    magSize: 90,
    reserveMax: 270,
    reserveStart: 90,
    reloadTime: 2.4,
    reloadEmptyExtra: 0.3,
    reloadMode: 'mag',
    spread: { hip: 0.006, ads: 0.003, moving: 0.012, air: 0.02, perShot: 0, max: 0.03, recovery: 0.1 },
    recoil: { pitch: 0.0006, yaw: 0.0016, adsScale: 0.8 },     // a beam must not climb off its target: tiny pitch, jitter in yaw
    falloff: { start: 14, end: 24, min: 0.55 },
    range: 26,
    beam: { chainRadius: 6.5, chainMax: 2, chainScale: 0.55, color: 0x7fe3ff, core: 0xffffff, width: 0.085, jitter: 0.2, eventInterval: 0.5 },
    adsZoom: 0.92,
    adsSensitivity: 0.9,
    adsTime: 0.12,
    equipTime: 0.4,
    tracerColor: 0x9fe8ff,
    sound: 'arc_start',
    loop: 'arc_loop',
    projectile: null,
    bot: { minRange: 0, maxRange: 20, preferredRange: 9, burst: 24, burstPause: 0.55, aimTime: 0.26 },
    flash: { size: 0.16, light: 2.2, color: 0x8fe8ff, time: 0.04 },
    view: { kick: 0.25, eject: null, shake: 0.06 },
  },

  // ---- Gale: repulsor cone (kind 'blast'): shoves enemies, reflects rockets / grenades, pushes the shooter off surfaces
  gale: {
    id: 'gale',
    name: 'Gale',
    slot: 9,
    kind: 'blast',
    auto: false,
    damage: 42,
    headshotMult: 1,
    pellets: 1,
    fireRate: 1.15,
    magSize: 5,
    reserveMax: 20,
    reserveStart: 10,
    reloadTime: 2.3,
    reloadEmptyExtra: 0.3,
    reloadMode: 'mag',
    spread: { hip: 0, ads: 0, moving: 0, air: 0, perShot: 0, max: 0, recovery: 1 },
    recoil: { pitch: 0.06, yaw: 0.006, adsScale: 0.7 },
    falloff: null,
    range: 12,
    adsZoom: 0.95,
    adsSensitivity: 0.95,
    adsTime: 0.14,
    equipTime: 0.4,
    tracerColor: 0xbfeaff,
    sound: 'gale_fire',
    projectile: null,
    blast: {
      range: 12, halfAngle: 0.60, adsHalfAngle: 0.28, adsRange: 16, damage: 42, damageMin: 10, push: 21, pushMin: 0.45, lift: 4.5,
      reflect: true, reflectRadius: 1.2, reflectSpeedMul: 1.1, selfRange: 6.5, selfPush: 11, selfLift: 0.35, noSurfacePush: 2,
      splat: true, splatDrop: 8, splatPerMs: 3.2, splatMax: 40,
    },
    bot: { minRange: 0, maxRange: 10, preferredRange: 5, burst: 1, burstPause: 0.7, aimTime: 0.3 },
    flash: { size: 0.5, light: 4.2, color: 0xbfeaff, time: 0.06 },
    view: { kick: 1.7, eject: null, shake: 0.32 },
  },
};

/** Frag grenade tuning (`selfScale` = fraction of damage the thrower takes). */
export const GRENADE = { damage: 120, radius: 6.5, fuse: 2.6, throwSpeed: 19, knockback: 14, maxCarry: 4, start: 2, cookable: true, selfScale: 0.5 };

/**
 * Grenade types (frag stays `GRENADE`). `key` in the type table is not an input action: G throws the selected type,
 * X cycles (see WeaponSystem). `start` is the guaranteed spawn count; specials are dealt by GrenadeTypes.spawnLoadout.
 */
export const GRENADE_TYPES = {
  frag: Object.assign(GRENADE, { id: 'frag', name: 'Frag Grenade', short: 'FRAG', color: 0xff9a3c, danger: GRENADE.radius + 1 }),
  vortex: {
    id: 'vortex', name: 'Vortex Grenade', short: 'VORTEX', color: 0xb26bff,
    fuse: 2.5, cookable: false, throwSpeed: 18, maxCarry: 2, start: 0, stick: true, deploy: 0.22, duration: 3.4,
    radius: 9.5, pull: 26, maxPullSpeed: 14, lift: { radius: 5.7, impulseY: 1.6, every: 0.3 },
    crush: { radius: 2.4, dps: 30 }, collapse: { radius: 6.5, damage: 90, knockback: 20 }, selfScale: 0.6, danger: 11,
  },
  static: {
    id: 'static', name: 'Static Grenade', short: 'STATIC', color: 0x5cf2ff,
    fuse: 1.7, cookable: true, throwSpeed: 20, maxCarry: 3, start: 0, radius: 11, arcs: 8, arcDamage: 34,
    shock: 1.1, knockback: 4, selfScale: 0.5, selfShock: 0.5, danger: 8,
  },
  kinetic: {
    id: 'kinetic', name: 'Kinetic Charge', short: 'KINETIC', color: 0x62ff9a,
    fuse: 2.0, cookable: true, throwSpeed: 19, maxCarry: 2, start: 0, radius: 7.5, damage: 14, knockback: 20,
    selfKnock: 0.7, selfScale: 0.2, splat: true, splatMax: 40, danger: 5, pinSound: 'charge_arm',
  },
  smoke: {
    id: 'smoke', name: 'Smoke Screen', short: 'SMOKE', color: 0xd0d8e0,
    fuse: 3.0, cookable: false, throwSpeed: 17, maxCarry: 2, start: 1, radius: 4.6, duration: 9, popDelay: 0.6,
    damage: 0, knockback: 0, danger: 0,
  },
};

/** Grenade type ids in HUD / cycling order. */
export const GRENADE_ORDER = ['frag', 'vortex', 'static', 'kinetic', 'smoke'];
/** Types dealt out at random by crates and spawn loadouts. */
export const GRENADE_SPECIALS = ['vortex', 'static', 'kinetic', 'smoke'];

/** Melee bash tuning. */
export const MELEE = { damage: 55, range: 2.2, cooldown: 0.65 };

const EXTRA_NAMES = {
  grenade: 'Frag Grenade', melee: 'Melee', fall: 'Gravity', explosion: 'Explosion', splat: 'Splat', ringout: 'Ring-out',
  vortex: 'Vortex Grenade', static: 'Static Grenade', kinetic: 'Kinetic Charge', smoke: 'Smoke Screen',
};

/**
 * Display name for any weapon id (including 'grenade', 'melee', 'fall', 'explosion').
 * @param {string} id
 * @returns {string}
 */
export function weaponName(id) {
  return (WEAPONS[id] && WEAPONS[id].name) || EXTRA_NAMES[id] || String(id);
}

/** Stratos storm strikes (attacker-less lightning damage). */
EXTRA_NAMES.lightning = 'Storm Strike';

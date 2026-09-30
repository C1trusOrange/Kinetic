import { WEAPONS, WEAPON_ORDER } from '../weapons/WeaponDefs.js';

/**
 * Shared AI tuning: locomotion constants, difficulty presets and weapon behaviour hints.
 * Kept in one place so Bot, BotBrain and BotManager agree on numbers.
 */

/** Locomotion tuning (m/s, m/s^2, 1/s). Player reference: walk 6.2, sprint 9.6, jump 8.0. */
export const MOVE = {
  run: 7.2,            // roaming / chasing
  strafe: 5.0,         // combat strafing
  sprint: 8.7,         // retreating / grabbing pickups / dodging grenades
  crouch: 3.0,
  jump: 8.0,           // jump velocity (~1.33 m apex at GRAVITY 24)
  groundAccel: 11,     // exponential approach rate toward the wish velocity
  airAccel: 28,        // m/s^2 of steering added in the air (never brakes a launch)
  terminal: 55,
  stride: 2.2,         // meters per footstep sound
  radius: 0.4,
};

/**
 * Difficulty presets. Human-like aim is built from:
 *   reaction   seconds between first seeing a target and pulling the trigger
 *   fov        vision cone (degrees, full angle)
 *   turnSpeed  max aim turn rate (rad/s)
 *   aimError   1-sigma angular aim error (rad) before shrink/scale
 *   errorShrink fraction the error shrinks after ~2 s of continuous tracking
 *   trackRate  how fast the aim point follows a moving target (1/s) - low = lag on strafing targets
 *   leadSkill  0..1 accuracy of projectile leading and of compensating the aim's own tracking lag
 *   pauseScale multiplier on the weapon's burst pause
 *   grenadeSlack seconds added to a grenade's flight time as fuse (timing sloppiness; 0 = airburst on arrival)
 */
export const DIFFICULTY_PRESETS = {
  easy: {
    reaction: 0.75, fov: 100, turnSpeed: 4.0, aimError: 0.05, errorShrink: 0.25, trackRate: 5, leadSkill: 0.35, pauseScale: 1.6,
    strafe: 0.45, flip: [1.0, 2.4], jumpiness: 0.02, crouchiness: 0.04, grenadeRate: 0.12, grenadeCooldown: 22, grenadeSlack: 0.7,
    memory: 4, hearRange: 26, damageScale: 0.7, speedScale: 0.88, retreatHealth: 40, aimHeight: 0.56,
    coverUse: 0.15, aggression: 0.45, fireTol: 1.5, spreadScale: 1.3, burstScale: 0.8, grenades: 1,
  },
  normal: {
    reaction: 0.45, fov: 120, turnSpeed: 7.0, aimError: 0.034, errorShrink: 0.4, trackRate: 9, leadSkill: 0.7, pauseScale: 0.85,
    strafe: 0.75, flip: [0.7, 1.8], jumpiness: 0.05, crouchiness: 0.07, grenadeRate: 0.3, grenadeCooldown: 14, grenadeSlack: 0.3,
    memory: 7, hearRange: 36, damageScale: 0.85, speedScale: 1.0, retreatHealth: 33, aimHeight: 0.62,
    coverUse: 0.4, aggression: 0.7, fireTol: 1.15, spreadScale: 1.0, burstScale: 1.35, grenades: 2,
  },
  hard: {
    reaction: 0.3, fov: 140, turnSpeed: 10.5, aimError: 0.02, errorShrink: 0.5, trackRate: 14, leadSkill: 0.88, pauseScale: 0.7,
    strafe: 0.9, flip: [0.55, 1.5], jumpiness: 0.09, crouchiness: 0.1, grenadeRate: 0.5, grenadeCooldown: 10, grenadeSlack: 0.15,
    memory: 10, hearRange: 42, damageScale: 1.0, speedScale: 1.04, retreatHealth: 27, aimHeight: 0.68,
    coverUse: 0.6, aggression: 0.85, fireTol: 1.0, spreadScale: 0.85, burstScale: 1.6, grenades: 2,
  },
  insane: {
    reaction: 0.18, fov: 160, turnSpeed: 15.0, aimError: 0.01, errorShrink: 0.55, trackRate: 24, leadSkill: 1.0, pauseScale: 0.55,
    strafe: 1.0, flip: [0.4, 1.2], jumpiness: 0.14, crouchiness: 0.12, grenadeRate: 0.7, grenadeCooldown: 7, grenadeSlack: 0.05,
    memory: 14, hearRange: 50, damageScale: 1.1, speedScale: 1.08, retreatHealth: 22, aimHeight: 0.72,
    coverUse: 0.8, aggression: 1.0, fireTol: 0.9, spreadScale: 0.7, burstScale: 2.0, grenades: 3,
  },
};

/** @returns {object} a copy of the preset for `name` (falls back to normal). */
export function getPreset(name) {
  return { ...(DIFFICULTY_PRESETS[name] || DIFFICULTY_PRESETS.normal) };
}

/**
 * Legacy (pre-arsenal) spawn weights, kept for reference. The bot spawn mix is now configurable
 * ("Bot arsenal" match option, see below); the "Classic" preset is the closest level-based match.
 */
export const WEAPON_WEIGHTS = { pistol: 0.1, rifle: 0.34, shotgun: 0.22, sniper: 0.14, rocket: 0.2 };

// ------------------------------------------------------------------------------------ bot arsenal
// "Bot arsenal" = how often each weapon is a bot's primary when it (re)spawns, plus how eager bots
// are to walk to that weapon's pad. Stored in settings as { weaponId: level } (levels are strings so
// the saved value stays readable and survives retuning of the weights below).

/** Weapons whose spawn frequency can be configured (every bot always carries the pistol as a sidearm). */
export const ARSENAL_IDS = WEAPON_ORDER.slice();

/**
 * Default spawn-frequency level of the weapons added after the original five (used wherever DEFAULT_ARSENAL has no entry, so
 * saved settings / presets written before a weapon existed still get a sensible value).
 */
export const WEAPON_DEFAULT_LEVEL = { smg: 'normal', rail: 'rare', arc: 'rare', gale: 'rare' };

/** Spawn-frequency levels, least to most frequent. */
export const ARSENAL_LEVELS = ['off', 'rare', 'normal', 'common'];

/** Relative spawn weight of a level (a weapon's share = its weight / sum of all weights). */
export const ARSENAL_WEIGHT = { off: 0, rare: 0.4, normal: 1, common: 2 };

/** How much bots want a weapon pad of that level (multiplies WEAPON_PICKUP_VALUE; 0 = never collect). */
export const ARSENAL_PAD_DESIRE = { off: 0, rare: 0.3, normal: 1, common: 1.15 };

/** Balanced default: rockets are a rarity, the rifle is the workhorse (~8% / 42% / 21% / 21% / 8%). */
export const DEFAULT_ARSENAL = Object.freeze({ pistol: 'rare', rifle: 'common', shotgun: 'normal', sniper: 'normal', rocket: 'rare', arc: 'rare', gale: 'rare' });

/** One-click arsenal presets shown in the menu (`arsenal` values are level maps). */
export const ARSENAL_PRESETS = Object.freeze([
  { id: 'balanced', name: 'Balanced', info: 'Rockets are rare', arsenal: DEFAULT_ARSENAL },
  { id: 'norockets', name: 'No rockets', info: 'No launchers, ever', arsenal: Object.freeze({ pistol: 'rare', rifle: 'common', shotgun: 'normal', sniper: 'normal', rocket: 'off' }) },
  { id: 'classic', name: 'Classic', info: 'Near the original mix', arsenal: Object.freeze({ pistol: 'rare', rifle: 'common', shotgun: 'normal', sniper: 'normal', rocket: 'normal' }) },
  { id: 'chaos', name: 'Chaos', info: 'Rockets and shotguns everywhere', arsenal: Object.freeze({ pistol: 'off', rifle: 'normal', shotgun: 'common', sniper: 'rare', rocket: 'common' }) },
]);

/**
 * Level for one raw value: a level name (any case), or a finite weight >= 0 (0 = off, anything above
 * snaps to the nearest of rare / normal / common, so a tiny non-zero weight never silently disables a weapon).
 */
function toArsenalLevel(v, fallback) {
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    return Object.hasOwn(ARSENAL_WEIGHT, s) ? s : fallback;
  }
  if (typeof v === 'number' && Number.isFinite(v) && v >= 0) {
    if (v === 0) return 'off';
    let best = 'rare';
    let bd = Infinity;
    for (const lv of ARSENAL_LEVELS) {
      if (lv === 'off') continue;
      const d = Math.abs(ARSENAL_WEIGHT[lv] - v);
      if (d < bd) { bd = d; best = lv; }
    }
    return best;
  }
  return fallback;
}

/**
 * Defensive normaliser for anything that claims to be an arsenal (saved settings, URL params, old
 * versions). Always returns a fresh, complete `{ pistol, rifle, shotgun, sniper, rocket }` map of levels:
 * unknown ids are dropped, missing / invalid / NaN / negative entries fall back to the default level
 * of that weapon. An all-'off' arsenal is valid (bots then only ever spawn with the pistol).
 * @param {*} input
 * @returns {Record<string,string>}
 */
export function sanitizeArsenal(input) {
  const src = input && typeof input === 'object' && !Array.isArray(input) ? input : null;
  const out = {};
  for (const id of ARSENAL_IDS) {
    const dflt = DEFAULT_ARSENAL[id] ?? WEAPON_DEFAULT_LEVEL[id] ?? 'normal';
    out[id] = src && Object.hasOwn(src, id) ? toArsenalLevel(src[id], dflt) : dflt;
  }
  return out;
}

/** @returns {boolean} true when two arsenals are identical after normalisation. */
export function arsenalEquals(a, b) {
  const x = sanitizeArsenal(a);
  const y = sanitizeArsenal(b);
  for (const id of ARSENAL_IDS) if (x[id] !== y[id]) return false;
  return true;
}

/** @returns {object|null} the preset whose levels match this arsenal exactly, or null ("custom"). */
export function matchArsenalPreset(arsenal) {
  for (const p of ARSENAL_PRESETS) if (arsenalEquals(p.arsenal, arsenal)) return p;
  return null;
}

/**
 * Spawn probability of each weapon (sums to 1). All 'off' -> the pistol gets 1 (it is the fallback).
 * @param {*} arsenal
 * @returns {Record<string,number>}
 */
export function arsenalShares(arsenal) {
  const a = sanitizeArsenal(arsenal);
  let total = 0;
  for (const id of ARSENAL_IDS) total += ARSENAL_WEIGHT[a[id]];
  const out = {};
  for (const id of ARSENAL_IDS) out[id] = total > 0 ? ARSENAL_WEIGHT[a[id]] / total : (id === 'pistol' ? 1 : 0);
  return out;
}

/**
 * The spawn shares as whole percentages that add up to exactly 100 (largest-remainder rounding).
 * @param {*} arsenal
 * @returns {Record<string,number>}
 */
export function arsenalPercents(arsenal) {
  const sh = arsenalShares(arsenal);
  const out = {};
  const rem = [];
  let sum = 0;
  for (const id of ARSENAL_IDS) {
    const raw = sh[id] * 100;
    out[id] = Math.floor(raw + 1e-9);
    sum += out[id];
    rem.push({ id, frac: raw - out[id] });
  }
  rem.sort((p, q) => q.frac - p.frac);
  for (let i = 0; sum < 100 && i < rem.length; i++, sum++) out[rem[i].id]++;
  return out;
}

/**
 * Weighted-random primary weapon for a spawning bot.
 * @param {*} arsenal level map (sanitised here)
 * @param {number} [roll] uniform [0,1) sample (default Math.random(); exposed for tests)
 * @returns {string} weapon id; 'pistol' when every weapon is off
 */
export function pickArsenalWeapon(arsenal, roll = Math.random()) {
  const a = sanitizeArsenal(arsenal);
  let total = 0;
  for (const id of ARSENAL_IDS) total += ARSENAL_WEIGHT[a[id]];
  if (!(total > 0)) return 'pistol';
  let r = roll * total;
  let last = 'pistol';
  for (const id of ARSENAL_IDS) {
    const w = ARSENAL_WEIGHT[a[id]];
    if (w <= 0) continue;
    last = id;
    r -= w;
    if (r < 0) return id;
  }
  return last;
}

/**
 * The arsenal that applies to the running match: `game.match.arsenal` (frozen at match start) when
 * present, else the saved setting, else the default. Always normalised.
 * @param {object} game
 * @returns {Record<string,string>}
 */
export function resolveArsenal(game) {
  const m = game && game.match;
  if (m && m.arsenal !== undefined) return sanitizeArsenal(m.arsenal);
  return sanitizeArsenal(game && game.settings ? game.settings.get('botArsenal') : undefined);
}

/**
 * Multiplier on a weapon pad's pickup value for a bot with this (normalised) arsenal: 0 for weapons
 * that are switched off, < 1 for rare ones. Weapons outside the arsenal (unknown ids) are unaffected.
 */
export function padDesire(arsenal, id) {
  const lv = arsenal && arsenal[id];
  return lv === undefined ? 1 : (ARSENAL_PAD_DESIRE[lv] ?? 1);
}

/** Rough "how much do I want this" per weapon (independent of range). */
export const WEAPON_POWER = { pistol: 0.3, rifle: 0.75, shotgun: 0.8, sniper: 0.8, rocket: 0.9, arc: 0.85, gale: 0.6 };

/** Pickup value of weapon pads (when the weapon is not owned yet). */
export const WEAPON_PICKUP_VALUE = { pistol: 0, rifle: 0.75, shotgun: 0.7, sniper: 0.8, rocket: 1.1, arc: 0.85, gale: 0.6 };

// Slipstream and Javelin (added separately from the literals above so each weapon agent can extend the tables on its own)
Object.assign(WEAPON_POWER, { smg: 0.72, rail: 0.95 });
Object.assign(WEAPON_PICKUP_VALUE, { smg: 0.7, rail: 1.0 });

const BOT_DEFAULTS = {
  pistol: { minRange: 0, maxRange: 45, preferredRange: 18, burst: 2, burstPause: 0.32, aimTime: 0.25 },
  rifle: { minRange: 0, maxRange: 60, preferredRange: 22, burst: 6, burstPause: 0.4, aimTime: 0.3 },
  shotgun: { minRange: 0, maxRange: 16, preferredRange: 6, burst: 1, burstPause: 0.45, aimTime: 0.3 },
  sniper: { minRange: 18, maxRange: 120, preferredRange: 50, burst: 1, burstPause: 0.9, aimTime: 0.6 },
  rocket: { minRange: 6, maxRange: 60, preferredRange: 22, burst: 1, burstPause: 0.55, aimTime: 0.4 },
  arc: { minRange: 0, maxRange: 20, preferredRange: 9, burst: 24, burstPause: 0.55, aimTime: 0.26 },
  gale: { minRange: 0, maxRange: 10, preferredRange: 5, burst: 1, burstPause: 0.7, aimTime: 0.3 },
};

const _botDefCache = {};

/**
 * Bot behaviour hints for a weapon: the def's `bot` block merged over sane defaults.
 * @param {string} id weapon id
 * @returns {{minRange:number,maxRange:number,preferredRange:number,burst:number,burstPause:number,aimTime:number}}
 */
export function botWeaponDef(id) {
  let c = _botDefCache[id];
  if (!c) {
    const def = WEAPONS[id];
    c = _botDefCache[id] = { ...(BOT_DEFAULTS[id] || BOT_DEFAULTS.rifle), ...((def && def.bot) || {}) };
  }
  return c;
}

/** Standard normal random (Box-Muller). */
export function gauss() {
  let u = 0;
  while (u === 0) u = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(6.283185307179586 * Math.random());
}

/** Position of a nav node / vector / node index, or null. */
export function asPos(nav, x) {
  if (!x) return null;
  if (x.isVector3) return x;
  if (x.position && x.position.isVector3) return x.position;
  if (typeof x === 'number' && nav && nav.nodes && nav.nodes[x]) return nav.nodes[x].position;
  return null;
}

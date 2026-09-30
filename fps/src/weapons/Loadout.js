/**
 * Spawn loadouts: which weapons a human spawns with. Pure data + sanitisers; imports only WeaponDefs (Settings, Menu,
 * Game and Modes import it, so it must not pull in three.js or any subsystem).
 *
 *   pool      MATCH RULE set by the host: { weapons, slots, ammo, grenades }
 *               weapons   allowed weapon ids (slot order, never empty)
 *               slots     max weapons per loadout, 1..9
 *               ammo      'standard' (magazine + reserveStart) | 'full' (magazine + reserveMax)
 *               grenades  'standard' (frag 2 + smoke 1 + one random special) | 'frag' (frags only) | 'none'
 *             Saved as settings.loadoutPool; frozen into game.match.pool by Game._startMatch (plain JSON, so a
 *             multiplayer host can send it to its clients as-is; Restart / Play again replay it).
 *   pick      ONE PLAYER's choice: { weapons, primary }
 *               weapons   ids in the player's order (the order is the priority when a pool has fewer slots)
 *               primary   the weapon drawn at spawn
 *             The local player's pick is settings.playerLoadout; `entity.loadoutPick` overrides it for that entity
 *             (remote humans in multiplayer, the autotest's loadout= URL param).
 *   resolved  what a spawn applies: resolveLoadout(pool, pick) -> { weapons, primary, secondary, ammo, grenades }
 *               weapons   owned at spawn (pick order, 1..pool.slots, all allowed by the pool)
 *               primary   drawn at spawn (one of weapons)
 *               secondary target of Q (last weapon) until the first switch
 *
 * Every function sanitises its input (unknown ids, junk from old saves, strings from URL params), and a resolved
 * loadout is never empty. The defaults reproduce the original fixed spawn exactly: pistol + rifle + shotgun at
 * reserveStart, standard grenades, rifle drawn, Q -> pistol.
 */

import { WEAPONS, WEAPON_ORDER } from './WeaponDefs.js';

/** Spawn ammo options of a pool. */
export const LOADOUT_AMMO = Object.freeze(['standard', 'full']);
/** Spawn grenade options of a pool. */
export const LOADOUT_GRENADES = Object.freeze(['standard', 'frag', 'none']);
/** Largest slot count (every weapon). */
export const MAX_SLOTS = WEAPON_ORDER.length;
/** Slot count of the default pool. */
export const DEFAULT_SLOTS = 3;

/** Default match rule: every weapon allowed, 3 slots, standard ammo and grenades. */
export const DEFAULT_POOL = Object.freeze({
  weapons: Object.freeze(WEAPON_ORDER.slice()), slots: DEFAULT_SLOTS, ammo: 'standard', grenades: 'standard',
});

/** Default pick = the original fixed spawn: pistol, rifle, shotgun with the rifle drawn. */
export const DEFAULT_PICK = Object.freeze({ weapons: Object.freeze(['pistol', 'rifle', 'shotgun']), primary: 'rifle' });

/**
 * Priority used when nothing of a pick is allowed by the pool: the default pick first, then slot order
 * (pistol, rifle, shotgun, sniper, rocket, smg, arc, rail, gale).
 */
export const FALLBACK_ORDER = Object.freeze([...DEFAULT_PICK.weapons, ...WEAPON_ORDER.filter(id => !DEFAULT_PICK.weapons.includes(id))]);

const GRENADE_ALIAS = { standard: 'standard', default: 'standard', mixed: 'standard', frag: 'frag', frags: 'frag', none: 'none', off: 'none', no: 'none' };
const AMMO_ALIAS = { standard: 'standard', default: 'standard', full: 'full', max: 'full' };

const isWeapon = id => typeof id === 'string' && Object.hasOwn(WEAPONS, id);
const lower = v => (typeof v === 'string' ? v.trim().toLowerCase() : v);
/** Own-property lookup of a (lower-cased) option name, so junk like '__proto__' can never leak through. */
const option = (map, v, fallback) => {
  const k = lower(v);
  return typeof k === 'string' && Object.hasOwn(map, k) ? map[k] : fallback;
};

/** Unique known weapon ids of an array / comma list, in input order. */
function idList(v) {
  const src = typeof v === 'string' ? v.split(',') : Array.isArray(v) ? v : [];
  const out = [];
  for (const raw of src) {
    const id = lower(raw);
    if (isWeapon(id) && !out.includes(id)) out.push(id);
  }
  return out;
}

function toSlots(v, fallback) {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? Math.min(MAX_SLOTS, Math.max(1, Math.round(n))) : fallback;
}

/**
 * Parse a pool string: `all` | `default` | `id,id,...` and/or options `slots=N`, `ammo=standard|full`,
 * `grenades=standard|frag|none` (`|` or `;` separate the parts, `=` or `:` the option values; a missing weapon list
 * allows every weapon). Examples: `rifle,sniper,smg;slots=2;ammo=full`, `slots=9`.
 */
function parsePoolString(str) {
  const out = {};
  for (const part of str.split(/[;|]/)) {
    const [k, v] = part.split(/[=:]/);
    const key = lower(k || '');
    if (v !== undefined) {
      if (key === 'slots' || key === 'ammo' || key === 'grenades') out[key] = v;
    } else if (key && key !== 'all' && key !== 'default' && key !== 'standard' && out.weapons === undefined) {
      out.weapons = key;
    }
  }
  return out;
}

/**
 * Defensive normaliser for anything that claims to be a pool (saved settings, URL params, a host's message).
 * Accepts an object, an id array (weapons only) or a pool string (see parsePoolString). Always returns a fresh,
 * complete pool; unknown ids are dropped and a pool without any known weapon allows every weapon.
 * @param {*} input
 * @returns {{weapons: string[], slots: number, ammo: string, grenades: string}}
 */
export function sanitizePool(input) {
  let src = input;
  if (typeof src === 'string') src = parsePoolString(src);
  else if (Array.isArray(src)) src = { weapons: src };
  if (!src || typeof src !== 'object') src = DEFAULT_POOL;
  const allowed = idList(src.weapons);
  return {
    weapons: allowed.length ? WEAPON_ORDER.filter(id => allowed.includes(id)) : WEAPON_ORDER.slice(),
    slots: toSlots(src.slots, DEFAULT_SLOTS),
    ammo: option(AMMO_ALIAS, src.ammo, 'standard'),
    grenades: option(GRENADE_ALIAS, src.grenades, 'standard'),
  };
}

/**
 * A sanitised, deep-frozen copy of a pool (the value Game freezes into the match config).
 * @param {*} input
 * @returns {Readonly<{weapons: ReadonlyArray<string>, slots: number, ammo: string, grenades: string}>}
 */
export function freezePool(input) {
  const p = sanitizePool(input);
  Object.freeze(p.weapons);
  return Object.freeze(p);
}

/** @returns {boolean} true when two pools are identical after normalisation. */
export function poolEquals(a, b) {
  const x = sanitizePool(a), y = sanitizePool(b);
  return x.slots === y.slots && x.ammo === y.ammo && x.grenades === y.grenades
    && x.weapons.length === y.weapons.length && x.weapons.every((id, i) => id === y.weapons[i]);
}

/** Primary fallback: the first non-pistol weapon (the pistol is the sidearm), else the first weapon. */
function fallbackPrimary(weapons) {
  return weapons.find(id => id !== 'pistol') || weapons[0];
}

/**
 * Defensive normaliser for a player's pick. Accepts `{weapons, primary}`, an id array or a string
 * `id,id,id[:primary]` (e.g. `pistol,sniper,smg:sniper`; `default` = the default pick). Always returns a fresh pick
 * with at least one weapon: junk / empty / unknown-only input -> the default pick; a primary that is not one of the
 * weapons -> the first non-pistol weapon (else the first).
 * @param {*} input
 * @returns {{weapons: string[], primary: string}}
 */
export function sanitizePick(input) {
  let src = input;
  if (typeof src === 'string') {
    const [list, primary] = src.split(':');
    src = { weapons: list, primary };
  } else if (Array.isArray(src)) {
    src = { weapons: src };
  }
  const weapons = src && typeof src === 'object' ? idList(src.weapons) : [];
  if (!weapons.length) return { weapons: DEFAULT_PICK.weapons.slice(), primary: DEFAULT_PICK.primary };
  const want = lower(src.primary);
  return { weapons, primary: weapons.includes(want) ? want : fallbackPrimary(weapons) };
}

/** @returns {boolean} true when two picks are identical after normalisation (same weapons in the same order). */
export function pickEquals(a, b) {
  const x = sanitizePick(a), y = sanitizePick(b);
  return x.primary === y.primary && x.weapons.length === y.weapons.length && x.weapons.every((id, i) => id === y.weapons[i]);
}

/**
 * The loadout a spawn applies: the pick filtered by the pool (disallowed weapons dropped), trimmed to `pool.slots`
 * (the primary is always kept, then the earliest picks), never empty (nothing left -> the first allowed weapons in
 * FALLBACK_ORDER, up to the slot count), with a valid primary (fallback: first non-pistol weapon) and the secondary
 * for Q (the first other weapon in pick order; the primary itself when it is the only weapon).
 * @param {*} pool  see sanitizePool
 * @param {*} pick  see sanitizePick
 * @returns {{weapons: string[], primary: string, secondary: string, ammo: string, grenades: string}}
 */
export function resolveLoadout(pool, pick) {
  const P = sanitizePool(pool);
  const K = sanitizePick(pick);
  let weapons = K.weapons.filter(id => P.weapons.includes(id));
  if (!weapons.length) weapons = FALLBACK_ORDER.filter(id => P.weapons.includes(id)).slice(0, P.slots);
  const keepPrimary = weapons.includes(K.primary) ? K.primary : null;
  if (weapons.length > P.slots) {
    const keep = keepPrimary ? [keepPrimary] : [];
    for (const id of weapons) {
      if (keep.length >= P.slots) break;
      if (id !== keepPrimary) keep.push(id);
    }
    weapons = weapons.filter(id => keep.includes(id));   // back in pick order
  }
  const primary = keepPrimary || fallbackPrimary(weapons);
  const secondary = weapons.find(id => id !== primary) || primary;
  return { weapons, primary, secondary, ammo: P.ammo, grenades: P.grenades };
}

/**
 * Normalise an explicit resolved loadout (e.g. pushed by a multiplayer host, or the legacy Escalation shape
 * `{primary, sidearm}`) without any pool restriction: known ids only, never empty, valid primary / secondary.
 * Extra fields such as `sidearm` are not kept.
 * @param {*} input
 * @returns {{weapons: string[], primary: string, secondary: string, ammo: string, grenades: string}}
 */
export function sanitizeLoadout(input) {
  const src = input && typeof input === 'object' ? input : {};
  let weapons = idList(src.weapons);
  if (!weapons.length) weapons = idList([src.sidearm, src.primary]);
  const lo = resolveLoadout({ weapons: WEAPON_ORDER, slots: MAX_SLOTS, ammo: src.ammo, grenades: src.grenades }, { weapons, primary: src.primary });
  const sec = lower(src.secondary);
  if (sec !== lo.primary && lo.weapons.includes(sec)) lo.secondary = sec;
  return lo;
}

/**
 * Escalation spawn loadout for a ladder weapon: the pistol sidearm plus that weapon (drawn), standard ammo and
 * grenades. Keeps the legacy `sidearm` field.
 * @param {string} id weapon of the entity's tier
 */
export function escalationLoadout(id) {
  const primary = isWeapon(id) ? id : 'pistol';
  return {
    weapons: primary === 'pistol' ? ['pistol'] : ['pistol', primary],
    primary, secondary: 'pistol', sidearm: 'pistol', ammo: 'standard', grenades: 'standard',
  };
}

/**
 * Reserve ammo a weapon spawns with: reserveStart ('standard') or reserveMax ('full'); Infinity stays Infinity.
 * @param {object} def weapon def
 * @param {string} ammo pool ammo option
 * @returns {number}
 */
export function spawnReserve(def, ammo) {
  const v = ammo === 'full' ? def.reserveMax : def.reserveStart;
  return Number.isFinite(v) ? v : Infinity;
}

/**
 * The resolved loadout of a human: the running match's pool (game.match.pool; outside a match the saved
 * settings.loadoutPool) + the entity's pick (entity.loadoutPick, else settings.playerLoadout). Does not know about
 * modes: Modes.loadoutFor handles Escalation and bots.
 * @param {object} game
 * @param {object} [entity]
 */
export function resolveFor(game, entity) {
  const m = game && game.match;
  const s = game && game.settings;
  const pool = m && m.pool !== undefined ? m.pool : (s ? s.get('loadoutPool') : undefined);
  const pick = entity && entity.loadoutPick != null ? entity.loadoutPick : (s ? s.get('playerLoadout') : undefined);
  return resolveLoadout(pool, pick);
}

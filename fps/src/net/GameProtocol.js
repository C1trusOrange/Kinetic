/**
 * Game-level multiplayer protocol on top of the relay protocol (protocol.js): JSON message kinds, tuning constants,
 * weapon / grenade index tables and wire sentinels. Shared by NetSession, NetHost, NetClient and NetCodec.
 *
 * Packets (byte 1, protocol.js PKT): PING / PONG (clock sync), JSON (reliable batches {e: epoch, m: [msg, ...]}, one
 * per destination per frame), SNAPSHOT (host -> one client, latest-wins), CSTATE (client -> host body state,
 * latest-wins). Byte-exact layouts: NetCodec.js. Design: docs/multiplayer/MULTIPLAYER_CONTRACT.md.
 */
import { PKT, LATEST_WINS, PROTOCOL_VERSION } from './protocol.js';
import { WEAPONS, WEAPON_ORDER, GRENADE_ORDER } from '../weapons/WeaponDefs.js';

export { PKT, PROTOCOL_VERSION };

// load-time check: packet types are distinct, the state streams are latest-wins and the reliable ones are not
{
  const values = Object.values(PKT);
  if (new Set(values).size !== values.length) throw new Error('[net] duplicate PKT values');
  if (PKT.CSTATE < LATEST_WINS || PKT.SNAPSHOT < LATEST_WINS) throw new Error('[net] state packets must be latest-wins');
  if (PKT.JSON >= LATEST_WINS || PKT.PING >= LATEST_WINS || PKT.PONG >= LATEST_WINS) throw new Error('[net] reliable packets must not be latest-wins');
}

/** Tuning constants (ms unless noted). */
export const NET = Object.freeze({
  SNAP_HZ: 60, SNAP_HZ_FALLBACK: 30, JITTER_FALLBACK_MS: 12, JITTER_RECOVER_MS: 8, JITTER_RECOVER_S: 10,
  STATE_HZ: 60, DEAD_STATE_HZ: 10,
  HOST_TICK_MS: 16, TICK_COALESCE_MS: 12, RAF_STALL_MS: 120, HOST_BOOST_RAF_MS: 18,
  DT_MAX: 0.25, SUB_STEP_MAX: 0.05, SUBSTEPS_MAX: 5, PLAYER_DT_MAX: 0.1,   // seconds
  INTERP_MIN_MS: 16, INTERP_MAX_MS: 150, HOST_SMOOTH_MIN_MS: 8, HOST_SMOOTH_MAX_MS: 120,
  DELAY_WINDOW_MS: 2000, DELAY_MARGIN_MS: 2, DELAY_DECAY_MS_PER_S: 10, DELAY_DILATION: 0.5, TELEPORT_HOLD: 3,
  COUNTDOWN_S: 3, LOAD_TIMEOUT_S: 45, FORCE_START_AFTER_S: 8, OUTRO_S: 2.2, DEPLOY_TIMEOUT_S: 10, LATE_SPAWN_PROTECT_S: 3,
  RECONNECT_GRACE_S: 60, LAGGING_MS: 250, SOFT_DROP_MS: 2500, INTERRUPTED_MS: 1000,
  PING_FAST_HZ: 4, PING_FAST_S: 3, PING_HZ: 1, PINGS_BROADCAST_HZ: 1, NQ_HZ: 1,
  HISTORY_S: 1.0, CLAIM_REWIND_MAX_MS: 400, CLAIM_POS_TOL_M: 0.75, CLAIM_TRADE_MS: 30, CLAIM_LATE_MS: 1000,
  ACTION_ORIGIN_TOL_M: 2.5, ACTION_ORIGIN_VEL_K: 0.1, ACTION_BURST: 2, DEATH_DROP_MS: 500,
  PRED_TIMEOUT_S: 1.0, PRED_KNOCK_MATCH_M: 1.0, ADOPT_DIR_DEG: 2, ADOPT_POS_M: 1.5, GRENADE_BLEND_S: 0.15,
  IMPLIED_SPEED_K: 1.5, IMPLIED_SPEED_ADD: 15, IMPLIED_SPEED_CAP: 120, FALL_BACKSTOP_S: 1.5,
  MAX_HUMANS: 8, MAX_FIGHTERS: 16, SCORE_KEYFRAME: 8,
  LOBBY_DEBOUNCE_MS: 100, PROGRESS_HZ: 4, HELLO_TIMEOUT_MS: 10000,
  /** JSON sentinel for Infinity / "none" (timeLeft, respawnAt, pickup respawns): JSON.stringify(Infinity) is 'null'. */
  NEVER: -1,
});

/** Weapons whose hits the shooter's client detects and claims (favor the shooter). Everything else is host-run. */
export const CLAIM_WEAPONS = new Set(['pistol', 'rifle', 'shotgun', 'sniper', 'smg', 'arc', 'rail', 'melee']);

/** The only non-positional sounds a weapon capture window may record (they are replayed positionally elsewhere). */
export const TWIN_SOUNDS = new Set([...WEAPON_ORDER.map(id => WEAPONS[id].sound), 'dry_fire', 'reload_start',
  'reload_insert', 'reload_end', 'pump', 'bolt', 'weapon_switch', 'melee_swing', 'melee_hit', 'grenade_pin',
  'charge_arm', 'grenade_throw', 'arc_end', 'rail_ready']);

/** JSON message kinds (field `k`). Lobby kinds are accepted in any epoch; the rest only in the current one. */
export const K = Object.freeze({
  // client -> host
  HELLO: 'hello', BYE: 'bye', READY: 'ready', TEAM: 'team', PICK: 'pick', PROG: 'prog', LOADED: 'loaded',
  DEPLOY: 'deploy', NQ: 'nq', FIRE: 'fire', CLAIM: 'cl', FALL: 'fall', FX: 'fx', ACT: 'act',
  // host -> client
  WELCOME: 'welcome', LOBBY: 'lobby', LOAD: 'load', BEGIN: 'begin', ROSTER: 'ros', PHASE: 'phase', SPAWN: 'spawn',
  DAMAGE: 'dmg', DEATH: 'death', PICKUP: 'pk', GRANT: 'grant', IMPULSE: 'imp', LAUNCH: 'lnch', CLAIM_REJECTED: 'clr',
  EXPLOSION: 'exp', END: 'end', SYS: 'sys', PINGS: 'pings',
});

export const LOBBY_KINDS = new Set(['hello', 'welcome', 'lobby', 'load', 'pings', 'sys', 'bye', 'ready', 'team', 'pick', 'nq']);

/** weapon id -> wire index (WEAPON_ORDER index + 1; 0 = none). */
export const WEAPON_INDEX = Object.freeze(Object.fromEntries(WEAPON_ORDER.map((id, i) => [id, i + 1])));
/** wire index -> weapon id (0 -> null). */
export const WEAPON_BY_INDEX = Object.freeze([null, ...WEAPON_ORDER]);
/** Grenade types in wire order (CSTATE nades). */
export const NADE_ORDER = GRENADE_ORDER;

export const PROJ_KIND = Object.freeze({ rocket: 0, frag: 1, vortex: 2, static: 3, kinetic: 4, smoke: 5 });
export const PROJ_STATE = Object.freeze({ flight: 0, deploy: 1, active: 2 });

/** Net-time (ms) value for the wire: finite -> rounded (>= 0: a time before the host started is just "past"), Infinity / NaN -> NET.NEVER. */
export const toWireTime = v => (Number.isFinite(v) ? Math.max(0, Math.round(v)) : NET.NEVER);
/** Counterpart of toWireTime: NET.NEVER (any negative) -> Infinity. */
export const fromWireTime = v => (typeof v === 'number' && v >= 0 ? v : Infinity);

/** Round a vector for JSON: positions to 1 cm. @returns {number[]} */
export function wirePos(v) {
  return [Math.round(v.x * 100) / 100, Math.round(v.y * 100) / 100, Math.round(v.z * 100) / 100];
}

/** Round a unit vector for JSON (1e-3). @returns {number[]} */
export function wireDir(v) {
  return [Math.round(v.x * 1000) / 1000, Math.round(v.y * 1000) / 1000, Math.round(v.z * 1000) / 1000];
}

/** A finite number from a wire field, else `fallback`. */
export function num(v, fallback = 0) {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/** [x, y, z] from the wire (non-finite components -> 0) into `out`; false if `a` is not a 3-array. */
export function readVec(a, out) {
  if (!Array.isArray(a) || a.length < 3) return false;
  out.set(num(a[0]), num(a[1]), num(a[2]));
  return true;
}

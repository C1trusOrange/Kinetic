/**
 * Team, colour and name planning for online matches (pure functions, no game state).
 */
import { TEAM_BLUE, TEAM_RED, TEAM_COLORS, PLAYER_COLOR, isTeamMode } from '../core/constants.js';

/** Free-for-all colours of the humans in join order ([0] = the classic player colour). */
export const HUMAN_COLORS = [PLAYER_COLOR, 0xffd84a, 0x4dffb8, 0xff6ec7, 0x8f9bff, 0xff9d4d, 0xc8ff4d, 0xd98bff];

const NAME_MAX = 16;

/** A display name from user input: trimmed, control characters removed, spaces collapsed, <= 16 chars ('' -> 'Player'). */
export function sanitizeName(raw) {
  const s = String(raw ?? '').replace(/[\u0000-\u001f\u007f-\u009f]/g, '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX).trim();
  return s || 'Player';
}

/**
 * `name`, or 'name 2', 'name 3', ... if a name in `taken` matches case-insensitively (kept within 16 chars).
 * @param {string} name @param {Iterable<string>} taken
 */
export function dedupeName(name, taken) {
  const used = new Set();
  for (const t of taken) used.add(String(t).toLowerCase());
  if (!used.has(name.toLowerCase())) return name;
  for (let n = 2; n < 100; n++) {
    const suffix = ' ' + n;
    const cand = name.slice(0, NAME_MAX - suffix.length).trimEnd() + suffix;
    if (!used.has(cand.toLowerCase())) return cand;
  }
  return name;
}

/**
 * Teams and colours of a match's humans and bots.
 * Free-for-all modes: team 0 (the game sets team = entity id), colour HUMAN_COLORS[i] (or the human's own `color`).
 * Team modes: each human joins the team with fewer humans (tie: fewer total, then Blue); a valid preference (1 / 2) is
 * honoured while the human counts stay within one. Bots fill each team to half of (humans + bots), the odd slot going to
 * the team with fewer humans.
 * @param {{mode: string, humans: {peer: number, name?: string, pref?: number, color?: number}[], botCount: number}} o
 *   humans: host first, then the clients in peer order
 * @returns {{humans: {peer: number, team: number, color: number}[], botTeams: number[]}}
 */
export function planMatch({ mode, humans, botCount }) {
  const n = Math.max(0, botCount | 0);
  if (!isTeamMode(mode)) {
    return {
      humans: humans.map((h, i) => ({ peer: h.peer, team: 0, color: Number.isFinite(h.color) ? h.color : HUMAN_COLORS[i % HUMAN_COLORS.length] })),
      botTeams: [],
    };
  }
  const count = { [TEAM_BLUE]: 0, [TEAM_RED]: 0 };
  const out = [];
  for (const h of humans) {
    const fewer = count[TEAM_RED] < count[TEAM_BLUE] ? TEAM_RED : TEAM_BLUE;
    let team = fewer;
    if (h.pref === TEAM_BLUE || h.pref === TEAM_RED) {
      const other = h.pref === TEAM_BLUE ? TEAM_RED : TEAM_BLUE;
      if (count[h.pref] + 1 - count[other] <= 1) team = h.pref;
    }
    count[team]++;
    out.push({ peer: h.peer, team, color: TEAM_COLORS[team] });
  }
  const total = humans.length + n;
  const fewerHumans = count[TEAM_RED] < count[TEAM_BLUE] ? TEAM_RED : TEAM_BLUE;
  const target = { [TEAM_BLUE]: Math.floor(total / 2), [TEAM_RED]: Math.floor(total / 2) };
  if (total % 2) target[fewerHumans]++;
  // a side with more humans than its target keeps them (bots never go negative); the other side takes every bot
  const botTeams = [];
  let blue = Math.max(0, target[TEAM_BLUE] - count[TEAM_BLUE]);
  let red = Math.max(0, target[TEAM_RED] - count[TEAM_RED]);
  while (blue + red < n) { if (blue <= red) blue++; else red++; }
  while (blue + red > n) { if (blue >= red) blue--; else red--; }
  for (let i = 0; i < n; i++) {
    // alternate while both still need bots, so a short bot list stays balanced
    if (red > 0 && (red >= blue || blue === 0)) { botTeams.push(TEAM_RED); red--; } else { botTeams.push(TEAM_BLUE); blue--; }
  }
  return { humans: out, botTeams };
}

/**
 * Team and colour of a human joining a running match: the team with fewer humans (tie: fewer fighters, then Blue), or
 * a valid preference when that keeps the human counts within one.
 * @param {{mode: string, entities: object[], pref?: number, index?: number}} o index = colour slot for free-for-all
 * @returns {{team: number, color: number}}
 */
export function planLateJoin({ mode, entities, pref, index = 0 }) {
  if (!isTeamMode(mode)) return { team: 0, color: HUMAN_COLORS[index % HUMAN_COLORS.length] };
  const humans = { [TEAM_BLUE]: 0, [TEAM_RED]: 0 }, all = { [TEAM_BLUE]: 0, [TEAM_RED]: 0 };
  for (const e of entities) {
    if (e.team !== TEAM_BLUE && e.team !== TEAM_RED) continue;
    all[e.team]++;
    if (e.isHuman) humans[e.team]++;
  }
  let team = humans[TEAM_RED] < humans[TEAM_BLUE] ? TEAM_RED
    : humans[TEAM_BLUE] < humans[TEAM_RED] ? TEAM_BLUE
    : all[TEAM_RED] < all[TEAM_BLUE] ? TEAM_RED : TEAM_BLUE;
  if (pref === TEAM_BLUE || pref === TEAM_RED) {
    const other = pref === TEAM_BLUE ? TEAM_RED : TEAM_BLUE;
    if (humans[pref] + 1 - humans[other] <= 1) team = pref;
  }
  return { team, color: TEAM_COLORS[team] };
}

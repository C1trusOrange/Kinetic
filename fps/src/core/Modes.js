// Rules of the two objective modes, kept out of Game.js:
//
//   Escalation ('escalation')  FFA gun game. Everybody climbs the same weapon ladder (ESCALATION_LADDER, filtered to the
//                              weapons that exist). A kill promotes the killer one tier (weapon replaced, +35 health,
//                              +1 grenade); the victim of a melee kill and anybody who suicides drops a tier. A kill made
//                              on the last tier wins the match. Weapon pads are switched off.
//   King of the Hill ('koth')  Blue vs Red. One control zone is live at a time and rotates through the map's zones
//                              (def.zones, or auto-picked spots). Uncontested holding scores a team point every
//                              HILL.tick seconds; a kill whose victim stood in the live zone is worth a bonus point.
//
// Game.js calls: onMatchStart(match) (after the bots exist, before anyone spawns), update(dt), onDeath(info),
// clear(), pickWinner(match). Bots / weapons ask loadoutFor(), targetBias(), objectiveGoal(), holdPosition(),
// suppressChase(). loadoutFor() is the single spawn-loadout resolver (weapons/Loadout.js shape): the Escalation ladder
// for everybody, else humans (any non-bot, local or remote) get the match pool + their own pick, bots get null (they
// keep the Bot arsenal). Events on game.events:
//   'esc:tier'  { entity, tier, delta, weapon, cause }   'esc:final' { entity }
//   'hill:move' { zone, index }   'hill:preview' { next }   'hill:relocate' { next }   'hill:capture' { team, prev, zone }
//   'hill:contested' { zone }     'hill:neutral' { prev }   'hill:score' { team, total, n, reason }

import { ESCALATION_LADDER, HILL } from './constants.js';
import { WEAPONS } from '../weapons/WeaponDefs.js';
import { escalationLoadout, resolveFor } from '../weapons/Loadout.js';
import { Zones, zoneContains, zonePoint } from '../world/Zones.js';
import { clamp } from './utils.js';

const TIER_HEAL = 35;

// ------------------------------------------------------------------------------------------------ Escalation

class EscalationMode {
  constructor(game) {
    this.game = game;
    this.ladder = [];
    this.winner = null;
  }

  onMatchStart(match) {
    this.ladder = ESCALATION_LADDER.filter(id => WEAPONS[id]);
    if (this.ladder.length < 2) this.ladder = Object.keys(WEAPONS);
    this.winner = null;
    match.ladder = this.ladder;
    match.scoreLimit = this.ladder.length;   // read-only in the menu: the ladder length
    for (const e of this.game.entities) e.tier = 0;
  }

  weaponFor(tier) {
    return this.ladder[clamp(tier | 0, 0, this.ladder.length - 1)];
  }

  isFinal(entity) {
    return entity.tier >= this.ladder.length - 1;
  }

  /** Spawn loadout for an entity: the sidearm plus the weapon of its current tier (Loadout.js resolved shape + `sidearm`). */
  loadoutFor(entity) {
    return escalationLoadout(this.weaponFor(entity.tier));
  }

  onDeath({ victim, attacker, weapon }) {
    const m = this.game.match;
    if (!m || m.over || !victim) return;
    const self = !attacker || attacker === victim;
    if (self) {
      // fell / blew itself up with nobody to blame: down a tier
      this._setTier(victim, victim.tier - 1, -1, weapon, 'suicide');
      return;
    }
    if (this.isFinal(attacker)) {
      this.winner = attacker;
      this.game.endMatch('ladder');
      return;
    }
    this._setTier(attacker, attacker.tier + 1, +1, weapon, weapon === 'melee' ? 'humiliation' : 'kill');
    if (weapon === 'melee') this._setTier(victim, victim.tier - 1, -1, weapon, 'humiliated');
  }

  _setTier(entity, tier, delta, weapon, cause) {
    const last = this.ladder.length - 1;
    tier = clamp(tier, 0, last);
    if (tier === entity.tier) return;
    entity.tier = tier;
    const id = this.ladder[tier];
    if (entity.alive) {
      // the dead get their loadout from loadoutFor() when they respawn
      if (entity.isPlayer) this.game.weapons.setEscalationWeapon(id);
      else if (typeof entity.setEscalationWeapon === 'function') entity.setEscalationWeapon(id);
      if (delta > 0) {
        entity.health = Math.min(entity.maxHealth, entity.health + TIER_HEAL);
        entity.addGrenades(1);
      }
    }
    const ev = this.game.events;
    ev.emit('esc:tier', { entity, tier, delta, weapon: id, cause });
    if (delta > 0 && tier === last) ev.emit('esc:final', { entity });
  }

  /** Bots hunt the leader: score bonus for candidates on the last tier / one tier ahead. */
  targetBias(bot, enemy) {
    if (enemy.tier >= this.ladder.length - 1) return 45;
    return enemy.tier > bot.tier ? 12 : 0;
  }

  /** Bots favour the weapon of their tier over the sidearm (range fit / empty magazines still win over the bias). */
  weaponBias(bot, id) {
    return id !== 'pistol' && id === this.weaponFor(bot.tier) ? 0.55 : 0;
  }

  pickWinner(match) {
    if (match.reason === 'ladder' && this.winner) return this.winner;
    let best = null;
    for (const e of this.game.entities) {
      if (!best || e.tier > best.tier || (e.tier === best.tier && (e.kills > best.kills || (e.kills === best.kills && e.deaths < best.deaths)))) best = e;
    }
    return best;
  }
}

// ------------------------------------------------------------------------------------------------ King of the Hill

class KothMode {
  constructor(game) {
    this.game = game;
    this.zones = new Zones(game);
    /** Live state, also exposed as match.koth (HUD, tests). */
    this.s = null;
    this.on = false;
  }

  /** The live zone or null (before the first zone goes live / while relocating). */
  get live() {
    const s = this.s;
    return this.on && s && s.phase === 'live' ? s.zones[s.index] : null;
  }

  onMatchStart(match) {
    const list = this.zones.load(this.game.world);
    this.on = list.length > 0;
    if (!this.on) console.warn('[koth] this map has no usable zones: every kill scores a team point instead');
    match.teamScores = { 1: 0, 2: 0 };
    this.s = match.koth = {
      zones: list,
      index: 0,            // the live zone, or the one that goes live next
      phase: 'countdown',  // 'countdown' | 'live' | 'relocating'
      t: 0,                // seconds in the phase
      left: HILL.firstDelay, // seconds until the phase ends
      previewed: false,
      owner: 0,            // team holding the zone (0 = nobody)
      contested: false,
      progress: 0,         // 0..1 towards the next hold point
      presence: { 1: 0, 2: 0 },
      // measurements
      moves: 0,
      teamHold: { 1: 0, 2: 0 },        // seconds a team held the live zone uncontested
      contestedTime: 0,
      captures: { 1: 0, 2: 0 },
      scored: { hold: { 1: 0, 2: 0 }, kill: { 1: 0, 2: 0 } },
      botSec: 0,           // bot-seconds spent alive inside the live zone
      botAliveSec: 0,      // bot-seconds alive while a zone was live
      teamSec: { 1: 0, 2: 0 }, // entity-seconds inside the live zone per team
    };
    this._push();
  }

  clear() {
    this.on = false;
    this.s = null;
    this.zones.clear();
  }

  update(dt) {
    const s = this.s, m = this.game.match;
    if (!this.on || !s || !m || m.over) return;
    s.t += dt;
    if (s.phase === 'countdown') {
      s.left = HILL.firstDelay - s.t;
      if (s.t >= HILL.firstDelay) this._goLive();
    } else if (s.phase === 'relocating') {
      s.left = HILL.gap - s.t;
      if (s.t >= HILL.gap) this._goLive();
    } else {
      s.left = HILL.duration - s.t;
      this._tickLive(dt);
    }
    this._push();
  }

  _tickLive(dt) {
    const g = this.game, s = this.s, m = g.match;
    const z = s.zones[s.index];
    let p1 = 0, p2 = 0;
    const ents = g.entities;
    for (let i = 0; i < ents.length; i++) {
      const e = ents[i];
      if (!e.alive) continue;
      const inside = zoneContains(z, e.position.x, e.position.y, e.position.z);
      if (e.isBot) s.botAliveSec += dt;
      if (!inside) continue;
      e.zoneTime += dt;
      if (e.isBot) s.botSec += dt;
      if (e.team === 1) p1++;
      else if (e.team === 2) p2++;
    }
    s.presence[1] = p1;
    s.presence[2] = p2;
    s.teamSec[1] += p1 * dt;
    s.teamSec[2] += p2 * dt;
    const ev = g.events;
    if (p1 && p2) {
      if (!s.contested) { s.contested = true; ev.emit('hill:contested', { zone: z }); }
      s.contestedTime += dt;
    } else {
      s.contested = false;
      const holder = p1 ? 1 : p2 ? 2 : 0;
      if (holder) {
        if (s.owner !== holder) {
          const prev = s.owner;
          s.owner = holder;
          s.progress = 0;
          s.captures[holder]++;
          ev.emit('hill:capture', { team: holder, prev, zone: z });
        }
        s.teamHold[holder] += dt;
        s.progress += dt / HILL.tick;
        while (s.progress >= 1) {
          s.progress -= 1;
          this._score(holder, 1, 'hold');
          if (m.over) return;
        }
      } else {
        s.progress = Math.max(0, s.progress - dt / HILL.tick);
        if (s.progress <= 0 && s.owner) {
          ev.emit('hill:neutral', { prev: s.owner });
          s.owner = 0;
        }
      }
    }
    if (!s.previewed && s.left <= HILL.warn) {
      s.previewed = true;
      ev.emit('hill:preview', { next: s.zones[(s.index + 1) % s.zones.length] });
    }
    if (s.t >= HILL.duration) this._relocate();
  }

  _goLive() {
    const s = this.s;
    s.phase = 'live';
    s.t = 0;
    s.left = HILL.duration;
    s.owner = 0;
    s.progress = 0;
    s.contested = false;
    s.previewed = false;
    s.moves++;
    this.game.events.emit('hill:move', { zone: s.zones[s.index], index: s.index });
    this._nudgeBots();
  }

  _relocate() {
    const s = this.s;
    s.phase = 'relocating';
    s.t = 0;
    s.left = HILL.gap;
    s.index = (s.index + 1) % s.zones.length;
    s.owner = 0;
    s.progress = 0;
    s.contested = false;
    s.previewed = false;
    this.game.events.emit('hill:relocate', { next: s.zones[s.index] });
    this._nudgeBots();
  }

  /** The objective moved: bots that are wandering pick a fresh goal (fighting bots do so when the fight ends). */
  _nudgeBots() {
    const t = this.game.time;
    for (const b of this.game.bots.list) {
      const br = b.brain;
      if (!b.alive || !br) continue;
      br._objBan = 0;
      if (br.state === 'roam' || br.state === 'collect' || br.state === 'chase') br.enterState('roam', t);
    }
  }

  _score(team, n, reason) {
    const g = this.game, m = g.match, s = this.s;
    m.teamScores[team] = (m.teamScores[team] || 0) + n;
    if (s && s.scored[reason]) s.scored[reason][team] += n;
    g.events.emit('hill:score', { team, total: m.teamScores[team], n, reason });
    g._checkScoreLimit();
  }

  /** Push the visual state to the world zones. */
  _push() {
    const s = this.s;
    const zs = s.zones;
    if (s.phase === 'live') {
      this.zones.setState({
        active: zs[s.index], next: s.previewed ? zs[(s.index + 1) % zs.length] : null,
        owner: s.owner, contested: s.contested, progress: s.progress, warn: s.previewed,
      });
    } else {
      this.zones.setState({ active: null, next: zs[s.index], owner: 0, contested: false, progress: 0, warn: false });
    }
  }

  onDeath({ victim, attacker }) {
    const s = this.s;
    if (!victim || !attacker || attacker === victim || attacker.team === victim.team) return;
    if (!this.on) { this._score(attacker.team, 1, 'kill'); return; }   // no zones: plain team deathmatch
    const z = this.live;
    if (z && zoneContains(z, victim.position.x, victim.position.y, victim.position.z, 0.5)) {
      this._score(attacker.team, HILL.killBonus, 'kill');
      if (s) s.killsInZone = (s.killsInZone || 0) + 1;
    }
  }

  // ---- bots

  /** holders (every other bot of a team) defend the zone, hunters flank and push in when it is not theirs. */
  _role(bot) {
    if (bot._kothRole) return bot._kothRole;
    let idx = 0;
    for (const b of this.game.bots.list) {
      if (b === bot) break;
      if (b.team === bot.team) idx++;
    }
    bot._kothRole = idx % 2 === 0 ? 'holder' : 'hunter';
    return bot._kothRole;
  }

  /** A walkable spot in the zone worth heading to, or null (= roam normally). */
  objectiveGoal(bot, brain) {
    const s = this.s;
    if (!this.on || !s) return null;
    const z = s.zones[s.index];
    if (!z || this.game.time < (brain._objBan || 0)) return null;
    const a = clamp(brain.cfg.aggression * brain.pers.aggr, 0.4, 1.1);
    let p;
    if (s.phase !== 'live') {
      p = 0.95;   // race to the zone that is about to go live
    } else if (this._role(bot) === 'holder') {
      p = 0.62 + 0.32 * a;
    } else {
      p = s.owner === bot.team && !s.contested ? 0.04 : 0.42 + 0.4 * a;
    }
    return Math.random() < p ? zonePoint(z) : null;
  }

  /**
   * Called every think while a bot roams: a bot whose goal is not in the zone is re-aimed at it (bots that are busy
   * collecting / fighting are handled by pickupFactor / suppressChase / the fight ending). True = a goal was set.
   */
  roamHook(bot, brain, t) {
    const s = this.s;
    if (!this.on || !s || t < (brain._objAt || 0)) return false;
    brain._objAt = t + 1.0 + Math.random() * 0.6;
    const z = s.zones[s.index];
    if (!z) return false;
    const nav = brain.nav;
    if (nav.hasGoal && nav.unreachable && nav.mode !== 'idle') {
      // the zone (or wherever this bot is heading) cannot be walked to from here: roam normally for a while
      brain._objBan = t + 10;
      nav.clear();
      return false;
    }
    if (nav.hasGoal && Math.abs(nav.goal.y - z.pos.y) <= z.halfUp && Math.hypot(nav.goal.x - z.pos.x, nav.goal.z - z.pos.z) <= z.radius) return false;
    const g = this.objectiveGoal(bot, brain);
    if (!g) return false;
    brain.roamFailures = 0;
    nav.setGoal(g, 1.4, 0.5);
    return true;
  }

  /** Bots skip far-away pickups (unless hurt) so they are free to play the zone: multiplier on the pickup's value. */
  pickupFactor(bot, p) {
    const s = this.s;
    if (!this.on || !s) return 1;
    const z = s.zones[s.index];
    if (!z) return 1;
    if (Math.hypot(p.position.x - z.pos.x, p.position.z - z.pos.z) <= z.radius + 8 && Math.abs(p.position.y - z.pos.y) <= z.halfUp) return 1;
    if (p.type === 'health' && bot.health < 60) return 1;
    return this._role(bot) === 'holder' ? 0.2 : 0.5;
  }

  /** Spawn-point score bonus (negative = worse): points nearer the live / upcoming zone are preferred (up to ~ +12). */
  spawnBias(entity, sp) {
    const s = this.s;
    if (!this.on || !s) return 0;
    const z = s.zones[s.index];
    if (!z) return 0;
    return -0.3 * Math.min(40, Math.hypot(sp.position.x - z.pos.x, sp.position.z - z.pos.z));
  }

  /** Holders standing on the zone fight on at lower health instead of leaving to look for a health pack. */
  retreatShift(bot) {
    const z = this.live;
    return z && this._role(bot) === 'holder' && zoneContains(z, bot.position.x, bot.position.y, bot.position.z, 3) ? 14 : 0;
  }

  /**
   * A bot that should be on the zone keeps advancing on it while it fights (shooting on the move) instead of
   * duelling wherever it happens to meet an enemy. Returns the goal or null (= fight normally).
   */
  advanceGoal(bot, brain, dist) {
    const s = this.s;
    if (!this.on || !s || dist < 9 || bot.health < 35) return null;
    const z = s.zones[s.index];
    if (!z || this.game.time < (brain._objBan || 0)) return null;
    if (this._role(bot) === 'hunter' && s.owner === bot.team && !s.contested) return null;   // hunters only push in when it is not theirs
    if (zoneContains(z, bot.position.x, bot.position.y, bot.position.z, 2)) return null;
    if (brain._advZone !== z || !brain._advPt) { brain._advZone = z; brain._advPt = zonePoint(z); }
    return brain._advPt;
  }

  /** Holders standing in the live zone do not walk out of it after enemies that are far away. */
  holdPosition(bot, dist, tp) {
    const z = this.live;
    if (!z || dist <= 16 || this._role(bot) !== 'holder') return false;
    if (!zoneContains(z, bot.position.x, bot.position.y, bot.position.z, 1.5)) return false;
    return !zoneContains(z, tp.x, tp.y, tp.z, 2);
  }

  /** Holders do not go hunting for a remembered enemy: they stay on (or return to) the objective. */
  suppressChase(bot) {
    return this.on && this._role(bot) === 'holder';
  }
}

// ------------------------------------------------------------------------------------------------ facade

export class Modes {
  /** @param {object} game (constructors must not touch other subsystems) */
  constructor(game) {
    this.game = game;
    this.escalation = new EscalationMode(game);
    this.koth = new KothMode(game);
    /** 'escalation' | 'koth' | null (ffa / tdm / no match) */
    this.mode = null;
  }

  /** Called by Game._startMatch after the bots are created and before anyone spawns. */
  onMatchStart(match) {
    this.clear();
    const esc = match.mode === 'escalation';
    const pickups = this.game.world.pickups;
    if (pickups && pickups.setWeaponPadsEnabled) pickups.setWeaponPadsEnabled(!esc);
    if (esc) {
      this.mode = 'escalation';
      this.escalation.onMatchStart(match);
    } else if (match.mode === 'koth') {
      this.mode = 'koth';
      this.koth.onMatchStart(match);
    }
  }

  /** Per frame (Game.update, after world.update). */
  update(dt) {
    if (this.mode === 'koth') {
      this.koth.update(dt);
      this.koth.zones.update(dt);
    }
  }

  /** Called by Game._onDeath after kills / deaths are tallied and before the score limit is checked. */
  onDeath(info) {
    if (this.mode === 'escalation') this.escalation.onDeath(info);
    else if (this.mode === 'koth') this.koth.onDeath(info);
  }

  /** Match torn down / left. */
  clear() {
    const wasEsc = this.mode === 'escalation';
    this.mode = null;
    this.koth.clear();
    this.escalation.winner = null;
    const pickups = this.game.world && this.game.world.pickups;
    if (wasEsc && pickups && pickups.setWeaponPadsEnabled) pickups.setWeaponPadsEnabled(true);
  }

  get isEscalation() { return this.mode === 'escalation'; }
  get isKoth() { return this.mode === 'koth'; }

  /**
   * Spawn loadout of an entity, as a resolved loadout { weapons, primary, secondary, ammo, grenades } (weapons/Loadout.js):
   * Escalation -> pistol + the weapon of the entity's tier (bots too); other modes -> humans (!isBot, so remote humans
   * count) get the match pool (game.match.pool) applied to their pick (entity.loadoutPick, else settings.playerLoadout);
   * bots -> null (they keep the Bot arsenal).
   * @param {object} entity
   * @returns {object|null}
   */
  loadoutFor(entity) {
    if (this.mode === 'escalation') return this.escalation.loadoutFor(entity);
    if (!entity || entity.isBot) return null;
    return resolveFor(this.game, entity);
  }

  /** Escalation: additive target-score bonus for `enemy` as seen by `bot` (0 in other modes). */
  targetBias(bot, enemy) {
    return this.mode === 'escalation' ? this.escalation.targetBias(bot, enemy) : 0;
  }

  /** Escalation: additive score for a bot choosing between its weapons (the ladder weapon is preferred). */
  weaponBias(bot, id) {
    return this.mode === 'escalation' ? this.escalation.weaponBias(bot, id) : 0;
  }

  /** King of the Hill: goal point for a bot picking where to go next, or null. */
  objectiveGoal(bot, brain) {
    return this.mode === 'koth' ? this.koth.objectiveGoal(bot, brain) : null;
  }

  /** King of the Hill: while roaming, re-aim a bot at the zone. True = a goal was set. */
  roamHook(bot, brain, t) {
    return this.mode === 'koth' ? this.koth.roamHook(bot, brain, t) : false;
  }

  /** King of the Hill: spawn-point score bonus so that everybody respawns nearer the zone. */
  spawnBias(entity, sp) {
    return this.mode === 'koth' ? this.koth.spawnBias(entity, sp) : 0;
  }

  /** King of the Hill: health points knocked off a bot's retreat threshold (holders on the zone stand their ground). */
  retreatShift(bot) {
    return this.mode === 'koth' ? this.koth.retreatShift(bot) : 0;
  }

  /** King of the Hill: multiplier on a pickup's value for a bot (far pickups matter less than the zone). */
  pickupFactor(bot, p) {
    return this.mode === 'koth' ? this.koth.pickupFactor(bot, p) : 1;
  }

  /** King of the Hill: a fighting bot's goal on the zone (advance under fire), or null. */
  advanceGoal(bot, brain, dist) {
    return this.mode === 'koth' ? this.koth.advanceGoal(bot, brain, dist) : null;
  }

  /** King of the Hill: should this bot stay put instead of closing the distance to a far enemy? */
  holdPosition(bot, dist, tp) {
    return this.mode === 'koth' ? this.koth.holdPosition(bot, dist, tp) : false;
  }

  /** King of the Hill: should this bot skip 'chase' (hunting a remembered enemy) and stay on the objective? */
  suppressChase(bot) {
    return this.mode === 'koth' ? this.koth.suppressChase(bot) : false;
  }

  /** Match winner (an entity) for the non-team modes; null = let the generic FFA rule decide. */
  pickWinner(match) {
    return this.mode === 'escalation' ? this.escalation.pickWinner(match) : null;
  }
}

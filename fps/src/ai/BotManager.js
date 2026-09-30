import * as THREE from 'three';
import { BOT_NAMES, BOT_COLORS, TEAM_COLORS, TEAM_BLUE, TEAM_RED } from '../core/constants.js';
import { DIFFICULTIES, isTeamMode } from '../core/constants.js';
import { Bot } from './Bot.js';
import { asPos } from './BotConfig.js';

const _o = new THREE.Vector3();
const SEPARATION_RADIUS = 0.95;
const PATH_BUDGET_MS = 2.5; // per frame, shared by all bots
const RAY_DIRS = [];
for (let i = 0; i < 8; i++) {
  const a = (i / 8) * Math.PI * 2;
  RAY_DIRS.push(new THREE.Vector3(Math.cos(a), 0, Math.sin(a)));
}

/** How far each weapon is heard, relative to the bot's hearing range. */
const LOUDNESS = { pistol: 0.7, rifle: 1.0, shotgun: 1.05, sniper: 1.35, rocket: 1.25 };
Object.assign(LOUDNESS, { smg: 0.9, rail: 1.3, arc: 0.9, gale: 1.1 });

/**
 * Owns every bot in a match: spawning with unique names / colors / teams, per-frame updates,
 * separation between bots, shared hearing events, a per-frame path-finding budget, and the
 * per-map cover / sniping spots computed in `prepare`.
 */
export class BotManager {
  /** @param {object} game */
  constructor(game) {
    this.game = game;
    this._bots = [];
    /** Map-specific tactical spots: { cover: [{pos}], snipe: [{pos}] }. */
    this.spots = { cover: [], snipe: [] };
    this._pathBudgetMs = 0;
    /** Path-finding statistics (requests, total / worst milliseconds) for diagnostics. */
    this.pathStats = { count: 0, totalMs: 0, maxMs: 0 };
    this._rot = 0;
    this.frameCount = 0;
    /** Camera position / forward direction, refreshed each update (animation LOD). */
    this.camPos = new THREE.Vector3();
    this.camFwd = new THREE.Vector3(0, 0, -1);
    this._errors = new Map();
  }

  /** Subscribe to the shared events bots react to. */
  init() {
    const ev = this.game.events;
    ev.on('weapon:fire', e => this._onFire(e));
    ev.on('explosion', e => this._onExplosion(e));
    ev.on('damage', e => this._onDamage(e));
  }

  /** @returns {Bot[]} */
  get list() {
    return this._bots;
  }

  /**
   * Precompute map-specific data (cover and sniping spots) from the nav graph. Runs once per match start.
   * @param {object} world
   */
  async prepare(world) {
    const spots = { cover: [], snipe: [] };
    this.spots = spots;
    const nav = world && world.nav;
    const col = world && world.collision;
    if (!col) return;

    // candidate positions: nav nodes (sampled), or spawn points / pickups when there is no graph
    const cand = [];
    const nodes = nav && nav.nodes;
    if (nodes && nodes.length > 0) {
      const step = Math.max(1, Math.floor(nodes.length / 360));
      const off = (Math.random() * step) | 0;
      for (let i = off; i < nodes.length; i += step) {
        const p = asPos(nav, nodes[i]);
        if (p) cand.push(p);
      }
    } else {
      for (const s of world.spawnPoints || []) cand.push(s.position);
      const pk = world.pickups && world.pickups.list;
      if (pk) for (const p of pk) cand.push(p.position);
    }

    const scored = [];
    let lastYield = performance.now();
    for (let i = 0; i < cand.length; i++) {
      const p = cand[i];
      _o.set(p.x, p.y + 1.3, p.z);
      let near = 0, far = 0, sum = 0;
      for (let k = 0; k < RAY_DIRS.length; k++) {
        const hit = col.raycast(_o, RAY_DIRS[k], 60);
        const dist = hit ? hit.distance : 60;
        sum += dist;
        if (dist < 2.6) near++;
        if (dist > 38) far++;
      }
      // cover: hugging obstacles on some sides but not boxed in
      if (near >= 2 && near <= 5) spots.cover.push({ pos: p.clone(), near });
      if (far >= 3) scored.push({ pos: p.clone(), score: sum + p.y * 4 });
      if (performance.now() - lastYield > 40) {
        await new Promise(r => setTimeout(r, 0));
        lastYield = performance.now();
      }
    }
    if (spots.cover.length > 200) {
      // keep an even spread
      const keep = [];
      const s = spots.cover.length / 200;
      for (let i = 0; i < 200; i++) keep.push(spots.cover[Math.floor(i * s)]);
      spots.cover = keep;
    }
    scored.sort((a, b) => b.score - a.score);
    spots.snipe = scored.slice(0, 24);
  }

  /**
   * Create bots and register them with the game. FFA: team = entity id, distinct colors.
   * TDM: teams alternate red(2), blue(1), ... with team colors.
   * @param {number} count
   * @param {string} difficulty 'easy' | 'normal' | 'hard' | 'insane'
   * @param {string} mode 'ffa' | 'tdm' | 'escalation' | 'koth' (team modes alternate red / blue, the others are free-for-all)
   * @returns {Bot[]}
   */
  spawnBots(count, difficulty = 'normal', mode = 'ffa') {
    const game = this.game;
    const diff = DIFFICULTIES.includes(difficulty) ? difficulty : 'normal';
    const names = BOT_NAMES.slice();
    for (let i = names.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [names[i], names[j]] = [names[j], names[i]];
    }
    const out = [];
    for (let i = 0; i < count; i++) {
      const bot = new Bot(game);
      game.addEntity(bot);
      let team, color;
      if (isTeamMode(mode)) {
        team = i % 2 === 0 ? TEAM_RED : TEAM_BLUE;
        color = TEAM_COLORS[team];
      } else {
        team = bot.id;
        color = BOT_COLORS[i % BOT_COLORS.length];
      }
      const name = i < names.length ? names[i] : `${names[i % names.length]} ${Math.floor(i / names.length) + 1}`;
      bot.setup({ name, color, team, difficulty: diff });
      this._bots.push(bot);
      out.push(bot);
    }
    return out;
  }

  /** Remove every bot (models leave the scene, entities are unregistered). */
  clear() {
    for (const bot of this._bots) {
      this.game.removeEntity(bot);
      bot.dispose();
    }
    this._bots.length = 0;
  }

  /**
   * Path-finding budget shared by all bots: true while this frame still has time left for a request
   * (a request may overshoot; the next ones then wait for the next frame). Keeps A* spikes flat.
   */
  consumePathBudget() {
    return this._pathBudgetMs > 0;
  }

  /** Bots report how long a path request took so the frame budget can be charged. @param {number} ms */
  reportPathTime(ms) {
    this._pathBudgetMs -= ms;
    const s = this.pathStats;
    s.count++;
    s.totalMs += ms;
    if (ms > s.maxMs) s.maxMs = ms;
  }

  /** @param {number} dt seconds */
  update(dt) {
    const bots = this._bots;
    const n = bots.length;
    if (n === 0) return;
    this._pathBudgetMs = PATH_BUDGET_MS;
    this.frameCount++;
    // camera reference for animation level-of-detail (bots far away / behind the camera animate at a lower rate)
    const cam = this.game.camera;
    if (cam) {
      this.camPos.copy(cam.position);
      cam.getWorldDirection(this.camFwd);
    }
    const start = this._rot++ % n;
    for (let k = 0; k < n; k++) {
      const bot = bots[(start + k) % n];
      if (!bot.alive) continue;
      try {
        bot.update(dt);
      } catch (err) {
        const key = String(err && err.message);
        const c = (this._errors.get(key) || 0) + 1;
        this._errors.set(key, c);
        if (c <= 3 || c % 300 === 0) console.error(`[bots] ${bot.name} update failed (x${c}):`, err);
      }
    }
    this._separate();
  }

  /** Soft push so bots (and bots vs. the player) do not stand inside each other. */
  _separate() {
    const bots = this._bots;
    const player = this.game.player;
    const R = SEPARATION_RADIUS;
    for (let i = 0; i < bots.length; i++) {
      const a = bots[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < bots.length; j++) {
        const b = bots[j];
        if (!b.alive) continue;
        const dx = b.position.x - a.position.x;
        const dz = b.position.z - a.position.z;
        const d2 = dx * dx + dz * dz;
        if (d2 >= R * R || Math.abs(b.position.y - a.position.y) > 1.6) continue;
        const d = Math.sqrt(d2);
        const push = (R - d) / R * 3.2;
        let nx, nz;
        if (d < 0.01) {
          nx = Math.random() - 0.5; nz = Math.random() - 0.5;
          const l = Math.hypot(nx, nz) || 1;
          nx /= l; nz /= l;
        } else {
          nx = dx / d; nz = dz / d;
        }
        a._pushX -= nx * push; a._pushZ -= nz * push;
        b._pushX += nx * push; b._pushZ += nz * push;
      }
      if (player && player.alive && !this.game.spectate) {
        const dx = a.position.x - player.position.x;
        const dz = a.position.z - player.position.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < R * R && Math.abs(a.position.y - player.position.y) < 1.6) {
          const d = Math.sqrt(d2) || 0.01;
          const push = (R - d) / R * 2.5;
          a._pushX += (dx / d) * push;
          a._pushZ += (dz / d) * push;
        }
      }
    }
  }

  // ------------------------------------------------------------------ shared events

  _onFire(e) {
    if (!e || !e.shooter || !e.origin) return;
    const loud = LOUDNESS[e.weapon] ?? 1;
    const bots = this._bots;
    for (let i = 0; i < bots.length; i++) {
      const b = bots[i];
      if (b.alive && b !== e.shooter) b.brain.onSound(e.origin, e.shooter, loud);
    }
  }

  _onExplosion(e) {
    if (!e || !e.owner || !e.position) return;
    const bots = this._bots;
    for (let i = 0; i < bots.length; i++) {
      const b = bots[i];
      if (b.alive && b !== e.owner) b.brain.onSound(e.position, e.owner, 1.3);
    }
  }

  _onDamage(e) {
    if (!e) return;
    const { target, attacker } = e;
    if (target && target.isBot && target.alive && target.brain) target.brain.onDamaged(attacker);
    if (attacker && attacker.isBot && target !== attacker) attacker.stats.damage += e.amount || 0;
  }
}

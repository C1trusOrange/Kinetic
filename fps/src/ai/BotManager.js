import * as THREE from 'three';
import { BOT_NAMES, BOT_COLORS, TEAM_COLORS, TEAM_BLUE, TEAM_RED } from '../core/constants.js';
import { DIFFICULTIES, isTeamMode } from '../core/constants.js';
import { Bot } from './Bot.js';
import { asPos } from './BotConfig.js';
import { pullFromEdges } from './BotNav.js';
import { BotShadowCaster, BotOutlines } from './BotModel.js';
import { WEAPON_ORDER } from '../weapons/WeaponDefs.js';

const _o = new THREE.Vector3();
const SEPARATION_RADIUS = 0.95;
/**
 * Path-finding milliseconds per frame, shared by all bots. Enforced inside the searches (see servicePaths), so a
 * frame's path work stays below this plus one bounded unit of work (a request's start-up lookups, one string-pulling
 * line test or one waypoint's ledge probes: well under 1 ms). Bots need ~0.05 ms per frame on average, so the budget
 * only spreads the rare long request (up to ~7 ms of work) over a few frames.
 */
const PATH_BUDGET_MS = 1.5;
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
    /** Path requests (BotNav) waiting for / holding the path budget, served first in first out. */
    this._pathQueue = [];
    /** Path work done in the current frame (ms). */
    this._pathFrameMs = 0;
    /**
     * Path-finding statistics for diagnostics: count = finished requests, totalMs = all path work, maxMs = the most
     * path work in one frame (= maxFrameMs), maxJobMs = the most work one request needed (spread over frames),
     * maxQueue = the longest queue seen.
     */
    this.pathStats = { count: 0, totalMs: 0, maxMs: 0, maxFrameMs: 0, maxJobMs: 0, maxQueue: 0 };
    this._rot = 0;
    this.frameCount = 0;
    /** Camera position / forward direction, refreshed each update (animation LOD). */
    this.camPos = new THREE.Vector3();
    this.camFwd = new THREE.Vector3(0, 0, -1);
    this._errors = new Map();
    /** Every bot's shadow drawn as ~12 instanced meshes (see BotShadowCaster); added to the scene in spawnBots. */
    this.shadows = new BotShadowCaster({ renderer: game.renderer });
    /** Outlines around enemy bots (settings enemyOutline / outlineColor); added to the scene in spawnBots. */
    this.outlines = new BotOutlines();
    if (game.settings) {
      this.outlines.setEnabled(game.settings.get('enemyOutline') !== false);
      this.outlines.setColor(game.settings.get('outlineColor'));
    }
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
    this._warmPaths(world);
  }

  /**
   * JIT warm-up of the path finder during loading: a few complete requests between random nodes of the main area
   * (plus the goal pickers the brain calls between them), so the first requests of the match run optimised code
   * (interpreted, one string-pulling line test alone can take milliseconds, which made the first path frame of a
   * match the slowest one).
   */
  _warmPaths(world) {
    const nav = world && world.nav;
    if (!nav || typeof nav.createPathJob !== 'function' || !nav.nodes || nav.nodes.length < 2) return;
    const t0 = performance.now();
    let job;
    for (let i = 0; i < 16 && performance.now() - t0 < 80; i++) {
      const a = nav.randomNode(), b = nav.randomNode();
      if (!a || !b) break;
      job = nav.createPathJob(a.position, b.position, job, { connect: true });
      nav.stepPath(job, Infinity);
      if (job.result && world.collision) pullFromEdges(world.collision, job.result);
      nav.isConnected(a.position, b.position);
      if (typeof nav.randomPointNear === 'function') nav.randomPointNear(a.position, 11);
    }
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
      // every weapon model up front: a respawn / pickup never builds one mid-match
      bot.prebuildWeaponModels();
      if (bot.model) {
        this.shadows.add(bot.model);
        // enemies only: in team modes the player's own team gets no line (the team is read per frame)
        this.outlines.add(bot.model, () => !game.player || bot.team !== game.player.team);
      }
      this._bots.push(bot);
      out.push(bot);
    }
    if (out.length) {
      for (const id of WEAPON_ORDER) {
        const w = out[0].spareWeaponModel(id);
        if (w) this.shadows.prepareWeapon(w.root);
      }
      // (re)added last: their matrix updates copy the bots' part matrices, refreshed earlier in the same traversal
      game.scene.add(this.shadows.root);
      game.scene.add(this.outlines.root);
    }
    return out;
  }

  /** Remove every bot (models leave the scene, entities are unregistered). */
  clear() {
    this._pathQueue.length = 0;
    this.shadows.clear();
    this.outlines.clear();
    for (const bot of this._bots) {
      this.game.removeEntity(bot);
      bot.dispose();
    }
    this._bots.length = 0;
  }

  /**
   * Objects Game.warmup adds to the world scene while the match loads, so their shader programs compile and their
   * buffers / textures upload before play (removed again afterwards): one spare batched weapon model per weapon kind,
   * the hit-flash materials of every bot colour and one set of death gibs.
   * @returns {{world: THREE.Object3D[]}}
   */
  prewarmObjects() {
    const world = [];
    const bots = this._bots;
    if (!bots.length) return { world };
    for (const id of WEAPON_ORDER) {
      for (const b of bots) {
        const w = b.spareWeaponModel(id);
        if (w) { world.push(w.root); break; }
      }
    }
    const sets = new Set();
    for (let i = 0; i < bots.length; i++) {
      const m = bots[i].model;
      if (!m || sets.has(m._set)) continue;
      sets.add(m._set);
      world.push(...m.prewarmMeshes(sets.size === 1));
    }
    return { world };
  }

  // ------------------------------------------------------------------ path budget

  /**
   * Queue a bot's path request (BotNav) and serve the queue right away while this frame's path budget lasts, so a
   * cheap request still completes in the frame it was made. The rest continues in the next frames' budgets.
   * @param {import('./BotNav.js').BotNav} nav
   */
  queuePath(nav) {
    const q = this._pathQueue;
    if (q.indexOf(nav) < 0) q.push(nav);
    if (q.length > this.pathStats.maxQueue) this.pathStats.maxQueue = q.length;
    this.servicePaths();
  }

  /** Remove a request from the queue (the bot cleared its goal / died). @param {import('./BotNav.js').BotNav} nav */
  cancelPath(nav) {
    const i = this._pathQueue.indexOf(nav);
    if (i >= 0) this._pathQueue.splice(i, 1);
  }

  /**
   * Advance the queued path requests, first in first out, until the queue is empty or this frame's budget
   * (PATH_BUDGET_MS) is spent. The deadline is checked inside the A* expansion loop, between the string-pulling line
   * tests and between waypoints of the ledge pull, so no single request can stall a frame.
   */
  servicePaths() {
    const q = this._pathQueue;
    if (q.length === 0 || this._pathFrameMs >= PATH_BUDGET_MS) return;
    const s = this.pathStats;
    const t0 = performance.now();
    const deadline = t0 + (PATH_BUDGET_MS - this._pathFrameMs);
    let t = t0;
    while (q.length > 0) {
      const nav = q[0];
      let done = true;
      try {
        done = nav.stepPath(deadline);
      } catch (err) {
        console.error('[bots] path request failed', err);
        nav._dropRequest();
      }
      const now = performance.now();
      nav.reqWorkMs += now - t;
      t = now;
      if (!done) break;
      if (q[0] === nav) q.shift();
      s.count++;
      if (nav.reqWorkMs > s.maxJobMs) s.maxJobMs = nav.reqWorkMs;
      if (now >= deadline) break;
    }
    const ms = t - t0;
    this._pathFrameMs += ms;
    s.totalMs += ms;
    if (this._pathFrameMs > s.maxFrameMs) s.maxFrameMs = s.maxMs = this._pathFrameMs;
  }

  /** True while this frame still has path budget left (legacy helper; requests go through queuePath). */
  consumePathBudget() {
    return this._pathFrameMs < PATH_BUDGET_MS;
  }

  /** Charge path work done outside servicePaths to this frame's budget (legacy helper). @param {number} ms */
  reportPathTime(ms) {
    this._pathFrameMs += ms;
    const s = this.pathStats;
    s.totalMs += ms;
    if (this._pathFrameMs > s.maxFrameMs) s.maxFrameMs = s.maxMs = this._pathFrameMs;
  }

  /** @param {number} dt seconds */
  update(dt) {
    const bots = this._bots;
    const n = bots.length;
    this._pathFrameMs = 0;
    if (n === 0) return;
    this.servicePaths();   // requests still running from the previous frames first
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

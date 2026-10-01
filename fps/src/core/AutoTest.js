import * as THREE from 'three';
import { ARSENAL_PRESETS, resolveArsenal } from '../ai/BotConfig.js';

/** ?arsenal= value: a preset id (balanced|norockets|classic|chaos) or `weapon:level,...` (missing weapons keep the default). */
function parseArsenalParam(v) {
  if (!v) return undefined;
  const preset = ARSENAL_PRESETS.find(p => p.id === v.trim().toLowerCase());
  if (preset) return preset.arsenal;
  const out = {};
  for (const part of v.split(',')) {
    const [k, lv] = part.split(':');
    if (k && lv) out[k.trim().toLowerCase()] = lv.trim();
  }
  return out;
}

/**
 * Automated smoke test, enabled with ?autotest=1. Starts a match immediately and drives the
 * player through a scripted sequence (movement, every weapon, grenade, grapple, melee) using
 * virtual input, while collecting a report in window.__TEST__ for the headless harness
 * (tools/run.py).
 *
 * URL params:
 *   map=<id>  bots=<n>  mode=ffa|tdm|escalation|koth  diff=<difficulty>  duration=<seconds, default 20>
 *   score=<score limit, default 0 = none (Escalation / koth: ladder / points)>  time=<time limit in minutes, default 0 = none>
 *   arsenal=<balanced|norockets|classic|chaos | rocket:off,rifle:common,...>  (bot spawn weapons; default = saved setting)
 *   god=1 (player invulnerable)  script=full|idle  spectate=1 (chase-cam a bot, no player)
 *   cam=x,y,z,yaw,pitch (fixed camera)  quality=auto|low|medium|high|ultra (default high)
 *   mapfile=<path.js> (custom test map module, default export = map definition)
 *   scenario=<path.js> (module exporting drive(t, dt, game, report), optional setup(game, report) / finish(game, report);
 *                       replaces the built-in script; write custom results into report.custom)
 */
export class AutoTest {
  constructor(game, params) {
    this.game = game;
    this.params = params;
    this.duration = parseFloat(params.get('duration') || '20');
    this.script = params.get('script') || (params.has('spectate') || params.has('cam') ? 'idle' : 'full');
    this.t = 0;
    this._lastPlayerPos = new THREE.Vector3();
    this._botLast = new Map();
    this._fpsSum = 0;
    this._fpsN = 0;
    this.report = {
      done: false,
      started: false,
      t: 0,
      frames: 0,
      fps: { avg: 0, min: 1e9, max: 0 },
      errors: window.__ERRORS__ || [],
      map: null,
      player: {
        distance: 0, maxSpeed: 0, minY: 1e9, maxY: -1e9, states: {},
        shots: 0, kills: 0, deaths: 0, damageDealt: 0, damageTaken: 0,
      },
      bots: [],
      events: { damage: 0, death: 0, spawn: 0, pickup: 0, fire: 0 },
      renderer: {},
    };
    window.__TEST__ = this.report;
  }

  async start() {
    const g = this.game, p = this.params, r = this.report;
    g.events.on('damage', e => {
      r.events.damage++;
      if (e.attacker === g.player && e.target !== g.player) r.player.damageDealt += e.amount;
      if (e.target === g.player) r.player.damageTaken += e.amount;
    });
    g.events.on('death', e => {
      r.events.death++;
      if (e.attacker === g.player && e.victim !== g.player) r.player.kills++;
      if (e.victim === g.player) r.player.deaths++;
    });
    g.events.on('spawn', () => r.events.spawn++);
    g.events.on('pickup', () => r.events.pickup++);
    g.events.on('weapon:fire', e => {
      r.events.fire++;
      if (e && e.shooter === g.player) r.player.shots++;
    });

    let mapId = p.get('map') || 'foundry';
    if (p.get('mapfile')) {
      // custom test map: a module default-exporting a map definition (path relative to project root)
      const mod = await import('/' + p.get('mapfile').replace(/^\/+/, ''));
      if (!g.maps.includes(mod.default)) g.maps.push(mod.default);
      mapId = mod.default.id;
    }
    if (p.get('scenario')) {
      // custom scenario: module exporting drive(t, dt, game, report) and optionally setup(game, report) / finish(game, report)
      this.scenario = await import('/' + p.get('scenario').replace(/^\/+/, ''));
    }

    await g.startMatch({
      mapId,
      mode: p.get('mode') || 'ffa',
      botCount: parseInt(p.get('bots') ?? '5', 10),
      difficulty: p.get('diff') || 'normal',
      scoreLimit: parseInt(p.get('score') ?? '0', 10) || 0,
      timeLimit: parseFloat(p.get('time') ?? '0') || 0,
      arsenal: parseArsenalParam(p.get('arsenal')),
    });
    r.arsenal = resolveArsenal(g);
    if (p.has('god')) g.player.god = true;
    r.map = g.world.mapId;
    if (this.scenario && this.scenario.setup) await this.scenario.setup(g, r);
    r.started = true;
    this._lastPlayerPos.copy(g.player.position);
  }

  /** Called by Game.update before the player updates. */
  update(dt) {
    const g = this.game, r = this.report;
    this.t += dt;
    r.t = +this.t.toFixed(2);
    if (this.scenario && this.scenario.drive) this.scenario.drive(this.t, dt, g, r);
    else if (this.script === 'full') this._drive(this.t, dt);

    const pl = g.player;
    if (pl.alive) {
      const d = pl.position.distanceTo(this._lastPlayerPos);
      if (d < 5) r.player.distance += d;
      this._lastPlayerPos.copy(pl.position);
      r.player.maxSpeed = Math.max(r.player.maxSpeed, Math.hypot(pl.velocity.x, pl.velocity.z));
      r.player.minY = Math.min(r.player.minY, pl.position.y);
      r.player.maxY = Math.max(r.player.maxY, pl.position.y);
      for (const k of ['isSprinting', 'isCrouching', 'isSliding', 'isWallRunning', 'isGrappling', 'isMantling', 'onGround']) {
        if (pl[k]) r.player.states[k] = true;
      }
      if (!pl.onGround) r.player.states.airborne = true;
    } else {
      this._lastPlayerPos.copy(pl.position);
    }

    for (const b of g.bots.list) {
      let rec = this._botLast.get(b);
      if (!rec) { rec = { pos: b.position.clone(), dist: 0 }; this._botLast.set(b, rec); }
      if (b.alive) {
        const d = b.position.distanceTo(rec.pos);
        if (d < 5) rec.dist += d;
      }
      rec.pos.copy(b.position);
    }

    if (this.t >= this.duration && !r.done) this.finish();
  }

  /** Called every rendered frame (even when not simulating). */
  frame(rawDt) {
    const r = this.report;
    r.frames++;
    const info = this.game.renderer.info;
    this._renderStats = { calls: info.render.calls, triangles: info.render.triangles };
    if (!r.started || rawDt <= 0) return;
    const fps = 1 / rawDt;
    this._fpsSum += fps;
    this._fpsN++;
    if (r.frames > 10) {
      r.fps.min = Math.min(r.fps.min, fps);
      r.fps.max = Math.max(r.fps.max, fps);
    }
  }

  _drive(t, dt) {
    const g = this.game, inp = g.input;
    const S = (a, b) => t >= a && t < b;
    inp.setVirtual('forward', S(1, 9.5) || S(12, 19.6));
    inp.setVirtual('sprint', S(1.3, 4.2) || S(14, 16) || S(17.2, 17.7));
    inp.setVirtual('jump', S(2.4, 2.5) || S(2.9, 3.0) || S(10.45, 10.55) || S(13.6, 13.7) || S(15.2, 15.3));
    inp.setVirtual('crouch', S(3.6, 4.4) || S(17.6, 18.4));
    inp.setVirtual('ads', S(5.6, 6.4));
    inp.setVirtual('fire', S(4.8, 6.4) || S(7.0, 7.05) || S(7.35, 7.4) || S(7.7, 7.75) || S(8.3, 8.35)
      || S(9.6, 9.65) || S(10.5, 10.55) || S(17.8, 18.5) || S(18.9, 19.6));
    inp.setVirtual('reload', S(6.5, 6.55));
    inp.setVirtual('weapon1', S(6.8, 6.85));
    inp.setVirtual('weapon3', S(8.0, 8.05));
    if (t >= 9.0 && !this._gave) {
      this._gave = true;
      g.weapons.giveWeapon('sniper');
      g.weapons.giveWeapon('rocket');
      g.weapons.giveWeapon('smg');
      g.weapons.giveWeapon('rail');
    }
    inp.setVirtual('weapon4', S(9.1, 9.15));
    inp.setVirtual('weapon5', S(10.0, 10.05));
    inp.setVirtual('grenade', S(11.0, 11.6));
    inp.setVirtual('weapon2', S(11.8, 11.85));
    inp.setVirtual('grapple', S(12.3, 12.35) || S(13.5, 13.55));
    inp.setVirtual('melee', S(16.5, 16.55));
    inp.setVirtual('weapon6', S(17.0, 17.05));                       // Slipstream: sprint -> slide -> fire while sliding
    inp.setVirtual('weapon8', S(18.6, 18.65));                       // Javelin: hold fire to charge, release

    // look script, in mouse counts per second (+x = turn right, +y = look down)
    let lx = 0, ly = 0;
    if (S(4.8, 6.4)) lx = 250;
    if (S(10.2, 10.45)) ly = 2400;
    if (S(10.7, 10.95)) ly = -2400;
    if (S(12.0, 12.3)) ly = -800;
    if (S(13.8, 14.1)) ly = 800;
    if (S(14, 17)) lx = 140;
    inp.addLook(lx * dt, ly * dt);
  }

  finish() {
    const g = this.game, r = this.report;
    r.bots = g.bots.list.map(b => ({
      name: b.name,
      alive: b.alive,
      kills: b.kills,
      deaths: b.deaths,
      health: Math.round(b.health),
      weapon: b.weaponId ?? null,
      state: (b.brain && b.brain.state) ?? b.state ?? null,
      distance: +((this._botLast.get(b) || { dist: 0 }).dist.toFixed(1)),
      pos: b.position.toArray().map(v => +v.toFixed(1)),
    }));
    const info = g.renderer.info;
    const rs = this._renderStats || { calls: 0, triangles: 0 };
    r.renderer = {
      calls: rs.calls,
      triangles: rs.triangles,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      programs: info.programs ? info.programs.length : null,
      // render pipeline (quality preset, drawing buffer, composer MSAA, low latency limiter, adapter)
      quality: g.quality ? g.quality.name : null,
      pixelRatio: +g.renderer.getPixelRatio().toFixed(3),
      buffer: [g.renderer.getContext().drawingBufferWidth, g.renderer.getContext().drawingBufferHeight],
      msaa: g.composer ? g.composer.renderTarget1.samples : null,
      lowLatency: !!(g.frameLimiter && g.frameLimiter.enabled),
      limiter: g.frameLimiter ? { ...g.frameLimiter.stats } : null,
      gpu: g.gpu ? g.gpu.name : null,
    };
    r.fps.avg = +(this._fpsSum / Math.max(1, this._fpsN)).toFixed(1);
    r.fps.min = +r.fps.min.toFixed(1);
    r.fps.max = +r.fps.max.toFixed(1);
    r.player.distance = +r.player.distance.toFixed(1);
    r.player.maxSpeed = +r.player.maxSpeed.toFixed(2);
    if (this.scenario && this.scenario.finish) {
      try { this.scenario.finish(g, r); } catch (err) { console.error('[autotest] scenario.finish threw', err); }
    }
    r.done = true;
    r.ok = r.errors.length === 0;
    console.log('[autotest] finished', JSON.stringify({ ok: r.ok, errors: r.errors.length, fps: r.fps.avg }));
  }
}

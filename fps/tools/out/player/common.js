// Shared helpers for the player movement scenarios.
import * as THREE from 'three';

export const ACTIONS = ['forward', 'back', 'left', 'right', 'jump', 'crouch', 'sprint', 'fire', 'ads', 'reload', 'grenade', 'grapple', 'melee'];

/** Teleport the player (feet position) with zero velocity and given look angles. */
export function teleport(game, x, y, z, yaw = 0, pitch = 0) {
  const p = game.player;
  p.velocity.set(0, 0, 0);
  p.yaw = yaw;
  p.pitch = pitch;
  p.move.reset();
  p.grapple.reset();
  p.move.place(new THREE.Vector3(x, y, z));
  p.prevPosition.copy(p.position);
  p._acc = 0;
}

export function releaseAll(game) {
  for (const a of ACTIONS) game.input.setVirtual(a, false);
}

export function keys(game, obj) {
  for (const [k, v] of Object.entries(obj)) game.input.setVirtual(k, !!v);
}

/**
 * Sequential phase runner. Each phase: { name, dur, start(game, R, ctx), tick(lt, dt, game, R, ctx), end(game, R, ctx) }.
 * R is report.custom. ctx is a per-phase scratch object.
 */
export function makeScenario(allPhases, opts = {}) {
  const only = new URLSearchParams(location.search).get('only');
  const phases = only ? allPhases.filter(p => only.split(',').includes(p.name)) : allPhases;
  let idx = -1;
  let phaseStart = 0;
  let ctx = null;
  const total = phases.reduce((s, p) => s + p.dur, 0);
  return {
    total,
    async setup(game, report) {
      report.custom = report.custom || {};
      game.player.god = true;
      game.autotest.duration = total + 0.3;
      if (opts.setup) await opts.setup(game, report.custom);
    },
    drive(t, dt, game, report) {
      const R = report.custom;
      let acc = 0;
      let want = -1;
      for (let i = 0; i < phases.length; i++) {
        if (t < acc + phases[i].dur) { want = i; break; }
        acc += phases[i].dur;
      }
      if (want !== idx) {
        if (idx >= 0 && phases[idx].end) phases[idx].end(game, R, ctx);
        idx = want;
        phaseStart = acc;
        ctx = {};
        releaseAll(game);
        if (idx >= 0 && phases[idx].start) phases[idx].start(game, R, ctx);
      }
      if (idx >= 0 && phases[idx].tick) phases[idx].tick(t - phaseStart, dt, game, R, ctx);
    },
    finish(game, report) {
      if (idx >= 0 && phases[idx] && phases[idx].end) phases[idx].end(game, report.custom, ctx);
      releaseAll(game);
      if (opts.finish) opts.finish(game, report.custom);
    },
  };
}

export const r2 = v => Math.round(v * 100) / 100;
export const hs = p => Math.hypot(p.velocity.x, p.velocity.z);

/** Record player events (jumps, landings, wall-runs, ...) into game.__log for the scenarios. */
export function installLog(game) {
  const p = game.player;
  game.__log = [];
  const wrap = name => {
    const o = p[name].bind(p);
    p[name] = (...a) => {
      game.__log.push({ t: game.time, ev: name.replace(/^_on/, ''), a: a[0], x: p.position.x, y: p.position.y, z: p.position.z, vx: p.velocity.x, vy: p.velocity.y, vz: p.velocity.z, speed: hs(p) });
      return o(...a);
    };
  };
  ['_onJump', '_onLand', '_onWallRunStart', '_onWallRunEnd', '_onMantle', '_onMantleEnd', '_onSlideStart', '_onSlideEnd'].forEach(wrap);
  game.events.on('player:grapple', e => game.__log.push({ t: game.time, ev: 'grapple', a: e.state, reason: e.reason, x: p.position.x, y: p.position.y, z: p.position.z, speed: hs(p) }));
}

export function evs(game, since, name) {
  return game.__log.filter(e => e.t >= since && (!name || e.ev === name));
}

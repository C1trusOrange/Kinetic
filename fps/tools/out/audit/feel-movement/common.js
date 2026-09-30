// Shared helpers for the feel-movement audit scenarios (scratch code, not part of the game).
import * as THREE from 'three';
import { MOVE } from '/src/player/MoveConfig.js';

// ?set=KEY=VAL|KEY=VAL applies MOVE tuning overrides at runtime (scratch experiments only)
{ const sp = new URLSearchParams(location.search).get('set'); if (sp) for (const kv of sp.split('|')) { const [k, v] = kv.split('='); MOVE[k] = parseFloat(v); } }


export const ACTIONS = ['forward', 'back', 'left', 'right', 'jump', 'crouch', 'sprint', 'fire', 'ads', 'reload', 'grenade', 'grapple', 'melee'];
export const r2 = v => Math.round(v * 100) / 100;
export const r3 = v => Math.round(v * 1000) / 1000;
export const DEG = 180 / Math.PI;
export const hs = p => Math.hypot(p.velocity.x, p.velocity.z);

export function teleport(game, x, y, z, yaw = 0, pitch = 0) {
  const p = game.player;
  p.velocity.set(0, 0, 0);
  p.yaw = yaw;
  p.pitch = pitch;
  p.move.reset();
  p.grapple.reset();
  p.move.place(new THREE.Vector3(x, y, z));
  p.prevPosition.copy(p.position);
  p.stepOffset.set(0, 0, 0);
  p._acc = 0;
  p.rig.landY = 0; p.rig.landV = 0; p.rig.trauma = 0; p.rig.fovKick = 0; p.rig.fovPunch = 0;
  p.rig.wallRoll = 0; p.rig.slideRoll = 0; p.rig.strafeRoll = 0;
}

export function releaseAll(game) { for (const a of ACTIONS) game.input.setVirtual(a, false); }
export function keys(game, obj) { for (const [k, v] of Object.entries(obj)) game.input.setVirtual(k, !!v); }

/** Sequential phase runner. Phase: {name, dur, start(g,R,c), tick(lt,dt,g,R,c), end(g,R,c)}. */
export function makeScenario(allPhases, opts = {}) {
  const only = new URLSearchParams(location.search).get('only');
  const phases = only ? allPhases.filter(p => only.split(',').includes(p.name)) : allPhases;
  let idx = -1, phaseStart = 0, ctx = null;
  const total = phases.reduce((s, p) => s + p.dur, 0);
  return {
    total,
    async setup(game, report) {
      report.custom = report.custom || {};
      game.player.god = true;
      game.autotest.duration = total + 0.3;
      installTrace(game);
      if (opts.setup) await opts.setup(game, report.custom);
    },
    drive(t, dt, game, report) {
      const R = report.custom;
      let acc = 0, want = -1;
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
        if (idx >= 0) {
          game.__trace.length = 0; game.__log.length = 0; game.__frames.length = 0;
          if (phases[idx].start) phases[idx].start(game, R, ctx);
          ctx.T0 = game.time;
        }
      }
      if (idx >= 0) {
        // frame-level camera sample (camera written by last frame's updateCamera)
        const p = game.player, cam = game.camera;
        game.__frames.push({ t: game.time, dt, fov: cam.fov, roll: cam.rotation.z, pitch: cam.rotation.x,
          cy: cam.position.y - p.position.y, landY: p.rig.landY, fovKick: p.rig.fovKick, fovPunch: p.rig.fovPunch,
          bobAmp: p.rig.bobAmp, trauma: p.rig.trauma });
        if (phases[idx].tick) phases[idx].tick(t - phaseStart, dt, game, R, ctx);
      }
    },
    finish(game, report) {
      if (idx >= 0 && phases[idx] && phases[idx].end) phases[idx].end(game, report.custom, ctx);
      releaseAll(game);
      if (opts.finish) opts.finish(game, report.custom);
    },
  };
}

/** Record every 120 Hz physics step and every player event into game.__trace / game.__log. */
export function installTrace(game) {
  const p = game.player, mv = p.move;
  game.__trace = [];
  game.__log = [];
  game.__frames = [];
  const orig = mv.step.bind(mv);
  mv.step = (dt) => {
    orig(dt);
    game.__trace.push({ t: mv.t, x: p.position.x, y: p.position.y, z: p.position.z,
      vx: p.velocity.x, vy: p.velocity.y, vz: p.velocity.z, st: mv.state, g: mv.grounded ? 1 : 0,
      sl: mv.sliding ? 1 : 0, wr: mv.wallRunning ? 1 : 0, cr: mv.crouched ? 1 : 0, sp: mv.sprinting ? 1 : 0, h: p.height });
  };
  const wrap = name => {
    const o = p[name].bind(p);
    p[name] = (...a) => {
      game.__log.push({ t: mv.t, gt: game.time, ev: name.replace(/^_on/, ''), a: a[0], x: p.position.x, y: p.position.y, z: p.position.z,
        vx: p.velocity.x, vy: p.velocity.y, vz: p.velocity.z, speed: hs(p) });
      return o(...a);
    };
  };
  ['_onJump', '_onLand', '_onWallRunStart', '_onWallRunEnd', '_onMantle', '_onMantleEnd', '_onSlideStart', '_onSlideEnd'].forEach(wrap);
  game.events.on('player:grapple', e => game.__log.push({ t: mv.t, gt: game.time, ev: 'grapple', a: e.state, reason: e.reason, x: p.position.x, y: p.position.y, z: p.position.z, vx: p.velocity.x, vy: p.velocity.y, vz: p.velocity.z, speed: hs(p) }));
}

export const evs = (game, name) => game.__log.filter(e => !name || e.ev === name);
export const tr = game => game.__trace;

export function stats(arr, f) {
  let mx = -Infinity, mn = Infinity;
  for (const s of arr) { const v = f(s); if (v > mx) mx = v; if (v < mn) mn = v; }
  return { min: r2(mn), max: r2(mx) };
}
/** time (s, relative to first sample) at which predicate first becomes true, else null */
export function firstT(arr, pred) {
  if (!arr.length) return null;
  const t0 = arr[0].t;
  for (const s of arr) if (pred(s)) return r2(s.t - t0);
  return null;
}

// Wall-running, wall-jumping, exploit checks.
import * as THREE from 'three';
import { teleport, keys, makeScenario, installLog, evs, r2, hs } from './common.js';

let T0 = 0;
const wr = (g) => {
  const st = evs(g, T0, 'WallRunStart')[0];
  const en = evs(g, T0, 'WallRunEnd')[0];
  return { st, en };
};

function report(g, c) {
  const { st, en } = wr(g);
  if (!st) return { ran: false };
  const endEv = en || { t: g.time, y: g.player.position.y, z: g.player.position.z, a: 'still running' };
  return {
    ran: true,
    startHeight: r2(st.y), endHeight: r2(endEv.y), sink: r2(st.y - endEv.y),
    duration: r2(endEv.t - st.t), distance: r2(Math.abs(endEv.z - st.z)),
    startSpeed: r2(st.speed), maxSpeed: r2(c.maxSpeed || 0), minSpeed: r2(c.minSpeed ?? 0),
    endReason: endEv.a, rollDegMid: r2((c.rollMid || 0) * 180 / Math.PI), sideMid: c.sideMid,
  };
}

function runPhase(name, x, opts = {}) {
  return {
    name, dur: opts.dur || 5,
    start(g, R, c) {
      teleport(g, x, 0, opts.z ?? 50, 0);
      T0 = g.time;
      c.maxSpeed = 0; c.minSpeed = 99;
    },
    tick(lt, dt, g, R, c) {
      const p = g.player;
      keys(g, {
        forward: lt > 0.15, sprint: lt > 0.15,
        jump: lt > 1.0 && lt < 1.05,
      });
      if (opts.tick) opts.tick(lt, dt, g, R, c);
      if (p.isWallRunning) {
        c.maxSpeed = Math.max(c.maxSpeed, p.speed);
        c.minSpeed = Math.min(c.minSpeed, p.speed);
        c.wrT = (c.wrT || 0) + dt;
        if (c.wrT > 0.7 && c.rollMid === undefined) { c.rollMid = g.camera.rotation.z; c.sideMid = p.wallRunSide; c.fovMid = g.camera.fov; }
      }
    },
    end(g, R, c) { R[name] = { ...report(g, c), ...(opts.extra ? opts.extra(g, c) : {}) }; },
  };
}

const phases = [
  runPhase('left_run', -9.2),
  runPhase('right_run', -4.8),
  { name: 'high_run', dur: 5,
    start(g, R, c) { teleport(g, -9.2, 8, 50, 0); g.player.velocity.set(0, 0, -9.6); T0 = g.time; c.maxSpeed = 0; c.minSpeed = 99; },
    tick(lt, dt, g, R, c) {
      keys(g, { forward: true, sprint: true });
      const p = g.player;
      if (p.isWallRunning) { c.maxSpeed = Math.max(c.maxSpeed, p.speed); c.minSpeed = Math.min(c.minSpeed, p.speed); }
    },
    end(g, R, c) { R.high_run = report(g, c); } },
  { ...runPhase('wall_jump', -9.2, {
      tick(lt, dt, g, R, c) {
        const p = g.player;
        if (p.isWallRunning) c.wrT2 = (c.wrT2 || 0) + dt;
        if (c.wrT2 > 0.5 && !c.jumped) { c.jumped = true; c.jf = 3; c.pre = { vx: p.velocity.x, vz: p.velocity.z, y: p.position.y }; }
        if (c.jf > 0) { g.input.setVirtual('jump', true); c.jf--; }
        const j = evs(g, T0, 'Jump').find(e => e.a === 'wall');
        if (j && !c.post) c.post = { vx: j.vx, vy: j.vy, vz: j.vz };
      },
      extra: (g, c) => ({ wallJumpEvent: !!c.post, before: c.pre, after: c.post,
        note: 'wall is on -x: away normal is +x, expected vx ~ +7.5, vy ~ 8.2 (before the step gravity), vz kept' }) }) },
  { ...runPhase('steer_away', -9.2, {
      tick(lt, dt, g, R, c) {
        const p = g.player;
        if (p.isWallRunning) c.a = (c.a || 0) + dt;
        // strafe away from the wall (right) after 0.4 s of running
        g.input.setVirtual('right', c.a > 0.4);
      } }) },
  { ...runPhase('crouch_exit', -9.2, {
      tick(lt, dt, g, R, c) {
        const p = g.player;
        if (p.isWallRunning) c.a = (c.a || 0) + dt;
        g.input.setVirtual('crouch', c.a > 0.5);
      } }) },
  { name: 'tower_end', dur: 4,
    start(g, R, c) { teleport(g, 35.3, 20, 8.5, 0); g.player.velocity.set(0, 0, -9.6); T0 = g.time; c.maxSpeed = 0; c.minSpeed = 99; },
    tick(lt, dt, g, R, c) {
      keys(g, { forward: true, sprint: true });
      const p = g.player;
      if (p.isWallRunning) { c.maxSpeed = Math.max(c.maxSpeed, p.speed); c.minSpeed = Math.min(c.minSpeed, p.speed); }
    },
    end(g, R, c) { R.tower_end = report(g, c); } },
  { name: 'pingpong', dur: 14,
    start(g, R, c) { teleport(g, -7, 0, 55, 0); T0 = g.time; c.maxY = 0; c.n = 0; c.dir = -1; c.airStart = null; },
    tick(lt, dt, g, R, c) {
      const p = g.player;
      // always run forward, jump as often as possible, drift toward the far wall after each wall jump
      const wj = evs(g, T0, 'Jump').filter(e => e.a === 'wall').length;
      if (wj !== c.n) { c.n = wj; c.dir = -c.dir; }
      keys(g, { forward: true, sprint: true, left: c.dir < 0, right: c.dir > 0, jump: Math.floor(lt / 0.16) % 2 === 0 });
      c.maxY = Math.max(c.maxY, p.position.y);
      if (p.onGround && lt > 1) c.landedAt = c.landedAt ?? lt;
    },
    end(g, R, c) {
      const jumps = evs(g, T0, 'Jump');
      R.pingpong = { maxHeight: r2(c.maxY), wallJumps: jumps.filter(e => e.a === 'wall').length, doubleJumps: jumps.filter(e => e.a === 'double').length, wallRuns: evs(g, T0, 'WallRunStart').length, firstLandingAt: r2(c.landedAt ?? -1), wallHeightLimit: 14 };
    } },
];

const S = makeScenario(phases, { setup: g => installLog(g) });
export const setup = S.setup;
export const drive = S.drive;
export const finish = S.finish;

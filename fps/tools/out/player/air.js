// Air movement: bhop / buffer / coyote / air strafing / launch / knockback / high speed collisions.
import * as THREE from 'three';
import { teleport, keys, makeScenario, installLog, evs, r2, hs } from './common.js';

let T0 = 0;

const phases = [
  { name: 'bhop', dur: 8,
    start(g, R, c) { teleport(g, 2, 0, 58, 0); T0 = g.time; c.was = true; c.speeds = []; },
    tick(lt, dt, g, R, c) {
      const p = g.player;
      const near = !p.onGround && p.velocity.y < -2 && p.position.y < 0.7;
      keys(g, { forward: lt > 0.1, sprint: lt > 0.1, jump: near || (p.onGround && lt > 1.2 && false) });
      if (p.onGround && !c.was && lt > 1) c.speeds.push(r2(hs(p)));
      c.was = p.onGround;
      if (lt > 1.0 && p.onGround && !c.started) { c.started = true; keys(g, { jump: true }); }
    },
    end(g, R, c) { R.bhop = { landingSpeeds: c.speeds, hops: evs(g, T0, 'Jump').length }; } },

  { name: 'airstrafe', dur: 10,
    start(g, R, c) { teleport(g, 2, 0, 58, 0); T0 = g.time; c.was = true; c.speeds = []; c.max = 0; c.dir = 1; c.hop = 0; },
    tick(lt, dt, g, R, c) {
      const p = g.player;
      const near = !p.onGround && p.velocity.y < -2 && p.position.y < 0.7;
      const air = !p.onGround;
      // turn the view while holding the matching strafe key (strafe jumping)
      if (air) p.yaw += c.dir * 1.5 * dt;
      keys(g, { forward: true, sprint: true, left: air && c.dir > 0, right: air && c.dir < 0, jump: near || (p.onGround && lt > 0.8) });
      if (p.onGround && !c.was) { c.hop++; c.dir = -c.dir; c.speeds.push(r2(hs(p))); }
      c.was = p.onGround;
      c.max = Math.max(c.max, hs(p));
      // keep in the open area: wrap the position back if we run too far
      if (p.position.z < -50 || Math.abs(p.position.x) > 6) { c.reset = (c.reset || 0) + 1; teleport(g, 2, 0, 58, 0); p.velocity.set(0, 0, -c.lastS || -9.6); }
      c.lastS = hs(p);
    },
    end(g, R, c) { R.airstrafe = { maxSpeed: r2(c.max), landingSpeeds: c.speeds, resets: c.reset || 0 }; } },

  { name: 'coyote', dur: 6,
    start(g, R, c) { teleport(g, 10, 2.6, -4, -Math.PI / 2); T0 = g.time; c.left = null; },
    tick(lt, dt, g, R, c) {
      const p = g.player;
      keys(g, { forward: lt > 0.1 && lt < 5 });
      if (!p.onGround && c.left === null && lt > 0.2) c.left = lt;
      const jump = c.left !== null && lt > c.left + 0.09 && lt < c.left + 0.14;
      g.input.setVirtual('jump', jump);
    },
    end(g, R, c) { const j = evs(g, T0, 'Jump'); R.coyote = { jumpType: j.length ? j[0].a : 'none', jumps: j.length }; } },

  { name: 'late_jump_is_double', dur: 6,
    start(g, R, c) { teleport(g, 10, 2.6, -4, -Math.PI / 2); T0 = g.time; c.left = null; },
    tick(lt, dt, g, R, c) {
      const p = g.player;
      keys(g, { forward: lt > 0.1 && lt < 5 });
      if (!p.onGround && c.left === null && lt > 0.2) c.left = lt;
      g.input.setVirtual('jump', c.left !== null && lt > c.left + 0.2 && lt < c.left + 0.25);
    },
    end(g, R, c) { const j = evs(g, T0, 'Jump'); R.late_jump = { jumpType: j.length ? j[0].a : 'none', leftAt: c.left, jumps: j.map(e => [r2(e.t - T0), e.a, r2(e.x), r2(e.y)]), events: g.__log.filter(e => e.t >= T0).map(e => [r2(e.t - T0), e.ev, e.a, r2(e.x), r2(e.y)]).slice(0, 12) }; } },

  { name: 'jump_buffer', dur: 3,
    start(g, R, c) { teleport(g, 2, 2, 50, 0); T0 = g.time; },
    tick(lt, dt, g, R, c) {
      // falls from 2 m: lands at ~0.41 s. press jump 0.07 s before landing
      g.input.setVirtual('jump', lt > 0.34 && lt < 0.4);
    },
    end(g, R, c) {
      const l = evs(g, T0, 'Land')[0], j = evs(g, T0, 'Jump')[0];
      R.jump_buffer = { landAt: l ? r2(l.t - T0) : null, jumpAt: j ? r2(j.t - T0) : null, type: j ? j.a : null };
    } },

  { name: 'launch_pad', dur: 4,
    start(g, R, c) { teleport(g, 2, 0, 50, 0); c.max = 0; c.done = false; },
    tick(lt, dt, g, R, c) {
      const p = g.player;
      if (lt > 0.3 && !c.done) { c.done = true; p.launch(new THREE.Vector3(0, 20, 0)); }
      c.max = Math.max(c.max, p.position.y);
    },
    end(g, R, c) { R.launch_pad = { peak: r2(c.max), expected: r2(400 / 48) }; } },

  { name: 'rocket_jump', dur: 4,
    start(g, R, c) { teleport(g, 2, 0, 50, 0); c.max = 0; c.done = false; },
    tick(lt, dt, g, R, c) {
      const p = g.player;
      if (lt > 0.3 && !c.done) { c.done = true; p.applyImpulse(new THREE.Vector3(3, 15, 0)); c.vx = 3; }
      if (c.done && !c.first) { c.first = { vx: r2(p.velocity.x), vy: r2(p.velocity.y), onGround: p.onGround }; }
      c.max = Math.max(c.max, p.position.y);
    },
    end(g, R, c) { R.rocket_jump = { peak: r2(c.max), expected: r2(225 / 48), first: c.first }; } },

  { name: 'fall_land', dur: 5,
    start(g, R, c) { teleport(g, 2, 30, 50, 0); c.maxFall = 0; T0 = g.time; },
    tick(lt, dt, g, R, c) { c.maxFall = Math.max(c.maxFall, -g.player.velocity.y); },
    end(g, R, c) { const l = evs(g, T0, 'Land')[0]; R.fall_land = { maxFallSpeed: r2(c.maxFall), landImpactEvent: l ? r2(l.a) : null, landImpactField: r2(g.player.landImpact), survived: g.player.alive }; } },

  { name: 'terminal', dur: 6,
    start(g, R, c) { teleport(g, 2, 90, 50, 0); c.maxFall = 0; },
    tick(lt, dt, g, R, c) { c.maxFall = Math.max(c.maxFall, -g.player.velocity.y); },
    end(g, R, c) { R.terminal = { maxFallSpeed: r2(c.maxFall), limit: 55 }; } },

  { name: 'thin_wall_60', dur: 2,
    start(g, R, c) { teleport(g, -50, 4, 0, Math.PI / 2); g.player.velocity.set(-60, 0, 0); c.minX = 0; },
    tick(lt, dt, g, R, c) { c.x = g.player.position.x; c.minX = Math.min(c.minX, c.x); },
    end(g, R, c) { R.thin_wall_60 = { finalX: r2(c.x), minX: r2(c.minX), tunnelled: c.minX < -70.5, wallAtX: -69.7 }; } },

  { name: 'thin_wall_150', dur: 2,
    start(g, R, c) { teleport(g, -50, 4, 0, Math.PI / 2); g.player.velocity.set(-150, 0, 0); c.minX = 0; },
    tick(lt, dt, g, R, c) { c.x = g.player.position.x; c.minX = Math.min(c.minX, c.x); },
    end(g, R, c) { R.thin_wall_150 = { finalX: r2(c.x), minX: r2(c.minX), tunnelled: c.minX < -70.5, wallAtX: -69.7 }; } },

  { name: 'thin_wall_ground', dur: 2,
    start(g, R, c) { teleport(g, -55, 0, 0, Math.PI / 2); g.player.launch(new THREE.Vector3(-70, 0.5, 0)); c.minX = 0; },
    tick(lt, dt, g, R, c) { c.x = g.player.position.x; c.minX = Math.min(c.minX, c.x); },
    end(g, R, c) { R.thin_wall_ground = { finalX: r2(c.x), minX: r2(c.minX), tunnelled: c.minX < -70.5 }; } },
];

const S = makeScenario(phases, { setup: g => installLog(g) });
export const setup = S.setup;
export const drive = S.drive;
export const finish = S.finish;

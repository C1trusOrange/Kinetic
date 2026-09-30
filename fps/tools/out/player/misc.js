// Grapple + mantle at the tower top, LOS release, respawn, misc regressions.
import * as THREE from 'three';
import { teleport, keys, makeScenario, installLog, evs, r2, hs } from './common.js';

let T0 = 0;
const phases = [
  { name: 'grapple_mantle', dur: 7,
    start(g, R, c) { teleport(g, 14, 0, 0, -Math.PI / 2, 0.83); T0 = g.time; c.maxY = 0; },
    tick(lt, dt, g, R, c) {
      const p = g.player;
      keys(g, { grapple: lt > 0.5 && lt < 0.55, forward: lt > 0.6 });
      c.maxY = Math.max(c.maxY, p.position.y);
      if (p.isMantling) c.mant = true;
      // keep holding forward; look slightly less steep once attached so the mantle faces the tower
    },
    end(g, R, c) {
      const p = g.player;
      R.grapple_mantle = { events: evs(g, T0).filter(e => ['grapple', 'Mantle', 'Land'].includes(e.ev)).map(e => [r2(e.t - T0), e.ev, e.a || '', r2(e.x), r2(e.y), r2(e.z)]), maxY: r2(c.maxY), final: p.position.toArray().map(r2) };
    } },

  { name: 'los_release', dur: 5,
    start(g, R, c) { teleport(g, 30, 0, 32, 0, 0.9); T0 = g.time; },
    tick(lt, dt, g, R, c) {
      const p = g.player;
      keys(g, { grapple: lt > 0.4 && lt < 0.45 });
      if (p.isGrappling && !c.tp) { c.tp = true; c.tpAt = lt; p.velocity.set(0, 0, 0); p.move.place(new THREE.Vector3(44.5, 8, -10)); p.move.grounded = false; }
      if (c.tp) { p.velocity.set(0, 0, 0); p.move.grounded = false; }
    },
    end(g, R, c) { const m = g.player.move; R.los_release = { mantle: { from: m.mantleFrom.toArray().map(r2), to: m.mantleTo.toArray().map(r2), H: r2(m.mantleHeight) }, teleportedAt: r2(c.tpAt ?? -1), events: evs(g, T0, 'grapple').map(e => [r2(e.t - T0), e.a, e.reason || '']) }; } },

  { name: 'respawn', dur: 8,
    start(g, R, c) { teleport(g, 2, 0, 50, 0); T0 = g.time; c.deaths = 0; },
    tick(lt, dt, g, R, c) {
      const p = g.player;
      if (lt > 1 && !c.killed) { c.killed = true; g.combat.kill(p, { attacker: null, weapon: 'fall' }); c.deadPos = p.position.toArray().map(r2); }
      if (!p.alive && !c.sawDead) c.sawDead = true;
      if (c.killed && p.alive && !c.respawnAt) { c.respawnAt = lt; c.spawnPos = p.position.toArray().map(r2); c.spawnY = g.camera.position.y - p.position.y; }
      if (c.respawnAt && lt > c.respawnAt + 0.3) keys(g, { forward: true, sprint: true });
      if (c.respawnAt && lt > c.respawnAt + 1.5 && !c.moved) c.moved = p.speed;
    },
    end(g, R, c) { R.respawn = { killed: c.killed, sawDead: c.sawDead, respawnedAt: r2(c.respawnAt ?? -1), spawnPos: c.spawnPos, camEyeHeightAboveFeet: r2(c.spawnY ?? -1), speedAfterRespawn: r2(c.moved || 0), health: g.player.health }; } },

  { name: 'crouch_jump_slide_land', dur: 6,
    start(g, R, c) { teleport(g, 2, 0, 55, 0); T0 = g.time; },
    tick(lt, dt, g, R, c) {
      // sprint, jump, hold crouch in the air, land into a slide
      keys(g, { forward: true, sprint: lt > 0.1, jump: lt > 1.5 && lt < 1.55, crouch: lt > 1.7 && lt < 3.5 });
    },
    end(g, R, c) { R.crouch_jump_slide = { slides: evs(g, T0, 'SlideStart').map(e => [r2(e.t - T0), e.a, r2(e.speed)]), lands: evs(g, T0, 'Land').map(e => [r2(e.t - T0), r2(e.a)]) }; } },
];

const S = makeScenario(phases, { setup: g => installLog(g) });
export const setup = S.setup;
export const drive = S.drive;
export const finish = S.finish;

// Screenshot scenarios: ?snap=grapple|grapple_fly|wallrun|wallrun_r|slide|death|mantle|air ; freezes the game and sets window.__SNAP.
import * as THREE from 'three';
import { teleport, keys, releaseAll } from './common.js';

const snap = new URLSearchParams(location.search).get('snap') || 'grapple';
let done = false;

export function setup(game, report) {
  report.custom = {};
  game.player.god = true;
  game.autotest.duration = 30;
  const p = game.player;
  switch (snap) {
    case 'grapple': case 'grapple_fly': teleport(game, 14, 0, 0, -Math.PI / 2, 0.83); break;
    case 'wallrun': teleport(game, -9.2, 8, 50, 0); p.velocity.set(0, 0, -9.6); break;
    case 'wallrun_r': teleport(game, -4.8, 8, 50, 0); p.velocity.set(0, 0, -9.6); break;
    case 'slide': teleport(game, 2, 0, 50, 0); break;
    case 'mantle': teleport(game, 3.5, 0, -28, -Math.PI / 2); break;
    case 'air': teleport(game, 2, 0, 20, 0); break;
    case 'death': teleport(game, 2, 0, 20, 0.3, 0.1); break;
  }
}

export function drive(t, dt, game, report) {
  if (done) return;
  const p = game.player;
  const freeze = () => { done = true; game.timeScale = 0; window.__SNAP = true; report.custom.snapAt = t; report.custom.pos = p.position.toArray(); };
  switch (snap) {
    case 'grapple':
      keys(game, { grapple: t > 0.5 && t < 0.55 });
      if (t > 1.5) freeze();
      break;
    case 'grapple_fly':
      keys(game, { grapple: t > 0.5 && t < 0.55 });
      if (t > 0.62) freeze();
      break;
    case 'wallrun': case 'wallrun_r':
      keys(game, { forward: true, sprint: true });
      if (p.isWallRunning && t > 0.4 + 0.9) freeze();
      if (t > 3) freeze();
      break;
    case 'slide':
      keys(game, { forward: t > 0.1, sprint: t > 0.1 && t < 1.5, crouch: t > 1.5 });
      if (t > 1.9) freeze();
      break;
    case 'mantle':
      keys(game, { forward: true, jump: p.position.x > 7.1 && p.position.x < 7.4 });
      if (p.isMantling && p.mantleProgress > 0.5) freeze();
      if (t > 4) freeze();
      break;
    case 'air':
      keys(game, { forward: t > 0.1, sprint: t > 0.1, jump: t > 1 && t < 1.05 });
      if (t > 1.35) freeze();
      break;
    case 'death':
      if (t > 0.3 && !report.custom.killed) {
        report.custom.killed = true;
        const killer = { alive: true, getChestPosition(o) { return o.set(-6, 1.3, 2); } };
        p.alive = false;
        p.onDeath({ attacker: killer, weapon: 'rifle', direction: new THREE.Vector3(1, 0, 0.2) });
      }
      if (t > 2.0) freeze();
      break;
  }
}

export function finish(game, report) { releaseAll(game); }

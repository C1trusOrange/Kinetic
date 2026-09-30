import * as THREE from 'three';
import { probeMove } from '/src/ai/BotNav.js';
const H = [0.15, 0.25, 0.32, 0.38, 0.5, 0.8, 1.1, 1.25];
const S = { curbs: [], ramps: [], phase: 0, t0: 0 };
const probe = { wall: false, step: false, ledge: false, wallDist: 0, drop: 0 };
export async function setup(game, report) {
  report.custom = S;
  for (const b of game.bots.list) { b.god = true; }
}
function place(b, x, y, z) {
  b.spawn(new THREE.Vector3(x, y, z), -Math.PI / 2); // yaw -90deg looks +x
  b.spawnProtectedUntil = 1e9;
  b._noSnapUntil = 0;
  b.brain.update = function (dt) {
    const it = this.intent;
    it.fire = false; it.reload = false; it.jump = false; it.crouch = false; it.weapon = null;
    it.moveX = 1; it.moveZ = 0; it.speed = 7.2;
    probeMove(this.game.world.collision, b.position, 1, 0, 1.5, probe);
    if (probe.step && b.onGround) it.jump = true;
    b.yaw = -Math.PI / 2;
  };
}
export function drive(t, dt, game) {
  const bots = game.bots.list;
  if (S.phase === 0 && t > 0.5) {
    for (let k = 0; k < 8; k++) {
      const b = bots[k]; if (!b) continue;
      place(b, -8, 0, -30 + k * 4);
      b._track = { k, h: H[k], maxX: -8, t0: t, stuckT: 0, crossedAt: null, minSpd: 99, jumps: 0 };
    }
    S.phase = 1; S.t0 = t;
  } else if (S.phase === 1) {
    for (const b of bots) {
      const tr = b._track; if (!tr) continue;
      if (b.position.x > tr.maxX) tr.maxX = b.position.x;
      if (b.position.x > 5 && tr.crossedAt === null) tr.crossedAt = +(t - tr.t0).toFixed(2);
      if (b.brain.intent.jump) tr.jumps++;
      if (b.speed < 1 && b.position.x < 0 && t - tr.t0 > 0.6) tr.stuckT += dt;
    }
    if (t > S.t0 + 4.5) {
      for (const b of bots) { const tr = b._track; if (!tr) continue; S.curbs.push({ h: tr.h, maxX: +tr.maxX.toFixed(2), crossedAt: tr.crossedAt, stuckT: +tr.stuckT.toFixed(2), jumps: tr.jumps, y: +b.position.y.toFixed(2) }); b._track = null; }
      S.phase = 2; S.t0 = t;
    }
  } else if (S.phase === 2) {
    // ramps
    for (let k = 0; k < 4; k++) {
      const b = bots[k];
      place(b, -8, 0, 6 + k * 5);
      b._track = { k, a: [25, 30, 35, 40][k], maxY: 0, t0: t, stuckT: 0, jumps: 0, maxX: -8 };
    }
    for (let k = 4; k < 8; k++) { if (bots[k]) { bots[k].brain.update = () => {}; bots[k].spawn(new THREE.Vector3(-30, 0, -35 + k), 0); } }
    S.phase = 3; S.t0 = t;
  } else if (S.phase === 3) {
    for (let k = 0; k < 4; k++) {
      const b = bots[k]; const tr = b._track; if (!tr) continue;
      tr.maxY = Math.max(tr.maxY, b.position.y); tr.maxX = Math.max(tr.maxX, b.position.x);
      if (b.speed < 1 && t - tr.t0 > 0.6) tr.stuckT += dt;
      if (b.brain.intent.jump) tr.jumps++;
    }
    if (t > S.t0 + 4.5) {
      for (let k = 0; k < 4; k++) { const b = bots[k]; const tr = b._track; S.ramps.push({ angle: tr.a, maxY: +tr.maxY.toFixed(2), maxX: +tr.maxX.toFixed(2), stuckT: +tr.stuckT.toFixed(2), jumps: tr.jumps, expectedTop: +(6 * Math.tan(tr.a * Math.PI / 180)).toFixed(2) }); }
      S.phase = 4;
    }
  }
}

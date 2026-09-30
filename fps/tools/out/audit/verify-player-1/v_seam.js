// Natural route: from the floor grapple the boundary wall at ~5 m (below the y=6 seam of the two stacked wall boxes) and hold W.
// The mantle latches onto the internal top face at the seam, i.e. INSIDE the wall, and the player walks out of the arena.
import * as THREE from 'three';
import { teleport, releaseAll, r2 } from './common.js';
export async function setup(game, report) {
  const R = report.custom = { log: [] };
  const p = game.player; p.god = true;
  game.autotest.duration = 1e9; game.state = 'loading';
  const coll = game.world.collision;
  R.map = game.world.mapId;
  const aimY = parseFloat(new URLSearchParams(location.search).get('aimy') || '5.0');
  const start = new THREE.Vector3(0.12, 0, -38);
  const tgt = new THREE.Vector3(0.12, aimY, -43.9);
  const d = tgt.clone().sub(new THREE.Vector3(start.x, 1.66, start.z));
  const yaw = Math.atan2(-d.x, -d.z), pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
  teleport(game, start.x, 0, start.z, yaw, pitch);
  const DT = 1 / 60;
  let last = '', inWallEvidence = null;
  for (let i = 0; i < 300; i++) {
    const t = i * DT;
    game.input.setVirtual('grapple', t > 0.2 && t < 0.25);
    game.input.setVirtual('forward', t > 0.3);
    game.input.update(); game.update(DT); game.input.endFrame();
    const st = p.move.state + '/' + p.grapple.state;
    if (st !== last || i % 30 === 0) { R.log.push([r2(t), st, r2(p.position.x), r2(p.position.y), r2(p.position.z)]); last = st; }
    if (p.move.mantling && !R.mantleTo) R.mantleTo = p.move.mantleTo.toArray().map(r2);
    if (R.mantleTo && !p.move.mantling && !inWallEvidence) {
      inWallEvidence = { t: r2(t), feet: p.position.toArray().map(r2), grounded: p.move.grounded };
      // can enemies in the arena hit / see the player who is standing inside the wall?
      const chest = p.getChestPosition(new THREE.Vector3());
      R.shots = [];
      for (const from of [new THREE.Vector3(chest.x, 5.5, -30), new THREE.Vector3(chest.x, 1.7, -20), new THREE.Vector3(chest.x + 5, 12, -25)]) {
        const dir = chest.clone().sub(from).normalize();
        const hit = game.combat.raycast(from, dir, 80, null);
        R.shots.push({ from: from.toArray().map(r2), hitEntity: hit && hit.entity ? 'PLAYER' : null, hitDist: hit ? r2(hit.distance) : null, dist: r2(from.distanceTo(chest)), canSee: game.combat.canSee(from, chest) });
      }
      const eye = p.getEyePosition(new THREE.Vector3());
      const out = game.combat.raycast(eye, new THREE.Vector3(0, -0.05, 1).normalize(), 90, p);
      R.playerShootsInto = out ? { dist: r2(out.distance), point: out.point.toArray().map(r2) } : null;
    }
    if (!R.anchor && p.grapple.attached) R.anchor = p.grapple.anchor.toArray().map(r2);
  }
  R.afterMantle = inWallEvidence;
  R.final = { pos: p.position.toArray().map(r2), alive: p.alive, deaths: p.deaths };
  releaseAll(game);
  report.done = true;
}
export function drive() {}

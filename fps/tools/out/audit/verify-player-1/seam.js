import * as THREE from 'three';
import { teleport, releaseAll, r2 } from './common.js';
export async function setup(game, report) {
  const R = report.custom = { log: [] }; const q = new URLSearchParams(location.search);
  const p = game.player; p.god = true;
  game.autotest.duration = 1e9; game.state = 'loading';
  const coll = game.world.collision;
  R.map = game.world.mapId;
  
  const aimY = parseFloat(q.get('aimy') || '8.0');
  const start = new THREE.Vector3(0.12, 0, -38);
  const tgt = new THREE.Vector3(0.12, aimY, -43.9);
  const d = tgt.clone().sub(new THREE.Vector3(start.x, 1.66, start.z));
  const yaw = Math.atan2(-d.x, -d.z), pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
  teleport(game, start.x, 0, start.z, yaw, pitch);
  const DT = 1 / 60;
  let last = '', ev = null;
  for (let i = 0; i < 300; i++) {
    const t = i * DT;
    game.input.setVirtual('grapple', t > 0.2 && t < 0.25);
    game.input.setVirtual('forward', q.get('fwd') !== '0' && t > 0.3);
    game.input.update(); game.update(DT); game.input.endFrame();
    const st = p.move.state + '/' + p.grapple.state;
    if (st !== last) { R.log.push([r2(t), st, r2(p.position.x), r2(p.position.y), r2(p.position.z)]); last = st; }
    if (p.move.mantling && !R.mantleTo) R.mantleTo = p.move.mantleTo.toArray().map(r2);
    if (R.mantleTo && !p.move.mantling && !ev) {
      ev = { t: r2(t), feet: p.position.toArray().map(r2), grounded: p.move.grounded };
      const chest = p.getChestPosition(new THREE.Vector3());
      R.shots = [];
      for (const from of [new THREE.Vector3(chest.x, 5.5, -30), new THREE.Vector3(chest.x, 1.7, -20), new THREE.Vector3(chest.x + 5, 12, -25)]) {
        const dir = chest.clone().sub(from).normalize();
        const hit = game.combat.raycast(from, dir, 80, null);
        R.shots.push({ from: from.toArray().map(r2), hitEntity: hit && hit.entity ? 'PLAYER' : (hit ? 'wall@' + r2(hit.distance) : null), dist: r2(from.distanceTo(chest)), canSee: game.combat.canSee(from, chest) });
      }
      // point-in-solid parity test: cast ray in +y and -y count of front hits? use up ray from capsule centre through back faces: front-face-only, so count hits of ray from far outside
      const mid = new THREE.Vector3(p.position.x, p.position.y + 0.9, p.position.z);
      R.capIntersect = coll.capsuleIntersect(p.move.capsule) ? 'hit' : 'none';
    }
  }
  R.afterMantle = ev;
  R.final = { pos: p.position.toArray().map(r2), alive: p.alive, deaths: p.deaths };
  R.solidsAtMantle = (R.mantleTo && game.world.def && game.world.def.solids ? 'has def' : 'no def');
  releaseAll(game);
  report.done = true;
}
export function drive() {}

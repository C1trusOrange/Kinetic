// verifier: grapple to boundary wall face at aimY, hold W; log where the player ends up vs def solids.
import * as THREE from 'three';
import { teleport, releaseAll, r2 } from './common.js';
export async function setup(game, report) {
  const R = report.custom = { log: [] };
  const p = game.player; p.god = true;
  game.autotest.duration = 1e9; game.state = 'loading';
  const coll = game.world.collision;
  const q = new URLSearchParams(location.search);
  const aimY = parseFloat(q.get('aimy') || '8');
  R.map = game.world.mapId;
  R.killY = game.world.killY;
  const sx = parseFloat(q.get('sx') || '0.12'); const start = new THREE.Vector3(sx, 0, -38);
  const tgt = new THREE.Vector3(sx, aimY, -43.9);
  const d = tgt.clone().sub(new THREE.Vector3(start.x, 1.66, start.z));
  const yaw = Math.atan2(-d.x, -d.z), pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
  teleport(game, start.x, 0, start.z, yaw, pitch);
  const DT = 1 / 60;
  const inSolids = (pt) => game.world.def.solids.filter(s => s.min && s.max && pt.x >= s.min[0] && pt.x <= s.max[0] && pt.y >= s.min[1] && pt.y <= s.max[1] && pt.z >= s.min[2] && pt.z <= s.max[2]).map(s => ({ min: s.min, max: s.max, vis: s.visible !== false }));
  let last = '';
  for (let i = 0; i < 360; i++) {
    const t = i * DT;
    game.input.setVirtual('grapple', t > 0.2 && t < 0.25);
    game.input.setVirtual('forward', t > 0.3);
    game.input.update(); game.update(DT); game.input.endFrame();
    const st = p.move.state + '/' + p.grapple.state;
    if (st !== last) { R.log.push([r2(t), st, p.position.toArray().map(r2), p.alive]); last = st; }
    if (p.move.mantling && !R.mantleTo) { R.mantleTo = p.move.mantleTo.toArray().map(r2); R.mantleFrom = p.move.mantleFrom.toArray().map(r2); R.anchor = p.grapple.anchor && p.grapple.anchor.toArray().map(r2); }
    if (R.mantleTo && !p.move.mantling && !R.after) {
      const chest = p.getChestPosition(new THREE.Vector3());
      R.after = { t: r2(t), feet: p.position.toArray().map(r2), grounded: p.move.grounded, insideDef: inSolids(p.position), capInt: (() => { const h = coll.capsuleIntersect(p.move.capsule); return h ? r2(h.depth) : 0; })() };
      R.shots = [];
      for (const from of [new THREE.Vector3(chest.x, 5.5, -30), new THREE.Vector3(chest.x, 1.7, -20), new THREE.Vector3(chest.x + 5, 12, -25)]) {
        const dir = chest.clone().sub(from).normalize();
        const hit = game.combat.raycast(from, dir, 80, null);
        R.shots.push({ dist: r2(from.distanceTo(chest)), hitDist: hit ? r2(hit.distance) : null, ent: hit && hit.entity ? (hit.entity.isPlayer ? 'PLAYER' : 'other') : null, canSee: game.combat.canSee(from, chest) });
      }
    }
    if (R.after && i % 20 === 0) R.log.push(['t', r2(t), p.position.toArray().map(r2), 'alive', p.alive]);
  }
  R.final = { pos: p.position.toArray().map(r2), alive: p.alive, deaths: p.deaths };
  releaseAll(game);
  report.done = true;
}
export function drive() {}

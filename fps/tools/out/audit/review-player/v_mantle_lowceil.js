// Foundry: ledge at (-12.75, 10.55, -19) has a 1.43 m ceiling. Try to mantle onto it from below at each edge; see if the mantle is accepted.
import * as THREE from 'three';
import { teleport, releaseAll, r2 } from './common.js';
export async function setup(game, report) {
  const R = report.custom = { attempts: [] };
  const p = game.player; p.god = true;
  game.autotest.duration = 1e9; game.state = 'loading';
  const mv = p.move, coll = game.world.collision;
  const S = new THREE.Vector3(-12.75, 10.55, -19);
  const down = new THREE.Vector3(0, -1, 0), up = new THREE.Vector3(0, 1, 0);
  const DT = 1 / 60;
  const tried = [];
  for (let k = 0; k < 16; k++) {
    const a = k / 16 * Math.PI * 2;
    const d = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    // walk outward on the floor until the floor ends
    let last = null;
    for (let s = 0; s < 40; s += 0.1) {
      const q = S.clone().addScaledVector(d, s);
      const h = coll.raycast(new THREE.Vector3(q.x, S.y + 0.3, q.z), down, 0.6);
      if (!h || Math.abs(h.point.y - S.y) > 0.15) break;
      const u = coll.raycast(new THREE.Vector3(q.x, S.y + 0.02, q.z), up, 3);
      last = { s, u: u ? u.distance : null, q };
    }
    if (!last || last.s > 39) continue;
    const E = last.q; // last floor point
    // yaw that looks along -d (toward the ledge)
    const look = d.clone().negate();
    const yaw = Math.atan2(-look.x, -look.z);
    // place the player hanging below the edge: feet 1.1 m under the floor, 0.55 m outward from the edge
    const P = E.clone().addScaledVector(d, 0.6); P.y = S.y - 1.1;
    // must be free space
    const cap = mv.capsule;
    teleport(game, P.x, P.y, P.z, yaw, 0);
    mv.grounded = false;
    const hit0 = coll.capsuleIntersect(mv.capsule);
    if (hit0 && hit0.depth > 0.02) { tried.push({ k, skip: 'embedded' }); continue; }
    let mantled = false, mantleTo = null;
    p.velocity.set(0, 0, 0);
    for (let i = 0; i < 90; i++) {
      game.input.setVirtual('forward', true);
      game.input.update(); game.update(DT); game.input.endFrame();
      if (mv.mantling && !mantled) { mantled = true; mantleTo = mv.mantleTo.clone(); }
      if (mantled && !mv.mantling) break;
    }
    if (mantled) {
      const feet = p.position.clone();
      const ceil = coll.raycast(new THREE.Vector3(feet.x, feet.y + 0.02, feet.z), up, 3);
      R.attempts.push({ k, edge: [r2(E.x), r2(E.y), r2(E.z)], mantleTo: mantleTo.toArray().map(r2), afterFeet: feet.toArray().map(r2), state: mv.state, height: r2(p.height), headroomAtLanding: ceil ? r2(ceil.distance) : null, standingTop: r2(feet.y + 1.8), ceilingY: ceil ? r2(feet.y + ceil.distance) : null });
    } else tried.push({ k, edge: [r2(E.x), r2(E.y), r2(E.z)], mantled: false });
    releaseAll(game);
  }
  R.notMantled = tried;
  report.done = true;
}
export function drive() {}

// Which shipped spawn points put the player capsule inside geometry? What does Player.spawn() do about it?
import * as THREE from 'three';
import { r2 } from './common.js';
export async function setup(game, report) {
  const R = report.custom = { map: game.world.mapId, bad: [] };
  const p = game.player; game.autotest.duration = 1e9; game.state = 'loading';
  const coll = game.world.collision;
  let i = 0;
  for (const sp of game.world.spawnPoints) {
    p.spawn(sp.position.clone(), sp.yaw);
    const c = p.move.capsule;
    const hit = coll.capsuleIntersect(c);
    const before = p.position.clone();
    // one physics step at 60fps
    const DT = 1 / 60;
    game.input.update(); game.update(DT); game.input.endFrame();
    const moved = p.position.distanceTo(before);
    if ((hit && hit.depth > 0.05) || moved > 0.3) R.bad.push({ i, pos: sp.position.toArray().map(r2), depth: hit ? r2(hit.depth) : 0, movedInFirstFrame: r2(moved), after: p.position.toArray().map(r2) });
    i++;
  }
  R.total = i;
  report.done = true;
}
export function drive() {}

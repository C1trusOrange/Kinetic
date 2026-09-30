// Natural route: stand on the arena floor, grapple to just below the boundary wall top, let the rope pull you up -> auto-mantle onto the wall top.
import * as THREE from 'three';
import { teleport, releaseAll, r2 } from './common.js';
export async function setup(game, report) {
  const R = report.custom = { log: [] };
  const p = game.player; p.god = true;
  game.autotest.duration = 1e9; game.state = 'loading';
  const coll = game.world.collision;
  const id = game.world.mapId; R.map = id;
  // find the boundary wall top: cast down from high above the arena edge
  const cfg = {
    sandbox: { x: 0, z0: -22, zw: -31.5, top: 10 },
    foundry: { x: 0, z0: -38, zw: -44.5, top: 16 },
    ruins: { x: 0, z0: -45, zw: -52, top: 24 },
    skyline: { x: 0, z0: -38, zw: -44.5, top: 15 },
  }[id];
  // locate actual wall top under the invisible box: cast down from y = top + 10
  const down = new THREE.Vector3(0, -1, 0);
  let wallTop = null;
  for (let z = cfg.zw - 1; z <= cfg.zw + 1; z += 0.1) {
    const h = coll.raycast(new THREE.Vector3(cfg.x, cfg.top + 30, z), down, 100);
    if (h) { wallTop = { z: r2(z), y: r2(h.point.y), n: h.normal.toArray().map(r2) }; break; }
  }
  R.probe = wallTop;
  // aim from (x, 0, z0) at a point 0.9 m below the wall top on the inner face
  const eyeY = 1.66;
  const tgt = new THREE.Vector3(cfg.x, cfg.top - 0.9, cfg.zw + 0.5);
  const start = new THREE.Vector3(cfg.x, 0, cfg.z0);
  const d = tgt.clone().sub(new THREE.Vector3(start.x, eyeY, start.z));
  const yaw = Math.atan2(-d.x, -d.z);
  const pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
  R.aim = { yaw: r2(yaw), pitch: r2(pitch), dist: r2(d.length()) };
  teleport(game, start.x, 0, start.z, yaw, pitch);
  const DT = 1 / 60;
  let last = '';
  for (let i = 0; i < 420; i++) {
    const t = i * DT;
    game.input.setVirtual('grapple', t > 0.2 && t < 0.25); game.input.setVirtual('forward', t > 0.3);
    game.input.update(); game.update(DT); game.input.endFrame();
    const st = p.move.state + '/' + p.grapple.state;
    if (st !== last || i % 60 === 0) { R.log.push([r2(t), st, r2(p.position.x), r2(p.position.y), r2(p.position.z)]); last = st; }
    if (!R.anchor && p.grapple.attached) R.anchor = p.grapple.anchor.toArray().map(r2);
  }
  R.final = { pos: p.position.toArray().map(r2), alive: p.alive, deaths: p.deaths, state: p.move.state };
  releaseAll(game);
  report.done = true;
}
export function drive() {}

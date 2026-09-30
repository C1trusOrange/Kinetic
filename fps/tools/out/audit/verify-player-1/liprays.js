import * as THREE from 'three';
import { r2 } from './common.js';
export async function setup(game, report) {
  const R = report.custom = { map: game.world.mapId, cases: [] };
  game.autotest.duration = 1e9; game.state = 'loading';
  const coll = game.world.collision;
  const test = (name, wallPt, n, H, feetY, T) => {
    const L = new THREE.Vector3(wallPt[0] + n[0] * 0.05, feetY + H + 0.6, wallPt[2] + n[2] * 0.05);
    const Tv = new THREE.Vector3(T[0], T[1], T[2]);
    const d = Tv.clone().sub(L); const len = d.length(); d.normalize();
    const h = coll.raycast(L, d, len);
    R.cases.push({ name, blocked: !!h, hitDist: h ? r2(h.distance) : null, len: r2(len) });
  };
  if (R.map === 'foundry') {
    test('foundry seam y=6', [0.12, 3.8, -44], [0, 0, 1], 2.17, 3.83, [0.12, 6.9, -44.47]);
    test('foundry top y=16', [0.12, 13.9, -44], [0, 0, 1], 2.1, 13.9, [0.12, 16.9, -44.47]);
  } else if (R.map === 'testmap4') {
    test('ledge 1.5 (legit)', [0, 0.45, 20], [0, 0, -1], 1.5, 0, [0, 1.5 + 0.9, 20.47]);
    test('ledge 1.5 legit thin overhang above 2.9', [0, 0.45, 20], [0, 0, -1], 1.5, 0, [0, 2.4, 20.47]);
  }
  report.done = true;
}
export function drive() {}

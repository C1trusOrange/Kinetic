// Screenshot helper: replays one mantle attempt headlessly, leaves the player where it ended and draws an x-ray
// capsule marker at the player's position (depthTest off) so "the player is inside the container / building" is
// visible from a fixed camera.
//   python tools/run.py "index.html?autotest=1&map=foundry&bots=0&god=1&duration=99999&cam=-33,4.5,-40.5,1.5708,0.05&scenario=tools/out/collision/shot.js&case=foundry_stack" --shot tools/out/collision/shot_foundry_before.png
import * as THREE from 'three';
import { Detector, attempt } from './lib.js';

const PI = Math.PI;
const CASES = {
  foundry_stack: { pos: [-39.9, 0.9, -40.5], yaw: PI / 2, air: true, dur: 1.4 },
  skyline_building: { pos: [17.0, 1.0, -28], yaw: -PI / 2, air: true, dur: 1.4 },
  foundry_border: { pos: [0, 4.0, -43.4], yaw: 0, air: true, dur: 2.5 },
};

let marker = null, frames = 0, det = null, result = null;

export async function setup(game, report) {
  det = new Detector(game);
  const c = CASES[game.params.get('case') || 'foundry_stack'];
  result = attempt(game, det, { ...c, alwaysCheck: true, checkEvery: 0 });
  report.custom = { case: game.params.get('case'), result: { mantled: result.mantled, mantleFrom: result.mantleFrom, inside: result.insideEnd, end: result.endPos } };
  marker = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.4, 1.0, 4, 12),
    new THREE.MeshBasicMaterial({ color: result.insideEnd ? 0xff2244 : 0x22ff88, transparent: true, opacity: 0.85, depthTest: false }),
  );
  marker.renderOrder = 999;
  game.scene.add(marker);
}

export function drive(t, dt, game, report) {
  if (!marker) return;
  const P = game.player;
  // keep the player exactly where the headless replay left it (no further input)
  marker.position.set(P.position.x, P.position.y + 0.9, P.position.z);
  if (++frames > 12) game.autotest.finish();
}

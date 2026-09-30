// Draw the gameplay hitboxes (Entity.getHitboxes) over a bot model, from front and side, to compare with the visible mesh.
import * as THREE from 'three';
const P = new URLSearchParams(location.search);
const VIEW = P.get('view') || 'side';
let frames = 0, bot = null;
const helpers = [];

export async function setup(game, report) {
  report.custom = {};
  game.player.god = true;
  bot = game.bots.list[0];
  bot.god = true;
  bot.update = () => {};
  bot.position.set(0, 0, 0);
  bot.velocity.set(0, 0, 0);
  bot.yaw = 0; bot.bodyYaw = 0;
  bot.model.root.position.copy(bot.position);
  bot.model.root.rotation.y = 0;
  bot.model.root.updateMatrixWorld(true);
  const mkWire = (geo, color) => {
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, wireframe: true, depthTest: false, transparent: true, opacity: 0.9 }));
    m.renderOrder = 999;
    m.frustumCulled = false;
    game.scene.add(m);
    helpers.push(m);
    return m;
  };
  // sphere for head, capsules for body and legs
  const hb = bot.getHitboxes();
  report.custom.hitboxes = hb.map(h => h.type === 'sphere'
    ? { part: h.part, type: 'sphere', center: h.center.toArray().map(v => +v.toFixed(2)), r: h.radius }
    : { part: h.part, type: 'capsule', start: h.start.toArray().map(v => +v.toFixed(2)), end: h.end.toArray().map(v => +v.toFixed(2)), r: h.radius });
  const head = mkWire(new THREE.SphereGeometry(hb[0].radius, 16, 10), 0xff3030);
  head.position.copy(hb[0].center);
  for (const [i, col] of [[1, 0x30ff60], [2, 0x3080ff]]) {
    const h = hb[i];
    const len = h.start.distanceTo(h.end);
    const cap = mkWire(new THREE.CapsuleGeometry(h.radius, len, 6, 14), col);
    cap.position.copy(h.start).add(h.end).multiplyScalar(0.5);
  }
  // camera
  const p = game.player;
  const d = VIEW === 'front' ? [0, 0, 6] : [6, 0, 0.001];
  p.move.place(new THREE.Vector3(d[0], 0, d[2]));
  p.prevPosition.copy(p.position);
  const tx = 0, ty = 1.0, tz = 0;
  const dx = tx - p.position.x, dz = tz - p.position.z;
  p.yaw = Math.atan2(-dx, -dz);
  p.pitch = Math.atan2(ty - 1.66, Math.hypot(dx, dz));
  report.custom.player = p.position.toArray();
  game.weapons.setVisible(false);
}

export function drive(t, dt, game) {
  const p = game.player;
  const dx = -p.position.x, dz = -p.position.z;
  p.yaw = Math.atan2(-dx, -dz);
  p.pitch = Math.atan2(1.0 - 1.66, Math.hypot(dx, dz));
  frames++;
  if (frames > 30) window.__FROZEN__ = true;
}
export function finish() {}

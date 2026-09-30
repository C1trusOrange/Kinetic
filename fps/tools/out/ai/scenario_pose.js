// Staged pose scenario: four scripted bots in front of a fixed camera (use with cam=0,1.6,25,0,-0.06).
import * as THREE from 'three';
const S = { bots: [], t0: 0 };
export async function setup(game, report) {
  const bots = game.bots.list.slice(0, 4);
  S.bots = bots;
  const xs = [-3.6, -1.2, 1.2, 3.6];
  bots.forEach((b, i) => {
    b.god = true;
    b.spawn(new THREE.Vector3(xs[i], 0, 19), Math.PI);
    b.brain.update = function (dt) {
      const it = this.intent;
      const t = game.time - S.t0;
      it.jump = false; it.fire = false; it.reload = false;
      it.moveX = 0; it.moveZ = 0; it.speed = 0; it.crouch = false;
      this.faceAim = true;
      b.pitch = 0;
      b.yaw = Math.PI;
      if (i === 0) { // runs toward the camera and back
        const ph = Math.sin(t * 0.7);
        it.moveZ = ph > 0 ? 1 : -1; it.speed = 7.2; b.yaw = ph > 0 ? Math.PI : 0; this.faceAim = false;
      } else if (i === 1) { // strafes while aiming at the camera and firing
        it.moveX = Math.sin(t * 1.3) > 0 ? 1 : -1; it.speed = 5; it.fire = true;
      } else if (i === 2) { // crouch + fire
        it.crouch = true; it.fire = true;
      } else { // jump + reload
        if (Math.floor(t * 1.2) % 3 === 0) it.jump = true; else if (Math.floor(t) % 4 === 3) it.reload = true;
        it.moveX = 0.4; it.speed = 3;
      }
      // keep them in place laterally / depth
      const dz = 19 - b.position.z;
      if (i > 0) { it.moveZ = Math.max(-1, Math.min(1, dz * 0.5)); if (i > 0 && it.speed === 0) it.speed = Math.abs(dz) > 0.3 ? 4 : 0; }
      const dx = xs[i] - b.position.x;
      if (i >= 2 && Math.abs(dx) > 1.5) { it.moveX = Math.sign(dx); it.speed = 4; }
    };
  });
  S.t0 = game.time;
  // ammo so nobody runs dry
  bots.forEach(b => { for (const id in b.inv) b.inv[id].reserve = 999; });
}
export function drive(t, dt, game) {
  for (const b of S.bots) if (b.alive) { b.health = b.maxHealth; }
}
export function finish() {}

import * as THREE from 'three';
export function setup(game, report) { report.custom = {}; game.player.god = true; }
const st = {};
const m4 = new THREE.Matrix4(), pos = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), nrm = new THREE.Vector3();
const ax = new THREE.Vector3(), ay = new THREE.Vector3(), o = new THREE.Vector3(), d = new THREE.Vector3();
export function drive(t, dt, game, report) {
  const p = game.player, c = report.custom;
  if (t > 0.5 && !st.a) {
    st.a = true;
    p.spawn(new THREE.Vector3(6.5, 0.05, 24), 0);
    game.projectiles.spawnRocket({ owner: p, origin: new THREE.Vector3(6.5, 1.5, 14), direction: new THREE.Vector3(0, 0, -1) });
    game.fixedCam = [10, 1.7, 14, 0.5, 0.0];
  }
  if (t > 1.4 && !st.b) {
    st.b = true;
    const L = game.effects.decals; const res = [];
    for (let i = 0; i < L.total; i++) {
      if (!L.live[i]) continue;
      L.mesh.getMatrixAt(i, m4); m4.decompose(pos, q, sc);
      nrm.set(0, 0, 1).applyQuaternion(q);
      ax.set(1, 0, 0).applyQuaternion(q); ay.set(0, 1, 0).applyQuaternion(q);
      let on = 0, tot = 0;
      for (let u = -0.45; u <= 0.451; u += 0.15) for (let v = -0.45; v <= 0.451; v += 0.15) {
        o.copy(pos).addScaledVector(ax, u * sc.x * 1).addScaledVector(ay, v * sc.x * 1).addScaledVector(nrm, 0.05);
        d.copy(nrm).negate();
        tot++; if (game.world.raycast(o, d, 0.25)) on++;
      }
      res.push({ scorch: i >= L.bulletCap, pos: pos.toArray().map(v => +v.toFixed(2)), n: nrm.toArray().map(v => +v.toFixed(2)), size: +sc.x.toFixed(2), coverage: +(on / tot).toFixed(2) });
    }
    c.decals = res;
  }
}
export function finish() {}

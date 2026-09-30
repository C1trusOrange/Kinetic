// tunnelling test: capsule vs 0.6 m wall at various speeds/dt (single moveCapsule call)
const col = game.world.collision;
const out = { wall: [], floor: [] };
const R = 0.4;
for (const dt of [1/120, 1/60, 0.05]) {
  for (const v of [30, 100, 300, 600, 900, 1500]) {
    const cap = new Capsule(new THREE.Vector3(-24, 0.9, -17), new THREE.Vector3(-24, 1.9, -17), R);
    const vel = new THREE.Vector3(0, 0, -v);
    const r = col.moveCapsule(cap, vel, dt);
    out.wall.push({ dt: +dt.toFixed(4), v, z: +cap.start.z.toFixed(2), hitWall: r.hitWall, vz: +vel.z.toFixed(1), stepped: +(v * dt).toFixed(1) });
  }
  for (const v of [30, 100, 300, 600, 1000, 2000]) {
    // straight down onto the 5 m thick ground slab
    const cap = new Capsule(new THREE.Vector3(-24, 5.4, -17), new THREE.Vector3(-24, 6.4, -17), R);
    const vel = new THREE.Vector3(0, -v, 0);
    const r = col.moveCapsule(cap, vel, dt);
    out.floor.push({ dt: +dt.toFixed(4), v, y: +cap.start.y.toFixed(2), onGround: r.onGround, stepped: +(v * dt).toFixed(1) });
  }
}
return out;

import * as THREE from 'three';
const mode = new URLSearchParams(location.search).get('mode') || 'grenade';
const st = {};
const m4 = new THREE.Matrix4(), pos = new THREE.Vector3(), nrm = new THREE.Vector3(), o = new THREE.Vector3(), d = new THREE.Vector3();
const sc = new THREE.Vector3(), q = new THREE.Quaternion();

function decalReport(game) {
  const L = game.effects.decals, out = [];
  for (let i = 0; i < L.total; i++) {
    if (!L.live[i]) continue;
    L.mesh.getMatrixAt(i, m4);
    m4.decompose(pos, q, sc);
    nrm.set(0, 0, 1).applyQuaternion(q).normalize();
    o.copy(pos).addScaledVector(nrm, 0.05);
    d.copy(nrm).negate();
    const hit = game.world.raycast(o, d, 0.25);
    out.push({ i, scorch: i >= L.bulletCap, pos: pos.toArray().map(v => +v.toFixed(2)), n: nrm.toArray().map(v => +v.toFixed(2)), size: +sc.x.toFixed(2), onSurface: !!hit });
  }
  return out;
}
export function setup(game, report) {
  report.custom = { mode, lights0: 0 };
  game.scene.traverse(x => { if (x.isLight) report.custom.lights0++; });
}
export function drive(t, dt, game, report) {
  const c = report.custom, p = game.player;
  if (!st.init) {
    st.init = true;
    p.god = true;
    // keep the bot(s) out of the way
  }
  if (mode === 'grenade') {
    if (t > 1 && !st.a) {
      st.a = true;
      p.spawn(new THREE.Vector3(10, 0.05, 30), 0);
      p.yaw = 0; p.pitch = Math.atan2(3.4, 10);
      game.projectiles.spawnGrenade({ owner: p, origin: new THREE.Vector3(10, 5, 20), velocity: new THREE.Vector3(0, 0, 0), fuse: 0.1 });
    }
    if (st.a) { p.yaw = 0; p.pitch = Math.atan2(3.4, 10); }
    if (t > 1.5 && !st.b) { st.b = true; c.decals = decalReport(game); }
  } else if (mode === 'rocket') {
    const bot = game.bots.list[0];
    if (t > 1 && !st.a && bot && bot.alive) {
      st.a = true;
      // find an open spot (10 m clear in 4 directions at chest height, floor beneath)
      let spot = null;
      const dirs = [[1,0,0],[-1,0,0],[0,0,1],[0,0,-1]];
      outer: for (let x = -24; x <= 24; x += 3) for (let z = -20; z <= 24; z += 3) {
        o.set(x, 1.1, z);
        const fl = game.world.raycast(new THREE.Vector3(x, 3, z), new THREE.Vector3(0,-1,0), 6);
        if (!fl || Math.abs(fl.point.y) > 0.05) continue;
        let ok = true;
        for (const dd of dirs) { d.set(dd[0], dd[1], dd[2]); if (game.world.raycast(o, d, 10)) { ok = false; break; } }
        if (ok) { spot = new THREE.Vector3(x, 0.05, z); break outer; }
      }
      c.spot = spot && spot.toArray();
      if (!spot) spot = new THREE.Vector3(0, 0.05, 20);
      bot.spawn(spot, 0);
      bot.update = () => {};
      // stand the player behind, look at the bot
      c.botPos = bot.position.toArray().map(v => +v.toFixed(1));
      d.set(0, 0, 1);
      const target = bot.position.clone(); target.y += 1.0;
      const from = target.clone().add(new THREE.Vector3(0, 0, 6)); from.y = target.y;
      const dir = target.clone().sub(from).normalize();
      st.target = target;
      game.projectiles.spawnRocket({ owner: p, origin: from, direction: dir });
      game.fixedCam = [spot.x + 2, 1.8, spot.z + 9, 0.1, 0.0];
      c.before = decalReport(game).length;
    }
    if (st.a) { p.yaw = 0; p.pitch = 0.0; }
    if (t > 1.6 && !st.b) { st.b = true; c.decals = decalReport(game); c.explosions = game.effects.stats; }
  }
}
export function finish(game, report) {
  report.custom.lights1 = 0;
  game.scene.traverse(x => { if (x.isLight) report.custom.lights1++; });
  report.custom.effStats = game.effects.stats;
}

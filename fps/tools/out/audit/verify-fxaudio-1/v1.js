import * as THREE from 'three';
const mode = new URLSearchParams(location.search).get('mode') || 'grenade';
const st = {};
const m4 = new THREE.Matrix4(), pos = new THREE.Vector3(), nrm = new THREE.Vector3(), o = new THREE.Vector3(), d = new THREE.Vector3();
const sc = new THREE.Vector3(), q = new THREE.Quaternion();
function decalReport(game) {
  const L = game.effects.decals, out = [];
  for (let i = 0; i < L.total; i++) {
    if (!L.live[i]) continue;
    L.mesh.getMatrixAt(i, m4); m4.decompose(pos, q, sc);
    nrm.set(0, 0, 1).applyQuaternion(q).normalize();
    const ax = new THREE.Vector3(1,0,0).applyQuaternion(q), ay = new THREE.Vector3(0,1,0).applyQuaternion(q);
    let on = 0, tot = 0;
    for (let u = -0.45; u <= 0.451; u += 0.15) for (let v = -0.45; v <= 0.451; v += 0.15) {
      o.copy(pos).addScaledVector(ax, u * sc.x).addScaledVector(ay, v * sc.x).addScaledVector(nrm, 0.05);
      d.copy(nrm).negate();
      tot++; if (game.world.raycast(o, d, 0.25)) on++;
    }
    out.push({ i, scorch: i >= L.bulletCap, pos: pos.toArray().map(v => +v.toFixed(2)), n: nrm.toArray().map(v => +v.toFixed(2)), size: +sc.x.toFixed(2), coverage: +(on / tot).toFixed(2) });
  }
  return out;
}
export function setup(game, report) { report.custom = { mode }; }
export function drive(t, dt, game, report) {
  const c = report.custom, p = game.player;
  if (!st.init) { st.init = true; p.god = true; }
  const hide = () => { game.effects.smoke.mesh.visible = false; game.effects.glow.mesh.visible = false; };
  if (mode === 'grenade') {
    if (t > 1 && !st.a) {
      st.a = true;
      p.spawn(new THREE.Vector3(10, 0.05, 30), 0);
      c.eventsBefore = game.effects.decals.liveCount;
      game.projectiles.spawnGrenade({ owner: p, origin: new THREE.Vector3(10, 5, 20), velocity: new THREE.Vector3(0, 0, 0), fuse: 0.1 });
      game.fixedCam = [10, 3.0, 28, 0, 0.0];
      // grenade exploded when g.fuse<=0: next frame
    }
    if (st.a && !st.h && game.effects.decals.liveCount > 0) { st.h = true; c.tHit = t; c.grenadesLeft = game.projectiles.grenades.length; }
    if (st.h) hide();
    if (st.h && t > c.tHit + 0.3 && !st.b) { st.b = true; c.decals = decalReport(game); c.stats = JSON.parse(JSON.stringify(game.effects.stats)); }
  } else if (mode === 'pillar') {
    if (t > 0.5 && !st.a) {
      st.a = true;
      p.spawn(new THREE.Vector3(6.5, 0.05, 24), 0);
      game.projectiles.spawnRocket({ owner: p, origin: new THREE.Vector3(6.5, 1.5, 14), direction: new THREE.Vector3(0, 0, -1) });
      game.fixedCam = [10, 1.7, 14, 0.5, 0.0];
    }
    if (st.a && !st.h && game.effects.decals.liveCount > 0) { st.h = true; c.tHit = t; }
    if (st.h) hide();
    if (st.h && t > c.tHit + 0.3 && !st.b) { st.b = true; c.decals = decalReport(game); }
  } else if (mode === 'rocket') {
    const bot = game.bots.list[0];
    if (t > 1 && !st.a && bot && bot.alive) {
      st.a = true;
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
      bot.god = true; // keep bot alive as target (so rocket is direct hit and bot remains as reference)
      const target = bot.position.clone(); target.y += 1.0;
      const from = target.clone().add(new THREE.Vector3(0, 0, 6));
      const dir = target.clone().sub(from).normalize();
      game.projectiles.spawnRocket({ owner: p, origin: from, direction: dir });
      game.fixedCam = [spot.x + 4, 1.7, spot.z + 10, 0.3, 0.0];
    }
    if (st.a && !st.h && game.effects.decals.liveCount > 0) { st.h = true; c.tHit = t; }
    if (st.h) hide();
    if (st.h && t > c.tHit + 0.3 && !st.b) { st.b = true; c.decals = decalReport(game); }
  }
}
export function finish(game, report) { report.custom.effStats = game.effects.stats; }

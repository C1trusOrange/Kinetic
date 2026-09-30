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
    // sample a 7x7 grid over the quad
    const ax = new THREE.Vector3(1, 0, 0).applyQuaternion(q), ay = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    let on = 0, tot = 0;
    for (let u = -0.4; u <= 0.401; u += 0.1333) for (let v = -0.4; v <= 0.401; v += 0.1333) {
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
  if (mode === 'grenade') {
    if (t > 1 && !st.a) {
      st.a = true;
      p.spawn(new THREE.Vector3(10, 0.05, 30), 0);
      game.projectiles.spawnGrenade({ owner: p, origin: new THREE.Vector3(10, 5, 20), velocity: new THREE.Vector3(0, 0, 0), fuse: 0.1 });
      game.fixedCam = [10, 3.4, 30, 0, Math.atan2(1.6, 10)];
    }
    if (t > 1.3 && !st.b) { st.b = true; c.decals = decalReport(game); c.stats = { ...game.effects.stats };
      game.effects.smoke.mesh.visible = false; game.effects.glow.mesh.visible = false; }
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
        for (const dd of dirs) { d.set(dd[0], dd[1], dd[2]); if (game.world.raycast(o, d, 12)) { ok = false; break; } }
        if (ok) { spot = new THREE.Vector3(x, 0.05, z); break outer; }
      }
      c.spot = spot && spot.toArray();
      if (!spot) spot = new THREE.Vector3(0, 0.05, 20);
      bot.spawn(spot, 0);
      bot.update = () => {};
      st.spot = spot;
      const target = bot.position.clone(); target.y += 1.0;
      const from = target.clone().add(new THREE.Vector3(0, 0, 6)); from.y = target.y;
      const dir = target.clone().sub(from).normalize();
      const r = game.projectiles.spawnRocket({ owner: p, origin: from, direction: dir });
      c.rocketFrom = from.toArray();
      game.fixedCam = [spot.x + 4, 1.8, spot.z + 10, 0.35, 0.0];
      // wrap explode to record its args
      const orig = game.projectiles.explode.bind(game.projectiles);
      game.projectiles.explode = (pt, opts) => { c.explodeArgs = { pt: pt.toArray().map(v=>+v.toFixed(2)), normal: opts.normal && opts.normal.toArray().map(v=>+v.toFixed(2)), weapon: opts.weapon }; return orig(pt, opts); };
    }
    if (t > 1.5 && st.a && !st.b) { st.b = true; c.decals = decalReport(game); c.botAlive = game.bots.list[0].alive; c.stats = { ...game.effects.stats };
      game.effects.smoke.mesh.visible = false; game.effects.glow.mesh.visible = false; }
  }
}
export function finish(game, report) {}

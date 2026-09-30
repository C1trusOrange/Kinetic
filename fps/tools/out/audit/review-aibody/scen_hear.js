import * as THREE from 'three';
const S = { phase: 0, res: {} };
export async function setup(game, report) {
  report.custom = S.res;
  const [A, B] = game.bots.list;
  for (const b of game.bots.slice ? game.bots.slice(2) : game.bots.list.slice(2)) { b.god = true; b.brain.update = () => {}; }
  S.A = A; S.B = B;
  A.brain.update = () => {};
  B.brain.update = () => {};
  // find two spawn points with line of sight, far apart
  const sp = game.world.spawnPoints;
  let best = null;
  for (let i = 0; i < sp.length; i++) for (let j = 0; j < sp.length; j++) {
    if (i === j) continue;
    const a = sp[i].position.clone(); a.y += 0.3; const b = sp[j].position.clone(); b.y += 0.3;
    const d = a.distanceTo(b);
    if (d > 20 && d < 40 && Math.abs(a.y - b.y) < 0.5 && game.combat.canSee(a, b)) { if (!best || d > best.d) best = { i, j, d }; }
  }
  S.res.pair = best;
  S.pair = best;
}
export function drive(t, dt, game) {
  const { A, B, pair } = S;
  if (!pair) return;
  if (S.phase === 0 && t > 0.5) {
    const sp = game.world.spawnPoints;
    A.spawn(sp[pair.i].position.clone(), 0); B.spawn(sp[pair.j].position.clone(), 0);
    A.spawnProtectedUntil = 0; B.spawnProtectedUntil = 0; B.maxHealth = 1000; B.health = 1000; B.god = false; A.god = true;
    A.model && (A.model.root.visible = true);
    B.brain.perceiveAt = 1e9; B.brain.thinkAt = 1e9;
    S.res.Apos = A.position.toArray().map(v => +v.toFixed(1));
    S.res.Bpos = B.position.toArray().map(v => +v.toFixed(1));
    S.phase = 1; S.t0 = t;
  } else if (S.phase === 1 && t > S.t0 + 0.3) {
    // real explode() at B's feet by A (A far away, not visible to B): radialDamage -> damage event -> explosion event
    const at = new THREE.Vector3(B.position.x + 1.5, B.position.y + 0.3, B.position.z);
    const before = B.brain.mem.get(A);
    game.projectiles.explode(at, { owner: A, weapon: 'rocket', normal: new THREE.Vector3(0, 1, 0) });
    const rec = B.brain.mem.get(A);
    S.res.explosionAt = at.toArray().map(v => +v.toFixed(1));
    S.res.afterExplode = rec ? { recPos: rec.pos.toArray().map(v => +v.toFixed(1)), hurtAt: +rec.hurtAt.toFixed(2), lastHeard: +rec.lastHeard.toFixed(2), Bhp: Math.round(B.health) } : null;
    S.res.distRecToA = rec ? +rec.pos.distanceTo(A.position).toFixed(1) : null;
    S.res.distRecToExplosion = rec ? +rec.pos.distanceTo(at).toFixed(1) : null;
    S.res.distExplosionToA = +at.distanceTo(A.position).toFixed(1);
    S.phase = 3;
  } else if (S.phase === 2) {
    const rec = B.brain.mem.get(A);
    if (rec) {
      S.res.samples = S.res.samples || [];
      S.res.samples.push({ t: +(t - S.t0).toFixed(2), recPos: rec.pos.toArray().map(v => +v.toFixed(1)), Apos: A.position.toArray().map(v => +v.toFixed(1)), Bhp: Math.round(B.health), dExplVsB: 0, known: rec.known, hurtAt: +rec.hurtAt.toFixed(2), heardAt: +rec.lastHeard.toFixed(2) });
      if (S.res.samples.length > 12) S.phase = 3;
    }
    if (t > S.t0 + 4 && !rec) { S.res.norec = true; S.phase = 3; }
  }
}

// Grenade checks in the real game: (1) throw accuracy at a target 14 m away, (2) dodge of a live grenade.
import * as THREE from 'three';
const S = { res: { throws: [], dodge: [] }, phase: 0, t0: 0 };
export async function setup(game, report) {
  report.custom = S.res;
  S.game = game;
  const [A, B, C] = game.bots.list;
  S.A = A; S.B = B; S.C = C;
  for (const b of [A, B, C]) { b.god = false; b.brain.thinkAt = 1e9; b.brain.perceiveAt = 1e9; }
  A.team = 91; B.team = 92; C.team = 93;
  for (const b of game.bots.list.slice(3)) { b.spawn(new THREE.Vector3(-35, 0, 36), 0); b.god = true; b.brain.update = () => {}; }
  game.events.on('explosion', e => {
    if (S.phase === 1) S.lastExplosion = { pos: e.position.clone(), t: game.time };
    if (S.phase === 2) S.lastExplosion = { pos: e.position.clone(), t: game.time };
  });
  S.phase = 0; S.t0 = game.time;
}
function place(b, x, z, yaw) { b.spawn(new THREE.Vector3(x, 0, z), yaw); b.spawnProtectedUntil = 0; b.brain.thinkAt = 1e9; b.brain.perceiveAt = 1e9; b.brain.update = () => {}; b.health = b.maxHealth; }
export function drive(t, dt, game) {
  const { A, B, C } = S;
  if (!A) return;
  const el = game.time - S.t0;
  if (S.phase === 0 && el > 0.5) {
    // (1) throw test: 8 throws at a target 14 m away, target fixed
    S.k = 0; S.phase = 1; S.sub = 0; S.wait = 0;
  }
  if (S.phase === 1) {
    S.wait -= dt;
    if (S.wait <= 0) {
      if (S.sub === 1) {
        const d = S.lastExplosion ? S.lastExplosion.pos.distanceTo(new THREE.Vector3(B.position.x, B.position.y + 0.9, B.position.z)) : -1;
        S.res.throws.push({ i: S.k, distToTarget: +d.toFixed(2), bHealth: Math.round(B.health) });
        S.k++;
        S.sub = 0;
      }
      if (S.k >= 8) { S.phase = 2; S.k = 0; S.sub = 0; S.wait = 0; return; }
      // set up
      place(A, -7, 35, -Math.PI / 2); place(B, 7, 35, Math.PI / 2); place(C, -25, 36, 0); C.god = true;
      A.grenades = 3; S.lastExplosion = null;
      const ok = A.brain.throwGrenadeAt(B.position);
      S.res.throws.length; S.thrown = ok;
      if (!ok) S.res.throws.push({ i: S.k, thrown: false });
      S.sub = ok ? 1 : 0; S.wait = ok ? 3.4 : 0.2;
      if (!ok) S.k++;
    }
  }
  if (S.phase === 2) {
    S.wait -= dt;
    if (S.wait <= 0) {
      if (S.sub === 1) {
        const c = S.C;
        const d = S.lastExplosion ? S.lastExplosion.pos.distanceTo(new THREE.Vector3(C.position.x, C.position.y + 0.9, C.position.z)) : -1;
        S.res.dodge.push({ i: S.k, distAtBlast: +d.toFixed(2), cHealth: Math.round(C.health) });
        S.k++;
        S.sub = 0;
      }
      if (S.k >= 8) { S.phase = 3; return; }
      // dodge test: C has a real brain (no enemies), a grenade lands 1.5 m from it
      place(A, -25, 36, 0); A.god = true; place(B, -22, 36, 0); B.god = true;
      C.team = 93; C.god = false; C.spawn(new THREE.Vector3(0, 0, 35), 0); C.spawnProtectedUntil = 0; C.health = C.maxHealth;
      C.brain.update = Object.getPrototypeOf(C.brain).update; // real brain
      delete C.brain.update;
      C.brain.thinkAt = 0; C.brain.perceiveAt = 0;
      const dir = new THREE.Vector3(Math.cos(S.k * 0.8), 0, Math.sin(S.k * 0.8));
      game.projectiles.spawnGrenade({ owner: A, origin: new THREE.Vector3(C.position.x + dir.x * 1.6, 0.4, C.position.z + dir.z * 1.6), velocity: new THREE.Vector3(0, 0.5, 0), fuse: 2.6 });
      S.lastExplosion = null; S.sub = 1; S.wait = 3.2;
    }
  }
}
export function finish(game, report) {
  const th = S.res.throws.filter(t => t.distToTarget !== undefined);
  S.res.throwSummary = { n: th.length, within3m: th.filter(t => t.distToTarget >= 0 && t.distToTarget < 3).length, within6: th.filter(t => t.distToTarget >= 0 && t.distToTarget < 6).length, damaged: th.filter(t => t.bHealth < 100).length };
  const dg = S.res.dodge;
  S.res.dodgeSummary = { n: dg.length, avgDist: +(dg.reduce((a, b) => a + b.distAtBlast, 0) / Math.max(1, dg.length)).toFixed(1), damaged: dg.filter(d => d.cHealth < 100).length, avgHealth: Math.round(dg.reduce((a, b) => a + b.cHealth, 0) / Math.max(1, dg.length)) };
}

import * as THREE from 'three';
const S = { log: [], dmg: [], expl: [] };
const R = {};
export async function setup(game, report) {
  report.custom = S;
  const [A, B] = game.bots.list;
  R.A = A; R.B = B;
  for (const b of game.bots.list) { b.brain.thinkAt = 1e9; b.brain.perceiveAt = 1e9; b.brain.update = () => {}; b.god = false; }
  A.team = 91; B.team = 92;
  for (const b of game.bots.list.slice(2)) { b.spawn(new THREE.Vector3(-25, 0, -25), 0); b.god = true; }
  game.events.on('damage', e => S.dmg.push({ t: +game.time.toFixed(2), target: e.target.name, amt: Math.round(e.amount), w: e.weapon }));
  game.events.on('explosion', e => S.expl.push({ t: +game.time.toFixed(2), pos: e.position.toArray().map(v => +v.toFixed(2)), owner: e.owner && e.owner.name, w: e.weapon }));
  S.t0 = game.time; S.done = false;
}
export function drive(t, dt, game) {
  const { A, B } = R;
  if (!A) return;
  const el = game.time - S.t0;
  if (el > 0.5 && !S.thrown) {
    A.spawn(new THREE.Vector3(-7, 0, 18), -Math.PI / 2); B.spawn(new THREE.Vector3(7, 0, 18), Math.PI / 2);
    A.spawnProtectedUntil = 0; B.spawnProtectedUntil = 0;
    A.grenades = 3;
    S.thrown = true; S.ok = A.brain.throwGrenadeAt(B.position);
    S.S0 = game.time;
    const g = game.projectiles.grenades[0];
    S.log.push({ note: 'throw', ok: S.ok, v: g ? g.velocity.toArray().map(x => +x.toFixed(1)) : null, o: g ? g.position.toArray().map(x => +x.toFixed(2)) : null, fuse: g ? +g.fuse.toFixed(2) : null, A: A.position.toArray(), B: B.position.toArray(), Bhealth: B.health, Bprot: B.isProtected(), Bgod: B.god, Bteam: B.team, Ateam: A.team });
  }
  if (S.thrown && game.time - S.S0 < 3) {
    const g = game.projectiles.grenades[0];
    if (g && S.log.length < 90) S.log.push([+(game.time - S.S0).toFixed(2), ...g.position.toArray().map(x => +x.toFixed(2)), g.velocity.toArray().map(x => +x.toFixed(1)).join(','), +g.fuse.toFixed(2)].join(' '));
  }
}
export function finish(game, report) { S.Bhealth = R.B.health; S.Balive = R.B.alive; }

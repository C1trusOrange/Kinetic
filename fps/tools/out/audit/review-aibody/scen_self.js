import * as THREE from 'three';
const S = { rockets: 0, grenades: 0, selfDmg: {}, selfDmgCount: {}, earlyBlast: [], nearOwnerBlast: 0, selfKills: 0, kills: 0, rocketDirectSelf: 0, quick: 0 };
export async function setup(game, report) {
  report.custom = S;
  const P = game.projectiles;
  const origRocket = P.spawnRocket.bind(P);
  P.spawnRocket = function (o) {
    S.rockets++;
    const r = origRocket(o);
    r._born = game.time; r._o = o.owner; r._org = o.origin.clone();
    // check spawn inside wall: ray from owner's eye to origin
    if (o.owner && o.owner.isBot) {
      const eye = o.owner.getEyePosition(new THREE.Vector3());
      const d = new THREE.Vector3().subVectors(o.origin, eye);
      const L = d.length(); d.normalize();
      const w = game.world.raycast(eye, d, L);
      if (w) S.earlyBlast.push({ kind: 'spawn-behind-wall', bot: o.owner.name, L: +L.toFixed(2), wall: +w.distance.toFixed(2) });
    }
    return r;
  };
  const origG = P.spawnGrenade.bind(P);
  P.spawnGrenade = function (o) { S.grenades++; return origG(o); };
  game.events.on('explosion', e => {
    if (e.weapon !== 'rocket' || !e.owner) return;
    const d = e.position.distanceTo(new THREE.Vector3(e.owner.position.x, e.owner.position.y + 1, e.owner.position.z));
    if (d < 2.5) { S.nearOwnerBlast++; if (S.earlyBlast.length < 12) S.earlyBlast.push({ kind: 'blast-near-owner', d: +d.toFixed(2), bot: e.owner.name, state: e.owner.brain ? e.owner.brain.state : '-' }); }
  });
  game.events.on('damage', e => {
    if (e.attacker && e.attacker === e.target && e.target.isBot) {
      S.selfDmg[e.weapon] = (S.selfDmg[e.weapon] || 0) + e.amount;
      S.selfDmgCount[e.weapon] = (S.selfDmgCount[e.weapon] || 0) + 1;
    }
  });
  game.events.on('death', e => { if (e.victim.isBot) { S.kills++; if (e.attacker === e.victim) S.selfKills++; } });
  // force rocket-heavy: give everybody a rocket launcher
  for (const b of game.bots.list) { b.giveWeapon('rocket'); }
}
export function drive() {}
export function finish(game) {
  for (const k in S.selfDmg) S.selfDmg[k] = +S.selfDmg[k].toFixed(0);
  S.earlyBlast = S.earlyBlast.slice(0, 12);
}

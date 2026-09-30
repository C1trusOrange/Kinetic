import * as THREE from 'three';
const S = { rockets: 0, short: [], selfDmg: 0, selfHits: 0, ageHist: {}, wallFire: 0, stats: {} };
export async function setup(game, report) {
  report.custom = S;
  const P = game.projectiles;
  const origRocket = P.spawnRocket.bind(P);
  P.spawnRocket = function (o) {
    S.rockets++;
    const r = origRocket(o);
    const b = o.owner;
    r._born = game.time; r._org = o.origin.clone();
    if (b && b.isBot) {
      const eye = b.getEyePosition(new THREE.Vector3());
      const aim = b.getAimDirection(new THREE.Vector3());
      const w = game.world.raycast(eye, aim, 60);
      const tgt = b.brain.target;
      const dtT = tgt ? new THREE.Vector3(tgt.position.x, tgt.position.y + tgt.height * 0.62, tgt.position.z).sub(eye) : null;
      let ang = -1, losClear = null, losWall = -1;
      if (dtT) { const L = dtT.length(); dtT.normalize(); ang = +Math.acos(Math.min(1, Math.max(-1, dtT.dot(aim)))).toFixed(3); const w2 = game.world.raycast(eye, dtT, L); losClear = !w2; losWall = w2 ? +w2.distance.toFixed(1) : -1; S.unsafe = S.unsafe || {n: 0, total: 0}; }
      S.unsafe = S.unsafe || { n: 0, total: 0 }; S.unsafe.total++; if (w && w.distance < 4.8) S.unsafe.n++;
      r._ctx = { ang, losClear, losWall, bot: b.name, state: b.brain.state, wallDist: w ? +w.distance.toFixed(2) : -1, tgtDist: tgt ? +tgt.position.distanceTo(b.position).toFixed(1) : -1, tgtVis: b.brain.targetRec ? b.brain.targetRec.visible : null, org2eye: +eye.distanceTo(o.origin).toFixed(2), spd: +b.speed.toFixed(1), pitch: +b.pitch.toFixed(2) };
    }
    return r;
  };
  const origRel = P._releaseRocket.bind(P);
  P._releaseRocket = function (r) {
    const age = game.time - r._born;
    const travel = r.position.distanceTo(r._org);
    if (r._ctx && (age < 0.25 || travel < 3)) S.short.push({ age: +age.toFixed(2), travel: +travel.toFixed(2), ...r._ctx });
    return origRel(r);
  };
  game.events.on('damage', e => { if (e.attacker && e.attacker === e.target && e.weapon === 'rocket') { S.selfHits++; S.selfDmg += e.amount; } });
  const setRocket = e => { const b = e.entity; if (!b.isBot) return; b.giveWeapon('rocket'); b.inv.rocket.reserve = 99; b.selectWeapon('rocket'); b.equipUntil = 0; };
  for (const b of game.bots.list) { b.brain.chooseWeapon = () => {}; b.brain.considerGrenade = () => {}; setRocket({ entity: b }); }
  game.events.on('spawn', e => { const b = e.entity; if (b.isBot) { b.brain.chooseWeapon = () => {}; b.brain.considerGrenade = () => {}; setRocket(e); } });
}
export function drive() {}
export function finish(game) { S.short = S.short.slice(0, 14); S.selfDmg = Math.round(S.selfDmg); }

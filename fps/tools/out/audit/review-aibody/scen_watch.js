import * as THREE from 'three';
const S = { stuck: {}, tele: 0, teleLog: [], nan: [], embedded: [], maxSpeed: 0, hopStats: {}, groundFlicker: {}, lowY: [], gibs: 0, nextCheck: 0 };
let _teleOrig = null;
export async function setup(game, report) {
  report.custom = S;
  for (const b of game.bots.list) {
    S.stuck[b.name] = 0;
    S.groundFlicker[b.name] = 0;
    b._wasG = true;
  }
  const proto = Object.getPrototypeOf(game.bots.list[0]);
  _teleOrig = proto.teleportTo;
  proto.teleportTo = function (pos, yaw) {
    S.tele++;
    S.teleLog.push({ t: +game.time.toFixed(1), bot: this.name, from: this.position.toArray().map(v => +v.toFixed(1)), to: pos.toArray().map(v => +v.toFixed(1)), state: this.brain.state });
    return _teleOrig.call(this, pos, yaw);
  };
}
export function drive(t, dt, game, report) {
  const col = game.world.collision;
  for (const b of game.bots.list) {
    if (!b.alive) continue;
    const it = b.brain.intent;
    const p = b.position, v = b.velocity;
    if (!isFinite(p.x + p.y + p.z + v.x + v.y + v.z + b.yaw + b.pitch + b.bodyYaw)) {
      S.nan.push({ bot: b.name, t: +t.toFixed(1), p: p.toArray(), v: v.toArray(), yaw: b.yaw, pitch: b.pitch });
    }
    if (b.onGround && it.speed > 2 && Math.hypot(it.moveX, it.moveZ) > 0.5 && b.speed < 0.3) S.stuck[b.name] += dt;
    if (b.onGround !== b._wasG) S.groundFlicker[b.name]++;
    b._wasG = b.onGround;
    S.maxSpeed = Math.max(S.maxSpeed, b.speed);
    if (p.y < game.world.bounds.min.y) S.lowY.push({ bot: b.name, y: p.y });
  }
  if (t >= S.nextCheck) {
    S.nextCheck = t + 0.5;
    for (const b of game.bots.list) {
      if (!b.alive) continue;
      const r = col.capsuleIntersect(b.capsule);
      if (r && r.depth > 0.12) S.embedded.push({ bot: b.name, t: +t.toFixed(1), depth: +r.depth.toFixed(2), p: b.position.toArray().map(v => +v.toFixed(1)) });
    }
  }
}
export function finish(game, report) {
  S.gibs = game.effects.gibList.length;
  S.stuck = Object.fromEntries(Object.entries(S.stuck).map(([k, v]) => [k, +v.toFixed(1)]));
  S.embedded = S.embedded.slice(0, 10);
  S.teleLog = S.teleLog.slice(0, 10);
  S.nan = S.nan.slice(0, 5);
  S.lowY = S.lowY.slice(0, 5);
  S.deaths = game.bots.list.map(b => b.deaths).join(',');
  S.time = game.time;
}

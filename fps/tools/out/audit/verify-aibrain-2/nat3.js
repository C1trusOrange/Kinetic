// Natural sim: log rescue teleports (call-site), pad launches / re-launches, airborne pickup blacklists, invalidations at pad waypoints.
import * as THREE from 'three';
const f = v => +v.toFixed(1);
const nap = () => new Promise(r => setTimeout(r, 0));
const DOWN = new THREE.Vector3(0, -1, 0);
export async function setup(game, report) {
  const C = report.custom = { tele: [], launches: [], blk: [], invPad: 0, invTotal: 0, ping: [] };
  game.autotest.duration = 1e9;
  const col = game.world.collision, gnav = game.world.nav;
  const SEC = parseFloat(game.params.get('sec') || '250');
  const jit = game.params.get('jit') === '1';
  const lastLaunch = new Map();
  for (const b of game.bots.list) {
    const br = b.brain, nav = br.nav;
    const m = br._ignored, os = m.set.bind(m);
    m.set = (k, v) => {
      const dur = v - game.time;
      if (dur > 60) {
        const g = col.raycast(b.position, DOWN, 40);
        C.blk.push({ t: f(game.time), bot: b.name, st: br.state, kind: (k && (k.type + (k.weapon ? ':' + k.weapon : ''))) || '?', onGround: b.onGround, gap: g ? f(g.distance) : null });
      }
      return os(k, v);
    };
    const ot = b.teleportTo.bind(b);
    b.teleportTo = (pos, yaw) => {
      const g = col.raycast(b.position, DOWN, 40);
      const st = (new Error().stack.split('\n').slice(2, 6).map(s => s.trim().replace(/^.*\//, '')).join(' < '));
      C.tele.push({ t: f(game.time), bot: b.name, state: br.state, onGround: b.onGround, gap: g ? f(g.distance) : null, hp: Math.round(b.health), st });
      return ot(pos, yaw);
    };
    const ol = b.launch.bind(b);
    b.launch = (v) => {
      const lt = lastLaunch.get(b) ?? -99;
      C.launches.push({ t: f(game.time), bot: b.name, st: br.state, dt: f(game.time - lt), pos: [f(b.position.x), f(b.position.y), f(b.position.z)] });
      lastLaunch.set(b, game.time);
      return ol(v);
    };
    const oi = nav.invalidate.bind(nav);
    nav.invalidate = () => {
      C.invTotal++;
      const wp = nav.path && nav.path[nav.index];
      if (wp && wp.pad) C.invPad++;
      return oi();
    };
  }
  const dt0 = 1 / 60;
  let acc = 0;
  for (let i = 0; acc < SEC; i++) {
    const dt = jit ? dt0 * (0.6 + Math.random() * 1.4) : dt0;
    game.update(dt);
    acc += dt;
    if (i % 240 === 239) await nap();
  }
  const L = C.launches;
  C.summary = {
    launches: L.length,
    relaunch12: L.filter(l => l.dt < 12).length,
    relaunch6: L.filter(l => l.dt < 6).length,
    tele: C.tele.length,
    teleFromRoamPick: C.tele.filter(t => /pickRoamGoal/.test(t.st)).length,
    teleFromRoamPickAir: C.tele.filter(t => /pickRoamGoal/.test(t.st) && !t.onGround).length,
    teleAir: C.tele.filter(t => !t.onGround).length,
    blk: C.blk.length,
    blkAir: C.blk.filter(b => !b.onGround).length,
    invTotal: C.invTotal,
    invPad: C.invPad,
  };
  game.autotest.duration = game.autotest.t + 0.05;
}
export function drive() {}

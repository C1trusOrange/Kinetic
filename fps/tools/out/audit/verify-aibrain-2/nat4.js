// Natural sim, part 2: (a) pad flights: landing vs pad target, replans during flight; (b) pickRoamGoal calls while airborne + rescue() results.
import * as THREE from 'three';
const f = v => +v.toFixed(1);
const nap = () => new Promise(r => setTimeout(r, 0));
const DOWN = new THREE.Vector3(0, -1, 0);
export async function setup(game, report) {
  const C = report.custom = { flights: [], roam: [], rescue: [], reqAir: 0, reqAirFail: 0 };
  game.autotest.duration = 1e9;
  const col = game.world.collision;
  const pads = game.world.jumpPads;
  const SEC = parseFloat(game.params.get('sec') || '250');
  const jit = game.params.get('jit') === '1';
  const pend = new Map();
  for (const b of game.bots.list) {
    const br = b.brain, nav = br.nav;
    const ol = b.launch.bind(b);
    b.launch = (v) => {
      let bi = -1, bd = 1e9;
      pads.forEach((p, i) => { const d = Math.hypot(p.position.x - b.position.x, p.position.z - b.position.z); if (d < bd) { bd = d; bi = i; } });
      pend.set(b, { t0: game.time, pad: bi, st: br.state, inv: 0, req: 0, mode0: nav.mode, hasGoal: nav.hasGoal, goal: [f(nav.goal.x), f(nav.goal.y), f(nav.goal.z)], maxY: b.position.y, air: 0 });
      return ol(v);
    };
    const oi = nav.invalidate.bind(nav);
    nav.invalidate = () => { const p = pend.get(b); if (p) p.inv++; return oi(); };
    const orq = nav._requestPath.bind(nav);
    nav._requestPath = () => { const p = pend.get(b); if (p && !b.onGround) p.req++; return orq(); };
    const opr = br.pickRoamGoal.bind(br);
    br.pickRoamGoal = () => {
      const air = !b.onGround;
      const g = air ? col.raycast(b.position, DOWN, 40) : null;
      const hadGoal = nav.hasGoal, rf0 = br.roamFailures;
      const r = opr();
      if (air) C.roam.push({ t: f(game.time), bot: b.name, gap: g ? f(g.distance) : null, goalSet: nav.hasGoal && (!hadGoal || nav.dirty), rf: [rf0, br.roamFailures], st: br.state });
      return r;
    };
    const ors = br.rescue.bind(br);
    br.rescue = () => {
      const r = ors();
      C.rescue.push({ t: f(game.time), bot: b.name, ret: r, air: !b.onGround, st: br.state, stack: new Error().stack.split('\n')[2].trim().replace(/^.*\//, '') });
      return r;
    };
  }
  const dt0 = 1 / 60;
  let acc = 0;
  for (let i = 0; acc < SEC; i++) {
    const dt = jit ? dt0 * (0.6 + Math.random() * 1.4) : dt0;
    game.update(dt);
    acc += dt;
    for (const [b, p] of pend) {
      if (!b.alive) { pend.delete(b); continue; }
      p.maxY = Math.max(p.maxY, b.position.y);
      if (game.time - p.t0 > 0.4 && b.onGround) {
        const pad = pads[p.pad];
        const tg = pad ? pad.target : null;
        const nav = b.brain.nav;
        C.flights.push({
          t: f(p.t0), bot: b.name, pad: p.pad, st: p.st, air: f(game.time - p.t0), maxY: f(p.maxY), inv: p.inv, req: p.req,
          land: [f(b.position.x), f(b.position.y), f(b.position.z)],
          target: tg ? [f(tg.x), f(tg.y), f(tg.z)] : null,
          miss: tg ? f(Math.hypot(b.position.x - tg.x, b.position.z - tg.z)) : null,
          dyT: tg ? f(b.position.y - tg.y) : null,
          unr: nav.unreachable, mode: nav.mode,
        });
        pend.delete(b);
      }
    }
    if (i % 240 === 239) await nap();
  }
  const F = C.flights;
  C.summary = {
    flights: F.length,
    missOver4: F.filter(x => x.miss !== null && (x.miss > 4 || Math.abs(x.dyT) > 2.5)).length,
    withInv: F.filter(x => x.inv > 0).length,
    withReq: F.filter(x => x.req > 0).length,
    longAir: F.filter(x => x.air > 4).length,
    roamAirCalls: C.roam.length,
    roamAirNoGoal: C.roam.filter(x => !x.goalSet).length,
    rescueCalls: C.rescue.length,
    rescueTrue: C.rescue.filter(x => x.ret).length,
  };
  game.autotest.duration = game.autotest.t + 0.05;
}
export function drive() {}

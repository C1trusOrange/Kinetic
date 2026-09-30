// Verifier: natural bot match with hooks. Logs (a) pickup blacklisting + whether the bot was airborne, (b) rescue teleports,
// (c) pad launches, (d) stuck recoveries with position/waypoint.
const f = v => +v.toFixed(1);
const nap = () => new Promise(r => setTimeout(r, 0));
export async function setup(game, report) {
  const C = report.custom = { ign: [], rescue: [], launches: [], stuck: [], roamFail: [] };
  game.autotest.duration = 1e9;
  const SECONDS = parseFloat(game.params.get('secs') || '200');
  const DT = 1 / parseFloat(game.params.get('sfps') || '30');
  const col = game.world.collision;
  const gapBelow = b => { const o = b.position.clone(); o.y += 0.1; const h = col.raycast(o, { x: 0, y: -1, z: 0, isVector3: true, clone() { return this; } }, 60); return h ? +(h.distance - 0.1).toFixed(1) : 99; };
  // Vector3 for the ray direction
  const THREE_V = game.player.position.constructor;
  const down = new THREE_V(0, -1, 0);
  const gap = b => { const o = b.position.clone(); o.y += 0.1; const h = col.raycast(o, down, 60); return h ? f(h.distance - 0.1) : 99; };
  const nm = b => b.name;
  for (const b of game.bots.list) {
    const br = b.brain, nav = br.nav;
    const oSet = br._ignored.set.bind(br._ignored);
    br._ignored.set = (p, u) => {
      const t = game.time;
      if (u - t > 30) C.ign.push({ t: f(t), bot: nm(b), what: p.type + (p.weapon ? ':' + p.weapon : ''), air: !b.onGround, gap: gap(b), y: f(b.position.y), state: br.state, mode: nav.mode, unreach: nav.unreachable, kind: br.retreatKind, lastLaunchAgo: f(t - b.lastLaunchTime), hp: Math.round(b.health) });
      return oSet(p, u);
    };
    const oResc = br.rescue.bind(br);
    br.rescue = () => {
      const air = !b.onGround, g = gap(b), pos = b.position.toArray().map(f), st = br.state, lf = br.roamFailures;
      const r = oResc();
      C.rescue.push({ t: f(game.time), bot: nm(b), ok: r, air, gap: g, pos, state: st, roamFailures: lf, stage: br.stuckStage, caller: (new Error().stack.split('\n')[2] || '').trim().replace(/^.*\//, '') });
      return r;
    };
    const oRec = br.recoverStuck.bind(br);
    br.recoverStuck = (t) => {
      const wp = nav.path && nav.path[nav.index];
      C.stuck.push({ t: f(t), bot: nm(b), pos: b.position.toArray().map(f), state: br.state, mode: nav.mode, wp: wp ? [f(wp.x), f(wp.y), f(wp.z), wp.type || ''].join(',') : null, stage: br.stuckStage + 1 });
      return oRec(t);
    };
    const oLaunch = b.launch.bind(b);
    b.launch = (v) => { C.launches.push({ t: f(game.time), bot: nm(b), state: br.state, mode: nav.mode, idx: nav.index, len: nav.path ? nav.path.length : 0 }); return oLaunch(v); };
  }
  const nap2 = async () => { await nap(); };
  const n = Math.round(SECONDS / DT);
  for (let i = 0; i < n; i++) {
    game.update(DT);
    if (i % 200 === 199) await nap2();
  }
  C.simSeconds = SECONDS;
  C.summary = { ign: C.ign.length, ignAir: C.ign.filter(x => x.air).length, rescue: C.rescue.length, rescueAir: C.rescue.filter(x => x.air).length, launches: C.launches.length, stuck: C.stuck.length };
  game.autotest.duration = 0;
}
export function drive() {}

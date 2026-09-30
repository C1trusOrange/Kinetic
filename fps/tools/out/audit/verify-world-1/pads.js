const st = { i: 0, phase: 'spawn', t0: 0, launched: false, res: [], apexY: -1e9, minZfeet: null, traj: [] };
export function setup(game, report) {
  report.custom = { pads: st.res, count: game.world.jumpPads.length, map: game.world.mapId, warnings: game.world.warnings.filter(w => /jumpPad/.test(w)) };
}
export function drive(t, dt, game, report) {
  const w = game.world, pads = w.jumpPads, p = game.player;
  if (st.i >= pads.length) { report.custom.finished = true; return; }
  const pad = pads[st.i];
  if (st.phase === 'spawn') {
    p.spawn(pad.position.clone(), 0); p.god = true;
    st.phase = 'wait'; st.t0 = game.time; st.launched = false; st.traj = [];
    return;
  }
  if (!st.launched && p.lastLaunchTime >= st.t0 - 1e-6 && game.time - p.lastLaunchTime < 0.2) { st.launched = true; st.launchT = game.time; st.v0 = p.velocity.toArray().map(v => +v.toFixed(2)); }
  if (st.launched) {
    const air = game.time - st.launchT;
    if (Math.round(air * 20) % 2 === 0 && st.traj.length < 60) st.traj.push([+air.toFixed(2), ...p.position.toArray().map(v => +v.toFixed(2)), ...p.velocity.toArray().map(v => +v.toFixed(1))]);
    if ((p.onGround && air > 0.4) || air > 6) {
      const tg = pad.target;
      st.res.push({ i: st.i, pos: pad.position.toArray().map(v => +v.toFixed(2)), target: tg.toArray().map(v => +v.toFixed(2)), land: p.position.toArray().map(v => +v.toFixed(2)),
        errH: +Math.hypot(p.position.x - tg.x, p.position.z - tg.z).toFixed(2), errY: +(p.position.y - tg.y).toFixed(2), air: +air.toFixed(2), v0: st.v0, warn: w.warnings.filter(m => m.startsWith('jumpPad #' + st.i)) });
      if (st.i === 3 && w.mapId === 'ruins' || st.i === 0 && w.mapId === 'skyline') report.custom['traj_' + st.i] = st.traj.slice(0, 20);
      st.i++; st.phase = 'spawn';
    }
  } else if (game.time - st.t0 > 1.5) { st.res.push({ i: st.i, error: 'never launched' }); st.i++; st.phase = 'spawn'; }
}

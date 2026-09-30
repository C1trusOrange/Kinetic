const st = { i: 0, phase: 'spawn', t0: 0, launched: false, apex: -1e9, res: [], tl: 0, mode: 'center' };
export function setup(game, report) {
  game.player.god = true;
  report.custom = { pads: st.res, count: game.world.jumpPads.length };
}
export function drive(t, dt, game, report) {
  const w = game.world, pads = w.jumpPads, p = game.player;
  if (st.i >= pads.length) { report.custom.finished = true; return; }
  const pad = pads[st.i];
  if (st.phase === 'spawn') {
    p.spawn(pad.position.clone(), 0);
    p.god = true;
    st.phase = 'wait'; st.t0 = game.time; st.launched = false; st.apex = -1e9; st.tl = 0;
    return;
  }
  if (!st.launched && p.lastLaunchTime >= st.t0 - 1e-6 && game.time - p.lastLaunchTime < 0.2) { st.launched = true; st.vel = p.velocity.clone(); st.pos0 = p.position.clone(); st.launchT = game.time; }
  if (st.launched) {
    st.apex = Math.max(st.apex, p.position.y);
    const air = game.time - st.launchT;
    if ((p.onGround && air > 0.4) || air > 6 || p.position.y < w.killY + 5) {
      const tgt = pad.target;
      st.res.push({ i: st.i, pos: pad.position.toArray().map(v => +v.toFixed(2)), target: tgt.toArray().map(v => +v.toFixed(2)),
        land: p.position.toArray().map(v => +v.toFixed(2)), errH: +Math.hypot(p.position.x - tgt.x, p.position.z - tgt.z).toFixed(2), errY: +(p.position.y - tgt.y).toFixed(2),
        apexRel: +(st.apex - pad.position.y).toFixed(2), vel: pad.velocity.toArray().map(v => +v.toFixed(2)), air: +air.toFixed(2), onGround: p.onGround });
      st.i++; st.phase = 'spawn';
    }
  } else if (game.time - st.t0 > 1.5) {
    st.res.push({ i: st.i, error: 'never launched', pos: pad.position.toArray(), playerPos: p.position.toArray() });
    st.i++; st.phase = 'spawn';
  }
}

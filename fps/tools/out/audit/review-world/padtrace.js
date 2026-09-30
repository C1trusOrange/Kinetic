const P = new URLSearchParams(location.search);
const idx = parseInt(P.get('pad') || '0', 10);
const st = { phase: 'spawn', t0: 0, launched: false, trace: [], done: false };
export function setup(game, report) { game.player.god = true; report.custom = { trace: st.trace, idx }; }
export function drive(t, dt, game, report) {
  const w = game.world, pad = w.jumpPads[idx], p = game.player;
  if (st.done) return;
  if (st.phase === 'spawn') { p.spawn(pad.position.clone(), 0); p.god = true; st.phase = 'wait'; st.t0 = game.time; return; }
  if (!st.launched && game.time - p.lastLaunchTime < 0.2 && p.lastLaunchTime >= st.t0) { st.launched = true; st.launchT = game.time; }
  if (st.launched) {
    const air = game.time - st.launchT;
    st.trace.push([+air.toFixed(2), ...p.position.toArray().map(v => +v.toFixed(2)), ...p.velocity.toArray().map(v => +v.toFixed(1)), p.onGround ? 1 : 0]);
    if ((p.onGround && air > 0.4) || air > 4) { st.done = true; report.custom.finished = true; report.custom.pad = { pos: pad.position.toArray(), target: pad.target.toArray(), vel: pad.velocity.toArray() }; }
  }
}

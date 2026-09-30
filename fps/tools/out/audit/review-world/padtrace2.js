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
    const mv = p.move;
    const cap = mv.capsule;
    const r = w.collision.capsuleIntersect(cap);
    st.trace.push({ t: +air.toFixed(2), pos: p.position.toArray().map(v => +v.toFixed(2)), vel: p.velocity.toArray().map(v => +v.toFixed(1)),
      wr: !!p.isWallRunning, mantle: !!p.isMantling, grap: !!p.isGrappling, slide: !!p.isSliding, og: p.onGround,
      cs: cap.start.toArray().map(v => +v.toFixed(2)), ce: cap.end.toArray().map(v => +v.toFixed(2)),
      col: r ? [+r.depth.toFixed(3), r.normal.toArray().map(v => +v.toFixed(2))] : null });
    if (air > 1.0) { st.done = true; report.custom.finished = true; }
  }
}

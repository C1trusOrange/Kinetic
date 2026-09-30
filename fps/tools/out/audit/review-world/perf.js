const S = { n: 0, t: 0, max: 0, pk: 0, pad: 0, sky: 0 };
export function setup(game, report) {
  const w = game.world;
  const orig = w.update.bind(w);
  w.update = function (dt) { const t0 = performance.now(); orig(dt); const d = performance.now() - t0; S.n++; S.t += d; if (d > S.max) S.max = d; };
  const pu = w.pickups.update.bind(w.pickups);
  w.pickups.update = function (dt) { const t0 = performance.now(); pu(dt); S.pk += performance.now() - t0; };
  const up = w._updatePads.bind(w);
  w._updatePads = function (dt) { const t0 = performance.now(); up(dt); S.pad += performance.now() - t0; };
  report.custom = S;
  game.events.on('pickup', e => { (S.by ||= {})[(e.entity.isPlayer ? 'player' : 'bot') + ':' + e.pickup.type] = ((S.by || {})[(e.entity.isPlayer ? 'player' : 'bot') + ':' + e.pickup.type] || 0) + 1; });
}
export function drive(t, dt, game, report) {
  S.avgMs = S.n ? +(S.t / S.n).toFixed(4) : 0; S.pkAvg = S.n ? +(S.pk / S.n).toFixed(4) : 0; S.padAvg = S.n ? +(S.pad / S.n).toFixed(4) : 0;
  const jp = game.world.jumpPads;
  S.padLaunches = (S.padLaunches || 0);
}

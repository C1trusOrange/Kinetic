const SPOTS = [[-2.2, 2], [0.6, -3], [2.5, -10], [-3, -18]];
export function setup(game, report) {
  report.custom = { n: 0 };
  for (const el of game.uiRoot.children) el.style.display = 'none';
}
export function drive(t, dt, game, report) {
  if (t < 1) for (const el of game.uiRoot.children) el.style.display = 'none';
  const list = game.bots.list;
  const P = window.__SPOTS || SPOTS;
  list.forEach((b, i) => {
    if (i >= P.length) return;
    b.health = 100;
    b.position.set(P[i][0], 0.0, P[i][1]);
    b.velocity.set(0, 0, 0);
    b.yaw = Math.PI + 0.35 - i * 0.2;
    b.bodyYaw = b.yaw;
    b.pitch = 0.05;
  });
  report.custom.n = list.length;
  if (t > 3) window.__BOTS_READY__ = true;
}

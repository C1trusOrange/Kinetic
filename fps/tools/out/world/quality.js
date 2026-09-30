export function setup(game, report) { report.custom = { steps: [] }; }
export function drive(t, dt, game, report) {
  const seq = [[1.0, 'low'], [2.0, 'medium'], [3.0, 'high'], [4.0, 'low'], [5.0, 'high']];
  for (const [at, q] of seq) {
    if (t >= at && !report.custom['done_' + at]) {
      report.custom['done_' + at] = true;
      game.setQuality(q);
      report.custom.steps.push({ at, q, sunShadow: game.world.sun.castShadow, map: game.world.sun.shadow.mapSize.x });
    }
  }
}
export function finish(game, report) { report.custom.lights = 0; game.scene.traverse(o => { if (o.isLight) report.custom.lights++; }); }

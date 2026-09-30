export function setup(game, report) { report.custom = { jumps: 0 }; }
export function drive(t, dt, game, report) {
  game.input.setVirtual('forward', t > 0.5 && t < 2);
  const j = t > 1 && t < 1.05;
  if (j) report.custom.jumps++;
  game.input.setVirtual('jump', j);
}
export function finish(game, report) { report.custom.finalY = +game.player.position.y.toFixed(2); }

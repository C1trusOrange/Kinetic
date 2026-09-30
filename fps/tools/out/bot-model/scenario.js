export function setup(game, report) {
  report.custom = {};
  for (const el of game.uiRoot.children) el.style.display = 'none';
}
export function drive(t, dt, game, report) {
  // hide UI every frame (menu may re-show loading overlays)
  if (t < 0.5) for (const el of game.uiRoot.children) el.style.display = 'none';
  const list = game.bots.list;
  if (list.length && !report.custom.bot) report.custom.bot = list[0].name;
  report.custom.states = list.map(b => b.brain ? b.brain.state : '?');
}

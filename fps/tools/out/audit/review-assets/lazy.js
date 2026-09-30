const rec = { built: [] };
export function setup(game, report) {
  report.custom = rec;
  const bot = game.bots.list[0];
  rec.botInitialWeapon = bot.weaponId;
  for (const id of ['pistol', 'rifle', 'shotgun', 'sniper', 'rocket']) {
    const had = !!bot._weaponModels[id];
    const t0 = performance.now();
    bot._getWeaponModel(id);
    rec.built.push({ id, had, ms: +(performance.now() - t0).toFixed(1) });
  }
  // second pass: instance cost only (templates cached)
  const b2 = game.bots.list[1] || bot;
  rec.instance = [];
  for (const id of ['pistol', 'rifle', 'shotgun', 'sniper', 'rocket']) {
    const t0 = performance.now(); b2._weaponModels[id] || b2._getWeaponModel(id); rec.instance.push({ id, ms: +(performance.now() - t0).toFixed(2) });
  }
}
export function drive() {}

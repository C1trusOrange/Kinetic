const g = window.__GAME__;
const WM = await import('/src/weapons/WeaponModels.js');
const out = { pickupWeapons: g.world.pickups.list.filter(p => p.type === 'weapon').map(p => p.weapon), botWeapons: g.bots.list.map(b => b.owned.join('+')) };
for (const id of ['pistol', 'rifle', 'shotgun', 'sniper', 'rocket']) {
  const t0 = performance.now();
  WM.createWeaponModel(id, { view: false });
  const t1 = performance.now();
  out[id] = +(t1 - t0).toFixed(1);
}
return out;

const WM = await import('/src/weapons/WeaponModels.js');
const out = {};
for (const id of ['pistol', 'rifle', 'shotgun', 'sniper', 'rocket']) {
  const t0 = performance.now();
  WM.createWeaponModel(id, { view: false });
  const t1 = performance.now();
  WM.createWeaponModel(id, { view: false });
  const t2 = performance.now();
  out[id] = { first: +(t1 - t0).toFixed(1), second: +(t2 - t1).toFixed(2) };
}
const { BotModel } = await import('/src/ai/BotModel.js');
const t0 = performance.now();
const m = new BotModel({ color: 0xff0000 });
const t1 = performance.now();
const m2 = new BotModel({ color: 0x00ff00 });
const t2 = performance.now();
const m3 = new BotModel({ color: 0x00ff00 });
const t3 = performance.now();
out.botModel = { firstColor: +(t1 - t0).toFixed(1), secondColor: +(t2 - t1).toFixed(1), sameColor: +(t3 - t2).toFixed(2) };
return out;

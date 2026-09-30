// Times model creation paths that run mid-game.
export async function setup(game, report) {
  const c = report.custom = {};
  const WM = await import('/src/weapons/WeaponModels.js');
  const BM = await import('/src/ai/BotModel.js');
  const ids = ['pistol', 'rifle', 'shotgun', 'sniper', 'rocket'];
  const time = (fn) => { const t = performance.now(); const r = fn(); return [+(performance.now() - t).toFixed(1), r]; };
  c.weaponWorld = {};
  for (const id of ids) {
    const runs = [];
    for (let i = 0; i < 3; i++) runs.push(time(() => WM.createWeaponModel(id, { view: false }))[0]);
    c.weaponWorld[id] = runs;
  }
  c.weaponView = {};
  for (const id of ids) {
    const runs = [];
    for (let i = 0; i < 2; i++) runs.push(time(() => WM.createWeaponModel(id, { view: true }))[0]);
    c.weaponView[id] = runs;
  }
  // geometry / material / texture counts created per world weapon model
  const meshCount = (root) => { let m = 0, g = new Set(), mat = new Set(), tex = new Set(); root.traverse(o => { if (o.isMesh) { m++; g.add(o.geometry); mat.add(o.material); for (const k in o.material) { const v = o.material[k]; if (v && v.isTexture) tex.add(v); } } }); return { meshes: m, geos: g.size, mats: mat.size, texs: tex.size }; };
  c.weaponStats = {};
  for (const id of ids) { const m = WM.createWeaponModel(id, { view: false }); c.weaponStats[id] = meshCount(m.root); }
  c.botModel = [];
  for (let i = 0; i < 3; i++) {
    const [ms, bm] = time(() => new BM.BotModel({ color: 0xff4a3d + i * 1000, team: i + 1 }));
    const st = meshCount(bm.root);
    const [ms2] = time(() => { bm.root.updateMatrixWorld(true); return bm.breakApart(); });
    c.botModel.push({ constructMs: ms, breakApartMs: ms2, ...st });
  }
  c.botModelWarmup = typeof BM.warmup;
}
export function drive() {}

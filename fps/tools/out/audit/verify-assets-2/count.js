import { createWeaponModel, createRocketModel, createGrenadeModel } from '/src/weapons/WeaponModels.js';
export function setup(game, report) {
  const out = {};
  for (const id of ['pistol', 'rifle', 'shotgun', 'sniper', 'rocket']) {
    for (const view of [false, true]) {
      const m = createWeaponModel(id, { view });
      let n = 0, tr = 0, tris = 0; const mats = new Set(); const small = [];
      m.root.traverse(o => { if (o.isMesh) { n++; if (o.material.transparent) tr++; mats.add(o.material.uuid); tris += o.geometry.attributes.position.count / 3;
        o.geometry.computeBoundingBox(); const s = o.geometry.boundingBox.getSize(new game.camera.position.constructor()); if (Math.max(s.x, s.y, s.z) < 0.03) small.push(o.name + ':' + (Math.max(s.x, s.y, s.z) * 100).toFixed(1) + 'cm'); } });
      out[id + (view ? ':view' : ':world')] = { meshes: n, transparent: tr, distinctMats: mats.size, tris: Math.round(tris), small };
    }
  }
  for (const [k, f] of [['rocketProj', createRocketModel], ['grenade', createGrenadeModel]]) {
    const m = f(); let n = 0; m.traverse(o => { if (o.isMesh) n++; }); out[k] = n;
  }
  report.custom = out;
}
export function drive() {}

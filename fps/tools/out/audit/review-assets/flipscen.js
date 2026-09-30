import { getMaterials } from '/src/weapons/models/WeaponMaterials.js';
const rec = { log: [] };
export function setup(game, report) {
  report.custom = rec;
  const r = game.renderer, M = getMaterials();
  const orig = r.render.bind(r);
  let frames = 0;
  r.render = (scene, cam) => {
    orig(scene, cam);
    if (game.state !== 'playing') return;
    const tag = scene === game.scene ? 'world' : (scene === game.viewScene ? 'view' : 'other');
    if (rec.log.length < 14 && game.time > 1) {
      const p = r.properties.get(M.steel), q = r.properties.get(M.glowCyan);
      rec.log.push({ pass: tag, steel: { lsv: p.lightsStateVersion, fog: !!p.fog, prog: p.currentProgram && p.currentProgram.id }, glowCyan: { lsv: q.lightsStateVersion, fog: !!q.fog, prog: q.currentProgram && q.currentProgram.id } });
    }
  };
  rec.info = { worldFog: !!game.scene.fog, viewFog: !!game.viewScene.fog };
}
export function drive() {}

import { getMaterials } from '/src/weapons/models/WeaponMaterials.js';
import { getMaterial } from '/src/world/Textures.js';
const rec = { samples: [] };
export function setup(game, report) {
  report.custom = rec;
  const r = game.renderer, M = getMaterials();
  const gold = getMaterial('gold');
  const orig = r.render.bind(r);
  r.render = (scene, cam) => {
    orig(scene, cam);
    if (game.state !== 'playing' || game.time < 1 || rec.samples.length >= 6) return;
    const tag = scene === game.scene ? 'world' : (scene === game.viewScene ? 'view' : 'other');
    if (tag === 'other') return;
    const lens = r.properties.get(M.lens), g = r.properties.get(gold);
    rec.samples.push({ pass: tag, sceneEnvIntensity: scene.environmentIntensity, lensMatIntensity: M.lens.envMapIntensity, lensUniform: lens.uniforms && lens.uniforms.envMapIntensity && lens.uniforms.envMapIntensity.value, goldMatIntensity: gold.envMapIntensity, goldUniform: g.uniforms && g.uniforms.envMapIntensity && g.uniforms.envMapIntensity.value });
  };
}
export function drive() {}

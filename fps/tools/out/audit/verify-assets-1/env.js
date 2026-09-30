import { getMaterials } from '/src/weapons/models/WeaponMaterials.js';
let done = false;
export function setup(game, report) { report.custom = {}; }
export function drive(t, dt, game, report) {
  if (t < 3 || done) return; done = true;
  const rec = report.custom, r = game.renderer, M = getMaterials();
  let gold = null;
  game.scene.traverse(o => { if (!gold && o.material && !Array.isArray(o.material) && o.material.envMapIntensity === 1.5) gold = o.material; });
  const orig = r.render.bind(r);
  rec.samples = [];
  r.render = (scene, cam) => {
    orig(scene, cam);
    const tag = scene === game.scene ? 'world' : scene === game.viewScene ? 'view' : 'other';
    if (tag === 'other') return;
    const lp = r.properties.get(M.lens), lp2 = r.properties.get(M.lensDark);
    const gp = gold ? r.properties.get(gold) : null;
    rec.samples.push({ pass: tag, sceneEnvIntensity: scene.environmentIntensity, hasEnv: !!scene.environment,
      lensMat: M.lens.envMapIntensity, lensUniform: lp.uniforms && lp.uniforms.envMapIntensity ? lp.uniforms.envMapIntensity.value : null,
      lensDarkMat: M.lensDark.envMapIntensity, lensDarkUniform: lp2.uniforms && lp2.uniforms.envMapIntensity ? lp2.uniforms.envMapIntensity.value : null,
      goldFound: !!gold, goldMat: gold && gold.envMapIntensity, goldUniform: gp && gp.uniforms && gp.uniforms.envMapIntensity ? gp.uniforms.envMapIntensity.value : null,
      lensEnvMapProp: M.lens.envMap });
  };
  game.render(); game.render();
  r.render = orig;
}

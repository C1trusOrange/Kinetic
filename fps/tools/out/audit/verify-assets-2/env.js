import { getMaterials } from '/src/weapons/models/WeaponMaterials.js';
const rec = {};
export function setup(game, report) { report.custom = rec; }
export function drive(t, dt, game, report) {
  if (t < 3 || rec.done) return;
  rec.done = true;
  const r = game.renderer, M = getMaterials();
  rec.sceneEnv = !!game.scene.environment; rec.sceneEnvIntensity = game.scene.environmentIntensity; rec.viewEnv = !!game.viewScene.environment; rec.viewEnvI = game.viewScene.environmentIntensity;
  const s = {};
  for (const k of ['lens', 'lensDark', 'lensRuby', 'steel']) {
    const p = r.properties.get(M[k]);
    s[k] = { matI: M[k].envMapIntensity, uniform: p.uniforms && p.uniforms.envMapIntensity ? p.uniforms.envMapIntensity.value : 'n/a', hasEnvMap: !!M[k].envMap, propEnv: !!p.environment };
  }
  rec.weapon = s;
  const gold = [];
  const seen = new Set();
  game.scene.traverse(o => { if (o.isMesh) for (const m of [].concat(o.material)) { if (m && m.envMapIntensity !== 1 && !seen.has(m.uuid)) { seen.add(m.uuid); const p = r.properties.get(m); gold.push({ name: m.name, matI: m.envMapIntensity, uniform: p.uniforms && p.uniforms.envMapIntensity ? p.uniforms.envMapIntensity.value : 'n/a' }); } } });
  rec.nonDefault = gold;
}

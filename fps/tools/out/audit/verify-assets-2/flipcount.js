import { getMaterials } from '/src/weapons/models/WeaponMaterials.js';
const rec = { frames: 0, flipsWorldPass: [], flipsViewPass: [] };
export function setup(game, report) {
  report.custom = rec;
  const r = game.renderer, M = getMaterials();
  const keys = Object.keys(M);
  let prev = null;
  const snap = () => keys.map(k => { const p = r.properties.get(M[k]); return p.lightsStateVersion + '|' + (p.fog ? 1 : 0); });
  const orig = r.render.bind(r);
  r.render = (scene, cam) => {
    const before = snap();
    orig(scene, cam);
    if (game.state !== 'playing' || game.time < 3) return;
    const tag = scene === game.scene ? 'world' : (scene === game.viewScene ? 'view' : null);
    if (!tag) return;
    const after = snap();
    let ch = 0; for (let i = 0; i < keys.length; i++) if (before[i] !== after[i]) ch++;
    (tag === 'world' ? rec.flipsWorldPass : rec.flipsViewPass).push(ch);
  };
}
export function drive() {}
export function finish(game, report) {
  const st = a => { const s = a.slice(5); return { n: s.length, mean: +(s.reduce((x, y) => x + y, 0) / s.length).toFixed(1), max: Math.max(...s) }; };
  report.custom.world = st(rec.flipsWorldPass); report.custom.view = st(rec.flipsViewPass);
  rec.flipsWorldPass = rec.flipsViewPass = null;
}

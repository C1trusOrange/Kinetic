import { getMaterials } from '/src/weapons/models/WeaponMaterials.js';
const rec = { log: [], A: [], B: [] };
let mode = 'A', frames = 0, nextSwitch = 0;
const swap = new Map(); // mesh -> [orig, clone]
export function setup(game, report) {
  report.custom = rec;
  const r = game.renderer, M = getMaterials();
  const orig = r.render.bind(r);
  r.render = (scene, cam) => {
    orig(scene, cam);
    if (game.state !== 'playing') return;
    const tag = scene === game.scene ? 'world' : (scene === game.viewScene ? 'view' : 'other');
    if (rec.log.length < 6 && game.time > 1) {
      const p = r.properties.get(M.steel);
      rec.log.push({ pass: tag, lsv: p.lightsStateVersion, fog: !!p.fog, prog: p.currentProgram && p.currentProgram.id });
    }
  };
  const gr = game.render.bind(game);
  game.render = function () {
    const t0 = performance.now();
    gr();
    const dt = performance.now() - t0;
    if (game.time > 3 && game.state === 'playing') { frames++; if (rec[mode]) rec[mode].push(dt); }
  };
}
function setMode(game, m) {
  const cloneMap = new Map();
  game.weapons.viewRoot.traverse(o => {
    if (!o.isMesh) return;
    if (!swap.has(o)) swap.set(o, [o.material, null]);
    const e = swap.get(o);
    if (m === 'B') {
      if (!e[1]) { let c = cloneMap.get(e[0]); if (!c) { c = e[0].clone(); cloneMap.set(e[0], c); } e[1] = c; }
      o.material = e[1];
    } else o.material = e[0];
  });
  mode = m;
}
export function drive(t, dt, game, report) {
  if (t < 3) return;
  if (t >= nextSwitch) {
    // prime clones (first B) then alternate every 1.5 s
    setMode(game, mode === 'A' ? 'B' : 'A');
    nextSwitch = t + 1.5;
  }
}
export function finish(game, report) {
  const stat = (a) => { if (!a) return null; a = a.slice(5).sort((x, y) => x - y); const s = a.reduce((x, y) => x + y, 0); return { n: a.length, mean: +(s / a.length).toFixed(3), median: +a[a.length >> 1].toFixed(3), p90: +a[Math.floor(a.length * 0.9)].toFixed(3) }; };
  report.custom.statA = stat(rec.A); report.custom.statB = stat(rec.B);
  report.custom.A = report.custom.B = null;
}

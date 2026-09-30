const rec = {};
const swap = new Map();
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
}
let done = false;
export function setup(game, report) { report.custom = rec; }
export function drive(t, dt, game, report) {
  if (t < 5 || done) return;
  done = true;
  const r = game.renderer;
  const gl = r.getContext();
  // make every viewmodel visible-ish state as is; shrink target so we're CPU bound
  r.setRenderTarget(null);
  const w = r.domElement.width, h = r.domElement.height;
  r.setPixelRatio(1); r.setSize(96, 54, false);
  const run = (n) => {
    gl.finish();
    const t0 = performance.now();
    for (let i = 0; i < n; i++) { r.render(game.scene, game.camera); r.render(game.viewScene, game.viewCamera); }
    gl.finish();
    return (performance.now() - t0) / n;
  };
  const res = { A: [], B: [] };
  // warm both
  setMode(game, 'B'); run(5); setMode(game, 'A'); run(5);
  for (let k = 0; k < 6; k++) {
    for (const m of (k % 2 ? ['B', 'A'] : ['A', 'B'])) { setMode(game, m); res[m].push(+run(60).toFixed(3)); }
  }
  rec.res = res;
  rec.calls = r.info.render.calls;
  const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
  rec.meanA = +mean(res.A).toFixed(3); rec.meanB = +mean(res.B).toFixed(3);
  rec.diff = +(rec.meanA - rec.meanB).toFixed(3);
  // how many bot weapon meshes actually rendered in world pass this frame? check frustum
  let inView = 0, total = 0;
  for (const b of game.bots.list) { const wp = b.model && b.model.weapon; if (!wp) continue; wp.root.traverse(o => { if (o.isMesh) total++; }); }
  rec.botWeaponMeshes = total;
  r.setSize(w, h, false);
}

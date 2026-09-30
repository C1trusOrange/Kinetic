const rec = {};
let done = false;
export function setup(game, report) { report.custom = rec; }
function weapons(game) { const a = []; for (const b of game.bots.list) { const w = b.model && b.model.weapon; if (w) a.push(w.root); } return a; }
export function drive(t, dt, game, report) {
  if (t < 5 || done) return;
  done = true;
  const r = game.renderer, gl = r.getContext();
  const w = r.domElement.width, h = r.domElement.height;
  r.setRenderTarget(null); r.setPixelRatio(1); r.setSize(96, 54, false);
  const roots = weapons(game);
  const meshes = []; roots.forEach(rt => rt.traverse(o => { if (o.isMesh) meshes.push(o); }));
  rec.meshes = meshes.length; rec.bots = roots.length;
  const setMode = (m) => {
    roots.forEach(rt => rt.visible = m !== 'H');
    meshes.forEach(o => o.castShadow = m === 'A');
  };
  const run = (n) => {
    gl.finish(); r.info.reset();
    const t0 = performance.now();
    for (let i = 0; i < n; i++) r.render(game.scene, game.camera);
    gl.finish();
    return (performance.now() - t0) / n;
  };
  const res = { A: [], H: [], S: [] }; const calls = {};
  for (const m of ['A', 'H', 'S']) { setMode(m); run(4); }
  const order = [['A', 'H', 'S'], ['S', 'H', 'A'], ['H', 'A', 'S'], ['A', 'S', 'H'], ['S', 'A', 'H'], ['H', 'S', 'A']];
  for (const ord of order) for (const m of ord) { setMode(m); res[m].push(+run(40).toFixed(3)); calls[m] = r.info.render.calls / 40; }
  rec.res = res; rec.calls = calls;
  const mean = a => +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(3);
  const med = a => a.slice().sort((x, y) => x - y)[a.length >> 1];
  rec.mean = { A: mean(res.A), H: mean(res.H), S: mean(res.S) };
  rec.median = { A: med(res.A), H: med(res.H), S: med(res.S) };
  setMode('A'); r.setSize(w, h, false);
}

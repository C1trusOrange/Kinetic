// Tests whether renderer.compile() warm-ups produce the same programs that the composer render path needs.
export function setup(game, report) {
  const r = game.renderer;
  const c = report.custom = { compileCalls: [], renderTargets: {}, dumps: [] };
  const origCompile = r.compile.bind(r);
  r.compile = function (scene, camera, target) {
    const n0 = r.info.programs.length;
    const rt = r.getRenderTarget();
    const res = origCompile(scene, camera, target);
    c.compileCalls.push({ t: game.time, scene: scene === game.scene ? 'world' : scene === game.viewScene ? 'view' : 'other', rtNull: rt === null, newProgs: r.info.programs.length - n0, outCS: r.outputColorSpace, tm: r.toneMapping });
    return res;
  };
  const origRender = r.render.bind(r);
  r.render = function (scene, camera) {
    const k = (scene === game.scene ? 'world' : scene === game.viewScene ? 'view' : 'other') + ':' + (r.getRenderTarget() === null ? 'screen' : 'rt');
    c.renderTargets[k] = (c.renderTargets[k] || 0) + 1;
    return origRender(scene, camera);
  };
  c.startProgs = r.info.programs.length;
  const dump = (label) => {
    const hist = {};
    const users = new Map();
    const mark = (scene, lab) => scene.traverse(o => {
      const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      for (const m of mats) { const p = r.properties.get(m); if (p && p.currentProgram) users.set(p.currentProgram.id, (users.get(p.currentProgram.id) || 0) + 1); }
    });
    mark(game.scene, 'S'); mark(game.viewScene, 'V');
    let dead = 0;
    for (const p of r.info.programs) {
      const parts = String(p.cacheKey).split(',');
      const i = parts.indexOf('highp');
      const cs = i >= 0 ? parts[i + 1] : '?';
      hist[cs] = (hist[cs] || 0) + 1;
      if (!users.has(p.id)) dead++;
    }
    c.dumps.push({ label, t: +game.time.toFixed(2), programs: r.info.programs.length, byOutputCS: hist, programsWithNoCurrentMaterial: dead });
  };
  game.__dump = dump;
  dump('setup');
}
export function drive(t, dt, game, report) {
  const c = report.custom;
  if (t > 0.5 && !game.__d1) { game.__d1 = true; game.__dump('t0.5'); }
  if (t > 2 && !game.__d2) { game.__d2 = true; game.__dump('t2'); }
  if (t > 3 && !game.__d3) { game.__d3 = true; game.input.setVirtual('fire', true); }
  if (t > 3.3 && !game.__d4) { game.__d4 = true; game.input.setVirtual('fire', false); game.__dump('after-fire'); }
}
export function finish(game, report) { game.__dump('end'); }

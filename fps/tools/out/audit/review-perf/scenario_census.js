export function setup(game, report) { report.custom = {}; }
export function drive(t, dt, game, report) {
  game.player.god = true;
  if (t > 6 && !game.__c) {
    game.__c = true;
    const scene = game.scene;
    const cnt = { total: 0, auto: 0, meshes: 0, groups: 0, lights: 0, instanced: 0, visible: 0, skinned: 0 };
    const byParent = {};
    scene.traverse(o => {
      cnt.total++;
      if (o.matrixAutoUpdate) cnt.auto++;
      if (o.isMesh) cnt.meshes++;
      if (o.isGroup || o.type === 'Object3D') cnt.groups++;
      if (o.isLight) cnt.lights++;
      if (o.isInstancedMesh) cnt.instanced++;
      if (o.visible) cnt.visible++;
    });
    for (const c of scene.children) { let n = 0; c.traverse(() => n++); const k = c.name || c.type; byParent[k] = (byParent[k] || 0) + n; }
    // time full matrix update (three does this every render: scene.updateMatrixWorld when autoUpdate)
    const N = 200;
    let t0 = performance.now();
    for (let i = 0; i < N; i++) scene.updateMatrixWorld(true);
    const ums = (performance.now() - t0) / N;
    // time projectObject-ish: renderer.render of shadowless minimal? use frustum traversal cost proxy: traverseVisible
    t0 = performance.now();
    for (let i = 0; i < N; i++) { let n = 0; scene.traverseVisible(() => n++); }
    const tms = (performance.now() - t0) / N;
    // textures resident: canvas/image sizes reachable from scene materials
    const texs = new Set();
    for (const root of [game.scene, game.viewScene]) root.traverse(o => { const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : []; for (const m of ms) for (const k in m) { const v = m[k]; if (v && v.isTexture) texs.add(v); } });
    let bytes = 0, canv = 0;
    for (const tx of texs) { const im = tx.image; if (im && im.width) { bytes += im.width * im.height * 4; canv++; } }
    report.custom = { cnt, byParent, updateMatrixWorldMs: +ums.toFixed(3), traverseVisibleMs: +tms.toFixed(3), textures: texs.size, cpuImageBytesMB: +(bytes / 1048576).toFixed(1), cpuImages: canv, bots: game.bots.list.length, calls: game.renderer.info.render.calls };
  }
}
export function finish() {}

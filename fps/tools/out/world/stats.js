export function setup(game, report) {
  const w = game.world;
  report.custom = { worldStats: w.stats, nav: w.nav.stats, warnings: w.warnings, lights: game.scene.children.length };
  let lights = 0; game.scene.traverse(o => { if (o.isLight) lights++; });
  report.custom.lightCount = lights;
}
export function drive() {}
export function finish(game, report) {
  const info = game.renderer.info;
  report.custom.render = { calls: info.render.calls, triangles: info.render.triangles, geometries: info.memory.geometries, textures: info.memory.textures };
}

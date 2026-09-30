export function setup(game, report) { report.custom = {}; }
export function drive() {}
export function finish(game, report) {
  const rows = {};
  const count = (root, key) => {
    let meshes = 0, tris = 0;
    root.traverse(o => {
      if (!(o.isMesh || o.isPoints || o.isLine)) return;
      let vis = true; let p = o; while (p) { if (!p.visible) { vis = false; break; } p = p.parent; }
      if (!vis) return;
      meshes++;
      const g = o.geometry; if (g) tris += (g.index ? g.index.count : g.attributes.position.count) / 3 * (o.isInstancedMesh ? 1 : 1);
    });
    rows[key] = { meshes, tris: Math.round(tris) };
  };
  for (const c of game.scene.children) count(c, (c.name || c.type) + '#' + c.uuid.slice(0, 4));
  report.custom.groups = rows;
  const info = game.renderer.info;
  report.custom.info = { calls: info.render.calls, tris: info.render.triangles };
  let lights = 0; game.scene.traverse(o => { if (o.isLight) lights++; });
  report.custom.lights = lights;
}

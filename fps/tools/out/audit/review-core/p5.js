// GPU resource growth when cycling quality presets, and across match restarts
const out = {};
const info = game.renderer.info;
const snap = () => ({ tex: info.memory.textures, geo: info.memory.geometries, prog: info.programs ? info.programs.length : null });
await sleep(800);
out.base = snap();
out.cycle = [];
for (let i = 0; i < 4; i++) {
  game.settings.set('quality', 'medium'); await sleep(400);
  game.settings.set('quality', 'high'); await sleep(400);
  out.cycle.push(snap());
}
game.settings.set('quality', 'low'); await sleep(400);
out.low = snap();
game.settings.set('quality', 'high'); await sleep(400);
out.backHigh = snap();
// composer render targets
out.hasComposer = !!game.composer;
// restart matches
out.restarts = [];
for (let i = 0; i < 3; i++) {
  await game.startMatch({ ...game.lastMatchConfig });
  await sleep(600);
  out.restarts.push({ ...snap(), sceneChildren: game.scene.children.length, entities: game.entities.length, time: +game.time.toFixed(2) });
}
return out;

const info = game.renderer.info;
const snap = id => ({ id, tex: info.memory.textures, geo: info.memory.geometries, prog: info.programs ? info.programs.length : null, sceneChildren: game.scene.children.length, heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(0) : null, lights: (() => { let n = 0; game.scene.traverse(o => { if (o.isLight) n++; }); return n; })() });
const out = { rounds: [] };
await sleep(500);
out.rounds.push(snap('start:' + game.world.mapId));
const ids = ['foundry', 'ruins', 'skyline', 'sandbox', 'foundry', 'ruins', 'skyline', 'sandbox'];
for (const id of ids) {
  await game.startMatch({ ...game.lastMatchConfig, mapId: id, botCount: 3 });
  await sleep(500);
  out.rounds.push(snap(id));
}
return out;

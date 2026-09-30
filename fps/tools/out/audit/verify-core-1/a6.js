const res = { samples: [] };
const mem = () => ({ tex: game.renderer.info.memory.textures, geo: game.renderer.info.memory.geometries, progs: game.renderer.info.programs ? game.renderer.info.programs.length : null });
res.start = mem();
res.quality0 = game.quality.name;
for (let i = 0; i < 3; i++) {
  game.setQuality('medium'); await sleep(300);
  const m1 = mem();
  game.setQuality('high'); await sleep(300);
  res.samples.push({ i, afterMedium: m1, afterHigh: mem() });
}
// control: dispose properly then rebuild to see growth stops
const before = mem();
for (let i = 0; i < 3; i++) {
  const c = game.composer;
  if (c) { for (const p of c.passes) if (p.dispose) p.dispose(); c.dispose(); game.composer = null; }
  game.setQuality('high'); await sleep(300);
}
res.controlAfterProperDispose = { before, after: mem() };
return res;

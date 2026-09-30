const sleep = ms => new Promise(r => setTimeout(r, ms));
export function drive() {}
export async function setup(game, report) {
  const c = report.custom = {};
  await sleep(800);
  const info = game.renderer.info;
  const tex = () => info.memory.textures;
  c.start = { quality: game.quality.name, textures: tex(), hasComposer: !!game.composer };
  const seq = [];
  for (let i = 0; i < 4; i++) {
    game.setQuality('high'); await sleep(200);
    game.setQuality('medium'); await sleep(200);
    seq.push(tex());
  }
  c.afterCyclesMediumHigh = seq;
  // Same, but disposing every pass first (the suggested fix)
  const seq2 = [];
  for (let i = 0; i < 3; i++) {
    for (const q of ['high', 'medium']) {
      const old = game.composer;
      if (old) { for (const p of old.passes) if (p.dispose) p.dispose(); old.dispose(); }
      game.setQuality(q); await sleep(200);
    }
    seq2.push(tex());
  }
  c.afterCyclesWithFullDispose = seq2;
  // sanity: is there still a valid image? (composer rendering)
  c.composer = !!game.composer;
}

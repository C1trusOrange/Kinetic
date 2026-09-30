function census(g) {
  let lights = 0, groups = 0, meshes = 0, mapGroups = 0;
  g.scene.traverse(o => { if (o.isLight) lights++; if (o.isGroup) groups++; if (o.isMesh) meshes++; if (o.name && o.name.startsWith('map:')) mapGroups++; });
  const i = g.renderer.info;
  return { lights, groups, meshes, mapGroups, geos: i.memory.geometries, tex: i.memory.textures, children: g.scene.children.length,
    mapId: g.world.mapId, pk: g.world.pickups.list.length, avail: g.world.pickups.list.filter(p => p.available).length,
    pads: g.world.jumpPads.length, spawns: g.world.spawnPoints.length, ents: g.entities.length, bots: g.bots.list.length,
    env: !!g.scene.environment, fog: g.scene.fog ? g.scene.fog.type : null, navNodes: g.world.nav.nodes.length, state: g.state };
}
export async function setup(game, report) {
  const C = (report.custom = { steps: [] });
  const w = game.world;
  const step = async (label, fn) => { await fn(); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); const c = census(game); c.label = label; C.steps.push(c); };
  await step('initial', async () => {});
  for (const p of w.pickups.list) { p.available = false; p.nextRespawn = game.time + 500; }
  for (const pd of w.jumpPads) pd.flash = 1;
  await step('after consuming all pickups', async () => {});
  await step('restart same map', async () => { await game.startMatch({ ...game.lastMatchConfig }); });
  const cfg = { ...game.lastMatchConfig };
  await step('switch skyline', async () => { await game.startMatch({ ...cfg, mapId: 'skyline' }); });
  await step('switch ruins', async () => { await game.startMatch({ ...cfg, mapId: 'ruins' }); });
  await step('switch sandbox', async () => { await game.startMatch({ ...cfg, mapId: 'sandbox' }); });
  await step('switch foundry', async () => { await game.startMatch({ ...cfg, mapId: 'foundry' }); });
  await step('restart foundry', async () => { await game.startMatch({ ...cfg, mapId: 'foundry' }); });
  await step('quitToMenu', async () => { game.quitToMenu(); });
  await step('start foundry from menu', async () => { await game.startMatch({ ...cfg, mapId: 'foundry' }); });
  C.done = true;
}
export function drive() {}

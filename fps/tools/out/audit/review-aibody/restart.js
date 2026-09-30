const g = window.__GAME__;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const snap = tag => ({
  tag,
  children: g.scene.children.length,
  botModels: g.scene.children.filter(c => c.name === 'BotModel').length,
  gibMeshes: g.scene.children.filter(c => c.name && c.name.startsWith('gib_')).length,
  geoms: g.renderer.info.memory.geometries, tex: g.renderer.info.memory.textures,
  ents: g.entities.length, bots: g.bots.list.length, gibList: g.effects.gibList.length, state: g.state,
  entIds: g.entities.map(e => e.id).join(','),
  botTeams: g.bots.list.map(b => b.team).join(','),
  botColors: g.bots.list.map(b => '#' + b.color.getHexString()).join(','),
});
const out = [snap('initial')];
await sleep(6000);
out.push(snap('after6s'));
for (let i = 0; i < 3; i++) {
  await g.startMatch({ ...g.lastMatchConfig });
  await sleep(3000);
  out.push(snap('restart' + i));
}
await g.startMatch({ mapId: 'ruins', mode: 'tdm', botCount: 15, difficulty: 'normal', scoreLimit: 0, timeLimit: 0 });
await sleep(3000);
out.push(snap('ruins_tdm15'));
await g.startMatch({ mapId: 'foundry', mode: 'ffa', botCount: 15, difficulty: 'normal', scoreLimit: 0, timeLimit: 0 });
await sleep(1000);
out.push(snap('foundry_ffa15'));
g.quitToMenu();
await sleep(500);
out.push(snap('menu'));
return out;

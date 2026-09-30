// leaks across restarts with bots, entity ids, listeners
const out = {};
const info = game.renderer.info;
const snap = () => ({ tex: info.memory.textures, geo: info.memory.geometries, prog: info.programs ? info.programs.length : null, sceneChildren: game.scene.children.length, entities: game.entities.length, ids: game.entities.map(e => e.id).join(','), teams: game.entities.map(e => e.team).join(','), time: +game.time.toFixed(2), evDeath: game.events._map.get('death').length, evDamage: game.events._map.get('damage').length, evFire: game.events._map.get('weapon:fire').length });
await sleep(800);
out.base = snap();
out.restarts = [];
for (let i = 0; i < 4; i++) {
  await game.startMatch({ ...game.lastMatchConfig, mode: i % 2 ? 'tdm' : 'ffa' });
  await sleep(700);
  out.restarts.push(snap());
}
return out;

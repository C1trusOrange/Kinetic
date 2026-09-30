import * as THREE from 'three';
const S = { step: 0, log: [], nextAt: 4, pending: false };
function snap(game, label) {
  let botModels = 0, meshes = 0, lights = 0, gibsInScene = 0, totalObjs = 0;
  game.scene.traverse(o => {
    totalObjs++;
    if (o.name === 'BotModel') botModels++;
    if (o.isMesh) meshes++;
    if (o.isLight) lights++;
    if (o.name && o.name.startsWith('gib_')) gibsInScene++;
  });
  const info = game.renderer.info;
  return {
    label, botModels, meshes, lights, gibsInScene, totalObjs,
    sceneChildren: game.scene.children.length,
    geometries: info.memory.geometries, textures: info.memory.textures,
    bots: game.bots.list.length, entities: game.entities.length,
    gibList: game.effects.gibList.length,
    rockets: game.projectiles.rockets.length, grenades: game.projectiles.grenades.length,
    teams: game.bots.list.map(b => b.team).join(','),
    colors: game.bots.list.map(b => b.color.getHexString()).join(','),
    names: game.bots.list.map(b => b.name).join(','),
    ids: game.bots.list.map(b => b.id).join(','),
    playerTeam: game.player.team, playerId: game.player.id,
  };
}
const CONFIGS = [{ mapId: 'ruins', mode: 'tdm', botCount: 6 }, { mapId: 'foundry', mode: 'tdm', botCount: 8 }, { mapId: 'sandbox', mode: 'ffa', botCount: 4 }, 
  
];
export async function setup(game, report) {
  report.custom = S;
  S.log.push(snap(game, 'initial'));
}
export function drive(t, dt, game, report) {
  if (S.pending) {
    S.pending = false;
    S.log.push(snap(game, 'after-start-' + S.step));
    S.nextAt = t + 3;
    return;
  }
  if (t >= S.nextAt && S.step < CONFIGS.length) {
    S.log.push(snap(game, 'before-restart-' + S.step));
    const cfg = CONFIGS[S.step++];
    game.startMatch({ difficulty: 'normal', scoreLimit: 0, timeLimit: 0, ...cfg });
    S.pending = true;
    S.nextAt = 1e9;
  }
}
export function finish(game, report) { S.log.push(snap(game, 'final')); }

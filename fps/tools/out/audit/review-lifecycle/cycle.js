// Cycles matches (restart / quit / other map / TDM<->FFA / 0 and 15 bots) and snapshots renderer + scene + listener counts.
const frames = n => new Promise(res => { let c = 0; const f = () => (++c >= n ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); });
const sleep = ms => new Promise(r => setTimeout(r, ms));

export function drive() {}

function countTree(root) {
  let n = 0, lights = 0, meshes = 0, visMeshes = 0;
  root.traverse(o => { n++; if (o.isLight) lights++; if (o.isMesh || o.isPoints || o.isSprite || o.isLine) { meshes++; if (o.visible) visMeshes++; } });
  return { n, lights, meshes, visMeshes };
}

function snap(game, label) {
  const info = game.renderer.info;
  const s = countTree(game.scene), v = countTree(game.viewScene);
  const listeners = {};
  let totalListeners = 0;
  for (const [k, list] of game.events._map) { listeners[k] = list.length; totalListeners += list.length; }
  const a = game.audio;
  return {
    label,
    state: game.state,
    map: game.world.mapId,
    mode: game.match && game.match.mode,
    bots: game.bots.list.length,
    entities: game.entities.length,
    geometries: info.memory.geometries,
    textures: info.memory.textures,
    programs: info.programs ? info.programs.length : null,
    sceneChildren: game.scene.children.length,
    sceneNodes: s.n, sceneLights: s.lights, sceneMeshes: s.meshes, sceneVisMeshes: s.visMeshes,
    viewNodes: v.n, viewLights: v.lights,
    listeners: totalListeners,
    listenerMap: listeners,
    loops: a.loops ? a.loops.size : -1,
    voices: a.voices ? a.voices.length : -1,
    gibs: game.effects.gibList.length,
    rockets: game.projectiles.rockets.length,
    grenades: game.projectiles.grenades.length,
    domNodes: game.uiRoot.querySelectorAll('*').length,
    anims: document.getAnimations ? document.getAnimations().length : -1,
    heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : -1,
    nextId: game._nextEntityId,
  };
}

async function start(game, opts) {
  await game.startMatch({ scoreLimit: 0, timeLimit: 0, difficulty: 'normal', ...opts });
  if (game.state !== 'playing') throw new Error('state after start: ' + game.state);
}

async function play(game, n) { await frames(n); }

function killAllBots(game) {
  for (const b of game.bots.list) if (b.alive) game.combat.kill(b, { attacker: game.player, weapon: 'rifle', point: b.getChestPosition(b.position.clone()), direction: b.position.clone().set(0, 0, -1) });
}

export async function setup(game, report) {
  const out = (window.__LC__ = { done: false, snaps: [], errors: [] });
  const S = label => { const s = snap(game, label); out.snaps.push(s); return s; };
  try {
    await frames(60);
    S('initial sandbox ffa 5');
    // restart x4, with kills/gibs and a rocket + grenade in flight each time
    for (let i = 0; i < 4; i++) {
      killAllBots(game);
      game.projectiles.spawnRocket({ owner: game.player, origin: game.camera.position.clone(), direction: game.camera.position.clone().set(0, 0, -1) });
      game.projectiles.spawnGrenade({ owner: game.player, origin: game.camera.position.clone(), velocity: game.camera.position.clone().set(0, 5, -8), fuse: 2.6 });
      await frames(20);
      game.restartMatch();
      while (game.state === 'loading') await frames(2);
      await frames(30);
      S('restart #' + (i + 1));
    }
    // quit to menu, then other maps/modes
    game.quitToMenu();
    await frames(20);
    S('menu after quit');
    const plan = [
      { mapId: 'foundry', mode: 'tdm', botCount: 0 },
      { mapId: 'ruins', mode: 'ffa', botCount: 15 },
      { mapId: 'skyline', mode: 'tdm', botCount: 15 },
      { mapId: 'sandbox', mode: 'ffa', botCount: 5 },
      { mapId: 'foundry', mode: 'tdm', botCount: 0 },
      { mapId: 'ruins', mode: 'ffa', botCount: 15 },
      { mapId: 'skyline', mode: 'tdm', botCount: 15 },
      { mapId: 'sandbox', mode: 'ffa', botCount: 5 },
    ];
    for (const p of plan) {
      await start(game, p);
      await frames(90);
      S(`${p.mapId} ${p.mode} ${p.botCount}`);
      killAllBots(game);
      await frames(30);
      S(`${p.mapId} ${p.mode} ${p.botCount} after kills`);
      if (p.mapId === 'ruins' || p.mapId === 'sandbox') { game.quitToMenu(); await frames(30); S('menu'); }
    }
  } catch (err) {
    out.errors.push(String(err && err.stack || err));
  }
  out.done = true;
}

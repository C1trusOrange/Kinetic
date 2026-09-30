// Heap growth per match with forced GC: same config repeated (restart) and map switching.
const frames = n => new Promise(res => { let c = 0; const f = () => (++c >= n ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); });
export function drive() {}
const heap = () => { try { window.gc(); window.gc(); } catch (e) {} return performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : -1; };
function killAllBots(game) { for (const b of game.bots.list) if (b.alive) game.combat.kill(b, { attacker: game.player, weapon: 'rifle' }); }
export async function setup(game, report) {
  const out = (window.__LC__ = { done: false, rows: [], errors: [] });
  const R = label => { const i = game.renderer.info.memory; out.rows.push({ label, heap: heap(), geo: i.geometries, tex: i.textures, listeners: [...game.events._map.values()].reduce((a, l) => a + l.length, 0), sceneNodes: (() => { let n = 0; game.scene.traverse(() => n++); return n; })() }); };
  try {
    await frames(40);
    R('start');
    for (let i = 0; i < 12; i++) {
      killAllBots(game); await frames(10);
      game.restartMatch();
      while (game.state === 'loading') await frames(2);
      await frames(20);
      R('restart ' + (i + 1));
    }
    for (let i = 0; i < 4; i++) {
      game.quitToMenu(); await frames(10);
      await game.startMatch({ mapId: i % 2 ? 'sandbox' : 'foundry', mode: i % 2 ? 'ffa' : 'tdm', botCount: 8, scoreLimit: 0, timeLimit: 0 });
      await frames(20);
      R('switch ' + (i + 1));
    }
    for (let i = 0; i < 8; i++) {
      game.quitToMenu(); await frames(10);
      await game.startMatch({ mapId: 'sandbox', mode: 'ffa', botCount: 8, scoreLimit: 0, timeLimit: 0 });
      await frames(20);
      R('quit+start ' + (i + 1));
    }
  } catch (e) { out.errors.push(String(e && e.stack || e)); }
  out.done = true;
}

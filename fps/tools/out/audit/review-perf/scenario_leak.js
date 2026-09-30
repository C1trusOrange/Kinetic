// Restart matches / switch maps repeatedly and watch renderer.info.memory, scene size, listeners, heap.
const G = window.__GAME__;
const seq = ['foundry', 'foundry', 'foundry', 'ruins', 'skyline', 'sandbox', 'foundry', 'foundry'];
let idx = 0, nextAt = 2.5, launching = false;
const rows = [];
const countObjs = root => { let n = 0, meshes = 0; root.traverse(o => { n++; if (o.isMesh || o.isPoints || o.isLine) meshes++; }); return { n, meshes }; };
const listeners = () => { const o = {}; for (const [k, v] of G.events._map) o[k] = v.length; return o; };
function snap(label) {
  const info = G.renderer.info;
  const s = countObjs(G.scene), v = countObjs(G.viewScene);
  rows.push({
    label, map: G.world.mapId,
    geo: info.memory.geometries, tex: info.memory.textures, progs: info.programs.length,
    sceneObjs: s.n, sceneMeshes: s.meshes, viewObjs: v.n,
    heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null,
    listeners: listeners(), entities: G.entities.length, gibs: G.effects.gibList.length, voices: G.audio.voices ? G.audio.voices.length : null,
  });
}
export function setup(game, report) { report.custom = {}; snap('start'); }
export function drive(t, dt, game, report) {
  game.player.god = true;
  if (launching) return;
  if (t >= nextAt && idx < seq.length) {
    launching = true;
    const m = seq[idx++];
    snap('before ' + idx + ' -> ' + m);
    game.startMatch({ mapId: m, mode: idx % 2 ? 'ffa' : 'tdm', botCount: 6, difficulty: 'normal', scoreLimit: 0, timeLimit: 0 }).then(() => { launching = false; nextAt = t + 3; setTimeout(() => snap('after ' + idx + ' ' + m), 200); });
  }
}
export function finish(game, report) { snap('end'); report.custom = { rows, perfMem: !!performance.memory }; }

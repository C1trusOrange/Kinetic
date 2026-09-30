// verify-perf-1: count program-key derivations per frame; attribute to materials shared between scene and viewScene.
import * as THREE from 'three';
const G = window.__GAME__;
const r = G.renderer;
const R = window.__VP1__ = { counts: new Map(), frames: 0, total: 0, perFrame: [] };
const orig = THREE.Material.prototype.customProgramCacheKey;
let frameCount = 0;
THREE.Material.prototype.customProgramCacheKey = function () {
  if (measuring) { R.counts.set(this, (R.counts.get(this) || 0) + 1); frameCount++; }
  return orig.call(this);
};
let measuring = false;
const origRender = G.render.bind(G);
G.render = function () {
  frameCount = 0;
  origRender();
  if (measuring) { R.frames++; R.total += frameCount; R.perFrame.push(frameCount); }
};
let startAt = 0;
export function drive(t, dt, game) {
  game.player.god = true;
  if (!measuring && t > 4) { measuring = true; startAt = t; }
}
export function finish(game, report) {
  const inScene = new Set(), inView = new Set();
  const collect = (root, set) => root.traverse(o => { const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : []; for (const m of ms) set.add(m); });
  collect(G.scene, inScene); collect(G.viewScene, inView);
  let shared = 0, sharedCalls = 0, nonSharedCalls = 0;
  const per = [];
  for (const [m, c] of R.counts) {
    const both = inScene.has(m) && inView.has(m);
    if (both) { shared++; sharedCalls += c; per.push(+(c / R.frames).toFixed(2)); } else nonSharedCalls += c;
  }
  const sortedPer = R.perFrame.slice().sort((a, b) => a - b);
  report.custom = {
    frames: R.frames, totalCalls: R.total, perFrame: +(R.total / R.frames).toFixed(1), medianPerFrame: sortedPer[Math.floor(sortedPer.length / 2)],
    materialsSeen: R.counts.size, sharedMaterials: shared, sharedCalls, nonSharedCalls,
    sharedPerFramePerMaterial: [...new Set(per)],
    sharedShare: +(sharedCalls / Math.max(1, R.total)).toFixed(2),
    sceneMats: inScene.size, viewMats: inView.size,
    quality: G.quality.name,
  };
}

import * as THREE from 'three';
import { getMaterials } from '/src/weapons/models/WeaponMaterials.js';
let done = false;
export function setup(game, report) { report.custom = {}; }
function mean(a) { return a.reduce((x, y) => x + y, 0) / a.length; }
function median(a) { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; }
export function drive(t, dt, game, report) {
  const rec = report.custom;
  if (t < 4 || done) return;
  done = true;
  const r = game.renderer;
  const M = getMaterials();
  const Mset = new Set(Object.values(M));
  // deterministic flip counter over 5 real game.render() frames
  const viewSet = new Set();
  game.viewScene.traverseVisible(o => { if (o.isMesh && Mset.has(o.material)) viewSet.add(o.material); });
  const worldSet = new Set();
  game.scene.traverseVisible(o => { if (o.isMesh && Mset.has(o.material)) worldSet.add(o.material); });
  const both = [...viewSet].filter(m => worldSet.has(m));
  const snap = () => both.map(m => { const p = r.properties.get(m); return (p.lightsStateVersion) + '/' + !!p.fog; });
  const orig = r.render.bind(r);
  let prev = snap(), flips = 0, passes = 0;
  r.render = (scene, cam) => {
    orig(scene, cam);
    if (scene === game.scene || scene === game.viewScene) {
      const cur = snap();
      for (let i = 0; i < cur.length; i++) if (cur[i] !== prev[i]) flips++;
      prev = cur; passes++;
    }
  };
  for (let i = 0; i < 6; i++) game.render();
  r.render = orig;
  rec.flipCount = { sharedMats: both.length, passes, flipsTotal: flips, flipsPerFrame: flips / 6 };

  // A/B, many rounds, direct render
  const viewMeshes = [];
  game.viewScene.traverse(o => { if (o.isMesh && Mset.has(o.material)) viewMeshes.push(o); });
  const clones = new Map();
  for (const m of viewMeshes) if (!clones.has(m.material)) clones.set(m.material, m.material.clone());
  const origMat = viewMeshes.map(m => m.material);
  const setMode = (d) => viewMeshes.forEach((m, i) => { m.material = d ? clones.get(origMat[i]) : origMat[i]; });
  const gl = r.getContext();
  const frame = () => { r.setRenderTarget(null); r.clear(); r.render(game.scene, game.camera); r.clearDepth(); r.render(game.viewScene, game.viewCamera); };
  const N = 30;
  const block = () => { const a = []; for (let i = 0; i < N; i++) { const s = performance.now(); frame(); a.push(performance.now() - s); } gl.finish(); return a.slice(4); };
  setMode(true); block(); setMode(false); block();
  const res = { shared: [], decoupled: [] };
  const diffs = [];
  for (let round = 0; round < 24; round++) {
    const order = round % 2 ? ['shared', 'decoupled'] : ['decoupled', 'shared'];
    const got = {};
    for (const k of order) { setMode(k === 'decoupled'); got[k] = mean(block()); res[k].push(got[k]); }
    diffs.push(got.shared - got.decoupled);
  }
  setMode(false);
  rec.ab = { sharedMean: mean(res.shared), decoupledMean: mean(res.decoupled), sharedMed: median(res.shared), decoupledMed: median(res.decoupled), diffMed: median(diffs), diffMean: mean(diffs), diffPositiveRounds: diffs.filter(d => d > 0).length, rounds: diffs.length };
}

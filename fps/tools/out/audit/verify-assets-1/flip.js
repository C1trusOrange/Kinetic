import * as THREE from 'three';
import { getMaterials } from '/src/weapons/models/WeaponMaterials.js';
let done = false;
export function setup(game, report) { report.custom = { log: [] }; }
function median(a) { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; }
export function drive(t, dt, game, report) {
  const rec = report.custom;
  if (t < 4 || done) return;
  done = true;
  const r = game.renderer;
  const M = getMaterials();
  const Mset = new Set(Object.values(M));
  const cyc = [];
  // 1. flip evidence for a set of materials, sampled after each pass
  const orig = r.render.bind(r);
  const tag = s => (s === game.scene ? 'world' : s === game.viewScene ? 'view' : 'other');
  const samples = [];
  r.render = (scene, cam) => {
    orig(scene, cam);
    if (samples.length < 6) {
      const p = r.properties.get(M.steel);
      samples.push({ pass: tag(scene), lsv: p.lightsStateVersion, fog: !!p.fog, prog: p.currentProgram && p.currentProgram.id });
    }
  };
  game.render(); game.render();
  r.render = orig;
  rec.flipSamples = samples;
  rec.sceneFog = { world: !!game.scene.fog, view: !!game.viewScene.fog };
  rec.composer = !!game.composer;

  // 2. count materials shared by both passes
  const worldSet = new Set(), viewSet = new Set();
  game.scene.updateMatrixWorld(true);
  const fr = new THREE.Frustum();
  const pm = new THREE.Matrix4().multiplyMatrices(game.camera.projectionMatrix, game.camera.matrixWorldInverse);
  fr.setFromProjectionMatrix(pm);
  const sph = new THREE.Sphere();
  let worldMeshCount = 0;
  game.scene.traverseVisible(o => {
    if (o.isMesh && Mset.has(o.material)) {
      if (o.geometry.boundingSphere === null) o.geometry.computeBoundingSphere();
      sph.copy(o.geometry.boundingSphere).applyMatrix4(o.matrixWorld);
      if (fr.intersectsSphere(sph)) { worldSet.add(o.material); worldMeshCount++; }
    }
  });
  game.viewScene.traverseVisible(o => { if (o.isMesh && Mset.has(o.material)) viewSet.add(o.material); });
  const inter = [...worldSet].filter(m => viewSet.has(m));
  rec.mats = { worldInFrustum: worldSet.size, worldMeshesInFrustum: worldMeshCount, view: viewSet.size, both: inter.length };

  // 3. A/B benchmark: decouple view materials (clones share textures)
  const viewMeshes = [];
  game.viewScene.traverse(o => { if (o.isMesh && Mset.has(o.material)) viewMeshes.push(o); });
  const clones = new Map();
  for (const m of viewMeshes) if (!clones.has(m.material)) clones.set(m.material, m.material.clone());
  const origMat = viewMeshes.map(m => m.material);
  const setMode = (decoupled) => viewMeshes.forEach((m, i) => { m.material = decoupled ? clones.get(origMat[i]) : origMat[i]; });
  const gl = r.getContext();
  const results = { shared: [], decoupled: [] };
  const N = 25;
  // direct 2-pass render (no composer)
  const frame = () => {
    r.setRenderTarget(null); r.clear();
    r.render(game.scene, game.camera);
    r.clearDepth();
    r.render(game.viewScene, game.viewCamera);
  };
  const timeBlock = (fn) => {
    const arr = [];
    for (let i = 0; i < N; i++) { const a = performance.now(); fn(); arr.push(performance.now() - a); }
    gl.finish();
    return arr.slice(3);
  };
  // warm up both
  setMode(true); timeBlock(frame); setMode(false); timeBlock(frame);
  for (let round = 0; round < 8; round++) {
    const order = round % 2 ? ['shared', 'decoupled'] : ['decoupled', 'shared'];
    for (const k of order) { setMode(k === 'decoupled'); results[k].push(median(timeBlock(frame))); }
  }
  setMode(false);
  rec.directMedians = { shared: median(results.shared), decoupled: median(results.decoupled), sharedAll: results.shared.map(v => +v.toFixed(2)), decoupledAll: results.decoupled.map(v => +v.toFixed(2)) };
  // game.render() (composer path, if any)
  const res2 = { shared: [], decoupled: [] };
  const f2 = () => game.render();
  setMode(true); timeBlock(f2); setMode(false); timeBlock(f2);
  for (let round = 0; round < 8; round++) {
    const order = round % 2 ? ['shared', 'decoupled'] : ['decoupled', 'shared'];
    for (const k of order) { setMode(k === 'decoupled'); res2[k].push(median(timeBlock(f2))); }
  }
  setMode(false);
  rec.gameRenderMedians = { shared: median(res2.shared), decoupled: median(res2.decoupled), sharedAll: res2.shared.map(v => +v.toFixed(2)), decoupledAll: res2.decoupled.map(v => +v.toFixed(2)) };
  rec.viewMeshes = viewMeshes.length;
  rec.clones = clones.size;
}

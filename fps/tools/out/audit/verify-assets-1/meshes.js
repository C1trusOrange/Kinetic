import * as THREE from 'three';
import { createWeaponModel } from '/src/weapons/WeaponModels.js';
let done = false;
export function setup(game, report) { report.custom = {}; }
function mean(a) { return a.reduce((x, y) => x + y, 0) / a.length; }
function median(a) { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; }
export function drive(t, dt, game, report) {
  const rec = report.custom;
  if (t < 4 || done) return;
  done = true;
  const r = game.renderer;
  rec.quality = { shadows: game.quality.shadows, name: game.quality.name, shadowEnabled: r.shadowMap.enabled };
  // template mesh counts
  rec.templates = {};
  for (const id of ['pistol', 'rifle', 'shotgun', 'sniper', 'rocket']) {
    const m = createWeaponModel(id, { view: false });
    let meshes = 0, transp = 0, tris = 0, tiny = 0;
    const sizes = [];
    m.root.traverse(o => {
      if (!o.isMesh) return;
      meshes++; tris += o.geometry.attributes.position.count / 3;
      if (o.material.transparent) transp++;
      o.geometry.computeBoundingBox();
      const bb = o.geometry.boundingBox; const d = Math.max(bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z);
      if (d < 0.03) tiny++;
      sizes.push([o.name, +d.toFixed(3), o.geometry.attributes.position.count / 3]);
    });
    rec.templates[id] = { meshes, transp, tris: Math.round(tris), tinyLt3cm: tiny };
    if (id === 'rifle') rec.rifleMeshes = sizes;
  }
  // in-game counts
  game.scene.updateMatrixWorld(true);
  const fr = new THREE.Frustum();
  fr.setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(game.camera.projectionMatrix, game.camera.matrixWorldInverse));
  const sph = new THREE.Sphere();
  let total = 0, casters = 0, inFr = 0, botsW = 0, visBots = 0, botTotalMeshes = 0;
  const roots = [];
  for (const b of game.bots.list) {
    const w = b.model && b.model.weapon; if (!w) continue;
    botsW++; roots.push(w.root);
    let vis = true; let p = w.root; while (p) { if (!p.visible) vis = false; p = p.parent; }
    if (vis) visBots++;
    w.root.traverse(o => { if (o.isMesh) { total++; if (o.castShadow) casters++; if (vis) { sph.copy(o.geometry.boundingSphere || (o.geometry.computeBoundingSphere(), o.geometry.boundingSphere)).applyMatrix4(o.matrixWorld); if (fr.intersectsSphere(sph)) inFr++; } } });
    b.model.root.traverse(o => { if (o.isMesh && !w.root.getObjectById(o.id)) botTotalMeshes++; });
  }
  rec.inGame = { bots: botsW, visibleBots: visBots, weaponMeshes: total, casters, inFrustumMeshes: inFr, botBodyMeshesTotal: botTotalMeshes };

  // draw-call delta + A/B timing
  const setW = (v) => roots.forEach(x => { x.visible = v; });
  const measureCalls = () => { r.info.reset(); game.render(); return { calls: r.info.render.calls, tris: r.info.render.triangles }; };
  setW(true); game.render(); rec.callsShown = measureCalls();
  setW(false); game.render(); rec.callsHidden = measureCalls();
  setW(true);

  const gl = r.getContext();
  const frame = () => { r.setRenderTarget(null); r.clear(); r.render(game.scene, game.camera); r.clearDepth(); r.render(game.viewScene, game.viewCamera); };
  const N = 30;
  const block = () => { const a = []; for (let i = 0; i < N; i++) { const s = performance.now(); frame(); a.push(performance.now() - s); } gl.finish(); return a.slice(4); };
  setW(true); block(); setW(false); block();
  const res = { shown: [], hidden: [] }, diffs = [];
  for (let round = 0; round < 16; round++) {
    const order = round % 2 ? ['shown', 'hidden'] : ['hidden', 'shown'];
    const got = {};
    for (const k of order) { setW(k === 'shown'); got[k] = mean(block()); res[k].push(got[k]); }
    diffs.push(got.shown - got.hidden);
  }
  setW(true);
  rec.ab = { shownMean: mean(res.shown), hiddenMean: mean(res.hidden), shownMed: median(res.shown), hiddenMed: median(res.hidden), diffMed: median(diffs), diffMean: mean(diffs), positive: diffs.filter(d => d > 0).length, rounds: diffs.length };
  // same with shadows disabled
  const so = r.shadowMap.enabled;
  r.shadowMap.enabled = false;
  game.scene.traverse(o => { if (o.material) for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.needsUpdate = true; });
  setW(true); block(); setW(false); block();
  const res2 = { shown: [], hidden: [] }, diffs2 = [];
  for (let round = 0; round < 12; round++) {
    const order = round % 2 ? ['shown', 'hidden'] : ['hidden', 'shown'];
    const got = {};
    for (const k of order) { setW(k === 'shown'); got[k] = mean(block()); res2[k].push(got[k]); }
    diffs2.push(got.shown - got.hidden);
  }
  setW(true);
  rec.abNoShadow = { shownMean: mean(res2.shown), hiddenMean: mean(res2.hidden), diffMed: median(diffs2), diffMean: mean(diffs2), positive: diffs2.filter(d => d > 0).length, rounds: diffs2.length };
  r.shadowMap.enabled = so;
}

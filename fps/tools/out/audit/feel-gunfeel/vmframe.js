// Viewmodel framing numbers: screen bbox / muzzle position per weapon at hip and ADS (1280x720 px equivalent).
import * as THREE from 'three';
const IDS = ['pistol', 'rifle', 'shotgun', 'sniper', 'rocket'];
const KEY = { pistol: 'weapon1', rifle: 'weapon2', shotgun: 'weapon3', sniper: 'weapon4', rocket: 'weapon5' };
const R = {};
let phases = [], idx = -1, phaseStart = 0, ctx = null;
const r1 = v => Math.round(v * 10) / 10;

function measure(game, id) {
  const w = game.weapons;
  const vm = w.vm[id];
  const cam = game.viewCamera;
  cam.updateMatrixWorld(true);
  vm.root.updateMatrixWorld(true);
  const W = 1280, H = 720;
  const proj = v => { const p = v.clone().project(cam); return [(p.x * 0.5 + 0.5) * W, (-p.y * 0.5 + 0.5) * H]; };
  // bbox of all visible meshes (skip flash)
  let minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9, area = 0;
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  vm.root.traverse(o => {
    if (!o.isMesh || !o.visible) return;
    o.geometry.computeBoundingBox();
    box.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
    const cs = [[box.min.x, box.min.y, box.min.z], [box.max.x, box.min.y, box.min.z], [box.min.x, box.max.y, box.min.z], [box.max.x, box.max.y, box.min.z],
      [box.min.x, box.min.y, box.max.z], [box.max.x, box.min.y, box.max.z], [box.min.x, box.max.y, box.max.z], [box.max.x, box.max.y, box.max.z]];
    for (const c of cs) {
      v.set(c[0], c[1], c[2]);
      const wp = v.clone().applyMatrix4(cam.matrixWorldInverse);
      if (wp.z > -0.02) continue; // behind near plane
      const p = proj(v);
      minx = Math.min(minx, p[0]); maxx = Math.max(maxx, p[0]); miny = Math.min(miny, p[1]); maxy = Math.max(maxy, p[1]);
    }
  });
  const mz = vm.model.muzzle.getWorldPosition(new THREE.Vector3());
  const mp = proj(mz);
  const sight = vm.model.sight.getWorldPosition(new THREE.Vector3());
  const sp = proj(sight);
  const sightCam = sight.clone().applyMatrix4(cam.matrixWorldInverse);
  const mzCam = mz.clone().applyMatrix4(cam.matrixWorldInverse);
  return {
    bbox: [Math.round(Math.max(0, minx)), Math.round(Math.max(0, miny)), Math.round(Math.min(W, maxx)), Math.round(Math.min(H, maxy))],
    coverPct: r1(100 * (Math.min(W, maxx) - Math.max(0, minx)) * (Math.min(H, maxy) - Math.max(0, miny)) / (W * H)),
    muzzlePx: [Math.round(mp[0]), Math.round(mp[1])], muzzleOffsetFromCenter: [Math.round(mp[0] - W / 2), Math.round(mp[1] - H / 2)],
    muzzleCamXYZ: [r1(mzCam.x * 100) / 100, r1(mzCam.y * 100) / 100, r1(mzCam.z * 100) / 100],
    sightPx: [Math.round(sp[0]), Math.round(sp[1])], sightDist: Math.round(-sightCam.z * 1000) / 1000,
  };
}

export async function setup(game, report) {
  report.custom = R;
  game.player.god = true;
  for (const id of ['sniper', 'rocket']) game.weapons.giveWeapon(id);
  for (const id of IDS) {
    phases.push({ name: id + '_hip', id, ads: false, dur: 1.6 });
    phases.push({ name: id + '_ads', id, ads: true, dur: 1.4 });
  }
  game.autotest.duration = phases.reduce((s, p) => s + p.dur, 0) + 0.3;
}

export function drive(t, dt, game) {
  let acc = 0, want = -1;
  for (let i = 0; i < phases.length; i++) { if (t < acc + phases[i].dur) { want = i; break; } acc += phases[i].dur; }
  if (want !== idx) {
    if (idx >= 0) { const p = phases[idx]; if (ctx && ctx.sample) R[p.name] = ctx.sample; }
    idx = want; phaseStart = acc; ctx = {};
    if (idx >= 0) {
      const p = phases[idx];
      game.input.setVirtual(KEY[p.id], true);
    }
  }
  if (idx < 0) return;
  const p = phases[idx];
  const lt = t - phaseStart;
  game.input.setVirtual(KEY[p.id], lt < 0.06 && !(p.ads && game.weapons.currentId === p.id));
  game.input.setVirtual('ads', p.ads && lt > 0.7);
  game.player.velocity.set(0, game.player.velocity.y, 0);
  if (lt > (p.ads ? 1.3 : 1.5) && !ctx.sample) {
    if (game.weapons.currentId === p.id) {
      // sniper: scoped hides the model; measure anyway by forcing visible
      const vm = game.weapons.vm[p.id];
      const vis = vm.root.visible;
      vm.root.visible = true;
      ctx.sample = measure(game, p.id);
      ctx.sample.scoped = !!game.weapons.scoped;
      ctx.sample.adsAmount = +game.weapons.adsAmount.toFixed(2);
      vm.root.visible = vis;
    } else ctx.sample = { error: 'not equipped ' + game.weapons.currentId };
  }
}

export function finish(game) {
  if (idx >= 0) { const p = phases[idx]; if (ctx && ctx.sample) R[p.name] = ctx.sample; }
}

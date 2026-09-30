import * as THREE from 'three';
const ORDER = ['pistol', 'rifle', 'shotgun', 'sniper', 'rocket'];
const rec = { weapons: {}, notes: [] };
let idx = 0, phase = 0, tp = 0, cur = null;
const _v = new THREE.Vector3();
export function setup(game, report) {
  report.custom = rec;
  game.player.god = true;
  game.weapons.giveWeapon('sniper'); game.weapons.giveWeapon('rocket');
}
function partsSnapshot(game, id) {
  const vm = game.weapons.vm[id];
  const out = {};
  for (const [k, pt] of Object.entries(vm.parts)) {
    const o = pt.obj;
    const dp = o.position.distanceTo(pt.pos);
    const dr = Math.abs(o.rotation.x - pt.rot.x) + Math.abs(o.rotation.y - pt.rot.y) + Math.abs(o.rotation.z - pt.rot.z);
    const fin = Number.isFinite(o.position.x + o.position.y + o.position.z + o.rotation.x + o.rotation.y + o.rotation.z + o.quaternion.x + o.quaternion.w);
    out[k] = { dp, dr, fin, vis: o.visible };
  }
  return out;
}
function track(game, id, label) {
  const r = rec.weapons[id] || (rec.weapons[id] = { maxPos: {}, maxRot: {}, nonFinite: [], final: {}, handCam: {} });
  const snap = partsSnapshot(game, id);
  for (const [k, s] of Object.entries(snap)) {
    r.maxPos[k] = Math.max(r.maxPos[k] || 0, +s.dp.toFixed(4));
    r.maxRot[k] = Math.max(r.maxRot[k] || 0, +s.dr.toFixed(3));
    if (!s.fin && !r.nonFinite.includes(k)) r.nonFinite.push(k);
  }
  // left hand world -> camera space
  const vm = game.weapons.vm[id];
  if (vm.parts.leftHand) {
    vm.parts.leftHand.obj.getWorldPosition(_v);
    game.viewCamera.worldToLocal(_v);
    const h = r.handCam;
    h.minX = Math.min(h.minX ?? 9, _v.x); h.maxX = Math.max(h.maxX ?? -9, _v.x);
    h.minY = Math.min(h.minY ?? 9, _v.y); h.maxY = Math.max(h.maxY ?? -9, _v.y);
    h.minZ = Math.min(h.minZ ?? 9, _v.z); h.maxZ = Math.max(h.maxZ ?? -9, _v.z);
  }
  return snap;
}
export function drive(t, dt, game, report) {
  if (idx >= ORDER.length) return;
  const w = game.weapons, inp = game.input, id = ORDER[idx];
  tp += dt;
  if (game.state !== 'playing' || !game.player.alive) return;
  const P = game.player;
  switch (phase) {
    case 0:
      w._requestSwitch(id); phase = 1; tp = 0; break;
    case 1:
      track(game, id, 'equip');
      if (tp > 1.0 && w.currentId === id) { cur = w.current; phase = 2; tp = 0; inp.setVirtual('fire', true); } else if (tp > 3) { rec.notes.push('switch to ' + id + ' failed (current ' + w.currentId + ')'); idx++; phase = 0; tp = 0; }
      break;
    case 2:
      track(game, id, 'fire');
      if (tp > 0.12) { inp.setVirtual('fire', false); phase = 3; tp = 0; }
      break;
    case 3:
      track(game, id, 'cycle');
      if (tp > 1.6) { // begin reload
        if (w.ammo === w.current.magSize) { w.ammo = Math.max(0, w.current.magSize - 3); }
        inp.setVirtual('reload', true); phase = 4; tp = 0;
      }
      break;
    case 4:
      inp.setVirtual('reload', false);
      track(game, id, 'reload');
      { const r = rec.weapons[id]; r.reloadSeen = r.reloadSeen || w.reloading; r.magHiddenSeen = r.magHiddenSeen || (w.vm[id].parts.mag ? !w.vm[id].parts.mag.obj.visible : false); }
      if (tp > 0.3 && !w.reloading) { phase = 5; tp = 0; }
      else if (tp > 8) { rec.notes.push('reload of ' + id + ' never finished'); phase = 5; tp = 0; }
      break;
    case 5:
      track(game, id, 'settle');
      if (tp > 1.0) {
        const snap = partsSnapshot(game, id);
        rec.weapons[id].final = Object.fromEntries(Object.entries(snap).map(([k, s]) => [k, { dp: +s.dp.toFixed(5), dr: +s.dr.toFixed(4), vis: s.vis }]));
        rec.weapons[id].ammoAfter = w.ammo;
        idx++; phase = 0; tp = 0;
      }
      break;
  }
}
export function finish(game, report) {
  rec.done = idx;
}

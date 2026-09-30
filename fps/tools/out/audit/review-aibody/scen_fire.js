// unit-ish tests run in setup(): fire-rate vs dt, reload durations.
import * as THREE from 'three';
import { WEAPONS } from '/src/weapons/WeaponDefs.js';

export async function setup(game, report) {
  const res = report.custom = { rate: {}, reload: {} };
  const bots = game.bots.list;
  const A = bots[0];
  const others = bots.slice(1);
  for (const b of others) { b.god = true; }
  const savedTime = game.time;
  A.god = true;
  // stop brain from interfering
  A.brain.update = () => {};
  A.spawn(new THREE.Vector3(0, 0, 0), 0);
  A.pitch = 0;
  const ids = Object.keys(WEAPONS);
  for (const id of ids) {
    if (!A.inv[id]) A._addWeaponInternal(id);
  }
  for (const id of ids) {
    A.weaponId = id;
    res.rate[id] = {};
    for (const hz of [144, 120, 60, 45, 30, 20]) {
      const dt = 1 / hz;
      let shots = 0;
      A.equipUntil = 0; A.nextFireAt = 0;
      A.reloading = false;
      let t = 1000;
      game.time = t;
      A.nextFireAt = t;
      const dur = 30;
      const n = Math.round(dur * hz);
      for (let i = 0; i < n; i++) {
        game.time += dt;
        A.inv[id].mag = 99; A.inv[id].reserve = 99;
        if (A.tryFire()) shots++;
      }
      res.rate[id][hz] = +(shots / dur).toFixed(3);
    }
    res.rate[id].def = WEAPONS[id].fireRate;
  }
  // reload durations
  for (const id of ids) {
    A.weaponId = id;
    const def = WEAPONS[id];
    res.reload[id] = {};
    for (const hz of [60, 20]) {
      const dt = 1 / hz;
      game.time = 2000;
      A.inv[id].mag = 0; A.inv[id].reserve = Number.isFinite(def.reserveMax) ? def.reserveMax : Infinity;
      A.reloading = false;
      A.startReload();
      let el = 0;
      let guard = 0;
      while (A.reloading && guard++ < 100000) { A._updateWeaponState(dt); el += dt; game.time += dt; }
      res.reload[id][hz] = { t: +el.toFixed(2), mag: A.inv[id].mag, reserve: A.inv[id].reserve, def: def.reloadTime + (def.reloadEmptyExtra || 0) };
    }
  }
  game.time = savedTime;
  A.spawn(new THREE.Vector3(0, 0, 0), 0);
}
export function drive() {}

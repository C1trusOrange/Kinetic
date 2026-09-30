// Timing / recoil / kick measurements for every player weapon (scratch scenario, read-only audit).
import * as THREE from 'three';
import { WEAPONS } from '/src/weapons/WeaponDefs.js';

const IDS = ['pistol', 'rifle', 'shotgun', 'sniper', 'rocket'];
const KEY = { pistol: 'weapon1', rifle: 'weapon2', shotgun: 'weapon3', sniper: 'weapon4', rocket: 'weapon5' };
const r3 = v => Math.round(v * 1000) / 1000;
const r2 = v => Math.round(v * 100) / 100;
const DEG = 180 / Math.PI;
const R = {};
let phases = [], idx = -1, phaseStart = 0, ctx = null;
let fires = [];

function place(game, x, z, yaw, pitch) {
  const p = game.player;
  p.move.reset();
  p.move.place(new THREE.Vector3(x, 0, z));
  p.prevPosition.copy(p.position);
  p.velocity.set(0, 0, 0);
  p.yaw = yaw; p.pitch = pitch;
  p._recoil.pendP = p._recoil.pendY = p._recoil.offP = p._recoil.offY = 0;
}
const releaseAll = g => { for (const a of ['forward', 'back', 'left', 'right', 'jump', 'crouch', 'sprint', 'fire', 'ads', 'reload', 'grenade', 'melee', 'weapon1', 'weapon2', 'weapon3', 'weapon4', 'weapon5']) g.input.setVirtual(a, false); };

function equipPhase(id) {
  return {
    name: 'equip_' + id, dur: 2.0,
    start(g, c) { c.pressed = false; c.first = null; c.canAct = null; c.full = null; c.applied = null; g.weapons.inv[id].ammo = WEAPONS[id].magSize; g.weapons.inv[id].reserve = 99; fires.length = 0; },
    tick(lt, dt, g, c) {
      const w = g.weapons;
      if (lt < 1.2) {
        // make sure another weapon is out first
        if (w.currentId === id && lt < 0.1) { g.input.setVirtual(id === 'pistol' ? 'weapon2' : 'weapon1', true); }
        else { g.input.setVirtual('weapon1', false); g.input.setVirtual('weapon2', false); }
        return;
      }
      if (!c.pressed) { c.pressed = true; c.t0 = lt; c.tPress = g.time; g.input.setVirtual(KEY[id], true); g.input.setVirtual('fire', true); c.n0 = fires.length; return; }
      g.input.setVirtual(KEY[id], false);
      if (c.applied === null && w.currentId === id) c.applied = lt - c.t0;
      if (c.canAct === null && w._canAct() && w.currentId === id) c.canAct = lt - c.t0;
      if (c.full === null && w.equipAmount >= 1 && w.currentId === id) c.full = lt - c.t0;
      if (c.first === null && fires.length > c.n0) { c.first = fires[c.n0] - c.tPress; g.input.setVirtual('fire', false); }
    },
    end(g, c) {
      R['equip_' + id] = { equipTimeDef: WEAPONS[id].equipTime, applied_s: c.applied && r3(c.applied), canAct_s: c.canAct && r3(c.canAct), full_s: c.full && r3(c.full),
        firstShot_s: c.first != null ? r3(c.first) : null };
    },
  };
}

function firePhase(id, hold = 2.0) {
  return {
    name: 'rate_' + id, dur: hold + 1.4,
    start(g, c) {
      g.input.setVirtual(KEY[id], true);
      const inv = g.weapons.inv[id]; inv.ammo = 999; inv.reserve = 999;
      fires.length = 0;
    },
    tick(lt, dt, g, c) {
      const def = WEAPONS[id];
      if (lt < 0.6) { g.input.setVirtual(KEY[id], lt < 0.05); g.weapons.inv[id].ammo = 999; return; }
      g.weapons.inv[id].ammo = 999;
      if (g.weapons.currentId === id) g.weapons.ammo = 999;
      const on = lt < 0.6 + hold;
      g.input.setVirtual('fire', on && (def.auto ? true : (Math.floor((lt - 0.6) / dt) % 2 === 0)));
    },
    end(g, c) {
      const d = WEAPONS[id];
      const ts = fires.slice();
      const iv = [];
      for (let i = 1; i < ts.length; i++) iv.push(ts[i] - ts[i - 1]);
      const avg = iv.length ? iv.reduce((a, b) => a + b, 0) / iv.length : 0;
      R['rate_' + id] = { defRate: d.fireRate, shots: ts.length, avgInterval_s: r3(avg), achievedRate: avg ? r2(1 / avg) : 0, minI: iv.length ? r3(Math.min(...iv)) : 0, maxI: iv.length ? r3(Math.max(...iv)) : 0 };
    },
  };
}

function reloadPhase(id) {
  return {
    name: 'reload_' + id, dur: 8,
    start(g, c) {
      g.input.setVirtual(KEY[id], true);
      c.stage = 0; c.t0 = 0; c.commitT = null; c.endSoundT = null; c.doneT = null;
      const def = WEAPONS[id];
      const inv = g.weapons.inv[id]; inv.ammo = 0; inv.reserve = 999;
    },
    tick(lt, dt, g, c) {
      const w = g.weapons;
      if (lt < 1.2) { g.input.setVirtual(KEY[id], lt < 0.05); if (lt > 1.1) { w.inv[id].ammo = 0; w.ammo = 0; } return; }
      if (c.stage === 0) { c.stage = 1; c.t0 = lt; c.ammo0 = w.ammo; c.wasEmpty = w.ammo === 0; }
      if (c.stage === 1) {
        // auto-reload starts by itself when mag is empty; also press reload
        g.input.setVirtual('reload', lt < c.t0 + 0.06);
        if (w.reloading && c.startT == null) c.startT = lt;
        if (c.commitT == null && w.ammo > 0 && w.reloading) c.commitT = lt - (c.startT ?? c.t0);
        if (c.startT != null && !w.reloading && c.doneT == null) { c.doneT = lt - c.startT; c.stage = 2; c.ammoEnd = w.ammo; c.reloadTotal = w.reloadTotal; }
        // sample vm channels for tail analysis
        c.samples = c.samples || [];
        if (w.reloading) c.samples.push({ t: lt - (c.startT ?? c.t0), p: w.reloadProgress, mag: w.ammo });
      }
    },
    end(g, c) {
      const d = WEAPONS[id];
      R['reload_' + id] = { defReloadTime: d.reloadTime, extraEmpty: d.reloadEmptyExtra || 0, mode: d.reloadMode, measuredTotal_s: c.doneT && r3(c.doneT), reloadTotalField: c.reloadTotal && r3(c.reloadTotal),
        magFilledAt_s: c.commitT != null ? r3(c.commitT) : null, ammoAfter: c.ammoEnd, magSize: d.magSize };
    },
  };
}

function recoilPhase(id, ads, shotsN) {
  return {
    name: `recoil_${id}_${ads ? 'ads' : 'hip'}`, dur: 3.0,
    start(g, c) {
      g.input.setVirtual(KEY[id], true);
      const inv = g.weapons.inv[id]; inv.ammo = 99; inv.reserve = 99;
      place(g, 0, 22, 0, 0);
      c.s0 = null; c.done = false; c.peakTrauma = 0; c.peakKz = 0; c.peakKrx = 0; c.pitch0 = 0; c.yaw0 = 0; c.maxSpread = 0; c.spreadAtEnd = 0; c.n = 0; c.pitchAfter = null; c.fired = 0;
      fires.length = 0;
    },
    tick(lt, dt, g, c) {
      const p = g.player, w = g.weapons;
      if (lt < 1.0) { g.input.setVirtual(KEY[id], lt < 0.05); g.input.setVirtual('ads', ads && lt > 0.6); return; }
      if (c.s0 === null) { c.s0 = lt; c.pitch0 = p.pitch; c.yaw0 = p.yaw; c.n0 = fires.length; }
      const def = WEAPONS[id];
      const n = fires.length - c.n0;
      if (n < shotsN && lt < c.s0 + 3) {
        w.inv[id].ammo = 99; w.ammo = 99;
        const st = Math.floor((lt - c.s0) / dt);
        g.input.setVirtual('fire', def.auto ? true : (st % 2 === 0));
      } else g.input.setVirtual('fire', false);
      c.peakTrauma = Math.max(c.peakTrauma, p.rig.trauma);
      c.peakKz = Math.max(c.peakKz, w._sp.kz.x);
      c.peakKrx = Math.max(c.peakKrx, w._sp.krx.x);
      c.maxSpread = Math.max(c.maxSpread, w.spreadAngle);
      if (n >= shotsN && c.doneAt == null) { c.doneAt = lt; c.pitchEnd = p.pitch - c.pitch0; c.yawEnd = p.yaw - c.yaw0; c.spreadEnd = w.spreadAngle; }
      if (c.doneAt != null && lt > c.doneAt + 0.6 && c.pitchAfter == null) { c.pitchAfter = p.pitch - c.pitch0; c.yawAfter = p.yaw - c.yaw0; }
      c.n = n;
    },
    end(g, c) {
      const def = WEAPONS[id];
      R[`recoil_${id}_${ads ? 'ads' : 'hip'}`] = {
        shots: c.n, burstPitchDeg: c.pitchEnd != null ? r2(c.pitchEnd * DEG) : null, perShotDeg: c.pitchEnd != null ? r3(c.pitchEnd * DEG / Math.max(1, c.n)) : null,
        burstYawDeg: c.yawEnd != null ? r2(c.yawEnd * DEG) : null, pitchAfter600msDeg: c.pitchAfter != null ? r2(c.pitchAfter * DEG) : null,
        defPitchDegPerShot: r3(def.recoil.pitch * DEG), peakTrauma: r3(c.peakTrauma), peakShakeSq: r3(c.peakTrauma * c.peakTrauma),
        peakViewKickBack_m: r3(c.peakKz), peakViewKickPitch_rad: r3(c.peakKrx), maxSpread: r3(c.maxSpread), spreadEnd: c.spreadEnd != null ? r3(c.spreadEnd) : null,
        burstTime_s: c.doneAt != null ? r2(c.doneAt - c.s0) : null,
      };
    },
  };
}

export async function setup(game, report) {
  report.custom = R;
  game.player.god = true;
  for (const id of ['sniper', 'rocket']) game.weapons.giveWeapon(id);
  game.events.on('weapon:fire', e => { if (e.shooter === game.player) fires.push(game.time); });
  // aim at the far wall so nothing weird happens
  place(game, 0, 22, 0, 0);
  if (new URLSearchParams(location.search).get('fix') === '1') {
    const w = game.weapons;
    const orig = w._fire.bind(w);
    w._fire = (def, inv, now) => {
      const prev = w.nextFireAt;
      orig(def, inv, now);
      const interval = 1 / def.fireRate;
      const late = now - prev;
      w.nextFireAt = (late >= 0 && late < interval * 0.5 ? prev : now) + interval;
    };
    R._fixApplied = true;
  }
  const only = new URLSearchParams(location.search).get('only');
  const want = only ? only.split(',') : ['equip', 'rate', 'reload', 'recoil'];
  phases = [];
  if (want.includes('equip')) for (const id of IDS) phases.push(equipPhase(id));
  if (want.includes('rate')) for (const id of IDS) phases.push(firePhase(id, id === 'pistol' || id === 'rifle' ? 2.0 : 5.5));
  if (want.includes('reload')) for (const id of IDS) phases.push(reloadPhase(id));
  if (want.includes('recoil')) {
    phases.push(recoilPhase('rifle', false, 11), recoilPhase('rifle', true, 11), recoilPhase('pistol', false, 6), recoilPhase('pistol', true, 6),
      recoilPhase('shotgun', false, 1), recoilPhase('sniper', false, 1), recoilPhase('rocket', false, 1));
  }
  const total = phases.reduce((s, p) => s + p.dur, 0);
  game.autotest.duration = total + 0.3;
  R._total = total;
}

export function drive(t, dt, game, report) {
  let acc = 0, want = -1;
  for (let i = 0; i < phases.length; i++) {
    if (t < acc + phases[i].dur) { want = i; break; }
    acc += phases[i].dur;
  }
  if (want !== idx) {
    if (idx >= 0 && phases[idx].end) phases[idx].end(game, ctx);
    idx = want;
    phaseStart = acc;
    ctx = {};
    releaseAll(game);
    if (idx >= 0 && phases[idx].start) phases[idx].start(game, ctx);
  }
  if (idx >= 0 && phases[idx].tick) phases[idx].tick(t - phaseStart, dt, game, ctx);
  // keep the player from being disturbed
  if (idx >= 0) game.player.velocity.set(0, game.player.velocity.y, 0);
}

export function finish(game, report) {
  if (idx >= 0 && phases[idx] && phases[idx].end) phases[idx].end(game, ctx);
  releaseAll(game);
}

// Latency measurements: sprint -> first shot, ADS-in time, first shot after equip while holding fire.
import * as THREE from 'three';
import { WEAPONS } from '/src/weapons/WeaponDefs.js';
const R = {};
let fires = [];
let phases = [], idx = -1, phaseStart = 0, ctx = null;
const r3 = v => Math.round(v * 1000) / 1000;
const KEY = { pistol: 'weapon1', rifle: 'weapon2', shotgun: 'weapon3' };

function place(g) {
  const p = g.player;
  p.move.reset(); p.move.place(new THREE.Vector3(0, 0, 40)); p.prevPosition.copy(p.position); p.velocity.set(0, 0, 0);
  p.yaw = 0; p.pitch = 0;
}
const rel = g => { for (const a of ['forward', 'sprint', 'fire', 'ads', 'weapon1', 'weapon2', 'weapon3']) g.input.setVirtual(a, false); };

function sprintPhase(id) {
  return {
    name: 'sprint_' + id, dur: 5,
    start(g, c) { place(g); g.input.setVirtual(KEY[id], true); c.pressT = null; },
    tick(lt, dt, g, c) {
      const w = g.weapons, p = g.player;
      if (lt < 0.1) return;
      g.input.setVirtual(KEY[id], false);
      if (lt < 0.9) { g.input.setVirtual('forward', false); g.input.setVirtual('sprint', false); p.yaw = 0; return; }
      w.inv[id].ammo = 99;
      if (lt < 2.6) { g.input.setVirtual('forward', true); g.input.setVirtual('sprint', true); c.spr = p.isSprinting; return; }
      if (c.pressT === null) { c.pressT = g.time; c.sprAtPress = p.isSprinting; c.blendAtPress = w.sprintBlend; c.n0 = fires.length; }
      g.input.setVirtual('fire', true);
      g.input.setVirtual('forward', true); g.input.setVirtual('sprint', true);
      if (c.first == null && fires.length > c.n0) { c.first = fires[c.n0] - c.pressT; c.speedAtFirst = p.speed; }
      // if a semi-auto weapon, release after first shot
      if (c.first != null) g.input.setVirtual('fire', false);
    },
    end(g, c) { R['sprintToShot_' + id] = { latency_s: c.first != null ? r3(c.first) : null, sprintingAtPress: c.sprAtPress, blendAtPress: c.blendAtPress && r3(c.blendAtPress) }; },
  };
}

function adsPhase(id) {
  return {
    name: 'ads_' + id, dur: 3,
    start(g, c) { place(g); g.input.setVirtual(KEY[id], true); c.t0 = null; c.t50 = null; c.t90 = null; },
    tick(lt, dt, g, c) {
      const w = g.weapons;
      if (lt < 0.1) return;
      g.input.setVirtual(KEY[id], false);
      if (lt < 1.4) return;
      if (c.t0 === null) { c.t0 = lt; g.input.setVirtual('ads', true); }
      if (c.t50 === null && w.adsAmount >= 0.5) c.t50 = lt - c.t0;
      if (c.t90 === null && w.adsAmount >= 0.9) c.t90 = lt - c.t0;
    },
    end(g, c) { R['adsIn_' + id] = { adsTimeDef: WEAPONS[id].adsTime, to50_s: c.t50 != null ? r3(c.t50) : null, to90_s: c.t90 != null ? r3(c.t90) : null }; },
  };
}

export async function setup(game, report) {
  report.custom = R;
  game.player.god = true;
  game.events.on('weapon:fire', e => { if (e.shooter === game.player) fires.push(game.time); });
  for (const id of ['rifle', 'pistol', 'shotgun']) { phases.push(sprintPhase(id)); phases.push(adsPhase(id)); }
  game.autotest.duration = phases.reduce((s, p) => s + p.dur, 0) + 0.3;
  place(game);
}

export function drive(t, dt, game) {
  let acc = 0, want = -1;
  for (let i = 0; i < phases.length; i++) { if (t < acc + phases[i].dur) { want = i; break; } acc += phases[i].dur; }
  if (want !== idx) {
    if (idx >= 0 && phases[idx].end) phases[idx].end(game, ctx);
    idx = want; phaseStart = acc; ctx = {}; rel(game);
    if (idx >= 0 && phases[idx].start) phases[idx].start(game, ctx);
  }
  if (idx >= 0 && phases[idx].tick) phases[idx].tick(t - phaseStart, dt, game, ctx);
}
export function finish(game) { if (idx >= 0 && phases[idx].end) phases[idx].end(game, ctx); rel(game); }

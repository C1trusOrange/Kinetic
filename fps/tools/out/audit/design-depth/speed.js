// Measures the horizontal speeds the movement kit actually produces (sprint, slide, slide-hop) to calibrate a speed-scaled weapon.
import * as THREE from 'three';
const log = [];
let t0 = 0;
export function setup(game, report) {
  const p = game.player;
  p.god = true;
  p.spawn(new THREE.Vector3(-19, 0, 0), -Math.PI / 2);
  p.god = true;
  report.custom = { log, summary: null };
}
export function drive(t, dt, game, report) {
  const p = game.player, inp = game.input;
  // t in [0.5,1.9] sprint, then crouch for slide at 1.9 (still holding forward+sprint), hold crouch until 5.0
  inp.setVirtual('forward', t > 0.5 && t < 8);
  inp.setVirtual('jump', false);
  inp.setVirtual('sprint', t > 0.5 && t < 2.0);
  inp.setVirtual('crouch', t > 1.9 && t < 4.5);
  inp.setVirtual('fire', t > 2.6 && t < 6);     // does firing cancel sprint / slide?
  if (Math.floor(t * 10) !== Math.floor((t - dt) * 10)) {
    log.push({ t: +t.toFixed(1), sp: +p.speed.toFixed(1), spr: p.isSprinting, sl: p.isSliding, crouch: p.isCrouching, g: p.onGround, x: +p.position.x.toFixed(1) });
  }
  if (t > 8) report.custom.summary = { maxSpeed: Math.max(...log.map(l => l.sp)), slideSpeedMax: Math.max(...log.filter(l => l.sl).map(l => l.sp), 0), slideSecs: log.filter(l => l.sl).length / 10, slideAbove10: log.filter(l => l.sl && l.sp >= 10).length / 10 };
}

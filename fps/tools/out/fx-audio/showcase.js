// Effects showcase: fires every effect in front of the (stationary) player and takes scenario-driven screenshots.
import * as THREE from 'three';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const SURFACES = ['metal', 'concrete', 'stone', 'wood', 'dirt', 'sand', 'glass', 'grass', 'energy'];
let step = 0, waitAck = null, unfreezeAt = 0;

export function setup(game, report) {
  report.custom = { phase: 'setup', audio: game.audio.stats, audioReady: game.audio.ready, audioState: game.audio.ctx && game.audio.ctx.state };
  if (game.player) game.player.god = true;
}

const SHOTS = new URLSearchParams(location.search).has('shots');
function shot(game, name) {
  if (!SHOTS) return;
  window.__SHOT_REQ = name;
  waitAck = window.__SHOT_ACK || 0;
  game.timeScale = 0;
}

const SCENES = [
  // [time, fn]
  [0.4, (g) => {
    const fx = g.effects;
    // every surface impact on the wall at z = 12.5 with tracers from the player's muzzle
    SURFACES.forEach((s, i) => {
      const x = -7 + i * 1.75, y = 1.6 + (i % 2) * 0.9;
      for (let k = 0; k < 3; k++) {
        const p = V(x + (k - 1) * 0.35, y + (k === 1 ? 0.3 : 0), 12.5);
        fx.impact(p, V(0, 0, 1), s);
      }
      fx.tracer(V(0.5, 1.3, 25.6), V(x, y, 12.5), { color: 0xffd890 });
    });
  }],
  [0.6, (g) => { g.effects.hitSpark(V(-3, 1.3, 13.4), V(0, 0, 1), { model: { flashHit() {} } }); g.effects.hitSpark(V(2, 1.4, 13.4), V(0.3, 0.2, 0.9).normalize(), null); }],
  [0.8, (g) => { for (const n of ['pistol_fire', 'rifle_fire', 'shotgun_fire', 'sniper_fire', 'rocket_fire', 'hitmarker', 'footstep']) g.audio.play(n); }],
  [0.9, (g) => { g.effects.muzzleFlash(V(-4, 1.4, 20), V(0, 0, -1), { scale: 1 }); g.effects.muzzleFlash(V(4, 1.4, 20), V(0.2, 0, -1).normalize(), { scale: 1.3, color: 0x9cd8ff }); }],
  ['shot', 'impacts'],
  [1.4, (g) => { g.effects.explosion(V(0, 0.15, 17), { radius: 5, normal: V(0, 1, 0) }); g.audio.play('explosion', { position: V(0, 0, 17) }); }],
  [1.55, null],
  ['shot', 'explosion_a'],
  [1.9, null],
  ['shot', 'explosion_b'],
  [2.6, null],
  ['shot', 'explosion_c'],
  [3.4, (g) => { g.effects.explosion(V(-3.5, 2.2, 12.85), { radius: 4.8, normal: V(0, 0, 1) }); }],
  [3.6, null],
  ['shot', 'wall_explosion'],
  [5.0, null],
  ['shot', 'aftermath'],
];

let idx = 0;
let trailT = 0;
export function drive(t, dt, game, report) {
  const c = report.custom;
  if (waitAck !== null) {
    if ((window.__SHOT_ACK || 0) > waitAck) { waitAck = null; game.timeScale = 1; }
    return;
  }
  // rocket trail (moves continuously between 2.0 s and 3.0 s)
  if (t > 2.0 && t < 3.2) {
    const u = (t - 2.0) / 1.2;
    game.effects.trail(V(3.5 - u * 2, 1.6 - u * 0.3, 25 - u * 9), { type: 'rocket' });
    game.effects.trail(V(-5 + u * 1.5, 1.1, 24 - u * 7), { type: 'grenade' });
  }
  while (idx < SCENES.length) {
    const s = SCENES[idx];
    if (s[0] === 'shot') { idx++; shot(game, s[1]); return; }
    if (t < s[0]) break;
    idx++;
    if (s[1]) s[1](game);
    c.phase = idx;
  }
  if (idx >= SCENES.length && !c.gibsDone) {
    c.gibsDone = true;
  }
}

export function finish(game, report) {
  report.custom.stats = { ...game.effects.stats };
  report.custom.voices = game.audio.voices ? game.audio.voices.length : 0;
  report.custom.audioState = game.audio.ctx && game.audio.ctx.state;
}

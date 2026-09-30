import * as THREE from 'three';

export const ACTIONS = ['forward', 'back', 'left', 'right', 'jump', 'crouch', 'sprint', 'fire', 'ads', 'reload', 'grenade', 'grapple', 'melee'];

export function teleport(game, x, y, z, yaw = 0, pitch = 0) {
  const p = game.player;
  p.velocity.set(0, 0, 0);
  p.yaw = yaw;
  p.pitch = pitch;
  p.move.reset();
  p.grapple.reset();
  p._stopLoops();
  p.move.place(new THREE.Vector3(x, y, z));
  p.prevPosition.copy(p.position);
  p._acc = 0;
}
export function releaseAll(game) { for (const a of ACTIONS) game.input.setVirtual(a, false); }
export function keys(game, obj) { for (const [k, v] of Object.entries(obj)) game.input.setVirtual(k, !!v); }
export const r2 = v => Math.round(v * 100) / 100;
export const hs = p => Math.hypot(p.velocity.x, p.velocity.z);
export function loopInfo(game) {
  const a = game.audio;
  return {
    loops: a.loops ? a.loops.size : null,
    loopBusGain: a.loopBus ? +a.loopBus.gain.value.toFixed(3) : null,
    ready: a.ready, ctx: a.ctx ? a.ctx.state : null,
    state: game.state,
  };
}

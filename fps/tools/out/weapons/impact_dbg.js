let done = false;
export function setup(game) {
  window.__POSE_READY__ = false;
  const V = game.player.position.constructor;
  game.player.spawn(new V(8, 0, 28), 3.14);
  game.player.pitch = 0;
}
export function drive(t, dt, game) {
  const mode = game.params.get('mode') || 'impact';
  if (t > 1.0 && !done) {
    done = true;
    const c = game.camera;
    const d = new c.position.constructor(0, 0, -1).applyQuaternion(c.quaternion);
    const h = game.world.raycast(c.position, d, 100);
    window.__H = h && [h.distance, h.point.toArray(), h.normal.toArray()];
    if (mode === 'impact') game.effects.impact(h.point, h.normal, h.surface);
    else if (mode === 'tracer') game.effects.tracer(c.position.clone().addScaledVector(d, 0.85), h.point, { color: 0x8feaff });
    else if (mode === 'light') game.effects.flashLight(c.position.clone().addScaledVector(d, 0.85), 0x9fe8ff, 26, 9, 0.06);
    else game.input.setVirtual('fire', true);
    setTimeout(() => { game.input.setVirtual('fire', false); game.timeScale = 0; setTimeout(() => { window.__POSE_READY__ = true; }, 300); }, 90);
  }
}

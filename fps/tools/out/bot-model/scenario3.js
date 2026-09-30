// Freeze bots in front of a fixed camera and drive their model animation poses.
const LAYOUT = [
  { x: -1.5, z: 5.2, pose: 'idle' },
  { x: 0.9, z: 4.5, pose: 'fire' },
  { x: -0.4, z: 0.5, pose: 'run' },
  { x: 2.6, z: 1.2, pose: 'crouch' },
  { x: -3.0, z: -1.5, pose: 'reload' },
];
export function setup(game, report) {
  report.custom = { n: 0 };
  for (const el of game.uiRoot.children) el.style.display = 'none';
}
let inited = false;
export function drive(t, dt, game, report) {
  if (t < 1) for (const el of game.uiRoot.children) el.style.display = 'none';
  const list = game.bots.list;
  list.forEach((b, i) => {
    const L = LAYOUT[i];
    if (!L) return;
    if (!b._frozen) {
      b._frozen = true;
      b.spawn(b.position.clone().set(L.x, 0, L.z), Math.PI + 0.3 - i * 0.15);
      b.update = function (d) { this._updateModel(d); };
    }
    b.health = 100;
    b.position.set(L.x, 0, L.z);
    b._syncCapsule && b._syncCapsule();
    b.onGround = true;
    b.yaw = Math.PI + 0.3 - i * 0.15;
    b.pitch = 0.04;
    b.velocity.set(0, 0, 0);
    b.speed = 0;
    b.crouch = 0;
    b.reloading = false;
    if (L.pose === 'run') { b.velocity.set(-Math.sin(b.bodyYaw) * -7, 0, -Math.cos(b.bodyYaw) * -7); b.speed = 7; }
    if (L.pose === 'fire') b._firingUntil = t + 0.14;
    if (L.pose === 'crouch') b.crouch = 1;
    if (L.pose === 'reload') b.reloading = true;
  });
  report.custom.n = list.length;
  if (t > 3) window.__BOTS_READY__ = true;
}

// grapple rope visibility after quitToMenu
const out = {};
const pl = game.player;
await sleep(500);
// find a look direction that hits geometry within 45m
const eye = pl.getEyePosition(new THREE.Vector3());
let found = null;
for (let pitch = 0.3; pitch < 1.4 && !found; pitch += 0.05) {
  for (let yaw = 0; yaw < 6.28 && !found; yaw += 0.3) {
    const d = new THREE.Vector3(-Math.sin(yaw)*Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw)*Math.cos(pitch));
    const h = game.world.raycast(eye, d, 40);
    if (h && h.normal.y < 0.5) found = { yaw, pitch, dist: h.distance };
  }
}
out.found = found;
pl.yaw = found.yaw; pl.pitch = found.pitch;
game.input.setVirtual('grapple', true);
await sleep(100);
game.input.setVirtual('grapple', false);
await sleep(900);
out.grappleState = pl.grapple.state;
out.groupVisibleBefore = pl.grapple.group && pl.grapple.group.visible;
out.ropeVisibleBefore = pl.grapple.rope && pl.grapple.rope.visible;
game.quitToMenu();
await sleep(800);
out.stateAfterQuit = game.state;
out.grappleStateAfterQuit = pl.grapple.state;
out.groupVisibleAfter = pl.grapple.group && pl.grapple.group.visible;
out.ropeVisibleAfter = pl.grapple.rope && pl.grapple.rope.visible;
out.isGrappling = pl.isGrappling;
out.groupPos = pl.grapple.group && pl.grapple.group.position.toArray();
out.camPos = game.camera.position.toArray();
return out;

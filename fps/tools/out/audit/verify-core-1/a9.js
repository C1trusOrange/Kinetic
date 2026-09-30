const out = {};
const pl = game.player;
await sleep(500);
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
out.grappleStateBefore = pl.grapple.state;
game.quitToMenu();
await sleep(1500);
out.state = game.state;
out.grappleState = pl.grapple.state;
out.ropeVisible = pl.grapple.rope.visible && pl.grapple.group.visible;
// project rope vertices to screen and count those inside viewport
const rp = pl.grapple._pos;
let inside = 0, total = rp.length / 3;
const v = new THREE.Vector3();
let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
for (let i = 0; i < total; i++) {
  v.set(rp[i*3], rp[i*3+1], rp[i*3+2]).project(game.camera);
  if (Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1 && v.z < 1) inside++;
  minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x); minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
}
out.ropeVertsInView = inside; out.ropeVerts = total;
out.ndcBox = [minX, maxX, minY, maxY].map(x => +x.toFixed(2));
out.claw = pl.grapple.claw.getWorldPosition(new THREE.Vector3()).toArray().map(x => +x.toFixed(1));
out.playerPos = pl.position.toArray().map(x => +x.toFixed(1));
out.camPos = game.camera.position.toArray().map(x => +x.toFixed(1));
// hide menu to see backdrop
const root = document.getElementById('menu-root') || document.querySelector('.menu-root, #menu');
out.hasRoot = !!root;
game.uiRoot.style.display = 'none';
await sleep(500);
return out;

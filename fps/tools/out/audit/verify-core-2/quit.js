import * as THREE from 'three';
const sleep = ms => new Promise(r => setTimeout(r, ms));
export function drive() {}
export async function setup(game, report) {
  const c = report.custom = {};
  await sleep(500);
  const pc = game.world.def.previewCamera;
  c.previewCamera = pc;
  const p = game.player;
  // stand near the preview look-at target, look toward the floor ahead
  const tgt = new THREE.Vector3(...pc.lookAt);
  p.spawn(new THREE.Vector3(tgt.x + 4, 0.05, tgt.z + 6), 0.0);
  p.pitch = -0.12;
  await sleep(400);
  game.input.setVirtual('grapple', true);
  await sleep(60);
  game.input.setVirtual('grapple', false);
  let waited = 0;
  while (p.grapple.state !== 'attached' && waited < 3000) { await sleep(8); waited += 8; }
  c.beforeQuit = { state: p.grapple.state, isGrappling: p.isGrappling, groupVisible: p.grapple.group.visible, ropeVisible: p.grapple.rope.visible, loops: game.audio.loops.size, pos: p.position.toArray().map(v => +v.toFixed(1)), anchor: p.grapple.anchor.toArray().map(v => +v.toFixed(1)) };
  game.quitToMenu();
  await sleep(1500);
  c.afterQuit = { gameState: game.state, state: p.grapple.state, isGrappling: p.isGrappling, groupVisible: p.grapple.group.visible, ropeVisible: p.grapple.rope.visible, clawVisible: p.grapple.claw.visible, loops: game.audio.loops.size, loopBusGain: game.audio.loopBus.gain.value, alive: p.alive };
  game.uiRoot.style.display = 'none'; c.ropeWorld = [game.player.grapple.rope.position.toArray(), game.player.grapple.origin.toArray(), game.player.grapple.hook.toArray()]; await sleep(500);
  window.__PROBE_DONE__ = true;
}

// Screenshot poses: ?pose=sprint|slide|wallrun|grapple|air|idle. Freezes the game (timeScale 0) at the moment of interest.
import * as THREE from 'three';
import { teleport, keys, installTrace, releaseAll, r2 } from './common.js';

const q = new URLSearchParams(location.search);
const pose = q.get('pose') || 'sprint';
const hold = parseFloat(q.get('hold') || '0.6');
const F = (g, name, on) => g.input.setVirtual(name, on);
const st = {};

export async function setup(g, report) {
  report.custom = { pose };
  g.player.god = true;
  g.autotest.duration = 60;
  installTrace(g);
  const p = g.player;
  if (q.get('fix') === 'hand') {
    const gr = p.grapple;
    const tmp = new THREE.Vector3();
    gr._handWorld = out => {
      const w = g.weapons, vm = w.vm[w.currentId], cam = g.camera, vcam = g.viewCamera;
      const part = vm && vm.parts && vm.parts.leftHand;
      if (part) {
        part.obj.getWorldPosition(tmp);
        vcam.worldToLocal(tmp);                           // hand in view-camera space (vfov 50)
        const k = Math.tan(cam.fov * Math.PI / 360) / Math.tan(vcam.fov * Math.PI / 360);
        tmp.x *= k; tmp.y *= k;                           // same screen pixel under the world camera's fov
        return out.copy(tmp).applyQuaternion(cam.quaternion).add(cam.position);
      }
      return out.set(-0.13, -0.21, -0.55).applyQuaternion(cam.quaternion).add(cam.position);
    };
  }
  if (pose === 'sprint') teleport(g, 20, 0, 27, Math.PI / 2, 0);
  if (pose === 'slide') teleport(g, 24, 0, 27, Math.PI / 2, -0.02);
  if (pose === 'wallrun') teleport(g, -11, 0, -16.6, Math.PI / 2 - 0.3, 0.05);
  if (pose === 'grapple') teleport(g, -8, 0, -12, Math.PI - 0.15, 1.0);
  if (pose === 'air') teleport(g, 0, 0, 26, 0, 0.1);
  if (pose === 'idle') teleport(g, 20, 0, 27, Math.PI / 2, 0);
  if (pose === 'mantle') teleport(g, 0, 0, -20, -Math.PI / 2, 0.05);
  if (pose === 'land') teleport(g, 0, 9, 40, 0, 0.1);
}

function freeze(g, why) {
  st.frozen = true;
  g.autotest.duration = g.autotest.t;
  st.why = why;
}

export function drive(t, dt, g, report) {
  if (st.frozen) return;
  const p = g.player;
  if (pose === 'sprint') {
    keys(g, { forward: t > 0.1, sprint: t > 0.1 });
    if (t > 1.3) freeze(g, 'sprint');
  } else if (pose === 'slide') {
    keys(g, { forward: t > 0.1, sprint: t > 0.1 && t < 1.1, crouch: t >= 1.1 });
    if (p.isSliding) { st.s = (st.s || 0) + dt; if (st.s > hold) freeze(g, 'slide'); }
  } else if (pose === 'wallrun') {
    keys(g, { forward: t > 0.05, sprint: t > 0.05 });
    if (t > 0.5 && !st.j) { st.j = 1; F(g, 'jump', true); } else if (st.j === 1) { st.j = 2; F(g, 'jump', false); }
    if (p.isWallRunning) { st.s = (st.s || 0) + dt; if (st.s > hold) freeze(g, 'wallrun'); }
  } else if (pose === 'grapple') {
    if (t > 0.3 && !st.f) { st.f = 1; F(g, 'grapple', true); } else if (st.f === 1) { st.f = 2; F(g, 'grapple', false); }
    if (p.isGrappling) { st.s = (st.s || 0) + dt; if (st.s > hold) freeze(g, 'grapple'); }
    if (t > 3) freeze(g, 'grapple-timeout');
  } else if (pose === 'air') {
    keys(g, { forward: t > 0.1, sprint: t > 0.1 });
    if (t > 0.6 && !st.j) { st.j = 1; F(g, 'jump', true); } else if (st.j === 1) { st.j = 2; F(g, 'jump', false); }
    if (t > 1.3) freeze(g, 'air');
  } else if (pose === 'mantle') {
    keys(g, { forward: t > 0.05, sprint: t > 0.05 });
    if (!st.j && p.position.x >= 6.0) { st.j = 1; F(g, 'jump', true); } else if (st.j === 1) { st.j = 2; F(g, 'jump', false); }
    if (p.isMantling && p.mantleProgress > parseFloat(q.get('mp') || '0.5')) freeze(g, 'mantle');
    if (t > 4) freeze(g, 'mantle-timeout');
  } else if (pose === 'land') {
    // frozen just after a hard landing: sample the dip frame (peak landY)
    if (p.onGround && !st.l) { st.l = 1; st.lt = t; }
    if (st.l && t - st.lt > parseFloat(q.get('after') || '0.06')) freeze(g, 'land');
    if (t > 4) freeze(g, 'land-timeout');
  } else if (pose === 'idle') {
    if (t > 0.8) freeze(g, 'idle');
  }
}

export function finish(g, report) {
  const p = g.player;
  report.custom.state = { why: st.why, speed: r2(p.speed), fov: r2(g.camera.fov), roll: r2(g.camera.rotation.z * 180 / Math.PI), pitch: r2(g.camera.rotation.x * 180 / Math.PI),
    sliding: p.isSliding, wall: p.isWallRunning, grappling: p.isGrappling, eye: r2(p.eyeHeight), camY: r2(g.camera.position.y - p.position.y) };
  releaseAll(g);
  g.timeScale = 0;
}

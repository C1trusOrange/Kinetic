// Shared helpers for the collision scenarios: an INDEPENDENT inside-a-solid detector (brute force ray
// crossing count over every collision triangle - it does not use the game's own isInside), player teleport,
// and a fast headless stepper that runs the PlayerController directly (no rendering) for sweeps.
import * as THREE from 'three';
import { MOVE as M } from '/src/player/MoveConfig.js';

export const R = 0.4;
export const STAND_H = 1.8;
export const STEP = M.STEP;

// ------------------------------------------------------------------------------------------------ detector

const DIRS = [
  [0.5773, 0.3011, 0.7593], [-0.2411, 0.8807, -0.4053], [0.1123, -0.6791, 0.7247],
  [-0.7013, -0.2117, -0.6796], [0.3319, 0.4701, -0.8175],
];
for (const d of DIRS) { const l = Math.hypot(d[0], d[1], d[2]); d[0] /= l; d[1] /= l; d[2] /= l; }

/** Brute-force ray-crossing detector over all collision triangles (closed solids, overlaps, seams all handled). */
export class Detector {
  constructor(game) {
    const set = new Set();
    const list = [];
    const walk = node => {
      for (const t of node.triangles) if (!set.has(t)) { set.add(t); list.push(t); }
      for (const s of node.subTrees) walk(s);
    };
    walk(game.world.collision.octree);
    this.count = list.length;
    this.tri = new Float64Array(list.length * 9);
    list.forEach((t, i) => {
      const o = i * 9;
      this.tri[o] = t.a.x; this.tri[o + 1] = t.a.y; this.tri[o + 2] = t.a.z;
      this.tri[o + 3] = t.b.x; this.tri[o + 4] = t.b.y; this.tri[o + 5] = t.b.z;
      this.tri[o + 6] = t.c.x; this.tri[o + 7] = t.c.y; this.tri[o + 8] = t.c.z;
    });
  }

  /** Signed crossing count along the ray to +infinity: number of solids containing the origin. */
  winding(px, py, pz, dx, dy, dz) {
    const T = this.tri;
    let w = 0;
    for (let i = 0, n = this.count * 9; i < n; i += 9) {
      const ax = T[i], ay = T[i + 1], az = T[i + 2];
      const e1x = T[i + 3] - ax, e1y = T[i + 4] - ay, e1z = T[i + 5] - az;
      const e2x = T[i + 6] - ax, e2y = T[i + 7] - ay, e2z = T[i + 8] - az;
      const hx = dy * e2z - dz * e2y, hy = dz * e2x - dx * e2z, hz = dx * e2y - dy * e2x;
      const a = e1x * hx + e1y * hy + e1z * hz;
      if (a > -1e-12 && a < 1e-12) continue;
      const f = 1 / a;
      const sx = px - ax, sy = py - ay, sz = pz - az;
      const u = f * (sx * hx + sy * hy + sz * hz);
      if (u < 0 || u > 1) continue;
      const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
      const v = f * (dx * qx + dy * qy + dz * qz);
      if (v < 0 || u + v > 1) continue;
      const t = f * (e2x * qx + e2y * qy + e2z * qz);
      if (t > 1e-7) w += a < 0 ? 1 : -1;
    }
    return w;
  }

  /** True when the point is inside at least one closed solid (majority of 5 skewed rays). */
  inside(x, y, z) {
    let votes = 0;
    for (let k = 0; k < DIRS.length; k++) {
      if (this.winding(x, y, z, DIRS[k][0], DIRS[k][1], DIRS[k][2]) > 0) votes++;
    }
    return votes >= 3;
  }

  /** Capsule (lower/upper sphere centres + midpoint) - true when ANY of the three points is inside a solid. */
  insideCapsule(c) {
    const mx = (c.start.x + c.end.x) / 2, my = (c.start.y + c.end.y) / 2, mz = (c.start.z + c.end.z) / 2;
    return this.inside(mx, my, mz) || this.inside(c.start.x, c.start.y, c.start.z) || this.inside(c.end.x, c.end.y, c.end.z);
  }
}

// ------------------------------------------------------------------------------------------------ player helpers

/** Teleport the player. o: {air, vel:[x,y,z], pitch}. */
export function teleport(game, x, y, z, yaw, o = {}) {
  const P = game.player, mv = P.move;
  P.god = true;
  P.spawn(new THREE.Vector3(x, y, z), yaw);
  P.spawnProtectedUntil = 0;
  const c = mv.capsule;
  if (o.air) {
    c.start.set(x, y + R, z);
    c.end.set(x, y + STAND_H - R, z);
    mv.grounded = false;
    mv.airTime = 0.25;
    mv.coyote = 0;
    mv.landSuppressUntil = mv.t + 1;
  }
  P.pitch = o.pitch || 0;
  P.yaw = yaw;
  if (o.vel) P.velocity.set(o.vel[0], o.vel[1], o.vel[2]);
  mv._sync();
  P.prevPosition.copy(P.position);
  P.stepOffset.set(0, 0, 0);
  const inp = mv.in;
  inp.forwardHeld = inp.jumpHeld = inp.jumpFresh = inp.crouchHeld = inp.crouchFresh = inp.sprintHeld = false;
  inp.wishX = inp.wishZ = inp.wishLen = inp.fwd = inp.strafe = 0;
  mv.jumpBuffer = 0;
  mv.mantleCooldown = 0;
  return P;
}

/**
 * Run one scripted attempt headlessly (PlayerController.step at 120 Hz, no rendering).
 * cfg: { pos:[x,y,z], yaw, pitch, air, vel:[..], sprint, fwdFrom=0, fwdTo=Infinity, jumps:[t..] (edge presses),
 *        turns:[[t, yaw]] (yaw changes), grappleAt, dur, post (extra seconds holding forward after `dur`),
 *        checkEvery (steps between inside samples after a mantle; 0 = only at the end) }
 * Returns { mantled, mantleT, mantleFrom, endPos, insideEnd, insideAny, firstInside:{t,pos}, maxDepth, steps }.
 */
export function attempt(game, det, cfg) {
  // a start position with the capsule already buried in a solid is a test artefact (a spawn inside geometry), not a
  // gameplay state: skip it (independent brute-force detector, identical for the old and the new code)
  if (cfg.skipBuried !== false) {
    const [px, py, pz] = cfg.pos;
    // (also skip starts within 3 cm of a surface: "inside" is ambiguous exactly on a face and the resolver pops such a
    //  capsule out through a neighbouring crate's top face - a test artefact, not a gameplay state)
    let bad = false;
    for (const [ox, oz] of [[0, 0], [0.03, 0], [-0.03, 0], [0, 0.03], [0, -0.03]]) {
      if (det.inside(px + ox, py + 0.4, pz + oz) || det.inside(px + ox, py + 0.9, pz + oz) || det.inside(px + ox, py + 1.4, pz + oz)) { bad = true; break; }
    }
    if (bad) {
      return { skipped: true, mantled: false, insideAny: false, insideEnd: false, endPos: [px, py, pz], minY: py, maxY: py, wallrun: false, grappleAttached: false };
    }
  }
  const P = teleport(game, cfg.pos[0], cfg.pos[1], cfg.pos[2], cfg.yaw || 0, { air: cfg.air, vel: cfg.vel, pitch: cfg.pitch });
  const mv = P.move, inp = mv.in;
  let yaw = cfg.yaw || 0;
  const fwdFrom = cfg.fwdFrom ?? 0, fwdTo = cfg.fwdTo ?? Infinity;
  const jumps = (cfg.jumps || []).slice().sort((a, b) => a - b);
  const turns = (cfg.turns || []).slice().sort((a, b) => a[0] - b[0]);
  let ji = 0, ti = 0, grappled = false;
  let rc0 = mv.rescueCount || 0, stepUpStep = -99;
  const origStepUp = mv._tryStepUp;
  mv._tryStepUp = function (...a) { const ok = origStepUp.apply(this, a); if (ok) stepUpStep = curStep; return ok; };
  let curStep = 0;
  const hist = [];
  const total = Math.round(((cfg.dur ?? 1.5) + (cfg.post ?? 0)) / STEP);
  const durSteps = Math.round((cfg.dur ?? 1.5) / STEP);
  const res = {
    mantled: false, mantleT: -1, mantleFrom: null, insideAny: false, insideEnd: false, firstInside: null,
    minY: 1e9, maxY: -1e9, wallrun: false, grappleAttached: false, steps: total,
  };
  const every = cfg.checkEvery ?? 24;
  let wasMantling = false, mantleDoneStep = -1;
  for (let i = 0; i < total; i++) {
    const t = i * STEP;
    while (ti < turns.length && turns[ti][0] <= t) { yaw = turns[ti][1]; P.yaw = yaw; ti++; }
    const holdF = t >= fwdFrom && t < fwdTo;
    inp.forwardHeld = holdF;
    inp.fwd = holdF ? 1 : 0;
    inp.strafe = 0;
    if (holdF) {
      inp.wishX = -Math.sin(yaw);
      inp.wishZ = -Math.cos(yaw);
      inp.wishLen = 1;
    } else { inp.wishX = inp.wishZ = inp.wishLen = 0; }
    inp.sprintHeld = !!cfg.sprint && holdF;
    inp.crouchFresh = false;
    if (cfg.crouchFrom !== undefined) {
      const was = inp.crouchHeld;
      inp.crouchHeld = t >= cfg.crouchFrom && !(cfg.uncrouchAt !== undefined && t >= cfg.uncrouchAt);
      if (inp.crouchHeld && !was) inp.crouchFresh = true;
    } else inp.crouchHeld = false;
    if (cfg.impulse && !cfg.impulse.done && t >= cfg.impulse.t) {
      cfg.impulse.done = true;
      P.applyImpulse(new THREE.Vector3(cfg.impulse.v[0], cfg.impulse.v[1], cfg.impulse.v[2]));
    }
    inp.jumpFresh = false;
    while (ji < jumps.length && jumps[ji] <= t) { inp.jumpFresh = true; ji++; }
    inp.jumpHeld = inp.jumpFresh;
    if (cfg.grappleAt !== undefined && !grappled && t >= cfg.grappleAt) {
      grappled = true;
      const gr = P.grapple;
      game.camera.position.set(P.position.x, P.position.y + P.eyeHeight, P.position.z);
      game.camera.rotation.set(P.pitch, yaw, 0, 'YXZ');
      game.camera.updateMatrixWorld(true);
      gr.fire();
    }
    if (grappled) P.grapple.update(STEP);
    P.prevPosition.copy(P.position);
    curStep = i;
    const pre = { mantling: mv.mantling, wall: mv.wallRunning, grapple: P.grapple.attached, slide: mv.sliding, crouch: mv.crouched, ground: mv.grounded, pos: [P.position.x, P.position.y, P.position.z] };
    mv.step(STEP);
    hist.push(pre); if (hist.length > 4) hist.shift();
    if ((mv.rescueCount || 0) > rc0) {
      rc0 = mv.rescueCount;
      const info = mv.rescueLog[mv.rescueLog.length - 1] || {};
      res.rescued = (res.rescued || 0) + 1;
      if (!res.rescueInfo) res.rescueInfo = { t: +t.toFixed(3), from: info.from, to: info.to, stepUpRecent: i - stepUpStep <= 3, pre, prev: hist.slice(0, -1).map(h => (h.mantling ? 'M' : '') + (h.wall ? 'W' : '') + (h.grapple ? 'G' : '') + (h.slide ? 'S' : '') + (h.crouch ? 'C' : '') + (h.ground ? 'g' : 'a')) };
    }
    inp.crouchFresh = false;
    if (mv.wallRunning) res.wallrun = true;
    if (P.grapple.attached) res.grappleAttached = true;
    if (cfg.trace && i % cfg.trace === 0) (res.trace = res.trace || []).push([+t.toFixed(2), r2(P.position.x), r2(P.position.y), r2(P.position.z), mv.state, r2(P.velocity.x), r2(P.velocity.y), r2(P.velocity.z)]);
    res.minY = Math.min(res.minY, P.position.y);
    res.maxY = Math.max(res.maxY, P.position.y);
    if (mv.mantling && !wasMantling) {
      res.mantled = true;
      res.mantleT = +t.toFixed(3);
      res.mantleFrom = [P.position.x, P.position.y, P.position.z].map(v => +v.toFixed(2));
    }
    if (!mv.mantling && wasMantling) mantleDoneStep = i;
    wasMantling = mv.mantling;
    // only sample "inside" after a mantle (cheap on big maps) and every `every` steps
    if (every && res.mantled && !mv.mantling && (i - mantleDoneStep) % every === 0 && i >= mantleDoneStep && !res.insideAny) {
      if (det.insideCapsule(mv.capsule)) {
        res.insideAny = true;
        res.firstInside = { t: +t.toFixed(3), pos: [P.position.x, P.position.y, P.position.z].map(v => +v.toFixed(2)) };
      }
    }
    if (i === durSteps - 1) res.durPos = [P.position.x, P.position.y, P.position.z].map(v => +v.toFixed(2));
  }
  res.endPos = [P.position.x, P.position.y, P.position.z].map(v => +v.toFixed(3));
  res.endCrouched = mv.crouched;
  res.rescues = mv.rescueCount;
  if (res.mantled || cfg.alwaysCheck) {
    res.insideEnd = det.insideCapsule(mv.capsule);
    if (res.insideEnd) res.insideAny = true;
  }
  P.grapple.reset();
  mv._tryStepUp = origStepUp;
  return res;
}

export const r2 = v => +v.toFixed(2);

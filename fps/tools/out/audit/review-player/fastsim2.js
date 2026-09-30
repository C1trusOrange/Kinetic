// Fast-forward fuzz: drives game.update() manually (no rendering) with random input and checks invariants.
import * as THREE from 'three';
import { ACTIONS, teleport, keys, releaseAll, r2, hs } from './common.js';

const P = new URLSearchParams(location.search);
const SEED = parseInt(P.get('seed') || '1', 10);
const SECONDS = parseFloat(P.get('secs') || '300');
const DT = 1 / parseFloat(P.get('fps') || '60');
const CHAOS = P.get('chaos') === '1';
const KILL = P.get('kill') === '1';
const RING = (P.get('ring') || '').split(',');
const RINGN = parseInt(P.get('ringn') || '40', 10);

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export async function setup(game, report) {
  const R = report.custom = { seed: SEED, viol: {}, samples: {}, counts: {} };
  const rand = rng(SEED);
  const p = game.player;
  p.god = true;
  game.autotest.duration = 1e9;
  game.state = 'loading';          // stop the rAF loop from simulating; we drive update() ourselves
  game.input.enabled = true;

  const world = game.world;
  const coll = world.collision;
  const bounds = world.bounds;
  const viol = (name, info) => {
    R.counts[name] = (R.counts[name] || 0) + 1;
    if (!R.samples[name]) { R.samples[name] = info; if (RING.includes(name)) R.ring[name] = ring.slice(-RINGN); }
  };
  const snap = () => ({
    t: r2(game.time), pos: [r2(p.position.x), r2(p.position.y), r2(p.position.z)], vel: [r2(p.velocity.x), r2(p.velocity.y), r2(p.velocity.z)],
    state: p.move.state, grounded: p.move.grounded, crouched: p.move.crouched, h: r2(p.height),
    keys: ACTIONS.filter(a => game.input.virtual.get(a)).join('+'),
    gr: p.grapple.state,
  });

  const ring = []; R.ring = {};
  R.trace = [];
  if (P.get('trace')) {
    const orig = coll.resolveCapsule.bind(coll);
    const lim = parseFloat(P.get('trace'));
    coll.resolveCapsule = (cap) => {
      const sx = cap.start.x, sy = cap.start.y, sz = cap.start.z;
      const res = orig(cap);
      const d = Math.hypot(cap.start.x - sx, cap.start.y - sy, cap.start.z - sz);
      if (d > lim && R.trace.length < 12) {
        if (d > 0.9) { R.bigRing = R.bigRing || []; if (R.bigRing.length < 4) R.bigRing.push(ring.slice(-400)); }
        const stack = new Error().stack.split('\n').slice(2, 6).map(l => l.trim().replace(/http:\/\/127.0.0.1:\d+\//, '')).join(' | ');
        R.trace.push({ t: r2(game.time), d: r2(d), from: [r2(sx), r2(sy), r2(sz)], to: [r2(cap.start.x), r2(cap.start.y), r2(cap.start.z)], n: res.count, normals: Array.from({length: res.count}, (_, i) => [r2(res.normals[i].x), r2(res.normals[i].y), r2(res.normals[i].z), r2(res.depths[i])]), stack });
      }
      return res;
    };
  }
  const held = {};
  const until = {};
  const setKey = (a, v) => { held[a] = v; game.input.setVirtual(a, v); };
  const spots = world.spawnPoints.map(s => s.position);
  const extra = [
    [-30, 0, -17, -Math.PI / 2], [-11, 0, -17, Math.PI / 2], [-21, 0, -12, 0], [14, 0, 0, -Math.PI / 2], [0, 0, 20, 0], [-20, 0, 22, 0],
    [18, 0, 16, 0], [25, 0, 16, Math.PI], [0, 4.5, 0, 0], [0, 4.5, -20, 0], [22, 16, -16, 0], [-14, 0, 0, 0],
  ];
  let nextTele = 5 + rand() * 10;
  let yawRate = 0, pitchRate = 0, nextLook = 0;
  const N = Math.floor(SECONDS / DT);
  let lastCheckAlive = true;
  const lastPos = new THREE.Vector3().copy(p.position); let popSkip = 3;
  for (let i = 0; i < N; i++) {
    const t = i * DT;
    if (i === 0) { const s0 = spots[SEED % spots.length]; teleport(game, s0.x, s0.y, s0.z, 0, 0); popSkip = 3; lastPos.copy(p.position); }
    // ---- random driver
    if (t > nextLook) { nextLook = t + 0.2 + rand() * 1.2; yawRate = (rand() - 0.5) * 900; pitchRate = (rand() - 0.5) * 500; if (rand() < 0.2) yawRate *= 4; }
    game.input.addLook(yawRate * DT, pitchRate * DT);
    for (const a of ['forward', 'back', 'left', 'right', 'sprint', 'crouch']) {
      if (!(until[a] > t)) {
        const on = a === 'forward' ? rand() < 0.8 : a === 'sprint' ? rand() < 0.7 : a === 'crouch' ? rand() < 0.2 : rand() < 0.25;
        setKey(a, on);
        until[a] = t + (a === 'crouch' ? 0.2 + rand() * 1.0 : 0.3 + rand() * 2.0);
      }
    }
    if (rand() < 0.05) setKey('jump', true); else if (held.jump && rand() < 0.5) setKey('jump', false);
    if (rand() < 0.012) setKey('grapple', true); else if (held.grapple) setKey('grapple', false);
    // pitch bias: keep look near horizontal or up
    if (p.pitch < -0.8) game.input.addLook(0, -200 * DT);
    if (t > nextTele) {
      nextTele = t + 6 + rand() * 12;
      let x, y, z, yaw = rand() * 6.28;
      if (game.world.mapId === 'sandbox' && rand() < 0.6) { const s = extra[Math.floor(rand() * extra.length)]; [x, y, z] = s; if (s[3] !== undefined) yaw = s[3]; }
      else { const s = spots[Math.floor(rand() * spots.length)]; x = s.x; y = s.y; z = s.z; }
      teleport(game, x, y, z, yaw, (rand() - 0.5) * 0.6); popSkip = 3;
      p.velocity.set(-Math.sin(yaw) * rand() * 10, 0, -Math.cos(yaw) * rand() * 10);
    }
    if (KILL && p.alive && ['slide', 'wallrun', 'grapple', 'mantle'].includes(p.move.state) && rand() < 0.03) {
      const stKill = p.move.state;
      R.kills = (R.kills || 0) + 1;
      game.combat.kill(p, { attacker: null, weapon: 'fall' });
      for (let k = 0; k < 20; k++) { game.input.update(); game.update(DT); game.input.endFrame(); }
      const d = { stKill, loops: game.audio.loops.size, gstate: p.grapple.state, gvis: p.grapple.group.visible, sl: p.isSliding, wr: p.isWallRunning, gp: p.isGrappling, mt: p.isMantling, cr: p.isCrouching, anchor: !!p.grappleAnchor, sp: r2(p.speed) };
      R.deathSamples = R.deathSamples || {};
      if (d.loops !== 0 || d.gstate !== 'idle' || d.sl || d.wr || d.gp || d.mt || d.anchor) viol('deathStale', d);
      R.deathSamples[stKill] = d;
      game.respawnEntity(p); popSkip = 3;
      for (let k = 0; k < 3; k++) { game.input.update(); game.update(DT); game.input.endFrame(); }
      const mv2 = p.move;
      const e = { st: mv2.state, cr: mv2.crouched, h: r2(p.height), loops: game.audio.loops.size, g: p.grapple.state, cd: p.grappleCharge, fov: r2(game.camera.fov), base: r2(game.getBaseFov()), dj: p.doubleJumpReady, wallRuns: mv2.wallRunsThisAir, wj: mv2.wallJumps, lock: mv2.lockUntil, mc: mv2.mantleCooldown, so: [r2(p.stepOffset.x), r2(p.stepOffset.y), r2(p.stepOffset.z)], tr: r2(p.rig.trauma), vel: [r2(p.velocity.x), r2(p.velocity.y), r2(p.velocity.z)], look: p.lookScale, fm: p.fovMultiplier };
      R.respawnSamples = R.respawnSamples || []; if (R.respawnSamples.length < 6) R.respawnSamples.push(e);
      if (e.loops !== 0 || e.g !== 'idle' || e.cr || Math.abs(e.fov - e.base) > 6 || e.cd !== 1) viol('respawnStale', e);
      continue;
    }
    if (!p.alive) { // respawn immediately when killed (kill plane etc.)
      viol('diedDuringFuzz', snap());
      game.respawnEntity(p); popSkip = 3;
    }

    // ---- step the game
    game.input.update();
    game.update(DT);
    game.input.endFrame();

    ring.push(snap()); if (ring.length > 400) ring.shift();
    // ---- invariants
    const mv = p.move;
    const fin = v => Number.isFinite(v);
    if (![p.position.x, p.position.y, p.position.z, p.velocity.x, p.velocity.y, p.velocity.z, p.yaw, p.pitch].every(fin)) { viol('nonFinite', snap()); teleport(game, 0, 0, 0); }
    const cp = game.camera.position;
    if (![cp.x, cp.y, cp.z, game.camera.fov].every(fin)) viol('cameraNonFinite', snap());
    const expLoops = (mv.sliding ? 1 : 0) + (mv.wallRunning ? 1 : 0) + (p.grapple.attached ? 1 : 0);
    if (game.audio.loops && game.audio.loops.size !== expLoops) viol('loopMismatch', { ...snap(), loops: game.audio.loops.size, expLoops, sliding: mv.sliding, wall: mv.wallRunning, att: p.grapple.attached });
    if (p.isWallRunning !== mv.wallRunning || p.isSliding !== mv.sliding || p.isMantling !== mv.mantling) viol('flagMismatch', { ...snap(), pw: p.isWallRunning, mw: mv.wallRunning, ps: p.isSliding, ms: mv.sliding, pm: p.isMantling, mm: mv.mantling });
    if (p.isGrappling !== p.grapple.attached) viol('grappleFlagMismatch', { ...snap(), isG: p.isGrappling, att: p.grapple.attached });
    if (mv.wallRunning && mv.grounded) viol('wallrunWhileGrounded', snap());
    if (mv.sliding && !mv.grounded) viol('slidingAirborne', snap());
    if (mv.sliding && p.grapple.attached) viol('slidingWhileGrappling', snap());
    if (!mv.mantling && Math.abs(p.height - (mv.crouched ? 1.15 : 1.8)) > 0.01) viol('heightMismatch', { ...snap(), crouched: mv.crouched });
    if (p.position.y < -8 || !bounds.containsPoint(p.position)) viol('outOfBounds', snap());
    if (p.grapple.attached) {
      const ch = new THREE.Vector3(p.position.x, p.position.y + p.height * 0.6, p.position.z);
      const d = ch.distanceTo(p.grapple.anchor);
      if (d > p.grapple.ropeLength + 0.6) viol('ropeStretch', { ...snap(), d: r2(d), rope: r2(p.grapple.ropeLength) });
    }
    // embedded in geometry?
    const hit = coll.capsuleIntersect(mv.capsule);
    if (hit && hit.depth > 0.08 && !mv.mantling) viol('embedded', { ...snap(), depth: r2(hit.depth) });
    if (p.grapple.state !== 'attached' && p.grapple.state !== 'idle' && p.grapple.state !== 'flying' && p.grapple.state !== 'retract') viol('badGrappleState', snap());
    const dcam = Math.hypot(cp.x - p.position.x, cp.y - (p.position.y + p.eyeHeight), cp.z - p.position.z);
    if (dcam > 0.8) viol('cameraFarFromEye', { ...snap(), dcam: r2(dcam), so: [r2(p.stepOffset.x), r2(p.stepOffset.y), r2(p.stepOffset.z)], alpha: r2(p._alpha), prev: [r2(p.prevPosition.x), r2(p.prevPosition.y), r2(p.prevPosition.z)], eye: r2(p.eyeHeight) });
    { const dpop = p.position.distanceTo(lastPos); const allow = (Math.hypot(p.velocity.x, p.velocity.y, p.velocity.z) + 9) * DT + 0.25;
      if (popSkip > 0) popSkip--; else if (dpop > allow && p.alive && !mv.mantling) viol('pop', { ...snap(), d: r2(dpop), allow: r2(allow), prev: [r2(lastPos.x), r2(lastPos.y), r2(lastPos.z)] });
      lastPos.copy(p.position); if (p._acc === 0 && false) popSkip = 0; }
    R.maxSpeed = Math.max(R.maxSpeed || 0, hs(p));
    const st = mv.state; R.states = R.states || {}; R.states[st] = (R.states[st] || 0) + 1;
    if (i % 600 === 0) await new Promise(r => setTimeout(r, 0));
  }
  releaseAll(game);
  R.simSeconds = SECONDS; R.dt = DT;
  report.done = true;
}
export function drive() {}

// Headless sweeps over the synthetic collision test map. Run:
//   python tools/run.py "index.html?autotest=1&mapfile=tools/out/collision/testmap.js&bots=0&god=1&duration=9999&scenario=tools/out/collision/sweep_synth.js" --report --timeout 300
// Optional query params: only=<spot name substring>, tags=air,ground,grapple,wallrun,tunnel
import * as THREE from 'three';
import { Detector, attempt, r2, R } from './lib.js';

const PI = Math.PI;
let gen = null;
let det = null;
const agg = new Map();
const outcomes = [];
const examples = [];
const rescueEx = [];
let attempts = 0;
let doneAt = 0;
let t0 = 0;

const key = (spot, lvl, tag) => `${spot.name} | ${lvl ? lvl.kind + '@' + lvl.y : '-'} | ${tag}`;

function record(spot, lvl, tag, cfg, res, extra = {}) {
  const k = key(spot, lvl, tag);
  let a = agg.get(k);
  if (!a) { a = { n: 0, mantle: 0, clip: 0, escape: 0, wallrun: 0, attach: 0, noMantleClip: 0 }; agg.set(k, a); }
  if (res.skipped) { a.skipped = (a.skipped || 0) + 1; outcomes.push('-'); return; }
  a.n++;
  attempts++;
  outcomes.push(res.mantled ? ((res.insideAny || res.insideEnd) ? 'C' : 'M') : '-');
  if (res.mantled) a.mantle++;
  if (res.wallrun) a.wallrun++;
  if (res.grappleAttached) a.attach++;
  const escaped = spot.escapeZ !== undefined && res.endPos[2] < spot.escapeZ;
  if (escaped) a.escape++;
  if (res.rescued) {
    a.rescued = (a.rescued || 0) + res.rescued;
    if (rescueEx.length < 40) rescueEx.push({ k, cfg: { pos: cfg.pos.map(r2), yaw: cfg.yaw, air: cfg.air, vel: cfg.vel, jumps: cfg.jumps, grappleAt: cfg.grappleAt, pitch: cfg.pitch, crouchFrom: cfg.crouchFrom, uncrouchAt: cfg.uncrouchAt, impulse: cfg.impulse && cfg.impulse.v }, mantled: res.mantled, info: res.rescueInfo });
  }
  if (res.insideAny || res.insideEnd) {
    a.clip++;
    if (!res.mantled) a.noMantleClip++;
    if (examples.length < 40 && !examples.some(e => e.k === k)) {
      examples.push({ k, cfg: { pos: cfg.pos, yaw: cfg.yaw, air: cfg.air, vel: cfg.vel, jumps: cfg.jumps, grappleAt: cfg.grappleAt, pitch: cfg.pitch }, res: { mantleT: res.mantleT, mantleFrom: res.mantleFrom, first: res.firstInside, end: res.endPos } });
    }
  }
  if (extra.sample && !a.sample) a.sample = extra.sample;
}

function* attempts_for(spot, tags) {
  const x = spot.x, front = spot.front;
  const levels = [...spot.seams.map(y => ({ y, kind: 'seam' })), ...spot.tops.map(y => ({ y, kind: 'top' }))];
  const post = spot.kind === 'border' ? 2.5 : 0;

  if (tags.has('air')) {
    for (const lvl of levels) {
      for (const dz of [2.25, 1.9, 1.5, 1.1, 0.8, 0.6]) {
        const fy = lvl.y - dz;
        if (fy < 0.05) continue;
        for (const d of [0.45, 0.8]) for (const lat of [-0.9, 0, 0.9]) for (const vz of [0, 6]) for (const yaw of [0, 0.5, -0.5]) {
          const vx = -Math.sin(yaw) * vz, vzz = -Math.cos(yaw) * vz;
          yield { spot, lvl, tag: 'air', cfg: { pos: [x + lat, fy, front + d], yaw, air: true, vel: [vx, 0, vzz], dur: 1.2, post, alwaysCheck: true } };
        }
      }
    }
  }
  if (tags.has('ground')) {
    for (const D of [1.0, 3.0, 6.0]) for (const lat of [-0.9, 0.3]) for (const tj of [0.0, 0.12, 0.25, 0.4]) for (const tdj of [null, 0.2, 0.35, 0.5]) {
      const jumps = [tj + 0.02];
      if (tdj !== null) jumps.push(tj + tdj);
      yield { spot, lvl: null, tag: 'ground', cfg: { pos: [x + lat, 0, front + 0.4 + D], yaw: 0, sprint: true, jumps, dur: 2.0, post, alwaysCheck: true } };
    }
  }
  if (tags.has('grapple')) {
    for (const lvl of levels) {
      for (const off of [-1.6, -0.9, -0.3, 0.3, 1.0]) {
        const ya = lvl.y + off;
        if (ya < 0.6) continue;
        for (const D of [8, 14]) for (const fwd of [true, false]) {
          const eyeY = 1.66;
          const pitch = Math.atan2(ya - eyeY, D);
          yield { spot, lvl, tag: 'grapple', cfg: { pos: [x, 0, front + D], yaw: 0, pitch, grappleAt: 0.05, fwdFrom: fwd ? 0 : 99, dur: 3.2, post, alwaysCheck: true } };
        }
      }
    }
  }
  if (tags.has('wallrun')) {
    for (const lvl of levels) {
      for (const dz of [1.9, 1.5, 1.2]) {
        const fy = lvl.y - dz;
        if (fy < 1.1) continue;
        for (const tj of [0.25, 0.4, 0.6]) for (const tr of [0.1, 0.2, 0.3]) {
          yield { spot, lvl, tag: 'wallrun', cfg: { pos: [x - (spot.kind === 'border' ? 26 : 2.5), fy, front + 0.45], yaw: -PI / 2, air: true, vel: [9.5, 0, 0], jumps: [tj], turns: [[tj + tr, 0.15]], dur: 1.8, post, alwaysCheck: true } };
        }
      }
    }
  }
  if (tags.has('tunnel') && (spot.kind === 'plain' || spot.kind === 'border')) {
    // sprint straight at the wall
    for (const lat of [0, 1.3]) for (const yaw of [0, 0.4, -0.4, 0.9]) {
      yield { spot, lvl: null, tag: 'tun_sprint', cfg: { pos: [x + lat, 0, front + 0.4 + 6], yaw, sprint: true, dur: 2.2, alwaysCheck: true } };
    }
    // slide boost into the wall
    for (const yaw of [0, 0.4]) {
      yield { spot, lvl: null, tag: 'tun_slide', cfg: { pos: [x, 0, front + 0.4 + 6], yaw, sprint: true, crouchFrom: 0.5, dur: 2.2, alwaysCheck: true } };
    }
    // rocket jump impulse (30 m/s) toward the wall from point blank, and 60 m/s
    for (const v of [22, 35, 60]) for (const up of [0, 12]) {
      yield { spot, lvl: null, tag: 'tun_rocket' + v, cfg: { pos: [x, 0, front + 0.45], yaw: 0, impulse: { t: 0.05, v: [0, up, -v] }, dur: 1.5, alwaysCheck: true } };
    }
    // grapple pull toward the wall face (anchor low)
    for (const off of [1.0, 2.5, 5]) for (const D of [10, 25]) {
      const pitch = Math.atan2(off - 1.66, D);
      yield { spot, lvl: null, tag: 'tun_grapple', cfg: { pos: [x, 0, front + D], yaw: 0, pitch, grappleAt: 0.05, dur: 3.2, alwaysCheck: true } };
    }
  }
  if (tags.has('legit') && spot.kind === 'legit') {
    const lg = spot.legit;
    if (lg.type === 'step') {
      for (const D of [1.5, 4]) for (const lat of [-1.5, 0, 1.5]) for (const yaw of [0, 0.3, -0.3]) for (const sprint of [false, true]) {
        yield { spot, lvl: null, tag: 'step', legitTop: lg.top, cfg: { pos: [x + lat, 0, front + 0.4 + D], yaw, sprint, dur: 1.6, alwaysCheck: true } };
      }
    }
    if (lg.type === 'crouch') {
      // walk in crouched under the slab, then release crouch: must stay crouched and outside the solid
      for (const lat of [-1, 0, 1]) {
        yield { spot, lvl: null, tag: 'crouch_release', legitCeiling: lg.ceilingY, cfg: { pos: [x + lat, 0, front + 1.5], yaw: 0, crouchFrom: 0, fwdTo: 1.0, dur: 2.6, uncrouchAt: 1.2, alwaysCheck: true } };
      }
    }
  }
  if (tags.has('tunnel') && spot.kind === 'slab') {
    // terminal velocity onto a 0.2 m slab
    for (const lat of [0, 2.5, 5.7]) for (const vy of [-30, -55]) {
      yield { spot, lvl: null, tag: 'tun_fall', cfg: { pos: [x + lat, 45, spot.z + lat * 0.3], yaw: 0, air: true, vel: [0, vy, 0], fwdFrom: 99, dur: 2.0, alwaysCheck: true }, slab: spot.slabY };
    }
  }
}

export async function setup(game, report) {
  det = new Detector(game);
  const spots = game.world.def.spots;
  const p = game.params;
  const only = p.get('only');
  const tags = new Set((p.get('tags') || 'air,ground,grapple,wallrun,tunnel').split(','));
  gen = (function* () {
    for (const spot of spots) {
      if (only && !spot.name.includes(only)) continue;
      yield* attempts_for(spot, tags);
    }
  })();
  report.custom = report.custom || {};
  report.custom.detector = { tris: det.count };
  t0 = performance.now();
}

export function drive(t, dt, game, report) {
  if (doneAt) return;
  const start = performance.now();
  while (performance.now() - start < 30) {
    const nx = gen.next();
    if (nx.done) {
      doneAt = performance.now();
      finalize(game, report);
      game.autotest.finish();
      return;
    }
    const a = nx.value;
    if (game.params.get('trace') && a.tag === game.params.get('trace') && (!game.params.get('tracelvl') || (a.lvl && a.lvl.y === Number(game.params.get('tracelvl')))) && !(report.custom.traces && report.custom.traces.length >= 3)) a.cfg.trace = 12;
    const res = attempt(game, det, a.cfg);
    if (a.cfg.trace) (report.custom.traces = report.custom.traces || []).push({ k: key(a.spot, a.lvl, a.tag), cfg: { pos: a.cfg.pos, yaw: a.cfg.yaw, vel: a.cfg.vel, jumps: a.cfg.jumps, turns: a.cfg.turns }, trace: res.trace, mantled: res.mantled, end: res.endPos });
    if (a.tag === 'step') {
      // success = ended standing ON the curb (feet at its top), not inside it
      // success = the feet reached the curb top at some point (the run continues across the 2 m deep curb and drops off)
      const ok = res.maxY >= a.legitTop - 0.03 && !res.insideAny && !res.insideEnd;
      const k = key(a.spot, null, 'step');
      const row = agg.get(k) || { n: 0, mantle: 0, clip: 0, escape: 0, wallrun: 0, attach: 0, noMantleClip: 0, stepOk: 0 };
      row.stepOk = (row.stepOk || 0) + (ok ? 1 : 0);
      agg.set(k, row);
    }
    if (a.tag === 'crouch_release') {
      const k = key(a.spot, null, 'crouch_release');
      const row = agg.get(k) || { n: 0, mantle: 0, clip: 0, escape: 0, wallrun: 0, attach: 0, noMantleClip: 0, crouchOk: 0 };
      // still crouched under the slab (height 1.15) at the end, and not inside anything
      row.crouchOk = (row.crouchOk || 0) + (res.endCrouched && res.endPos[2] < a.spot.front - 0.3 && res.endPos[2] > a.spot.front - 5.5 && !res.insideEnd ? 1 : 0);
      agg.set(k, row);
    }
    if (a.tag === 'tun_fall') {
      // fell through the slab?  (final y must be >= slab top)
      res.insideAny = res.insideAny || res.endPos[1] < a.slab - 0.05;
      (report.custom.falls = report.custom.falls || []).push({ pos: a.cfg.pos.map(r2), vel: a.cfg.vel, end: res.endPos, minY: r2(res.minY), slab: a.slab });
    }
    record(a.spot, a.lvl, a.tag, a.cfg, res);
  }
}

function finalize(game, report) {
  const rows = [];
  let clips = 0, mantles = 0, n = 0, esc = 0;
  for (const [k, a] of agg) {
    rows.push(`${k}: n=${a.n}${a.stepOk !== undefined ? ' stepOk=' + a.stepOk : ''}${a.crouchOk !== undefined ? ' crouchOk=' + a.crouchOk : ''} mantle=${a.mantle} CLIP=${a.clip}${a.noMantleClip ? '(nomantle ' + a.noMantleClip + ')' : ''}${a.escape ? ' ESCAPE=' + a.escape : ''}${a.rescued ? ' RESCUED=' + a.rescued : ''}${a.skipped ? ' skippedBuriedStart=' + a.skipped : ''}${a.wallrun ? ' wallrun=' + a.wallrun : ''}${a.attach ? ' attach=' + a.attach : ''}`);
    clips += a.clip; mantles += a.mantle; n += a.n; esc += a.escape;
  }
  const c = report.custom;
  const rescues = game.player.move.rescueCount;
  c.rescues = rescues === undefined ? null : rescues;
  c.summary = { attempts: n, mantles, clips, escapes: esc, seconds: +((doneAt - t0) / 1000).toFixed(1) };
  c.rows = rows;
  c.outcomes = outcomes.join('');
  c.examples = examples.slice(0, 12);
  c.rescueExamples = rescueEx;
}

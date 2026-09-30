// Headless air-mantle sweeps on the REAL maps. Finds every side of a box/container/crate/wall whose top has another
// solid sitting on / around it ("hidden seam"), and attacks each such face with airborne mantle attempts at several
// heights. Also attacks a sample of plain (no-seam) faces as controls, so the number of legitimate mantles can be
// compared before / after a fix.
//   python tools/run.py "index.html?autotest=1&map=foundry&bots=0&god=1&duration=9999&scenario=tools/out/collision/sweep_real.js" --report --timeout 500
import * as THREE from 'three';
import { Detector, attempt } from './lib.js';

let gen = null;
let det = null;
let coll = null;
let onlyFace = null, explain = false;
const why = {};
const explainRows = new Map();
const _o = new THREE.Vector3();
const _dn = new THREE.Vector3(0, -1, 0);
let doneAt = 0;
let t0 = 0;
const outcomes = [];
const rescueEx = [];
let rescueAttempts = 0;
const stats = { cands: 0, ctlCands: 0, attempts: 0, ctlAttempts: 0, seamMantles: 0, seamClips: 0, ctlMantles: 0, ctlClips: 0, escapes: 0 };
const clipSpots = new Map();
const faceStats = new Map();
const seamMantleFaces = new Set();
const ctlMantleFaces = new Set();

function obbOf(s, i) {
  if (!s || s.collide === false) return null;
  let cx, cy, cz, sx, sy, sz, rot = typeof s.rot === 'number' ? s.rot : 0;
  if (s.type === 'box') {
    if (s.min && s.max) {
      sx = s.max[0] - s.min[0]; sy = s.max[1] - s.min[1]; sz = s.max[2] - s.min[2];
      cx = (s.min[0] + s.max[0]) / 2; cy = (s.min[1] + s.max[1]) / 2; cz = (s.min[2] + s.max[2]) / 2;
    } else { [cx, cy, cz] = s.pos; [sx, sy, sz] = s.size; }
  } else if (s.type === 'container') {
    [cx, cy, cz] = s.pos; [sx, sy, sz] = s.size || [2.44, 2.6, 6.06];
  } else if (s.type === 'crate') {
    [cx, cy, cz] = s.pos;
    const z = s.size ?? 1.2;
    [sx, sy, sz] = Array.isArray(z) ? z : [z, z, z];
  } else if (s.type === 'wall') {
    const dx = s.to[0] - s.from[0], dz = s.to[1] - s.from[1];
    const h = s.height ?? 3, t = s.thickness ?? 0.5, y0 = s.y0 ?? 0;
    cx = (s.from[0] + s.to[0]) / 2; cz = (s.from[1] + s.to[1]) / 2; cy = y0 + h / 2;
    sx = Math.hypot(dx, dz); sy = h; sz = t; rot = Math.atan2(-dz, dx);
  } else return null;
  return { i, type: s.type, visible: s.visible !== false, cx, cy, cz, hx: sx / 2, hy: sy / 2, hz: sz / 2, rot, c: Math.cos(rot), s: Math.sin(rot), minY: cy - sy / 2, maxY: cy + sy / 2 };
}

/** local (lx, lz) of a world xz point relative to the OBB */
function toLocal(o, x, z) {
  const dx = x - o.cx, dz = z - o.cz;
  // local x axis = (c, -s), local z axis = (s, c)
  return [dx * o.c - dz * o.s, dx * o.s + dz * o.c];
}
function insideOBB(o, x, y, z, m = 0) {
  if (y < o.minY + m || y > o.maxY - m) return false;
  const [lx, lz] = toLocal(o, x, z);
  return Math.abs(lx) <= o.hx - m && Math.abs(lz) <= o.hz - m;
}
function insideAny(obbs, x, y, z, m = 0) {
  for (const o of obbs) if (insideOBB(o, x, y, z, m)) return o;
  return null;
}

function* candidates(obbs, control) {
  let n = 0;
  for (const A of obbs) {
    // the 4 sides: local +-x, +-z
    const sides = [
      { nx: A.c, nz: -A.s, half: A.hx, along: [A.s, A.c], L: A.hz },
      { nx: -A.c, nz: A.s, half: A.hx, along: [A.s, A.c], L: A.hz },
      { nx: A.s, nz: A.c, half: A.hz, along: [A.c, -A.s], L: A.hx },
      { nx: -A.s, nz: -A.c, half: A.hz, along: [A.c, -A.s], L: A.hx },
    ];
    for (const sd of sides) {
      for (const u of [-0.6, -0.15, 0.35, 0.7]) {
        const px = A.cx + sd.nx * sd.half + sd.along[0] * u * sd.L;
        const pz = A.cz + sd.nz * sd.half + sd.along[1] * u * sd.L;
        const y = A.maxY;
        // hidden seam: 0.3 m inside the face, just above the top, there is another solid
        const inner = insideAny(obbs, px - sd.nx * 0.3, y + 0.15, pz - sd.nz * 0.3);
        // and 1.8 m above, still inside (a real wall continues up, not a thin slab)
        const hasSeam = !!inner && inner !== A;
        // exposed: 0.6 m in front of the face at y-1 there is no solid
        if (insideAny(obbs, px + sd.nx * 0.6, y - 1.0, pz + sd.nz * 0.6)) continue;
        if (insideAny(obbs, px + sd.nx * 0.6, y + 0.3, pz + sd.nz * 0.6)) continue;
        if (control ? hasSeam : !hasSeam) continue;
        n++;
        if (control && n % 14 !== 0) continue;
        // how the inner solid sits relative to the face: where it starts behind the face (m) and how far above the ledge it reaches (m)
        let startsAt = null, reach = 0;
        if (inner) {
          for (let d = 0; d <= 1.5; d += 0.05) if (insideOBB(inner, px - sd.nx * d, y + 0.15, pz - sd.nz * d)) { startsAt = +d.toFixed(2); break; }
          for (let h = 0.15; h <= 3.2; h += 0.1) if (insideOBB(inner, px - sd.nx * 0.3, y + h, pz - sd.nz * 0.3)) reach = +h.toFixed(2); else if (h > 0.3) break;
        }
        yield { A, sd, px, pz, y, u, inner, startsAt, reach };
      }
    }
  }
}

function* attempts(cand, ground, obbs) {
  const { A, sd, px, pz, y } = cand;
  const yaw = Math.atan2(sd.nx, sd.nz);
  for (const dz of [2.25, 1.75, 1.25, 0.85, 0.6]) {
    const fy = y - dz;
    if (fy < ground - 0.01) continue;
    for (const d of [0.45, 0.8]) {
      const sx = px + sd.nx * d, sz = pz + sd.nz * d;
      // never start inside a solid (a teleport into geometry is a test artefact, not gameplay)
      if (insideAny(obbs, sx, fy + 0.4, sz) || insideAny(obbs, sx, fy + 0.9, sz) || insideAny(obbs, sx, fy + 1.4, sz)) continue;
      // (ramps, stairs, cylinders are not boxes: ask the independent brute-force detector too)
      if (det.inside(sx, fy + 0.4, sz) || det.inside(sx, fy + 0.9, sz) || det.inside(sx, fy + 1.4, sz)) continue;
      // a start point under the floor (the void below the map) is a test artefact, not a gameplay position: some
      // walkable surface must lie within 8 m below the feet
      _o.set(sx, fy + 0.5, sz);
      const fl = coll.raycast(_o, _dn, 8.5);
      if (!fl || fl.normal.y < 0.5) continue;
      for (const vz of [0, 5]) {
        yield { cand, cfg: { pos: [sx, fy, sz], yaw, air: true, vel: [-Math.sin(yaw) * vz, 0, -Math.cos(yaw) * vz], dur: 1.0, post: 0, checkEvery: 0 } };
      }
    }
  }
}

export async function setup(game, report) {
  det = new Detector(game);
  coll = game.world.collision;
  onlyFace = game.params.get('onlyFace');
  explain = !!game.params.get('explain');
  if (explain) {
    const mv = game.player.move;
    const orig = mv._tryMantle;
    mv._tryMantle = function (...a) { const r = orig.apply(this, a); if (!r && this.mantleWhy) why[this.mantleWhy] = (why[this.mantleWhy] || 0) + 1; return r; };
  }
  const solids = game.world.def.solids;
  const obbs = [];
  solids.forEach((s, i) => { const o = obbOf(s, i); if (o) obbs.push(o); });
  const ground = 0;
  const isSeamRun = (game.params.get('mode2') || 'both');
  gen = (function* () {
    if (isSeamRun !== 'ctl') for (const c of candidates(obbs, false)) { stats.cands++; for (const a of attempts(c, -50, obbs)) { a.kind = 'seam'; yield a; } }
    if (isSeamRun !== 'seam') for (const c of candidates(obbs, true)) { stats.ctlCands++; for (const a of attempts(c, -50, obbs)) { a.kind = 'ctl'; yield a; } }
  })();
  report.custom = report.custom || {};
  report.custom.detector = { tris: det.count, obbs: obbs.length };
  t0 = performance.now();
}

export function drive(t, dt, game, report) {
  if (doneAt) return;
  const start = performance.now();
  while (performance.now() - start < 30) {
    const nx = gen.next();
    if (nx.done) { doneAt = performance.now(); finalize(game, report); game.autotest.finish(); return; }
    const a = nx.value;
    if (onlyFace) {
      const fid = `${a.cand.A.type}#${a.cand.A.i}@${a.cand.px.toFixed(1)},${a.cand.pz.toFixed(1)},y${a.cand.y.toFixed(1)}`;
      if (!fid.includes(onlyFace)) { outcomes.push('-'); continue; }
    }
    if (explain) { for (const k in why) delete why[k]; }
    const res = attempt(game, det, a.cfg);
    if (explain && !res.mantled) {
      const fid = `${a.cand.A.type}#${a.cand.A.i}@${a.cand.px.toFixed(1)},${a.cand.pz.toFixed(1)},y${a.cand.y.toFixed(1)}`;
      const key = fid + ' | ' + Object.keys(why).filter(k => k !== 'no wall' && k !== 'not facing').sort().join(', ');
      explainRows.set(key, (explainRows.get(key) || 0) + 1);
    }
    const seam = a.kind === 'seam';
    if (seam) stats.attempts++; else stats.ctlAttempts++;
    if (res.rescued) {
      rescueAttempts++;
      if (rescueEx.length < 12) rescueEx.push({ face: `${a.cand.A.type}#${a.cand.A.i}@${a.cand.px.toFixed(1)},${a.cand.pz.toFixed(1)},y${a.cand.y.toFixed(1)}`, pos: a.cfg.pos.map(v => +v.toFixed(2)), yaw: +a.cfg.yaw.toFixed(3), vel: a.cfg.vel.map(v => +v.toFixed(2)), mantled: res.mantled, ...res.rescueInfo });
    }
    outcomes.push(res.mantled ? ((res.insideEnd || res.insideAny) ? 'C' : 'M') : '-');
    const face = `${a.cand.A.type}#${a.cand.A.i}@${a.cand.px.toFixed(1)},${a.cand.pz.toFixed(1)},y${a.cand.y.toFixed(1)}`;
    {
      let fs = faceStats.get(face);
      if (!fs) { fs = { face, kind: a.kind, n: 0, m: 0, c: 0, inner: a.cand.inner ? `${a.cand.inner.type}#${a.cand.inner.i}${a.cand.inner.visible ? '' : '(inv)'}` : null, startsAt: a.cand.startsAt, reach: a.cand.reach, ex: null }; faceStats.set(face, fs); }
      fs.n++;
      if (res.mantled) { fs.m++; if (!fs.ex) fs.ex = { from: res.mantleFrom, end: res.endPos.map(v => +v.toFixed(2)) }; }
      if (res.insideEnd || res.insideAny) fs.c++;
    }
    if (res.mantled) {
      if (seam) { stats.seamMantles++; seamMantleFaces.add(face); } else { stats.ctlMantles++; ctlMantleFaces.add(face); }
    }
    if (res.insideEnd || res.insideAny) {
      if (seam) stats.seamClips++; else stats.ctlClips++;
      const k = face;
      const rec = clipSpots.get(k) || { face: k, n: 0, kind: a.kind, inner: a.cand.inner ? `${a.cand.inner.type}#${a.cand.inner.i}${a.cand.inner.visible ? '' : '(invisible)'}` : null, ex: null };
      rec.n++;
      if (!rec.ex) rec.ex = { pos: a.cfg.pos, yaw: +a.cfg.yaw.toFixed(3), vel: a.cfg.vel.map(v => +v.toFixed(2)), mantleFrom: res.mantleFrom, end: res.endPos };
      clipSpots.set(k, rec);
    }
  }
}

function finalize(game, report) {
  // NOTE: the harness truncates the printed report at 60000 characters, so keep the important keys first and small
  const c = report.custom;
  const rescues = game.player.move.rescueCount;
  c.rescues = rescues === undefined ? null : rescues;
  c.rescueAttempts = rescueAttempts;
  c.rescueExamples = rescueEx;
  c.stats = { ...stats, seconds: +((doneAt - t0) / 1000).toFixed(1), seamFacesMantled: seamMantleFaces.size, ctlFacesMantled: ctlMantleFaces.size };
  c.clipSpotCount = clipSpots.size;
  c.seamAttempts = stats.attempts;
  window.__EXPLAIN__ = Array.from(explainRows.entries());
  window.__FACEROWS__ = Array.from(faceStats.values()).filter(f => f.m > 0 || f.c > 0).map(f => [f.face, f.kind, f.n, f.m, f.c, f.inner, f.startsAt, f.reach, f.ex && f.ex.end]);
  c.outcomes = outcomes.join('');
  c.clipSpots = Array.from(clipSpots.values()).sort((a, b) => b.n - a.n).slice(0, 25).map(r => ({ face: r.face, n: r.n, inner: r.inner, ex: r.ex && { pos: r.ex.pos.map(v => +v.toFixed(2)), end: r.ex.end } }));
}

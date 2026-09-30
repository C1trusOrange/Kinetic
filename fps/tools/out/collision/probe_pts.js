// Probe points: API isInside vs the independent brute-force detector, plus the closest collision triangles.
//   pts=x,y,z;x,y,z   (FEET positions; the capsule sphere centres y+0.4 / y+1.4 are tested)
import { Detector } from './lib.js';

let done = false;

export async function setup(game, report) {
  const det = new Detector(game);
  const coll = game.world.collision;
  const pts = (game.params.get('pts') || '').split(';').filter(Boolean).map(s => s.split(',').map(Number));
  const T = det.tri;
  const out = [];
  for (const f of pts) {
    const row = { feet: f, spheres: [] };
    for (const dy of [0.4, 1.4]) {
      const x = f[0], y = f[1] + dy, z = f[2];
      const api = coll.isInsideXYZ(x, y, z, 3);
      const apiFar = coll.isInsideXYZ(x, y, z, 12);
      const brute = det.inside(x, y, z);
      // closest triangles (by distance to the triangle's plane, restricted to those whose bbox is within 0.6 m)
      const near = [];
      for (let i = 0; i < det.count; i++) {
        const o = i * 9;
        let mnx = Math.min(T[o], T[o + 3], T[o + 6]), mxx = Math.max(T[o], T[o + 3], T[o + 6]);
        let mny = Math.min(T[o + 1], T[o + 4], T[o + 7]), mxy = Math.max(T[o + 1], T[o + 4], T[o + 7]);
        let mnz = Math.min(T[o + 2], T[o + 5], T[o + 8]), mxz = Math.max(T[o + 2], T[o + 5], T[o + 8]);
        if (x < mnx - 0.5 || x > mxx + 0.5 || y < mny - 0.5 || y > mxy + 0.5 || z < mnz - 0.5 || z > mxz + 0.5) continue;
        const e1 = [T[o + 3] - T[o], T[o + 4] - T[o + 1], T[o + 5] - T[o + 2]];
        const e2 = [T[o + 6] - T[o], T[o + 7] - T[o + 1], T[o + 8] - T[o + 2]];
        let nx = e1[1] * e2[2] - e1[2] * e2[1], ny = e1[2] * e2[0] - e1[0] * e2[2], nz = e1[0] * e2[1] - e1[1] * e2[0];
        const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
        const d = (x - T[o]) * nx + (y - T[o + 1]) * ny + (z - T[o + 2]) * nz;
        if (Math.abs(d) < 0.5) near.push({ d: +d.toFixed(3), n: [nx, ny, nz].map(v => +v.toFixed(2)), bb: [[mnx, mny, mnz], [mxx, mxy, mxz]].map(a => a.map(v => +v.toFixed(2))) });
      }
      near.sort((a, b) => Math.abs(a.d) - Math.abs(b.d));
      row.spheres.push({ y: +y.toFixed(2), api, apiFar, brute, nearTris: near.length, nearest: near.slice(0, 7) });
    }
    out.push(row);
  }
  report.custom = { points: out };
  done = true;
}

export function drive(t, dt, game, report) {
  if (done && !report.done) game.autotest.finish();
}

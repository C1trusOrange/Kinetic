// Scan a box of points around (cx, cy, cz): where does the API say "inside" while the independent brute-force detector says open air?
// Params: cx,cy,cz, half (m), step (m). Reports counts, the bounding box of the disagreements and the first rays' facing at one of them.
import { Detector } from './lib.js';
let done = false;
export async function setup(game, report) {
  const q = k => parseFloat(game.params.get(k));
  const cx = q('cx'), cy = q('cy'), cz = q('cz'), half = q('half') || 1, step = q('step') || 0.2;
  const det = new Detector(game);
  const coll = game.world.collision;
  const raw = [[0.61, 0.32, 0.72], [-0.44, -0.83, -0.35], [-0.79, 0.27, 0.55], [0.71, -0.29, -0.64], [-0.33, 0.52, -0.79], [0.09, -0.94, 0.33], [0.86, 0.18, -0.47], [-0.27, 0.91, 0.31]];
  let n = 0, fp = 0, fn = 0, both = 0;
  const bb = { min: [1e9, 1e9, 1e9], max: [-1e9, -1e9, -1e9] };
  let first = null;
  for (let x = cx - half; x <= cx + half + 1e-6; x += step) for (let y = cy - half; y <= cy + half + 1e-6; y += step) for (let z = cz - half; z <= cz + half + 1e-6; z += step) {
    n++;
    const a = coll.isInsideXYZ(x, y, z, 12), b = det.inside(x, y, z);
    if (a && b) both++;
    if (a && !b) {
      fp++;
      bb.min = [Math.min(bb.min[0], x), Math.min(bb.min[1], y), Math.min(bb.min[2], z)];
      bb.max = [Math.max(bb.max[0], x), Math.max(bb.max[1], y), Math.max(bb.max[2], z)];
      if (!first) first = { p: [x, y, z].map(v => +v.toFixed(2)), rays: raw.map(d => { const l = Math.hypot(...d); const t = coll._nearestFacing(x, y, z, d[0] / l, d[1] / l, d[2] / l, 12); return t < 0 ? 'miss' : ((coll._hitBack ? 'BACK@' : 'front@') + t.toFixed(2) + ' -> (' + [x + d[0] / l * t, y + d[1] / l * t, z + d[2] / l * t].map(v => v.toFixed(2)) + ')'); }) };
    }
    if (!a && b) fn++;
  }
  report.custom = { points: n, bothInside: both, apiOnly: fp, bruteOnly: fn, fpBox: fp ? bb : null, first };
  done = true;
}
export function drive(t, dt, game, report) { if (done && !report.done) game.autotest.finish(); }

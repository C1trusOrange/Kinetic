/**
 * Shared sub-assemblies used by several weapons: raked pistol grips, reflex/holo sights, rails.
 */
import { chamferPoly } from './ModelKit.js';
import { labelMaterial } from './WeaponMaterials.js';

/**
 * Geometry helper for a raked (tilted) grip. The grip axis passes through `axis` = [y, z] (root space, x = 0),
 * runs down and to the rear at angle `rake` (radians from vertical).
 * @param {number} rake
 * @param {number[]} axis [y, z] of the palm point
 */
export function gripFrame(rake, axis = [-0.04, 0]) {
  const s = Math.sin(rake), c = Math.cos(rake);
  const T = [0, -c, s];   // towards the heel (down + back)
  const V = [0, s, c];    // out of the back strap (up + back)
  const O = [0, axis[0], axis[1]];
  return {
    rake, T, V, O,
    /** Root-space point at grip-axis parameter t, lateral x and depth offset v (rear positive). */
    at(t, x = 0, v = 0) {
      return [x, O[1] + T[1] * t + V[1] * v, O[2] + T[2] * t + V[2] * v];
    },
    /** Side-profile polygon ([forward, up] pairs) of the grip between axis parameters t0..t1. */
    profile(t0, t1, halfDepth) {
      const a = this.at(t0, 0, -halfDepth), b = this.at(t1, 0, -halfDepth), c2 = this.at(t1, 0, halfDepth), d = this.at(t0, 0, halfDepth);
      return [a, b, c2, d].map(p => [-p[2], p[1]]);
    },
  };
}

/**
 * Pistol grip with knurled side panels.
 * @param {import('./ModelKit.js').ModelBuilder} b
 * @param {ReturnType<typeof gripFrame>} g
 * @param {{t0:number,t1:number,halfDepth:number,width:number,mat?:string,panel?:string}} o
 */
export function pistolGrip(b, g, o) {
  const mat = o.mat || 'poly';
  const prof = chamferPoly(g.profile(o.t0, o.t1, o.halfDepth), [0.006, 0.006, 0.006, 0.005]);
  b.ext(mat, prof, { width: o.width, bevel: 0.0024 });
  const inner = chamferPoly(g.profile(o.t0 + 0.012, o.t1 - 0.012, o.halfDepth - 0.0035), [0.004, 0.004, 0.004, 0.004]);
  const pw = 0.0034;
  b.ext(o.panel || 'grip', inner, { width: pw, cx: -(o.width / 2 + pw / 2 - 0.0012), bevel: 0.0007 });
  b.ext(o.panel || 'grip', inner, { width: pw, cx: (o.width / 2 + pw / 2 - 0.0012), bevel: 0.0007 });
}

/** Rectangular trigger guard (thin U-shaped extrusion). Coordinates in (forward, up). */
export function triggerGuard(b, f0, f1, yTop, yBot, thick = 0.006, width = 0.008, mat = 'polyGrey') {
  const t = thick;
  const outer = [[f0, yTop], [f0 + 0.004, yBot], [f1 - 0.004, yBot], [f1, yTop]];
  const inner = [[f1 - t, yTop], [f1 - t - 0.002, yBot + t], [f0 + t + 0.002, yBot + t], [f0 + t, yTop]];
  b.ext(mat, [...outer, ...inner], { width, bevel: 0.0014 });
}

/**
 * Holographic / reflex sight: a rectangular tube frame with a tinted glass window and a glowing ring reticle.
 * `sightPos` is the reticle centre [x, y, z].
 * @param {import('./ModelKit.js').ModelBuilder} b
 * @param {{x?:number, baseY:number, z:number, depth?:number, w?:number, h?:number, accent?:string}} o
 * @returns {number[]} sight point
 */
export function holoSight(b, o) {
  const x = o.x ?? 0;
  const depth = o.depth ?? 0.05, w = o.w ?? 0.04, h = o.h ?? 0.036, wall = 0.0042;
  const baseTop = o.baseY;
  const cy = baseTop + 0.004 + h / 2 - 0.0;
  const z = o.z;
  // mount
  b.box('steelBlack', [0.034, 0.008, depth + 0.02], [x, baseTop - 0.004, z], { bevel: 0.0018 });
  if (b.hi) {
    b.cube('steelDark', [0.036, 0.003, 0.006], [x, baseTop + 0.0015, z + depth / 2 + 0.006]);
    b.cube('steelDark', [0.036, 0.003, 0.006], [x, baseTop + 0.0015, z - depth / 2 - 0.006]);
  }
  // housing walls
  b.box('polyGrey', [wall, h, depth], [x - (w - wall) / 2, cy, z], { bevel: 0.0018 });
  b.box('polyGrey', [wall, h, depth], [x + (w - wall) / 2, cy, z], { bevel: 0.0018 });
  b.box('polyGrey', [w, wall, depth], [x, cy + (h - wall) / 2, z], { bevel: 0.0018 });
  b.box('polyGrey', [w, wall, depth], [x, cy - (h - wall) / 2, z], { bevel: 0.0018 });
  // window
  const ww = w - 2 * wall, wh = h - 2 * wall;
  b.decal('lens', [ww, wh], [x, cy, z - 0.0005], { face: 'back' });
  b.decal('reticleRing', [0.028, 0.028], [x, cy, z - 0.001], { face: 'back' });
  // accent strips + label
  const acc = o.accent || 'glowCyan';
  b.cube(acc, [0.0012, 0.004, depth * 0.6], [x - w / 2 - 0.0004, cy, z]);
  b.cube(acc, [0.0012, 0.004, depth * 0.6], [x + w / 2 + 0.0004, cy, z]);
  b.cube('void', [w * 0.6, 0.0012, 0.008], [x, cy + h / 2 + 0.0004, z + depth / 2 - 0.02]);
  if (b.hi) b.decal(labelMaterial('holo-tag', 'HX-2', { w: 128, h: 32, size: 22, color: '#dfe6ec', spacing: 2 }), [0.02, 0.005], [x - w / 2 - 0.0009, cy - 0.011, z + 0.012]);
  return [x, cy, z];
}

/**
 * Hex-head screws on a flat side (view models only). `side` -1 = left face (-X), +1 = right face (+X).
 * @param {import('./ModelKit.js').ModelBuilder} b
 * @param {number[][]} points [x, y, z] of the surface point for each screw (x = the face plane)
 * @param {number} side
 */
export function screws(b, points, side = -1, r = 0.0021) {
  if (!b.hi) return;
  for (const p of points) b.cyl('steelDark', { r, len: 0.0016, axis: 'x', pos: [p[0] + side * 0.0004, p[1], p[2]], seg: 5 });
}

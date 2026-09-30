// OBB helpers for box-like solids of a map definition (used by the real-map scenarios)
export function obbOf(s, i) {
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
export function toLocal(o, x, z) {
  const dx = x - o.cx, dz = z - o.cz;
  // local x axis = (c, -s), local z axis = (s, c)
  return [dx * o.c - dz * o.s, dx * o.s + dz * o.c];
}
export function insideOBB(o, x, y, z, m = 0) {
  if (y < o.minY + m || y > o.maxY - m) return false;
  const [lx, lz] = toLocal(o, x, z);
  return Math.abs(lx) <= o.hx - m && Math.abs(lz) <= o.hz - m;
}
export function insideAny(obbs, x, y, z, m = 0) {
  for (const o of obbs) if (insideOBB(o, x, y, z, m)) return o;
  return null;
}


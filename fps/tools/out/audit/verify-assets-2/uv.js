import { createWeaponModel, createRocketModel, createGrenadeModel } from '/src/weapons/WeaponModels.js';
import { ModelBuilder } from '/src/weapons/models/ModelKit.js';
import { UV_SCALE, DEFAULT_UV_SCALE } from '/src/weapons/models/WeaponMaterials.js';
export function setup(game, report) {
  const out = {};
  const analyse = (geo, su) => {
    const pos = geo.attributes.position, uv = geo.attributes.uv, idx = geo.index;
    const n = idx ? idx.count : pos.count; let bad = 0, tris = 0, worst = 0, area = 0, badArea = 0;
    const P = i => [pos.getX(i), pos.getY(i), pos.getZ(i)], U = i => [uv.getX(i), uv.getY(i)];
    for (let t = 0; t < n; t += 3) {
      const ids = [0, 1, 2].map(k => idx ? idx.getX(t + k) : t + k);
      let ratio = 0;
      for (const [a, b] of [[0, 1], [1, 2], [2, 0]]) {
        const p = P(ids[a]), q = P(ids[b]); const d3 = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
        const u = U(ids[a]), w = U(ids[b]); const d2 = Math.hypot(u[0] - w[0], u[1] - w[1]) * su;
        if (d3 > 1e-5) ratio = Math.max(ratio, d2 / d3);
      }
      const p0 = P(ids[0]), p1 = P(ids[1]), p2 = P(ids[2]);
      const e1 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]], e2 = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
      const cx = e1[1] * e2[2] - e1[2] * e2[1], cy = e1[2] * e2[0] - e1[0] * e2[2], cz = e1[0] * e2[1] - e1[1] * e2[0];
      const ar = 0.5 * Math.hypot(cx, cy, cz);
      tris++; area += ar; if (ratio > 2.5) { bad++; badArea += ar; } worst = Math.max(worst, ratio);
    }
    return { tris, bad, worst: +worst.toFixed(1), areaPct: +(100 * badArea / Math.max(area, 1e-9)).toFixed(1) };
  };
  // primitive: cyl with different seg counts
  for (const seg of [8, 10, 12, 14]) {
    const b = new ModelBuilder({ hi: true });
    b.cyl('paintOlive', { r: 0.05, len: 0.4, seg, axis: 'z' });
    const tpl = b.build();
    const m = tpl.parts.body.meshes[0];
    out['cyl_seg' + seg] = analyse(m.geometry, UV_SCALE.paintOlive);
  }
  const collect = (root, tag) => { root.traverse(o => { if (o.isMesh) { const key = o.name.split(':').slice(1).join(':'); const su = UV_SCALE[key] || DEFAULT_UV_SCALE; const a = analyse(o.geometry, su); if (a.bad) out[tag + '/' + o.name] = a; } }); };
  collect(createGrenadeModel(), 'grenade');
  collect(createRocketModel(), 'rocketProj');
  for (const id of ['pistol', 'rifle', 'shotgun', 'sniper', 'rocket']) { collect(createWeaponModel(id, { view: true }).root, id + ':view'); collect(createWeaponModel(id, { view: false }).root, id + ':world'); }
  report.custom = out;
}
export function drive() {}

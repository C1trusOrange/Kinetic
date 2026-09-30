// Synthetic collision test map: a row of "spots", each a stacked-solid configuration that used to let the
// player mantle into the hidden seam between two layers. Every spot faces +Z (the player approaches from +Z,
// looking toward -Z, yaw 0). `spots` (extra field, ignored by World) carries the metadata the scenarios use.
//
// Legend per spot: seams = horizontal layer boundaries (y) that are inside the visible solid,
//                  tops   = walkable ledge tops the player may legitimately mantle onto (y).

const solids = [];
const add = s => { solids.push(s); return s; };
const box = (x0, y0, z0, x1, y1, z1, o = {}) => add({ type: 'box', min: [x0, y0, z0], max: [x1, y1, z1], ...o });

const Z0 = -20;          // centre z of every spot
const HD = 1.22;         // half depth of a container
const HL = 3.03;         // half length of a container
let cursor = -250;

// ---- ground + enclosure
box(-260, -5, -70, 330, 0, 70, { mat: 'concrete_floor', top: 'concrete_floor' });
box(-261, -5, -71, 331, 60, -70, { mat: 'concrete_dark' });
box(-261, -5, 70, 331, 60, 71, { mat: 'concrete_dark' });
box(-261, -5, -70, -260, 60, 70, { mat: 'concrete_dark' });
box(330, -5, -70, 331, 60, 70, { mat: 'concrete_dark' });

const spots = [];
let n = 0;
function spot(name, seams, tops, front, build, extra = {}) {
  const w = extra.hw ?? 3.6;
  const x = cursor + w;
  cursor = x + w + 3;
  n++;
  build(x);
  spots.push({ name, x, z: Z0, front, dir: [0, 1], seams, tops, ...extra });
}
const cont = (x, y, z, rot = Math.PI / 2, color = 'red') => add({ type: 'container', pos: [x, y, z], rot, color });

// 1. two containers, equal footprint (the classic)
spot('cont2_equal', [2.6], [5.2], Z0 + HD, x => {
  cont(x, 1.3, Z0, Math.PI / 2, 'blue');
  cont(x, 3.9, Z0, Math.PI / 2, 'red');
});
// 2-4. upper solid set back from the front face
for (const [nm, sb] of [['setback_0.20', 0.2], ['setback_0.45', 0.45], ['setback_1.00', 1.0]]) {
  spot('box2_' + nm, [2.6], sb >= 0.9 ? [2.6, 5.2] : [5.2], Z0 + HD, x => {
    box(x - HL, 0, Z0 - HD, x + HL, 2.6, Z0 + HD, { mat: 'container_blue' });
    box(x - HL, 2.6, Z0 - HD, x + HL, 5.2, Z0 + HD - sb, { mat: 'container_red' });
  });
}
// 5. overhang: the upper solid sticks out 0.3 m past the lower one
spot('box2_overhang_0.30', [2.6], [5.2], Z0 + HD, x => {
  box(x - HL, 0, Z0 - HD, x + HL, 2.6, Z0 + HD, { mat: 'container_blue' });
  box(x - HL, 2.6, Z0 - HD, x + HL, 5.2, Z0 + HD + 0.3, { mat: 'container_red' });
});
// 6. rotated upper solid
spot('box2_rot25', [2.6], [5.2], Z0 + HD, x => {
  box(x - HL, 0, Z0 - HD, x + HL, 2.6, Z0 + HD, { mat: 'container_blue' });
  add({ type: 'box', pos: [x, 3.9, Z0], size: [2 * HL, 2.6, 2 * HD], rot: 0.436, mat: 'container_red' });
});
// 7. three crates high (1.2 m cubes)
spot('crate3_equal', [1.2, 2.4], [3.6], Z0 + 0.6, x => {
  for (let k = 0; k < 3; k++) add({ type: 'crate', pos: [x, 0.6 + k * 1.2, Z0], size: 1.2 });
});
// 8. two crates, upper one shifted sideways 0.15
spot('crate2_shift', [1.2], [2.4], Z0 + 0.6, x => {
  add({ type: 'crate', pos: [x, 0.6, Z0], size: 1.2 });
  add({ type: 'crate', pos: [x + 0.15, 1.8, Z0], size: 1.2 });
});
// 9. foundry-style border wall: 1 m thick lower part, upper part, invisible extension (bigger footprint)
spot('border_foundry', [6, 16], [], Z0 + 0.5, x => {
  box(x - 30, 0, Z0 - 0.5, x + 30, 6, Z0 + 0.5, { mat: 'concrete_dark' });
  box(x - 30, 6, Z0 - 0.5, x + 30, 16, Z0 + 0.5, { mat: 'metal_corrugated' });
  box(x - 31, 16, Z0 - 1.5, x + 31, 36, Z0 + 0.5, { visible: false });
}, { escapeZ: Z0 - 3, kind: 'border', hw: 31 });
// 10. skyline-style border: invisible volume overlaps the top 0.5 m of the visible wall
spot('border_skyline', [5.6, 14.5], [], Z0 + 0.5, x => {
  box(x - 30, 0, Z0 - 0.5, x + 30, 5.6, Z0 + 0.5, { mat: 'brick_dark' });
  box(x - 30, 5.6, Z0 - 0.5, x + 30, 15, Z0 + 0.5, { mat: 'concrete' });
  box(x - 31, 14.5, Z0 - 4.5, x + 31, 42, Z0 + 0.5, { visible: false });
}, { escapeZ: Z0 - 6, kind: 'border', hw: 31 });
// 11. building shell: base band + body with identical footprint (skyline)
spot('building_shell', [3.2], [9.6], Z0 + 3, x => {
  box(x - 10, -1, Z0 - 3, x + 10, 3.2, Z0 + 3, { mat: 'brick_dark' });
  box(x - 10, 3.2, Z0 - 3, x + 10, 9.6, Z0 + 3, { mat: 'concrete', top: 'roof_gravel', bottom: 'brick_dark' });
}, { hw: 10.5 });
// 12. building shell with a parapet wall on the roof (third layer)
spot('building_parapet', [3.2, 9.6], [10.6], Z0 + 3, x => {
  box(x - 10, -1, Z0 - 3, x + 10, 3.2, Z0 + 3, { mat: 'brick_dark' });
  box(x - 10, 3.2, Z0 - 3, x + 10, 9.6, Z0 + 3, { mat: 'concrete', top: 'roof_gravel', bottom: 'brick_dark' });
  box(x - 10, 9.6, Z0 + 2.6, x + 10, 10.6, Z0 + 3, { mat: 'concrete' });
}, { hw: 10.5 });
// ---- controls: single solids, legitimate mantles that must keep working
spot('ctl_single_container', [], [2.6], Z0 + HD, x => {
  cont(x, 1.3, Z0, Math.PI / 2, 'green');
});
spot('ctl_crate1', [], [1.2], Z0 + 0.6, x => {
  add({ type: 'crate', pos: [x, 0.6, Z0], size: 1.2 });
});
spot('ctl_crate2_stack', [1.2], [2.4], Z0 + 0.6, x => {
  add({ type: 'crate', pos: [x, 0.6, Z0], size: 1.2 });
  add({ type: 'crate', pos: [x, 1.8, Z0], size: 1.2 });
});
spot('ctl_wall_1.8', [], [1.8], Z0 + 0.5, x => {
  box(x - 6, 0, Z0 - 0.5, x + 6, 1.8, Z0 + 0.5, { mat: 'concrete' });
}, { hw: 6.5 });
spot('ctl_thin_wall_2.0', [], [2.0], Z0 + 0.15, x => {
  box(x - 6, 0, Z0 - 0.15, x + 6, 2.0, Z0 + 0.15, { mat: 'concrete' });
}, { hw: 6.5 });
// tall thin plain wall for tunnelling attempts (no seams at all)
spot('plain_wall_0.30', [], [], Z0 + 0.15, x => {
  box(x - 30, 0, Z0 - 0.15, x + 30, 12, Z0 + 0.15, { mat: 'concrete' });
}, { kind: 'plain', escapeZ: Z0 - 1, hw: 30.5 });
spot('plain_wall_0.12', [], [], Z0 + 0.06, x => {
  box(x - 30, 0, Z0 - 0.06, x + 30, 12, Z0 + 0.06, { mat: 'concrete' });
}, { kind: 'plain', escapeZ: Z0 - 1, hw: 30.5 });

// ---- step-up / crouch controls (kind: 'legit')
spot('step_curb_0.30', [], [], Z0 + 1, x => {
  box(x - 6, 0, Z0 - 1, x + 6, 0.3, Z0 + 1, { mat: 'concrete' });
}, { kind: 'legit', legit: { type: 'step', top: 0.3 }, hw: 6.5 });
spot('step_curb_0.45', [], [], Z0 + 1, x => {
  box(x - 6, 0, Z0 - 1, x + 6, 0.45, Z0 + 1, { mat: 'concrete' });
}, { kind: 'legit', legit: { type: 'step', top: 0.45 }, hw: 6.5 });
spot('step_stacked_0.22x2', [0.22], [], Z0 + 1, x => {
  box(x - 6, 0, Z0 - 1, x + 6, 0.22, Z0 + 1, { mat: 'concrete' });
  box(x - 6, 0.22, Z0 - 1, x + 6, 0.44, Z0 + 1, { mat: 'concrete_dark' });
}, { kind: 'legit', legit: { type: 'step', top: 0.44 }, hw: 6.5 });
spot('step_crate_0.5', [], [], Z0 + 0.6, x => {
  add({ type: 'crate', pos: [x, 0.25, Z0], size: [1.2, 0.5, 1.2] });
}, { kind: 'legit', legit: { type: 'step', top: 0.5 }, hw: 3.6 });
// low ceiling slab (0.2 thick) at 1.5 m: crouching under it, then releasing crouch must NOT stand up into it
spot('crouch_under_1.5', [], [], Z0 + 3, x => {
  box(x - 4, 1.5, Z0 - 3, x + 4, 1.7, Z0 + 3, { mat: 'metal_grate' });
  box(x - 4, 1.7, Z0 - 3, x - 3.6, 6, Z0 + 3, { mat: 'concrete' });
  box(x + 3.6, 1.7, Z0 - 3, x + 4, 6, Z0 + 3, { mat: 'concrete' });
}, { kind: 'legit', legit: { type: 'crouch', ceilingY: 1.5 }, hw: 4.5 });

// a thin 0.2 m floor slab high above the ground (fast-fall tunnelling test) at x of the last spot + 14
{
  const x = cursor + 7;
  box(x - 6, 20, Z0 - 6, x + 6, 20.2, Z0 + 6, { mat: 'metal_grate' });
  spots.push({ name: 'thin_slab_20', x, z: Z0, front: Z0, dir: [0, 1], seams: [], tops: [], kind: 'slab', slabY: 20.2 });
  n++;
}

const lights = [
  { pos: [-60, 14, 0], color: '#fff2dc', intensity: 40, distance: 60 },
  { pos: [60, 14, 0], color: '#fff2dc', intensity: 40, distance: 60 },
];

export default {
  id: 'colltest',
  name: 'Collision Test',
  subtitle: 'Synthetic',
  description: 'Synthetic stacked-solid test map.',
  colors: ['#333', '#888'],
  bounds: { min: [-260, -6, -70], max: [331, 60, 70] },
  killY: -40,
  previewCamera: { pos: [0, 30, 60], lookAt: [0, 2, -20] },
  theme: {
    sky: { top: '#2f6fd0', horizon: '#c2dbf2', bottom: '#59606a', sunColor: '#fff0d0', sunSize: 1.1, stars: false, clouds: 0.2 },
    sun: { dir: [-0.38, 0.8, 0.46], color: '#fff0dc', intensity: 2.7 },
    hemi: { sky: '#d6e2f2', ground: '#5c5040', intensity: 0.7 },
    fog: { color: '#c7dcf0', near: 150, far: 500 },
    exposure: 1.0,
    envIntensity: 0.55,
    bloom: { strength: 0.2, radius: 0.4, threshold: 0.9 },
  },
  solids,
  lights,
  spawns: [
    { pos: [0, 0, 40], yaw: 0 }, { pos: [10, 0, 40], yaw: 0 }, { pos: [20, 0, 40], yaw: 0 }, { pos: [30, 0, 40], yaw: 0 },
    { pos: [-10, 0, 40], yaw: 0 }, { pos: [-20, 0, 40], yaw: 0 }, { pos: [-30, 0, 40], yaw: 0 }, { pos: [-40, 0, 40], yaw: 0 },
  ],
  pickups: [],
  jumpPads: [],
  spots,
};

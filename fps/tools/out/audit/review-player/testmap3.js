import sandbox from '../../../../src/world/maps/sandbox.js';
// grid of "ledge + overhead slab" cells: tall floor box (top at H) with a slab above at clearance c, thickness t
const solids = [];
const add = s => solids.push(s);
add({ type: 'box', min: [-60, -5, -60], max: [60, 0, 60], mat: 'concrete' });
export const cells = [];
let n = 0;
for (let ix = 0; ix < 8; ix++) for (let iz = 0; iz < 8; iz++) {
  const x0 = -50 + ix * 12, z0 = -50 + iz * 12;
  const H = [0.6, 1.2, 1.5, 2.0][n % 4];
  const clear = 1.2 + (Math.floor(n / 4) % 6) * 0.1;      // 1.2 .. 1.7
  const thick = [0.3, 0.9, 1.5][Math.floor(n / 24) % 3];
  const wide = (n % 3) === 0 ? 2 : 0;                     // slab footprint larger than the ledge?
  add({ type: 'box', min: [x0, 0, z0], max: [x0 + 6, H, z0 + 6], mat: 'concrete' });
  add({ type: 'box', min: [x0 - wide, H + clear, z0 - wide], max: [x0 + 6 + wide, H + clear + thick, z0 + 6 + wide], mat: 'metal_dark' });
  cells.push({ x: x0 + 3, z: z0 + 3, H, clear, thick, wide });
  n++;
}
export default {
  ...sandbox,
  id: 'testmap3', name: 'Test3', bounds: { min: [-60, -6, -60], max: [60, 40, 60] }, killY: -20,
  solids, lights: [], pickups: [], jumpPads: [],
  spawns: [{ pos: [-58, 0, 58], yaw: 0 }, { pos: [58, 0, 58], yaw: 0 }, { pos: [58, 0, -58], yaw: 0 }, { pos: [-58, 0, -58], yaw: 0 }],
};

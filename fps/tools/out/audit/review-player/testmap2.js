import sandbox from '../../../../src/world/maps/sandbox.js';
// grid of small "rooms": separate floor box + separate ceiling slab at various clearances, some with floor added after the ceiling
const solids = [];
const add = s => solids.push(s);
add({ type: 'box', min: [-60, -5, -60], max: [60, -0.5, 60], mat: 'concrete' });        // deep base (top at -0.5) so per-room floors are separate solids
export const rooms = [];
let n = 0;
for (let ix = 0; ix < 8; ix++) for (let iz = 0; iz < 6; iz++) {
  const x0 = -50 + ix * 12, z0 = -40 + iz * 12;
  const clear = 1.3 + (n % 5) * 0.1;          // 1.3 .. 1.7
  const floorFirst = n % 2 === 0;
  const thick = 0.3 + (n % 3) * 0.6;          // ceiling thickness 0.3 / 0.9 / 1.5
  const floor = { type: 'box', min: [x0, -0.5, z0], max: [x0 + 6, 0, z0 + 6], mat: 'concrete_floor' };
  const ceil = { type: 'box', min: [x0, clear, z0], max: [x0 + 6, clear + thick, z0 + 6], mat: 'metal_dark' };
  if (floorFirst) { add(floor); add(ceil); } else { add(ceil); add(floor); }
  rooms.push({ x: x0 + 3, z: z0 + 3, clear, floorFirst, thick });
  n++;
}
export default {
  ...sandbox,
  id: 'testmap2', name: 'Test2', bounds: { min: [-60, -6, -60], max: [60, 40, 60] }, killY: -20,
  solids, lights: [], pickups: [], jumpPads: [],
  spawns: [{ pos: [-58, 0, 58], yaw: 0 }, { pos: [58, 0, 58], yaw: 0 }, { pos: [58, 0, -58], yaw: 0 }, { pos: [-58, 0, -58], yaw: 0 }],
};

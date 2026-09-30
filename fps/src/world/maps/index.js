// Map registry. Each map module default-exports a map definition (see ARCHITECTURE.md "Map format").
import foundry from './foundry.js';
import skyline from './skyline.js';
import ruins from './ruins.js';
import stratos from './stratos.js';
import aerie from './aerie.js';
import sandbox from './sandbox.js';

/** Maps in menu order. */
export const MAPS = [foundry, skyline, ruins, stratos, aerie, sandbox];

export function getMap(id) {
  return MAPS.find(m => m.id === id) || null;
}

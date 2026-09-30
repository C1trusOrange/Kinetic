import { MAPS } from '/src/world/maps/index.js';
import * as THREE from 'three';

function census(g) {
  const info = g.renderer.info;
  let lights = 0, meshes = 0, instanced = 0, groups = 0, lightList = [];
  g.scene.traverse(o => {
    if (o.isLight) { lights++; lightList.push(o.type); }
    if (o.isInstancedMesh) instanced++;
    else if (o.isMesh) meshes++;
    if (o.isGroup) groups++;
  });
  return {
    geos: info.memory.geometries, tex: info.memory.textures,
    programs: info.programs ? info.programs.length : null,
    lights, lightList: lightList.join(','), meshes, instanced, groups,
    sceneChildren: g.scene.children.length,
    bg: g.scene.background ? 'set' : 'null', env: g.scene.environment ? 'set' : 'null', fog: g.scene.fog ? g.scene.fog.type : 'null',
  };
}

export async function setup(g, r) {
  r.custom = {};
  const C = r.custom;
  C.initial = census(g);
  C.seq = [];
  const order = ['foundry', 'ruins', 'skyline', 'sandbox', 'foundry', 'ruins', 'skyline', 'sandbox', 'foundry'];
  g.state = 'loading'; // simulate the menu -> loading flow (no world.update during load)
  for (const id of order) {
    const def = MAPS.find(m => m.id === id);
    const t0 = performance.now();
    await g.world.load(def);
    g._syncViewLighting();
    // let a couple frames render so GL resources are created
    await new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
    const c = census(g);
    c.id = id; c.ms = Math.round(performance.now() - t0);
    c.warn = g.world.warnings.length;
    c.tris = g.world.collision.triangleCount;
    C.seq.push(c);
  }
  C.warnings = {};
  for (const id of ['foundry', 'ruins', 'skyline', 'sandbox']) {
    const def = MAPS.find(m => m.id === id);
    await g.world.load(def);
    C.warnings[id] = { list: g.world.warnings.slice(), stats: g.world.stats, nav: g.world.nav.stats };
  }
  await g.world.load(MAPS.find(m => m.id === 'sandbox'));
  g.state = 'playing';
}
export function drive() {}

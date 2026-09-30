// Draw-call / triangle attribution by subtractive toggling of scene groups.
import * as THREE from 'three';
let shadowAcc = null;
function installShadowWrap(game) {
  const sm = game.renderer.shadowMap;
  const orig = sm.render.bind(sm);
  sm.render = function (lights, scene, camera) {
    const info = game.renderer.info;
    const c0 = info.render.calls, t0 = info.render.triangles;
    const r = orig(lights, scene, camera);
    if (shadowAcc) { shadowAcc.calls += info.render.calls - c0; shadowAcc.tris += info.render.triangles - t0; }
    return r;
  };
}
function measureWorld(game, rt) {
  const r = game.renderer, info = r.info;
  shadowAcc = { calls: 0, tris: 0 };
  const prev = r.getRenderTarget();
  r.setRenderTarget(rt);
  r.clear();
  info.reset();
  r.render(game.scene, game.camera);
  const total = { calls: info.render.calls, tris: info.render.triangles };
  const out = { main: { calls: total.calls - shadowAcc.calls, tris: total.tris - shadowAcc.tris }, shadow: { calls: shadowAcc.calls, tris: shadowAcc.tris } };
  shadowAcc = null;
  r.setRenderTarget(prev);
  return out;
}
function measureView(game, rt) {
  const r = game.renderer, info = r.info;
  const prev = r.getRenderTarget();
  r.setRenderTarget(rt);
  info.reset();
  r.render(game.viewScene, game.viewCamera);
  const out = { calls: info.render.calls, tris: info.render.triangles };
  r.setRenderTarget(prev);
  return out;
}
function countObjs(root) {
  let meshes = 0, tris = 0;
  root.traverse(o => {
    if (o.isMesh || o.isPoints || o.isLine || o.isSprite) {
      meshes++;
      const g = o.geometry;
      if (g && g.attributes && g.attributes.position) {
        const n = g.index ? g.index.count / 3 : g.attributes.position.count / 3;
        tris += n * (o.isInstancedMesh ? o.count : 1);
      }
    }
  });
  return { meshes, tris: Math.round(tris) };
}
function attribute(game, label) {
  const r = game.renderer;
  const rt = game.composer ? game.composer.renderTarget1 : new THREE.WebGLRenderTarget(64, 64);
  const base = measureWorld(game, rt);
  const groups = [];
  const world = game.world;
  const scene = game.scene;
  // top-level scene children (excluding lights/camera) and map subgroups
  const push = (name, obj) => groups.push({ name, obj });
  for (const c of scene.children) {
    if (c.isLight || c.isCamera) continue;
    if (c === world.group) {
      for (const cc of c.children) {
        if (cc.isLight || cc.isObject3D && cc.type === 'Object3D') continue;
        push('map/' + (cc.name || cc.type), cc);
      }
    } else if (c.name === 'BotModel') {
      push('bot', c);
    } else if (c.name && c.name.startsWith('gib_')) {
      push('gibs', c);
    } else {
      push(c.name || ('scene/' + c.type + (c.isInstancedMesh ? '[inst]' : '')), c);
    }
  }
  // merge same-name groups by toggling all together
  const byName = new Map();
  for (const g of groups) { if (!byName.has(g.name)) byName.set(g.name, []); byName.get(g.name).push(g.obj); }
  const rows = [];
  for (const [name, objs] of byName) {
    const vis = objs.map(o => o.visible);
    for (const o of objs) o.visible = false;
    const m = measureWorld(game, rt);
    objs.forEach((o, i) => { o.visible = vis[i]; });
    const cnt = objs.reduce((a, o) => { const c = countObjs(o); a.meshes += c.meshes; a.tris += c.tris; return a; }, { meshes: 0, tris: 0 });
    rows.push({
      name, n: objs.length, sceneMeshes: cnt.meshes, sceneTris: cnt.tris,
      mainCalls: base.main.calls - m.main.calls, mainTris: base.main.tris - m.main.tris,
      shadowCalls: base.shadow.calls - m.shadow.calls, shadowTris: base.shadow.tris - m.shadow.tris,
    });
  }
  rows.sort((a, b) => (b.mainCalls + b.shadowCalls) - (a.mainCalls + a.shadowCalls));
  const view = measureView(game, rt);
  // full composer frame for post-processing share
  let full = null;
  if (game.composer) {
    shadowAcc = { calls: 0, tris: 0 };
    r.info.reset();
    game.composer.render(0.016);
    full = { calls: r.info.render.calls, tris: r.info.render.triangles, shadowCalls: shadowAcc.calls, shadowTris: shadowAcc.tris };
    shadowAcc = null;
  }
  const map = world.stats || {};
  return {
    label, base, view, full,
    postCalls: full ? full.calls - full.shadowCalls - base.main.calls - view.calls : null,
    mapStats: { drawCalls: map.drawCalls, triangles: map.triangles, solids: map.solids, collisionTriangles: map.collisionTriangles, materials: map.materials },
    rows,
    pixelRatio: r.getPixelRatio(), size: r.getSize(new THREE.Vector2()).toArray(),
    liveBots: game.bots.list.filter(b => b.alive).length,
  };
}
export function setup(game, report) {
  report.custom = { snaps: [] };
  installShadowWrap(game);
}
export function drive(t, dt, game, report) {
  const c = report.custom;
  if (t > 3 && !game.__m1) {
    game.__m1 = true;
    c.snaps.push(attribute(game, 'player-pov t=' + t.toFixed(1)));
    // overview camera (menu preview camera)
    const pc = game.world.def.previewCamera;
    if (pc) {
      const cam = game.camera, save = { p: cam.position.clone(), q: cam.quaternion.clone() };
      cam.position.fromArray(pc.pos); cam.lookAt(new THREE.Vector3().fromArray(pc.lookAt)); cam.updateMatrixWorld(true);
      c.snaps.push(attribute(game, 'overview'));
      cam.position.copy(save.p); cam.quaternion.copy(save.q); cam.updateMatrixWorld(true);
    }
  }
  if (t > 8 && !game.__m2) {
    game.__m2 = true;
    c.snaps.push(attribute(game, 'player-pov t=' + t.toFixed(1)));
  }
}

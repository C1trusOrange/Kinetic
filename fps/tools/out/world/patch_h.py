p = 'tools/out/world/harness.js'
s = open(p, encoding='utf-8').read()
marker = "  if (tests.includes('tris')) {"
add = """  if (tests.includes('reload')) {
    R.reload = [];
    const files = ['/src/world/maps/sandbox.js', '/tools/out/world/gallery.js', '/tools/out/world/night.js', '/src/world/maps/sandbox.js', '/src/world/maps/sandbox.js'];
    for (const f of files) {
      const d = (await import(f)).default;
      await world.load(d, {});
      // render once so GPU resources exist
      camera.position.set(0, 10, 40); camera.lookAt(0, 0, 0);
      renderer.render(scene, camera);
      let lightsN = 0; scene.traverse(o => { if (o.isLight) lightsN++; });
      R.reload.push({ map: d.id, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures, children: scene.children.length, lights: lightsN, ms: world.stats.totalMs });
    }
    world.applyQuality(QUALITY_PRESETS.low); renderer.render(scene, camera);
    world.applyQuality(QUALITY_PRESETS.medium); renderer.render(scene, camera);
    world.applyQuality(QUALITY_PRESETS.high); renderer.render(scene, camera);
    world.reset();
    world.unload();
    R.afterUnload = { children: scene.children.length, geometries: renderer.info.memory.geometries, bg: scene.background, env: !!scene.environment, fog: !!scene.fog };
    await world.load(def, {});
  }

"""
s = s.replace(marker, add + marker, 1)
open(p, 'w', encoding='utf-8').write(s)
print('ok')

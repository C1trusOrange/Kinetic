(window.__GAME__ && window.__GAME__.state === "menu" && !window.__started && (window.__started = true, (async () => {
  try {
    const g = window.__GAME__, w = g.world;
    const base = g.maps.find(m => m.id === 'foundry');
    const V = g.camera.position.constructor;
    const test = async (dir) => {
      const def = { ...base, id: 'foundry-sun', theme: { ...base.theme, sun: { ...(base.theme.sun || {}), dir } } };
      await w.load(def);
      w.sun.shadow.updateMatrices(w.sun);
      const cam = w.sun.shadow.camera;
      const M = new (cam.projectionMatrix.constructor)().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
      let total = 0, out = 0, outPlay = 0;
      const p = new V();
      const bd = w.bounds;
      w._solidsGroup.traverse(o => {
        if (!o.isMesh || !o.castShadow) return;
        const P = o.geometry.attributes.position;
        for (let i = 0; i < P.count; i += 3) {
          p.set(P.getX(i), P.getY(i), P.getZ(i));
          const inPlay = bd.containsPoint(p);
          p.applyMatrix4(M);
          total++;
          if (Math.abs(p.x) > 1 || Math.abs(p.y) > 1) { out++; if (inPlay) outPlay++; }
        }
      });
      return { dir, l: +cam.left.toFixed(1), r: +cam.right.toFixed(1), b: +cam.bottom.toFixed(1), t: +cam.top.toFixed(1), total, out, outPlay, bounds: [bd.min.toArray(), bd.max.toArray()] };
    };
    window.__JOB__ = { normal: await test([-0.5, 0.7, 0.35]), high: await test([-0.5, 0.86, 0.35]), zenithish: await test([0.02, 1, 0.02]), zenith: await test([0, 1, 0]) };
  } catch (e) { window.__JOB__ = { error: String(e && e.stack || e) }; }
  window.__jobdone = true;
})()), window.__jobdone === true)

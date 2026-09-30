(window.__GAME__ && window.__GAME__.state === "menu" && !window.__started && (window.__started = true, (async () => {
  try {
    const g = window.__GAME__, w = g.world;
    const V3 = g.camera.position.constructor;
    const byId = id => g.maps.find(m => m.id === id);
    const G = 24;
    const out = {};
    for (const id of ['foundry', 'ruins', 'skyline', 'sandbox']) {
      await w.load(byId(id));
      const c = w.collision;
      const res = [];
      w.jumpPads.forEach((pad, i) => {
        const pos = pad.position, tg = pad.target, vel = pad.velocity;
        const dy = tg.y - pos.y;
        const tEnd = (vel.y + Math.sqrt(Math.max(0, vel.y * vel.y - 2 * G * dy))) / G;
        const hd = new V3(vel.x, 0, vel.z).normalize();
        const side = new V3().crossVectors(hd, new V3(0, 1, 0)).normalize();
        const test = (h, off) => {
          const p0 = new V3(pos.x, pos.y + h, pos.z).addScaledVector(side, off), p1 = new V3(), dir = new V3();
          const steps = 60;
          for (let s = 1; s <= steps; s++) {
            const t = (s / steps) * tEnd * 0.94;
            p1.set(pos.x + vel.x * t, pos.y + h + vel.y * t - 0.5 * G * t * t, pos.z + vel.z * t).addScaledVector(side, off);
            dir.subVectors(p1, p0);
            const len = dir.length();
            if (len < 1e-4) continue;
            dir.multiplyScalar(1 / len);
            const hit = c.raycast(p0, dir, len);
            if (hit) return [+hit.point.x.toFixed(1), +hit.point.y.toFixed(1), +hit.point.z.toFixed(1)];
            p0.copy(p1);
          }
          return null;
        };
        res.push({ i, waist: test(0.9, 0), feet: test(0.1, 0), head: test(1.7, 0), feetL: test(0.3, 0.4), feetR: test(0.3, -0.4), warnedByWorld: w.warnings.filter(m => m.startsWith('jumpPad #' + i)) });
      });
      out[id] = res;
    }
    window.__JOB__ = out;
  } catch (e) { window.__JOB__ = { error: String(e && e.stack || e) }; }
  window.__jobdone = true;
})()), window.__jobdone === true)
